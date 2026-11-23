-- Order form: students sign in too (Oliver, 2026-11-23).
-- Sign-up used to be refused for anyone not on `members`. Now any @mdi.ac.in Google account may
-- sign up (students use the separate order-form site). Access to MART Orders data is unchanged:
-- every MART policy still needs an active `members` row (my_role() / has_perm()), so a student
-- gets zero rows there. Non-MDI emails still need an active members row (backup super admins).

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
