/**
 * The rollback files in supabase/rollback must undo their migration cleanly, so a bad go-live can be
 * reversed: apply up to the migration, run its rollback, check nothing is left, re-apply.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const ROOT = join(__dirname, '..', '..')
it('order-form migration rolls back and re-applies cleanly', async () => {
  const src = readFileSync(join(ROOT, 'supabase/tests/db.test.ts'), 'utf8')
  const stub = /const SUPABASE_STUB = `([\s\S]*?)`/.exec(src)![1]
  const db = new PGlite()
  await db.exec(stub)
  const mig = join(ROOT, 'supabase/migrations')
  const files = readdirSync(mig).filter((f) => f.endsWith('.sql')).sort().filter((f) => f <= '20261123120100_order_form.sql')
  for (const f of files) await db.exec(readFileSync(join(mig, f), 'utf8'))
  const pcBefore = (await db.query<{ d: string }>(`select pg_get_functiondef('public.payment_checked()'::regprocedure) d`)).rows[0].d
  await db.exec(readFileSync(join(ROOT, 'supabase/rollback/20261123120100_order_form.down.sql'), 'utf8'))
  const left = await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'form\_%'`)
  expect(left.rows).toEqual([])
  const cols = await db.query(`select column_name from information_schema.columns where table_schema='public' and column_name in ('user_id','screenshot_path','form_order_id') and table_name in ('buyers','payments','order_items')`)
  expect(cols.rows).toEqual([])
  const fn = await db.query(`select proname from pg_proc where proname in ('submit_order','get_order_form','my_orders','student_email','is_form_admin')`)
  expect(fn.rows).toEqual([])
  // payment_checked is back to the security-fixes version (no screenshot_path)
  const pc = (await db.query<{ d: string }>(`select pg_get_functiondef('public.payment_checked()'::regprocedure) d`)).rows[0].d
  expect(pc).not.toContain('screenshot_path')
  expect(pc).toContain('old.screenshot_url, old.import_id')
  // and the migration applies again
  await db.exec(readFileSync(join(mig, '20261123120100_order_form.sql'), 'utf8'))
  const pcAgain = (await db.query<{ d: string }>(`select pg_get_functiondef('public.payment_checked()'::regprocedure) d`)).rows[0].d
  expect(pcAgain).toBe(pcBefore)
  await db.close()
}, 60000)

it('storage migration rolls back cleanly, then the order-form one too, and both re-apply', async () => {
  const src = readFileSync(join(ROOT, 'supabase/tests/db.test.ts'), 'utf8')
  const stub = /const SUPABASE_STUB = `([\s\S]*?)`/.exec(src)![1]
  const db = new PGlite()
  await db.exec(stub)
  const mig = join(ROOT, 'supabase/migrations')
  const rb = join(ROOT, 'supabase/rollback')
  for (const f of readdirSync(mig).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(mig, f), 'utf8'))
  const count = async () => ({
    buckets: (await db.query<{ n: number }>(`select count(*)::int n from storage.buckets`)).rows[0].n,
    policies: (await db.query<{ n: number }>(`select count(*)::int n from pg_policies where schemaname = 'storage'`)).rows[0].n,
  })
  expect(await count()).toEqual({ buckets: 2, policies: 6 })
  await db.exec(readFileSync(join(rb, '20261123120200_order_form_storage.down.sql'), 'utf8'))
  expect(await count()).toEqual({ buckets: 0, policies: 0 })
  // with storage gone, the order-form rollback also runs (its functions are no longer used by policies)
  await db.exec(readFileSync(join(rb, '20261123120100_order_form.down.sql'), 'utf8'))
  await db.exec(readFileSync(join(mig, '20261123120100_order_form.sql'), 'utf8'))
  await db.exec(readFileSync(join(mig, '20261123120200_order_form_storage.sql'), 'utf8'))
  expect(await count()).toEqual({ buckets: 2, policies: 6 })
  await db.close()
}, 60000)
