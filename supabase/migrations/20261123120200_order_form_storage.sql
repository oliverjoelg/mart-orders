-- Order form storage (Oliver, 2026-11-23). Two private buckets:
--   payment-screenshots  students upload into their own folder (<user id>/...), can read only their
--                        own; people with "Check payments" read all. No edits or deletes by students.
--   form-assets          product photos and payment QR images; any signed-in user reads,
--                        only form admins upload, replace or delete.
-- The phone compresses screenshots to ~200 KB before upload; the 1 MB limit is a backstop.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-screenshots', 'payment-screenshots', false, 1048576, array['image/jpeg', 'image/png', 'image/webp']),
  ('form-assets', 'form-assets', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- screenshots
create policy "screenshots: students upload to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-screenshots'
    and public.student_email() is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "screenshots: own, or Check payments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-screenshots'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.has_perm('check_payments')))
  );

-- form assets
create policy "form assets: signed-in users read" on storage.objects
  for select to authenticated
  using (bucket_id = 'form-assets');
create policy "form assets: form admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'form-assets' and (select public.is_form_admin()));
create policy "form assets: form admins replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'form-assets' and (select public.is_form_admin()))
  with check (bucket_id = 'form-assets' and (select public.is_form_admin()));
create policy "form assets: form admins delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'form-assets' and (select public.is_form_admin()));
