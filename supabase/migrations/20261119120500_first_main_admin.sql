-- The first main admin, so someone can sign in and add the rest of the team
-- from the "Team & roles" page. Name can be changed there.
insert into public.members (email, display_name, role)
values ('pgdm26oliver_j@mdi.ac.in', 'George', 'main_admin')
on conflict (email) do update set role = 'main_admin', active = true;
