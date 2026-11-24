-- ROLLBACK for 20261124120000_order_form_security.sql. Run in the SQL Editor only if needed, and
-- before the rollbacks of 20261123120200 / 120100. Puts back the exact definitions from
-- 20261123120000, 20261123120100, 20261123120200 and 20261123110000 (audit_select).
begin;

drop trigger if exists form_admins_audit on public.form_admins;
drop trigger if exists form_rounds_audit on public.form_rounds;
drop trigger if exists form_products_audit on public.form_products;
drop trigger if exists form_payment_qrs_audit on public.form_payment_qrs;
drop trigger if exists form_orders_audit on public.form_orders;

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

drop policy if exists form_orders_select on public.form_orders;
create policy form_orders_select on public.form_orders for select to authenticated
  using ((select public.my_role()) is not null and public.campaign_visible(campaign_id));

drop policy if exists form_rounds_select on public.form_rounds;
drop policy if exists form_rounds_write on public.form_rounds;
drop policy if exists form_products_select on public.form_products;
drop policy if exists form_products_write on public.form_products;
create policy form_rounds_select on public.form_rounds for select to authenticated
  using ((select public.is_form_admin()) or (select public.my_role()) is not null);
create policy form_rounds_write on public.form_rounds for all to authenticated
  using ((select public.is_form_admin())) with check ((select public.is_form_admin()));
create policy form_products_select on public.form_products for select to authenticated
  using ((select public.is_form_admin()) or (select public.my_role()) is not null);
create policy form_products_write on public.form_products for all to authenticated
  using ((select public.is_form_admin())) with check ((select public.is_form_admin()));

drop policy if exists "screenshots: students upload to their own folder" on storage.objects;
drop policy if exists "screenshots: own, or Payments page" on storage.objects;
create policy "screenshots: students upload to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-screenshots'
    and public.student_email() is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "screenshots: own, or Check payments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-screenshots'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.has_perm('check_payments')))
  );


create or replace function public.enforce_member_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
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
revoke all on function public.submit_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.submit_order(uuid, jsonb, jsonb, jsonb) to authenticated;

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
revoke all on function public.form_admin_save_product(uuid, jsonb) from public, anon;
grant execute on function public.form_admin_save_product(uuid, jsonb) to authenticated;

drop function if exists public.my_recent_screenshot_count();
drop function if exists public.product_campaign(uuid);

commit;
