# MART Orders

Inventory and handover tracker for MART, the student-run campus store at MDI Gurgaon.
Replaces the Excel "working file" for batch T-shirts. Spec: [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md).
Decisions: [docs/decisions.md](docs/decisions.md). First-time setup: [docs/SETUP.md](docs/SETUP.md).
Prod checklist: [docs/TEST-PLAN.md](docs/TEST-PLAN.md).

- **Frontend:** Vite + React + TypeScript, static site on GitHub Pages (`/mart-orders/`).
- **Backend:** Supabase (Postgres + Google sign-in). Row-level security and audit triggers in
  `supabase/migrations/` do the enforcing; the app only hides buttons a role can't use.

## Run it

```sh
npm install
npm run dev:demo   # made-up data, no Supabase or sign-in needed; switch roles in the top bar
npm run dev        # real backend, needs .env (copy .env.example)
npm test           # importer, exports, inventory + the migrations in an in-memory Postgres
npm run build
```

## What's where

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, roles/RLS, audit triggers, RPCs, the 2026 products |
| `supabase/tests/db.test.ts` | Runs the migrations in PGlite and checks each role's limits and the audit log |
| `src/lib/import/` | Google Form CSV → one row per shirt (`parseForm.ts`), with tests and a fake fixture |
| `src/lib/exports.ts`, `inventory.ts` | Call lists / email lists, product × size grid |
| `src/lib/api*.ts` | Data layer: Supabase, or the in-memory demo |
| `src/pages/` | Handover desk, Overview, Shirts, Inventory, Print list, Exports, Import, Activity, Products, Team |

## Checking the importer on a real export (local only)

Real responses never go in the repo (`*.csv`, `*.xlsx`, `data/` are git-ignored). To test a real file:

```sh
MART_REAL_CSV="C:/somewhere/outside/the/repo/responses.csv" npx vitest run src/lib/import/realFile.test.ts --silent=false
```

It prints counts only.
