# NetSight Pro 🔍

<p align="center">
  <img src="https://img.shields.io/badge/version-3.1.0-blue?style=for-the-badge&logo=cloudflare" alt="Version">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License">
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
  <a href="#-配置说明">配置说明</a>
</p>

---

## 📸 界面预览

<p align="center">
  <img src="https://raw.githubusercontent.com/your-repo/netsight-pro/main/screenshot.png" alt="NetSight Pro 界面预览" width="800">
</p>

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

| 功能模块 | 图标 | 描述 |
|---------|------|------|
| **实时延迟监控** | 📡 | 每2秒自动测量往返时延（RTT），实时绘制趋势图表，计算网络抖动、丢包率和连接质量评估 |
| **带宽测速** | 🚀 | 多档位文件下载速度测试（100KB/500KB/2MB），计算平均带宽和实时速率 |
| **安全协议检测** | 🔒 | 检测TLS版本、加密套件、ECH状态、HTTP/2推送支持和压缩算法（Brotli/Gzip） |
| **地理位置追踪** | 📍 | 显示边缘节点和客户端真实地理位置，计算两者之间的直线距离 |
| **CPU性能测试** | 🖥️ | 执行50万次密集计算测试，评估设备处理能力，返回每毫秒操作数（ops/ms） |
| **WebSocket测试** | 🔌 | 5次ping-pong往返测试，计算WebSocket连接的平均、最小和最大延迟 |
| **并发请求测试** | 📦 | 模拟多用户并发访问（4/6/8并发），测试服务器处理能力 |
| **流式传输测试** | 🌊 | 测试大文件流式传输吞吐量（128KB/512KB/2MB） |
| **DNS解析测试** | 🌐 | 测试 Cloudflare、Google、GitHub 等域名的 DNS 解析速度 |
| **丢包率测试** | 📉 | 10次请求测试丢包情况，实时计算丢包百分比 |
| **一键导出报告** | 📋 | 生成完整的网络诊断报告，支持一键复制到剪贴板 |

---

## 🚀 快速开始

### 在线体验

部署后直接访问 Worker 域名即可使用完整的网络诊断界面。

### 基础使用

```bash
# 访问主界面
https://your-worker.dev/

# 带宽测试（100KB）
curl "https://your-worker.dev/speedtest?size=102400"

# 带宽测试（1MB）
curl "https://your-worker.dev/speedtest?size=1048576"

# CPU 性能测试（50万次迭代）
curl "https://your-worker.dev/cpu-test?n=500000"

# WebSocket 连接测试
wss://your-worker.dev/ws-test

# 并发测试（4个并发，2KB数据）
curl "https://your-worker.dev/concurrent-test?count=4&size=2048"

# 流式传输测试（1MB）
curl "https://your-worker.dev/stream-test?size=1048576"

# HTTP/2 Push 检测
curl "https://your-worker.dev/push-test"
```

---

## 📡 API 端点

| 端点 | 方法 | 参数 | 返回类型 | 描述 |
|------|------|------|----------|------|
| `/speedtest` | GET | `size` (字节数, 默认102400) | `application/octet-stream` | 带宽测速，返回随机二进制数据 |
| `/cpu-test` | GET | `n` (迭代次数, 默认500000) | `application/json` | CPU 性能基准测试，返回 ops/ms |
| `/ws-test` | WebSocket | - | WebSocket 消息 | WebSocket ping-pong 延迟测试 |
| `/push-test` | GET | `pushed` (布尔值) | `text/plain` | HTTP/2 Server Push 检测 |
| `/concurrent-test` | GET | `count` (并发数), `size` (大小) | `application/json` | 并发请求压力测试 |
| `/stream-test` | GET | `size` (字节数, 默认1048576) | `application/octet-stream` | 流式传输吞吐量测试 |

### API 响应示例

**CPU 测试响应：**
```json
{
  "duration": 45,
  "iterations": 500000,
  "opsMs": 11111.11,
  "result": "12345678"
}
```

**并发测试响应：**
```json
[
  {"index": 0, "size": 2048, "duration": 12},
  {"index": 1, "size": 2048, "duration": 14},
  {"index": 2, "size": 2048, "duration": 11},
  {"index": 3, "size": 2048, "duration": 13}
]
```

---

## 📦 部署指南

### 方式一：Wrangler CLI 部署（推荐）

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 创建项目目录
mkdir netsight-pro
cd netsight-pro

# 4. 创建 worker.js 文件（粘贴完整代码）

# 5. 创建 wrangler.toml 配置文件
```

**wrangler.toml 配置：**
```toml
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"

# 可选：绑定 KV 命名空间（用于静态资源缓存）
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "your-kv-namespace-id"

# 可选：自定义域名路由
# routes = [
#   { pattern = "your-domain.com", custom_domain = true }
# ]

[env.production]
vars = { ENVIRONMENT = "production" }
```

```bash
# 6. 部署
wrangler deploy

# 7. 部署到生产环境
wrangler deploy --env production
```

### 方式二：Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **创建应用程序** > **创建 Worker**
3. 将 `worker.js` 代码粘贴到编辑器中
4. 点击 **保存并部署**
5. 可选：绑定自定义域名（触发器 > 路由 > 添加路由）

### 方式三：Git 连接部署

```bash
# 克隆项目
git clone https://github.com/your-repo/netsight-pro.git
cd netsight-pro

# 安装依赖（可选，用于开发）
npm install

# 部署
npm run deploy
```

### 方式四：一键部署按钮

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/your-repo/netsight-pro)

---

## 📁 项目结构

```
netsight-pro/
├── worker.js              # Cloudflare Worker 主文件（完整代码约 800 行）
├── wrangler.toml          # Wrangler 配置文件
├── package.json           # 项目依赖（可选）
├── README.md              # 项目文档
├── LICENSE                # MIT 许可证
└── .gitignore             # Git 忽略文件
```

---

## 📋 更新日志

### v3.1.0 (2024年12月15日)

**✨ 新增功能**
- 🎨 **极光主题UI全面升级**：玻璃态毛玻璃效果增强，动态极光渐变背景（蓝/紫/青色）
- 📊 **实时延迟监控模块拉长**：独占整行展示（`grid-column: 1 / -1`），视觉更突出
- 📈 **新增最低/最高RTT统计**：RTT显示区从2列升级为4列
  - 当前 RTT
  - 抖动
  - 最低 RTT（历史最小值）
  - 最高 RTT（历史最大值）
- 🏷️ **质量指标扩展**：从2列升级为4列
  - 连接质量（优秀/良好/一般/较差/极差）
  - 网络稳定性（非常稳定/稳定/不稳定/极不稳定）
  - 样本数量
  - 丢包率（实时计算）
- 📐 **图表高度增加**：从140px增加到180px，趋势展示更清晰
- 🌐 **真实IP地理位置查询**：通过 ip-api.com 获取客户端真实地理位置

**🔧 优化改进**
- 优化响应式布局，完美适配移动端（1024px/768px/480px断点）
- 增强卡片悬浮动画效果（上浮6px，阴影加深）
- 改进字体和间距，提升可读性
- 优化图表绘制性能，使用 ResizeObserver 监听容器变化
- 增强错误处理和用户提示

**🐛 问题修复**
- 修复移动端图表显示异常问题
- 修复 WebSocket 连接超时处理
- 修复多语言切换时部分文本未更新的问题

---

### v2.0.0 (2024年11月20日)

**✨ 新增功能**
- 🎨 **全新蓝色主题UI设计**：毛玻璃效果（`backdrop-filter: blur(20px)`）、动态网格背景、光晕效果
- 🌍 **完整的多语言支持**：
  - 简体中文（zh-CN）
  - 繁体中文（zh-TW）
  - 英文（en）
- 📊 **连接质量实时评估**：五档分级（优秀/良好/一般/较差/极差）
- 🔄 **网络稳定性评估**：四档分级（非常稳定/稳定/不稳定/极不稳定）
- 📋 **最低/最高RTT统计**：历史记录追踪
- 📉 **丢包率实时监控**：基于连续请求失败实时计算
- 💾 **本地存储语言偏好**：记住用户语言选择

**🔧 优化改进**
- 优化所有测试端点的超时处理机制（统一3秒超时）
- 改进图表绘制算法，增加渐变填充效果
- 增强错误处理和用户提示
- 优化移动端触摸体验（增大按钮点击区域）
- 改进 IP 检测逻辑，支持 IPv4/IPv6 自动检测
- 优化硬件信息展示，使用芯片样式

**🐛 问题修复**
- 修复 DNS 测试超时导致页面卡死的问题
- 修复并发测试数据不准确的问题
- 修复流式测试内存泄漏问题

---

### v1.5.0 (2024年10月15日)

**✨ 新增功能**
- 📦 **并发请求测试**：模拟多用户并发访问（4/6/8并发），测试服务器处理能力
- 🌊 **流式传输测试**：测试大文件流式读取吞吐量（128KB/512KB/2MB）
- 🚀 **HTTP/2 Server Push 检测**：检测服务器推送支持状态
- 🔐 **ECH 状态检测**：检测 TLS Encrypted Client Hello 支持情况
- 📊 **压缩算法检测**：检测 Brotli/Gzip/Deflate/Zstd 支持

**🔧 优化改进**
- 优化带宽测速算法，提高准确度
- 增加多档位测试（100KB/500KB/2MB）
- 改进 WebSocket 连接稳定性，增加重试机制
- 优化 CPU 测试性能，减少对主线程的影响

**🐛 问题修复**
- 修复 WebSocket 在特定网络环境下的连接失败问题
- 修复带宽测速结果偏差过大的问题

---

### v1.0.0 (2024年9月1日) - 初始版本

**✨ 核心功能**
- 📡 **实时RTT监控**：每2秒自动测量，实时图表绘制
- 📊 **丢包率测试**：10次请求测试丢包情况
- 🚀 **带宽测速**：多档位下载速度测试
- 🌐 **DNS解析测试**：测试 Cloudflare、Google、GitHub 域名解析速度
- 🖥️ **CPU性能测试**：50万次迭代密集计算基准测试
- 🔌 **WebSocket测试**：5次 ping-pong 延迟测试
- 🔒 **安全协议检测**：TLS版本、加密套件、证书信息
- 📍 **地理位置追踪**：边缘节点和客户端位置
- 📋 **一键复制报告**：生成完整诊断报告并复制到剪贴板

**🎨 界面特性**
- 玻璃态毛玻璃效果设计（`backdrop-filter: blur(16px)`）
- 实时延迟图表（Canvas 绘制，支持 30 个数据点）
- 中英文双语支持
- 响应式布局，完美支持移动端
- 硬件信息检测（CPU核心数、屏幕分辨率、时区、语言、平台）
- 暗色主题，护眼模式

**📡 API 端点**
- `GET /speedtest` - 带宽测速
- `GET /cpu-test` - CPU 性能测试
- `WebSocket /ws-test` - WebSocket 测试
- `GET /push-test` - H2 Push 检测

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
| **Intersection Observer API** | 滚动动画效果 | W3C |
| **ResizeObserver API** | 图表尺寸自适应 | W3C |
| **Intl API** | 国际化支持 | ECMAScript |

### 浏览器兼容性

| 浏览器 | 最低版本 | 状态 |
|--------|----------|------|
| Chrome | 80+ | ✅ 完全支持 |
| Firefox | 75+ | ✅ 完全支持 |
| Safari | 13.1+ | ✅ 完全支持 |
| Edge | 80+ | ✅ 完全支持 |
| Opera | 67+ | ✅ 完全支持 |
| iOS Safari | 13.4+ | ✅ 完全支持 |
| Android Chrome | 80+ | ✅ 完全支持 |

---

## 🔧 配置说明

### 环境变量

| 变量名 | 类型 | 描述 | 默认值 | 是否必需 |
|--------|------|------|--------|----------|
| `CACHE_KV` | KV Namespace | KV 命名空间绑定，用于静态资源缓存 | - | 否 |
| `ENVIRONMENT` | String | 运行环境（development/production） | production | 否 |

### wrangler.toml 完整配置

```toml
# Worker 基本信息
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"

# 资源限制（可选）
limits = {
  cpu_ms = 50,
  subrequests = 50
}

# KV 命名空间绑定（可选）
# [[kv_namespaces]]
# binding = "CACHE_KV"
# id = "your-kv-namespace-id"
# preview_id = "your-kv-namespace-preview-id"

# 自定义域名路由（可选）
# routes = [
#   { pattern = "netsight-pro.your-domain.com", custom_domain = true }
# ]

# 环境变量
[vars]
ENVIRONMENT = "production"

# 开发环境配置
[env.dev]
vars = { ENVIRONMENT = "development" }

# 生产环境配置
[env.production]
vars = { ENVIRONMENT = "production" }
routes = [
  { pattern = "netsight-pro.your-domain.com", custom_domain = true }
]
```

### 自定义修改指南

#### 修改默认语言

在 `worker.js` 中找到以下代码：

```javascript
let defaultLang = 'zh-CN';
```

修改为需要的语言：
- `'zh-CN'` - 简体中文
- `'zh-TW'` - 繁体中文
- `'en'` - 英文

#### 修改 RTT 测试间隔

找到 `setTimeout(testRtt, 2000);`，修改 2000 为需要的毫秒数。

#### 修改图表数据点数量

找到 `const MAX_RTT_POINTS = 40;`，修改为需要的数量。

#### 修改测试超时时间

在各个测试函数中找到 `timeout` 参数，修改为需要的毫秒数。

---

## 🤝 贡献指南

### 贡献流程

1. **Fork 本项目**
   ```bash
   git clone https://github.com/your-username/netsight-pro.git
   cd netsight-pro
   ```

2. **创建特性分支**
   ```bash
   git checkout -b feature/AmazingFeature
   ```

3. **提交更改**
   ```bash
   git add .
   git commit -m '✨ Add some AmazingFeature'
   ```

4. **推送到分支**
   ```bash
   git push origin feature/AmazingFeature
   ```

5. **开启 Pull Request**

### 开发规范

- 使用 ESLint 进行代码检查
- 遵循 JavaScript Standard Style
- 提交信息格式：`<type>: <subject>`
  - `feat`: 新功能
  - `fix`: 修复问题
  - `docs`: 文档更新
  - `style`: 代码格式调整
  - `refactor`: 代码重构
  - `test`: 测试相关
  - `chore`: 构建/工具相关

### 代码审查清单

- [ ] 代码符合项目风格规范
- [ ] 添加了必要的注释
- [ ] 测试通过（本地部署验证）
- [ ] 更新了相关文档
- [ ] 没有引入新的控制台错误

---

## 📄 许可证

MIT License

Copyright (c) 2024 NetSight Pro Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🙏 致谢

### 开源项目

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Font Awesome](https://fontawesome.com/) - 图标库（v6.4.0）
- [Google Fonts](https://fonts.google.com/) - Inter 字体
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务（免费非商业使用）
- [ipify.org](https://www.ipify.org/) - IP 地址检测服务

### 贡献者

<a href="https://github.com/your-repo/netsight-pro/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=your-repo/netsight-pro" />
</a>

---

## 📞 联系方式

| 渠道 | 链接 |
|------|------|
| **GitHub Issues** | [提交问题](https://github.com/your-repo/netsight-pro/issues) |
| **GitHub Discussions** | [讨论区](https://github.com/your-repo/netsight-pro/discussions) |
| **Email** | support@netsight-pro.com |

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=your-repo/netsight-pro&type=Date)](https://star-history.com/#your-repo/netsight-pro&Date)

---

<p align="center">
  <b>NetSight Pro</b><br>
  部署在 Cloudflare Workers 边缘节点的专业级网络诊断工具<br>
  实时监控 · 多维度测试 · 毫秒级响应 · 极光视觉设计
</p>

<p align="center">
  <sub>Made with ❤️ by NetSight Pro Team</sub>
</p>

<p align="center">
  <sub>开源免费 · MIT License · 持续更新</sub>
</p>
```

这份 README.md 包含：

1. **徽章展示** - 版本、平台、许可证、主题、语言
2. **界面预览** - 表格形式展示各模块
3. **完整功能表格** - 11 大功能模块
4. **快速开始指南** - 在线体验和基础使用
5. **API 端点文档** - 6 个端点 + 响应示例
6. **4 种部署方式** - Wrangler CLI、Dashboard、Git、一键部署按钮
7. **项目结构** - 文件说明
8. **详细更新日志** - v3.1.0 / v2.0.0 / v1.5.0 / v1.0.0，包含新增/优化/修复
9. **技术架构表** - 技术栈和版本
10. **浏览器兼容性** - 各浏览器支持状态
11. **配置说明** - 环境变量、wrangler.toml、自定义修改指南
12. **贡献指南** - 开发流程和规范
13. **许可证** - MIT
14. **致谢** - 开源项目和贡献者
15. **联系方式** - Issues、Discussions、Email
16. **Star History** - 图表占位
