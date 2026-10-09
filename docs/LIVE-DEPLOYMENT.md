# Monad 测试网部署与实测记录

部署日期：2026 年 10 月 9 日（北京时间）。

- 网络：Monad Testnet，chain ID 10143。
- 协议版本：AgentPassport v2。
- 合约地址：`0x7907858dA5b94B34C51b6F177abF23d4C9bb1763`。
- 部署区块：`69547336`。
- [部署交易](https://testnet.monadscan.com/tx/0x375fe2f83bc53ab09c4502a75e0d14c8e19e88079b3e506a71ded1f1a4d8b81a)。
- [DeepSeek 写作输出凭证交易](https://testnet.monadscan.com/tx/0x75e510ab9f769c1673120ec1a2477cb8e48598e1f591365855776897791b6f4f)，区块 `69547809`。
- [撤销前读取凭证](https://testnet.monadscan.com/tx/0x024a77957f4d5074151cbc6852e8971c2b5ee52711b18047d776adc60a655abb)。

## 实际完成的验证

1. RPC 返回 chain ID 10143，部署交易成功并确认，合约 `protocolVersion()` 为 2。
2. 演示 Agent 注册及三段示例记忆的加密承诺提交到真实测试网。
3. 未授权的私密记忆请求返回 HTTP 403 / `NO_GRANT`，未返回正文。
4. 为项目背景和写作偏好创建真实限时授权；写作应用独立查询 RPC、签署读取请求并核验链上读取凭证。
5. DeepSeek 生成真实文章，应用自检的四项规则通过。输出和自检结果被签名并提交到链上。
6. 独立核验全部通过：链 ID、签名、签名域、交易状态、链上承诺、输出内容、应用地址和交易事件。
7. 单独创建测试授权，读取后撤销。再次使用该授权返回 HTTP 403 / `REVOKED`；此前的读取凭证仍能独立验证。

部署公开元数据在 `deployments/monad-testnet.json`；完整可复核证据在 `deployments/monad-live-validation.json`。两者不包含钱包私钥、API Key 或本地登录 token。

## 当前运行方式

控制台：<http://127.0.0.1:4390>。页面应显示 **Monad Testnet · 10143**。

`.data/network.json` 保存已启用的测试网部署配置，启动时优先于 `.env` 中的默认 `CHAIN_MODE=local`。本地链记录保留在 `.data/state-local.json`；测试网状态使用 `.data/state-monad.json`，不会把本地链凭证冒充为测试网凭证。

演示 Agent #1 使用本机托管的专用测试钱包作为所有者及 gas 中继。用户已在 Edge 安装 MetaMask 并实际签名注册 Agent #2；注册交易 `0xfb687683f3574fbf29de7d8c65539c7a7e3c2bf753c945283fe545a5f0700527` 已独立核对 owner、signer、EIP-712 签名、交易状态和注册事件，证据在 `deployments/wallet-live-validation.json`。

第一次保存记忆、DeepSeek 生成和凭证核验发生在演示 Agent #1，证据保留在 `deployments/user-flow-validation.json`。用户随后在 Agent #2 保存自己的记忆并签署写作授权；授权交易 `0x3100919c5e4c9900fea96d905c401119a3bf8734709e44e69e35d6973a09cb7f` 的 Owner 签名、Agent ID、记忆及授权数组哈希已独立核对。

排查发现切换身份时旧轮询响应可能把演示记忆留在写作选择中。已阻止旧身份响应覆盖新页面，并在刷新与提交时清除不属于当前工作空间的记忆 ID。修复后，授权写作服务实际使用 Agent #2 的记忆调用 DeepSeek，读取及输出凭证全部通过独立验证；[初次输出交易](https://testnet.monadscan.com/tx/0xa7a3cfc7dc1eb4cd02613b750096e08d1cc757b9717bfd3fb3faa381b9462b75)。

用户随后亲自在更新后的公网完成写作、凭证核验和钱包签名撤销。完整钱包验收已通过：[用户写作输出](https://testnet.monadscan.com/tx/0x37c89a3b5e6e864185c6e80ce252b2342afecf14e79687c2b9481156c99e6198)；[用户撤销交易](https://testnet.monadscan.com/tx/0xd6e5bb4b14862680a8567f70912ff55ca6de02e37fc4e153f2f51d93513e0b00)。独立核对撤销的 Owner 签名、Agent ID、授权数组哈希和链上 revoked 状态。撤销后重试返回 HTTP 403 / `REVOKED`，此前读取与输出凭证仍全部验证通过。完整证据在 `deployments/wallet-live-validation.json`。

Agent ID 保留在页面 URL，钱包短期登录会话保留在当前标签页的 sessionStorage，到期需重新签名登录，且不会自动回到演示身份。浏览器测试涵盖晚到的旧身份请求、刷新、到期重新登录、授权和撤销。公网授权检查失败的请求会退还其 AI 额度预留，成功任务仍受每分钟两次上限约束。

任务输出凭证证明签名和内容承诺，不证明语义或事实正确。Vault 仍托管记忆解密密钥；端到端加密、完整 ERC-8004 兼容、第三方质量验证和正式提交均未完成。临时公网和无配音录屏草稿已完成，最终参赛视频尚待制作。合约源代码验证与安全审计也未宣称完成。
