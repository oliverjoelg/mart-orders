# Setup (one time, George)

These steps need account access, so the code does not do them. Do them in this order.

## 1. Apply the database migrations

Either with the Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref qwhsaijzpyildsuascfu
npx supabase db push
```

or paste each file in `supabase/migrations/` into **SQL Editor** in filename order and run it.

Then add yourself as the first main admin (SQL Editor; edit the email and name first):

```sql
insert into public.members (email, display_name, role)
values ('your.name@mdi.ac.in', 'Your Name', 'main_admin');
```

Everyone else is added from the **Team** page in the app. Only `@mdi.ac.in` emails can be added.

> The sign-up check is a trigger on `auth.users` (`enforce_member_signup`). If Supabase ever
> refuses triggers on the auth schema, use **Authentication → Hooks → Before User Created**
> instead. [unsourced: depends on Supabase policy at the time]

## 2. Google sign-in

Guide: https://supabase.com/docs/guides/auth/social-login/auth-google

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → Web application.
   - Authorized JavaScript origins: `https://oliverjoelg.github.io`, `http://localhost:5173`
   - Authorized redirect URI: `https://qwhsaijzpyildsuascfu.supabase.co/auth/v1/callback`
   - OAuth consent screen: "Internal" if the project is in the mdi.ac.in Google Workspace
     (only MDI accounts can then sign in at all), otherwise "External".
2. Supabase → Authentication → Sign In / Providers → **Google**: enable, paste client ID and secret.
3. Supabase → Authentication → URL Configuration:
   - Site URL: `https://oliverjoelg.github.io/mart-orders/`
   - Redirect URLs: `https://oliverjoelg.github.io/mart-orders/` and `http://localhost:5173/`

Anyone not on the Team list is refused at sign-up by the database, and sees nothing even if
they already have an account.

## 3. GitHub Pages

GitHub Pages on a **private** repo needs a paid GitHub plan (Pro / Team); on GitHub Free it
works only for public repos. Source: https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
Options: upgrade, or make the repo public (the code has no secrets and no student data; the
publishable key is meant to be public and row-level security protects the data).

Then:
1. Repo → Settings → Pages → Source: **GitHub Actions**.
2. Repo → Settings → Secrets and variables → Actions → **Variables** tab → add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (values from `.env.example`).
3. Push to `master` (or run "Deploy to GitHub Pages" by hand). The site appears at
   https://oliverjoelg.github.io/mart-orders/

## 4. Keep-awake

`.github/workflows/keepalive.yml` calls the database's `ping()` every Monday, using the same
two variables. Nothing else to do once step 3 is done. Run it once by hand to check it.

## 5. First import

Sign in → **Import CSV** → in Google Sheets use File → Download → Comma-separated values →
drop the file in. Check the "Needs a look" rows, then Import.
For the 2026 batch file the importer finds **1,008 shirts** in 647 responses. The form's
"Total" column adds to 1,011; the 3 extra are typos in three responses (amount paid matches
the shirts found), which the preview lists.
