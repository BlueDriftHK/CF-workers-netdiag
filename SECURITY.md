# 安全策略（Security Policy）

**项目：NetSight Pro** · 版本 **1.0** · 生效日期：2026-11-08
**当前发布版本：5.1.0** · 维护者：NetSight Pro maintainers

> 如果你发现了安全漏洞，**请不要公开提交 Issue、PR 或 Discussion**。请按 [漏洞报告](#漏洞报告) 中的方式私下联系我们。
> 本文同时给出项目的威胁模型、安全设计、自托管加固清单与漏洞披露流程，供用户、部署者与安全研究者参考。

---

## 目录

- [支持的版本](#支持的版本)
- [漏洞报告](#漏洞报告)
- [报告之后会发生什么](#报告之后会发生什么)
- [安全研究安全港](#安全研究安全港)
- [严重程度分级](#严重程度分级)
- [威胁模型](#威胁模型)
- [安全设计与现有防护](#安全设计与现有防护)
- [安全相关配置](#安全相关配置)
- [自托管加固清单](#自托管加固清单)
- [已知限制与接受的风险](#已知限制与接受的风险)
- [隐私与数据流](#隐私与数据流)
- [供应链与依赖安全](#供应链与依赖安全)
- [事件响应流程](#事件响应流程)
- [安全更新与版本支持](#安全更新与版本支持)
- [不在范围内的问题](#不在范围内的问题)
- [致谢与披露政策](#致谢与披露政策)
- [English Version](#english-version)

---

## 支持的版本

| 版本 | 支持状态 | 说明 |
|---|---|---|
| **5.1.x** | ✅ 活跃支持 | 当前发布版本，接收安全修复 |
| 5.0.x | ⚠️ 有限支持 | 仅接收严重安全修复，建议升级 |
| 4.x | ❌ 不再支持 | 请升级到 5.1.x |
| `main` 分支 | ✅ 开发中 | 可能包含未发布修复；不建议直接用于生产 |

安全修复会以 **patch 版本**（如 5.1.1）发布，并在 GitHub Security Advisories 中公告。升级方式见 [安全更新与版本支持](#安全更新与版本支持)。

---

## 漏洞报告

### 首选渠道

**GitHub Private Security Advisory（推荐）**

<https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories/new>

优点：私密、可附 PoC、可协调披露、可申请 CVE/GHSA。

### 备选渠道

- 邮件：**<asiacomk@gmail.com>**，标题请以 `[SECURITY]` 开头；
- 如涉及维护者本人或邮件渠道不可用，请使用 GitHub 平台的滥用/安全报告渠道。

> 如需加密传输，请在首封邮件中说明，维护者会提供可用的安全传输方式。请勿在首封邮件中直接附带完整利用细节或用户数据。

### 报告中请尽量包含

- **受影响版本**（`/health` 或页面版本号）与部署方式（单文件 / 模块化 / 自定义配置）；
- **漏洞类型**（如鉴权绕过、SSRF、XSS、DoS、信息泄露、供应链）；
- **复现步骤**（最小化、可重复）；
- **影响评估**（能做什么、需要什么前置条件、影响哪些用户/数据/成本）；
- **PoC 或关键请求/响应**（请脱敏；不要包含真实用户数据或第三方凭据）；
- **是否已公开**、是否计划公开、希望的披露时间；
- **你的联系方式与署名偏好**（真实姓名/昵称/匿名）；
- 如果涉及配置，请说明 `PAGE_TOKEN_SECRET`、`MONITOR_ADMIN_KEY`、KV、`SITE_CONFIG` 是否启用（**不要发送密钥本身**）。

### 不要做什么

- 不要在公开 Issue / PR / Discussion / 社交媒体发布漏洞细节或可用 PoC；
- 不要访问、修改、删除他人数据，不要扩大访问范围；
- 不要进行 DoS、压测或影响服务可用性的测试；
- 不要对第三方系统（包括演示站点、他人部署、真实用户目标）进行测试；
- 不要以披露为威胁索取报酬、合并代码或其他利益。

---

## 报告之后会发生什么

| 阶段 | 目标时间 | 说明 |
|---|---|---|
| 确认收到 | **7 天内** | 人工回复，说明正在处理；如有需要会请求更多信息 |
| 初步分级 | **14 天内** | 与报告者确认严重程度、影响范围与复现条件 |
| 修复与验证 | 视严重程度，通常 **30–90 天** | 复杂问题可能更久；会持续同步进展 |
| 协调披露 | 修复发布后 | 征得报告者同意后发布 Advisory，并致谢 |
| 复盘 | 发布后 | 必要时更新代码、文档或本策略 |

说明：

- 这是个人维护的开源项目，以上为**目标时间**，不是商业 SLA；维护者会尽力在合理时间内响应；
- 如漏洞正在被积极利用，请在报告中注明，会优先处理；
- 修复发布前，请不要公开细节；如需提前向你的客户/团队说明，请先与维护者协调。

---

## 安全研究安全港

在以下范围内，出于善意的安全研究**不会**被追究：

- 只测试**你自己部署的** NetSight Pro 实例；
- 只测试你拥有或获得**明确书面授权**的目标；
- 不访问、修改、删除他人数据；不建立持久化访问；不扩大访问范围；
- 不进行可能影响可用性的测试（DoS、压测、资源耗尽）；
- 不公开未修复的漏洞细节；
- 发现敏感数据时立即停止，删除本地副本，并告知维护者；
- 给维护者合理的修复时间（通常 7–30 天，严重问题可协商）。

**超出范围**的行为（包括但不限于）：扫描第三方、利用漏洞获取未授权数据、部署后门、把项目能力用于攻击、公开 0-day、以漏洞勒索。

如果你不确定某个测试是否在安全港范围内，**先发邮件问**，不要先做。

---

## 严重程度分级

使用 [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) 作为参考，并结合项目实际影响：

| 级别 | 典型问题 | 示例 |
|---|---|---|
| **Critical** | 未授权即可完全控制 / 大规模数据泄露 | 页面令牌或管理员鉴权可被完全绕过；SSRF 可读取云元数据/内网敏感服务；远程代码执行 |
| **High** | 严重权限提升 / 敏感数据或密钥泄露 / 可稳定 DoS | 持久化 XSS 可窃取管理员密钥；监控配置可被未授权修改；令牌伪造；可低成本打爆部署额度 |
| **Medium** | 受限绕过 / 中等影响 | 限流可被特定方式绕过并造成明显成本；信息泄露帮助进一步攻击；CSP 绕过但需用户交互 |
| **Low** | 低影响 / 纵深防御 | 配置错误提示、非敏感版本信息、缺少安全头但不构成利用链 |
| **Informational** | 最佳实践建议 | 文档改进、可观测性建议、非漏洞的健壮性问题 |

> 最终分级由维护者结合可利用性、影响面、是否需要前置条件与项目实际部署情况判断。如果你不同意分级，欢迎补充论证。

---

## 威胁模型

### 资产（Assets）

- **用户数据**：浏览器内的诊断结果、历史记录、本地设置（默认不离开浏览器）；
- **会话令牌**：页面令牌（Cookie / `x-ns-token`）、`PAGE_TOKEN_SECRET`；
- **管理能力**：`MONITOR_ADMIN_KEY`、`/api/monitor*`、`/api/admin/overview`、`/metrics`；
- **持久化数据**：可选 KV 中的监控配置、状态、事件日志；
- **部署可用性与成本**：Worker 请求额度、CPU、KV 读写、出站带宽；
- **代码与构建链**：源码、构建脚本、CI、发布产物。

### 参与者（Actors）

- 未认证的互联网用户 / 爬虫 / 扫描器；
- 正常使用页面的访客（拥有页面令牌）；
- 恶意页面访客（试图越权/滥用/DoS/消耗配额）；
- 部署者 / 管理员（拥有部署与密钥；也可能误配置）；
- 被监控目标 / 第三方服务（可能返回恶意内容或异常响应）；
- 供应链攻击者（依赖、构建、CI、发布渠道）；
- 网络中间人（在无 TLS 或错误配置时）。

### 信任边界（Trust Boundaries）

1. **浏览器 ↔ Cloudflare 边缘**：TLS、CSP、同源策略、Cookie 属性；
2. **Worker ↔ 上游**：DoH、crt.sh、监控目标、webhook；所有用户输入都在此跨越边界，必须校验；
3. **Worker ↔ KV**：写入预算、去抖、失败处理；
4. **管理员 ↔ 管理面**：页面令牌 + 管理员密钥双重校验；
5. **源码 ↔ 构建产物**：构建可复现、CI 校验、发布来源可信。

### 主要威胁与对应控制

| 威胁 | 控制 |
|---|---|
| 伪造 Origin/Referer 绕过同源校验 | 页面令牌（HttpOnly Cookie + 自定义头）+ HMAC；不依赖 Origin |
| 跨 isolate 令牌失效导致刷新风暴 | 可选无状态 HMAC 令牌；前端 403 静默续期重试 |
| SSRF 访问内网/云元数据 | 协议/端口白名单、私网判定、DoH 公网解析、逐跳重定向校验 |
| 恶意 URL/域名导致 XSS | HTML/JS 上下文分离转义、CSP nonce、无 `unsafe-inline` |
| 恶意目标响应头注入页面 | 输出转义 + 截断 + CSP |
| 接口滥用导致额度耗尽 | 限流（按 IP/端点）、大响应配额、KV 写预算、端点开关 |
| 管理密钥泄露/爆破 | 恒定时间比较、`x-admin-key`、sessionStorage、限流 |
| 第三方 webhook 被用于 SSRF | 保存时校验、发送前 DNS 复核、禁止跟随重定向 |
| 静态资源被篡改 | 内容哈希版本、Cache API、可选的 SRI（外部字体） |
| 供应链/构建污染 | 零运行时依赖、CI 校验、可复现构建、发布审计 |

---

## 安全设计与现有防护

### 1. 鉴权与会话

- 主页面每次渲染签发页面令牌：
  - 配置 `PAGE_TOKEN_SECRET` 时：`v1.<exp>.<nonce>.<HMAC-SHA256>` **无状态令牌**，跨 isolate 有效；
  - 未配置时：per-isolate 内存 Map（TTL 1 小时、最多 8000 条、LRU 淘汰）；
- 令牌写入 `HttpOnly; SameSite=Strict; Path=/; Max-Age=3600` Cookie，并注入 `window.__PAGE_KEY__`；
- 前端对同源请求自动附加 `x-ns-token`；403 时调用 `/api/page-token` **静默续期并重试一次**，避免整页刷新循环；
- `/health`、`/speedtest`、`/upload-test`、`/stream-test`、`/ws-test`、`/http2-test`、`/api/*`（除 `/api/page-token`）均要求令牌；
- `/admin` 页面本身公开，但 `/api/admin/overview` 要求令牌 + 管理密钥；
- `/api/monitor*` 要求令牌 + `x-admin-key`；
- `/metrics` 要求 `SITE_CONFIG.metricsKey` 或 `MONITOR_ADMIN_KEY`。

### 2. SSRF 防护

面向用户输入的目标（站点体检、监控、webhook）：

- 协议白名单：仅 `http:` / `https:`；
- 端口白名单：仅 80 / 443；
- 私网/特殊地址判定：IPv4 私网、回环、链路本地、组播、保留段；IPv6 ULA、链路本地、组播、6to4、Teredo、NAT64、IPv4-mapped、旧 site-local 等；
- 域名先做 **DoH 公网解析校验**（缓存 60 秒）；
- 站点体检与监控巡检**手动跟随重定向，每一跳重新校验**；
- 监控 webhook：发送前重新做 DoH 校验，禁止重定向；
- 超时、响应体大小与读取方式受限；仅取必要内容。

### 3. 注入与输出

- HTML 模板区分：
  - `escapeHtml`：HTML 文本/属性上下文；
  - `escapeForJS`：JS 字符串上下文（含 `<`、`>`、引号、反引号、`${}` 等）；
- CSP：`default-src 'self'`、`script-src 'self' 'nonce-<random>'`、无 `unsafe-inline`；内联脚本必须带 nonce；
- 安全响应头：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、HSTS、Referrer-Policy、Permissions-Policy、`frame-ancestors 'none'` 等；
- 用户可控数据（DNS TXT、响应头、重定向 URL、监控配置）在渲染前统一转义并截断；
- 前端不加载第三方脚本。

### 4. 滥用与成本防护

| 端点/场景 | 限制 |
|---|---|
| 默认请求 | 60 次 / 分 / IP；Map 硬上限 5000 键、30 秒增量清理 |
| `/health` | 180 次 / 分 / IP（独立桶） |
| 大响应（`/speedtest >2MB`、`/upload-test`、`/stream-test`） | 30 次 / 分 / IP（独立桶） |
| `/cpu-test` | 3 次 / 分 / IP |
| `/speedtest` | 单次 ≤64 MB |
| `/upload-test` | ≤32 MB |
| `/stream-test` | ≤5 MB |
| `/api/log-speed` | body ≤10 KB（流式限长） |
| `/api/monitor` | body ≤64 KB；最多 10 目标 |
| KV 写入 | 20 次 / 分 / isolate、600 次 / 日 / isolate、同键去抖 10 秒、失败回滚 |
| 监控 | 并发 3、证书检查 6 小时/目标、静默/维护窗口 |
| 已停用端点 | `/dns-proxy`、`/api/ip-fraud`、`/api/reach-check` 返回 410 |

### 5. 管理面

- 管理密钥使用**恒定时间比较**，前端仅存 `sessionStorage`；
- `/admin` 只读，修改监控需回到主页面工具；
- 管理员端点仍在令牌 + 密钥双重保护下；
- `/metrics` 与 `/admin` 建议在反向代理/WAF 层再加访问控制。

### 6. 数据与隐私

- 诊断结果默认仅存浏览器（localStorage / 内存）；
- 无第三方分析、广告、指纹、埋点；
- 监控状态仅在显式配置 KV 后写入；
- PWA Service Worker 只缓存静态资产，不缓存 API 响应与包含令牌的页面；
- 日志中不记录令牌、Cookie、管理密钥。

---

## 安全相关配置

| 配置 | 建议 | 说明 |
|---|---|---|
| `PAGE_TOKEN_SECRET` | **必须设置**（高熵随机，≥32 字节） | 无状态 HMAC 令牌，跨 isolate 生效 |
| `MONITOR_ADMIN_KEY` | **必须设置**（高熵随机） | 管理端点与 `/metrics` 鉴权 |
| `SITE_CONFIG.metricsKey` | 可选，独立随机 | `/metrics` 专用密钥 |
| `ALLOWED_ORIGINS` | 尽量不配置；如需要，使用精确 Origin | 不支持 `*`，通配符会被忽略 |
| `SPEED_HISTORY` KV | 仅在需要监控/历史时绑定 | 注意 KV 写预算与成本 |
| `SITE_CONFIG.disabledTools` | 公开部署建议禁用不需要的工具 | 降低攻击面与成本 |
| `SITE_CONFIG.disabledEndpoints` | 公开部署建议禁用不需要的端点 | 命中返回 403 |
| `SITE_CONFIG.offline` | 按需 | PWA 离线壳；不影响 API 安全 |
| `SITE_CONFIG.certCheck` | 按需 | crt.sh 外部依赖 |

**永远不要把密钥写进 `wrangler.toml` 的 `vars`、源码、Issue、PR 或截图。** 使用：

```bash
npx wrangler secret put PAGE_TOKEN_SECRET
npx wrangler secret put MONITOR_ADMIN_KEY
```

---

## 自托管加固清单

公开部署前请逐项确认：

### 密钥与身份

- [ ] 已设置 `PAGE_TOKEN_SECRET`（高熵、≥32 字节、非默认值）；
- [ ] 已设置 `MONITOR_ADMIN_KEY`（高熵、与其它密码不同）；
- [ ] `SITE_CONFIG.metricsKey` 独立且随机（如启用）；
- [ ] 密钥只通过 `wrangler secret` 配置，未写入仓库/截图/聊天记录；
- [ ] 定期轮换密钥（尤其怀疑泄露后），并同步更新已部署实例；
- [ ] 管理员密钥未在浏览器 localStorage 中持久化（项目默认使用 sessionStorage）。

### 访问控制与滥用

- [ ] 公开部署时启用 Cloudflare WAF / Rate Limiting / Managed Challenge / Turnstile；
- [ ] 通过 `SITE_CONFIG.disabledTools` / `disabledEndpoints` 关闭不需要的工具与端点；
- [ ] 未把 `/metrics`、`/admin` 直接暴露给公网（或在边缘层限制来源 IP）；
- [ ] 已评估 `/speedtest`、`/upload-test`、`/stream-test` 的流量成本；
- [ ] 已配置账单告警与 Workers/KV 用量监控；
- [ ] 不把测试/演示实例用于生产数据。

### 部署与网络

- [ ] 使用自定义域 + 强制 HTTPS，确认证书有效；
- [ ] 启用 HSTS（项目默认返回，但需确认域名策略）；
- [ ] 如启用 `ALLOWED_ORIGINS`，只写精确 Origin，不要使用 `*`；
- [ ] KV 绑定最小权限命名空间，避免与其它项目共享；
- [ ] 如使用 Cron，确认真实频率与监控目标符合预期；
- [ ] 定期检查 `/health`、`/metrics` 的 403/429/500、KV 失败与监控状态；
- [ ] 定期 `npm run verify` 并跟随安全更新。

### 构建与发布

- [ ] 只从可信来源获取代码，审查变更；
- [ ] 使用 `project/` 构建，不直接改 `dist/_workers.js`；
- [ ] 不引入未审计的第三方运行时依赖；
- [ ] CI 不存储生产密钥；部署使用独立凭证；
- [ ] 发布前跑完整回归与手工冒烟（见 CONTRIBUTING 发布流程）。

### 隐私与合规

- [ ] 明确告知用户诊断数据的处理方式（默认本地 / 可选 KV）；
- [ ] 不要求用户提交不必要的个人数据；
- [ ] 如你的服务面向他人，确认符合当地隐私与网络法规；
- [ ] 不要使用本工具对未授权目标进行探测。

---

## 已知限制与接受的风险

这些是**已知的、经评估可接受**的限制，不属于漏洞（除非你能证明可被低成本利用并造成实质影响）：

1. **per-isolate 限制**：限流、KV 预算、用量统计都是 per-isolate 的；多 isolate 会放大有效额度。公开高流量部署应叠加 WAF / 平台限流。
2. **未配置 `PAGE_TOKEN_SECRET` 时**：令牌回退为 per-isolate Map，跨 isolate 可能出现 403；前端会静默续期，但高频场景建议配置 secret。
3. **crt.sh / DoH / 告警平台信任**：证书与 DNS 信息来自第三方，存在延迟、缺失或被污染的可能；失败时降级处理，不阻塞主流程。
4. **IP 地理信息来自 `request.cf`**：Cloudflare 平台数据，精度有限；前端可回退第三方 ipapi（仅浏览器侧）。
5. **管理员密钥是共享密钥**：没有账号体系、MFA 与细粒度权限；安全依赖密钥强度、传输安全与保管。
6. **`/metrics` 与 `/health` 的 per-isolate 计数**：重启/换 isolate 归零，不适合作为长期计费依据。
7. **PWA 离线壳**：只缓存静态资产与离线页；离线期间无法提供诊断数据。
8. **静态展示页**：`index.html` / `index-apple.html` 为静态演示，数据为模拟，不连接 Worker API。
9. **免费套餐**：10 万请求/天、10 ms CPU、KV 1000 写/天等；项目做了预算与限流，但公开部署仍需平台侧防护。
10. **AGPL-3.0**：修改后作为网络服务提供时，需按许可证向使用者提供对应源代码。

> 如果你认为上述某项限制可被利用造成安全影响，欢迎按漏洞流程报告，我们会重新评估。

---

## 隐私与数据流

| 数据 | 去向 | 是否持久化 |
|---|---|---|
| RTT / 抖动 / 丢包 / 吞吐结果 | 浏览器内存 / localStorage（可选） | 本地 |
| 诊断历史 | 浏览器 localStorage | 本地 |
| 页面令牌 | HttpOnly Cookie + 页面内变量 | 会话级 |
| 监控配置 / 状态 / 事件 | 可选 KV（`SPEED_HISTORY`） | 部署者账号内 |
| 测速历史（可选） | KV（默认关闭） | 部署者账号内 |
| 目标站点响应头 | 浏览器展示，不写入 KV | 不持久化 |
| DoH 查询内容 | 发送给 DoH 解析器 | 由第三方策略决定 |
| 证书查询 | 发送给 crt.sh（域名） | 由第三方策略决定 |
| 告警内容 | 发送给配置的 webhook | 由告警平台策略决定 |
| 页面访问日志 | Cloudflare 平台（按账户配置） | 由部署者策略决定 |

我们没有自建的分析/日志服务，也不向维护者回传数据。你的部署数据只属于你自己的 Cloudflare 账号。

---

## 供应链与依赖安全

- **运行时零第三方依赖**：Worker 由平台原生 API 构成；构建与测试只使用 Node 内置模块；
- **前端依赖**：应用页面使用 Font Awesome（cdnjs）与 Google Fonts；静态展示页零外部请求；
- **新增依赖要求**：必须讨论、审查许可证兼容性（AGPL-3.0）、维护状态与体积；
- **构建可复现**：`project/scripts/build.mjs` 会做语法检查与运行时资产逐字节校验；
- **CI**：`.github/workflows/verify.yml` 在 Node 20 上执行 build → check → 164 项测试，不包含生产密钥；
- **发布**：通过 `wrangler deploy` 或可信 CI 发布；建议开启 GitHub 的 branch protection 与 2FA；
- **漏洞响应**：如依赖出现安全公告，维护者会评估影响并在 patch 版本中更新或说明。

---

## 事件响应流程

当收到安全报告或发现正在被利用的问题时，维护者会：

1. **确认与分级**：复现、评估影响面（数据/密钥/成本/可用性）；
2. **止损**：必要时通过 `SITE_CONFIG.disabledEndpoints` / `disabledTools` 临时关闭能力；轮换 `PAGE_TOKEN_SECRET`、`MONITOR_ADMIN_KEY`、`metricsKey`；清理/回滚 KV 配置；
3. **修复**：在私有分支开发补丁，补充回归测试；
4. **验证**：在预发环境复测，确认无回归；
5. **发布**：发布 patch 版本与 GitHub Security Advisory；
6. **通知**：告知报告者与受影响用户（仓库公告/Release Notes）；
7. **复盘**：分析根因，更新代码、文档与本策略，必要时补充测试；
8. **致谢**：在 Advisory 与 Release Notes 中致谢报告者（征得同意）。

如你正在被积极利用，请在报告中明确说明，并尽量提供时间线、日志与影响范围。

---

## 安全更新与版本支持

- 安全修复以 **patch 版本** 发布（例如 `5.1.1`）；
- 严重问题可能提前发布安全公告（GitHub Security Advisories）；
- 只有最新 minor 版本接收安全修复；旧版本建议尽快升级；
- 升级建议：
  1. 阅读 Release Notes 与 Advisory；
  2. 备份 KV 配置（如使用监控）；
  3. 更新代码并 `npm run verify`；
  4. 重新构建、同步、部署；
  5. 轮换可能受影响的密钥；
  6. 观察 `/health`、`/metrics` 与告警。

---

## 不在范围内的问题

以下通常**不被视为本项目漏洞**（除非能与其他问题组合造成实际影响）：

- Cloudflare Workers / KV / Cron / WAF 平台本身的漏洞；
- 第三方服务（crt.sh、DoH 解析器、Slack/Telegram/ntfy/飞书/钉钉、ipapi、Google Fonts、Font Awesome CDN）的漏洞或可用性问题；
- 依赖库已知但未被项目利用的问题（请提供利用路径）；
- 缺少安全头但没有实际影响（项目默认已带全套基础安全头）；
- 仅扫描器输出、没有可复现步骤或影响说明的报告；
- Self-XSS、需要用户安装恶意扩展/修改自己浏览器才能触发的场景；
- 社会工程、物理访问、钓鱼、凭证泄露；
- 暴力破解管理员密钥但没有速率限制影响的报告（已有恒定时间比较与限流；如能低成本绕过请报告）；
- 对公开演示页/静态展示页的纯视觉或内容问题；
- 已在本文件「已知限制」中列出且无可利用路径的问题；
- 对第三方系统进行的测试（无论是否使用本项目）。

> 如果你不确定，请先私下询问。我们更愿意处理一个「可能是误报」的问题，也不愿错过真实风险。

---

## 致谢与披露政策

- 我们采用**协调披露**：默认在修复发布后公开细节，时间由双方协商；
- 如报告者希望匿名，我们尊重其选择；
- 修复发布后，会在 GitHub Security Advisory 与 Release Notes 中致谢（默认使用你提供的署名）；
- 本项目**没有赏金计划**（无货币奖励），但会提供公开致谢、Advisory 记录与（如适用）CVE/GHSA 申请支持；
- 对善意报告，我们承诺不采取法律行动，也不报复；
- 对恶意报告、勒索、公开 0-day 或攻击行为，保留追究权利。

**联系方式**：<asiacomk@gmail.com>（标题 `[SECURITY]`）
**GitHub Security Advisories**：<https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories/new>

---

## English Version

**Security Policy — NetSight Pro v1.0 (effective 2026-11-08, current release 5.1.0)**

**Supported versions.** 5.1.x is actively supported; 5.0.x receives critical fixes only; 4.x is unsupported. `main` may contain unreleased fixes and is not recommended for production.

**Reporting a vulnerability.** Do **not** open a public issue, PR or discussion. Use GitHub Private Security Advisories (preferred) or email <asiacomk@gmail.com> with `[SECURITY]` in the subject. Include affected version, deployment mode, vulnerability type, minimal reproduction, impact assessment, and redacted PoC. Never send real tokens, keys, cookies, user data or third-party credentials.

**What happens next.** Acknowledgement within 7 days (best effort), initial triage within 14 days, fix typically within 30–90 days depending on severity, coordinated disclosure after the fix. This is a personal open-source project, not a commercial SLA. If the issue is actively exploited, say so and it will be prioritized.

**Safe harbor.** Good-faith research is welcome when you test only your own deployment or systems you are authorized to test, do not access or modify third-party data, do not perform DoS/stress tests, do not publicly disclose unfixed details, and allow reasonable time for a fix. Out-of-scope behavior includes scanning third parties, exploiting for data, backdoors, using the tool to attack, public 0-days, or extortion.

**Severity.** We use CVSS v3.1 plus project impact: Critical (full auth bypass, SSRF to cloud metadata, RCE), High (privilege escalation, key/data exposure, stable DoS), Medium (limited bypass or cost/DoS impact), Low (defense-in-depth), Informational (best practices).

**Threat model & controls.** Assets include user diagnostic data, page tokens, admin key, optional KV monitoring state, availability/cost and the build chain. Controls include stateless HMAC page tokens (with per-isolate fallback), HttpOnly SameSite=Strict cookies, silent 403 token refresh, SSRF protection (scheme/port allowlists, private IP/IPv6 filtering, DoH public resolution, per-hop redirect validation, webhook re-validation), CSP with per-response nonce and no `unsafe-inline`, HTML/JS context-specific escaping, rate limits, large-response quotas, KV write budgets, constant-time admin key comparison, disabled endpoints (410), and PWA that never caches API responses or token-bearing pages.

**Security configuration.** Set `PAGE_TOKEN_SECRET` and `MONITOR_ADMIN_KEY` via `wrangler secret` (never in `vars`, source or screenshots). Optionally set `SITE_CONFIG.metricsKey`, exact `ALLOWED_ORIGINS`, bind `SPEED_HISTORY` only if needed, and disable unused tools/endpoints for public deployments.

**Hardening checklist.** Rotate secrets; keep them out of localStorage/source; enable Cloudflare WAF/Rate Limiting/Turnstile for public deployments; restrict `/admin` and `/metrics`; evaluate bandwidth costs; configure billing alerts; use HTTPS/HSTS; monitor 403/429/500 and KV failures; run `npm run verify` and follow security releases.

**Known limitations (accepted risks).** Per-isolate rate limits/counters and KV budgets can be amplified across isolates; without `PAGE_TOKEN_SECRET` tokens are per-isolate; certificate/DNS data depends on third parties; IP geolocation comes from `request.cf`; admin key is a shared secret without MFA; `/health` counters reset on isolate restart; PWA offline shell cannot provide diagnostics offline; static showcase pages use simulated data; free-tier limits still need platform-side protection; AGPL-3.0 applies to hosted modifications.

**Out of scope.** Platform/third-party vulnerabilities, scanner-only reports, self-XSS, social engineering, missing headers without impact, already-documented accepted risks, and testing third parties.

**Disclosure & credit.** Coordinated disclosure by default; reporters may remain anonymous; we credit reporters in advisories and release notes (no monetary bug bounty); good-faith research will not lead to legal action; malicious reports, extortion or public 0-days are not tolerated.

**Contact.** <asiacomk@gmail.com> · GitHub Security Advisories: <https://github.com/BlueDriftHK/CF-workers-netdiag/security/advisories/new>

---

<p align="center">
  <sub>Security is a process, not a badge. Thank you for reporting responsibly.</sub>
</p>
