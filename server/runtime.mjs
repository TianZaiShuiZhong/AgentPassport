import 'dotenv/config';
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import ganache from 'ganache';
import {
  BrowserProvider,
  JsonRpcProvider,
  Wallet,
  NonceManager,
  Contract,
  ContractFactory,
} from 'ethers';
import { compile, root } from '../scripts/compile.mjs';
import { readJson, writeJson, serialQueue } from './storage.mjs';
import { newId, hashJson, domainFor } from '../sdk/index.mjs';
import { encryptMemory, envelopeHash } from './crypto.mjs';
import { decryptMemory } from './crypto.mjs';
import { MEMORY_COMMIT_TYPES } from '../sdk/owner.mjs';

export const APP_INFO = {
  research: {
    name: 'Research Studio',
    nameZh: '研究助手',
    purpose: '提取并保存结构化项目记忆',
    color: 'blue',
  },
  writer: {
    name: 'Writing Studio',
    nameZh: '写作助手',
    purpose: '在授权范围内复用记忆、生成文章',
    color: 'purple',
  },
};

export async function createRuntime({
  dataDir = path.join(root, '.data'),
  persistent = true,
  mode = null,
} = {}) {
  const networkSettings = readJson(path.join(dataDir, 'network.json'), null);
  mode ||= networkSettings?.mode || process.env.CHAIN_MODE || 'local';
  const rpcUrl =
    networkSettings?.rpcUrl || process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
  const configuredContract = networkSettings?.contractAddress || process.env.MONAD_CONTRACT_ADDRESS;
  if (!['local', 'monad'].includes(mode)) throw new Error('CHAIN_MODE must be local or monad');
  mkdirSync(dataDir, { recursive: true });
  const keysFile = path.join(dataDir, 'keys.json');
  const keys =
    readJson(keysFile, null) ||
    Object.fromEntries(
      ['owner', 'agent', 'research', 'writer'].map((k) => [k, Wallet.createRandom().privateKey]),
    );
  if (!existsSync(keysFile)) writeJson(keysFile, keys);
  for (const role of ['research', 'writer'])
    writeJson(path.join(dataDir, `app-key-${role}.json`), { privateKey: keys[role] });
  let eip1193, provider;
  const artifact = compile();
  let ownerKey = keys.owner;
  if (mode === 'local') {
    eip1193 = ganache.provider({
      chain: { chainId: 1337, hardfork: 'shanghai' },
      logging: { quiet: true },
      wallet: { accounts: [{ secretKey: keys.owner, balance: '0x3635c9adc5dea00000' }] },
      ...(persistent ? { database: { dbPath: path.join(dataDir, 'chain') } } : {}),
    });
    provider = new BrowserProvider(eip1193, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 100;
  } else {
    if ((!networkSettings && !process.env.MONAD_PRIVATE_KEY) || !configuredContract)
      throw new Error('Monad mode needs MONAD_PRIVATE_KEY and MONAD_CONTRACT_ADDRESS. See README.');
    ownerKey = networkSettings ? keys.owner : process.env.MONAD_PRIVATE_KEY;
    provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  }
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (mode === 'monad' && chainId !== Number(process.env.MONAD_CHAIN_ID || 10143))
    throw new Error('RPC chain ID differs from configured Monad testnet');
  const owner = new NonceManager(new Wallet(ownerKey, provider));
  const stateFile = path.join(dataDir, `state-${mode}.json`);
  const vaultFile = path.join(dataDir, `vault-${mode}.json`);
  let state = readJson(stateFile, null);
  let migrated = [];
  let migrationArchive = null;
  if (state && state.version < 2) {
    if (mode !== 'local')
      throw new Error(
        'Deploy protocol v2 to a new testnet contract and use a new DATA_DIR. Existing deployment is preserved.',
      );
    const archive = path.join(dataDir, 'archive', `v1-${Date.now()}`);
    migrationArchive = archive;
    mkdirSync(archive, { recursive: true });
    copyFileSync(stateFile, path.join(archive, path.basename(stateFile)));
    const oldVault = readJson(vaultFile, {});
    if (existsSync(vaultFile))
      copyFileSync(vaultFile, path.join(archive, path.basename(vaultFile)));
    const oldKey = readFileSync(path.join(dataDir, 'master.key'));
    migrated = state.memories.map((m) => ({
      ...decryptMemory(oldKey, oldVault[m.id], oldVault[m.id].aad),
      source: m.source,
      migratedFrom: m.id,
    }));
    state = null;
  }
  const expectedAddress = configuredContract;
  if (
    mode === 'monad' &&
    state &&
    state.contractAddress.toLowerCase() !== expectedAddress.toLowerCase()
  )
    throw new Error(
      'Existing state uses a different contract. Use a separate DATA_DIR for a new deployment.',
    );
  let address = state?.contractAddress || (mode === 'monad' ? expectedAddress : null);
  if (!address) {
    const deployment = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy();
    await deployment.waitForDeployment();
    address = await deployment.getAddress();
  }
  const code = await provider.getCode(address);
  if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) {
    // EIP712 contains immutables, so compare the executable ABI through a probe instead.
    if (code === '0x') throw new Error('Configured contract has no bytecode');
  }
  const contract = new Contract(address, artifact.abi, owner);
  const ownerAddress = await owner.getAddress();
  if (!state) {
    const profile = { name: 'Atlas', description: 'Research and writing agent', version: 1 };
    const tx = await contract.register(new Wallet(keys.agent).address, hashJson(profile));
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.name === 'AgentRegistered');
    state = {
      version: 2,
      migrationArchive,
      contractAddress: address,
      chainId,
      agentId: Number(event.args.agentId),
      owner: ownerAddress,
      createdAt: new Date().toISOString(),
      identityTx: tx.hash,
      memories: [],
      grants: [],
      receipts: [],
      audit: [],
      seedCompleted: false,
      workspaces: [],
    };
    writeJson(stateFile, state);
  }
  const agent = await contract.agents(state.agentId);
  if (agent.owner.toLowerCase() !== ownerAddress.toLowerCase())
    throw new Error('Configured key does not own this Agent');
  const keyFile = path.join(dataDir, 'master.key');
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const encryptionKey = readFileSync(keyFile);
  const vault = readJson(vaultFile, {});
  if (state.migrationArchive && !migrated.length) {
    const oldState = readJson(path.join(state.migrationArchive, path.basename(stateFile)), null);
    const oldVault = readJson(path.join(state.migrationArchive, path.basename(vaultFile)), {});
    migrated = oldState.memories.map((m) => ({
      ...decryptMemory(encryptionKey, oldVault[m.id], oldVault[m.id].aad),
      source: m.source,
      migratedFrom: m.id,
    }));
  }
  state.workspaces ||= [];
  for (const list of [state.memories, state.grants, state.receipts, state.audit]) {
    for (const item of list) item.agentId ||= state.agentId;
  }
  const serialize = serialQueue();
  const queue = (work) =>
    serialize(async () => {
      try {
        return await work();
      } catch (error) {
        // ethers NonceManager increments before send/estimate; a rejected write must
        // discard that local nonce so the next transaction cannot get stuck in a gap.
        owner.reset();
        throw error;
      }
    });
  const apps = Object.fromEntries(
    Object.entries(APP_INFO).map(([id, info]) => [
      id,
      { id, ...info, address: new Wallet(keys[id]).address },
    ]),
  );
  const runtime = {
    dataDir,
    state,
    vault,
    keys,
    apps,
    owner,
    provider,
    contract,
    chainId,
    mode,
    chainTime: async () => {
      const block = await provider.getBlock('latest');
      return mode === 'local'
        ? Math.max(block.timestamp, Math.floor(Date.now() / 1000))
        : block.timestamp;
    },
    rpcUrl: mode === 'local' ? null : rpcUrl,
    encryptionKey,
    queue,
    domain: domainFor(chainId, address),
    adminToken: randomBytes(32).toString('hex'),
    save: () => {
      writeJson(vaultFile, vault);
      writeJson(stateFile, state);
    },
    audit: (type, details) => {
      state.audit.unshift({
        id: newId(),
        type,
        agentId: state.agentId,
        at: new Date().toISOString(),
        ...details,
      });
      state.audit = state.audit.slice(0, 300);
      writeJson(stateFile, state);
    },
    close: async () => {
      provider.destroy();
      if (eip1193) await eip1193.disconnect();
    },
    rpc: async (method, params) => {
      if (eip1193) return eip1193.request({ method, params });
      return provider.send(method, params);
    },
  };
  runtime.workspace = (id) =>
    Number(id) === state.agentId
      ? {
          agentId: state.agentId,
          owner: state.owner,
          identityTx: state.identityTx,
          createdAt: state.createdAt,
          controlMode: 'demo',
        }
      : state.workspaces.find((w) => w.agentId === Number(id));
  runtime.addMemory = async ({
    kind,
    title,
    content,
    source = 'research',
    agentId = state.agentId,
    migratedFrom,
  }) => {
    const id = newId();
    const aad = `${chainId}:${address}:${agentId}:${id}:${kind}`;
    const envelope = encryptMemory(encryptionKey, { id, kind, title, content }, aad);
    const ciphertextHash = envelopeHash(envelope);
    // Persist ciphertext before the on-chain write: no plaintext is stored in the vault.
    vault[id] = envelope;
    writeJson(vaultFile, vault);
    let tx;
    try {
      if (agentId === state.agentId) tx = await contract.commitMemory(agentId, id, ciphertextHash);
      else {
        const block = await provider.getBlock('latest');
        const signer = new Wallet(keys.research);
        const commit = {
          agentId,
          memoryId: id,
          ciphertextHash,
          nonce: (await contract.ownerNonces(signer.address)).toString(),
          deadline: block.timestamp + 120,
        };
        const signature = await signer.signTypedData(runtime.domain, MEMORY_COMMIT_TYPES, commit);
        tx = await contract.commitMemoryFor(commit, signature);
      }
      await tx.wait();
    } catch (error) {
      delete vault[id];
      writeJson(vaultFile, vault);
      throw error;
    }
    const memory = {
      ...(migratedFrom ? { migratedFrom } : {}),
      agentId,
      id,
      kind,
      title,
      source,
      ciphertextHash,
      createdAt: new Date().toISOString(),
      txHash: tx.hash,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
    state.memories.unshift(memory);
    runtime.audit('memory_saved', { agentId, title, memoryId: id, source, txHash: tx.hash });
    runtime.save();
    return memory;
  };
  for (const memory of migrated)
    if (!state.memories.some((m) => m.migratedFrom === memory.migratedFrom))
      await runtime.addMemory(memory);
  if (state.migrationArchive) {
    state.migrationArchive = null;
    runtime.save();
  }
  if (!state.seedCompleted) {
    const seeds = [
      {
        kind: 'background',
        title: 'AgentPassport · 项目背景',
        content:
          'AgentPassport 是面向 AI 智能体的跨应用记忆与授权协议。用户可以授权指定应用访问特定记忆，并设置次数、有效期与撤销权限。身份、授权和凭证承诺保存在 Monad；记忆正文保存在加密的链下存储。参赛赛道：Trust, Identity & AI Infrastructure。目标用户是多应用 AI 使用者和 Agent 应用开发者。',
      },
      {
        kind: 'preferences',
        title: '我的写作偏好',
        content:
          '用中文撰写。先解释用户的问题，再介绍方案。语气清晰、克制，避免夸张宣传。使用一个具体例子；最后说明实现边界。不要宣称链上凭证证明 AI 推理正确。',
      },
      {
        kind: 'private',
        title: '仅自己可见 · 私密笔记',
        content:
          'PRIVATE_DEMO_NOTE: 下周内部讨论预算和未发布计划。此内容仅供演示权限隔离，不允许分享给写作应用。',
      },
    ];
    for (const seed of seeds) {
      if (!state.memories.some((m) => m.title === seed.title)) await runtime.addMemory(seed);
    }
    state.seedCompleted = true;
    runtime.save();
  }
  return runtime;
}
