# NetSight Pro

> 单文件 Cloudflare Worker 网络诊断平台 · 20 项诊断工具 · 三语言 · 可视化结果
>
> A single-file Cloudflare Worker for network diagnostics · 20 tools · Trilingual · Visualized results

![version](https://img.shields.io/badge/version-4.6.0-blue)
![platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)
![license](https://img.shields.io/badge/license-AGPL--3.0-green)
![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20%E7%AE%80%E4%BD%93%20%7C%20%E7%B9%81%E9%AB%94-lightgrey)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

NetSight Pro 是一个部署在 Cloudflare Workers 上的**整站网络诊断平台**。它把「我这条链路到 Cloudflare 边缘」以及「任意站点」的可观测数据一次性摊开：IP、边缘节点、TLS/协议指纹、实时 RTT、带宽、丢包、DNS、WebRTC 泄漏、域名邮件安全、站点安全响应头评分等，并全部在浏览器端实时计算与渲染。整个后端就是**一个 Worker 脚本**——无需构建、无需依赖。

NetSight Pro is an all-in-one **network diagnostics platform** that runs on Cloudflare Workers. It surfaces everything observable about "my path to the Cloudflare edge" and "any third-party site": IP, edge colo, TLS/protocol fingerprints, live RTT, bandwidth, packet loss, DNS, WebRTC leaks, domain email security, HTTP security-header scoring, and more — all computed and rendered client-side. The backend is **a single Worker script**: no build step, no dependencies.

- **版本 / Version**：`4.6.0`
- **运行平台 / Runtime**：Cloudflare Workers（V8, ES2020）
- **存储 / Storage**：**可选** KV（绑定 `SPEED_HISTORY`）。默认策略下**常规请求不读写 KV**，用量统计走内存；测速历史默认不落 KV。
- **规模 / Scale**：20 项诊断工具 · 3 种语言 · 40+ 项自动断言回归

---

## 📋 目录 · Table of Contents

- [✨ 特性总览 · Features](#-特性总览--features)
- [🎯 观测点与数据来源 · Vantage Points](#-观测点与数据来源--vantage-points)
- [🎨 界面 · UI](#-界面--ui)
- [🧱 技术架构 · Architecture](#-技术架构--architecture)
- [🚀 快速部署 · Quick Deploy](#-快速部署--quick-deploy)
- [🛠️ 详细部署 · Detailed Deployment](#️-详细部署--detailed-deployment)
- [⚙️ 绑定与变量 · Bindings & Vars](#️-绑定与变量--bindings--vars)
- [📌 API 端点 · Endpoints](#-api-端点--endpoints)
- [🖱️ 前端功能与工具 · Frontend & Tools](#️-前端功能与工具--frontend--tools)
- [🔒 安全机制 · Security](#-安全机制--security)
- [💾 KV 用量策略 · KV Budget](#-kv-用量策略--kv-budget)
- [🌐 国际化与主题 · i18n & Theme](#-国际化与主题--i18n--theme)
- [⚡ 性能与可靠性 · Performance](#-性能与可靠性--performance)
- [🔀 相较上游的改动 · Changes vs Upstream](#-相较上游的改动--changes-vs-upstream)
- [🛠️ 自定义与扩展 · Customization](#️-自定义与扩展--customization)
- [❓ 常见问题 · FAQ](#-常见问题--faq)
- [📝 版本记录 · Changelog](#-版本记录--changelog)
- [📄 许可证与贡献 · License & Contributing](#-许可证与贡献--license--contributing)

---

## ✨ 特性总览 · Features

| 类别 Category | 功能 Feature | 描述 Description |
| --- | --- | --- |
| 📡 网络质量 Quality | 实时 RTT 监控 / Live RTT | 每 2s 探测一次，绘制延迟趋势图，计算抖动、最低/最高 RTT、丢包率、质量与稳定性等级 |
| | 一键体检 / Quick check | 一键运行全部检测并生成评分报告 |
| | 下载测速 / Download speed | 多档位下载，估算下行带宽 |
| | 上传测速 / Upload speed | 多档位上传，估算上行带宽 |
| | 缓冲膨胀 / Bufferbloat | 负载下的延迟测试，A–F 评级 |
| | 并发测试 / Concurrency | 4/6/8 路并发请求，观察多连接处理能力 |
| | 流式吞吐 / Stream | 分块流式下载，测试长连接持续吞吐 |
| | TTFB 分阶段 / TTFB phase | 拆解各阶段耗时 |
| 🔒 协议与安全 Protocol | HTTP/2 · HTTP/3 | 判定 HTTP/2 或 QUIC 协议 |
| | TLS 信息 / TLS info | TLS 版本、加密套件、ECH 推断 |
| | 压缩 / Compression | 检测 br / gzip / deflate / zstd |
| | Bot 评分 / Bot score | Cloudflare Bot Management 评分 |
| | **站点安全评分 / Site audit** | **审计任意站点的 HTTP 安全响应头，给出 0–100 分与 A–F 评级 + 问题清单** |
| | WebRTC 泄漏 / WebRTC leak | 检测内网/公网 IP 是否经 WebRTC 泄露 |
| 🌍 IP 与位置 Location | 双栈 IP / Dual-stack | 多公共 API 备用获取 IPv4 / IPv6 |
| | 真实位置 / Geo | **直接使用 Cloudflare 边缘数据**（城市、地区、国家、运营商、客户端 IP），零出站请求 |
| | 距离 / Distance | 客户端到边缘节点的直线距离（Haversine） |
| | IP 风险评分 / IP risk | 代理 / VPN / TOR / 托管标记与风险等级（proxycheck.io，HTTPS） |
| 🌐 DNS 与域名 DNS | DNS 工具箱 / DNS toolbox | DoH 记录查询（A/AAAA/CNAME/MX/TXT/NS/SOA/CAA）+ IP 黑名单检测 |
| | 多解析器对比 / DNS compare | 并发查询 Cloudflare / Google / Quad9 / AliDNS 并比对一致性 |
| | 域名安全体检 / Domain check | MX / SPF / DMARC / DKIM 与域名声誉，评分 + 问题清单 |
| 🛰️ 网络探测 Probe | 网络可达性 / Reachability | **边缘侧与浏览器侧同时探测境内外站点，识别本地阻断** |
| | 多节点对比 / Multi-node | 输入多个节点 URL，并行测延迟并对比 |
| | 流媒体连通 / Media | Netflix / Disney+ / YouTube / ChatGPT 可达性 |
| 📊 运维 Ops | 站点监控 / Site monitor | 定时巡检（Cron），异常自动 Webhook 告警；**仅状态变化时写 KV** |
| | 测速历史 / Speed history | 最近记录（需 KV，默认关闭写入） |
| | 用量统计 / Usage stats | 各端点调用次数（默认内存，不写 KV） |
| 🎨 交互 UX | 一键报告 / Copy report | 生成纯文本诊断报告 |
| | 主题 / Theme | 深色 / 浅色 / 跟随系统 |
| | 语言 / Language | English / 简体中文 / 繁體中文，全量覆盖 |
| | PWA | 可安装到桌面 / 主屏，具备离线外壳 |

---

## 🎯 观测点与数据来源 · Vantage Points

**本工具以「用户端（你的浏览器 / 本机网络）」为第一观测视角。** 绝大多数测量都在你的浏览器里发起，反映的是**你的链路**；只有需要「公网视角」的检查才由 **Cloudflare 边缘**发起——它们描述的是**目标站点**或边缘侧能力，**不代表你的网络**。

> This tool is **client-first**: most measurements are initiated by your browser and describe **your own network**. Only checks that need a public vantage point are issued by the **Cloudflare edge** — they describe the **target site**, not your network.

| 观测点 Vantage | 工具 Tools | 说明 Description |
| --- | --- | --- |
| 🖥️ 你的浏览器 Your browser | 实时 RTT 监控、丢包率、带宽测速、上传测速、缓冲膨胀、DNS 解析、TTFB、WebRTC、多节点对比、流媒体连通、WebSocket、并发测试、流式传输、一键体检 | 从你的设备发起，反映你的链路质量 |
| 🛰️ 双侧对照 Both sides | 网络可达性 | 边缘侧与浏览器侧**同时**探测并对照，用于识别「本地被阻断」 |
| ☁️ Cloudflare 边缘 Edge | DNS 工具箱、多解析器对比、域名安全体检、站点安全评分、CPU 基准、站点监控 | 由边缘发起；描述**目标站点**或边缘侧能力 |

**判读建议**：判断「我的网络好不好」请以 **🖥️ 浏览器侧**数据为准；边缘侧结果仅作对照参考。

### 请求来源说明 · Who calls the Worker

| 来源 | 是否用户端 | 会产生什么 |
| --- | --- | --- |
| 你的浏览器 | ✅ 是 | 页面/资源加载、每 2s 的 `/health`（仅前台轮询）、点击工具时的 API 调用 |
| 第三方 / 爬虫 / 外部探针 | ❌ 否 | 可直接访问 `/` 与 `/health`（这两者不做同源校验）；敏感 API 会被同源校验拒绝（403） |
| Cloudflare Cron Triggers | ❌ 否 | 服务端定时触发 `scheduled` 处理器执行站点巡检（探测目标 + 发 Webhook），**不经过 fetch 处理器**，故不计入用量统计 |
| Worker 自己发起的出站请求 | ❌ 否 | DoH 解析、`proxycheck.io`、站点评分目标抓取、可达性探测、监控目标探测与 Webhook 告警 |

> 因此，「默认策略下不写 KV」这一结论**与调用方无关**：无论请求来自你的浏览器、爬虫还是别的来源，默认都不会产生 KV 写入。另注：用量统计是 **per-isolate 内存**，不同边缘节点各算各的，并非全站总数。

---

## 🎨 界面 · UI

界面分为 **4 个标签页 / 4 tabs**：

- **概览 Overview**：IPv4/IPv6、边缘节点、Worker 耗时 + 实时 RTT 监控（图表 + 质量/稳定性/丢包/样本）
- **网络信息 Network**：TLS/协议/ECH/压缩/Bot 评分、边缘位置与运营商、真实 IP 位置与风险、硬件信息
- **诊断工具 Tools**：**20 张工具卡片网格**
- **历史统计 History**：测速历史、用量统计

诊断工具采用 **卡片网格 + 结果弹层**：点击卡片 → 弹出层内运行并展示结果，右上角带「重新运行」按钮，窄屏自动精简。结果用**指标卡 + 进度条 / 行列表**结构化呈现，而非一段裸文本。深浅主题可切换，偏好保存到 `localStorage`。

---

## 🧱 技术架构 · Architecture

**后端 · Backend（Cloudflare Worker）**
- 运行时 Runtime：Cloudflare Workers（V8）
- 语言 Language：JavaScript（ES2020）
- 存储 Storage：**可选** KV（`SPEED_HISTORY`）；默认策略下常规请求零 KV 读写
- API 设计：RESTful，返回 JSON 或二进制流
- 并发控制 Concurrency：自定义 `pLimit`
- 限流 Rate limit：内存 Map（per-isolate），分区限流（通用 / 健康检查 / 大响应 / CPU）
- 安全头 Security headers：HSTS、X-Frame-Options、CSP(nonce)、CORS 白名单

**前端 · Frontend（原生 SPA）**
- 框架 Framework：纯原生 JS，无第三方框架（仅字体与图标库）
- 图表 Chart：Canvas 2D 实时折线
- WebSocket：`wss://` 双向通信测试
- 响应式 Responsive：CSS Grid + Flexbox
- 本地存储：`localStorage` 保存语言与主题偏好

**外部依赖 · External deps**：IP 探测（`ipify` / `icanhazip` 等）、IP 风险（`proxycheck.io`，HTTPS）、字体 Google Fonts（Inter，**异步加载、不阻塞首屏**）、图标 Font Awesome 6（带 SRI 校验）。

> 客户端地理位置**不再依赖第三方 API**，直接使用 Cloudflare `request.cf` 边缘数据，任何网络环境均可用。

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

# 4)（可选）创建 KV
wrangler kv:namespace create "SPEED_HISTORY"

# 5) 在 wrangler.toml 填入 KV id（如使用 KV）

# 6) 发布
wrangler deploy
```

访问 Worker 分配的 `*.workers.dev` 域名即可使用。
Then open the assigned `*.workers.dev` URL.

---

## 🛠️ 详细部署 · Detailed Deployment

### 方式一 / Option A：Wrangler CLI（推荐 / Recommended）

**前置条件 Prerequisites**：Node.js 16+、Cloudflare 账号。

**Step 1 · 安装 Wrangler**
```bash
npm install -g wrangler
```

**Step 2 · 登录 Cloudflare**
```bash
wrangler login
```

**Step 3 ·（可选）创建 KV 命名空间**
```bash
wrangler kv:namespace create "SPEED_HISTORY"
```
输出形如：
```
✨ Success! Worker KV namespace created:
{ binding = "SPEED_HISTORY", id = "abc123def456" }
```
记下 `id`。**不绑定也能完整运行**（用量统计走内存、测速历史与站点监控持久化不可用）。

**Step 4 · 配置 `wrangler.toml`**
```toml
name = "netsight-pro"
main = "_workers.js"
compatibility_date = "2024-01-01"

# 可选 optional
# [[kv_namespaces]]
# binding = "SPEED_HISTORY"
# id = "abc123def456"

[vars]
# 可选：跨域白名单（逗号分隔；含 * 表示允许全部）
ALLOWED_ORIGINS = "https://yourdomain.com"
# 可选：站点监控管理密钥
# MONITOR_ADMIN_KEY = "your-secret"

# 可选：站点监控定时巡检
# [triggers]
# crons = ["*/15 * * * *"]
```

**Step 5 · 发布并验证**
```bash
wrangler deploy
curl https://your-worker.workers.dev/health
# => {"status":"ok","version":"4.6.0", ...}
```

### 方式二 / Option B：Cloudflare Dashboard

1. 登录 Dashboard → **Workers & Pages** → 创建 Worker。
2. 把本项目的 Worker 脚本（`_workers.js`）完整粘贴进在线编辑器。
3. **设置 → 变量 / Settings → Bindings**（可选）添加：
   - KV Namespace：名称 `SPEED_HISTORY`
   - 变量：`ALLOWED_ORIGINS`、`MONITOR_ADMIN_KEY`
4. 保存并部署。

> 注意：Dashboard 方式不支持本地调试与热更新，适合快速测试。变量名需与代码一致（区分大小写）。

---

## ⚙️ 绑定与变量 · Bindings & Vars

| 名称 Name | 类型 Type | 必填 Required | 描述 Description |
| --- | --- | --- | --- |
| `SPEED_HISTORY` | KV Namespace | 否 No | 站点监控状态/日志、测速历史。未绑定时相关功能优雅降级为「暂无记录」，**不影响其它功能** |
| `ALLOWED_ORIGINS` | 环境变量 Var | 否 No | 跨域来源白名单（逗号分隔）。未设置时仅允许同源；含 `*` 允许全部 |
| `MONITOR_ADMIN_KEY` | 环境变量 Var | 否 No | 站点监控管理密钥；未设置时监控配置读写不可用 |
| Cron Triggers | 定时触发器 | 否 No | 启用后站点监控才会按计划自动巡检 |

| 源码常量 Constant | 默认 Default | 说明 |
| --- | --- | --- |
| `USAGE_BACKEND` | `memory` | 用量统计后端；设为 `kv` 才会聚合后写入 KV（消耗额度） |
| `SPEED_HISTORY_KV_ENABLED` | `false` | 是否把测速历史写入 KV；默认关闭以保护额度 |

> 所有绑定都是**软依赖**：代码用 `typeof X !== 'undefined'` 判断，未绑定也能完整运行。
> All bindings are **soft dependencies** — the script degrades gracefully when absent.

---

## 📌 API 端点 · Endpoints

| 端点 Endpoint | 方法 Method | 参数 Params | 说明 Description | 限制 Limit |
| --- | --- | --- | --- | --- |
| `/` | GET | — | 主诊断页 | — |
| `/health` | GET | — | 健康检查（版本 + 存储策略） | 独立限流 180/分 |
| `/app.js`、`/app.css` | GET | — | 前端资源（可缓存） | — |
| `/manifest.webmanifest`、`/sw.js` | GET | — | PWA 清单与 Service Worker | — |
| `/icon.svg`、`/icon-192.png`、`/icon-512.png` | GET | — | 站点图标 | — |
| `/speedtest` | GET | `size` | 下载测速（随机字节） | 1..67,108,864（默认 100KB）；大响应独立限流 30/分 |
| `/upload-test` | POST | body | 上传测速（流式读取） | body ≤ 32 MB |
| `/cpu-test` | GET | `n` | CPU 基准测试 | n 1..20,000；独立限流 3/分 |
| `/dns-proxy` | GET | `url` | HEAD 探测 | 仅 http/https + 公网校验 |
| `/ws-test` | GET | — | WebSocket 往返延迟 | 需 Upgrade 头 |
| `/http2-test` | GET | — | HTTP/2·3 / TLS / ALPN | — |
| `/concurrent-test` | GET | `count`,`size` | 并发下载 | count 1..16；size 1..65,536 |
| `/stream-test` | GET | `size` | 流式传输 | 1..5,242,880 |
| `/api/dns-lookup` | GET | `name`,`type` | 单条 DoH 查询 | 类型白名单 |
| `/api/dnsbl` | GET | `ip` | IP 黑名单检测 | 需 IPv4 |
| `/api/dns-compare` | GET | `name`,`type` | 多解析器对比与一致性判定 | 类型白名单 |
| `/api/domain-check` | GET | `domain`,`selector` | 域名邮件安全体检 | 合法域名 |
| `/api/site-audit` | GET | `url` | 站点安全响应头审计与评分 | 仅公网 http/https |
| `/api/reach-check` | GET | — | 边缘侧可达性探测结果 | — |
| `/api/monitor` | GET / POST | `key`（GET） | 读取 / 保存站点监控配置 | 需 `MONITOR_ADMIN_KEY` |
| `/api/monitor-run` | POST | — | 手动触发一次巡检 | 需 `x-admin-key` |
| `/api/usage-stats` | GET | — | 用量统计（默认内存） | — |
| `/api/speed-history` | GET | `limit` | 查询测速历史（需 KV） | limit 1..20 |
| `/api/log-speed` | POST | `{avgSpeed,results}` | 记录一次测速结果 | body ≤ 10KB |
| `/api/ip-fraud` | GET | — | IP 风险评分 | 依赖第三方接口 |
| `/*` | OPTIONS | — | CORS 预检 | 含 CORS 头 |

除静态资源外，所有端点受基础限流（默认 **60 次/分钟/IP**）保护；`/health`、大响应下载、`/cpu-test` 使用**独立限流桶**。所有响应均携带安全头，敏感端点实施同源保护。

---

## 🖱️ 前端功能与工具 · Frontend & Tools

### 实时 RTT 监控 / Live RTT
每 2s 向 `/health` 发一次 HEAD 请求（带缓存破坏参数），计算往返时间；保留最近样本绘制折线图。派生指标：抖动（移动平均窗口）、最低/最高 RTT、丢包率、质量等级、稳定性等级。**标签页切到后台时自动暂停轮询，回到前台自动恢复。**

### 20 个诊断工具 / 20 tools

| 工具 Tool | 数据来源 Source | 测试内容 What it does |
| --- | --- | --- |
| 一键体检 Quick check | 🖥️ 本机 | 运行全部检测并生成评分报告 |
| 丢包率 Packet Loss | 🖥️ 本机 | 连续探测，统计失败率与质量 |
| 带宽测速 Bandwidth | 🖥️ 本机 | 依次下载多档位，算各档与平均 Mbps |
| 上传测速 Upload | 🖥️ 本机 | 多档位上传，算各档与平均 Mbps |
| 缓冲膨胀 Bufferbloat | 🖥️ 本机 | 负载下延迟，A–F 评级 |
| DNS 解析 DNS | 🖥️ 本机 | 解析主流站点，测量解析耗时 |
| TTFB 分析 TTFB | 🖥️ 本机 | 拆解请求各阶段耗时 |
| WebRTC 泄漏 Leak | 🖥️ 本机 | 判断内网/公网 IP 泄露 |
| 多节点对比 Multi-node | 🖥️ 本机 | 输入多节点 URL，并行测延迟 |
| 流媒体连通 Media | 🖥️ 本机 | Netflix/Disney+/YouTube/ChatGPT 可达性 |
| WebSocket | 🖥️ 本机 | 建连后往返延迟测量 |
| 并发测试 Concurrency | 🖥️ 本机 | 多路并发，观测平均耗时 |
| 流式传输 Stream | 🖥️ 本机 | 分块流式读取，算持续吞吐 |
| 网络可达性 Reachability | 🛰️ 双侧 | 边缘侧与浏览器侧**同时**探测并对照 |
| DNS 工具箱 DNS Toolbox | ☁️ 边缘 | DoH 记录查询 + IP 黑名单检测 |
| 多解析器对比 DNS Compare | ☁️ 边缘 | 4 个公共解析器并发对比 |
| 域名安全体检 Domain Check | ☁️ 边缘 | MX / SPF / DMARC / DKIM 与声誉 |
| 站点安全评分 Site Audit | ☁️ 边缘 | HTTP 安全响应头审计 + A–F 评级 |
| CPU 性能 CPU | ☁️ 边缘 | Worker 端计算基准 |
| 站点监控 Monitor | ☁️ 边缘 | 定时巡检 + Webhook 告警 |

### 站点安全评分 · Site Audit
输入任意公网 URL，由 Worker 端发起请求并审计：状态码、首字节（TTFB）、总耗时、重定向次数、跟随重定向后的最终地址，并逐项检查安全响应头：

`Strict-Transport-Security` / `Content-Security-Policy` / `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy` / `COOP` / `Server`

按权重汇总为 **0–100 安全评分与 A–F 评级**，并给出问题清单（如 HSTS 缺失、CSP 允许 `unsafe-inline`、Server 头暴露软件信息等）。

> 说明：Workers `fetch` 无法获取任意目标的 TLS 证书信息，因此体检覆盖 **HTTP 层**，不含证书链审计。

### 网络可达性 · Reachability
同时从 **Cloudflare 边缘**（服务端）与 **你的浏览器**（客户端）探测 10 个境内外目标站点，给出结论：可达 / **疑似被阻断**（边缘可达而本地不可达）/ 不可达。用于快速识别本地网络或出口层的阻断与干扰。

### 报告 / Report
点击「复制报告」生成纯文本报告：诊断时间、边缘节点、客户端 IP、RTT/抖动/丢包、协议/TLS/压缩/Bot 评分、位置与 ISP、IP 风险信息等。

---

## 🔒 安全机制 · Security

1. **CSP（随机 nonce）**：`script-src` 仅 `'self' + 'nonce-<random>'`，页面内联脚本携带该 nonce；脚本不使用 `'unsafe-inline'`。
2. **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、HSTS、`Permissions-Policy`。
3. **同源校验（fail-closed）**：写操作与敏感端点校验 `Origin`/`Referer`；**无 `Origin` 且无 `Referer` 一律拒绝**，跨域需显式加入 `ALLOWED_ORIGINS`。
4. **SSRF 防护**（`/dns-proxy`、`/api/site-audit`）：协议白名单 + 私网/保留地址拦截 + DoH 解析确认全为公网 IP + 重定向**逐跳**校验 + 超时 + 只读响应头。
5. **分区限流**：通用 60/分；`/health` 180/分；大响应下载 30/分；`/cpu-test` 3/分（均为 per-isolate、按 IP）。
6. **上传防护**：统一**流式读取**，超过 32 MB 直接返回 413。
7. **第三方资源**：外链样式/字体带 `integrity`（SRI）与 `crossorigin`。
8. **出站加密**：优先 HTTPS（如 `proxycheck.io`），避免明文链路。
9. **转义分层**：HTML 上下文 `escapeHtml`，JS 字符串上下文 `escapeForJS`，客户端渲染统一 `escapeHTML`。

> English: CSP with a random nonce (no `unsafe-inline` scripts), strict security headers, fail-closed same-origin checks, SSRF guards with per-hop redirect validation, partitioned rate limits, streaming upload cap, SRI on third-party assets, HTTPS-only egress, and layered escaping for HTML vs JS contexts.

---

## 💾 KV 用量策略 · KV Budget

> 免费 KV 额度为 **1,000 次写入/天**。若页面高频轮询的接口顺手写 KV，极易「爆额度」。当前策略如下：

1. **常规请求零 KV 读写**：源码常量 `USAGE_BACKEND = 'memory'`，用量统计只走 isolate 内存。
2. **测速历史默认不落 KV**：源码常量 `SPEED_HISTORY_KV_ENABLED = false`；前端据此关闭 `/api/log-speed` 与历史轮询。
3. **站点监控按状态变化写入**：仅在「正常 → 异常」「异常 → 正常」或每小时例行刷新时写入，平稳状态不产生写操作。
4. **前端行为由服务端注入的 `window.__NETDIAG__` 驱动**，三种语言文案自动跟随开关状态。

> 如需跨 isolate 持久化用量或恢复测速历史：绑定 `SPEED_HISTORY` 后，分别把上述常量改为 `'kv'` / `true` 即可（请自行评估额度）。

---

## 🌐 国际化与主题 · i18n & Theme

**语言 / Languages**：English (en)、简体中文 (zh-CN)、繁體中文 (zh-TW)。三个语言包**键集合完全一致**（各 280+ 键，含 20 项工具说明与 9 类审计问题文案），切换时即时更新所有静态与动态内容。语言偏好持久化到 `localStorage`，并按 `Accept-Language` 自动初选。通用缩写与单位（IPv4/TLS/ASN/ECH/ms/Mbps/KB 等）跨语言一致，不做翻译。

**主题 / Theme**：深色 / 浅色 / 跟随系统。通过 CSS 变量与 `data-theme` 属性控制，偏好保存到 `localStorage`。

---

## ⚡ 性能与可靠性 · Performance

- **字体非阻塞**：Google Fonts 由内联脚本**异步注入**，链路不可达时自动回退系统字体，不拖慢首屏。
- **后台暂停**：标签页隐藏时暂停 RTT 轮询，回到前台自动恢复，减少无谓请求与耗电。
- **缓存**：前端资源独立外置并缓存；主页面与测速端点 `no-store`。
- **高效随机数据**：`crypto.getRandomValues` 分块填充；流式传输用 `ReadableStream` 逐块生成，内存友好。
- **并发控制**：`pLimit` 限制并发数，避免资源耗尽。
- **内存管理**：限流 Map 定期清理；KV 记录带 TTL。
- **降级**：KV 未绑定或外部接口失败时给出友好提示，不抛异常。
- **零 KV 压力**：默认策略下常规使用不产生任何 KV 读写。

---

## 🔀 相较上游的改动 · Changes vs Upstream

> 本仓库在上游 `CF-workers-netdiag` 基础上做了界面重做与稳定性/安全加固，并持续迭代新功能。This fork reworked the UI and hardened reliability/security on top of the upstream project, and keeps adding new capabilities.

**界面与交互**
- 单页长滚动 → **4 个标签页**；工具按钮堆叠 → **卡片网格 + 结果弹层**（指标卡/进度条 + 「重新运行」）。
- 结果统一结构化渲染，窄屏自适应精简。

**功能新增**
- 站点安全评分（HTTP 安全响应头审计 + A–F）。
- DNS 工具箱（DoH 查询 + IP 黑名单）、**多解析器对比**、域名邮件安全体检。
- **网络可达性检测**（边缘侧 + 浏览器侧对照）、缓冲膨胀测试、一键体检评分。
- 站点监控（Cron 巡检 + Webhook 告警）、PWA。
- 三语言全量对齐，覆盖所有动态内容。

**稳定性**
- `/cpu-test` 迭代上限压到免费计划 CPU 预算内（避免 1102 超时）；带宽端点体积上限收敛。
- 客户端地理位置改用 Cloudflare `request.cf` 边缘数据，消除第三方接口不可达导致的「获取失败」。
- 字体异步加载、后台暂停轮询等渲染优化。

**安全**
- CSP `script-src` 收紧为 `'self' + nonce`；补齐多个 API 端点的同源校验（fail-closed）。
- 新增 SSRF 防护（DoH 解析校验 + 逐跳重定向校验）；新增 `Permissions-Policy`。
- 分区限流（健康检查 / 大响应 / CPU）；上传 32 MB 流式限制；外链资源加 SRI。
- 出站风险查询由明文 HTTP 改为 HTTPS（`proxycheck.io`）。
- HTML/JS 转义彻底分离；修复客户端正则的模板字符串转义 bug。

**成本**
- KV 用量策略：默认关闭常规请求的 KV 读写，杜绝额度被刷爆。

---

## 🛠️ 自定义与扩展 · Customization

**加一个诊断工具**：在客户端 `TOOL_LIST` 增加一项（`key / icon / nameKey`），在 `TOOL_RUNNERS` 注册对应函数，结果用 `metricCard()` / `resultTitle()` / `result-rows` 渲染；如需要输入，参考「多解析器对比」或「站点体检」的实现。三语言需在 `i18n` 与 `toolDesc` 中补齐。

**加一个后端端点**：在 `handleRequest` 主流程添加 `if (url.pathname === '/your-endpoint')` 分支，并沿用相同的安全措施（CORS、限流、同源检查、输入收敛、SSRF 校验）。

**改配色 / 改主题**：只改 `:root` 与 `[data-theme="light"]` 的 CSS 变量即可全局换色。

**改文案**：编辑客户端 `i18n` 对象（三语言同步）。界面文本 ID 以 `t-` 开头，对应 `updateUI` 里的映射表。

> ⚠️ **踩坑提醒 · Pitfall**：内嵌客户端代码里的正则反斜杠必须写**双份**（如 `/^https?:\\/\\//`），否则会被外层模板字符串「吃掉」，导致客户端脚本解析失败。改动客户端正则后，务必验证渲染出的 `<script>` 能被解析（`node --check` 只校验 Worker 本身，不会校验内嵌脚本）。同理，客户端里的反引号与 `${` 也需要转义。

---

## ❓ 常见问题 · FAQ

**Q：部署后页面空白 / 加载失败？**
A：检查 Worker 日志（Dashboard → Workers → 选择 Worker → 日志），确认代码完整粘贴、无语法错误。

**Q：需要绑定 KV 吗？**
A：**不需要**。默认策略下用量统计走内存、测速历史不写 KV。仅在需要跨 isolate 持久化（测速历史 / 站点监控状态）时才绑定 `SPEED_HISTORY`。

**Q：测速历史 / 监控配置显示「暂无记录」或不可用？**
A：确认已绑定 `SPEED_HISTORY`（绑定名区分大小写）；站点监控另需设置 `MONITOR_ADMIN_KEY`。测速历史还需把源码常量 `SPEED_HISTORY_KV_ENABLED` 改为 `true`。

**Q：KV 额度老是被刷爆？**
A：确认使用当前默认策略（`USAGE_BACKEND='memory'`、`SPEED_HISTORY_KV_ENABLED=false`）。页面每 2s 一次的 `/health` 轮询若顺手写 KV，一天就能耗尽免费额度。

**Q：WebSocket / 部分测试失败？**
A：检查浏览器是否支持 WebSocket，某些企业网络或插件会拦截；可尝试无痕模式。

**Q：地理位置显示失败？**
A：4.5.1 起客户端位置直接取自 Cloudflare 边缘数据，正常情况下不会再失败；请确认请求确实经过 Cloudflare 网络。

**Q：IP 风险评分显示「获取失败」？**
A：该评分依赖第三方接口（`proxycheck.io`，免费额度有限），可能受可用性波动影响。

**Q：主题 / 语言切换不生效？**
A：确认浏览器未禁用 `localStorage`；`data-theme` 与语言偏好是否正确写入。

**Q：如何限制仅自己使用？**
A：在 `ALLOWED_ORIGINS` 填入自己的域名；如需更强限制，可自行增加基于 `cf-connecting-ip` 的 IP 白名单。

**Q：CPU 压测报错 1102？**
A：免费计划单请求 CPU 时间有限，`/cpu-test` 迭代上限已刻意压低；如需更高可选付费计划。

**Q：报告能存成文件吗？**
A：复制报告后粘贴到文本编辑器另存为 `.md` / `.txt` 即可。

---

## 📝 版本记录 · Changelog

- **4.6.0** — 新增「DNS 多解析器对比」「网络可达性检测（边缘侧 + 浏览器侧）」；站点体检升级为安全响应头评分制（0–100 / A–F + 问题清单）。
- **4.5.x** — 渲染与性能优化：字体异步加载、标签页后台暂停 RTT 轮询、转义函数单遍化；客户端地理位置改用 Cloudflare 边缘数据（修复查询失败）。
- **4.4.0** — 域名安全体检、站点监控（Cron + Webhook 告警）、PWA。
- **4.3.0** — KV 用量策略落地：默认关闭 KV 读写，杜绝额度被刷爆。
- **4.2.x** — 安全加固：SSRF 防护、同源 fail-closed、分区限流、SRI、CSP。
- **4.1.x** — 首版安全审查修复与界面重做。

---

## 📄 许可证与贡献 · License & Contributing

本项目基于 **AGPL-3.0** 许可证开源，欢迎任何形式的贡献（Issue / PR / Star）。

- **作者 Author**：BlueDriftHK
- **仓库 Repository**：https://github.com/BlueDriftHK/CF-workers-netdiag
- **反馈 Feedback**：请提交 GitHub Issue

本项目为网络诊断用途。对目标站点发起探测前，请确保你**有权**对该目标进行测试，并遵守目标站点服务条款与所在地法律法规。
This tool is for network diagnostics. Ensure you are **authorized** to probe any target site and comply with the target's terms of service and applicable laws.

> NetSight Pro – 让网络诊断既克制又高效。 🌌
