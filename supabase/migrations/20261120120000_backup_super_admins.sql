-- Backup super admins: personal (non-@mdi.ac.in) Google accounts kept as a way back in if the
-- MDI accounts are ever lost. Rules:
--   * a non-MDI email is allowed only on a super admin row (and cannot be moved to another role:
--     remove it instead);
--   * those rows, and every log entry about them or made by them, are visible to super admins only.

create or replace function public.is_mdi_email(e text)
returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(e, '') like '%@mdi.ac.in' $$;

-- 1. drop the old "@mdi.ac.in only" check (found by its text, whatever Postgres named it)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.members'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%mdi.ac.in%'
  loop
    execute format('alter table public.members drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.members
  add constraint members_email_format
  check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- 2. non-MDI emails only for super admins
create or replace function public.guard_backup_member()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_mdi_email(new.email) and not public.role_is_super(new.role) then
    if tg_op = 'UPDATE' then
      raise exception 'A backup (non-MDI) account can only be a super admin. Remove it instead.';
    end if;
    raise exception 'Team members need an @mdi.ac.in email (only a super admin can use another email)';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_backup_member() from public, anon, authenticated;

create trigger members_guard_backup
  before insert or update on public.members
  for each row execute function public.guard_backup_member();

-- 3. hide backup accounts from everyone but super admins
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using ((select public.my_role()) is not null and (public.is_mdi_email(email) or (select public.is_super())));

-- 4. hide log entries about them (members rows) or made by them
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
      )
    )
  );
