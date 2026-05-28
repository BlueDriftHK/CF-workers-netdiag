# NetSight Pro 🔍

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-blue?style=for-the-badge&logo=cloudflare" alt="Version">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-GPLv3-red?style=for-the-badge&logo=gnu" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/UI-极光主题-06b6d4?style=for-the-badge" alt="UI Theme">
  <img src="https://img.shields.io/badge/语言-多语言支持-8b5cf6?style=for-the-badge" alt="Multi Language">
</p>

<p align="center">
  <strong>⚡ 部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具</strong><br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-api-端点">API 端点</a> •
  <a href="#-更新日志">更新日志</a> •
  <a href="#-部署指南">部署指南</a> •
  <a href="#-技术架构">技术架构</a> •
  <a href="#-配置说明">配置说明</a> •
  <a href="#-许可证">许可证</a>
</p>

---

## 📊 界面预览

| 模块 | 展示内容 |
|------|----------|
| 🎯 **英雄区** | IPv4/IPv6 地址、边缘节点信息、Worker 耗时 |
| 📡 **实时延迟监控** | 当前 RTT、抖动、最低/最高 RTT、实时图表、质量评估 |
| 🔒 **安全与协议** | TLS 版本、加密套件、ECH 状态、压缩算法、机器人评分 |
| 📍 **地理位置** | 边缘节点位置、真实 IP 位置、距离计算、运营商信息 |
| 🛠️ **诊断工具集** | 8+ 种测试工具，一键运行 |
| 💻 **硬件信息** | CPU 核心、屏幕分辨率、时区、语言、平台 |

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 📡 网络质量检测
- **实时延迟监控** - 每2秒自动测量RTT，实时趋势图表
- **丢包率测试** - 10次请求测试，实时计算丢包百分比
- **网络抖动评估** - 稳定性分级（非常稳定/稳定/不稳定）
- **连接质量评分** - 五档分级（优秀/良好/一般/较差/极差）

### 🚀 性能测试工具
- **带宽测速** - 多档位测试（100KB/500KB/2MB）
- **CPU性能测试** - 50万次密集计算，返回 ops/ms
- **并发请求测试** - 模拟 4/6/8 并发访问
- **流式传输测试** - 测试 128KB/512KB/2MB 吞吐量

</td>
<td width="50%">

### 🔒 安全与协议检测
- **TLS版本检测** - 识别 TLS 1.0/1.1/1.2/1.3
- **加密套件分析** - 查看协商的加密算法
- **ECH状态检测** - 检测 Encrypted Client Hello 支持
- **压缩算法检测** - Brotli/Gzip/Deflate/Zstd

### 🌐 网络诊断工具
- **DNS解析测试** - 测试 Cloudflare/Google/GitHub 等域名
- **WebSocket测试** - 5次 ping-pong 往返延迟测试
- **地理位置追踪** - 边缘节点与客户端位置、距离计算
- **一键导出报告** - 生成完整诊断报告并复制

</td>
</tr>
</table>

---

## 🚀 快速开始

### 在线体验

部署后直接访问 Worker 域名即可使用完整的网络诊断界面。

### 命令行快速测试

```bash
# 带宽测试（100KB）
curl "https://your-worker.dev/speedtest?size=102400"

# 带宽测试（1MB）
curl "https://your-worker.dev/speedtest?size=1048576"

# CPU 性能测试（50万次迭代）
curl "https://your-worker.dev/cpu-test?n=500000"

# 并发测试（4个并发，2KB数据）
curl "https://your-worker.dev/concurrent-test?count=4&size=2048"

# 流式传输测试（1MB）
curl "https://your-worker.dev/stream-test?size=1048576"

# HTTP/2 Push 检测
curl "https://your-worker.dev/push-test"

# WebSocket 连接测试
wss://your-worker.dev/ws-test
```

---

## 📡 API 端点

### 端点概览

| 端点 | 方法 | 参数 | 返回类型 | 描述 |
|------|------|------|----------|------|
| `/speedtest` | GET | `size` (默认102400) | `application/octet-stream` | 带宽测速，返回随机二进制数据 |
| `/cpu-test` | GET | `n` (默认500000) | `application/json` | CPU 性能基准测试 |
| `/ws-test` | WebSocket | - | WebSocket 消息 | ping-pong 延迟测试 |
| `/push-test` | GET | `pushed` | `text/plain` | HTTP/2 Server Push 检测 |
| `/concurrent-test` | GET | `count`, `size` | `application/json` | 并发请求压力测试 |
| `/stream-test` | GET | `size` (默认1048576) | `application/octet-stream` | 流式传输吞吐量测试 |

### API 响应示例

<details>
<summary><b>CPU 测试响应</b></summary>

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
<summary><b>并发测试响应</b></summary>

```json
[
  {"index": 0, "size": 2048, "duration": 12},
  {"index": 1, "size": 2048, "duration": 14},
  {"index": 2, "size": 2048, "duration": 11},
  {"index": 3, "size": 2048, "duration": 13}
]
```
</details>

---

## 📦 部署指南

### 方式一：Wrangler CLI 部署（推荐）

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建项目并部署
mkdir netsight-pro && cd netsight-pro
# 将 worker.js 放入当前目录
```

**wrangler.toml 配置：**
```toml
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"

# 可选：自定义域名路由
# routes = [
#   { pattern = "your-domain.com", custom_domain = true }
# ]

[env.production]
vars = { ENVIRONMENT = "production" }
```

```bash
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

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/your-repo/netsight-pro)

---

## 📁 项目结构

```
netsight-pro/
├── worker.js              # Cloudflare Worker 主文件（~800行）
├── wrangler.toml          # Wrangler 配置文件
├── package.json           # 项目依赖（可选）
├── README.md              # 项目文档
├── LICENSE                # GPLv3 许可证
└── .gitignore             # Git 忽略文件
```

---

## 📋 更新日志

### v3.1.0 (2026-05-28)

**✨ 新增功能**
- 🎨 **极光主题UI全面升级** - 玻璃态毛玻璃效果，动态极光渐变背景
- 📊 **实时延迟监控模块拉长** - 独占整行展示，视觉更突出
- 📈 **新增最低/最高RTT统计** - 4列布局：当前RTT、抖动、最低RTT、最高RTT
- 🏷️ **质量指标扩展** - 连接质量、网络稳定性、样本数量、丢包率
- 📐 **图表高度增加** - 从140px增加到180px
- 🌐 **真实IP地理位置查询** - 通过 ip-api.com 获取客户端地理位置

**🔧 优化改进**
- 优化响应式布局，完美适配移动端
- 增强卡片悬浮动画效果
- 改进图表绘制性能

**🐛 问题修复**
- 修复移动端图表显示异常
- 修复 WebSocket 连接超时处理
- 修复多语言切换文本更新问题

<details>
<summary><b>查看更多历史版本</b></summary>

### v2.0.0 (2026-05-10)
- 🎨 全新蓝色主题UI设计
- 🌍 完整的多语言支持（简中/繁中/英文）
- 📊 连接质量实时评估
- 📋 最低/最高RTT统计
- 💾 本地存储语言偏好

### v1.0.0 (2026-05-01) - 初始版本
- 📡 实时RTT监控
- 🚀 带宽测速
- 🖥️ CPU性能测试
- 🔌 WebSocket测试
- 🔒 安全协议检测

</details>

---

## 🛠️ 技术架构

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

## 🔧 配置说明

### 自定义修改指南

| 修改项 | 位置 | 默认值 | 说明 |
|--------|------|--------|------|
| 默认语言 | `defaultLang` | `'zh-CN'` | 改为 `'en'` 或 `'zh-TW'` |
| RTT测试间隔 | `setTimeout(testRtt, ...)` | `2000` 毫秒 | 调整监控频率 |
| 图表数据点 | `MAX_RTT_POINTS` | `40` | 图表显示的历史点数 |
| 测试超时 | 各测试函数的 `timeout` | `3000` 毫秒 | 单个测试超时时间 |

### 环境变量

| 变量名 | 类型 | 描述 | 必需 |
|--------|------|------|------|
| `CACHE_KV` | KV Namespace | 静态资源缓存 | 否 |
| `ENVIRONMENT` | String | 运行环境 | 否 |

---

## 📄 许可证

本项目使用 **GNU General Public License v3.0** 许可证。

| 项目 | 说明 |
|------|------|
| **许可类型** | 开源许可证 |
| **商业使用** | ✅ 允许 |
| **修改代码** | ✅ 允许 |
| **分发代码** | ✅ 允许 |
| **公开源代码** | ✅ 必须（修改后） |
| **保留版权声明** | ✅ 必须 |

> 完整许可证文本请查看 [LICENSE](./LICENSE) 文件

---

## 🤝 贡献指南

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

- `feat`: 新功能
- `fix`: 修复问题
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具

---

## 🙏 致谢

### 开源项目与服务

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务

---

## 📞 联系方式

| 渠道 | 链接 |
|------|------|
| **GitHub Issues** | [提交问题](https://github.com/your-repo/netsight-pro/issues) |
| **GitHub Discussions** | [讨论区](https://github.com/your-repo/netsight-pro/discussions) |

---

<p align="center">
  <b>NetSight Pro</b><br>
  部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具<br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计
</p>
---
<p align="center"> <b>Made with ❤️ by BlueDriftHK</b> </p><p align="center"> <b>GNU General Public License v3.0 · 开源自由 · 持续更新</b> </p>
