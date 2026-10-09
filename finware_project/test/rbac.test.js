// Role-based access control tests. Run with: npm test
// Uses a throwaway SQLite file so the real data/finware.sqlite is never touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finware-test-'));
process.env.FINWARE_DB_PATH = path.join(tmpDir, 'test.sqlite');
process.env.JWT_SECRET = 'test-secret-' + 'x'.repeat(40);

const app = require('../server');

const ADMIN = { email: 'admin@finware.com', password: 'finware2026' };
const MODEL_TERMS = /random forest|isolation forest|classifier|n_estimators|hyperparameter|roc-auc|f1-score|baselineSource|deviationFromAverage/i;

let server;
let base;

async function api(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json, text };
}

async function login(email, password, portal) {
  return api('POST', '/api/auth/login', { body: { email, password, portal } });
}

async function register(name, email, password, extra = {}) {
  return api('POST', '/api/auth/register', { body: { name, email, password, ...extra } });
}

let adminToken;
let alice; // { token, id }
let bob;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = 'http://127.0.0.1:' + server.address().port;

  const a = await login(ADMIN.email, ADMIN.password, 'admin');
  assert.equal(a.status, 200);
  adminToken = a.json.token;

  const r1 = await register('Alice Example', 'alice@example.com', 'alicepass123', { role: 'admin', customerId: 'U02' });
  const r2 = await register('Bob Example', 'bob@example.com', 'bobpass1234');
  alice = { token: r1.json.token, id: r1.json.user.id };
  bob = { token: r2.json.token, id: r2.json.user.id };
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('existing admin keeps working and is identified as admin', async () => {
  const me = await api('GET', '/api/auth/me', { token: adminToken });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.role, 'admin');
  assert.equal(me.json.user.title, 'Data Warehouse Administrator');
});

test('admin can reach every admin feature', async () => {
  for (const url of [
    '/api/analytics/star/category-summary', '/api/analytics/star/bank-summary', '/api/analytics/star/date-trend',
    '/api/analytics/snowflake/user-profile', '/api/analytics/snowflake/bank-profile',
    '/api/analytics/galaxy/cross-process', '/api/analytics/dashboard-summary',
    '/api/warehouse/source/transaction-raw', '/api/insights/summary', '/api/insights/customers',
    '/api/insights/anomalies', '/api/insights/customer/U01', '/api/admin/users', '/api/admin/model-info'
  ]) {
    const r = await api('GET', url, { token: adminToken });
    assert.equal(r.status, 200, url);
  }
  const all = await api('GET', '/api/warehouse/all', { token: adminToken });
  assert.equal(all.json.users.length, 5);
  assert.equal(all.json.transactions.length, 100);
  const model = await api('GET', '/api/admin/model-info', { token: adminToken });
  assert.match(model.text, /Random Forest/);
});

test('registration always creates a user, ignoring role/customer in the body', async () => {
  const me = await api('GET', '/api/auth/me', { token: alice.token });
  assert.equal(me.json.user.role, 'user');
  assert.equal(me.json.user.customerId, null);
});

test('registration validates input and rejects duplicate emails', async () => {
  assert.equal((await register('X', 'not-an-email', 'longenough1')).status, 400);
  assert.equal((await register('X', 'x@example.com', 'short')).status, 400);
  assert.equal((await register('', 'y@example.com', 'longenough1')).status, 400);
  assert.equal((await register('Dup', 'ALICE@example.com', 'longenough1')).status, 409);
});

test('separate portals: users cannot use the admin login and vice versa', async () => {
  assert.equal((await login('alice@example.com', 'alicepass123', 'admin')).status, 403);
  const u = await login('alice@example.com', 'alicepass123', 'user');
  assert.equal(u.status, 200);
  assert.equal(u.json.user.role, 'user');
  assert.equal((await login(ADMIN.email, ADMIN.password, 'user')).status, 403);
  assert.equal((await login('alice@example.com', 'wrong-password', 'user')).status, 401);
});

test('user cannot call admin-only APIs directly', async () => {
  for (const url of [
    '/api/analytics/star/category-summary', '/api/analytics/galaxy/cross-process', '/api/analytics/dashboard-summary',
    '/api/warehouse/source/user-master', '/api/insights/summary', '/api/insights/customers',
    '/api/admin/users', '/api/admin/model-info'
  ]) {
    const r = await api('GET', url, { token: alice.token });
    assert.equal(r.status, 403, url);
  }
  assert.equal((await api('PATCH', `/api/admin/users/${alice.id}`, { token: alice.token, body: { role: 'admin' } })).status, 403);
  assert.equal((await api('DELETE', `/api/admin/users/${bob.id}`, { token: alice.token })).status, 403);
});

test('user cannot escalate their own role', async () => {
  const r = await api('PATCH', '/api/auth/me', { token: alice.token, body: { name: 'Alice', role: 'admin', customerId: 'U01', email: 'x@y.z' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'user');
  assert.equal(r.json.user.customerId, null);
  assert.equal(r.json.user.email, 'alice@example.com');
  assert.equal(r.json.user.name, 'Alice');
  const me = await api('GET', '/api/auth/me', { token: alice.token });
  assert.equal(me.json.user.role, 'user');
});

test('unlinked user sees no customer records', async () => {
  const all = await api('GET', '/api/warehouse/all', { token: bob.token });
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.users, []);
  assert.deepEqual(all.json.transactions, []);
  assert.deepEqual(all.json.caSessions, []);
  assert.equal((await api('GET', '/api/insights/anomalies', { token: bob.token })).status, 403);
});

test('admin links a user to a customer; user then sees only their own records', async () => {
  const link = await api('PATCH', `/api/admin/users/${alice.id}`, { token: adminToken, body: { customerId: 'U01' } });
  assert.equal(link.status, 200);
  assert.equal(link.json.user.customerId, 'U01');
  // one customer per account
  assert.equal((await api('PATCH', `/api/admin/users/${bob.id}`, { token: adminToken, body: { customerId: 'U01' } })).status, 409);

  const all = await api('GET', '/api/warehouse/all', { token: alice.token });
  assert.deepEqual(all.json.users.map((u) => u.id), ['U01']);
  assert.ok(all.json.transactions.length > 0);
  assert.ok(all.json.transactions.every((t) => t.userId === 'U01'));
  assert.ok(all.json.caSessions.every((s) => s.userId === 'U01'));

  for (const url of ['/api/insights/customer/U01', '/api/insights/customer/U01/spending', '/api/insights/customer/U01/recommendations']) {
    assert.equal((await api('GET', url, { token: alice.token })).status, 200, url);
  }
  const anomalies = await api('GET', '/api/insights/anomalies', { token: alice.token });
  assert.equal(anomalies.status, 200);
  assert.ok(anomalies.json.transactions.every((t) => t.userId === 'U01'));
  assert.equal(anomalies.json.counts.totalTransactions, all.json.transactions.length);
});

test("user cannot access another customer's records (IDOR)", async () => {
  for (const url of [
    '/api/insights/customer/U02', '/api/insights/customer/U02/spending',
    '/api/insights/customer/U02/recommendations', '/api/insights/anomalies?user=U02'
  ]) {
    assert.equal((await api('GET', url, { token: alice.token })).status, 403, url);
  }
  const adminAll = await api('GET', '/api/warehouse/all', { token: adminToken });
  const foreignTxn = adminAll.json.transactions.find((t) => t.userId !== 'U01');
  const ownTxn = adminAll.json.transactions.find((t) => t.userId === 'U01');
  assert.equal((await api('GET', `/api/insights/transaction/${foreignTxn.id}/risk`, { token: alice.token })).status, 403);
  assert.equal((await api('GET', `/api/insights/transaction/${ownTxn.id}/risk`, { token: alice.token })).status, 200);
});

test('user-facing responses and pages do not disclose ML model information', async () => {
  const adminAll = await api('GET', '/api/warehouse/all', { token: adminToken });
  const ownTxn = adminAll.json.transactions.find((t) => t.userId === 'U01');
  for (const url of [
    '/api/auth/me', '/api/warehouse/all', '/api/insights/customer/U01', '/api/insights/customer/U01/spending',
    '/api/insights/customer/U01/recommendations', '/api/insights/anomalies', `/api/insights/transaction/${ownTxn.id}/risk`
  ]) {
    const r = await api('GET', url, { token: alice.token });
    assert.equal(r.status, 200, url);
    assert.doesNotMatch(r.text, MODEL_TERMS, url);
  }
  // The public SPA files carry no model details either.
  for (const url of ['/', '/index.html', '/admin', '/js/app.js']) {
    const r = await api('GET', url);
    assert.equal(r.status, 200, url);
    assert.doesNotMatch(r.text, /random forest|isolation forest|n_estimators/i, url);
  }
});

test('logout / invalid sessions / unauthenticated requests are rejected', async () => {
  assert.equal((await api('GET', '/api/warehouse/all')).status, 401);
  assert.equal((await api('GET', '/api/warehouse/all', { token: 'garbage' })).status, 401);
  assert.equal((await api('GET', '/api/admin/users')).status, 401);
  assert.equal((await api('GET', '/api/admin/model-info')).status, 401);
  assert.equal((await api('GET', '/api/nope', { token: adminToken })).status, 404);

  // Deleting an account revokes its existing token immediately.
  const tmp = await register('Temp', 'temp@example.com', 'temppass123');
  assert.equal((await api('GET', '/api/auth/me', { token: tmp.json.token })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/users/${tmp.json.user.id}`, { token: adminToken })).status, 204);
  assert.equal((await api('GET', '/api/auth/me', { token: tmp.json.token })).status, 401);
});

test('role changes take effect immediately and admins cannot lock themselves out', async () => {
  const me = await api('GET', '/api/auth/me', { token: adminToken });
  assert.equal((await api('PATCH', `/api/admin/users/${me.json.user.id}`, { token: adminToken, body: { role: 'user' } })).status, 400);
  assert.equal((await api('DELETE', `/api/admin/users/${me.json.user.id}`, { token: adminToken })).status, 400);
  assert.equal((await api('PATCH', `/api/admin/users/${bob.id}`, { token: adminToken, body: { role: 'superuser' } })).status, 400);

  assert.equal((await api('PATCH', `/api/admin/users/${bob.id}`, { token: adminToken, body: { role: 'admin' } })).status, 200);
  assert.equal((await api('GET', '/api/admin/users', { token: bob.token })).status, 200);
  assert.equal((await api('PATCH', `/api/admin/users/${bob.id}`, { token: adminToken, body: { role: 'user' } })).status, 200);
  assert.equal((await api('GET', '/api/admin/users', { token: bob.token })).status, 403);
});

test('profile password change requires the current password', async () => {
  assert.equal((await api('PATCH', '/api/auth/me', { token: bob.token, body: { currentPassword: 'wrong', newPassword: 'newpass1234' } })).status, 400);
  assert.equal((await api('PATCH', '/api/auth/me', { token: bob.token, body: { currentPassword: 'bobpass1234', newPassword: 'newpass1234' } })).status, 200);
  assert.equal((await login('bob@example.com', 'newpass1234', 'user')).status, 200);
});

test('admin user list never exposes password hashes', async () => {
  const r = await api('GET', '/api/admin/users', { token: adminToken });
  assert.doesNotMatch(r.text, /password|\$2[aby]\$/i);
});
