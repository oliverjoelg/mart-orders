-- MART Orders: RPCs used by the app. All are SECURITY INVOKER, so the caller's
-- row-level security and the guard triggers still apply. They exist to make multi-row
-- changes atomic (all or nothing) and to keep long id lists out of URLs.

-- ---------------------------------------------------------------------------
-- Bulk status change, e.g. "vendor box arrived: mark all Navy M as received".
create or replace function public.set_items_status(p_item_ids uuid[], p_status public.item_status)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.has_role('main_admin', 'admin', 'ops') then
    raise exception 'Your role cannot change stock status' using errcode = '42501';
  end if;
  if p_status = 'handed_over' then
    raise exception 'Use the handover desk to mark shirts handed over' using errcode = '23514';
  end if;

  update public.order_items
     set status = p_status
   where id = any (p_item_ids)
     and status <> p_status;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Handover desk: hand one or more shirts to the student or to someone collecting for them.
create or replace function public.record_handover(
  p_item_ids uuid[],
  p_type public.handover_type,
  p_collector_name text default null,
  p_collector_roll text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.has_role('main_admin', 'admin', 'ops') then
    raise exception 'Your role cannot record handovers' using errcode = '42501';
  end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'Pick at least one shirt';
  end if;

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

-- Admins only (RLS on handovers): undo a handover, with a reason. The shirt goes back on the shelf.
create or replace function public.undo_handover(p_item_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.has_role('main_admin', 'admin') then
    raise exception 'Only admins can undo a handover' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Give a reason for the undo';
  end if;

  update public.handovers
     set undone_at = now(), undo_reason = btrim(p_reason)
   where item_id = p_item_id and undone_at is null;
  if not found then
    raise exception 'This shirt has no handover to undo';
  end if;

  update public.order_items set status = 'received' where id = p_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV import, all or nothing. The app parses the Google Form CSV, shows a preview and
-- sends only the rows the user approved.
--   p_buyers: [{roll_no, name, email, phone, batch, course, section}]
--   p_items:  [{roll_no, product_id, size, print_name, batch, source_timestamp, source_slot}]
create or replace function public.import_orders(
  p_campaign_id uuid,
  p_file_name text,
  p_responses integer,
  p_duplicates_skipped integer,
  p_buyers jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_import_id uuid;
  v_items integer;
  v_buyers integer;
  v_missing text;
begin
  if not public.has_role('main_admin', 'admin', 'it') then
    raise exception 'Your role cannot run imports' using errcode = '42501';
  end if;

  insert into public.buyers (roll_no, name, email, phone, batch, course, section)
  select upper(btrim(b.roll_no)), coalesce(b.name, ''), nullif(btrim(b.email), ''),
         nullif(btrim(b.phone), ''), nullif(btrim(b.batch), ''), nullif(btrim(b.course), ''),
         nullif(btrim(b.section), '')
    from jsonb_to_recordset(p_buyers) as b(
      roll_no text, name text, email text, phone text, batch text, course text, section text)
  on conflict (roll_no) do update set
    name    = coalesce(nullif(excluded.name, ''), public.buyers.name),
    email   = coalesce(excluded.email, public.buyers.email),
    phone   = coalesce(excluded.phone, public.buyers.phone),
    batch   = coalesce(excluded.batch, public.buyers.batch),
    course  = coalesce(excluded.course, public.buyers.course),
    section = coalesce(excluded.section, public.buyers.section);
  get diagnostics v_buyers = row_count;

  select string_agg(distinct x.roll_no, ', ')
    into v_missing
    from jsonb_to_recordset(p_items) as x(roll_no text)
   where not exists (select 1 from public.buyers b where b.roll_no = upper(btrim(x.roll_no)));
  if v_missing is not null then
    raise exception 'Items without a buyer row: %', v_missing;
  end if;

  insert into public.imports (campaign_id, file_name, responses, duplicates_skipped)
  values (p_campaign_id, p_file_name, p_responses, p_duplicates_skipped)
  returning id into v_import_id;

  insert into public.order_items
    (campaign_id, buyer_id, product_id, size, print_name, batch, source_timestamp, source_slot,
     import_id)
  select p_campaign_id, b.id, x.product_id, x.size, nullif(btrim(x.print_name), ''),
         nullif(btrim(x.batch), ''), x.source_timestamp, x.source_slot, v_import_id
    from jsonb_to_recordset(p_items) as x(
      roll_no text, product_id uuid, size text, print_name text, batch text,
      source_timestamp timestamptz, source_slot smallint)
    join public.buyers b on b.roll_no = upper(btrim(x.roll_no));
  get diagnostics v_items = row_count;

  update public.imports set items_created = v_items where id = v_import_id;

  return jsonb_build_object('import_id', v_import_id, 'items_created', v_items,
                            'buyers_upserted', v_buyers);
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly keep-alive from GitHub Actions so the free project isn't paused between drops.
-- Returns a constant; reads no data. The only thing anon may call.
create or replace function public.ping()
returns text
language sql
stable
set search_path = ''
as $$
  select 'ok'::text;
$$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

revoke all on function public.set_items_status(uuid[], public.item_status) from public, anon;
revoke all on function public.record_handover(uuid[], public.handover_type, text, text) from public, anon;
revoke all on function public.undo_handover(uuid, text) from public, anon;
revoke all on function public.import_orders(uuid, text, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.set_items_status(uuid[], public.item_status) to authenticated;
grant execute on function public.record_handover(uuid[], public.handover_type, text, text) to authenticated;
grant execute on function public.undo_handover(uuid, text) to authenticated;
grant execute on function public.import_orders(uuid, text, integer, integer, jsonb, jsonb) to authenticated;
