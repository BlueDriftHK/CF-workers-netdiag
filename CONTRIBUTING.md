# 贡献指南 · Contributing to NetSight Pro / CF-workers-netdiag

**适用版本**：v4.7.x（`_workers.js` 单文件 Cloudflare Worker + PWA 前端）
**代码许可**：GNU AGPL-3.0 · **本文档许可**：CC BY 4.0
**行为规范**：参与本项目即表示你同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
**本文档版本**：v1.0 · 最近更新：`<待填：2026-10-16>`

> **一句话**：先讨论再动手；一次 PR 只做一件事；不要削弱"零出站 / KV 写入预算 / 安全默认值"这三条取舍。
>
> **English summary** — This project is a single-file Cloudflare Worker with an inline PWA front-end, no build step and no runtime dependencies. Contributions are welcome for bug fixes, diagnostics, translations (en / zh-CN / zh-TW) and docs. Before coding: open an issue for anything that touches endpoints, rate limits, KV writes, outbound requests, or security defaults. Keep DOM ids stable, add UI strings in all three languages, run `node --check _workers.js` and `wrangler deploy --dry-run`, and estimate the worst-case request/KV-write cost of your change. Contributions are licensed under AGPL-3.0 (inbound = outbound, no CLA).

---

## 目录

1. [开始之前](#1-开始之前)
2. [仓库结构](#2-仓库结构)
3. [本地开发环境](#3-本地开发环境)
4. [改代码的规矩](#4-改代码的规矩)
5. [测试清单（提交前必过）](#5-测试清单提交前必过)
6. [提交与 PR](#6-提交与-pr)
7. [版本与发布（维护者）](#7-版本与发布维护者)
8. [文档与翻译贡献](#8-文档与翻译贡献)
9. [有问题去哪里问](#9-有问题去哪里问)
- [附录 A：新增一个诊断工具的骨架](#附录-a新增一个诊断工具的骨架)
- [附录 B：新增一个 API 端点的骨架](#附录-b新增一个-api-端点的骨架)
- [附录 C：一页速查（提交前 30 秒）](#附录-c一页速查提交前-30-秒)

---

## 1. 开始之前

### 1.1 这个项目是什么

一个**单文件**的 Cloudflare Worker，把"网络诊断工具箱"和它的前端一起装在一个 `.js` 里：Worker 负责少量服务端能力（限流、可选 KV、少量可选出站），前端（内联 CSS/JS，作为 `/app.css`、`/app.js` 由 Worker 提供）负责绝大部分探测——RTT、质量监控、多流测速、WebRTC 检测、可达性探测等都在**你的浏览器**里完成。

它**不是**：不是 SaaS，不带账号体系，不上报数据，不依赖任何前端框架或构建工具，也**不保证**任何服务可用性（公开实例由个人自费部署）。

### 1.2 三条不可协商的取舍

改动前请先理解这三条，它们在 [CODE_OF_CONDUCT.md 第 6 节](CODE_OF_CONDUCT.md#6-本项目特有的技术红线) 有完整说明：

| 取舍 | 含义 | 你要做的事 |
|---|---|---|
| **零出站优先** | 能由浏览器做的探测，不放到 Worker 做 | 新功能先问"浏览器能不能做"；确实要出站则默认关闭 + 缓存 + 超时 |
| **KV 写入有预算** | 所有 KV 写入经统一闸门（每分钟/每日上限 + 同键去抖） | 用 `kvPut()`，不要直接 `ns.put()`；不要引入 `list` / 批量 `delete` |
| **安全默认值不可放宽** | CSP、安全头、会话令牌、SSRF 防护、体积上限 | 不要为了让自己的改动"跑通"而放开任何一项 |

### 1.3 贡献类型与入口

| 你想做的事 | 怎么做 |
|---|---|
| 报 bug | 用 `.github` 里的 issue 模板；按 [§4.3 脱敏要求](CODE_OF_CONDUCT.md#43-贴日志与数据的脱敏要求) 附证据 |
| 提新功能 | **先开 issue 讨论**（尤其涉及端点、限流、KV、出站、安全时） |
| 修 bug / 实现功能 | fork → 分支 → 小步提交 → PR（见第 6 节） |
| 翻译 / 文案修正 | 直接 PR，务必三语同步（见 [4.8](#48-国际化与本地化)） |
| 文档改进 | 直接 PR；改动 README 的端点表时请与代码保持一致 |
| 部署踩坑反馈 | 开 issue，注明托管方式（Workers 直连 / 自定义域 / CI 部署） |
| **安全漏洞** | **不要开公开 issue**，走私密渠道，见 [SECURITY.md](SECURITY.md) 与 [CoC 第 8 节](CODE_OF_CONDUCT.md#8-安全漏洞与敏感数据上报) |

### 1.4 先搜索、先讨论

- 搜索已有 issue/PR（含**已关闭**的——本项目的取舍类问题经常被反复提出）。
- 以下改动**必须先有 issue 共识**再动手：
  - 新增或恢复端点、调整限流阈值、调整 KV 策略
  - 新增 Worker 出站请求、放宽 SSRF/端口策略
  - 新增依赖或外链资源
  - 改版本策略、改端点开关默认值

---

## 2. 仓库结构

| 文件 | 作用 | 可否直接改 |
|---|---|---|
| `_workers.js` | **唯一权威源文件**：Worker 逻辑 + 内联 CSS + 内联前端 JS + HTML 模板 | ✅ 是主要工作面 |
| `index.html` | 静态副本 / 展示页（用途 `<待填：请维护者确认>`） | ⚠️ 若与 `_workers.js` 内容重叠，改动需同步，否则会出现"两份代码两种行为" |
| `README.md` | 项目介绍、端点表、部署说明 | ✅ |
| `CONTRIBUTING.md` | 本文档 | ✅ |
| `CODE_OF_CONDUCT.md` | 行为准则 + 工程红线 + 许可与 AGPL 合规说明 | ✅ |
| `SECURITY.md` | 漏洞披露策略 | ✅ |
| `LICENSE` | AGPL-3.0 | ❌ 不要改 |
| `.github/` | issue / PR 模板、Actions（如有） | ✅ |
| `CNAME` | 自定义域 | ⚠️ 改前确认域名归属 |

### 2.1 为什么没有构建步骤

Worker 直接把 `APP_CSS` / `APP_JS` 两个模板字符串作为静态资源返回，前端不打包、不转译。代价是所有前端代码必须写在模板字符串里（见 [4.2 转义陷阱](#42-app_js-模板字符串的三个转义陷阱)），好处是**改一行、推一次就能上线**，没有工具链腐化问题。

### 2.2 代码地图（`_workers.js` 内的分区）

从上到下的主要区块，便于定位：

| 区块 | 内容 |
|---|---|
| 常量与安全头 | `CORS_HEADERS`、`SECURITY_HEADERS`、`isSameOriginNavigation`、会话令牌（`issuePageToken` / `getRequestToken` / `isValidPageToken`） |
| 限流与配额 | `isRateLimited`、`cleanupRateLimit`、各类 bucket 常量、`COUNTED_ENDPOINTS`、`DISABLED_ENDPOINTS` |
| 安全校验工具 | `isIpLiteral` / `parseIPv6ToGroups` / `isPrivateIp` / `isPrivateHost` / `isAllowedTargetPort` / `resolvesToPublicOnly` |
| KV 层 | `kvWriteGateOk` / `kvPut`（写入总闸）、`recordUsage`、测速历史环形缓冲、`statsCache` |
| 站点监控 | `handleMonitorCheck`、`runMonitorChecks`、`postMonitorWebhook`、Cron 入口 |
| 前端资源 | `APP_CSS`、`APP_JS`（含 `i18n`、工具表、各工具 runner） |
| 请求路由 | `handleRequest()`：令牌/限流 → 停用端点短路 → 各端点 → 主页面 HTML |
| 主页面模板 | 内联 HTML（含 `${...}` 服务端插值）与 CSP nonce |

### 2.3 前端代码的组织方式（`APP_JS` 内）

| 部分 | 说明 |
|---|---|
| `i18n` | 三语字典（`en` / `zh-CN` / `zh-TW`），含 `toolDesc`、`advice`、`auditIssueMap` 等嵌套表 |
| `elements` | DOM 引用表（含结果区回退到 `#toolModalBody`） |
| 通用 UI 工具 | `escapeHTML`、`showResult`、`resultTitle`、`metricCard`、`metricGrid`、`rowItem`、`adviceBlock` |
| 弹层两栏 | `openToolModal`、`setToolParams`、`setToolActions`、`primaryAction`、`secondaryAction` |
| 工具表 | `TOOL_GROUPS`、`TOOL_LIST`、`TOOL_RUNNERS`、`renderToolCards` |
| 各工具实现 | `runXxxTool()` 负责"渲染左栏参数 + 绑定事件"，`startXxx()` 负责执行与结果渲染 |
| 本地历史 | `pushLocalHistory` / `renderLocalHistory`（localStorage，键名 `netsight-local-history`） |

---

## 3. 本地开发环境

### 3.1 前置

- Node.js ≥ 18（仅用于 `wrangler` 与 `node --check`，项目本身无 npm 依赖）
- `wrangler`（`npm i -g wrangler` 或用 `npx wrangler`）
- 一个 Cloudflare 账号（`wrangler login`）

### 3.2 最小可跑

```bash
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag
wrangler dev            # 本地起一个 Worker，默认 http://localhost:8787
```

`wrangler dev` 下没有 KV 绑定也能跑：用量统计退化为内存模式，测速历史与站点监控会各自提示未绑定/未配置。

### 3.3 `wrangler.toml` 参考（按需增删）

```toml
name = "cf-workers-netdiag"
main = "_workers.js"
compatibility_date = "2024-11-01"

# 可选：测速历史、用量统计（kv 模式）、站点监控状态都依赖它
[[kv_namespaces]]
binding = "SPEED_HISTORY"
id = "<待填：你的 KV namespace id>"

# 可选：/static/ 静态资源缓存（该前缀当前处于停用状态，见 §4.6）
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "<待填>"

# 可选：站点监控定时巡检（建议 5 分钟一次）
[triggers]
crons = ["*/5 * * * *"]

[vars]
# 跨域白名单：逗号分隔；`*` 表示放开（会关闭令牌校验的跨域分支，慎用）
ALLOWED_ORIGINS = ""
```

**必须在部署端设置（不要写进代码、不要提交）**：

| 名称 | 类型 | 用途 |
|---|---|---|
| `MONITOR_ADMIN_KEY` | Secret | 站点监控的管理密钥；只走 `x-admin-key` 请求头 |
| `ALLOWED_ORIGINS` | Var/Secret | 跨域白名单，留空即只允许同源 |

本地调试把密钥放 `.dev.vars`（该文件必须在 `.gitignore` 里）：

```
MONITOR_ADMIN_KEY="local-dev-key"
```

### 3.4 本地调试常用速查

| 现象 | 原因 / 处理 |
|---|---|
| 访问 `/health` 返回 **403** | 会话令牌校验生效：先用浏览器打开主页面（会种下 `__ns_t` Cookie），或在请求里带 `x-ns-token` / `Referer` |
| 页面工具全部报错 | 大概率是令牌失效（isolate 重建）→ 前端会在 RTT 探测收到 403 时自动刷新页面重新领取 |
| 某端点返回 **410** | 该端点已被 `DISABLED_ENDPOINTS` 停用（正常行为，见 §4.6） |
| KV 相关功能无效 | 未绑定 `SPEED_HISTORY`，或 `SPEED_HISTORY_KV_ENABLED` / `USAGE_BACKEND` 保持默认关闭 |
| 请求被 **429** | 命中限流：默认 60/min/IP，`/health` 180/min，大响应 30/min，`/cpu-test` 3/min |
| 想看 KV 写入预算 | 主页面控制台执行 `fetch('/health').then(r=>r.json()).then(d=>console.log(d.kvWrite))` |

---

## 4. 改代码的规矩

### 4.1 代码风格

- **缩进**：Worker 侧 2 空格；`APP_JS` / `APP_CSS` 模板内沿用 4 空格（与现有代码保持一致）。
- **引号**：字符串统一单引号；模板字符串仅在需要插值时使用。
- **命名**：常量 `UPPER_SNAKE`；函数 `camelCase`；DOM id 用 `kebab-case`；`data-*` 只用于工具键（`data-tool`）。
- **注释**：中文，说明"为什么这么做"（取舍、配额、安全原因），而不是复述代码。
- **不要引入运行时依赖**，不要引入构建步骤，不要新增未讨论的外链。
- **一次 PR 只做一件事**：格式化、重命名不要与功能改动混在一起。

### 4.2 `APP_JS` 模板字符串的三个转义陷阱

这是本项目**最容易踩**的坑：`APP_JS` 本身是 Worker 里的模板字符串，里面再写前端代码时，以下字符必须转义。

| 你想在前端代码里写 | 在 `_workers.js` 里必须写成 | 原因 |
|---|---|---|
| 反引号 `` ` ``（前端模板字符串） | `` \` `` | 否则会提前结束 `APP_JS` |
| `${expr}`（前端插值） | `\${expr}` | 否则会被 Worker 侧提前求值 |
| 正则里的 `\d`、`\.`、`\/` | `\\d`、`\\.`、`\\/` | 模板字符串会吃掉一层反斜杠 |
| 字符串里的换行 `\n` | `\\n` | 同上 |

示例（前端代码）：

```js
// _workers.js 中的实际写法
const testUrl = node + '/node-ping';
if (!/^https?:\\/\\//i.test(u)) u = 'https://' + u;
el.innerHTML = '<div>' + escapeHTML(name) + ' \\n ' + value + '</div>';
const arr = urls.split('\\n');
```

> 自检：改完 `APP_JS` 后跑 `node --check _workers.js`；若报 `Unexpected token` 或 `Invalid or unexpected token`，几乎都是这里的转义漏了。

**HTML 模板**（主页面那段）里的 `${...}` 是**真插值**，只能插入服务端准备好的两种值：

- `data.*` → 已经过 `escapeForJS()`，用于 `<script>` 里
- `h.*` → 已经过 `escapeHtml()`，用于 HTML 文本/属性

不要直接把 `request.cf.*` 或用户输入插进 HTML 模板。

### 4.3 DOM 契约

**既有 id 不允许改名或删除**（前端逻辑、分享链接、`updateUI` 的 id→i18n 映射都依赖它们）。需要调整结构时：

- ✅ 新增包裹层、新增 id（例如 `#toolModalSide`、`#toolModalParams`）
- ✅ 用 CSS 重排、改样式
- ❌ 重命名 `#toolModalBody`、`#toolGrid`、`#speed-history-panel`、`#qmOut`、`#bbResult`、`#qcResult` 等

| 区域 | 关键 id |
|---|---|
| 概览 | `v4` `v6` `rtt-num` `jitter-val` `min-rtt` `max-rtt` `chart` `quality-badge` `stability-badge` `sample-count` `loss-rate` |
| 网络信息 | `s-dc` `s-risk` `proto-val` `ech-val` `compress-val` `http2-val` `bot-score-val` `user-geo-info` `hw-info` |
| 工具区 / 弹层 | `toolGrid` `toolModal` `toolModalTitle` `toolModalDesc` `toolModalBody` `toolModalSide` `toolModalParams` `toolModalSideActions` `toolModalRerun` `toolModalClose` |
| 结果容器 | `toolModalBody`（默认）、`qmOut`、`bbResult`、`qcResult`、`msOut`、`dcOut`、`dnsLookupOut`、`dnsblOut`、`monOut` |
| 历史页 | `speed-history-panel`、`usage-stats-panel` |
| i18n 文本 | 统一前缀 `t-*`（由 `updateUI()` 的映射表驱动） |

新增 id 请遵循：`t-xxx` 表示可国际化文本节点，其余用语义化 kebab-case。

### 4.4 新增一个诊断工具的标准流程

1. **判断归属分组**：`quality`（质量与延迟） / `bandwidth`（带宽与吞吐） / `dns` / `security`（安全与合规） / `reach`（可达性与多节点） / `monitor`（监控与系统）。
2. **三语加键**：`xxxBtn`（名称）、`toolDesc.xxx`（说明，会作为卡片 tooltip），以及结果区需要的文案。
3. **登记工具表**：在 `TOOL_LIST` 加 `{ key, group, icon, nameKey }`（图标用 Font Awesome 6 类名）。
4. **注册 runner**：在 `TOOL_RUNNERS` 加 `xxx: runXxxTool`。
5. **实现 `runXxxTool()`**：`setToolParams(...)` 渲染左栏参数（无参数则留空）、`setToolActions(primaryAction(...))` 渲染主操作按钮，右栏只放输出容器。
6. **实现执行逻辑**：优先纯浏览器实现；必须访问同源端点时确认它已接入令牌校验与限流。
7. **可选**：用 `adviceBlock(findings)` 输出"可能原因 + 建议"（需在 `i18n.<lang>.advice` 里补规则），用 `pushLocalHistory(...)` 记录一条本地历史。
8. **自测**：见第 5 节矩阵 + 手机宽度 + 三语。

完整骨架见 [附录 A](#附录-a新增一个诊断工具的骨架)。

### 4.5 新增一个 API 端点的标准流程

1. **先论证必要性**：能否用浏览器侧完成？能否复用现有端点（例如探活复用 `/node-ping`）？
2. **默认安全**：必须调用 `isSameOriginNavigation(request)`（除非是像 `/node-ping` 那样经过讨论的匿名端点）。
3. **接入限流**：走默认桶即可；若是高成本端点（大响应、CPU 密集、外部请求），申请独立桶。
4. **登记统计**：如需要计入用量统计，加入 `COUNTED_ENDPOINTS`。
5. **出站目标校验**：协议 → `isPrivateHost()` → `isAllowedTargetPort()` → `resolvesToPublicOnly()`，重定向**每一跳**都校验。
6. **限制输入**：参数用正则白名单校验，长度上限明确（参考：域名 ≤253、URL ≤300、请求体 ≤10KB/32MB）。
7. **返回统一形状**：成功返回 JSON；错误用 `{ error: 'machine_readable_code' }` + 恰当状态码（400/403/404/410/429/503），并带上 `...corsHeaders(request), ...SECURITY_HEADERS`。
8. **三语错误文案**：前端按 `error` 码映射到 i18n（不要直接展示英文错误）。
9. **文档**：更新 README 的端点表（方法、参数、说明、限制）。

完整骨架见 [附录 B](#附录-b新增一个-api-端点的骨架)。

### 4.6 停用端点与开关

已停用并统一返回 **410 Gone** 的端点（`DISABLED_ENDPOINTS` / `DISABLED_PATH_PREFIXES`）：`/dns-proxy`、`/api/ip-fraud`、`/api/reach-check`、`/static/*`。

- **不要"顺手恢复"**：如需恢复请在 issue 中说明用途、成本与安全影响。
- 新增停用项只需把路径加进集合（实现代码保留），并在 README 标注状态。
- 停用判断在 `handleRequest()` 最前面短路，先于令牌、限流与统计——新端点若被停用，不应再产生任何副作用。

### 4.7 KV 写入要求

```js
// ✅ 唯一正确写法
const ok = await kvPut(SPEED_HISTORY, 'speed:history', JSON.stringify(arr), { expirationTtl: 86400 * 7 });
if (!ok) { /* 被预算拦截或写入失败：非关键路径可直接忽略 */ }

// ❌ 禁止
await SPEED_HISTORY.put('speed:' + ts, json);          // 绕过闸门
const keys = await SPEED_HISTORY.list({ prefix: 'x' }); // list 按量计费
await SPEED_HISTORY.delete(k.name);                     // 批量 delete 同理
```

要求：

- 单键优先：用**一个键存数组/对象**（环形缓冲），不要"一条记录一个键"。
- 必带节流：按客户端 + 全局双层（参考测速历史：15s/客户端 + 30 次/分/isolate）。
- PR 中给出**最坏情况估算**：`写入次数/天 = ？`、`读取次数/天 = ？`、`单键体积 ≈ ？`。
- 读取侧要有内存缓存（参考 `statsCache` 60s）或明确说明为什么不需要。
- 新增 KV 键请在 README 或代码注释里登记用途与 TTL。

### 4.8 国际化与本地化

- **三语必须齐全**：`en` / `zh-CN` / `zh-TW`。评审会直接因此打回。
- 术语以 [CODE_OF_CONDUCT.md 附录 A](CODE_OF_CONDUCT.md#附录-a术语表三语对照) 为准；需要新增术语时**同时更新那张表**。
- 繁体中文用台湾/香港通行写法（網路、連線、資料、設定），不要简繁直接转码。
- 不要硬编码语言、时区、日期格式：时间用 `Intl` / `toLocaleString(locale)`。
- 动态拼接的句子注意语序差异：能用"标签 + 值"的行结构就别拼整句。
- 新增 `advice` 规则时，三语都要写 `cause` 与 `action`，否则该语言下建议区会静默缺失。

### 4.9 界面约定（4.7.1 起的布局）

| 约定 | 说明 |
|---|---|
| 工具区 | 6 个分组，组头 = 图标 + 分组名 + 数量；卡片为「图标 + 名称」，说明放 `title`（tooltip） |
| 结果弹层 | 宽屏两栏：左 `#toolModalParams`（参数）+ `#toolModalSideActions`（操作），右 `#toolModalBody`（结果）；≤860px 折叠为单栏 |
| 按钮三级 | 主 `.btn.btn-primary`（执行/保存）、次 `.btn`（重跑/停止/复制）、幽灵 `.btn.btn-ghost`（关闭/次要链接） |
| 尺寸 | `.btn-sm` / `.btn-xs` / `.btn-icon` / `.btn-block`；不要新造一套按钮样式 |
| 结果渲染 | 用 `rowItem()` / `metricCard()` / `metricGrid()` / `resultTitle()`；所有插值必须 `escapeHTML()` |
| 颜色 | 只用 CSS 变量（`var(--success)` 等），不要写死颜色，否则浅色主题会崩 |
| 空态 | 用 `.no-data`；加载态用 `<span class="loading">`；错误态用 `.tool-error` |

---

## 5. 测试清单（提交前必过）

本项目**没有自动化测试**，回归靠手动清单。请在 PR 描述里贴出你实际验证过的项目（没验证的注明"未测"比假装测过更好）。

### 5.1 语法与静态检查

```bash
node --check _workers.js        # 语法（模板字符串转义错误会在这里暴露）
wrangler deploy --dry-run       # 打包与配置校验，不上线
```

### 5.2 工具回归矩阵（改动涉及哪块就测哪块）

| 分组 | 工具（23） | 备注 |
|---|---|---|
| 网络质量与延迟 | 一键体检 · 长时质量监控 · 丢包率 · TTFB 分析 · WebSocket · 代理/VPN 检测 · WebRTC 泄漏 | 一键体检会串跑多个子项，改动 `quickcheck` 相关代码务必整体跑一次 |
| 带宽与吞吐 | 带宽测速 · 多流并发测速 · 上传测速 · 缓冲膨胀 · 流式传输 · 并发测试 | 多流与缓冲膨胀会消耗真实流量（数十 MB 起），注意移动网络 |
| DNS | DNS 解析 · DNS 工具箱 · 多解析器对比 | 工具箱含"黑名单检测"子功能，两个按钮都要点一次 |
| 安全与合规 | 站点体检（含可选证书检查） · 域名安全体检 | 证书检查勾选后会多 1 次出站（crt.sh），注意测两种情况 |
| 可达性与多节点 | 流媒体连通性 · 网络可达性 · 多节点对比 | 后两者依赖外部网络环境，测不通时说明环境而非直接判失败 |
| 监控与系统 | 站点监控 · CPU 性能 | 监控需要 KV + `MONITOR_ADMIN_KEY`；无绑定时应给出明确提示而非报错 |

### 5.3 界面回归

- [ ] 桌面宽度（≥1200px）与手机宽度（≤480px）各看一遍
- [ ] 深色 / 浅色主题各看一遍（不要写死颜色）
- [ ] 三种语言各切一遍：分组名、按钮、结果标题、错误提示都在
- [ ] 弹层：参数在左、结果在右；≤860px 折叠为单栏且参数区可正常输入
- [ ] 长结果（如体检报告）在右栏可独立滚动，不会把左栏顶掉
- [ ] 键盘可达：Tab 能到主操作按钮，回车能提交表单

### 5.4 安全与配额回归（改了这些才需要）

- [ ] 未带令牌访问受保护端点 → 403（且不是 200）
- [ ] 停用端点 → 410
- [ ] 超限 → 429，且不产生副作用
- [ ] 内网/本机/超范围端口目标 → 403/400（`isPrivateHost` / `isAllowedTargetPort` 生效）
- [ ] 大体积请求 → 413（上传 >32MB、`/api/log-speed` >10KB）
- [ ] `/health` 的 `kvWrite.blocked` 没有异常增长

### 5.5 费用自查（在 PR 里贴出）

```
改动引入的额外请求：__ 次/用户操作
最坏情况（单 IP 每分钟 / 单 isolate 每天）：
  Worker 请求：__
  KV 写入：__      （闸门上限：20/min、600/day/isolate）
  KV 读取：__
  出站请求（Worker→第三方）：__（若为 0 请注明）
可观测性事件估算：__（本项目对事件量敏感）
```

---

## 6. 提交与 PR

### 6.1 分支与提交信息

- 分支名：`feat/xxx`、`fix/xxx`、`i18n/xxx`、`docs/xxx`、`perf/xxx`、`security/xxx`
- 提交前缀（便于生成变更日志）：

```
feat(tools): 新增「端口连通性」工具（浏览器侧）
fix(health): 令牌失效时前端未重载导致 RTT 停摆
perf(kv): 测速历史改单键环形缓冲，去掉 list/delete
security(ssrf): 站点体检重定向逐跳校验端口
i18n(zh-TW): 统一「連線」用词
docs(readme): 端点表补充 410 停用说明
```

- 提交信息用**祈使句**，说明"做了什么"；**为什么**写在正文里。

### 6.2 PR 模板（建议放进 `.github/PULL_REQUEST_TEMPLATE.md`）

```markdown
## 改了什么
<!-- 一句话；若是修 bug，请写根因 -->

## 为什么这样改
<!-- 涉及取舍时说明：为什么不能用更简单的做法 -->

## 验证方式
- [ ] `node --check _workers.js`
- [ ] `wrangler deploy --dry-run`
- [ ] 手动回归（列出你实际点过的工具）：
- [ ] 手机宽度 / 三语 / 深浅色

## 成本与安全影响
- 新增出站请求：0 / 有（说明开关与默认值）
- 新增 KV 读写：无 / 有（贴出 §5.5 的估算）
- 是否触及安全默认值：否 / 是（说明并附 issue 链接）

## 截图
<!-- 界面改动请附改动前后 + 手机宽度 -->

## 关联 issue
Closes #
```

### 6.3 截图与录屏

- 界面改动：**改动前 / 改动后**各一张，桌面 + 手机宽度各一组。
- 截图必须**脱敏**（IP、RAY ID、Webhook 地址、密钥、Cookie），见 [CoC §4.3](CODE_OF_CONDUCT.md#43-贴日志与数据的脱敏要求)。
- 动画/交互改动优先录屏（GIF/MP4），比静态图更省 review 时间。

### 6.4 署名与许可

- 本项目**不使用 CLA**，也不要求版权转让；提交被合并即视为同意以 **AGPL-3.0** 授权（inbound = outbound）。详见 [CoC §13.2](CODE_OF_CONDUCT.md#132-贡献的许可inbound--outbound)。
- 欢迎（非强制）在提交信息里加 `Signed-off-by: 你的名字 <邮箱>`，便于追溯。
- 不要提交你无权授权的代码；引用第三方片段请注明出处与许可。

### 6.5 Review 流程与响应预期

| 阶段 | 预期 |
|---|---|
| 首次回应 | 约 3–7 天（个人维护，尽力而为） |
| 常见打回原因 | 一次改了太多事 / 三语缺项 / 动了安全默认值 / 无法验证 / 引入未讨论的依赖或外链 |
| 被要求修改 | 直接在同一分支追加提交即可，无需重开 PR |
| PR 被关闭 | 通常会说明原因；可拆成更小 PR 再提，或先开 issue 讨论方案 |

催办请礼貌地在原 PR 追加一次评论；不要连发、不要 @ 多人、不要跨 issue 重复粘贴（见 [CoC §4.5](CODE_OF_CONDUCT.md#45-响应预期非-sla)）。

### 6.6 好消息：适合上手的改动

- 文案与术语统一（三语）、错别字
- 移动端布局细节（表格溢出、按钮换行）
- 错误提示的可读性（把机器码换成用户能懂的话 + 建议动作）
- 新增 `advice` 规则（针对某个已知问题给出"原因 + 建议"）
- 端点表 / README 的准确性修正

---

## 7. 版本与发布（维护者）

### 7.1 版本号必须同步的 4 个位置

改版本号时**四处一起改**，漏掉会导致缓存或版本识别不一致：

1. 文件头部注释：`// 版本: x.y.z | 变更摘要`
2. `const ASSET_VER = 'x.y.z';`（前端资源缓存键）
3. `/health` 返回的 `version`
4. `/node-ping` 返回的 `version`

> 只改前端资源时才必须动 `ASSET_VER`；纯 Worker 逻辑改动可只改其余三处——但保持同步更省心。

### 7.2 发布检查清单

- [ ] `node --check _workers.js`
- [ ] `wrangler deploy --dry-run` 通过
- [ ] 分阶段部署或先在 `wrangler dev` 验证
- [ ] 部署后访问 `/health` 确认 `version` 已更新、`kvWrite.today` 正常
- [ ] 抽查至少 3 个工具（含一个带参数工具）与一次语言切换
- [ ] 若改了前端资源，确认 `ASSET_VER` 已递增（否则老客户端会拿缓存）
- [ ] 更新 README 端点表与 CHANGELOG/Release Notes

### 7.3 配额与费用巡检

- Cloudflare 面板关注：**KV 写入/删除/列出**、**请求数**、**可观测性事件量**、CPU 时间。
- 本项目设计上应接近"零 list、零 delete"（历史遗留的 `speed:<ts>` 键带 7 天 TTL，会自行过期）。
- 若 `kvWrite.blocked` 持续增长，说明有异常写入源被闸门拦下——先查原因再决定是否放宽阈值。
- 免费额度下 KV 写入为 1000/天，闸门默认 600/天/isolate，留有余量；付费环境下也可据此控成本。

---

## 8. 文档与翻译贡献

- 改代码时顺手更新文档：端点表、限额、开关状态、新增的 i18n 键。
- 文档三语策略：**README 与本文档以中文为主**（附英文摘要）；界面文案必须三语齐全。
- 代码注释保持中文，说明取舍原因；不要在注释里写"以后可能支持 X"这类无主承诺。
- 新增术语请同时更新 [CoC 附录 A 术语表](CODE_OF_CONDUCT.md#附录-a术语表三语对照)。

---

## 9. 有问题去哪里问

| 类型 | 渠道 |
|---|---|
| 使用问题 / 报 bug | GitHub Issues（按模板，附环境与脱敏证据） |
| 功能建议 | GitHub Issues / Discussions（先描述场景与期望） |
| 安全漏洞 | 私密报告（[SECURITY.md](SECURITY.md)、[CoC §8](CODE_OF_CONDUCT.md#8-安全漏洞与敏感数据上报)） |
| 行为问题 | [CoC §9](CODE_OF_CONDUCT.md#9-举报渠道与保密) 的渠道 |
| 部署踩坑 | Issues，标注托管方式与 `wrangler.toml` 关键片段（**去掉 id 与密钥**） |

---

## 附录 A：新增一个诊断工具的骨架

以下骨架可直接复制修改（注意 [4.2 转义规则](#42-app_js-模板字符串的三个转义陷阱)：`\``、`\${`、`\\d`）。

```js
// ① TOOL_GROUPS 已有分组；② TOOL_LIST 中登记
{ key: 'mycheck', group: 'quality', icon: 'fa-satellite-dish', nameKey: 'mycheckBtn' },

// ③ TOOL_RUNNERS 注册
mycheck: runMyCheckTool,

// ④ 左栏：参数 + 主操作；右栏：输出容器
function runMyCheckTool() {
    const t = i18n[currentLang];
    const body = document.getElementById('toolModalBody');
    if (!body) return;
    setToolParams(
        '<input type="text" id="myHost" class="tool-input" placeholder="example.com" autocomplete="off">' +
        '<div class="side-desc" style="margin:0">' + escapeHTML(t.mycheckNote) + '</div>');
    setToolActions(primaryAction('myGo', 'fa-play', t.mycheckStart));
    body.innerHTML = '<div id="myOut"><div class="no-data">' + escapeHTML(t.mycheckIntro) + '</div></div>';
    const go = document.getElementById('myGo');
    if (go) go.addEventListener('click', startMyCheck);
}

// ⑤ 执行 + 渲染结果
let myCheckRunning = false;
async function startMyCheck() {
    if (myCheckRunning) return;
    myCheckRunning = true;
    const t = i18n[currentLang];
    const out = document.getElementById('myOut');
    if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
    const findings = [];
    try {
        // 优先纯浏览器实现；必须同源时才 fetch('/api/...')
        const value = 42;
        if (out) out.innerHTML = resultTitle(t.mycheckBtn) + metricGrid([
            metricCard(t.latency, value, 'ms', value < 100 ? 'ok' : 'warn', value)
        ]) + adviceBlock(findings);
        pushLocalHistory({ type: 'mycheck', label: t.mycheckBtn, value: value, unit: ' ms', tone: 'ok' });
    } catch (e) {
        if (out) out.innerHTML = '<div class="tool-error"><i class="fas fa-exclamation-triangle"></i> ' + escapeHTML(t.loadFailed) + '</div>';
    }
    myCheckRunning = false;
}
```

配套 i18n（三语都要加）：

```js
mycheckBtn: '我的检测',
mycheckIntro: '一句话说明这个工具做什么。',
mycheckNote: '成本提示：会消耗多少流量 / 会不会读写 KV。',
mycheckStart: '开始检测',
```

> 若需要"原因 + 建议"，在 `i18n.<lang>.advice` 里加 `{ cause, action }`，然后在 `findings` 里 push 对应 code。

---

## 附录 B：新增一个 API 端点的骨架

```js
// ==================== 我的端点 ====================
if (url.pathname === '/api/my-endpoint') {
  // ① 默认要令牌
  if (!isSameOriginNavigation(request)) return forbiddenResponse(request);

  // ② 输入校验（白名单 + 长度上限）
  const name = (url.searchParams.get('name') || '').trim().toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_.-]{0,251}$/.test(name)) {
    return new Response(JSON.stringify({ error: 'invalid_name' }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ③ 若需要出站：协议 → 私网 → 端口 → 公网解析，且重定向逐跳复检
  //    const p = new URL(target);
  //    if (!['http:', 'https:'].includes(p.protocol) || isPrivateHost(p.hostname) ||
  //        !isAllowedTargetPort(p) || !(await resolvesToPublicOnly(p.hostname))) { ...403... }

  // ④ 内存缓存（降低重复请求与 KV 读取）
  const cacheKey = 'my:' + name;
  const hit = myCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60000) {
    return new Response(JSON.stringify(hit.data), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ⑤ 结果 + 缓存 + 统一错误码
  const payload = { ok: true, name: name };
  if (myCache.size > 200) myCache.clear();
  myCache.set(cacheKey, { at: Date.now(), data: payload });
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
  });
}
```

新增端点检查项：

- [ ] 令牌校验（或已在 issue 中说明为何匿名，且响应极小无敏感信息）
- [ ] 限流：默认桶即可，高成本端点申请独立桶
- [ ] 输入白名单 + 长度上限
- [ ] 出站目标全链路校验（含重定向跳）
- [ ] 需要计入统计则加入 `COUNTED_ENDPOINTS`
- [ ] 错误码机器可读，前端三语映射
- [ ] README 端点表已更新
- [ ] 若成本高，考虑加入 `DISABLED_ENDPOINTS` 的可停用设计

---

## 附录 C：一页速查（提交前 30 秒）

- [ ] 只做了一件事；需要先讨论的改动已有 issue 共识
- [ ] `node --check _workers.js` 通过（转义陷阱已避开）
- [ ] `wrangler deploy --dry-run` 通过
- [ ] 三语文案齐全；术语与术语表一致；没有硬编码语言/时区
- [ ] 既有 DOM id 未被改名；新增 id 命名规范
- [ ] 按钮用三级体系；颜色用 CSS 变量；结果全部 `escapeHTML()`
- [ ] 若新增 KV 写入：走 `kvPut()`，无 `list`/`delete`，已贴最坏情况估算
- [ ] 若新增出站：默认关闭 + 缓存 + 超时 + 体积上限 + 端口/私网校验
- [ ] 没有放宽 CSP / 安全头 / 令牌 / 体积上限 / SSRF 防护
- [ ] 没有"顺手恢复"已停用端点
- [ ] 截图/日志已脱敏；PR 描述含根因与验证方式
- [ ] 许可：我可授权这些代码（AGPL-3.0，inbound = outbound）
