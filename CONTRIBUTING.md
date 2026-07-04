# 贡献指南

感谢你对 网络洞察专业版 的关注！本指南将帮助你了解如何参与项目贡献。

---

## 📋 目录

- [行为准则](#-行为准则)
- [我能做什么](#-我能做什么)
- [开发环境搭建](#-开发环境搭建)
- [贡献流程](#-贡献流程)
- [代码规范](#-代码规范)
- [提交信息格式](#-提交信息格式)
- [Pull Request 检查清单](#-pull-request-检查清单)
- [测试指南](#-测试指南)
- [文档贡献](#-文档贡献)

---

## 🤝 行为准则

本项目遵循 [贡献者公约](CODE_OF_CONDUCT.md)。参与即表示你同意遵守其条款。请保持友善、尊重和建设性的交流氛围。

---

## 🎯 我能做什么

### 报告 Bug

如果你发现了 Bug，请在 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 中提交，并包含以下信息：

- **标题**: 简明扼要地描述问题
- **环境**: 操作系统、浏览器版本、Node.js 版本
- **复现步骤**: 详细的操作步骤，最好附上 curl 命令或截图
- **预期行为**: 你期望发生什么
- **实际行为**: 实际发生了什么（包含错误信息、日志、截图）
- **Workers 日志**: 如已部署，附上 `wrangler tail` 的相关输出

### 建议新功能

提交功能建议时，请说明：

- 这个功能解决什么问题
- 你期望的使用场景
- 如果有，附上参考实现或设计方案

### 贡献代码

从修复文档错别字到实现全新功能，所有代码贡献都欢迎。建议先从 `good first issue` 标签的 Issue 开始。

---

## 🛠️ 开发环境搭建

### 前置条件

- Node.js 18+
- npm 或 pnpm
- Cloudflare 账号（用于测试）
- Wrangler CLI

### 本地搭建步骤

```bash
# 1. Fork 项目后克隆到本地
git clone https://github.com/YOUR_USERNAME/CF-workers-netdiag.git
cd CF-workers-netdiag

# 2. 安装 Wrangler CLI
npm install -g wrangler

# 3. 登录 Cloudflare
wrangler login

# 4. 创建 KV 命名空间（用于测试测速历史功能）
wrangler kv:namespace create SPEED_HISTORY

# 5. 本地启动开发服务
wrangler dev --main _workers.js --port 8787

# 6. 浏览器访问
# http://localhost:8787
```

### 项目结构速览

```
CF-workers-netdiag/
├── _workers.js          # ★ 核心文件：Cloudflare Worker 主程序
├── index.html           # 产品介绍落地页（纯静态）
├── README.md            # 项目文档
├── SECURITY.md          # 安全政策
├── CONTRIBUTING.md      # 本文件
└── LICENSE              # GPL-3.0 许可证
```

**注意事项**：

- `_workers.js` 是唯一需要部署的核心文件，包含所有 API 路由、HTML 模板和内联 JS/CSS
- `index.html` 是纯静态产品介绍页，与 Worker 运行时无关

---

## 🔄 贡献流程

```bash
# 1. 确保你的 Fork 与主仓库同步
git checkout main
git pull upstream main

# 2. 创建特性分支（命名规范见下方）
git checkout -b feature/你的功能名称
# 或
git checkout -b fix/你的修复名称

# 3. 进行开发并提交
git add .
git commit -m '✨ feat: 添加新功能描述'

# 4. 推送到你的 Fork
git push origin feature/你的功能名称

# 5. 在 GitHub 上创建 Pull Request
```

### 分支命名规范

| 前缀 | 用途 | 示例 |
| :--- | :--- | :--- |
| `feature/` | 新功能 | `feature/add-ipv6-traceroute` |
| `fix/` | Bug 修复 | `fix/dns-timeout-cors` |
| `docs/` | 文档更新 | `docs/update-api-reference` |
| `refactor/` | 代码重构 | `refactor/extract-rate-limiter` |
| `perf/` | 性能优化 | `perf/reduce-stream-buffer` |
| `security/` | 安全修复 | `security/fix-xss-vector` |

---

## 📝 代码规范

### JavaScript 规范（_workers.js）

由于 `_workers.js` 是单一的 Cloudflare Worker 文件，请遵循以下规范：

```javascript
// ✅ 正确示例
// 1. 使用 2 空格缩进
function handleRequest(request) {
  const url = new URL(request.url);
  
  // 2. 变量使用 camelCase
  const clientIp = request.headers.get('CF-Connecting-IP');
  
  // 3. 常量使用 UPPER_SNAKE_CASE
  const MAX_SPEEDTEST_SIZE = 5 * 1024 * 1024;
  const RATE_LIMIT_MAX = 60;
  
  // 4. 函数使用 camelCase，动词开头
  function isRateLimited(ip, max = RATE_LIMIT_MAX) {
    // ...
  }
  
  // 5. 必要的 JSDoc 注释
  /** @param {number} n - 迭代次数 */
  function runCpuTest(n) {
    // ...
  }
}

// ❌ 错误示例
function handle_request( request ){  // 下划线命名、空格不一致
  var client_ip = "";  // var、下划线命名
  const maxsize=1024;  // 缺少空格、命名不规范
}
```

### HTML/CSS 规范

- HTML 使用 2 空格缩进，保持标签闭合
- CSS 自定义属性统一在 `:root` 声明，深浅色覆盖在 `@media (prefers-color-scheme: dark)` 中
- 颜色值优先使用 CSS 变量而非硬编码
- 新增 CSS 变量命名遵循 `--{类别}-{属性}` 格式，如 `--bg-primary`、`--text-secondary`

### Cloudflare Workers 注意事项

1. **无全局副作用**: 避免在全局作用域中进行异步操作
2. **安全第一**: 所有用户输入必须做参数校验（`parseInt` 钳制、域名白名单等）
3. **限流保护**: 新 API 端点必须接入 `isRateLimited()` 限流中间件
4. **KV 操作**: 使用 KV 前必须做 `typeof SPEED_HISTORY !== 'undefined'` 类型守卫
5. **XSS 防护**: 动态内容必须经过 `escapeForJS()` 转义

---

## 💬 提交信息格式

遵循约定式提交（Conventional Commits）规范：

```
<类型>: <简短描述>

<详细说明（可选）>

<关闭的 Issue 编号（可选）>
```

### 提交类型

| 类型 | 图标 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `feat` | ✨ | 新功能 | `feat: 添加 IPv6 路由追踪功能` |
| `fix` | 🐛 | Bug 修复 | `fix: DNS 超时改用代理路由绕过 CORS` |
| `docs` | 📝 | 文档更新 | `docs: 完善 API 端点参数说明` |
| `style` | 🎨 | 代码格式（不影响逻辑） | `style: 统一卡片悬停动效曲线` |
| `refactor` | ♻️ | 代码重构 | `refactor: 提取限流中间件为独立函数` |
| `perf` | ⚡ | 性能优化 | `perf: 并发测试改用 ArrayBuffer 复用` |
| `test` | ✅ | 测试相关 | `test: 添加健康检查端点测试` |
| `chore` | 🔧 | 构建/工具配置 | `chore: 更新 wrangler 兼容日期` |
| `security` | 🔒 | 安全修复 | `security: 增强 SSRF 域名白名单校验` |

### 提交示例

```bash
# 简单提交
git commit -m '✨ feat: 添加 Traceroute 网络路径追踪'

# 带详细说明
git commit -m '🐛 fix: DNS 测试全部超时

浏览器直接 fetch 外部 URL 被 CORS 拦截，改为通过 Worker 
代理路由转发请求，客户端使用 Image 对象测量真实延迟。

Closes #12'
```

---

## ✅ Pull Request 检查清单

提交 PR 前，请确认以下事项：

- [ ] 代码符合项目规范（2 空格缩进、camelCase 命名）
- [ ] 新 API 端点已接入 `isRateLimited()` 限流中间件
- [ ] 所有用户输入已做参数校验和类型转换
- [ ] 新增 HTML 内容已做 `escapeForJS()` 转义
- [ ] 新增 CSS 颜色值使用 CSS 变量，深浅色模式均已覆盖
- [ ] 本地 `wrangler dev` 测试通过
- [ ] 相关文档已更新（README、SECURITY 等）
- [ ] 提交信息格式正确
- [ ] PR 描述中说明了变更原因和影响范围
- [ ] 未引入破坏性变更（或已明确标注）

---

## 🧪 测试指南

### 本地功能测试

```bash
# 启动本地 Worker
wrangler dev --main _workers.js --port 8787

# 健康检查
curl http://localhost:8787/health

# 带宽测速
curl http://localhost:8787/speedtest?size=102400

# CPU 测试
curl http://localhost:8787/cpu-test?n=100000

# 并发测试
curl http://localhost:8787/concurrent-test?count=4&size=2048

# HTTP/2 协议检测
curl http://localhost:8787/http2-test

# WebSocket 测试
websocat ws://localhost:8787/ws-test
```

### 限流测试

```bash
# 连续发送请求验证限流是否生效
for i in $(seq 1 70); do
  echo "请求 $i: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/speedtest?size=1024)"
done
# 预期：前 60 次返回 200，之后返回 429
```

### 页面测试

在浏览器中访问 `http://localhost:8787`，检查：

1. 各测试按钮功能是否正常
2. 深浅色模式是否正确切换（跟随系统设置）
3. 测速完成后历史记录是否正常展示
4. 移动端响应式布局是否正常

---

## 📚 文档贡献

文档同样需要你的贡献。以下是可以参与的文档工作：

- 修正 README 中的表述错误或过时信息
- 补充 API 使用示例
- 翻译文档到其他语言
- 完善故障排查章节
- 添加部署最佳实践

文档格式要求：

- 使用 Markdown 格式
- 中文为主，技术术语保留英文
- 代码块标注正确的语言标识
- 内部链接使用相对路径

---

## 🔗 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 指南](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
- [约定式提交规范](https://www.conventionalcommits.org/zh-hans/)

---

## 📞 需要帮助？

- 在 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 中提问
- 描述你遇到的问题和已尝试的解决方法
- 我们会尽快回复

---

*感谢每一位贡献者的付出！*
*（内容由AI生成，仅供参考）*
