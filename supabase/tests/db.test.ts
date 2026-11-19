/**
 * Runs the real migrations in an in-memory Postgres (PGlite) with a minimal stand-in for
 * Supabase's auth schema, then checks permissions and the audit trail as different users.
 * This is what "enforced in the database" means: these calls go straight to SQL, no UI.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = join(__dirname, '..', 'migrations')

// Just enough of Supabase for the migrations: roles, auth.users, auth.uid(), auth.jwt().
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant execute on all functions in schema auth to anon, authenticated;
`

const USERS = {
  main: { sub: '00000000-0000-0000-0000-000000000001', email: 'main@mdi.ac.in', role: 'main_admin' },
  admin: { sub: '00000000-0000-0000-0000-000000000002', email: 'admin@mdi.ac.in', role: 'admin' },
  ops: { sub: '00000000-0000-0000-0000-000000000003', email: 'ops@mdi.ac.in', role: 'ops' },
  stranger: { sub: '00000000-0000-0000-0000-000000000009', email: 'someone@mdi.ac.in', role: null },
} as const
type Who = keyof typeof USERS

let db: PGlite

/** Run SQL as a signed-in user (role authenticated + JWT claims), like PostgREST does. */
async function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []) {
  const u = USERS[who]
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: u.sub, email: u.email, role: 'authenticated' }),
    ])
    await tx.exec('set local role authenticated')
    const res = await tx.query<T>(sql, params)
    return res
  })
}

async function fails(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected the query to fail, but it succeeded')
}

let itemId: string
let productId: string
let campaignId: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  }
  // the migrations seed George as the first main admin; these tests use their own users
  const seeded = await db.query<{ role: string }>(`select role from public.members where email = 'pgdm26oliver_j@mdi.ac.in'`)
  expect(seeded.rows[0]?.role).toBe('main_admin')
  // seed members as the SQL editor would (superuser, no JWT)
  for (const u of Object.values(USERS)) {
    if (u.role) {
      await db.query(`insert into public.members (email, display_name, role) values ($1, $2, $3)`, [
        u.email,
        u.email.split('@')[0],
        u.role,
      ])
    }
  }
  await db.query(`delete from public.members where email = 'pgdm26oliver_j@mdi.ac.in'`)
  const p = await db.query<{ id: string; campaign_id: string }>(
    `select id, campaign_id from public.products where name = 'Classic MDI Navy Blue'`,
  )
  productId = p.rows[0].id
  campaignId = p.rows[0].campaign_id

  const res = await as<{ import_orders: { items_created: number } }>(
    'admin',
    `select public.import_orders($1, 'fake.csv', 2, 0, $2::jsonb, $3::jsonb)`,
    [
      campaignId,
      JSON.stringify([
        { roll_no: 'pgp26-001', name: 'Test One', email: 'one@example.test' },
        { roll_no: 'PGP26-002', name: 'Test Two', email: 'two@example.test' },
      ]),
      JSON.stringify([
        { roll_no: 'PGP26-001', product_id: productId, size: 'M', print_name: 'ONE', source_slot: 1 },
        { roll_no: 'PGP26-001', product_id: productId, size: 'L', print_name: null, source_slot: 2 },
        { roll_no: 'PGP26-002', product_id: productId, size: 'S', print_name: 'TWO', source_slot: 1 },
      ]),
    ],
  )
  expect(res.rows[0].import_orders.items_created).toBe(3)
  const item = await db.query<{ id: string }>(`select id from public.order_items where size = 'M'`)
  itemId = item.rows[0].id
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('migrations', () => {
  it('seed the 2026 campaign with four products', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.products`)
    expect(r.rows[0].n).toBe(4)
  })
})

describe('sign-in gate', () => {
  it('refuses to create an auth user who is not on the team list', async () => {
    const msg = await fails(db.query(`insert into auth.users (email) values ('random@gmail.com')`))
    expect(msg).toMatch(/not on the MART team list/)
  })
  it('lets a team member sign up and links their member row', async () => {
    await db.query(`insert into auth.users (email) values ('OPS@mdi.ac.in')`)
    const r = await db.query<{ ok: boolean }>(
      `select m.user_id = u.id as ok from public.members m join auth.users u on lower(u.email) = m.email
        where m.email = 'ops@mdi.ac.in'`,
    )
    expect(r.rows[0].ok).toBe(true)
  })
  it('link_my_member sets user_id from the JWT', async () => {
    await as('admin', `select public.link_my_member()`)
    const r = await db.query<{ user_id: string }>(`select user_id from public.members where email = 'admin@mdi.ac.in'`)
    expect(r.rows[0].user_id).toBe(USERS.admin.sub)
  })
  it('only accepts @mdi.ac.in emails on the team list', async () => {
    const msg = await fails(as('main', `insert into public.members (email, display_name) values ('x@gmail.com', 'X')`))
    expect(msg).toMatch(/check constraint/)
  })
})

describe('who can see data', () => {
  it('a signed-in non-member sees nothing', async () => {
    const r = await as('stranger', `select * from public.order_items`)
    expect(r.rows).toHaveLength(0)
    const b = await as('stranger', `select * from public.buyers`)
    expect(b.rows).toHaveLength(0)
  })
  it('anon has no access at all', async () => {
    const msg = await fails(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        await tx.query('select * from public.order_items')
      }),
    )
    expect(msg).toMatch(/permission denied/)
  })
  it('anon can call ping (keep-alive) and nothing else', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      return tx.query<{ ping: string }>('select public.ping()')
    })
    expect(r.rows[0].ping).toBe('ok')
    const msg = await fails(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        await tx.query(`select public.set_items_status('{}', 'received')`)
      }),
    )
    expect(msg).toMatch(/permission denied/)
  })
  it('every member can read items', async () => {
    for (const w of ['main', 'admin', 'ops'] as const) {
      const r = await as(w, `select id from public.order_items`)
      expect(r.rows).toHaveLength(3)
    }
  })
})

describe('Ops limits', () => {
  it('Ops cannot delete', async () => {
    await as('ops', `delete from public.order_items`)
    await as('ops', `delete from public.buyers`)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.order_items`)
    expect(r.rows[0].n).toBe(3) // RLS: delete matched no rows
  })
  it('Ops cannot change roles or add members', async () => {
    await as('ops', `update public.members set role = 'main_admin' where email = 'ops@mdi.ac.in'`)
    const r = await db.query<{ role: string }>(`select role from public.members where email = 'ops@mdi.ac.in'`)
    expect(r.rows[0].role).toBe('ops')
    const msg = await fails(
      as('ops', `insert into public.members (email, display_name, role) values ('new@mdi.ac.in', 'N', 'admin')`),
    )
    expect(msg).toMatch(/row-level security/)
  })
  it('Ops can change status but not other columns', async () => {
    const n = await as<{ set_items_status: number }>('ops', `select public.set_items_status($1, 'received')`, [
      [itemId],
    ])
    expect(n.rows[0].set_items_status).toBe(1)
    const msg = await fails(as('ops', `update public.order_items set size = 'XL' where id = $1`, [itemId]))
    expect(msg).toMatch(/status only/)
  })
  it('Ops cannot write the audit log', async () => {
    const msg = await fails(as('ops', `insert into public.audit_log (action, table_name) values ('INSERT', 'x')`))
    expect(msg).toMatch(/permission denied/)
  })
})

describe('deleting products', () => {
  it('an admin can delete a product nobody ordered', async () => {
    await as('admin', `insert into public.products (campaign_id, name, colour, price_inr) values ($1, 'Temp Hoodie', 'Grey', 999)`, [
      campaignId,
    ])
    await as('admin', `delete from public.products where name = 'Temp Hoodie'`)
    expect((await db.query(`select 1 from public.products where name = 'Temp Hoodie'`)).rows).toHaveLength(0)
  })
  it('a product with orders cannot be deleted, even by an admin', async () => {
    const msg = await fails(as('admin', `delete from public.products where id = $1`, [productId]))
    expect(msg).toMatch(/foreign key/)
  })
  it('Ops cannot delete products', async () => {
    await as('admin', `insert into public.products (campaign_id, name, colour, price_inr) values ($1, 'Temp Cap', 'Black', 299)`, [
      campaignId,
    ])
    await as('ops', `delete from public.products where name = 'Temp Cap'`)
    expect((await db.query(`select 1 from public.products where name = 'Temp Cap'`)).rows).toHaveLength(1)
  })
})

describe('roles', () => {
  it('there is no separate IT role any more (merged into admin)', async () => {
    const r = await db.query<{ v: string }>(`select unnest(enum_range(null::public.app_role))::text as v`)
    expect(r.rows.map((x) => x.v)).toEqual(['main_admin', 'admin', 'ops'])
  })
  it('the super admin can add, change and remove admins and ops', async () => {
    await as('main', `insert into public.members (email, display_name, role) values ('temp.admin@mdi.ac.in', 'T', 'admin')`)
    await as('main', `update public.members set role = 'ops' where email = 'temp.admin@mdi.ac.in'`)
    await as('main', `delete from public.members where email = 'temp.admin@mdi.ac.in'`)
    expect((await db.query(`select 1 from public.members where email = 'temp.admin@mdi.ac.in'`)).rows).toHaveLength(0)
  })
  it('Ops cannot add team members', async () => {
    const msg = await fails(
      as('ops', `insert into public.members (email, display_name, role) values ('x.ops@mdi.ac.in', 'X', 'ops')`),
    )
    expect(msg).toMatch(/row-level security/)
  })
})

describe('Team & roles', () => {
  it('an admin can add members and change roles', async () => {
    await as('admin', `insert into public.members (email, display_name, role) values ('newops@mdi.ac.in', 'New Ops', 'ops')`)
    await as('admin', `update public.members set role = 'admin' where email = 'newops@mdi.ac.in'`)
    const r = await db.query<{ role: string }>(`select role from public.members where email = 'newops@mdi.ac.in'`)
    expect(r.rows[0].role).toBe('admin')
  })
  it('an admin cannot create a main admin or edit one', async () => {
    const msg = await fails(
      as('admin', `insert into public.members (email, display_name, role) values ('boss@mdi.ac.in', 'B', 'main_admin')`),
    )
    expect(msg).toMatch(/row-level security/)
    const promote = await fails(as('admin', `update public.members set role = 'main_admin' where email = 'newops@mdi.ac.in'`))
    expect(promote).toMatch(/row-level security/)
    await as('admin', `update public.members set active = false where email = 'main@mdi.ac.in'`)
    const r = await db.query<{ active: boolean }>(`select active from public.members where email = 'main@mdi.ac.in'`)
    expect(r.rows[0].active).toBe(true)
  })
  it('an admin cannot delete members; the main admin can', async () => {
    await as('admin', `delete from public.members where email = 'newops@mdi.ac.in'`)
    expect((await db.query(`select 1 from public.members where email = 'newops@mdi.ac.in'`)).rows).toHaveLength(1)
    await as('main', `delete from public.members where email = 'newops@mdi.ac.in'`)
    expect((await db.query(`select 1 from public.members where email = 'newops@mdi.ac.in'`)).rows).toHaveLength(0)
  })
})

describe('handovers', () => {
  it('cannot mark handed over without the handover desk', async () => {
    const msg = await fails(as('admin', `update public.order_items set status = 'handed_over' where id = $1`, [itemId]))
    expect(msg).toMatch(/handover desk/)
  })
  it('cannot hand over a shirt that is not in MART yet', async () => {
    const other = await db.query<{ id: string }>(`select id from public.order_items where size = 'S'`)
    const msg = await fails(as('ops', `select public.record_handover($1, 'self')`, [[other.rows[0].id]]))
    expect(msg).toMatch(/received/)
  })
  it('needs collector name and roll no. when someone else collects', async () => {
    const msg = await fails(as('ops', `select public.record_handover($1, 'collected_by_other', '', '')`, [[itemId]]))
    expect(msg).toMatch(/handover_collector_required/)
  })
  it('Ops records a handover to someone else', async () => {
    await as('ops', `select public.record_handover($1, 'collected_by_other', 'Friend Name', 'pgp26-050')`, [[itemId]])
    const r = await db.query<{ status: string; collector_roll: string; handed_by: string }>(
      `select i.status, h.collector_roll, h.handed_by from public.order_items i
         join public.handovers h on h.item_id = i.id where i.id = $1`,
      [itemId],
    )
    expect(r.rows[0]).toMatchObject({ status: 'handed_over', collector_roll: 'PGP26-050', handed_by: USERS.ops.sub })
  })
  it('the same shirt cannot be handed over twice', async () => {
    const msg = await fails(as('ops', `select public.record_handover($1, 'self')`, [[itemId]]))
    expect(msg).toMatch(/received/)
  })
  it('Ops cannot undo a handover; admins can, with a reason', async () => {
    const msg = await fails(as('ops', `select public.undo_handover($1, 'mistake')`, [itemId]))
    expect(msg).toMatch(/Only admins/)
    const noReason = await fails(as('admin', `select public.undo_handover($1, '  ')`, [itemId]))
    expect(noReason).toMatch(/reason/)
    await as('admin', `select public.undo_handover($1, 'Wrong student')`, [itemId])
    const r = await db.query<{ status: string }>(`select status from public.order_items where id = $1`, [itemId])
    expect(r.rows[0].status).toBe('received')
  })
})

describe('audit log', () => {
  it('records every status change and handover with the user', async () => {
    const r = await db.query<{ action: string; table_name: string; actor_name: string; changed: string[] | null }>(
      `select action, table_name, actor_name, changed from public.audit_log where item_id = $1 order by id`,
      [itemId],
    )
    const lines = r.rows.map((x) => `${x.table_name}:${x.action}:${x.actor_name}:${(x.changed ?? []).join(',')}`)
    expect(lines).toEqual([
      'order_items:INSERT:admin:',
      'order_items:UPDATE:ops:status',
      'handovers:INSERT:ops:',
      'order_items:UPDATE:ops:status',
      'handovers:UPDATE:admin:undo_reason,undone_at,undone_by',
      'order_items:UPDATE:admin:status',
    ])
  })
  it('stores old and new values', async () => {
    const r = await db.query<{ old_data: { status: string }; new_data: { status: string } }>(
      `select old_data, new_data from public.audit_log
        where item_id = $1 and table_name = 'order_items' and action = 'UPDATE' order by id limit 1`,
      [itemId],
    )
    expect(r.rows[0].old_data.status).toBe('ordered')
    expect(r.rows[0].new_data.status).toBe('received')
  })
  it('is append-only even for the database owner', async () => {
    expect(await fails(db.query(`delete from public.audit_log`))).toMatch(/append-only/)
    expect(await fails(db.query(`update public.audit_log set actor_name = 'x'`))).toMatch(/append-only/)
  })
  it('members can read it', async () => {
    const r = await as('ops', `select count(*)::int as n from public.audit_log`)
    expect((r.rows[0] as { n: number }).n).toBeGreaterThan(5)
  })
})

describe('main admin safety', () => {
  it('the last main admin cannot be demoted', async () => {
    const msg = await fails(as('main', `update public.members set role = 'admin' where email = 'main@mdi.ac.in'`))
    expect(msg).toMatch(/at least one active main admin/)
  })
})
