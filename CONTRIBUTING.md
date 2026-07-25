# 贡献指南

感谢您对 **NetSight Pro** 的关注与支持！我们欢迎任何形式的贡献——无论是报告 Bug、提出新功能建议、改进文档，还是提交代码。

请花几分钟阅读本指南，以使贡献过程更顺畅高效。

---

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境准备](#开发环境准备)
- [项目架构概览](#项目架构概览)
- [代码规范](#代码规范)
- [CSS / UI 规范](#css--ui-规范)
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
- **环境**：浏览器/操作系统/设备类型（桌面/平板/手机）
- **复现步骤**：详细的操作步骤
- **预期行为**：您期望发生什么
- **实际行为**：实际发生了什么（附截图或日志更佳）
- **主题状态**：当时使用的是深色/浅色/自动模式
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

1. **先沟通**：较大改动（如新增功能、重构、UI 改版）建议先在 Issue 中讨论，避免做无用功。
2. **保持聚焦**：每个 PR 只解决一个问题或新增一个功能。
3. **写测试**：若可行，请为新增功能或修复添加测试用例。
4. **更新文档**：如有 API 变更或新功能，请同步更新 README 和本指南。
5. **双主题验证**：涉及 UI 改动时，务必在深色和浅色主题下均验证通过。

---

## 开发环境准备

本项目是 Cloudflare Worker，使用 JavaScript (ES2022) 编写，单文件架构（~3400 行），部署在 Worker 运行时。

### 必备工具

- [Node.js](https://nodejs.org/) 18+ 及 npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（Cloudflare Workers 官方 CLI）
- 现代浏览器（Chrome 80+ / Firefox 103+ / Safari 13.1+ / Edge 80+）

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/BlueDriftHK/CF-workers-netdiag.git
cd CF-workers-netdiag

# 本地启动开发服务器（需要 Cloudflare 账号）
wrangler dev _workers.js

# 访问 http://localhost:8787 预览
```

> 注意：由于 Worker 依赖 Cloudflare 环境（如 `caches`、`WebSocket`、`KV`、`cf` 对象等），本地开发时某些功能可能受限。建议直接部署到测试环境进行完整验证。

### 部署到测试环境

```bash
# 创建 KV 命名空间（首次）
wrangler kv:namespace create SPEED_HISTORY

# 部署到 Cloudflare
wrangler deploy --main _workers.js

# 实时查看日志
wrangler tail
```

---

## 项目架构概览

`_workers.js` 是唯一的源文件，内部按以下顺序组织：

```
_workers.js (~3400 行)
├── 服务端逻辑
│   ├── 限流中间件（IP 级别，通用 60/min + CPU 3/min）
│   ├── 路由分发（/health, /speedtest, /cpu-test, /ws-test 等）
│   ├── WebSocket 处理器（ping-pong + 30s 心跳）
│   ├── KV 读写（测速历史，5 条上限，7 天 TTL）
│   ├── 外部 API 调用（ipapi.co 地理定位, Scamalytics 欺诈评分）
│   └── 安全响应头注入（CSP nonce, HSTS, X-Frame-Options 等）
│
├── HTML 模板（模板字符串）
│   ├── <head>：meta、Font Awesome CDN、内联 <style>
│   ├── <body>：极光背景层 → 卡片网格 → 诊断工具 → 页脚
│   └── 动态数据注入点（${data.xxx} 模板变量）
│
├── CSS 设计体系（内联 <style>，~600 行）
│   ├── :root 设计令牌（深色默认）
│   ├── [data-theme="light"] 浅色覆盖
│   ├── 极光背景动画（body::before / body::after + @keyframes）
│   ├── 玻璃拟态卡片（backdrop-filter: blur(24px) saturate(150%)）
│   ├── 响应式布局（CSS Grid + 1024/768/480px 三档断点）
│   └── 组件样式（badge, info-row, rtt-display, btn 等）
│
└── 客户端 JavaScript（内联 <script>，~1200 行）
    ├── BACKEND_DATA 对象（服务端注入的运行时数据）
    ├── i18n 字典（zh-CN / zh-TW / en）
    ├── DOM 引用缓存（elements 对象）
    ├── 主题管理（applyTheme + matchMedia 监听）
    ├── RTT 监控 + Canvas 图表
    ├── 诊断工具集（丢包/测速/CPU/并发/流式/WebSocket/DNS）
    ├── 地理位置（fetchUserGeo + calculateDistance）
    ├── 多节点对比
    └── 报告生成 + 剪贴板复制
```

### 关键设计决策

- **单文件架构**：所有代码在一个文件中，便于 Dashboard 直接粘贴部署，无需构建工具。
- **服务端渲染数据**：`BACKEND_DATA` 对象由 Worker 在响应时注入，包含 IP、地理位置、TLS 信息等。
- **客户端动态渲染**：部分卡片（如真实 IP 位置、欺诈评分）由客户端 JS 异步获取数据后填充 innerHTML。
- **主题方案**：`:root` = 深色（默认，无需属性），`[data-theme="light"]` = 浅色覆盖。`applyTheme('auto')` 通过 `matchMedia('(prefers-color-scheme: dark)')` 判断。

---

## 代码规范

### JavaScript

- **语言**：JavaScript (ES2022)，使用严格模式。
- **缩进**：4 个空格（服务端）/ 4 个空格（客户端脚本）。
- **分号**：每个语句末尾加分号。
- **命名**：
  - 变量/函数：`camelCase`（如 `fetchUserGeo`、`calculateDistance`）
  - 常量：`UPPER_SNAKE_CASE`（如 `MAX_GEO_RETRY`、`BACKEND_DATA`）
  - DOM ID：`kebab-case`（如 `user-geo-info`、`bot-score-val`）
  - CSS 类：`kebab-case`（如 `glass-card`、`info-row`、`badge-info`）
- **注释**：复杂逻辑、公共函数、关键算法需添加清晰注释。区块分隔使用 `// ==================== 区块名 ====================` 格式。
- **错误处理**：对 I/O 操作（fetch、KV）使用 `try/catch`，并给出有意义的错误信息或静默降级。
- **安全**：始终进行输入校验（`parseInt` 钳制、URL 白名单等），避免 XSS 和注入。用户可控数据必须经过 `escapeForJS()` 处理。

### HTML 模板

- 使用模板字符串（反引号）构建 HTML。
- 动态数据通过 `${data.xxx}` 注入，所有用户可控字段必须经过 `escapeForJS()` 转义。
- 需要 i18n 的文本元素必须带有 `id="t-xxx"` 属性，并在 `updateUI()` 中注册映射。

### 国际化（i18n）

- 三语支持：`zh-CN`（简体）、`zh-TW`（繁体）、`en`（英文）。
- 所有用户可见文本必须通过 `i18n[currentLang].xxx` 获取，禁止硬编码。
- 新增文本时，需同时在三个语言字典中添加对应条目。
- 动态渲染的 innerHTML 模板中，使用 `${t.xxx}` 引用当前语言文本。

---

## CSS / UI 规范

### 设计令牌

所有颜色、间距、圆角等必须通过 CSS 自定义属性引用，禁止硬编码：

```css
/* 深色主题（:root 默认） */
--bg-primary: #050510;
--glass-bg: rgba(255, 255, 255, 0.04);
--glass-border: rgba(255, 255, 255, 0.08);
--accent: #818cf8;
--text-primary: rgba(255, 255, 255, 0.92);

/* 浅色主题覆盖 */
[data-theme="light"] {
    --bg-primary: #f0f2f5;
    --glass-bg: rgba(255, 255, 255, 0.72);
    --glass-border: rgba(0, 0, 0, 0.06);
    --accent: #6366f1;
    --text-primary: #1a1a2e;
}
```

### 玻璃拟态卡片

```css
.card {
    background: var(--glass-bg);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
}
```

### 响应式断点

| 断点 | 布局 |
| :--- | :--- |
| > 1024px | 多列网格（`repeat(auto-fit, minmax(300px, 1fr))`） |
| 768px – 1024px | 部分折叠（`grid-2col` → 单列） |
| < 480px | 完全单列瀑布流，字号缩小，间距收紧 |

### 动效

- 极光背景：`@keyframes auroraShift`，12s ease-in-out infinite alternate
- 卡片悬停：`transform: translateY(-2px)`，0.3s ease
- 主题切换：`transition: background 0.5s ease, color 0.4s ease`
- 避免在 `prefers-reduced-motion: reduce` 下播放动画

---

## 测试指南

目前项目暂无自动化测试框架，但欢迎贡献测试。手动测试时，请重点验证：

### 功能测试

- 所有 API 端点返回预期状态码和数据格式
- WebSocket 连接及双向通信正常
- 限流机制生效（触发 429 + `retry-after` 头）
- 各诊断按钮（丢包率、测速、CPU、并发、流式、DNS）结果合理
- 多节点对比功能正常
- 测速历史写入/读取/清理正常

### UI 测试

- 深色/浅色/自动三种主题模式均正常渲染
- 桌面（>1024px）/ 平板（768–1024px）/ 手机（<480px）布局正确
- 极光背景动画流畅，不造成性能问题
- 玻璃拟态效果在支持的浏览器中正常显示
- 三语切换（中/英/繁）所有文本正确，无遗漏
- 动态渲染卡片（真实 IP 位置、欺诈评分）加载后内容完整

### 安全测试

- 限流触发后正确返回 429
- DNS 代理仅允许白名单域名
- CSP nonce 每次响应不同
- 用户可控输入（IP、UA 等）经过转义，无 XSS

### 自动化测试（推荐）

若编写自动化测试，建议使用 [Vitest](https://vitest.dev/) 配合 `@cloudflare/workers-types`：

```bash
npm init -y
npm install -D vitest @cloudflare/workers-types
```

---

## 提交 Pull Request

1. **Fork 仓库**：点击 GitHub 右上角的 Fork 按钮。
2. **创建分支**：从 `main` 分支创建您的特性分支。
3. **提交更改**：写清晰的提交信息（使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式）。
4. **推送分支**：推送到您的 Fork。
5. **打开 PR**：前往原始仓库，点击 New Pull Request，选择您的分支并填写 PR 模板。

### 分支命名

| 类型 | 格式 | 示例 |
| :--- | :--- | :--- |
| 新功能 | `feature/xxx` | `feature/traceroute-test` |
| Bug 修复 | `fix/xxx` | `fix/websocket-timeout` |
| UI 改进 | `ui/xxx` | `ui/aurora-animation-perf` |
| 文档 | `docs/xxx` | `docs/api-examples` |
| 重构 | `refactor/xxx` | `refactor/rate-limiter` |

### 提交信息格式

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

类型：`feat` / `fix` / `ui` / `docs` / `refactor` / `perf` / `test` / `chore`

示例：
```
feat(diagnostic): add traceroute test endpoint

Implements a 30-hop traceroute using sequential fetch with TTL simulation.
Returns JSON array of {hop, ip, rtt} objects.

Closes #42
```

### PR 描述要求

- **标题**：简洁描述改动（如 `feat: add multi-node comparison table`）
- **内容**：说明改动目的、实现方式、影响范围，以及如何测试
- **截图**：涉及 UI 改动时，附深色/浅色主题截图（桌面 + 手机各一张）
- **关联 Issue**：如修复或关联某个 Issue，请注明 `Closes #xxx` 或 `Related to #xxx`

---

## 代码审核流程

- 所有 PR 至少需要一位维护者审核通过方可合并。
- 审核者会关注：代码质量、性能影响、安全性、双主题兼容性、响应式表现、文档完整性。
- 如有修改意见，请友善回应并积极调整。
- 合并后，您的贡献将出现在项目历史中，并会在更新日志中致谢。

### 审核检查清单

- [ ] 代码风格符合本指南规范
- [ ] 无硬编码颜色/文本（使用 CSS 变量 / i18n）
- [ ] 新增用户可见文本已添加三语翻译
- [ ] 涉及 UI 的改动在深色/浅色主题下均正常
- [ ] 涉及 UI 的改动在桌面/平板/手机断点下均正常
- [ ] 新增 API 端点已添加限流保护
- [ ] 用户可控输入已做转义/校验
- [ ] README 已同步更新（如有 API 变更）

---

## 社区沟通

- **问题讨论**：请在 [Issues](https://github.com/BlueDriftHK/CF-workers-netdiag/issues) 中讨论，便于追踪。
- **实时交流**：暂未建立聊天群组，如有紧急事宜可邮件联系维护者（asiacomk@gmail.com）。
- **尊重他人**：请遵循行为准则，保持友好和建设性的讨论氛围。

---

感谢您为 **NetSight Pro** 添砖加瓦！期待您的贡献！
