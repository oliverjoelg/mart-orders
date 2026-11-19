-- Payments: what each student says they paid (from the order form), and a manual check.
-- A separate verification step: it never changes stock, items or handovers.
--   * one row per form response (round + student + form timestamp); hand-added ones have no timestamp
--   * status: unchecked -> received / problem, ticked by people with "Check payments"
--   * "Payments" page permission to see them; logged, frozen in locked rounds like everything else

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  buyer_id          uuid not null references public.buyers (id) on delete restrict,
  source_timestamp  timestamptz,                 -- the form response it came from; null = added by hand
  paid_to           text,                        -- whose QR code, as the form says
  amount_paid       integer check (amount_paid is null or amount_paid >= 0),
  txn_id            text,
  screenshot_url    text check (screenshot_url is null or screenshot_url ~* '^https?://'),
  status            text not null default 'unchecked' check (status in ('unchecked', 'received', 'problem')),
  note              text,
  checked_by        uuid,
  checked_at        timestamptz,
  import_id         uuid references public.imports (id) on delete set null,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id, buyer_id, source_timestamp)
);
create index payments_campaign_idx on public.payments (campaign_id);
create index payments_buyer_idx on public.payments (buyer_id);
create index payments_txn_idx on public.payments (txn_id);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger payments_frozen before insert or update or delete on public.payments
  for each row execute function public.freeze_by_campaign();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- who ticked it and when
create or replace function public.payment_checked()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'unchecked' then
      new.checked_by := null;
      new.checked_at := null;
    else
      new.checked_by := auth.uid();
      new.checked_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.payment_checked() from public, anon, authenticated;
create trigger payments_checked before insert or update on public.payments
  for each row execute function public.payment_checked();

-- permissions (only the super admin has them until ticked for a role)
insert into public.permissions (key, label, hint, kind, sort_order) values
  ('check_payments', 'Check payments', 'Mark payments received or as a problem, fix typos, add a payment', 'action', 130),
  ('page_payments',  'Payments',       'See who paid what, and to whom', 'page', 280);

grant select, insert, update, delete on public.payments to authenticated;
alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using ((select public.has_perm('page_payments')) and public.campaign_visible(campaign_id));
-- adding orders also saves their payment details, even for roles that can't see payments
create policy payments_insert on public.payments for insert to authenticated
  with check (((select public.has_perm('check_payments')) or (select public.has_perm('add_orders')))
              and public.campaign_visible(campaign_id));
create policy payments_update on public.payments for update to authenticated
  using ((select public.has_perm('check_payments')) and public.campaign_visible(campaign_id))
  with check ((select public.has_perm('check_payments')) and public.campaign_visible(campaign_id));
create policy payments_delete on public.payments for delete to authenticated
  using ((select public.is_super()));

-- activity log: payment entries only for people who can see payments
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
        and (actor_email is null or public.is_mdi_email(actor_email))
        and not (table_name = 'members'
                 and ((new_data is not null and not public.is_mdi_email(new_data ->> 'email'))
                      or (old_data is not null and not public.is_mdi_email(old_data ->> 'email'))))
        and (table_name <> 'payments' or (select public.has_perm('page_payments')))
      )
    )
  );

-- Saves form payment details; skips responses already saved. Runs with owner rights so that a role
-- that may add orders (but not see payments) can still skip existing rows; checks permission itself.
create or replace function public.save_import_payments(p_campaign_id uuid, p_import_id uuid, p_payments jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not (public.has_perm('add_orders') or public.has_perm('check_payments')) then
    raise exception 'Your role cannot add payments' using errcode = '42501';
  end if;
  if not public.campaign_visible(p_campaign_id) then
    raise exception 'Unknown sales round' using errcode = '42501';
  end if;
  perform public.assert_round_unlocked(p_campaign_id);
  -- only for students who have items in this round
  insert into public.payments (campaign_id, buyer_id, source_timestamp, paid_to, amount_paid, txn_id, screenshot_url, import_id, created_by)
  select p_campaign_id, b.id, x.source_timestamp, nullif(btrim(x.paid_to), ''), x.amount_paid,
         nullif(btrim(x.txn_id), ''),
         case when btrim(coalesce(x.screenshot_url, '')) ~* '^https?://' then btrim(x.screenshot_url) end,
         p_import_id, auth.uid()
    from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(roll_no text, source_timestamp timestamptz, paid_to text,
                                             amount_paid integer, txn_id text, screenshot_url text)
    join public.buyers b on b.roll_no = upper(btrim(x.roll_no))
   where x.source_timestamp is not null
     and exists (select 1 from public.order_items i where i.buyer_id = b.id and i.campaign_id = p_campaign_id)
     -- same response saved before (times can differ by milliseconds between a CSV and an Excel copy)
     and not exists (select 1 from public.payments p
                      where p.campaign_id = p_campaign_id and p.buyer_id = b.id
                        and date_trunc('second', p.source_timestamp) = date_trunc('second', x.source_timestamp))
  on conflict (campaign_id, buyer_id, source_timestamp) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.save_import_payments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_import_payments(uuid, uuid, jsonb) to authenticated;

-- import: also save each response's payment details; already-saved responses are left alone,
-- so re-uploading an old file fills in payments for orders imported before this existed
drop function if exists public.import_orders(uuid, text, integer, integer, jsonb, jsonb);
create or replace function public.import_orders(
  p_campaign_id uuid, p_file_name text, p_responses integer, p_duplicates_skipped integer,
  p_buyers jsonb, p_items jsonb, p_payments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_import_id uuid;
  v_items integer;
  v_buyers integer;
  v_payments integer;
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

  v_payments := public.save_import_payments(p_campaign_id, v_import_id, p_payments);

  update public.imports set items_created = v_items where id = v_import_id;
  return jsonb_build_object('import_id', v_import_id, 'items_created', v_items, 'buyers_upserted', v_buyers,
                            'payments_added', v_payments);
end;
$$;
revoke all on function public.import_orders(uuid, text, integer, integer, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_orders(uuid, text, integer, integer, jsonb, jsonb, jsonb) to authenticated;
