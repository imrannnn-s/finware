const express = require('express');
const { createAuth, ROLES } = require('../middleware/auth');
const engine = require('../insights/engine');

/**
 * FinWare insight endpoints.
 *
 * This layer only reads real rows from the SQLite warehouse and hands them to
 * the deterministic calculators in ../insights/engine. There are no stored or
 * hardcoded predictions: every figure in a response is computed on request from
 * the current contents of the database.
 */

module.exports = function insightsRoutes(db) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = createAuth(db);
  router.use(requireAuth);

  const isAdmin = (req) => req.user.role === ROLES.ADMIN;

  /**
   * Object-level authorization: an admin may read any customer, a 'user' only
   * the warehouse customer linked to their own account.
   */
  function canAccessCustomer(req, customerId) {
    return isAdmin(req) || (!!req.user.customerId && req.user.customerId === customerId);
  }

  function forbidCustomer(res) {
    return res.status(403).json({ error: 'You can only view your own records.' });
  }

  function customerGuard(req, res, next) {
    if (!canAccessCustomer(req, req.params.user)) return forbidCustomer(res);
    return next();
  }

  // Scoring internals (baselines, thresholds, deviation statistics) are
  // admin-only; users get the outcome and the plain-language reason.
  const USER_HIDDEN_RISK_FIELDS = [
    'ratioToBaseline', 'baseline', 'baselineSource', 'baselineSample', 'deviationFromAverage', 'bands'
  ];
  function forUser(req, obj) {
    if (isAdmin(req) || !obj) return obj;
    const copy = { ...obj };
    for (const key of USER_HIDDEN_RISK_FIELDS) delete copy[key];
    return copy;
  }

  const TXN_SQL = `
    SELECT t.txn_id      AS id,
           t.user_id     AS userId,
           d.full_date   AS date,
           d.date_id     AS dateId,
           t.category_id AS categoryId,
           t.amount      AS amount,
           t.txn_type    AS type,
           b.bank_name   AS bank
    FROM fact_transactions t
    JOIN dim_date  d ON d.date_id = t.date_id
    JOIN dim_bank  b ON b.bank_id = t.bank_id
  `;

  const USER_SQL = `
    SELECT u.user_id        AS id,
           u.user_name      AS name,
           c.city_name      AS city,
           i.bracket_label  AS income,
           a.account_type   AS accountType
    FROM dim_user u
    JOIN dim_city           c ON c.city_id = u.city_id
    JOIN dim_income_bracket i ON i.income_id = u.income_id
    JOIN dim_account_type   a ON a.account_type_id = u.account_type_id
    ORDER BY u.user_id
  `;

  /** Build a category id -> { name, group } lookup from the real dimension. */
  function categoryLookup() {
    const map = new Map();
    for (const row of db.prepare('SELECT category_id AS id, category_name AS name, category_group AS "group" FROM dim_category').all()) {
      map.set(row.id, { name: row.name, group: row.group });
    }
    return (id) => map.get(id);
  }

  function toDay(isoDate) {
    return Date.parse(`${isoDate}T00:00:00Z`) / 86400000;
  }

  /**
   * Compute everything the API needs for one request.
   * Cohort averages are derived from the whole warehouse, so results stay
   * correct as new customers and transactions are added.
   */
  function buildContext() {
    const users = db.prepare(USER_SQL).all();
    const transactions = db.prepare(`${TXN_SQL} ORDER BY t.user_id, d.full_date, t.txn_id`).all();
    const lookup = categoryLookup();

    const byUser = new Map(users.map((u) => [u.id, []]));
    for (const txn of transactions) {
      if (byUser.has(txn.userId)) byUser.get(txn.userId).push(txn);
    }

    // Portfolio level reference points for relative activity judgement.
    const spans = users.map((u) => {
      const list = engine.sortByDate(byUser.get(u.id) || []);
      if (list.length < 2) return 1;
      return toDay(list[list.length - 1].date) - toDay(list[0].date) + 1;
    });
    const cohort = {
      avgAmount: transactions.length ? engine.mean(transactions.map((t) => t.amount)) : 0,
      avgRate: users.length ? engine.mean(users.map((u, i) => (byUser.get(u.id) || []).length / spans[i])) : 0
    };

    // Score every transaction once, per customer baseline context.
    const scores = new Map();
    for (const user of users) {
      const list = engine.sortByDate(byUser.get(user.id) || []);
      if (!list.length) continue;
      const amounts = list.map((t) => t.amount);

      const byCategoryAmounts = new Map();
      for (const txn of list) {
        if (!byCategoryAmounts.has(txn.categoryId)) byCategoryAmounts.set(txn.categoryId, []);
        byCategoryAmounts.get(txn.categoryId).push(txn.amount);
      }
      const byCategory = new Map(
        [...byCategoryAmounts].map(([key, values]) => [key, { median: engine.median(values), count: values.length }])
      );

      const typeCounts = {};
      for (const txn of list) typeCounts[txn.type] = (typeCounts[txn.type] || 0) + 1;

      const gaps = list.slice(1).map((txn, i) => toDay(txn.date) - toDay(list[i].date));
      const baselineGap = engine.median(gaps);

      const userStats = {
        byCategory,
        mean: engine.mean(amounts),
        stddev: engine.stddev(amounts),
        total: engine.sum(amounts),
        typeCounts
      };

      list.forEach((txn, index) => {
        const previousGap = index > 0 ? toDay(txn.date) - toDay(list[index - 1].date) : 0;
        scores.set(txn.id, engine.scoreTransaction(txn, { userStats, allAmounts: amounts, previousGap, baselineGap }));
      });
    }

    return { users, transactions, byUser, scores, cohort, lookup };
  }

  /** Rolling counters so each customer can report their own alert totals. */
  function anomalyIndex(scores) {
    const byUser = new Map();
    let anomalousCount = 0;
    let normalCount = 0;
    let low = 0;
    let medium = 0;
    let high = 0;

    for (const score of scores.values()) {
      if (score.status === 'ANOMALOUS') anomalousCount += 1;
      else normalCount += 1;
      if (score.level === 'LOW') low += 1;
      else if (score.level === 'MEDIUM') medium += 1;
      else high += 1;
    }
    return { byUser, anomalousCount, normalCount, low, medium, high };
  }

  function summariseForUser(ctx, userId) {
    const totals = { anomalousCount: 0, highRiskCount: 0, scored: 0 };
    for (const txn of ctx.byUser.get(userId) || []) {
      const score = ctx.scores.get(txn.id);
      if (!score) continue;
      totals.scored += 1;
      if (score.status === 'ANOMALOUS') totals.anomalousCount += 1;
      if (score.level === 'HIGH') totals.highRiskCount += 1;
    }
    return totals;
  }

  /** Resolve a customer or fail with a clear 404. */
  function findUser(ctx, id) {
    return ctx.users.find((u) => u.id === id) || null;
  }

  function requireUser(ctx, res, id) {
    const user = findUser(ctx, id);
    if (!user) {
      res.status(404).json({ error: `No customer found with id "${id}".` });
      return null;
    }
    return user;
  }

  // -------------------------------------------------------------------------
  // GET /api/insights/summary
  // -------------------------------------------------------------------------
  router.get('/summary', requireAdmin, (req, res) => {
    const ctx = buildContext();
    const counts = anomalyIndex(ctx.scores);
    const total = ctx.scores.size;

    const behaviours = { HIGH: [], MODERATE: [], LOW: [] };
    const customerSummaries = ctx.users.map((user) => {
      const list = ctx.byUser.get(user.id) || [];
      const profile = engine.behaviouralProfile(user, list, ctx.cohort, ctx.lookup);
      const totals = summariseForUser(ctx, user.id);
      if (profile.behaviour) {
        const key = profile.behaviour.startsWith('HIGH') ? 'HIGH' : profile.behaviour.startsWith('LOW') ? 'LOW' : 'MODERATE';
        behaviours[key].push(user.id);
      }
      return {
        userId: user.id,
        userName: user.name,
        sufficientHistory: profile.sufficientHistory,
        behaviour: profile.behaviour,
        transactionFrequency: profile.transactionFrequency,
        spendingTrend: profile.spendingTrend,
        primaryCategory: profile.primaryCategory ? profile.primaryCategory.name : null,
        primaryCategoryShare: profile.primaryCategory ? profile.primaryCategory.shareOfSpend : null,
        transactionCount: profile.totalTransactions,
        totalSpending: profile.totalSpending,
        averageTransaction: profile.averageTransaction,
        highestTransaction: profile.highestTransaction,
        debitCount: profile.debitCount,
        creditCount: profile.creditCount,
        anomalousCount: totals.anomalousCount,
        highRiskCount: totals.highRiskCount
      };
    });

    const topRisk = [...ctx.scores.values()]
      .sort((a, b) => b.score - a.score || a.txnId.localeCompare(b.txnId))
      .slice(0, 5)
      .map((score) => {
        const txn = ctx.transactions.find((t) => t.id === score.txnId);
        return {
          txnId: score.txnId,
          userId: txn.userId,
          userName: (findUser(ctx, txn.userId) || {}).name,
          date: txn.date,
          amount: txn.amount,
          categoryName: (ctx.lookup(txn.categoryId) || {}).name,
          score: score.score,
          level: score.level,
          status: score.status,
          reason: score.reason
        };
      });

    res.json({
      sufficientHistory: true,
      generatedFrom: 'live warehouse records',
      customersAnalysed: ctx.users.length,
      totalTransactions: total,
      totalRecordsScored: total,
      normalCount: counts.normalCount,
      anomalousCount: counts.anomalousCount,
      anomalyRate: total ? engine.round2((counts.anomalousCount / total) * 100) : 0,
      riskBreakdown: { low: counts.low, medium: counts.medium, high: counts.high },
      behaviourBreakdown: {
        low: behaviours.LOW.length,
        moderate: behaviours.MODERATE.length,
        high: behaviours.HIGH.length
      },
      cohortAverageTransaction: engine.round2(ctx.cohort.avgAmount),
      customers: customerSummaries,
      topRiskTransactions: topRisk,
      bands: { low: `0-${engine.CONFIG.RISK_MEDIUM_AT - 1}`, medium: `${engine.CONFIG.RISK_MEDIUM_AT}-${engine.CONFIG.RISK_HIGH_AT - 1}`, high: `${engine.CONFIG.RISK_HIGH_AT}-100` }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/customer/:user
  // -------------------------------------------------------------------------
  router.get('/customer/:user', customerGuard, (req, res) => {
    const ctx = buildContext();
    const user = requireUser(ctx, res, req.params.user);
    if (!user) return;

    const list = ctx.byUser.get(user.id) || [];
    const profile = engine.behaviouralProfile(user, list, ctx.cohort, ctx.lookup);
    const totals = summariseForUser(ctx, user.id);

    if (!profile.sufficientHistory) {
      return res.json({
        customer: user,
        sufficientHistory: false,
        message: engine.INSUFFICIENT_HISTORY_MESSAGE,
        insight: engine.INSUFFICIENT_HISTORY_MESSAGE,
        spending: null,
        recommendations: { sufficientHistory: false, recommendations: [], disclaimer: engine.DISCLAIMER }
      });
    }

    const activity = profile.activityDetail;
    res.json({
      customer: user,
      sufficientHistory: true,
      insight: engine.buildSpendingInsight(profile, activity),
      spending: {
        totalTransactions: profile.totalTransactions,
        totalSpending: profile.totalSpending,
        averageTransaction: profile.averageTransaction,
        highestTransaction: profile.highestTransaction,
        lowestTransaction: profile.lowestTransaction,
        primaryCategory: profile.primaryCategory,
        categories: profile.categories,
        debitCount: profile.debitCount,
        creditCount: profile.creditCount,
        transactionFrequency: profile.transactionFrequency,
        frequencyDetail: profile.frequencyDetail,
        spendingTrend: profile.spendingTrend,
        trendDetail: profile.trendDetail,
        behaviour: profile.behaviour,
        activityDetail: profile.activityDetail,
        period: { firstDate: profile.firstDate, lastDate: profile.lastDate, spanDays: profile.spanDays }
      },
      risk: {
        scoredTransactions: totals.scored,
        anomalousCount: totals.anomalousCount,
        highRiskCount: totals.highRiskCount,
        anomalyRate: totals.scored ? engine.round2((totals.anomalousCount / totals.scored) * 100) : 0
      },
      recommendations: engine.buildRecommendations(profile, {
        anomalousCount: totals.anomalousCount,
        highRiskCount: totals.highRiskCount
      })
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/customer/:user/spending
  // -------------------------------------------------------------------------
  router.get('/customer/:user/spending', customerGuard, (req, res) => {
    const ctx = buildContext();
    const user = requireUser(ctx, res, req.params.user);
    if (!user) return;

    const list = ctx.byUser.get(user.id) || [];
    const profile = engine.behaviouralProfile(user, list, ctx.cohort, ctx.lookup);

    if (!profile.sufficientHistory) {
      return res.json({
        customer: user,
        sufficientHistory: false,
        message: engine.INSUFFICIENT_HISTORY_MESSAGE,
        transactionFrequency: profile.transactionFrequency,
        behaviour: null,
        primaryCategory: null,
        insight: engine.INSUFFICIENT_HISTORY_MESSAGE
      });
    }

    res.json({
      customer: user,
      sufficientHistory: true,
      totalTransactions: profile.totalTransactions,
      totalSpending: profile.totalSpending,
      averageTransaction: profile.averageTransaction,
      highestTransaction: profile.highestTransaction,
      lowestTransaction: profile.lowestTransaction,
      primaryCategory: profile.primaryCategory,
      categories: profile.categories,
      debitCount: profile.debitCount,
      creditCount: profile.creditCount,
      transactionFrequency: profile.transactionFrequency,
      frequencyDetail: profile.frequencyDetail,
      spendingTrend: profile.spendingTrend,
      trendDetail: profile.trendDetail,
      behaviour: profile.behaviour,
      activityDetail: profile.activityDetail,
      period: { firstDate: profile.firstDate, lastDate: profile.lastDate, spanDays: profile.spanDays },
      insight: engine.buildSpendingInsight(profile, profile.activityDetail)
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/customer/:user/recommendations
  // -------------------------------------------------------------------------
  router.get('/customer/:user/recommendations', customerGuard, (req, res) => {
    const ctx = buildContext();
    const user = requireUser(ctx, res, req.params.user);
    if (!user) return;

    const list = ctx.byUser.get(user.id) || [];
    const profile = engine.behaviouralProfile(user, list, ctx.cohort, ctx.lookup);
    const totals = summariseForUser(ctx, user.id);

    if (!profile.sufficientHistory) {
      return res.json({
        customer: user,
        sufficientHistory: false,
        message: engine.INSUFFICIENT_HISTORY_MESSAGE,
        recommendations: [],
        disclaimer: engine.DISCLAIMER
      });
    }

    const result = engine.buildRecommendations(profile, {
      anomalousCount: totals.anomalousCount,
      highRiskCount: totals.highRiskCount
    });

    res.json({
      customer: user,
      sufficientHistory: true,
      behaviour: profile.behaviour,
      transactionFrequency: profile.transactionFrequency,
      spendingTrend: profile.spendingTrend,
      topCategories: profile.categories.slice(0, 4).map((c) => ({
        categoryId: c.categoryId,
        name: c.name,
        group: c.group,
        totalSpend: c.totalSpend,
        transactionCount: c.transactionCount,
        shareOfSpend: c.shareOfSpend
      })),
      recommendations: result.recommendations,
      disclaimer: result.disclaimer
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/anomalies
  // Supports ?user=U01&status=ANOMALOUS&minScore=40&limit=100
  // -------------------------------------------------------------------------
  router.get('/anomalies', (req, res) => {
    const { status, minScore, limit } = req.query;
    let { user } = req.query;
    if (!isAdmin(req)) {
      if (user && !canAccessCustomer(req, String(user))) return forbidCustomer(res);
      if (!req.user.customerId) return forbidCustomer(res);
      user = req.user.customerId;
    }
    const ctx = buildContext();

    if (user) {
      const known = findUser(ctx, String(user));
      if (!known) return res.status(404).json({ error: `No customer found with id "${user}".` });
    }

    let rows = ctx.transactions.map((txn) => ({ txn, score: ctx.scores.get(txn.id) })).filter((r) => r.score);

    if (user) rows = rows.filter((r) => r.txn.userId === String(user));
    if (status) rows = rows.filter((r) => r.score.status === String(status).toUpperCase());
    if (minScore !== undefined) {
      const floor = Number(minScore);
      if (Number.isFinite(floor)) rows = rows.filter((r) => r.score.score >= floor);
    }

    // Highest risk first, deterministic on ties.
    rows.sort((a, b) => b.score.score - a.score.score || a.txn.id.localeCompare(b.txn.id));

    // Users' counts cover only their own transactions, never the portfolio.
    const scopedScores = isAdmin(req)
      ? ctx.scores
      : new Map((ctx.byUser.get(String(user)) || []).filter((t) => ctx.scores.has(t.id)).map((t) => [t.id, ctx.scores.get(t.id)]));
    const counts = anomalyIndex(scopedScores);
    const anomalous = rows.filter((r) => r.score.status === 'ANOMALOUS');

    let payload = rows.map((r) => forUser(req, {
      txnId: r.txn.id,
      userId: r.txn.userId,
      userName: (findUser(ctx, r.txn.userId) || {}).name,
      date: r.txn.date,
      dateId: r.txn.dateId,
      bank: r.txn.bank,
      amount: r.txn.amount,
      type: r.txn.type,
      categoryId: r.txn.categoryId,
      categoryName: (ctx.lookup(r.txn.categoryId) || {}).name,
      categoryGroup: (ctx.lookup(r.txn.categoryId) || {}).group,
      status: r.score.status,
      riskLevel: r.score.level,
      riskScore: r.score.score,
      ratioToBaseline: r.score.ratio,
      baseline: r.score.baseline,
      baselineSource: r.score.baselineSource,
      shareOfLifetimeSpend: r.score.shareOfLifetimeSpend,
      reason: r.score.reason
    }));

    const capped = payload.length > Number(limit || 500);
    if (limit) payload = payload.slice(0, Number(limit));

    res.json({
      sufficientHistory: true,
      counts: {
        totalTransactions: scopedScores.size,
        normalCount: counts.normalCount,
        anomalousCount: counts.anomalousCount,
        anomalyRate: scopedScores.size ? engine.round2((counts.anomalousCount / scopedScores.size) * 100) : 0,
        returned: payload.length,
        matchingFilters: payload.length,
        truncated: capped,
        riskLow: counts.low,
        riskMedium: counts.medium,
        riskHigh: counts.high
      },
      anomalies: anomalous
        .slice(0, Number(limit || 500))
        .map((r) => ({
          txnId: r.txn.id,
          userId: r.txn.userId,
          userName: (findUser(ctx, r.txn.userId) || {}).name,
          date: r.txn.date,
          amount: r.txn.amount,
          categoryName: (ctx.lookup(r.txn.categoryId) || {}).name,
          status: r.score.status,
          riskLevel: r.score.level,
          riskScore: r.score.score,
          reason: r.score.reason
        })),
      transactions: payload,
      ...(isAdmin(req)
        ? { bands: { low: `0-${engine.CONFIG.RISK_MEDIUM_AT - 1}`, medium: `${engine.CONFIG.RISK_MEDIUM_AT}-${engine.CONFIG.RISK_HIGH_AT - 1}`, high: `${engine.CONFIG.RISK_HIGH_AT}-100` } }
        : {})
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/transaction/:txnId/risk
  // -------------------------------------------------------------------------
  router.get('/transaction/:txnId/risk', (req, res) => {
    const ctx = buildContext();
    const txn = ctx.transactions.find((t) => t.id === req.params.txnId);
    if (!txn) {
      return res.status(404).json({ error: `No transaction found with id "${req.params.txnId}".` });
    }
    if (!canAccessCustomer(req, txn.userId)) return forbidCustomer(res);

    const user = findUser(ctx, txn.userId) || null;
    const list = ctx.byUser.get(txn.userId) || [];
    const profile = engine.behaviouralProfile(user || { id: txn.userId, name: '' }, list, ctx.cohort, ctx.lookup);
    const score = ctx.scores.get(txn.id);
    const category = ctx.lookup(txn.categoryId) || {};

    res.json({
      transaction: {
        txnId: txn.id,
        userId: txn.userId,
        userName: user ? user.name : null,
        date: txn.date,
        dateId: txn.dateId,
        bank: txn.bank,
        amount: txn.amount,
        type: txn.type,
        categoryId: txn.categoryId,
        categoryName: category.name,
        categoryGroup: category.group
      },
      risk: forUser(req, {
        status: score.status,
        level: score.level,
        score: score.score,
        reason: score.reason,
        ratioToBaseline: score.ratio,
        baseline: score.baseline,
        baselineSource: score.baselineSource,
        baselineSample: score.baselineSample,
        shareOfLifetimeSpend: score.shareOfLifetimeSpend,
        deviationFromAverage: score.zScore,
        bands: { low: `0-${engine.CONFIG.RISK_MEDIUM_AT - 1}`, medium: `${engine.CONFIG.RISK_MEDIUM_AT}-${engine.CONFIG.RISK_HIGH_AT - 1}`, high: `${engine.CONFIG.RISK_HIGH_AT}-100` }
      }),
      context: {
        customerAverageTransaction: profile.averageTransaction,
        customerTransactionCount: profile.totalTransactions,
        sufficientHistory: profile.sufficientHistory,
        note: profile.sufficientHistory ? null : engine.INSUFFICIENT_HISTORY_MESSAGE
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/insights/customers  (selector helper for the UI)
  // -------------------------------------------------------------------------
  router.get('/customers', requireAdmin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.user_id AS id, u.user_name AS name,
                COUNT(t.txn_id) AS transactionCount
         FROM dim_user u
         LEFT JOIN fact_transactions t ON t.user_id = u.user_id
         GROUP BY u.user_id
         ORDER BY u.user_id`
      )
      .all();
    res.json({ customers: rows });
  });

  return router;
};
