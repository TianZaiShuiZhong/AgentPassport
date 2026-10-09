// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice MVP identity, encrypted-memory commitments and scoped access receipts.
/// @dev Custom MVP registry, NOT a complete ERC-8004 implementation. No plaintext on-chain.
contract AgentPassport is EIP712 {
    struct Agent { address owner; address signer; bytes32 profileHash; bool active; }
    struct Memory { uint256 agentId; bytes32 ciphertextHash; bool active; }
    struct Grant { uint256 agentId; address app; bytes32 memoryId; uint64 expiresAt; uint32 remaining; bool revoked; }
    struct Access { bytes32 grantId; bytes32 requestId; uint256 nonce; uint64 deadline; }
    struct Result { bytes32 requestId; bytes32 resultHash; bytes32 validationHash; }
    struct Registration { address owner; address signer; address ingestor; bytes32 profileHash; uint256 nonce; uint64 deadline; }
    struct GrantBatch { uint256 agentId; address app; bytes32 memoryIdsHash; bytes32 grantIdsHash; uint64 expiresAt; uint32 uses; uint256 nonce; uint64 deadline; }
    struct RevokeBatch { uint256 agentId; bytes32 grantIdsHash; uint256 nonce; uint64 deadline; }
    struct IngestorUpdate { uint256 agentId; address ingestor; uint256 nonce; uint64 deadline; }
    struct MemoryCommit { uint256 agentId; bytes32 memoryId; bytes32 ciphertextHash; uint256 nonce; uint64 deadline; }

    uint256 public agentCount;
    uint256 public receiptCount;
    mapping(uint256 => Agent) public agents;
    mapping(bytes32 => Memory) public memories;
    mapping(bytes32 => Grant) public grants;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bytes32) public receiptDigests;
    mapping(bytes32 => bytes32) public receiptMemoryHashes;
    mapping(bytes32 => address) public receiptApps;
    mapping(bytes32 => bytes32) public taskDigests;
    mapping(bytes32 => bytes32) public taskResultHashes;
    mapping(address => uint256) public ownerNonces;
    mapping(uint256 => address) public ingestors;
    bytes32 public constant ACCESS_TYPEHASH = keccak256("Access(bytes32 grantId,bytes32 requestId,uint256 nonce,uint64 deadline)");
    bytes32 public constant RESULT_TYPEHASH = keccak256("Result(bytes32 requestId,bytes32 resultHash,bytes32 validationHash)");
    bytes32 private constant REGISTRATION_TYPEHASH = keccak256("Registration(address owner,address signer,address ingestor,bytes32 profileHash,uint256 nonce,uint64 deadline)");
    bytes32 private constant GRANT_BATCH_TYPEHASH = keccak256("GrantBatch(uint256 agentId,address app,bytes32 memoryIdsHash,bytes32 grantIdsHash,uint64 expiresAt,uint32 uses,uint256 nonce,uint64 deadline)");
    bytes32 private constant REVOKE_BATCH_TYPEHASH = keccak256("RevokeBatch(uint256 agentId,bytes32 grantIdsHash,uint256 nonce,uint64 deadline)");
    bytes32 private constant INGESTOR_TYPEHASH = keccak256("IngestorUpdate(uint256 agentId,address ingestor,uint256 nonce,uint64 deadline)");
    bytes32 private constant MEMORY_COMMIT_TYPEHASH = keccak256("MemoryCommit(uint256 agentId,bytes32 memoryId,bytes32 ciphertextHash,uint256 nonce,uint64 deadline)");

    error NotOwner(); error InvalidAgent(); error InvalidMemory(); error InvalidGrant();
    error WrongApplication(); error Expired(); error Revoked(); error Exhausted();
    error InvalidNonce(); error InvalidSignature(); error DuplicateRequest();

    event AgentRegistered(uint256 indexed agentId, address indexed owner, address signer, bytes32 profileHash);
    event AgentUpdated(uint256 indexed agentId, address signer, bool active);
    event IngestorUpdated(uint256 indexed agentId, address indexed ingestor);
    event MemoryCommitted(bytes32 indexed memoryId, uint256 indexed agentId, bytes32 ciphertextHash);
    event MemoryDisabled(bytes32 indexed memoryId);
    event GrantCreated(bytes32 indexed grantId, uint256 indexed agentId, address indexed app, bytes32 memoryId, uint64 expiresAt, uint32 uses);
    event GrantRevoked(bytes32 indexed grantId);
    event AccessRecorded(bytes32 indexed requestId, bytes32 indexed grantId, address indexed app, bytes32 memoryId, bytes32 ciphertextHash, bytes32 digest, uint256 timestamp);
    event ResultRecorded(bytes32 indexed requestId, address indexed app, bytes32 resultHash, bytes32 validationHash, bytes32 digest);

    constructor() EIP712("AgentPassport", "1") {}
    function protocolVersion() external pure returns (uint256) { return 2; }

    /// @notice Owner remains the wallet that signs; a relayer only pays gas.
    function registerFor(Registration calldata r, bytes calldata signature) external returns (uint256 id) {
        if (r.owner == address(0) || r.signer == address(0)) revert InvalidAgent();
        _signed(r.owner, keccak256(abi.encode(REGISTRATION_TYPEHASH, r)), r.nonce, r.deadline, signature);
        id = ++agentCount;
        agents[id] = Agent(r.owner, r.signer, r.profileHash, true);
        ingestors[id] = r.ingestor;
        emit AgentRegistered(id, r.owner, r.signer, r.profileHash);
        emit IngestorUpdated(id, r.ingestor);
    }

    function grantFor(GrantBatch calldata b, bytes32[] calldata memoryIds, bytes32[] calldata grantIds, bytes calldata signature) external {
        if (memoryIds.length == 0 || memoryIds.length > 20 || memoryIds.length != grantIds.length || keccak256(abi.encode(memoryIds)) != b.memoryIdsHash || keccak256(abi.encode(grantIds)) != b.grantIdsHash) revert InvalidGrant();
        Agent memory a = agents[b.agentId];
        if (!a.active || a.owner == address(0)) revert InvalidAgent();
        _signed(a.owner, keccak256(abi.encode(GRANT_BATCH_TYPEHASH, b)), b.nonce, b.deadline, signature);
        for (uint256 i; i < memoryIds.length; ++i) _grant(grantIds[i], b.agentId, b.app, memoryIds[i], b.expiresAt, b.uses);
    }

    function revokeFor(RevokeBatch calldata b, bytes32[] calldata grantIds, bytes calldata signature) external {
        if (grantIds.length == 0 || grantIds.length > 30 || keccak256(abi.encode(grantIds)) != b.grantIdsHash) revert InvalidGrant();
        address owner = agents[b.agentId].owner;
        if (owner == address(0)) revert InvalidAgent();
        _signed(owner, keccak256(abi.encode(REVOKE_BATCH_TYPEHASH, b)), b.nonce, b.deadline, signature);
        for (uint256 i; i < grantIds.length; ++i) {
            if (grants[grantIds[i]].agentId != b.agentId) revert InvalidGrant();
            grants[grantIds[i]].revoked = true;
            emit GrantRevoked(grantIds[i]);
        }
    }

    function updateIngestorFor(IngestorUpdate calldata u, bytes calldata signature) external {
        address owner = agents[u.agentId].owner;
        if (owner == address(0)) revert InvalidAgent();
        _signed(owner, keccak256(abi.encode(INGESTOR_TYPEHASH, u)), u.nonce, u.deadline, signature);
        ingestors[u.agentId] = u.ingestor;
        emit IngestorUpdated(u.agentId, u.ingestor);
    }

    function commitMemoryFor(MemoryCommit calldata c, bytes calldata signature) external {
        address ingestor = ingestors[c.agentId];
        if (ingestor == address(0) || !agents[c.agentId].active) revert InvalidAgent();
        _signed(ingestor, keccak256(abi.encode(MEMORY_COMMIT_TYPEHASH, c)), c.nonce, c.deadline, signature);
        _commit(c.agentId, c.memoryId, c.ciphertextHash);
    }

    function _signed(address signer, bytes32 hash, uint256 nonce, uint64 deadline, bytes calldata signature) private {
        if (block.timestamp >= deadline) revert Expired();
        if (ownerNonces[signer] != nonce) revert InvalidNonce();
        if (ECDSA.recover(_hashTypedDataV4(hash), signature) != signer) revert InvalidSignature();
        ++ownerNonces[signer];
    }

    function register(address signer, bytes32 profileHash) external returns (uint256 id) {
        if (signer == address(0)) revert InvalidAgent();
        id = ++agentCount;
        agents[id] = Agent(msg.sender, signer, profileHash, true);
        emit AgentRegistered(id, msg.sender, signer, profileHash);
    }

    function updateAgent(uint256 id, address signer, bool active) external {
        _owner(id);
        if (signer == address(0)) revert InvalidAgent();
        agents[id].signer = signer;
        agents[id].active = active;
        emit AgentUpdated(id, signer, active);
    }

    function commitMemory(uint256 agentId, bytes32 memoryId, bytes32 ciphertextHash) external {
        _owner(agentId);
        if (!agents[agentId].active) revert InvalidAgent();
        _commit(agentId, memoryId, ciphertextHash);
    }

    function _commit(uint256 agentId, bytes32 memoryId, bytes32 ciphertextHash) private {
        if (memoryId == bytes32(0) || ciphertextHash == bytes32(0) || memories[memoryId].agentId != 0) revert InvalidMemory();
        memories[memoryId] = Memory(agentId, ciphertextHash, true);
        emit MemoryCommitted(memoryId, agentId, ciphertextHash);
    }

    function disableMemory(bytes32 memoryId) external {
        _owner(memories[memoryId].agentId);
        memories[memoryId].active = false;
        emit MemoryDisabled(memoryId);
    }

    function grant(bytes32 grantId, uint256 agentId, address app, bytes32 memoryId, uint64 expiresAt, uint32 uses) external {
        _owner(agentId);
        _grant(grantId, agentId, app, memoryId, expiresAt, uses);
    }

    function _grant(bytes32 grantId, uint256 agentId, address app, bytes32 memoryId, uint64 expiresAt, uint32 uses) private {
        Memory memory m = memories[memoryId];
        if (!agents[agentId].active) revert InvalidAgent();
        if (m.agentId != agentId || !m.active) revert InvalidMemory();
        if (grantId == bytes32(0) || grants[grantId].agentId != 0 || app == address(0) || uses == 0) revert InvalidGrant();
        if (expiresAt <= block.timestamp) revert Expired();
        grants[grantId] = Grant(agentId, app, memoryId, expiresAt, uses, false);
        emit GrantCreated(grantId, agentId, app, memoryId, expiresAt, uses);
    }

    function revoke(bytes32 grantId) external {
        _owner(grants[grantId].agentId);
        grants[grantId].revoked = true;
        emit GrantRevoked(grantId);
    }

    /// @notice Consumes access BEFORE the vault releases plaintext. Anyone can relay a signed request.
    function consume(Access calldata access, bytes calldata signature) external returns (bytes32 digest) {
        Grant storage g = grants[access.grantId];
        if (g.agentId == 0) revert InvalidGrant();
        if (!agents[g.agentId].active) revert InvalidAgent();
        if (g.revoked) revert Revoked();
        if (block.timestamp >= g.expiresAt || block.timestamp >= access.deadline) revert Expired();
        if (g.remaining == 0) revert Exhausted();
        Memory memory m = memories[g.memoryId];
        if (!m.active) revert InvalidMemory();
        if (access.requestId == bytes32(0) || receiptDigests[access.requestId] != bytes32(0)) revert DuplicateRequest();
        if (access.nonce != nonces[g.app]) revert InvalidNonce();
        digest = _hashTypedDataV4(keccak256(abi.encode(ACCESS_TYPEHASH, access.grantId, access.requestId, access.nonce, access.deadline)));
        if (ECDSA.recover(digest, signature) != g.app) revert InvalidSignature();
        ++nonces[g.app];
        --g.remaining;
        ++receiptCount;
        receiptDigests[access.requestId] = digest;
        receiptMemoryHashes[access.requestId] = m.ciphertextHash;
        receiptApps[access.requestId] = g.app;
        emit AccessRecorded(access.requestId, access.grantId, g.app, g.memoryId, m.ciphertextHash, digest, block.timestamp);
    }

    /// @notice An app attests its output; this does not prove semantic correctness.
    function recordResult(Result calldata result, bytes calldata signature) external {
        address app = receiptApps[result.requestId];
        if (app == address(0)) revert InvalidGrant();
        if (taskDigests[result.requestId] != bytes32(0)) revert DuplicateRequest();
        if (result.resultHash == bytes32(0) || result.validationHash == bytes32(0)) revert InvalidMemory();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RESULT_TYPEHASH, result.requestId, result.resultHash, result.validationHash)));
        if (ECDSA.recover(digest, signature) != app) revert InvalidSignature();
        taskDigests[result.requestId] = digest;
        taskResultHashes[result.requestId] = result.resultHash;
        emit ResultRecorded(result.requestId, app, result.resultHash, result.validationHash, digest);
    }

    function _owner(uint256 id) private view {
        if (agents[id].owner == address(0)) revert InvalidAgent();
        if (agents[id].owner != msg.sender) revert NotOwner();
    }
}
