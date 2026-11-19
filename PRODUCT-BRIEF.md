# MART Orders — product brief

Internal web tool for MART (MDI Gurgaon's student-run campus store) to track merchandise
inventory and handovers. Replaces the Excel "working file" used for the 2026 batch T-shirts.
Agreed with George on 2026-11-19.

## Why (what broke in Excel)
From `MART Tshirt Working File.xlsx` and `Batch Tshirts form (Responses).xlsx` (local, not in repo):
- Status typed by hand: "received" held `yes / YES / Yes / eys / F`, "delivered" held `Yea`, `yes'`.
- The same data copied into ~10 sheets (Data, Sheet12, Pink, MAIN Pink/Blue/Black pg 26, Pink pg 25…),
  so a fix in one never reached the others.
- One form row held up to 4 shirts side by side, so one shirt of three could not be marked separately.
- 16 roll numbers appear more than once (re-orders / duplicates). Notes like "NEED TO COLLECT CASH"
  sat in an unfiltered comments column.
- No record of who changed what. This is the main problem to solve.

## Scope
**In:** inventory, stock received from the vendor, handovers, roll-number/email exports,
vendor print lists, change history, team roles.
**Out:** ordering and payments. Those stay in the Google Form / elsewhere. Orders enter this tool
only by **CSV import of the form responses**.

## Stack (decided: best long-term option)
- **Database + auth:** Supabase Free (Postgres). Unlimited API requests, 500 MB DB, 50K MAU,
  2 active projects; free projects pause after 1 week of inactivity (data kept, one click to resume).
  Source: https://supabase.com/pricing
  - Add a free weekly GitHub Actions ping so it doesn't pause between drops.
- **Hosting:** static site on **GitHub Pages** (the site is static; Supabase does data and login).
- **Frontend:** static SPA (e.g. Vite + React + TypeScript), responsive for phone and desktop.
- **Code:** private GitHub repo; collaborators work in branches.
- Rejected: Firebase Spark — no Cloud Functions on the free plan (so the change log would be
  written by the client, not enforced), and 50K document reads/day could be hit on a busy handover
  day with ~1,100 shirts. Source: https://firebase.google.com/pricing,
  https://firebase.google.com/docs/firestore/quotas
- Rejected: Vercel Hobby — not needed for a static site; 1 developer seat. Source: https://vercel.com/pricing

## Login and roles
Google sign-in, restricted to `@mdi.ac.in` emails plus an approved-members list. Enforced by
Supabase row-level security, not just the UI.

| Role | Can do |
|---|---|
| Main admin | Everything, incl. managing users and roles |
| Admin | Imports, edit orders/products, undo handovers, delete |
| Ops | Mark received from vendor, handovers, exports (incl. emails for "come collect" mails), notes. Cannot delete |
| IT | Manage team logins, run imports, view activity log; stock is read-only |

## Data model
- `campaigns` — one sales round (e.g. Batch Tees 2026, Reopening round).
- `products` — name, colour, price, allowed sizes (XXS only for Navy Blue / Baby Pink; custom sizes allowed).
  2026 products: Classic MDI Navy Blue ₹699, Classic MDI Baby Pink ₹699, Premium UCB Black ₹1049,
  Premium UCB White ₹1049.
- `buyers` — roll number (unique, normalised: trimmed, upper-case), name, email, phone, batch, course, section.
- `order_items` — **one row per shirt**: campaign, buyer, product, size, print name, batch,
  status, source form timestamp.
- `handovers` — item, type (`self` / `collected_by_other`), collector name + roll number,
  handed by (logged-in user), time; undo needs a reason.
- `notes` — flags on a buyer or item.
- `audit_log` — written by Postgres triggers on every insert/update/delete: who, when, table,
  row, old → new. The app cannot skip it.

Item status (fixed values): `ordered → sent_to_vendor → received → handed_over`.

## Features
1. **Import** Google Form responses (CSV). Splits each response's 4 shirt slots into one row per
   shirt, normalises sizes/colours, flags duplicates (same roll no. + same shirt) for review
   instead of silently adding them. Shows a preview before saving.
2. **Status updates**, single or bulk (e.g. a vendor box arrives: mark all Navy M as received).
3. **Handover desk** (phone-first): search roll no. or name → that student's shirts → "Handed over"
   → "To them" or "Collected by someone else" (name + roll no.).
4. **Inventory grid** product × size: ordered / received / handed over / on shelf / still with vendor.
   Spare stock tracked separately.
5. **Exports** by status, filterable by product, size, batch, section, campaign:
   arrived-not-collected (call list), not yet arrived, collected (with who handed over).
   One line per student; toggle for partly-arrived students. Copy roll numbers / emails to clipboard
   or download CSV.
6. **Vendor print list** per colour and size, with back-print names (replaces the colour sheets).
7. **History** tab per item and a full activity feed.

## Data safety
The spreadsheets hold students' names, phones and emails. They never go into git
(`.gitignore` blocks `*.xlsx`, `*.csv`, `data/`). Supabase keys: only the public anon key in the
site; the service-role key never in the repo.

## Done when (v1)
- A team member can sign in on phone and desktop; a non-MART email is refused.
- The 2026 form CSV imports to the right number of shirts (form total of "Total No. of t-shirt ordered").
- Every status change and handover shows in the activity log with the user's name.
- Ops can export "arrived, not collected" roll numbers in under 3 taps.
- An Ops user cannot delete or change roles (checked against the database, not only the UI).
