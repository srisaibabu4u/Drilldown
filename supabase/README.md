# Supabase setup (team features)

Team features — ward / mandal leads, booth leads, scheme-help requests and the
coverage map — need a database. Everything else works without one.

The site's **server functions** are the only thing that talks to the database.
Row-level security is switched on for every table with no policies, so Supabase's
public API keys can read nothing. Role rules ("a booth lead sees only their
booths") are enforced on every query in `netlify/functions`.

## Easiest: one-time setup page (no copying SQL)

1. Supabase → **Project Settings → Database → Connection string → Transaction
   pooler** (port 6543). Copy it and put your database password in it.
2. Netlify → **Site configuration → Environment variables** → add:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Transaction pooler connection string (mark as secret) |
   | `SETUP_KEY` | any phrase you choose, 12+ characters (mark as secret) |

   Keep `SESSION_SECRET` as it is. Then **Deploys → Trigger deploy → Deploy site**.
3. Open **`https://<your-site>/setup.html`**, type the same `SETUP_KEY`, tap
   **Set up database**. It creates the tables and loads the demo team and requests.
4. **Delete `SETUP_KEY`** in Netlify (and redeploy) to switch the setup page off.

The setup page runs only the SQL bundled with the site (`netlify/lib/setup-sql.generated.ts`,
built from the files below by `npm run db:seed`). It refuses to overwrite existing
users unless you tick "Replace existing users and requests".

If setup reports a connection problem through the Transaction pooler, try the
**Session pooler** connection string (port 5432) as `DATABASE_URL` instead.

Once `DATABASE_URL` is set, logins come from the database (`app_users`), so the old
`AUTH_USERS` admin no longer signs in — use the demo accounts below. Remove
`DATABASE_URL` to go back to the single `AUTH_USERS` login.

## Manual alternative (SQL Editor)

1. Supabase → **SQL Editor** → paste `supabase/migrations/001_roles_and_help_requests.sql` → **Run**.
2. Paste `supabase/seed.sql` → **Run** (large, ~0.5 MB), or from a computer:
   `psql "<Session pooler connection string>" -f supabase/seed.sql`
3. Set `DATABASE_URL` in Netlify as above and redeploy.

The seed **replaces** all users, assignments and requests with synthetic demo data:
1 admin, 15 ward / mandal leads, 198 booth leads (572 of 712 booths covered, the
rest left empty on purpose), and 300 help requests with history.
To make a new seed (e.g. a new demo password): `npm run db:seed`. It prints the new
password once; only password hashes go into the SQL.

## Demo logins

All demo accounts share the password printed by `make-seed.ts`.

| Role | Username pattern | Example |
|---|---|---|
| Admin | `admin` | `admin` |
| Ward / mandal lead | `lead.<ward or mandal>` | `lead.moosapet`, `lead.kphb-colony`, `lead.ghattu` |
| Booth lead | `bl.<ward or mandal>.<nn>` | `bl.moosapet.01`, `bl.dharur.03` |

## What each role can do

| | Admin | Ward / mandal lead | Booth lead |
|---|---|---|---|
| See help requests | all | their ward / mandal | their booths |
| Add a request (from a voter's card, consent required) | any booth | their ward / mandal | their booths |
| Change status / add notes | all | their area | their booths |
| Reassign a request | ✓ | to leads in their area | — |
| Team & coverage | everyone | their area, booth leads' phones | their booths, their lead's phone |

No amounts or budgets are recorded, and nothing about caste or voting is stored
with a request. Every change is kept in `request_events`.
