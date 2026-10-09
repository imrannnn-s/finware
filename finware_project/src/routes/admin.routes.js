const fs = require('fs');
const path = require('path');
const express = require('express');
const { createAuth, publicUser, ROLES } = require('../middleware/auth');

const MODEL_INFO_PATH = path.join(__dirname, '..', 'admin-content', 'model-info.html');

/**
 * Administrator-only endpoints. Every route is behind requireAuth +
 * requireAdmin at the router level, so nothing here can be reached by a
 * 'user' account, whatever URL or payload it sends.
 */
module.exports = function adminRoutes(db) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = createAuth(db);
  router.use(requireAuth, requireAdmin);

  const listUsers = db.prepare(
    `SELECT a.id, a.email, a.name, a.role, a.title, a.customer_id, a.created_at, u.user_name AS customer_name
     FROM app_users a
     LEFT JOIN dim_user u ON u.user_id = a.customer_id
     ORDER BY a.role, a.id`
  );
  const findById = db.prepare('SELECT * FROM app_users WHERE id = ?');
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM app_users WHERE role = 'admin'");
  const customerExists = db.prepare('SELECT 1 FROM dim_user WHERE user_id = ?');
  const customerOwner = db.prepare('SELECT id FROM app_users WHERE customer_id = ? AND id <> ?');

  function toAccount(row) {
    return { ...publicUser(row), customerName: row.customer_name || null, createdAt: row.created_at || null };
  }

  router.get('/users', (req, res) => {
    const customers = db.prepare('SELECT user_id AS id, user_name AS name FROM dim_user ORDER BY user_id').all();
    res.json({ users: listUsers.all().map(toAccount), customers });
  });

  // Change an account's role and/or the warehouse customer it is linked to.
  router.patch('/users/:id', (req, res) => {
    const target = findById.get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'No such account.' });
    const body = req.body || {};

    let role = target.role;
    if (body.role !== undefined) {
      if (!Object.values(ROLES).includes(body.role)) {
        return res.status(400).json({ error: "Role must be 'admin' or 'user'." });
      }
      if (target.id === req.user.id && body.role !== ROLES.ADMIN) {
        return res.status(400).json({ error: 'You cannot remove your own administrator role.' });
      }
      if (target.role === ROLES.ADMIN && body.role !== ROLES.ADMIN && adminCount.get().c <= 1) {
        return res.status(400).json({ error: 'At least one administrator must remain.' });
      }
      role = body.role;
    }

    let customerId = target.customer_id;
    if (body.customerId !== undefined) {
      customerId = body.customerId === null || body.customerId === '' ? null : String(body.customerId);
      if (customerId !== null) {
        if (!customerExists.get(customerId)) return res.status(400).json({ error: 'Unknown customer id.' });
        if (customerOwner.get(customerId, target.id)) {
          return res.status(409).json({ error: 'That customer is already linked to another account.' });
        }
      }
    }
    if (role === ROLES.ADMIN) customerId = null;

    db.prepare('UPDATE app_users SET role = ?, customer_id = ? WHERE id = ?').run(role, customerId, target.id);
    const updated = listUsers.all().find((u) => u.id === target.id);
    res.json({ user: toAccount(updated) });
  });

  router.delete('/users/:id', (req, res) => {
    const target = findById.get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'No such account.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    if (target.role === ROLES.ADMIN && adminCount.get().c <= 1) {
      return res.status(400).json({ error: 'At least one administrator must remain.' });
    }
    db.prepare('DELETE FROM app_users WHERE id = ?').run(target.id);
    res.status(204).end();
  });

  // ML model description, hyperparameters and evaluation results.
  router.get('/model-info', (req, res) => {
    res.type('html').send(fs.readFileSync(MODEL_INFO_PATH, 'utf8'));
  });

  return router;
};
