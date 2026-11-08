# 贡献指南（Contributing to NetSight Pro）

**版本：5.1.0** · 最后更新：2026-11-08

感谢你愿意为 NetSight Pro 做出贡献。这个项目从一个 7,000 行的单文件 Worker 起步，逐步长成了现在有模块化源码、构建脚本、测试套件与多语言界面的完整工程。它今天的质量，来自每一位提交 Issue、修 bug、写文档、翻译、做安全研究的人。

本指南会告诉你：**能贡献什么、怎么本地跑起来、代码/测试/翻译/文档有哪些约定、PR 如何被评审、版本如何发布**。读完它，你应该可以独立完成一次符合项目规范的贡献。

> 参与本项目即表示你同意遵守 [贡献者公约（CODE_OF_CONDUCT.md）](CODE_OF_CONDUCT.md)。
> 安全漏洞请**不要**公开提交 Issue，请阅读 [安全贡献](#安全贡献) 一节。

---

## 目录

- [你可以贡献什么](#你可以贡献什么)
- [开始之前](#开始之前)
- [开发环境](#开发环境)
- [本地开发流程](#本地开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 指南](#pull-request-指南)
- [Issue 规范](#issue-规范)
- [测试指南](#测试指南)
- [翻译指南](#翻译指南)
- [文档与展示页贡献](#文档与展示页贡献)
- [安全贡献](#安全贡献)
- [发布流程（维护者）](#发布流程维护者)
- [评审、治理与认可](#评审治理与认可)
- [常见问题](#常见问题)
- [English Version](#english-version)

---

## 你可以贡献什么

| 类型 | 具体内容 | 适合谁 |
|---|---|---|
| **Bug 修复** | 复现问题、定位原因、提交修复 + 回归测试 | 所有人 |
| **新功能** | 新诊断工具、新端点、新告警通道、PWA 改进 | 熟悉项目架构的贡献者 |
| **测试** | 补充边缘用例、SSRF/令牌/限流/监控断言 | 测试/安全背景优先 |
| **文档** | README、部署说明、FAQ、架构图、注释 | 写作/运维背景 |
| **翻译** | 六种界面语言（en / zh-CN / zh-TW / ja / ko / es）的翻译与审校 | 母语/流利使用者 |
| **设计与前端** | 界面细节、无障碍、动效、展示页 | 设计师/前端 |
| **安全研究** | 负责任的漏洞披露、威胁建模、安全加固 | 安全研究者 |
| **部署反馈** | 真实网络环境、不同套餐、不同地区的行为差异 | 用户/运维 |
| **社区** | 回答问题、整理 Issue、帮助新人、写使用案例 | 所有人 |

**不需要写代码也可以贡献。** 一个高质量的 Bug 报告、一段准确的翻译、一次真实的部署反馈，和一行代码同样重要。

---

## 开始之前

请按顺序完成以下检查，这能帮你节省大量时间：

1. **读文档**：根目录 `README.md`、`project/README.md`、`deploy/README.md`；了解「浏览器侧优先 / 零出站 / 预算与上限」的设计原则。
2. **读公约**：`CODE_OF_CONDUCT.md`。
3. **搜索是否已有**：先用关键词搜索 Issues / PRs / Discussions，避免重复劳动。
4. **确认版本**：当前发布版本为 **5.1.0**；如你基于旧版本，请先同步 `main`。
5. **大改动先讨论**：新增工具、端点、配置字段、数据结构、依赖、许可证变更，请先开 Issue 描述动机与方案，达成一致后再写代码。
6. **小改动直接提**：拼写错误、文档修正、明显的 bug 修复、翻译修正，可以直接提交 PR。
7. **不要提交机密**：真实 token、Cookie、密钥、用户 IP、HAR、内网地址，永远不要进入 Issue/PR。

---

## 开发环境

### 前置条件

- **Node.js ≥ 20**（构建、测试、同步脚本均只依赖 Node 内置模块）；
- **npm**（随 Node 提供）；
- 可选：`wrangler`（`npx wrangler` 即可，不需要全局安装）；
- 可选：Chrome / Edge 用于 UI 与展示页的手工验证；
- 不需要数据库、不需要 Docker、不需要第三方服务。

### 获取代码

```bash
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag
```

### 目录速览

```text
.
├── _workers.js                 # 单文件发行版（由 project 构建同步，不直接修改）
├── index.html                  # 经典静态介绍页
├── index-apple.html            # Apple 风格静态展示页
├── docs/                       # README 截图
└── project/                    # 源码与工程化流程
    ├── src/
    │   ├── server-core.js      # 常量 / 安全 / 令牌 / 限流 / 缓存 / KV / 监控 / 配置
    │   ├── server-handler.js   # handleRequest 路由与端点
    │   ├── lib/dns-wire.js     # RFC 8484 DoH 编解码
    │   └── handlers/           # page / pwa / admin
    ├── assets/
    │   ├── app.css             # 前端 CSS（原始文件）
    │   └── app.js              # 前端 JS（原始文件，无需模板转义）
    ├── scripts/
    │   ├── build.mjs           # 构建 + 校验
    │   └── sync.mjs            # 同步构建产物到部署文件
    ├── tests/worker.test.mjs   # 164 项回归
    ├── deploy/                 # wrangler 模板与说明
    └── dist/_workers.js        # 构建产物
```

### 常用命令

```bash
cd project

npm run build     # src + assets → dist/_workers.js（含语法与资产一致性校验）
npm run check     # node --check dist/_workers.js
npm test          # 164 项 Node vm 沙箱回归（无网络）
npm run verify    # build + check + test
npm run sync      # 需要时：同步构建产物到部署文件
```

> 项目没有第三方运行时依赖；`npm install` 只用于准备 npm 环境（可跳过）。

---

## 本地开发流程

### 1. 选择一个任务

- 从 `good first issue` / `help wanted` 标签开始；
- 或修复你实际遇到的问题（附上复现步骤会大大加速评审）；
- 大功能先开 Issue 对齐方案。

### 2. 创建分支

```bash
git checkout main
git pull
git checkout -b feat/monitor-content-assertions
# 或 fix/token-refresh-loop、docs/deploy-typo、i18n/ja-terminology ...
```

命名建议：`feat/`、`fix/`、`docs/`、`i18n/`、`test/`、`security/`、`refactor/`。

### 3. 修改源码

- **前端**：`project/assets/app.js`、`project/assets/app.css`；
- **服务端**：`project/src/server-core.js`、`server-handler.js`、`src/lib/**`、`src/handlers/**`；
- **不要直接改** `project/dist/_workers.js`，也不要直接改根目录 `_workers.js`（它是同步产物）；
- 保持改动聚焦：一个 PR 尽量只做一件事。

### 4. 本地验证

```bash
cd project
npm run verify
```

### 5. 手工回归

在浏览器中打开部署/本地预览，至少验证：

- 页面正常加载，无 CSP / JS 报错；
- 你改动的工具/端点可正常使用；
- 切换深/浅主题与 6 种语言无明显异常；
- 移动端宽度（390px）不溢出；
- 涉及安全（令牌/SSRF/限流/管理员端点）时，补做边界测试。

### 6. 本地预览 Worker

```bash
cd project
cp deploy/wrangler.toml.example wrangler.toml   # 按需修改
npm run build
npx wrangler dev
```

> `/health` 需要页面令牌；用浏览器访问首页即可获得 Cookie，再用 DevTools 调接口。
> 可视化展示页（`index-apple.html`）可直接 `start` 打开，无需服务器。

### 7. 同步单文件发行版（如需要）

仓库仍维护根目录的 `_workers.js` 作为单文件发行版：

```bash
cd project
node scripts/sync.mjs ../_workers.js
```

### 8. 提交并推送

```bash
git add -A
git commit -m "feat(monitor): support content assertions"
git push origin feat/monitor-content-assertions
```

---

## 代码规范

### 通用

- 保持文件现有风格：缩进、引号、分号与周边一致；**不要顺手格式化整个文件**；
- 优先小函数、纯函数；服务端逻辑尽量可测试；
- 命名清晰，避免魔法数字（可提取常量并注释原因）；
- 注释解释「为什么」，而不是复述「做了什么」；
- 删除死代码与调试输出，不要提交 `console.log` 噪音（关键错误日志除外）；
- 不引入运行时第三方依赖，除非经过讨论且确有需要；
- 不提交构建产物之外的大型二进制文件。

### 前端（`assets/app.js` / `app.css`）

- 原生 HTML / CSS / JS，**不引入框架**（React/Vue/Tailwind 等）；
- 所有用户可见文案走 i18n，不硬编码中文/英文；
- 动态拼接 HTML 时正确使用 `escapeHTML` / `escapeForJS`，不要直接拼用户数据；
- 网络请求统一走 `fetchWithTimeout`（带超时/Abort），长任务使用 `AbortController`；
- 轮询/定时器必须在页面隐藏或弹层关闭时暂停/清理；
- CSS 使用现有变量（颜色、圆角、间距），深浅主题都必须可读；
- 遵循 `prefers-reduced-motion`；动画不应阻塞操作；
- 移动端 320–768px 优先检查。

### 服务端（`src/**`）

- Service Worker 语法（`addEventListener('fetch'/'scheduled')`），构建后单文件分发；
- 新端点必须在路由中显式放置，处理 `OPTIONS`、方法校验、鉴权、限流、错误响应；
- 涉及用户输入的出站请求，必须经过 SSRF 校验（协议/端口/私网/DoH），并设置超时；
- 涉及 KV 的写入必须经过 `kvPut` / `kvWriteGateOk`，不要绕过预算；
- 响应头统一带 no-store（动态接口）或明确缓存策略（静态资产）；
- 不泄露内部信息（异常堆栈、KV ID、密钥、内部路径）；
- 新增环境变量/绑定必须有默认值与缺失时降级。

### 安全敏感代码

以下区域的 PR 会被额外审查，并需要补充测试：

- 页面令牌 / HMAC / Cookie / 管理员鉴权；
- SSRF 判定、DoH 校验、重定向处理、webhook；
- 限流、KV 写预算、大响应配额；
- HTML 模板注入点、CSP、内联脚本；
- 管理面板 / metrics 暴露面；
- 依赖与许可证变更。

### 静态展示页

- `index.html` / `index-apple.html` 必须保持**零外部依赖**（系统字体、内联 SVG、原生 Canvas）；
- 深/浅主题、移动端、`prefers-reduced-motion`、无 JS 降级都要考虑；
- 新增动效需可解释、可关闭、不闪烁；
- 截图素材放在 `docs/`，README 引用相对路径。

---

## 提交规范

### 分支

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/dns-wire-resolver` |
| `fix/` | Bug 修复 | `fix/monitor-quiet-hours` |
| `docs/` | 文档 | `docs/contributing-guide` |
| `i18n/` | 翻译/本地化 | `i18n/ja-terminology` |
| `test/` | 测试 | `test/ssrf-ipv6-cases` |
| `security/` | 安全加固（非漏洞细节） | `security/token-timing-safe` |
| `refactor/` | 无行为变化的重构 | `refactor/split-handlers` |

### Commit Message

建议使用 Conventional Commits：

```text
feat(monitor): support body/keyword assertions
fix(token): avoid infinite reload on 403
docs(readme): document SITE_CONFIG fields
i18n(ja): revise network terminology
test(ssrf): add IPv4-mapped IPv6 cases
refactor(handler): extract page renderer
```

规则：

- 首行 ≤72 字符，使用祈使语气（add / fix / document / refactor）；
- 正文说明「为什么」与「影响范围」；
- 关联 Issue：`Closes #123` / `Refs #456`；
- 一个 commit 只做一件事；大改动可拆多个 commit，但每个都应可独立理解。

---

## Pull Request 指南

### PR 应包含什么

1. **标题**：与 commit 风格一致，能看出模块与结果；
2. **描述**：
   - 动机 / 解决的问题；
   - 方案要点与取舍（为什么这样做）；
   - 涉及端点、配置、数据结构变更；
   - 测试方式与结果（命令、断言数、截图/录屏）；
   - 是否影响安全/隐私/免费额度；
   - 关联 Issue。
3. **变更类型**：Bug 修复 / 新功能 / 文档 / 翻译 / 重构 / 安全加固；
4. **Checklist**：见下。

### PR Checklist

```markdown
- [ ] 已阅读 README / project/README / CONTRIBUTING / CODE_OF_CONDUCT
- [ ] 改动聚焦于一个目的，未混入无关格式化
- [ ] 已在 project/ 中修改源码，未直接改 dist 或根目录 _workers.js
- [ ] 已运行 `npm run verify`，164 项回归通过
- [ ] 新增/修改逻辑已补充测试（如适用）
- [ ] 新增文案已补齐 6 种语言，key 对齐（如适用）
- [ ] 已手工验证受影响的页面/端点（附截图或命令）
- [ ] 未提交任何密钥、token、真实 IP、用户数据或 HAR
- [ ] 涉及安全/隐私/配额变更时，已在描述中说明
```

### 评审流程

- CI（build → `node --check` → 164 项测试）必须通过；
- 至少一位维护者 review；
- 维护者可能要求拆分 PR、补测试、补 i18n、补文档；
- 评审意见聚焦代码、行为、安全与可维护性，不针对个人；
- 如对结论有异议，请讨论依据与替代方案，必要时由维护者裁决；
- 合并后恭喜你成为项目贡献者 🎉

### PR 大小建议

- 理想：**< 400 行**改动、可在一个 review 轮次内理解；
- 大功能可以拆成多个 PR（例如：先数据结构，再接口，再 UI）；
- 纯格式化/重命名请单独提交，避免淹没真实改动。

---

## Issue 规范

### Bug 报告

请包含：

- 版本（`/health` 或页面版本号）；
- 部署方式（单文件 / 模块化 / 自定义配置）；
- 浏览器、系统、网络环境（是否代理/VPN/IPv6）；
- 复现步骤（最小化）；
- 期望结果 vs 实际结果；
- 错误信息、控制台日志、截图（**已脱敏**）；
- 是否绑定 KV / 设置 `PAGE_TOKEN_SECRET` / 管理密钥；
- 是否可稳定复现。

**请勿**包含：真实 token、Cookie、IP、HAR、用户数据、内网地址。如需提供敏感信息，先私信维护者。

### 功能建议

请包含：

- 需求场景（谁、在什么网络环境下、解决什么问题）；
- 现有替代方案与不足；
- 期望的交互/API/配置形态；
- 对成本（请求/CPU/KV/出站）、隐私、安全的影响；
- 是否愿意实现/测试/翻译。

### 标签建议

`bug`、`enhancement`、`documentation`、`i18n`、`security`、`good first issue`、`help wanted`、`question`、`deployment`、`design`。

---

## 测试指南

### 自动化测试

- 测试文件：`project/tests/worker.test.mjs`；
- 运行：`cd project && npm test`（或 `npm run verify`）；
- 测试在 Node `vm` 沙箱中加载 Worker，不访问网络；通过 mock 的 `fetch`、KV、Request/Response 验证行为；
- 当前 **164 项**，任何修复/新功能都应补充断言；
- 不允许为了通过测试而弱化断言；如确需调整既有断言，请在 PR 中说明原因。

### 写测试的方式

```js
// 例：为新的 DNS wire 解析补充 fixture
const parsed = T.dnsParseResponse(makeDnsWireResponse());
eq('dns wire rcode', parsed.status, 0);
eq('dns wire A record', parsed.answers[0].data, '1.2.3.4');

// 例：为端点补充 mock fetch
const T = await load({
  fetch: async (url) => new Response(JSON.stringify({ Status: 0, Answer: [] }), {
    headers: { 'content-type': 'application/json' }
  })
});
const res = await T.handleRequest(makeEvent('/api/dns-lookup?name=example.com', {
  headers: { 'x-ns-token': token }
}));
eq('dns-lookup 200', res.status, 200);
```

要求：

- 使用 mock，不发起真实网络请求；
- 覆盖正常、边界、异常、安全（SSRF/令牌/限流）路径；
- 测试命名清晰，失败信息可定位；
- 不依赖执行顺序与共享可变状态。

### 手工回归清单（涉及 UI/端点时）

- [ ] 首页、`/app.js`、`/app.css`、`/sw.js`、`/manifest` 正常；
- [ ] `/node-ping` 公开可访问；`/health` 从页面内 200、curl 403；
- [ ] 6 种语言切换正常，文案不溢出；
- [ ] 深/浅主题、390px 移动端正常；
- [ ] 改动的工具：开始/中止/重复运行无异常；
- [ ] 安全相关：私网目标被拒、无令牌 403、限流 429、管理员端点鉴权；
- [ ] PWA：离线页可用、SW 不缓存 API。

---

## 翻译指南

### 语言与位置

- 支持 6 种语言：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`es`；
- 文案位于 `project/assets/app.js` 中的 `I18N`、`I18N_EXTRA`、`I18N_MORE`、`I18N_EXTRA_V49`、`I18N_EXTRA_V51` 等对象；
- 新增文案必须在 **6 种语言**中补齐，key 完全一致；
- 工具描述、建议（advice）、issue 映射（auditIssueMap）、管理面板文案都属于 i18n 范围。

### 翻译要求

- 使用自然、简洁的界面语言，避免机翻腔；
- 技术术语保持统一（见下表）；
- 保留数字、单位、符号（`·`、`→`、`×`、`%`、`Mbps`、`ms`）；
- 不改变语义、不添加原文没有的承诺或警示；
- 避免地域歧视、政治敏感与冒犯性措辞；
- 涉及安全提示的翻译要准确（如「静默时段」「维护窗口」「私网」）；
- 欢迎母语者审校；PR 中说明语言背景与验证方式。

### 术语参考

| en | zh-CN | zh-TW | ja | ko | es |
|---|---|---|---|---|---|
| latency / RTT | 延迟 / RTT | 延遲 / RTT | レイテンシ / RTT | 지연 / RTT | latencia / RTT |
| jitter | 抖动 | 抖動 | ジッター | 지터 | jitter |
| packet loss | 丢包 | 封包遺失 | パケット損失 | 패킷 손실 | pérdida de paquetes |
| bandwidth | 带宽 | 頻寬 | 帯域幅 | 대역폭 | ancho de banda |
| resolver | 解析器 | 解析器 | リゾルバ | 리졸버 | resolutor |
| domain audit | 域名体检 | 網域健檢 | ドメイン監査 | 도메인 점검 | auditoría de dominio |
| uptime monitoring | 站点监控 | 站點監控 | 稼働監視 | 사이트 모니터링 | monitoreo de sitio |
| alert | 告警 | 告警 | アラート | 경고 | alerta |
| quiet hours | 静默时段 | 靜默時段 | 静かな時間帯 | 방해 금지 시간 | horas de silencio |
| token | 令牌 | 權杖 | トークン | 토큰 | token |

### 翻译 PR 流程

1. 在 Issue/PR 中说明目标语言与范围；
2. 修改对应 i18n 对象，补齐所有语言；
3. `npm run verify`，确认 `APP_JS` 可编译；
4. 打开页面逐项检查 6 种语言；
5. 提交 PR，标题如 `i18n(ja): revise monitor terminology`。

> 不接受「纯机器翻译、无法解释术语、拒绝回应评审」的批量 PR。

---

## 文档与展示页贡献

- 文档文件：`README.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`project/README.md`、`deploy/README.md`；
- 文档中的命令、版本号、端点、配置字段必须与实际代码一致；
- 修改 README 截图时，同时更新 `docs/` 中的图片（建议 1440 宽、保留深/浅色）；
- 展示页 `index-apple.html` 的设计规则：
  - 零外部请求（系统字体、内联 SVG、原生 Canvas）；
  - 深/浅主题、响应式、无障碍、`prefers-reduced-motion`；
  - 动效服务信息层级，不做无意义闪烁；
  - 修改后用 Chrome Headless 截图检查桌面 + 390px 移动端。
- 文档 PR 也建议附「改了什么、为什么、影响哪些链接」。

---

## 安全贡献

### 不要公开提交漏洞细节

- 不要用公开 Issue/PR 披露可利用细节、PoC、用户数据或密钥；
- 通过 GitHub **Private Security Advisory** 或邮件 <admin@bjhr.space>（标题 `[SECURITY]`）反馈；
- 给维护者合理修复时间（通常 7–30 天）；
- 我们会在修复后征得同意给予公开致谢。

### 安全港

在以下范围内，出于善意的安全研究不予追究：

- 只测试你自己的部署；
- 只测试你拥有或获得授权的目标；
- 不访问/修改/删除他人数据；
- 不做影响可用性的压测/DoS；
- 不公开未修复漏洞。

### 贡献代码时的安全底线

- 永不提交真实密钥/token/Cookie/用户数据；
- 新端点必须限流、鉴权、输入校验、SSRF 防护；
- 不引入隐蔽数据外传、第三方统计、指纹或后门；
- 不降低现有安全基线（CSP、令牌、KV 预算、限流）；
- 涉及安全逻辑的改动必须补测试，并接受额外评审。

---

## 发布流程（维护者）

1. **确定版本号**：语义化版本（`major.minor.patch`）；
2. **更新出现版本号的位置**：
   - `project/package.json`；
   - `project/src/server-core.js` 顶部注释；
   - `project/src/server-handler.js` 的 `/health`、`/node-ping` 版本字段与 `ASSET_VER` 前缀；
   - README 徽章/版本、CoC/CONTRIBUTING 的版本说明（如涉及）；
3. **更新文档**：README 更新日志、部署说明、API 变更；
4. **完整验证**：

   ```bash
   cd project
   npm run verify
   ```

5. **构建并同步发行文件**：

   ```bash
   npm run build
   node scripts/sync.mjs ../_workers.js
   ```

6. **预发部署 + 冒烟**：
   - `/node-ping` 200；
   - 首页加载、`/app.js`、`/sw.js`、`/manifest` 正常；
   - `/health` 页面内 200、curl 403；
   - `/metrics` 鉴权正确；
   - `/admin` 可加载；
   - 至少一个诊断工具、一个 DNS 工具、监控保存/巡检正常；
   - 6 语言 / 深色浅色 / 移动端；
7. **部署**：`npx wrangler deploy`（`main` 指向 `dist/_workers.js`）；
8. **Git tag + Release**：`git tag v5.x.y`，Release Notes 汇总变更与贡献者；
9. **公告**：GitHub Discussions / 项目页面；
10. **归档**：保留上一版本 tag；必要时更新 `_workers.js.bak` 或发布说明中的回滚方式。

---

## 评审、治理与认可

- **维护者**：负责方向、评审、发布、安全响应与最终裁决；
- **评审 SLA**：尽力在 7 天内首次响应；复杂问题可能更久，会在 Issue 中说明；
- **利益冲突**：评审者与被评审内容存在利益关系时应回避；
- **一致性**：相似问题应得到相似处理，避免选择性执法；
- **透明度**：重要的架构/安全/许可证决策会在 Issue/Discussion 中记录理由；
- **认可**：所有贡献者会在 Release Notes 中致谢；重要贡献可列入 README/AUTHORS（如建立）。

---

## 常见问题

**Q：我不会 Cloudflare，能贡献吗？**
A：可以。文档、翻译、展示页、测试用例、Issue 复现都很有价值；本地运行只需要 Node。

**Q：必须用框架吗？**
A：不。项目刻意保持原生 HTML/CSS/JS，零运行时依赖；请勿引入前端框架或 UI 库。

**Q：为什么不能直接改 `_workers.js` / `dist/_workers.js`？**
A：它们是构建产物（`dist` 生成后同步到根目录）。源码在 `project/src` 与 `project/assets`，直接改产物会在下次构建时被覆盖。

**Q：测试必须联网吗？**
A：不需要。测试使用 mock，禁止真实网络请求；真实环境验证请手动进行。

**Q：我可以只改一个错别字吗？**
A：当然，直接提 PR 即可。

**Q：我的 PR 多久会被 review？**
A：维护者尽力 7 天内首次响应；如果 CI 未通过或缺少必要信息，会先要求补齐。

**Q：可以用 AI 写代码/翻译吗？**
A：可以，但你必须理解并验证结果；涉及安全逻辑需人工复核；不接受未经验证的批量生成 PR（详见 `CODE_OF_CONDUCT.md`）。

**Q：如何本地测试 Worker？**
A：`cd project && npm run build && npx wrangler dev`；`/health` 需要浏览器页面令牌，用首页获取 Cookie 后再调。

**Q：如何成为维护者？**
A：持续、高质量地贡献（代码/安全/翻译/社区），理解项目原则，并在多个 PR 中展现判断力；由现有维护者邀请。

---

## English Version

**Contributing to NetSight Pro (v5.1.0)**

Thanks for your interest! NetSight Pro is a single-file Cloudflare Worker and a modular project. This guide covers how to contribute code, tests, docs, translations and security reports.

**Ways to contribute.** Bug reports and fixes, new diagnostic tools or endpoints, tests (especially token/SSRF/rate-limit/monitoring edge cases), documentation, translations (en / zh-CN / zh-TW / ja / ko / es), UI/UX and accessibility, responsible security research, deployment feedback, and community support.

**Before you start.** Read `README.md`, `project/README.md`, `deploy/README.md` and `CODE_OF_CONDUCT.md`. Search existing issues and PRs. For large changes (new tools, endpoints, config fields, data structures, dependencies or license changes), open an Issue first. Never post real tokens, cookies, keys, IPs, HAR files or user data.

**Development environment.** Node.js ≥ 20. The project has no runtime dependencies. Source lives in `project/src/**` (server) and `project/assets/**` (frontend). Do not edit `project/dist/_workers.js` or the root `_workers.js` — they are build artifacts.

```bash
cd project
npm run build     # build dist/_workers.js with validation
npm run check     # syntax check
npm test          # 164 sandbox tests, no network
npm run verify    # build + check + test
node scripts/sync.mjs ../_workers.js   # when syncing the single-file release
```

**Coding standards.** Keep the existing style; no frontend frameworks or runtime dependencies; use existing CSS variables and support dark/light themes; all user-facing strings go through the six-language i18n dictionaries; escape HTML/JS output correctly; use timeouts and AbortController for network requests; new endpoints must implement auth, rate limiting, input validation and SSRF protection; KV writes must go through the budget gate; never weaken the security baseline. Security-sensitive changes require tests and extra review.

**Commits & PRs.** Use Conventional Commits (`feat(monitor): ...`, `fix(token): ...`, `docs(readme): ...`, `i18n(ja): ...`). Keep PRs focused (< ~400 lines when possible), include motivation, approach, affected endpoints/config, test evidence and screenshots for UI changes. PRs must pass `npm run verify`; at least one maintainer review is required. Never commit secrets or unredacted data.

**Issues.** For bugs include version, deployment mode, browser/OS/network environment, repro steps, expected vs actual, redacted logs/screenshots, and whether KV/admin key are configured. For features include the scenario, alternatives, proposed API/UI, and impact on cost/privacy/security.

**Testing.** Add assertions to `project/tests/worker.test.mjs` using mocked fetch/KV/Request/Response; never make real network calls in tests. Cover success, boundary, failure and security paths. Manual smoke checks: page/assets, `/node-ping`, `/health` auth behavior, 6 languages, themes, mobile, changed tools, rate limiting, admin endpoints and PWA offline behavior.

**Translations.** Six languages are required for every new string, with identical keys. Use natural, concise UI language; keep technical terms, numbers and symbols; avoid machine-only bulk PRs; native review is welcome.

**Security.** Do not disclose vulnerabilities publicly. Use GitHub Private Security Advisories or email <admin@bjhr.space> with `[SECURITY]`. Safe harbor: test only your own deployments or systems you are authorized to test, do not disrupt services, do not access third-party data, and allow 7–30 days for fixes.

**Release process (maintainers).** Bump the version in `project/package.json`, `src/server-core.js`, `src/server-handler.js` (`/health`, `/node-ping`, `ASSET_VER`), update docs/README, run `npm run verify`, build and sync, deploy to staging and smoke test, deploy with `wrangler`, tag the release and publish notes.

**Governance & recognition.** Maintainers guide direction, review, releases and security response. Review SLA is best effort (first response within 7 days). Decisions should be consistent, transparent and conflict-free. All contributors are credited in release notes.

**Questions?** Open a Discussion/Issue or email <admin@bjhr.space>. Please also read `CODE_OF_CONDUCT.md`. Thank you for helping make NetSight Pro better!

---

<p align="center">
  <sub>Code is read more often than it is written. Thanks for contributing.</sub>
</p>
