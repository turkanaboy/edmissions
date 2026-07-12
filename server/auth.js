import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 7;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

// SHA-256 digests are always equal length, so timingSafeEqual never throws on a typo'd password
const sha256 = (s) => createHash('sha256').update(String(s)).digest();

export function createAuth(config) {
  const attempts = new Map(); // ponytail: in-memory rate limit, resets on restart — fine for two users

  const sign = (payload) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

  const makeSession = (username) => {
    const payload = Buffer.from(
      JSON.stringify({ u: username, exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000 })
    ).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };

  const readSession = (token) => {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const a = Buffer.from(token.slice(dot + 1));
    const b = Buffer.from(sign(payload));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!data.u || Date.now() > data.exp) return null;
      return data;
    } catch {
      return null;
    }
  };

  const getSessionCookie = (req) => {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'edm_session') return decodeURIComponent(v.join('='));
    }
    return null;
  };

  const cookieAttrs = () =>
    `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}` +
    (config.trustProxy ? '; Secure' : '');

  const login = (req, res) => {
    const { username, password } = req.body || {};
    const key = `${req.ip}|${username}`;
    const failed = attempts.get(key);
    if (failed && failed.count >= MAX_FAILS && Date.now() < failed.resetAt) {
      return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
    }
    const user = config.users.find((u) => u.username === username);
    const stored = user ? user.password : '__no_such_user__';
    const ok = timingSafeEqual(sha256(password ?? ''), sha256(stored)) && Boolean(user);
    if (!ok) {
      const now = Date.now();
      const entry = failed && now < failed.resetAt ? failed : { count: 0, resetAt: now + WINDOW_MS };
      entry.count += 1;
      attempts.set(key, entry);
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    attempts.delete(key);
    res.setHeader('Set-Cookie', `edm_session=${encodeURIComponent(makeSession(username))}; ${cookieAttrs()}`);
    res.json({ ok: true, username });
  };

  const logout = (req, res) => {
    res.setHeader('Set-Cookie', `edm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  };

  const requireAuth = (req, res, next) => {
    const session = readSession(getSessionCookie(req));
    if (session) {
      req.user = session.u;
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login.html');
  };

  return { login, logout, requireAuth };
}
