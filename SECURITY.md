---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 920b985d2f5d9c3397e2be237fdb8e96_8e96f39d779f11f19641525400d9a7a1
    ReservedCode1: IdfxrG/gbthnD+3f7VqPT7naSQlb2YCoap9T0VFyocWfrJzqVpbDS6pE0U9TybGVeaROHrDcm9I1JRh81HiVsROm2IZuw5+qsBpsdMlpDYr5oIGsQNzcupfc6W2fk0IObhn+IshGgJv4lGy48bOUUO+SHXMQre8lUTgaTnjrw09yWJHlnNdmnLhz4T4=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 920b985d2f5d9c3397e2be237fdb8e96_8e96f39d779f11f19641525400d9a7a1
    ReservedCode2: IdfxrG/gbthnD+3f7VqPT7naSQlb2YCoap9T0VFyocWfrJzqVpbDS6pE0U9TybGVeaROHrDcm9I1JRh81HiVsROm2IZuw5+qsBpsdMlpDYr5oIGsQNzcupfc6W2fk0IObhn+IshGgJv4lGy48bOUUO+SHXMQre8lUTgaTnjrw09yWJHlnNdmnLhz4T4=
---

# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.6.x   | :white_check_mark: |
| 3.5.x   | :white_check_mark: |
| < 3.5   | :x:                |

## Reporting a Vulnerability

**Do not open a public issue.** Send vulnerability reports to:

- Email: `<your-security-contact>` (placeholder — replace before publishing)

You should receive an initial response within 48 hours. Critical fixes are typically released within 7 days after confirmation.

## Security Model

NetSight Pro runs entirely within a Cloudflare Worker sandbox. No user data is persisted server-side beyond anonymous speed-test aggregates (KV, 7-day TTL).

### 1. Rate Limiting

Two-tier rate limiting protects every API endpoint:

| Tier | Scope | Limit | Window |
| ---- | ----- | ----- | ------ |
| General | Per IP | 60 requests | 60 seconds |
| CPU Test | Per IP | 3 requests | 60 seconds |

429 responses include a `retry-after` header indicating when the client can retry.

### 2. Input Validation

- All numeric parameters are sanitized via `parseInt()` and clamped with `Math.min()` to prevent resource exhaustion.
- URL targets in `/dns-proxy` are validated against an explicit domain allowlist (`cloudflare.com`, `google.com`, `github.com`) to block SSRF.
- `encodeURIComponent` is applied to all user-supplied values before they enter URL context.

### 3. XSS & Injection Mitigations

- Server-generated data injected into the HTML template is escaped by `escapeForJS()`, which neutralizes backslashes, quotes, newlines, and tabs.
- The HTML page is served with a **Content-Security-Policy** that uses a per-request `nonce`. Inline scripts without a valid nonce are blocked.
- `innerHTML` usage in the frontend is confined to data that has already been sanitized server-side.

### 4. Response Headers

Every JSON response includes:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### 5. CORS

The worker responds with `Access-Control-Allow-Origin: *` to support cross-origin embedding. This is intentional — NetSight Pro is a public diagnostic tool with no authentication.

### 6. WebSocket

WebSocket connections are created via Cloudflare's native `WebSocketPair` upgrade. No persistent connection pool is maintained beyond the scope of a single `/ws-test` request.

### 7. KV Storage

Speed-test history stored in Workers KV is:

- **Type-guarded** — `typeof` checks prevent processing of unexpected data shapes.
- **Capped** — only the 5 most recent entries are retained per key.
- **Auto-expired** — entries carry a 7-day TTL.

## Scope & Limitations

The following are **not** covered by this policy:

- **Third-party test servers** — endpoints used for speed, latency, and DNS tests are selected at request time and are outside our control.
- **Client-side libraries** — measurement logic running in the browser (Image ping, `performance.now()`) is subject to the host page's context.

## Disclosure Timeline

| Date | Description |
| ---- | ----------- |
| — | No CVEs filed to date |

---

*This document applies to NetSight Pro v3.6 (`_workers.js`).*
*（内容由AI生成，仅供参考）*
