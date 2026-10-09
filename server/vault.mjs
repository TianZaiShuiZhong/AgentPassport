import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { keccak256, verifyTypedData, TypedDataEncoder, verifyMessage } from 'ethers';
import { createRuntime } from './runtime.mjs';
import { baseApp, requireAdmin, validate, errorHandler, portFor } from './http.mjs';
import { ACCESS_TYPES, RESULT_TYPES, hashJson, newId, verifyReceipt } from '../sdk/index.mjs';
import { decryptMemory, envelopeHash } from './crypto.mjs';
import { root } from '../scripts/compile.mjs';
import { installWalletRoutes } from './wallet.mjs';
import { installMonadRoutes } from './monad.mjs';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const kind = z.enum(['background', 'preferences', 'private']);
const fail = (code, message, status = 403) => {
  throw Object.assign(new Error(message), { code, status });
};

export function createVaultApp(r) {
  const app = baseApp({ owner: true });
  const admin = requireAdmin(r);
  installWalletRoutes(app, r);
  installMonadRoutes(app, r, admin);
  app.get('/api/health', (req, res) => res.json({ ready: true, service: 'vault', mode: r.mode }));
  app.get('/api/session', (req, res) => res.json({ token: r.adminToken }));
  app.get('/api/config', (req, res) => {
    const workspace = r.workspace(req.query.agentId || r.state.agentId);
    if (!workspace)
      return res.status(404).json({ error: 'Agent workspace not found', code: 'NOT_FOUND' });
    return res.json({
      mode: r.mode,
      chainId: r.chainId,
      contractAddress: r.state.contractAddress,
      agentId: workspace.agentId,
      owner: workspace.owner,
      controlMode: workspace.controlMode,
      identityTx: workspace.identityTx,
      createdAt: workspace.createdAt,
      domain: r.domain,
      agentSigner: r.contract ? undefined : null,
      apps: Object.values(r.apps),
      vaultUrl: `http://127.0.0.1:${portFor('vault')}`,
      rpcUrl: r.mode === 'local' ? `http://127.0.0.1:${portFor('vault')}/rpc` : r.rpcUrl,
      explorer:
        r.mode === 'monad' ? process.env.MONAD_EXPLORER || 'https://testnet.monadscan.com' : null,
      llmConfigured: Boolean(process.env.LLM_API_KEY),
      appUrls: {
        research: `http://127.0.0.1:${portFor('research')}`,
        writer: `http://127.0.0.1:${portFor('writer')}`,
      },
    });
  });
  app.get('/api/state', async (req, res) => {
    const agentId = Number(req.query.agentId || r.state.agentId);
    if (!r.workspace(agentId))
      return res.status(404).json({ code: 'NOT_FOUND', error: 'Agent workspace not found' });
    const block = await r.provider.getBlock('latest');
    const now = await r.chainTime();
    const grants = await Promise.all(
      r.state.grants
        .filter((g) => (g.agentId || r.state.agentId) === agentId)
        .map(async (g) => {
          const onchain = await r.contract.grants(g.id);
          return {
            ...g,
            remaining: Number(onchain.remaining),
            revoked: onchain.revoked,
            status: onchain.revoked
              ? 'revoked'
              : now >= Number(onchain.expiresAt)
                ? 'expired'
                : onchain.remaining === 0n
                  ? 'exhausted'
                  : 'active',
          };
        }),
    );
    res.json({
      memories: r.state.memories.filter((m) => m.agentId === agentId),
      grants,
      receipts: r.state.receipts.filter((item) => item.agentId === agentId),
      audit: r.state.audit.filter((item) => item.agentId === agentId),
      blockNumber: block.number,
      chainTime: block.timestamp,
      receiptCount: Number(await r.contract.receiptCount()),
    });
  });
  app.get('/api/memories/:id', async (req, res) => {
    const m = r.state.memories.find((x) => x.id === req.params.id);
    if (!m) fail('NOT_FOUND', 'Memory not found', 404);
    if (m.agentId === r.state.agentId) {
      if (req.get('x-admin-token') !== r.adminToken)
        fail('OWNER_AUTH_REQUIRED', '需要本地演示所有者会话', 401);
    } else {
      const session = r.walletSession(req.get('x-wallet-token'));
      const agent = await r.contract.agents(m.agentId);
      if (!session || session.owner !== agent.owner)
        fail('NOT_OWNER', '只有记忆所有者可以解密预览', 401);
    }
    const envelope = r.vault[m.id];
    const onchain = await r.contract.memories(m.id);
    if (envelopeHash(envelope) !== onchain.ciphertextHash)
      fail('INVALID_MEMORY', 'Ciphertext commitment mismatch');
    const memory = decryptMemory(
      r.encryptionKey,
      envelope,
      `${r.chainId}:${r.state.contractAddress}:${m.agentId}:${m.id}:${m.kind}`,
    );
    res.json({ memory, envelope });
  });
  // Minimal RPC facade exposes reads only. The funded relay is never available through RPC.
  app.post('/rpc', async (req, res) => {
    const allowed = new Set([
      'eth_chainId',
      'eth_blockNumber',
      'eth_call',
      'eth_getCode',
      'eth_getBlockByNumber',
      'eth_getTransactionReceipt',
      'eth_getTransactionByHash',
      'eth_getLogs',
      'eth_getBalance',
    ]);
    const perform = async (request) => {
      if (
        !request ||
        request.jsonrpc !== '2.0' ||
        !allowed.has(request.method) ||
        !Array.isArray(request.params)
      )
        return {
          jsonrpc: '2.0',
          id: request?.id ?? null,
          error: { code: -32601, message: 'Read-only RPC: method unavailable' },
        };
      try {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: await r.rpc(request.method, request.params),
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32000, message: 'RPC request failed' },
        };
      }
    };
    if (Array.isArray(req.body)) {
      if (req.body.length > 20) return res.status(400).json({ error: 'Maximum 20 batch calls' });
      return res.json(await Promise.all(req.body.map(perform)));
    }
    res.json(await perform(req.body));
  });
  app.post('/api/grants', admin, async (req, res) => {
    const input = validate(
      z.object({
        appId: z.enum(['research', 'writer']),
        memoryIds: z.array(hex32).min(1).max(20),
        durationMinutes: z.number().int().min(1).max(1440),
        uses: z.number().int().min(1).max(100),
      }),
      req.body,
    );
    const created = await r.queue(async () => {
      const result = [];
      for (const memoryId of [...new Set(input.memoryIds)]) {
        if (!r.state.memories.some((m) => m.id === memoryId))
          fail('INVALID_MEMORY', 'Unknown memory', 400);
      }
      for (const memoryId of [...new Set(input.memoryIds)]) {
        const expiresAt = (await r.chainTime()) + input.durationMinutes * 60;
        const id = newId();
        const tx = await r.contract.grant(
          id,
          r.state.agentId,
          r.apps[input.appId].address,
          memoryId,
          expiresAt,
          input.uses,
        );
        await tx.wait();
        const grant = {
          id,
          agentId: r.state.agentId,
          appId: input.appId,
          app: r.apps[input.appId].address,
          memoryId,
          expiresAt,
          uses: input.uses,
          remaining: input.uses,
          revoked: false,
          createdAt: new Date().toISOString(),
          txHash: tx.hash,
        };
        r.state.grants.unshift(grant);
        result.push(grant);
        r.audit('grant_created', { grantId: id, appId: input.appId, memoryId, txHash: tx.hash });
        r.save();
      }
      return result;
    });
    res.status(201).json({ grants: created });
  });
  app.post('/api/grants/revoke', admin, async (req, res) => {
    const { grantIds } = validate(z.object({ grantIds: z.array(hex32).min(1).max(30) }), req.body);
    const revoked = await r.queue(async () => {
      const result = [];
      for (const id of [...new Set(grantIds)]) {
        const grant = r.state.grants.find((g) => g.id === id);
        if (!grant) fail('NO_GRANT', 'Unknown grant', 400);
        if (grant.revoked) continue;
        const tx = await r.contract.revoke(id);
        await tx.wait();
        grant.revoked = true;
        r.audit('grant_revoked', { grantId: id, appId: grant.appId, txHash: tx.hash });
        result.push(id);
        r.save();
      }
      return result;
    });
    res.json({ revoked });
  });
  // Metadata is visible, plaintext is returned only after successful on-chain consumption.
  app.post('/api/access', async (req, res) => {
    const input = validate(
      z.object({
        access: z.object({
          grantId: hex32,
          requestId: hex32,
          nonce: z.string().regex(/^\d+$/),
          deadline: z.number().int().positive(),
        }),
        signature,
      }),
      req.body,
    );
    const response = await r
      .queue(async () => {
        let recovered;
        try {
          recovered = verifyTypedData(r.domain, ACCESS_TYPES, input.access, input.signature);
        } catch {
          fail('INVALID_SIGNATURE', 'Bad access signature');
        }
        const grant = await r.contract.grants(input.access.grantId);
        if (grant.agentId === 0n) fail('NO_GRANT', 'No permission for this memory');
        if (recovered.toLowerCase() !== grant.app.toLowerCase())
          fail('WRONG_APPLICATION', 'Signature belongs to another application');
        const memory = r.state.memories.find((m) => m.id === grant.memoryId);
        const envelope = r.vault[grant.memoryId];
        const onchainMemory = await r.contract.memories(grant.memoryId);
        if (!memory || !envelope || envelopeHash(envelope) !== onchainMemory.ciphertextHash)
          fail('INVALID_MEMORY', 'Ciphertext hash does not match chain');
        const tx = await r.contract.consume(input.access, input.signature);
        const mined = await tx.wait();
        // A mined permission receipt is a prerequisite to releasing plaintext.
        const payload = decryptMemory(
          r.encryptionKey,
          envelope,
          `${r.chainId}:${r.state.contractAddress}:${memory.agentId}:${memory.id}:${memory.kind}`,
        );
        const receipt = {
          agentId: memory.agentId,
          id: input.access.requestId,
          type: 'access',
          domain: r.domain,
          access: input.access,
          signature: input.signature,
          app: recovered,
          appId:
            Object.values(r.apps).find((a) => a.address.toLowerCase() === recovered.toLowerCase())
              ?.id || 'external',
          memoryId: memory.id,
          title: memory.title,
          ciphertextHash: onchainMemory.ciphertextHash,
          txHash: tx.hash,
          blockNumber: mined.blockNumber,
          at: new Date().toISOString(),
        };
        r.state.receipts.unshift(receipt);
        r.audit('memory_read', {
          agentId: memory.agentId,
          appId: receipt.appId,
          memoryId: memory.id,
          title: memory.title,
          txHash: tx.hash,
        });
        r.save();
        return { memory: payload, receipt };
      })
      .catch((error) => {
        r.audit('access_denied', {
          grantId: input.access.grantId,
          reason: error.code || error.shortMessage || 'Rejected',
        });
        throw error;
      });
    res.json(response);
  });
  app.post('/api/ingest', async (req, res) => {
    const { message, signature: sig } = validate(
      z.object({
        message: z.object({
          app: z.string(),
          agentId: z.string(),
          kind,
          title: z.string().trim().min(1).max(100),
          content: z.string().trim().min(1).max(10000),
          requestId: hex32,
          deadline: z.number().int(),
        }),
        signature,
      }),
      req.body,
    );
    let recovered;
    try {
      recovered = verifyMessage(JSON.stringify(message), sig);
    } catch {
      fail('INVALID_SIGNATURE', 'Invalid ingest signature');
    }
    if (
      recovered.toLowerCase() !== r.apps.research.address.toLowerCase() ||
      message.app.toLowerCase() !== recovered.toLowerCase()
    )
      fail('WRONG_APPLICATION', 'Only enrolled Research Studio can propose memories');
    const workspace = r.workspace(Number(message.agentId));
    if (!workspace) fail('INVALID_AGENT', 'Wrong agent');
    if (
      Math.floor(Date.now() / 1000) >= message.deadline ||
      message.deadline > Math.floor(Date.now() / 1000) + 120
    )
      fail('EXPIRED', 'Ingest request expired');
    const memory = await r.queue(async () => {
      r.state.ingestRequests ||= [];
      if (r.state.ingestRequests.includes(message.requestId))
        fail('REPLAY', 'Ingest already processed', 409);
      const m = await r.addMemory({
        ...message,
        agentId: Number(message.agentId),
        source: 'research',
      });
      r.state.ingestRequests.push(message.requestId);
      r.save();
      return m;
    });
    res.status(201).json({ memory });
  });
  app.post('/api/results', async (req, res) => {
    const input = validate(
      z.object({
        result: z.object({ requestId: hex32, resultHash: hex32, validationHash: hex32 }),
        signature,
        output: z.object({
          title: z.string().max(200),
          text: z.string().max(20000),
          source: z.string().max(100),
          memoryIds: z.array(hex32).max(20),
          accessRequestIds: z.array(hex32).max(20),
        }),
        validation: z.object({
          validator: z.string(),
          passed: z.boolean(),
          checks: z
            .array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() }))
            .max(20),
        }),
      }),
      req.body,
    );
    if (
      hashJson(input.output) !== input.result.resultHash ||
      hashJson(input.validation) !== input.result.validationHash
    )
      fail('INVALID_MEMORY', 'Result content was modified', 400);
    const receipt = await r.queue(async () => {
      const recovered = verifyTypedData(r.domain, RESULT_TYPES, input.result, input.signature);
      const tx = await r.contract.recordResult(input.result, input.signature);
      const mined = await tx.wait();
      const record = {
        agentId:
          r.state.receipts.find(
            (x) => x.type === 'access' && x.access.requestId === input.result.requestId,
          )?.agentId || r.state.agentId,
        id: newId(),
        type: 'result',
        domain: r.domain,
        ...input,
        app: recovered,
        appId: 'writer',
        title: input.output.title,
        txHash: tx.hash,
        blockNumber: mined.blockNumber,
        at: new Date().toISOString(),
      };
      r.state.receipts.unshift(record);
      r.audit('task_completed', {
        agentId: record.agentId,
        title: record.title,
        txHash: tx.hash,
        passed: input.validation.passed,
      });
      r.save();
      return record;
    });
    res.status(201).json({ receipt });
  });
  app.post('/api/verify', async (req, res) => {
    const { receiptId } = validate(z.object({ receiptId: hex32 }), req.body);
    const receipt = r.state.receipts.find((x) => x.id === receiptId);
    if (!receipt) fail('NOT_FOUND', 'Receipt not found', 404);
    res.json(await verifyReceipt(receipt, r.provider));
  });
  // Public demo metadata, with no ciphertext/key download endpoint.
  app.use(express.static(path.join(root, 'dist')));
  app.get('/', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
  app.use(errorHandler(r.contract));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await createRuntime({ dataDir: process.env.DATA_DIR || path.join(root, '.data') });
  const server = createVaultApp(r).listen(portFor('vault'), '127.0.0.1', () =>
    console.log(`Vault ready: http://127.0.0.1:${portFor('vault')} · ${r.mode} chain ${r.chainId}`),
  );
  const stop = () =>
    server.close(async () => {
      await r.close();
      process.exit(0);
    });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
