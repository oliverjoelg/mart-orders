# Decisions

- 2026-11-19: Scope is inventory + handover only; ordering and payments stay outside. Orders enter by CSV import of the Google Form.
- 2026-11-19: Supabase (Postgres, free) + static site on GitHub Pages. Firebase rejected: no Cloud Functions on Spark, so the change log could not be enforced; 50K reads/day cap.
- 2026-11-19: Roles are Main admin, Admin, Ops, IT. Ops sends the "come collect" mails.
