# 贡献指南

感谢您对 **NetSight Pro** 的兴趣！我们欢迎来自社区的各种贡献，无论是报告 Bug、提交代码、改进文档，还是提出新功能建议。  
本指南将帮助您了解如何参与项目，并确保您的贡献能够顺利被合并。

---

## 📋 目录

- [行为准则](#-行为准则)
- [如何报告问题](#-如何报告问题)
- [如何请求新功能](#-如何请求新功能)
- [贡献代码](#-贡献代码)
  - [准备工作](#准备工作)
  - [分支命名](#分支命名)
  - [代码风格](#代码风格)
  - [提交信息规范](#提交信息规范)
  - [测试](#测试)
  - [提交 Pull Request](#提交-pull-request)
- [其他贡献方式](#-其他贡献方式)
- [贡献者许可协议](#-贡献者许可协议)
- [获取帮助](#-获取帮助)

---

## 📜 行为准则

本项目遵循 [Contributor Covenant 行为准则](./CODE_OF_CONDUCT.md)。  
参与本项目的所有贡献者都必须遵守该准则。如有违反，项目维护者有权采取相应措施。

---

## 🐛 如何报告问题

### 检查现有 Issue

在提交新 Issue 之前，请先搜索现有的 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues)，看看您遇到的问题是否已经被报告或正在解决中。

### 创建新 Issue

如果问题尚未被报告，请点击 [New Issue](https://github.com/BlueDriftHK/CF-workers-netdiag/issues/new) 并选择合适的模板（如果存在）或按照以下格式填写：

```markdown
### 问题描述
（清晰描述您遇到的问题）

### 复现步骤
1. 访问 [URL]
2. 执行 [操作]
3. 看到 [错误现象]

### 预期行为
（您期望发生什么）

### 实际行为
（实际发生了什么）

### 环境信息
- NetSight Pro 版本: [v4.0]
- 浏览器及版本: [Chrome 120]
- Cloudflare Worker 区域: [可选]
- 其他相关信息: [如网络环境、操作系统等]

### 日志/截图
（如果有 Worker 日志或浏览器控制台输出，请附上）
```

### 安全问题

**请勿**在公开的 GitHub Issues 中报告安全漏洞。请参考 [SECURITY.md](./SECURITY.md) 中的指引，通过邮件私下报告。

---

## 💡 如何请求新功能

我们也欢迎功能建议！请遵循以下步骤：

1. 查看现有的 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues)，看看是否已有类似建议。
2. 如果不存在，请创建新 Issue，并选择 “Feature Request” 模板（如果有）或填写：
   - **功能描述**：清晰描述您希望添加的功能。
   - **使用场景**：说明该功能在什么场景下有用。
   - **实现思路**（可选）：如果您有初步的想法，欢迎分享。

我们会根据项目方向和社区需求，评估并决定是否采纳。

---

## 👨‍💻 贡献代码

### 准备工作

1. **Fork 本仓库**：点击右上角的 “Fork” 按钮，将项目复制到您的 GitHub 账户下。
2. **克隆您的 Fork**：
   ```bash
   git clone https://github.com/您的用户名/CF-workers-netdiag.git
   cd CF-workers-netdiag
   ```
3. **添加上游仓库**：
   ```bash
   git remote add upstream https://github.com/BlueDriftHK/CF-workers-netdiag.git
   ```
4. **安装依赖**（如果需要）：
   本项目不需要额外的构建工具，但您可以使用 `wrangler` 进行本地测试：
   ```bash
   npm install -g wrangler
   ```

### 分支命名

请基于 `main` 分支创建您的功能分支，并遵循以下命名规范：

- `feature/功能名称` —— 新功能
- `fix/问题描述` —— 修复 Bug
- `docs/文档改进` —— 文档更新
- `refactor/重构内容` —— 代码重构
- `chore/杂项` —— 构建、配置等

示例：`feature/multi-node-compare`

### 代码风格

为了保持代码的一致性和可维护性，请遵循以下规范：

#### JavaScript（Worker 主文件 `_workers.js`）

- 使用 **ES modules** 语法（`import`/`export`）。
- 使用 **单引号** 表示字符串（除非包含单引号）。
- 使用 **2 个空格** 缩进。
- 使用 `const` 和 `let`，避免 `var`。
- 每个语句末尾使用 **分号**。
- 使用 **对象/数组解构** 提高可读性。
- 函数命名使用 **camelCase**。
- 常量使用 **UPPER_SNAKE_CASE**（如 `CORS_HEADERS`）。
- 适当添加注释，尤其是复杂逻辑。
- 保持代码简洁，避免过长的函数（建议不超过 50 行）。

示例：
```javascript
// 好的风格
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store'
};

function isRateLimited(ip, maxRequests = 60) {
  // 逻辑...
}
```

#### CSS（内嵌在 `_workers.js` 的 HTML 中）

- 使用 **CSS 变量**（`var(--accent)`）管理主题。
- 选择器使用 **连字符**（kebab-case）命名类。
- 遵循 **BEM 方法论**（可选）。
- 保持规则按模块分组，添加注释分隔。
- 避免使用 `!important`，除非绝对必要。
- 深色/浅色模式通过 `[data-theme="dark"]` 和 `[data-theme="light"]` 控制。

#### HTML

- 使用 **语义化标签**（`<header>`, `<section>`, `<article>` 等）。
- `id` 和 `class` 使用 **kebab-case**。
- 确保内容在无 CSS 时可读（渐进增强）。
- 添加合适的 `alt` 属性（如有图片）。

#### 提交信息规范

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，以便自动生成更新日志。

提交信息格式：
```
<类型>(<范围>): <简短描述>

<详细描述（可选）>

<脚注（可选）>
```

**类型**：
- `feat`：新功能
- `fix`：Bug 修复
- `docs`：文档更新
- `style`：代码格式（不影响逻辑）
- `refactor`：代码重构（不修改功能）
- `perf`：性能优化
- `test`：测试相关
- `chore`：构建/工具/依赖更新

**范围**（可选）：如 `api`、`ui`、`kv` 等。

示例：
```
feat(api): 添加多节点对比端点

新增 /api/multi-node-compare 接口，支持并行测试多个 Worker 节点的延迟。
```

### 测试

- 如果您的更改涉及新功能或修复，请确保现有功能仍能正常工作。
- 您可以使用 `wrangler dev` 在本地进行测试：
  ```bash
  wrangler dev --local --main _workers.js
  ```
  然后在浏览器中访问 `http://localhost:8787`。
- 对于 API 更改，建议使用 `curl` 或 Postman 进行测试。
- 我们不强制要求编写单元测试，但对于关键逻辑（如限流、安全头），欢迎添加。

### 提交 Pull Request

1. **同步上游代码**：
   ```bash
   git checkout main
   git pull upstream main
   git push origin main  # 更新您的 Fork 的 main
   ```

2. **基于 main 创建分支**：
   ```bash
   git checkout -b feature/your-feature
   ```

3. **进行更改并提交**（遵循提交规范）：
   ```bash
   git add .
   git commit -m "feat: 添加某个功能"
   ```

4. **推送到您的 Fork**：
   ```bash
   git push origin feature/your-feature
   ```

5. **打开 Pull Request**：
   - 访问您的 Fork 页面，点击 “Compare & pull request”。
   - 填写 PR 标题和描述，清晰说明更改内容、目的和测试情况。
   - 关联相关的 Issue（如有）：“Closes #123”。

6. **等待审查**：
   - 维护者会审核您的 PR，可能会提出修改意见。
   - 请及时响应反馈并进行调整。
   - 一旦通过，PR 将被合并到 `main` 分支。

---

## 🌟 其他贡献方式

除了代码，您还可以通过以下方式贡献：

- **完善文档**：修正错别字、补充示例、翻译（如果支持）。
- **测试**：在多种环境下测试，反馈兼容性问题。
- **回答 Issues**：帮助其他用户解决遇到的问题。
- **推广**：向更多人介绍 NetSight Pro，或撰写博客/教程。
- **设计**：改进 UI/UX，优化图标或配色。

您的每一点贡献都值得赞赏！

---

## 📄 贡献者许可协议（CLA）

提交贡献即表示您同意将您的代码贡献视为符合项目许可证（**AGPL-3.0**）的条款。  
您无需签署额外的 CLA，但请确保您的贡献完全由您创作，或者您有权授权其使用。

---

## 💬 获取帮助

如果您在贡献过程中有任何疑问，欢迎通过以下方式联系我们：

- 在 [GitHub Discussions](https://github.com/BlueDriftHK/CF-workers-netdiag/discussions) 中提问
- 在 [GitHub Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 中留言（如果与现有问题相关）
- 发送邮件至项目维护者（见 [SECURITY.md](./SECURITY.md) 中的联系方式）

---

感谢您的贡献，让我们一起让 NetSight Pro 变得更好！🎉
