import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
import { compile, root } from './compile.mjs';
if (!process.env.MONAD_PRIVATE_KEY)
  throw new Error('Set MONAD_PRIVATE_KEY in .env to a dedicated funded TESTNET wallet.');
const provider = new JsonRpcProvider(
  process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz',
  undefined,
  { batchMaxCount: 1 },
);
try {
  const expectedChain = Number(process.env.MONAD_CHAIN_ID || 10143);
  const actualChain = Number((await provider.getNetwork()).chainId);
  // This script cannot deploy to mainnet; the default deployment target is Monad testnet.
  if (actualChain !== 10143 || expectedChain !== 10143)
    throw new Error(
      `Expected Monad testnet (10143), got ${actualChain}. Mainnet deployment is disabled.`,
    );
  const wallet = new Wallet(process.env.MONAD_PRIVATE_KEY, provider);
  const artifact = compile();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy();
  const tx = contract.deploymentTransaction();
  console.log(`Submitted ${tx.hash}`);
  const receipt = await tx.wait(1);
  const manifest = {
    name: 'AgentPassport',
    chainId: actualChain,
    address: await contract.getAddress(),
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    deployer: wallet.address,
    compiler: artifact.compiler,
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(path.join(root, 'deployments'), { recursive: true });
  writeFileSync(
    path.join(root, 'deployments/monad-testnet.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    `Confirmed contract: ${manifest.address}\nSet MONAD_CONTRACT_ADDRESS=${manifest.address} and CHAIN_MODE=monad in .env.`,
  );
} finally {
  provider.destroy();
}
