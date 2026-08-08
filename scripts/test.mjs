// Smoke test: runs the app against a throwaway local libSQL file (same code path as Turso),
// exercises every endpoint, and asserts real behaviour incl. self-seed + persistence.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3987;
const BASE = `http://localhost:${PORT}`;
const DB_FILE = join(ROOT, 'test.local.db');
rmSync(DB_FILE, { force: true });

let passed = 0, failed = 0;
const ok = (c, m) => c ? (passed++, console.log(`  ✓ ${m}`)) : (failed++, console.error(`  ✗ ${m}`));

const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: `file:${DB_FILE}`, TURSO_AUTH_TOKEN: '' },
  stdio: 'ignore',
});

const get = async p => (await fetch(`${BASE}${p}`)).json();
const post = async (p, b) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };

async function waitHealth(n = 50) { for (let i = 0; i < n; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error('server did not start'); }

try {
  await waitHealth();
  console.log('\nSlotty Tam (Turso build) tests\n');

  const cats = await get('/api/categories');
  ok(cats.categories.length === 6, 'self-seed populated categories (6 groups)');
  ok(cats.categories.every(c => c.count > 0), 'every category has listings');

  const all = await get('/api/listings');
  ok(all.total >= 20, `listings present (${all.total})`);

  const lj = await get('/api/listings?q=la jolla');
  ok(lj.results.length > 0 && lj.results.every(r => /la jolla/i.test([r.city, r.blurb, r.description, r.tags.join(' ')].join(' '))), 'free-text search works');

  ok(all.results.every(r => typeof r.image_url === 'string' && r.image_url.startsWith('http')), 'every listing has an image URL');
  const sd = await get('/api/listings?q=san diego');
  ok(sd.total >= 10, `San Diego venues present (${sd.total})`);

  const food = await get('/api/listings?pill=food');
  ok(food.results.every(r => ['restaurant', 'buffet'].includes(r.category)), 'pill=food maps to restaurant+buffet');

  const spk = await get('/api/listings?category=speakeasy');
  ok(spk.results.length && spk.results.every(r => r.category === 'speakeasy'), 'category filter works');
  ok(spk.results[0].category_meta.singular === 'Speakeasy', 'singular label correct');

  ok((await get('/api/featured')).main?.name, 'featured has a main card');
  ok((await get('/api/picks')).picks.every(p => p.tams_pick), 'picks are Tam picks');
  ok((await get('/api/jackpot')).jackpot?.jackpot, 'jackpot has details');
  ok(new Date((await get('/api/giveaway')).giveaway.ends_at) > new Date(), 'giveaway ends in future');

  const email = `t_${Date.now()}@example.com`;
  ok((await post('/api/newsletter', { email })).data.ok, 'newsletter accepts new email');
  ok((await post('/api/newsletter', { email })).data.already === true, 'newsletter dedupes');
  ok((await post('/api/newsletter', { email: 'bad' })).status === 400, 'newsletter rejects invalid');

  const before = (await get('/api/stats')).community_members;
  await post('/api/newsletter', { email: `c_${Date.now()}@example.com` });
  ok((await get('/api/stats')).community_members === before + 1, 'stats reflect persisted signups');

  ok((await post('/api/giveaway/enter', { email: `w_${Date.now()}@example.com` })).data.ok, 'giveaway entry works');
  ok((await fetch(`${BASE}/api/listings/999999`)).status === 404, 'unknown listing -> 404');

  console.log(`\n${passed} passed, ${failed} failed\n`);
} catch (e) {
  console.error('Test error:', e.message); failed++;
} finally {
  server.kill();
  rmSync(DB_FILE, { force: true });
  process.exit(failed ? 1 : 0);
}
