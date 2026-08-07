// Schema + seeding, shared by the app (lazy self-seed) and scripts/seed.mjs (manual reseed).
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
  password_hint TEXT, reservation TEXT, jackpot TEXT
);
CREATE TABLE IF NOT EXISTS happy_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT NOT NULL, city TEXT NOT NULL, time_range TEXT NOT NULL, deal TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT 'pink'
);
CREATE TABLE IF NOT EXISTS road_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '🚗', distance_label TEXT NOT NULL DEFAULT '',
  blurb TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', accent TEXT NOT NULL DEFAULT 'v'
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
CREATE TABLE IF NOT EXISTS seed_lock (
  id INTEGER PRIMARY KEY, seeded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function loadSeedData() {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8'));
}

// Insert all content rows (assumes content tables are empty).
export async function insertContent(data) {
  const batch = [];
  for (const l of data.listings) {
    batch.push({
      sql: `INSERT INTO listings
        (name,category,city,state,blurb,description,emoji,rating,price_label,tags,
         featured,featured_slot,tams_pick,tam_quote,tam_rating,badge,thumb_class,
         password_hint,reservation,jackpot)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        l.name, l.category, l.city, l.state, l.blurb || '', l.description || '',
        l.emoji || '🎰', l.rating || 0, l.price_label || '', JSON.stringify(l.tags || []),
        l.featured ? 1 : 0, l.featured_slot ?? null, l.tams_pick ? 1 : 0,
        l.tam_quote ?? null, l.tam_rating ?? null, l.badge ?? null, l.thumb_class || 'g1',
        l.password_hint ?? null, l.reservation ?? null, l.jackpot ? JSON.stringify(l.jackpot) : null,
      ],
    });
  }
  for (const h of data.happy_hours) batch.push({ sql: `INSERT INTO happy_hours (venue,city,time_range,deal,accent) VALUES (?,?,?,?,?)`, args: [h.venue, h.city, h.time_range, h.deal, h.accent || 'pink'] });
  for (const t of data.road_trips) batch.push({ sql: `INSERT INTO road_trips (name,emoji,distance_label,blurb,tags,accent) VALUES (?,?,?,?,?,?)`, args: [t.name, t.emoji, t.distance_label, t.blurb, JSON.stringify(t.tags || []), t.accent || 'v'] });
  for (const m of data.merch) batch.push({ sql: `INSERT INTO merch (name,price,emoji,badge,thumb_class,sold_count) VALUES (?,?,?,?,?,?)`, args: [m.name, m.price, m.emoji, m.badge ?? null, m.thumb_class || 'm1', m.sold_count || 0] });
  for (const t of data.ticker) batch.push({ sql: `INSERT INTO ticker (text) VALUES (?)`, args: [t] });
  const g = data.giveaway;
  const endsAt = new Date(Date.now() + (g.duration_hours || 72) * 3600 * 1000).toISOString();
  batch.push({ sql: `INSERT INTO giveaway (title,prize,ends_at,active) VALUES (?,?,?,1)`, args: [g.title, g.prize, endsAt] });
  await db.batch(batch, 'write');
  return data.listings.length;
}

// Destructive reseed: wipe content tables, re-insert. Leaves subscribers/entries alone.
export async function reseed() {
  await db.executeMultiple(SCHEMA);
  for (const t of ['listings', 'happy_hours', 'road_trips', 'merch', 'giveaway', 'ticker']) {
    await run(`DELETE FROM ${t}`);
  }
  return insertContent(loadSeedData());
}

// Lazy init used by the app: ensure schema, and seed once if the DB is empty.
// A UNIQUE row in seed_lock prevents two cold-starting functions from double-seeding.
let readyPromise = null;
export function ensureReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}
async function init() {
  await db.executeMultiple(SCHEMA);
  const count = await get('SELECT COUNT(*) AS n FROM listings');
  if (count && count.n > 0) return;
  try {
    await run('INSERT INTO seed_lock (id) VALUES (1)'); // acquire lock (fails if taken)
  } catch {
    return; // another instance is seeding
  }
  await insertContent(loadSeedData());
}
