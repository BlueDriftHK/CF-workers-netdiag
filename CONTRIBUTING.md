# 🤝 贡献指南 | Contributing Guide

> 感谢你对 NetSight Pro 的关注！我们欢迎所有形式的贡献

**版本**: 1.0 | **最后更新**: 2026-06-12

---

## 📋 目录

- [欢迎贡献](#-欢迎贡献)
- [贡献方式](#-贡献方式)
- [开发环境搭建](#-开发环境搭建)
- [代码规范](#-代码规范)
- [提交规范](#-提交规范)
- [Pull Request 流程](#-pull-request-流程)
- [测试要求](#-测试要求)
- [文档贡献](#-文档贡献)
- [报告 Bug](#-报告-bug)
- [功能建议](#-功能建议)
- [代码审查](#-代码审查)
- [社区行为准则](#-社区行为准则)
- [获取帮助](#-获取帮助)

---

## 🎉 欢迎贡献

NetSight Pro 是一个开源项目，我们欢迎所有形式的贡献，无论大小！

### 贡献类型

| 贡献类型 | 说明 | 适合人群 |
| :--- | :--- | :--- |
| 🐛 **报告 Bug** | 发现并报告问题 | 所有用户 |
| 💡 **功能建议** | 提出新功能想法 | 所有用户 |
| 📝 **文档改进** | 完善 README、Wiki 等 | 初学者 |
| 🔧 **代码贡献** | 修复 Bug、添加功能 | 开发者 |
| 🌐 **翻译** | 多语言支持 | 翻译者 |
| ⭐ **Star 项目** | 支持项目发展 | 所有用户 |

---

## 🚀 贡献方式

### 方式一：报告 Bug 或建议功能

1. 查看 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 是否已存在
2. 创建新 Issue，使用提供的模板
3. 详细描述问题或建议

### 方式二：提交代码

```bash
# 1. Fork 项目
# 2. 克隆到本地
git clone https://github.com/YOUR_USERNAME/CF-workers-netdiag.git
cd CF-workers-netdiag

# 3. 创建分支
git checkout -b feature/your-feature-name

# 4. 提交更改
git add .
git commit -m "feat: add your feature"

# 5. 推送并创建 PR
git push origin feature/your-feature-name
```

### 方式三：改进文档

- 直接编辑 `README.md`、`SECURITY.md` 等文档
- 或参与 [Wiki](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki) 编辑

---

## 🛠️ 开发环境搭建

### 前置条件

| 工具 | 版本要求 | 说明 |
| :--- | :--- | :--- |
| Node.js | 18.x 或更高 | JavaScript 运行时 |
| npm | 9.x 或更高 | 包管理器 |
| Wrangler | 最新版 | Cloudflare Workers CLI |
| Git | 2.x 或更高 | 版本控制 |
| Code Editor | 任意 | 推荐 VS Code |

### 安装步骤

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. Fork 并克隆项目
git clone https://github.com/YOUR_USERNAME/CF-workers-netdiag.git
cd CF-workers-netdiag

# 4. 安装依赖（本项目无 npm 依赖，此步骤可选）
npm init -y  # 仅用于本地测试工具

# 5. 本地运行
wrangler dev --main _workers.js

# 6. 访问 http://localhost:8787
```

### VS Code 推荐配置

创建 `.vscode/settings.json`：

```json
{
  "editor.formatOnSave": true,
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

---

## 📏 代码规范

### JavaScript 规范

本项目使用 **JavaScript (ES2020+)**，遵循以下规范：

| 规范项 | 要求 | 示例 |
| :--- | :--- | :--- |
| **缩进** | 2 空格 | `if (x) {` |
| **变量命名** | camelCase | `let clientIp` |
| **常量命名** | UPPER_SNAKE_CASE | `const CORS_HEADERS` |
| **函数命名** | camelCase | `function isRateLimited()` |
| **类命名** | PascalCase | `class RateLimiter` |
| **分号** | 必须使用 | `const x = 1;` |
| **引号** | 单引号 | `const str = 'hello';` |
| **换行符** | LF (Unix) | 不要使用 CRLF |

### 代码示例

```javascript
// ✅ 正确示例
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS'
};

function calculateRTT(startTime, endTime) {
  const duration = endTime - startTime;
  if (duration < 0) {
    return 0;
  }
  return duration;
}

// ❌ 错误示例
var CORS_headers={access-control-allow-origin:"*"}
function calculate_rtt(start,end){return end-start}
```

### 注释规范

```javascript
/**
 * 限流检查函数
 * @param {string} ip - 客户端 IP 地址
 * @param {number} maxRequests - 最大请求数，默认 60
 * @param {number} windowMs - 时间窗口（毫秒），默认 60000
 * @returns {boolean} 是否被限流
 */
function isRateLimited(ip, maxRequests = 60, windowMs = 60000) {
  // 实现逻辑
}
```

### 文件组织

```
_workers.js           # 主文件（所有代码在此）
├── 常量定义          # CORS_HEADERS, SECURITY_HEADERS
├── 工具函数          # escapeForJS, pLimit, cleanupRateLimit
├── 限流逻辑          # isRateLimited, rateLimit Map
├── 路由处理          # handleRequest, handleOptions
├── API 端点          # /health, /speedtest, /cpu-test 等
└── HTML 页面         # 主页面模板
```

---

## 📝 提交规范

### 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| 类型 | 图标 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `feat` | ✨ | 新功能 | `feat: add health check endpoint` |
| `fix` | 🐛 | Bug 修复 | `fix: websocket timeout issue` |
| `docs` | 📝 | 文档更新 | `docs: update API documentation` |
| `style` | 🎨 | 代码格式 | `style: update card hover effect` |
| `refactor` | ♻️ | 代码重构 | `refactor: extract common functions` |
| `perf` | ⚡ | 性能优化 | `perf: optimize concurrent test` |
| `test` | ✅ | 测试相关 | `test: add unit tests` |
| `chore` | 🔧 | 构建/工具 | `chore: update wrangler config` |
| `security` | 🔒 | 安全相关 | `security: add rate limiting` |
| `i18n` | 🌐 | 国际化 | `i18n: add zh-TW translations` |

### Scope 范围（可选）

| Scope | 说明 |
| :--- | :--- |
| `api` | API 端点相关 |
| `ui` | 前端界面相关 |
| `ws` | WebSocket 相关 |
| `security` | 安全相关 |
| `perf` | 性能相关 |
| `docs` | 文档相关 |

### 提交示例

```bash
# 简单提交
git commit -m "fix: correct RTT calculation formula"

# 详细提交
git commit -m "feat(api): add new /dns-test endpoint

- Add DNS resolution for common domains
- Return response time and resolved IPs
- Add rate limiting protection

Closes #42"

# 破坏性变更
git commit -m "refactor(api): change /speedtest response format

BREAKING CHANGE: response format changed from plain text to JSON"
```

---

## 🔀 Pull Request 流程

### PR 标题格式

```
<type>(<scope>): <description>
```

示例：
- `feat: add WebSocket ping-pong test`
- `fix(ui): correct chart rendering on mobile`
- `docs: update installation guide`

### PR 模板

```markdown
## 变更类型

- [ ] 🐛 Bug 修复
- [ ] ✨ 新功能
- [ ] 📝 文档更新
- [ ] 🎨 代码格式
- [ ] ♻️ 代码重构
- [ ] ⚡ 性能优化
- [ ] 🔒 安全相关

## 变更描述

[详细描述本次变更的内容]

## 测试

- [ ] 本地测试通过
- [ ] 现有功能未受影响
- [ ] 新增功能有测试覆盖

## 检查清单

- [ ] 代码符合项目规范
- [ ] 提交信息格式正确
- [ ] 更新了相关文档
- [ ] 无破坏性变更（如有已说明）
- [ ] 所有测试通过

## 相关 Issue

Closes #[issue_number]

## 截图（如适用）

[添加截图]
```

### PR 检查清单

提交 PR 前，请确认：

- [ ] 代码符合规范（2空格缩进、单引号等）
- [ ] 提交信息格式正确
- [ ] 已测试通过（`wrangler dev` 本地运行）
- [ ] 更新了相关文档（如有必要）
- [ ] 无合并冲突
- [ ] 未引入破坏性变更（如有已说明）

### PR 生命周期

| 阶段 | 预期时间 | 说明 |
| :--- | :--- | :--- |
| 提交 PR | - | 创建 PR，等待审查 |
| 首次审查 | 1-3 天 | 维护者审查代码 |
| 修改反馈 | 根据反馈 | 解决问题并更新 |
| 合并 | 审查通过后 | 合并到 main 分支 |

---

## 🧪 测试要求

### 本地测试

```bash
# 启动本地服务器
wrangler dev --main _workers.js

# 测试健康检查
curl http://localhost:8787/health

# 测试带宽测速
curl -o /dev/null -s -w '%{speed_download}\n' http://localhost:8787/speedtest?size=102400

# 测试 CPU 性能
curl http://localhost:8787/cpu-test?n=10000

# 测试 HTTP/2 检测
curl http://localhost:8787/http2-test
```

### 功能测试清单

| 功能 | 测试命令 | 预期结果 |
| :--- | :--- | :--- |
| 健康检查 | `curl /health` | 返回 JSON，status=ok |
| 带宽测速 | `curl /speedtest?size=1024` | 返回二进制数据 |
| CPU 测试 | `curl /cpu-test?n=1000` | 返回 JSON，包含 opsMs |
| 限流测试 | 连续请求 61 次 | 第 61 次返回 429 |
| 主页面 | `curl /` | 返回 HTML 页面 |

### 兼容性测试

| 浏览器 | 最低版本 | 测试状态 |
| :--- | :--- | :--- |
| Chrome | 80+ | ✅ 通过 |
| Firefox | 75+ | ✅ 通过 |
| Safari | 13.1+ | ✅ 通过 |
| Edge | 80+ | ✅ 通过 |

---

## 📚 文档贡献

### 需要维护的文档

| 文档 | 位置 | 说明 |
| :--- | :--- | :--- |
| README.md | 根目录 | 项目主文档 |
| SECURITY.md | 根目录 | 安全政策 |
| CONTRIBUTING.md | 根目录 | 贡献指南（本文件） |
| CODE_OF_CONDUCT.md | 根目录 | 行为准则 |
| Wiki | GitHub Wiki | 详细文档 |

### 文档格式规范

- 使用 Markdown 格式
- 标题层级清晰（# ## ###）
- 代码块标注语言（```javascript）
- 表格对齐美观
- 链接使用相对路径（如可能）

---

## 🐛 报告 Bug

### Bug 报告模板

```markdown
## Bug 描述

[清晰简洁地描述问题]

## 复现步骤

1. 访问 '...'
2. 点击 '...'
3. 滚动到 '...'
4. 看到错误

## 预期行为

[清晰描述你期望发生什么]

## 实际行为

[清晰描述实际发生了什么]

## 环境信息

- 浏览器：[Chrome/Firefox/Safari]
- 版本：[如 120.0]
- 操作系统：[Windows/Mac/Linux]
- 部署方式：[Cloudflare/本地]

## 截图

[如适用，添加截图]

## 额外信息

[任何其他相关信息]
```

---

## 💡 功能建议

### 功能建议模板

```markdown
## 功能描述

[清晰简洁地描述你想要的功能]

## 使用场景

[描述这个功能会在什么场景下使用]

## 解决方案

[如果有，描述你期望的实现方式]

## 替代方案

[描述你考虑过的其他替代方案]

## 附加信息

[任何其他相关信息]
```

---

## 👀 代码审查

### 审查者关注点

| 关注点 | 说明 |
| :--- | :--- |
| **正确性** | 代码是否按预期工作 |
| **安全性** | 是否有安全漏洞（XSS、注入等） |
| **性能** | 是否影响响应时间或资源消耗 |
| **可读性** | 代码是否易于理解 |
| **一致性** | 是否符合项目规范 |
| **测试** | 是否有足够的测试覆盖 |

### 审查流程

1. 审查者阅读代码变更
2. 留下评论（问题、建议、赞扬）
3. 贡献者响应并修改
4. 所有问题解决后批准
5. 合并 PR

### 评论标签

| 标签 | 含义 |
| :--- | :--- |
| `[question]` | 需要澄清的问题 |
| `[suggestion]` | 改进建议（非强制） |
| `[required]` | 必须修改的问题 |
| `[praise]` | 做得好的地方 |
| `[nit]` | 小问题 |

---

## 📜 社区行为准则

本项目遵循 [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md)

### 基本原则

- 使用欢迎和包容的语言
- 尊重不同的观点和经验
- 优雅地接受建设性批评
- 关注对社区最有利的事情
- 对其他社区成员表示同理心

### 不可接受行为

- 性暗示语言或图像
- 挑衅、侮辱/贬低评论
- 公开或私下骚扰
- 未经明确许可发布他人私人信息
- 其他不道德或不专业行为

---

## 💬 获取帮助

### 联系方式

| 渠道 | 用途 | 链接 |
| :--- | :--- | :--- |
| **GitHub Issues** | 报告问题 | [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) |
| **GitHub Discussions** | 讨论交流 | [Discussions](https://github.com/BlueDriftHK/CF-workers-netdiag/discussions) |
| **Wiki** | 文档查阅 | [Wiki](https://github.com/BlueDriftHK/CF-workers-netdiag/wiki) |

### 常见问题

| 问题 | 解决方法 |
| :--- | :--- |
| 本地部署失败 | 检查 Node.js 版本和 Wrangler 登录状态 |
| 代码风格不一致 | 运行 `prettier --write _workers.js` |
| 测试失败 | 确保本地 `wrangler dev` 正常运行 |
| 不确定如何开始 | 查看 [Good First Issue](https://github.com/BlueDriftHK/CF-workers-netdiag/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) |

---

## 🏆 贡献者致谢

所有贡献者将出现在项目的 [README.md](README.md) 致谢部分。

### 贡献者级别

| 级别 | 条件 | 致谢方式 |
| :--- | :--- | :--- |
| ⭐ 贡献者 | 提交有效 PR | 名字列入 README |
| 🏅 核心贡献者 | 多次重大贡献 | 名字 + 头像 + 特别致谢 |
| 👑 维护者 | 持续贡献 + 审查 | 项目维护者名单 |

---

## 📄 许可证

本项目采用 **GNU General Public License v3.0** 许可证。贡献代码即表示你同意将代码按此许可证授权。

---

## 📋 快速参考卡片

```bash
# 克隆项目
git clone https://github.com/YOUR_USERNAME/CF-workers-netdiag.git
cd CF-workers-netdiag

# 创建分支
git checkout -b feature/your-feature

# 本地开发
wrangler dev --main _workers.js

# 提交代码
git add .
git commit -m "type(scope): description"
git push origin feature/your-feature

# 创建 Pull Request
# 访问 GitHub 仓库页面
```

---

**Made with ❤️ by BlueDriftHK and contributors**

**感谢你为 NetSight Pro 做出的贡献！**

---

[⬆️ 返回顶部](#-贡献指南--contributing-guide)
