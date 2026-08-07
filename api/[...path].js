// Vercel serverless entry: routes every /api/* request through the Express app.
import app from '../lib/app.js';

export default function handler(req, res) {
  // Defensive: ensure Express sees the /api-prefixed path it registers routes under.
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? '' : '/') + req.url;
  }
  return app(req, res);
}
