import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getAddress, verifyMessage, verifyTypedData, ZeroAddress } from 'ethers';
import { validate } from './http.mjs';
import { hashJson, newId } from '../sdk/index.mjs';
import {
  REGISTRATION_TYPES,
  GRANT_BATCH_TYPES,
  REVOKE_BATCH_TYPES,
  INGESTOR_TYPES,
  hashIds,
} from '../sdk/owner.mjs';
const deny = (code, message, status = 403) => {
  throw Object.assign(new Error(message), { code, status });
};
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export function installWalletRoutes(app, r) {
  const challenges = new Map(),
    sessions = new Map(),
    preparations = new Map();
  const authenticate = (req, res, next) => {
    const token = req.get('x-wallet-token');
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now())
      return res
        .status(401)
        .json({ code: 'WALLET_SESSION_REQUIRED', error: '钱包会话已过期，请重新连接并登录' });
    req.wallet = session;
    next();
  };
  r.walletSession = (token) => {
    const s = sessions.get(token);
    return s && s.expiresAt > Date.now() ? s : null;
  };
  app.post('/api/wallet/authorize', authenticate, (req,res) => {
    const { agentId } = validate(z.object({ agentId: z.number().int().positive() }), req.body);
    const workspace = r.workspace(agentId);
    if (!workspace || workspace.owner !== req.wallet.owner) return res.status(403).json({code:'NOT_OWNER',error:'请连接属于当前 Agent 的钱包'});
    res.json({authorized:true,agentId});
  });
  app.post('/api/wallet/challenge', (req, res) => {
    const { walletAddress } = validate(z.object({ walletAddress: address }), req.body);
    const owner = getAddress(walletAddress),
      nonce = randomBytes(16).toString('hex');
    const id = newId(),
      now = new Date(),
      expiration = new Date(Date.now() + 300000);
    const origin = req.get('origin') || `http://127.0.0.1:${process.env.UI_PORT || 4390}`;
    const url = new URL(origin);
    const message = `${url.host} wants you to sign in with your Ethereum account:\n${owner}\n\nSign in to AgentPassport. This does not grant memory access or transfer funds.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${r.chainId}\nNonce: ${nonce}\nIssued At: ${now.toISOString()}\nExpiration Time: ${expiration.toISOString()}`;
    challenges.set(id, { owner, message, origin, expiresAt: expiration.getTime() });
    for (const [k, v] of challenges) if (v.expiresAt < Date.now()) challenges.delete(k);
    res.json({ id, message });
  });
  app.post('/api/wallet/login', (req, res) => {
    const { id, signature } = validate(
      z.object({ id: z.string(), signature: z.string() }),
      req.body,
    );
    const c = challenges.get(id);
    if (!c || c.expiresAt <= Date.now()) deny('CHALLENGE_EXPIRED', '登录请求已过期');
    if ((req.get('origin') || `http://127.0.0.1:${process.env.UI_PORT || 4390}`) !== c.origin)
      deny('ORIGIN_DENIED', '登录域名不匹配');
    let recovered;
    try {
      recovered = verifyMessage(c.message, signature);
    } catch {
      deny('INVALID_SIGNATURE', '登录签名无效');
    }
    if (recovered !== c.owner) deny('INVALID_SIGNATURE', '签名与连接的钱包不匹配');
    challenges.delete(id);
    const token = randomBytes(32).toString('hex'),
      expiresAt = Date.now() + 30 * 60000;
    sessions.set(token, { owner: recovered, expiresAt });
    const workspace = r.state.workspaces.find((w) => w.owner === recovered);
    res.json({ token, address: recovered, expiresAt, workspace: workspace || null });
  });
  app.post('/api/wallet/logout', authenticate, (req, res) => {
    sessions.delete(req.get('x-wallet-token'));
    res.json({ ok: true });
  });
  app.post('/api/wallet/prepare', authenticate, async (req, res) => {
    const input = validate(
      z.object({
        operation: z.enum(['register', 'grant', 'revoke', 'ingestor']),
        agentId: z.number().int().positive().optional(),
        appId: z.enum(['research', 'writer']).optional(),
        memoryIds: z.array(z.string()).max(20).optional(),
        grantIds: z.array(z.string()).max(30).optional(),
        durationMinutes: z.number().int().min(1).max(1440).optional(),
        uses: z.number().int().min(1).max(100).optional(),
        allowResearch: z.boolean().optional(),
      }),
      req.body,
    );
    const owner = req.wallet.owner;
    const block = { timestamp: await r.chainTime() };
    const base = {
      nonce: (await r.contract.ownerNonces(owner)).toString(),
      deadline: block.timestamp + 300,
    };
    let types,
      value,
      args = {};
    if (input.operation === 'register') {
      if (r.state.workspaces.some((w) => w.owner === owner))
        deny('ALREADY_REGISTERED', '该钱包已有 Agent');
      types = REGISTRATION_TYPES;
      value = {
        owner,
        signer: owner,
        ingestor: input.allowResearch ? r.apps.research.address : ZeroAddress,
        profileHash: hashJson({ name: 'Atlas', owner, version: 2 }),
        ...base,
      };
    } else {
      const workspace = r.workspace(input.agentId);
      const chainAgent = workspace && (await r.contract.agents(workspace.agentId));
      if (!workspace || chainAgent.owner !== owner || workspace.controlMode !== 'wallet')
        deny('NOT_OWNER', '当前钱包不是该 Agent 的所有者');
      if (input.operation === 'grant') {
        const memoryIds = [...new Set(input.memoryIds || [])];
        if (!memoryIds.length || !input.appId || !input.durationMinutes || !input.uses)
          deny('VALIDATION_ERROR', '请选择记忆、应用和授权参数', 400);
        if (
          memoryIds.some(
            (id) => !r.state.memories.some((m) => m.id === id && m.agentId === workspace.agentId),
          )
        )
          deny('NOT_OWNER', '无法授权其他 Agent 的记忆');
        const grantIds = memoryIds.map(() => newId());
        types = GRANT_BATCH_TYPES;
        value = {
          agentId: workspace.agentId,
          app: r.apps[input.appId].address,
          memoryIdsHash: hashIds(memoryIds),
          grantIdsHash: hashIds(grantIds),
          expiresAt: block.timestamp + input.durationMinutes * 60,
          uses: input.uses,
          ...base,
        };
        args = { memoryIds, grantIds, appId: input.appId };
      } else if (input.operation === 'revoke') {
        const grantIds = [...new Set(input.grantIds || [])];
        if (
          !grantIds.length ||
          grantIds.some(
            (id) => !r.state.grants.some((g) => g.id === id && g.agentId === workspace.agentId),
          )
        )
          deny('NOT_OWNER', '无法撤销其他 Agent 的授权');
        types = REVOKE_BATCH_TYPES;
        value = { agentId: workspace.agentId, grantIdsHash: hashIds(grantIds), ...base };
        args = { grantIds };
      } else {
        types = INGESTOR_TYPES;
        value = {
          agentId: workspace.agentId,
          ingestor: input.allowResearch ? r.apps.research.address : ZeroAddress,
          ...base,
        };
      }
    }
    const id = newId(),
      prepared = {
        id,
        operation: input.operation,
        owner,
        types,
        domain: r.domain,
        value,
        args,
        expiresAt: Date.now() + 300000,
      };
    preparations.set(id, prepared);
    for (const [k, v] of preparations) if (v.expiresAt < Date.now()) preparations.delete(k);
    res.json({
      id,
      operation: input.operation,
      domain: r.domain,
      types,
      value,
      summary:
        input.operation === 'register'
          ? '注册钱包所有的 Atlas；研究写入权限以 ingestor 字段为准'
          : input.operation === 'grant'
            ? `授权 ${input.appId} 读取 ${args.memoryIds.length} 段记忆，每段 ${input.uses} 次`
            : input.operation === 'revoke'
              ? `撤销 ${args.grantIds.length} 份授权`
              : input.allowResearch
                ? '允许研究助手保存记忆'
                : '停止研究助手保存新记忆',
    });
  });
  app.post('/api/wallet/execute', authenticate, async (req, res) => {
    const { id, signature } = validate(
      z.object({ id: z.string(), signature: z.string() }),
      req.body,
    );
    const p = preparations.get(id);
    if (!p || p.expiresAt <= Date.now()) deny('EXPIRED', '签名请求已过期');
    if (p.owner !== req.wallet.owner) deny('NOT_OWNER', '该签名请求属于其他钱包');
    let recovered;
    try {
      recovered = verifyTypedData(p.domain, p.types, p.value, signature);
    } catch {
      deny('INVALID_SIGNATURE', '操作签名无效');
    }
    if (recovered !== p.owner) deny('INVALID_SIGNATURE', '操作签名与钱包不匹配');
    const result = await r.queue(async () => {
      if (!preparations.has(id)) deny('REPLAY', '此请求已提交', 409);
      let tx;
      if (p.operation === 'register') tx = await r.contract.registerFor(p.value, signature);
      else if (p.operation === 'grant')
        tx = await r.contract.grantFor(p.value, p.args.memoryIds, p.args.grantIds, signature);
      else if (p.operation === 'revoke')
        tx = await r.contract.revokeFor(p.value, p.args.grantIds, signature);
      else tx = await r.contract.updateIngestorFor(p.value, signature);
      const mined = await tx.wait();
      preparations.delete(id);
      let workspace = r.state.workspaces.find((w) => w.owner === p.owner);
      if (p.operation === 'register') {
        const event = mined.logs
          .map((log) => {
            try {
              return r.contract.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((e) => e?.name === 'AgentRegistered');
        workspace = {
          agentId: Number(event.args.agentId),
          owner: p.owner,
          controlMode: 'wallet',
          identityTx: tx.hash,
          createdAt: new Date().toISOString(),
        };
        r.state.workspaces.push(workspace);
      } else if (p.operation === 'grant') {
        p.args.memoryIds.forEach((memoryId, i) =>
          r.state.grants.unshift({
            id: p.args.grantIds[i],
            agentId: p.value.agentId,
            appId: p.args.appId,
            app: p.value.app,
            memoryId,
            expiresAt: p.value.expiresAt,
            uses: p.value.uses,
            remaining: p.value.uses,
            revoked: false,
            createdAt: new Date().toISOString(),
            txHash: tx.hash,
          }),
        );
      } else if (p.operation === 'revoke') {
        r.state.grants
          .filter((g) => p.args.grantIds.includes(g.id))
          .forEach((g) => {
            g.revoked = true;
          });
      }
      r.audit(`wallet_${p.operation}`, {
        agentId: workspace.agentId,
        owner: p.owner,
        txHash: tx.hash,
      });
      r.save();
      return { workspace, txHash: tx.hash };
    });
    res.json(result);
  });
}
