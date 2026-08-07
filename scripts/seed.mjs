// Manual reseed: wipes content tables and re-inserts from data/seed.json.
// Subscriber and giveaway-entry data are preserved.
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/seed.mjs
import { reseed } from '../lib/seed.js';

reseed()
  .then(n => { console.log(`Reseeded ${n} listings + happy hours, road trips, merch, ticker, giveaway.`); process.exit(0); })
  .catch(e => { console.error('Seed failed:', e); process.exit(1); });
