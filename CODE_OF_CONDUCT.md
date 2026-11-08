# 贡献者公约（Code of Conduct）

**项目：NetSight Pro** · 版本 **1.0** · 生效日期：2026-11-08
**维护者：NetSight Pro maintainers** · 联系：<asiacomk@gmail.com>

> 本文改编自 [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)，并针对 NetSight Pro 的技术场景（网络诊断、边缘计算、安全研究、多语言界面）做了补充。
> 本文以 **CC BY 4.0** 许可发布，可自由引用与改编，但请保留出处与致谢。

---

## 一句话原则

**对技术保持严谨，对人保持善意；不伤害他人，也不滥用这个工具。**

网络诊断天然涉及「看见别人的网络」。这让我们比普通开源项目更需要边界感：尊重授权、尊重隐私、尊重不同网络环境下的人。技术分歧可以很激烈，但对人的攻击不可以。

---

## 目录

- [我们的承诺](#我们的承诺)
- [适用范围](#适用范围)
- [我们鼓励的行为](#我们鼓励的行为)
- [不可接受的行为](#不可接受的行为)
- [项目特定准则](#项目特定准则)
- [安全研究与漏洞披露](#安全研究与漏洞披露)
- [隐私与数据准则](#隐私与数据准则)
- [举报方式](#举报方式)
- [执行流程](#执行流程)
- [执行指南（四级）](#执行指南四级)
- [报复与申诉](#报复与申诉)
- [维护者职责](#维护者职责)
- [语言、翻译与国际化](#语言翻译与国际化)
- [AI 辅助贡献政策](#ai-辅助贡献政策)
- [贡献流程与技术要求](#贡献流程与技术要求)
- [生效、修订与致谢](#生效修订与致谢)
- [English Version](#english-version)

---

## 我们的承诺

作为 NetSight Pro 的维护者与贡献者，我们承诺：无论年龄、体型、可见或不可见的残障、族裔、性别认同与表达、经验水平、教育背景、社会经济地位、国籍、个人外貌、种族、宗教、性取向或技术栈偏好，参与本项目的每个人都应当拥有**无骚扰**的体验。

我们承诺以开放、欢迎、包容的方式行事，并建设一个健康、可持续的社区：

- 对初学者保持耐心，对专家保持诚实；
- 欢迎不同网络环境（家庭宽带、校园网、企业网络、移动网络、IPv6-only、受限地区）的真实反馈；
- 尊重不同语言、时区、工作节奏与沟通风格；
- 对事不对人，用证据、复现步骤和代码说话；
- 在涉及安全、隐私和他人网络时，主动选择更保守的做法。

---

## 适用范围

本公约适用于**所有项目空间**，包括但不限于：

- GitHub 仓库：Issues、Pull Requests、Reviews、Discussions、Releases、Wiki、Security Advisories；
- 项目相关聊天、邮件、视频会议、语音频道、线下活动；
- 在公开场合（社交媒体、会议、博客、直播）**代表本项目**时的言行；
- 项目维护者与贡献者之间、贡献者与贡献者之间、以及维护者与用户之间的互动；
- 项目提供的诊断端点、演示页、监控能力被用于「与项目相关的协作场景」时。

本公约同样约束**维护者**。如果你认为维护者的行为不符合本公约，可以按 [举报方式](#举报方式) 中的替代渠道反馈，相关维护者应回避处理。

本公约不适用于完全私人的、与项目无关的交流，但如果你在项目空间中受到骚扰，仍可举报。

---

## 我们鼓励的行为

### 技术讨论

- **用证据对话**：报告问题时提供版本、浏览器/系统、复现步骤、期望与实际结果；能提供 HAR、截图、日志（已脱敏）更好。
- **区分「事实」与「判断」**：例如「在我这里 RTT 中位数 180ms」是事实；「这个实现很烂」是判断，请给出原因与替代方案。
- **承认不确定性**：网络问题经常是环境相关的，「我无法复现」不代表对方在说谎。
- **对安全保持敬畏**：涉及令牌、密钥、IP、DNS 配置时，默认按「可能泄露」的标准处理。
- **接受评审**：代码被指出问题时，讨论行为与结果，而不是动机与能力。
- **给可执行的反馈**：指出问题的同时，尽量给出方向、示例链接或最小复现。

### 社区协作

- 在提问前先搜索 Issues / Discussions / README；重复问题可以礼貌地指路，但不要嘲讽。
- 主动标注「我可能理解错了」「这是我的猜测」，降低沟通成本。
- 帮助新人理解项目原则（浏览器侧优先、零出站、预算与上限），而不是直接甩结论。
- 为别人的贡献点赞、补充测试、复查翻译；指出问题时同时认可做得好的部分。
- 尊重维护者的时间：一个清晰的问题比十个催促更有用。

### 具体示例

- ✅ 「我在 iOS 17 的 Safari 上点『智能诊断』，第 3 步卡住不动，控制台报 `AbortError`；附上截图与版本。」
- ✅ 「建议把 `dns-compare` 的解析器超时从 5s 调到 3s：海外到 Cloudflare 的 P95 会更快；我可以提 PR。」
- ✅ 「这个 PR 的行为我理解，但会把 `/health` 的请求量放大 3 倍，能不能先加一个采样开关？」
- ✅ 「繁体中文的这段措辞更像香港用语，台湾用户可能更习惯另一种表达，我们一起确认？」
- ✅ 「我无法复现你的问题，但我相信它存在；能否再提供一下浏览器时区与是否使用代理？」

---

## 不可接受的行为

以下行为在任何项目空间都不可接受，无论出于何种动机：

### 人际层面

- 侮辱、贬损、人身攻击、嘲讽、阴阳怪气、恐吓、威胁；
- 基于身份（性别、性取向、种族、宗教、国籍、残障、年龄、外貌、经验水平等）的歧视性言论；
- 不受欢迎的性暗示、性关注或性骚扰；
- 跟踪、骚扰、反复私信、在对方明确拒绝后继续接触；
- 人肉搜索（doxxing）、公开他人真实姓名、住址、工作单位、账号、IP、聊天记录；
- 冒充他人、伪造身份、使用马甲/小号操纵讨论；
- 恶意举报、滥用举报机制打击异见；
- 对举报者、证人或处理者进行报复或威胁报复；
- 鼓励或纵容上述行为。

### 技术层面

- 提交明知不安全、有后门、有数据外传或违反许可证的代码；
- 故意在公共 Issue/PR 中粘贴真实令牌、密钥、Cookie、他人 IP、未脱敏的个人数据或客户信息；
- 使用本项目端点、演示页或你部署的实例，对**未授权的第三方系统**进行探测、扫描、压测或攻击；
- 利用项目能力绕过认证、抓取他人数据、实施 DoS 或任何违法行为；
- 在漏洞被修复前公开披露细节、PoC 或可直接利用的步骤；
- 恶意消耗项目/社区资源（提交海量无意义 Issue、刷 PR、自动化脚本轰炸、滥用「一键部署」）；
- 伪造测试结果、篡改基准数据、在基准测试中作弊；
- 违反 AGPL-3.0 或其他依赖许可证的再分发义务；
- 对安全研究者进行报复或封堵其正常、负责任的披露渠道。

### 社区层面

- 垃圾信息、刷屏、无关广告、反复自我推广；
- 持续偏离主题、恶意灌水、破坏讨论可读性；
- 拉帮结派、排挤特定贡献者、传播未经证实的指控；
- 恶意曲解项目立场、冒充官方渠道、伪造维护者背书；
- 在项目空间传播违法内容、恶意软件、钓鱼链接或欺诈信息。

### 具体示例

- ❌ 「你这水平也来提 PR？」——技术批评可以尖锐，但不应针对人。
- ❌ 把用户发来的 HAR 文件直接上传到公开 Issue（内含 Cookie / IP / 内网地址）。
- ❌ 用部署好的 NetSight 实例扫描别人的域名/IP，并声称「这是安全测试」。
- ❌ 在公开 Issue 中发布 0-day 利用步骤，要求「先合并再说」。
- ❌ 反复 @ 维护者催更，或在多个 Issue 中复制同一段抱怨。
- ❌ 用机器翻译批量提交六种语言的 PR，且无法回答任何术语问题。

---

## 项目特定准则

NetSight Pro 是一个**网络诊断工具**，它的能力可以被用于合法排障，也可能被滥用。以下规则是参与本项目的最低要求。

### 1. 尊重授权边界

- 只对你**拥有或获得明确授权**的网络、域名、服务进行探测；
- 不要用项目的 `/api/site-audit`、`/api/monitor`、`/api/dns-compare` 等能力去扫描、压测或攻击第三方；
- 不要提交自动化脚本，让他人「一键」对互联网目标做批量探测；
- 发现项目存在可能被用于滥用的设计缺口时，按 [安全研究](#安全研究与漏洞披露) 流程私下反馈。

### 2. 尊重测量真实性

- 不伪造基准、不选择性截取数据、不在测速中作弊；
- 讨论性能时说明环境（地区、运营商、设备、浏览器、是否开启代理）；
- 承认「这是模拟数据」与「这是实测」的区别，不把演示数据当作能力证明。

### 3. 尊重免费额度与公共资源

- 不要用脚本刷 `/speedtest`、`/upload-test`、`/stream-test` 等大流量端点；
- 不要对演示站点或他人部署做压力测试；
- 提交的代码不能明显导致默认部署超出免费额度或产生不可控成本。

### 4. 尊重隐私设计

- 不引入第三方分析、广告、指纹或数据回传，除非经过明确讨论并默认关闭；
- 不要求用户提供不必要的个人信息；
- 诊断数据默认留在浏览器；任何持久化（KV）都必须可选、可见、可预期。

### 5. 尊重许可证与依赖

- 项目主许可证为 **AGPL-3.0**；新增依赖必须兼容；
- 不要引入来源不明、许可证不清、体积巨大或维护停滞的依赖；
- 对 AGPL 的再分发/网络服务义务有疑问时，先讨论，不要默认绕过。

### 6. 尊重多语言与多地区

- 不因语言、地区、网络环境差异贬低他人；
- 翻译文案时避免地域歧视、政治敏感与不准确的技术术语；
- 对使用非母语交流的人保持耐心，不要嘲笑语法或拼写。

---

## 安全研究与漏洞披露

我们欢迎安全研究，但要求**负责任披露**。

### 安全港（Safe Harbor）

在以下范围内，我们对出于善意的安全研究不予追究：

- 只测试你自己的 NetSight Pro 部署；
- 只测试你拥有或获得明确授权的目标；
- 不访问、修改、删除他人数据，不扩大访问范围；
- 不进行可能影响服务可用性的 DoS/压测；
- 不公开披露未修复的漏洞细节；
- 漏洞报告后，给维护者合理的修复时间（通常 7–30 天，视严重程度）。

### 报告方式

- 首选：GitHub **Private Security Advisory**（仓库 → Security → Advisories）；
- 备选：邮件 <asiacomk@gmail.com>，标题注明 `[SECURITY]`；
- 请包含：受影响版本、复现步骤、影响评估、可能的修复建议、是否已公开；
- 我们会在 **7 天内**确认收到，并在修复后征得同意给予公开致谢。

### 禁止

- 不要用公开 Issue / PR / Discussion 发布漏洞利用链、可直接使用的 PoC 或用户数据；
- 不要对第三方系统进行「顺手测试」；
- 不要在漏洞修复前联系媒体或公开传播；
- 不要以披露为威胁索取报酬、合并代码或其他利益。

---

## 隐私与数据准则

讨论技术问题时，请默认所有贴出的内容都会被永久公开。

**发布前请移除/替换：**

- 真实姓名、邮箱、电话、住址、工作单位；
- IP 地址（公网/内网）、MAC、ASN 归属人信息；
- Cookie、`x-ns-token`、`PAGE_TOKEN_SECRET`、`MONITOR_ADMIN_KEY`、KV ID；
- 监控 URL 中的 token/query secret；
- 浏览器 HAR 中的 Cookie、Authorization、内网域名；
- 任何第三方用户的数据。

**建议做法：**

- 用 `203.0.113.x` / `198.51.100.x` / `example.com` 等保留地址与域名代替真实值；
- 用 `[REDACTED]` 标注敏感字段；
- 截图前检查浏览器地址栏、标签页标题、系统通知；
- 如果必须提供原始日志，先私信维护者并确认处理方式。

---

## 举报方式

如果你经历或目击了违反本公约的行为，请通过以下渠道举报：

- **常规行为问题**：邮件至 <asiacomk@gmail.com>，标题注明 `[CoC]`；
- **安全漏洞**：优先 GitHub Private Security Advisory，或邮件标题 `[SECURITY]`；
- **涉及维护者本人**：请发送邮件并说明「需要回避」，由其他维护者或平台渠道处理；若项目暂无其他维护者，请使用 GitHub 平台举报/滥用报告渠道。

**举报时建议包含：**

- 事件时间、地点（Issue/PR/聊天链接）；
- 涉及人员（项目内昵称即可）；
- 可核查的证据（截图、链接、上下文）；
- 是否涉及安全、隐私或法律风险；
- 你希望的处理方式（澄清、道歉、隔离、封禁等）；
- 你是否需要匿名。

**我们的承诺：**

- 在 **7 天内**确认收到；
- 对举报人身份与内容保密，仅在必要范围内共享；
- 不因举报而报复；
- 对善意举报但未能证实的，不追究举报人；
- 对明显恶意的举报，按 [不可接受行为](#不可接受的行为) 处理。

---

## 执行流程

1. **确认与受理**：维护者在 7 天内回复，说明下一步；
2. **利益冲突回避**：如被举报人是处理者本人或与其有直接关系，该处理者回避；
3. **调查**：查看公开记录、必要范围内询问双方与证人；优先保护举报人；
4. **判断**：依据本公约与项目实际情况，判断是否违规及严重程度；
5. **措施**：参照 [执行指南](#执行指南四级)，并书面通知相关方（不公开细节）；
6. **记录**：维护者保留最小必要的处理记录，不公开举报人信息；
7. **申诉**：当事人可在通知后 **14 天**内提出一次申诉，由未参与原处理的维护者复核；
8. **闭环**：必要时更新文档或流程，防止同类问题再次发生。

**时间预期**：常规问题通常在 30 天内完成；复杂或涉及安全/法律的问题可能更长。若维护者因个人原因无法及时处理，应在仓库公告中说明。

---

## 执行指南（四级）

以下四级适用于违规行为，具体措施取决于严重程度、持续性、影响范围与当事人的态度。

| 级别 | 名称 | 适用情形 | 处理措施 |
|---|---|---|---|
| **1** | **纠正（Correction）** | 不当措辞、无意冒犯、首次轻微违规 | 私下说明问题与影响，要求澄清或道歉；必要时公开说明；记录在案 |
| **2** | **警告（Warning）** | 重复轻微违规、一次中等违规、被纠正后仍继续 | 正式警告并说明后果；规定观察期（如 30 天）；观察期内禁止与当事人互动；违反则升级 |
| **3** | **临时封禁（Temporary Ban）** | 严重违规、持续骚扰、恶意行为、泄露隐私/密钥 | 禁止在项目空间互动 30–90 天；期间不得以任何方式联系当事人；违反则永久封禁 |
| **4** | **永久封禁（Permanent Ban）** | 暴力威胁、人肉搜索、性骚扰、持续性恶意、重大安全/法律风险、严重滥用项目能力 | 永久禁止参与项目空间；必要时上报平台；保留法律追责权利 |

**补充说明：**

- 安全漏洞/密钥泄露等行为，优先**止损**（撤销密钥、清理内容、通知受影响方），再按级别处理；
- 对「技术能力很强但持续伤害社区」的贡献者，同样适用上述规则；
- 对初犯且真诚道歉者，优先采用第 1 级；对恶意、组织化或反复违规者，可从第 3 级起步；
- 所有措施应**可解释、可复核**，并避免「因言获罪」式的主观扩大化。

---

## 报复与申诉

- **禁止报复**：对举报人、证人、处理者进行任何形式的报复，本身即属严重违规，可直接适用第 3–4 级；
- **申诉**：当事人可在收到处理通知后 14 天内，向 <asiacomk@gmail.com> 提交一次申诉，说明事实与理由；由未参与原处理的维护者复核；
- **复核结果**：维持、减轻、撤销或加重；复核结论为最终结果；
- **记录**：申诉与复核记录仅维护者可见，不公开个人隐私。

---

## 维护者职责

维护者应：

- 以身作则，遵守本公约；
- 及时、一致、透明地处理问题，不因个人好恶选择性执法；
- 保护举报人与当事人隐私，避免「公开处刑」；
- 在涉及自身利益时回避；
- 解释决定时给出依据（本公约条款、事实、影响），而不是只给结论；
- 承认错误并及时纠正；
- 不滥用管理权限（关闭 Issue、删评论、封禁）压制合理批评；
- 定期回顾本公约与执行情况，必要时修订；
- 关注社区健康，主动欢迎新贡献者，尤其是非英语母语者与少数群体。

---

## 语言、翻译与国际化

项目支持 **6 种界面语言**：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`es`。

- 任何语言的使用者都应受到同等尊重；
- 你可以用自己最舒服的语言提问，维护者会尽力回应或请人协助；
- 翻译贡献要求：
  - 保持 6 种语言的 key 集合与结构一致；
  - 技术术语（DNS、DNSSEC、DoH、RTT、TTFB、Mbps 等）按项目约定处理；
  - 避免地域歧视、政治敏感与冒犯性措辞；
  - 不接受「纯机器翻译、无法解释术语、拒绝回应评审」的批量 PR；
  - 欢迎母语者参与审校，翻译贡献者应在 PR 中说明语言背景与验证方式。
- 对翻译的讨论应聚焦「准确性、可读性、一致性」，而不是语言优劣。

---

## AI 辅助贡献政策

我们**不禁止**使用 AI 辅助编程或翻译，但要求作者对结果负责：

- **允许**：用 AI 生成草稿、补测试、解释报错、辅助翻译初稿；
- **要求**：
  - 你理解并验证了提交的代码/文案；
  - 涉及安全、令牌、SSRF、限流、权限的改动必须人工复核；
  - 有实质性 AI 生成内容时，建议在 PR 描述中说明（工具与范围）；
  - 翻译需由能阅读目标语言的人审校；
- **禁止**：
  - 未经验证的大段代码 / 大规模自动 PR；
  - 用 AI 批量生成低质量 Issue、评论或翻译；
  - 用 AI 伪造测试结果、复现步骤或安全报告；
  - 让 AI 代替你回应评审而完全不理解内容。

---

## 贡献流程与技术要求

参与代码贡献时，请同时遵守以下约定：

- 阅读 `README.md` 与 `project/README.md`；
- 服务端改动在 `project/src/**`，前端在 `project/assets/**`；不要直接修改 `dist/_workers.js`；
- 提交前运行 `npm run verify`（构建 + 语法检查 + 164 项回归）；
- 新增 i18n 文案必须六语齐全、key 对齐；
- 安全相关改动必须附带影响评估与测试；
- 涉及端点/配置/数据结构的破坏性变更，先开 Issue 讨论；
- 尊重 AGPL-3.0 许可证与第三方依赖许可；
- 不提交密钥、真实用户数据、内网地址或未脱敏 HAR。

---

## 生效、修订与致谢

- 本公约自 **2026-11-08** 起生效，版本 **1.0**；
- 维护者可根据社区发展修订本公约，重大修订会通过 Release / Discussion 公告；
- 本公约不溯及既往，但对持续行为适用最新版本；
- 本公约改编自 [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可；
- 感谢所有让这个项目变得更好的贡献者、翻译者、安全研究者与用户。

如有疑问，请联系：<asiacomk@gmail.com> · 项目：<https://github.com/BlueDriftHK/CF-workers-netdiag>

---

## English Version

**NetSight Pro — Code of Conduct v1.0 (effective 2026-11-08)**

This Code of Conduct is adapted from the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) and tailored to a network-diagnostics project. It applies to all project spaces: GitHub Issues, Pull Requests, Reviews, Discussions, releases, project chats, events, and public communication made on behalf of the project. It applies to maintainers as well as contributors.

**Our Pledge.** We pledge to make participation harassment-free for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity and orientation. We commit to acting in ways that contribute to an open, welcoming, diverse, inclusive and healthy community.

**Expected behavior.** Be respectful and evidence-driven; provide reproducible reports; assume good faith; welcome beginners and non-native speakers; credit others; respect maintainers' time; treat credentials, IP addresses and other people's data as sensitive by default.

**Unacceptable behavior.** Harassment, discrimination, personal attacks, sexualized attention, stalking, doxxing, impersonation, retaliation, spam, deliberate misinformation, publishing secrets or personal data, public disclosure of unfixed vulnerabilities, and using this project's diagnostic capabilities against systems you do not own or have permission to test. Do not use public demo or community endpoints for scanning, stress testing or attacks.

**Network-specific rules.** Only diagnose systems you own or are authorized to test. Do not abuse `/speedtest`, `/upload-test`, `/stream-test` or deployed instances. Respect the project's privacy-by-default and zero-egress design: no third-party analytics, no hidden data collection. Do not introduce dependencies with incompatible licenses. AGPL-3.0 applies to the project.

**Security research.** Responsible disclosure only: test your own deployments, avoid service disruption, do not access or exfiltrate third-party data, and give maintainers reasonable time to fix (typically 7–30 days). Report via GitHub Private Security Advisory or email <asiacomk@gmail.com> with `[SECURITY]` in the subject.

**Reporting.** Contact <asiacomk@gmail.com> with `[CoC]` for behavior issues. Reports are acknowledged within 7 days and handled confidentially. If the report concerns a maintainer, that maintainer will recuse themselves; use an alternative channel if needed. We will not tolerate retaliation against reporters or witnesses.

**Enforcement guidelines.** 1) **Correction** — private clarification and apology; 2) **Warning** — formal warning with a 30-day observation period; 3) **Temporary ban** — 30–90 days from project spaces; 4) **Permanent ban** — for severe or repeated violations, including threats, doxxing, harassment or abuse of project capabilities. Security incidents may be handled immediately to limit harm.

**Appeals.** A decision may be appealed once within 14 days by emailing <asiacomk@gmail.com>; an uninvolved maintainer will review. The review decision is final. Retaliation is itself a serious violation.

**Maintainer responsibilities.** Maintainers must model this Code, handle reports promptly and consistently, protect confidentiality, recuse themselves from conflicts of interest, explain decisions, and never use moderation powers to silence legitimate criticism.

**AI-assisted contributions.** Allowed, but authors are responsible for the result. Verify code and translations, disclose substantial AI-generated content when appropriate, and never submit unreviewed bulk PRs or fake reports.

**Project contribution rules.** Read `README.md` and `project/README.md`; edit `project/src/**` or `project/assets/**`, never `dist/_workers.js`; run `npm run verify` before opening a PR; keep i18n keys complete for all six languages; never commit secrets, real user data or unredacted HAR files.

**License & attribution.** This document is released under CC BY 4.0; the project is licensed under AGPL-3.0. Adapted from the Contributor Covenant v2.1.

---

<p align="center">
  <sub>Be rigorous about networks. Be kind to people.</sub>
</p>
