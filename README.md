# NetSight Pro 🔍

> 部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具  
> 实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计 · 企业级安全防护

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BlueDriftHK/CF-workers-netdiag)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![Version](https://img.shields.io/badge/version-3.5-green)](https://github.com/BlueDriftHK/CF-workers-netdiag)

**版本**: 3.5 | **许可证**: GPL-3.0 | **最后更新**: 2026-06-11

---

## 📖 目录

- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
- [API 端点](#-api-端点)
- [命令行测试](#-命令行测试示例)
- [配置说明](#-配置说明)
- [技术架构](#-技术架构)
- [项目结构](#-项目结构)
- [本地开发](#-本地开发与测试)
- [更新日志](#-更新日志)
- [常见问题](#-常见问题)
- [故障排查](#-故障排查)
- [贡献指南](#-贡献指南)
- [致谢](#-致谢)
- [许可证](#-许可证)

---

## ✨ 功能特性

### 📡 网络质量检测
| 功能 | 说明 |
| :--- | :--- |
| **实时延迟监控** | 每2秒自动测量 RTT，实时趋势图表 |
| **丢包率测试** | 10次请求测试，实时计算丢包百分比 |
| **网络抖动评估** | 稳定性分级（非常稳定/稳定/不稳定/极不稳定） |
| **连接质量评分** | 五档分级（优秀/良好/一般/较差/极差） |
| **最低/最高 RTT** | 统计周期内的延迟极值 |

### 🚀 性能测试工具
| 功能 | 说明 | 限制 |
| :--- | :--- | :--- |
| **带宽测速** | 多档位测试 | 最大 5MB |
| **CPU性能测试** | 密集数学运算，返回 ops/ms | 最大 200万次迭代 |
| **并发请求测试** | 模拟多并发下载 | 内部限制 4 并发 |
| **流式传输测试** | 测试吞吐量 | 最大 10MB |

### 🔒 安全与协议检测
- **TLS版本检测** - 识别 TLS 1.0/1.1/1.2/1.3
- **加密套件分析** - 查看协商的加密算法
- **ECH状态检测** - 检测 Encrypted Client Hello 支持
- **压缩算法检测** - Brotli/Gzip/Deflate/Zstd
- **HTTP/2/3 检测** - 识别协议版本和 Early Hints 支持
- **ALPN 协商** - 查看应用层协议协商结果

### 🌐 网络诊断工具
- **DNS解析测试** - 测试 Cloudflare/Google/GitHub 等域名
- **WebSocket测试** - 5次 ping-pong 往返延迟测试，30秒心跳保持
- **地理位置追踪** - 边缘节点与客户端位置、距离计算
- **一键导出报告** - 生成完整诊断报告并复制到剪贴板

### 🛡️ 企业级安全
| 安全项 | 配置 | 说明 |
| :--- | :--- | :--- |
| **限流保护** | 60次/分钟 | IP 级别限流，超限返回 429 |
| **CSP 策略** | 动态 nonce | 防止 XSS 和数据注入 |
| **HSTS** | max-age=31536000 | 强制 HTTPS 连接 |
| **X-Frame-Options** | DENY | 防止点击劫持 |
| **X-Content-Type-Options** | nosniff | 防止 MIME 类型混淆 |
| **X-XSS-Protection** | 1; mode=block | 浏览器 XSS 过滤器 |

---

## 🚀 快速开始

### 前置条件
- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
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

# 4. 部署（注意：核心文件为 _workers.js）
wrangler deploy --main _workers.js

# 5. （可选）绑定自定义域名
wrangler routes add https://your-domain.com
```

### 方式二：Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **创建应用程序** > **创建 Worker**
3. 将 `_workers.js` 文件中的**全部代码**复制并粘贴到编辑器中
4. 点击 **保存并部署**
5. （可选）在 **触发器** 选项卡中绑定自定义域名

### 方式三：一键部署

点击下方按钮，授权 GitHub 和 Cloudflare 后即可自动部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BlueDriftHK/CF-workers-netdiag)

### 方式四：使用 Git 仓库直接部署

1. 在 Cloudflare Dashboard 中进入 **Workers & Pages**
2. 点击 **创建应用程序** > **Pages** > **连接到 Git**
3. 连接你的 GitHub 仓库 `BlueDriftHK/CF-workers-netdiag`
4. 设置框架预设为 **None**
4. 点击 **保存并部署**

---

## 📡 API 端点

### 完整端点列表

| 端点 | 方法 | 参数 | 参数限制 | 限流 | 描述 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/health` | GET | - | - | ❌ | 健康检查 |
| `/speedtest` | GET | `size` | ≤ 5MB | ✅ | 带宽测速 |
| `/cpu-test` | GET | `n` | ≤ 200万 | ✅ | CPU 性能基准测试 |
| `/ws-test` | WebSocket | - | - | ✅ | WebSocket 延迟测试 |
| `/http2-test` | GET | - | - | ✅ | HTTP/2/3 + Early Hints |
| `/concurrent-test` | GET | `count`, `size` | `count`≤16, `size`≤64KB | ✅ | 并发压力测试 |
| `/stream-test` | GET | `size` | ≤ 10MB | ✅ | 流式吞吐量测试 |
| `/` | GET | - | - | ❌ | 主诊断页面（HTML） |

### API 响应示例

**🏥 健康检查 `/health`**
```json
{
  "status": "ok",
  "timestamp": 1704067200000,
  "version": "3.5",
  "uptime": "unknown"
}
```

**⚙️ CPU 测试 `/cpu-test?n=500000`**
```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```

**🌐 HTTP/2 测试 `/http2-test`**
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

**📊 并发测试 `/concurrent-test?count=4&size=2048`**
```json
[
  { "index": 0, "size": 2048, "duration": 12 },
  { "index": 1, "size": 2048, "duration": 14 },
  { "index": 2, "size": 2048, "duration": 11 },
  { "index": 3, "size": 2048, "duration": 13 }
]
```

**🚀 流式传输测试 `/stream-test?size=1048576`**
- 返回 `application/octet-stream` 类型的二进制数据流
- 响应头包含 `content-length` 和 `cache-control: no-store`

---

## 🧪 命令行测试示例

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

默认限流规则：**60次/分钟 / IP**

修改 `_workers.js` 中调用 `isRateLimited()` 的参数：

```javascript
// 第58行附近
if (isRateLimited(clientIp)) {  // 默认 60次/分钟
// 修改为 100次/分钟
if (isRateLimited(clientIp, 100)) {
// 修改为 30次/10秒
if (isRateLimited(clientIp, 30, 10000)) {
```

### 测试参数上限配置

各端点的参数上限可在代码中调整：

| 端点 | 代码位置 | 参数 | 默认上限 | 可修改范围 |
| :--- | :--- | :--- | :--- | :--- |
| `/speedtest` | 第181行 | `size` | 5,242,880 (5MB) | 建议 ≤ 10MB |
| `/cpu-test` | 第199行 | `n` | 2,000,000 | 建议 ≤ 5,000,000 |
| `/concurrent-test` | 第289行 | `count` | 16 | 建议 ≤ 32 |
| `/concurrent-test` | 第289行 | `size` | 65,536 (64KB) | 建议 ≤ 256KB |
| `/stream-test` | 第342行 | `size` | 10,485,760 (10MB) | 建议 ≤ 25MB |

### 并发限制器配置

```javascript
// 第289行附近，修改 pLimit 的参数
const limit = pLimit(4);  // 改为 6 可允许更多并发
```

### 自定义域名绑定

在 `wrangler.toml` 中添加：

```toml
name = "netsight-pro"
main = "_workers.js"
compatibility_date = "2024-12-01"

routes = [
  { pattern = "diagnostics.yourdomain.com", custom_domain = true }
]
```

### 环境变量配置

如需使用 KV 存储静态资源：

```toml
# wrangler.toml
kv_namespaces = [
  { binding = "CACHE_KV", id = "your-kv-namespace-id" }
]
```

---

## 🛠️ 技术架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端                                │
│  浏览器 / curl / WebSocket 客户端                            │
└─────────────────┬───────────────────────────────────────────┘
                  │ HTTPS / WSS
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare 边缘网络                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Cloudflare Worker                       │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐       │   │
│  │  │ 限流中间件 │─▶│ 路由分发  │─▶│ 响应生成器 │       │   │
│  │  └───────────┘  └─────┬─────┘  └─────┬─────┘       │   │
│  │                       │              │               │   │
│  │         ┌─────────────┼──────────────┼─────────────┐ │   │
│  │         ▼             ▼              ▼             │ │   │
│  │  ┌───────────┐ ┌───────────┐  ┌───────────┐      │ │   │
│  │  │ 静态页面  │ │ API 端点  │  │ WebSocket │      │ │   │
│  │  │  生成器   │ │  处理器   │  │   处理器   │      │ │   │
│  │  └───────────┘ └─────┬─────┘  └─────┬─────┘      │ │   │
│  │                      │              │             │ │   │
│  │         ┌────────────┴──────────────┘             │ │   │
│  │         ▼                                          │ │   │
│  │  ┌───────────┐                                    │ │   │
│  │  │ 外部 API  │ (ip-api.com, ipify.org)           │ │   │
│  │  └───────────┘                                    │ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 技术 | 用途 | 版本/标准 |
| :--- | :--- | :--- |
| **Cloudflare Workers** | 边缘计算运行时 | 2024-12-01 API |
| **WebSocket API** | 实时双向通信测试 | RFC 6455 |
| **Canvas API** | 实时延迟图表绘制 | HTML5 |
| **ReadableStream API** | 流式数据传输 | WHATWG Streams |
| **Web Crypto API** | 随机数据生成 | W3C |
| **Fetch API** | HTTP 请求处理 | WHATWG |
| **EventTarget API** | WebSocket 事件处理 | DOM Level 2 |

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
├── _workers.js              # Cloudflare Worker 主文件（~1200行核心代码）
├── index.html               # 纯前端演示版（无需后端部署）
├── README.md                # 项目文档（本文件）
├── LICENSE                  # GPL-3.0 许可证
├── CODE_OF_CONDUCT.md       # 行为准则
├── CONTRIBUTING.md          # 贡献指南
├── SECURITY.md              # 安全政策
├── .github/
│   ├── workflows/
│   │   └── build.yml        # GitHub Actions CI/CD
│   └── ISSUE_TEMPLATE/      # Issue 模板
└── .gitignore               # Git 忽略文件配置
```

### 核心文件说明

| 文件 | 大小 | 说明 |
| :--- | :--- | :--- |
| `_workers.js` | ~1200行 | Worker 主程序，包含所有 API 逻辑和前端 HTML |
| `index.html` | ~600行 | 纯前端演示版，可本地运行测试界面 |

---

## 🔧 本地开发与测试

### 使用 Wrangler 本地预览

```bash
# 安装依赖
npm install -g wrangler

# 克隆项目
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

# 本地启动（预览模式）
wrangler dev --main _workers.js --port 8787

# 访问 http://localhost:8787
```

### 使用 curl 测试本地 API

```bash
# 健康检查
curl http://localhost:8787/health

# 带宽测试
curl http://localhost:8787/speedtest?size=1024

# CPU 测试
curl http://localhost:8787/cpu-test?n=10000
```

### 使用纯前端演示版

```bash
# 下载演示文件
wget https://raw.githubusercontent.com/BlueDriftHK/CF-workers-netdiag/main/index.html

# 在浏览器中打开（仅前端模拟，无后端 API）
open index.html

# 或使用 Python 启动本地服务器
python3 -m http.server 8080
# 访问 http://localhost:8080
```

### 调试技巧

1. **启用本地日志**：
   ```bash
   wrangler dev --log-level debug
   ```

2. **查看实时日志**（部署后）：
   ```bash
   wrangler tail
   ```

3. **使用 Chrome DevTools 调试**：
   - 在 `wrangler dev` 模式下，按 `D` 键打开 Devtools

---

## 📋 更新日志

### v3.5 (2026-06-11)
- **提交**: [`f2f5e00`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/f2f5e00379d276a25e7bf088456bd6fa4f97e17b)
- **优化**: 限流清理机制从 `setInterval` 改为按需随机抽样清理（约1%概率），提升 Worker 运行时效率
- **修复**: 全局作用域异步操作问题
- **增强**: WebSocket 心跳机制更稳定，改善长连接测试可靠性
- **安全**: 动态 CSP nonce，增强 XSS 防护

### v3.4 (2026-06-05)
- **提交**: [`8797a21`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/8797a2179623f5731bacb48ee0e040b1b41b1e17)
- **优化**: 静态资源缓存策略调整
- **修复**: 部分浏览器兼容性问题

### v3.3 (2026-05-28)
- **提交**: [`509de89`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/509de890a6b8a5972fe79b5a3fac5a03898998a1)
- **新增**: `/health` 健康检查端点，支持监控系统集成
- **新增**: IP 级别请求限流保护（60次/分钟），防止 API 滥用
- **新增**: 完整安全响应头（CSP、HSTS、X-Frame-Options、X-Content-Type-Options）
- **新增**: WebSocket 30秒心跳机制，保持长连接稳定
- **优化**: 并发测试增加内部并发限制器 `pLimit(4)`，避免资源耗尽
- **优化**: 流式传输使用 `queueMicrotask` 替代 `setTimeout`
- **优化**: 静态资源缓存策略（24小时/7天分层缓存）
- **修复**: `event` 变量作用域问题
- **修复**: WebSocket 连接超时处理

### v3.2 (2026-05-20)
- **提交**: [`f493b68`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/f493b68613160b0bdde72c652018872447ea7b4d)
- **新增**: 多语言支持框架
- **优化**: UI 响应式布局改进

### v3.1 (2026-05-15)
- **提交**: [`8111c3e`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/8111c3eb54a281b36fe1fe8cffd71e251c9750b3)
- **新增**: 真实 IP 地理位置查询 API 集成
- **优化**: 前端加载性能

### v3.0 (2026-05-10)
- **提交**: [`5c6d5da`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/5c6d5da7f0f24550aae3b22142cebee320569896)
- **新增**: 实时延迟监控模块，每2秒自动测量 RTT
- **新增**: Canvas 实时趋势图表绘制
- **新增**: 最低/最高 RTT 统计
- **新增**: 多档位带宽测速功能
- **新增**: CPU 密集型性能测试
- **新增**: WebSocket 双向延迟测试
- **新增**: 真实 IP 地理位置查询（通过 ip-api.com）
- **UI**: 全新蓝色玻璃态毛玻璃效果主题
- **UI**: 实时延迟监控模块独占整行展示

### v2.x (2026-05-01 ~ 2026-05-05)
- 基础框架搭建与迭代优化

### v1.0 (2026-05-01)
- **提交**: [`cf1826f`](https://github.com/BlueDriftHK/CF-workers-netdiag/commit/cf1826f5dbb47e5d996b4bfb22adf44a9bb532f3)
- **项目初始化**: 创建 `_workers.js` 核心文件
- **基础功能**: IP 地址检测与地区验证
- **框架搭建**: Cloudflare Worker 基础运行环境

---

## ❓ 常见问题

### 1. 部署后访问出现 404 错误？
- **原因**: 可能未正确部署 `_workers.js` 文件
- **解决**: 确保复制的是 `_workers.js` 的完整内容，而非 `index.html`

### 2. 限流触发后如何解除？
- 限流周期为 **60秒**，等待 60 秒后自动解除
- 响应头会包含 `retry-after: 60`

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
- 建议多次测试取平均值
- 测试迭代次数越高，结果越稳定

### 6. 如何获取真实客户端 IP？
- Worker 会自动从 `cf-connecting-ip` 或 `x-forwarded-for` 头获取
- 地理位置通过调用 `ip-api.com` 获取

### 7. 支持 IPv6 吗？
- 完全支持。Worker 会自动检测并显示 IPv4 和 IPv6 地址

---

## 🔍 故障排查

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

1. **启用 KV 缓存**：配置 `CACHE_KV` 绑定可缓存静态资源
2. **使用自定义域名**：减少 DNS 解析时间
3. **调整限流阈值**：根据实际使用量调整
4. **压缩响应**：Worker 默认支持 Brotli/Gzip

---

## 🤝 贡献指南

### 贡献流程

```bash
# 1. Fork 本项目
# 2. 克隆到本地
git clone https://github.com/YOUR_USERNAME/CF-workers-netdiag.git

# 3. 创建特性分支
git checkout -b feature/AmazingFeature

# 4. 提交更改
git add .
git commit -m '✨ Add some AmazingFeature'

# 5. 推送并开启 Pull Request
git push origin feature/AmazingFeature
```

### 代码规范

- 使用 **2 空格缩进**
- 变量命名使用 **camelCase**
- 常量使用 **UPPER_SNAKE_CASE**
- 添加必要的注释

### 提交信息格式

| 类型 | 图标 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| feat | ✨ | 新功能 | `feat: add health check endpoint` |
| fix | 🐛 | 修复问题 | `fix: websocket timeout issue` |
| docs | 📝 | 文档更新 | `docs: update API documentation` |
| style | 🎨 | 代码格式 | `style: update card hover effect` |
| refactor | ♻️ | 代码重构 | `refactor: extract common functions` |
| perf | ⚡ | 性能优化 | `perf: optimize concurrent test` |
| test | ✅ | 测试相关 | `test: add unit tests` |
| chore | 🔧 | 构建/工具 | `chore: update wrangler config` |
| security | 🔒 | 安全相关 | `security: add rate limiting` |

### Pull Request 检查清单

- [ ] 代码符合项目规范
- [ ] 已测试通过
- [ ] 更新了相关文档
- [ ] 提交信息格式正确
- [ ] 未引入破坏性变更

---

## 🙏 致谢

### 开源项目与服务

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务

### 贡献者

感谢所有为本项目做出贡献的开发者！

---

## 📄 许可证

本项目使用 **GNU General Public License v3.0** 许可证。

| 项目 | 说明 |
| :--- | :--- |
| **商业使用** | ✅ 允许 |
| **修改代码** | ✅ 允许 |
| **分发代码** | ✅ 允许 |
| **公开源代码** | ✅ 必须（修改后） |
| **保留版权声明** | ✅ 必须 |
| **专利授权** | ✅ 包含 |
| **私人使用** | ✅ 允许 |
| **许可和版权声明** | ✅ 必须保留 |

> 完整许可证文本请查看 [LICENSE](./LICENSE) 文件

---

## 📞 联系方式

| 渠道 | 链接 |
| :--- | :--- |
| **GitHub Issues** | [提交问题](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) |
| **GitHub Discussions** | [讨论区](https://github.com/BlueDriftHK/CF-workers-netdiag/discussions) |
| **📖 中文 Wiki** | [完整文档](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki) |
| **📖 English Wiki** | [Full Documentation](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki) |

---

## ⭐ Star History

如果这个项目对你有帮助，欢迎 Star 支持！

[![Star History Chart](https://api.star-history.com/svg?repos=BlueDriftHK/CF-workers-netdiag&type=Date)](https://star-history.com/#BlueDriftHK/CF-workers-netdiag&Date)

---

**Made with ❤️ by [BlueDriftHK](https://github.com/BlueDriftHK)**

**GNU General Public License v3.0 · 开源自由 · 持续更新**

---

[⬆️ 返回顶部](#netsight-pro-)
