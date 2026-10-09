import type { Provider } from 'ethers';
export type PassportConfig = {
  vaultUrl: string;
  rpcUrl?: string;
  contractAddress: string;
  privateKey: string;
  chainId: number;
  provider?: Provider;
  fetchImpl?: typeof fetch;
};
export declare class PassportError extends Error {
  code: string;
}
export declare class AgentPassportClient {
  constructor(config: PassportConfig);
  identity(
    agentId: number | string,
  ): Promise<{ owner: string; signer: string; profileHash: string; active: boolean }>;
  readMemory(grantId: string): Promise<{
    memory: { id: string; kind: string; title: string; content: string };
    receipt: Record<string, unknown>;
    proof: Record<string, unknown>;
  }>;
  saveMemory(input: {
    agentId: number | string;
    kind: string;
    title: string;
    content: string;
  }): Promise<unknown>;
  recordResult(requestId: string, output: unknown, validation: unknown): Promise<unknown>;
}
export declare function verifyReceipt(
  receipt: any,
  provider: Provider,
): Promise<{
  valid: boolean;
  checks: Record<string, boolean>;
  signer: string;
  digest: string;
  blockNumber?: number;
}>;
export declare function hashJson(value: unknown): string;
export declare function canonicalJson(value: unknown): string;
export declare function newId(): string;
