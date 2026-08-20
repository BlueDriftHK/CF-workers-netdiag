# 贡献指南

感谢您对 **NetSight Pro** 的关注！我们欢迎各种形式的贡献，无论是报告问题、提出新功能、改进代码还是完善文档。这份指南将帮助您了解如何参与项目，并确保您的贡献能顺利被采纳。

---

## 📋 目录

- [行为准则](#-行为准则)
- [我该如何贡献？](#-我该如何贡献？)
  - [报告 Bug](#报告-bug)
  - [提出新功能](#提出新功能)
  - [提交代码（Pull Request）](#提交代码pull-request)
- [开发环境设置](#-开发环境设置)
- [代码规范](#-代码规范)
  - [JavaScript 风格](#javascript-风格)
  - [HTML/CSS 风格](#htmlcss-风格)
  - [国际化文本](#国际化文本)
- [提交信息规范](#-提交信息规范)
- [测试](#-测试)
- [文档](#-文档)
- [安全性相关](#-安全性相关)
- [许可证](#-许可证)

---

## 📜 行为准则

本项目遵循 **[贡献者公约行为准则](CODE_OF_CONDUCT.md)**。参与即表示您同意遵守该准则。请阅读全文，确保您的行为符合社区规范。

---

## 🤝 我该如何贡献？

### 报告 Bug

如果您发现了 Bug，请通过 [GitHub Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 提交报告。为了让问题更快被解决，请提供：

- **清晰的问题描述**：发生了什么，预期应该发生什么。
- **重现步骤**：尽可能详细地列出操作步骤，最好附带截图或视频。
- **环境信息**：浏览器版本、操作系统、Worker 部署的域名或版本。
- **错误日志**：浏览器控制台（F12）或 Worker 日志中的错误信息。

**请不要在 Issues 中透露任何敏感信息**，例如您的 Cloudflare 凭证或私有 API 密钥。

### 提出新功能

如果您有改进建议或新功能点子，同样请通过 Issues 提出，并勾选 **Feature Request** 标签。描述中请说明：

- 该功能解决什么痛点？
- 您期望的实现方式（可以附带伪代码或设计稿）。
- 如果可能，请说明该功能是否会影响现有功能或性能。

我们会定期审阅新功能提案，并优先考虑最符合项目定位（网络诊断工具）的提议。

### 提交代码（Pull Request）

我们欢迎所有类型的代码贡献，包括 Bug 修复、性能优化、新功能、文档改进等。请遵循以下流程：

1. **Fork 仓库**：点击项目右上角的 Fork 按钮，将仓库复制到您的 GitHub 账户。

2. **克隆分支**：
   ```bash
   git clone https://github.com/您的用户名/CF-workers-netdiag.git
   cd CF-workers-netdiag
   ```

3. **创建新分支**：请基于 `main` 分支创建功能分支，命名尽量反映内容，例如：
   ```bash
   git checkout -b fix/typo-readme
   git checkout -b feature/add-webrtc-test
   git checkout -b optimize/cpu-benchmark
   ```

4. **开发和测试**：在本地进行修改，并确保代码可以正常部署（可使用 `wrangler dev` 测试）。如果添加了新功能，请在适当位置添加注释，并更新相关文档。

5. **提交代码**：遵循下文的 [提交信息规范](#-提交信息规范)。

6. **推送并创建 PR**：
   ```bash
   git push origin 分支名
   ```
   然后进入您的 Fork 仓库页面，点击 **Compare & pull request**，填写 PR 描述。

**PR 描述应包含**：
- 简短标题，概括本次变更。
- 详细说明变更内容、原因以及测试情况。
- 如果修复了某个 Issue，请注明 `Fixes #123`。

#### PR 审查标准

- 代码必须通过安全检查（无硬编码密钥、无注入风险）。
- 所有新功能必须有对应的前端界面调整或 API 说明。
- 国际化文本必须同时更新三种语言（`en`、`zh-CN`、`zh-TW`）。
- 不得破坏现有兼容性（除非有重大版本号变更）。
- 鼓励添加注释，尤其是复杂逻辑部分。

---

## 🛠️ 开发环境设置

### 必需工具
- [Node.js](https://nodejs.org/) (建议 LTS 版本)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- Git

### 本地运行

1. 安装依赖（此项目没有额外 npm 依赖，但建议安装 Prettier 等工具）：
   ```bash
   npm init -y
   npm install --save-dev prettier
   ```

2. 在项目根目录创建 `wrangler.toml`（可从示例复制）：
   ```toml
   name = "netsight-pro"
   type = "javascript"
   account_id = "您的账号ID"
   workers_dev = true
   ```

3. 启动本地开发服务器：
   ```bash
   wrangler dev
   ```
   访问 `http://localhost:8787` 即可预览。

4. 修改代码后，Wrangler 会自动重新加载（需要刷新浏览器）。

### 使用 KV 本地模拟（可选）
如果需要对历史记录功能进行本地测试，可使用 Wrangler 的 KV 模拟：
```bash
wrangler dev --kv SPEED_HISTORY
```

---

## 📐 代码规范

### JavaScript 风格

- 使用 **ES2020** 语法（`async/await`、可选链 `?.`、空值合并 `??` 等）。
- 缩进使用 **2 个空格**（不要使用 Tab）。
- 字符串统一使用 **单引号**，模板字符串使用反引号。
- 每个语句末尾不要加分号（项目约定）。
- 函数命名采用 **camelCase**，类名采用 **PascalCase**。
- 常量使用 **UPPER_SNAKE_CASE**（仅当为顶级常量且不可变时）。
- 尽可能使用 `const` 和 `let`，避免 `var`。
- 每个文件末尾保留一个空行。

**示例**：
```javascript
const MAX_RETRIES = 3

function processData(input) {
  let result = 0
  for (const item of input) {
    result += item.value
  }
  return result
}
```

### HTML/CSS 风格

- 使用语义化 HTML5 标签。
- 类名采用 **kebab-case**（如 `hero-card`、`rtt-display`）。
- 样式遵循 **BEM** 命名方式（可选），但保持清晰。
- CSS 变量集中定义在 `:root` 中，主题切换通过 `data-theme` 控制。
- 避免使用 `!important`，优先通过权重和层级解决。

### 国际化文本

所有用户可见的字符串必须添加到前端 `i18n` 对象中，并同时提供三种语言的翻译。新增文本时：

1. 在 `i18n.en` 中添加英文键值对。
2. 在 `i18n['zh-CN']` 中添加简体中文。
3. 在 `i18n['zh-TW']` 中添加繁体中文。
4. 在 `updateUI` 的 `map` 对象中增加相应 ID 映射。

**不要**在 HTML 或 JavaScript 中硬编码中文或英文文本。

---

## 📝 提交信息规范

提交信息应清晰描述变更，推荐遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。格式：

```
<类型>(<范围>): <简短描述>

<详细说明（可选）>
```

**类型**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 代码重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链变动

**示例**：
```
feat(api): add WebRTC leak detection endpoint

Implement /api/webrtc-test which returns local and public IPs
using RTCPeerConnection.

Fixes #23
```

```
fix(ui): correct RTT chart axis scaling

The chart now adjusts to max RTT value dynamically instead of
being capped at 200ms.
```

---

## 🧪 测试

目前项目未集成自动化测试框架，但我们鼓励贡献者手动测试以下场景：

- 在主流浏览器（Chrome、Firefox、Safari、Edge）中打开页面，检查界面显示和交互。
- 测试所有诊断按钮（特别是新增功能），确保输出正确。
- 检查限流是否生效（快速点击测试按钮，查看是否返回 429）。
- 检查 WebSocket 连接是否稳定。
- 检查国际化切换后所有文本是否更新。
- 检查深色/浅色主题切换是否正常。

如果您的贡献涉及后端逻辑，请确保本地 `wrangler dev` 下所有 API 响应正常。

---

## 📖 文档

- 更新 `README.md` 以反映新增功能或变更。
- 如果新增了 API 端点，请在文档的“API 端点”部分补充说明。
- 如果修改了环境变量或部署步骤，请同步更新 README 和部署指南。
- 代码中添加必要注释，尤其是复杂的逻辑或算法。

---

## 🔐 安全性相关

由于本项目涉及网络诊断和 IP 信息，任何变更都不得削弱现有安全机制。特别注意：

- 所有用户输入必须经过校验（`clampInt`、`safeNumber`、URL 白名单等）。
- 敏感端点必须保留 `isSameOriginNavigation` 检查。
- 不得在日志中输出用户 IP 或其他敏感信息（除非是调试目的且已脱敏）。
- 如果新增外部 API，请确保设置合理的超时和错误处理。
- 任何 CORS 配置变更需谨慎，防止跨域泄露。

---

## 📄 许可证

通过提交贡献，您同意您的代码将根据项目的 **[MIT 许可证](LICENSE)** 进行分发。

---

## 🙏 最后的感谢

感谢您花时间阅读这份指南。我们期待您的第一次贡献！如果有任何疑问，请随时在 Issues 中提出，或直接联系维护者。

**NetSight Pro** 因您的参与而更加出色。🌟
