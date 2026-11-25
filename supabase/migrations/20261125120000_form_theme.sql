-- Order form themes (2026-11-25, Oliver): each sales round has a look on the student order form.
--   'tees'    = Batch T-shirt (the original look)
--   'hoodies' = Winter Hoodies
-- Only MART super admins can change it. Form admins keep every other round setting.
-- The theme is not secret: form_look() tells the sign-in page (before anyone signs in) how to look.

alter table public.form_rounds
  add column theme text not null default 'tees' check (theme in ('tees', 'hoodies'));

-- Form admins write form_rounds directly (RLS policy form_rounds_write), so the theme column is
-- guarded by a trigger: a signed-in user who is not a super admin cannot set or change it.
-- SQL run without a signed-in user (SQL Editor, migrations) is allowed.
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

create trigger form_rounds_theme_guard before insert or update on public.form_rounds
  for each row execute function public.form_rounds_theme_guard();

-- Super admins set a round's theme (creates the round's form settings if there are none yet).
create or replace function public.form_set_theme(p_campaign_id uuid, p_theme text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_super() then
    raise exception 'Only MART super admins can change the form theme' using errcode = '42501';
  end if;
  if p_theme is null or p_theme not in ('tees', 'hoodies') then
    raise exception 'Unknown theme: use tees or hoodies' using errcode = '22023';
  end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id) then
    raise exception 'Unknown sales round' using errcode = '22023';
  end if;
  if public.campaign_locked(p_campaign_id) then
    raise exception 'This sales round is locked' using errcode = '42501';
  end if;
  insert into public.form_rounds (campaign_id, theme) values (p_campaign_id, p_theme)
    on conflict (campaign_id) do update set theme = excluded.theme;
end;
$$;

-- The look of the open round, for the sign-in page. Returns only 'tees' or 'hoodies'.
create or replace function public.form_look()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select r.theme
      from public.form_rounds r join public.campaigns c on c.id = r.campaign_id
     where r.is_open and not c.locked
     limit 1
  ), 'tees');
$$;

revoke all on function public.form_rounds_theme_guard() from public, anon, authenticated;
revoke all on function public.form_set_theme(uuid, text) from public, anon;
grant execute on function public.form_set_theme(uuid, text) to authenticated;
revoke all on function public.form_look() from public;
grant execute on function public.form_look() to anon, authenticated;
