# AgentPassport

**用户可控的跨应用 AI 记忆与授权。**

Agent Identity · Scoped Access · Portable Memory · Verifiable Receipts

为 [Monad Metropolis](https://hackathon.monad.xyz/) 赛道四 **Trust, Identity & AI Infrastructure** 开发的可运行 MVP。

源码仓库：[TianZaiShuiZhong/AgentPassport](https://github.com/TianZaiShuiZhong/AgentPassport)。评审体验从 [JUDGES.md](JUDGES.md) 开始；[英文项目介绍](docs/SUBMISSION.md)、[提交清单](docs/SUBMISSION-CHECKLIST-ZH.md) 和 [中文演示讲稿](docs/DEMO-SCRIPT-ZH.md) 已准备。

研究助手保存记忆 → 用户指定应用、记忆、次数和有效期 → 写作助手独立查询链上身份与授权 → 签名读取 → Vault 等待链上确认后释放明文 → 写作结果生成可核验凭证。私密记忆默认不授权，撤销后后续读取失败。

## 当前部署状态

本机已切换到 **Monad Testnet（10143）**，完成真实合约部署、DeepSeek 写作、凭证核验和撤销验证。[部署地址与实测证据](docs/LIVE-DEPLOYMENT.md)。全新安装仍默认从本地 EVM 启动。

## 临时公网演示

已通过 trycloudflare 提供受访问码保护的临时入口。[公网地址、启动方法与钱包安装指南](docs/PUBLIC-DEMO.md)。本机主服务和 tunnel 必须持续运行。访问码不写入仓库。

## 快速运行

需要 Node.js 22 或 24、npm。首次启动自动建立本地 EVM、部署真实 Solidity 合约、注册 Atlas、创建三段**演示**记忆。

```powershell
npm install
npm run build
npm run dev
```

- 控制台：<http://127.0.0.1:4390>
- 研究助手独立应用：<http://127.0.0.1:4392>
- 写作助手独立应用：<http://127.0.0.1:4393>
- Vault API：<http://127.0.0.1:4391>

`npm run build` 生成供独立应用使用的前端；控制台在开发模式使用 Vite。修改前端后重新 build，独立窗口会使用新的静态页面。运行构建后的完整版本：`npm start`。

默认 **Local EVM，chain ID 1337**。所有交易、Solidity 权限检查、EIP-712 签名和凭证核验实际执行；不是 Monad 测试网部署。界面始终标注实际网络。无需钱包、真实资金或模型 API Key。

Node.js 24 下 Ganache 可能提示 µWS 原生模块不可用，自动使用 Node 实现；不影响演示合约功能。

## 三分钟体验

1. 在“记忆保险箱”查看项目背景、写作偏好和私密笔记。所有者视图展示解密正文及实际存储的密文封装。
2. 在“授权管理”创建 Writing Studio 授权，选择背景和偏好，不选择私密笔记。有效期 10 分钟，每段允许 5 次读取。
3. 打开写作助手独立窗口，点击“测试私密记忆访问”：收到 `NO_GRANT`，没有返回正文。
4. 点击“读取记忆并生成”：SDK 核验身份与权限、签名读取，生成文章和链上输出承诺。
5. 点击“查看凭证 → 从链上核验”，查看签名、交易、事件、链上哈希等检查结果，可导出 JSON。
6. 回到控制台撤销授权，在独立写作应用再次运行：请求被拒绝，之前的文章仍保留，历史凭证仍可核验。
7. 在研究助手保存自己的新背景，控制台会出现新记忆；授权后可以跨应用使用。

没有 `LLM_API_KEY` 时生成**确定性模板文章**，界面明确标注“模板演示 · 未调用语言模型”。这仍验证了真实的身份、授权、加密、跨进程 SDK 和链上凭证流程。模板模式不应称为 AI 推理演示。

## 接入真实模型（可选）

复制 `.env.example` 为 `.env`，配置 OpenAI-compatible Chat Completions 服务：

```dotenv
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.moonshot.ai/v1
LLM_MODEL=kimi-k2.5
```

模型名称和账号地域以你的服务商控制台为准。[Kimi 官方文档](https://platform.kimi.ai/docs/overview)。也可填入兼容接口的其他模型服务。Key 仅由写作服务加载，浏览器不会收到 Key。请求超时 60 秒，调用失败会明确报错，不悄悄切换模板。**被授权的正文会发送给配置的模型服务商。**

模型返回后，应用自检长度、必要段落、输入范围及输入关联。输出与验证结果哈希一起上链。规则通过不能证明语义、事实或推理正确；这是应用自检，尚无独立第三方验证者。

## Monad 测试网部署

**v0.2 推荐使用页面向导：** 点击右上角“网络与部署”，复制本机测试钱包地址领取测试 MON，再部署并启用测试网。钱包登录、用户签名授权、向导步骤及升级边界见 [第二阶段说明](docs/PHASE2.md)。以下为保留的手动部署方式。

官方网络说明：[Monad Testnet](https://docs.monad.xyz/developer-essentials/testnet)。本地检查过公开 RPC 的 `eth_chainId` 返回 `0x279f`（10143）。网络可用性不等于已完成部署。

1. 用专用测试网钱包，在 [Monad Faucet](https://faucet.monad.xyz/) 获取测试代币。
2. 配置 `.env`：

   ```dotenv
   MONAD_RPC_URL=https://testnet-rpc.monad.xyz
   MONAD_CHAIN_ID=10143
   MONAD_PRIVATE_KEY=0x_your_dedicated_testnet_private_key
   ```

3. 运行 `npm run deploy:monad`。脚本检查链 ID，只允许 10143，确认交易后写入 `deployments/monad-testnet.json`。
4. 填写部署地址并开启测试网模式：

   ```dotenv
   CHAIN_MODE=monad
   MONAD_CONTRACT_ADDRESS=0x_deployed_address
   MONAD_EXPLORER=https://testnet.monadscan.com
   ```

5. 重启 `npm run dev`。Vault 使用专用钱包注册 Atlas、提交密文承诺及授权/读取/结果交易。应用通过测试网 RPC 独立核验。

更换部署地址时指定一个新的 `DATA_DIR`，避免把旧合约的状态混入新部署。默认本地数据与测试网数据分别保存在 `state-local.json` / `state-monad.json`。项目没有收集或包含你的钱包私钥，也没有代你领取测试代币或发布公网服务。

## 项目结构

```text
contracts/AgentPassport.sol     身份、记忆承诺、授权、读取与输出凭证
sdk/index.mjs                  应用签名与独立链上核验 SDK
sdk/index.d.mts                TypeScript ESM 接口声明
server/runtime.mjs             持久本地链 / Monad 模式、初始化与交易队列
server/vault.mjs               加密 Vault、所有者 API、签名访问 API
server/crypto.mjs              AES-256-GCM，关联数据绑定记忆上下文
server/agent-app.mjs            两个独立应用，SDK 接入与可选 LLM
server/ui.mjs                  构建版控制台与 API 代理
src/                           React + TypeScript 控制台
scripts/                       启动、编译、测试网部署、离线凭证验证
tests/                         权限/加密/SDK/应用测试与浏览器流程
docs/                          架构、API、信任边界、英文参赛介绍与演示脚本
```

启动器运行三个独立后端进程和一个 UI。研究与写作服务各持自己的签名密钥，从 RPC 读取授权，不加载 Vault 解密密钥。它们当前在同一 OS 账号运行，这是开发环境中的逻辑服务边界，并非操作系统安全隔离。

## SDK 示例

```js
import { AgentPassportClient } from './sdk/index.mjs';

const passport = new AgentPassportClient({
  vaultUrl: 'http://127.0.0.1:4391',
  rpcUrl: 'http://127.0.0.1:4391/rpc', // 本地只读 RPC；测试网用公共 RPC
  contractAddress: '0x_your_deployment',
  chainId: 1337,
  privateKey: process.env.APP_PRIVATE_KEY,
});

const { memory, receipt, proof } = await passport.readMemory(grantId);
console.log(memory.content, proof.valid);
```

SDK 是仓库内模块，尚未发布 npm 包。新应用必须由所有者把其签名地址绑定到一份 Grant。SDK 验证返回的凭证是否匹配原始签名请求，再独立核验链上交易、事件和承诺。

导出后的凭证不依赖控制台核验：

```powershell
npm run verify:receipt -- receipt.json http://127.0.0.1:4391/rpc
# 测试网凭证可换成你信任的 Monad 测试网 RPC
```

## 验证

```powershell
npm run compile
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

本次浏览器验证使用系统已安装的 Chrome。Windows 上可跳过浏览器下载，运行：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

测试使用临时链和临时数据目录，覆盖未授权访问、错误应用签名、撤销、过期、读取次数耗尽、重放、跨链/跨合约签名、密文篡改、历史凭证、输出篡改、SDK 跨应用流程和浏览器操作。E2E 使用独立端口及 `.data/e2e-*`，不改变正常演示的 `.data` 状态。自动化测试禁用真实模型 Key，通过本地模拟服务检查模型接口，不消耗你的 API 额度。

## 真实边界

- **加密存储，尚非端到端加密。** Vault 托管主密钥，能在所有者与授权访问时解密；Vault 是需要信任的服务。SDK 能核验链上授权与承诺，但不能证明托管服务提供的明文确实对应密文。
- **撤销阻止未来访问。** 以 `consume` 交易确认作为访问被接受的时点；后续撤销不能撤回已经被接受或已返回的内容。
- **正文不上链，元数据仍可见。** 地址、访问时间、密文哈希和记忆间的关系公开；演示 API 公开记忆标题和活动摘要。私密标题不应包含秘密。
- **结果签名不等于正确性证明。** 本版无 zkML、TEE、独立验证者、抗刷分声誉或“信任分”。
- **自定义 MVP 身份表。** 未完整实现 [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)。当前 Agent 身份由 Vault 所有者注册；应用密钥用于请求签名。Agent signer 保留用于后续 Agent 自主签名，v0.2 钱包工作空间已实现 EOA 钱包签名登录、注册及授权，Agent owner/signer 归用户钱包。尚未实现 ERC-1271、WebAuthn 或独立 Agent 密钥轮换。
- **本地开发授权模型。** 控制台以本机会话控制测试钱包，应用会话防止跨站发起操作。所有服务绑定 `127.0.0.1`，不能直接作为多人公网产品上线；v0.2 已加入钱包签名认证及 Agent 数据过滤；生产化仍需要严格应用用户认证、多租户隔离、独立密钥服务、速率限制和 TLS。
- **读操作按次上链。** 此版优先展示完整可核验闭环，未进行吞吐量测试。生产可研究短期凭证或批量承诺，同时明确定义撤销和竞态语义。

后续优先顺序：真实 Monad 部署与演示录像 → 独立应用部署与真实钱包扩展验证 → ERC-8004 身份适配 → 用户持钥/细粒度密钥管理 → 第三方任务验证。当前不把这些后续事项当作已完成能力。
