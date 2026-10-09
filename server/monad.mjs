import path from 'node:path';
import {
  JsonRpcProvider,
  Wallet,
  ContractFactory,
  Contract,
  formatEther,
  FetchRequest,
} from 'ethers';
import { compile, root } from '../scripts/compile.mjs';
import { readJson, writeJson, serialQueue } from './storage.mjs';

export function installMonadRoutes(app, r, admin) {
  const file = path.join(r.dataDir, 'monad-deployment.json');
  const rpcUrl = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
  const relayAddress = new Wallet(r.keys.owner).address;
  const serialize = serialQueue();
  const connect = () => {
    const transport = new FetchRequest(rpcUrl);
    transport.timeout = 15000;
    const provider = new JsonRpcProvider(transport, undefined, {
      batchMaxCount: 1,
      cacheTimeout: -1,
    });
    return { provider, wallet: new Wallet(r.keys.owner, provider) };
  };
  async function requireTestnet(provider) {
    if (Number((await provider.getNetwork()).chainId) !== 10143)
      throw Object.assign(new Error('RPC 不是 Monad 测试网（10143）'), {
        code: 'WRONG_CHAIN',
        status: 400,
      });
  }
  app.get('/api/monad/status', async (req, res) => {
    const { provider } = connect();
    try {
      await requireTestnet(provider);
      const balance = await provider.getBalance(relayAddress);
      res.json({
        chainId: 10143,
        rpcUrl,
        relayAddress,
        balanceWei: balance.toString(),
        balance: formatEther(balance),
        funded: balance > 0n,
        deployment: readJson(file, null),
        active: r.mode === 'monad',
        faucetUrl: 'https://faucet.monad.xyz',
      });
    } catch {
      res.status(502).json({
        code: 'MONAD_RPC_UNAVAILABLE',
        error: 'Monad 测试网 RPC 暂时不可用，请稍后重试',
        relayAddress,
        faucetUrl: 'https://faucet.monad.xyz',
      });
    } finally {
      provider.destroy();
    }
  });
  app.get('/api/monad/artifact', (req, res) => res.json(compile()));
  app.post('/api/monad/deploy', admin, async (req, res) => {
    const manifest = await serialize(async () => {
      const existing = readJson(file, null);
      if (existing) return existing;
      const { provider, wallet } = connect();
      try {
        await requireTestnet(provider);
        if ((await provider.getBalance(relayAddress)) === 0n)
          throw Object.assign(new Error('请先为显示的本机测试钱包领取测试网 MON'), {
            code: 'TESTNET_FUNDS_REQUIRED',
            status: 400,
          });
        const artifact = compile();
        const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
        const contract = await factory.deploy();
        const tx = contract.deploymentTransaction();
        const receipt = await tx.wait(1);
        const manifest = {
          name: 'AgentPassport',
          protocolVersion: 2,
          chainId: 10143,
          address: await contract.getAddress(),
          transactionHash: tx.hash,
          blockNumber: receipt.blockNumber,
          deployer: wallet.address,
          deployedAt: new Date().toISOString(),
          rpcUrl,
        };
        writeJson(file, manifest);
        writeJson(path.join(root, 'deployments/monad-testnet.json'), manifest);
        return manifest;
      } finally {
        provider.destroy();
      }
    });
    res.json({ deployment: manifest });
  });
  app.post('/api/monad/activate', admin, async (req, res) => {
    const deployment = readJson(file, null);
    if (!deployment)
      return res.status(400).json({ code: 'DEPLOYMENT_REQUIRED', error: '请先完成测试网部署' });
    const { provider } = connect();
    try {
      await requireTestnet(provider);
      const contract = new Contract(
        deployment.address,
        ['function protocolVersion() view returns (uint256)'],
        provider,
      );
      if ((await contract.protocolVersion()) !== 2n) throw new Error('Unexpected contract version');
      if ((await provider.getBalance(relayAddress)) === 0n)
        return res.status(400).json({
          code: 'TESTNET_FUNDS_REQUIRED',
          error: '中继钱包需要测试网 MON 才能提交授权交易',
        });
      writeJson(path.join(r.dataDir, 'network.json'), {
        mode: 'monad',
        contractAddress: deployment.address,
        rpcUrl,
      });
      res.json({
        configured: true,
        restartRequired: !process.send,
        message: '测试网配置已保存，正在重启服务',
      });
      if (process.send) setTimeout(() => process.send({ type: 'restart' }), 600);
    } finally {
      provider.destroy();
    }
  });
}
