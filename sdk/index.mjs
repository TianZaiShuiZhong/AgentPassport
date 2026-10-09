import {
  Contract,
  JsonRpcProvider,
  Wallet,
  TypedDataEncoder,
  verifyTypedData,
  keccak256,
  toUtf8Bytes,
  randomBytes,
  hexlify,
} from 'ethers';

export const ACCESS_TYPES = {
  Access: [
    { name: 'grantId', type: 'bytes32' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
};
export const RESULT_TYPES = {
  Result: [
    { name: 'requestId', type: 'bytes32' },
    { name: 'resultHash', type: 'bytes32' },
    { name: 'validationHash', type: 'bytes32' },
  ],
};
export const READ_ABI = [
  'function agents(uint256) view returns (address owner,address signer,bytes32 profileHash,bool active)',
  'function memories(bytes32) view returns (uint256 agentId,bytes32 ciphertextHash,bool active)',
  'function grants(bytes32) view returns (uint256 agentId,address app,bytes32 memoryId,uint64 expiresAt,uint32 remaining,bool revoked)',
  'function nonces(address) view returns (uint256)',
  'function receiptDigests(bytes32) view returns (bytes32)',
  'function receiptMemoryHashes(bytes32) view returns (bytes32)',
  'function receiptApps(bytes32) view returns (address)',
  'function taskDigests(bytes32) view returns (bytes32)',
  'function taskResultHashes(bytes32) view returns (bytes32)',
  'event AccessRecorded(bytes32 indexed requestId,bytes32 indexed grantId,address indexed app,bytes32 memoryId,bytes32 ciphertextHash,bytes32 digest,uint256 timestamp)',
  'event ResultRecorded(bytes32 indexed requestId,address indexed app,bytes32 resultHash,bytes32 validationHash,bytes32 digest)',
];
// Protocol v1 canonical JSON: sorted object keys, preserved array order, JSON primitives.
export const canonicalJson = (value) =>
  JSON.stringify(value, function (key, item) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter((k) => item[k] !== undefined)
          .map((k) => [k, item[k]]),
      );
    }
    return item;
  });
export const hashJson = (value) => keccak256(toUtf8Bytes(canonicalJson(value)));
export const newId = () => hexlify(randomBytes(32));
export const domainFor = (chainId, address) => ({
  name: 'AgentPassport',
  version: '1',
  chainId: Number(chainId),
  verifyingContract: address,
});

export class PassportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Each application holds its own signer and independently reads the chain. */
export class AgentPassportClient {
  constructor({
    vaultUrl,
    rpcUrl,
    contractAddress,
    privateKey,
    chainId,
    provider,
    fetchImpl = fetch,
  }) {
    this.vaultUrl = vaultUrl.replace(/\/$/, '');
    this.provider =
      provider || new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    this.signer = new Wallet(privateKey);
    this.contract = new Contract(contractAddress, READ_ABI, this.provider);
    this.domain = domainFor(chainId, contractAddress);
    this.fetch = fetchImpl;
  }
  async call(path, body) {
    const response = await this.fetch(
      `${this.vaultUrl}${path}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json();
    if (!response.ok)
      throw new PassportError(data.code || 'REQUEST_FAILED', data.error || 'Request failed');
    return data;
  }
  async identity(agentId) {
    const a = await this.contract.agents(agentId);
    if (!a.active) throw new PassportError('INVALID_AGENT', 'Agent is inactive');
    return { owner: a.owner, signer: a.signer, profileHash: a.profileHash, active: a.active };
  }
  async readMemory(grantId) {
    const g = await this.contract.grants(grantId);
    if (g.app.toLowerCase() !== this.signer.address.toLowerCase())
      throw new PassportError('WRONG_APPLICATION', 'This grant belongs to a different application');
    await this.identity(g.agentId);
    if (g.revoked) throw new PassportError('REVOKED', 'Authorization has been revoked');
    if (g.remaining === 0n)
      throw new PassportError('EXHAUSTED', 'Authorization has no remaining reads');
    const block = await this.provider.getBlock('latest');
    const chainNow =
      this.domain.chainId === 1337
        ? Math.max(block.timestamp, Math.floor(Date.now() / 1000))
        : block.timestamp;
    if (BigInt(chainNow) >= g.expiresAt)
      throw new PassportError('EXPIRED', 'Authorization has expired');
    const memory = await this.contract.memories(g.memoryId);
    if (!memory.active) throw new PassportError('INVALID_MEMORY', 'Memory is disabled');
    const access = {
      grantId,
      requestId: newId(),
      nonce: (await this.contract.nonces(this.signer.address)).toString(),
      deadline: chainNow + 60,
    };
    const signature = await this.signer.signTypedData(this.domain, ACCESS_TYPES, access);
    const data = await this.call('/api/access', { access, signature });
    if (
      !data.receipt ||
      data.receipt.type !== 'access' ||
      TypedDataEncoder.hash(data.receipt.domain, ACCESS_TYPES, data.receipt.access) !==
        TypedDataEncoder.hash(this.domain, ACCESS_TYPES, access) ||
      data.receipt.signature !== signature ||
      data.receipt.app.toLowerCase() !== this.signer.address.toLowerCase() ||
      data.memory?.id !== g.memoryId ||
      data.receipt.memoryId !== g.memoryId
    ) {
      throw new PassportError(
        'INVALID_RECEIPT',
        'Vault response does not match the signed request',
      );
    }
    // Independent read against our own RPC, not just a trust in the vault's response.
    const proof = await verifyReceipt(data.receipt, this.provider);
    if (!proof.valid)
      throw new PassportError('INVALID_RECEIPT', 'Chain receipt verification failed');
    return { memory: data.memory, receipt: data.receipt, proof };
  }
  async saveMemory({ agentId, kind, title, content }) {
    const message = {
      app: this.signer.address,
      agentId: String(agentId),
      kind,
      title,
      content,
      requestId: newId(),
      deadline: Math.floor(Date.now() / 1000) + 60,
    };
    const signature = await this.signer.signMessage(JSON.stringify(message));
    return this.call('/api/ingest', { message, signature });
  }
  async recordResult(requestId, output, validation) {
    const result = {
      requestId,
      resultHash: hashJson(output),
      validationHash: hashJson(validation),
    };
    const signature = await this.signer.signTypedData(this.domain, RESULT_TYPES, result);
    return this.call('/api/results', { result, signature, output, validation });
  }
}

/** Verifies the signature, on-chain storage AND event in the specified transaction. */
export async function verifyReceipt(receipt, provider) {
  const network = await provider.getNetwork();
  const checks = {};
  checks.chain = Number(network.chainId) === Number(receipt.domain.chainId);
  const contract = new Contract(receipt.domain.verifyingContract, READ_ABI, provider);
  const types = receipt.type === 'result' ? RESULT_TYPES : ACCESS_TYPES;
  const value = receipt.type === 'result' ? receipt.result : receipt.access;
  const digest = TypedDataEncoder.hash(receipt.domain, types, value);
  const recovered = verifyTypedData(receipt.domain, types, value, receipt.signature);
  checks.signature = recovered.toLowerCase() === receipt.app.toLowerCase();
  checks.domain = receipt.domain.name === 'AgentPassport' && receipt.domain.version === '1';
  const tx = await provider.getTransactionReceipt(receipt.txHash);
  checks.transaction = Boolean(
    tx &&
    tx.status === 1 &&
    tx.to?.toLowerCase() === receipt.domain.verifyingContract.toLowerCase(),
  );
  if (receipt.type === 'result') {
    checks.commitment = (await contract.taskDigests(value.requestId)) === digest;
    checks.content =
      hashJson(receipt.output) === value.resultHash &&
      hashJson(receipt.validation) === value.validationHash;
  } else {
    checks.commitment = (await contract.receiptDigests(value.requestId)) === digest;
    checks.memory =
      (await contract.receiptMemoryHashes(value.requestId)) === receipt.ciphertextHash;
  }
  checks.application =
    (await contract.receiptApps(value.requestId)).toLowerCase() === recovered.toLowerCase();
  const eventName = receipt.type === 'result' ? 'ResultRecorded' : 'AccessRecorded';
  checks.event = Boolean(
    tx?.logs.some((log) => {
      if (log.address.toLowerCase() !== receipt.domain.verifyingContract.toLowerCase())
        return false;
      try {
        const event = contract.interface.parseLog(log);
        return (
          event?.name === eventName &&
          event.args.requestId === value.requestId &&
          event.args.digest === digest &&
          event.args.app.toLowerCase() === recovered.toLowerCase() &&
          (receipt.type === 'result'
            ? event.args.resultHash === value.resultHash &&
              event.args.validationHash === value.validationHash
            : event.args.ciphertextHash === receipt.ciphertextHash)
        );
      } catch {
        return false;
      }
    }),
  );
  return {
    valid: Object.values(checks).every(Boolean),
    checks,
    signer: recovered,
    digest,
    blockNumber: tx?.blockNumber,
  };
}
