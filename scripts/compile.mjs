import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import solc from 'solc';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function compile() {
  const source = readFileSync(path.join(root, 'contracts/AgentPassport.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'AgentPassport.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        try {
          return { contents: readFileSync(path.join(root, 'node_modules', name), 'utf8') };
        } catch {
          return { error: `Import not found: ${name}` };
        }
      },
    }),
  );
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = output.contracts['AgentPassport.sol'].AgentPassport;
  return {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    compiler: solc.version(),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const artifact = compile();
  writeFileSync(path.join(root, 'artifacts/AgentPassport.json'), JSON.stringify(artifact, null, 2));
  console.log(
    `AgentPassport compiled (${artifact.compiler}); bytecode ${(artifact.bytecode.length - 2) / 2} bytes.`,
  );
}
