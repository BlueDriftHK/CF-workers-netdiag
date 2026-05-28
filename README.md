# NetSight Pro 🔍

<p align="center">
  <img src="https://img.shields.io/badge/version-3.3.0-blue?style=for-the-badge&logo=cloudflare" alt="Version">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-GPLv3-red?style=for-the-badge&logo=gnu" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/UI-极光主题-06b6d4?style=for-the-badge" alt="UI Theme">
  <img src="https://img.shields.io/badge/语言-多语言支持-8b5cf6?style=for-the-badge" alt="Multi Language">
</p>

<p align="center">
  <strong>⚡ 部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具</strong><br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计 · 企业级安全防护
</p>

<p align="center">
  <a href="#-主要特性">主要特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-部署指南">部署指南</a> •
  <a href="#-api-端点">API 端点</a> •
  <a href="#-更新日志">更新日志</a> •
  <a href="#-许可证">许可证</a>
</p>

---

## 📖 项目文档

> **完整的部署指南、配置说明、API文档和常见问题请查阅以下Wiki页面：**

<p align="center">
  <a href="https://github.com/BlueDriftHK/CF-workers-netdiag/wiki/Wiki-About-The--CF%E2%80%90workers%E2%80%90netdiag-ZH%E2%80%90CN">
    <img src="https://img.shields.io/badge/📖-Wiki_中文-06b6d4?style=for-the-badge&logo=gitbook" alt="中文Wiki">
  </a>
  <a href="https://github.com/BlueDriftHK/CF-workers-netdiag/wiki/Wiki-About-The-CF%E2%80%90workers%E2%80%90netdiag-English">
    <img src="https://img.shields.io/badge/📖-Wiki_English-3b82f6?style=for-the-badge&logo=gitbook" alt="English Wiki">
  </a>
</p>

---

## ✨ 主要特性

<table>
<tr>
<td width="50%">

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

</td>
<td width="50%">

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

</td>
</tr>
</table>

---

## 🚀 快速开始

### 在线体验

#### 方式一：演示站点（纯前端模拟）

```bash
# 下载演示 HTML 文件
wget https://raw.githubusercontent.com/BlueDriftHK/CF-workers-netdiag/main/index.html

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

### 命令行测试

```bash
# 健康检查
curl https://your-worker.dev/health

# 带宽测试（100KB）
curl https://your-worker.dev/speedtest?size=102400

# CPU 性能测试（50万次迭代）
curl https://your-worker.dev/cpu-test?n=500000

# HTTP/2 检测
curl https://your-worker.dev/http2-test

# 并发测试（4个并发，2KB数据）
curl https://your-worker.dev/concurrent-test?count=4&size=2048

# 流式传输测试（1MB）
curl https://your-worker.dev/stream-test?size=1048576
```

---

## 📦 部署指南

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

**wrangler.toml 配置：**
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

### 方式二：Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **创建应用程序** > **创建 Worker**
3. 将 `worker.js` 代码粘贴到编辑器
4. 点击 **保存并部署**
5. 可选：绑定自定义域名

### 方式三：一键部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/)

---

## 📡 API 端点

| 端点 | 方法 | 参数限制 | 限流 | 描述 |
|------|------|----------|------|------|
| `/health` | GET | - | ❌ | 健康检查 |
| `/speedtest` | GET | `size` ≤ 5MB | ✅ | 带宽测速 |
| `/cpu-test` | GET | `n` ≤ 200万 | ✅ | CPU 性能基准测试 |
| `/ws-test` | WebSocket | - | ✅ | WebSocket 延迟测试 |
| `/http2-test` | GET | - | ✅ | HTTP/2/3 + Early Hints |
| `/concurrent-test` | GET | `count` ≤ 16, `size` ≤ 64KB | ✅ | 并发压力测试 |
| `/stream-test` | GET | `size` ≤ 10MB | ✅ | 流式吞吐量测试 |

### API 响应示例

<details>
<summary><b>🏥 健康检查响应</b></summary>

```json
{
  "status": "ok",
  "timestamp": 1704067200000,
  "version": "3.3",
  "uptime": "unknown"
}
```
</details>

<details>
<summary><b>⚙️ CPU 测试响应</b></summary>

```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```
</details>

<details>
<summary><b>🌐 HTTP/2 测试响应</b></summary>

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
</details>

---

## 🔧 技术架构

| 技术 | 用途 | 版本 |
|------|------|------|
| **Cloudflare Workers** | 边缘计算运行时 | 2024-12-01 |
| **WebSocket API** | 实时双向通信测试 | RFC 6455 |
| **Canvas API** | 实时延迟图表绘制 | HTML5 |
| **Fetch API** | HTTP 请求处理 | WHATWG |
| **Web Crypto API** | 随机数据生成 | W3C |
| **ReadableStream API** | 流式数据传输 | WHATWG |

### 浏览器兼容性

| 浏览器 | 最低版本 | 状态 |
|--------|----------|------|
| Chrome | 80+ | ✅ 完全支持 |
| Firefox | 75+ | ✅ 完全支持 |
| Safari | 13.1+ | ✅ 完全支持 |
| Edge | 80+ | ✅ 完全支持 |

---

## 📋 更新日志

### v3.3.0 (2026-05-28) - 企业级安全与性能优化

**✨ 新增功能**
- 🏥 **健康检查端点** - 新增 `/health` 端点，支持监控系统集成
- 🔒 **请求限流保护** - IP 级别 60次/分钟限流，防止 API 滥用
- 🛡️ **完整安全响应头** - CSP、HSTS、X-Frame-Options、X-Content-Type-Options
- 💓 **WebSocket 心跳机制** - 30秒心跳保持连接，更稳定的长连接测试

**⚡ 性能优化**
- 并发测试增加 4 并发限制器 `pLimit(4)`，避免资源耗尽
- 流式传输使用 `Promise.resolve().then()` 替代 `setTimeout`
- 静态资源缓存优化（24小时/7天分层缓存）
- 所有测试端点增加参数上限保护

**🐛 问题修复**
- 修复 `event` 变量作用域问题
- 修复静态资源缓存中 `event.waitUntil` 未定义错误
- 修复 WebSocket 连接超时处理

### v3.2.0 (2026-05-20)

**✨ 新增功能**
- 🎨 极光主题UI全面升级 - 玻璃态毛玻璃效果
- 📊 实时延迟监控模块拉长，独占整行展示
- 📈 新增最低/最高RTT统计
- 🌐 真实IP地理位置查询

### v3.1.0 (2026-05-15)

**✨ 新增功能**
- 🌍 完整多语言支持（简体/繁体/英文）
- 📊 Canvas 实时延迟图表绘制
- 💾 本地存储语言偏好设置

### v3.0.0 (2026-05-10)

**✨ 新增功能**
- 🎨 全新蓝色主题UI设计
- 📡 实时RTT监控 - 每2秒自动测量
- 🚀 多档位带宽测速功能
- 🖥️ CPU性能密集型测试
- 🔌 WebSocket双向延迟测试

---

## 🛡️ 安全特性

| 安全项 | 配置 | 说明 |
|--------|------|------|
| **限流保护** | 60次/分钟 | IP 级别限流，超限返回 429 |
| **CSP 策略** | 完整策略 | 防止 XSS 和数据注入 |
| **HSTS** | max-age=31536000 | 强制 HTTPS 连接 |
| **X-Frame-Options** | DENY | 防止点击劫持 |
| **X-Content-Type-Options** | nosniff | 防止 MIME 类型混淆 |
| **参数限制** | 各端点独立 | 防止资源耗尽攻击 |

---

## 📁 项目结构

```
netsight-pro/
├── worker.js              # Cloudflare Worker 主文件 (~1200行)
├── wrangler.toml          # Wrangler 配置文件
├── index.html             # 纯前端演示版
├── README.md              # 项目文档
├── LICENSE                # GPLv3 许可证
└── .gitignore             # Git 忽略文件
```

---

## 🤝 贡献指南

### 贡献流程

```bash
# 1. Fork 本项目
# 2. 克隆到本地
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git

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

---

## 🙏 致谢

### 开源项目与服务

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务

---

## 📄 许可证

本项目使用 **GNU General Public License v3.0** 许可证。

| 项目 | 说明 |
|------|------|
| **商业使用** | ✅ 允许 |
| **修改代码** | ✅ 允许 |
| **分发代码** | ✅ 允许 |
| **公开源代码** | ✅ 必须（修改后） |
| **保留版权声明** | ✅ 必须 |
| **专利授权** | ✅ 包含 |

> 完整许可证文本请查看 [LICENSE](./LICENSE) 文件

---

## 📞 联系方式

| 渠道 | 链接 |
|------|------|
| **GitHub Issues** | [提交问题](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) |
| **GitHub Discussions** | [讨论区](https://github.com/BlueDriftHK/CF-workers-netdiag/discussions) |
| **📖 中文 Wiki** | [完整文档](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki/Wiki-About-The--CF%E2%80%90workers%E2%80%90netdiag-ZH%E2%80%90CN) |
| **📖 English Wiki** | [Full Documentation](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki/Wiki-About-The-CF%E2%80%90workers%E2%80%90netdiag-English) |

---

<p align="center">
  <b>NetSight Pro</b><br>
  部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具<br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计 · 企业级安全防护
</p>

<p align="center">
  <b>Made with ❤️ by <a href="https://github.com/BlueDriftHK">BlueDriftHK</a></b>
</p>

<p align="center">
  <b>GNU General Public License v3.0 · 开源自由 · 持续更新</b>
</p>

<p align="center">
  <a href="#netsight-pro-">⬆️ 返回顶部</a>
</p>
