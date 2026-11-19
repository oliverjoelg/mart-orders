-- Optional nickname per team member (Oliver, 2026-11-19). The app and the activity log show the
-- nickname when set, otherwise the name from their Google account (display_name, synced at sign-in).

alter table public.members
  add column nickname text check (nickname is null or btrim(nickname) <> '');

-- same as before, but the actor is named by nickname first
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
    select coalesce(m.nickname, m.display_name), m.role into v_name, v_role
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
