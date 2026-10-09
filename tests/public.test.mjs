import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPublicGateway, initializePublicSettings } from '../server/public.mjs';
import { writeJson } from '../server/storage.mjs';
import { trustedPublicRequest } from '../server/public-access.mjs';

test('public gateway protects credentials, workspace data and funded actions', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'agentpassport-public-')),
    file = path.join(dataDir, 'public-access.json');
  const settings = initializePublicSettings(file);
  let calls = [],
    denyRun = false,
    denyWallet = true;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    if (pathname === '/api/session') return Response.json({ token: 'REAL_BACKEND_SECRET_TOKEN' });
    if (pathname === '/api/config')
      return Response.json({
        agentId: 1,
        chainId: 10143,
        mode: 'monad',
        owner: '0xowner',
        vaultUrl: 'http://127.0.0.1:4391',
        rpcUrl: 'https://private-rpc.example/PRIVATE_KEY',
        appUrls: { research: 'http://127.0.0.1:4392', writer: 'http://127.0.0.1:4393' },
      });
    if (pathname === '/api/wallet/authorize')
      return Response.json(
        denyWallet ? { code: 'NOT_OWNER', error: 'Not owner' } : { authorized: true },
        { status: denyWallet ? 403 : 200 },
      );
    if (pathname === '/api/run')
      return denyRun
        ? Response.json({ code: 'NO_GRANT', error: 'No authorization' }, { status: 403 })
        : Response.json({ task: { output: { source: 'LLM' } } }, { status: 201 });
    return Response.json({ ok: true });
  };
  const app = createPublicGateway({ settingsFile: file, fetchImpl });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  settings.origin = base;
  writeJson(file, settings);
  let cookie;
  const call = async (endpoint, body, headers = {}) => {
    const r = await fetch(base + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    return { status: r.status, data, cookie: r.headers.get('set-cookie') };
  };
  try {
    await t.test(
      'anonymous users cannot read API, perform writes or obtain owner session',
      async () => {
        assert.equal((await call('/api/config')).status, 401);
        assert.equal((await call('/api/session')).status, 401);
        assert.equal((await call('/writer-api/run', { prompt: 'attack' })).status, 401);
        assert.equal(calls.length, 0);
      },
    );
    await t.test('login requires exact code and issues an HttpOnly SameSite session', async () => {
      assert.equal((await call('/public/login', { code: 'bad' })).status, 401);
      const r = await call('/public/login', { code: settings.accessCode });
      assert.equal(r.status, 200);
      assert.match(r.cookie, /HttpOnly/i);
      assert.match(r.cookie, /SameSite=Strict/i);
      cookie = r.cookie.split(';')[0];
      assert.equal((await call('/public/session')).data.authenticated, true);
    });
    await t.test('no backend session token or private RPC URL is sent to the browser', async () => {
      const session = await call('/api/session');
      assert.deepEqual(session.data, { token: 'public-session' });
      const config = await call('/api/config');
      assert.equal(config.data.publicMode, true);
      assert.equal(config.data.appUrls.writer, base + '/apps/writer');
      assert.equal(config.data.vaultUrl, base);
      assert.equal(config.data.rpcUrl, 'https://testnet-rpc.monad.xyz');
      assert.equal(JSON.stringify(config).includes('PRIVATE_KEY'), false);
    });
    await t.test(
      'deployment, source files, direct relay RPC and unknown endpoints are denied',
      async () => {
        for (const endpoint of [
          '/api/monad/deploy',
          '/api/monad/activate',
          '/api/access',
          '/api/ingest',
        ])
          assert.equal((await call(endpoint, {})).status, 403);
        for (const endpoint of ['/.env', '/.data/keys.json', '/server/runtime.mjs', '/rpc'])
          assert.equal((await call(endpoint)).status, 404);
      },
    );
    await t.test('foreign Origin, missing Origin and malicious host are rejected', async () => {
      assert.equal(
        (
          await call(
            '/public/login',
            { code: settings.accessCode },
            { Origin: 'https://evil.example' },
          )
        ).status,
        403,
      );
      const missing = await fetch(base + '/public/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: settings.accessCode }),
      });
      assert.equal(missing.status, 403);
      assert.equal(
        (await call('/api/config', undefined, { Origin: 'https://evil.example' })).status,
        403,
      );
    });
    await t.test(
      'wallet workspace requires its owner token and rejects conflicting agent IDs',
      async () => {
        assert.equal((await call('/api/state?agentId=2')).status, 403);
        assert.equal((await call('/writer-api/run?agentId=1', { agentId: 2 })).status, 400);
        denyWallet = false;
        assert.equal(
          (await call('/api/state?agentId=2', undefined, { 'X-Wallet-Token': 'owner-session' }))
            .status,
          200,
        );
      },
    );
    await t.test('only trusted gateway Origin with secret is accepted by internal services', () => {
      const old = process.env.PUBLIC_CONFIG_FILE;
      process.env.PUBLIC_CONFIG_FILE = file;
      try {
        const request = (headers) => ({ get: (name) => headers[name] });
        assert.equal(
          trustedPublicRequest(
            request({ origin: base, 'x-public-gateway': settings.gatewaySecret }),
          ),
          true,
        );
        assert.equal(
          trustedPublicRequest(request({ origin: base, 'x-public-gateway': 'forged' })),
          false,
        );
        assert.equal(
          trustedPublicRequest(
            request({ origin: 'https://evil.example', 'x-public-gateway': settings.gatewaySecret }),
          ),
          false,
        );
      } finally {
        if (old === undefined) delete process.env.PUBLIC_CONFIG_FILE;
        else process.env.PUBLIC_CONFIG_FILE = old;
      }
    });
    await t.test('AI calls use internal tokens, then enforce a request limit', async () => {
      calls = [];
      denyRun = true;
      for (let i = 0; i < 3; i++)
        assert.equal((await call('/writer-api/run', { agentId: 1, prompt: 'denied' })).status, 403);
      denyRun = false;
      calls = [];
      for (let i = 0; i < 2; i++)
        assert.equal((await call('/writer-api/run', { agentId: 1, prompt: 'demo' })).status, 201);
      assert.equal((await call('/writer-api/run', { agentId: 1, prompt: 'too much' })).status, 429);
      const proxied = calls.filter((c) => c.url.endsWith('/api/run'));
      assert.equal(proxied.length, 2);
      assert.equal(proxied[0].options.headers['X-Admin-Token'], 'REAL_BACKEND_SECRET_TOKEN');
      assert.equal(proxied[0].options.headers['X-Public-Gateway'], settings.gatewaySecret);
      const { readJson } = await import('../server/storage.mjs');
      assert.equal(readJson(path.join(dataDir, 'public-usage.json')).ai, 2);
    });
    await t.test('logout immediately invalidates the public session', async () => {
      assert.equal((await call('/public/logout', {})).status, 200);
      assert.equal((await call('/api/config')).status, 401);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
