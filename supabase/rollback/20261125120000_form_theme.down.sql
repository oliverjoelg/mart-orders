-- Undo 20261125120000_form_theme.sql
drop function if exists public.form_look();
drop function if exists public.form_set_theme(uuid, text);
drop trigger if exists form_rounds_theme_guard on public.form_rounds;
drop function if exists public.form_rounds_theme_guard();
alter table public.form_rounds drop column if exists theme;
