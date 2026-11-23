-- Fixes from the 2026-11-23 security review (ECC database-reviewer + security-reviewer).
--  1. Payments: only "Check payments" can create a payment that is already received/problem;
--     who-checked / when / who-created can't be faked; a payment can't be moved to another
--     student or round, and its screenshot link can't be swapped.
--  2. Sign-in: a member is only recognised when signed in with Google (not e.g. email+password
--     registered with someone else's address).
--  3. Names in the change log come from the Google identity, not from profile data users can edit.
--  4. Deleting a sales round no longer silently deletes its payments.
--  5. Locked rounds: log entries about their students, notes and spare stock are hidden too.
--  6. Small permission gaps: only "Remove team members" can switch a member off; only a super
--     admin can create a round that is already locked.

-- ---------------------------------------------------------------------------
-- 2. who is signed in: Google only
create or replace function public.signed_in_email()
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
      then nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '')
  end;
$$;

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.members m
   where m.active and m.email = public.signed_in_email()
   limit 1;
$$;

-- 3. names from the Google identity (user_metadata can be edited by the user)
create or replace function public.link_my_member()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.members m
     set user_id = auth.uid(),
         display_name = coalesce(g.name, m.display_name)
    from (select public.google_name((select i.identity_data from auth.identities i
                                      where i.user_id = auth.uid() and i.provider = 'google'
                                      limit 1)) as name) g
   where m.active
     and m.email = public.signed_in_email()
     and (m.user_id is distinct from auth.uid() or m.display_name is distinct from coalesce(g.name, m.display_name));
$$;

revoke all on function public.signed_in_email() from public, anon;
grant execute on function public.signed_in_email() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. payments
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert to authenticated
  with check (((select public.has_perm('check_payments'))
               or ((select public.has_perm('add_orders')) and status = 'unchecked'))
              and public.campaign_visible(campaign_id));

create or replace function public.payment_checked()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if new.status = 'unchecked' then
      new.checked_by := null;
      new.checked_at := null;
    else
      new.checked_by := auth.uid();
      new.checked_at := now();
    end if;
    return new;
  end if;
  -- UPDATE: these never change
  if (new.campaign_id, new.buyer_id, new.source_timestamp, new.screenshot_url, new.import_id)
     is distinct from (old.campaign_id, old.buyer_id, old.source_timestamp, old.screenshot_url, old.import_id) then
    raise exception 'A payment''s student, round, form response and screenshot can''t be changed' using errcode = '42501';
  end if;
  new.created_by := old.created_by;
  if new.status is distinct from old.status then
    if new.status = 'unchecked' then
      new.checked_by := null;
      new.checked_at := null;
    else
      new.checked_by := auth.uid();
      new.checked_at := now();
    end if;
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  return new;
end;
$$;

-- 4. a round with payments can't be deleted (they'd vanish with it)
alter table public.payments drop constraint if exists payments_campaign_id_fkey;
alter table public.payments
  add constraint payments_campaign_id_fkey foreign key (campaign_id) references public.campaigns (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 5. activity log: also hide students, notes and spare stock of locked rounds
drop policy if exists audit_select on public.audit_log;
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
        and (table_name <> 'buyers' or row_id is null or public.buyer_visible(row_id))
        and (nullif(coalesce(new_data, old_data) ->> 'buyer_id', '') is null
             or public.buyer_visible((coalesce(new_data, old_data) ->> 'buyer_id')::uuid))
        and (table_name <> 'spare_stock'
             or nullif(coalesce(new_data, old_data) ->> 'product_id', '') is null
             or public.campaign_visible((select p.campaign_id from public.products p
                                          where p.id = (coalesce(new_data, old_data) ->> 'product_id')::uuid)))
        and (actor_email is null or public.is_mdi_email(actor_email))
        and not (table_name = 'members'
                 and ((new_data is not null and not public.is_mdi_email(new_data ->> 'email'))
                      or (old_data is not null and not public.is_mdi_email(old_data ->> 'email'))))
        and (table_name <> 'payments' or (select public.has_perm('page_payments')))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 6a. switching a member off is removing them: needs "Remove team members"
create or replace function public.guard_member_deactivate()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.active and not new.active and auth.uid() is not null
     and not (public.is_super() or public.has_perm('remove_members')) then
    raise exception 'Your role can''t switch team members off' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_member_deactivate() from public, anon, authenticated;
create trigger members_guard_deactivate before update on public.members
  for each row execute function public.guard_member_deactivate();

-- 6b. only a super admin can create a round that starts locked
create or replace function public.guard_campaign_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.locked and auth.uid() is not null and not public.is_super() then
    raise exception 'Only a super admin can lock or unlock a sales round' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_campaign_insert() from public, anon, authenticated;
create trigger campaigns_guard_insert before insert on public.campaigns
  for each row execute function public.guard_campaign_insert();
