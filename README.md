# NetSight Pro

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/BlueDriftHK/CF-workers-netdiag/blob/main/LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/BlueDriftHK/CF-workers-netdiag/pulls)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BlueDriftHK/CF-workers-netdiag)

> 🚀 部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具  
> **实时监控 · 多维度测试 · 毫秒级响应 · Apple 极简视觉设计 · 企业级安全防护**

**版本**: 4.0 | **许可证**: AGPL-3.0 | **最后更新**: 2026-07-06

---

## 📖 目录

- [✨ 功能特性](#-功能特性)
- [🖼️ 界面预览](#️-界面预览)
- [🚀 快速开始](#-快速开始)
- [📡 API 端点](#-api-端点)
- [🧪 命令行测试](#-命令行测试)
- [⚙️ 配置说明](#️-配置说明)
- [🏗️ 技术架构](#️-技术架构)
- [📁 项目结构](#-项目结构)
- [🛡️ 安全策略](#️-安全策略)
- [📝 更新日志](#-更新日志)
- [❓ 常见问题](#-常见问题)
- [🔧 故障排查](#-故障排查)
- [📄 许可证](#-许可证)

---

## ✨ 功能特性

### 📡 网络质量检测

| 功能 | 说明 |
| :--- | :--- |
| **实时延迟监控** | 每 2 秒自动测量 RTT，实时趋势图表（Canvas 绘制） |
| **丢包率测试** | 10 次请求测试，实时计算丢包百分比 |
| **网络抖动评估** | 稳定性分级（非常稳定 / 稳定 / 不稳定 / 极不稳定） |
| **连接质量评分** | 五档分级（优秀 / 良好 / 一般 / 较差 / 极差） |
| **最低 / 最高 RTT** | 统计周期内的延迟极值 |
| **DNS 解析测试** | 通过 Worker 代理路由测试 Cloudflare/Google/GitHub 等域名真实延迟 |
| **多节点对比** | 同时测试多个 Worker 节点的延迟，表格直观对比（v4.0 新增） |

### ⚡ 性能测试工具

| 功能 | 说明 | 限制 |
| :--- | :--- | :--- |
| **带宽测速** | 多档位测试（100KB、500KB、2MB） | 最大 5MB |
| **CPU 性能测试** | 密集数学运算，返回 ops/ms | 最大 200 万次迭代，每 IP 每分钟 3 次 |
| **并发请求测试** | 模拟多并发下载（4/6/8 路） | 内部限制 4 并发，最大 16 路 |
| **流式传输测试** | 测试吞吐量（逐步增大数据块） | 最大 10MB |
| **WebSocket 延迟测试** | 5 次 ping-pong 往返延迟，30 秒心跳保持 | - |
| **流媒体连通性** | 检测 Netflix/Disney+/YouTube/ChatGPT 的可访问性（v4.0 新增） | - |

### 📊 测速历史与用量统计（v3.6 引入，v4.0 增强）

- **测速历史记录**：自动保存最近 5 条测速结果到 Cloudflare KV
- **用量统计面板**：可视化展示 API 端点调用统计（Top 8）
- **历史趋势**：通过 `/api/speed-history` 获取最近测速记录

### 🔒 安全与协议检测

- **TLS 版本检测**：识别 TLS 1.0/1.1/1.2/1.3
- **加密套件分析**：查看协商的加密算法
- **ECH 状态检测**：检测 Encrypted Client Hello 支持
- **压缩算法检测**：Brotli / Gzip / Deflate / Zstd
- **HTTP/2/3 检测**：识别协议版本和 Early Hints 支持
- **ALPN 协商**：查看应用层协议协商结果
- **IP 欺诈评分**：调用 Scamalytics API 评估代理/VPN/Tor/托管风险（v4.0 增强）

### 🌍 地理位置追踪

- 边缘节点位置（城市/坐标/ASN/运营商）
- 客户端真实地理位置（通过 ip-api.com）
- 客户端与边缘节点距离计算（公里）

### 🎨 Apple 极简视觉设计

- 30+ CSS 自定义属性，统一视觉决策
- 浅色 / 深色 / 自动模式（跟随系统或手动切换）
- SF 灰白基调 + Apple 蓝 `#007AFF` + 毛玻璃 `backdrop-filter: blur(24px)`
- 大圆角 12-24px、低弥散阴影、0.18-0.25s 原生动画曲线
- 简体中文 / 繁体中文 / English 三语切换
- 768px / 480px 响应式断点

---

## 🖼️ 界面预览

> 以下为模拟界面，实际部署后数据实时更新。

![界面预览](https://via.placeholder.com/800x400?text=NetSight+Pro+Dashboard)  
*（您可以在部署后自行截图替换此占位图）*

- **顶部**：显示客户端 IPv4/IPv6、边缘节点 colo、Worker 处理耗时、实时状态指示灯。
- **主区域**：四个 RTT 指标卡（当前/抖动/最低/最高）、动态曲线图、质量评级（连接质量/稳定性/样本/丢包率）。
- **信息卡片**：安全与协议、边缘节点位置、真实 IP 位置（含欺诈评分）。
- **诊断工具**：8 个按钮（丢包率、带宽测速、DNS 解析、CPU 性能、WebSocket、并发测试、流式传输、流媒体连通性），点击后结果显示于下方。
- **多节点对比**：弹窗输入节点 URL，并行测试延迟并展示表格。
- **底部**：RAY ID、客户端 IP、一键复制报告。

---

## 🚀 快速开始

### 前置条件

- Cloudflare 账号（免费版即可）
- 域名（可选，可使用 `workers.dev` 子域名）
- Node.js 18+ 和 npm（用于 Wrangler CLI）

### 方式一：Wrangler CLI 部署（推荐）

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 克隆项目
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

# 4. 创建 KV 命名空间（用于测速历史）
wrangler kv:namespace create SPEED_HISTORY

# 5. 将返回的 KV ID 配置到 wrangler.toml
# 编辑 wrangler.toml，添加：
# kv_namespaces = [
#   { binding = "SPEED_HISTORY", id = "your-kv-namespace-id" }
# ]

# 6. 部署
wrangler deploy --main _workers.js
```

### 方式二：Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **创建应用程序** > **创建 Worker**
3. 将 `_workers.js` 文件中的**完整代码**复制并粘贴到编辑器中
4. 在 Worker 设置中绑定 KV 命名空间 `SPEED_HISTORY`
5. 点击 **保存并部署**

### 方式三：一键部署

点击下方按钮，授权 GitHub 和 Cloudflare 后即可自动部署：

[![部署到 Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BlueDriftHK/CF-workers-netdiag)

---

## 📡 API 端点

所有接口均支持 CORS，方便集成到您自己的工具链中。

| 端点 | 方法 | 参数 | 参数限制 | 限流 | 描述 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/` | GET | - | - | ❌ | 主诊断页面（HTML） |
| `/health` | GET | - | - | ❌ | 健康检查 |
| `/speedtest` | GET | `size` | ≤ 5MB | ✅ | 带宽测速 |
| `/cpu-test` | GET | `n` | ≤ 200 万 | ✅ (3/min) | CPU 性能基准测试 |
| `/ws-test` | WebSocket | - | - | ✅ | WebSocket 延迟测试 |
| `/http2-test` | GET | - | - | ✅ | HTTP/2/3 + Early Hints |
| `/concurrent-test` | GET | `count`, `size` | count≤16, size≤64KB | ✅ | 并发压力测试 |
| `/stream-test` | GET | `size` | ≤ 10MB | ✅ | 流式吞吐量测试 |
| `/api/log-speed` | POST | JSON body | - | ✅ | 保存测速记录到 KV |
| `/api/speed-history` | GET | `limit` | ≤ 100 | ✅ | 查询测速历史 |
| `/api/usage-stats` | GET | - | - | ✅ | 查询用量统计摘要 |
| `/api/ip-fraud` | GET | - | - | ✅ | IP 欺诈评分 |
| `/dns-proxy` | GET | `url` | 仅白名单域名 | ✅ | DNS 代理测试 |

### API 响应示例

**健康检查 `/health`**
```json
{
  "status": "ok",
  "timestamp": 1704067200000,
  "version": "4.0",
  "uptime": "unknown"
}
```

**CPU 测试 `/cpu-test?n=500000`**
```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```

**HTTP/2 测试 `/http2-test`**
```json
{
  "http2": true,
  "http3": false,
  "protocol": "HTTP/2",
  "tlsVersion": "TLSv1.3",
  "earlyHints": true,
  "supportsEarlyHints": true,
  "alpn": "h2"
}
```

**测速历史 `/api/speed-history`**
```json
{
  "records": [
    {
      "timestamp": 1704067200000,
      "avgSpeed": 45.2,
      "results": [ { "sizeKB": 100, "speed": "45.2" } ],
      "colo": "NRT",
      "asn": "AS13335"
    }
  ]
}
```

---

## 🧪 命令行测试

### 基础测试
```bash
# 健康检查
curl https://your-worker.dev/health

# 获取主页面
curl https://your-worker.dev/
```

### 性能测试
```bash
# 带宽测试（100KB）
curl -o /dev/null -s -w 'Speed: %{speed_download} bytes/sec\n' \
  https://your-worker.dev/speedtest?size=102400

# CPU 性能测试（50万次迭代）
curl https://your-worker.dev/cpu-test?n=500000

# 并发测试（4个并发，2KB数据）
curl https://your-worker.dev/concurrent-test?count=4&size=2048

# 流式传输测试（1MB）
curl -o /dev/null -s -w 'Time: %{time_total}s\n' \
  https://your-worker.dev/stream-test?size=1048576
```

### 协议检测
```bash
# HTTP/2 检测
curl -v https://your-worker.dev/http2-test 2>&1 | grep -i "http"

# TLS 信息
curl -v https://your-worker.dev/health 2>&1 | grep -i "tls"
```

### WebSocket 测试
```bash
# 使用 websocat 工具
websocat ws://your-worker.dev/ws-test
```

---

## ⚙️ 配置说明

### 限流配置

默认限流规则：

| 维度 | 限制 | 说明 |
| :--- | :--- | :--- |
| 通用 API | 60 次/分钟 / IP | 大部分端点 |
| CPU 测试 | 3 次/分钟 / IP | 防止 CPU 资源滥用 |

修改 `_workers.js` 中限流参数：
```javascript
// 通用限流（第58行附近）
if (isRateLimited(clientIp)) { // 默认 60次/分钟
// 修改为 100次/分钟
if (isRateLimited(clientIp, 100)) {

// CPU 限流
if (cpuRateLimit(clientIp, 3)) { // 默认 3次/分钟
// 修改为 5次/分钟
if (cpuRateLimit(clientIp, 5)) {
```

### 测试参数上限配置

各端点的参数上限可在代码中调整：

| 端点 | 参数 | 默认上限 | 建议范围 |
| :--- | :--- | :--- | :--- |
| `/speedtest` | `size` | 5,242,880 (5MB) | ≤ 10MB |
| `/cpu-test` | `n` | 2,000,000 | ≤ 5,000,000 |
| `/concurrent-test` | `count` | 16 | ≤ 32 |
| `/concurrent-test` | `size` | 65,536 (64KB) | ≤ 256KB |
| `/stream-test` | `size` | 10,485,760 (10MB) | ≤ 25MB |

### KV 命名空间配置

```toml
# wrangler.toml
name = "netsight-pro"
main = "_workers.js"
compatibility_date = "2024-12-01"

kv_namespaces = [
  { binding = "SPEED_HISTORY", id = "your-kv-namespace-id" }
]
```

### 自定义域名绑定

```toml
routes = [
  { pattern = "diagnostics.yourdomain.com", custom_domain = true }
]
```

### 环境变量（通过 `wrangler.toml` 或 Dashboard 设置）

| 变量名 | 描述 | 默认值 |
| :--- | :--- | :--- |
| `MAX_REQUESTS` | 每分钟每个 IP 的最大请求数 | `60` |
| `ALLOWED_DOMAINS` | DNS 代理测试允许的域名（逗号分隔） | `cloudflare.com,google.com,github.com` |
| `SPEED_HISTORY` | KV 命名空间绑定（必须） | - |

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                         客户端                              │
│                  浏览器 / curl / WebSocket                  │
└─────────────────┬───────────────────────────────────────────┘
                  │ HTTPS / WSS
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare 边缘网络                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Cloudflare Worker                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐       │   │
│  │  │  限流中间件 │─▶│  路由分发  │─▶│  响应生成器 │       │   │
│  │  └───────────┘  └─────┬─────┘  └─────┬─────┘       │   │
│  │                        │               │               │   │
│  │         ┌─────────────┼───────────────┼─────────────┐│   │
│  │         ▼             ▼               ▼             ││   │
│  │  ┌───────────┐ ┌───────────┐  ┌───────────┐        ││   │
│  │  │ 静态页面   │ │ API 端点  │  │ WebSocket │        ││   │
│  │  │ 生成器     │ │ 处理器    │  │ 处理器    │        ││   │
│  │  └───────────┘ └─────┬─────┘  └─────┬─────┘        ││   │
│  │                       │               │              ││   │
│  │         ┌─────────────┴───────────────┘              ││   │
│  │         ▼                                            ││   │
│  │  ┌──────────────────────────────────────┐            ││   │
│  │  │ 外部 API (ip-api.com, scamalytics)   │            ││   │
│  │  │ KV 存储 (SPEED_HISTORY)              │            ││   │
│  │  └──────────────────────────────────────┘            ││   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 技术 | 用途 | 版本/标准 |
| :--- | :--- | :--- |
| Cloudflare Workers | 边缘计算运行时 | 2024-12-01 API |
| Cloudflare KV | 测速历史持久化 | SPEED_HISTORY |
| WebSocket API | 实时双向通信测试 | RFC 6455 |
| Canvas API | 实时延迟图表绘制 | HTML5 |
| ReadableStream API | 流式数据传输 | WHATWG Streams |
| Web Crypto API | 随机数据生成 | W3C |
| Fetch API | HTTP 请求处理 | WHATWG |

### 浏览器兼容性

| 浏览器 | 最低版本 | WebSocket | Canvas | Streams API | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Chrome | 80+ | ✅ | ✅ | ✅ | 完全支持 |
| Firefox | 75+ | ✅ | ✅ | ✅ | 完全支持 |
| Safari | 13.1+ | ✅ | ✅ | ⚠️ 部分支持 | 基本支持 |
| Edge | 80+ | ✅ | ✅ | ✅ | 完全支持 |

---

## 📁 项目结构

```
CF-workers-netdiag/
├── _workers.js          # Cloudflare Worker 主文件（~2700行核心代码）
├── README.md            # 项目文档（本文件）
├── SECURITY.md          # 安全政策
├── LICENSE              # AGPL-3.0 许可证
├── CODE_OF_CONDUCT.md   # 行为准则
├── CONTRIBUTING.md      # 贡献指南
├── .github/
│   ├── workflows/
│   │   └── build.yml    # GitHub Actions CI/CD
│   └── ISSUE_TEMPLATE/  # Issue 模板
└── .gitignore           # Git 忽略文件配置
```

### 核心文件说明

| 文件 | 大小 | 说明 |
| :--- | :--- | :--- |
| `_workers.js` | ~2700 行 | Worker 主程序，包含所有 API 逻辑、前端 HTML、CSS 设计体系和 KV 集成 |
| `README.md` | 本文件 | 项目文档，包含所有使用说明 |
| `SECURITY.md` | - | 安全策略和报告流程 |

---

## 🛡️ 安全策略

完整安全策略请参阅 [SECURITY.md](./SECURITY.md)。

### 核心安全措施

| 维度 | 措施 | 说明 |
| :--- | :--- | :--- |
| **限流** | 双层（通用 60/min + CPU 3/min） | IP 级别限流，返回 429 + `retry-after` |
| **输入校验** | parseInt 钳制 + 域名白名单 | `cloudflare.com` / `google.com` / `github.com` |
| **XSS 防护** | `escapeForJS` + 动态 CSP nonce | 每次响应生成随机 nonce |
| **响应头** | 5 项安全头 | `nosniff` / `DENY` / `XSS` / `Referrer` / `HSTS` |
| **CORS** | `*`（可配置） | 开放跨域访问 |
| **KV 安全** | typeof 类型守卫 + 7 天 TTL | 防止数据投毒与过期清理 |
| **DNS 代理** | Worker 服务端代理 | 绕过浏览器 CORS，域名白名单防 SSRF |

### 安全报告

如发现安全漏洞，请发送邮件至：**asiacomk@gmail.com**

---

## 📝 更新日志

### v4.0 (2026-07-06)

- **新增**: 多节点对比功能，可同时测试多个 Worker 节点的延迟
- **新增**: 流媒体连通性检测（Netflix/Disney+/YouTube/ChatGPT）
- **新增**: IP 欺诈评分端点 `/api/ip-fraud`（集成 Scamalytics）
- **新增**: 自动主题切换（深色/浅色/自动）
- **增强**: 测速历史支持更多字段（colo、asn）
- **优化**: UI 重构，采用 Apple 极简设计体系
- **优化**: 响应式断点适应更多设备
- **修复**: 若干边缘情况错误处理

### v3.6 (2026-07-04)

- **新增**: 测速历史记录功能，自动保存最近 5 条结果到 Cloudflare KV
- **新增**: 用量统计面板，可视化展示网络质量趋势
- **新增**: 3 个 KV API 端点（`/api/log-speed`、`/api/speed-history`、`/api/usage-stats`）
- **优化**: UI 全面重构为 Apple 极简设计体系
- **修复**: DNS 测试全部超时——改用 Worker 代理路由 + Image 对象客户端计时，绕过 CORS
- **修复**: CPU 测试返回 null——duration=0 导致 Infinity，加除零保护
- **新增**: CPU 独立限流（每 IP 每分钟 3 次），429 响应
- **新增**: KV 自动清理机制，写入后删除超出 5 条的旧记录

### v3.5 (2026-06-11)

- 优化: 限流清理机制从 `setInterval` 改为按需随机抽样清理（约1%概率）
- 修复: 全局作用域异步操作问题
- 增强: WebSocket 心跳机制更稳定
- 安全: 动态 CSP nonce，增强 XSS 防护

### v3.3 (2026-05-28)

- 新增: `/health` 健康检查端点
- 新增: IP 级别请求限流保护（60次/分钟）
- 新增: 完整安全响应头（CSP、HSTS、X-Frame-Options、X-Content-Type-Options）
- 新增: WebSocket 30秒心跳机制
- 优化: 并发测试增加内部并发限制器 `pLimit(4)`

### v3.0 (2026-05-10)

- 新增: 实时延迟监控模块，每2秒自动测量 RTT
- 新增: Canvas 实时趋势图表绘制
- 新增: 多档位带宽测速、CPU 密集型性能测试、WebSocket 双向延迟测试
- 新增: 真实 IP 地理位置查询（通过 ip-api.com）
- UI: 全新蓝色玻璃态毛玻璃效果主题

### v1.0 (2026-05-01)

- 项目初始化，创建 `_workers.js` 核心文件
- 基础功能: IP 地址检测与地区验证

---

## ❓ 常见问题

### 1. 部署后访问出现 404 错误？
- **原因**: 可能未正确部署 `_workers.js` 文件
- **解决**: 确保复制的是 `_workers.js` 的完整内容，而非其他文件

### 2. 限流触发后如何解除？
- 通用限流周期为 60 秒，CPU 限流周期为 60 秒
- 等待周期结束后自动解除
- 响应头会包含 `retry-after` 字段

### 3. WebSocket 连接失败？
- 确保客户端支持 WebSocket 协议
- 检查网络环境是否允许 WebSocket 连接
- 尝试使用 `ws://` 而非 `wss://`（开发环境）

### 4. 带宽测速结果不准确？
- 测速受网络波动影响，建议多次测试取平均值
- 使用有线网络比 Wi-Fi 更稳定
- 测速文件大小建议选择 1MB 以上

### 5. CPU 测试结果差异大？
- Cloudflare Workers 的 CPU 资源是共享的，结果会有波动
- 建议多次测试取平均值（注意每 IP 每分钟限 3 次）
- 测试迭代次数越高，结果越稳定

### 6. DNS 测试为什么不再直接 fetch？
- 浏览器直接 fetch 外部 URL 会被 CORS 拦截
- v3.6 改为通过 Worker 代理路由进行 DNS 解析，客户端使用 `Image` 对象测量真实延迟

### 7. 测速历史数据能存多久？
- 最近 5 条记录永久保存，超出自动清理
- 每条记录 TTL 为 7 天

### 8. 支持 IPv6 吗？
- 完全支持。Worker 会自动检测并显示 IPv4 和 IPv6 地址

### 9. 多节点对比需要所有节点运行同一套代码吗？
- 是的，所有被测试的节点都需要部署相同或兼容版本的 NetSight Pro，因为测试依赖 `/speedtest` 端点。

### 10. 如何自定义欺诈评分服务？
- 修改 `_workers.js` 中的 `getIpFraudScore` 函数，替换为其他服务 API。

---

## 🔧 故障排查

### 查看 Worker 日志

```bash
# 实时查看日志
wrangler tail

# 过滤特定请求
wrangler tail --filter "status:>=400"

# 输出 JSON 格式
wrangler tail --format json
```

### 常见错误码

| 状态码 | 含义 | 解决方法 |
| :--- | :--- | :--- |
| 429 | Too Many Requests | 等待 60 秒后重试 |
| 404 | Not Found | 检查 URL 路径是否正确 |
| 426 | Upgrade Required | WebSocket 请求需要正确的 Upgrade 头 |
| 500 | Internal Server Error | 检查 Worker 代码或联系支持 |
| 503 | Service Unavailable | Cloudflare 临时问题，稍后重试 |

### 性能优化建议

1. **启用 KV 缓存**: 配置 `SPEED_HISTORY` KV 绑定存储测速历史
2. **使用自定义域名**: 减少 DNS 解析时间
3. **调整限流阈值**: 根据实际使用量调整
4. **压缩响应**: Worker 默认支持 Brotli/Gzip

---

## 📄 许可证

本项目使用 **GNU Affero General Public License v3.0** 许可证。

| 项目 | 说明 |
| :--- | :--- |
| 商业使用 | ✅ 允许 |
| 修改代码 | ✅ 允许 |
| 分发代码 | ✅ 允许 |
| 公开源代码 | ✅ 必须（修改后） |
| 保留版权声明 | ✅ 必须 |
| 专利授权 | ✅ 包含 |
| 私人使用 | ✅ 允许 |

完整许可证文本请查看 [LICENSE](./LICENSE) 文件。

---

## 💬 联系方式

| 渠道 | 链接 |
| :--- | :--- |
| GitHub Issues | [提交问题](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) |
| 安全报告 | asiacomk@gmail.com |

---

*由 BlueDriftHK 用 ❤️ 制作*  
*GNU Affero 通用公共许可证 v3.0 · 开源自由 · 持续更新*
