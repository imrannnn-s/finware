// Upgrading a database created before roles existed must keep the existing
// admin login working and convert it to the 'admin' role.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

test('legacy app_users rows are migrated without losing credentials', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finware-migrate-'));
  const dbPath = path.join(tmpDir, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`CREATE TABLE app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL)`);
    legacy.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sqlite.sql'), 'utf8'));
    legacy.exec("INSERT INTO dim_city VALUES (1,'Mumbai'); INSERT INTO dim_income_bracket VALUES (1,'x'); INSERT INTO dim_account_type VALUES (1,'Savings')");
    legacy.exec("INSERT INTO dim_user VALUES ('U01','Rohan',1,1,1)");
    legacy.prepare('INSERT INTO app_users (email, password_hash, name, role) VALUES (?,?,?,?)')
      .run('admin@finware.com', bcrypt.hashSync('finware2026', 4), 'Admin', 'Data Warehouse Administrator');
    legacy.close();

    process.env.FINWARE_DB_PATH = dbPath;
    const db = require('../src/db');
    const row = db.prepare('SELECT * FROM app_users WHERE email = ?').get('admin@finware.com');
    assert.equal(row.role, 'admin');
    assert.equal(row.title, 'Data Warehouse Administrator');
    assert.equal(row.customer_id, null);
    assert.ok(bcrypt.compareSync('finware2026', row.password_hash));
    assert.throws(() => db.prepare("UPDATE app_users SET role = 'superadmin' WHERE id = ?").run(row.id), /invalid role/);
    assert.throws(() => db.prepare("INSERT INTO app_users (email, password_hash, name, role) VALUES ('a@b.c','x','A','root')").run(), /invalid role/);
    db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
