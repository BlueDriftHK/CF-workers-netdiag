# NetSight Pro

> 极简、零依赖、单文件的 Cloudflare Worker 网络诊断工具集 —— 打开网页即可测延迟、带宽、DNS、TLS、WebRTC 泄漏与站点安全，全部在你的浏览器里完成。


![version](https://img.shields.io/badge/version-5.1.1-2f6feb)
![runtime](https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![files](https://img.shields.io/badge/deploy-single%20file-6e7781)
![i18n](https://img.shields.io/badge/i18n-6%20languages-8250df)

**English summary** — NetSight Pro is a zero-dependency, single-file network diagnostics suite that runs on Cloudflare Workers. Latency, jitter, packet loss, bandwidth, DNS comparison, DoH, TLS/HTTP2, WebRTC leak, TTFB waterfall and site security-header audits all run in your browser; the Worker only handles tokens, rate limiting and the few endpoints that must originate from the edge. No build step, no database required (an optional KV namespace powers the monitoring feature). Deploy by pasting one file into a Worker, or with `wrangler`. UI ships in EN / 简体 / 繁體 / 日本語 / 한국어 / Español.

---

## 目录

- [一、这是什么](#一这是什么)
- [二、两种构建，先选一个](#二两种构建先选一个)
- [三、功能清单](#三功能清单)
- [四、设计取舍](#四设计取舍)
- [五、快速部署](#五快速部署)
- [六、配置项](#六配置项)
- [七、API 参考](#七api-参考)
- [八、安全模型](#八安全模型)
- [九、本地开发与自检](#九本地开发与自检)
- [十、目录结构](#十目录结构)
- [十一、常见问题](#十一常见问题)
- [十二、配额与性能](#十二配额与性能)
- [十三、已知限制](#十三已知限制)
- [十四、贡献](#十四贡献)
- [十五、致谢与许可](#十五致谢与许可)

---

## 一、这是什么

一个可以直接粘贴到 Cloudflare Workers 的 **单文件 JavaScript 程序**（不需要 Node、不需要打包、没有 `node_modules`）。它把两件事塞进了同一个文件：

1. **服务端（Worker）**：签发会话令牌、限流、SSRF 防护、提供测速/上传/CPU 等需要边缘节点参与的小接口，以及一个完全内嵌的网页。
2. **前端（浏览器）**：全部诊断逻辑（RTT、抖动、DNS、TLS、WebRTC、TTFB、瀑布图……），以 `APP_JS` 的形式内嵌在 Worker 里，运行时通过 `/app.css`、`/app.js` 提供。

**它不做什么**：不采集你的浏览记录、不要求登录、不把诊断数据上传到第三方（除你在页面里主动点击会用到 STUN / crt.sh / IP 查询之外，见[隐私说明](#隐私说明)）。

### 特点

| | |
|---|---|
| **单文件部署** | 12,110 行 / 706 KB 一个文件，粘贴即上线；前端 CSS/JS 内嵌并自动做内容哈希版本 |
| **零依赖** | 没有 `package.json`、没有构建步骤、没有第三方运行时 |
| **6 语言** | 简体中文 / 繁体中文 / English / 日本語 / 한국어 / Español，缺 key 自动回退英文 |
| **PWA** | 内置 service worker、manifest、图标，可安装到桌面 |
| **深/浅色** | 跟随系统或手动切换 |
| **安全设计** | HttpOnly Cookie 会话令牌、四级限流、SSRF 全链路防护、CSP、安全响应头 |
| **可验证** | 附带 4 套离线自检脚本（共 159 项断言），不需要联网也不需要真实浏览器 |

---

## 二、两种构建，先选一个

仓库里有两个可直接部署的版本，**功能代码完全相同，差别只在"要不要站点监控"**：

| | `_workers.js`（完整版） | `_workers-nokv.js`（无 KV 版） |
|---|---|---|
| 文件大小 | 706,896 B / 12,110 行 | **664,982 B / 11,333 行** |
| 全部浏览器侧诊断工具 | ✅ | ✅ |
| 本地历史 / 趋势 / 对比 | ✅ | ✅ |
| 站点监控（定时巡检 + Webhook 告警） | ✅ 需绑定 KV | ❌ 无此功能 |
| 需要 KV 命名空间 | 可选（不绑定即零写入） | **不需要** |
| 需要 Cron Trigger | 可选 | **不需要** |
| 可能产生 KV 写入的代码路径 | 4 处（均有前置判断） | **0 处** |
| 自检套件 | `tools/verify-all.mjs`（159 项） | `tools/verify-nokv.mjs`（21 项） |

**怎么选：**

- 怕 KV 额度被写爆、或只想白嫖免费额度 → **无 KV 版**（推荐给个人使用）。
- 需要"站点挂了自动发钉钉/飞书/Slack 告警" → 完整版 + 绑定 KV + Cron。
- 两个版本不能部署在同一个 Worker 名上，建议分别命名（如 `netsight` / `netsight-nokv`）。

---

## 三、功能清单

工具按 6 组分类，共 26 项（无 KV 版隐藏「站点监控」后为 25 项）。

### 质量与体验（quality）

| 工具 | 说明 |
|---|---|
| 一键体检 | 依次测延迟、DNS、HTTP/2、风险项，汇总评分与建议 |
| 智能诊断 | 引导式诊断：延迟/丢包 → DNS → 下行吞吐 → 协议，给出评分与可执行建议 |
| 长时质量监控 | 持续采样 RTT，输出 p50/p95/p99、抖动、卡顿时间线与稳定性评级 |
| 丢包测试 | 连续 10 次探测统计丢包率与失败样本（限流样本计入失败，不会虚报 0%） |
| TTFB 分析 | 拆解 DNS / TCP / TLS / 等待 / 下载；浏览器不提供分阶段数据时自动回退为总耗时并注明原因 |
| 资源瀑布 | 用 Performance API 画出当前页面资源的 DNS/TCP/TLS/TTFB/下载分段 |
| WebSocket 测试 | 建立 WS 连接测往返延迟与可用性 |
| 代理 / VPN 检测 | 对比「HTTP 出口 IP」与「WebRTC 反射 IP」，不一致通常意味着分流或代理未覆盖 UDP |
| WebRTC 泄漏 | 用 Cloudflare STUN 取 srflx 反射候选，按 host/mDNS/srflx/relay 分类展示并给出是否泄漏的结论 |

### 带宽（bandwidth）

| 工具 | 说明 |
|---|---|
| 带宽测速 | 单流下载，三种模式（快速/标准/精确），带 TTFB 与稳定度 |
| 多流并发 | 多路并行下载，观察总吞吐与单流差异 |
| 上传测速 | 分档上传，测客户端上行 |
| 缓冲区膨胀 | 加载态下测延迟增量，判断 bufferbloat 等级 |
| 流式下载 | 大流量流式读取，观察持续吞吐与卡顿 |
| 并发下载 | N 路并行下载同一资源，测并发效率与失败率 |

### DNS（dns）

| 工具 | 说明 |
|---|---|
| DNS 解析 | 查询 A/AAAA/CNAME/MX/TXT/NS/SOA/CAA |
| DNS 查询 | 指定域名 + 类型 + 黑名单检测 |
| DNS 对比 | 6 个解析器（Cloudflare/Google/Quad9/AdGuard/DNS.SB/AliDNS）DoH wireformat 并发对比，检测解析不一致与污染 |
| 域名安全体检 | MX/SPF/DMARC/DKIM/NS/CAA/DNSSEC/MTA-STS/BIMI + 黑名单，输出评分与问题清单 |

### 安全（security）

| 工具 | 说明 |
|---|---|
| 站点体检 | 审计目标站点的 HSTS / CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy / COOP 等并打分 |
| 域名安全体检 | 见上（DNS 层） |
| 代理/VPN 检测 | 见上（出口一致性） |
| WebRTC 泄漏 | 见上 |

### 可达性（reach）

| 工具 | 说明 |
|---|---|
| IP 连通性 | 用浏览器探测常见站点是否可达（no-cors favicon 探测，零 Worker 出站） |
| 可达性探测 | 多目标批量探测，给出可达/超时矩阵 |
| 多节点对比 | 输入其它 NetSight 节点 URL，并行测 `/node-ping` 延迟，比较各边缘节点 |

### 监控与信息（monitor）

| 工具 | 说明 |
|---|---|
| 网络信息 | 浏览器 Network Information API + 硬件信息 + 时区/语言 |
| CPU 性能 | Worker 端自校准基准测试（预热 + 按时间预算累加），返回真实 ops/ms；无法测量时明确返回 `null` 而不是编一个数 |
| 站点监控 | 定时巡检 + Webhook 告警（钉钉 / 飞书 / 企微 / Slack / Discord / Telegram / ntfy，或通用 JSON）+ 证书到期提醒；**仅完整版 + 绑定 KV 可用** |

### 页面其它能力

- **概览**：边缘节点、ASN、TLS/协议、JA3/JA4、真实 IP 位置、数据中心/机器人评分
- **历史统计**：本地历史（localStorage）+ 趋势图 + 日期分组 + 记录对比 + CSV/JSON 导入导出 + 内存用量统计
- **管理面板 `/admin`**：只读概览（站点配置、用量、可观测性指标），需 `x-admin-key`

---

## 四、设计取舍

| 决策 | 原因 |
|---|---|
| **单文件、内嵌前端** | 部署极简；代价是文件大，但 Cloudflare 免费版 1 MB/文件足够 |
| **零出站优先** | 能由浏览器做的诊断（RTT、DNS、TTFB、WebRTC、可达性）全部放浏览器，Worker 只做必须由边缘节点做的事 |
| **无状态令牌 + HttpOnly Cookie** | 不依赖数据库；令牌不落在 HTML/JS 里，XSS 也偷不走 |
| **限流 + 预算护栏** | 免费额度有限，宁可丢少量非关键数据，也不让一个异常循环打爆配额 |
| **监控可选** | 监控必须跨请求持久化状态，天然依赖 KV；不想用 KV 的用户可以直接用无 KV 版 |
| **不引入前端框架** | 一个文件、零构建；用原生 DOM + Canvas 手写渲染 |

---

## 五、快速部署

### 前置

- 一个 Cloudflare 账号（免费版即可）
- 二选一：浏览器（Dashboard）或 `wrangler`（Node 18+）

> ⚠️ **GitHub Pages 不能部署这个项目**——它是 Cloudflare Worker（需要在边缘运行 JS 并提供 API），不是静态站点。GitHub 只用来托管仓库/触发部署。

### 方式 A：Dashboard 粘贴（最快）

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Worker**。
2. 把 `_workers-nokv.js`（或 `_workers.js`）的全部内容粘贴进在线编辑器。
3. **Save and Deploy**。
4. 绑定自定义域名（可选）：Worker → Settings → Domains & Routes。

### 方式 B：wrangler 部署

```bash
npm i -g wrangler
wrangler login
```

`wrangler.toml`（无 KV 版）：

```toml
name = "netsight-nokv"
main = "_workers-nokv.js"
compatibility_date = "2025-01-01"

[vars]
# 建议配置：让会话令牌跨 isolate 有效（与 KV 无关）
PAGE_TOKEN_SECRET = "请替换为 32 字节以上随机串"
```

```bash
wrangler deploy
```

`wrangler.toml`（完整版 + 监控）：

```toml
name = "netsight"
main = "_workers.js"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "SPEED_HISTORY"
id = "把 KV 命名空间 id 填这里"

[triggers]
crons = ["*/5 * * * *"]

[vars]
PAGE_TOKEN_SECRET = "请替换为 32 字节以上随机串"
MONITOR_ADMIN_KEY = "请替换为 24 字节以上随机串"
```

创建 KV：`wrangler kv namespace create SPEED_HISTORY`

### 方式 C：GitHub + Workers Builds（推荐）

1. 把仓库推到 GitHub，根目录放 `_workers-nokv.js`（或 `_workers.js`）与 `wrangler.toml`。
2. Cloudflare Dashboard → **Workers & Pages** → 你的 Worker → **Settings** → **Build** → **Connect Git repository**。
3. 构建设置：
   - Build command：留空（没有构建步骤）
   - Deploy command：`npx wrangler deploy`
4. 之后每次 `git push` 自动部署。

### 方式 D：GitHub Actions

`.github/workflows/deploy.yml`：

```yaml
name: Deploy Worker

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

需要在仓库 **Settings → Secrets and variables → Actions** 里添加：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 权限至少 `Workers Scripts:Edit`、`Workers KV Storage:Edit`（若用完整版） |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 右侧栏的 Account ID |

### 部署后自检

```bash
curl -I https://你的域名/                 # 200 + 安全响应头 + Set-Cookie: __Host-ns_t=...
curl -o /dev/null -w '%{http_code}\n' https://你的域名/health        # 403（没有令牌，符合设计）
curl -o /dev/null -w '%{http_code}\n' https://你的域名/nope          # 404
curl -o /dev/null -w '%{http_code}\n' https://你的域名/api/ip-fraud  # 410（已下线）
curl -o /dev/null -w '%{http_code}\n' https://你的域名/x              # 404
```

> 浏览器里的"全部功能是否正常"，用页面上的**一键体检**跑一遍最快。

---

## 六、配置项

### 环境变量 / Secret

| 名称 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `PAGE_TOKEN_SECRET` | Secret | **建议必填** | ≥32 字节随机串。配置后页面令牌为无状态 HMAC，跨 isolate 有效；不配置则退化为 per-isolate 内存令牌（多实例会随机 403），新版本在无 secret 时会自动降级为 Fetch Metadata 校验以免随机失败 |
| `MONITOR_ADMIN_KEY` | Secret | 可选 | 监控配置/管理面板/`/metrics` 的密钥；≥24 字节，不要与 `metricsKey` 复用；连续 10 次失败封 10 分钟 |
| `ALLOWED_ORIGINS` | 文本 | 可选 | 逗号分隔的跨域白名单（如 `https://a.com,https://b.com`）。**禁止填 `*`**；白名单内的 Origin 会跳过令牌校验 |
| `SITE_CONFIG` | 文本(JSON) | 可选 | 站点白标配置，见下 |
| `SPEED_HISTORY` | KV 绑定 | 仅完整版监控需要 | 存监控配置/状态/日志；不绑定时监控工具自动禁用 |
| Cron Trigger | 触发器 | 仅完整版监控需要 | 建议 `*/5 * * * *`，不要更密 |

### `SITE_CONFIG` 字段

```json
{
  "siteName": "NetSight Pro",
  "defaultLang": "zh-CN",
  "disabledTools": ["monitor", "cpu"],
  "disabledEndpoints": ["/api/site-audit"],
  "metricsKey": "可选：/metrics 的独立密钥",
  "offline": true,
  "certCheck": true
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `siteName` | string(≤40) | 站点名，会显示在标题与页脚 |
| `defaultLang` | `en` / `zh-CN` / `zh-TW` / `ja` / `ko` / `es` | 默认语言（仍可手动切换） |
| `disabledTools[]` | string[] | 隐藏指定工具卡片，如 `["monitor","cpu"]` |
| `disabledEndpoints[]` | string[] | 直接返回 403 的端点（**精确匹配**，注意结尾不要带 `/`） |
| `metricsKey` | string | 为 `/metrics` 单独设密钥 |
| `offline` | boolean | 隐藏需要出站的入口 |
| `certCheck` | boolean | 是否启用证书到期检查（完整版监控用） |

---

## 七、API 参考

### 鉴权说明

- **页面会话令牌**：打开页面时通过 `Set-Cookie: __Host-ns_t=…; HttpOnly; SameSite=Strict; Secure` 下发，令牌**不出现在 HTML/JS 里**，同源请求自动携带。
- **跨域**：把来源加入 `ALLOWED_ORIGINS` 即视为已授权。
- **管理密钥**：`x-admin-key` 请求头，恒定时间比较；不接受 URL 参数。
- **无 secret 部署**：令牌校验降级为「浏览器 Fetch Metadata 同源校验」，裸脚本仍会被 403。

### 端点列表

| 路径 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/` | GET | 无 | 主页面（同时下发会话 Cookie） |
| `/admin` | GET | 无（数据需 key） | 管理面板页面 |
| `/app.css` `/app.js` `/sw.js` `/manifest.webmanifest` `/icon*` | GET | 无 | 静态资源（长缓存，URL 带内容哈希） |
| `/health` | GET | 令牌 | 存活检查，仅返回 `{status,timestamp}` |
| `/api/page-token` | GET | 同源浏览器上下文 | 续期 Cookie，响应体不含令牌 |
| `/speedtest` | GET | 令牌 | 下载测速，`?size=` 1B–25MB，>2MB 走流式 |
| `/upload-test` | POST | 令牌 | 上传测速，body ≤32MB |
| `/stream-test` | GET | 令牌 | 流式下载，`?size=` ≤5MB |
| `/ws-test` | GET | 令牌 | WebSocket 往返测试（Upgrade） |
| `/cpu-test` | GET | 令牌 | CPU 基准（自校准，3 次/分/IP） |
| `/http2-test` | GET | 令牌 | 协议/H2/H3 探测 |
| `/node-ping` | GET | 无 | 公开节点探测（供多节点对比），`Access-Control-Allow-Origin: *` |
| `/api/dns-lookup` | GET | 令牌 | `?name=&type=` |
| `/api/dnsbl` | GET | 令牌 | 黑名单检测 |
| `/api/dns-compare` | GET | 令牌 + 浏览器上下文 | 6 解析器并发对比，独立 15/分/IP |
| `/api/domain-check` | GET | 令牌 + 浏览器上下文 | 域名安全体检，独立 15/分/IP |
| `/api/site-audit` | GET | 令牌 + 浏览器上下文 | HTTP 安全头审计，`?url=&cert=1`，独立 5/分/IP |
| `/api/log-speed` | POST | 令牌 | 测速历史写入（无 KV 版为 no-op，返回 `{ok:true,stored:false}`） |
| `/api/speed-history` | GET | 令牌 | 服务端历史（无 KV 版返回 410） |
| `/api/usage-stats` | GET | 令牌 | 内存用量统计 |
| `/api/monitor` | GET/POST | 令牌 + `x-admin-key` | 监控配置读写（无 KV 版 410） |
| `/api/monitor-run` | POST | 令牌 + `x-admin-key` | 立即巡检（无 KV 版 410；60s 内限一次） |
| `/api/admin/overview` | GET | 令牌 + `x-admin-key` | 管理概览 |
| `/metrics` | GET | `x-metrics-key` 或 `x-admin-key` | Prometheus 指标 |

**返回 410（已下线）**：`/api/ip-fraud`、`/dns-proxy`、`/static/*`
**已删除**：`/concurrent-test`（前端的并发下载改为 N 路真实 `/speedtest`）
**其它未匹配路径**：返回 404（不再回退到主页面）

### curl 示例

```bash
# 1) 取 Cookie（页面会 Set-Cookie）
curl -c cookie.txt https://你的域名/ -o /dev/null

# 2) 带 Cookie 调受保护端点
curl -b cookie.txt https://你的域名/health
curl -b cookie.txt "https://你的域名/speedtest?size=1048576" -o /dev/null -w '%{speed_download}\n'

# 3) 跨域授权（需在 ALLOWED_ORIGINS 里配置来源）
curl -H 'Origin: https://your-app.com' -H 'Sec-Fetch-Site: same-origin' \
     "https://你的域名/api/dns-lookup?name=example.com&type=A"

# 4) 管理端点
curl -H "x-admin-key: $ADMIN_KEY" https://你的域名/api/admin/overview
curl -H "x-admin-key: $ADMIN_KEY" https://你的域名/metrics
```

---

## 八、安全模型

### 会话与鉴权

- 令牌只通过 **HttpOnly + SameSite=Strict + Secure** 的 `__Host-` Cookie 下发，页面脚本读不到。
- 令牌 1 小时有效，403 时前端自动续期并重试**一次**，不会刷新风暴。
- 管理密钥恒定时间比较、失败退避（10 次/10 分钟/IP）、只走请求头。

### 限流（按 `cf-connecting-ip`）

| 桶 | 上限 |
|---|---|
| 默认（工具端点） | 60 次/分/IP |
| `/health` | 180 次/分/IP（RTT 轮询专用） |
| 大响应下载（`/speedtest` >2MB、`/upload-test`、`/stream-test`） | 30 次/分/IP |
| `/api/site-audit` | 5 次/分/IP |
| DNS 工具（`dns-compare` / `domain-check`） | 15 次/分/IP |
| 令牌签发 | 10 次/分/IP |
| 静态资源 | 600 次/分/IP |
| `/cpu-test` | 3 次/分/IP |

### SSRF 防护

所有接受 URL 的入口（站点体检、监控目标、Webhook）都经过：

1. 协议白名单（http/https）+ 端口白名单（80/443）
2. 私网判定：IPv4 全保留段、IPv6 ULA/链路本地/组播/6to4/Teredo/NAT64/IPv4 映射，**以及 `127.1`、`0177.0.0.1`、`0x7f.0.0.1` 这类编码型 IP**（fail-closed）
3. `resolvToPublicOnly` DoH 解析校验，解析失败视为不安全
4. 重定向 `manual` 逐跳复检，且**出站前强制重新解析**，把 DNS 重绑定窗口压到毫秒级
5. 响应体丢弃/限长，避免大 body 占资源

### 输出与浏览器侧

- 全部动态内容经 `escapeHTML` / `safeJsonForScript` 转义；无 `eval`、`new Function`、`document.write`
- CSP：`script-src 'self' 'nonce-…'`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`、`form-action 'none'`
- 安全响应头：`nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、HSTS、`Permissions-Policy`
- 动态响应统一 `cache-control: no-store` + `vary: Origin`

### 隐私说明

- Worker **默认不主动向第三方发请求**；诊断请求由你的浏览器发起。
- 会用到外部服务的功能（都在你主动点击时触发）：
  - **WebRTC 泄漏** → `stun.cloudflare.com:3478`（会向 Cloudflare 暴露你的公网 IP）
  - **真实 IP 位置** → `ipify` / `icanhazip` / `seeip` / `ipapi.co`
  - **证书信息** → `crt.sh`（仅完整版监控或站点体检勾选证书时）
- 本地历史只存在浏览器 `localStorage`，不会上传；分享链接已移除 IP / 运营商 / 边缘节点。

---

## 九、本地开发与自检

不需要安装依赖，只需 Node 18+（推荐 20+）。

```bash
# 完整版：四套回归（单元 / 路由 / 告警状态机 / 静态护栏）
node tools/verify-all.mjs _workers.js

# 无 KV 版：专项验证（静态契约 + 关键路由）
node tools/verify-nokv.mjs _workers-nokv.js

# 单跑某一套
node tools/check-worker.mjs _workers.js       # Worker 解析 + 内嵌 APP_JS 编译 + 纯函数断言
node tools/route-smoke.mjs _workers.js        # 在 vm 里真实执行 handleRequest
node tools/monitor-scenarios.mjs _workers.js  # 告警状态机（完整版）
node tools/static-audit.mjs _workers.js       # 静态护栏（防危险写法复活）
```

| 套件 | 覆盖 | 断言数 |
|---|---|---|
| `check-worker.mjs` | 语法、内嵌前端编译、SSRF/证书/DNS/令牌等纯函数 | 44 |
| `route-smoke.mjs` | 鉴权、404/405/410、Cookie、CSP、爆破封禁、监控配置、零-KV 降级 | 34 |
| `monitor-scenarios.mjs` | 阈值、去重、恢复、静默补发、webhook 重试、证书误报 | 11 |
| `static-audit.mjs` | 危险写法不得复活 + 关键防护必须在位 | 70 |
| `verify-nokv.mjs` | 无 KV 构建的静态契约与路由行为 | 21 |

**修改代码后必须做的三件事**：

```bash
node --check _workers.js          # 语法
node tools/verify-all.mjs _workers.js
# 若改了无 KV 版：node tools/verify-nokv.mjs _workers-nokv.js
```

> 前端代码在 `APP_JS` 模板字符串里，改它时注意反引号与 `${` 需要转义；自检脚本会单独编译内嵌脚本，能抓到这类错误。

---

## 十、目录结构

```
.
├── _workers.js                 # 完整版（含可选站点监控）
├── _workers-nokv.js            # 无 KV 版（监控已移除，零写入路径）
├── wrangler.toml               # 部署配置（按需选择对应 main）
├── README.md
├── 修复记录-v5.1.1.md           # 逐项修复记录（P1/P2/P3 + 补充项）
├── 无KV版报告.md                # 无 KV 版交付报告
└── tools/
    ├── verify-all.mjs          # 完整版总入口
    ├── verify-nokv.mjs         # 无 KV 版总入口
    ├── check-worker.mjs
    ├── route-smoke.mjs
    ├── monitor-scenarios.mjs
    └── static-audit.mjs
```

---

## 十一、常见问题

**Q：工具时好时坏、随机 403？**
A：`PAGE_TOKEN_SECRET` 没配，旧版本令牌只存在单个 isolate。v5.1.1 起：配置该 secret（推荐）或使用会自动降级的新版本。

**Q：站点监控显示"未绑定 KV / 410"？**
A：你用的是无 KV 版，或完整版没绑定 KV。监控必须跨请求保存状态，需要 KV；其余功能不受影响。

**Q：WebRTC 一直显示"无法判定"？**
A：看结果里的 `ICE` 行：`mDNS > 0 且 srflx = 0` 说明 UDP 3478 被网络拦截（公司网/部分移动网络常见）；`host 0 · mDNS 0` 说明浏览器或插件禁用了 WebRTC。

**Q：TTFB 只有总耗时，没有 DNS/TCP/TLS 分项？**
A：浏览器没有暴露 Resource Timing（隐私设置/插件/旧内核）。工具会自动回退为手动计时并标注"phase breakdown unavailable"。

**Q：CPU 性能显示 20000 ops/ms？**
A：那是 v5.1.0 的已知 bug（把迭代次数当吞吐）。v5.1.1 已改为自校准，显示真实量级（约 1e4）。

**Q：KV 会不会被写爆？**
A：完整版有硬护栏（单 isolate 150 写/天、12 写/分、同键 10s 去抖、告警节流 10 分钟），且用量统计默认内存、测速历史默认关闭；完全不想碰 KV 就用无 KV 版——**0 条写入路径**。

**Q：历史记录换浏览器/清缓存后没了？**
A：历史存在 `localStorage`，属预期。可用"导出 JSON"备份、换设备后"导入"。

**Q：访问 `/static/xxx` 返回 410？**
A：静态资源走 `/app.js`、`/app.css`，`/static/` 前缀已下线。

**Q：为什么访问任意路径都 404？**
A：v5.1.1 起只有 `/`、`/index.html`、`/admin` 与静态资源会返回内容，其它路径 404（避免误导 API 调用方与绕过端点禁用）。

**Q：静默时段按哪个时区？**
A：按浏览器时区（前端提交 `-getTimezoneOffset()/60`），未提交时默认 UTC+8。

---

## 十二、配额与性能

以 Cloudflare **免费版**为例：

| 资源 | 免费额度 | 本项目的控制手段 |
|---|---|---|
| Worker 请求 | 100,000/天 | 端点级限流 + 静态资源独立桶 |
| CPU 时间 | 10 ms/请求 | 测速用 256 KB 随机模板复用；CPU 基准自校准并设上限 |
| 响应体 | 无硬限制但计流量 | `/speedtest` 单次 ≤25 MB，流式生成，慢读者 30s 截止 |
| KV 写 | 1,000/天（若绑定） | 单 isolate 预算 150/天 + 12/分 + 去抖；无 KV 版为 0 |
| KV 读 | 100,000/天 | 60s 内存缓存；无 KV 版为 0 |
| 子请求 | 50/请求（免费） | 单请求最多 12 次 DoH；巡检有总 deadline |

---

## 十三、已知限制

1. **必须以 Cloudflare Worker 运行**，不能放 GitHub Pages / 普通静态托管（需要服务端签发令牌与测速接口）。
2. **CSP 的 `connect-src` 保留 `https:`**：多节点对比需要浏览器直连用户输入的任意节点，收紧会废掉该功能；其余 CSP 指令均已收紧。
3. **完整版监控依赖 KV**（或未来的 DO/D1）；无 KV 版直接不含该功能。
4. **站点体检**最多发起 3 次请求（跟随 2 跳重定向），总耗时上限 10 秒。
5. **无 secret 部署时**令牌校验降级为 Fetch Metadata，安全性略低于无状态 HMAC，但裸脚本仍被拦截。
6. 部分浏览器扩展会拦截 WebRTC/Resource Timing，导致相应工具显示"无法判定"，属预期降级。

---

## 十四、贡献

欢迎 Issue / PR，但请遵守：

1. **保持单文件可部署**：不要引入构建步骤或运行时依赖。
2. **提交前必须通过自检**：
   ```bash
   node --check _workers.js
   node tools/verify-all.mjs _workers.js
   # 改动无 KV 版时：
   node tools/verify-nokv.mjs _workers-nokv.js
   ```
3. **新增 i18n 文案**：至少同时补 `en` 与 `zh-CN`（其余语言会自动回退英文），6 语言齐全更好。
4. **新增端点**：必须接入限流桶、鉴权、`no-store` 响应头，并在 README 的 API 表格登记。
5. **安全相关改动**：说明威胁模型；不要降低 SSRF/鉴权/转义标准。
6. 前端代码在 `APP_JS` 模板字符串内，注意反引号与 `${` 的转义。

---

## 十五、致谢与许可

- 灵感与早期版本来自 [BlueDriftHK/CF-workers-netdiag](https://github.com/BlueDriftHK/CF-workers-netdiag)。
- 运行平台：[Cloudflare Workers](https://workers.cloudflare.com/)；DNS over HTTPS 对比使用 Cloudflare / Google / Quad9 / AdGuard / DNS.SB / AliDNS 的公开 DoH 服务。
- 图标：[Font Awesome](https://fontawesome.com/)（CDN 引入）。

**License**：本仓库当前未附带 `LICENSE` 文件。若计划公开分发，建议补充 **MIT License**（或你偏好的开源协议），并在 README 顶部加上 badge。

**免责声明**：本工具仅用于诊断你自有或已获授权的网络与站点。请勿用于扫描、探测或攻击他人资产；使用者需自行承担合规责任。
