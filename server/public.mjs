import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { root } from '../scripts/compile.mjs';
import { readJson, writeJson } from './storage.mjs';
import { portFor } from './http.mjs';
import { publicSettingsFile } from './public-access.mjs';

export function initializePublicSettings(file = publicSettingsFile()) {
  const existing = readJson(file, null);
  if (existing) return existing;
  const settings = {
    version: 1,
    origin: null,
    accessCode: randomBytes(12).toString('hex'),
    gatewaySecret: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  writeJson(file, settings);
  return settings;
}
export function createPublicGateway({
  settingsFile = publicSettingsFile(),
  fetchImpl = fetch,
  usageFile = path.join(path.dirname(settingsFile), 'public-usage.json'),
} = {}) {
  initializePublicSettings(settingsFile);
  const app = express();
  app.disable('x-powered-by');
  const sessions = new Map(),
    rates = new Map();
  const limits = { ai: 20, writes: 80 };
  const usage = readJson(usageFile, { day: '', ai: 0, writes: 0 });
  let activeMutations = 0;
  const consumeQuota = (key) => {
    const day = new Date().toISOString().slice(0, 10);
    if (usage.day !== day) Object.assign(usage, { day, ai: 0, writes: 0 });
    if (usage[key] >= limits[key]) return false;
    usage[key]++;
    writeJson(usageFile, usage);
    return true;
  };
  const rate = (id, max, windowMs) => {
    const now = Date.now(),
      old = rates.get(id);
    const current = old && old.until > now ? old : { count: 0, until: now + windowMs };
    rates.set(id, current);
    if (rates.size > 3000) for (const [k, v] of rates) if (v.until <= now) rates.delete(k);
    if (current.count >= max) return false;
    current.count++;
    return true;
  };
  app.use((req, res, next) => {
    const settings = readJson(settingsFile, null);
    const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname);
    const publicHost = settings.origin && new URL(settings.origin).hostname;
    if (!isLocal && req.hostname !== publicHost)
      return res.status(403).json({ code: 'HOST_DENIED', error: '访问域名未配置' });
    req.publicOrigin = isLocal ? `http://${req.get('host')}` : settings.origin;
    const origin = req.get('origin');
    if (origin && origin !== req.publicOrigin)
      return res.status(403).json({ code: 'ORIGIN_DENIED', error: '请求来源不匹配' });
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && origin !== req.publicOrigin)
      return res.status(403).json({ code: 'ORIGIN_REQUIRED', error: '请通过演示页面发起操作' });
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; connect-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    res.set('Cache-Control', 'no-store');
    const ip = createHash('sha256')
      .update(req.get('cf-connecting-ip') || req.socket.remoteAddress || 'unknown')
      .digest('hex');
    req.clientId = ip;
    if (!rate(ip + ':requests', 120, 60000))
      return res.status(429).json({ code: 'RATE_LIMIT', error: '请求过于频繁，请稍后再试' });
    next();
  });
  app.use(express.json({ limit: '96kb' }));
  const getSession = (req) => {
    const cookie = req.get('cookie') || '',
      match = cookie.match(/(?:^|;\s*)ap_demo=([a-f0-9]{64})(?:;|$)/);
    const s = match && sessions.get(match[1]);
    return s && s.until > Date.now() ? s : null;
  };
  app.get('/public/session', (req, res) =>
    res.json({ authenticated: Boolean(getSession(req)), mode: 'protected-demo' }),
  );
  app.post('/public/login', (req, res) => {
    if (!rate(req.clientId + ':login', 6, 300000))
      return res
        .status(429)
        .json({ code: 'LOGIN_RATE_LIMIT', error: '尝试次数过多，请五分钟后重试' });
    const settings = readJson(settingsFile, null),
      provided = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const a = Buffer.from(provided),
      b = Buffer.from(settings.accessCode);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return res.status(401).json({ code: 'INVALID_ACCESS_CODE', error: '演示访问码不正确' });
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { id, until: Date.now() + 4 * 3600000 });
    for (const [k, v] of sessions) if (v.until < Date.now()) sessions.delete(k);
    res.cookie('ap_demo', id, {
      httpOnly: true,
      secure: req.publicOrigin.startsWith('https:'),
      sameSite: 'strict',
      maxAge: 4 * 3600000,
      path: '/',
    });
    res.json({ authenticated: true });
  });
  app.post('/public/logout', (req, res) => {
    const session = getSession(req);
    if (session) sessions.delete(session.id);
    res.clearCookie('ap_demo', { path: '/' });
    res.json({ ok: true });
  });
  const requireSession = (req, res, next) =>
    getSession(req)
      ? next()
      : res.status(401).json({ code: 'PUBLIC_LOGIN_REQUIRED', error: '请先输入演示访问码' });
  const allowedGet = new Set([
    '/api/health',
    '/api/config',
    '/api/state',
    '/api/session',
    '/api/tasks',
  ]);
  const allowedPost = new Set([
    '/api/grants',
    '/api/grants/revoke',
    '/api/verify',
    '/api/wallet/challenge',
    '/api/wallet/login',
    '/api/wallet/logout',
    '/api/wallet/prepare',
    '/api/wallet/execute',
    '/api/save',
    '/api/run',
    '/api/probe',
  ]);
  for (const [prefix, role] of [
    ['/api', 'vault'],
    ['/research-api', 'research'],
    ['/writer-api', 'writer'],
  ])
    app.use(prefix, requireSession, async (req, res) => {
      const pathname = '/api' + req.path;
      if (
        !(
          req.method === 'GET' &&
          (allowedGet.has(pathname) || /^\/api\/memories\/0x[0-9a-fA-F]{64}$/.test(pathname))
        ) &&
        !(req.method === 'POST' && allowedPost.has(pathname))
      )
        return res
          .status(403)
          .json({ code: 'PUBLIC_ROUTE_DENIED', error: '该接口不通过公网演示开放' });
      if (pathname === '/api/session') return res.json({ token: 'public-session' });
      let mutating = false;
      let aiReservation;
      try {
        const vaultBase = `http://127.0.0.1:${portFor('vault')}`;
        const config = await (
          await fetchImpl(vaultBase + '/api/config', { signal: AbortSignal.timeout(10000) })
        ).json();
        const queryId = Number(req.query.agentId) || null,
          bodyId = Number(req.body?.agentId) || null;
        if (queryId && bodyId && queryId !== bodyId)
          return res.status(400).json({ code: 'WORKSPACE_MISMATCH', error: '工作空间参数不一致' });
        const agentId = bodyId || queryId || config.agentId;
        if (agentId !== config.agentId) {
          const check = await fetchImpl(vaultBase + '/api/wallet/authorize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Wallet-Token': req.get('x-wallet-token') || '',
            },
            body: JSON.stringify({ agentId }),
            signal: AbortSignal.timeout(10000),
          });
          if (!check.ok) return res.status(check.status).json(await check.json());
        }
        if (
          req.method === 'POST' &&
          ![
            '/api/verify',
            '/api/wallet/challenge',
            '/api/wallet/login',
            '/api/wallet/logout',
            '/api/wallet/prepare',
          ].includes(pathname)
        ) {
          if (activeMutations >= 2)
            return res
              .status(429)
              .json({ code: 'PUBLIC_BUSY', error: '演示正在处理其他操作，请稍后再试' });
          if (pathname === '/api/run') {
            const key = getSession(req).id + ':ai';
            if (!rate(key, 2, 60000))
              return res
                .status(429)
                .json({ code: 'AI_RATE_LIMIT', error: '每分钟最多运行两次写作任务，请稍后重试' });
            aiReservation = {
              key,
              rate: rates.get(key),
              day: new Date().toISOString().slice(0, 10),
              quota: false,
            };
          }
          if (!consumeQuota('writes') || (pathname === '/api/run' && !consumeQuota('ai')))
            return res
              .status(429)
              .json({ code: 'DEMO_QUOTA', error: '今日公网演示额度已用完，请联系项目作者' });
          if (aiReservation) aiReservation.quota = true;
          activeMutations++;
          mutating = true;
        }
        const backend = `http://127.0.0.1:${portFor(role)}`;
        let adminToken;
        if (req.method === 'POST' || pathname.startsWith('/api/memories/'))
          adminToken = (await (await fetchImpl(backend + '/api/session')).json()).token;
        const settings = readJson(settingsFile, null);
        const headers = {
          'Content-Type': 'application/json',
          Origin: settings.origin,
          'X-Public-Gateway': settings.gatewaySecret,
          ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
          ...(req.get('x-wallet-token') ? { 'X-Wallet-Token': req.get('x-wallet-token') } : {}),
        };
        const response = await fetchImpl(backend + '/api' + req.url, {
          method: req.method,
          headers,
          signal: AbortSignal.timeout(110000),
          ...(req.method === 'GET' ? {} : { body: JSON.stringify(req.body) }),
        });
        const result = await response.json();
        // These errors occur before model inference. Release only this request's
        // reservation; the general request rate limit still prevents repeated abuse.
        if (
          aiReservation &&
          [400, 403].includes(response.status) &&
          [
            'NO_GRANT',
            'REVOKED',
            'EXPIRED',
            'EXHAUSTED',
            'WRONG_APPLICATION',
            'INVALID_AGENT',
            'INVALID_MEMORY',
            'VALIDATION_ERROR',
          ].includes(result.code)
        ) {
          if (rates.get(aiReservation.key) === aiReservation.rate)
            aiReservation.rate.count = Math.max(0, aiReservation.rate.count - 1);
          if (aiReservation.quota && usage.day === aiReservation.day) {
            usage.ai = Math.max(0, usage.ai - 1);
            writeJson(usageFile, usage);
          }
        }
        if (response.ok && pathname === '/api/config') {
          result.publicMode = true;
          result.vaultUrl = req.publicOrigin;
          result.rpcUrl =
            result.mode === 'monad' ? 'https://testnet-rpc.monad.xyz' : req.publicOrigin + '/rpc';
          result.appUrls = {
            research: req.publicOrigin + '/apps/research',
            writer: req.publicOrigin + '/apps/writer',
          };
        }
        res.status(response.status).json(result);
      } catch (error) {
        console.error('Public gateway request failed:', error.name);
        res
          .status(502)
          .json({ code: 'PUBLIC_SERVICE_ERROR', error: '演示服务暂时不可用，请稍后重试' });
      } finally {
        if (
          aiReservation &&
          !aiReservation.quota &&
          rates.get(aiReservation.key) === aiReservation.rate
        )
          aiReservation.rate.count = Math.max(0, aiReservation.rate.count - 1);
        if (mutating) activeMutations--;
      }
    });
  for (const [url, role] of [
    ['/', null],
    ['/apps/research', 'research'],
    ['/apps/writer', 'writer'],
  ])
    app.get(url, (req, res) => {
      const meta = `<meta name="agentpassport-public" content="true"/>${role ? `<meta name="agentpassport-role" content="${role}"/>` : ''}`;
      res
        .type('html')
        .send(
          readFileSync(path.join(root, 'dist/index.html'), 'utf8').replace(
            '</head>',
            meta + '</head>',
          ),
        );
    });
  app.use(
    '/assets',
    express.static(path.join(root, 'dist/assets'), { dotfiles: 'deny', index: false }),
  );
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(root, 'dist/favicon.svg')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ code: 'INVALID_PUBLIC_REQUEST', error: '请求格式或大小不符合要求' });
  });
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  createPublicGateway().listen(Number(process.env.PUBLIC_PORT || 4394), '127.0.0.1', () =>
    console.log(
      'Protected public gateway ready on localhost; use npm run public to create the tunnel.',
    ),
  );
