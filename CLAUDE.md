# MART Orders

Internal inventory + handover tracker for MART (MDI Gurgaon campus store). Not from Idea Lab.
ECC is enabled for this repo (`.claude/settings.json`).

## Start here
1. Read `PRODUCT-BRIEF.md`: scope, stack, roles, data model, features, "Done when (v1)".
2. Ordering and payments are out of scope. Orders come in by CSV import only.
3. Never commit student data (`*.xlsx`, `*.csv`, `data/`) or the Supabase service-role key.
4. New decisions go in `docs/decisions.md`.
