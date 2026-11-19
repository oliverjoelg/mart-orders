# Decisions

- 2026-11-19: Scope is inventory + handover only; ordering and payments stay outside. Orders enter by CSV import of the Google Form.
- 2026-11-19: Supabase (Postgres, free) + static site on GitHub Pages. Firebase rejected: no Cloud Functions on Spark, so the change log could not be enforced; 50K reads/day cap.
- 2026-11-19: Roles are Main admin, Admin, Ops, IT. Ops sends the "come collect" mails.

## v1 build (2026-11-19)

- **Sign-in gate:** only emails on `members` (active, `@mdi.ac.in`, enforced by a check constraint) can sign in. A trigger on `auth.users` refuses sign-up for anyone else; RLS gives non-members zero rows. Main admins add anyone; IT adds/edits Ops and IT only; there must always be one active main admin.
- **Permissions live in Postgres.** RLS per table plus guard triggers: Ops may change only an item's status (any other column is refused); "handed over" can be set only with a live handover row; leaving "handed over" needs the handover undone first, which only admins can do and needs a reason. Handovers are never deleted. IT cannot change stock.
- **Audit log:** one `security definer` trigger on every app table writes who (from the JWT, with name and role from `members`), when, table, row, old/new JSON and changed columns. `audit_log` has no insert/update/delete grant for users and an append-only trigger that also stops the owner/service role. `item_id` is stored on each entry so per-shirt history is one indexed query.
- **Multi-row changes go through RPCs** (`set_items_status`, `record_handover`, `undo_handover`, `import_orders`), all `security invoker` so RLS still applies. They make bulk changes atomic and keep long id lists out of URLs.
- **Importer reads the form by position, not header text.** The 2026 form was edited while live, so shirts 2–4 are in either the old block ("Color ", "Color  2", "Color") or columns Google appended at the end ("T-shirt Details Color 2/3/4", "Batch 5/6/7"). Slots are found between "Add another T-shirt" columns; appended columns fill shirts 2–4 in order. Both layouts (and the later Reopening form) are covered by tests.
- **Duplicates:** same roll no. + same product + size + back name in a *different* response (or already in the tool) is held back for review. Two identical shirts in one response are treated as intentional. An exact re-import of a response (same timestamp, roll, slot) is skipped as "already imported", so re-importing the whole sheet is safe.
- **2026 form count:** the importer finds 1,008 shirts in 647 responses; the form's "Total" column sums to 1,011. The 3 extra are typos in three responses — amount paid matches the shirts found in each. The preview shows amount paid next to the expected price for every mismatch.
- **Custom sizes** (e.g. "Chest 38 / Length 28") are kept as typed and flagged, not rejected. Sizes outside a product's list (e.g. XXXS) are flagged too.
- **Form timestamps** are stored as India time (+05:30). D/M/Y vs M/D/Y is detected from the whole file.
- **Frontend data:** the app loads the whole round (≈1,100 shirts) once, paginating past Supabase's 1,000-row limit, and computes inventory/exports in the browser. It refreshes after every change and when the tab comes back into view. Fine at this size; revisit with views if a round passes ~10k shirts.
- **HashRouter** so deep links work on GitHub Pages without a 404 redirect trick. Google OAuth uses the PKCE flow.
- **Demo mode** (`npm run dev:demo`): an in-memory backend with made-up data and a role switcher, for trying the UI without accounts. Not included in the production bundle.
- **Tests:** `supabase/tests/db.test.ts` runs the real migrations in PGlite (in-memory Postgres) with a stand-in `auth` schema and checks every role limit and the audit trail.
- **Keep-awake:** a public `ping()` function (returns 'ok', reads nothing) is the only thing `anon` may call; a weekly GitHub Action calls it.
- **Call list default:** "Arrived, not collected" lists only students whose shirts are *all* in MART, so they come once; a toggle adds partly-arrived students. Emails copy comma-separated for Bcc; roll numbers copy one per line.
- **GitHub Pages on a private repo needs a paid plan** (https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages). Left to George: upgrade or make the repo public.
