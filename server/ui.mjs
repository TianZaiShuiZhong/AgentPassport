import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { root } from '../scripts/compile.mjs';
import { portFor } from './http.mjs';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '96kb' }));
for (const [prefix, role] of [
  ['/api', 'vault'],
  ['/research-api', 'research'],
  ['/writer-api', 'writer'],
]) {
  app.use(prefix, async (req, res) => {
    try {
      const origin = req.get('origin');
      const response = await fetch(`http://127.0.0.1:${portFor(role)}/api${req.url}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          ...(req.get('x-admin-token') ? { 'X-Admin-Token': req.get('x-admin-token') } : {}),
          ...(req.get('x-wallet-token') ? { 'X-Wallet-Token': req.get('x-wallet-token') } : {}),
        },
        ...(req.method === 'GET' ? {} : { body: JSON.stringify(req.body) }),
      });
      res
        .status(response.status)
        .set('Cache-Control', 'no-store')
        .send(await response.text());
    } catch {
      res.status(502).json({ error: '服务不可用' });
    }
  });
}
app.use(express.static(path.join(root, 'dist')));
app.get('/', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(Number(process.env.UI_PORT || 4390), '127.0.0.1');
