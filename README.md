# NetSight Pro · CF-workers-netdiag

> 单文件 Cloudflare Worker 网络诊断工具箱 —— 一个 `.js` 文件同时提供 Worker 逻辑、API 端点与完整前端（PWA）。23 个诊断工具、三语界面、零构建步骤、零运行时依赖、默认零 Worker 出站。

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![i18n](https://img.shields.io/badge/i18n-en%20%7C%20zh--CN%20%7C%20zh--TW-lightgrey)
![Version](https://img.shields.io/badge/version-4.7.1-informational)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BlueDriftHK/CF-workers-netdiag)

**问题反馈**：[Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) · **安全报告**：[SECURITY.md](SECURITY.md)

<!-- 截图位置（放到 docs/ 或 assets/ 后取消注释）
<p align="center">
  <img src="docs/overview.png" width="820" alt="概览页">
</p>
-->

---

## 目录

- [它是什么](#它是什么)
- [功能总览](#功能总览)
  - [诊断工具（23 个 · 6 分组）](#诊断工具23-个--6-分组)
  - [平台能力](#平台能力)
- [设计原则](#设计原则)
- [快速开始](#快速开始)
- [部署配置](#部署配置)
- [API 端点](#api-端点)
- [限流与配额](#限流与配额)
- [安全与隐私](#安全与隐私)
- [工具成本一览](#工具成本一览)
- [常见问题](#常见问题)
- [项目结构](#项目结构)
- [开发与贡献](#开发与贡献)
- [未实现 / 不打算做](#未实现--不打算做)
- [变更摘要](#变更摘要)
- [许可与第三方归属](#许可与第三方归属)
- [免责声明](#免责声明)
- [联系](#联系)

---

## 它是什么

把浏览器能做的网络探测全部放在**浏览器侧**完成，Worker 只承担少量必要职责（限流、可选 KV 存储、少量可选出站）。于是：

- **部署极简**：一个文件，`wrangler deploy` 即可；不需要 npm install、不需要打包、没有 CI。
- **成本可控**：默认不写 KV、不做 Worker 出站；KV 写入有硬预算闸门。
- **隐私友好**：没有账号、没有埋点、不上报测速结果；历史记录默认只存在你自己的浏览器里。
- **跨语言**：界面完整支持 `en` / `zh-CN` / `zh-TW`，深色/浅色主题。

**它不是什么**：不是 SaaS，不保证可用性，不带账号体系，也不是给第三方站点做扫描的工具。

---

## 功能总览

### 诊断工具（23 个 · 6 分组）

| 分组 | 工具 | 说明 |
|---|---|---|
| **网络质量与延迟** | 一键体检 | 串跑延迟/抖动/丢包/上下行/协议/DNS 等 6 项，给出百分制评分、评级、**问题清单 + 原因建议** |
| | 长时质量监控 | 1/5/10 分钟每秒探测，输出 **p50/p95/p99**、抖动、丢包、卡顿次数与时间线色带 |
| | 丢包率 | 连续探测统计丢包（自动剔除限流样本，不虚报 0%） |
| | TTFB 分析 | DNS / TCP / TLS / 等待 / 下载 五阶段耗时拆解 |
| | WebSocket | 真实 WebSocket 往返延迟（服务端心跳 + 超时上限） |
| | 代理/VPN 检测 | 比对 **HTTP 出口 IP** 与 **WebRTC 暴露 IP**，识别代理、VPN 与分流泄漏 |
| | WebRTC 泄漏 | 检测浏览器是否暴露内网/公网真实 IP |
| **带宽与吞吐** | 带宽测速 | 3 档位下载测速（读取完整响应体，不做 TTFB 误判） |
| | 多流并发测速 | 4 条并行流 + **实时速率曲线**，报告平均 / p95 峰值 / 稳定性 |
| | 上传测速 | 3 档位上传，服务端流式读取 |
| | 缓冲膨胀 | 空闲 vs 满载延迟对比，A–F 评级（会消耗较多流量） |
| | 流式传输 | 分块流式下载吞吐 |
| | 并发测试 | 多档位并发请求观察耗时变化 |
| **DNS** | DNS 解析 | 主流站点解析/加载耗时（优先取浏览器真实 DNS 耗时） |
| | DNS 工具箱 | DoH 记录查询（A/AAAA/CNAME/MX/TXT/NS/SOA/CAA）+ IP 黑名单检测 |
| | 多解析器对比 | 同时查询 Cloudflare / Google / Quad9 / AliDNS，判定解析一致性 |
| **安全与合规** | 站点体检 | 安全响应头审计评分（HSTS/CSP/XFO/XCTO/Referrer-Policy/COOP/Server），可选**证书到期检查** |
| | 域名安全体检 | MX / SPF / DMARC / DKIM + 两个黑名单声誉库 |
| **可达性与多节点** | 流媒体连通性 | 纯浏览器探测流媒体站点可达性 |
| | 网络可达性 | 浏览器侧直连境内外站点，识别本地阻断 |
| | 多节点对比 | 对比多个自建 Worker 节点的延迟（走跨域 `/node-ping`） |
| **监控与系统** | 站点监控 | Cron 定时巡检 + Webhook 告警（钉钉/飞书/企微/Slack），仅状态变化时写存储 |
| | CPU 性能 | Worker 端计算基准（独立限流 3 次/分/IP） |

### 平台能力

- **实时 RTT 监控**：5 秒间隔轮询、抖动、最小/最大、丢包率、实时曲线、质量与稳定性评级
- **诊断建议引擎（E1）**：把问题映射为「可能原因 + 建议动作」，而不是只丢一个分数
- **本地测试历史**：六类测试结果存 localStorage（最近 20 条，可一键清空），**不写 KV**
- **分享能力**：体检结果可生成分享图（Canvas）或分享链接（URL 内嵌压缩数据）
- **i18n**：`en` / `zh-CN` / `zh-TW` 全界面覆盖，含分组名与建议文案
- **主题**：深色/浅色，跟随系统或手动切换
- **PWA**：manifest + Service Worker（网络直通，不做离线缓存以保证诊断实时性）
- **安全响应头**：HSTS / XCTO / XFO / Referrer-Policy / Permissions-Policy，主页面带 nonce CSP

---

## 设计原则

这四条是本项目的取舍底线，改动代码前请先读 [CODE_OF_CONDUCT.md 第 6 节](CODE_OF_CONDUCT.md#6-本项目特有的技术红线)。

| 原则 | 具体做法 |
|---|---|
| **零出站优先** | 可达性、WebRTC、测速、质量监控全在浏览器侧；IP 风险评分已停用；证书检查是**可勾选**的 1 次出站 |
| **KV 写入有预算** | 所有写入经统一闸门（20 次/分、600 次/日/isolate、同键 10s 去抖）；测速历史为单键环形缓冲，**无 list、无 delete** |
| **安全默认值不可放宽** | 会话令牌校验、CSP、安全头、SSRF 防护、体积上限、管理密钥只走请求头 |
| **单文件零依赖** | 无构建步骤、无运行时依赖、无前端框架；改一行推一次即上线 |

---

## 快速开始

### 方式一：一键部署

点击顶部 **Deploy to Cloudflare Workers** 按钮，按提示授权即可（部署后可选配置 KV 与变量，见下节）。

### 方式二：命令行

```bash
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

npx wrangler login
npx wrangler dev            # 本地预览 http://localhost:8787
npx wrangler deploy         # 部署到 *.workers.dev
```

### 部署后自检

1. 打开首页，确认「边缘节点 / Worker 耗时」有值、RTT 曲线开始滚动。
2. 控制台执行 `fetch('/health').then(r=>r.json()).then(console.log)`，确认 `version` 与 `kvWrite` 正常。
3. 点几个工具卡片：免参数工具应立即出结果，带参数工具应在**左栏输入、右栏查看结果**。

---

## 部署配置

### `wrangler.toml` 参考

```toml
name = "cf-workers-netdiag"
main = "_workers.js"
compatibility_date = "2024-11-01"

# 可选：测速历史、用量统计（kv 模式）、站点监控状态依赖它
[[kv_namespaces]]
binding = "SPEED_HISTORY"
id = "<你的 KV namespace id>"

# 可选：/static/ 静态资源缓存（该前缀当前停用，见「端点表」）
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "<你的 KV namespace id>"

# 可选：站点监控定时巡检（建议 5 分钟）
[triggers]
crons = ["*/5 * * * *"]
```

```bash
# 创建 KV（可选）
npx wrangler kv namespace create SPEED_HISTORY

# 设置管理员密钥（站点监控用，务必用 secret，不要写进代码）
npx wrangler secret put MONITOR_ADMIN_KEY
```

### 绑定与变量

| 名称 | 类型 | 必填 | 用途 | 不配置时 |
|---|---|---|---|---|
| `SPEED_HISTORY` | KV 绑定 | 否 | 测速历史、用量统计（kv 模式）、站点监控状态与日志 | 用量统计退化为 isolate 内存；测速历史与监控提示未绑定 |
| `CACHE_KV` | KV 绑定 | 否 | `/static/` 前缀的静态资源（该前缀当前停用） | 无影响 |
| `MONITOR_ADMIN_KEY` | Secret | 否 | 站点监控管理密钥（仅接受 `x-admin-key` 请求头） | 监控端点返回 `key_not_set` |
| `ALLOWED_ORIGINS` | Var/Secret | 否 | 跨域白名单（逗号分隔，`*` 表示放开） | 仅允许同源访问（推荐） |

### Cron Triggers

站点监控由 `scheduled` 事件驱动。不配置 Cron 时，监控工具仍可手动触发「立即检测」，只是不会有自动巡检。

### 自定义域

在 Cloudflare 面板绑定自定义域即可；仓库里的 `CNAME` 文件用于 Pages 场景。绑定后请确认：

- 站点通过 **HTTPS** 访问（会话令牌 Cookie 会带 `Secure`；HTTP 下改用 `x-ns-token` 请求头兜底）
- 若对外提供的是**修改版**，请把页脚源码链接换成你自己的仓库（AGPL-3.0 §13 要求，见 [CODE_OF_CONDUCT.md 13.3](CODE_OF_CONDUCT.md#133-agpl-30-13-对本项目的实际含义部署者必读)）

---

## API 端点

🔑 = 需要主页面签发的**会话令牌**（HttpOnly Cookie `__ns_t` 或 `x-ns-token` 头，TTL 1 小时）。缺失或失效返回 **403**；前端收到 403 会自动刷新页面重新领取。

| 端点 | 方法 | 参数 | 说明 | 限制 |
|---|---|---|---|---|
| `/` | GET | — | 主诊断页（签发会话令牌） | 无令牌要求 |
| `/health` | GET | — | 版本 + 存储策略 + **KV 写入遥测** | 🔑 独立限流 180/分/IP |
| `/app.js`、`/app.css` | GET | `v` | 前端资源 | 1 年 immutable，免限流 |
| `/manifest.webmanifest`、`/sw.js` | GET | — | PWA 清单与 Service Worker | 免限流 |
| `/icon.svg`、`/icon-192.png`、`/icon-512.png` | GET | — | 站点图标 | 免限流 |
| `/node-ping` | GET | — | 节点互测延迟（供多节点对比） | 无令牌、CORS `*`、响应 ≈60B |
| `/speedtest` | GET | `size` | 下载测速（随机字节） | 🔑 1..67,108,864（默认 100KB）；>2MB 走独立桶 30/分 |
| `/upload-test` | POST | body | 上传测速（流式读取） | 🔑 body ≤ 32MB |
| `/cpu-test` | GET | `n` | CPU 基准测试 | 🔑 n 1..20,000；独立限流 3/分 |
| `/ws-test` | GET | — | WebSocket 往返延迟 | 🔑 需 `Upgrade: websocket`；消息 ≤4KB；最长 5 分钟 |
| `/http2-test` | GET | — | HTTP/2·3 / TLS / ALPN | 🔑 `earlyHints` 恒为 false（Workers 无法发 103） |
| `/concurrent-test` | GET | `count,size` | 并发下载 | 🔑 count 1..16、size 1..65,536 |
| `/stream-test` | GET | `size` | 流式传输（64KB 分块） | 🔑 1..5,242,880 |
| `/api/dns-lookup` | GET | `name,type` | 单条 DoH 查询 | 🔑 类型白名单；缓存 60s |
| `/api/dnsbl` | GET | `ip` | IP 黑名单检测（3 个 zone） | 🔑 需 IPv4；缓存 5 分钟 |
| `/api/dns-compare` | GET | `name,type` | 4 个公共解析器对比 | 🔑 `consistent` 需恰好 1 组；缓存 60s |
| `/api/domain-check` | GET | `domain,selector` | MX/SPF/DMARC/DKIM + 声誉 | 🔑 缓存 120s |
| `/api/site-audit` | GET | `url,cert` | 安全响应头审计与评分；`cert=1` 附证书到期 | 🔑 公网 http/https、端口仅 80/443、≤6 跳逐跳校验 |
| `/api/monitor` | GET / POST | — | 读取 / 保存站点监控配置 | 🔑 + `x-admin-key`；目标与 Webhook 限公网 + 80/443 |
| `/api/monitor-run` | POST | — | 手动触发一次巡检 | 🔑 + `x-admin-key` |
| `/api/usage-stats` | GET | — | 用量统计 | 🔑 默认内存模式；kv 模式缓存 60s |
| `/api/speed-history` | GET | `limit` | 测速历史（需 KV 开关） | 🔑 limit 1..20；单键读 + 缓存 60s |
| `/api/log-speed` | POST | `{avgSpeed,results}` | 记录一次测速结果 | 🔑 body ≤ 10KB；按 IP 15s + 全局 30/分 |
| `/*` | OPTIONS | — | CORS 预检 | 含 CORS 头；先于限流处理 |

### 已停用端点（统一返回 **410 Gone**）

| 端点 | 停用原因 |
|---|---|
| `/dns-proxy` | 前端从未调用；DNS 探测已由浏览器侧实现 |
| `/api/ip-fraud` | 外部风险评分已停用（零出站设计） |
| `/api/reach-check` | 边缘侧可达性探测已移除，改为纯浏览器侧 |
| `/static/*` | 遗留的 KV 静态托管，无任何静态资源被引用 |

实现代码保留，恢复只需从 `DISABLED_ENDPOINTS` / `DISABLED_PATH_PREFIXES` 移除对应路径。

---

## 限流与配额

### 限流桶（按 IP）

| 桶 | 配额 | 说明 |
|---|---|---|
| 默认 | 60 次/分钟 | 除静态资源外的几乎所有端点 |
| `/health` | 180 次/分钟 | 独立配额，RTT 轮询与质量监控不挤占工具额度 |
| 大响应下载 | 30 次/分钟 | `/speedtest?size>2MB`（缓冲膨胀、长时测速） |
| `/cpu-test` | 3 次/分钟 | CPU 密集，独立收紧 |

> 未授权的请求头（伪造 `Origin`/`Referer`/`cf-connecting-ip`）不能用于规避限流，见 [CODE_OF_CONDUCT.md 6.1](CODE_OF_CONDUCT.md#61-不要滥用公开实例)。

### KV 写入总闸

所有 KV 写入都经过统一闸门，宁可丢少量非关键数据，也不让异常循环打爆额度：

| 限制 | 值 |
|---|---|
| 每分钟写入 | 20 次 / isolate |
| 每日写入 | 600 次 / isolate（免费额度 1000/天，留 40% 余量） |
| 同键去抖 | 10 秒内同键只写 1 次 |
| 测速历史 | 单键环形缓冲（≤10 条），每次写入 = 1 get + 1 put，**无 list / 无 delete** |
| 用量统计（kv 模式） | 默认关闭；开启后最多 1 次写/分钟 |
| 站点监控 | 仅状态变化时写；无变化心跳写 6 小时一次 |

超预算时：非关键写入静默丢弃并计数；**保存监控配置**会返回 `503 write_budget_exceeded` 并给出明确提示。

### 免费额度参考

以 Cloudflare 官方为准（可能调整）：

| 项目 | 免费额度 |
|---|---|
| Workers 请求 | 100,000 / 天 |
| KV 读取 / 写入 / 删除 / 列出 | 100,000 / 1,000 / 1,000 / 1,000 每天 |
| 可观测性事件 | 200,000 / 天（**本项目对事件量敏感，建议关注**） |

> 写 KV 与出站请求默认关闭；即使全部开启，写入闸门也把最坏情况限制在每日 600 次/isolate 以内。

---

## 安全与隐私

### 安全机制

| 机制 | 说明 |
|---|---|
| 会话令牌 | 取代可伪造的 Origin/Referer 判断：主页面签发令牌（HttpOnly Cookie + `x-ns-token` 兜底），失效时前端自动刷新重领 |
| SSRF 防护 | 私网/本机判定（含 IPv6 与 IPv4 映射）、端口白名单（仅 80/443）、DoH 解析结果必须全为公网、重定向逐跳复检 |
| CSP | 主页面 nonce CSP + 严格响应头（HSTS/XCTO/XFO/Referrer-Policy/Permissions-Policy） |
| 输入限制 | 上传 ≤32MB、日志 ≤10KB、域名/URL 正则白名单、监控目标 ≤10 个 |
| 管理密钥 | 只走 `x-admin-key` 请求头，绝不接受查询参数（避免进入日志/历史） |
| 端点开关 | 无引用或已废弃端点统一 410，且短路在令牌校验与限流之前 |
| 出站端口 | Worker 侧所有用户可控目标仅放行 80/443 |

### 数据去向

| 数据 | 默认位置 |
|---|---|
| RTT / 抖动 / 质量监控样本 | 仅在浏览器内存与图表，**不上传** |
| 测试历史 | **localStorage**（`netsight-local-history`，≤20 条，可一键清空） |
| 出口 IP / 地理位置 | **浏览器直连**第三方（ipify、icanhazip、ipapi.co 回退）；Worker 侧只用 Cloudflare 提供的 `request.cf` |
| 测速历史 / 用量统计 | 默认**不写 KV**；开启后受写入闸门约束 |
| 站点监控配置 | 仅在部署者绑定 KV 且设置管理员密钥时保存 |
| 第三方埋点 / 统计 / 广告 | **没有** |

### 报告安全问题

请**不要**开公开 issue。使用 GitHub 私密报告（仓库 **Security → Report a vulnerability**）或邮件 `admin@bjhr.space`，详见 [SECURITY.md](SECURITY.md) 与 [CODE_OF_CONDUCT.md 第 8 节](CODE_OF_CONDUCT.md#8-安全漏洞与敏感数据上报)。

---

## 工具成本一览

| 工具 | Worker 出站 | 流量消耗 | 备注 |
|---|---|---|---|
| RTT / 丢包 / 长时质量监控 / 一键体检（延迟部分） | 0 | 极小 | 仅 `/health` HEAD 请求 |
| WebRTC 泄漏 / 代理检测 | 0 | 0 | 浏览器直连 STUN/ICE |
| 带宽测速 / 上传测速 / 流式 / 并发 | 0 | 中（数 MB 起） | 与带宽成正比 |
| 多流并发测速 | 0 | 约 64MB | 4 流 × 16MB |
| 缓冲膨胀 | 0 | 较大（可达数百 MB） | 会在界面提示 |
| DNS 解析 / 可达性 / 流媒体连通性 | 0 | 极小 | 浏览器侧 Image / fetch |
| DNS 工具箱 / 多解析器对比 / 域名体检 | 1–6 次/次操作 | 极小 | Worker 侧 DoH 查询（固定解析器） |
| 站点体检 | 1–6 次/次操作 | 小 | 抓取目标站点响应头 |
| 站点体检 + 证书检查（需勾选） | +1 次 | 极小 | crt.sh，30 分钟内存缓存 |
| 站点监控 | 每目标 1 次/巡检 | 小 | Cron 驱动，含 Webhook |

---

## 常见问题

<details>
<summary><b>打开页面后工具都报错 / RTT 停摆？</b></summary>

多半是**会话令牌失效**（isolate 重建或超过 1 小时 TTL）。前端在 RTT 探测收到 403 时会自动刷新页面重新领取；若仍不行，强制刷新一次即可。
</details>

<details>
<summary><b>用 curl 请求 <code>/health</code> 返回 403？</b></summary>

这是预期的：`/health` 需要页面会话令牌。脚本化探活请改用 **`/node-ping`**（无令牌、响应极小、带 CORS 头）。
</details>

<details>
<summary><b>某个端点返回 410？</b></summary>

该端点已停用（`/dns-proxy`、`/api/ip-fraud`、`/api/reach-check`、`/static/*`）。需要恢复请在 Issues 中说明用途。
</details>

<details>
<summary><b>测速历史 / 站点监控说"未绑定 KV"？</b></summary>

两者的持久化依赖 KV 绑定 `SPEED_HISTORY`（且测速历史还有独立开关，默认关闭）。不绑定也能正常使用其他工具。
</details>

<details>
<summary><b>站点监控没有自动巡检？</b></summary>

需要三件事齐备：KV 绑定 + `MONITOR_ADMIN_KEY` 已设置 + `wrangler.toml` 里配置了 Cron Triggers。缺任意一项时可手动点「立即检测」。
</details>

<details>
<summary><b>提示 429 Too Many Requests？</b></summary>

命中限流。默认 60 次/分/IP，`/health` 180/分，大响应下载 30/分，`/cpu-test` 3/分。等一分钟，或避免同时运行多个重工具。
</details>

<details>
<summary><b>缓冲膨胀/多流测速提示限流或结果不可信？</b></summary>

这类测试会短时间发出大量大响应请求，可能触发大响应桶（30/分）。界面会明确提示"负载阶段触发限流，结果可能不准确"，稍后重跑即可。若持续发生，请考虑自行部署实例。
</details>

<details>
<summary><b>能加第三方统计 / 广告 / 风控接口吗？</b></summary>

不可以。本项目坚持零埋点、零不必要出站（这也是 IP 风险评分被停用的原因）。相关改动需先在 Issues 讨论。
</details>

<details>
<summary><b>如何自建多节点做"多节点对比"？</b></summary>

把本项目部署到多个区域/账号，然后在工具里填入各节点根地址（每行一个）。探测走跨域 `/node-ping`，因此目标节点需为 4.6.3 以后的版本。
</details>

---

## 项目结构

```
.
├── _workers.js            # 唯一权威源文件：Worker + 内联 CSS/JS + HTML 模板
├── index.html             # 静态副本 / 展示页（用途见下方说明）
├── README.md              # 本文档
├── CONTRIBUTING.md        # 贡献指南（开发、测试、PR 规范）
├── CODE_OF_CONDUCT.md     # 行为准则 + 工程红线 + 许可与 AGPL 合规
├── SECURITY.md            # 漏洞披露策略
├── LICENSE                # GNU AGPL-3.0
├── CNAME                  # 自定义域（Pages 场景）
└── .github/               # issue / PR 模板与自动化
```

> `index.html` 。若它与 `_workers.js` 内容重叠，改动时需同步，否则会出现"两份代码两种行为"。

### 代码地图（`_workers.js`）

| 区块 | 内容 |
|---|---|
| 常量与安全头 | `CORS_HEADERS`、`SECURITY_HEADERS`、会话令牌、同源判定 |
| 限流与配额 | 各 bucket、`COUNTED_ENDPOINTS`、`DISABLED_ENDPOINTS` |
| 安全校验 | `isPrivateIp` / `isPrivateHost` / `isAllowedTargetPort` / `resolvesToPublicOnly` |
| KV 层 | `kvPut` 写入闸门、用量统计、测速历史环形缓冲、内存缓存 |
| 站点监控 | 巡检、Webhook、Cron 入口 |
| 前端资源 | `APP_CSS`、`APP_JS`（i18n、工具表、各工具 runner） |
| 请求路由 | `handleRequest()`：令牌/限流 → 停用端点 → 各端点 → 主页面 |
| 主页面模板 | 内联 HTML、CSP nonce、注入的 `window.__BACKEND__` |

---

## 开发与贡献

```bash
npx wrangler dev              # 本地预览
node --check _workers.js      # 语法检查（模板字符串转义错误会在这里暴露）
npx wrangler deploy --dry-run # 打包与配置校验
```

开始动手前请读 [CONTRIBUTING.md](CONTRIBUTING.md)（含 **`APP_JS` 模板字符串转义陷阱**、新增工具/端点的可复制骨架、测试清单、PR 模板），行为规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

**适合上手的改动**：三语文案统一、移动端布局细节、错误提示可读性、新增诊断建议规则、文档与端点表修正。

---

## 未实现 / 不打算做

有些想法受平台限制或与本项目取舍冲突，列在这里避免重复讨论：

| 想法 | 结论 |
|---|---|
| traceroute / 跳数路径 | Cloudflare Workers 与浏览器都不支持 ICMP 与 TTL 控制，**做不了** |
| 真实 MTU 探测 | 无 DF/分片控制，只能间接推断，价值低 |
| 直读证书链 | Workers `fetch` 不暴露对端证书，浏览器跨域读证书被禁；改用 CT 日志（已实现为可选的证书到期检查） |
| 严格 DNS 泄漏检测 | 浏览器无法指定解析器；Worker 侧只能做"多解析器对比"（已实现） |
| 服务端 IP 风险评分 | 需要第三方出站，与"零出站"冲突，**已停用** |
| 第三方统计 / 广告 | 不做 |
| 账号体系 / 云端历史 | 不做（本地历史 + 可选 KV 已够用） |

---

## 变更摘要

| 版本 | 主要变化 |
|---|---|
| **4.7.1** | UI 重构：工具按 6 类分组 + 紧凑卡片（说明移到 tooltip）；结果弹层改**宽屏两栏**（左参数/操作，右结果）；按钮统一三级；安全卡分「传输与协议」「来源与指纹」 |
| **4.7.0** | 新增 6 项：代理/VPN 一致性检测、长时质量监控（p50/p95/p99 + 卡顿时间线）、多流并发测速（实时曲线）、证书到期检查（可选出站）、本地测试历史、（一键体检）诊断建议引擎 |
| 4.6.7 | 端点开关：停用 `/dns-proxy`、`/static/*`、`/api/ip-fraud`、`/api/reach-check`（统一 410） |
| 4.6.6 | 出站端口收紧：Worker 侧用户可控目标仅放行 80/443 |
| 4.6.5 | KV 写入总闸（分钟/每日预算 + 同键去抖）；监控心跳写 1h→6h；`/health` 暴露 `kvWrite` 遥测 |
| 4.6.4 | KV 防爆：测速历史改单键环形缓冲（去掉 list/批量 delete）；用量落盘最小间隔 + 故障退避 |
| 4.6.3 | 安全：页面会话令牌取代可伪造的 Origin/Referer 校验；修复测速带宽高估、Quad9 DoH 端口、多节点对比被同源校验拦截等问题 |

---

## 许可与第三方归属

- **代码**：[GNU AGPL-3.0](LICENSE)。你可以自由使用、修改、再分发；但**如果你修改后把它作为网络服务对外提供，必须向使用者提供对应源代码**（§13）。部署修改版时请把页脚源码链接换成你自己的仓库——详见 [CODE_OF_CONDUCT.md 13.3](CODE_OF_CONDUCT.md#133-agpl-30-13-对本项目的实际含义部署者必读)。
- **本文档**：CC BY 4.0。
- **第三方资源**：Font Awesome（图标 CC BY 4.0 / 代码 MIT）、Inter 字体（SIL OFL 1.1）、Cloudflare Workers 运行时与 CDN。请保留相应归属声明。

---

## 免责声明

- 所有诊断结果**仅供参考**，不代表任何服务等级承诺；不同网络环境、时段、运营商可能得出不同结论。
- 请**不要**把本站点体检 / 站点监控用于扫描、探测或骚扰他人站点；请仅对你拥有或获授权的目标使用。
- 自托管实例的**配额、费用与合规由部署者自行承担**；建议开启预算与用量告警。
- 本项目不对因使用本工具造成的任何直接或间接损失负责。

---

## 联系

- 一般问题 / 缺陷 / 功能建议：[GitHub Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues)
- 安全漏洞 / 敏感事项：`admin@bjhr.space`（或仓库私密报告）
- 行为问题：见 [CODE_OF_CONDUCT.md 第 9 节](CODE_OF_CONDUCT.md#9-举报渠道与保密)

如果这个项目对你有帮助，欢迎给个 ⭐ 或自建一个节点加入多节点对比。
