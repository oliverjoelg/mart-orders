-- Order form (Oliver, 2026-11-23): the student-facing site (repo mart-order-form) writes orders
-- straight into MART Orders. Plan: docs/order-form-plan.md. Decisions:
--   * Students cannot edit or cancel an order (no RPC for it; they have no rights on MART tables).
--   * Form admins: a separate list of at most 2 people (form_admins), not MART roles.
--   * At most 6 items per order.
--
-- Students never get rights on MART tables. Everything they do goes through three
-- SECURITY DEFINER functions that check who they are and validate every value:
--   get_order_form()  what the form shows (open round, products, prices, sizes, live QR)
--   submit_order()    saves buyer + one order_items row per item + a payments row, atomically
--   my_orders()       their own orders and statuses
-- Form admins use RLS on the form_* tables plus form_admin_* functions. They change only what the
-- form shows (open/close, photos, descriptions, QRs), never MART data such as prices or sizes.

-- ---------------------------------------------------------------------------
-- 1. who is calling
-- public.signed_in_email() (20261123110000_security_fixes.sql) is the email of a Google sign-in
-- only, so an email/password sign-up can never pose as a student or a form admin.

-- a student = anyone signed in with an @mdi.ac.in Google account (team members included)
create or replace function public.student_email()
returns text
language sql stable security definer set search_path = ''
as $$
  select e from (select public.signed_in_email() as e) x
   where auth.uid() is not null and public.is_mdi_email(e);
$$;

-- ---------------------------------------------------------------------------
-- 2. form admins (1-2 people; added by a MART super admin)
create table public.form_admins (
  email       text primary key check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  added_by    uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create or replace function public.form_admins_max_two()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.form_admins) > 2 then
    raise exception 'The order form has at most 2 form admins. Remove one first.';
  end if;
  return null;
end;
$$;
create trigger form_admins_max_two after insert on public.form_admins
  for each statement execute function public.form_admins_max_two();

create or replace function public.is_form_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.form_admins f where f.email = public.signed_in_email());
$$;

grant select, insert, delete on public.form_admins to authenticated;
alter table public.form_admins enable row level security;
create policy form_admins_select on public.form_admins for select to authenticated
  using ((select public.is_super()) or (select public.is_form_admin()));
create policy form_admins_insert on public.form_admins for insert to authenticated
  with check ((select public.is_super()));
create policy form_admins_delete on public.form_admins for delete to authenticated
  using ((select public.is_super()));

-- ---------------------------------------------------------------------------
-- 3. what the form shows
-- One row per sales round that has a form. At most one round is open at a time.
create table public.form_rounds (
  campaign_id     uuid primary key references public.campaigns (id) on delete cascade,
  is_open         boolean not null default false,
  title           text,                          -- shown at the top; defaults to the round name
  intro           text,                          -- short note under the title
  item_cap        integer not null default 6 check (item_cap between 1 and 6),
  student_batches text[] not null default array['PG''24', 'PG''25', 'PG''26'],
  courses         text[] not null default array['PGDM', 'PGDM-HRM', 'PGDM-IB', 'PGDM-BFS', 'PGDM-BN'],
  sections        text[] not null default array['A', 'B', 'C', 'D', 'E', 'F', 'NA'],
  print_batches   text[] not null default array['PG''24', 'PG''25', 'PG''26'],
  name_max        integer not null default 12 check (name_max between 1 and 30),
  -- MART team only (e.g. a members' price round): only active MART members see and order in it
  team_only       boolean not null default false,
  updated_at      timestamptz not null default now()
);
create unique index form_rounds_one_open_idx on public.form_rounds (is_open) where is_open;
create trigger form_rounds_updated_at before update on public.form_rounds
  for each row execute function public.set_updated_at();

-- Display info per product (name, colour, price and sizes stay in public.products).
create table public.form_products (
  product_id         uuid primary key references public.products (id) on delete cascade,
  shown              boolean not null default true,
  description        text,
  photo_paths        text[] not null default '{}',   -- objects in the form-assets bucket
  allow_custom_size  boolean not null default false,
  updated_at         timestamptz not null default now()
);
create trigger form_products_updated_at before update on public.form_products
  for each row execute function public.set_updated_at();

-- Payment QR codes. Rotated when a member's UPI limit is hit; exactly one is live.
create table public.form_payment_qrs (
  id              uuid primary key default gen_random_uuid(),
  payee_name      text not null check (btrim(payee_name) <> ''),   -- saved as payments.paid_to
  upi_id          text,
  image_path      text not null check (btrim(image_path) <> ''),   -- object in form-assets
  active          boolean not null default false,
  activated_at    timestamptz,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now()
);
create unique index form_qrs_one_active_idx on public.form_payment_qrs (active) where active;

create or replace function public.form_qr_times()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then new.activated_at := now(); end if;
  if not new.active and tg_op = 'UPDATE' and old.active then new.deactivated_at := now(); end if;
  return new;
end;
$$;
create trigger form_qrs_times before insert or update on public.form_payment_qrs
  for each row execute function public.form_qr_times();

grant select, insert, update, delete on public.form_rounds, public.form_products, public.form_payment_qrs to authenticated;
alter table public.form_rounds enable row level security;
alter table public.form_products enable row level security;
alter table public.form_payment_qrs enable row level security;
-- form admins manage these; MART team members may look. Students read them only via get_order_form().
create policy form_rounds_select on public.form_rounds for select to authenticated
  using ((select public.is_form_admin()) or (select public.my_role()) is not null);
create policy form_rounds_write on public.form_rounds for all to authenticated
  using ((select public.is_form_admin())) with check ((select public.is_form_admin()));
create policy form_products_select on public.form_products for select to authenticated
  using ((select public.is_form_admin()) or (select public.my_role()) is not null);
create policy form_products_write on public.form_products for all to authenticated
  using ((select public.is_form_admin())) with check ((select public.is_form_admin()));
create policy form_qrs_select on public.form_payment_qrs for select to authenticated
  using ((select public.is_form_admin()) or (select public.has_perm('page_payments')));
create policy form_qrs_write on public.form_payment_qrs for all to authenticated
  using ((select public.is_form_admin())) with check ((select public.is_form_admin()));

-- ---------------------------------------------------------------------------
-- 4. orders from the form
-- order_items had room for the Google Form's 4 shirt slots; the form allows 6.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.order_items'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%source_slot%'
  loop
    execute format('alter table public.order_items drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.order_items add constraint order_items_source_slot_check check (source_slot between 1 and 6);

-- the student's account, so "My orders" finds their buyer row
alter table public.buyers add column user_id uuid unique;
-- screenshots uploaded on the form live in Storage (bucket payment-screenshots), not at a URL
alter table public.payments add column screenshot_path text;

-- same as 20261123110000_security_fixes.sql, plus: the uploaded screenshot (screenshot_path) can't
-- be swapped after the payment is saved, just like screenshot_url
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
  if (new.campaign_id, new.buyer_id, new.source_timestamp, new.screenshot_url, new.screenshot_path, new.import_id)
     is distinct from (old.campaign_id, old.buyer_id, old.source_timestamp, old.screenshot_url, old.screenshot_path, old.import_id) then
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

create table public.form_orders (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  buyer_id      uuid not null references public.buyers (id) on delete restrict,
  user_id       uuid not null,
  email         text not null,
  submitted_at  timestamptz not null,
  item_count    integer not null check (item_count between 1 and 6),
  total_inr     integer not null check (total_inr >= 0),
  qr_id         uuid references public.form_payment_qrs (id) on delete set null,
  payment_id    uuid references public.payments (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index form_orders_user_idx on public.form_orders (user_id);
create index form_orders_campaign_idx on public.form_orders (campaign_id);
alter table public.order_items add column form_order_id uuid references public.form_orders (id) on delete set null;
create index order_items_form_order_idx on public.order_items (form_order_id) where form_order_id is not null;

grant select on public.form_orders to authenticated;
alter table public.form_orders enable row level security;
-- MART team members see them like items; students only through my_orders()
create policy form_orders_select on public.form_orders for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(campaign_id));

-- ---------------------------------------------------------------------------
-- 5. get_order_form(): everything the form needs, in one call
create or replace function public.get_order_form()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_email text := public.student_email();
  v_round public.form_rounds;
  v_team_only_hidden boolean := false;
begin
  if v_email is null then
    raise exception 'Sign in with your @mdi.ac.in Google account' using errcode = '42501';
  end if;

  select r.* into v_round
    from public.form_rounds r join public.campaigns c on c.id = r.campaign_id
   where r.is_open and not c.locked;
  -- a MART-team-only round is invisible to everyone who is not an active MART member
  if v_round.team_only and public.my_role() is null then
    v_round := null;
    v_team_only_hidden := true;
  end if;

  -- prefill: the student's last details
  return jsonb_build_object(
    'round', case when v_round.campaign_id is null then null else (
      select jsonb_build_object(
        'campaign_id', c.id, 'title', coalesce(v_round.title, c.name), 'intro', v_round.intro,
        'item_cap', v_round.item_cap, 'student_batches', v_round.student_batches,
        'courses', v_round.courses, 'sections', v_round.sections,
        'print_batches', v_round.print_batches, 'name_max', v_round.name_max,
        'team_only', v_round.team_only)
        from public.campaigns c where c.id = v_round.campaign_id) end,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'colour', p.colour, 'price_inr', p.price_inr,
               'sizes', p.sizes, 'description', fp.description, 'photo_paths', fp.photo_paths,
               'allow_custom_size', fp.allow_custom_size)
             order by p.sort_order, p.name)
        from public.products p join public.form_products fp on fp.product_id = p.id
       where p.campaign_id = v_round.campaign_id and fp.shown), '[]'::jsonb),
    'qr', (select jsonb_build_object('id', q.id, 'payee_name', q.payee_name, 'upi_id', q.upi_id,
                                     'image_path', q.image_path)
             from public.form_payment_qrs q where q.active),
    'me', (select jsonb_build_object('name', b.name, 'phone', b.phone, 'roll_no', b.roll_no,
                                     'batch', b.batch, 'course', b.course, 'section', b.section)
             from public.buyers b
            where b.user_id = auth.uid() or (b.user_id is null and lower(b.email) = v_email)
            order by (b.user_id = auth.uid()) desc nulls last, b.updated_at desc
            limit 1),
    'email', v_email,
    'team_only_round_open', v_team_only_hidden,
    'is_form_admin', public.is_form_admin()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. submit_order(): validate everything, then save in one transaction
--   p_details: {name, phone, roll_no, batch, course, section}
--   p_items:   [{product_id, size, print_name, print_batch}]   1..6
--   p_payment: {qr_id, txn_id, screenshot_path}
create or replace function public.submit_order(
  p_campaign_id uuid, p_details jsonb, p_items jsonb, p_payment jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := public.student_email();
  v_now     timestamptz := now();
  v_round   public.form_rounds;
  v_name    text := btrim(coalesce(p_details ->> 'name', ''));
  v_phone   text := regexp_replace(coalesce(p_details ->> 'phone', ''), '[\s-]', '', 'g');
  v_roll    text := upper(btrim(coalesce(p_details ->> 'roll_no', '')));
  v_batch   text := btrim(coalesce(p_details ->> 'batch', ''));
  v_course  text := btrim(coalesce(p_details ->> 'course', ''));
  v_section text := btrim(coalesce(p_details ->> 'section', ''));
  v_txn     text := upper(btrim(coalesce(p_payment ->> 'txn_id', '')));
  v_shot    text := btrim(coalesce(p_payment ->> 'screenshot_path', ''));
  v_qr      public.form_payment_qrs;
  v_buyer   public.buyers;
  v_n       integer;
  v_total   integer := 0;
  v_order   uuid;
  v_payment uuid;
  v_item    record;
  v_product public.products;
  v_custom  boolean;
  v_size    text;
  v_print   text;
begin
  if v_email is null then
    raise exception 'Sign in with your @mdi.ac.in Google account' using errcode = '42501';
  end if;
  -- one order at a time per student (a double tap can't save twice)
  perform pg_advisory_xact_lock(hashtext('submit_order:' || v_uid::text));

  -- round
  select r.* into v_round from public.form_rounds r join public.campaigns c on c.id = r.campaign_id
   where r.campaign_id = p_campaign_id and r.is_open and not c.locked;
  if v_round.campaign_id is null then
    raise exception 'Orders for this round are closed' using errcode = '22023';
  end if;
  if v_round.team_only and public.my_role() is null then
    raise exception 'This round is for the MART team only' using errcode = '42501';
  end if;

  -- student details
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Enter your full name' using errcode = '22023';
  end if;
  v_phone := regexp_replace(v_phone, '^(\+91|91|0)(?=\d{10}$)', '');
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a 10-digit Indian mobile number' using errcode = '22023';
  end if;
  if v_roll !~ '^[A-Z0-9][A-Z0-9/_-]{2,19}$' then
    raise exception 'Enter your roll number (letters, digits, - or /)' using errcode = '22023';
  end if;
  if not (v_batch = any (v_round.student_batches)) then
    raise exception 'Pick your batch' using errcode = '22023';
  end if;
  if not (v_course = any (v_round.courses)) then
    raise exception 'Pick your course' using errcode = '22023';
  end if;
  if not (v_section = any (v_round.sections)) then
    raise exception 'Pick your section' using errcode = '22023';
  end if;

  -- items
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'No items in the order' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 then raise exception 'Add at least one item' using errcode = '22023'; end if;
  if v_n > least(v_round.item_cap, 6) then
    raise exception 'At most % items per order', least(v_round.item_cap, 6) using errcode = '22023';
  end if;

  for v_item in
    select x.ord, x.value ->> 'product_id' as product_id, btrim(coalesce(x.value ->> 'size', '')) as size,
           nullif(btrim(coalesce(x.value ->> 'print_name', '')), '') as print_name,
           btrim(coalesce(x.value ->> 'print_batch', '')) as print_batch
      from jsonb_array_elements(p_items) with ordinality as x(value, ord)
  loop
    select p.* into v_product
      from public.products p join public.form_products fp on fp.product_id = p.id
     where p.id::text = v_item.product_id and p.campaign_id = p_campaign_id and fp.shown;
    if v_product.id is null then
      raise exception 'Item %: this product is not on the form', v_item.ord using errcode = '22023';
    end if;
    select fp.allow_custom_size into v_custom from public.form_products fp where fp.product_id = v_product.id;
    v_size := v_item.size;
    if upper(v_size) = any (v_product.sizes) then
      v_size := upper(v_size);
    elsif not (v_custom and length(v_size) between 2 and 40 and v_size ~ '^[A-Za-z0-9 ./"''-]+$') then
      raise exception 'Item %: pick a size from the list', v_item.ord using errcode = '22023';
    end if;
    if not (v_item.print_batch = any (v_round.print_batches)) then
      raise exception 'Item %: pick the batch to print', v_item.ord using errcode = '22023';
    end if;
    if v_item.print_name is not null then
      v_print := upper(regexp_replace(v_item.print_name, '\s+', ' ', 'g'));
      if length(v_print) > v_round.name_max or v_print !~ '^[A-Z][A-Z .''-]*$' then
        raise exception 'Item %: name on the back can have letters, spaces, . '' - (max %)',
          v_item.ord, v_round.name_max using errcode = '22023';
      end if;
    end if;
    v_total := v_total + v_product.price_inr;
  end loop;

  -- payment
  select q.* into v_qr from public.form_payment_qrs q
   where q.id::text = (p_payment ->> 'qr_id')
     and (q.active or q.deactivated_at > v_now - interval '2 hours');
  if v_qr.id is null then
    raise exception 'That payment QR is no longer in use. Reload the page and pay to the new QR.' using errcode = '22023';
  end if;
  if v_txn !~ '^[A-Z0-9]{6,35}$' then
    raise exception 'Enter the UPI transaction ID (UTR) from your payment app' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments p where upper(p.txn_id) = v_txn) then
    raise exception 'This transaction ID is already used for an order' using errcode = '23505';
  end if;
  if v_shot = '' or split_part(v_shot, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'payment-screenshots' and o.name = v_shot) then
    raise exception 'Upload the payment screenshot' using errcode = '22023';
  end if;

  -- buyer: one row per roll number. A roll number already linked to another account is refused.
  select b.* into v_buyer from public.buyers b where b.roll_no = v_roll for update;
  if v_buyer.id is null then
    insert into public.buyers (roll_no, name, email, phone, batch, course, section, user_id)
    values (v_roll, v_name, v_email, v_phone, v_batch, v_course, v_section, v_uid)
    returning * into v_buyer;
  else
    if v_buyer.user_id is distinct from v_uid
       and (v_buyer.user_id is not null or lower(coalesce(v_buyer.email, v_email)) <> v_email) then
      raise exception 'Roll number % is linked to another account. Check it, or contact MART.', v_roll
        using errcode = '42501';
    end if;
    if exists (select 1 from public.buyers b where b.user_id = v_uid and b.id <> v_buyer.id) then
      raise exception 'Your account already ordered with another roll number. Contact MART to change it.'
        using errcode = '42501';
    end if;
    update public.buyers
       set user_id = v_uid, name = v_name, email = v_email, phone = v_phone,
           batch = v_batch, course = v_course, section = v_section
     where id = v_buyer.id;
  end if;

  insert into public.payments (campaign_id, buyer_id, source_timestamp, paid_to, amount_paid, txn_id,
                               screenshot_path, created_by)
  values (p_campaign_id, v_buyer.id, v_now, v_qr.payee_name, v_total, v_txn, v_shot, v_uid)
  returning id into v_payment;

  insert into public.form_orders (campaign_id, buyer_id, user_id, email, submitted_at, item_count,
                                  total_inr, qr_id, payment_id)
  values (p_campaign_id, v_buyer.id, v_uid, v_email, v_now, v_n, v_total, v_qr.id, v_payment)
  returning id into v_order;

  insert into public.order_items (campaign_id, buyer_id, product_id, size, print_name, batch,
                                  source_timestamp, source_slot, form_order_id)
  select p_campaign_id, v_buyer.id, p.id,
         case when upper(btrim(x.value ->> 'size')) = any (p.sizes) then upper(btrim(x.value ->> 'size'))
              else btrim(x.value ->> 'size') end,
         nullif(upper(regexp_replace(btrim(coalesce(x.value ->> 'print_name', '')), '\s+', ' ', 'g')), ''),
         btrim(x.value ->> 'print_batch'), v_now, x.ord, v_order
    from jsonb_array_elements(p_items) with ordinality as x(value, ord)
    join public.products p on p.id::text = x.value ->> 'product_id';

  return jsonb_build_object('order_id', v_order, 'items', v_n, 'total_inr', v_total, 'submitted_at', v_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. my_orders(): the student's own orders (form orders and older imported ones)
create or replace function public.my_orders()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_email text := public.student_email();
begin
  if v_email is null then
    raise exception 'Sign in with your @mdi.ac.in Google account' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(o order by o ->> 'submitted_at' desc)
      from (
        select jsonb_build_object(
                 'key', coalesce(i.form_order_id::text, c.id::text || '/' || coalesce(i.source_timestamp::text, '')),
                 'round', c.name,
                 'submitted_at', coalesce(fo.submitted_at, i.source_timestamp, min(i.created_at)),
                 'total_inr', coalesce(fo.total_inr, sum(p.price_inr)),
                 'payment_status', pay.status,
                 'items', jsonb_agg(jsonb_build_object(
                     'product', p.name, 'colour', p.colour, 'size', i.size, 'print_name', i.print_name,
                     'print_batch', i.batch, 'status', i.status, 'price_inr', p.price_inr)
                   order by i.source_slot nulls last, i.created_at)) as o
          from public.buyers b
          join public.order_items i on i.buyer_id = b.id
          join public.campaigns c on c.id = i.campaign_id and not c.locked
          join public.products p on p.id = i.product_id
          left join public.form_orders fo on fo.id = i.form_order_id
          left join lateral (
            select py.status from public.payments py
             where py.id = fo.payment_id
                or (fo.id is null and py.campaign_id = i.campaign_id and py.buyer_id = b.id
                    and py.source_timestamp = i.source_timestamp)
             limit 1) pay on true
         where b.user_id = auth.uid()
            or (b.user_id is null and lower(b.email) = v_email)
         group by i.form_order_id, c.id, c.name, i.source_timestamp, fo.submitted_at, fo.total_inr, pay.status
      ) s(o)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. form admin helpers
-- Everything a form admin's screen needs: rounds (not locked), their products, form settings, QRs.
create or replace function public.form_admin_state()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_form_admin() then
    raise exception 'Only form admins can do this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_id', c.id, 'name', c.name, 'form', to_jsonb(r),
               'orders', (select count(*) from public.form_orders fo where fo.campaign_id = c.id),
               'products', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', p.id, 'name', p.name, 'colour', p.colour, 'price_inr', p.price_inr,
                          'sizes', p.sizes, 'sort_order', p.sort_order,
                          'ordered', (select count(*) from public.order_items i where i.product_id = p.id),
                          'form', to_jsonb(fp)) order by p.sort_order, p.name)
                   from public.products p left join public.form_products fp on fp.product_id = p.id
                  where p.campaign_id = c.id), '[]'::jsonb))
             order by c.created_at desc)
        from public.campaigns c left join public.form_rounds r on r.campaign_id = c.id
       where not c.locked), '[]'::jsonb),
    'qrs', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from public.form_payment_qrs q), '[]'::jsonb)
  );
end;
$$;

-- Open one round (closing any other) or close it.
create or replace function public.form_admin_set_open(p_campaign_id uuid, p_open boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_form_admin() then
    raise exception 'Only form admins can do this' using errcode = '42501';
  end if;
  if p_open and public.campaign_locked(p_campaign_id) then
    raise exception 'This sales round is locked in MART Orders' using errcode = '42501';
  end if;
  if p_open then
    update public.form_rounds set is_open = false where is_open and campaign_id <> p_campaign_id;
  end if;
  insert into public.form_rounds (campaign_id, is_open) values (p_campaign_id, p_open)
  on conflict (campaign_id) do update set is_open = excluded.is_open;
end;
$$;

-- Form-only display settings for a product. Form admins never change MART data (Oliver,
-- 2026-11-23): name, colour, price and sizes are read from public.products and edited only in
-- MART Orders (Products page, "Manage sales rounds & products").
--   p: {shown, description, photo_paths[], allow_custom_size}
create or replace function public.form_admin_save_product(p_product_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_form_admin() then
    raise exception 'Only form admins can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Unknown product';
  end if;
  if p ?| array['price_inr', 'sizes', 'name', 'colour'] then
    raise exception 'Prices, sizes and names are changed in MART Orders, not on the order form' using errcode = '42501';
  end if;
  insert into public.form_products (product_id, shown, description, photo_paths, allow_custom_size)
  values (p_product_id, coalesce((p ->> 'shown')::boolean, true), nullif(btrim(p ->> 'description'), ''),
          coalesce(array(select jsonb_array_elements_text(p -> 'photo_paths')), '{}'),
          coalesce((p ->> 'allow_custom_size')::boolean, false))
  on conflict (product_id) do update set
    shown = coalesce((p ->> 'shown')::boolean, public.form_products.shown),
    description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else public.form_products.description end,
    photo_paths = case when p ? 'photo_paths' then excluded.photo_paths else public.form_products.photo_paths end,
    allow_custom_size = coalesce((p ->> 'allow_custom_size')::boolean, public.form_products.allow_custom_size);
end;
$$;

-- Make one QR live (the others stop; orders started on the old one still go through for 2 hours).
create or replace function public.form_admin_set_active_qr(p_qr_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_form_admin() then
    raise exception 'Only form admins can do this' using errcode = '42501';
  end if;
  update public.form_payment_qrs set active = false where active and id is distinct from p_qr_id;
  if p_qr_id is not null then
    update public.form_payment_qrs set active = true where id = p_qr_id;
    if not found then raise exception 'Unknown QR'; end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. who may call what
revoke all on function public.student_email(), public.is_form_admin(),
  public.form_admins_max_two(), public.form_qr_times(),
  public.get_order_form(), public.submit_order(uuid, jsonb, jsonb, jsonb), public.my_orders(),
  public.form_admin_state(), public.form_admin_set_open(uuid, boolean),
  public.form_admin_save_product(uuid, jsonb), public.form_admin_set_active_qr(uuid)
  from public, anon;
revoke all on function public.form_admins_max_two(), public.form_qr_times() from authenticated;
grant execute on function public.student_email(), public.is_form_admin(),
  public.get_order_form(), public.submit_order(uuid, jsonb, jsonb, jsonb), public.my_orders(),
  public.form_admin_state(), public.form_admin_set_open(uuid, boolean),
  public.form_admin_save_product(uuid, jsonb), public.form_admin_set_active_qr(uuid)
  to authenticated;
