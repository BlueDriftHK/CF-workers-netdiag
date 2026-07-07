# 贡献指南

感谢您对 **NetSight Pro** 的关注与支持！我们欢迎任何形式的贡献——无论是报告 Bug、提出新功能建议、改进文档，还是提交代码。

请花几分钟阅读本指南，以使贡献过程更顺畅高效。

---

## 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
  - [报告 Bug](#报告-bug)
  - [提出新功能](#提出新功能)
  - [改进文档](#改进文档)
  - [提交代码](#提交代码)
- [开发环境准备](#开发环境准备)
- [代码规范](#代码规范)
- [测试指南](#测试指南)
- [提交 Pull Request](#提交-pull-request)
- [代码审核流程](#代码审核流程)
- [社区沟通](#社区沟通)

---

## 行为准则

本项目遵循 [Contributor Covenant](https://www.contributor-covenant.org) 行为准则。参与即表示您同意遵守其条款。如有不可接受的行为，请向项目维护者报告（邮箱见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)）。

---

## 如何贡献

### 报告 Bug

如果您发现 Bug，请通过 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 提交，并尽量包含以下信息：

- **标题**：清晰简洁地描述问题
- **环境**：浏览器/操作系统/Cloudflare Worker 版本
- **复现步骤**：详细的操作步骤
- **预期行为**：您期望发生什么
- **实际行为**：实际发生了什么（附截图或日志更佳）
- **其他上下文**：如是否稳定复现、是否与特定网络环境相关

### 提出新功能

欢迎提出新功能建议！请在 Issue 中说明：

- **功能描述**：该功能解决什么问题
- **使用场景**：谁会用、怎么用
- **替代方案**（如有）：当前有哪些变通方法
- **额外上下文**：相关技术背景或参考实现

### 改进文档

文档（README、API 说明、本贡献指南等）若有错别字、表述不清或遗漏，欢迎提交 PR 修正。即使是很小的改进也很有价值。

### 提交代码

如果您想贡献代码，请遵循以下流程：

1. **先沟通**：较大改动（如新增功能、重构）建议先在 Issue 中讨论，避免做无用功。
2. **保持聚焦**：每个 PR 只解决一个问题或新增一个功能。
3. **写测试**：若可行，请为新增功能或修复添加测试用例。
4. **更新文档**：如有 API 变更或新功能，请同步更新 README 和本指南。

---

## 开发环境准备

本项目是 Cloudflare Worker，使用 JavaScript (ES2022) 编写，部署在 Worker 运行时。

### 必备工具

- [Node.js](https://nodejs.org/) 18+ 及 npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（Cloudflare Workers 官方 CLI）

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

# 安装依赖（如果有 package.json，但目前是单文件 Worker，无需依赖）
# 若后续引入测试框架等，可添加

# 本地启动开发服务器（需要 Cloudflare 账号）
wrangler dev _workers.js

# 访问 http://localhost:8787 预览
```

> 注意：由于 Worker 依赖 Cloudflare 环境（如 `caches`、`WebSocket`、`KV` 等），本地开发时某些功能可能受限。建议直接部署到测试环境进行完整验证。

---

## 代码规范

- **语言**：JavaScript (ES2022)，使用严格模式 (`'use strict'`)。
- **缩进**：2 个空格，不要使用 Tab。
- **分号**：每个语句末尾加分号。
- **命名**：
  - 变量/函数：`camelCase`
  - 类/构造函数：`PascalCase`
  - 常量：`UPPER_SNAKE_CASE`（仅用于全局常量）
- **注释**：复杂逻辑、公共函数、关键算法需添加清晰注释，优先使用英文。
- **单文件**：所有代码在 `_workers.js` 中（目前设计如此），但若扩展为多文件，请保持模块化。
- **避免全局污染**：尽量使用 IIFE 或模块作用域。
- **错误处理**：对 I/O 操作（fetch、KV）使用 `try/catch`，并给出有意义的错误信息。
- **安全**：始终进行输入校验（`parseInt` 钳制、URL 白名单等），避免 XSS 和注入。

---

## 测试指南

目前项目暂无自动化测试框架，但欢迎贡献测试。手动测试时，请重点验证：

- 所有 API 端点返回预期状态码和数据格式
- WebSocket 连接及双向通信正常
- 限流机制生效（触发 429）
- 不同语言（中/英/繁）界面显示正确
- 主题切换（深色/浅色/自动）正常
- 各诊断按钮（丢包率、测速、CPU 等）结果合理

若编写自动化测试，建议使用 [Vitest](https://vitest.dev/) 或 [Jest](https://jestjs.io/) 配合 `wrangler` 的测试工具。

---

## 提交 Pull Request

1. **Fork 仓库**：点击 GitHub 右上角的 Fork 按钮。
2. **创建分支**：从 `main` 分支创建您的特性分支（如 `feature/add-new-test`）。
3. **提交更改**：写清晰的提交信息（推荐使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式）。
4. **推送分支**：推送到您的 Fork。
5. **打开 PR**：前往原始仓库，点击 New Pull Request，选择您的分支并填写 PR 模板。

### PR 描述要求

- **标题**：简洁描述改动（如 `feat: add multi-node comparison table`）
- **内容**：说明改动目的、实现方式、影响范围，以及如何测试
- **关联 Issue**：如修复或关联某个 Issue，请注明 `Closes #xxx` 或 `Related to #xxx`

---

## 代码审核流程

- 所有 PR 至少需要一位维护者审核通过方可合并。
- 审核者会关注代码质量、性能影响、安全性和文档完整性。
- 如有修改意见，请友善回应并积极调整。
- 合并后，您的贡献将出现在项目历史中，并会在更新日志中致谢。

---

## 社区沟通

- **问题讨论**：请在 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 中讨论，便于追踪。
- **实时交流**：暂未建立聊天群组，如有紧急事宜可邮件联系维护者（asiacomk@gmail.com）。
- **尊重他人**：请遵循行为准则，保持友好和建设性的讨论氛围。

---

感谢您为 **NetSight Pro** 添砖加瓦！🎉 期待您的贡献！
