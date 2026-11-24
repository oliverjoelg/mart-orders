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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
                           raw_app_meta_data jsonb default '{"provider": "google", "providers": ["google"]}');
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant execute on all functions in schema auth to anon, authenticated;

  -- Supabase Storage, just the parts the policies use
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean default false,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets,
                                name text not null, owner uuid default auth.uid(), created_at timestamptz default now(),
                                unique (bucket_id, name));
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant execute on all functions in schema storage to anon, authenticated;
`

const USERS = {
  main: { sub: '00000000-0000-0000-0000-000000000001', email: 'main@mdi.ac.in', role: 'main_admin' },
  admin: { sub: '00000000-0000-0000-0000-000000000002', email: 'admin@mdi.ac.in', role: 'admin' },
  ops: { sub: '00000000-0000-0000-0000-000000000003', email: 'ops@mdi.ac.in', role: 'ops' },
  stranger: { sub: '00000000-0000-0000-0000-000000000009', email: 'someone@mdi.ac.in', role: null },
  // order form: students and a form admin are not MART members
  student: { sub: '00000000-0000-0000-0000-000000000010', email: 'student@mdi.ac.in', role: null },
  student2: { sub: '00000000-0000-0000-0000-000000000011', email: 'student2@mdi.ac.in', role: null },
  formadmin: { sub: '00000000-0000-0000-0000-000000000012', email: 'formadmin@mdi.ac.in', role: null },
} as const
type Who = keyof typeof USERS

let db: PGlite

/** Run SQL as a signed-in user (role authenticated + JWT claims), like PostgREST does. */
async function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []) {
  const u = USERS[who]
  return asClaims<T>(
    { sub: u.sub, email: u.email, role: 'authenticated', app_metadata: { provider: 'google', providers: ['google'] } },
    sql,
    params,
  )
}

/** Run SQL with exactly these JWT claims. */
async function asClaims<T = Record<string, unknown>>(claims: object, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
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
  // the migrations seed Oliver as the first main admin; these tests use their own users
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
  it('refuses to create an auth user who is not @mdi.ac.in and not on the team list', async () => {
    const msg = await fails(db.query(`insert into auth.users (email) values ('random@gmail.com')`))
    expect(msg).toMatch(/Only @mdi.ac.in Google accounts/) // a Google sign-up (the stub's default)
  })
  it('lets any @mdi.ac.in account sign up (students, for the order form) without making them members', async () => {
    await db.query(`insert into auth.users (email) values ('Fresh.Student@mdi.ac.in')`)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.members where email = 'fresh.student@mdi.ac.in'`)
    expect(r.rows[0].n).toBe(0)
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
  it('only accepts @mdi.ac.in emails on the team list (except backup super admins)', async () => {
    const msg = await fails(as('main', `insert into public.members (email, display_name) values ('x@gmail.com', 'X')`))
    expect(msg).toMatch(/need an @mdi.ac.in email/)
    const bad = await fails(as('main', `insert into public.members (email, display_name, role) values ('not an email', 'X', 'main_admin')`))
    expect(bad).toMatch(/check constraint/)
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

describe('names come from Google', () => {
  it('first sign-in takes the Google name, not what was typed', async () => {
    await db.query(`insert into public.members (email, display_name, role) values ('name.test@mdi.ac.in', 'Typed Name', 'ops')`)
    await db.query(`insert into auth.users (email, raw_user_meta_data) values ('name.test@mdi.ac.in', '{"full_name":"Real Google Name"}')`)
    const r = await db.query<{ display_name: string }>(`select display_name from public.members where email = 'name.test@mdi.ac.in'`)
    expect(r.rows[0].display_name).toBe('Real Google Name')
  })
  it('each sign-in refreshes the name from the Google identity', async () => {
    await db.query(`insert into auth.identities (user_id, provider, identity_data) values ($1, 'google', '{"full_name":"Ops From Google"}')`, [USERS.ops.sub])
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({
          sub: USERS.ops.sub,
          email: USERS.ops.email,
          role: 'authenticated',
          app_metadata: { provider: 'google' },
        }),
      ])
      await tx.exec('set local role authenticated')
      await tx.query('select public.link_my_member()')
    })
    const r = await db.query<{ display_name: string }>(`select display_name from public.members where email = 'ops@mdi.ac.in'`)
    expect(r.rows[0].display_name).toBe('Ops From Google')
    // put the short name back for the audit-log tests below
    await db.query(`update public.members set display_name = 'ops' where email = 'ops@mdi.ac.in'`)
    await db.query(`delete from auth.identities where user_id = $1`, [USERS.ops.sub])
  })
  it('the activity log uses the nickname when one is set', async () => {
    await as('main', `update public.members set nickname = 'Opsy' where email = 'ops@mdi.ac.in'`)
    await as('ops', `insert into public.notes (buyer_id, body, created_by) select id, 'nickname check', $1 from public.buyers limit 1`, [
      USERS.ops.sub,
    ])
    const r = await db.query<{ actor_name: string }>(
      `select actor_name from public.audit_log where table_name = 'notes' order by id desc limit 1`,
    )
    expect(r.rows[0].actor_name).toBe('Opsy')
    await db.query(`update public.members set nickname = null where email = 'ops@mdi.ac.in'`)
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
    const r = await db.query<{ v: string }>(`select key as v from public.roles order by sort_order`)
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
    expect(msg).toMatch(/cannot undo/)
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
    expect(msg).toMatch(/at least one active super admin/)
  })
})



describe('backup super admins (non-MDI)', () => {
  const BACKUP = 'mart.backup@gmail.com'
  it('a super admin can add a personal email, but only as super admin', async () => {
    await as('main', `insert into public.members (email, display_name, role) values ($1, 'Backup', 'main_admin')`, [BACKUP])
    const asOps = await fails(as('main', `insert into public.members (email, display_name, role) values ('y@gmail.com', 'Y', 'ops')`))
    expect(asOps).toMatch(/need an @mdi.ac.in email/)
    const demote = await fails(as('main', `update public.members set role = 'admin' where email = $1`, [BACKUP]))
    expect(demote).toMatch(/can only be a super admin/)
  })
  it('an admin cannot add one', async () => {
    const msg = await fails(as('admin', `insert into public.members (email, display_name, role) values ('z@gmail.com', 'Z', 'main_admin')`))
    expect(msg).toMatch(/row-level security/)
  })
  it('is invisible to admins and ops, visible to super admins', async () => {
    for (const who of ['admin', 'ops'] as const) {
      const r = await as(who, `select 1 from public.members where email = $1`, [BACKUP])
      expect(r.rows).toHaveLength(0)
      const log = await as(who, `select 1 from public.audit_log where table_name = 'members' and new_data ->> 'email' = $1`, [BACKUP])
      expect(log.rows).toHaveLength(0)
    }
    expect((await as('main', `select 1 from public.members where email = $1`, [BACKUP])).rows).toHaveLength(1)
    expect((await as('main', `select 1 from public.audit_log where new_data ->> 'email' = $1`, [BACKUP])).rows.length).toBeGreaterThan(0)
  })
  it('can sign in and acts as a super admin', async () => {
    await db.query(`insert into auth.users (email) values ($1)`, [BACKUP])
    const r = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: '00000000-0000-0000-0000-0000000000bb', email: BACKUP, role: 'authenticated', app_metadata: { provider: 'google' } }),
      ])
      await tx.exec('set local role authenticated')
      return tx.query<{ ok: boolean }>(`select public.is_super() as ok`)
    })
    expect(r.rows[0].ok).toBe(true)
  })
  it('a super admin can remove it', async () => {
    await as('main', `delete from public.members where email = $1`, [BACKUP])
    expect((await db.query(`select 1 from public.members where email = $1`, [BACKUP])).rows).toHaveLength(0)
  })
})

describe('roles & permissions (configurable)', () => {
  it('a new role gets exactly the ticked permissions', async () => {
    await as('main', `insert into public.roles (key, name) values ('volunteer', 'Volunteer')`)
    await as('main', `insert into public.role_permissions (role_key, permission) values ('volunteer', 'hand_over')`)
    await as('main', `insert into public.members (email, display_name, role) values ('vol@mdi.ac.in', 'Vol', 'volunteer')`)
    const can = async (p: string) =>
      (
        await db.transaction(async (tx) => {
          await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: '00000000-0000-0000-0000-0000000000aa', email: 'vol@mdi.ac.in', role: 'authenticated', app_metadata: { provider: 'google' } }),
          ])
          await tx.exec('set local role authenticated')
          return tx.query<{ ok: boolean }>(`select public.has_perm($1) as ok`, [p])
        })
      ).rows[0].ok
    expect(await can('hand_over')).toBe(true)
    expect(await can('receive_stock')).toBe(false)
    expect(await can('delete_items')).toBe(false)
  })
  it('unticking a permission takes effect in the database', async () => {
    await as('main', `delete from public.role_permissions where role_key = 'ops' and permission = 'spare_stock'`)
    const msg = await fails(as('ops', `insert into public.spare_stock (product_id, size, quantity) values ($1, 'M', 2)`, [productId]))
    expect(msg).toMatch(/row-level security/)
    await as('main', `insert into public.role_permissions (role_key, permission) values ('ops', 'spare_stock')`)
    await as('ops', `insert into public.spare_stock (product_id, size, quantity) values ($1, 'M', 2)`, [productId])
  })
  it('only the super admin can change permissions or roles', async () => {
    const msg = await fails(as('admin', `insert into public.role_permissions (role_key, permission) values ('admin', 'remove_members')`))
    expect(msg).toMatch(/row-level security/)
    const msg2 = await fails(as('admin', `insert into public.roles (key, name) values ('boss', 'Boss')`))
    expect(msg2).toMatch(/row-level security/)
  })
  it('the super admin role cannot be deleted or edited', async () => {
    expect(await fails(as('main', `delete from public.roles where key = 'main_admin'`))).toMatch(/cannot be deleted/)
    expect(await fails(as('main', `update public.roles set is_super = false where key = 'main_admin'`))).toMatch(/cannot be changed/)
  })
  it('a role with members cannot be deleted', async () => {
    expect(await fails(as('main', `delete from public.roles where key = 'volunteer'`))).toMatch(/foreign key/)
  })
})

describe('payments', () => {
  const TS = '2026-09-04T14:52:09.559Z'
  const importPayments = (payments: unknown[]) =>
    as<{ import_orders: { payments_added: number } }>(
      'admin',
      `select public.import_orders($1, 'pay.csv', 1, 0, '[]'::jsonb, '[]'::jsonb, $2::jsonb)`,
      [campaignId, JSON.stringify(payments)],
    )
  const count = async (who: Who) =>
    (await as<{ n: number }>(who, `select count(*)::int as n from public.payments where campaign_id = $1`, [campaignId])).rows[0].n

  it('adding orders saves payment details, once per form response', async () => {
    const first = await importPayments([
      { roll_no: 'PGP26-001', source_timestamp: TS, paid_to: 'Animesh', amount_paid: 1398, txn_id: '512345678901', screenshot_url: 'https://drive.google.com/x' },
      { roll_no: 'PGP26-999', source_timestamp: TS, paid_to: 'Ekta', amount_paid: 699, txn_id: 'T9' },
    ])
    expect(first.rows[0].import_orders.payments_added).toBe(1) // PGP26-999 has no items in this round
    const again = await importPayments([{ roll_no: 'PGP26-001', source_timestamp: TS, paid_to: 'Animesh', amount_paid: 1398 }])
    expect(again.rows[0].import_orders.payments_added).toBe(0)
    // the same response from an Excel copy, where the time lost its milliseconds
    const excel = await importPayments([{ roll_no: 'PGP26-001', source_timestamp: '2026-09-04T14:52:09Z', paid_to: 'Animesh', amount_paid: 1398 }])
    expect(excel.rows[0].import_orders.payments_added).toBe(0)
  })
  it('only roles with the Payments page can see them', async () => {
    expect(await count('admin')).toBe(0)
    expect(await count('ops')).toBe(0)
    expect(await count('main')).toBe(1)
  })
  it('ticking needs "Check payments" and records who and when', async () => {
    await as('admin', `update public.payments set status = 'received' where campaign_id = $1`, [campaignId])
    let r = await db.query<{ status: string }>(`select status from public.payments where campaign_id = $1`, [campaignId])
    expect(r.rows[0].status).toBe('unchecked')

    await as('main', `insert into public.role_permissions (role_key, permission) values ('admin', 'page_payments'), ('admin', 'check_payments')`)
    expect(await count('admin')).toBe(1)
    await as('admin', `update public.payments set status = 'received' where campaign_id = $1`, [campaignId])
    const done = await db.query<{ status: string; checked_by: string; checked_at: string | null }>(
      `select status, checked_by, checked_at from public.payments where campaign_id = $1`, [campaignId])
    expect(done.rows[0]).toMatchObject({ status: 'received', checked_by: USERS.admin.sub })
    expect(done.rows[0].checked_at).not.toBeNull()

    await as('admin', `update public.payments set status = 'unchecked' where campaign_id = $1`, [campaignId])
    r = await db.query<{ status: string; checked_by: string | null }>(`select status, checked_by from public.payments where campaign_id = $1`, [campaignId])
    expect(r.rows[0]).toMatchObject({ status: 'unchecked', checked_by: null })
  })
  it('payment log entries are hidden from roles without the Payments page', async () => {
    const q = `select count(*)::int as n from public.audit_log where table_name = 'payments'`
    expect((await as<{ n: number }>('ops', q)).rows[0].n).toBe(0)
    expect((await as<{ n: number }>('main', q)).rows[0].n).toBeGreaterThan(0)
  })
  it('only a super admin can remove a payment', async () => {
    await as('admin', `delete from public.payments where campaign_id = $1`, [campaignId])
    expect(await count('main')).toBe(1)
    await as('main', `insert into public.payments (campaign_id, buyer_id, paid_to, amount_paid)
                      select $1, id, 'Ekta', 10 from public.buyers where roll_no = 'PGP26-002'`, [campaignId])
    expect(await count('main')).toBe(2)
    await as('main', `delete from public.payments where campaign_id = $1 and amount_paid = 10`, [campaignId])
    expect(await count('main')).toBe(1)
    await as('main', `delete from public.role_permissions where role_key = 'admin' and permission in ('page_payments', 'check_payments')`)
  })
})

describe('security review fixes (2026-11-23)', () => {
  const asProvider = (email: string, provider: string, sql: string) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: '00000000-0000-0000-0000-0000000000cc', email, role: 'authenticated', app_metadata: { provider } }),
      ])
      await tx.exec('set local role authenticated')
      return tx.query<{ r: string | null }>(sql)
    })

  it('only a Google sign-in is recognised as a team member', async () => {
    expect((await asProvider('admin@mdi.ac.in', 'google', `select public.my_role() as r`)).rows[0].r).toBe('admin')
    expect((await asProvider('admin@mdi.ac.in', 'email', `select public.my_role() as r`)).rows[0].r).toBeNull()
    expect((await asProvider('ADMIN@mdi.ac.in', 'google', `select public.my_role() as r`)).rows[0].r).toBe('admin')
  })

  it('a role that can only add orders cannot create an already-received payment', async () => {
    const msg = await fails(
      as('admin', `insert into public.payments (campaign_id, buyer_id, amount_paid, status)
                   select $1, id, 1, 'received' from public.buyers where roll_no = 'PGP26-002'`, [campaignId]),
    )
    expect(msg).toMatch(/row-level security/)
  })

  it('who checked a payment, and who created it, cannot be faked', async () => {
    await as('main', `insert into public.role_permissions (role_key, permission) values ('admin', 'page_payments'), ('admin', 'check_payments')`)
    await as('admin', `insert into public.payments (campaign_id, buyer_id, amount_paid, status, created_by, checked_by)
                       select $1, id, 7, 'received', $2, $2 from public.buyers where roll_no = 'PGP26-002'`, [campaignId, USERS.main.sub])
    let r = await db.query<{ id: string; created_by: string; checked_by: string }>(
      `select id, created_by, checked_by from public.payments where amount_paid = 7`)
    expect(r.rows[0]).toMatchObject({ created_by: USERS.admin.sub, checked_by: USERS.admin.sub })
    // editing the note can't rewrite who checked it
    await as('admin', `update public.payments set note = 'x', checked_by = $1, checked_at = '2020-01-01' where amount_paid = 7`, [USERS.main.sub])
    r = await db.query(`select id, created_by, checked_by from public.payments where amount_paid = 7`)
    expect(r.rows[0].checked_by).toBe(USERS.admin.sub)
    // and the payment can't be moved to another student
    const moved = await fails(as('admin', `update public.payments set buyer_id = (select id from public.buyers where roll_no = 'PGP26-001') where amount_paid = 7`))
    expect(moved).toMatch(/can't be changed/)
    await as('main', `delete from public.payments where amount_paid = 7`)
    await as('main', `delete from public.role_permissions where role_key = 'admin' and permission in ('page_payments', 'check_payments')`)
  })

  it('a round with payments cannot be deleted', async () => {
    const c = await db.query<{ id: string }>(`insert into public.campaigns (name) values ('Pay-only round') returning id`)
    await db.query(`insert into public.payments (campaign_id, buyer_id, amount_paid) select $1, id, 5 from public.buyers where roll_no = 'PGP26-002'`, [c.rows[0].id])
    const msg = await fails(db.query(`delete from public.campaigns where id = $1`, [c.rows[0].id]))
    expect(msg).toMatch(/foreign key/)
    await db.query(`delete from public.payments where campaign_id = $1`, [c.rows[0].id])
    await db.query(`delete from public.campaigns where id = $1`, [c.rows[0].id])
  })

  it('switching a member off needs "Remove team members"', async () => {
    await as('main', `insert into public.members (email, display_name, role) values ('off.test@mdi.ac.in', 'Off', 'ops')`)
    const msg = await fails(as('admin', `update public.members set active = false where email = 'off.test@mdi.ac.in'`))
    expect(msg).toMatch(/can't switch team members off/)
    await as('main', `update public.members set active = false where email = 'off.test@mdi.ac.in'`)
    await as('main', `delete from public.members where email = 'off.test@mdi.ac.in'`)
  })

  it('only a super admin can create a round that starts locked', async () => {
    const msg = await fails(as('admin', `insert into public.campaigns (name, locked) values ('Sneaky locked', true)`))
    expect(msg).toMatch(/super admin/)
  })

  it('names in the log come from the Google identity, not editable profile data', async () => {
    await db.query(`insert into auth.identities (user_id, provider, identity_data) values ($1, 'google', '{"full_name":"Real Ops"}')`, [USERS.ops.sub])
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: USERS.ops.sub, email: USERS.ops.email, role: 'authenticated', app_metadata: { provider: 'google' },
                         user_metadata: { full_name: 'Oliver Joel' } }),
      ])
      await tx.exec('set local role authenticated')
      await tx.query(`select public.link_my_member()`)
    })
    const r = await db.query<{ display_name: string }>(`select display_name from public.members where email = 'ops@mdi.ac.in'`)
    expect(r.rows[0].display_name).toBe('Real Ops')
    await db.query(`update public.members set display_name = 'ops' where email = 'ops@mdi.ac.in'`)
    await db.query(`delete from auth.identities where user_id = $1`, [USERS.ops.sub])
  })
})

describe('locked sales rounds', () => {
  let lockedCampaign: string
  beforeAll(async () => {
    const c = await db.query<{ id: string }>(`insert into public.campaigns (name) values ('Old Round') returning id`)
    lockedCampaign = c.rows[0].id
    const p = await db.query<{ id: string }>(
      `insert into public.products (campaign_id, name, colour, price_inr) values ($1, 'Old Tee', 'Red', 1) returning id`,
      [lockedCampaign],
    )
    await db.query(
      `insert into public.order_items (campaign_id, buyer_id, product_id, size)
       select $1, b.id, $2, 'M' from public.buyers b where b.roll_no = 'PGP26-002'`,
      [lockedCampaign, p.rows[0].id],
    )
  })
  it('only a super admin can lock a round', async () => {
    expect(await fails(as('admin', `update public.campaigns set locked = true where id = $1`, [lockedCampaign]))).toMatch(/super admin/)
    await as('main', `update public.campaigns set locked = true where id = $1`, [lockedCampaign])
  })
  it('a locked round is hidden from everyone except super admins', async () => {
    const seen = async (who: 'admin' | 'ops' | 'main') => {
      const c = await as<{ n: number }>(who, `select count(*)::int as n from public.campaigns where id = $1`, [lockedCampaign])
      const i = await as<{ n: number }>(who, `select count(*)::int as n from public.order_items where campaign_id = $1`, [lockedCampaign])
      return [c.rows[0].n, i.rows[0].n]
    }
    expect(await seen('admin')).toEqual([0, 0])
    expect(await seen('ops')).toEqual([0, 0])
    expect(await seen('main')).toEqual([1, 1])
  })
  it('its activity-log entries are hidden too', async () => {
    const a = await as<{ n: number }>('admin', `select count(*)::int as n from public.audit_log where item_id in (select id from public.order_items where campaign_id = $1)`, [lockedCampaign])
    expect(a.rows[0].n).toBe(0)
  })
  it('a locked round is frozen, even for the super admin', async () => {
    const msg = await fails(as('main', `update public.order_items set size = 'L' where campaign_id = $1`, [lockedCampaign]))
    expect(msg).toMatch(/locked/)
    expect(await fails(as('main', `update public.campaigns set name = 'Renamed' where id = $1`, [lockedCampaign]))).toMatch(/locked/)
  })
  it('unlocking brings it back for everyone', async () => {
    await as('main', `update public.campaigns set locked = false where id = $1`, [lockedCampaign])
    const c = await as<{ n: number }>('ops', `select count(*)::int as n from public.campaigns where id = $1`, [lockedCampaign])
    expect(c.rows[0].n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Order form (docs/order-form-plan.md): students sign in, order through RPCs only,
// get nothing from MART tables and see only their own orders.
describe('order form', () => {
  const STUDENT_SHOT = `${USERS.student.sub}/pay-1.jpg`
  let pinkId: string
  let qrId: string
  const details = { name: 'Asha Rao', phone: '+91 98765 43210', roll_no: 'pgp26-500', batch: "PG'26", course: 'PGDM', section: 'B' }
  const item = (over: object = {}) => ({ product_id: productId, size: 'M', print_name: 'Asha', print_batch: "PG'26", ...over })
  const submit = (who: Who, items: unknown[], pay: object = {}, det: object = details) =>
    as<{ submit_order: { items: number; total_inr: number; order_id: string } }>(
      who,
      `select public.submit_order($1, $2::jsonb, $3::jsonb, $4::jsonb)`,
      [campaignId, JSON.stringify(det), JSON.stringify(items), JSON.stringify({ qr_id: qrId, txn_id: '412345678901', screenshot_path: STUDENT_SHOT, ...pay })],
    )

  // every MART table plus the form tables: a student must get nothing from any of them
  const TABLES = [
    'members', 'campaigns', 'products', 'buyers', 'imports', 'order_items', 'handovers', 'notes',
    'spare_stock', 'audit_log', 'roles', 'permissions', 'role_permissions', 'payments',
    'form_orders', 'form_admins', 'form_rounds', 'form_products', 'form_payment_qrs',
  ]

  beforeAll(async () => {
    const pink = await db.query<{ id: string }>(`select id from public.products where name = 'Classic MDI Baby Pink'`)
    pinkId = pink.rows[0].id
    // the super admin adds the form admin (a student account, not a MART member)
    await as('main', `insert into public.form_admins (email) values ('formadmin@mdi.ac.in')`)
  })

  describe('form admins', () => {
    it('only a MART super admin can add form admins, and at most 2', async () => {
      expect(await fails(as('admin', `insert into public.form_admins (email) values ('x@mdi.ac.in')`))).toMatch(/row-level security/)
      expect(await fails(as('formadmin', `insert into public.form_admins (email) values ('x@mdi.ac.in')`))).toMatch(/row-level security/)
      await as('main', `insert into public.form_admins (email) values ('second@mdi.ac.in')`)
      expect(await fails(as('main', `insert into public.form_admins (email) values ('third@mdi.ac.in')`))).toMatch(/at most 2/)
      await as('main', `delete from public.form_admins where email = 'second@mdi.ac.in'`)
    })
    it('a form admin opens the round, sets products and a live QR', async () => {
      await as('formadmin', `select public.form_admin_set_open($1, true)`, [campaignId])
      await as('formadmin', `select public.form_admin_save_product($1, $2::jsonb)`, [productId, JSON.stringify({ shown: true, allow_custom_size: true, description: 'Classic' })])
      await as('formadmin', `select public.form_admin_save_product($1, $2::jsonb)`, [pinkId, JSON.stringify({ shown: true })])
      const q = await as<{ id: string }>('formadmin', `insert into public.form_payment_qrs (payee_name, image_path) values ('Animesh', 'qr/animesh.png') returning id`)
      qrId = q.rows[0].id
      await as('formadmin', `select public.form_admin_set_active_qr($1)`, [qrId])
    })
    it('a form admin cannot change prices, sizes or names: those stay in MART Orders', async () => {
      const before = await db.query(`select id, name, colour, price_inr, sizes, updated_at from public.products order by id`)
      for (const patch of [{ price_inr: 1 }, { sizes: ['M'] }, { name: 'X' }, { shown: true, price_inr: 699 }]) {
        expect(await fails(as('formadmin', `select public.form_admin_save_product($1, $2::jsonb)`, [pinkId, JSON.stringify(patch)]))).toMatch(/changed in MART Orders/)
      }
      await as('formadmin', `update public.products set price_inr = 1, sizes = '{M}'`) // RLS: touches no rows
      const after = await db.query(`select id, name, colour, price_inr, sizes, updated_at from public.products order by id`)
      expect(after.rows).toEqual(before.rows)
      // nothing the form admin did shows up as a change to MART data
      const a = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where actor_email = 'formadmin@mdi.ac.in' and table_name not like 'form\_%'`)
      expect(a.rows[0].n).toBe(0)
    })
    it('students and MART admins cannot use form admin functions', async () => {
      for (const w of ['student', 'admin'] as const) {
        expect(await fails(as(w, `select public.form_admin_set_open($1, false)`, [campaignId]))).toMatch(/Only form admins/)
        expect(await fails(as(w, `select public.form_admin_state()`))).toMatch(/Only form admins/)
      }
      expect(await fails(as('student', `insert into public.form_payment_qrs (payee_name, image_path) values ('Me', 'x.png')`))).toMatch(/row-level security/)
    })
  })

  describe('a student orders', () => {
    it('reads the open round, shown products and live QR', async () => {
      const r = await as<{ get_order_form: { round: { item_cap: number }; products: { id: string }[]; qr: { id: string } } }>('student', `select public.get_order_form()`)
      const f = r.rows[0].get_order_form
      expect(f.round.item_cap).toBe(6)
      expect(f.products.map((p) => p.id).sort()).toEqual([productId, pinkId].sort())
      expect(f.qr.id).toBe(qrId)
    })
    it('uploads a screenshot only into their own folder', async () => {
      await as('student', `insert into storage.objects (bucket_id, name) values ('payment-screenshots', $1)`, [STUDENT_SHOT])
      expect(await fails(as('student', `insert into storage.objects (bucket_id, name) values ('payment-screenshots', $1)`, [`${USERS.student2.sub}/x.jpg`]))).toMatch(/row-level security/)
      expect(await fails(as('student', `insert into storage.objects (bucket_id, name) values ('form-assets', 'qr/fake.png')`))).toMatch(/row-level security/)
    })
    it('refuses bad orders', async () => {
      const seven = Array.from({ length: 7 }, () => item())
      expect(await fails(submit('student', seven))).toMatch(/At most 6 items/)
      expect(await fails(submit('student', []))).toMatch(/at least one item/)
      expect(await fails(submit('student', [item({ product_id: pinkId, size: 'XXXXL' })]))).toMatch(/pick a size/)
      expect(await fails(submit('student', [item({ size: 'M<script>' })]))).toMatch(/pick a size/) // custom sizes: plain text only
      expect(await fails(submit('student', [item({ product_id: pinkId, size: 'Chest 38' })]))).toMatch(/pick a size/) // no custom sizes for pink
      expect(await fails(submit('student', [item({ print_name: 'ASHA123' })]))).toMatch(/name on the back/)
      expect(await fails(submit('student', [item({ print_name: 'ABCDEFGHIJKLM' })]))).toMatch(/name on the back/) // 13 > 12
      expect(await fails(submit('student', [item({ print_batch: "PG'99" })]))).toMatch(/batch to print/)
      expect(await fails(submit('student', [item()], {}, { ...details, phone: '12345' }))).toMatch(/10-digit/)
      expect(await fails(submit('student', [item()], {}, { ...details, section: 'Z' }))).toMatch(/section/)
      expect(await fails(submit('student', [item()], { txn_id: '' }))).toMatch(/transaction ID/)
      expect(await fails(submit('student', [item()], { screenshot_path: `${USERS.student.sub}/missing.jpg` }))).toMatch(/screenshot/)
      expect(await fails(submit('student', [item()], { qr_id: '00000000-0000-0000-0000-0000000000ff' }))).toMatch(/QR/)
      // a roll number already belonging to someone else (imported with another email)
      expect(await fails(submit('student', [item()], {}, { ...details, roll_no: 'PGP26-001' }))).toMatch(/different email/)
      // nothing was saved by any of these
      const n = await db.query<{ n: number }>(`select count(*)::int as n from public.form_orders`)
      expect(n.rows[0].n).toBe(0)
    })
    it('refuses anyone not signed in with an @mdi.ac.in Google account', async () => {
      const pw = { sub: USERS.student.sub, email: USERS.student.email, role: 'authenticated', app_metadata: { provider: 'email' } }
      expect(await fails(asClaims(pw, `select public.get_order_form()`))).toMatch(/Sign in/)
      const gmail = { sub: '00000000-0000-0000-0000-0000000000aa', email: 'x@gmail.com', role: 'authenticated', app_metadata: { provider: 'google' } }
      expect(await fails(asClaims(gmail, `select public.get_order_form()`))).toMatch(/Sign in/)
    })
    it('saves buyer, one item per row and a payment in one go; the total comes from the database', async () => {
      const r = await submit('student', [item(), item({ product_id: pinkId, size: 'xxs', print_name: null })])
      expect(r.rows[0].submit_order).toMatchObject({ items: 2, total_inr: 699 + 699 })
      const items = await db.query<{ size: string; print_name: string | null; batch: string; source_slot: number }>(
        `select i.size, i.print_name, i.batch, i.source_slot from public.order_items i join public.buyers b on b.id = i.buyer_id
          where b.roll_no = 'PGP26-500' order by i.source_slot`)
      expect(items.rows).toEqual([
        { size: 'M', print_name: 'ASHA', batch: "PG'26", source_slot: 1 },
        { size: 'XXS', print_name: null, batch: "PG'26", source_slot: 2 },
      ])
      const b = await db.query<{ phone: string; user_id: string; email: string }>(`select phone, user_id, email from public.buyers where roll_no = 'PGP26-500'`)
      expect(b.rows[0]).toEqual({ phone: '9876543210', user_id: USERS.student.sub, email: 'student@mdi.ac.in' })
      const pay = await db.query<{ amount_paid: number; paid_to: string; status: string; txn_id: string }>(
        `select amount_paid, paid_to, status, txn_id from public.payments where screenshot_path = $1`, [STUDENT_SHOT])
      expect(pay.rows[0]).toEqual({ amount_paid: 1398, paid_to: 'Animesh', status: 'unchecked', txn_id: '412345678901' })
    })
    it('shows up in MART Orders straight away, with the student in the activity log', async () => {
      const r = await as<{ n: number }>('ops', `select count(*)::int as n from public.order_items where form_order_id is not null`)
      expect(r.rows[0].n).toBe(2)
      const a = await as<{ n: number }>('admin', `select count(*)::int as n from public.audit_log where table_name = 'order_items' and action = 'INSERT' and actor_email = 'student@mdi.ac.in'`)
      expect(a.rows[0].n).toBe(2)
    })
    it("the uploaded screenshot can't be swapped afterwards, even by a super admin", async () => {
      const msg = await fails(as('main', `update public.payments set screenshot_path = 'someone-else/x.jpg' where screenshot_path = $1`, [STUDENT_SHOT]))
      expect(msg).toMatch(/can't be changed/)
    })
    it('the same transaction ID cannot be used twice', async () => {
      expect(await fails(submit('student', [item()]))).toMatch(/already used/)
    })
    it('a closed round takes no orders', async () => {
      await as('formadmin', `select public.form_admin_set_open($1, false)`, [campaignId])
      expect(await fails(submit('student', [item()], { txn_id: 'NEWTXN123456' }))).toMatch(/closed/)
      await as('formadmin', `select public.form_admin_set_open($1, true)`, [campaignId])
    })
    it('a MART-team-only round is hidden from students and refuses their orders; team members can order', async () => {
      await as('formadmin', `update public.form_rounds set team_only = true where campaign_id = $1`, [campaignId])
      type F = { get_order_form: { round: { team_only: boolean } | null; products: unknown[]; team_only_round_open: boolean } }
      const s = (await as<F>('student', `select public.get_order_form()`)).rows[0].get_order_form
      expect(s).toMatchObject({ round: null, products: [], team_only_round_open: true })
      expect(await fails(submit('student', [item()], { txn_id: 'TEAMTXN00001' }))).toMatch(/MART team only/)

      const o = (await as<F>('ops', `select public.get_order_form()`)).rows[0].get_order_form
      expect(o.round?.team_only).toBe(true)
      expect(o.products).toHaveLength(2)
      const shot = `${USERS.ops.sub}/team.jpg`
      await as('ops', `insert into storage.objects (bucket_id, name) values ('payment-screenshots', $1)`, [shot])
      const r = await submit('ops', [item({ print_name: 'OPS' })], { txn_id: 'TEAMTXN00002', screenshot_path: shot },
        { ...details, name: 'Ops Member', roll_no: 'PGP26-777' })
      expect(r.rows[0].submit_order.items).toBe(1)

      await as('formadmin', `update public.form_rounds set team_only = false where campaign_id = $1`, [campaignId])
      const again = (await as<F>('student', `select public.get_order_form()`)).rows[0].get_order_form
      expect(again.round).not.toBeNull()
    })
  })

  describe('a student sees only their own orders', () => {
    it('my_orders lists the order with its items and statuses', async () => {
      const r = await as<{ my_orders: { total_inr: number; payment_status: string; items: { status: string; size: string }[] }[] }>('student', `select public.my_orders()`)
      expect(r.rows[0].my_orders).toHaveLength(1)
      const o = r.rows[0].my_orders[0]
      expect(o).toMatchObject({ total_inr: 1398, payment_status: 'unchecked' })
      expect(o.items.map((i) => [i.size, i.status])).toEqual([['M', 'ordered'], ['XXS', 'ordered']])
    })
    it('another student sees none of it, but does see their own older (imported) orders', async () => {
      const empty = await as<{ my_orders: unknown[] }>('student2', `select public.my_orders()`)
      expect(empty.rows[0].my_orders).toEqual([])
      // PGP26-002 was imported from the Google Form; its email is student2's
      await db.query(`update public.buyers set email = 'student2@mdi.ac.in' where roll_no = 'PGP26-002'`)
      const r = await as<{ my_orders: { items: { print_name: string | null }[] }[] }>('student2', `select public.my_orders()`)
      const names = r.rows[0].my_orders.flatMap((o) => o.items.map((i) => i.print_name))
      expect(names).toContain('TWO')
      expect(names).not.toContain('ASHA')
    })
    it('get_order_form prefills only the student’s own details', async () => {
      const a = await as<{ get_order_form: { me: { roll_no: string } | null } }>('student', `select public.get_order_form()`)
      expect(a.rows[0].get_order_form.me?.roll_no).toBe('PGP26-500')
      const b = await as<{ get_order_form: { me: { roll_no: string } | null } }>('student2', `select public.get_order_form()`)
      expect(b.rows[0].get_order_form.me?.roll_no).toBe('PGP26-002')
    })
    it('a student cannot read another student’s screenshot; "Check payments" can', async () => {
      const q = `select coalesce(array_agg(name order by name), '{}') as names from storage.objects where bucket_id = 'payment-screenshots'`
      const seen = async (w: Who) => (await as<{ names: string[] }>(w, q)).rows[0].names
      expect(await seen('student')).toEqual([STUDENT_SHOT])
      expect(await seen('student2')).toEqual([])
      expect(await seen('ops')).toEqual([`${USERS.ops.sub}/team.jpg`]) // only their own (from the team-only round)
      expect((await seen('main')).length).toBe(2) // super admin has "Check payments"
    })
  })

  describe('a signed-in student gets nothing from MART tables', () => {
    it('reads zero rows from every table', async () => {
      for (const t of TABLES) {
        const r = await as<{ n: number }>('student', `select count(*)::int as n from public.${t}`)
        expect(r.rows[0].n, t).toBe(0)
      }
    })
    it('a form admin who is not a MART member reads nothing from MART tables either', async () => {
      for (const t of TABLES.filter((x) => !x.startsWith('form_'))) {
        const r = await as<{ n: number }>('formadmin', `select count(*)::int as n from public.${t}`)
        expect(r.rows[0].n, t).toBe(0)
      }
    })
  })

  describe('a signed-in student cannot change anything in MART', () => {
    const snapshot = async () => {
      const out: Record<string, string> = {}
      for (const t of TABLES) {
        const r = await db.query<{ h: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`)
        out[t] = r.rows[0].h
      }
      return out
    }
    it('updates and deletes touch no rows; inserts are refused', async () => {
      const before = await snapshot()
      for (const t of TABLES) {
        if (t !== 'audit_log' && t !== 'permissions') {
          await as('student', `delete from public.${t}`).catch(() => undefined)
        }
      }
      await as('student', `update public.order_items set status = 'received'`)
      await as('student', `update public.members set role = 'main_admin'`)
      await as('student', `update public.payments set status = 'received'`)
      await as('student', `update public.buyers set name = 'X'`)
      await as('student', `update public.campaigns set locked = true`)
      expect(await snapshot()).toEqual(before)

      const inserts = [
        `insert into public.members (email, display_name, role) values ('student@mdi.ac.in', 'Me', 'main_admin')`,
        `insert into public.role_permissions (role_key, permission) values ('ops', 'remove_members')`,
        `insert into public.roles (key, name) values ('hacker', 'Hacker')`,
        `insert into public.campaigns (name) values ('Fake round')`,
        `insert into public.buyers (roll_no) values ('FAKE1')`,
        `insert into public.order_items (campaign_id, buyer_id, product_id, size) values ('${campaignId}', gen_random_uuid(), '${productId}', 'M')`,
        `insert into public.notes (buyer_id, body, created_by) values (gen_random_uuid(), 'x', auth.uid())`,
        `insert into public.payments (campaign_id, buyer_id) values ('${campaignId}', gen_random_uuid())`,
        `insert into public.form_rounds (campaign_id, is_open) values ('${campaignId}', true)`,
        `insert into public.audit_log (action, table_name) values ('INSERT', 'x')`,
      ]
      for (const s of inserts) {
        expect(await fails(as('student', s)), s).toMatch(/row-level security|permission denied/)
      }
      expect(await snapshot()).toEqual(before)
    })
    it('every MART function that changes data refuses a student', async () => {
      const calls = [
        `select public.set_items_status(array['${itemId}']::uuid[], 'received')`,
        `select public.record_handover(array['${itemId}']::uuid[], 'self')`,
        `select public.undo_handover('${itemId}', 'oops')`,
        `select public.import_orders('${campaignId}', 'x.csv', 1, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
        `select public.save_import_payments('${campaignId}', null, '[]'::jsonb)`,
      ]
      for (const c of calls) {
        expect(await fails(as('student', c)), c).toMatch(/Your role cannot|permission denied/)
      }
    })
    it('there is no way for a student to edit or cancel an order', async () => {
      const fns = await db.query<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname ~ '(cancel|edit|update|delete)_.*order'`)
      expect(fns.rows).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// ECC security review of the order form (migration 20261124120000_order_form_security.sql)
describe('order form security review fixes', () => {
  let qrId: string
  const shot = (who: Who, n: string) => `${USERS[who].sub}/${n}.jpg`
  const upload = (who: Who, n: string) =>
    as(who, `insert into storage.objects (bucket_id, name) values ('payment-screenshots', $1)`, [shot(who, n)])
  const order = (who: Who, roll: string, txn: string, screenshot: string) =>
    as<{ submit_order: { items: number } }>(
      who,
      `select public.submit_order($1, $2::jsonb, $3::jsonb, $4::jsonb)`,
      [
        campaignId,
        JSON.stringify({ name: 'Sec Test', phone: '9876543210', roll_no: roll, batch: "PG'26", course: 'PGDM', section: 'A' }),
        JSON.stringify([{ product_id: productId, size: 'M', print_name: null, print_batch: "PG'26" }]),
        JSON.stringify({ qr_id: qrId, txn_id: txn, screenshot_path: screenshot }),
      ],
    )

  beforeAll(async () => {
    const q = await db.query<{ id: string }>(`select id from public.form_payment_qrs where active`)
    qrId = q.rows[0].id
  })

  it('3a: only Google sign-ups are accepted, even for @mdi.ac.in emails', async () => {
    const msg = await fails(db.query(
      `insert into auth.users (email, raw_app_meta_data) values ('pw.student@mdi.ac.in', '{"provider":"email","providers":["email"]}')`))
    expect(msg).toMatch(/Sign in with Google/)
    const member = await fails(db.query(
      `insert into auth.users (email, raw_app_meta_data) values ('admin@mdi.ac.in', '{"provider":"email"}')`))
    expect(member).toMatch(/Sign in with Google/)
    await db.query(`insert into auth.users (email, raw_app_meta_data) values ('g.student@mdi.ac.in', '{"provider":"google"}')`)
  })

  it('3b: a roll number with no email on file is never claimed automatically', async () => {
    await db.query(`insert into public.buyers (roll_no, name) values ('PGP26-NOMAIL', 'No Mail')`)
    await upload('student2', 'b1')
    expect(await fails(order('student2', 'PGP26-NOMAIL', 'SECTXN000001', shot('student2', 'b1')))).toMatch(/ask MART to link it/)
    const b = await db.query<{ user_id: string | null }>(`select user_id from public.buyers where roll_no = 'PGP26-NOMAIL'`)
    expect(b.rows[0].user_id).toBeNull()
  })
  it('3b: a roll number whose email on file is the student\'s is claimed', async () => {
    await db.query(`insert into public.buyers (roll_no, name, email) values ('PGP26-MINE', 'Mine', 'student2@mdi.ac.in')`)
    // student2 has an imported record (PGP26-002) with the same email; one account = one roll number
    await db.query(`update public.buyers set email = null where roll_no = 'PGP26-002'`)
    const r = await order('student2', 'PGP26-MINE', 'SECTXN000002', shot('student2', 'b1'))
    expect(r.rows[0].submit_order.items).toBe(1)
    const b = await db.query<{ user_id: string }>(`select user_id from public.buyers where roll_no = 'PGP26-MINE'`)
    expect(b.rows[0].user_id).toBe(USERS.student2.sub)
    await db.query(`update public.buyers set email = 'student2@mdi.ac.in' where roll_no = 'PGP26-002'`)
  })

  it('3c: the same transaction ID is refused for another student, under a lock on the ID itself', async () => {
    await upload('student', 'c1')
    expect(await fails(order('student', 'PGP26-500', 'SECTXN000002', shot('student', 'c1')))).toMatch(/already used/)
    const def = await db.query<{ d: string }>(`select pg_get_functiondef('public.submit_order(uuid,jsonb,jsonb,jsonb)'::regprocedure) d`)
    expect(def.rows[0].d).toContain(`pg_advisory_xact_lock(hashtext('submit_order:txn:' || v_txn))`)
  })

  it('3d: at most 3 orders per student per round wait for a payment check', async () => {
    const waiting = async () => (await db.query<{ n: number }>(
      `select count(*)::int n from public.form_orders fo join public.payments p on p.id = fo.payment_id
        where fo.user_id = $1 and p.status = 'unchecked'`, [USERS.student.sub])).rows[0].n
    let i = 0
    while ((await waiting()) < 3) {
      await order('student', 'PGP26-500', `SECTXN10000${i++}`, shot('student', 'c1'))
    }
    expect(await fails(order('student', 'PGP26-500', 'SECTXN199999', shot('student', 'c1')))).toMatch(/3 orders waiting/)
    // once MART ticks one as received, the student can order again
    await as('main', `update public.payments set status = 'received' where id = (select payment_id from public.form_orders where user_id = $1 limit 1)`, [USERS.student.sub])
    const ok = await order('student', 'PGP26-500', 'SECTXN199999', shot('student', 'c1'))
    expect(ok.rows[0].submit_order.items).toBe(1)
  })
  it('3d: at most 10 screenshot uploads per student per 24 hours', async () => {
    let n = (await db.query<{ n: number }>(`select count(*)::int n from storage.objects where name like $1`, [`${USERS.student2.sub}/%`])).rows[0].n
    while (n < 10) await upload('student2', `d${n++}`)
    expect(await fails(upload('student2', 'd-over'))).toMatch(/row-level security/)
    // older uploads don't count
    await db.query(`update storage.objects set created_at = now() - interval '2 days' where name like $1`, [`${USERS.student2.sub}/%`])
    await upload('student2', 'd-next-day')
  })

  it('3e: form orders and form screenshots need the Payments page, not just "Check payments"', async () => {
    const orders = (w: Who) => as<{ n: number }>(w, `select count(*)::int n from public.form_orders`).then((r) => r.rows[0].n)
    const shotSeen = (w: Who) => as<{ n: number }>(w, `select count(*)::int n from storage.objects where name = $1`, [shot('student', 'c1')]).then((r) => r.rows[0].n)
    expect(await orders('ops')).toBe(0)
    expect(await orders('admin')).toBe(0)
    expect(await orders('main')).toBeGreaterThan(0)
    await as('main', `insert into public.role_permissions (role_key, permission) values ('admin', 'check_payments')`)
    expect(await shotSeen('admin')).toBe(0)
    await as('main', `insert into public.role_permissions (role_key, permission) values ('admin', 'page_payments')`)
    expect(await shotSeen('admin')).toBe(1)
    expect(await orders('admin')).toBeGreaterThan(0)
    // locked round: hidden again
    await as('main', `update public.campaigns set locked = true where id = $1`, [campaignId])
    expect(await shotSeen('admin')).toBe(0)
    expect(await orders('admin')).toBe(0)
    await as('main', `update public.campaigns set locked = false where id = $1`, [campaignId])
    await as('main', `delete from public.role_permissions where role_key = 'admin' and permission in ('check_payments', 'page_payments')`)
  })

  it('3f: QR, form-admin, round, product and form-order changes are logged with who did it', async () => {
    const q = await as<{ id: string }>('formadmin', `insert into public.form_payment_qrs (payee_name, upi_id, image_path) values ('Sneaky', 'me@okbank', 'qr/me.png') returning id`)
    await as('formadmin', `select public.form_admin_set_active_qr($1)`, [q.rows[0].id])
    await as('formadmin', `select public.form_admin_set_active_qr($1)`, [qrId])
    const log = await db.query<{ table_name: string; actor_email: string }>(
      `select distinct table_name, actor_email from public.audit_log where table_name like 'form\\_%' order by 1, 2`)
    const tables = new Set(log.rows.map((r) => r.table_name))
    for (const t of ['form_admins', 'form_rounds', 'form_products', 'form_payment_qrs', 'form_orders']) expect(tables, t).toContain(t)
    expect(log.rows).toContainEqual({ table_name: 'form_payment_qrs', actor_email: 'formadmin@mdi.ac.in' })
    // QR and form-order entries (UPI IDs, emails) only for the Payments page
    const seen = (w: Who) => as<{ n: number }>(w, `select count(*)::int n from public.audit_log where table_name in ('form_payment_qrs', 'form_orders')`).then((r) => r.rows[0].n)
    expect(await seen('ops')).toBe(0)
    expect(await seen('main')).toBeGreaterThan(0)
  })

  it('3g: a locked round\'s form settings are hidden from members and frozen for form admins', async () => {
    const vis = async (w: Who) => [
      (await as<{ n: number }>(w, `select count(*)::int n from public.form_rounds where campaign_id = $1`, [campaignId])).rows[0].n,
      (await as<{ n: number }>(w, `select count(*)::int n from public.form_products fp join public.products p on p.id = fp.product_id where p.campaign_id = $1`, [campaignId])).rows[0].n,
    ]
    expect((await vis('ops'))[0]).toBe(1)
    await as('main', `update public.campaigns set locked = true where id = $1`, [campaignId])
    expect(await vis('ops')).toEqual([0, 0])
    expect((await vis('main'))[0]).toBe(1)
    expect(await fails(as('formadmin', `select public.form_admin_save_product($1, '{"shown": false}'::jsonb)`, [productId]))).toMatch(/locked/)
    await as('formadmin', `update public.form_rounds set intro = 'changed' where campaign_id = $1`, [campaignId])
    const intro = await db.query<{ intro: string | null }>(`select intro from public.form_rounds where campaign_id = $1`, [campaignId])
    expect(intro.rows[0].intro).not.toBe('changed')
    await as('main', `update public.campaigns set locked = false where id = $1`, [campaignId])
  })
})
