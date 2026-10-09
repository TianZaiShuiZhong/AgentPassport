# AgentPassport 提交准备清单

更新：2026 年 10 月 9 日，北京时间。

## 已完成

- [x] 赛道四：Trust, Identity & AI Infrastructure。
- [x] Monad 测试网真实部署、DeepSeek 真实生成。
- [x] Edge / MetaMask 用户钱包注册、授权与撤销完整验收。
- [x] 撤销后拒绝新读取；历史凭证独立核验有效。
- [x] 临时公网、评审体验说明、英文项目介绍和中文讲稿。
- [x] 源码发布到 [TianZaiShuiZhong/AgentPassport](https://github.com/TianZaiShuiZhong/AgentPassport)，`main` 分支。
- [x] 现有自动化验证：38 个 Node 测试、6 个浏览器流程；授权检查失败不计 AI 额度的专项测试通过。

## 接下来按顺序处理

| 步骤 | 当前材料 | 待完成事项 |
|---|---|---|
| 1. 发布源码 | `README.md`、`JUDGES.md`、MIT License、源码发布包 | 已发布到 https://github.com/TianZaiShuiZhong/AgentPassport |
| 2. 完成视频 | `docs/demo-video/public-live-demo.webm`、`docs/DEMO-SCRIPT-ZH.md` | 当前视频是无配音草稿；按提交页时长/格式要求配音或重新录制，上传并取得可观看 URL |
| 3. 完善项目页面 | `docs/SUBMISSION.md`、`docs/PROJECT-PITCH-ZH.md` | 补团队名称、成员、联系方式、GitHub 和视频链接 |
| 4. 保持演示可访问 | `docs/PUBLIC-DEMO.md` | 保持本机服务与 tunnel 运行；把访问码填入评审访问说明；提交前核对当前链接 |
| 5. 正式提交 | https://hackathon.monad.xyz/ | 用自己的比赛账户登录，逐项核对必填项、规则和 sponsor 条件，确认后提交并保存回执 |

## 可直接填写的项目字段

- 项目名：AgentPassport。
- 一句话英文：User-controlled memory that travels between AI applications, with scoped on-chain authorization and verifiable receipts on Monad.
- 一句话中文：让 AI 记忆在用户授权下跨应用使用，每次读取和输出都有可核验凭证。
- 赛道：Trust, Identity & AI Infrastructure。
- 网络：Monad Testnet，10143。
- 合约：`0x7907858dA5b94B34C51b6F177abF23d4C9bb1763`。
- 当前项目 URL：https://shanghai-singles-diameter-vaccine.trycloudflare.com。
- 代码仓库 URL：https://github.com/TianZaiShuiZhong/AgentPassport。
- 最终视频 URL：待制作与上传。
- 团队与联系方式：待填写。

## 官方规则核验情况

[官网公共入口](https://hackathon.monad.xyz/)显示活动区间为 9 月 1 日至 10 月 13 日，提交页面需登录。尚未核验登录后完整字段、精确截止时区、视频时长及 sponsor 资格。三分钟是本项目的视频建议，不冒充官方强制要求；也不把其他 Monad 比赛的规则套用到本项目。

## 发布包说明

运行 `python scripts/package-release.py` 生成 `release/AgentPassport-source.zip` 与哈希清单。发布包只收录白名单源码与公开材料，不包含 `.env`、`.data`、`node_modules`、工具二进制、浏览器测试追踪或原始视频。脚本还会针对本机已配置的 API Key、钱包密钥和网关访问凭据检查入包文件；该检查不等于安全审计。

源码已上传 GitHub；尚未上传最终视频，也未向比赛平台提交。现有无配音录屏草稿仅保存在项目所有者本机，不在源码仓库中。比赛登录和团队信息由本人提供；不把密码、私钥或助记词放进项目提交材料。
