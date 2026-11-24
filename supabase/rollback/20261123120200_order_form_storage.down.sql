-- ROLLBACK for 20261123120200_order_form_storage.sql. Run in the SQL Editor only if needed,
-- before the order-form rollback (20261123120100). Before this migration (checked live on
-- 2026-11-23) storage had no buckets, no policies on storage.objects and no files.
-- The buckets are removed only while empty. If students already uploaded screenshots, download
-- what you need, then empty and delete the buckets in Dashboard -> Storage (Supabase may refuse
-- deleting storage rows directly from SQL).
begin;

drop policy if exists "screenshots: students upload to their own folder" on storage.objects;
drop policy if exists "screenshots: own, or Check payments" on storage.objects;
drop policy if exists "form assets: signed-in users read" on storage.objects;
drop policy if exists "form assets: form admins upload" on storage.objects;
drop policy if exists "form assets: form admins replace" on storage.objects;
drop policy if exists "form assets: form admins delete" on storage.objects;

delete from storage.buckets b
 where b.id in ('payment-screenshots', 'form-assets')
   and not exists (select 1 from storage.objects o where o.bucket_id = b.id);

commit;
