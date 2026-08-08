// Schema + seeding, shared by the app (lazy self-seed) and scripts/seed.mjs (manual reseed).
// Content auto-reseeds whenever data/seed.json's "version" changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, run, get } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', 'data', 'seed.json');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, category TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🎰', rating REAL NOT NULL DEFAULT 0,
  price_label TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0, featured_slot TEXT,
  tams_pick INTEGER NOT NULL DEFAULT 0, tam_quote TEXT, tam_rating REAL,
  badge TEXT, thumb_class TEXT NOT NULL DEFAULT 'g1',
  password_hint TEXT, reservation TEXT, jackpot TEXT,
  image_url TEXT, image_credit TEXT
);
CREATE TABLE IF NOT EXISTS happy_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT NOT NULL, city TEXT NOT NULL, time_range TEXT NOT NULL, deal TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT 'pink'
);
CREATE TABLE IF NOT EXISTS road_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '🚗', distance_label TEXT NOT NULL DEFAULT '',
  blurb TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', accent TEXT NOT NULL DEFAULT 'v',
  image_url TEXT
);
CREATE TABLE IF NOT EXISTS merch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, price REAL NOT NULL, emoji TEXT NOT NULL DEFAULT '🛍️',
  badge TEXT, thumb_class TEXT NOT NULL DEFAULT 'm1', sold_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS giveaway (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, prize TEXT NOT NULL, ends_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ticker (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'newsletter',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, giveaway_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email, giveaway_id)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS reseed_lock (
  tag TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function loadSeedData() {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8'));
}

// Add columns that may not exist on databases seeded by an older version.
async function migrate() {
  const adds = [
    'ALTER TABLE listings ADD COLUMN image_url TEXT',
    'ALTER TABLE listings ADD COLUMN image_credit TEXT',
    'ALTER TABLE road_trips ADD COLUMN image_url TEXT',
  ];
  for (const sql of adds) { try { await run(sql); } catch { /* column already exists */ } }
}

// Insert all content rows (assumes content tables are empty).
export async function insertContent(data) {
  const defCredit = data.image_default_credit || null;
  const batch = [];
  for (const l of data.listings) {
    batch.push({
      sql: `INSERT INTO listings
        (name,category,city,state,blurb,description,emoji,rating,price_label,tags,
         featured,featured_slot,tams_pick,tam_quote,tam_rating,badge,thumb_class,
         password_hint,reservation,jackpot,image_url,image_credit)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        l.name, l.category, l.city, l.state, l.blurb || '', l.description || '',
        l.emoji || '🎰', l.rating || 0, l.price_label || '', JSON.stringify(l.tags || []),
        l.featured ? 1 : 0, l.featured_slot ?? null, l.tams_pick ? 1 : 0,
        l.tam_quote ?? null, l.tam_rating ?? null, l.badge ?? null, l.thumb_class || 'g1',
        l.password_hint ?? null, l.reservation ?? null, l.jackpot ? JSON.stringify(l.jackpot) : null,
        l.image_url ?? null, l.image_credit ?? (l.image_url ? defCredit : null),
      ],
    });
  }
  for (const h of data.happy_hours) batch.push({ sql: `INSERT INTO happy_hours (venue,city,time_range,deal,accent) VALUES (?,?,?,?,?)`, args: [h.venue, h.city, h.time_range, h.deal, h.accent || 'pink'] });
  for (const t of data.road_trips) batch.push({ sql: `INSERT INTO road_trips (name,emoji,distance_label,blurb,tags,accent,image_url) VALUES (?,?,?,?,?,?,?)`, args: [t.name, t.emoji, t.distance_label, t.blurb, JSON.stringify(t.tags || []), t.accent || 'v', t.image_url ?? null] });
  for (const m of data.merch) batch.push({ sql: `INSERT INTO merch (name,price,emoji,badge,thumb_class,sold_count) VALUES (?,?,?,?,?,?)`, args: [m.name, m.price, m.emoji, m.badge ?? null, m.thumb_class || 'm1', m.sold_count || 0] });
  for (const t of data.ticker) batch.push({ sql: `INSERT INTO ticker (text) VALUES (?)`, args: [t] });
  const g = data.giveaway;
  const endsAt = new Date(Date.now() + (g.duration_hours || 72) * 3600 * 1000).toISOString();
  batch.push({ sql: `INSERT INTO giveaway (title,prize,ends_at,active) VALUES (?,?,?,1)`, args: [g.title, g.prize, endsAt] });
  await db.batch(batch, 'write');
  return data.listings.length;
}

// Wipe content tables and re-insert. Leaves subscribers/entries alone.
async function reseedContent(data) {
  for (const t of ['listings', 'happy_hours', 'road_trips', 'merch', 'giveaway', 'ticker']) {
    await run(`DELETE FROM ${t}`);
  }
  return insertContent(data);
}

// Manual reseed (npm run seed).
export async function reseed() {
  await db.executeMultiple(SCHEMA);
  await migrate();
  const data = loadSeedData();
  const n = await reseedContent(data);
  await run("INSERT INTO meta (key,value) VALUES ('content_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(data.version || '1')]);
  return n;
}

// Lazy init used by the app: ensure schema, migrate, and (re)seed when the
// seed version changes or the DB is empty. A row in reseed_lock keyed by the
// version stops two cold-starting functions from seeding at once.
let readyPromise = null;
export function ensureReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}
async function init() {
  await db.executeMultiple(SCHEMA);
  await migrate();
  const data = loadSeedData();
  const version = String(data.version || '1');
  const cur = await get("SELECT value FROM meta WHERE key='content_version'");
  const count = await get('SELECT COUNT(*) AS n FROM listings');
  if (cur && cur.value === version && count && count.n > 0) return; // already current
  try {
    await run('INSERT INTO reseed_lock (tag) VALUES (?)', ['seed:' + version]); // acquire
  } catch {
    return; // another instance is (re)seeding this version
  }
  await reseedContent(data);
  await run("INSERT INTO meta (key,value) VALUES ('content_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [version]);
}
