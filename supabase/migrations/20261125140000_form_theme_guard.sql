-- Security audit follow-up (2026-11-25): the form theme guard keyed "is this a person?" on a Google
-- email (signed_in_email()). Any signed-in session at all now counts as a person, so only SQL run
-- without a session (SQL Editor, migrations) skips the super-admin check. Same behaviour today,
-- because only Google sign-in is switched on; this keeps it true if another provider is ever added.
create or replace function public.form_rounds_theme_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.theme <> 'tees')
     or (tg_op = 'UPDATE' and new.theme is distinct from old.theme) then
    if auth.uid() is not null and not public.is_super() then
      raise exception 'Only MART super admins can change the form theme' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.form_rounds_theme_guard() from public, anon, authenticated;
