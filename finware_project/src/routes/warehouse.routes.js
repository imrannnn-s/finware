const express = require('express');
const { createAuth, ROLES } = require('../middleware/auth');

module.exports = function warehouseRoutes(db) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = createAuth(db);
  router.use(requireAuth);

  // Admins see the whole warehouse. A 'user' only ever sees the customer
  // record linked to their account (none until an admin links one); banks,
  // categories and dates are shared reference data.
  function customerScope(req) {
    if (req.user.role === ROLES.ADMIN) return { sql: '', params: [] };
    return { sql: 'WHERE {col} = ?', params: [req.user.customerId || '\u0000none'] };
  }

  // Everything the dashboard needs to render, shaped exactly as the UI expects it.
  router.get('/all', (req, res) => {
    const scope = customerScope(req);
    const where = (col) => scope.sql.replace('{col}', col);
    const users = db
      .prepare(
        `SELECT u.user_id AS id, u.user_name AS name, city.city_name AS city,
                income.bracket_label AS income, acct.account_type AS accountType
         FROM dim_user u
         JOIN dim_city city ON city.city_id = u.city_id
         JOIN dim_income_bracket income ON income.income_id = u.income_id
         JOIN dim_account_type acct ON acct.account_type_id = u.account_type_id
         ${where('u.user_id')}
         ORDER BY u.user_id`
      )
      .all(...scope.params);

    const banks = db
      .prepare(
        `SELECT b.bank_id AS id, b.bank_name AS name, bt.bank_type AS bankType
         FROM dim_bank b
         JOIN dim_bank_type bt ON bt.bank_type_id = b.bank_type_id
         ORDER BY b.bank_id`
      )
      .all();

    const categories = db
      .prepare('SELECT category_id AS id, category_name AS name, category_group AS "group" FROM dim_category ORDER BY category_id')
      .all();

    // Real Dim_Date rows straight off the table - no month/quarter/year is
    // derived or hardcoded anywhere in the app.
    const dimDate = db
      .prepare(
        `SELECT date_id AS dateId, full_date AS date, weekday, month, quarter, year
         FROM dim_date
         ORDER BY full_date, date_id`
      )
      .all();

    const transactions = db
      .prepare(
        `SELECT t.txn_id AS id, t.date_id AS dateId, d.full_date AS date, t.user_id AS userId, t.bank_id AS bankId,
                t.category_id AS categoryId, t.amount AS amount, t.txn_type AS type
         FROM fact_transactions t
         JOIN dim_date d ON d.date_id = t.date_id
         ${where('t.user_id')}
         ORDER BY d.full_date, t.txn_id`
      )
      .all(...scope.params);

    const caSessions = db
      .prepare(
        `SELECT s.session_id AS id, s.date_id AS dateId, d.full_date AS date, s.user_id AS userId,
                s.ca_id AS caId, c.ca_name AS caName, s.fee_amount AS fee, s.status AS status
         FROM fact_ca_sessions s
         JOIN dim_date d ON d.date_id = s.date_id
         JOIN dim_ca c ON c.ca_id = s.ca_id
         ${where('s.user_id')}
         ORDER BY d.full_date, s.session_id`
      )
      .all(...scope.params);

    res.json({ users, banks, categories, transactions, caSessions, dimDate });
  });

  // Raw OLTP mirrors. Internal warehouse detail - kept as a queryable endpoint
  // for the DWM layer even though the UI no longer exposes a source-table page.
  // Table names come from a fixed allowlist, never from the request directly.
  router.get('/source/:table', requireAdmin, (req, res) => {
    const table = { 'transaction-raw': 'transaction_raw', 'user-master': 'user_master', 'bank-master': 'bank_master' }[
      req.params.table
    ];
    if (!table) return res.status(404).json({ error: 'Unknown source table.' });
    res.json(db.prepare(`SELECT * FROM ${table}`).all());
  });

  return router;
};
