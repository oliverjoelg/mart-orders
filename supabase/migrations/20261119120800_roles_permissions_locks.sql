-- MART Orders: configurable roles & permissions, and lockable sales rounds (Oliver, 2026-11-19).
--
--  * Roles are data (public.roles). The super admin role (is_super) always has every permission
--    and can't be edited or deleted, so nobody can lock themselves out.
--  * public.permissions lists what can be ticked; public.role_permissions holds the ticks.
--    'action' permissions are enforced here in the database. 'page' permissions only decide
--    which pages the app shows (the data behind them stays readable by team members).
--  * A locked sales round is hidden from everyone except super admins, and frozen: nobody can
--    change anything in it (not even a super admin) until it is unlocked.
--
-- Every policy is rebuilt on has_perm(...) instead of fixed role names.

-- ---------------------------------------------------------------------------
-- 1. roles & permissions
create table public.roles (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null unique check (btrim(name) <> ''),
  is_super    boolean not null default false,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index roles_one_super_idx on public.roles (is_super) where is_super;
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

insert into public.roles (key, name, is_super, sort_order) values
  ('main_admin', 'Super admin', true, 0),
  ('admin', 'Admin', false, 1),
  ('ops', 'Ops', false, 2);

create table public.permissions (
  key         text primary key,
  label       text not null,
  hint        text,
  kind        text not null check (kind in ('action', 'page')),
  sort_order  integer not null default 100
);

insert into public.permissions (key, label, hint, kind, sort_order) values
  ('receive_stock',   'Receive stock / change status', 'Mark items as with the vendor, arrived in MART, or back to ordered', 'action', 10),
  ('hand_over',       'Hand over items',              'Use the handover desk', 'action', 20),
  ('undo_handover',   'Undo a handover',              'Needs a reason; the item goes back on the shelf', 'action', 30),
  ('add_orders',      'Add orders',                   'Upload the order file or add an order by hand', 'action', 40),
  ('edit_items',      'Edit item details',            'Change product, size, back name or batch of an item', 'action', 50),
  ('delete_items',    'Delete items',                 null, 'action', 60),
  ('manage_products', 'Manage sales rounds & products', 'Create rounds, add, edit and delete products', 'action', 70),
  ('spare_stock',     'Edit spare stock',             null, 'action', 80),
  ('add_notes',       'Add notes & flags',            null, 'action', 90),
  ('resolve_flags',   'Mark flags as sorted',         null, 'action', 100),
  ('manage_team',     'Add team members & set roles', 'Cannot touch super admins', 'action', 110),
  ('remove_members',  'Remove team members',          'Cannot remove super admins', 'action', 120),
  ('page_home',       'Home',                         null, 'page', 200),
  ('page_desk',       'Handover desk',                'Search students and see their items', 'page', 210),
  ('page_lists',      'Student lists',                'Call lists, emails, CSV', 'page', 220),
  ('page_items',      'Items',                        null, 'page', 230),
  ('page_inventory',  'Inventory',                    null, 'page', 240),
  ('page_print_list', 'Vendor print list',            null, 'page', 250),
  ('page_activity',   'Activity',                     null, 'page', 260),
  ('page_products',   'Products',                     null, 'page', 270);

create table public.role_permissions (
  role_key    text not null references public.roles (key) on update cascade on delete cascade,
  permission  text not null references public.permissions (key) on update cascade on delete cascade,
  primary key (role_key, permission)
);

-- defaults = what Admin and Ops could do before
insert into public.role_permissions (role_key, permission)
select 'admin', key from public.permissions where key <> 'remove_members'
union all
select 'ops', key from public.permissions
 where key in ('receive_stock', 'hand_over', 'spare_stock', 'add_notes', 'resolve_flags')
    or kind = 'page';

-- ---------------------------------------------------------------------------
-- 2. drop every old policy and the fixed-role helpers
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

drop function if exists public.has_role(public.app_role[]);
drop function if exists public.my_role();

alter table public.members alter column role drop default;
alter table public.members alter column role type text using role::text;
alter table public.members alter column role set default 'ops';
alter table public.members
  add constraint members_role_fkey foreign key (role) references public.roles (key) on update cascade on delete restrict;
alter table public.audit_log alter column actor_role type text using actor_role::text;

-- ---------------------------------------------------------------------------
-- 3. permission helpers
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.members m
   where m.active and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
   limit 1;
$$;

create or replace function public.is_super()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.roles r where r.is_super and r.key = public.my_role());
$$;

create or replace function public.has_perm(p text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super()
      or exists (select 1 from public.role_permissions rp where rp.role_key = public.my_role() and rp.permission = p);
$$;

create or replace function public.role_is_super(k text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select r.is_super from public.roles r where r.key = k), false);
$$;

-- the old enum type is no longer used anywhere
drop type public.app_role;

-- ---------------------------------------------------------------------------
-- 4. locked sales rounds
alter table public.campaigns add column locked boolean not null default false;

create or replace function public.campaign_locked(cid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select c.locked from public.campaigns c where c.id = cid), false);
$$;

create or replace function public.campaign_visible(cid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super() or not public.campaign_locked(cid);
$$;

create or replace function public.item_campaign(iid uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select i.campaign_id from public.order_items i where i.id = iid;
$$;

create or replace function public.buyer_visible(bid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_super()
      or not exists (select 1 from public.order_items i where i.buyer_id = bid)
      or exists (select 1 from public.order_items i join public.campaigns c on c.id = i.campaign_id
                  where i.buyer_id = bid and not c.locked);
$$;

-- frozen: nothing in a locked round may change
create or replace function public.assert_round_unlocked(cid uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if cid is not null and public.campaign_locked(cid) then
    raise exception 'This sales round is locked. A super admin must unlock it first.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.freeze_by_campaign()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.assert_round_unlocked(old.campaign_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.assert_round_unlocked(new.campaign_id); end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.freeze_by_item()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.item_id is not null then
    perform public.assert_round_unlocked(public.item_campaign(old.item_id));
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.item_id is not null then
    perform public.assert_round_unlocked(public.item_campaign(new.item_id));
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.freeze_by_product()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.assert_round_unlocked((select p.campaign_id from public.products p where p.id = old.product_id));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.assert_round_unlocked((select p.campaign_id from public.products p where p.id = new.product_id));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger order_items_frozen before insert or update or delete on public.order_items
  for each row execute function public.freeze_by_campaign();
create trigger products_frozen before insert or update or delete on public.products
  for each row execute function public.freeze_by_campaign();
create trigger imports_frozen before insert or update or delete on public.imports
  for each row execute function public.freeze_by_campaign();
create trigger handovers_frozen before insert or update or delete on public.handovers
  for each row execute function public.freeze_by_item();
create trigger notes_frozen before insert or update or delete on public.notes
  for each row execute function public.freeze_by_item();
create trigger spare_stock_frozen before insert or update or delete on public.spare_stock
  for each row execute function public.freeze_by_product();

-- campaigns: only a super admin locks/unlocks; a locked round can't be renamed or deleted
create or replace function public.guard_campaign()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked then raise exception 'This sales round is locked. A super admin must unlock it first.' using errcode = '42501'; end if;
    return old;
  end if;
  if new.locked is distinct from old.locked and auth.uid() is not null and not public.is_super() then
    raise exception 'Only a super admin can lock or unlock a sales round' using errcode = '42501';
  end if;
  if old.locked and new.locked and (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    raise exception 'This sales round is locked. A super admin must unlock it first.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger campaigns_guard before update or delete on public.campaigns
  for each row execute function public.guard_campaign();

-- ---------------------------------------------------------------------------
-- 5. rewritten guards and RPCs (same behaviour, permission-based)
create or replace function public.guard_order_item()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_fixed text[] := array['status', 'status_changed_at', 'status_changed_by', 'updated_at'];
  v_live boolean;
  v_user boolean := auth.uid() is not null;  -- false in the SQL editor (owner)
begin
  if v_user and not public.has_perm('edit_items')
     and (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
    raise exception 'Your role can change an item''s status only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    select exists (select 1 from public.handovers h where h.item_id = new.id and h.undone_at is null) into v_live;
    if new.status = 'handed_over' and not v_live then
      raise exception 'Use the handover desk to mark an item handed over' using errcode = '23514';
    end if;
    if old.status = 'handed_over' and v_live then
      raise exception 'Undo the handover (with a reason) before changing this item''s status' using errcode = '23514';
    end if;
    if v_user and new.status <> 'handed_over' and old.status <> 'handed_over'
       and not (public.has_perm('receive_stock') or public.has_perm('edit_items')) then
      raise exception 'Your role cannot change stock status' using errcode = '42501';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.keep_one_main_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.role_is_super(old.role) and old.active
     and (tg_op = 'DELETE' or not public.role_is_super(new.role) or not new.active)
     and not exists (
       select 1 from public.members m
        where m.id <> old.id and m.active and public.role_is_super(m.role)
     ) then
    raise exception 'There must always be at least one active super admin';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.guard_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_super then raise exception 'The super admin role cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.is_super then raise exception 'There is only one super admin role'; end if;
  if tg_op = 'UPDATE' and (new.is_super is distinct from old.is_super or (old.is_super and new.key <> old.key)) then
    raise exception 'The super admin role cannot be changed';
  end if;
  return new;
end;
$$;
create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function public.guard_role();

create or replace function public.set_items_status(p_item_ids uuid[], p_status public.item_status)
returns integer
language plpgsql set search_path = ''
as $$
declare v_count integer;
begin
  if not (public.has_perm('receive_stock') or public.has_perm('edit_items')) then
    raise exception 'Your role cannot change stock status' using errcode = '42501';
  end if;
  if p_status = 'handed_over' then
    raise exception 'Use the handover desk to mark items handed over' using errcode = '23514';
  end if;
  update public.order_items set status = p_status where id = any (p_item_ids) and status <> p_status;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_handover(
  p_item_ids uuid[], p_type public.handover_type, p_collector_name text default null, p_collector_roll text default null)
returns integer
language plpgsql set search_path = ''
as $$
declare v_count integer;
begin
  if not public.has_perm('hand_over') then
    raise exception 'Your role cannot record handovers' using errcode = '42501';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then raise exception 'Pick at least one item'; end if;
  insert into public.handovers (item_id, type, collector_name, collector_roll)
  select i, p_type,
         case when p_type = 'collected_by_other' then btrim(p_collector_name) end,
         case when p_type = 'collected_by_other' then upper(btrim(p_collector_roll)) end
    from unnest(p_item_ids) as i;
  update public.order_items set status = 'handed_over' where id = any (p_item_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.undo_handover(p_item_id uuid, p_reason text)
returns void
language plpgsql set search_path = ''
as $$
begin
  if not public.has_perm('undo_handover') then
    raise exception 'Your role cannot undo handovers' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for the undo'; end if;
  update public.handovers set undone_at = now(), undo_reason = btrim(p_reason)
   where item_id = p_item_id and undone_at is null;
  if not found then raise exception 'This item has no handover to undo'; end if;
  update public.order_items set status = 'received' where id = p_item_id;
end;
$$;

create or replace function public.import_orders(
  p_campaign_id uuid, p_file_name text, p_responses integer, p_duplicates_skipped integer, p_buyers jsonb, p_items jsonb)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_import_id uuid;
  v_items integer;
  v_buyers integer;
  v_missing text;
begin
  if not public.has_perm('add_orders') then
    raise exception 'Your role cannot add orders' using errcode = '42501';
  end if;

  insert into public.buyers (roll_no, name, email, phone, batch, course, section)
  select upper(btrim(b.roll_no)), coalesce(b.name, ''), nullif(btrim(b.email), ''),
         nullif(btrim(b.phone), ''), nullif(btrim(b.batch), ''), nullif(btrim(b.course), ''),
         nullif(btrim(b.section), '')
    from jsonb_to_recordset(p_buyers) as b(roll_no text, name text, email text, phone text, batch text, course text, section text)
  on conflict (roll_no) do update set
    name    = coalesce(nullif(excluded.name, ''), public.buyers.name),
    email   = coalesce(excluded.email, public.buyers.email),
    phone   = coalesce(excluded.phone, public.buyers.phone),
    batch   = coalesce(excluded.batch, public.buyers.batch),
    course  = coalesce(excluded.course, public.buyers.course),
    section = coalesce(excluded.section, public.buyers.section);
  get diagnostics v_buyers = row_count;

  select string_agg(distinct x.roll_no, ', ') into v_missing
    from jsonb_to_recordset(p_items) as x(roll_no text)
   where not exists (select 1 from public.buyers b where b.roll_no = upper(btrim(x.roll_no)));
  if v_missing is not null then raise exception 'Items without a buyer row: %', v_missing; end if;

  insert into public.imports (campaign_id, file_name, responses, duplicates_skipped)
  values (p_campaign_id, p_file_name, p_responses, p_duplicates_skipped)
  returning id into v_import_id;

  insert into public.order_items
    (campaign_id, buyer_id, product_id, size, print_name, batch, source_timestamp, source_slot, import_id)
  select p_campaign_id, b.id, x.product_id, x.size, nullif(btrim(x.print_name), ''),
         nullif(btrim(x.batch), ''), x.source_timestamp, x.source_slot, v_import_id
    from jsonb_to_recordset(p_items) as x(roll_no text, product_id uuid, size text, print_name text, batch text,
                                          source_timestamp timestamptz, source_slot smallint)
    join public.buyers b on b.roll_no = upper(btrim(x.roll_no));
  get diagnostics v_items = row_count;

  update public.imports set items_created = v_items where id = v_import_id;
  return jsonb_build_object('import_id', v_import_id, 'items_created', v_items, 'buyers_upserted', v_buyers);
end;
$$;

-- audit: role is plain text now
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb; v_new jsonb; v_changed text[];
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_name text; v_role text; v_row_id uuid; v_item_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key
       and n.key not in ('updated_at', 'status_changed_at', 'status_changed_by');
    if v_changed is null then return new; end if;
  end if;
  if v_email is not null then
    select coalesce(m.nickname, m.display_name), m.role into v_name, v_role from public.members m where m.email = v_email;
  end if;
  v_row_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  v_item_id := case
    when tg_table_name = 'order_items' then v_row_id
    else nullif(coalesce(v_new ->> 'item_id', v_old ->> 'item_id'), '')::uuid
  end;
  insert into public.audit_log (actor_id, actor_email, actor_name, actor_role, action, table_name, row_id, item_id, old_data, new_data, changed)
  values (auth.uid(), v_email, coalesce(v_name, v_email, 'system'), v_role, tg_op, tg_table_name, v_row_id, v_item_id, v_old, v_new, v_changed);
  return coalesce(new, old);
end;
$$;

-- roles have a text key, not a uuid id; log them by key in new_data only
create or replace function public.audit_row_no_id()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_email text := lower(nullif(auth.jwt() ->> 'email', '')); v_name text; v_role text;
begin
  if v_email is not null then
    select coalesce(m.nickname, m.display_name), m.role into v_name, v_role from public.members m where m.email = v_email;
  end if;
  insert into public.audit_log (actor_id, actor_email, actor_name, actor_role, action, table_name, old_data, new_data)
  values (auth.uid(), v_email, coalesce(v_name, v_email, 'system'), v_role, tg_op, tg_table_name,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function public.audit_row_no_id();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_no_id();

revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.audit_row_no_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. privileges and policies
grant select, insert, update, delete on public.roles, public.role_permissions to authenticated;
grant select on public.permissions to authenticated;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- members see the role list; only the super admin changes roles and ticks
create policy roles_select on public.roles for select to authenticated using ((select public.my_role()) is not null);
create policy roles_write on public.roles for all to authenticated
  using ((select public.is_super())) with check ((select public.is_super()));
create policy permissions_select on public.permissions for select to authenticated using ((select public.my_role()) is not null);
create policy role_perms_select on public.role_permissions for select to authenticated using ((select public.my_role()) is not null);
create policy role_perms_write on public.role_permissions for all to authenticated
  using ((select public.is_super())) with check ((select public.is_super()) and not public.role_is_super(role_key));

-- team
create policy members_select on public.members for select to authenticated using ((select public.my_role()) is not null);
create policy members_insert on public.members for insert to authenticated
  with check ((select public.is_super()) or ((select public.has_perm('manage_team')) and not public.role_is_super(role)));
create policy members_update on public.members for update to authenticated
  using ((select public.is_super()) or ((select public.has_perm('manage_team')) and not public.role_is_super(role)))
  with check ((select public.is_super()) or ((select public.has_perm('manage_team')) and not public.role_is_super(role)));
create policy members_delete on public.members for delete to authenticated
  using ((select public.is_super()) or ((select public.has_perm('remove_members')) and not public.role_is_super(role)));

-- rounds & products (locked rounds: super admins only)
create policy campaigns_select on public.campaigns for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(id));
create policy campaigns_insert on public.campaigns for insert to authenticated with check ((select public.has_perm('manage_products')));
create policy campaigns_update on public.campaigns for update to authenticated
  using ((select public.has_perm('manage_products')) and public.campaign_visible(id))
  with check ((select public.has_perm('manage_products')));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using ((select public.has_perm('manage_products')) and public.campaign_visible(id));

create policy products_select on public.products for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(campaign_id));
create policy products_insert on public.products for insert to authenticated with check ((select public.has_perm('manage_products')));
create policy products_update on public.products for update to authenticated
  using ((select public.has_perm('manage_products'))) with check ((select public.has_perm('manage_products')));
create policy products_delete on public.products for delete to authenticated using ((select public.has_perm('manage_products')));

-- students & imports
create policy buyers_select on public.buyers for select to authenticated
  using ((select public.my_role()) is not null and public.buyer_visible(id));
create policy buyers_insert on public.buyers for insert to authenticated with check ((select public.has_perm('add_orders')));
create policy buyers_update on public.buyers for update to authenticated
  using ((select public.has_perm('add_orders')) or (select public.has_perm('edit_items')))
  with check ((select public.has_perm('add_orders')) or (select public.has_perm('edit_items')));
create policy buyers_delete on public.buyers for delete to authenticated using ((select public.has_perm('delete_items')));

create policy imports_select on public.imports for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(campaign_id));
create policy imports_insert on public.imports for insert to authenticated with check ((select public.has_perm('add_orders')));
create policy imports_update on public.imports for update to authenticated
  using ((select public.has_perm('add_orders'))) with check ((select public.has_perm('add_orders')));
create policy imports_delete on public.imports for delete to authenticated using ((select public.has_perm('delete_items')));

-- items
create policy items_select on public.order_items for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(campaign_id));
create policy items_insert on public.order_items for insert to authenticated with check ((select public.has_perm('add_orders')));
create policy items_update on public.order_items for update to authenticated
  using ((select public.has_perm('receive_stock')) or (select public.has_perm('edit_items'))
      or (select public.has_perm('hand_over')) or (select public.has_perm('undo_handover')))
  with check ((select public.has_perm('receive_stock')) or (select public.has_perm('edit_items'))
      or (select public.has_perm('hand_over')) or (select public.has_perm('undo_handover')));
create policy items_delete on public.order_items for delete to authenticated using ((select public.has_perm('delete_items')));

-- handovers (never deleted)
create policy handovers_select on public.handovers for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(public.item_campaign(item_id)));
create policy handovers_insert on public.handovers for insert to authenticated
  with check ((select public.has_perm('hand_over')) and handed_by = auth.uid() and undone_at is null);
create policy handovers_update on public.handovers for update to authenticated
  using ((select public.has_perm('undo_handover'))) with check ((select public.has_perm('undo_handover')));

-- notes
create policy notes_select on public.notes for select to authenticated
  using ((select public.my_role()) is not null
         and (item_id is null or public.campaign_visible(public.item_campaign(item_id)))
         and (buyer_id is null or public.buyer_visible(buyer_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check ((select public.has_perm('add_notes')) and created_by = auth.uid());
create policy notes_update on public.notes for update to authenticated
  using ((select public.has_perm('resolve_flags'))) with check ((select public.has_perm('resolve_flags')));
create policy notes_delete on public.notes for delete to authenticated using ((select public.has_perm('delete_items')));

-- spare stock
create policy spare_select on public.spare_stock for select to authenticated
  using ((select public.my_role()) is not null
         and public.campaign_visible((select p.campaign_id from public.products p where p.id = product_id)));
create policy spare_insert on public.spare_stock for insert to authenticated with check ((select public.has_perm('spare_stock')));
create policy spare_update on public.spare_stock for update to authenticated
  using ((select public.has_perm('spare_stock'))) with check ((select public.has_perm('spare_stock')));
create policy spare_delete on public.spare_stock for delete to authenticated using ((select public.has_perm('spare_stock')));

-- activity log: hide entries that belong to a locked round from everyone but super admins
create policy audit_select on public.audit_log for select to authenticated
  using (
    (select public.my_role()) is not null
    and (
      (select public.is_super())
      or (
        (item_id is null or public.campaign_visible(public.item_campaign(item_id)))
        and (nullif(coalesce(new_data, old_data) ->> 'campaign_id', '') is null
             or public.campaign_visible((coalesce(new_data, old_data) ->> 'campaign_id')::uuid))
        and (table_name <> 'campaigns' or row_id is null or public.campaign_visible(row_id))
      )
    )
  );

-- helpers callable by the app
revoke all on function public.my_role(), public.is_super(), public.has_perm(text), public.role_is_super(text),
  public.campaign_locked(uuid), public.campaign_visible(uuid), public.item_campaign(uuid), public.buyer_visible(uuid),
  public.assert_round_unlocked(uuid) from public, anon;
grant execute on function public.my_role(), public.is_super(), public.has_perm(text), public.role_is_super(text),
  public.campaign_locked(uuid), public.campaign_visible(uuid), public.item_campaign(uuid), public.buyer_visible(uuid),
  public.assert_round_unlocked(uuid) to authenticated;
