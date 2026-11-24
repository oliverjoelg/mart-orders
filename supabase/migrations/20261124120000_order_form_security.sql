-- Order form: fixes from the ECC security review of the order-form branch (2026-11-24).
-- 20261123120000-120200 are already live, so these go in as a new migration on top.
--   a. sign-up: Google only
--   b. roll numbers: never auto-claim a student record that has no email on file
--   c. the same UPI transaction ID can't be saved twice, even by two students at the same moment
--   d. abuse limits: at most 3 orders waiting for a payment check per student per round,
--      and at most 10 screenshot uploads per student per 24 hours
--   e. form orders and form screenshots: only people with the Payments page, never locked rounds
--   f. change log for the form tables (who swapped the QR, opened the round, ...)
--   g. locked rounds: their form settings are hidden and frozen like the rest of the round
-- Everything here is rebuilt on top of 20261123110000_security_fixes.sql.

-- ---------------------------------------------------------------------------
-- a. sign-up: only Google sign-ups (an email+password account could be registered with someone
--    else's address). Students: any @mdi.ac.in Google account; anyone else: an active member row.
create or replace function public.enforce_member_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    raise exception 'Sign in with Google (% tried another way)', coalesce(new.email, '(no email)')
      using errcode = '42501';
  end if;
  if not public.is_mdi_email(v_email)
     and not exists (select 1 from public.members m where m.active and m.email = v_email) then
    raise exception 'Only @mdi.ac.in Google accounts can sign in (% is not one)', coalesce(new.email, '(no email)')
      using errcode = '42501';
  end if;
  -- team members: link and take the Google name (no-op for students)
  update public.members
     set user_id = coalesce(user_id, new.id),
         display_name = coalesce(public.google_name(new.raw_user_meta_data), display_name)
   where email = v_email;
  return new;
end;
$$;
revoke all on function public.enforce_member_signup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- small helpers
-- the sales round of a product (for policies on form_products)
create or replace function public.product_campaign(pid uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.campaign_id from public.products p where p.id = pid;
$$;

-- screenshots the signed-in student uploaded in the last 24 hours (for the upload limit)
create or replace function public.my_recent_screenshot_count()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from storage.objects o
   where o.bucket_id = 'payment-screenshots'
     and (storage.foldername(o.name))[1] = auth.uid()::text
     and o.created_at > now() - interval '24 hours';
$$;

revoke all on function public.product_campaign(uuid), public.my_recent_screenshot_count() from public, anon;
grant execute on function public.product_campaign(uuid), public.my_recent_screenshot_count() to authenticated;

-- ---------------------------------------------------------------------------
-- b, c, d. submit_order: same as 20261123120100, with these changes
--   b. an existing roll number is accepted only if it is already this account's, or its email on
--      file is this student's Google email. No email on file / another email -> "contact MART".
--   c. a lock on the transaction ID itself, so two students can't save the same UTR at once.
--      (No unique index: imported Google Form data can legitimately hold the same ID twice;
--      MART Orders flags those for a person to check.)
--   d. at most 3 orders per student per round still waiting for a payment check.
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
  v_waiting integer;
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

  -- d. orders still waiting for a payment check in this round
  select count(*) into v_waiting
    from public.form_orders fo join public.payments p on p.id = fo.payment_id
   where fo.user_id = v_uid and fo.campaign_id = p_campaign_id and p.status = 'unchecked';
  if v_waiting >= 3 then
    raise exception 'You already have 3 orders waiting for MART to check the payment. Wait for those, or contact MART.'
      using errcode = '22023';
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
  -- c. everyone submitting this transaction ID waits here, so only one of them can save it
  perform pg_advisory_xact_lock(hashtext('submit_order:txn:' || v_txn));
  if exists (select 1 from public.payments p where upper(p.txn_id) = v_txn) then
    raise exception 'This transaction ID is already used for an order' using errcode = '23505';
  end if;
  if v_shot = '' or split_part(v_shot, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'payment-screenshots' and o.name = v_shot) then
    raise exception 'Upload the payment screenshot' using errcode = '22023';
  end if;

  -- b. student record: one per roll number
  select b.* into v_buyer from public.buyers b where b.roll_no = v_roll for update;
  if v_buyer.id is null then
    if exists (select 1 from public.buyers b where b.user_id = v_uid) then
      raise exception 'Your account already ordered with another roll number. Contact MART to change it.'
        using errcode = '42501';
    end if;
    insert into public.buyers (roll_no, name, email, phone, batch, course, section, user_id)
    values (v_roll, v_name, v_email, v_phone, v_batch, v_course, v_section, v_uid)
    returning * into v_buyer;
  else
    -- coalesce: with no account linked, "user_id = me" is null, which must count as "no"
    if not coalesce(v_buyer.user_id = v_uid
                    or (v_buyer.user_id is null and v_buyer.email is not null and lower(btrim(v_buyer.email)) = v_email),
                    false) then
      raise exception 'Roll number % is already on file with a different email. Check it, or ask MART to link it to your account.', v_roll
        using errcode = '42501';
    end if;
    if exists (select 1 from public.buyers b where b.user_id = v_uid and b.id <> v_buyer.id) then
      raise exception 'Your account already ordered with another roll number. Contact MART to change it.'
        using errcode = '42501';
    end if;
    update public.buyers
       set user_id = v_uid, name = v_name, phone = v_phone,
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
revoke all on function public.submit_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.submit_order(uuid, jsonb, jsonb, jsonb) to authenticated;

-- my_orders: only the account's own records, plus imported ones whose email on file is theirs
-- (unchanged rule; listed here because b. relies on it)

-- ---------------------------------------------------------------------------
-- d, e. screenshots: at most 10 uploads per student per 24 hours; read by the student who
--       uploaded it, or by people with the Payments page for a round they can see
drop policy if exists "screenshots: students upload to their own folder" on storage.objects;
create policy "screenshots: students upload to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-screenshots'
    and public.student_email() is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.my_recent_screenshot_count() < 10
  );

drop policy if exists "screenshots: own, or Check payments" on storage.objects;
create policy "screenshots: own, or Payments page" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-screenshots'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or ((select public.has_perm('page_payments'))
             and exists (select 1 from public.payments p
                          where p.screenshot_path = name and public.campaign_visible(p.campaign_id))))
  );

-- e. form orders (email, total, payment, QR): Payments page only
drop policy if exists form_orders_select on public.form_orders;
create policy form_orders_select on public.form_orders for select to authenticated
  using ((select public.has_perm('page_payments')) and public.campaign_visible(campaign_id));

-- ---------------------------------------------------------------------------
-- g. locked rounds: form settings hidden from everyone but super admins, and frozen
drop policy if exists form_rounds_select on public.form_rounds;
drop policy if exists form_rounds_write on public.form_rounds;
create policy form_rounds_select on public.form_rounds for select to authenticated
  using (((select public.is_form_admin()) or (select public.my_role()) is not null)
         and public.campaign_visible(campaign_id));
create policy form_rounds_write on public.form_rounds for all to authenticated
  using ((select public.is_form_admin()) and not public.campaign_locked(campaign_id))
  with check ((select public.is_form_admin()) and not public.campaign_locked(campaign_id));

drop policy if exists form_products_select on public.form_products;
drop policy if exists form_products_write on public.form_products;
create policy form_products_select on public.form_products for select to authenticated
  using (((select public.is_form_admin()) or (select public.my_role()) is not null)
         and public.campaign_visible(public.product_campaign(product_id)));
create policy form_products_write on public.form_products for all to authenticated
  using ((select public.is_form_admin()) and not public.campaign_locked(public.product_campaign(product_id)))
  with check ((select public.is_form_admin()) and not public.campaign_locked(public.product_campaign(product_id)));

-- the form-admin function runs with owner rights, so it checks the lock itself
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
  perform public.assert_round_unlocked(public.product_campaign(p_product_id));
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
revoke all on function public.form_admin_save_product(uuid, jsonb) from public, anon;
grant execute on function public.form_admin_save_product(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- f. change log for the form tables
create trigger form_admins_audit after insert or update or delete on public.form_admins
  for each row execute function public.audit_row();
create trigger form_rounds_audit after insert or update or delete on public.form_rounds
  for each row execute function public.audit_row();
create trigger form_products_audit after insert or update or delete on public.form_products
  for each row execute function public.audit_row();
create trigger form_payment_qrs_audit after insert or update or delete on public.form_payment_qrs
  for each row execute function public.audit_row();
create trigger form_orders_audit after insert or update or delete on public.form_orders
  for each row execute function public.audit_row();

-- activity log: same as 20261123110000_security_fixes.sql, plus
--   form orders and payment-QR entries only for the Payments page (they hold emails, UPI IDs),
--   form-product entries of locked rounds hidden like spare stock
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
        and (table_name not in ('spare_stock', 'form_products')
             or nullif(coalesce(new_data, old_data) ->> 'product_id', '') is null
             or public.campaign_visible(public.product_campaign((coalesce(new_data, old_data) ->> 'product_id')::uuid)))
        and (actor_email is null or public.is_mdi_email(actor_email))
        and not (table_name = 'members'
                 and ((new_data is not null and not public.is_mdi_email(new_data ->> 'email'))
                      or (old_data is not null and not public.is_mdi_email(old_data ->> 'email'))))
        and (table_name not in ('payments', 'form_orders', 'form_payment_qrs') or (select public.has_perm('page_payments')))
      )
    )
  );
