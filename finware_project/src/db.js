const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.FINWARE_DB_PATH || path.join(__dirname, '..', 'data', 'finware.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Create tables if this is a fresh database.
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sqlite.sql'), 'utf8');
db.exec(schemaSql);

migrateAppUsers(db);

// Seed once, on first run.
const alreadySeeded = db.prepare('SELECT COUNT(*) AS c FROM dim_user').get().c > 0;
if (!alreadySeeded) {
  seed(db);
  console.log('Seeded the database with the sample DWM dataset.');
}

/**
 * Bring app_users up to the role-based shape without touching existing rows'
 * credentials. Older databases stored a free-text role (the seeded admin's
 * "Data Warehouse Administrator"); before this change the only way to get an
 * app_users row was that admin seed, so any non-standard role is an admin. The
 * old text is kept as the display title.
 */
function migrateAppUsers(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(app_users)').all().map((c) => c.name));
  if (!columns.has('title')) db.exec('ALTER TABLE app_users ADD COLUMN title TEXT');
  if (!columns.has('customer_id')) {
    db.exec('ALTER TABLE app_users ADD COLUMN customer_id TEXT REFERENCES dim_user(user_id) ON DELETE SET NULL');
  }
  if (!columns.has('created_at')) db.exec('ALTER TABLE app_users ADD COLUMN created_at TEXT');

  db.exec(`UPDATE app_users SET title = COALESCE(title, role), role = 'admin' WHERE role NOT IN ('admin', 'user')`);
  db.exec(`UPDATE app_users SET created_at = datetime('now') WHERE created_at IS NULL`);

  // Defence in depth: the database itself refuses any role outside the two
  // supported ones, whatever code path tries to write it.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS app_users_role_insert BEFORE INSERT ON app_users
    WHEN NEW.role NOT IN ('admin', 'user')
    BEGIN SELECT RAISE(ABORT, 'invalid role'); END;
    CREATE TRIGGER IF NOT EXISTS app_users_role_update BEFORE UPDATE OF role ON app_users
    WHEN NEW.role NOT IN ('admin', 'user')
    BEGIN SELECT RAISE(ABORT, 'invalid role'); END;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_customer ON app_users(customer_id) WHERE customer_id IS NOT NULL;
  `);
}

function seed(db) {
  const data = require('../database/seed-data.js');

  const insertAll = () => {
    db.exec('BEGIN');
    try {
      const cityById = new Map(data.cities.map((c) => [c.id, c.name]));
      const incomeById = new Map(data.incomeBrackets.map((i) => [i.id, i.label]));
      const accountTypeById = new Map(data.accountTypes.map((a) => [a.id, a.type]));
      const bankTypeById = new Map(data.bankTypes.map((b) => [b.id, b.type]));

      const insertCity = db.prepare('INSERT INTO dim_city (city_id, city_name) VALUES (?, ?)');
      data.cities.forEach((c) => insertCity.run(c.id, c.name));

      const insertIncome = db.prepare('INSERT INTO dim_income_bracket (income_id, bracket_label) VALUES (?, ?)');
      data.incomeBrackets.forEach((i) => insertIncome.run(i.id, i.label));

      const insertAccountType = db.prepare('INSERT INTO dim_account_type (account_type_id, account_type) VALUES (?, ?)');
      data.accountTypes.forEach((a) => insertAccountType.run(a.id, a.type));

      const insertBankType = db.prepare('INSERT INTO dim_bank_type (bank_type_id, bank_type) VALUES (?, ?)');
      data.bankTypes.forEach((b) => insertBankType.run(b.id, b.type));

      const insertUser = db.prepare(
        'INSERT INTO dim_user (user_id, user_name, city_id, income_id, account_type_id) VALUES (?, ?, ?, ?, ?)'
      );
      data.users.forEach((u) => insertUser.run(u.id, u.name, u.cityId, u.incomeId, u.accountTypeId));

      const insertBank = db.prepare('INSERT INTO dim_bank (bank_id, bank_name, bank_type_id) VALUES (?, ?, ?)');
      data.banks.forEach((b) => insertBank.run(b.id, b.name, b.typeId));

      const insertCategory = db.prepare(
        'INSERT INTO dim_category (category_id, category_name, category_group) VALUES (?, ?, ?)'
      );
      data.categories.forEach((c) => insertCategory.run(c.id, c.name, c.group));

      const insertDate = db.prepare(
        'INSERT INTO dim_date (date_id, full_date, weekday, month, quarter, year) VALUES (?, ?, ?, ?, ?, ?)'
      );
      data.dates.forEach((d) => insertDate.run(d.id, d.date, d.weekday, d.month, d.quarter, d.year));

      const insertCa = db.prepare('INSERT INTO dim_ca (ca_id, ca_name) VALUES (?, ?)');
      data.cas.forEach((c) => insertCa.run(c.id, c.name));

      const insertTxn = db.prepare(
        'INSERT INTO fact_transactions (txn_id, date_id, user_id, bank_id, category_id, amount, txn_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      data.transactions.forEach((t) => insertTxn.run(t.id, t.dateId, t.userId, t.bankId, t.categoryId, t.amount, t.type));

      const insertCaSession = db.prepare(
        'INSERT INTO fact_ca_sessions (session_id, date_id, user_id, ca_id, fee_amount, status) VALUES (?, ?, ?, ?, ?, ?)'
      );
      data.caSessions.forEach((s) => insertCaSession.run(s.id, s.dateId, s.userId, s.caId, s.fee, s.status));

      // Denormalized OLTP mirrors (Source Tables page / Section 2 of the proposal).
      const dateFullById = new Map(data.dates.map((d) => [d.id, d.date]));
      const insertTxnRaw = db.prepare(
        'INSERT INTO transaction_raw (txn_id, txn_date, user_id, bank_id, category_id, amount, txn_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      data.transactions.forEach((t) =>
        insertTxnRaw.run(t.id, dateFullById.get(t.dateId), t.userId, t.bankId, t.categoryId, t.amount, t.type)
      );

      const insertUserMaster = db.prepare(
        'INSERT INTO user_master (user_id, full_name, city, income_bracket, account_type) VALUES (?, ?, ?, ?, ?)'
      );
      data.users.forEach((u) =>
        insertUserMaster.run(u.id, u.name, cityById.get(u.cityId), incomeById.get(u.incomeId), accountTypeById.get(u.accountTypeId))
      );

      const insertBankMaster = db.prepare('INSERT INTO bank_master (bank_id, bank_name, bank_type) VALUES (?, ?, ?)');
      data.banks.forEach((b) => insertBankMaster.run(b.id, b.name, bankTypeById.get(b.typeId)));

      const passwordHash = bcrypt.hashSync(data.admin.password, 10);
      db.prepare('INSERT INTO app_users (email, password_hash, name, role, title) VALUES (?, ?, ?, ?, ?)').run(
        data.admin.email,
        passwordHash,
        data.admin.name,
        'admin',
        data.admin.role
      );

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  insertAll();
}

module.exports = db;
