-- ROLLBACK for 20261123120000_student_signup.sql: only MART team members can sign up again.
-- Copied from the live database on 2026-11-23 just before the migration was applied
-- (same as 20261119120600_names_from_google.sql). Run in the SQL Editor only if needed.
create or replace function public.enforce_member_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.members m
    where m.active and m.email = lower(btrim(coalesce(new.email, '')))
  ) then
    raise exception 'MART Orders: % is not on the MART team list', coalesce(new.email, '(no email)')
      using errcode = '42501';
  end if;
  update public.members
     set user_id = coalesce(user_id, new.id),
         display_name = coalesce(public.google_name(new.raw_user_meta_data), display_name)
   where email = lower(btrim(new.email));
  return new;
end;
$$;
