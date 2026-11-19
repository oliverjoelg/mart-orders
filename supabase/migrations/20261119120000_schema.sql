-- MART Orders: core schema.
-- One row per shirt in order_items. Status is a fixed enum. audit_log is filled by triggers
-- (see 20261119120200_audit.sql); row-level security is in 20261119120100_security.sql.

create type public.app_role as enum ('main_admin', 'admin', 'ops', 'it');
create type public.item_status as enum ('ordered', 'sent_to_vendor', 'received', 'handed_over');
create type public.handover_type as enum ('self', 'collected_by_other');

-- keeps updated_at current on every update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team: the approved-members list. Sign-in is refused for anyone not listed here.
create table public.members (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique
                check (email = lower(btrim(email)) and email like '%@mdi.ac.in'),
  display_name  text not null check (btrim(display_name) <> ''),
  role          public.app_role not null default 'ops',
  active        boolean not null default true,
  user_id       uuid unique,  -- auth.users id, set at first sign-in (used to show names)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger members_updated_at before update on public.members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- A sales round, e.g. "Batch Tees 2026" or "Reopening round".
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (btrim(name) <> ''),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.campaigns (id) on delete cascade,
  name               text not null check (btrim(name) <> ''),   -- "Classic MDI Navy Blue"
  colour             text not null check (btrim(colour) <> ''), -- "Navy Blue"
  price_inr          integer not null check (price_inr >= 0),
  sizes              text[] not null default '{}',              -- allowed standard sizes, in order
  -- lower-case words that identify this product in the Google Form's colour answer
  form_keywords      text[] not null default '{}',
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (campaign_id, name)
);
create index products_campaign_idx on public.products (campaign_id);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
create table public.buyers (
  id          uuid primary key default gen_random_uuid(),
  roll_no     text not null unique check (roll_no = upper(btrim(roll_no)) and roll_no <> ''),
  name        text not null default '',
  email       text,
  phone       text,
  batch       text,
  course      text,
  section     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index buyers_name_idx on public.buyers (lower(name));
create trigger buyers_updated_at before update on public.buyers
  for each row execute function public.set_updated_at();

-- One CSV import run.
create table public.imports (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns (id) on delete cascade,
  file_name           text not null,
  responses           integer not null default 0,
  items_created       integer not null default 0,
  duplicates_skipped  integer not null default 0,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- One row per shirt.
create table public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.campaigns (id) on delete restrict,
  buyer_id           uuid not null references public.buyers (id) on delete restrict,
  product_id         uuid not null references public.products (id) on delete restrict,
  size               text not null check (btrim(size) <> ''),
  print_name         text,                  -- back print; null = no name
  batch              text,                  -- batch printed on the shirt, e.g. PG'26
  status             public.item_status not null default 'ordered',
  status_changed_at  timestamptz,
  status_changed_by  uuid,
  source_timestamp   timestamptz,           -- Google Form response time
  source_slot        smallint check (source_slot between 1 and 4),
  import_id          uuid references public.imports (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index order_items_buyer_idx on public.order_items (buyer_id);
create index order_items_grid_idx on public.order_items (campaign_id, product_id, size, status);
create index order_items_status_idx on public.order_items (status);
create trigger order_items_updated_at before update on public.order_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
create table public.handovers (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.order_items (id) on delete cascade,
  type            public.handover_type not null,
  collector_name  text,
  collector_roll  text,
  handed_by       uuid not null default auth.uid(),
  handed_at       timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid,
  undo_reason     text,
  constraint handover_collector_required check (
    type = 'self'
    or (btrim(coalesce(collector_name, '')) <> '' and btrim(coalesce(collector_roll, '')) <> '')
  ),
  constraint handover_undo_needs_reason check (
    undone_at is null or btrim(coalesce(undo_reason, '')) <> ''
  )
);
-- at most one live handover per shirt
create unique index handovers_one_active_idx on public.handovers (item_id) where undone_at is null;

-- ---------------------------------------------------------------------------
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  buyer_id    uuid references public.buyers (id) on delete cascade,
  item_id     uuid references public.order_items (id) on delete cascade,
  body        text not null check (btrim(body) <> ''),
  is_flag     boolean not null default false,   -- e.g. "NEED TO COLLECT CASH"
  resolved    boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint note_has_target check (buyer_id is not null or item_id is not null)
);
create index notes_buyer_idx on public.notes (buyer_id);
create index notes_item_idx on public.notes (item_id);
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

-- Spare shirts (extra stock from the vendor, not tied to an order).
create table public.spare_stock (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  size        text not null check (btrim(size) <> ''),
  quantity    integer not null default 0 check (quantity >= 0),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (product_id, size)
);
create trigger spare_stock_updated_at before update on public.spare_stock
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only change log. Written only by triggers.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  actor_name   text,
  actor_role   public.app_role,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text not null,
  row_id       uuid,
  item_id      uuid,          -- the shirt this change concerns, when there is one
  old_data     jsonb,
  new_data     jsonb,
  changed      text[]         -- columns that changed (UPDATE only)
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);
create index audit_log_item_idx on public.audit_log (item_id) where item_id is not null;
