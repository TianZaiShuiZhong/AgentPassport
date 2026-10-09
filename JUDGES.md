# Try AgentPassport

Track: Trust, Identity & AI Infrastructure.

AgentPassport lets a user carry selected AI context between applications, with a wallet-owned identity, scoped grants and independently verifiable receipts on Monad.

## Live demo

Open https://shanghai-singles-diameter-vaccine.trycloudflare.com in a browser. The project owner supplies the demo access code separately in the submission's access instructions. This temporary URL requires the author's machine and services to remain online; the current URL is also recorded in `docs/PUBLIC-DEMO.md`.

The default workspace is **Demo Agent #1**, controlled by a clearly labelled managed test wallet. You can try the core protocol without installing a wallet. Your own wallet is optional; MetaMask in Edge was used for the complete live acceptance of **Agent #2**.

## Suggested walkthrough

1. Open **记忆保险箱** (Memory Vault). Background, preferences and a private note are separate encrypted memories. Plaintext is stored off-chain; ciphertext commitments are on Monad.
2. Open **授权管理** (Permissions), click **创建授权** (Create Grant), choose Writing Studio and select background/preferences only. Choose one hour and five reads. The demo relayer pays testnet gas.
3. Open **Writing Studio**. **测试私密记忆访问** probes an ungranted private note: access is denied, without returning plaintext.
4. Select only the granted memories and click **读取记忆并生成**. The app independently checks the chain and signs its requests. The configured DeepSeek model generates with the authorized context; its output and application rule checks are anchored.
5. Open **可信履历** (Verifiable History), click **核验**, then **从链上核验**. Verify both the read and output receipts. JSON export is available.
6. Return to Permissions and revoke the grants. Try the same memory again: new reads are denied. The previous receipts still verify.

The protected demo allows two writing runs per minute and twenty AI requests per UTC day. Permission/parameter failures before inference release their AI reservation. These are demo limits, not production capacity claims.

## Verify the real deployment

- Monad Testnet, chain ID **10143**.
- Contract: `0x7907858dA5b94B34C51b6F177abF23d4C9bb1763`.
- [Deployment transaction](https://testnet.monadscan.com/tx/0x375fe2f83bc53ab09c4502a75e0d14c8e19e88079b3e506a71ded1f1a4d8b81a).
- [Wallet-owned Agent #2 registration](https://testnet.monadscan.com/tx/0xfb687683f3574fbf29de7d8c65539c7a7e3c2bf753c945283fe545a5f0700527).
- [User-authorized output](https://testnet.monadscan.com/tx/0x37c89a3b5e6e864185c6e80ce252b2342afecf14e79687c2b9481156c99e6198).
- [Owner-signed revocation](https://testnet.monadscan.com/tx/0xd6e5bb4b14862680a8567f70912ff55ca6de02e37fc4e153f2f51d93513e0b00).

The public validation JSON in `deployments/` records signatures/commitment checks without private keys or session tokens. `deployments/wallet-live-validation.json` includes a revoked-access retry and verification of historical receipts after revocation.

## Reproduce locally

Use Node.js 22 or 24:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4390. A fresh installation runs a persistent local EVM, labelled chain 1337. With no model key, generated text is explicitly labelled as a deterministic template. Configure your own compatible model key in `.env` to use actual inference; no author credentials are distributed.

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Read `docs/ARCHITECTURE.md` and `sdk/index.mjs` for the protocol. The Vault currently holds decryption keys; this is not end-to-end encryption. The identity table is a custom MVP, not complete ERC-8004 compliance. App-signed outputs prove attribution and integrity, not semantic correctness. Revocation prevents subsequent access and cannot erase information already disclosed.
