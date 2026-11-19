-- Run ONCE in the Supabase SQL editor after the migrations, with your own details.
-- It adds the first main admin. Everyone else is added from the Team page in the app.
-- (Copy to seed.sql locally if you like; do not commit real team emails you don't want in git.)

insert into public.members (email, display_name, role)
values ('your.name@mdi.ac.in', 'Your Name', 'main_admin');
