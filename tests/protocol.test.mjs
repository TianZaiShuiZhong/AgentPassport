import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, TypedDataEncoder } from 'ethers';
import { createRuntime } from '../server/runtime.mjs';
import { createVaultApp } from '../server/vault.mjs';
import { createAgentApp, generateArticle } from '../server/agent-app.mjs';
import express from 'express';
import { request as httpRequest } from 'node:http';
import {
  AgentPassportClient,
  ACCESS_TYPES,
  RESULT_TYPES,
  newId,
  hashJson,
  verifyReceipt,
} from '../sdk/index.mjs';
import { encryptMemory, decryptMemory } from '../server/crypto.mjs';

// Never spend a user's configured model credits during automated tests.
delete process.env.LLM_API_KEY;

async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function post(url, endpoint, body, token) {
  const response = await fetch(`${url}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function rejectWithName(contract, operation, name) {
  let error;
  try {
    await operation();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `Expected ${name} revert`);
  const raw = error.data || error.info?.error?.data?.result;
  assert.equal(contract.interface.parseError(raw)?.name, name);
}

test('AgentPassport authorization, crypto, SDK and application integration', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'agentpassport-test-'));
  const r = await createRuntime({ dataDir, persistent: false, mode: 'local' });
  const vault = await serve(createVaultApp(r));
  const sdk = (role) =>
    new AgentPassportClient({
      vaultUrl: vault.url,
      provider: r.provider,
      contractAddress: r.state.contractAddress,
      privateKey: r.keys[role],
      chainId: r.chainId,
    });
  const writer = sdk('writer'),
    research = sdk('research');
  const config = { agentId: r.state.agentId, mode: 'local' };
  const writerApp = await serve(
    createAgentApp({ role: 'writer', client: writer, config, dataDir }),
  );
  const researchApp = await serve(
    createAgentApp({ role: 'research', client: research, config, dataDir }),
  );
  const writerToken = (await (await fetch(`${writerApp.url}/api/session`)).json()).token;
  const researchToken = (await (await fetch(`${researchApp.url}/api/session`)).json()).token;
  const background = r.state.memories.find((m) => m.kind === 'background');
  const privateMemory = r.state.memories.find((m) => m.kind === 'private');
  const preferences = r.state.memories.find((m) => m.kind === 'preferences');
  const issue = async (memoryId, overrides = {}) => {
    const id = newId();
    const block = await r.provider.getBlock('latest');
    const expiresAt = overrides.expiresAt || block.timestamp + 600;
    const tx = await r.contract.grant(
      id,
      r.state.agentId,
      overrides.app || writer.signer.address,
      memoryId,
      expiresAt,
      overrides.uses || 5,
    );
    await tx.wait();
    const grant = {
      id,
      appId: overrides.appId || 'writer',
      memoryId,
      app: overrides.app || writer.signer.address,
      expiresAt,
      uses: overrides.uses || 5,
      revoked: false,
    };
    r.state.grants.unshift(grant);
    r.save();
    return grant;
  };
  const signedAccess = async (grantId, overrides = {}, signer = writer.signer) => {
    const block = await r.provider.getBlock('latest');
    const access = {
      grantId,
      requestId: newId(),
      nonce: (await r.contract.nonces(signer.address)).toString(),
      deadline: block.timestamp + 60,
      ...overrides,
    };
    return { access, signature: await signer.signTypedData(r.domain, ACCESS_TYPES, access) };
  };
  try {
    await t.test(
      'seed memories are encrypted on disk and only commitments are on chain',
      async () => {
        const disk = readFileSync(path.join(dataDir, 'vault-local.json'), 'utf8');
        assert.equal(disk.includes('PRIVATE_DEMO_NOTE'), false);
        assert.equal(disk.includes('用户可以授权'), false);
        const commitment = await r.contract.memories(background.id);
        assert.equal(commitment.agentId, BigInt(r.state.agentId));
        assert.equal(commitment.ciphertextHash, background.ciphertextHash);
        assert.equal(await r.contract.agentCount(), 1n);
      },
    );
    await t.test('AES-GCM rejects modified ciphertext, tag, key, and associated context', () => {
      const key = Buffer.alloc(32, 12),
        envelope = encryptMemory(key, { content: 'secret' }, 'agent:memory:private');
      assert.equal(decryptMemory(key, envelope, envelope.aad).content, 'secret');
      assert.throws(() =>
        decryptMemory(key, { ...envelope, data: 'ff' + envelope.data.slice(2) }, envelope.aad),
      );
      assert.throws(() => decryptMemory(key, { ...envelope, tag: '00'.repeat(16) }, envelope.aad));
      assert.throws(() => decryptMemory(Buffer.alloc(32, 8), envelope, envelope.aad));
      assert.throws(() => decryptMemory(key, envelope, 'other-agent'));
    });
    await t.test(
      'owner authorization is required, and browser origin cannot acquire it',
      async () => {
        const body = { appId: 'writer', memoryIds: [background.id], durationMinutes: 10, uses: 5 };
        assert.equal((await post(vault.url, '/api/grants', body)).status, 401);
        const blocked = await fetch(`${vault.url}/api/session`, {
          headers: { Origin: 'https://untrusted.example' },
        });
        assert.equal(blocked.status, 403);
        const hostileStatus = await new Promise((resolve, reject) => {
          const req = httpRequest(
            `${vault.url}/api/session`,
            { headers: { Host: 'untrusted.example' } },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            },
          );
          req.on('error', reject);
          req.end();
        });
        assert.equal(hostileStatus, 403);
        const created = await post(vault.url, '/api/grants', body, r.adminToken);
        assert.equal(created.status, 201);
        assert.equal(created.data.grants[0].app, writer.signer.address);
      },
    );
    await t.test(
      'successful read consumes one use and returns an independently verifiable receipt',
      async () => {
        const grant = await issue(background.id);
        const before = (await r.contract.grants(grant.id)).remaining;
        const data = await writer.readMemory(grant.id);
        assert.match(data.memory.content, /AgentPassport/);
        assert.equal(data.proof.valid, true);
        assert.equal((await r.contract.grants(grant.id)).remaining, before - 1n);
        assert.equal(
          await r.contract.receiptDigests(data.receipt.access.requestId),
          TypedDataEncoder.hash(r.domain, ACCESS_TYPES, data.receipt.access),
        );
        const changedTx = { ...data.receipt, txHash: r.state.identityTx };
        assert.equal((await verifyReceipt(changedTx, r.provider)).valid, false);
        const changedMemory = { ...data.receipt, ciphertextHash: newId() };
        assert.equal((await verifyReceipt(changedMemory, r.provider)).valid, false);
      },
    );
    await t.test(
      'private note without grant returns no plaintext, no mined receipt and no nonce change',
      async () => {
        const beforeCount = await r.contract.receiptCount();
        const beforeNonce = await r.contract.nonces(writer.signer.address);
        const input = await signedAccess(newId());
        const denied = await post(vault.url, '/api/access', input);
        assert.equal(denied.status, 403);
        assert.equal(denied.data.code, 'NO_GRANT');
        assert.equal('memory' in denied.data, false);
        assert.equal(JSON.stringify(denied).includes('PRIVATE_DEMO_NOTE'), false);
        assert.equal(await r.contract.receiptCount(), beforeCount);
        assert.equal(await r.contract.nonces(writer.signer.address), beforeNonce);
        const probe = await post(
          writerApp.url,
          '/api/probe',
          { memoryId: privateMemory.id },
          writerToken,
        );
        assert.equal(probe.status, 403);
        assert.equal(probe.data.code, 'NO_GRANT');
      },
    );
    await t.test('an application cannot use another application grant', async () => {
      const grant = await issue(background.id);
      await assert.rejects(research.readMemory(grant.id), (e) => e.code === 'WRONG_APPLICATION');
      const denied = await post(
        vault.url,
        '/api/access',
        await signedAccess(grant.id, {}, research.signer),
      );
      assert.equal(denied.status, 403);
      assert.equal(denied.data.code, 'WRONG_APPLICATION');
    });
    await t.test('replay and cross-contract / cross-chain signatures are rejected', async () => {
      const grant = await issue(background.id);
      const input = await signedAccess(grant.id);
      const tx = await r.contract.consume(input.access, input.signature);
      await tx.wait();
      await rejectWithName(
        r.contract,
        () => r.contract.consume.staticCall(input.access, input.signature),
        'DuplicateRequest',
      );
      const next = await signedAccess(grant.id);
      const oldNonce = { ...next.access, nonce: input.access.nonce };
      const oldSig = await writer.signer.signTypedData(r.domain, ACCESS_TYPES, oldNonce);
      await rejectWithName(
        r.contract,
        () => r.contract.consume.staticCall(oldNonce, oldSig),
        'InvalidNonce',
      );
      for (const domain of [
        { ...r.domain, chainId: 1 },
        { ...r.domain, verifyingContract: Wallet.createRandom().address },
      ]) {
        const sig = await writer.signer.signTypedData(domain, ACCESS_TYPES, next.access);
        await rejectWithName(
          r.contract,
          () => r.contract.consume.staticCall(next.access, sig),
          'InvalidSignature',
        );
      }
      const response = await post(vault.url, '/api/access', input);
      assert.equal(response.status, 409);
    });
    await t.test('ciphertext tampering is rejected before consuming access', async () => {
      const grant = await issue(background.id),
        old = r.vault[background.id];
      const before = (await r.contract.grants(grant.id)).remaining;
      r.vault[background.id] = { ...old, data: '00' + old.data.slice(2) };
      const denied = await post(vault.url, '/api/access', await signedAccess(grant.id));
      assert.equal(denied.status, 403);
      assert.equal(denied.data.code, 'INVALID_MEMORY');
      assert.equal((await r.contract.grants(grant.id)).remaining, before);
      r.vault[background.id] = old;
    });
    await t.test(
      'revocation blocks future reads while historical receipts remain verifiable',
      async () => {
        const grant = await issue(background.id);
        const read = await writer.readMemory(grant.id);
        const stale = await signedAccess(grant.id);
        const tx = await r.contract.revoke(grant.id);
        await tx.wait();
        await assert.rejects(writer.readMemory(grant.id), (e) => e.code === 'REVOKED');
        const denied = await post(vault.url, '/api/access', stale);
        assert.equal(denied.status, 403);
        assert.equal(denied.data.code, 'REVOKED');
        assert.equal((await verifyReceipt(read.receipt, r.provider)).valid, true);
      },
    );
    await t.test(
      'exhaustion, deadline expiry, disabled memories and inactive agents fail closed',
      async () => {
        const limited = await issue(background.id, { uses: 1 });
        await writer.readMemory(limited.id);
        await assert.rejects(writer.readMemory(limited.id), (e) => e.code === 'EXHAUSTED');
        const grant = await issue(preferences.id);
        const block = await r.provider.getBlock('latest');
        const expiredRequest = await signedAccess(grant.id, { deadline: block.timestamp });
        await rejectWithName(
          r.contract,
          () => r.contract.consume.staticCall(expiredRequest.access, expiredRequest.signature),
          'Expired',
        );
        const disable = await r.contract.disableMemory(preferences.id);
        await disable.wait();
        const access = await signedAccess(grant.id);
        await rejectWithName(
          r.contract,
          () => r.contract.consume.staticCall(access.access, access.signature),
          'InvalidMemory',
        );
        const update = await r.contract.updateAgent(
          r.state.agentId,
          new Wallet(r.keys.agent).address,
          false,
        );
        await update.wait();
        const enabledMemoryGrant = await signedAccess(limited.id);
        await rejectWithName(
          r.contract,
          () =>
            r.contract.consume.staticCall(enabledMemoryGrant.access, enabledMemoryGrant.signature),
          'InvalidAgent',
        );
        const restore = await r.contract.updateAgent(
          r.state.agentId,
          new Wallet(r.keys.agent).address,
          true,
        );
        await restore.wait();
      },
    );
    await t.test('expired grants are rejected using chain time', async () => {
      const block = await r.provider.getBlock('latest');
      const grant = await issue(background.id, { expiresAt: block.timestamp + 10 });
      await r.rpc('evm_increaseTime', [11]);
      await r.rpc('evm_mine', []);
      await assert.rejects(writer.readMemory(grant.id), (e) => e.code === 'EXPIRED');
    });
    await t.test(
      'research service uses the SDK to ingest new memory; writer generates and anchors output',
      async () => {
        const saved = await post(
          researchApp.url,
          '/api/save',
          {
            kind: 'background',
            title: '测试研究资料',
            content: '新项目让用户控制记忆迁移。研究发现：授权应按应用、记忆与有效期分别限制。',
          },
          researchToken,
        );
        assert.equal(saved.status, 201);
        assert.equal(saved.data.memory.kind, 'background');
        const grant = await issue(saved.data.memory.id);
        const result = await post(
          writerApp.url,
          '/api/run',
          { prompt: '介绍跨应用记忆项目', memoryIds: [saved.data.memory.id], grantIds: [grant.id] },
          writerToken,
        );
        assert.equal(result.status, 201, JSON.stringify(result.data));
        assert.equal(result.data.task.validation.passed, true);
        assert.equal(result.data.task.output.source, '模板演示 · 未调用语言模型');
        const receipt = result.data.task.receipt;
        assert.equal((await verifyReceipt(receipt, r.provider)).valid, true);
        const changed = structuredClone(receipt);
        changed.output.text += 'changed';
        assert.equal((await verifyReceipt(changed, r.provider)).valid, false);
        const tamperedEvent = { ...receipt, txHash: r.state.identityTx };
        assert.equal((await verifyReceipt(tamperedEvent, r.provider)).valid, false);
        const revoke = await r.contract.revoke(grant.id);
        await revoke.wait();
        const again = await post(
          writerApp.url,
          '/api/run',
          { prompt: '再次写作', memoryIds: [saved.data.memory.id], grantIds: [grant.id] },
          writerToken,
        );
        assert.equal(again.status, 403);
        assert.equal(again.data.code, 'REVOKED');
      },
    );
    await t.test(
      'result cannot be attested by the wrong application or submitted twice',
      async () => {
        const g = await issue(background.id);
        const read = await writer.readMemory(g.id);
        const result = {
          requestId: read.receipt.access.requestId,
          resultHash: hashJson('output'),
          validationHash: hashJson('rules'),
        };
        const wrong = await research.signer.signTypedData(r.domain, RESULT_TYPES, result);
        await rejectWithName(
          r.contract,
          () => r.contract.recordResult.staticCall(result, wrong),
          'InvalidSignature',
        );
        const sig = await writer.signer.signTypedData(r.domain, RESULT_TYPES, result);
        const tx = await r.contract.recordResult(result, sig);
        await tx.wait();
        await rejectWithName(
          r.contract,
          () => r.contract.recordResult.staticCall(result, sig),
          'DuplicateRequest',
        );
      },
    );
    await t.test('idle local chain uses current time for grants and signed reads', async () => {
      const original = r.provider.getBlock.bind(r.provider);
      r.provider.getBlock = async (...args) => {
        const block = await original(...args);
        return { ...block, timestamp: block.timestamp - 600 };
      };
      try {
        const created = await post(
          vault.url,
          '/api/grants',
          { appId: 'writer', memoryIds: [background.id], durationMinutes: 10, uses: 2 },
          r.adminToken,
        );
        assert.equal(created.status, 201, JSON.stringify(created.data));
        const read = await writer.readMemory(created.data.grants[0].id);
        assert.equal(read.proof.valid, true);
      } finally {
        r.provider.getBlock = original;
      }
    });
    await t.test('read-only RPC cannot expose transaction writes', async () => {
      const response = await post(vault.url, '/rpc', {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendTransaction',
        params: [],
      });
      assert.equal(response.data.error.code, -32601);
      const read = await post(vault.url, '/rpc', {
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_chainId',
        params: [],
      });
      assert.equal(read.data.result, '0x539');
    });
    await t.test(
      'optional model adapter sends only authorized context and reports provider failures',
      async () => {
        const mock = express();
        mock.use(express.json());
        let captured,
          rejected = false;
        mock.post('/v1/chat/completions', (req, res) => {
          captured = req.body;
          if (rejected) return res.status(503).json({ error: 'mock provider unavailable' });
          res.json({
            choices: [
              {
                message: {
                  content:
                    '用户的问题\n已授权资料的内容。\n方案\n按权限复用。\n例子\n仅输入共享记忆。\n实现边界\n这是测试模型响应。',
                },
              },
            ],
          });
        });
        const service = await serve(mock);
        const previous = { url: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL };
        try {
          process.env.LLM_API_KEY = 'test-only-key';
          process.env.LLM_BASE_URL = `${service.url}/v1`;
          process.env.LLM_MODEL = 'mock-model';
          const generated = await generateArticle(
            [{ id: background.id, kind: 'background', content: 'ONLY_AUTHORIZED_CONTEXT' }],
            '写作请求',
          );
          assert.equal(generated.source, 'LLM · mock-model');
          assert.equal(JSON.stringify(captured).includes('ONLY_AUTHORIZED_CONTEXT'), true);
          assert.equal(JSON.stringify(captured).includes('PRIVATE_DEMO_NOTE'), false);
          rejected = true;
          await assert.rejects(
            generateArticle([{ kind: 'background', content: 'shared' }], '测试失败'),
            (e) => e.code === 'LLM_FAILED',
          );
        } finally {
          delete process.env.LLM_API_KEY;
          if (previous.url === undefined) delete process.env.LLM_BASE_URL;
          else process.env.LLM_BASE_URL = previous.url;
          if (previous.model === undefined) delete process.env.LLM_MODEL;
          else process.env.LLM_MODEL = previous.model;
          await new Promise((resolve) => service.server.close(resolve));
        }
      },
    );
  } finally {
    await Promise.all(
      [vault.server, writerApp.server, researchApp.server].map(
        (s) => new Promise((resolve) => s.close(resolve)),
      ),
    );
    await r.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
