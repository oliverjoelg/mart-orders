-- Usage page (super admins only): how much of the free plan's space is used.
-- Read-only: database size as Postgres reports it, the biggest tables, file storage used, and
-- when the first sales round was created (to estimate growth). Network traffic (egress) is not
-- visible from SQL; the page links to the Supabase dashboard for that.

create or replace function public.usage_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tables jsonb;
  v_storage_bytes bigint := 0;
  v_storage_files bigint := 0;
begin
  if not public.is_super() then
    raise exception 'Only a super admin can see usage' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb) into v_tables
    from (
      select c.relname as name,
             pg_total_relation_size(c.oid) as bytes,
             greatest(c.reltuples, 0)::bigint as rows
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc
       limit 8
    ) t;

  -- uploaded files (e.g. payment screenshots), if Supabase Storage is in use
  if to_regclass('storage.objects') is not null then
    execute 'select coalesce(sum((metadata ->> ''size'')::bigint), 0), count(*) from storage.objects'
      into v_storage_bytes, v_storage_files;
  end if;

  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'public_bytes', (select coalesce(sum(pg_total_relation_size(c.oid)), 0)
                       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r'),
    'tables', v_tables,
    'storage_bytes', v_storage_bytes,
    'storage_files', v_storage_files,
    'first_round_at', (select min(created_at) from public.campaigns),
    'orders', (select count(*) from public.order_items),
    'measured_at', now()
  );
end;
$$;

revoke all on function public.usage_stats() from public, anon;
grant execute on function public.usage_stats() to authenticated;
