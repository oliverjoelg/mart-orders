-- ROLLBACK for 20261123120100_order_form.sql. Run in the SQL Editor only if needed.
-- Removes the order-form tables, columns and functions and restores payment_checked() to the
-- 20261123110000_security_fixes.sql version (checked live on 2026-11-23 before applying).
-- WARNING: orders already placed through the form stay in MART Orders (items, payments, students),
-- but lose their link to the form (form_orders, buyers.user_id, payments.screenshot_path).
-- Run the storage rollback (20261123120200) first if that migration was applied.
-- The slot check goes back to 1-4 only if no item uses slot 5 or 6.
begin;

drop function if exists public.form_admin_set_active_qr(uuid);
drop function if exists public.form_admin_save_product(uuid, jsonb);
drop function if exists public.form_admin_set_open(uuid, boolean);
drop function if exists public.form_admin_state();
drop function if exists public.my_orders();
drop function if exists public.submit_order(uuid, jsonb, jsonb, jsonb);
drop function if exists public.get_order_form();

alter table public.order_items drop column if exists form_order_id;
drop table if exists public.form_orders;
drop table if exists public.form_payment_qrs;
drop table if exists public.form_products;
drop table if exists public.form_rounds;
drop table if exists public.form_admins;
drop function if exists public.form_qr_times();
drop function if exists public.form_admins_max_two();
drop function if exists public.is_form_admin();
drop function if exists public.student_email();

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
revoke all on function public.payment_checked() from public, anon, authenticated;

alter table public.payments drop column if exists screenshot_path;
alter table public.buyers drop column if exists user_id;

alter table public.order_items drop constraint if exists order_items_source_slot_check;
alter table public.order_items add constraint order_items_source_slot_check check (source_slot between 1 and 4);

commit;
