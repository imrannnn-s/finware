const jwt = require('jsonwebtoken');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Values that ship in .env.example or in old commits. A secret equal to one of
// these is treated as "not configured" - it must never be used to sign tokens.
const PLACEHOLDER_SECRETS = new Set(['', 'dev-secret-change-me', 'change-this-to-a-long-random-string']);

function resolveJwtSecret() {
  const configured = (process.env.JWT_SECRET || '').trim();
  const isPlaceholder = PLACEHOLDER_SECRETS.has(configured.toLowerCase());

  // A placeholder (including the value shipped in .env.example, or an empty
  // JWT_SECRET= line) is never acceptable - refuse to start on it at all.
  if (configured && isPlaceholder) {
    throw new Error(
      'JWT_SECRET is set to a placeholder value. Generate a real secret, e.g. ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))", ' +
        'and put it in .env before starting the server.'
    );
  }

  // No secret configured at all: allowed only for local development, and always
  // announced loudly. Production must supply an explicit secret.
  if (!configured) {
    if (IS_PRODUCTION) {
      throw new Error(
        'JWT_SECRET is not set. Set a long random JWT_SECRET in .env before starting the server.'
      );
    }
    console.warn(
      '[auth] JWT_SECRET is not set - falling back to an INSECURE development-only secret. ' +
        'Set JWT_SECRET in .env before using this anywhere other than your own machine.'
    );
    return 'dev-secret-change-me';
  }

  if (IS_PRODUCTION && configured.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long in production.');
  }

  return configured;
}

const JWT_SECRET = resolveJwtSecret();

const ROLES = Object.freeze({ ADMIN: 'admin', USER: 'user' });

/** The only shape of an account that ever leaves the server. */
function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    title: row.title || (row.role === ROLES.ADMIN ? 'Administrator' : 'User'),
    customerId: row.customer_id || null
  };
}

function signToken(row) {
  return jwt.sign({ sub: row.id }, JWT_SECRET, { expiresIn: '8h' });
}

/**
 * Build the auth middleware bound to a database.
 *
 * requireAuth verifies the bearer token and then re-loads the account from
 * app_users on every request, so the role and customer link always come from
 * the database - never from the token or the client - and deleting an account
 * or changing its role takes effect immediately.
 */
function createAuth(db) {
  const findById = db.prepare('SELECT id, email, name, role, title, customer_id FROM app_users WHERE id = ?');

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token.' });
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    const row = Number.isInteger(Number(payload.sub)) ? findById.get(Number(payload.sub)) : null;
    if (!row) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    req.user = publicUser(row);
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Missing bearer token.' });
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'You do not have permission to access this resource.' });
      }
      return next();
    };
  }

  return { requireAuth, requireRole, requireAdmin: requireRole(ROLES.ADMIN) };
}

module.exports = { createAuth, publicUser, signToken, ROLES, JWT_SECRET };
