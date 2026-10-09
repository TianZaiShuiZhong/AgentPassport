# 临时公网演示

当前链接：<https://shanghai-singles-diameter-vaccine.trycloudflare.com>。

访问码由项目所有者单独分享，保存在本机 `.data/public-access.json`，不写入公开文档或仓库。模型 Key、钱包私钥、本地管理 token 和 gateway secret 不发送给访客。

## 运行与停止

先运行 `npm start` 启动四个本地服务，再在另一终端运行 `npm run public`。后者启动受保护的 localhost 网关（4394）和 Cloudflare Quick Tunnel。公网只连到网关，Vault 和两个应用继续绑定 localhost。

cloudflared 来自 Cloudflare 官方 GitHub release，当前版本 2026.10.0，下载文件已与发布的 SHA-256 digest 校验。二进制在 `.tools/cloudflared.exe`，不纳入源码。

停止 tunnel 或关闭电脑会使临时链接失效；重新启动通常产生新域名。Quick Tunnel 的生命周期与限制见 [Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。它用于临时演示，尚不是持续托管。

## 访客流程

1. 打开公网链接，输入演示访问码。
2. 进入控制台，查看 Monad Testnet（10143）状态、加密记忆和真实链上履历。
3. 给 Writing Studio 创建限时授权，选择背景和写作偏好。
4. 测试未授权私密记忆访问、调用 DeepSeek 写作，并核验输出凭证。
5. 撤销授权，重试被拒绝；历史输出和凭证保留。

研究助手独立窗口：`/apps/research`；写作助手独立窗口：`/apps/writer`。它们共用公网域名和访问会话，仍由不同后端进程与签名密钥执行。不请求访客自己的 localhost。

## 安装自己的钱包

用 Chrome / Edge 打开 [MetaMask 官方下载页](https://metamask.io/download)，选择浏览器扩展并按提示添加。首次使用，在扩展中创建钱包并自己保管备份。参照 [MetaMask 官方安装说明](https://support.metamask.io/start/getting-started-with-metamask/)。

然后在同一个浏览器打开本项目链接，输入访问码，点击“连接钱包 → 连接并签名登录 → 签名注册我的 Agent”。页面会请求切换或添加 Monad Testnet。所有者授权是独立的 EIP-712 签名；登录签名不等于记忆授权。

用户钱包的 Agent 是新的工作空间，不会自动继承演示账户的记忆。注册时确认是否允许研究应用写入，然后保存自己的背景与偏好，再按范围授权写作应用。中继支付测试网 gas，无需给新用户钱包充值。

用户已通过 Edge 的 MetaMask 完成 Agent #2 的真实钱包验收：注册、记忆保存、签名授权、DeepSeek 写作、凭证核验和签名撤销。独立核对三类 Owner 签名，撤销后重试返回 `REVOKED`，历史凭证仍有效。演示 Agent #1 的操作不计为用户 Agent #2 的操作。

控制台顶栏明确显示“我的 Agent #编号”或“演示 Agent #编号”。当前身份选择保存在 URL；30 分钟钱包登录会话保存在当前标签页的 sessionStorage，刷新时恢复，到期需重新签名登录，不会自动切回演示账户。独立窗口可能需要另行钱包登录；只有显式点击“返回演示工作空间”才主动切换身份。

## 公网边界

- 访问码建立 4 小时的 HttpOnly / SameSite=Strict 会话；HTTPS 下 Cookie 为 Secure。
- 公网部署、切换网络、原始中继/RPC 写接口和私有文件请求被拒绝。
- 内部管理员 token 只由网关读取并在受限代理请求中使用，不返回浏览器；访客看到的 `public-session` 是无特权占位值。
- 动态公网 Origin 必须由带有私有 gateway secret 的内部请求提交。任意浏览器 Origin、伪造 secret、跨 Agent 数据请求被拒绝。
- 非演示 Agent 的元数据、任务和操作需对应钱包登录；明文预览在 Vault 再次检查实际 Owner。
- 公网写作上限 20 次 / UTC 日，写操作代理上限 80 次 / UTC 日；单会话每分钟最多 2 次写作，最多 2 个并发变更。模型推理前被授权检查或参数检查拒绝的任务不占用 AI 日额度和每分钟次数；一般写请求和实际模型失败仍可能消耗对应额度。计数持久化在 `.data/public-usage.json`。

持有访问码的受邀访客可以操作**托管演示账户**，包括修改示例记忆、签发授权及消耗受限的测试币/模型额度。因此只向计划参与演示的人分享访问码。

这仍是临时受邀演示入口，没有声称达到多人生产环境的隔离、密钥管理、安全审计或可用性标准。公开 SDK 的服务端集成还需定义长期 API 认证；此访问码网关主要供浏览器演示使用。

## 实测记录

`deployments/public-access-validation.json` 保存公网 URL 和不含凭据的验证结论。已验证匿名 API 拒绝、访问码登录、真实公网控制台、独立写作窗口、真实链上凭证核验、无 localhost 浏览器请求和无页面运行错误。

公网完整写流程也已实测：授权提交到 Monad、未授权私密读取被拒绝、DeepSeek 实际生成、输出承诺上链、从浏览器独立核验、撤销后拒绝重试。

项目所有者本机的录屏草稿在 `docs/demo-video/public-live-demo.webm`，没有配音或字幕，尚不是最终参赛视频；该本地草稿不纳入源码仓库。重新录制需安装 Playwright FFmpeg（`npx playwright install ffmpeg`）并运行 `node scripts/record-demo.mjs`；脚本会实际创建/撤销演示授权并使用一次模型调用。
