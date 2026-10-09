const express = require('express');
const { createAuth } = require('../middleware/auth');

// These endpoints aren't used by the dashboard UI (which hydrates once from
// /api/warehouse/all and filters client-side for snappy interaction). They're
// here to demonstrate, with real SQL against the warehouse tables, the three
// query patterns the DWM lab is about. Try them directly, e.g.:
//   curl http://localhost:4000/api/analytics/star/category-summary \
//        -H "Authorization: Bearer <token>"

module.exports = function analyticsRoutes(db) {
  const router = express.Router();
  // Portfolio-wide analytics: administrators only.
  const { requireAuth, requireAdmin } = createAuth(db);
  router.use(requireAuth, requireAdmin);

  // ---- STAR: fact joined straight to a denormalized-style dimension ----
  router.get('/star/category-summary', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT cat.category_name AS category, cat.category_group AS categoryGroup,
                  SUM(t.amount) AS totalValue, COUNT(*) AS txnCount
           FROM fact_transactions t
           JOIN dim_category cat ON cat.category_id = t.category_id
           GROUP BY cat.category_id
           ORDER BY totalValue DESC`
        )
        .all()
    );
  });

  router.get('/star/bank-summary', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT bank.bank_name AS bank, SUM(t.amount) AS totalValue, COUNT(*) AS txnCount
           FROM fact_transactions t
           JOIN dim_bank bank ON bank.bank_id = t.bank_id
           GROUP BY bank.bank_id
           ORDER BY totalValue DESC`
        )
        .all()
    );
  });

  // ---- STAR: daily trend across the real span of dim_date ----
  router.get('/star/date-trend', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.full_date AS date,
                  COALESCE(SUM(t.amount), 0) AS totalValue,
                  COALESCE(SUM(CASE WHEN t.txn_type = 'DEBIT' THEN t.amount ELSE 0 END), 0) AS debit,
                  COALESCE(SUM(CASE WHEN t.txn_type = 'CREDIT' THEN t.amount ELSE 0 END), 0) AS credit,
                  COUNT(t.txn_id) AS txnCount
           FROM dim_date d
           LEFT JOIN fact_transactions t ON t.date_id = d.date_id
           GROUP BY d.date_id
           HAVING txnCount > 0
           ORDER BY d.full_date`
        )
        .all()
    );
  });

  // ---- SNOWFLAKE: walks the extra normalization hops on Dim_User ----
  router.get('/snowflake/user-profile', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.user_id AS userId, u.user_name AS userName, city.city_name AS city,
                  income.bracket_label AS incomeBracket, acct.account_type AS accountType,
                  COALESCE(SUM(t.amount), 0) AS totalSpend
           FROM dim_user u
           JOIN dim_city city ON city.city_id = u.city_id
           JOIN dim_income_bracket income ON income.income_id = u.income_id
           JOIN dim_account_type acct ON acct.account_type_id = u.account_type_id
           LEFT JOIN fact_transactions t ON t.user_id = u.user_id
           GROUP BY u.user_id
           ORDER BY u.user_id`
        )
        .all()
    );
  });

  router.get('/snowflake/bank-profile', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT bank.bank_id AS bankId, bank.bank_name AS bankName, bt.bank_type AS bankType,
                  COALESCE(SUM(t.amount), 0) AS totalValue
           FROM dim_bank bank
           JOIN dim_bank_type bt ON bt.bank_type_id = bank.bank_type_id
           LEFT JOIN fact_transactions t ON t.bank_id = bank.bank_id
           GROUP BY bank.bank_id
           ORDER BY bank.bank_id`
        )
        .all()
    );
  });

  // ---- GALAXY: two fact tables joined only through conformed dimensions ----
  router.get('/galaxy/cross-process', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.user_id AS userId, u.user_name AS userName, d.full_date AS date,
                  COALESCE(t.txn_total, 0) AS transactionValue, COALESCE(c.ca_total, 0) AS caFees
           FROM dim_user u
           CROSS JOIN dim_date d
           LEFT JOIN (
             SELECT user_id, date_id, SUM(amount) AS txn_total
             FROM fact_transactions GROUP BY user_id, date_id
           ) t ON t.user_id = u.user_id AND t.date_id = d.date_id
           LEFT JOIN (
             SELECT user_id, date_id, SUM(fee_amount) AS ca_total
             FROM fact_ca_sessions GROUP BY user_id, date_id
           ) c ON c.user_id = u.user_id AND c.date_id = d.date_id
           WHERE t.txn_total IS NOT NULL OR c.ca_total IS NOT NULL
           ORDER BY d.full_date, u.user_id`
        )
        .all()
    );
  });

  router.get('/dashboard-summary', (req, res) => {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS txnCount, COALESCE(SUM(amount), 0) AS totalValue,
                COALESCE(SUM(CASE WHEN txn_type = 'DEBIT' THEN amount ELSE 0 END), 0) AS debit,
                COALESCE(SUM(CASE WHEN txn_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS credit
         FROM fact_transactions`
      )
      .get();
    const caRevenue = db.prepare('SELECT COALESCE(SUM(fee_amount), 0) AS revenue FROM fact_ca_sessions').get();
    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM dim_user').get();
    const totalBanks = db.prepare('SELECT COUNT(*) AS c FROM dim_bank').get();
    const totalCategories = db.prepare('SELECT COUNT(*) AS c FROM dim_category').get();
    const caSessions = db.prepare('SELECT COUNT(*) AS c FROM fact_ca_sessions').get();
    const range = db.prepare('SELECT MIN(full_date) AS firstDate, MAX(full_date) AS lastDate FROM dim_date').get();
    res.json({
      ...totals,
      caRevenue: caRevenue.revenue,
      totalUsers: totalUsers.c,
      totalBanks: totalBanks.c,
      totalCategories: totalCategories.c,
      caSessionCount: caSessions.c,
      firstDate: range.firstDate,
      lastDate: range.lastDate
    });
  });

  return router;
};
