// Express app (routes only — no listen). Used by:
//   - api/[...path].js  (Vercel serverless)
//   - server.js         (local dev, adds static + listen)
import express from 'express';
import { all, get, run } from './db.js';
import { ensureReady } from './seed.js';

const CATEGORY_META = {
  casino:     { label: 'Casinos',     singular: 'Casino',     icon: '🎰', color: 'pink' },
  restaurant: { label: 'Restaurants', singular: 'Restaurant', icon: '🍽️', color: 'purple' },
  speakeasy:  { label: 'Speakeasies', singular: 'Speakeasy',  icon: '🔐', color: 'gold' },
  buffet:     { label: 'Buffets',     singular: 'Buffet',     icon: '🥂', color: 'teal' },
  show:       { label: 'Shows',       singular: 'Show',       icon: '🎭', color: 'red' },
  activity:   { label: 'Activities',  singular: 'Activity',   icon: '🎳', color: 'pink' },
};
const PILL_TO_CATEGORIES = { all: null, casinos: ['casino'], food: ['restaurant', 'buffet'], bars: ['speakeasy'] };

const safeJson = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
function rowToListing(r) {
  if (!r) return r;
  const out = {
    ...r,
    tags: safeJson(r.tags, []),
    featured: !!r.featured,
    tams_pick: !!r.tams_pick,
    category_meta: CATEGORY_META[r.category] || { label: r.category, singular: r.category, icon: '⭐', color: 'pink' },
  };
  if (r.jackpot) out.jackpot = safeJson(r.jackpot, null);
  return out;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asyncH = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function refreshGiveaway() {
  const g = await get('SELECT * FROM giveaway WHERE active = 1 ORDER BY id DESC LIMIT 1');
  if (!g) return null;
  if (new Date(g.ends_at).getTime() <= Date.now()) {
    const endsAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    await run('UPDATE giveaway SET ends_at = ? WHERE id = ?', [endsAt, g.id]);
    g.ends_at = endsAt;
  }
  return g;
}

const app = express();
app.use(express.json());

const api = express.Router();
// Ensure schema + seed before any API call (cheap once warm).
api.use((req, res, next) => {
  ensureReady().then(() => next()).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'Database not ready' });
  });
});

api.get('/health', asyncH(async (_req, res) => res.json({ ok: true, time: new Date().toISOString() })));

api.get('/listings', asyncH(async (req, res) => {
  const { q, category, pill, featured, tams_pick } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const where = [];
  const args = [];
  if (q && String(q).trim()) {
    where.push('(name LIKE ? OR city LIKE ? OR state LIKE ? OR blurb LIKE ? OR description LIKE ? OR tags LIKE ? OR category LIKE ?)');
    const like = `%${String(q).trim()}%`;
    for (let i = 0; i < 7; i++) args.push(like);
  }
  let cats = null;
  if (category) cats = [category];
  else if (pill && PILL_TO_CATEGORIES[String(pill).toLowerCase()] !== undefined) cats = PILL_TO_CATEGORIES[String(pill).toLowerCase()];
  if (cats && cats.length) {
    where.push(`category IN (${cats.map(() => '?').join(',')})`);
    cats.forEach(c => args.push(c));
  }
  if (featured === '1') where.push('featured = 1');
  if (tams_pick === '1') where.push('tams_pick = 1');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await get(`SELECT COUNT(*) AS n FROM listings ${whereSql}`, args);
  const rows = await all(`SELECT * FROM listings ${whereSql} ORDER BY rating DESC, name ASC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  res.json({ total: totalRow.n, count: rows.length, results: rows.map(rowToListing) });
}));

api.get('/listings/:id', asyncH(async (req, res) => {
  const row = await get('SELECT * FROM listings WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Listing not found' });
  res.json(rowToListing(row));
}));

api.get('/categories', asyncH(async (_req, res) => {
  const rows = await all('SELECT category, COUNT(*) AS count FROM listings GROUP BY category');
  const byCat = Object.fromEntries(rows.map(r => [r.category, r.count]));
  const categories = Object.entries(CATEGORY_META).map(([key, meta]) => ({ key, ...meta, count: byCat[key] || 0 }));
  res.json({ categories });
}));

api.get('/happy-hours', asyncH(async (_req, res) => {
  res.json({ happy_hours: await all('SELECT * FROM happy_hours ORDER BY id') });
}));

api.get('/featured', asyncH(async (_req, res) => {
  const main = await get("SELECT * FROM listings WHERE featured = 1 AND featured_slot = 'main' ORDER BY rating DESC LIMIT 1");
  const small = await all("SELECT * FROM listings WHERE featured = 1 AND featured_slot = 'small' ORDER BY rating DESC");
  res.json({ main: rowToListing(main), small: small.map(rowToListing) });
}));

api.get('/picks', asyncH(async (_req, res) => {
  const rows = await all('SELECT * FROM listings WHERE tams_pick = 1 ORDER BY tam_rating DESC, rating DESC');
  res.json({ picks: rows.map(rowToListing) });
}));

api.get('/road-trips', asyncH(async (_req, res) => {
  const rows = await all('SELECT * FROM road_trips ORDER BY id');
  res.json({ road_trips: rows.map(r => ({ ...r, tags: safeJson(r.tags, []) })) });
}));

api.get('/merch', asyncH(async (_req, res) => {
  res.json({ merch: await all('SELECT * FROM merch ORDER BY id') });
}));

api.get('/jackpot', asyncH(async (_req, res) => {
  const row = await get('SELECT * FROM listings WHERE jackpot IS NOT NULL ORDER BY rating DESC LIMIT 1');
  if (!row) return res.status(404).json({ error: 'No jackpot set' });
  res.json({ jackpot: rowToListing(row) });
}));

api.get('/giveaway', asyncH(async (_req, res) => {
  const g = await refreshGiveaway();
  if (!g) return res.status(404).json({ error: 'No active giveaway' });
  res.json({ giveaway: g });
}));

api.get('/ticker', asyncH(async (_req, res) => {
  const rows = await all('SELECT text FROM ticker ORDER BY id');
  res.json({ ticker: rows.map(r => r.text) });
}));

api.get('/stats', asyncH(async (_req, res) => {
  const venues = (await get('SELECT COUNT(*) AS n FROM listings')).n;
  const states = (await get('SELECT COUNT(DISTINCT state) AS n FROM listings')).n;
  const avg = (await get('SELECT ROUND(AVG(rating),1) AS a FROM listings')).a;
  const members = (await get('SELECT COUNT(*) AS n FROM subscribers')).n;
  res.json({ venues_listed: venues, states_covered: states, avg_rating: avg, community_members: members });
}));

api.post('/newsletter', asyncH(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address' });
  try {
    await run('INSERT INTO subscribers (email, source) VALUES (?, ?)', [email, req.body?.source || 'newsletter']);
    res.json({ ok: true, message: "🎰 You're in! Welcome to the Jackpot Drop!" });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json({ ok: true, message: "You're already on the list — see you Friday! 🎰", already: true });
    throw e;
  }
}));

api.post('/giveaway/enter', asyncH(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address' });
  const g = await refreshGiveaway();
  if (!g) return res.status(404).json({ ok: false, error: 'No active giveaway' });
  try {
    await run('INSERT INTO giveaway_entries (email, giveaway_id) VALUES (?, ?)', [email, g.id]);
    try { await run('INSERT INTO subscribers (email, source) VALUES (?, ?)', [email, 'giveaway']); } catch {}
    res.json({ ok: true, message: "🎁 You're entered! Winner announced Sunday." });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json({ ok: true, message: "You're already entered — good luck! 🍀", already: true });
    throw e;
  }
}));

app.use('/api', api);

export default app;
