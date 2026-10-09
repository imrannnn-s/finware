# FinWare — Banking & Fintech Data Warehouse Analytics Platform

A full-stack implementation of the FinWare proposal for the **Data Warehousing and
Mining (DWM) Lab**: a real Express + SQLite backend serving the Star / Snowflake /
Galaxy schema data, and the FinWare dashboard as a proper client of that API
(JWT login, live data fetch, real file downloads for reports).

This is the same 16-page prototype from the proposal, now backed by an actual
database instead of hardcoded sample arrays.

## What's inside

```
finware/
├── server.js                    Express entry point (serves the API + the frontend)
├── src/
│   ├── db.js                    Opens/creates data/finware.sqlite, seeds it on first run
│   ├── middleware/auth.js       JWT verification, DB-backed sessions, requireRole/requireAdmin
│   ├── admin-content/           Admin-only content (ML model details), served via /api/admin/model-info
│   └── routes/
│       ├── auth.routes.js       POST /api/auth/login|register, GET/PATCH /api/auth/me
│       ├── admin.routes.js      Admin-only: /api/admin/users, /api/admin/model-info
│       ├── warehouse.routes.js  GET /api/warehouse/all, /api/warehouse/source/:table
│       └── analytics.routes.js  Real SQL demonstrating Star / Snowflake / Galaxy queries
├── database/
│   ├── schema.sqlite.sql        DDL the app actually runs on first start
│   ├── seed-data.js             The 5-user / 5-bank / 5-category / 5-transaction / 5-session dataset
│   └── dwm-schema-reference.sql Star / Snowflake / Galaxy written out separately, for the lab report
└── public/                      Static frontend (plain HTML/CSS/JS + Chart.js)
    ├── index.html
    ├── css/styles.css
    └── js/app.js
```

## Requirements

- Node.js 22.13 or later (uses the built-in `node:sqlite` module)
- No separate database server needed — it uses SQLite via `better-sqlite3`
  (a single file at `data/finware.sqlite`, created automatically).

## Running it in VS Code

1. Open this folder in VS Code.
2. Open a terminal (`` Ctrl+` ``) and install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
   (or `npm run dev` to auto-restart on file changes)
4. Open **http://localhost:4000/admin** to sign in as an administrator with the
   seeded demo account:
   - **Email:** `admin@finware.com`
   - **Password:** `finware2026`
5. Open **http://localhost:4000/** for the customer (user) sign-in and
   self-service registration.

Run the automated tests with `npm test` (uses a throwaway database).

The first time you start the server it creates `data/finware.sqlite` and seeds
it with the sample dataset. Delete that file (or the whole `data/` folder) and
restart the server to reseed from scratch.

Optional: copy `.env.example` to `.env` if you want to change the port or set
your own `JWT_SECRET` (recommended if you ever deploy this anywhere beyond
your own machine).

## How the frontend and backend fit together

- `public/` is served as static files by the same Express server that exposes
  `/api/*`, so everything runs on one port with no CORS configuration needed
  (CORS is enabled anyway, in case you serve the frontend separately e.g. via
  VS Code's Live Server).
- On login, `public/js/app.js` calls `POST /api/auth/login`, stores the
  returned JWT in `localStorage`, then calls `GET /api/warehouse/all` to
  hydrate the dashboard. All the page rendering, filtering, charts and the
  Star/Snowflake/Galaxy diagrams run entirely client-side against that data.
- The "Export CSV" and "Reports" buttons build a CSV in the browser and
  trigger a normal file download — no server round-trip needed for those.

## The Star / Snowflake / Galaxy schemas

`database/schema.sqlite.sql` is what the running app actually uses — it's
already the Snowflake + Galaxy shape (Dim_User/Dim_Bank normalized into
Dim_City/Dim_IncomeBracket/Dim_AccountType/Dim_BankType, and
Fact_Transactions + Fact_CA_Sessions sharing Dim_User + Dim_Date).

`database/dwm-schema-reference.sql` writes the three schemas out **separately**
(Postgres-flavoured DDL, with example queries) exactly as the proposal
describes them — this is what you'd paste into the lab report.

To see the three query patterns actually run against the database, hit these
endpoints with the JWT from login (e.g. with `curl` or Postman):

```
GET /api/analytics/star/category-summary      -- fact joined straight to one dimension
GET /api/analytics/star/bank-summary
GET /api/analytics/snowflake/user-profile      -- walks the extra normalization hops
GET /api/analytics/snowflake/bank-profile
GET /api/analytics/galaxy/cross-process        -- two facts via the conformed dimensions
GET /api/analytics/dashboard-summary
```

Example:
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@finware.com","password":"finware2026"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl http://localhost:4000/api/analytics/galaxy/cross-process \
  -H "Authorization: Bearer $TOKEN"
```

## Roles and access control

There are two roles, stored in `app_users.role` and enforced by the database
(`CHECK`/triggers allow only `admin` or `user`):

| | Admin (`/admin`) | User (`/`) |
|---|---|---|
| Sign-in | Admin portal only | User portal only; self-registration |
| Data | All warehouse records, analytics, portfolio insights | Only the warehouse customer linked to the account (`app_users.customer_id`) |
| Admin features | Dashboard, analytics, reports, user management, ML model details | None (403 from the API, "Access denied" in the UI) |

- **Role is decided by the server.** Registration always creates a `user`;
  any `role`/`customerId` in the request is ignored. The JWT only carries the
  account id — every protected request reloads the account from the database,
  so role changes, customer re-links and deleted accounts take effect
  immediately.
- **Linking users to data.** A newly registered user sees no records until an
  admin links the account to a warehouse customer on **User Management**
  (one account per customer). Users can't pick their own customer, so nobody
  can claim someone else's data.
- **Object-level checks.** `/api/insights/customer/:id/*` and
  `/api/insights/transaction/:id/risk` return 403 for records outside the
  user's linked customer. User responses omit scoring internals (baselines,
  bands), and ML model details are only served by the admin-only
  `/api/admin/model-info` endpoint — they are no longer in `public/`.
- **Upgrading an existing database.** On start-up `src/db.js` adds the new
  columns and converts the old free-text role (e.g. "Data Warehouse
  Administrator") to `admin`, keeping the text as `title`. Existing
  credentials keep working; no new default accounts are created.
- Admins can't demote or delete themselves if that would leave no admin.

## Known limitations (by design, for an honest lab demo)

- The sample dataset is intentionally the same 5 rows per table from the
  practical, so month-over-month/seasonal trend views only show one week of
  data — the Time Analysis page says so directly rather than faking history.
- The admin account is seeded once at first run with the demo password
  above — change it (or remove the seed) before deploying anywhere real.
- Tokens are stored in `localStorage` and expire after 8 hours; "log out"
  discards the token client-side (there is no server-side token revocation
  list, but deleting or changing an account takes effect immediately).
- There is no login rate limiting yet.
- `JWT_SECRET` defaults to a placeholder in dev — set a real one in `.env`
  before putting this anywhere other than your own machine.

## Extending it

- **Swap SQLite for Postgres/MySQL:** `database/schema.sqlite.sql` maps
  directly onto `database/dwm-schema-reference.sql`'s tables; swap
  `better-sqlite3` for `pg`/`mysql2` in `src/db.js` and adjust the few
  SQLite-specific bits (`AUTOINCREMENT`, `PRAGMA`).
- **More sample data:** add rows to `database/seed-data.js`, delete
  `data/finware.sqlite`, and restart — everything downstream (charts, tables,
  reports) recomputes automatically.
- **Real password reset / user management:** the Login page's "Forgot
  password?" link is a placeholder — there's no email flow behind it yet.
