const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'wunschzettel.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (group_id, name)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT,
    image_url TEXT,
    notes TEXT,
    reserved_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
    bought INTEGER NOT NULL DEFAULT 0,
    bought_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function tokenFromReq(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function authMember(req, res, next) {
  const token = tokenFromReq(req);
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const member = db
    .prepare('SELECT m.*, g.name AS group_name, g.invite_code FROM members m JOIN groups g ON g.id = m.group_id WHERE m.token = ?')
    .get(token);
  if (!member) return res.status(401).json({ error: 'Sitz ungültig.' });
  req.member = member;
  next();
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function makeInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (db.prepare('SELECT 1 FROM groups WHERE invite_code = ?').get(code));
  return code;
}

function itemVisibleRow(item, viewerId) {
  const isOwner = item.member_id === viewerId;
  const reserved = item.reserved_by != null;
  const bought = !!item.bought;
  if (isOwner) {
    return {
      ...item,
      reserved: reserved || bought,
      reserved_by: null,
      reserved_by_name: reserved || bought ? 'Verdeckt' : null,
      bought: false,
      bought_by: null,
      bought_by_name: null,
    };
  }
  return item;
}

function groupState(member) {
  const members = db
    .prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY name')
    .all(member.group_id);
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const items = db
    .prepare('SELECT * FROM items WHERE group_id = ? ORDER BY created_at DESC, id DESC')
    .all(member.group_id)
    .map((item) => {
      const visible = itemVisibleRow(item, member.id);
      visible.reserved_by_name = visible.reserved_by && nameById[visible.reserved_by] ? nameById[visible.reserved_by] : visible.reserved_by_name;
      visible.bought_by_name = visible.bought_by && nameById[visible.bought_by] ? nameById[visible.bought_by] : null;
      return visible;
    });
  return {
    group: { id: member.group_id, name: member.group_name, inviteCode: member.invite_code },
    me: { id: member.id, name: member.name },
    members,
    items,
  };
}

app.post('/api/groups', (req, res) => {
  const groupName = String(req.body.groupName || '').trim();
  const yourName = String(req.body.yourName || '').trim();
  if (!groupName || !yourName) return res.status(400).json({ error: 'Gruppenname und dein Name fehlen.' });

  const code = makeInviteCode();
  const token = makeToken();
  const info = db
    .prepare('INSERT INTO groups (name, invite_code) VALUES (?, ?)')
    .run(groupName, code);
  const groupId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO members (group_id, name, token) VALUES (?, ?, ?)').run(groupId, yourName, token);
  res.json({ token, inviteCode: code });
});

app.post('/api/groups/join', (req, res) => {
  const code = String(req.body.inviteCode || '').trim().toUpperCase();
  const yourName = String(req.body.yourName || '').trim();
  if (!code || !yourName) return res.status(400).json({ error: 'Einladungscode und dein Name fehlen.' });

  const group = db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(code);
  if (!group) return res.status(404).json({ error: 'Einladungscode unbekannt.' });

  const existing = db.prepare('SELECT * FROM members WHERE group_id = ? AND name = ?').get(group.id, yourName);
  if (existing) return res.status(409).json({ error: 'Dieser Name ist in der Gruppe schon vergeben.' });

  const token = makeToken();
  db.prepare('INSERT INTO members (group_id, name, token) VALUES (?, ?, ?)').run(group.id, yourName, token);
  res.json({ token });
});

app.get('/api/state', authMember, (req, res) => {
  res.json(groupState(req.member));
});

app.post('/api/items', authMember, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Bitte einen Titel angeben.' });
  const url = String(req.body.url || '').trim() || null;
  const imageUrl = String(req.body.imageUrl || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;
  db.prepare('INSERT INTO items (group_id, member_id, title, url, image_url, notes) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.member.group_id,
    req.member.id,
    title,
    url,
    imageUrl,
    notes
  );
  res.json(groupState(req.member));
});

app.delete('/api/items/:id', authMember, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND group_id = ?').get(req.params.id, req.member.group_id);
  if (!item) return res.status(404).json({ error: 'Item nicht gefunden.' });
  if (item.member_id !== req.member.id) return res.status(403).json({ error: 'Nur eigene Items dürfen gelöscht werden.' });
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  res.json(groupState(req.member));
});

function loadItem(req) {
  return db.prepare('SELECT * FROM items WHERE id = ? AND group_id = ?').get(req.params.id, req.member.group_id);
}

app.post('/api/items/:id/reserve', authMember, (req, res) => {
  const item = loadItem(req);
  if (!item) return res.status(404).json({ error: 'Item nicht gefunden.' });
  if (item.member_id === req.member.id) return res.status(403).json({ error: 'Eigene Items können nicht reserviert werden.' });
  db.prepare('UPDATE items SET reserved_by = ? WHERE id = ?').run(req.member.id, item.id);
  res.json(groupState(req.member));
});

app.post('/api/items/:id/unreserve', authMember, (req, res) => {
  const item = loadItem(req);
  if (!item) return res.status(404).json({ error: 'Item nicht gefunden.' });
  if (item.reserved_by !== req.member.id && item.bought_by !== req.member.id) {
    return res.status(403).json({ error: 'Nur die Person, die reserviert hat, kann das zurücknehmen.' });
  }
  db.prepare('UPDATE items SET reserved_by = NULL WHERE id = ?').run(item.id);
  res.json(groupState(req.member));
});

app.post('/api/items/:id/bought', authMember, (req, res) => {
  const item = loadItem(req);
  if (!item) return res.status(404).json({ error: 'Item nicht gefunden.' });
  if (item.member_id === req.member.id) return res.status(403).json({ error: 'Eigene Items können nicht als gekauft markiert werden.' });
  db.prepare('UPDATE items SET bought = 1, bought_by = ?, reserved_by = ? WHERE id = ?').run(req.member.id, req.member.id, item.id);
  res.json(groupState(req.member));
});

app.post('/api/items/:id/unbought', authMember, (req, res) => {
  const item = loadItem(req);
  if (!item) return res.status(404).json({ error: 'Item nicht gefunden.' });
  if (item.bought_by !== req.member.id) return res.status(403).json({ error: 'Nur die Person, die gekauft hat, kann das zurücknehmen.' });
  db.prepare('UPDATE items SET bought = 0, bought_by = NULL, reserved_by = NULL WHERE id = ?').run(item.id);
  res.json(groupState(req.member));
});

app.post('/api/upload', authMember, (req, res) => {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
  if (!match) return res.status(400).json({ error: 'Bitte eine Bilddatei (PNG/JPG/WebP/GIF) hochladen.' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Bild ist zu groß (max. 8 MB).' });
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  res.json({ imageUrl: `/uploads/${fileName}` });
});

app.listen(PORT, () => {
  console.log(`Wunschzettel läuft auf http://localhost:${PORT}`);
});
