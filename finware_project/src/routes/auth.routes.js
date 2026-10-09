const express = require('express');
const bcrypt = require('bcryptjs');
const { createAuth, publicUser, signToken, ROLES } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_NAME = 80;

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

module.exports = function authRoutes(db) {
  const router = express.Router();
  const { requireAuth } = createAuth(db);

  const findByEmail = db.prepare('SELECT * FROM app_users WHERE email = ?');
  const findById = db.prepare('SELECT * FROM app_users WHERE id = ?');

  // `portal` is 'admin' or 'user' and only decides which login screen the
  // request came from; the role itself is always read from the database.
  router.post('/login', (req, res) => {
    const { email, password, portal } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = findByEmail.get(String(email).toLowerCase().trim());
    if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (portal === ROLES.ADMIN && user.role !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'This account does not have administrator access. Use the user sign-in page.' });
    }
    if (portal === ROLES.USER && user.role !== ROLES.USER) {
      return res.status(403).json({ error: 'Administrators must sign in through the admin portal.' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  // Self-service sign-up always creates a 'user'. Any role, customerId or
  // other field in the body is ignored; only an admin can change those later.
  router.post('/register', (req, res) => {
    const body = req.body || {};
    const name = cleanName(body.name);
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    if (!name || name.length > MAX_NAME) {
      return res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters).` });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const problem = passwordProblem(body.password);
    if (problem) return res.status(400).json({ error: problem });
    if (findByEmail.get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const hash = bcrypt.hashSync(body.password, 10);
    const result = db
      .prepare("INSERT INTO app_users (email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
      .run(email, hash, name, ROLES.USER);
    const user = findById.get(Number(result.lastInsertRowid));
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // Users may change their own display name and password. Role, email,
  // title and customer link are not editable here for anyone.
  router.patch('/me', requireAuth, (req, res) => {
    const body = req.body || {};
    const row = findById.get(req.user.id);

    let name = row.name;
    if (body.name !== undefined) {
      name = cleanName(body.name);
      if (!name || name.length > MAX_NAME) {
        return res.status(400).json({ error: `Name is required (max ${MAX_NAME} characters).` });
      }
    }

    let passwordHash = row.password_hash;
    if (body.newPassword !== undefined) {
      if (typeof body.currentPassword !== 'string' || !bcrypt.compareSync(body.currentPassword, row.password_hash)) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      const problem = passwordProblem(body.newPassword);
      if (problem) return res.status(400).json({ error: problem });
      passwordHash = bcrypt.hashSync(body.newPassword, 10);
    }

    db.prepare('UPDATE app_users SET name = ?, password_hash = ? WHERE id = ?').run(name, passwordHash, row.id);
    res.json({ user: publicUser(findById.get(row.id)) });
  });

  return router;
};
