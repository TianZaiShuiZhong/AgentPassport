import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../server/runtime.mjs';
import { readJson, writeJson } from '../server/storage.mjs';
import { decryptMemory, envelopeHash } from '../server/crypto.mjs';

test('upgrade preserves encrypted user memories and archives the previous deployment', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'agentpassport-migration-'));
  let r;
  try {
    r = await createRuntime({ dataDir, mode: 'local', persistent: true });
    await r.addMemory({
      kind: 'private',
      title: '升级保留测试',
      content: 'PRESERVE_THIS_PRIVATE_CONTEXT',
    });
    const oldAddress = r.state.contractAddress,
      oldIds = r.state.memories.map((m) => m.id);
    await r.close();
    r = null;
    const stateFile = path.join(dataDir, 'state-local.json'),
      old = readJson(stateFile, null);
    old.version = 1;
    writeJson(stateFile, old);
    r = await createRuntime({ dataDir, mode: 'local', persistent: true });
    assert.notEqual(r.state.contractAddress, oldAddress);
    assert.equal(r.state.version, 2);
    assert.equal(r.state.memories.length, oldIds.length);
    assert.equal(
      r.state.memories.filter((m) => oldIds.includes(m.migratedFrom)).length,
      oldIds.length,
    );
    const memory = r.state.memories.find((m) => m.title === '升级保留测试');
    assert.equal(
      decryptMemory(r.encryptionKey, r.vault[memory.id], r.vault[memory.id].aad).content,
      'PRESERVE_THIS_PRIVATE_CONTEXT',
    );
    assert.equal(
      (await r.contract.memories(memory.id)).ciphertextHash,
      envelopeHash(r.vault[memory.id]),
    );
    assert.equal(readdirSync(path.join(dataDir, 'archive')).length, 1);
    const newAddress = r.state.contractAddress;
    await r.close();
    r = null;
    r = await createRuntime({ dataDir, mode: 'local', persistent: true });
    assert.equal(r.state.contractAddress, newAddress);
    assert.equal(r.state.memories.length, oldIds.length, 'No duplicate memories on restart');
  } finally {
    if (r) await r.close();
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
