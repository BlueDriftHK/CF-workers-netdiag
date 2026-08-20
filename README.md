# NetSight Pro · 极光网络诊断工具

[![Cloudflare Worker](https://img.shields.io/badge/Cloudflare-Worker-F38020?logo=cloudflare&style=for-the-badge)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-4.1--security-brightgreen?style=for-the-badge)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](https://github.com/BlueDriftHK/CF-workers-netdiag/pulls)

> **NetSight Pro** 是一款部署在 Cloudflare Workers 上的全功能网络诊断工具，提供实时延迟监控、带宽测速、CPU 性能测试、WebSocket 延迟、TTFB 分阶段分析、WebRTC 泄漏检测、多节点对比等 **20+ 项诊断能力**，并支持三语言国际化（English/简体中文/繁體中文）和深色/浅色主题。代码经过安全加固，适合个人或企业快速部署私有网络健康检查服务。

---

## 📋 目录

- [✨ 特性总览](#-特性总览)
- [📸 界面预览](#-界面预览)
- [🧱 技术架构](#-技术架构)
- [🚀 快速部署（3 分钟）](#-快速部署3-分钟)
- [🛠️ 详细部署步骤](#️-详细部署步骤)
  - [方式一：使用 Wrangler CLI（推荐）](#方式一使用-wrangler-cli推荐)
  - [方式二：通过 Cloudflare Dashboard](#方式二通过-cloudflare-dashboard)
- [⚙️ 环境变量与 KV 绑定](#️-环境变量与-kv-绑定)
- [📌 所有 API 端点详解](#-所有-api-端点详解)
- [🖱️ 前端功能详解](#️-前端功能详解)
- [🔒 安全机制](#-安全机制)
- [🌐 国际化与主题](#-国际化与主题)
- [⚡ 性能与可靠性](#-性能与可靠性)
- [🛠️ 自定义与扩展](#️-自定义与扩展)
- [❓ 常见问题与故障排查](#-常见问题与故障排查)
- [📄 许可证与贡献](#-许可证与贡献)

---

## ✨ 特性总览

| 类别 | 功能 | 描述 |
|------|------|------|
| 📡 **网络质量** | 实时 RTT 监控 | 每 2 秒发送 HEAD 请求，绘制延迟趋势图，计算抖动、最低/最高 RTT、丢包率 |
| | 带宽测速（下载） | 多档位（100KB~2MB）下载测试，计算平均速度 |
| | 带宽测速（上传） | 多档位（256KB~2MB）上传测试，计算上行速率 |
| | 并发下载测试 | 模拟 4/6/8 路并发请求，检测多连接处理能力 |
| | 流式传输吞吐量 | 流式读取大文件（最大 10MB），测试长连接吞吐 |
| | TTFB 分阶段分析 | 分解 DNS 解析、TCP 连接、TLS 握手、等待响应、内容下载各阶段耗时 |
| 🔒 **协议与安全** | HTTP/2 / HTTP/3 检测 | 判断连接是否使用 HTTP/2 或 QUIC，并显示 ALPN 信息 |
| | TLS 信息 | 显示 TLS 版本、加密套件、客户端 Hello 长度（ECH 推断） |
| | 客户端指纹 | 显示 JA3 和 JA4 指纹（用于会话识别） |
| | 机器人评分 | 展示 Cloudflare 的 Bot Management 评分（0~100） |
| | 压缩算法 | 检测客户端支持的压缩算法（br/gzip/deflate/zstd） |
| 🌍 **IP 与位置** | 双栈 IP 检测 | 分别获取 IPv4 和 IPv6 地址（使用多个公共 API 备用） |
| | 地理位置 | 通过 ipapi.co 获取客户端真实地理位置（城市、国家、运营商） |
| | 距离计算 | 计算客户端到 Cloudflare 边缘节点的直线距离 |
| | IP 欺诈评分 | 集成 Scamalytics API，检测 IP 是否为代理/VPN/Tor/托管，并给出风险等级 |
| 💻 **客户端环境** | 硬件信息 | 屏幕分辨率、CPU 核心数、时区、语言、操作系统平台 |
| | WebRTC 泄漏检测 | 检测本地/公网 IP 是否通过 WebRTC 泄露 |
| | 流媒体连通性 | 检测 Netflix/Disney+/YouTube/ChatGPT 的 favicon 是否可达 |
| 📊 **对比与历史** | 多节点对比 | 输入其他 Worker 节点 URL，并行测试延迟，生成对比表格 |
| | 测速历史 | 存储最近 5 条测速记录（需 KV 支持），展示时间、速度、边缘节点 |
| | API 用量统计 | 统计各端点调用次数（需 KV 支持） |
| 🎨 **用户交互** | 一键复制报告 | 生成纯文本诊断报告，包含所有关键指标 |
| | 主题切换 | 深色/浅色/跟随系统，自动适配 |
| | 语言切换 | 英语、简体中文、繁體中文，界面完全覆盖 |

---

## 📸 界面预览

（由于无法直接插入图片，请自行部署后访问。界面为毛玻璃质感，带极光背景动画，风格类似 macOS 的简约设计。）

- **头部**：Logo、主题按钮、语言切换器
- **主卡片**：IPv4/IPv6 地址、边缘节点、Worker 耗时、实时状态点
- **RTT 监控卡片**：四个大数字（当前/抖动/最低/最高）、动态折线图、四个质量指标（连接质量、稳定性、样本数、丢包率）
- **安全与协议卡片**：数据中心标识、风险等级、ASN、协议、TLS 版本、加密套件、ECH、压缩、HTTP/2、Bot 分数、JA3/JA4
- **位置信息卡片**（双栏）：边缘节点位置（城市/坐标/运营商）和真实 IP 位置（含距离及欺诈评分表格）
- **硬件信息条**：屏幕、CPU、时区、语言、平台
- **诊断工具集**：12 个按钮，点击后动态展示结果
- **历史与统计**：测速历史表格、用量统计（总请求数 + 端点调用排行）
- **底部**：RAY ID、客户端 IP、复制报告按钮

---

## 🧱 技术架构

### 后端（Cloudflare Worker）
- **运行时**：Cloudflare Workers（基于 V8 引擎）
- **语言**：JavaScript（ES2020）
- **存储**：可选 KV（`SPEED_HISTORY` 和 `CACHE_KV`）
- **API 设计**：RESTful，返回 JSON 或二进制流
- **并发控制**：自定义 `pLimit` 函数限制并发数
- **限流**：内存 Map（per‑isolate），可扩展为 KV/DO
- **安全头**：HSTS、X-Frame-Options、CSP、CORS 白名单

### 前端（原生 SPA）
- **框架**：纯原生 JavaScript，无第三方依赖（除字体与图标库）
- **图表**：Canvas 2D 绘制实时折线图
- **WebSocket**：支持 `wss://` 双向通信测试
- **响应式**：CSS Grid + Flexbox，适配桌面、平板、手机
- **存储**：localStorage 保存语言偏好和主题

### 外部服务依赖
- **IP 查询**：ipapi.co（地理位置、ISP）
- **IP 检测**：api4.ipify.org、api6.ipify.org、ipv4.icanhazip.com、ipv6.icanhazip.com、ip4.seeip.org
- **欺诈评分**：scamalytics.com
- **字体**：Google Fonts（Inter）
- **图标**：Font Awesome 6

---

## 🚀 快速部署（3 分钟）

如果你已熟悉 Cloudflare Workers，可快速完成：

1. **克隆仓库**
   ```bash
   git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
   cd CF-workers-netdiag
   ```

2. **安装 Wrangler**
   ```bash
   npm install -g wrangler
   ```

3. **登录 Cloudflare**
   ```bash
   wrangler login
   ```

4. **创建 KV（可选但推荐）**
   ```bash
   wrangler kv:namespace create "SPEED_HISTORY"
   ```

5. **编辑 `wrangler.toml`**，填入 KV ID 和账号 ID。

6. **发布**
   ```bash
   wrangler publish
   ```

7. 访问 Worker 分配的 URL，即可使用。

---

## 🛠️ 详细部署步骤

### 方式一：使用 Wrangler CLI（推荐）

#### 前置条件
- Node.js 16+ 和 npm
- Cloudflare 账号
- （可选）Cloudflare 付费计划（用于自定义域名和 KV 额度）

#### Step 1: 安装 Wrangler
```bash
npm install -g wrangler
```

#### Step 2: 克隆项目
```bash
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag
```

#### Step 3: 登录 Cloudflare
```bash
wrangler login
```
浏览器会自动打开 Cloudflare 授权页面，点击允许即可。

#### Step 4: 创建 KV 命名空间（用于存储测速历史和用量统计）
```bash
# 创建生产环境 KV
wrangler kv:namespace create "SPEED_HISTORY"
```
输出会显示类似：
```
🌀 Creating namespace with title "netsight-pro-SPEED_HISTORY"
✨ Success! Worker KV namespace created:
{ binding: "SPEED_HISTORY", id: "abc123def456" }
```
记下 `id`，后面需要填入 `wrangler.toml`。

如果你想额外缓存静态资源，还可以创建另一个 KV：
```bash
wrangler kv:namespace create "CACHE_KV"
```

#### Step 5: 配置 `wrangler.toml`
在项目根目录创建或编辑 `wrangler.toml`：

```toml
name = "netsight-pro"
type = "javascript"
account_id = "你的账号ID"   # 可在 Cloudflare Dashboard 的 Workers 页面找到
workers_dev = true

# 绑定 SPEED_HISTORY KV（必须与上面创建的 ID 一致）
[[kv_namespaces]]
binding = "SPEED_HISTORY"
id = "abc123def456"

# 可选：绑定静态资源缓存 KV
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "your-cache-kv-id"

# 环境变量（可选）
[vars]
ALLOWED_ORIGINS = "https://yourdomain.com,https://another.com"
```

> **说明**：`account_id` 可在 Cloudflare Dashboard 的 “Workers & Pages” → “概述” 页面右下角找到。

#### Step 6: （可选）添加自定义域名
如果你希望使用自己的域名，可以在 Cloudflare Dashboard 的 “Workers & Pages” → 选择你的 Worker → “触发器” → “自定义域” 中添加，然后配置 DNS 记录。

#### Step 7: 发布 Worker
```bash
wrangler publish
```
首次发布可能需要几秒钟。完成后会显示一个 `.workers.dev` 子域名，例如 `netsight-pro.your-subdomain.workers.dev`。

#### Step 8: 验证部署
访问该域名，应看到 NetSight Pro 的主界面。若页面正常加载，说明部署成功。

---

### 方式二：通过 Cloudflare Dashboard

适用于不想安装 Node.js 的用户。

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 点击左侧菜单 “Workers & Pages” → “创建应用程序” → “创建 Worker”。
3. 在编辑器中，将本项目的 `worker.js` 代码复制粘贴进去。
4. 在 “设置” → “变量” 中添加 KV 命名空间绑定：
   - 变量名称：`SPEED_HISTORY`
   - 值：选择一个已创建的 KV 命名空间（如果没有，需先创建）
   - 同样可添加 `CACHE_KV`。
5. 在 “设置” → “环境变量” 中添加 `ALLOWED_ORIGINS`（可选）。
6. 点击 “保存并部署”。
7. 部署后，Worker 会分配一个 `.workers.dev` 域名，即可访问。

> **注意**：Dashboard 方式无法使用 Wrangler 的本地调试和热更新，建议仅用于快速测试。

---

## ⚙️ 环境变量与 KV 绑定

| 变量名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| `ALLOWED_ORIGINS` | 环境变量 | 否 | 允许跨域请求的 Origin 列表（逗号分隔）。若未设置或为空，则仅允许同源请求。 |
| `SPEED_HISTORY` | KV 绑定 | 否 | 用于存储测速历史和用量统计。若未绑定，历史记录功能将降级（仅显示“暂无记录”）。 |
| `CACHE_KV` | KV 绑定 | 否 | 用于缓存静态资源（如 `/static/` 下的文件）。若未绑定，将使用 Workers Cache API。 |

> 强烈建议绑定 `SPEED_HISTORY` 以启用完整功能。

---

## 📌 所有 API 端点详解

| 端点 | 方法 | 参数 | 描述 | 响应格式 |
|------|------|------|------|----------|
| `/` | GET | - | 主诊断页面（HTML） | `text/html` |
| `/health` | GET | - | 健康检查 | JSON `{ status, version }` |
| `/speedtest` | GET | `size` (1~5MB) | 下载速度测试（生成随机字节） | `application/octet-stream` |
| `/upload-test` | POST | 二进制 body | 上传速度测试（最大 10MB） | JSON `{ bytes, duration, speedMbps }` |
| `/cpu-test` | GET | `n` (1~500k) | CPU 基准测试 | JSON `{ duration, iterations, opsMs, result }` |
| `/dns-proxy` | GET | `url` (白名单域名) | DNS 代理测试（HEAD 请求） | JSON `{ time, status }` 或 `{ error }` |
| `/ws-test` | GET | - | WebSocket 握手（需 Upgrade 头） | WebSocket 连接 |
| `/http2-test` | GET | - | HTTP/2/3、TLS 信息检测 | JSON `{ http2, http3, protocol, tlsVersion, earlyHints, alpn }` |
| `/concurrent-test` | GET | `count` (1~16), `size` (1~64KB) | 并发下载测试 | JSON 数组 `[{ index, size, duration }]` |
| `/stream-test` | GET | `size` (1~10MB) | 流式大文件传输 | `application/octet-stream` |
| `/api/log-speed` | POST | `{ avgSpeed, results }` | 记录测速结果到 KV | JSON `{ ok }` 或错误 |
| `/api/speed-history` | GET | `limit` (1~20) | 查询测速历史 | JSON 数组 |
| `/api/usage-stats` | GET | - | 查询用量统计 | JSON `{ totalRequests, endpoints }` |
| `/api/ip-fraud` | GET | - | IP 欺诈评分 | JSON `{ score, isProxy, isVpn, isTor, isHosting, riskLevel }` |
| `OPTIONS` | OPTIONS | - | CORS 预检 | 空响应体，含 CORS 头 |

所有端点在响应中均携带安全头，敏感端点实施同源保护。

---

## 🖱️ 前端功能详解

### 实时 RTT 监控
- 每隔 2 秒向当前页面发送 HEAD 请求（带缓存破坏参数），计算往返时间。
- 存储最近 40 个样本，绘制折线图（Canvas），填充渐变区域。
- 动态计算：
  - **抖动**：当前 RTT 与上次 RTT 的绝对值的移动平均（窗口 10）。
  - **最低/最高 RTT**：自页面加载以来的极值。
  - **丢包率**：连续失败次数 + 总失败次数 / 总样本数。
- **质量等级**：根据当前 RTT 分为 Excellent / Good / Fair / Poor / Very Poor。
- **稳定性等级**：根据平均抖动分为 Very Stable / Stable / Unstable / Very Unstable。

### 地理位置与距离
- 页面加载后，通过 `navigator` 或 `ipapi.co` 获取客户端真实 IP 地理位置。
- 利用 Haversine 公式计算客户端到边缘节点（`cf.latitude/longitude`）的距离，以公里显示。

### 诊断工具集（12 个测试按钮）
每个按钮点击后，会显示一个临时结果区域，展示测试结果（支持成功/错误状态，带图标和颜色标识）。

| 按钮 | 测试内容 | 输出示例 |
|------|----------|----------|
| 丢包率 | 连续 10 次 HEAD 请求，统计失败次数 | `0% (无丢包)` 或 `10% (1/10 丢失)` |
| 带宽测速 | 依次下载 100KB、500KB、2MB，计算速度 | 显示各档位 Mbps 和平均速度 |
| DNS 解析 | 使用 Image 对象加载 favicon，测量 DNS 时间（实际包含连接时间） | 各域名耗时（ms） |
| CPU 性能 | 发送 `/cpu-test?n=500000` | ops/ms 和总耗时 |
| WebSocket | 建立 WebSocket，进行 5 次 ping/pong | 平均、最小、最大延迟 |
| 并发测试 | 请求 `/concurrent-test?count=4/6/8&size=2KB` | 各并发数的平均耗时 |
| 流式传输 | 依次下载 128KB、512KB、2MB 流数据 | 各档位吞吐量（Mbps） |
| 流媒体连通性 | 加载 Netflix/Disney+/YouTube/ChatGPT 的 favicon | 每个服务的可达性（✅/❌） |
| 多节点对比 | 弹出对话框输入节点 URL，并行测试 `/speedtest?size=1` | 表格列出每个节点的延迟和状态 |
| WebRTC 泄漏 | 创建 RTCPeerConnection，收集 ICE 候选 | 显示本地和公网 IP（如有） |
| TTFB 分析 | 使用 PerformanceObserver 捕获 `/health` 请求的各阶段耗时 | 条形图显示 DNS/TCP/TLS/等待/下载 |
| 上传测速 | 依次上传 256KB、1MB、2MB 随机数据 | 各档位上传速度（Mbps）和平均速度 |

### 历史与统计
- **测速历史**：从 `/api/speed-history` 获取数据，显示最近 5 条记录，用速度条直观展示。
- **用量统计**：从 `/api/usage-stats` 获取总请求数和最常调用的端点（最多 8 个）。

### 报告生成
点击“复制报告”按钮，会生成一份包含以下内容的纯文本报告：
- 诊断时间、边缘节点、客户端 IP、RAY ID
- 当前 RTT、抖动、最低/最高 RTT、质量/稳定性/丢包率
- 协议、TLS 版本、加密套件、ECH、压缩、HTTP/2、Bot 评分
- 边缘位置、真实 IP 位置、ISP
- IP 风险信息（若已加载）
- 附带生成时间戳和来源声明。

---

## 🔒 安全机制

### 1. 请求来源限制
- **同源导航检查**：所有敏感端点（`/speedtest`、`/upload-test`、`/cpu-test`、`/ws-test`、`/concurrent-test`、`/stream-test`、`/api/log-speed` 等）均通过 `isSameOriginNavigation` 验证，确保请求来自同一 Origin 或允许列表，防止 CSRF 和跨域滥用。
- **CORS 白名单**：通过环境变量 `ALLOWED_ORIGINS` 控制，只有明确列出的 Origin 才能获得 CORS 响应。

### 2. 输入校验
- 所有数值参数（`size`、`count`、`n`、`limit`）均使用 `clampInt` 和 `safeNumber` 进行范围限制，防止拒绝服务攻击。
- URL 参数（`dns-proxy` 的 `url`）强制校验协议（仅 http/https）和域名白名单。
- 请求体大小限制（`/upload-test` 最大 10MB，`/api/log-speed` 最大 10KB）。
- `escapeForJS` 和 `escapeHTML` 对输出进行转义，防止 XSS。

### 3. 限流
- **通用限流**：每个 IP 每分钟最多 60 次请求（对非静态资源路径生效）。
- **CPU 测试限流**：每个 IP 每分钟最多 3 次。
- 限流数据存储在内存 Map 中，定期清理过期条目。

### 4. 安全头部
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **CSP（内容安全策略）**：
  ```
  default-src 'self';
  script-src 'self' 'nonce-<random>' https://cdnjs.cloudflare.com https://fonts.googleapis.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com;
  font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com;
  connect-src 'self' https://ipapi.co https://api4.ipify.org https://api6.ipify.org ...;
  img-src 'self' data: https://www.netflix.com ...;
  ```

### 5. 外部 API 超时
- 所有外部 fetch 使用 `AbortController` 和超时（通常 4~5 秒），避免长时间阻塞。

---

## 🌐 国际化与主题

### 语言支持
- **支持语言**：English (en)、简体中文 (zh-CN)、繁體中文 (zh-TW)
- **检测逻辑**：
  1. 优先读取 `localStorage` 中 `pref-lang`。
  2. 否则根据 `Accept-Language` 头部匹配（zh-CN/zh-SG/zh-MY → 简体，zh → 繁体，en → 英语）。
  3. 若未匹配，使用 Worker 端默认语言（由 `defaultLang` 决定）。
- **覆盖范围**：所有界面文本、按钮、标签、提示信息、报告模板、质量等级、风险标签等。

### 主题模式
- **支持**：浅色、深色、跟随系统。
- **实现**：通过 CSS 变量和 `data-theme` 属性控制，所有颜色值自适应。
- **切换**：点击头部月亮/太阳图标循环切换，偏好保存至 `localStorage`。

---

## ⚡ 性能与可靠性

### 缓存策略
- **静态资源**（`/static/*`）：使用 Cache API 缓存 1 天，并支持 KV 存储（如配置 `CACHE_KV`）。
- **主页面**：强制 `no-cache, no-store, must-revalidate`，确保每次获取最新版本。
- **测速端点**：所有测试 API 均设置 `cache-control: no-store` 防止缓存干扰。

### 高效随机数据生成
- 使用 `crypto.getRandomValues` 配合分块（64KB）填充，适合大块数据生成。
- 流式传输使用 ReadableStream，逐块生成，内存友好。

### 并发控制
- 使用自定义 `pLimit` 函数限制并发数（如 `/concurrent-test` 内部并发为 4），避免 Worker 资源耗尽。

### 内存管理
- 限流 Map 定期清理（每次 check 有 5% 概率触发清理，或条目数 > 10000 时触发）。
- 测速历史 KV 自动设置 TTL（7 天），用量统计 TTL 30 天。

### 降级策略
- 若 `SPEED_HISTORY` KV 未绑定，历史记录和统计功能将优雅降级，显示“暂无记录”或“等待首次请求”。
- 外部 API 失败时，前端会显示“获取失败”或“无法获取风险数据”等友好提示。

---

## 🛠️ 自定义与扩展

### 添加新的测试工具
1. 在前端 HTML 的 `.button-group` 中添加新按钮。
2. 在 JavaScript 中编写对应的测试函数（通常为 `async function runXxxTest()`）。
3. 绑定按钮点击事件，调用该函数，并使用 `showResult()` 显示结果。

### 修改国际化文本
编辑前端 `i18n` 对象，按语言键值对更新文本。所有界面 ID 均以 `t-` 开头，对应 `map` 对象中的键。

### 调整主题样式
修改 `:root` 和 `[data-theme="light"]` 中的 CSS 变量即可全局更换配色。

### 扩展后端 API
在 `handleRequest` 主流程中添加新的 `if (url.pathname === '/your-endpoint')` 分支，实现自定义逻辑，并应用相同的安全措施（CORS、限流、同源检查）。

### 集成更多欺诈评分源
当前使用 Scamalytics，如需替换，修改 `getIpFraudScore` 函数，调用其他服务（如 IPQS、MaxMind）即可。

---

## ❓ 常见问题与故障排查

**Q：部署后页面显示空白或加载失败？**  
A：检查 Worker 日志（Cloudflare Dashboard → Workers → 选择 Worker → “日志”），查看是否有 JavaScript 错误。确保代码完整复制，且无语法错误。

**Q：测速历史显示“暂无记录”？**  
A：请确认已正确绑定 `SPEED_HISTORY` KV，并且 Worker 代码中的 binding 名称与 `wrangler.toml` 或 Dashboard 设置完全一致（区分大小写）。部署后首次测速会创建记录，稍等片刻刷新。

**Q：部分测试（如 WebSocket）失败？**  
A：检查浏览器是否支持 WebSocket，以及 Worker 是否正常响应升级请求。某些企业网络或浏览器插件可能拦截 WebSocket 连接。可尝试使用 Chrome 无痕模式测试。

**Q：IP 欺诈评分一直显示“获取失败”？**  
A：Scamalytics API 可能有访问限制或网络问题。可尝试在浏览器中直接访问 `https://scamalytics.com/api/ip/你的IP` 测试是否可达。若不可达，可考虑替换为其他 API。

**Q：主题切换不生效？**  
A：确保浏览器未禁用 localStorage，且 `data-theme` 属性正确设置。可尝试清除缓存后重新加载。

**Q：如何限制仅自己使用？**  
A：在 `ALLOWED_ORIGINS` 中填入自己部署的域名，并确保 Worker 路由仅允许该域名访问。此外，也可在 Worker 中添加 IP 白名单（需自行实现，例如检查 `cf-connecting-ip` 头部）。

**Q：能否将报告保存为文件？**  
A：复制报告后，可粘贴到文本编辑器中保存为 `.md` 或 `.txt` 文件。

**Q：Worker 每日请求限额不足？**  
A：Cloudflare Workers 免费计划每天有 10 万次请求限额，个人使用通常足够。如需更多，可升级至付费计划。

**Q：如何更新到最新版本？**  
A：拉取仓库最新代码，重新部署即可。若使用 Wrangler，`wrangler publish` 会自动更新。

---

## 📄 许可证与贡献

本项目基于 **MIT 许可证** 开源，欢迎任何形式的贡献（Issue、PR、Star）。

- **作者**：[BlueDriftHK](https://github.com/BlueDriftHK)
- **项目仓库**：[https://github.com/BlueDriftHK/CF-workers-netdiag](https://github.com/BlueDriftHK/CF-workers-netdiag)
- **反馈与建议**：请提交 GitHub Issue，或通过邮件联系（详见个人主页）。

---

**NetSight Pro – 让网络诊断如极光般绚丽而高效。** 🌌
