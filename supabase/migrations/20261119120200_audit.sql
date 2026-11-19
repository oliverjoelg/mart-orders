-- MART Orders: audit trail. Every insert/update/delete on every app table writes one
-- audit_log row: who (from the JWT), when, which table and row, old -> new, changed columns.
-- The function is security definer, so the app cannot skip it and users cannot write the log
-- directly (they have no insert privilege on audit_log).

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_email    text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_name     text;
  v_role     public.app_role;
  v_row_id   uuid;
  v_item_id  uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key
       and n.key not in ('updated_at', 'status_changed_at', 'status_changed_by');
    if v_changed is null then
      return new;  -- nothing really changed
    end if;
  end if;

  if v_email is not null then
    select m.display_name, m.role into v_name, v_role
      from public.members m where m.email = v_email;
  end if;

  v_row_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_item_id := case
    when tg_table_name = 'order_items' then v_row_id
    else nullif(coalesce(v_new ->> 'item_id', v_old ->> 'item_id'), '')::uuid
  end;

  insert into public.audit_log
    (actor_id, actor_email, actor_name, actor_role, action, table_name, row_id, item_id,
     old_data, new_data, changed)
  values
    (auth.uid(), v_email, coalesce(v_name, v_email, 'system'), v_role, tg_op, tg_table_name,
     v_row_id, v_item_id, v_old, v_new, v_changed);

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_row() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'members', 'campaigns', 'products', 'buyers', 'imports',
    'order_items', 'handovers', 'notes', 'spare_stock'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.audit_row()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- The log is append-only, even for the table owner / service role (they bypass RLS, not triggers).
create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();
