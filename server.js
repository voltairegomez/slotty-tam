// Local dev server: serves the static site + mounts the same API used on Vercel.
// Run: npm start   (reads TURSO_* from env, or falls back to a local file DB)
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import app from './lib/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Serve the static front-end from the project root.
app.use(express.static(__dirname));
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'index.html')));

app.listen(PORT, () => {
  const target = process.env.TURSO_DATABASE_URL || '(none set — set TURSO_DATABASE_URL)';
  console.log(`\n🎰 Slotty Tam running at http://localhost:${PORT}`);
  console.log(`   Database: ${target}\n`);
});
