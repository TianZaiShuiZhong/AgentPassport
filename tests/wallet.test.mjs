import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createRuntime } from '../server/runtime.mjs';
import { createVaultApp } from '../server/vault.mjs';
import { AgentPassportClient } from '../sdk/index.mjs';
delete process.env.LLM_API_KEY;
test('wallet ownership and scoped signing flows', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'agentpassport-wallet-'));
  const r = await createRuntime({ dataDir, persistent: false, mode: 'local' });
  const server = createVaultApp(r).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (endpoint, body, token, admin = false) => {
    const response = await fetch(base + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Wallet-Token': token } : {}),
        ...(admin ? { 'X-Admin-Token': r.adminToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const owner = Wallet.createRandom(),
    attacker = Wallet.createRandom();
  const login = async (wallet) => {
    const c = await call('/api/wallet/challenge', { walletAddress: wallet.address });
    const signature = await wallet.signMessage(c.data.message);
    return call('/api/wallet/login', { id: c.data.id, signature });
  };
  const execute = async (wallet, token, operation, args = {}) => {
    const p = await call('/api/wallet/prepare', { operation, ...args }, token);
    assert.equal(p.status, 200, JSON.stringify(p.data));
    const signature = await wallet.signTypedData(p.data.domain, p.data.types, p.data.value);
    return call('/api/wallet/execute', { id: p.data.id, signature }, token);
  };
  let token, attackerToken, agentId, memory, grant;
  try {
    await t.test('challenge login is bound to the wallet and cannot be replayed', async () => {
      const c = await call('/api/wallet/challenge', { walletAddress: owner.address });
      const wrong = await call('/api/wallet/login', {
        id: c.data.id,
        signature: await attacker.signMessage(c.data.message),
      });
      assert.equal(wrong.status, 403);
      const signature = await owner.signMessage(c.data.message),
        logged = await call('/api/wallet/login', { id: c.data.id, signature });
      assert.equal(logged.status, 200);
      token = logged.data.token;
      assert.equal((await call('/api/wallet/login', { id: c.data.id, signature })).status, 403);
      attackerToken = (await login(attacker)).data.token;
      assert.equal(
        await r.contract.agentCount(),
        1n,
        'Logging in does not register or grant anything',
      );
    });
    await t.test('wallet owns the registered Agent; relay never becomes its owner', async () => {
      const result = await execute(owner, token, 'register', { allowResearch: true });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      agentId = result.data.workspace.agentId;
      const registered = await r.contract.agents(agentId);
      assert.equal(registered.owner, owner.address);
      assert.equal(registered.signer, owner.address);
      assert.notEqual(registered.owner, await r.owner.getAddress());
      assert.equal(await r.contract.ingestors(agentId), r.apps.research.address);
      const again = await call(
        '/api/wallet/prepare',
        { operation: 'register', allowResearch: true },
        token,
      );
      assert.equal(again.status, 403);
    });
    await t.test('research ingest uses separately granted write permission', async () => {
      const client = new AgentPassportClient({
        vaultUrl: base,
        provider: r.provider,
        contractAddress: r.state.contractAddress,
        privateKey: r.keys.research,
        chainId: 1337,
      });
      memory = (
        await client.saveMemory({
          agentId,
          kind: 'background',
          title: 'Wallet-owned context',
          content: 'This context belongs to the user wallet.',
        })
      ).memory;
      assert.equal(memory.agentId, agentId);
      assert.equal((await r.contract.memories(memory.id)).agentId, BigInt(agentId));
      const ownState = await call(`/api/state?agentId=${agentId}`);
      assert.equal(ownState.data.memories.length, 1);
      const demoState = await call('/api/state');
      assert.equal(
        demoState.data.memories.some((m) => m.id === memory.id),
        false,
      );
    });
    await t.test('owner preview rejects local admin and another wallet', async () => {
      assert.equal(
        (await call(`/api/memories/${memory.id}`, undefined, attackerToken)).status,
        401,
      );
      assert.equal(
        (await call(`/api/memories/${memory.id}`, undefined, undefined, true)).status,
        401,
      );
      const own = await call(`/api/memories/${memory.id}`, undefined, token);
      assert.equal(own.status, 200);
      assert.equal(own.data.memory.content, 'This context belongs to the user wallet.');
    });
    await t.test(
      'login cannot substitute for explicit owner authorization; forged signature fails',
      async () => {
        const before = await r.contract.ownerNonces(owner.address);
        const p = await call(
          '/api/wallet/prepare',
          {
            operation: 'grant',
            agentId,
            appId: 'writer',
            memoryIds: [memory.id],
            durationMinutes: 10,
            uses: 3,
          },
          token,
        );
        const signature = await attacker.signTypedData(p.data.domain, p.data.types, p.data.value);
        assert.equal(
          (await call('/api/wallet/execute', { id: p.data.id, signature }, token)).status,
          403,
        );
        assert.equal(await r.contract.ownerNonces(owner.address), before);
        assert.equal(
          (
            await call(
              '/api/wallet/prepare',
              {
                operation: 'grant',
                agentId,
                appId: 'writer',
                memoryIds: [memory.id],
                durationMinutes: 10,
                uses: 3,
              },
              attackerToken,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              '/api/wallet/prepare',
              {
                operation: 'grant',
                agentId,
                appId: 'writer',
                memoryIds: [r.state.memories.find((m) => m.agentId === r.state.agentId).id],
                durationMinutes: 10,
                uses: 3,
              },
              token,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      'signed batch grant succeeds and exact submitted signature cannot be replayed',
      async () => {
        const p = await call(
          '/api/wallet/prepare',
          {
            operation: 'grant',
            agentId,
            appId: 'writer',
            memoryIds: [memory.id],
            durationMinutes: 10,
            uses: 3,
          },
          token,
        );
        const signature = await owner.signTypedData(p.data.domain, p.data.types, p.data.value);
        const done = await call('/api/wallet/execute', { id: p.data.id, signature }, token);
        assert.equal(done.status, 200, JSON.stringify(done.data));
        assert.equal(
          (await call('/api/wallet/execute', { id: p.data.id, signature }, token)).status,
          403,
        );
        grant = r.state.grants.find((g) => g.agentId === agentId);
        assert.equal((await r.contract.grants(grant.id)).app, r.apps.writer.address);
        const writer = new AgentPassportClient({
          vaultUrl: base,
          provider: r.provider,
          contractAddress: r.state.contractAddress,
          privateKey: r.keys.writer,
          chainId: 1337,
        });
        const read = await writer.readMemory(grant.id);
        assert.equal(read.memory.content, 'This context belongs to the user wallet.');
        assert.equal(read.proof.valid, true);
      },
    );
    await t.test(
      'owner nonce and chain / contract domain prevent modified or stale operations',
      async () => {
        const p = await call(
          '/api/wallet/prepare',
          { operation: 'revoke', agentId, grantIds: [grant.id] },
          token,
        );
        const wrongDomain = { ...p.data.domain, chainId: 1 };
        assert.equal(
          (
            await call(
              '/api/wallet/execute',
              {
                id: p.data.id,
                signature: await owner.signTypedData(wrongDomain, p.data.types, p.data.value),
              },
              token,
            )
          ).status,
          403,
        );
        const revoked = await execute(owner, token, 'revoke', { agentId, grantIds: [grant.id] });
        assert.equal(revoked.status, 200);
        assert.equal((await r.contract.grants(grant.id)).revoked, true);
        const signature = await owner.signTypedData(p.data.domain, p.data.types, p.data.value);
        const stale = await call('/api/wallet/execute', { id: p.data.id, signature }, token);
        assert.equal(stale.status, 409);
      },
    );
    await t.test('disabling research writing prevents new encrypted commitments', async () => {
      const disabled = await execute(owner, token, 'ingestor', { agentId, allowResearch: false });
      assert.equal(disabled.status, 200);
      const client = new AgentPassportClient({
        vaultUrl: base,
        provider: r.provider,
        contractAddress: r.state.contractAddress,
        privateKey: r.keys.research,
        chainId: 1337,
      });
      const before = r.state.memories.length;
      await assert.rejects(
        client.saveMemory({
          agentId,
          kind: 'preferences',
          title: 'blocked',
          content: 'should not persist',
        }),
      );
      assert.equal(r.state.memories.length, before);
    });
    await t.test('Monad activation requires an actual deployed manifest', async () => {
      const result = await call('/api/monad/activate', {}, undefined, true);
      assert.equal(result.status, 400);
      assert.equal(result.data.code, 'DEPLOYMENT_REQUIRED');
      assert.equal(
        (await call('/api/monad/deploy', {})).status,
        401,
        'No unauthorized deployment request',
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await r.close();
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
