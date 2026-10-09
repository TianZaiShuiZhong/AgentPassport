import { readFileSync } from 'node:fs';
import { JsonRpcProvider } from 'ethers';
import { verifyReceipt } from '../sdk/index.mjs';
const [file, rpcUrl] = process.argv.slice(2);
if (!file || !rpcUrl) {
  console.error('Usage: npm run verify:receipt -- receipt.json https://your-rpc-url');
  process.exit(2);
}
const receipt = JSON.parse(readFileSync(file, 'utf8'));
const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
try {
  const result = await verifyReceipt(receipt, provider);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
} finally {
  provider.destroy();
}
