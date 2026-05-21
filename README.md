# NetSight Pro - 蓝色极速网络诊断工具

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-yellow?style=flat-square&logo=javascript)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript)

> 一款部署在 Cloudflare Workers 上的专业级网络诊断工具，提供实时网络监控、性能测试和连接质量评估。
## ✨ 功能特性

### 📡 实时网络监控
- **实时 RTT 监控** - 每2秒自动测量往返时延，实时绘制趋势图表
- **网络抖动计算** - 自动计算网络稳定性指标
- **连接质量评估** - 基于 RTT 的5级质量评估（优秀/良好/一般/较差/极差）
- **丢包率监控** - 实时监测网络丢包情况
- **最低/最高 RTT 记录** - 统计历史最佳和最差延迟

### 🔒 安全与协议检测
- **TLS 版本检测** - 显示当前使用的 TLS 协议版本
- **加密套件识别** - 展示正在使用的加密算法
- **ECH 状态检测** - 检测 Encrypted Client Hello 是否启用
- **HTTP/2 Push 检测** - 检查服务器是否支持 H2 推送
- **压缩算法支持** - 检测 Brotli、Gzip 等压缩算法
- **机器人评分** - 显示 Cloudflare Bot Management 评分

### 🎯 一键诊断工具
| 测试项 | 说明 |
|--------|------|
| **丢包率测试** | 发送10个测试包，计算丢失百分比 |
| **带宽测速** | 测试 100KB、500KB、1MB 下载速度 |
| **DNS 解析** | 测试 Cloudflare、Google、GitHub 的 DNS 解析时间 |
| **CPU 性能** | 密集计算测试，评估设备性能 |
| **WebSocket** | 5次 ping-pong 测试，计算平均延迟 |
| **并发测试** | 测试 4、6、8 个并发请求性能 |
| **流式传输** | 测试 64KB、256KB、1MB 流式吞吐量 |

### 📍 地理位置信息
- **边缘节点位置** - 显示 Cloudflare 数据中心位置和坐标
- **真实 IP 位置** - 通过 ip-api.com 查询客户端真实地理位置
- **距离计算** - 计算客户端到边缘节点的直线距离
- **运营商信息** - 显示 ASN 和 ISP 信息

### 🌐 多语言支持
- 简体中文
- 繁体中文
- 英文

## 🚀 快速部署

### 前置要求
- Cloudflare 账号
- Wrangler CLI 工具

### 部署步骤

1. **安装 Wrangler CLI**
```bash
npm install -g wrangler
```

2. **登录 Cloudflare**
```bash
wrangler login
```

3. **创建 `wrangler.toml` 配置文件**
```toml
name = "netsight-pro"
main = "worker.js"
compatibility_date = "2024-12-01"

[env.production]
vars = { ENVIRONMENT = "production" }

# 可选：绑定自定义域名
# routes = [
#   { pattern = "diagnostics.yourdomain.com", zone_id = "your-zone-id" }
# ]
```

4. **部署 Worker**
```bash
wrangler deploy --env production
```

## 📖 使用说明

### 主要功能使用

#### 实时延迟监控
页面会自动开始监控网络延迟，每2秒更新一次：
- **当前 RTT** - 最新测量的往返时延
- **抖动** - 网络延迟变化幅度
- **连接质量** - 根据 RTT 实时评估
- **网络稳定性** - 根据抖动评估

#### 诊断工具使用
点击对应按钮即可执行测试：
- 测试结果会显示在按钮下方
- 结果会自动淡出，或可连续测试
- 所有测试都有超时保护

#### 复制报告
点击右下角"复制报告"按钮，可生成完整的诊断报告并复制到剪贴板。

### 界面说明

```
┌─────────────────────────────────────────────────────────────┐
│  NetSight Pro                         EN 简体 繁體         │
├─────────────────────────────────────────────────────────────┤
│  IPv4: xxx.xxx.xxx.xxx                                       │
│  IPv6: xxxx:xxxx:xxxx:xxxx                                   │
│  节点: HKG | 耗时: 12ms | ● 实时监控                         │
├───────────────────┬───────────────────┬─────────────────────┤
│   安全与协议       │   边缘节点位置     │   真实 IP 位置      │
│   数据中心/代理    │   上海, 中国       │   广州, 中国        │
│   风险等级         │   31.22°N/121.45°E │   距离: 1200km      │
│   TLS 1.3         │   中国移动通信     │   中国电信          │
├───────────────────┴───────────────────┴─────────────────────┤
│                    实时延迟监控                              │
│             233                   108                        │
│         → 当前 RTT          抖动 (ms)                        │
│                                                              │
│                    📈 实时图表                                │
│                                                              │
│   连接质量: 较差    网络稳定性: 极不稳定                      │
│   样本数量: 6       丢包率: 0%                               │
├─────────────────────────────────────────────────────────────┤
│  诊断工具集                                                   │
│  [丢包率] [带宽测速] [DNS解析] [CPU性能] [WebSocket] ...     │
├─────────────────────────────────────────────────────────────┤
│  硬件信息: 屏幕 1920x1080 | CPU核心: 8 | 时区: Asia/Shanghai │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 API 端点

Worker 提供以下 API 端点供测试使用：

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/speedtest` | GET | `size` | 带宽测速，返回随机数据 |
| `/cpu-test` | GET | `n` | CPU 性能测试，返回 ops/ms |
| `/ws-test` | WebSocket | - | WebSocket 延迟测试 |
| `/push-test` | GET | - | HTTP/2 Push 检测 |
| `/concurrent-test` | GET | `count`, `size` | 并发请求测试 |
| `/stream-test` | GET | `size` | 流式传输测试 |

## 📊 性能指标说明

### RTT 质量评估标准
| RTT 范围 | 质量评级 | 颜色 |
|----------|----------|------|
| < 50ms | 优秀 | 🟢 绿色 |
| 50-100ms | 良好 | 🟢 绿色 |
| 100-150ms | 一般 | 🟡 黄色 |
| 150-250ms | 较差 | 🟠 橙色 |
| > 250ms | 极差 | 🔴 红色 |

### 抖动稳定性评估
| 抖动范围 | 稳定性评级 | 颜色 |
|----------|------------|------|
| < 10ms | 非常稳定 | 🟢 绿色 |
| 10-30ms | 稳定 | 🔵 蓝色 |
| 30-60ms | 不稳定 | 🟡 黄色 |
| > 60ms | 极不稳定 | 🔴 红色 |

## 🛠️ 技术架构

- **运行环境**: Cloudflare Workers
- **前端框架**: 原生 JavaScript + HTML5 Canvas
- **图标库**: Font Awesome 6
- **字体**: Google Fonts Inter
- **地理位置**: ip-api.com, ipapi.co
- **部署工具**: Wrangler CLI

## 📁 项目结构

```
netsight-pro/
├── worker.js          # 主 Worker 代码
├── wrangler.toml      # Cloudflare 配置
└── README.md          # 项目文档
```

## ⚠️ 注意事项

1. **地理位置查询限制**
   - ip-api.com 免费版限制 45次/分钟
   - 建议生产环境使用付费 API 或自建服务

2. **Worker 资源限制**
   - 免费版 CPU 时间限制 10ms
   - CPU 测试会减少迭代次数以确保不超时

3. **WebSocket 支持**
   - 需要 HTTPS/WSS 环境
   - 某些网络可能屏蔽 WebSocket

## 🔄 更新日志

### v2.0 (2026-05)
- ✨ 全新蓝色主题 UI 设计
- 📊 增强实时延迟监控图表
- 🎯 新增连接质量和稳定性评估
- 🌐 完整的多语言支持
- 📈 添加最低/最高 RTT 统计
- 🔧 优化所有测试端点的超时处理

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [ip-api.com](http://ip-api.com/) - IP 地理位置服务
- [Font Awesome](https://fontawesome.com/) - 图标库
- [Google Fonts](https://fonts.google.com/) - 字体服务

---

<div align="center">
  <sub>Built with ❤️ for network diagnostics</sub>
</div>
