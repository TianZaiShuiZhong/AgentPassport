export type Kind = 'background' | 'preferences' | 'private';
export type Memory = {
  id: string;
  kind: Kind;
  title: string;
  source: string;
  ciphertextHash: string;
  createdAt: string;
  txHash: string;
  bytes: number;
};
export type Grant = {
  id: string;
  appId: string;
  memoryId: string;
  expiresAt: number;
  uses: number;
  remaining: number;
  revoked: boolean;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
  txHash: string;
};
export type Receipt = {
  id: string;
  type: 'access' | 'result';
  appId: string;
  title: string;
  txHash: string;
  blockNumber: number;
  at: string;
  [key: string]: unknown;
};
export type Audit = {
  id: string;
  type: string;
  at: string;
  title?: string;
  appId?: string;
  reason?: string;
  txHash?: string;
};
export type State = {
  memories: Memory[];
  grants: Grant[];
  receipts: Receipt[];
  audit: Audit[];
  blockNumber: number;
  chainTime: number;
  receiptCount: number;
};
export type Config = {
  mode: 'local' | 'monad';
  chainId: number;
  contractAddress: string;
  agentId: number;
  owner: string;
  controlMode?: 'demo' | 'wallet';
  publicMode?: boolean;
  identityTx: string;
  createdAt: string;
  rpcUrl: string;
  explorer: string | null;
  vaultUrl: string;
  llmConfigured: boolean;
  apps: { id: string; name: string; nameZh: string; address: string; purpose: string }[];
  appUrls: { research: string; writer: string };
};
export type Task = {
  id: string;
  at: string;
  output: { title: string; text: string; source: string; memoryIds: string[] };
  inputs: { id: string; title: string; kind: Kind }[];
  validation: {
    validator: string;
    passed: boolean;
    checks: { name: string; passed: boolean; detail: string }[];
  };
  receipt: Receipt;
};
export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
const tokens: Record<string, string> = {};
export type WalletSession = {
  token: string;
  address: string;
  expiresAt: number;
  workspace: { agentId: number } | null;
};
const walletSessionKey = 'agentpassport-wallet-session';
export const getWalletSession = (): WalletSession | null => {
  try {
    const session = JSON.parse(sessionStorage.getItem(walletSessionKey) || 'null');
    if (
      session &&
      typeof session.token === 'string' &&
      /^0x[0-9a-fA-F]{40}$/.test(session.address) &&
      session.expiresAt > Date.now() &&
      (!session.workspace ||
        (Number.isSafeInteger(session.workspace.agentId) && session.workspace.agentId > 0))
    )
      return session;
    sessionStorage.removeItem(walletSessionKey);
  } catch {
    /* Storage may be disabled in the browser. */
  }
  return null;
};
const restoredSession = getWalletSession();
let workspaceId = Number(new URLSearchParams(location.search).get('agentId')) || undefined;
export const selectedWorkspace = () => workspaceId;
let walletToken = restoredSession?.token || '';
export const setWalletToken = (token: string) => {
  walletToken = token;
};
export const selectWorkspace = (id?: number) => {
  workspaceId = id;
  const url = new URL(location.href);
  if (id) url.searchParams.set('agentId', String(id));
  else url.searchParams.delete('agentId');
  history.replaceState(null, '', url);
};
if (!workspaceId && restoredSession?.workspace) selectWorkspace(restoredSession.workspace.agentId);
export const saveWalletSession = (session: WalletSession) => {
  walletToken = session.token;
  try {
    sessionStorage.setItem(walletSessionKey, JSON.stringify(session));
  } catch {
    /* Optional persistence. */
  }
};
export const expireWalletSession = () => {
  walletToken = '';
  try {
    sessionStorage.removeItem(walletSessionKey);
  } catch {
    /* Optional persistence. */
  }
  window.dispatchEvent(new Event('wallet-session-expired'));
};
const ports = { vault: 4391, research: 4392, writer: 4393 };
const appRole = document.querySelector('meta[name="agentpassport-role"]')?.getAttribute('content');
export const publicMode = Boolean(document.querySelector('meta[name="agentpassport-public"]'));
export const standalone: 'research' | 'writer' | null =
  appRole === 'research' || appRole === 'writer' ? appRole : null;
const prefix = (role: 'vault' | 'research' | 'writer') =>
  standalone && !publicMode
    ? role === standalone
      ? '/api'
      : `http://127.0.0.1:${ports[role]}/api`
    : role === 'vault'
      ? '/api'
      : `/${role}-api`;
export async function request<T = any>(
  role: 'vault' | 'research' | 'writer',
  endpoint: string,
  body?: unknown,
  owner = false,
): Promise<T> {
  if (owner && !tokens[role]) {
    const r = await fetch(`${prefix(role)}/session`);
    const d = await r.json();
    if (!r.ok) throw new ApiError(d.error, d.code);
    tokens[role] = d.token;
  }
  const loginEndpoint = ['/wallet/challenge', '/wallet/login', '/wallet/logout'].includes(endpoint);
  const query =
    workspaceId && !loginEndpoint
      ? `${endpoint.includes('?') ? '&' : '?'}agentId=${workspaceId}`
      : '';
  const res = await fetch(`${prefix(role)}${endpoint}${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(owner ? { 'X-Admin-Token': tokens[role] } : {}),
      ...(walletToken ? { 'X-Wallet-Token': walletToken } : {}),
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(
            role !== 'vault' && workspaceId && typeof body === 'object'
              ? { ...body, agentId: workspaceId }
              : body,
          ),
        }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.code === 'PUBLIC_LOGIN_REQUIRED')
      window.dispatchEvent(new Event('public-session-expired'));
    if (data.code === 'WALLET_SESSION_REQUIRED') expireWalletSession();
    if (res.status === 401) delete tokens[role];
    throw new ApiError(data.error || '请求失败', data.code || 'REQUEST_FAILED');
  }
  return data;
}
export const short = (s?: string, n = 6) => (s ? `${s.slice(0, n + 2)}…${s.slice(-4)}` : '—');
export const date = (s: string | number) =>
  new Date(typeof s === 'number' ? s * 1000 : s).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const KIND: Record<Kind, { label: string; en: string; color: string }> = {
  background: { label: '项目背景', en: 'PROJECT CONTEXT', color: 'blue' },
  preferences: { label: '写作偏好', en: 'PREFERENCES', color: 'purple' },
  private: { label: '私密笔记', en: 'PRIVATE MEMORY', color: 'orange' },
};
