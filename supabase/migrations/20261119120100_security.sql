-- MART Orders: who may do what, enforced in the database.
--
--   main_admin  everything, incl. managing team members and roles
--   admin       imports, edit orders/products, undo handovers, delete
--   ops         mark received, handovers, spare stock, notes, exports. Cannot delete.
--               May change only an item's status, never other columns.
--   it          manage ops/it logins, run imports, view activity log. Stock is read-only.
--
-- Anyone signed in who is not an active member gets nothing (my_role() is null).

-- ---------------------------------------------------------------------------
-- Role of the signed-in user, looked up by the email in their JWT.
create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.members m
  where m.active
    and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() = any (roles), false);
$$;

revoke all on function public.my_role() from public, anon;
revoke all on function public.has_role(public.app_role[]) from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.has_role(public.app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Refuse sign-up (first Google sign-in) for anyone not on the members list.
create or replace function public.enforce_member_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.members m
    where m.active and m.email = lower(btrim(coalesce(new.email, '')))
  ) then
    raise exception 'MART Orders: % is not on the MART team list', coalesce(new.email, '(no email)')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_member_signup
  before insert on auth.users
  for each row execute function public.enforce_member_signup();

-- ---------------------------------------------------------------------------
-- Table privileges: nothing for anon; authenticated is filtered by RLS below.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on
  public.members, public.campaigns, public.products, public.buyers, public.imports,
  public.order_items, public.handovers, public.notes, public.spare_stock
  to authenticated;
grant select on public.audit_log to authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;

alter table public.members      enable row level security;
alter table public.campaigns    enable row level security;
alter table public.products     enable row level security;
alter table public.buyers       enable row level security;
alter table public.imports      enable row level security;
alter table public.order_items  enable row level security;
alter table public.handovers    enable row level security;
alter table public.notes        enable row level security;
alter table public.spare_stock  enable row level security;
alter table public.audit_log    enable row level security;

-- ---------------------------------------------------------------------------
-- members
create policy members_select on public.members for select to authenticated
  using ((select public.my_role()) is not null);

-- main_admin may add anyone; it may add only ops/it.
create policy members_insert on public.members for insert to authenticated
  with check (
    (select public.has_role('main_admin'))
    or ((select public.has_role('it')) and role in ('ops', 'it'))
  );

create policy members_update on public.members for update to authenticated
  using (
    (select public.has_role('main_admin'))
    or ((select public.has_role('it')) and role in ('ops', 'it'))
  )
  with check (
    (select public.has_role('main_admin'))
    or ((select public.has_role('it')) and role in ('ops', 'it'))
  );

create policy members_delete on public.members for delete to authenticated
  using ((select public.has_role('main_admin')));

-- Never leave the tool without an active main admin.
create or replace function public.keep_one_main_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'main_admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'main_admin' or not new.active)
     and not exists (
       select 1 from public.members m
       where m.id <> old.id and m.role = 'main_admin' and m.active
     ) then
    raise exception 'There must always be at least one active main admin';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger members_keep_main_admin
  before update or delete on public.members
  for each row execute function public.keep_one_main_admin();

-- ---------------------------------------------------------------------------
-- campaigns, products: read by all members, changed by admins
create policy campaigns_select on public.campaigns for select to authenticated
  using ((select public.my_role()) is not null);
create policy campaigns_write on public.campaigns for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin')));
create policy campaigns_update on public.campaigns for update to authenticated
  using ((select public.has_role('main_admin', 'admin')))
  with check ((select public.has_role('main_admin', 'admin')));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

create policy products_select on public.products for select to authenticated
  using ((select public.my_role()) is not null);
create policy products_insert on public.products for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin')));
create policy products_update on public.products for update to authenticated
  using ((select public.has_role('main_admin', 'admin')))
  with check ((select public.has_role('main_admin', 'admin')));
create policy products_delete on public.products for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

-- ---------------------------------------------------------------------------
-- buyers, imports: imports are run by admins and IT
create policy buyers_select on public.buyers for select to authenticated
  using ((select public.my_role()) is not null);
create policy buyers_insert on public.buyers for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin', 'it')));
create policy buyers_update on public.buyers for update to authenticated
  using ((select public.has_role('main_admin', 'admin', 'it')))
  with check ((select public.has_role('main_admin', 'admin', 'it')));
create policy buyers_delete on public.buyers for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

create policy imports_select on public.imports for select to authenticated
  using ((select public.my_role()) is not null);
create policy imports_insert on public.imports for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin', 'it')));
create policy imports_delete on public.imports for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

-- ---------------------------------------------------------------------------
-- order_items
create policy items_select on public.order_items for select to authenticated
  using ((select public.my_role()) is not null);
create policy items_insert on public.order_items for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin', 'it')));
create policy items_update on public.order_items for update to authenticated
  using ((select public.has_role('main_admin', 'admin', 'ops')))
  with check ((select public.has_role('main_admin', 'admin', 'ops')));
create policy items_delete on public.order_items for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

-- Status rules, for everyone (also the SQL editor):
--  * Ops may change status only, never size/product/print name etc.
--  * "handed_over" is set only together with a live handover row (handover desk).
--  * Leaving "handed_over" needs the handover undone first (admins only, with a reason).
create or replace function public.guard_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.my_role();
  v_fixed text[] := array['status', 'status_changed_at', 'status_changed_by', 'updated_at'];
  v_live boolean;
begin
  if v_role = 'ops' and (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
    raise exception 'Ops can change an item''s status only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    select exists (
      select 1 from public.handovers h where h.item_id = new.id and h.undone_at is null
    ) into v_live;

    if new.status = 'handed_over' and not v_live then
      raise exception 'Use the handover desk to mark a shirt handed over' using errcode = '23514';
    end if;
    if old.status = 'handed_over' and v_live then
      raise exception 'Undo the handover (with a reason) before changing this shirt''s status'
        using errcode = '23514';
    end if;

    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger order_items_guard
  before update on public.order_items
  for each row execute function public.guard_order_item();

-- ---------------------------------------------------------------------------
-- handovers: recorded by ops/admins; undone only by admins; never deleted
create policy handovers_select on public.handovers for select to authenticated
  using ((select public.my_role()) is not null);
create policy handovers_insert on public.handovers for insert to authenticated
  with check (
    (select public.has_role('main_admin', 'admin', 'ops'))
    and handed_by = auth.uid()
    and undone_at is null
  );
create policy handovers_update on public.handovers for update to authenticated
  using ((select public.has_role('main_admin', 'admin')))
  with check ((select public.has_role('main_admin', 'admin')));
-- no delete policy: handovers are never deleted, only undone

-- A shirt can be handed over only once it is in MART.
create or replace function public.guard_handover_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.order_items i where i.id = new.item_id and i.status = 'received'
  ) then
    raise exception 'Only shirts that are in MART (received) can be handed over'
      using errcode = '23514';
  end if;
  new.handed_at := now();
  return new;
end;
$$;
create trigger handovers_guard_insert
  before insert on public.handovers
  for each row execute function public.guard_handover_insert();

create or replace function public.guard_handover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.undone_at is not null then
    raise exception 'This handover was already undone';
  end if;
  if (to_jsonb(new) - array['undone_at', 'undone_by', 'undo_reason'])
     is distinct from (to_jsonb(old) - array['undone_at', 'undone_by', 'undo_reason']) then
    raise exception 'A handover can only be undone, not edited';
  end if;
  if new.undone_at is null then
    raise exception 'Set undone_at and a reason to undo a handover';
  end if;
  new.undone_by := auth.uid();
  return new;
end;
$$;
create trigger handovers_guard
  before update on public.handovers
  for each row execute function public.guard_handover();

-- ---------------------------------------------------------------------------
-- notes: any member adds; author or admins edit; admins delete
create policy notes_select on public.notes for select to authenticated
  using ((select public.my_role()) is not null);
create policy notes_insert on public.notes for insert to authenticated
  with check ((select public.my_role()) is not null and created_by = auth.uid());
create policy notes_update on public.notes for update to authenticated
  -- ops may resolve flags raised by others (e.g. "cash collected")
  using ((select public.has_role('main_admin', 'admin', 'ops')))
  with check ((select public.has_role('main_admin', 'admin', 'ops')));
create policy notes_delete on public.notes for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

-- ---------------------------------------------------------------------------
-- spare stock: ops count it when the vendor box arrives
create policy spare_select on public.spare_stock for select to authenticated
  using ((select public.my_role()) is not null);
create policy spare_insert on public.spare_stock for insert to authenticated
  with check ((select public.has_role('main_admin', 'admin', 'ops')));
create policy spare_update on public.spare_stock for update to authenticated
  using ((select public.has_role('main_admin', 'admin', 'ops')))
  with check ((select public.has_role('main_admin', 'admin', 'ops')));
create policy spare_delete on public.spare_stock for delete to authenticated
  using ((select public.has_role('main_admin', 'admin')));

-- ---------------------------------------------------------------------------
-- audit_log: every member can read it; nobody writes it except the triggers
create policy audit_select on public.audit_log for select to authenticated
  using ((select public.my_role()) is not null);
