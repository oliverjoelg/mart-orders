# MART order form — plan (handoff)

Planned with Oliver on 2026-11-20 to 2026-11-23 (phone, cloud session). Nothing is built yet.
Read this before starting work on the order form.

## Goal
Replace the Google Form + Google Sheets for merch orders with our own order site that writes
straight into the MART Orders Supabase database. No sheets, no CSV import step.
Second goal: a much better ordering experience (3D shirt, live name preview).

## Shape
- **Separate site, separate repo** (suggested name `oliverjoelg/mart-order-form`, not created yet).
  Front-end only. Same stack as MART Orders (Vite + React + TypeScript), static hosting.
- **Same Supabase project** as MART Orders. All migrations stay in **this** repo (`mart-orders`),
  so the schema has one home.
- **MART Orders stays team-only.** Students never use it. A student who signs in there sees
  "Not on the MART team list" and gets zero rows (RLS).
- **Students sign in with Google, @mdi.ac.in only.** No roles for students: everyone sees the
  same form, and only their own orders.
- **1–2 form admins** control what the form shows (open round, products, photos, prices, sizes,
  live payment QR, open/close). Admin screens live in the order-form site.

## Database changes needed (in this repo)
1. **Sign-up rule.** Today a trigger on `auth.users` refuses anyone not on `members`. Change it to
   allow any `@mdi.ac.in` Google account. MART access must still need an active `members` row
   (it already does through RLS / `has_perm`). Backup super-admin Gmail rows keep working.
2. **Form tables** (names to settle): form settings per round (open/closed, item cap), product
   display info (photos, description), payment QRs with an "active" flag (QRs are rotated when a
   UPI limit is hit; each order records which QR it was shown), form admins list.
3. **`submit_order` RPC**: validates and saves buyer + one `order_items` row per item + `payments`
   row in one transaction, like `import_orders`. Prices, sizes and products come from the DB, the
   total is computed (no "Total no. of t-shirts" / "Amount paid" fields). Orders show up in MART
   Orders immediately and are audited.
4. **Student read access**: a student can read only their own orders/status ("My orders":
   ordered → at vendor → ready to collect → collected).
5. **Screenshot storage**: Supabase Storage bucket; students can upload, not read others';
   only "Check payments" users read. Compress images on the phone (~200 KB).
6. **Tests** in `supabase/tests/db.test.ts` (PGlite): signed-in student gets zero rows from every
   MART table, every MART write/role/member change refused, a student sees only their own orders.

## Open decisions (Claude's suggestions, Oliver to confirm)
- Students can edit/cancel an order until admins mark the round as sent to the vendor.
- Form admins: a separate list of 1–2 people in the database (not MART super admins).
- Cap of 6 items per order.

## Form content (from the current Google Form "MART Team Batch T-Shirt")
- Student: email (from Google), name, phone, roll number, batch (PG'24/25/26), course (PGDM,
  PGDM-HRM, PGDM-IB, PGDM-BFS, PGDM-BN), section (A–F, NA).
- Per item: product/colour, size (XXS only for Navy Blue / Baby Pink; custom size allowed),
  batch printed on the back (PG'24/25/26), name on back (or none).
- Payment: live QR, transaction ID, screenshot. Total computed.
- Validate as typed: phone, roll number, name-on-back rules (letters, spaces, `.` `'` `-`, max 12,
  capitals — confirm with vendor).
- Problems in the Google Form this fixes: colour names differ between pages; "Other" size only on
  shirt 1; no validation; size chart unreadable on phones.

## UX
- Phones first. Ordering should take under 2 minutes.
- Prototype (2026-11-20): https://claude.ai/artifact/9Vy7rX8FkKgFNB8rGWr6kx — sticky 3D polo
  (three.js) that turns as you scroll, colour switch, live name and batch on the back.
- Real 3D model is being made separately: ~70 photos → photogrammetry app (Polycam /
  RealityScan / KIRI) → `.glb`. Then: compress to ~2–3 MB, separate fabric from print so colour
  and name are layers. Fallback for old phones / reduced motion: 2D front/back flip.
- Still needed from Oliver: real print artwork (PNG/SVG), vendor's name-print rules (font, size,
  position, max letters), size chart numbers, exact colour hex codes.

## Setup steps that need Oliver's accounts
- Create the GitHub repo.
- Apply the new migrations to the Supabase project.
- Add the form site's URL to Supabase Auth redirect URLs (Google sign-in).
- Hosting: GitHub Pages needs a public repo or a paid plan.
