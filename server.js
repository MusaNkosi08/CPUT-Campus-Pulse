require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-me';
const STALE_WINDOW_HOURS = Number(process.env.STALE_WINDOW_HOURS) || 48;
const dbPath = path.join(__dirname, 'campus-pulse.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const categories = new Set(['water', 'power', 'access', 'teaching', 'safety', 'other']);
const statuses = new Set(['reported', 'confirmed', 'in_progress', 'resolved', 'stale']);

function tokenFor(user) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      if (required) return res.status(401).json({ error: 'Authentication required.' });
      return next();
    }
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
  };
}

function role(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

function refreshStale() {
  db.prepare(`
    UPDATE issues SET status = 'stale'
    WHERE status IN ('reported', 'confirmed')
      AND datetime(last_confirmed_at) < datetime('now', ?)
  `).run(`-${STALE_WINDOW_HOURS} hours`);
}

function issueRow(row, userId) {
  if (!row) return null;
  return { ...row, user_has_confirmed: Boolean(userId && row.user_confirmation), user_confirmation: undefined };
}

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || name.trim().length < 2 || password.length < 8) {
    return res.status(400).json({ error: 'Name, email and a password of at least 8 characters are required.' });
  }
  try {
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 12));
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ user, token: tokenFor(user) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' });
    res.status(500).json({ error: 'Could not create your account.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ user: safeUser, token: tokenFor(safeUser) });
});

app.get('/api/me', auth(), (req, res) => res.json({ user: req.user }));

app.get('/api/issues', auth(false), (req, res) => {
  refreshStale();
  const { category, status, lat, lng, radius } = req.query;
  const conditions = [];
  const params = [];
  if (category && categories.has(category)) { conditions.push('i.category = ?'); params.push(category); }
  if (status && statuses.has(status)) { conditions.push('i.status = ?'); params.push(status); }
  if (lat && lng && radius) {
    const distance = Number(radius) / 111000;
    conditions.push('i.latitude BETWEEN ? AND ? AND i.longitude BETWEEN ? AND ?');
    params.push(Number(lat) - distance, Number(lat) + distance, Number(lng) - distance, Number(lng) + distance);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT i.*, u.name AS reporter_name,
      (SELECT action FROM confirmations c WHERE c.issue_id = i.id AND c.user_id = ?) AS user_confirmation
    FROM issues i JOIN users u ON u.id = i.reporter_id ${where}
    ORDER BY CASE i.status WHEN 'confirmed' THEN 1 WHEN 'reported' THEN 2 WHEN 'in_progress' THEN 3 WHEN 'stale' THEN 4 ELSE 5 END, i.created_at DESC
  `).all(req.user ? req.user.id : 0, ...params).map(row => issueRow(row, req.user && req.user.id));
  res.json({ issues: rows, stale_window_hours: STALE_WINDOW_HOURS });
});

app.post('/api/issues', auth(), role('student', 'staff'), (req, res) => {
  const { category, description, latitude, longitude } = req.body || {};
  if (!categories.has(category) || !description || description.trim().length < 5 || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ error: 'Choose a category, add a short description, and place a valid pin.' });
  }
  const result = db.prepare('INSERT INTO issues (reporter_id, category, description, latitude, longitude) VALUES (?, ?, ?, ?, ?)').run(req.user.id, category, description.trim(), Number(latitude), Number(longitude));
  const issue = db.prepare('SELECT i.*, u.name AS reporter_name FROM issues i JOIN users u ON u.id = i.reporter_id WHERE i.id = ?').get(result.lastInsertRowid);
  res.status(201).json({ issue: issueRow(issue, req.user.id) });
});

app.post('/api/issues/:id/confirm', auth(), role('student', 'staff'), (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
  if (!issue || issue.status === 'resolved') return res.status(404).json({ error: 'That issue is no longer active.' });
  try {
    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO confirmations (issue_id, user_id, action) VALUES (?, ?, ?) ON CONFLICT(issue_id, user_id) DO UPDATE SET action = excluded.action, created_at = datetime(\'now\')').run(issue.id, req.user.id, 'confirm');
      db.prepare("UPDATE issues SET status = CASE WHEN status = 'stale' THEN 'confirmed' ELSE 'confirmed' END, last_confirmed_at = datetime('now'), confirmation_count = confirmation_count + 1 WHERE id = ?").run(issue.id);
    });
    transaction();
    res.json({ message: 'Marked as still happening.', issue: db.prepare('SELECT * FROM issues WHERE id = ?').get(issue.id) });
  } catch { res.status(500).json({ error: 'Could not record your confirmation.' }); }
});

app.post('/api/issues/:id/resolve', auth(), role('student', 'staff'), (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
  if (!issue || issue.status === 'resolved') return res.status(404).json({ error: 'That issue is already resolved.' });
  db.prepare("INSERT INTO confirmations (issue_id, user_id, action) VALUES (?, ?, 'clear') ON CONFLICT(issue_id, user_id) DO UPDATE SET action = 'clear', created_at = datetime('now')").run(issue.id, req.user.id);
  db.prepare("UPDATE issues SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(issue.id);
  res.json({ message: 'Thanks — marked as fixed.' });
});

app.patch('/api/issues/:id/status', auth(), role('staff'), (req, res) => {
  const { status } = req.body || {};
  if (!statuses.has(status) || status === 'stale' || status === 'reported' || status === 'confirmed') return res.status(400).json({ error: 'Staff can move issues to In Progress or Resolved.' });
  const result = db.prepare("UPDATE issues SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE NULL END WHERE id = ?").run(status, status, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Issue not found.' });
  res.json({ issue: db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id) });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Campus Pulse running at http://localhost:${PORT}`));
