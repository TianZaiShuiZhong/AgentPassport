import {
  request,
  selectWorkspace,
  saveWalletSession,
  getWalletSession,
  expireWalletSession,
  type Config,
} from './api';
type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, fn: (...args: any[]) => void) => void;
  removeListener?: (event: string, fn: (...args: any[]) => void) => void;
};
export const injected = () => (window as Window & { ethereum?: Injected }).ethereum;
export async function switchNetwork(config: Config) {
  const provider = injected();
  if (!provider)
    throw new Error(
      '未检测到钱包扩展。请用安装了 MetaMask 或 Rabby 的 Chrome / Edge 打开当前地址。',
    );
  const chainId = `0x${config.chainId.toString(16)}`;
  if ((await provider.request({ method: 'eth_chainId' })) === chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e: any) {
    if (e.code !== 4902) throw e;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: config.mode === 'monad' ? 'Monad Testnet' : 'AgentPassport Local EVM',
          nativeCurrency: {
            name: config.mode === 'monad' ? 'MON' : 'Demo Ether',
            symbol: config.mode === 'monad' ? 'MON' : 'ETH',
            decimals: 18,
          },
          rpcUrls: [config.rpcUrl],
          ...(config.explorer ? { blockExplorerUrls: [config.explorer] } : {}),
        },
      ],
    });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
export async function loginWallet() {
  const ethereum = injected();
  if (!ethereum)
    throw new Error(
      '未检测到钱包扩展。请用安装了 MetaMask 或 Rabby 的 Chrome / Edge 打开当前地址。',
    );
  await ethereum.request({ method: 'eth_requestAccounts' });
  const { BrowserProvider } = await import('ethers');
  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const challenge = await request('vault', '/wallet/challenge', {
    walletAddress: await signer.getAddress(),
  });
  const signature = await signer.signMessage(challenge.message);
  const login = await request('vault', '/wallet/login', { id: challenge.id, signature });
  saveWalletSession(login);
  selectWorkspace(login.workspace?.agentId);
  return login as { address: string; workspace: { agentId: number } | null; expiresAt: number };
}
export async function walletOperation(
  config: Config,
  operation: string,
  input: Record<string, unknown> = {},
) {
  await switchNetwork(config);
  const ethereum = injected()!;
  const { BrowserProvider } = await import('ethers');
  const provider = new BrowserProvider(ethereum),
    signer = await provider.getSigner();
  const prepared = await request('vault', '/wallet/prepare', {
    operation,
    agentId: config.agentId,
    ...input,
  });
  const signature = await signer.signTypedData(prepared.domain, prepared.types, prepared.value);
  const result = await request('vault', '/wallet/execute', { id: prepared.id, signature });
  if (result.workspace) {
    selectWorkspace(result.workspace.agentId);
    const session = getWalletSession();
    if (session) saveWalletSession({ ...session, workspace: result.workspace });
  }
  return result;
}
export function forgetWallet(returnToDemo = true) {
  void request('vault', '/wallet/logout', {}).catch(() => {});
  expireWalletSession();
  if (returnToDemo) selectWorkspace(undefined);
}
