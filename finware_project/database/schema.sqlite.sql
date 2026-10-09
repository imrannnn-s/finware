-- =====================================================================
-- FinWare — SQLite schema
-- This is the schema the running app actually uses. It already reflects
-- the "snowflaked" shape (dim_user/dim_bank normalized further) and the
-- "galaxy" shape (two fact tables sharing dim_user + dim_date). The
-- Star/Snowflake/Galaxy pages in the UI, and the queries in
-- src/routes/analytics.routes.js, show how the same tables answer each
-- kind of question. See database/dwm-schema-reference.sql for the three
-- schemas written out separately (Postgres-flavoured) for a lab report.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------- OLTP source tables (pre-ETL, denormalized) ----------
CREATE TABLE IF NOT EXISTS transaction_raw (
  txn_id      TEXT PRIMARY KEY,
  txn_date    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  bank_id     TEXT NOT NULL,
  category_id TEXT NOT NULL,
  amount      REAL NOT NULL,
  txn_type    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_master (
  user_id        TEXT PRIMARY KEY,
  full_name      TEXT NOT NULL,
  city           TEXT NOT NULL,
  income_bracket TEXT NOT NULL,
  account_type   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_master (
  bank_id   TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  bank_type TEXT NOT NULL
);

-- ---------- Snowflake sub-dimensions ----------
CREATE TABLE IF NOT EXISTS dim_city (
  city_id   INTEGER PRIMARY KEY,
  city_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_income_bracket (
  income_id     INTEGER PRIMARY KEY,
  bracket_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_account_type (
  account_type_id INTEGER PRIMARY KEY,
  account_type    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_bank_type (
  bank_type_id INTEGER PRIMARY KEY,
  bank_type    TEXT NOT NULL
);

-- ---------- Conformed dimensions ----------
CREATE TABLE IF NOT EXISTS dim_user (
  user_id         TEXT PRIMARY KEY,
  user_name       TEXT NOT NULL,
  city_id         INTEGER NOT NULL REFERENCES dim_city(city_id),
  income_id       INTEGER NOT NULL REFERENCES dim_income_bracket(income_id),
  account_type_id INTEGER NOT NULL REFERENCES dim_account_type(account_type_id)
);

CREATE TABLE IF NOT EXISTS dim_bank (
  bank_id      TEXT PRIMARY KEY,
  bank_name    TEXT NOT NULL,
  bank_type_id INTEGER NOT NULL REFERENCES dim_bank_type(bank_type_id)
);

CREATE TABLE IF NOT EXISTS dim_category (
  category_id    TEXT PRIMARY KEY,
  category_name  TEXT NOT NULL,
  category_group TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_date (
  date_id   TEXT PRIMARY KEY,
  full_date TEXT NOT NULL,
  weekday   TEXT NOT NULL,
  month     TEXT NOT NULL,
  quarter   TEXT NOT NULL,
  year      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_ca (
  ca_id   TEXT PRIMARY KEY,
  ca_name TEXT NOT NULL
);

-- ---------- Fact tables (galaxy: share dim_user + dim_date) ----------
CREATE TABLE IF NOT EXISTS fact_transactions (
  txn_id      TEXT PRIMARY KEY,
  date_id     TEXT NOT NULL REFERENCES dim_date(date_id),
  user_id     TEXT NOT NULL REFERENCES dim_user(user_id),
  bank_id     TEXT NOT NULL REFERENCES dim_bank(bank_id),
  category_id TEXT NOT NULL REFERENCES dim_category(category_id),
  amount      REAL NOT NULL,
  txn_type    TEXT NOT NULL CHECK (txn_type IN ('DEBIT','CREDIT'))
);

CREATE TABLE IF NOT EXISTS fact_ca_sessions (
  session_id  TEXT PRIMARY KEY,
  date_id     TEXT NOT NULL REFERENCES dim_date(date_id),
  user_id     TEXT NOT NULL REFERENCES dim_user(user_id),
  ca_id       TEXT NOT NULL REFERENCES dim_ca(ca_id),
  fee_amount  REAL NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('Completed','Scheduled','Cancelled'))
);

-- ---------- App auth (separate from the warehouse itself) ----------
-- role is 'admin' or 'user' (enforced by triggers created in src/db.js, which
-- also migrates older databases). customer_id links a 'user' login to the
-- warehouse customer whose records it may see; only an admin can set it.
CREATE TABLE IF NOT EXISTS app_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','user')),
  title         TEXT,
  customer_id   TEXT REFERENCES dim_user(user_id) ON DELETE SET NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fact_txn_date ON fact_transactions(date_id);
CREATE INDEX IF NOT EXISTS idx_fact_txn_user ON fact_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_fact_ca_date ON fact_ca_sessions(date_id);
CREATE INDEX IF NOT EXISTS idx_fact_ca_user ON fact_ca_sessions(user_id);
