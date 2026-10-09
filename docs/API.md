# Local API and SDK

All services bind localhost. JSON requests are capped at 96 KB. Browser origins are restricted to the dashboard / app origins. Owner writes additionally require a process-scoped `X-Admin-Token`, retrieved by the local console from `/api/session`; this is a local developer session, not production user authentication.

## Vault :4391

| Method / path | Purpose | Authorization |
|---|---|---|
| GET `/api/health` | Readiness | Local |
| GET `/api/config` | Public network and app configuration | Local |
| GET `/api/state` | Metadata, grant status, receipts, activity | Local |
| GET `/api/session` | Local owner session | Restricted browser origin |
| GET `/api/memories/:id` | Owner plaintext preview + ciphertext envelope | Owner session |
| POST `/api/grants` | Grant selected memories to enrolled application | Owner session |
| POST `/api/grants/revoke` | Revoke grants | Owner session |
| POST `/api/access` | Consume signed grant and release plaintext | App EIP-712 signature |
| POST `/api/ingest` | Save encrypted memory and chain commitment | Enrolled research app signature |
| POST `/api/results` | Anchor app output and validation hashes | App EIP-712 signature |
| POST `/api/verify` | Verify a stored receipt | Local |
| POST `/rpc` | Read-only local RPC facade | Local, read methods only |

Grant body:

```json
{ "appId": "writer", "memoryIds": ["0x...32-bytes..."], "durationMinutes": 10, "uses": 5 }
```

`POST /api/grants/revoke`: `{ "grantIds": ["0x..."] }`. Each memory gets an independent grant, count and expiration.

`POST /api/access`: `{ "access": { "grantId": "0x...", "requestId": "0x...", "nonce": "0", "deadline": 1234567890 }, "signature": "0x...65-bytes..." }`.

Denied access never returns a `memory` field. Typical codes: `NO_GRANT`, `REVOKED`, `EXPIRED`, `EXHAUSTED`, `WRONG_APPLICATION`, `INVALID_SIGNATURE`, `REPLAY`, `INVALID_MEMORY`. Replay is HTTP 409; permission denial is HTTP 403.

## Research / Writing applications :4392 / :4393

- GET `/api/health`, `/api/config`, `/api/state`, `/api/session`.
- Research POST `/api/save`: `{ "kind": "background|preferences|private", "title": "...", "content": "..." }` with local app session header. App signs and ingests via shared SDK.
- Writer POST `/api/run`: `{ "prompt": "...", "memoryIds": ["0x..."], "grantIds": ["0x..."] }` with app session. `grantIds` optional, useful to demonstrate a particular revoked grant rather than falling back to a new active grant.
- Writer POST `/api/probe`: `{ "memoryId": "0x..." }` with app session. Tests actual authorization, never echoes private plaintext.
- Writer GET `/api/tasks`: previously generated outputs. These may contain authorized context, so treat local output history as sensitive derived data.
- POST `/api/verify`: independently verifies a receipt using the app's provider.

No model call occurs for a denied input. Partial reads are possible if a grant expires or is revoked while the app is reading several memories; previously accepted reads are not rolled back. A model failure also does not restore consumed reads.

## SDK

`AgentPassportClient.identity(agentId)`, `.saveMemory(input)`, `.readMemory(grantId)`, `.recordResult(requestId, output, validation)`.

`verifyReceipt(receipt, provider)` returns `valid`, `checks`, `signer`, `digest`, `blockNumber`. It checks the receipt's claimed chain and contract. The caller must select a trusted RPC and ensure the claimed contract is the intended deployment; third-party verification is not a contract reputation endorsement.

The Vault has one registered Agent and two enrolled apps in this MVP. It is deliberately not a general public, permissionless relay or multi-user service.
