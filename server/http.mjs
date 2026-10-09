import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { trustedPublicRequest } from './public-access.mjs';
export const portFor = (role) =>
  Number(
    process.env[`${role.toUpperCase()}_PORT`] ||
      { vault: 4391, research: 4392, writer: 4393 }[role],
  );
export function baseApp({ owner = false, role = 'vault' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const ui = Number(process.env.UI_PORT || 4390);
  const allowed = new Set([`http://127.0.0.1:${ui}`, `http://localhost:${ui}`]);
  if (!owner) {
    allowed.add(`http://127.0.0.1:${portFor(role)}`);
    allowed.add(`http://localhost:${portFor(role)}`);
  }
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))
      return res
        .status(403)
        .json({ code: 'HOST_DENIED', error: 'Only loopback hosts are allowed' });
    const origin = req.get('origin');
    req.publicGateway = trustedPublicRequest(req);
    if (origin && !allowed.has(origin) && !req.publicGateway)
      return res.status(403).json({ code: 'ORIGIN_DENIED', error: 'This origin is not allowed' });
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, X-Wallet-Token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '96kb' }));
  return app;
}
export function requireAdmin(runtime) {
  return (req, res, next) => {
    const a = Buffer.from(req.get('x-admin-token') || ''),
      b = Buffer.from(runtime.adminToken);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return res.status(401).json({ code: 'OWNER_AUTH_REQUIRED', error: 'Owner session required' });
    next();
  };
}
export function errorHandler(contract) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const names = {
      Revoked: 'REVOKED',
      Expired: 'EXPIRED',
      Exhausted: 'EXHAUSTED',
      InvalidNonce: 'REPLAY',
      InvalidSignature: 'INVALID_SIGNATURE',
      DuplicateRequest: 'REPLAY',
      InvalidGrant: 'NO_GRANT',
      InvalidMemory: 'INVALID_MEMORY',
      NotOwner: 'NOT_OWNER',
      InvalidAgent: 'INVALID_AGENT',
    };
    let parsed;
    const data = error.data || error.info?.error?.data?.result || error.info?.error?.data;
    if (contract && typeof data === 'string') {
      try {
        parsed = contract.interface.parseError(data);
      } catch {}
    }
    const code =
      error.code &&
      typeof error.code === 'string' &&
      !['CALL_EXCEPTION', 'UNKNOWN_ERROR'].includes(error.code)
        ? error.code
        : names[parsed?.name] || 'REQUEST_FAILED';
    const messages = {
      REVOKED: '授权已撤销，无法继续读取',
      EXPIRED: '授权或请求已过期',
      EXHAUSTED: '授权读取次数已用完',
      REPLAY: '重复请求或签名编号失效',
      NO_GRANT: '没有对应记忆的有效授权',
      WRONG_APPLICATION: '授权属于其他应用',
      INVALID_SIGNATURE: '请求签名无效',
      OWNER_AUTH_REQUIRED: '需要所有者会话',
      INVALID_MEMORY: '记忆无效或密文校验失败',
      INVALID_AGENT: 'Agent 已停用或不存在',
    };
    const status =
      error.status ||
      (code === 'REPLAY'
        ? 409
        : [
              'REVOKED',
              'EXPIRED',
              'EXHAUSTED',
              'NO_GRANT',
              'WRONG_APPLICATION',
              'INVALID_SIGNATURE',
            ].includes(code)
          ? 403
          : code === 'VALIDATION_ERROR'
            ? 400
            : 500);
    console.error(`[${req.method} ${req.path}] ${code}: ${error.shortMessage || error.message}`);
    res.status(status).json({
      code,
      error: messages[code] || (status < 500 ? error.message : '请求未完成，请检查服务日志'),
    });
  };
}
export function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success)
    throw Object.assign(
      new Error(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')),
      { code: 'VALIDATION_ERROR', status: 400 },
    );
  return result.data;
}
