# 安全策略

## 受支持版本

| 版本   | 状态               |
| ------ | ------------------ |
| 3.6.x  | :white_check_mark: |
| 3.5.x  | :white_check_mark: |
| < 3.5  | :x:                |

## 报告漏洞

**请勿公开提交 Issue。** 安全漏洞请通过以下方式私下报告：

- 邮箱：**asiacomk@gmail.com**

我们会在 48 小时内确认收到。经过验证的关键漏洞通常会在 7 天内发布修复。

## 安全模型

NetSight Pro 完全运行在 Cloudflare Worker 沙箱环境中。除匿名测速统计数据（KV，7 天 TTL）外，服务端不持久化任何用户数据。

### 1. 速率限制

双层限流保护所有 API 端点：

| 级别     | 作用域 | 上限     | 时间窗口 |
| -------- | ------ | -------- | -------- |
| 通用限流 | 每 IP  | 60 次    | 60 秒    |
| CPU 测试 | 每 IP  | 3 次     | 60 秒    |

触发 429 响应时，附带 `retry-after` 头指示客户端可重试时间。

### 2. 输入校验

- 所有数值参数经 `parseInt()` 解析后通过 `Math.min()` 钳制上限，防止资源耗尽。
- `/dns-proxy` 中的目标 URL 会与显式域名白名单（`cloudflare.com`、`google.com`、`github.com`）逐一比对，阻断 SSRF 攻击。
- 所有用户提供的值在进入 URL 上下文前均经过 `encodeURIComponent` 处理。

### 3. XSS 与注入防护

- 注入 HTML 模板的服务端数据由 `escapeForJS()` 转义，对反斜杠、引号、换行、制表符等危险字符做全面中和。
- HTML 页面附带基于单次请求 `nonce` 的 **Content-Security-Policy**，无合法 nonce 的内联脚本会被浏览器直接拦截。
- 前端 `innerHTML` 的使用范围严格限定于已由服务端转义的数据。

### 4. 安全响应头

每个 JSON 响应均包含：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### 5. CORS

Worker 以 `Access-Control-Allow-Origin: *` 响应，允许跨域嵌入。这是有意为之——NetSight Pro 是一款无身份认证的公开诊断工具。

### 6. WebSocket

WebSocket 连接使用 Cloudflare 原生 `WebSocketPair` 进行协议升级。单次 `/ws-test` 请求之外不维护任何持久连接池。

### 7. KV 存储

Workers KV 中存储的测速历史数据具备以下保障：

- **类型守卫** — 所有读取均通过 `typeof` 检查，防止处理意外数据结构。
- **容量上限** — 每个 key 下仅保留最近 5 条记录。
- **自动过期** — 每条记录携带 7 天 TTL，到期自动清除。

## 范围与限制

以下内容**不在**本安全策略覆盖范围内：

- **第三方测试服务器** — 测速、延迟、DNS 测试使用的目标端点由请求时指定，不受我方控制。
- **客户端库** — 浏览器中运行的测量逻辑（Image ping、`performance.now()`）受宿主页面上下文约束。

## 披露记录

| 日期 | 说明 |
| ---- | ---- |
| —    | 暂无 CVE 记录 |

---

*本文档适用于 NetSight Pro v3.6（`_workers.js`）。*
*（内容由AI生成，仅供参考）*
