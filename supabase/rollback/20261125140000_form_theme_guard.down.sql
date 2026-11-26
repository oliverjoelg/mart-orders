-- Undo 20261125140000_form_theme_guard.sql (back to the signed_in_email() check)
create or replace function public.form_rounds_theme_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.theme <> 'tees')
     or (tg_op = 'UPDATE' and new.theme is distinct from old.theme) then
    if public.signed_in_email() is not null and not public.is_super() then
      raise exception 'Only MART super admins can change the form theme' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
