# AgentPassport — submission draft

**Track:** Trust, Identity & AI Infrastructure.

**One-liner:** User-controlled memory that travels between AI applications, with scoped on-chain authorization and verifiable receipts on Monad.

## Problem

Users repeatedly explain their project context and preferences to each new AI application. Sharing a complete history exposes private information. Applications lack a shared way to verify Agent identity and a user's authorization to read a particular memory.

## Product

AgentPassport separates identity, permission and memory storage. Users grant an application access to a specific encrypted memory for a limited time and number of reads. Applications independently verify chain state, sign each request, and receive memory only after the authorization transaction is confirmed. Each accepted read leaves a verifiable receipt. Generated outputs and application rule-check results can also be signed and anchored.

Two independently running example apps demonstrate reuse: Research Studio captures structured context, while Writing Studio continues a user's task with only the memories the user authorized. A private-memory probe and live revocation show the access boundary.

## Why Monad

Monad is the intended shared registry for identities, scoped grants and receipt commitments, independently readable by each application. Applications do not need to trust another app's private authorization database. Memory plaintext and model inference remain off-chain. This MVP uses EVM-compatible Solidity; claims about throughput, scale or production economics require measurement and are not made here.

## Technical implementation

Solidity + OpenZeppelin EIP-712/ECDSA; replay-resistant application signatures; AES-256-GCM with memory-bound associated data; shared JavaScript/TypeScript SDK; separate research and writing processes; React/TypeScript console; optional Chat Completions model integration; contract/API/SDK tests and Playwright user-flow checks.

The identity table is a custom MVP, with ERC-8004 adaptation planned. The Vault is a trusted key custodian, not end-to-end encrypted. Output signatures prove attribution and integrity, not semantic correctness. Revocation blocks future reads and cannot erase already disclosed information.

## Submission status

- Implemented locally: identity registration, encrypted memory commitments, scoped grants, expiry/count/revocation, independent app signing, receipt verification/export, app output anchoring, optional LLM adapter.
- Fresh installation default: local persistent EVM, chain 1337. The current development instance is running on Monad testnet, chain 10143.
- Monad testnet deployment: **confirmed** at `0x7907858dA5b94B34C51b6F177abF23d4C9bb1763`, block `69547336`. [Deployment transaction](https://testnet.monadscan.com/tx/0x375fe2f83bc53ab09c4502a75e0d14c8e19e88079b3e506a71ded1f1a4d8b81a).
- Live model generation: verified locally with DeepSeek using public sample context. Runs without a key continue to show a labelled deterministic template.
- Live protocol and model flow: verified on Monad testnet with DeepSeek. Private input denied; authorized reads and output anchored; independent receipt verification passed; revoked grant denied while its historical read remained verifiable. Full evidence is in `deployments/monad-live-validation.json`.
- v0.2 wallet flow: **live acceptance complete**. The user used MetaMask in Edge to register Agent #2, save memory, sign a scoped grant, generate with DeepSeek, verify receipts and sign revocation. Registration, grant and revocation owner signatures independently verified on Monad. After revocation, retry returned HTTP 403 / REVOKED while both historical read and output proofs remained valid. Evidence: `deployments/wallet-live-validation.json`. Browser tests also cover late responses from the prior workspace, reload persistence and expired-session login. Earlier demo-account evidence remains separately identified in `deployments/user-flow-validation.json`.
- Temporary public demo: available through a protected trycloudflare URL. See `docs/PUBLIC-DEMO.md`; the project owner shares the access code separately.
- Public interaction verification: complete real grant, DeepSeek generation, chain proof and revocation flow passed through the public URL. The owner has a local unvoiced screen-recording draft at `docs/demo-video/public-live-demo.webm`, excluded from the source repository. Narration/editing, video hosting and the final submission video remain pending.
- Source repository: **published** at [TianZaiShuiZhong/AgentPassport](https://github.com/TianZaiShuiZhong/AgentPassport), branch `main`. Competition submission is **not yet completed**. A Chinese demonstration script is ready in `docs/DEMO-SCRIPT-ZH.md`.

## Suggested three-minute demo

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Agent passport and vault | “Your AI context should move with you, under your control.” |
| 0:20–0:45 | Background, preferences, private note | “We encrypt the content off-chain and commit its hash on-chain.” |
| 0:45–1:10 | Issue a writer grant | “This app gets only these memories, for ten minutes and five reads.” |
| 1:10–1:30 | Independent writer window, private access probe | “An ungranted memory is denied by the protocol.” |
| 1:30–2:05 | Run writing task | “The SDK independently checks chain authorization and signs the read.” |
| 2:05–2:30 | Verify and export receipt | “A third party can verify the signature, transaction, event and commitment.” |
| 2:30–2:50 | Revoke, retry | “New access fails. Previous disclosures and historical receipts remain.” |
| 2:50–3:00 | SDK page | “Other apps can integrate the same identity and permission checks.” |

Use actual model generation for an AI demo after configuring a provider. If recording the default local version, explicitly disclose the local network and template mode. Before submission, check the authenticated event portal's complete rules, deadline timezone, required video durations and sponsor bounty criteria.
