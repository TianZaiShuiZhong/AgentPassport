import { AbiCoder, keccak256 } from 'ethers';
const fields = (entries) => entries.map(([name, type]) => ({ name, type }));
const tail = [
  ['nonce', 'uint256'],
  ['deadline', 'uint64'],
];
export const REGISTRATION_TYPES = {
  Registration: fields([
    ['owner', 'address'],
    ['signer', 'address'],
    ['ingestor', 'address'],
    ['profileHash', 'bytes32'],
    ...tail,
  ]),
};
export const GRANT_BATCH_TYPES = {
  GrantBatch: fields([
    ['agentId', 'uint256'],
    ['app', 'address'],
    ['memoryIdsHash', 'bytes32'],
    ['grantIdsHash', 'bytes32'],
    ['expiresAt', 'uint64'],
    ['uses', 'uint32'],
    ...tail,
  ]),
};
export const REVOKE_BATCH_TYPES = {
  RevokeBatch: fields([['agentId', 'uint256'], ['grantIdsHash', 'bytes32'], ...tail]),
};
export const INGESTOR_TYPES = {
  IngestorUpdate: fields([['agentId', 'uint256'], ['ingestor', 'address'], ...tail]),
};
export const MEMORY_COMMIT_TYPES = {
  MemoryCommit: fields([
    ['agentId', 'uint256'],
    ['memoryId', 'bytes32'],
    ['ciphertextHash', 'bytes32'],
    ...tail,
  ]),
};
export const hashIds = (ids) => keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32[]'], [ids]));
