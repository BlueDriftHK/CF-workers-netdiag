# NetSight Pro 🔍

<p align="center">
  <img src="https://img.shields.io/badge/version-3.3.0-blue?style=for-the-badge&logo=cloudflare" alt="Version">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-GPLv3-red?style=for-the-badge&logo=gnu" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/UI-极光主题-06b6d4?style=for-the-badge" alt="UI Theme">
  <img src="https://img.shields.io/badge/语言-多语言支持-8b5cf6?style=for-the-badge" alt="Multi Language">
  <img src="https://img.shields.io/badge/Wiki-文档中心-06b6d4?style=for-the-badge&logo=gitbook" alt="Wiki">
</p>

<p align="center">
  <strong>⚡ 部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具</strong><br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计 · 企业级安全防护
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-api-端点">API 端点</a> •
  <a href="#-更新日志">更新日志</a> •
  <a href="#-部署指南">部署指南</a> •
  <a href="#-技术架构">技术架构</a> •
  <a href="#-安全配置">安全配置</a> •
  <a href="#-许可证">许可证</a> •
  <a href="WIKI.md"><strong>📖 完整 Wiki</strong></a>
</p>

---

## 📚 快速导航

| 文档 | 说明 | 链接 |
|------|------|------|
| **📖 完整 Wiki** | 详细的项目文档、API 参考、架构设计 | [查看 Wiki](./WIKI.md) |
| **🚀 快速开始** | 5分钟部署指南 | [开始使用](#-快速开始) |
| **📡 API 文档** | 完整 API 端点说明 | [查看 API](#-api-文档) |
| **🛡️ 安全配置** | 企业级安全特性 | [查看安全](#-安全特性) |
| **📋 更新日志** | 版本迭代记录 | [查看日志](#-更新日志) |

---

## 项目概述

### 简介

**NetSight Pro** 是一款部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具。利用 Cloudflare 全球分布的边缘网络，提供实时网络监控、多维度性能测试和全面的安全协议检测能力。

> 📖 **完整文档**：详细的架构设计、API 参考、配置说明请查看 [项目 Wiki](./WIKI.md)

### 核心特性

| 特性 | 说明 |
|------|------|
| ⚡ **边缘部署** | 基于 Cloudflare Workers，全球低延迟响应 |
| 📡 **实时监控** | 每2秒自动测量 RTT，实时趋势图表 |
| 🛠️ **8+ 诊断工具** | 带宽测速、CPU性能、WebSocket、并发测试等 |
| 🔒 **安全检测** | TLS版本、加密套件、ECH状态、HSTS |
| 🌍 **地理位置** | 边缘节点与客户端位置追踪 |
| 🎨 **极光主题** | 玻璃态毛玻璃效果，现代化 UI |
| 🌐 **多语言** | 简体中文、繁体中文、英文 |
| 🛡️ **企业安全** | 限流保护、CSP、HSTS、安全响应头 |

### 技术栈

| 技术 | 用途 | 版本 |
|------|------|------|
| Cloudflare Workers | 边缘计算运行时 | 2024-12-01 |
| WebSocket API | 实时双向通信 | RFC 6455 |
| Canvas API | 实时图表绘制 | HTML5 |
| Web Crypto API | 随机数据生成 | W3C |
| ReadableStream | 流式数据传输 | WHATWG |
| Fetch API | HTTP 请求处理 | WHATWG |

---

## 功能特性

### 📡 网络质量检测
- **实时延迟监控** - 每2秒自动测量RTT，实时趋势图表
- **丢包率测试** - 10次请求测试，实时计算丢包百分比
- **网络抖动评估** - 稳定性分级（非常稳定/稳定/不稳定/极不稳定）
- **连接质量评分** - 五档分级（优秀/良好/一般/较差/极差）

### 🚀 性能测试工具
- **带宽测速** - 多档位测试（100KB/500KB/2MB），最大 5MB
- **CPU性能测试** - 50万次密集计算，返回 ops/ms
- **并发请求测试** - 模拟 4/6/8 并发（同时限制为 4）
- **流式传输测试** - 测试 128KB/512KB/2MB 吞吐量，最大 10MB

### 🔒 安全与协议检测
- **TLS版本检测** - 识别 TLS 1.0/1.1/1.2/1.3
- **加密套件分析** - 查看协商的加密算法
- **ECH状态检测** - 检测 Encrypted Client Hello 支持
- **压缩算法检测** - Brotli/Gzip/Deflate/Zstd
- **HTTP/2/3 检测** - 识别协议版本和 Early Hints 支持

### 🌐 网络诊断工具
- **DNS解析测试** - 测试 Cloudflare/Google/GitHub 等域名
- **WebSocket测试** - 5次 ping-pong 往返延迟测试，心跳保持
- **地理位置追踪** - 边缘节点与客户端位置、距离计算
- **一键导出报告** - 生成完整诊断报告并复制

### 🛡️ 企业级安全
- **请求限流** - IP 级别 60次/分钟限流保护
- **CSP 策略** - 完整的内容安全策略
- **HSTS 强制** - HTTP 严格传输安全
- **安全响应头** - XSS/点击劫持/内容嗅探防护

> 💡 **更多详情**：完整的功能说明和实现原理请查看 [Wiki - 功能模块](./WIKI.md#功能模块)

---

## 快速开始

### 在线体验

#### 方式一：演示站点（纯前端模拟）

```bash
# 下载演示 HTML 文件
wget https://raw.githubusercontent.com/your-repo/netsight-pro/demo/index.html

# 直接在浏览器中打开
open index.html
```

#### 方式二：部署到 Cloudflare Workers

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建项目
mkdir netsight-pro && cd netsight-pro

# 4. 复制 worker.js 代码

# 5. 部署
wrangler deploy
```

### 最小化部署

**wrangler.toml**
```toml
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"

# 可选：自定义域名
# routes = [
#   { pattern = "your-domain.com", custom_domain = true }
# ]

# 可选：KV 命名空间配置
# kv_namespaces = [
#   { binding = "CACHE_KV", id = "your-kv-id" }
# ]
```

### 命令行测试

```bash
# 健康检查
curl https://your-worker.dev/health

# 带宽测试（100KB）
curl https://your-worker.dev/speedtest?size=102400

# 带宽测试（1MB）
curl https://your-worker.dev/speedtest?size=1048576

# CPU 性能测试（50万次迭代）
curl https://your-worker.dev/cpu-test?n=500000

# HTTP/2 检测
curl https://your-worker.dev/http2-test

# 并发测试（4个并发，2KB数据）
curl https://your-worker.dev/concurrent-test?count=4&size=2048

# 流式传输测试（1MB）
curl https://your-worker.dev/stream-test?size=1048576
```

> 📖 **部署指南**：详细的部署步骤和配置说明请查看 [Wiki - 部署指南](./WIKI.md#部署指南)

---

## API 文档

### 端点汇总

| 端点 | 方法 | 参数限制 | 限流 | 描述 |
|------|------|----------|------|------|
| `/health` | GET | - | ❌ | 健康检查 |
| `/speedtest` | GET | `size` ≤ 5MB | ✅ | 带宽测速 |
| `/cpu-test` | GET | `n` ≤ 200万 | ✅ | CPU 性能基准测试 |
| `/ws-test` | WebSocket | - | ✅ | WebSocket 延迟测试 |
| `/http2-test` | GET | - | ✅ | HTTP/2/3 + Early Hints |
| `/concurrent-test` | GET | `count` ≤ 16, `size` ≤ 64KB | ✅ | 并发压力测试 |
| `/stream-test` | GET | `size` ≤ 10MB | ✅ | 流式吞吐量测试 |

### 详细规范

#### GET /health

**响应**
```json
{
  "status": "ok",
  "timestamp": 1704067200000,
  "version": "3.3",
  "uptime": "unknown"
}
```

#### GET /speedtest

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| size | number | 102400 | 5242880 | 数据大小(字节) |

**响应**
- Content-Type: `application/octet-stream`
- Body: 随机二进制数据

#### GET /cpu-test

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| n | number | 500000 | 2000000 | 迭代次数 |

**响应**
```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```

#### WebSocket /ws-test

**协议**

```javascript
// 客户端发送 ping
ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

// 服务端响应 pong
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // { type: 'pong', timestamp: 1704067200000, echoTime: 1704067200000 }
};

// 客户端关闭连接
ws.send(JSON.stringify({ type: 'close' }));
```

#### GET /http2-test

**响应**
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

> 📡 **完整 API 文档**：所有端点的详细说明和示例请查看 [Wiki - API 文档](./WIKI.md#api-文档)

---

## 部署指南

### 前置条件

- [x] Cloudflare 账号
- [x] 域名（可选，可使用 workers.dev 子域名）

### 方式一：Wrangler CLI 部署（推荐）

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建项目并部署
mkdir netsight-pro && cd netsight-pro
# 将 worker.js 放入当前目录

# 部署
wrangler deploy
```

### 方式二：Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **创建应用程序** > **创建 Worker**
3. 将 `worker.js` 代码粘贴到编辑器
4. 点击 **保存并部署**
5. 可选：绑定自定义域名

### 方式三：一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/)

### 自定义域名

```toml
# wrangler.toml
routes = [
  { pattern = "diagnostics.your-domain.com", custom_domain = true }
]
```

> 🚀 **详细部署教程**：包含故障排除和最佳实践请查看 [Wiki - 部署指南](./WIKI.md#部署指南)

---

## 配置说明

### 可配置参数

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| 默认语言 | `defaultLang` | `'zh-CN'` | 可选 `'en'`, `'zh-TW'` |
| RTT 间隔 | `setTimeout(testRtt, ...)` | `2000` ms | 监控频率 |
| 图表点数 | `MAX_RTT_POINTS` | `40` | 历史数据点数 |
| 限流阈值 | `maxRequests` | `60` | 每分钟请求数 |
| 限流窗口 | `windowMs` | `60000` ms | 时间窗口 |

### 环境变量

| 变量 | 类型 | 描述 |
|------|------|------|
| `CACHE_KV` | KV Namespace | 静态资源缓存 |
| `ENVIRONMENT` | String | 运行环境 |

### 限流配置

```javascript
// 修改限流参数
function isRateLimited(ip, maxRequests = 100, windowMs = 60000) {
  // maxRequests 改为所需值
}
```

### 安全头配置

```javascript
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self' ...",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'x-xss-protection': '1; mode=block'
};
```

> ⚙️ **配置详解**：完整的配置参数说明请查看 [Wiki - 配置说明](./WIKI.md#配置说明)

---

## 安全特性

### 限流保护

- **粒度**: IP 级别（基于 `cf-connecting-ip`）
- **阈值**: 60 次/分钟
- **超限响应**: 429 Too Many Requests
- **重试头**: `Retry-After: 60`

### 安全响应头

| 头名称 | 值 | 防护目标 |
|--------|-----|----------|
| Content-Security-Policy | 完整策略 | XSS、数据注入 |
| Strict-Transport-Security | max-age=31536000 | HTTPS 降级 |
| X-Frame-Options | DENY | 点击劫持 |
| X-Content-Type-Options | nosniff | MIME 混淆 |
| X-XSS-Protection | 1; mode=block | XSS 攻击 |
| Referrer-Policy | strict-origin-when-cross-origin | 信息泄露 |

### 参数限制

| 端点 | 参数 | 限制 |
|------|------|------|
| `/speedtest` | size | ≤ 5MB |
| `/cpu-test` | n | ≤ 2,000,000 |
| `/concurrent-test` | count | ≤ 16 |
| `/concurrent-test` | size | ≤ 64KB |
| `/stream-test` | size | ≤ 10MB |

### CSP 策略

```http
Content-Security-Policy: default-src 'self'; 
  script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api4.ipify.org https://api6.ipify.org https://ipv4.icanhazip.com https://ipv6.icanhazip.com https://ip4.seeip.org;
```

> 🛡️ **安全架构**：详细的安全设计和最佳实践请查看 [Wiki - 安全特性](./WIKI.md#安全特性)

---

## 技术架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  极光 UI    │  │  Canvas图表  │  │  8个诊断工具按钮    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers 边缘节点                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   路由处理器                          │   │
│  │  /health │ /speedtest │ /cpu-test │ /ws-test │ ...  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  限流中间件  │  │  安全头中间件 │  │    CORS 中间件      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 浏览器兼容性

| 浏览器 | 最低版本 | 状态 |
|--------|----------|------|
| Chrome | 80+ | ✅ 完全支持 |
| Firefox | 75+ | ✅ 完全支持 |
| Safari | 13.1+ | ✅ 完全支持 |
| Edge | 80+ | ✅ 完全支持 |
| Opera | 67+ | ✅ 完全支持 |

> 🏗️ **架构设计**：详细的技术架构和数据流说明请查看 [Wiki - 技术架构](./WIKI.md#技术架构)

---

## 更新日志

### v3.3.0 (2026-05-28) - 企业级安全与性能优化

**✨ 新增功能**
- 🏥 **健康检查端点** - 新增 `/health` 端点，支持监控系统集成
- 🔒 **请求限流保护** - IP 级别 60次/分钟限流，防止 API 滥用
- 🛡️ **完整安全响应头** - CSP、HSTS、X-Frame-Options、X-Content-Type-Options
- 💓 **WebSocket 心跳机制** - 30秒心跳保持连接，更稳定的长连接测试
- 🔗 **资源预连接优化** - 字体和 CDN 预连接，提升页面加载速度

**⚡ 性能优化**
- 并发测试增加 4 并发限制器 `pLimit(4)`，避免资源耗尽
- 流式传输使用 `Promise.resolve().then()` 替代 `setTimeout`，解决背压问题
- 静态资源缓存优化（24小时/7天分层缓存）
- 所有测试端点增加参数上限保护（CPU:200万，并发:16，流式:10MB）

**🔧 功能改进**
- 地理位置服务降级方案 - ip-api.com 失败时使用 Cloudflare 数据
- WebSocket 连接优雅关闭，发送 `close` 消息后断开
- 限流计数器自动清理（超过1000条记录时清理过期数据）
- `Content-Security-Policy` 完整策略配置

**🐛 问题修复**
- 修复 `event` 变量作用域问题
- 修复静态资源缓存中 `event.waitUntil` 未定义错误
- 修复 WebSocket 连接超时处理
- 修复移动端图表显示异常

### v3.2.0 (2026-05-20)

**✨ 新增功能**
- 🎨 **极光主题UI全面升级** - 玻璃态毛玻璃效果，动态极光渐变背景
- 📊 **实时延迟监控模块拉长** - 独占整行展示，视觉更突出
- 📈 **新增最低/最高RTT统计** - 4列布局：当前RTT、抖动、最低RTT、最高RTT
- 🏷️ **质量指标扩展** - 连接质量、网络稳定性、样本数量、丢包率
- 📐 **图表高度增加** - 从140px增加到180px
- 🌐 **真实IP地理位置查询** - 通过 ip-api.com 获取客户端地理位置

### v3.1.0 (2026-05-15)

**✨ 新增功能**
- 🌍 **完整多语言支持** - 简体中文/繁体中文/英文
- 📊 **实时延迟图表** - Canvas 绘制实时 RTT 趋势图
- 💾 **本地存储语言偏好** - 记住用户语言选择
- 🔒 **安全协议检测增强** - ECH、TLS 版本、加密套件

### v3.0.0 (2026-05-10)

**✨ 新增功能**
- 🎨 **全新蓝色主题UI设计**
- 📡 **实时RTT监控** - 每2秒自动测量
- 🚀 **带宽测速** - 多档位测试
- 🖥️ **CPU性能测试** - 密集型计算基准
- 🔌 **WebSocket测试** - 双向延迟测试
- 🔒 **安全协议检测** - TLS/加密套件/ECH

> 📋 **完整更新历史**：查看所有版本的详细更新内容请访问 [Wiki - 更新日志](./WIKI.md#更新日志)

---

## 常见问题

### Q1: 部署后访问显示 404？

**A**: 检查 Worker 路由配置。确保 `wrangler.toml` 中正确设置了路由，或直接使用 Worker 默认域名。

### Q2: WebSocket 连接失败？

**A**: 
1. 确认 Worker 已正确部署
2. 检查防火墙是否允许 WebSocket 连接
3. 查看浏览器控制台错误信息

### Q3: 带宽测速结果不稳定？

**A**: 
1. 网络状况会影响测速结果
2. 建议多次测试取平均值
3. 确保没有其他大流量应用占用带宽

### Q4: 如何修改限流阈值？

**A**: 编辑 `worker.js` 中的 `isRateLimited` 函数

### Q5: 支持 IPv6 吗？

**A**: 完全支持。Cloudflare Workers 原生支持 IPv6。

### Q6: 如何自定义 UI 主题颜色？

**A**: 修改 CSS 变量中的颜色值

### Q7: 纯前端演示版和真实版有什么区别？

**A**: 演示版使用模拟数据，真实版连接 Worker 获取真实数据

> 💬 **更多问题**：查看完整的 FAQ 请访问 [Wiki - 常见问题](./WIKI.md#常见问题)

---

## 贡献指南

### 贡献流程

```bash
# 1. Fork 本项目
# 2. 克隆到本地
git clone https://github.com/your-username/netsight-pro.git

# 3. 创建特性分支
git checkout -b feature/AmazingFeature

# 4. 提交更改
git commit -m '✨ Add some AmazingFeature'

# 5. 推送并开启 Pull Request
git push origin feature/AmazingFeature
```

### 提交信息格式

| 类型 | 说明 | 示例 |
|------|------|------|
| ✨ feat | 新功能 | `feat: add health check endpoint` |
| 🐛 fix | 修复问题 | `fix: websocket timeout issue` |
| 📝 docs | 文档更新 | `docs: update API documentation` |
| 🎨 style | 代码格式 | `style: update card hover effect` |
| ♻️ refactor | 代码重构 | `refactor: extract common functions` |
| ⚡ perf | 性能优化 | `perf: optimize concurrent test` |
| 🔒 security | 安全相关 | `security: add rate limiting` |

> 🤝 **贡献指南**：详细的贡献规范和代码标准请查看 [Wiki - 贡献指南](./WIKI.md#贡献指南)

---

## 致谢

### 开源项目与服务

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务

---

## 许可证

本项目使用 **GNU General Public License v3.0** 许可证。

| 项目 | 说明 |
|------|------|
| **商业使用** | ✅ 允许 |
| **修改代码** | ✅ 允许 |
| **分发代码** | ✅ 允许 |
| **公开源代码** | ✅ 必须（修改后） |
| **保留版权声明** | ✅ 必须 |

---

## 联系方式

| 渠道 | 链接 |
|------|------|
| **GitHub Issues** | [提交问题](https://github.com/your-repo/netsight-pro/issues) |
| **GitHub Discussions** | [讨论区](https://github.com/your-repo/netsight-pro/discussions) |
| **📖 完整 Wiki** | [项目文档中心](./WIKI.md) |

---

<p align="center">
  <b>NetSight Pro</b><br>
  部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具
</p>

<p align="center">
  <a href="#netsight-pro-">⬆️ 返回顶部</a> •
  <a href="./WIKI.md">📖 阅读完整 Wiki</a>
</p>

<p align="center">
  <b>Made with ❤️ by BlueDriftHK</b><br>
  <b>GNU General Public License v3.0 · 开源自由 · 持续更新</b>
</p>
```

## 2. 创建独立的 WIKI.md 文件

由于 Wiki 内容较长，我创建一个完整的独立 Wiki 文件。您可以将以下内容保存为 `WIKI.md`：

```markdown
# NetSight Pro Wiki

<p align="center">
  <img src="https://img.shields.io/badge/version-3.3.0-blue?style=flat-square&logo=cloudflare" alt="Version">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-GPLv3-red?style=flat-square&logo=gnu" alt="GPLv3 License">
</p>

## 📚 目录

- [项目概述](#项目概述)
- [快速开始](#快速开始)
- [架构设计](#架构设计)
- [功能模块](#功能模块)
- [API 文档](#api-文档)
- [部署指南](#部署指南)
- [配置说明](#配置说明)
- [安全特性](#安全特性)
- [技术架构](#技术架构)
- [更新日志](#更新日志)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 项目概述

### 简介

**NetSight Pro** 是一款部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具。利用 Cloudflare 全球分布的边缘网络，提供实时网络监控、多维度性能测试和全面的安全协议检测能力。

### 核心特性

| 特性 | 说明 |
|------|------|
| ⚡ **边缘部署** | 基于 Cloudflare Workers，全球低延迟响应 |
| 📡 **实时监控** | 每2秒自动测量 RTT，实时趋势图表 |
| 🛠️ **8+ 诊断工具** | 带宽测速、CPU性能、WebSocket、并发测试等 |
| 🔒 **安全检测** | TLS版本、加密套件、ECH状态、HSTS |
| 🌍 **地理位置** | 边缘节点与客户端位置追踪 |
| 🎨 **极光主题** | 玻璃态毛玻璃效果，现代化 UI |
| 🌐 **多语言** | 简体中文、繁体中文、英文 |
| 🛡️ **企业安全** | 限流保护、CSP、HSTS、安全响应头 |

### 技术栈

| 技术 | 用途 | 版本 |
|------|------|------|
| Cloudflare Workers | 边缘计算运行时 | 2024-12-01 |
| WebSocket API | 实时双向通信 | RFC 6455 |
| Canvas API | 实时图表绘制 | HTML5 |
| Web Crypto API | 随机数据生成 | W3C |
| ReadableStream | 流式数据传输 | WHATWG |
| Fetch API | HTTP 请求处理 | WHATWG |

---

## 快速开始

### 前置条件

- [x] Cloudflare 账号
- [x] Node.js 16+ (用于 Wrangler CLI)
- [x] 域名（可选）

### 安装部署

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建项目
mkdir netsight-pro && cd netsight-pro

# 4. 创建 worker.js 文件并粘贴代码

# 5. 创建 wrangler.toml
cat > wrangler.toml << EOF
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"
EOF

# 6. 部署
wrangler deploy
```

### 验证部署

```bash
# 健康检查
curl https://your-worker.dev/health

# 预期响应
# {"status":"ok","version":"3.3","timestamp":...}
```

---

## 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  极光 UI    │  │  Canvas图表  │  │  8个诊断工具按钮    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers 边缘节点                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   路由处理器                          │   │
│  │  /health │ /speedtest │ /cpu-test │ /ws-test │ ...  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  限流中间件  │  │  安全头中间件 │  │    CORS 中间件      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
1. 用户请求 → Worker 路由 → 限流检查 → 安全头注入
2. API 请求 → 参数校验 → 业务处理 → 响应返回
3. WebSocket → 升级连接 → 心跳保持 → 消息处理
4. 实时监控 → 定时 HEAD 请求 → RTT 计算 → 图表更新
```

### 目录结构

```
netsight-pro/
├── worker.js              # Cloudflare Worker 主文件 (~1200行)
├── wrangler.toml          # Wrangler 配置文件
├── README.md              # 项目文档
├── WIKI.md                # 详细 Wiki
├── LICENSE                # GPLv3 许可证
├── .gitignore             # Git 忽略文件
└── docs/
    ├── api.md             # API 详细文档
    ├── deployment.md      # 部署指南
    └── troubleshooting.md # 故障排除
```

---

## 功能模块

### 1. 实时延迟监控

**功能描述**：每2秒自动向 Worker 发送 HEAD 请求，计算 RTT 并实时更新图表。

**技术实现**：
- 前端使用 `setInterval` + `performance.now()` 测量
- 后端响应 HEAD 请求，不返回内容体
- Canvas 绘制实时趋势图

**代码示例**：
```javascript
// 前端 RTT 测试
async function testRtt() {
    const start = performance.now();
    await fetch(`${workerUrl}/?_=${Date.now()}`, { method: 'HEAD' });
    const diff = Math.round(performance.now() - start);
    updateMetrics(diff);
}
```

### 2. 带宽测速

**功能描述**：测试 100KB、500KB、2MB 文件的下载速度。

**参数限制**：
- 最小：102400 字节 (100KB)
- 最大：5242880 字节 (5MB)

**响应示例**：
```json
{
  "sizeKB": 100,
  "speed": 45.32
}
```

### 3. CPU 性能测试

**功能描述**：执行密集型数学计算，返回操作数/毫秒。

**参数限制**：
- 最小：100,000 次迭代
- 最大：2,000,000 次迭代

**响应示例**：
```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```

### 4. WebSocket 测试

**功能描述**：建立 WebSocket 连接，执行 5 次 ping-pong 测试。

**消息格式**：

| 类型 | 方向 | 格式 |
|------|------|------|
| ping | C→S | `{"type":"ping","timestamp":1704067200000}` |
| pong | S→C | `{"type":"pong","timestamp":1704067200000,"echoTime":1704067200000}` |
| close | C→S | `{"type":"close"}` |

### 5. HTTP/2 检测

**功能描述**：检测当前连接的 HTTP/2/3 支持情况和 Early Hints 状态。

**响应字段**：
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

### 6. 并发测试

**功能描述**：模拟 4/6/8 并发请求，测试服务器并发处理能力。

**参数限制**：
- count: 最大 16
- size: 最大 64KB

### 7. 流式传输测试

**功能描述**：使用 ReadableStream 流式传输大文件，测试吞吐量。

**参数限制**：
- 最小：131072 字节 (128KB)
- 最大：10485760 字节 (10MB)

### 8. DNS 解析测试

**功能描述**：测试常见域名的 DNS 解析时间。

**测试域名**：
- Cloudflare (cloudflare.com)
- Google (google.com)
- GitHub (github.com)

---

## API 文档

### 端点汇总

| 端点 | 方法 | 参数 | 限流 | 描述 |
|------|------|------|------|------|
| `/health` | GET | - | ❌ | 健康检查 |
| `/speedtest` | GET | `size` | ✅ | 带宽测速 |
| `/cpu-test` | GET | `n` | ✅ | CPU 性能测试 |
| `/ws-test` | WS | - | ✅ | WebSocket 测试 |
| `/http2-test` | GET | - | ✅ | HTTP/2 检测 |
| `/concurrent-test` | GET | `count`, `size` | ✅ | 并发测试 |
| `/stream-test` | GET | `size` | ✅ | 流式传输 |

### 详细规范

#### GET /health

**响应**
```json
{
  "status": "ok",
  "timestamp": 1704067200000,
  "version": "3.3",
  "uptime": "unknown"
}
```

**状态码**
- 200: 服务正常
- 500: 服务异常

#### GET /speedtest

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| size | number | 102400 | 5242880 | 数据大小(字节) |

**响应**
- Content-Type: `application/octet-stream`
- Body: 随机二进制数据
- Cache-Control: `no-store`

**示例**
```bash
curl -O https://your-worker.dev/speedtest?size=1048576
```

#### GET /cpu-test

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| n | number | 500000 | 2000000 | 迭代次数 |

**响应**
```json
{
  "duration": 45,
  "duration_ms": 45,
  "iterations": 500000,
  "ops_ms": 11111.11,
  "result": "12345678"
}
```

#### WebSocket /ws-test

**协议**

```javascript
// 客户端发送 ping
ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

// 服务端响应 pong
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // { type: 'pong', timestamp: 1704067200000, echoTime: 1704067200000 }
};

// 客户端关闭连接
ws.send(JSON.stringify({ type: 'close' }));
```

**心跳机制**
- 服务端每 30 秒发送一次 ping
- 客户端应在收到 ping 后响应 pong
- 超时未响应会关闭连接

#### GET /http2-test

**响应**
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

#### GET /concurrent-test

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| count | number | 4 | 16 | 并发数量 |
| size | number | 1024 | 65536 | 每个请求数据大小 |

**响应**
```json
[
  {"index": 0, "size": 2048, "duration": 12},
  {"index": 1, "size": 2048, "duration": 14},
  {"index": 2, "size": 2048, "duration": 11},
  {"index": 3, "size": 2048, "duration": 13}
]
```

#### GET /stream-test

**请求参数**

| 参数 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| size | number | 1048576 | 10485760 | 流大小(字节) |

**响应**
- Content-Type: `application/octet-stream`
- Transfer-Encoding: `chunked`
- Cache-Control: `no-store`

---

## 部署指南

### 方式一：Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
wrangler login

# 初始化项目
wrangler init netsight-pro

# 部署
wrangler deploy
```

### 方式二：Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **创建应用程序**
3. 选择 **创建 Worker**
4. 粘贴 `worker.js` 代码
5. 点击 **保存并部署**

### 方式三：Git 部署

```bash
# 克隆仓库
git clone https://github.com/your-repo/netsight-pro.git

# 进入目录
cd netsight-pro

# 安装依赖
npm install

# 部署
npm run deploy
```

### 自定义域名

```toml
# wrangler.toml
routes = [
  { pattern = "diagnostics.your-domain.com", custom_domain = true }
]
```

### 故障排除

| 问题 | 解决方案 |
|------|----------|
| 部署后 404 | 检查路由配置，确认 worker 已正确部署 |
| WebSocket 连接失败 | 检查防火墙，确认支持 WebSocket |
| 限流触发 | 等待 60 秒后重试，或调整限流阈值 |
| CORS 错误 | 确认 `access-control-allow-origin` 头正确设置 |

---

## 配置说明

### 可配置参数

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| 默认语言 | `defaultLang` | `'zh-CN'` | 可选 `'en'`, `'zh-TW'` |
| RTT 间隔 | `setTimeout(testRtt, ...)` | `2000` ms | 监控频率 |
| 图表点数 | `MAX_RTT_POINTS` | `40` | 历史数据点数 |
| 限流阈值 | `maxRequests` | `60` | 每分钟请求数 |
| 限流窗口 | `windowMs` | `60000` ms | 时间窗口 |
| 图表高度 | `canvas.height` | `200` px | 图表高度 |

### 环境变量

| 变量 | 类型 | 描述 | 必需 |
|------|------|------|------|
| `CACHE_KV` | KV Namespace | 静态资源缓存 | ❌ |
| `ENVIRONMENT` | String | 运行环境 | ❌ |
| `DEBUG` | Boolean | 调试模式 | ❌ |

### 限流配置

```javascript
// 修改限流参数
function isRateLimited(ip, maxRequests = 100, windowMs = 60000) {
  // maxRequests: 每分钟最大请求数
  // windowMs: 时间窗口(毫秒)
}
```

### 安全头配置

```javascript
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self' ...",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'x-xss-protection': '1; mode=block',
  'referrer-policy': 'strict-origin-when-cross-origin'
};
```

---

## 安全特性

### 限流保护

- **粒度**: IP 级别（基于 `cf-connecting-ip`）
- **阈值**: 60 次/分钟
- **超限响应**: 429 Too Many Requests
- **重试头**: `Retry-After: 60`
- **自动清理**: 超过 1000 条记录时清理过期数据

### 安全响应头

| 头名称 | 值 | 防护目标 |
|--------|-----|----------|
| Content-Security-Policy | 完整策略 | XSS、数据注入 |
| Strict-Transport-Security | max-age=31536000 | HTTPS 降级 |
| X-Frame-Options | DENY | 点击劫持 |
| X-Content-Type-Options | nosniff | MIME 混淆 |
| X-XSS-Protection | 1; mode=block | XSS 攻击 |
| Referrer-Policy | strict-origin-when-cross-origin | 信息泄露 |

### 参数限制

| 端点 | 参数 | 限制 | 原因 |
|------|------|------|------|
| `/speedtest` | size | ≤ 5MB | 防止内存耗尽 |
| `/cpu-test` | n | ≤ 2,000,000 | 防止 CPU 过载 |
| `/concurrent-test` | count | ≤ 16 | 防止并发爆炸 |
| `/concurrent-test` | size | ≤ 64KB | 防止带宽滥用 |
| `/stream-test` | size | ≤ 10MB | 防止带宽滥用 |

### CSP 策略

```http
Content-Security-Policy: default-src 'self'; 
  script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api4.ipify.org https://api6.ipify.org https://ipv4.icanhazip.com;
  img-src 'self' data:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

---

## 技术架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  极光 UI    │  │  Canvas图表  │  │  8个诊断工具按钮    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers 边缘节点                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   路由处理器                          │   │
│  │  /health │ /speedtest │ /cpu-test │ /ws-test │ ...  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  限流中间件  │  │  安全头中间件 │  │    CORS 中间件      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
请求处理流程:
1. 接收请求 → 2. 路由匹配 → 3. 限流检查 → 4. 参数校验 
→ 5. 业务处理 → 6. 安全头注入 → 7. 响应返回

WebSocket 流程:
1. 升级请求 → 2. 握手确认 → 3. 心跳保持 → 4. 消息收发 → 5. 优雅关闭

实时监控流程:
1. 定时触发 → 2. HEAD 请求 → 3. RTT 计算 → 4. 图表更新 → 5. 循环执行
```

### 浏览器兼容性

| 浏览器 | 最低版本 | WebSocket | Canvas | ReadableStream |
|--------|----------|-----------|--------|----------------|
| Chrome | 80+ | ✅ | ✅ | ✅ |
| Firefox | 75+ | ✅ | ✅ | ✅ |
| Safari | 13.1+ | ✅ | ✅ | ✅ |
| Edge | 80+ | ✅ | ✅ | ✅ |
| Opera | 67+ | ✅ | ✅ | ✅ |

---

## 更新日志

### v3.3.0 (2026-05-28)

**新增**
- ✨ 健康检查端点 `/health`
- ✨ 请求限流保护（60次/分钟）
- ✨ 完整安全响应头（CSP、HSTS）
- ✨ WebSocket 心跳机制（30秒）
- ✨ 资源预连接优化

**优化**
- ⚡ 并发测试增加 4 并发限制器
- ⚡ 流式传输使用微任务替代 setTimeout
- ⚡ 静态资源缓存分层（24h/7d）
- ⚡ 参数上限保护

**修复**
- 🐛 修复 `event` 变量作用域问题
- 🐛 修复 `event.waitUntil` 未定义错误
- 🐛 修复 WebSocket 超时处理
- 🐛 修复移动端图表显示异常

### v3.2.0 (2026-05-20)

**新增**
- ✨ 极光主题 UI 全面升级
- ✨ 实时延迟监控模块独占整行
- ✨ 最低/最高 RTT 统计
- ✨ 质量指标扩展（4列布局）
- ✨ 真实 IP 地理位置查询

### v3.1.0 (2026-05-15)

**新增**
- ✨ 完整多语言支持
- ✨ Canvas 实时图表
- ✨ 本地存储语言偏好
- ✨ 安全协议检测增强

### v3.0.0 (2026-05-10)

**新增**
- ✨ 全新蓝色主题 UI
- ✨ 实时 RTT 监控
- ✨ 多档位带宽测速
- ✨ CPU 性能测试
- ✨ WebSocket 测试

**架构**
- 🏗️ 完全重写为 Cloudflare Worker 架构
- 🏗️ 边缘节点地理位置集成

---

## 常见问题

### Q1: 部署后访问显示 404？

**A**: 检查 Worker 路由配置。确保 `wrangler.toml` 中正确设置了路由，或直接使用 Worker 默认域名（`https://your-worker.your-subdomain.workers.dev`）。

### Q2: WebSocket 连接失败？

**A**: 
1. 确认 Worker 已正确部署
2. 检查防火墙是否允许 WebSocket 连接（端口 443）
3. 查看浏览器控制台错误信息
4. 确认使用了 `wss://` 协议

### Q3: 带宽测速结果不稳定？

**A**: 
1. 网络状况会影响测速结果，建议多次测试取平均值
2. 确保没有其他大流量应用占用带宽
3. 尝试不同大小的测试文件
4. 检查 Worker 限流是否触发

### Q4: 如何修改限流阈值？

**A**: 编辑 `worker.js` 中的 `isRateLimited` 函数：
```javascript
function isRateLimited(ip, maxRequests = 100, windowMs = 60000) {
  // 将 maxRequests 改为所需值，如 100
}
```

### Q5: 支持 IPv6 吗？

**A**: 完全支持。Cloudflare Workers 原生支持 IPv6，前端会同时检测 IPv4 和 IPv6 地址。

### Q6: 如何自定义 UI 主题颜色？

**A**: 修改 CSS 变量：
```css
:root {
  --primary: #3b82f6;    /* 主色调 */
  --cyan: #06b6d4;       /* 青色强调 */
  --purple: #8b5cf6;     /* 紫色点缀 */
}
```

### Q7: 纯前端演示版和真实版有什么区别？

**A**: 
| 特性 | 演示版 | 真实版 |
|------|--------|--------|
| 部署要求 | 无 | Cloudflare Worker |
| 数据来源 | 模拟生成 | 真实测量 |
| RTT 监控 | 模拟延迟 | 真实网络延迟 |
| 地理位置 | 无 | 边缘节点位置 |

### Q8: 如何获取客户端真实 IP？

**A**: 使用 `request.headers.get('cf-connecting-ip')` 获取。Cloudflare 会自动添加此头。

### Q9: Worker 执行超时怎么办？

**A**: 
1. 检查 CPU 密集型测试的迭代次数
2. 减少 `size` 参数大小
3. 升级 Cloudflare Workers 计划

### Q10: 如何备份配置？

**A**: 
```bash
# 备份 wrangler.toml
cp wrangler.toml wrangler.toml.bak

# 备份 worker.js
cp worker.js worker.js.bak

# 使用 git 版本控制
git add .
git commit -m "backup: configuration backup"
```

---

## 贡献指南

### 贡献流程

```bash
# 1. Fork 本项目
# 2. 克隆到本地
git clone https://github.com/your-username/netsight-pro.git

# 3. 创建特性分支
git checkout -b feature/amazing-feature

# 4. 提交更改
git add .
git commit -m '✨ Add amazing feature'

# 5. 推送并创建 PR
git push origin feature/amazing-feature
```

### 提交信息格式

| 类型 | 说明 | 示例 |
|------|------|------|
| ✨ feat | 新功能 | `feat: add health check endpoint` |
| 🐛 fix | 修复问题 | `fix: websocket timeout issue` |
| 📝 docs | 文档更新 | `docs: update API documentation` |
| 🎨 style | 代码格式 | `style: update card hover effect` |
| ♻️ refactor | 代码重构 | `refactor: extract common functions` |
| ⚡ perf | 性能优化 | `perf: optimize concurrent test` |
| 🔒 security | 安全相关 | `security: add rate limiting` |
| 🧪 test | 测试相关 | `test: add unit tests` |
| 🔧 chore | 构建/工具 | `chore: update dependencies` |

### 代码规范

- 使用 ES2020+ 语法
- 添加必要的注释
- 保持函数单一职责
- 错误处理使用 try-catch
- 使用 const/let 避免 var
- 异步操作使用 async/await

### 测试要求

- 新功能需通过本地测试
- 不影响现有功能
- WebSocket 连接测试通过
- 限流功能正常工作
- 安全头正确返回

### PR 审核标准

- [ ] 代码符合规范
- [ ] 通过所有测试
- [ ] 文档已更新
- [ ] 无破坏性变更
- [ ] 提交信息清晰

---

## 致谢

### 开源项目与服务

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务
- [icanhazip.com](https://icanhazip.com/) - IP 地址检测服务

### 贡献者

感谢所有为本项目做出贡献的开发者！

---

## 许可证

本项目使用 **GNU General Public License v3.0** 许可证。

| 项目 | 说明 |
|------|------|
| 商业使用 | ✅ 允许 |
| 修改代码 | ✅ 允许 |
| 分发代码 | ✅ 允许 |
| 公开源代码 | ✅ 必须（修改后） |
| 保留版权声明 | ✅ 必须 |
| 专利授权 | ✅ 包含 |
| 私人使用 | ✅ 允许 |

---

## 联系方式

| 渠道 | 链接 |
|------|------|
| GitHub Issues | [提交问题](https://github.com/your-repo/netsight-pro/issues) |
| GitHub Discussions | [讨论区](https://github.com/your-repo/netsight-pro/discussions) |
| 电子邮件 | support@netsight-pro.com |

---

<p align="center">
  <b>NetSight Pro</b><br>
  部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具
</p>

<p align="center">
  <a href="#netsight-pro-wiki">⬆️ 返回顶部</a>
</p>

<p align="center">
  <b>Made with ❤️ by BlueDriftHK</b><br>
  <b>GNU General Public License v3.0 · 开源自由 · 持续更新</b>
</p>
   - 文档页面可托管在 GitHub Pages

这样用户就可以在 README 和完整 Wiki 之间方便地跳转了！
