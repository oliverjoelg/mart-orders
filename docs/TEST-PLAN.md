# Prod test plan (run once after go-live, and after big changes)

Goal: prove that what the app shows matches what the database stores, that each role can only
do what it should, and that every change lands in the activity log with the right name.
Automated checks already cover the rules in an in-memory copy of the database
(`npm test`, `supabase/tests/db.test.ts`); this plan checks the **live** setup end to end.

Use a throwaway sales round so real data stays clean:
**Products → New sales round → "TEST – delete me"**, add one product (e.g. Navy, keywords `navy, blue`).
Audit entries for the test stay in the log by design (it is append-only).

People needed: Oliver (super admin) + one test Admin + one test Ops (real @mdi.ac.in accounts,
added on Team & roles). Devices: one Android phone (Chrome), one laptop.

## A. Sign-in and roles
| # | Do | Expect | DB check (SQL editor) |
|---|---|---|---|
| A1 | Sign in with an @mdi.ac.in account that is NOT on the team | Refused: "not on the MART team list" | `select count(*) from auth.users where email = '<that email>'` → 0 |
| A2 | Sign in with a personal Gmail | Refused | same → 0 |
| A3 | Open the link from WhatsApp | Yellow "Open in Chrome" note on the login page | — |
| A4 | Oliver adds test Admin + test Ops on Team & roles | They can sign in; their name shows | `select email, role, user_id is not null from members` |
| A5 | Ops: look for Team & roles / Import CSV | Not in the menu; typing `#/team` goes to Overview | — |
| A6 | Admin: try to make someone Super admin | Option not offered | — |
| A7 | Admin: look at Oliver's row | No Edit button | — |

## B. Import
| # | Do | Expect | DB check |
|---|---|---|---|
| B1 | Admin: import a small test CSV (3 responses, 5 shirts, 1 repeat) into the TEST round | Preview: 5 shirts, 1 possible duplicate held back | — |
| B2 | Import | "Imported 4 shirts" | `select count(*) from order_items i join campaigns c on c.id = i.campaign_id where c.name like 'TEST%'` → 4 |
| B3 | Import the same file again | 0 to import, 4 "already imported" | count still 4 |
| B4 | Ops opens `#/import` | Redirected | — |

## C. Receive stock → handover (an Ops day)
| # | Do (Android phone, as Ops) | Expect | DB check |
|---|---|---|---|
| C1 | Receive stock → Navy → "All M came" → Mark as arrived → Yes | Green "marked as arrived" line | `select status, count(*) from order_items group by 1` shows `received` |
| C2 | Handover desk → last 3 digits of a test roll → tap student → Hand over → "<name> is taking it" | Green "Done" line, search empty | `select type, handed_by from handovers order by handed_at desc limit 1` → `self`, Ops' user id |
| C3 | Same with "A friend is taking it" + name + roll | Done line names the friend | `collector_name`, `collector_roll` filled, roll upper-case |
| C4 | Open a student whose shirt hasn't arrived | No Hand over button ("not arrived yet") | — |
| C5 | Two phones open the same student, both tap Hand over | Second gets an error, no double handover | `select item_id, count(*) from handovers where undone_at is null group by 1 having count(*) > 1` → no rows |
| C6 | Admin: Undo a handover with a reason | Shirt back to In MART | `undone_at`, `undo_reason` set; item `received` |
| C7 | Ops: look for Undo | Not shown | — |

## D. Exports and lists
| # | Do | Expect |
|---|---|---|
| D1 | Ops: Export tab → Ready to collect → Copy roll numbers (2 taps after opening the app) | One roll per line; students whose shirts are all In MART |
| D2 | Copy emails → paste into Gmail Bcc | Comma-separated, no blanks |
| D3 | Download CSV on Android | Opens in Sheets; names and ₹ not garbled |
| D4 | Toggle "Also students with only some shirts ready" | List grows by the partly-ready students |
| D5 | Vendor print list → CSV / Print | Counts per colour × size match Inventory |

## E. Activity log (the main point of the tool)
| # | Do | Expect | DB check |
|---|---|---|---|
| E1 | Activity tab after A–D | Every receive, handover, friend handover, undo, import and role change, with the right person's name | `select actor_name, action, table_name, changed from audit_log order by id desc limit 30` |
| E2 | Open a shirt → History | Its full story in order | `select * from audit_log where item_id = '<id>' order by id` |
| E3 | SQL editor: `delete from audit_log` | Error "append-only" | — |

## F. Phones and network
| # | Do | Expect |
|---|---|---|
| F1 | Android Chrome, every tab | Nothing scrolls sideways; bottom bar visible; keyboard doesn't hide the Hand over button |
| F2 | Airplane mode, tap Hand over | Clear "No connection" message, nothing half-saved |
| F3 | Leave the tab 2 minutes, come back | Data refreshes (another person's handover shows up) |
| F4 | Light theme toggle | Readable |

## G. Clean-up
- Products → close the "TEST – delete me" round (an admin can delete its shirts).
- Super admin removes the test Admin / Ops on Team & roles.
- GitHub → Actions → "Keep Supabase awake" → Run workflow → green.

## Results — 2026-11-19 (first prod run)

**Database rules on the live project: 27 / 27 passed.** Run as one transaction that is always rolled back
(simulated Ops / Admin / non-member / anon users via JWT claims); afterwards 0 test rows remained.
Covered: sign-up gate, anon and non-member see nothing, Ops cannot delete items/products, change roles, add members,
edit anything but status, or write the log; no handover before arrival, no double handover, Ops cannot undo,
undo needs a reason, admin undo restores "In MART"; 6 audit rows per item with the right names; audit log append-only
(even for the owner); admin cannot create a super admin; product with orders cannot be deleted.

**App flows on the live site as Oliver (super admin), in round "TEST – delete me":** all passed and matched the database.
- Products: new round + product (B-equivalent).
- Add orders → One order by hand: TEST-001 (2 items), TEST-002 (1 item).
- Receive stock: ticked M and S only → "2 Grey items marked as arrived".
- Exports: Ready to collect = TEST-002 only; with the partly-ready toggle = both (TEST-001 "1 still with vendor"); Not arrived = TEST-001 L. (D1, D4)
- Handover desk: single item → no checkbox, one tap "<name> is taking it" (C2); friend handover saved roll in capitals (C3); search cleared after each.
- Undo as super admin: button disabled until a reason is typed; item back to In MART (C6).
- Activity: every step listed in plain words with Oliver's name and the undo reason (E1); DB cross-check matched.
- Round closed afterwards (data kept; audit log is append-only by design).

**Not yet run (needs people / devices):** A3 WhatsApp link, A4–A7 with real Admin/Ops accounts, C4/C5/C7 on two phones,
D2 Gmail Bcc paste, D3 CSV on Android, F1–F4 Android Chrome, B1–B3 with the real 2026 CSV.
Small finding: items added by hand show "(import)" in Activity because they go through the import function — cosmetic.
