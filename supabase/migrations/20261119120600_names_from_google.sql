-- Team members' names come from their Google account, not from what was typed on the Team page
-- (Oliver, 2026-11-19). Set at first sign-in and refreshed on every sign-in.

create or replace function public.google_name(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '');
$$;

-- first sign-in: gate + link + name
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

-- every sign-in (the app calls this): keep the link and the Google name current
create or replace function public.link_my_member()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.members
     set user_id = auth.uid(),
         display_name = coalesce(public.google_name(auth.jwt() -> 'user_metadata'), display_name)
   where active
     and email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and (user_id is distinct from auth.uid()
          or display_name is distinct from coalesce(public.google_name(auth.jwt() -> 'user_metadata'), display_name));
$$;
revoke all on function public.link_my_member() from public, anon;
grant execute on function public.link_my_member() to authenticated;

-- anyone who already signed in: take the name from their Google account now
update public.members m
   set display_name = public.google_name(u.raw_user_meta_data)
  from auth.users u
 where m.user_id = u.id
   and public.google_name(u.raw_user_meta_data) is not null
   and m.display_name is distinct from public.google_name(u.raw_user_meta_data);
