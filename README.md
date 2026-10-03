# NetSight Pro

> 单文件 Cloudflare Worker 网络诊断工具 · 灰度 HUD 界面 · 三语言 · 可视化结果
>
> A single-file Cloudflare Worker for network diagnostics · Grayscale HUD · Trilingual · Visualized results

![version](https://img.shields.io/badge/version-4.1--security-blue)
![platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)
![license](https://img.shields.io/badge/license-AGPL--3.0-green)
![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20%E7%AE%80%E4%BD%93%20%7C%20%E7%B9%81%E9%AB%94-lightgrey)

NetSight Pro 是一个部署在 Cloudflare Workers 上的**整站网络诊断工具**。它把「我这条链路到 Cloudflare 边缘」以及「任意站点」的可观测数据一次性摊开：IP、边缘节点、TLS/协议指纹、实时 RTT、带宽、丢包、DNS、WebRTC 泄漏、HTTP 安全头审计等，并全部在浏览器端实时计算与渲染。整个项目就是**一个 Worker 脚本**——HTML/CSS/JS 全部内联，无需构建、无需依赖、无需前端工程。

NetSight Pro is an all-in-one **network diagnostics tool** that runs on Cloudflare Workers. It surfaces everything observable about "my path to the Cloudflare edge" and "any third-party site": IP, edge colo, TLS/protocol fingerprints, live RTT, bandwidth, packet loss, DNS, WebRTC leaks, HTTP security-header audit, and more — all computed and rendered client-side. The whole project is **a single Worker script** with the HTML/CSS/JS inlined: no build step, no dependencies, no frontend toolchain.

- **版本 / Version**：`4.1-security`（在本仓库基础上做了界面重做与稳定性/安全加固）
- **运行平台 / Runtime**：Cloudflare Workers（V8, ES2020）
- **存储 / Storage**：KV（绑定 `SPEED_HISTORY`，用于测速历史与用量统计）
- **上游 / Upstream**：基于 [`BlueDriftHK/CF-workers-netdiag`](https://github.com/BlueDriftHK/CF-workers-netdiag) 的增强版

---

## 📋 目录 · Table of Contents

- [✨ 特性总览 · Features](#-特性总览--features)
- [🎨 界面 · UI](#-界面--ui)
- [🧱 技术架构 · Architecture](#-技术架构--architecture)
- [🚀 快速部署 · Quick Deploy](#-快速部署--quick-deploy)
- [🛠️ 详细部署 · Detailed Deployment](#️-详细部署--detailed-deployment)
- [⚙️ 绑定与变量 · Bindings & Vars](#️-绑定与变量--bindings--vars)
- [📌 API 端点 · Endpoints](#-api-端点--endpoints)
- [🖱️ 前端功能与工具 · Frontend & Tools](#️-前端功能与工具--frontend--tools)
- [🔒 安全机制 · Security](#-安全机制--security)
- [🌐 国际化与主题 · i18n & Theme](#-国际化与主题--i18n--theme)
- [⚡ 性能与可靠性 · Performance](#-性能与可靠性--performance)
- [🔀 相较上游的改动 · Changes vs Upstream](#-相较上游的改动--changes-vs-upstream)
- [🛠️ 自定义与扩展 · Customization](#️-自定义与扩展--customization)
- [❓ 常见问题 · FAQ](#-常见问题--faq)
- [📄 许可证与贡献 · License & Contributing](#-许可证与贡献--license--contributing)

---

## ✨ 特性总览 · Features

| 类别 Category | 功能 Feature | 描述 Description |
| --- | --- | --- |
| 📡 网络质量 Quality | 实时 RTT 监控 / Live RTT | 每 2s 探测一次，绘制延迟趋势图，计算抖动、最低/最高 RTT、丢包率 |
| | 下载测速 / Download speed | 多档位（100KB~2MB）下载，估算下行带宽 |
| | 上传测速 / Upload speed | 多档位（256KB~2MB）上传，估算上行带宽 |
| | 并发测试 / Concurrency | 4/6/8 路并发请求，观察多连接处理能力 |
| | 流式吞吐 / Stream | 分块流式下载，测试长连接持续吞吐 |
| | TTFB 分阶段 / TTFB phase | 拆解 DNS / TCP / TLS / 等待 / 下载各阶段耗时 |
| 🔒 协议与安全 Protocol | HTTP/2 · HTTP/3 | 判定 HTTP/2 或 QUIC，显示 ALPN |
| | TLS 信息 / TLS info | TLS 版本、加密套件、ECH 推断 |
| | 客户端指纹 / Fingerprints | JA3、JA4 指纹 |
| | Bot 评分 / Bot score | Cloudflare Bot Management 评分（0~100） |
| | 压缩 / Compression | 检测 br / gzip / deflate / zstd |
| | **站点体检 / Site Audit** | **审计任意站点的 HTTP 安全响应头与响应性能** |
| 🌍 IP 与位置 Location | 双栈 IP / Dual-stack | 多公共 API 备用获取 IPv4 / IPv6 |
| | 真实位置 / Geo | 客户端侧解析城市、国家、运营商 |
| | 距离 / Distance | 客户端到边缘节点的直线距离（Haversine） |
| | IP 风险评分 / IP risk | 代理 / VPN / 托管标记与风险等级 |
| 💻 客户端环境 Client | 硬件信息 / Hardware | 屏幕、CPU 核心数、时区、语言、平台 |
| | WebRTC 泄漏 / WebRTC leak | 检测内网/公网 IP 是否经 WebRTC 泄露 |
| | 流媒体连通 / Media | Netflix / Disney+ / YouTube / ChatGPT 可达性 |
| 📊 对比与历史 Compare | 多节点对比 / Multi-node | 输入多个节点 URL，并行测延迟并对比 |
| | 测速历史 / Speed history | 最近记录（需 KV），含时间、速度、边缘节点 |
| | 用量统计 / Usage stats | 各端点调用次数（需 KV） |
| 🎨 交互 UX | 一键报告 / Copy report | 生成纯文本诊断报告 |
| | 主题 / Theme | 深色 / 浅色 / 跟随系统 |
| | 语言 / Language | English / 简体中文 / 繁體中文，全量覆盖 |

---

## 🎨 界面 · UI

**灰度 HUD 风格**：近黑底 + 细网格背景 + 直角卡片 + 等宽数字；颜色只保留给状态语义——正常=白灰、警告=暗琥珀、异常=暗红，整体克制而"仪器化"。不再使用毛玻璃模糊与极光动画，渲染更轻、观感更专业。

**Grayscale HUD aesthetic**: near-black background with a subtle grid, square-cornered cards, monospaced numerals. Color is reserved for status only — neutral (white/gray) for normal, dark amber for warnings, dark red for errors. This keeps the panel restrained and instrument-like.

界面分为 **4 个标签页 / 4 tabs**：

- **概览 Overview**：IPv4/IPv6、边缘节点、Worker 耗时 + 实时 RTT 监控（图表 + 质量/稳定性/丢包/样本）
- **网络信息 Network**：TLS/协议/指纹/ECH/压缩/Bot、边缘位置与运营商、真实 IP 位置与风险、硬件信息
- **诊断工具 Tools**：13 张工具卡片网格
- **历史统计 History**：测速历史、用量统计

诊断工具采用 **卡片网格 + 结果弹层**：点击卡片 → 弹出层内运行并展示结果，右上角带「重新运行」按钮，窄屏自动精简。结果用**指标卡 + 进度条 / 行列表**结构化呈现，而非一段裸文本。

---

## 🧱 技术架构 · Architecture

**后端 · Backend（Cloudflare Worker）**
- 运行时 Runtime：Cloudflare Workers（V8）
- 语言 Language：JavaScript（ES2020）
- 存储 Storage：可选 KV（`SPEED_HISTORY`、`CACHE_KV`）
- API 设计：RESTful，返回 JSON 或二进制流
- 并发控制 Concurrency：自定义 `pLimit`
- 限流 Rate limit：内存 Map（per-isolate）
- 安全头 Security headers：HSTS、X-Frame-Options、CSP(nonce)、CORS 白名单

**前端 · Frontend（原生 SPA）**
- 框架 Framework：纯原生 JS，无第三方框架（仅字体与图标库）
- 图表 Chart：Canvas 2D 实时折线
- WebSocket：`wss://` 双向通信测试
- 响应式 Responsive：CSS Grid + Flexbox
- 本地存储：`localStorage` 保存语言与主题偏好

**外部依赖 · External deps**：IP 查询（`ipapi.co`）、IP 探测（`ipify` / `icanhazip` / `seeip`）、IP 风险（`ip-api.com`）、字体 Google Fonts（Inter）、图标 Font Awesome 6。

---

## 🚀 快速部署 · Quick Deploy

```bash
# 1) 获取代码
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

# 2) 安装 Wrangler
npm install -g wrangler

# 3) 登录 Cloudflare
wrangler login

# 4) 创建 KV（可选但推荐）
wrangler kv:namespace create "SPEED_HISTORY"

# 5) 在 wrangler.toml 填入 KV id 与 account_id

# 6) 发布
wrangler deploy
```

访问 Worker 分配的 `*.workers.dev` 域名即可使用。
Then open the assigned `*.workers.dev` URL.

---

## 🛠️ 详细部署 · Detailed Deployment

### 方式一 / Option A：Wrangler CLI（推荐 / Recommended）

**前置条件 Prerequisites**：Node.js 16+、Cloudflare 账号。
（可选）Cloudflare 付费计划，用于自定义域名与更大 KV 额度。

**Step 1 · 安装 Wrangler**
```bash
npm install -g wrangler
```

**Step 2 · 登录 Cloudflare**
```bash
wrangler login
```
浏览器会自动打开授权页面，点击允许。

**Step 3 · 创建 KV 命名空间**
```bash
wrangler kv:namespace create "SPEED_HISTORY"
```
输出形如：
```
✨ Success! Worker KV namespace created:
{ binding = "SPEED_HISTORY", id = "abc123def456" }
```
记下 `id`。若还想缓存静态资源，可再创建 `CACHE_KV`。

**Step 4 · 配置 `wrangler.toml`**
```toml
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "SPEED_HISTORY"
id = "abc123def456"

# 可选 optional
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "your-cache-kv-id"

[vars]
# 可选：跨域白名单（逗号分隔；含 * 表示允许全部）
ALLOWED_ORIGINS = "https://yourdomain.com"
```

**Step 5 · 发布并验证**
```bash
wrangler deploy
```
访问输出的 `*.workers.dev` 域名，看到主界面即成功。

### 方式二 / Option B：Cloudflare Dashboard

1. 登录 Dashboard → **Workers & Pages** → 创建 Worker。
2. 把本项目的 Worker 脚本完整粘贴进在线编辑器。
3. **设置 → 变量 / Settings → Bindings** 添加 KV Namespace：
   - 名称 Name：`SPEED_HISTORY`
   - 值 Value：选择你的 KV 命名空间
4. 可选添加 `CACHE_KV` 与 `ALLOWED_ORIGINS`。
5. 保存并部署。

> 注意：Dashboard 方式不支持本地调试与热更新，适合快速测试。若 Worker 允许访问 Dashboard，请务必把同名变量名与代码一致（区分大小写）。

---

## ⚙️ 绑定与变量 · Bindings & Vars

| 名称 Name | 类型 Type | 必填 Required | 描述 Description |
| --- | --- | --- | --- |
| `SPEED_HISTORY` | KV Namespace | 否 No | 测速历史 + 用量统计。未绑定时相关功能优雅降级为"暂无记录"，**不影响其它功能** |
| `CACHE_KV` | KV Namespace | 否 No | `/static/*` 静态资源读取；未绑定时回退到 Cache API |
| `ALLOWED_ORIGINS` | 环境变量 Var | 否 No | 跨域来源白名单（逗号分隔）。未设置时仅允许同源；含 `*` 允许全部 |

> 所有绑定都是**软依赖**：代码用 `typeof X !== 'undefined'` 判断，未绑定也能完整运行。
> All bindings are **soft dependencies** — the script degrades gracefully when absent.

---

## 📌 API 端点 · Endpoints

| 端点 Endpoint | 方法 Method | 参数 Params | 说明 Description | 限制 Limit |
| --- | --- | --- | --- | --- |
| `/` | GET | — | 主诊断页 | — |
| `/health` | GET | — | 健康检查 | — |
| `/static/*` | GET | — | 静态资源（CDN 缓存 / CACHE_KV） | — |
| `/speedtest` | GET | `size` | 下载测速（随机字节） | 1..2,097,152（默认 100KB） |
| `/upload-test` | POST | body | 上传测速 | body ≤ 5MB |
| `/cpu-test` | GET | `n` | CPU 基准测试 | 1..20,000；限流 3/分钟 |
| `/dns-proxy` | GET | `url` | HEAD 探测 | 仅 http/https + 域名白名单 |
| `/ws-test` | GET | — | WebSocket 往返延迟 | Upgrade 头；消息 ≤ 4KB |
| `/http2-test` | GET | — | HTTP/2·3 / TLS / ALPN | — |
| `/concurrent-test` | GET | `count`,`size` | 并发下载 | count 1..16；size 1..65536 |
| `/stream-test` | GET | `size` | 流式传输 | 1..5,242,880 |
| `/api/log-speed` | POST | `{avgSpeed,results}` | 记录测速到 KV | body ≤ 10KB |
| `/api/speed-history` | GET | `limit` | 查询测速历史 | limit 1..20 |
| `/api/usage-stats` | GET | — | 查询用量统计 | — |
| `/api/ip-fraud` | GET | — | IP 风险评分 | 依赖第三方接口 |
| `/api/site-audit` | GET | `url` | 站点体检（安全头审计） | 仅公网 http/https |
| `/*` | OPTIONS | — | CORS 预检 | 含 CORS 头 |

除主页面与 `/static/*` 外，所有端点受基础限流（默认 **60 次/分钟/IP**）保护。所有响应均携带安全头，敏感端点实施同源保护。

---

## 🖱️ 前端功能与工具 · Frontend & Tools

### 实时 RTT 监控 / Live RTT
每 2s 向 `/health` 发一次 HEAD 请求（带缓存破坏参数），计算往返时间；保留最近 40 个样本绘制折线图。派生指标：抖动（移动平均窗口 10）、最低/最高 RTT、丢包率、质量等级（Excellent/Good/Fair/Poor/Very Poor）、稳定性等级。

### 13 个诊断工具 / 13 tools

| 工具 Tool | 测试内容 What it does |
| --- | --- |
| 丢包率 Packet Loss | 连续 10 次探测，统计失败率 |
| 带宽测速 Bandwidth | 依次下载多档位，算各档与平均 Mbps |
| DNS 解析 DNS | 加载 favicon 测解析耗时 |
| CPU 性能 CPU | Worker 端计算基准（ops/ms） |
| WebSocket | 建连后 5 次 ping/pong，算平均/最小/最大延迟 |
| 并发测试 Concurrency | 4/6/8 路并发，观测平均耗时 |
| 流式传输 Stream | 分块流式读取，算持续吞吐 |
| 流媒体连通 Media | Netflix/Disney+/YouTube/ChatGPT 可达性 |
| 多节点对比 Multi-node | 输入多节点 URL，并行测延迟 |
| WebRTC 泄漏 Leak | 收集 ICE 候选，判断内网/公网 IP 泄露 |
| TTFB 分析 | PerformanceObserver 拆解各阶段耗时 |
| 上传测速 Upload | 多档位上传，算各档与平均 Mbps |
| **站点体检 Audit** | **输入 URL，审计其 HTTP 安全响应头 + 响应性能** |

### 站点体检 · Site Audit
输入任意公网 URL，由 Worker 端发起请求并审计：
- 指标：状态码、首字节（TTFB）、总耗时、重定向次数
- 跟随重定向后的最终地址
- 安全响应头清单：`Strict-Transport-Security` / `Content-Security-Policy` / `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy`（有值显值，缺失标黄）

> 说明：Workers `fetch` 无法获取任意目标的 TLS 证书信息，因此体检覆盖 **HTTP 层**，不含证书链审计。

### 报告 / Report
点击「复制报告」生成纯文本报告：诊断时间、边缘节点、客户端 IP、RAY ID、RTT/抖动/丢包、协议/TLS/加密套件/指纹/评分、位置与 ISP、IP 风险信息等。

---

## 🔒 安全机制 · Security

1. **CSP（随机 nonce）**：`script-src` 仅 `'self' + 'nonce-<random>'`，页面内联脚本携带该 nonce；未使用 `'unsafe-inline'` 放行脚本。
2. **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、HSTS、`Permissions-Policy`。
3. **同源校验**：写操作与敏感读取端点（含 `/api/speed-history`、`/api/usage-stats`、`/api/ip-fraud`、`/http2-test`、`/api/site-audit`）校验 `Origin`/`Referer`；同源放行、无头放行、跨域拒绝。
4. **SSRF 防护**（`/dns-proxy`、`/api/site-audit`）：协议白名单 + 域名白名单 / 私网与保留地址拦截 + 重定向跳数上限 + 超时 + 只读响应头。
5. **转义分层**：HTML 上下文 `escapeHtml`，JS 字符串上下文 `escapeForJS`，客户端渲染统一 `escapeHTML`。
6. **输入约束**：所有数值参数经 `clampInt` / `safeNumber` 收敛；请求体大小限制。
7. **资源保护**：CPU 迭代上限压到免费计划预算内；下载/上传/流式端点体积上限；通用限流 60/分钟 + CPU 端点 3/分钟。

> English: CSP with random nonce (no unsafe-inline for scripts), strict security headers, same-origin checks on sensitive endpoints, SSRF guards on URL-accepting endpoints, layered escaping for HTML vs JS contexts, clamped numeric inputs, and resource caps (CPU iterations, transfer sizes) to survive the free-plan limits.

---

## 🌐 国际化与主题 · i18n & Theme

**语言 / Languages**：English (en)、简体中文 (zh-CN)、繁體中文 (zh-TW)。三个语言包**键集合完全一致**（各 160+ 键），切换时即时更新所有静态与动态内容（含已打开的结果弹层——会按新语言重跑）。语言偏好持久化到 `localStorage`（`pref-lang`），并按 `Accept-Language` 自动初选。通用缩写与单位（IPv4/TLS/ASN/JA3/JA4/ECH/ms/Mbps/KB 等）跨语言一致，不做翻译。

**主题 / Theme**：深色 / 浅色 / 跟随系统。通过 CSS 变量与 `data-theme` 属性控制，切换按钮循环切换，偏好保存到 `localStorage`。

---

## ⚡ 性能与可靠性 · Performance

- **缓存**：静态资源缓存 1 天并支持 KV；主页面 `no-store`；测速端点均 `no-store`。
- **高效随机数据**：`crypto.getRandomValues` 分块（64KB）填充；流式传输用 `ReadableStream` 逐块生成，内存友好。
- **不阻塞渲染**：主页面不做同步外呼——客户端地理信息由前端**异步**获取，避免第三方接口拖慢首屏。
- **并发控制**：`pLimit` 限制并发数，避免资源耗尽。
- **内存管理**：限流 Map 定期清理；KV 记录带 TTL（测速历史 7 天、用量统计 30 天）。
- **降级**：KV 未绑定或外部接口失败时给出友好提示，不抛异常。

---

## 🔀 相较上游的改动 · Changes vs Upstream

> 本仓库在上游 `CF-workers-netdiag` 基础上做了界面重做与稳定性/安全加固。This fork reworked the UI and hardened reliability/security on top of the upstream project.

- **界面**：极光毛玻璃 → **灰度 HUD + 网格背景**；单页长滚动 → **4 个标签页**。
- **工具交互**：12 个按钮堆叠 → **13 张卡片网格 + 结果弹层**（指标卡/进度条 + 「重新运行」）。
- **新增**：**站点体检**（HTTP 安全头审计端点 `/api/site-audit`）。
- **稳定性**：`/cpu-test` 迭代上限下调至免费计划 CPU 预算内（避免 1102 超时）；带宽端点体积上限收敛；移除主页阻塞式服务端地理查询。
- **安全**：CSP `script-src` 收紧为 `'self' + nonce`；补齐多个 API 端点的同源校验；新增 SSRF 防护；新增 `Permissions-Policy`；HTML/JS 转义彻底分离；修复 WebRTC IP 匹配正则的模板字符串转义 bug。
- **i18n**：三语言全量对齐并覆盖所有动态内容。

---

## 🛠️ 自定义与扩展 · Customization

**加一个诊断工具**：在客户端 `TOOL_LIST` 增加一项（`key / icon / nameKey`），在 `TOOL_RUNNERS` 注册对应函数，结果用 `metricCard()` / `resultTitle()` / `result-rows` 渲染；如需要输入，参考「站点体检」的 `runSiteAudit()`。三语言需在 `i18n` 与 `toolDesc` 中补齐。

**加一个后端端点**：在 `handleRequest` 主流程添加 `if (url.pathname === '/your-endpoint')` 分支，并沿用相同的安全措施（CORS、限流、同源检查、输入收敛）。

**改配色 / 改主题**：只改 `:root` 与 `[data-theme="light"]` 的 CSS 变量即可全局换色。

**改文案**：编辑客户端 `i18n` 对象（三语言同步）。界面文本 ID 以 `t-` 开头，对应 `updateUI` 里的映射表。

> ⚠️ **踩坑提醒 · Pitfall**：内嵌客户端代码里的正则反斜杠必须写**双份**（如 `/^https?:\/\//`），否则会被外层模板字符串"吃掉"，导致客户端脚本解析失败。改动客户端正则后，务必验证渲染出的 `<script>` 能被解析（`node --check` 只校验 Worker 本身，不会校验内嵌脚本）。

---

## ❓ 常见问题 · FAQ

**Q：部署后页面空白 / 加载失败？**
A：检查 Worker 日志（Dashboard → Workers → 选择 Worker → 日志），确认代码完整粘贴、无语法错误。

**Q：测速历史显示「暂无记录」？**
A：确认已绑定 `SPEED_HISTORY` KV，且绑定名与代码完全一致（区分大小写）。首次测速后刷新即可。

**Q：WebSocket / 部分测试失败？**
A：检查浏览器是否支持 WebSocket，某些企业网络或插件会拦截；可尝试无痕模式。

**Q：IP 风险评分显示「获取失败」？**
A：该评分依赖第三方免费接口（`ip-api.com`，免费版为 HTTP），可能受可用性波动影响。

**Q：主题 / 语言切换不生效？**
A：确认浏览器未禁用 `localStorage`；`data-theme` 与 `pref-lang` 是否正确写入。

**Q：如何限制仅自己使用？**
A：在 `ALLOWED_ORIGINS` 填入自己的域名；如需更强限制，可自行增加基于 `cf-connecting-ip` 的 IP 白名单。

**Q：CPU 压测报错 1102？**
A：免费计划单请求 CPU 时间有限，`/cpu-test` 迭代上限已刻意压低；如需更高可选付费计划。

**Q：报告能存成文件吗？**
A：复制报告后粘贴到文本编辑器另存为 `.md` / `.txt` 即可。

**Q：请求限额不够？**
A：Workers 免费计划每天约 10 万次请求，个人使用通常足够；可升级付费计划。

---

## 📄 许可证与贡献 · License & Contributing

本项目基于 **AGPL-3.0** 许可证开源，欢迎任何形式的贡献（Issue / PR / Star）。

- **作者 Author**：BlueDriftHK
- **上游仓库 Repository**：https://github.com/BlueDriftHK/CF-workers-netdiag
- **反馈 Feedback**：请提交 GitHub Issue

本项目为网络诊断用途。对目标站点发起探测前，请确保你**有权**对该目标进行测试，并遵守目标站点服务条款与所在地法律法规。
This tool is for network diagnostics. Ensure you are **authorized** to probe any target site and comply with the target's terms of service and applicable laws.

> NetSight Pro – 让网络诊断既克制又高效。 🌌
