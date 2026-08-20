# 安全政策

**最后更新**：2026年8月

NetSight Pro 致力于为用户提供安全、可靠的网络诊断服务。本安全政策概述了项目对安全漏洞的处理流程、已实施的安全措施以及用户和贡献者应遵循的最佳实践。

---

## 🔒 支持的版本

我们仅对最新稳定版本提供安全更新。建议所有用户始终部署最新版本以获取最新的安全修复。

| 版本 | 支持状态 | 安全更新 |
|------|----------|----------|
| 4.1-security（最新） | ✅ 完全支持 | 及时修复 |
| 4.0.x 及更早 | ❌ 不再支持 | 建议升级 |

请通过 [GitHub Releases](https://github.com/BlueDriftHK/CF-workers-netdiag/releases) 获取最新版本。

---

## 📮 报告安全漏洞

如果您发现安全漏洞，**请勿公开披露**（不要在 Issues 或 Discussions 中直接提及）。请通过以下方式私密报告：

### 报告渠道

1. **GitHub 安全漏洞报告（推荐）**  
   访问项目仓库的 [Security Advisories](https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories) 页面，点击“Report a vulnerability”提交详细描述。

2. **电子邮件**  
   如果无法使用 GitHub 安全功能，可将漏洞详情发送至项目维护者的邮箱（地址可在仓库页面找到）。邮件主题请使用 `[SECURITY]` 前缀，以确保及时处理。

### 报告内容

请尽可能提供以下信息，以便我们快速复现和修复：

- **漏洞类型**（例如：XSS、CSRF、信息泄露、代码注入等）
- **影响范围**（受影响的端点、功能或数据）
- **复现步骤**（详细操作，包括请求/响应示例）
- **潜在危害**（攻击者可能利用该漏洞做什么）
- **环境信息**（Worker 版本、部署配置等）
- **您的联系方式**（以便我们与您沟通进展，可选）

### 响应承诺

- **首次响应**：我们会在 48 小时内确认收到您的报告。
- **评估与修复**：我们将在 7 个工作日内完成初步评估，并制定修复计划。关键漏洞会优先处理。
- **公开披露**：在修复版本发布后，我们会公开致谢（经您同意），并更新安全公告。

我们承诺对报告者的身份保密，不会在未经您允许的情况下公开您的个人信息。

---

## 🛡️ 已实施的安全措施

NetSight Pro 从设计之初就将安全性作为核心考虑，目前已经实施了以下防护机制：

### 1. 请求来源限制
- **同源导航检查**：所有敏感端点（`/speedtest`、`/upload-test`、`/cpu-test`、`/ws-test` 等）均要求请求来自同一 Origin（或 CORS 允许列表），有效防止跨站请求伪造（CSRF）。
- **CORS 白名单**：通过环境变量 `ALLOWED_ORIGINS` 控制，仅允许明确指定的 Origin 进行跨域访问。

### 2. 输入验证与过滤
- **数值参数校验**：所有整型参数（`size`、`count`、`n`、`limit`）均经过 `clampInt` 限制在安全范围内，避免溢出或资源耗尽攻击。
- **URL 校验**：`/dns-proxy` 端点仅允许 `http` 或 `https` 协议，且目标域名必须属于白名单（`cloudflare.com`、`google.com`、`github.com`）。
- **请求体大小限制**：`/upload-test` 最大 10MB，`/api/log-speed` 最大 10KB，防止大载荷攻击。
- **输出转义**：所有用户可控数据在输出到 HTML 或 JSON 前，均经过 `escapeForJS` 或 `escapeHTML` 转义，防止 XSS 注入。

### 3. 限流与资源保护
- **通用限流**：每个 IP 每分钟最多 60 次请求（静态资源除外），防止滥用和 DDoS。
- **CPU 测试限流**：针对 `/cpu-test` 单独限流（每分钟 3 次），避免恶意消耗 Worker CPU 资源。
- 限流数据定期清理，防止内存泄漏。

### 4. 安全头部
每个响应都包含以下安全头部（由 `SECURITY_HEADERS` 常量强制添加）：
- `X-Content-Type-Options: nosniff` – 防止 MIME 类型嗅探
- `X-Frame-Options: DENY` – 防止点击劫持
- `Referrer-Policy: strict-origin-when-cross-origin` – 限制 Referer 泄露
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` – 强制 HTTPS
- **Content-Security-Policy (CSP)** – 使用随机 nonce 限制脚本、样式、字体、连接等资源来源，大幅降低 XSS 和代码注入风险。

### 5. 外部请求保护
- 所有向外部 API（ipapi.co、Scamalytics 等）发起的请求均设置 **超时（4~5 秒）** 和 **AbortController**，防止长时间阻塞。
- 外部 API 返回的错误会被捕获并妥善处理，不会泄露内部信息。

### 6. 部署安全
- 无需额外暴露端口或服务，完全运行在 Cloudflare Workers 的隔离环境中。
- 敏感配置（如 `ALLOWED_ORIGINS`）通过环境变量注入，不会硬编码在代码中。
- KV 存储的数据均设置 TTL（过期时间），自动清理历史数据。

---

## ⚠️ 安全注意事项

### 对用户
- **保持更新**：定期检查并部署最新版本，以获取安全修复。
- **配置环境变量**：在生产环境中，务必设置 `ALLOWED_ORIGINS` 限制访问来源，避免被未授权站点调用。
- **保护 KV 数据**：如果绑定 `SPEED_HISTORY`，请确保 KV 命名空间仅被此 Worker 访问，不对外公开。
- **监控流量**：关注 Worker 的请求日志和限流情况，如发现异常高频请求，可考虑调整限流阈值或增加防护。

### 对贡献者
- **不要引入外部依赖**：本项目尽量保持零依赖，减少供应链攻击风险。如有必要引入第三方库，必须经过严格审查。
- **谨慎处理用户 IP**：所有 IP 信息仅用于诊断展示，不得滥用或长期存储。KV 中不存储 IP 地址，仅存储测速数据。
- **避免硬编码密钥**：所有敏感信息（如 API 密钥）必须通过环境变量注入，绝不可硬编码在代码中。
- **遵循输入校验规范**：添加新端点时，必须对所有输入参数进行校验和清理，遵循现有模式。
- **更新安全头部**：如需调整 CSP 或其他安全头，请确保不影响现有功能并充分测试。

---

## 🏆 致谢

我们衷心感谢以下安全研究人员和社区成员，他们负责任地报告了安全漏洞，帮助改进了 NetSight Pro 的安全性：

（此处将列出已公开致谢的研究人员，可添加 GitHub 用户名或姓名）

如果您报告了漏洞并被接受，我们将在获得您的同意后在此处公开致谢。

---

## 📞 联系

- 安全问题专用邮箱：（请参阅项目主页维护者邮箱）
- GitHub Security Advisories： [https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories](https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories)

我们重视安全性，并将持续改进。感谢您的信任和支持。

---

**NetSight Pro – 安全与性能并重。**
