// Qodo Forum - Backend with real SQLite database
// Run: npm install && npm start

const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Database init
const dbPath = path.join(__dirname, 'qodo-forum.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(topic_id) REFERENCES topics(id)
);
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(question_id) REFERENCES questions(id)
);
`);

function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2, 10); }
function now(){ return new Date().toISOString(); }

// Seed demo data if empty
(function seed(){
  const topicsCount = db.prepare('SELECT COUNT(*) AS c FROM topics').get().c;
  const usersCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const questionsCount = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;

  if (topicsCount === 0){
    const ins = db.prepare('INSERT INTO topics (id,title,color,created_at) VALUES (?,?,?,?)');
    ins.run(uid('t'), 'JavaScript', '#8aa2ff', now());
    ins.run(uid('t'), 'Python', '#00d1b2', now());
    ins.run(uid('t'), 'Web', '#f6c945', now());
  }
  if (usersCount === 0){
    const ins = db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)');
    ins.run(uid('u'), 'demo', bcrypt.hashSync('demo1234', 10), now());
  }
  if (questionsCount === 0){
    const topic = db.prepare("SELECT id FROM topics WHERE title=?").get('Web');
    const qid = uid('q');
    db.prepare('INSERT INTO questions (id,title,body,topic_id,author,created_at) VALUES (?,?,?,?,?,?)')
      .run(qid, 'Как подключить CSS к HTML?', 'Используйте тег <link rel="stylesheet" href="style.css"> в секции <head>.', topic.id, 'demo', now());
    db.prepare('INSERT INTO replies (id,question_id,body,author,created_at) VALUES (?,?,?,?,?)')
      .run(uid('r'), qid, 'Вставьте <link rel="stylesheet" href="style.css"> в <head>.', 'demo', now());
  }
})();

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Serve static frontend
app.use(express.static(__dirname));

// Auth helpers
function signToken(user){
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authMiddleware(req,res,next){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ')? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes: Auth
app.post('/api/auth/register', (req,res)=>{
  const { username, password } = req.body || {};
  if (!username || !password || String(username).trim().length < 3 || String(password).length < 6){
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });
  const user = { id: uid('u'), username: String(username).trim(), password_hash: bcrypt.hashSync(password, 10), created_at: now() };
  db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)')
    .run(user.id, user.username, user.password_hash, user.created_at);
  const token = signToken(user);
  return res.json({ token, user: { id: user.id, username: user.username } });
});

app.post('/api/auth/login', (req,res)=>{
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?)').get(username || '');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  return res.json({ token, user: { id: user.id, username: user.username } });
});

// Routes: Topics
app.get('/api/topics', (req,res)=>{
  const rows = db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all();
  res.json(rows);
});
app.post('/api/topics', authMiddleware, (req,res)=>{
  const { title, color } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const t = { id: uid('t'), title: String(title).trim(), color: color || '#8aa2ff', created_at: now() };
  db.prepare('INSERT INTO topics (id,title,color,created_at) VALUES (?,?,?,?)')
    .run(t.id, t.title, t.color, t.created_at);
  res.json(t);
});
app.put('/api/topics/:id', authMiddleware, (req,res)=>{
  const { id } = req.params; const { title, color } = req.body || {};
  const old = db.prepare('SELECT * FROM topics WHERE id=?').get(id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE topics SET title=?, color=? WHERE id=?').run(title || old.title, color || old.color, id);
  res.json({ ...old, title: title || old.title, color: color || old.color });
});
app.delete('/api/topics/:id', authMiddleware, (req,res)=>{
  const { id } = req.params;
  const old = db.prepare('SELECT * FROM topics WHERE id=?').get(id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM topics WHERE id=?').run(id);
  // Optionally: reassign questions of this topic
  res.json({ ok: true });
});

// Routes: Questions
app.get('/api/questions', (req,res)=>{
  const { q = '', topicId = 'all', sort = 'new' } = req.query;
  let sql = 'SELECT * FROM questions';
  const params = [];
  const filters = [];
  if (topicId !== 'all'){ filters.push('topic_id = ?'); params.push(topicId); }
  if (q){ filters.push('(LOWER(title) LIKE ? OR LOWER(body) LIKE ?)'); params.push(`%${String(q).toLowerCase()}%`, `%${String(q).toLowerCase()}%`); }
  if (filters.length){ sql += ' WHERE ' + filters.join(' AND '); }
  if (sort === 'old') sql += ' ORDER BY created_at ASC';
  else if (sort === 'answers') {
    sql = `SELECT q.*, (
      SELECT COUNT(*) FROM replies r WHERE r.question_id = q.id
    ) AS replies_count FROM questions q` + (filters.length? ' WHERE ' + filters.join(' AND ') : '') + ' ORDER BY replies_count DESC';
  } else sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});
app.get('/api/questions/:id', (req,res)=>{
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  const replies = db.prepare('SELECT * FROM replies WHERE question_id=? ORDER BY created_at ASC').all(q.id);
  res.json({ ...q, replies });
});
app.post('/api/questions', authMiddleware, (req,res)=>{
  const { title, body, topicId } = req.body || {};
  if (!title || !body || !topicId) return res.status(400).json({ error: 'Missing fields' });
  const q = { id: uid('q'), title: String(title).trim(), body: String(body).trim(), topic_id: topicId, author: req.user.username, created_at: now() };
  db.prepare('INSERT INTO questions (id,title,body,topic_id,author,created_at) VALUES (?,?,?,?,?,?)')
    .run(q.id, q.title, q.body, q.topic_id, q.author, q.created_at);
  res.json(q);
});
app.put('/api/questions/:id', authMiddleware, (req,res)=>{
  const { id } = req.params; const { title, body, topicId } = req.body || {};
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  if (q.author !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE questions SET title=?, body=?, topic_id=? WHERE id=?')
    .run(title || q.title, body || q.body, topicId || q.topic_id, id);
  const updated = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  res.json(updated);
});
app.delete('/api/questions/:id', authMiddleware, (req,res)=>{
  const { id } = req.params;
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  if (q.author !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM replies WHERE question_id=?').run(id);
  db.prepare('DELETE FROM questions WHERE id=?').run(id);
  res.json({ ok: true });
});

// Routes: Replies
app.post('/api/questions/:id/replies', authMiddleware, (req,res)=>{
  const { id } = req.params; const { body } = req.body || {};
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!q) return res.status(404).json({ error: 'Question not found' });
  if (!body) return res.status(400).json({ error: 'Body required' });
  const r = { id: uid('r'), question_id: id, body: String(body).trim(), author: req.user.username, created_at: now() };
  db.prepare('INSERT INTO replies (id,question_id,body,author,created_at) VALUES (?,?,?,?,?)')
    .run(r.id, r.question_id, r.body, r.author, r.created_at);
  res.json(r);
});
app.put('/api/replies/:id', authMiddleware, (req,res)=>{
  const { id } = req.params; const { body } = req.body || {};
  const r = db.prepare('SELECT * FROM replies WHERE id=?').get(id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.author !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE replies SET body=? WHERE id=?').run(body || r.body, id);
  const upd = db.prepare('SELECT * FROM replies WHERE id=?').get(id);
  res.json(upd);
});
app.delete('/api/replies/:id', authMiddleware, (req,res)=>{
  const { id } = req.params;
  const r = db.prepare('SELECT * FROM replies WHERE id=?').get(id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.author !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM replies WHERE id=?').run(id);
  res.json({ ok: true });
});

// Healthcheck
app.get('/api/health', (req,res)=> res.json({ ok: true }));

app.listen(PORT, ()=>{
  console.log(`Qodo Forum backend running on http://localhost:${PORT}`);
});
