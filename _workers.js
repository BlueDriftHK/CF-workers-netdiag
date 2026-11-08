// ============================================================
// NetSight Pro - Apple 极简网络诊断工具
// Cloudflare Worker 完整优化版 | 全界面国际化 + 深色/浅色切换
// 版本: 5.1.0 | 新增：诊断向导 / 管理面板 / DoH wireformat 多解析器 / 监控目标标签 / 工程化（模块化源码 + 构建 + CI） | v5.0：SITE_CONFIG/指标/PWA/成本护栏 | v4.9：域名体检/证书告警/告警降噪/多渠道/ja·ko·es：令牌无状态化/限流封顶/测速与监控可靠性/DNS 与体检加固 | UI 重构：工具按 6 类分组 + 紧凑卡片(tooltip 展示说明) · 结果弹层改宽屏两栏(左说明/参数/操作，右结果) · 按钮统一三级(主/次/幽灵) · 安全卡分「传输与协议」「来源与指纹」
// ============================================================

// ==================== 常量定义 ====================
const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
  'vary': 'Origin'
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
};

function getConfiguredOrigins() {
  if (typeof ALLOWED_ORIGINS === 'undefined' || !ALLOWED_ORIGINS) return [];
  return String(ALLOWED_ORIGINS)
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin && origin !== '*'); // 禁止 '*'：通配符会让任意 Origin 绕过令牌校验
}

// ==================== 站点配置外置（可选 SITE_CONFIG JSON var，便于多部署/白标） ====================
// 支持字段：siteName、defaultLang、disabledTools[]、disabledEndpoints[]、metricsKey、offline(bool)、certCheck(bool)
let _siteConfigCache = null;
function getSiteConfig() {
  if (_siteConfigCache) return _siteConfigCache;
  const fallback = {
    siteName: 'NetSight Pro', defaultLang: '', disabledTools: [], disabledEndpoints: [],
    metricsKey: '', offline: true, certCheck: true
  };
  try {
    if (typeof SITE_CONFIG === 'undefined' || !SITE_CONFIG) {
      _siteConfigCache = fallback;
      return _siteConfigCache;
    }
    const raw = (typeof SITE_CONFIG === 'string') ? JSON.parse(SITE_CONFIG) : SITE_CONFIG;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      _siteConfigCache = fallback;
      return _siteConfigCache;
    }
    const cfg = Object.assign({}, fallback, raw);
    cfg.siteName = String(cfg.siteName || 'NetSight Pro').slice(0, 40);
    cfg.defaultLang = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es'].includes(cfg.defaultLang) ? cfg.defaultLang : '';
    cfg.disabledTools = Array.isArray(cfg.disabledTools) ? cfg.disabledTools.map(function (x) { return String(x); }).slice(0, 64) : [];
    cfg.disabledEndpoints = Array.isArray(cfg.disabledEndpoints) ? cfg.disabledEndpoints.map(function (x) { return String(x); }).slice(0, 64) : [];
    cfg.metricsKey = String(cfg.metricsKey || '').slice(0, 128);
    cfg.offline = cfg.offline !== false;
    cfg.certCheck = cfg.certCheck !== false;
    _siteConfigCache = cfg;
  } catch (e) {
    _siteConfigCache = fallback;
  }
  return _siteConfigCache;
}

// JSON 嵌入内联脚本时转义 `<` 与行分隔符，避免闭合标签注入
function safeJsonForScript(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isAllowedOrigin(request, origin) {
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    if (origin === requestOrigin) return true;
    const allowed = getConfiguredOrigins();
    return allowed.includes(origin);
  } catch (e) {
    return false;
  }
}

function resolveDefaultLang(acceptLanguage) {
  const al = acceptLanguage || '';
  if (al.match(/zh-(CN|SG|MY)/i)) return 'zh-CN';
  if (al.match(/zh/i)) return 'zh-TW';
  if (al.match(/ja/i)) return 'ja';
  if (al.match(/ko/i)) return 'ko';
  if (al.match(/es/i)) return 'es';
  if (al.match(/en/i)) return 'en';
  return 'en';
}

function corsHeaders(request, methods = 'GET, HEAD, OPTIONS') {
  const origin = request.headers.get('Origin');
  const headers = {
    ...CORS_HEADERS,
    'access-control-allow-methods': methods
  };
  if (origin && isAllowedOrigin(request, origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

// 同源校验升级：Origin/Referer 均可被 curl 等脚本随意伪造，不再作为放行依据。
// 现在要求请求携带主页面颁发的会话令牌（HttpOnly Cookie 或 x-ns-token 头），
// 未访问过页面的爬虫/扫描器一律 403；显式配置的跨域白名单（ALLOWED_ORIGINS）除外。
async function isSameOriginNavigation(request) {
  const origin = request.headers.get('Origin');
  if (origin) {
    const allowed = getConfiguredOrigins();
    if (allowed.includes(origin)) return true;
  }
  return await isValidPageToken(getRequestToken(request));
}

function forbiddenResponse(request) {
  obs.status403 += 1;
  return new Response(JSON.stringify({
    error: 'forbidden',
    message: 'Invalid session token or origin not allowed'
  }), {
    status: 403,
    headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
  });
}

// 简单的限流实现（注意：Map 为 per-isolate 内存，非全局共享；高并发场景如需全局限流应使用 KV 或 Durable Object）
const rateLimit = new Map();
const healthRateLimit = new Map(); // /health 独立配额：RTT/丢包轮询频繁，避免挤占工具请求额度
const HEALTH_RATE_MAX = 180;       // /health 每 IP 每分钟上限（RTT 轮询约 12 次/分，5s 间隔）
const largeDlRateLimit = new Map(); // 大响应下载（缓冲膨胀/长时测速）独立配额，防放大
const LARGE_DL_MAX = 30;            // 每 IP 每分钟大响应次数上限（单次最大 64MB）
const cpuRateLimit = new Map();
// 限流表硬上限 + 低频增量清理：避免大量唯一 IP（IPv6 轮换等）把 per-isolate Map 撑到 128MB 上限
const RATE_LIMIT_MAX_KEYS = 5000;
const RATE_LIMIT_CLEAN_INTERVAL_MS = 30000;
const rateLimitCleanupState = { at: 0 };
// 测速历史写入节流：同一客户端最小落盘间隔（限制 KV 写入）
const SPEED_LOG_MIN_INTERVAL_MS = 15000;
const speedLogThrottle = new Map();
// ===== KV 防爆：测速历史改为固定单键环形缓冲（speed:history） =====
// 旧实现每条记录一个键，且每次写入后 list 全部键并逐个 delete（list/delete 均按量计费），
// 多用户并发或 isolate 轮换时会放大为 O(键数) 的读写/删除费用，极易打爆 KV 配额。
// 现改为单键 JSON 数组：每次落盘 = 1 get + 1 put，全程无 list、无 delete；
// 并发写「后写覆盖先写」对诊断历史可接受。写入受三重限制：按 IP 15s 节流 +
// 单 isolate 全局 30 次/分上限 + 功能默认关闭（SPEED_HISTORY_KV_ENABLED=false）。
const SPEED_HISTORY_MAX = 10;               // 单键最多保留条数
const SPEED_HISTORY_GLOBAL_MAX_PER_MIN = 30; // 单 isolate 每分钟全局写上限（防多 IP 并发写爆）
const speedHistoryGlobalThrottle = { count: 0, resetAt: 0 };
function isSpeedLogGloballyAllowed() {
  const now = Date.now();
  if (now >= speedHistoryGlobalThrottle.resetAt) {
    speedHistoryGlobalThrottle.count = 0;
    speedHistoryGlobalThrottle.resetAt = now + 60000;
  }
  speedHistoryGlobalThrottle.count += 1;
  return speedHistoryGlobalThrottle.count <= SPEED_HISTORY_GLOBAL_MAX_PER_MIN;
}
// DNS 工具箱内存缓存（per-isolate，不占用 KV）
const DNS_LOOKUP_CACHE_MS = 60000;
const dnsLookupCache = new Map();
const DNSBL_CACHE_MS = 300000;
const dnsblCache = new Map();
// PWA 图标（PNG base64 内嵌，占位符由构建脚本注入）
const ICON_192_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAeQSURBVHhe7d3By21THMbxOyYDMiADMiAlGZABKckAEzK4pSQDMrgZSAY3k5uBpMjklhIDMqAMMCADMrkZUIoMyIAMyP9w9KhVr7X32Wf/1l5rn7Xf5zv4TO57ztrnvHc/v3fvvX577TOXXX7FDnB1Jv8HwAkBgDUCAGsEANYIAKwRAFgjALBGAGCNAMAaAYA1AgBrBADWCACsEQBYIwCwRgBgjQDAGgGANQIAawQA1ggArBEAWCMAsEYAYI0AwBoBgDUCAGsEANYIAKwRAFgjALBGAGCNAMAaAYA1AgBrBADWCACsEQBYIwCwRgBgjQDAGgGANQIAawQA1ggArBEAWCMAsEYAYI0AwBoBgDUCAGsEANYIAKwRAFgjALBGAGCNAMAaAYA1AgBrBADWCACsEQBYIwCwRgBgjQDAGgGANQIAawQA1ggArBEAWCMAK7j1ttt3993/wH/yn+G4CEBDd99z7+7zL77c/fX3P//zyquv7a659rrB67E+AtDI2bOP737/48/Bzp989fU3hKADBKCBm26+ZffLr78Ndvrce+9/MHgv1kUAGtCOne/s+9xx512D92M9BKAy7dD5Tj7lwoWXB2NgPQSgskj1l0uXvh2MgfUQgIqi1T/RZdJ8LKyDAFQUrf7J8y+8OBgL6yAAlZRWf/nk088G42EdBKCS0uqfMCdwHASggiXVP3niyacG46I9AlDB0uovTIodBwFYqEb1F7VNXHnV1YPx0RYBWKhG9U8efOjhwfhoiwAsUKv6J6+/8eZgG2iLACxQs/rLjz/9PNgG2iIAhWpX/0T3EOTbQjsEoFDt6p+cP//SYFtohwAUaFX9RTfK5NtDOwSgQKvqn+iGmnybaIMABLWs/sm5c88Ntos2CEBQSfXX5c3836bQHLceAhBQUv11TK8Z3qkb5HN6Lc1x6yAAASXV/5FHHyt6r1aVyLeP+gjATKXVP71f3Z75z6e8/c67g8+A+gjATNEKLqn6iw5p8p9P0bIqNMe1RwBmWFr9E53c5q+bstZSironWWHVJNyxqSHw+htuHHzGVgjADEurf6J7f/PXTdESivkYNWm+4cOPPh5stwf6XGsEgQAcUKv6iypt/top333/w2CMWvRZ5qxed0z6fK1DQAAOqFX9E60DlL9+SquV48YW7e1R6zkRAjChZvVPtBJc/p4pOi7Ox1hKAc2307NWRUAIwITa1V90Ypu/Z4oqdT7GUgppvp2ePf3Ms4PvUAsB2KNF9U+ix941j4NLvtextfgrmBCAPVpU/+TixbcG751SswKWfK9jm/t7LUEARpRUybnVX6LH4LokmI9RInoVqgfqi2rZHk4ARpRUyUiVKmmOqzErrHmFfOzetTz8EQKQaV39k+gEVCRgY3QeEQldD1SIagR/CgHItK7+iY7r83Gm6LwhHyMievn1mHTla62lIlcLgCqQ/pyp8mn5j/xLb1VJ9U+/j3ysKbpylI8xl6po9HeuQpCPcxqtEgA1OEUv/W1FSfVPorOxpc1xusUyH+uQlpNPPWkeAP0it3bsOVdp9U/0FzEfc0rp88TUU5SPNaXWVactaB6AaO/Lliyp/hI94S55nlj0kqss/V5b0jQA0ePcLVla/ZNodY4+Tyza9lDre21F0wCUVJ+tqFUlo9fmI88T0zKL+fsPWevqSy+aBiDa+LUVNatk9HcUaQ+OXtLVlaLW19170zQA0ftgt6JW9RftcNErZHOWTImeX4jjglxNAyDRKtS7FldItAJEvp0pcw5Tootxua5F1DwAOhGOTsL0Ki1ylX/HpbQGUL6tKYcmqUraHlrff9yr5gEQ/YdEJ316o8/fqkJq3MgOe6g5LnpirfFq3nOwJasEINEJn65i5Eth9G6Nh1ZEl0zZ9zwx2h5iVg0A9ou2K+x7nlh0HHFpexhDADqhmz7yHXPKvueJRat/i5P6LSEAHYnO2uaHZiUTjzUv6W4RAeiIzjfyHXSKXn/y/dEA1ZzQ2yoC0JFo68LJHTg6oyxz5hNOOwLQmegxfLphPDrh6Nj2MIYAdCY6g6urPrQ9lCMAndH1/XxnnaL5g+g6Q65tD2MIQGdKlkyJvF5c2x7GEIAORY/nI5zbHsYQgA5FnycW4dz2MIYAdKjlfRTObQ9jCECnos1xc7i3PYwhAJ2KPk9sDve2hzEEoFO1V3Km7WEcAehYzTWVaj5j4DQhAB2rtaAtbQ/7EYCOlTS4jaHtYT8C0Lnokik5Jr6mEYDORft8crQ9TCMAnSu5y+skqv80AtC5aHPcSbQ9HEYANiD6PLGEtofDCMAGRJ8nJpFFdJ0RgA0oec4CbQ/zEICNiCwtSdvDfARgIyIrvtH2MB8B2Ii5a362WsH6tCIAG6J1g6YuiSogXPmJIQAbox187GYZPWSDSa84ArBRum1SzXKSFsdCHAGANQIAawQA1ggArBEAWCMAsEYAYI0AwBoBgDUCAGsEANYIAKwRAFgjALBGAGCNAMAaAYA1AgBrBADWCACsEQBYIwCwRgBgjQDAGgGANQIAawQA1ggArBEAWCMAsEYAYI0AwBoBgDUCAGsEANYIAKwRAFgjALBGAGDtX8o5dgZDZFdgAAAAAElFTkSuQmCC';
const ICON_512_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAABcDSURBVHhe7d29q2VVmsDhiWeYYIYJFAPFQBGKooJuOlAEEQM16aaDAkHEQDFoJhAxkE4Kg6ZpUEwKBNGgmw6qoAI1UAy66aQwUBBmmEAxmGGCGeZ/qOEt3Vi11r23zrnn7L0+3id4Ej/uXedU3bt/a5+93/13f/8P/3gLAMjl78p/AADMTwAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQADOS++x+49eJLL9+6cuXtWx9/8uldrl59/9Yrr75268LFS9X/B1ASADCAp55+5vYB/j//679v/c///t89ffvd97cj4Z/++V+qrwUQBAB07MGHHr712edfVAf4Xf3bv//HrV/+6tfV1wUQANCp2PXHTr48qJ/Htes3bn98UH4PIC8BAB36zW/+tTqIHyquE/CRALAQANCZuMivPHgfS5wJEAFAEADQkUcefexop/1PExcTlt8XyEcAQEfiNH15wF6DCwMBAQCdWONz/9PEnQXl9wdyEQDQgfhcPm7ZKw/Ua/rZz39RrQPIQwBAB7bc/S/++Kc/V+sA8hAA0FiL3f8iLjos1wPkIACgsRa7/0U8O6BcD5CDAICGWu7+Q8wFKNcE5CAAoKGWu/8QDxcyIhhyEgDQSOvd/+Ly5ReqtQHzEwDQSOvd/8JkQMhJAEADvez+Q4weLtcHzE8AQAO97P4X8ejhco3A3AQAbKyn3f/id7//Q7VOYG4CADbW2+4/fPX1N9U6gbkJANhQj7v/xYWLl6r1AvMSALChHnf/i9ffeLNaLzAvAQAb6Xn3HzwiGHIRALCRnnf/iwcferhaNzAnAQAb6H33v3jxpZertQNzEgCwgRF2/+GPf/pztXZgTgIAVjbK7j/Ew4FiveVrAOYjAGBlo+z+F88+93z1GoD5CABY0Ui7/4WHA0EOAgBWNNruP0SwlK8DmI8AgJWMuPtfPP7Ek9XrAeYiAGAlI+7+F2+99dvq9QBzEQCwgpF3/+HmzS+r1wTMRQDACkbe/S8eefSx6nUB8xAAcGSj7/4XETHlawPmIQDgyGbY/YePP/m0em3APAQAHNEsu/8QUwHvu/+B6jUCcxAAcESz7P4XHg4E8xIAcCQz7f4XH3z4UfU6gTkIADiS2Xb/4dvvvvdwIJiUAIAjmHH3v3jq6Weq1wuMTwDAEcy4+1+88+571esFxicA4EAz7/7DV19/U71mYHwCAA408+5/8bOf/6J63cDYBAAcYPbd/8LDgWA+AgAOkGH3Hz77/IvqtQNjEwBwTll2/wsPB4K5CAA4pyy7/8Urr75WvQfAuAQAnEO23X+4dv1G9T4A4xIAcA7Zdv8hHg5kKiDMQwDAnjLu/heXL79QvR/AmAQA7Cnj7n9x9er71fsBjEkAwB4y7/5DPByofE+AMQkA2EPm3f/Cw4FgDgIAdpR997+4cuXt6r0BxiMAYEe97P7javzyn23Jw4FgDgIAdtDT7v/1N968/Vl8+c+3dOHipeo9AsYiAGAHvez+I0IiRj748KPq320pIqR8j4CxCAC4h552/xEisaa4H7/8d1v6+JNPq/cJGIsAgHvobfcfa7rv/geaXwvw4EMPV+8VMA4BAGfocfe/iF14+d9s6cWXXq7eL2AcAgDO0OPuv5e1/fFPf67eL2AcAgBO0fPuPzzy6GPVf7clDweCsQkAOEXrHfbipN3/4i9//Vv132/p2eeer9YEjEEAwAl63/0v3nrrt9V/vyUPB4JxCQA4wQi7//D4E09W/8+WYn3lmoAxCAAojLL7X7Rea0RIuSagfwIACqPs/hfvvPte9f9uKT6GKNcE9E8AwB1G2/2HuBCv/H+3dPPml9WagP4JALjDaLv/EP9d66mAcUtiuS6gbwIAfjTi7n8RQ3nKr7GlfdebUfz9eurpZ1hZ+b5zOgEAPxpx97+Isbzl19mShwPV4uLIeGpjvDetz9BkFO97/Ew7O3U6AQCD7/5DPByo/DpbigNcrKFcV0a//NWvmz+ngbtFiAmBmgCAwXf/i9YHnewPB4oDzGeff1G9L/QhItUdK3cTAKQ3+u5/8fobb1Zfb0uxyyrXlMXPfv6LW199/U31ntCfuF7mvJE9GwFAejPs/sOFi5eqr7mlb7/7/qD1jypuw4zXXr4f9CvO1GT8u1oSAKQ2y+5/Effkl193S9muwo6dvwv8xpT5jNVCAJDaLLv/xZUrb1dfe0u/+/0fqjXNzGf+Y4uPzco/00wEAGnNtvsPsQMvv/aW4nPwck2z6iUeOb84e/PgQw9Xf7ZZCADS6uUX+LF2/4vWn0fHafFyTbOJg4ZT/3PIdtbqTgKAlGbc/S+uXn2/+h5bynCrVRw0ytfNmDLPsBAApDTr7j9cvvxC9X22FJ+Ll2uaid3/fLLOsBAApDPz7j/E62t9gJr5c9U4w1G+XsaW9Y4AAUA6M+/+F9eu36i+35ZeefW1ak0z6CkeOZ5MF6/eSQCQSk+/wNfY/S/iAFx+vy1FgJRrmkEv8chxxRmz8s86AwFAKr38Al9z9x9iLn35PbcUv1DXfH2ttB60xHoyXggoAEgjy+5/0XpITTwVr1zTyOL1lK+Recx83cppBABpZNn9L1pfrBa3I5ZrGtlf/vq36jUyj/LPOwMBQArZdv8hBvKU33tLMZCoXNOoWr+XrMtFgDCxbLv/RetH1M7ycKB4hGz52pjHx598Wv2ZZyAAmF7G3f/inXffq9awpXg4Ubmm0bR+zDLr2/rnshcCgOll3f2H1g8HiqvmyzWNxtjf+cVdM+WfewYCgKll3v2HeP2tHw4UO+hyXaMw9nd+8fFO+eeehQBgapl3/4sYc1quZ0sjP3O99Z0UrC/D0ytPIwCYVvbd/yIedFKuZ0ujXmDV098f1pH1GQALAcC07P5/EBPOWp/GHnHKWi9/f1hHzHVo+XPZAwHAlHravbXc/S9iF16ua0sjPm7V2N95xe+GrBf+3UkAMKVedm+td/+L1u/HaBdaGfs7r5iNMfKFqcckAJiO3X/Nw4H20/o5CqwjzoSN+HHUWgQA02m92130svtftD6l/exzz1dr6pGxv/OJXf/lyy9Uf9bZCQCmYvd/uta3tMVUwnJNPTL2dw5x1in+LOP6k55CvCcCYEePP/Hk7alqcU9z/CKlT63veV/0tvsP8Xe4XOeW4j0p19Sb1h+VLOIjiPLvNruJ39Oht5+/HgmAM8SFQPFI09aT1BhPb7v/ReuzIxEh5Zp60svY38zDadiOADhB1KNnf3NePe7+FxG05Xq3FDu0ck296GXs76iDkxiPALhD/NJu/QuS8fW6+w9xIV653i1FWJdr6kV8vFeut4U481iuDdYgAH4Ut4a49YdD9bz7D7G21rvcHgew9HLxaM+BxHwEwI8//E75cww97/4Xra9y7/E96uXW0Vdefa1aG6xFAHTwC5E59L77X3g4UK2HDcAof3+YR/oA6KX8GV+PO9uTxMVu5dq3FB9B9DSNrZexv6P8/WEeqQMgfhH28Lkf4xtt99b64UA9TWXr4dqfiKL4fVSuDdaUOgB6ueeX8Y22e2t9xXsvz2HvZexv/C4q1wZrSx0ABvxwDKPt/kM8Da18HVuKn70e3rNerv+x+6eFtAEQw37KH0I4j9F2/4t4QEr5WrYUP4PlmrbUy9jf0R6VzDzSBsCVK29XP4iwrxF3/4vWPwOtT3v38hGgsb+0kjYArl2/Uf0gwr5G3f2H1mfB4gxEuaatGPsLiQOgh/t+GdvIu/9F6+tgWu1+W18EuTD2l5bSBoDb/zjUyLv/RetnX7R4OJCxv/CDtAHQ+gIoxjbD7j/E/fjla9tS3INfrmltvQz/MvaX1tIGQOtBKIxtht1/6OHhQFvfAtfDx3+zBCRjSxsAMYik/KGEXcz2y7v1BbFb7oSN/YWfpA2AXi4CYjyz/fKOA3D5GrcUAVKuaS3G/sJP0gZA60lojGm23X9oPRAnDohbvKfG/sLd0gZAuHnzy+qHE84y2+5/0XpnvMXtcMb+wt1SB0Dr56IzlrhzZIudagtxO175ercUtyOWazqm1mc5Fsb+0pPUARB6uCKYMbSeXb+m1qfHYyBRuaZjMvYXaukDoPU4VMaQ4XPb1rMx1gosY3/hZOkDIPQyGIQ+xbUis576v9M7775XvfYtxcOJyjUdQy93/GxxnQPsQwD8qPUvP/oUu+Isp21bnw2L0CrXdChjf+F0AuAOvewU6ENcGZ/piu04WLZ+OFBcrFeu6xC9nN3bctgR7EoAFOI0XQ87BtqKq9IznPYvtZ6QGRFerukQPVzkO+PsCOYgAE4QP6xxW1Tr3RDbiwPg4088Wf2dyKL1rbHHvFDO2F84mwA4Q4RAPC0tdoNiYE7xuXMcdOICtGOffh7Rffc/0PyK+VhDua7zaD3cKBj7S88EwJ7il1NcLMXYHOxP1/pJmXEWolzTvlrPNVhkuH2UcQkA4C6tL5yLj2HKNe3L2F+4NwEA3KX12NxDHw7Uev0LY3/pnQAAKq0flPXsc89Xa9qVsb+wGwEAVFo/HCgGc5Vr2oWxv7A7AQBU4lbI8qC2pZjAWK5pF62vX1gY+8sIBABwotYDsfadx2DsL+xHAAAnivkX5cFtS/ExRLmms8S43fJrtGDsL6MQAMCJ4kK88uC2pX130sb+wn4EAHCiOJC1vqBu14FNxv7C/gQAcKrWA3V2PZ3eenphMPaX0QgA4FQjPBzI2F84HwEAnCp2tOWBbkuxq77Xw4Fan6VY2P0zGgEAnKn16fV4Ime5pkXrQFkY+8uIBABwptffeLM64G0pbkcs17Qw9hfOTwAAZ7pw8VJ1wNvSt999f+Ktdcb+wmEEAHBPMZq3PPBt6amnn6nWZOwvHEYAAPd05crb1YFvS+UV9sb+wuEEAHBPsQMvD35bKh8OZOwvHE4AADuJz+LLA+CW4lqEZS3G/sLhBACwk14eDmTsLxyHAAB2EvfjlwfBLX32+Re319F6LkEw9pcZCABgJz08HKj1EwoX5UWJMCIBAOzs2vUb1cFwS62vQ1jY/TMDAQDsrJer71sy9pdZCABgZ488+lh1QMzG2F9mIQCAvcTFeOVBMQtjf5mJAAD2ErfjlQfGLIz9ZSYCANhLnAIvD4wZGPvLbAQAsLfWDwdqwdhfZiMAgL298+571QFyZsb+MiMBAOyt9cOBtmbsLzMSAMDeYjfcy1CetRn7y6wEAHAuH3z4UXWwnJGxv8xKAADn8uJLL1cHyxnZ/TMrAQCcy333P9D84UBrM/aXmQkA4Nx6eDTvmoz9ZWYCADi3uDq+PGjOwthfZicAgHOb+eFAxv4yOwEAHOTmzS+rg+fojP0lAwEAHGTGhwMZ+0sGAgA4yONPPFkdQEdm7C9ZCADgYHHQLA+kozL2lywEAHCwq1ffrw6kIzL2l0wEAHCwZ597vjqYjsjYXzIRAMDB4jPzGaYC2v2TiQAAjiLG5pYH1JEY+0s2AgA4itEfDmTsL9kIAOAo4vR5eVAdhbG/ZCQAgKMZ9eFAxv6SkQAAjub1N96sDq69M/aXrAQAcDQXLl6qDrC9M/aXrAQAcFRfff1NdZDtlbG/ZCYAgKO6cuXt6kDbK2N/yUwAAEf11NPPVAfaHhn7S3YCADi6b7/7vjrg9sbYX7ITAMDRjfBwILt/shMAwNFdvvxCdcDtibG/IACAFfT+cCBjf0EAACu5dv1GdeDtgbG/8AMBAKwiBuyUB98eGPsLPxAAwCoeefSx6uDbmrG/8BMBAKzms8+/qA7CLRn7Cz8RAMBq3nrrt9VBuBVjf+FuAgBYTVxtXx6IWzH2F+4mAIBV9fBwIGN/oSYAgFW98+571QF5a8b+Qk0AAKvq4eFAdv9QEwDAquLCu5YPBzL2F04mAIDVffDhR9WBeSvG/sLJBACwuhdferk6MG/B2F84nQAAVnff/Q80eTiQsb9wOgEAbCKuxC8P0Gsy9hfOJgCATcSV+FueBbD7h7MJAGAzW50FiIsOy+8N3E0AAJuJswBr3xIYM//d9w/3JgCATcVteWtGQNxxUH5PoCYAgM1FBKxxPYAH/sDuBADQxLPPPX+0CIgzCvH1yu8BnE4AAM3EZ/WHTgm8efPLWxcuXqq+NnA2AQA0Fw8Mivv2y4P7Wa5dv3Hr8uUXqq8F7EYAAN2IEHj9jTdvP8Anrua/84AfgRCjfePxwo88+lj1/wL7EQAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAkJAAAICEBAAAJCQAASEgAAEBCAgAAEhIAAJCQAACAhAQAACQkAAAgIQEAAAkJAABISAAAQEICAAASEgAAkJAAAICEBAAAJCQAACAhAQAACQkAAEhIAABAQgIAABISAACQkAAAgIQEAAAk9P9evaHuMZSyXwAAAABJRU5ErkJggg==';
let _icon192Bytes = null;
let _icon512Bytes = null;

// ==================== 页面会话令牌（防伪造 Origin/Referer 绕过同源校验） ====================
// 优先使用无状态 HMAC 令牌（部署时配置 secret 绑定 PAGE_TOKEN_SECRET 即可跨 isolate 生效），
// 未配置 secret 时退回 per-isolate 内存 Map（LRU 淘汰，不再整表 clear），TTL 1 小时。
// 前端 403 时通过 /api/page-token 静默续期重试，不再整页刷新。
const pageTokens = new Map();
const PAGE_TOKEN_TTL_MS = 3600000;
const PAGE_TOKEN_MAX = 8000;
let _pageTokenSecretCache;
let _pageTokenKeyPromise = null;

function getPageTokenSecret() {
  if (_pageTokenSecretCache === undefined) {
    try {
      _pageTokenSecretCache = (typeof PAGE_TOKEN_SECRET === 'undefined' || !PAGE_TOKEN_SECRET) ? '' : String(PAGE_TOKEN_SECRET);
    } catch (e) {
      _pageTokenSecretCache = '';
    }
  }
  return _pageTokenSecretCache;
}

function getPageTokenKey() {
  if (!getPageTokenSecret()) return Promise.resolve(null);
  if (!_pageTokenKeyPromise) {
    _pageTokenKeyPromise = crypto.subtle
      .importKey('raw', new TextEncoder().encode(getPageTokenSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
      .catch(() => null);
  }
  return _pageTokenKeyPromise;
}

function bytesToB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) return null;
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

function issueMemoryPageToken() {
  const tok = crypto.randomUUID() + '.' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 10);
  pageTokens.set(tok, Date.now() + PAGE_TOKEN_TTL_MS);
  if (pageTokens.size > PAGE_TOKEN_MAX) {
    const now = Date.now();
    for (const [t, exp] of pageTokens) {
      if (now > exp) pageTokens.delete(t);
    }
    // 仍然超限：按插入顺序淘汰最旧令牌，不要整表 clear，否则所有在线会话同时 403
    while (pageTokens.size > PAGE_TOKEN_MAX) {
      const oldest = pageTokens.keys().next().value;
      if (oldest === undefined) break;
      pageTokens.delete(oldest);
    }
  }
  return tok;
}

async function issuePageToken() {
  if (!getPageTokenSecret()) return issueMemoryPageToken();
  const exp = Date.now() + PAGE_TOKEN_TTL_MS;
  const nonce = crypto.randomUUID();
  const payload = 'v1.' + exp + '.' + nonce;
  try {
    const key = await getPageTokenKey();
    if (!key) return issueMemoryPageToken();
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return payload + '.' + bytesToB64Url(new Uint8Array(sig));
  } catch (e) {
    return issueMemoryPageToken();
  }
}

function getRequestToken(request) {
  const header = request.headers.get('x-ns-token');
  if (header) return String(header).slice(0, 200);
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)__ns_t=([^;]+)/);
  return m ? m[1].slice(0, 200) : '';
}

async function isValidPageToken(token) {
  if (!token) return false;
  if (getPageTokenSecret()) {
    const parts = String(token).split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return false;
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const sig = b64UrlToBytes(parts[3]);
    if (!sig || sig.length !== 32) return false;
    try {
      const key = await getPageTokenKey();
      if (!key) return false;
      return await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(parts[0] + '.' + parts[1] + '.' + parts[2]));
    } catch (e) {
      return false;
    }
  }
  const exp = pageTokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    pageTokens.delete(token);
    return false;
  }
  return true;
}

function cleanupRateLimit() {
  const now = Date.now();
  let cleanedCount = 0;
  // 增量清理：单次最多扫描 300 条，避免高基数时单个请求承担全量 O(n) 成本
  for (const store of [rateLimit, healthRateLimit, largeDlRateLimit]) {
    let scanned = 0;
    for (const [ip, timestamps] of store.entries()) {
      if (scanned++ >= 300) break;
      const valid = timestamps.filter(t => now - t < 60000);
      if (valid.length === 0) {
        store.delete(ip);
        cleanedCount++;
      } else {
        store.set(ip, valid);
      }
    }
  }
  // 同步清理 cpuRateLimit 中过期的条目，防止内存泄漏
  for (const [ip, limit] of cpuRateLimit.entries()) {
    if (now > limit.resetTime) {
      cpuRateLimit.delete(ip);
      cleanedCount++;
    }
  }
  return cleanedCount;
}

function evictOldestRateLimitKeys(store) {
  while (store.size > RATE_LIMIT_MAX_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function isRateLimited(ip, maxRequests = 60, windowMs = 60000, store = rateLimit) {
  const now = Date.now();
  const requests = store.get(ip) || [];
  const recent = requests.filter(t => now - t < windowMs);
  
  if (recent.length >= maxRequests) return true;
  
  recent.push(now);
  store.set(ip, recent);
  // 硬上限：到上限按插入顺序淘汰最旧 IP，保证 Map 内存有界
  if (store.size > RATE_LIMIT_MAX_KEYS) evictOldestRateLimitKeys(store);
  // 低频全量清理（30s 一次），替代原先「5% 概率 + 超 1 万后每请求」的随机全量扫描
  if (now - rateLimitCleanupState.at >= RATE_LIMIT_CLEAN_INTERVAL_MS) {
    rateLimitCleanupState.at = now;
    cleanupRateLimit();
  }
  
  return false;
}

function fillRandom(data) {
  const CHUNK = 65536;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const slice = data.subarray(offset, Math.min(offset + CHUNK, data.length));
    crypto.getRandomValues(slice);
  }
  return data;
}

// 大响应流式生成用的随机模板（仅生成一次，之后复制，控制 CPU 与内存）
let _randomTemplate = null;
function getRandomTemplate() {
  if (!_randomTemplate) {
    _randomTemplate = new Uint8Array(262144);
    fillRandom(_randomTemplate);
  }
  return _randomTemplate;
}

const ESC_JS_MAP = { '\\': '\\\\', "'": "\\'", '"': '\\"', '`': '\\`', '${': '\\${', '\n': '\\n', '\r': '\\r', '\t': '\\t', '<': '\\x3c', '>': '\\x3e', '&': '\\x26' };
function escapeForJS(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\\|'|"|`|\$\{|\n|\r|\t|<|>|&/g, (m) => ESC_JS_MAP[m]);
}

const ESC_HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ESC_HTML_MAP[c]);
}

// 站点体检的 SSRF 防护：拒绝内网/本机/非公网主机名
function isIpLiteral(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return h.includes(':');
}

// 将 IPv6 文本解析为 8 组 16 位数值（含 :: 压缩与 IPv4 尾段）；非法返回 null
function parseIPv6ToGroups(input) {
  const h = String(input || '').toLowerCase();
  if (!h.includes(':')) return null;
  let addr = h;
  const m4 = addr.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m4) {
    const p = m4[1].split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const g1 = (((p[0] << 8) | p[1]) >>> 0).toString(16);
    const g2 = (((p[2] << 8) | p[3]) >>> 0).toString(16);
    // 把 IPv4 尾段就地转成两个十六进制分组（保留其前面的冒号），避免 :: 压缩位置错位
    addr = addr.slice(0, m4.index + 1) + g1 + ':' + g2;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (s) => s ? s.split(':').map(g => (/^[0-9a-f]{0,4}$/.test(g) ? parseInt(g || '0', 16) : NaN)) : [];
  const head = parseHalf(halves[0]);
  const tail = halves.length === 2 ? parseHalf(halves[1]) : [];
  if ([...head, ...tail].some(n => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  const used = head.length + tail.length;
  if (used > 8 || (halves.length === 1 && used !== 8)) return null;
  const zeros = 8 - used;
  return head.concat(new Array(zeros).fill(0), tail);
}

function isPrivateIp(ip) {
  const h = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return true;
  if (h.includes(':')) {
    const g = parseIPv6ToGroups(h);
    if (!g) return true; // 无法解析视为不安全（fail-closed）
    if (g.every(x => x === 0)) return true; // ::
    if (g[7] === 1 && g.slice(0, 7).every(x => x === 0)) return true; // ::1
    if ((g[0] & 0xfe00) === 0xfc00) return true; // 唯一本地 fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // 链路本地 fe80::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // 组播 ff00::/8
    if (g[0] === 0x2002) return true; // 6to4 2002::/16
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 文档前缀 2001:db8::/32（非公网）
    if ((g[0] & 0xffc0) === 0xfec0) return true; // 已废弃的 site-local fec0::/10
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 丢弃前缀
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 1 && g[3] === 0) return true; // 64:ff9b:1::/48 本地 NAT64
    if (g[0] === 0x2001 && g[1] === 2 && g[2] === 0) return true; // 2001:2::/48 基准测试
    // IPv4 映射 ::ffff:0:0/96 与 NAT64 64:ff9b::/96：末 32 位还原为 IPv4 再判断
    const isMapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
    const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    const isCompat = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    if (isMapped || isNat64 || isCompat) {
      const v4 = ((g[6] >> 8) & 0xff) + '.' + (g[6] & 0xff) + '.' + ((g[7] >> 8) & 0xff) + '.' + (g[7] & 0xff);
      return isPrivateIp(v4);
    }
    return false;
  }
  const p = h.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = p[0], b = p[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && p[2] === 0) return true;
  if (a === 192 && b === 0 && p[2] === 2) return true;   // TEST-NET-1 192.0.2.0/24
  if (a === 198 && b === 51 && p[2] === 100) return true; // TEST-NET-2 198.51.100.0/24
  if (a === 203 && b === 0 && p[2] === 113) return true;  // TEST-NET-3 203.0.113.0/24
  if (a === 192 && b === 88 && p[2] === 99) return true;  // 6to4 relay 192.88.99.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (isIpLiteral(h)) return isPrivateIp(h);
  return !h.includes('.');
}

// 出站目标端口白名单：只放行 HTTP/HTTPS 常用端口（80/443）。
// URL 解析会自动归一化默认端口（http 的 :80、https 的 :443 会变成空串），因此集合保留空串。
// 目的：不给 Worker 留下用任意端口探测第三方服务（SSRF 端口扫描）的能力。
const ALLOWED_TARGET_PORTS = new Set(['', '80', '443']);
function isAllowedTargetPort(u) {
  try {
    return ALLOWED_TARGET_PORTS.has(String((u && u.port) || ''));
  } catch (e) {
    return false;
  }
}

// 有界内存缓存：按插入顺序淘汰最旧键，避免「满 N 条整表 clear」造成的缓存击穿
function boundedCacheSet(map, key, value, maxEntries) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

// 流式读取响应/请求体并限制最大字节数；超过上限返回空串（不把大响应整体缓冲进内存）
async function readTextCapped(source, maxBytes) {
  if (!source || !source.body) return '';
  const reader = source.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = step.value;
      total += chunk ? chunk.byteLength : 0;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (e) {}
        return '';
      }
      if (chunk) chunks.push(chunk);
    }
  } catch (e) {
    return '';
  }
  try {
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  } catch (e) {
    return '';
  }
}

// DNS 解析缓存（per-isolate，仅用于站点体检的 SSRF 校验；带 TTL，防止域名改解析到内网后仍被永久放行）
const DNS_CHECK_CACHE_MS = 60000;
const dnsCheckCache = new Map();

// 通过 DoH(cloudflare-dns.com) 解析域名，确认所有解析结果均为公网地址；解析不到结果时按不安全处理
async function resolvesToPublicOnly(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIpLiteral(h)) return !isPrivateIp(h);
  const cached = dnsCheckCache.get(h);
  if (cached && Date.now() - cached.at < DNS_CHECK_CACHE_MS) return cached.value;
  const queries = ['A', 'AAAA'].map(async (type) => {
    const ips = [];
    try {
      const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(h) + '&type=' + type, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000)
      });
      if (!r.ok) return ips;
      const j = await r.json();
      for (const ans of (j.Answer || [])) {
        if (ans.type === 1 || ans.type === 28) ips.push(ans.data);
      }
    } catch (e) {}
    return ips;
  });
  const lists = await Promise.all(queries);
  const ips = lists[0].concat(lists[1]);
  const safe = ips.length > 0 && ips.every(ip => !isPrivateIp(ip));
  boundedCacheSet(dnsCheckCache, h, { at: Date.now(), value: safe }, 500);
  return safe;
}

// ==================== 证书到期查询（CT 日志 / crt.sh；可选，仅在 ?cert=1 时产生 1 次出站） ====================
// Workers fetch 不暴露对端证书、浏览器也无法跨域读取证书链，故用 CT 日志间接获取签发与到期时间。
const CERT_CACHE_MS = 1800000; // 30 分钟内存缓存，避免重复查询 crt.sh
const certCache = new Map();

async function fetchCertInfo(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return null;
  const hit = certCache.get(d);
  if (hit && Date.now() - hit.at < CERT_CACHE_MS) return hit.value;
  let info = null;
  try {
    const r = await fetch('https://crt.sh/?q=' + encodeURIComponent(d) + '&output=json&exclude=expired&deduplicate=Y', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      // 流式读取并在超过上限时立即放弃：先 r.text() 再判大小会把巨大响应整体缓冲进内存
      const txt = await readTextCapped(r, 1200000);
      if (!txt) throw new Error('ct response too large');
      const arr = JSON.parse(txt);
      if (Array.isArray(arr) && arr.length) {
        let best = null;
        for (const c of arr) {
          if (!c || !c.not_after) continue;
          const s0 = String(c.not_after).trim();
          const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s0) ? s0 : (s0.replace(' ', 'T') + 'Z');
          const ts = Date.parse(iso);
          if (!Number.isFinite(ts)) continue;
          if (!best || ts > best.ts) best = { ts: ts, issuer: c.issuer_name || '', name: c.common_name || '' };
        }
        if (best) {
          info = {
            notAfter: new Date(best.ts).toISOString(),
            daysLeft: Math.floor((best.ts - Date.now()) / 86400000),
            issuer: String(best.issuer).slice(0, 160),
            commonName: String(best.name).slice(0, 160),
            source: 'crt.sh'
          };
        }
      }
    }
  } catch (e) {
    info = null;
  }
  boundedCacheSet(certCache, d, { at: Date.now(), value: info }, 200);
  return info;
}

// 恒定时间字符串比较：避免管理密钥比较泄漏长度/前缀信息
function timingSafeEqualString(a, b) {
  const sa = String(a === null || a === undefined ? '' : a);
  const sb = String(b === null || b === undefined ? '' : b);
  let diff = sa.length ^ sb.length;
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;
  
  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const nextFn = queue.shift();
      if (nextFn) nextFn();
    }
  };
  
  const run = async (fn, resolve, reject) => {
    activeCount++;
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      next();
    }
  };
  
  const enqueue = (fn, resolve, reject) => {
    queue.push(() => run(fn, resolve, reject));
    if (activeCount < concurrency && queue.length > 0) {
      const nextFn = queue.shift();
      if (nextFn) nextFn();
    }
  };
  
  return (fn) => new Promise((resolve, reject) => {
    enqueue(fn, resolve, reject);
  });
}

addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event).catch(err => {
      obs.errors500 += 1;
      try { console.error('unhandled_request_error', (err && (err.stack || err.message)) || String(err)); } catch (e) {}
      return new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    })
  );
});

// 定时巡检（部署侧需配置 Cron Triggers，例如每 5 分钟：*/5 * * * *）
addEventListener('scheduled', event => {
  event.waitUntil(handleMonitorCheck());
});

// 处理 OPTIONS 预检请求
function handleOptions(request) {
  const headers = {
    ...corsHeaders(request, 'GET, HEAD, POST, OPTIONS'),
    'access-control-max-age': '86400',
    ...SECURITY_HEADERS
  };
  return new Response(null, {
    status: isAllowedOrigin(request, request.headers.get('Origin')) ? 204 : 403,
    headers
  });
}

// ==================== IP 风险评分函数（已停用外部调用，零出站） ====================
// 说明: 原先调用 proxycheck.io 判断 proxy/vpn/tor/hosting，每次页面加载都会产生一次 Worker 出站请求。
//       为「以用户网络为主、尽量不用 Worker 的网络和请求」，改为不再调用任何外部服务（零出站）。
//       代价: /api/ip-fraud 返回 503，前端据此不显示 proxy/vpn/tor 判定；地理位置信息不受影响，
//       仍由 request.cf 提供。如需恢复，还原本函数并配置 PROXYCHECK_KEY 即可。
async function getIpFraudScore(ip) {
  // 外部风险检测已停用（省 Worker 出站请求）
  return null;
}

// 允许计入用量统计的端点白名单（避免任意路径撑爆 KV）
const COUNTED_ENDPOINTS = new Set([
  '/health', '/node-ping', '/speedtest', '/upload-test', '/cpu-test', '/dns-proxy',
  '/api/site-audit', '/ws-test', '/http2-test', '/concurrent-test', '/stream-test',
  '/api/log-speed', '/api/speed-history', '/api/usage-stats', '/api/ip-fraud',
  '/api/dns-lookup', '/api/dnsbl', '/api/domain-check', '/api/monitor', '/api/monitor-run'
]);

// ==================== 端点开关（停用无引用/已废弃端点，缩小攻击面） ====================
// 停用后统一返回 410 Gone，且在限流、用量统计、令牌校验之前短路——不消耗任何 KV/出站/CPU 资源。
// 实现代码全部保留，恢复只需把路径从这里移除（或把前缀从 DISABLED_PATH_PREFIXES 删除）。
const DISABLED_ENDPOINTS = new Set([
  '/dns-proxy',      // 前端从未调用：DNS 探测已由浏览器侧 Image/DoH 实现，此端点可直接下线
  '/api/ip-fraud',   // 外部风险评分已停用（零出站设计），此前恒定 503，现正式下线
  '/api/reach-check' // 边缘侧可达性探测已移除（改为纯浏览器侧 no-cors 探测）
]);
// 前缀停用：遗留的 KV 静态托管（无任何静态文件、前端未引用；如需恢复请移除本项）
const DISABLED_PATH_PREFIXES = ['/static/'];

function isDisabledEndpoint(pathname) {
  if (DISABLED_ENDPOINTS.has(pathname)) return true;
  for (const prefix of DISABLED_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// ==================== KV 用量策略（防止 KV 额度被写爆/读爆）====================
// USAGE_BACKEND:
//   'memory'（默认）：用量统计只保留在 isolate 内存，对 KV 零写入；重启/换 isolate 后归零。
//   'kv'：聚合后落盘到 SPEED_HISTORY（跨 isolate 持久），会消耗 KV 写额度。
const USAGE_BACKEND = 'memory';
const USAGE_FLUSH_MS = 3600000;   // kv 模式下最长 1 小时落盘一次
const USAGE_MAX_PENDING = 2000;   // kv 模式下待写条数达阈值时提前落盘（受最小间隔约束）
const USAGE_FLUSH_MIN_MS = 60000; // kv 模式下两次落盘的最小间隔：即使高流量也最多 1 次写/分，防写爆 KV
const SPEED_HISTORY_KV_ENABLED = false; // 默认关闭：测速历史不写 KV；改回 true 可恢复（仍限 15s/客户端）

// 只读接口内存缓存：降低前端 30s 轮询造成的 KV 读放大
const STATS_CACHE_MS = 60000;
const statsCache = new Map();
function getStatsCache(key) {
  const entry = statsCache.get(key);
  if (entry && Date.now() - entry.at < STATS_CACHE_MS) return entry.value;
  return null;
}
function setStatsCache(key, value) {
  boundedCacheSet(statsCache, key, { at: Date.now(), value }, 100);
}
function invalidateStatsCache() {
  statsCache.clear();
}

// ==================== KV 写入总闸（防写爆） ====================
// 所有对 KV 的写入都必须经 kvPut()：超预算或同键抖动时直接跳过写入并计数。
// 设计取舍：宁可丢少量非关键数据（测速历史、监控心跳），也不让任何异常循环
// （cron 配得过密 / 目标状态抖动风暴 / isolate 反复重建）打爆 KV 写入额度。
// 计数为 per-isolate 内存，与限流 Map 同一取舍；跨 isolate 的精确总量需 Durable Object。
const KV_WRITE_MAX_PER_MIN = 20;            // 单 isolate 每分钟写入上限
const KV_WRITE_MAX_PER_DAY = 600;           // 单 isolate 每日写入上限（免费额度 1000/天，留 40% 余量）
const KV_WRITE_MIN_KEY_INTERVAL_MS = 10000; // 同一 key 的最小写入间隔（防热键抖动写）
const kvWriteStats = { day: '', dayCount: 0, minStart: 0, minCount: 0, blocked: 0, failed: 0 };
const kvKeyLastWrite = new Map();

function kvWriteGateOk(key, skipDebounce) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (kvWriteStats.day !== day) {
    kvWriteStats.day = day;
    kvWriteStats.dayCount = 0;
  }
  if (now - kvWriteStats.minStart >= 60000) {
    kvWriteStats.minStart = now;
    kvWriteStats.minCount = 0;
  }
  const lastKeyAt = kvKeyLastWrite.get(key) || 0;
  const blocked = kvWriteStats.dayCount >= KV_WRITE_MAX_PER_DAY
    || kvWriteStats.minCount >= KV_WRITE_MAX_PER_MIN
    || (!skipDebounce && (now - lastKeyAt) < KV_WRITE_MIN_KEY_INTERVAL_MS);
  if (blocked) {
    kvWriteStats.blocked += 1;
    return false;
  }
  kvWriteStats.dayCount += 1;
  kvWriteStats.minCount += 1;
  kvKeyLastWrite.set(key, now);
  if (kvKeyLastWrite.size > 200) {
    for (const [k, t] of kvKeyLastWrite) {
      if (now - t > KV_WRITE_MIN_KEY_INTERVAL_MS) kvKeyLastWrite.delete(k);
    }
  }
  return true;
}

// 统一写入入口：返回 true=已写入，false=被预算拦截或写入失败（调用方自行决定是否回滚/提示）
async function kvPut(ns, key, value, options, opts) {
  if (!ns) return false;
  const skipDebounce = !!(opts && opts.skipDebounce);
  obs.kv.attempts += 1;
  if (!kvWriteGateOk(key, skipDebounce)) { obs.kv.blocked += 1; return false; }
  try {
    await ns.put(key, value, options);
    obs.kv.success += 1;
    return true;
  } catch (e) {
    obs.kv.failed += 1;
    // KV 写入失败：回滚预算计数并单独记录失败数（避免短暂故障提前耗尽当天预算）
    kvWriteStats.dayCount = Math.max(0, kvWriteStats.dayCount - 1);
    kvWriteStats.minCount = Math.max(0, kvWriteStats.minCount - 1);
    kvWriteStats.failed += 1;
    return false;
  }
}

let liveUsage = { totalRequests: 0, endpoints: {}, lastReset: Date.now() };
// 可观测性计数器（per-isolate）：只做轻量内存累加，/health 与 /metrics 读取
const obs = {
  startedAt: Date.now(),
  status429: 0,
  status403: 0,
  errors500: 0,
  disabledByConfig: 0,
  kv: { attempts: 0, success: 0, blocked: 0, failed: 0 },
  monitor: { lastRunAt: 0, lastDurationMs: 0, lastChanged: false, lastNotified: 0, lastSuppressed: false }
};
let usagePending = { total: 0, endpoints: {} };
let usageLastFlush = 0;
let usageFlushInFlight = false;

function recordUsage(pathname) {
  // 内存统计始终累加，供 /api/usage-stats 在 memory 模式下读取
  liveUsage.totalRequests += 1;
  liveUsage.endpoints[pathname] = (liveUsage.endpoints[pathname] || 0) + 1;

  if (USAGE_BACKEND !== 'kv') return Promise.resolve(); // 默认：不写 KV
  if (typeof SPEED_HISTORY === 'undefined' || !SPEED_HISTORY) return Promise.resolve();

  usagePending.total += 1;
  usagePending.endpoints[pathname] = (usagePending.endpoints[pathname] || 0) + 1;
  const now = Date.now();
  const due = (now - usageLastFlush >= USAGE_FLUSH_MS)
    || (usagePending.total >= USAGE_MAX_PENDING && now - usageLastFlush >= USAGE_FLUSH_MIN_MS);
  if (!due || usageFlushInFlight) return Promise.resolve();
  usageLastFlush = now;
  usageFlushInFlight = true;
  const snapshot = usagePending;
  usagePending = { total: 0, endpoints: {} };
  return (async () => {
    try {
      const raw = await SPEED_HISTORY.get('usage:stats');
      let stats = raw ? JSON.parse(raw) : { totalRequests: 0, endpoints: {}, lastReset: 0 };
      if (!stats.endpoints || typeof stats.endpoints !== 'object') stats.endpoints = {};
      stats.totalRequests = (stats.totalRequests || 0) + snapshot.total;
      for (const [ep, count] of Object.entries(snapshot.endpoints)) {
        const knownKeys = Object.keys(stats.endpoints);
        if (stats.endpoints[ep] !== undefined || knownKeys.length < 50) {
          stats.endpoints[ep] = (stats.endpoints[ep] || 0) + count;
        }
      }
      if (!stats.lastReset) stats.lastReset = Date.now();
      const usageWrote = await kvPut(SPEED_HISTORY, 'usage:stats', JSON.stringify(stats), { expirationTtl: 86400 * 30 });
      if (!usageWrote) throw new Error('kv write blocked'); // 交给下面的 catch：计数回滚 + 退避重试
      invalidateStatsCache();
    } catch (e) {
      // 落盘失败则把计数还回缓冲避免丢失；把 lastFlush 置为当前时间，
      // 按 USAGE_FLUSH_MIN_MS 退避重试——KV 故障期间不再每个请求都触发一次写尝试（防写爆）
      usagePending.total += snapshot.total;
      for (const [ep, count] of Object.entries(snapshot.endpoints)) {
        usagePending.endpoints[ep] = (usagePending.endpoints[ep] || 0) + count;
      }
      usageLastFlush = now;
    } finally {
      usageFlushInFlight = false;
    }
  })();
}

// ==================== 站点监控（Cron 巡检 + Webhook 告警；仅状态变化/心跳到期时写 KV） ====================
// 无状态变化时的「心跳写」间隔：1 小时 → 6 小时（基线写量 720/月 → 120/月）。
// 状态变化（up/down 切换、URL 增删）仍会立即写入，因此不影响告警与 since 语义。
const MONITOR_STATE_REFRESH_MS = 6 * 3600000;
const MONITOR_LOG_MAX = 20;

function monitorKv() {
  return (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) ? SPEED_HISTORY : null;
}

function buildNotifyPayload(format, text, extra) {
  const chatId = (extra && extra.chatId) ? String(extra.chatId) : '';
  if (format === 'dingtalk') return { msgtype: 'text', text: { content: text } };
  if (format === 'feishu') return { msg_type: 'text', content: { text: text } };
  if (format === 'wecom') return { msgtype: 'text', text: { content: text } };
  if (format === 'slack') return { text: text };
  if (format === 'discord') return { content: text };
  if (format === 'telegram') return { chat_id: chatId, text: text, disable_web_page_preview: true };
  return { text: text, source: 'NetSight Pro' };
}

function isPublicHttpUrlAllowed(p) {
  return ['http:', 'https:'].includes(p.protocol) && isAllowedTargetPort(p) && !isPrivateHost(p.hostname);
}

async function postMonitorWebhook(webhook, format, text, extra) {
  // webhook 只允许公网 http(s) 目标：保存时校验 + 发送前再做一次 DNS 解析校验，且不跟随重定向
  try {
    const p = new URL(webhook);
    if (!isPublicHttpUrlAllowed(p)) return false;
    if (!(await resolvesToPublicOnly(p.hostname))) return false;
  } catch (e) {
    return false;
  }
  try {
    // ntfy 走纯文本 body（POST 到 https://ntfy.sh/<topic>）；其它渠道走 JSON payload
    const isNtfy = format === 'ntfy';
    const res = await fetch(webhook, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': isNtfy ? 'text/plain;charset=UTF-8' : 'application/json' },
      body: isNtfy ? String(text) : JSON.stringify(buildNotifyPayload(format, text, extra)),
      signal: AbortSignal.timeout(8000)
    });
    try { if (res.body) await res.body.cancel(); } catch (e) {}
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    return false;
  }
}

// 巡检目标抓取：手动跟随重定向，每一跳都重新做协议/端口/私网/公网解析校验，避免 302 跳内网
async function fetchMonitorTarget(target) {
  let current = target;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'NetSight-Monitor/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { if (res.body) await res.body.cancel(); } catch (e) {}
      if (!loc || hop >= 3) return res;
      let next;
      try { next = new URL(loc, current); } catch (e) { return res; }
      if (!isPublicHttpUrlAllowed(next) || !(await resolvesToPublicOnly(next.hostname))) throw new Error('blocked redirect');
      current = next.href;
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

async function runMonitorChecks(urls) {
  // 目标并发上限 3：串行时 10 个目标最坏可达 ~160s，超过多数客户端/网关超时
  const limit = pLimit(3);
  return await Promise.all(urls.map(target => limit(async () => {
    const started = Date.now();
    let status = 'down', code = null, error = '';
    try {
      const targetUrl = new URL(target);
      if (isPrivateHost(targetUrl.hostname) || !isAllowedTargetPort(targetUrl) || !(await resolvesToPublicOnly(targetUrl.hostname))) throw new Error('blocked target');
      const res = await fetchMonitorTarget(target);
      code = res.status;
      status = code < 400 ? 'up' : 'down';
      try { if (res.body) { const rd = res.body.getReader(); try { await rd.cancel(); } catch (e2) {} } } catch (e3) {}
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 120);
    }
    return { url: target, status: status, code: code, error: error, ms: Date.now() - started };
  })));
}

// 告警静默时段（按配置的固定偏移，默认 +8 北京时间）；quietHours 格式 "23:00-08:00"
function isMonitorQuietHours(config, now) {
  try {
    const q = String((config && config.quietHours) || '');
    const m = q.match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return false;
    const tz = Number.isFinite(Number(config.tzOffset)) ? Number(config.tzOffset) : 8;
    const d = new Date(now + tz * 3600000);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    if (start === end) return false;
    return start < end ? (mins >= start && mins < end) : (mins >= start || mins < end);
  } catch (e) { return false; }
}
function certWarnLevel(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  if (n < 0) return 'expired';
  if (n <= 7) return '7';
  if (n <= 14) return '14';
  return '';
}

async function handleMonitorCheck() {
  const _monStart = Date.now();
  const kv = monitorKv();
  if (!kv) return { skipped: 'kv_missing' };
  let cfg = null, prevState = {}, log = [];
  try { const raw = await kv.get('monitor:config'); if (raw) cfg = JSON.parse(raw); } catch (e) {}
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || !Array.isArray(cfg.urls) || cfg.urls.length === 0) return { skipped: 'no_config' };
  try { const raw = await kv.get('monitor:state'); if (raw) prevState = JSON.parse(raw); } catch (e) {}
  if (!prevState || typeof prevState !== 'object' || Array.isArray(prevState)) prevState = {};
  try { const raw = await kv.get('monitor:log'); if (raw) log = JSON.parse(raw); } catch (e) {}
  if (!Array.isArray(log)) log = [];

  const now = Date.now();
  // 兼容两种配置格式：字符串 URL 或 { url, label } 对象（D6 监控分组/标签）
  const monitorTargets = cfg.urls.slice(0, 10).map(function (x) {
    if (typeof x === 'string') return { url: x, label: '' };
    if (x && typeof x === 'object') return { url: String(x.url || '').trim(), label: String(x.label || '').trim().slice(0, 60) };
    return null;
  }).filter(function (t) { return t && t.url; });
  if (!monitorTargets.length) return { skipped: 'no_config' };
  const targetLabelMap = {};
  monitorTargets.forEach(function (t) { if (t.label) targetLabelMap[t.url] = t.label; });
  const results = await runMonitorChecks(monitorTargets.map(function (t) { return t.url; }));
  const failureThreshold = Math.min(5, Math.max(1, Number(cfg.failureThreshold) || 1));
  const quiet = isMonitorQuietHours(cfg, now);
  const maintenance = Number(cfg.maintenanceUntil) > now;
  const suppressed = quiet || maintenance;

  // 证书到期检查：每个 https 主机最多 6 小时检查一次，最多并行 5 个，失败静默降级
  const certMap = {};
  if (cfg.certCheck !== false) {
    const certTargets = [];
    const seenHost = {};
    for (const r of results) {
      try {
        const u = new URL(r.url);
        if (u.protocol !== 'https:' || seenHost[u.hostname]) continue;
        seenHost[u.hostname] = true;
        const prev = prevState[r.url] || {};
        if (now - (Number(prev.certCheckedAt) || 0) >= 6 * 3600000) certTargets.push({ url: r.url, host: u.hostname });
      } catch (e) {}
    }
    if (certTargets.length) {
      await Promise.all(certTargets.slice(0, 5).map(async function (t) {
        try {
          const cert = await fetchCertInfo(t.host);
          certMap[t.url] = { checkedAt: now, daysLeft: cert ? cert.daysLeft : null };
        } catch (e) {}
      }));
    }
  }

  let changed = false;
  const nextState = {};
  const events = [];
  for (const r of results) {
    const prev = prevState[r.url] || null;
    const failures = r.status === 'down' ? (((prev && Number(prev.failures)) || 0) + 1) : 0;
    const since = (prev && prev.status === r.status) ? prev.since : now;
    const entry = { status: r.status, code: r.code, since: since, lastCheck: now, error: r.error || '', failures: failures };
    if (targetLabelMap[r.url]) entry.label = targetLabelMap[r.url];
    if (certMap[r.url]) {
      entry.certCheckedAt = certMap[r.url].checkedAt;
      entry.certDays = certMap[r.url].daysLeft;
    } else if (prev && prev.certCheckedAt) {
      entry.certCheckedAt = prev.certCheckedAt;
      if (prev.certDays !== undefined && prev.certDays !== null) entry.certDays = prev.certDays;
    }
    const isRecovery = prev && prev.status === 'down' && r.status === 'up';
    const wasDownNotified = prev && prev.notifiedDown === true;
    if (!prev || prev.status !== r.status) {
      changed = true;
      if (isRecovery && wasDownNotified) {
        const downFor = prev.since ? Math.max(1, Math.round((now - prev.since) / 1000)) : 0;
        events.push({ t: now, url: r.url, status: 'up', text: '[NetSight] 恢复: ' + r.url + ' 已恢复正常 (' + r.ms + 'ms)' + (downFor ? '，故障持续 ' + downFor + 's' : '') });
        entry.notifiedDown = false;
      } else if (r.status === 'down' && failures >= failureThreshold && !wasDownNotified) {
        const text = '[NetSight] 异常: ' + r.url + ' ' + (r.code ? ('HTTP ' + r.code) : (r.error || '连接失败')) + ' · ' + r.ms + 'ms' + (failures > 1 ? ' · 连续失败 ' + failures + ' 次' : '');
        events.push({ t: now, url: r.url, status: 'down', text: text });
        entry.notifiedDown = true;
      } else if (r.status === 'down') {
        entry.notifiedDown = false;
      }
    } else if (r.status === 'down' && !wasDownNotified && failures >= failureThreshold) {
      // 状态未变，但此前因未达阈值未通知：达到阈值时补发一次
      changed = true;
      const text = '[NetSight] 异常: ' + r.url + ' ' + (r.code ? ('HTTP ' + r.code) : (r.error || '连接失败')) + ' · 连续失败 ' + failures + ' 次';
      events.push({ t: now, url: r.url, status: 'down', text: text });
      entry.notifiedDown = true;
    } else if (r.status === 'up') {
      entry.notifiedDown = false;
    }
    // 证书到期事件：仅在等级变化时告警一次（14 天 / 7 天 / 已过期）
    if (entry.certDays !== undefined && Number.isFinite(Number(entry.certDays))) {
      const level = certWarnLevel(Number(entry.certDays));
      const prevLevel = (prev && prev.certWarn) ? prev.certWarn : '';
      if (level && level !== prevLevel) {
        changed = true;
        events.push({
          t: now,
          url: r.url,
          status: r.status,
          text: (level === 'expired' ? '[NetSight] 证书已过期: ' : '[NetSight] 证书即将到期: ') + r.url + ' · 剩余 ' + entry.certDays + ' 天'
        });
        entry.certWarn = level;
      } else {
        entry.certWarn = prevLevel;
      }
    } else if (prev && prev.certWarn) {
      entry.certWarn = prev.certWarn;
    }
    nextState[r.url] = entry;
  }
  const currentMonSet = new Set(results.map(x => x.url));
  for (const k of Object.keys(prevState)) {
    if (k !== '__meta' && !currentMonSet.has(k)) changed = true;
  }
  const lastWrite = (prevState.__meta && prevState.__meta.writtenAt) ? prevState.__meta.writtenAt : 0;
  let stateWritten = true;
  if (changed || (now - lastWrite) > MONITOR_STATE_REFRESH_MS) {
    nextState.__meta = { writtenAt: now };
    // 先把状态落盘：写失败时本轮不发告警，避免下一轮因旧状态再次判定「变化」而重复告警
    stateWritten = await kvPut(kv, 'monitor:state', JSON.stringify(nextState), undefined, { skipDebounce: true });
  }
  let notified = 0;
  if (events.length) {
    if (stateWritten && !suppressed) {
      for (const ev of events) {
        if (cfg.webhook && await postMonitorWebhook(cfg.webhook, cfg.format || 'generic', ev.text, { chatId: cfg.chatId })) notified++;
      }
    }
    const logEvents = suppressed ? events.map(function (ev) { return Object.assign({}, ev, { suppressed: true }); }) : events;
    await kvPut(kv, 'monitor:log', JSON.stringify(logEvents.concat(log).slice(0, MONITOR_LOG_MAX)), undefined, { skipDebounce: true });
  }
  obs.monitor = {
    lastRunAt: now,
    lastDurationMs: Date.now() - _monStart,
    lastChanged: changed,
    lastNotified: notified,
    lastSuppressed: suppressed
  };
  return { results: results, changed: changed, notified: notified, stateWritten: stateWritten, suppressed: suppressed, quiet: quiet, maintenance: maintenance };
}

// ==================== 前端静态资源（外置 /app.css 与 /app.js，可长缓存） ====================
// 资源版本由内嵌 CSS/JS 内容哈希自动生成：改前端即自动换 URL，避免忘记 bump 版本导致长期返回旧缓存
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
const UNLIMITED_PATHS = new Set(['/app.js', '/app.css', '/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']);

// ==================== DoH wireformat（RFC 8484）查询实现 ====================
// 用途：让 DNS 多解析器对比支持任意 DoH 服务（Cloudflare/Google/Quad9/AdGuard/DNS.SB/AliDNS…），
// 不再依赖各服务的 JSON API。实现一个最小 DNS 消息编解码器（查询 + 常见记录类型答案解析）。

const DNS_WIRE_TYPES = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, DS: 43, DNSKEY: 48, CAA: 257
};

function dnsEncodeName(name) {
  const labels = String(name || '').replace(/\.$/, '').split('.').filter(Boolean);
  const out = [];
  for (const label of labels) {
    const bytes = new TextEncoder().encode(label);
    if (bytes.length === 0 || bytes.length > 63) throw new Error('invalid dns label');
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  if (out.length > 255) throw new Error('dns name too long');
  return out;
}

function dnsBuildQuery(name, type) {
  const qtype = typeof type === 'number' ? type : (DNS_WIRE_TYPES[String(type || 'A').toUpperCase()] || 1);
  const header = [0, 0, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]; // ID=0, RD=1, QDCOUNT=1
  const qname = dnsEncodeName(name);
  const tail = [(qtype >> 8) & 0xff, qtype & 0xff, 0, 1]; // QTYPE + QCLASS IN
  return Uint8Array.from([...header, ...qname, ...tail]);
}

function dnsBytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function dnsReadName(buf, offset) {
  const labels = [];
  let off = offset;
  let after = offset;
  let jumped = false;
  let guard = 0;
  while (guard++ < 128) {
    if (off >= buf.length) throw new Error('dns name out of range');
    const len = buf[off];
    if (len === 0) {
      off += 1;
      if (!jumped) after = off;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (off + 1 >= buf.length) throw new Error('dns pointer out of range');
      const ptr = ((len & 0x3f) << 8) | buf[off + 1];
      if (!jumped) after = off + 2;
      jumped = true;
      off = ptr;
      continue;
    }
    if (off + 1 + len > buf.length) throw new Error('dns label out of range');
    labels.push(new TextDecoder().decode(buf.subarray(off + 1, off + 1 + len)));
    off += 1 + len;
    if (!jumped) after = off;
  }
  return { name: labels.join('.'), after };
}

function dnsFormatRdata(buf, type, start, length) {
  try {
    if (type === 1 && length === 4) {
      return [buf[start], buf[start + 1], buf[start + 2], buf[start + 3]].join('.');
    }
    if (type === 28 && length === 16) {
      const groups = [];
      for (let i = 0; i < 16; i += 2) groups.push(((buf[start + i] << 8) | buf[start + i + 1]).toString(16));
      return groups.join(':');
    }
    if (type === 2 || type === 5 || type === 12) {
      return dnsReadName(buf, start).name;
    }
    if (type === 15 && length >= 3) {
      const pref = (buf[start] << 8) | buf[start + 1];
      return pref + ' ' + dnsReadName(buf, start + 2).name;
    }
    if (type === 16) {
      const parts = [];
      let off = start;
      const end = start + length;
      while (off < end) {
        const len = buf[off];
        off += 1;
        if (len === 0 || off + len > end) break;
        parts.push(new TextDecoder().decode(buf.subarray(off, off + len)));
        off += len;
      }
      return parts.join('');
    }
    if (type === 6) {
      const mname = dnsReadName(buf, start);
      const rname = dnsReadName(buf, mname.after);
      return mname.name + ' ' + rname.name;
    }
    if (type === 43 && length >= 4) {
      const keytag = (buf[start] << 8) | buf[start + 1];
      const algo = buf[start + 2];
      const dtype = buf[start + 3];
      const digest = [];
      for (let i = start + 4; i < start + length; i++) digest.push(buf[i].toString(16).padStart(2, '0'));
      return keytag + ' ' + algo + ' ' + dtype + ' ' + digest.join('');
    }
    if (type === 48 && length >= 4) {
      const flags = (buf[start] << 8) | buf[start + 1];
      const proto = buf[start + 2];
      const algo = buf[start + 3];
      let bin = '';
      for (let i = start + 4; i < start + length; i++) bin += String.fromCharCode(buf[i]);
      return flags + ' ' + proto + ' ' + algo + ' ' + btoa(bin);
    }
    if (type === 257 && length >= 2) {
      const flags = buf[start];
      const tagLen = buf[start + 1];
      if (start + 2 + tagLen > start + length) return '';
      const tag = new TextDecoder().decode(buf.subarray(start + 2, start + 2 + tagLen));
      const value = new TextDecoder().decode(buf.subarray(start + 2 + tagLen, start + length));
      return flags + ' ' + tag + ' "' + value + '"';
    }
    const hex = [];
    for (let i = start; i < start + length && i < buf.length; i++) hex.push(buf[i].toString(16).padStart(2, '0'));
    return hex.join('');
  } catch (e) {
    return '';
  }
}

function dnsParseResponse(buf) {
  if (!buf || buf.length < 12) throw new Error('dns response too short');
  const flags = (buf[2] << 8) | buf[3];
  const qdcount = (buf[4] << 8) | buf[5];
  const ancount = (buf[6] << 8) | buf[7];
  let off = 12;
  for (let i = 0; i < qdcount; i++) {
    const q = dnsReadName(buf, off);
    off = q.after + 4;
  }
  const answers = [];
  for (let i = 0; i < ancount && off + 10 <= buf.length; i++) {
    const n = dnsReadName(buf, off);
    off = n.after;
    const type = (buf[off] << 8) | buf[off + 1];
    const ttl = ((buf[off + 4] << 24) | (buf[off + 5] << 16) | (buf[off + 6] << 8) | buf[off + 7]) >>> 0;
    const rdlen = (buf[off + 8] << 8) | buf[off + 9];
    const rdataStart = off + 10;
    if (rdataStart + rdlen > buf.length) break;
    answers.push({
      name: n.name,
      type: type,
      ttl: ttl,
      data: String(dnsFormatRdata(buf, type, rdataStart, rdlen)).slice(0, 400)
    });
    off = rdataStart + rdlen;
  }
  return { status: flags & 0x0f, ad: !!(flags & 0x0020), answers: answers };
}

// RFC 8484 GET 查询：?dns=<base64url(query)>
async function dohWireQuery(resolverUrl, name, type, timeoutMs) {
  try {
    const query = dnsBuildQuery(name, type);
    const target = resolverUrl + (resolverUrl.indexOf('?') === -1 ? '?' : '&') + 'dns=' + dnsBytesToBase64Url(query);
    const res = await fetch(target, {
      headers: { accept: 'application/dns-message' },
      signal: AbortSignal.timeout(timeoutMs || 5000)
    });
    if (!res.ok) return { error: 'http_' + res.status, status: -1, ad: false, answers: [] };
    const buf = new Uint8Array(await res.arrayBuffer());
    const parsed = dnsParseResponse(buf);
    return { status: parsed.status, ad: parsed.ad, answers: parsed.answers };
  } catch (e) {
    return { error: 'unreachable', status: -1, ad: false, answers: [] };
  }
}

const APP_CSS = `
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --bg-primary: #0a0b0d;
            --bg-orb-1: rgba(255, 255, 255, 0.02);
            --bg-orb-2: rgba(255, 255, 255, 0.015);
            --bg-orb-3: rgba(255, 255, 255, 0.012);
            --bg-orb-4: rgba(255, 255, 255, 0.01);

            --glass-bg: #101114;
            --glass-bg-hover: #17181c;
            --glass-heavy: #121316;
            --glass-border: #24262b;
            --glass-border-hover: #383b42;
            --glass-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.03);
            --glass-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
            --glass-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5);
            --glass-blur: none;

            --text-primary: #e9eaec;
            --text-secondary: #9a9da3;
            --text-tertiary: #8b8e96;      /* 对比度 >= 5.4:1 (WCAG AA) */
            --text-quaternary: #7f838b;    /* 对比度 >= 4.6:1 (WCAG AA) */

            --accent: #9aa0a8;
            --accent-hover: #c6cad0;
            --accent-light: rgba(255, 255, 255, 0.06);
            --accent-glass: rgba(255, 255, 255, 0.04);
            --accent-glow: none;

            --success: #a7b6a9;
            --success-light: rgba(255, 255, 255, 0.05);
            --warning: #c8b07a;
            --warning-light: rgba(200, 176, 122, 0.10);
            --danger: #c98a8a;
            --danger-light: rgba(201, 138, 138, 0.10);

            --border: #24262b;
            --border-accent: rgba(255, 255, 255, 0.16);
            --divider: #1d1f24;

            --radius-sm: 3px;
            --radius-md: 4px;
            --radius-lg: 6px;
            --radius-xl: 8px;

            --transition-fast: 0.15s ease;
            --transition-smooth: 0.25s ease;

            --chart-cyan: #c3c7cd;
            --chart-green: #a7b6a9;
            --chart-teal: #b0b4ba;

            --grid-line: rgba(255, 255, 255, 0.03);

            --font: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
            --font-mono: 'SF Mono', 'JetBrains Mono', ui-monospace, monospace;
        }

        [data-theme="light"] {
            --bg-primary: #f4f5f6;
            --bg-orb-1: rgba(0, 0, 0, 0.02);
            --bg-orb-2: rgba(0, 0, 0, 0.015);
            --bg-orb-3: rgba(0, 0, 0, 0.012);
            --bg-orb-4: rgba(0, 0, 0, 0.01);

            --glass-bg: #ffffff;
            --glass-bg-hover: #f2f3f4;
            --glass-heavy: #ffffff;
            --glass-border: #dcdde0;
            --glass-border-hover: #c3c5c9;
            --glass-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
            --glass-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
            --glass-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.08);
            --glass-blur: none;

            --text-primary: #17181a;
            --text-secondary: #5b5e64;
            --text-tertiary: #66696f;      /* 对比度 >= 4.9:1 (WCAG AA) */
            --text-quaternary: #6b6e75;    /* 对比度 >= 4.6:1 (WCAG AA) */

            --accent: #2a2c30;
            --accent-hover: #45484d;
            --accent-light: rgba(0, 0, 0, 0.05);
            --accent-glass: rgba(0, 0, 0, 0.03);
            --accent-glow: none;

            --success: #5f7265;
            --success-light: rgba(0, 0, 0, 0.04);
            --warning: #8a7538;
            --warning-light: rgba(138, 117, 56, 0.10);
            --danger: #9c6060;
            --danger-light: rgba(156, 96, 96, 0.10);

            --border: #dcdde0;
            --border-accent: rgba(0, 0, 0, 0.18);
            --divider: #e7e8ea;

            --chart-cyan: #4a4d52;
            --chart-green: #5f7265;
            --chart-teal: #55585d;

            --grid-line: rgba(0, 0, 0, 0.035);
        }

        html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }

        body {
            font-family: var(--font);
            background: var(--bg-primary);
            min-height: 100vh;
            padding: 32px 24px;
            color: var(--text-primary);
            position: relative;
            overflow-x: hidden;
            transition: background 0.5s ease, color 0.4s ease;
        }

        /* Aurora background */
        body::before {
            content: '';
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background:
                linear-gradient(180deg, transparent 0%, var(--bg-orb-1) 20%, transparent 40%),
                linear-gradient(160deg, transparent 30%, var(--bg-orb-3) 50%, transparent 70%),
                linear-gradient(200deg, transparent 50%, var(--bg-orb-2) 70%, transparent 90%);
            animation: auroraShift 12s ease-in-out infinite alternate;
            pointer-events: none; z-index: 0;
            filter: blur(60px);
        }
        body::after {
            content: '';
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background:
                linear-gradient(170deg, transparent 10%, var(--bg-orb-4) 35%, transparent 55%),
                linear-gradient(190deg, transparent 40%, var(--bg-orb-1) 60%, transparent 80%);
            animation: auroraShift2 16s ease-in-out infinite alternate;
            pointer-events: none; z-index: 0;
            filter: blur(80px);
            opacity: 0.7;
        }
        @keyframes auroraShift {
            0% { transform: translateY(-5%) skewX(-2deg) scaleY(1); opacity: 0.8; }
            50% { transform: translateY(3%) skewX(1deg) scaleY(1.1); opacity: 1; }
            100% { transform: translateY(-2%) skewX(-1deg) scaleY(0.95); opacity: 0.7; }
        }
        @keyframes auroraShift2 {
            0% { transform: translateY(4%) skewX(2deg); opacity: 0.6; }
            50% { transform: translateY(-3%) skewX(-1deg); opacity: 0.9; }
            100% { transform: translateY(2%) skewX(1deg); opacity: 0.5; }
        }

        .bg-orbs { display: none; }

        .container { max-width: 1000px; margin: 0 auto; position: relative; z-index: 1; }

        .header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 20px 28px; margin-bottom: 28px; flex-wrap: wrap; gap: 16px;
            background: var(--glass-heavy);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border-radius: var(--radius-xl);
            border: 1px solid var(--glass-border);
            box-shadow: var(--glass-shadow), var(--glass-highlight);
            transition: all var(--transition-smooth);
        }
        .header:hover { border-color: var(--glass-border-hover); }

        .logo { display: flex; align-items: center; gap: 14px; }
        .logo-icon {
            width: 44px; height: 44px;
            background: linear-gradient(135deg, var(--accent), #a855f7);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; color: #fff;
            box-shadow: 0 4px 16px rgba(129, 140, 248, 0.3);
        }
        .logo h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
        .logo p { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

        .header-right { display: flex; align-items: center; gap: 12px; }
        .theme-toggle {
            background: var(--glass-bg); border: 1px solid var(--glass-border);
            border-radius: 50px; padding: 8px 14px; cursor: pointer;
            font-size: 15px; color: var(--text-secondary);
            transition: all var(--transition-fast);
            display: flex; align-items: center;
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        }
        .theme-toggle:hover {
            background: var(--glass-bg-hover); color: var(--text-primary);
            border-color: var(--glass-border-hover);
            box-shadow: var(--accent-glow);
        }

        .lang-switcher {
            display: flex; gap: 2px; flex-wrap: wrap; background: var(--glass-bg); padding: 4px;
            border-radius: 10px; border: 1px solid var(--glass-border);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        }
        .lang-btn {
            background: transparent; border: none; color: var(--text-tertiary);
            padding: 6px 14px; border-radius: 7px; cursor: pointer;
            font-size: 12px; font-weight: 500; font-family: var(--font);
            transition: all var(--transition-fast);
        }
        .lang-btn.active {
            background: var(--accent-light); color: var(--accent);
            font-weight: 600; box-shadow: var(--accent-glow);
        }
        .lang-btn:hover:not(.active) { color: var(--text-primary); background: var(--glass-bg-hover); }

        .hero-card {
            background: var(--glass-heavy);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border-radius: var(--radius-xl); padding: 32px;
            margin-bottom: 28px;
            border: 1px solid var(--glass-border);
            box-shadow: var(--glass-shadow-lg), var(--glass-highlight);
            transition: all var(--transition-smooth);
        }
        .hero-card:hover { border-color: var(--glass-border-hover); }

        .ip-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 16px; margin-bottom: 14px; }
        .ip-label {
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 1.5px; color: var(--accent); min-width: 50px;
        }
        .ip-val {
            font-size: 26px; font-weight: 700; font-family: var(--font-mono);
            color: var(--text-primary); word-break: break-all; letter-spacing: -0.5px;
        }
        .ip-val-small { font-size: 16px; color: var(--text-secondary); }

        .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 10px; margin-top: 22px; }
        .stat-item {
            display: flex; align-items: center; gap: 8px; font-size: 12px;
            padding: 7px 16px; background: var(--glass-bg); border-radius: 50px;
            border: 1px solid var(--glass-border); color: var(--text-secondary);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            transition: all var(--transition-fast);
        }
        .stat-item:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
        .stat-item strong { color: var(--text-primary); font-weight: 600; }
        .stat-item i { color: var(--accent); font-size: 12px; }
        .live-dot {
            display: inline-block; width: 7px; height: 7px; border-radius: 50%;
            background: var(--success); animation: pulse 2s ease-in-out infinite; margin-right: 4px;
        }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.3)} }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 28px; }
        .grid-2col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 28px; }
        .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 32px; }
        .info-section-label {
            font-size: 10px; text-transform: uppercase; letter-spacing: 1.1px;
            color: var(--text-quaternary); margin: 2px 0 8px;
        }
        .info-grid + .info-section-label { margin-top: 20px; }

        .card {
            background: var(--glass-bg);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border-radius: var(--radius-lg);
            border: 1px solid var(--glass-border);
            overflow: hidden;
            transition: all var(--transition-smooth);
            box-shadow: var(--glass-shadow), var(--glass-highlight);
        }
        .card:hover {
            border-color: var(--glass-border-hover);
            box-shadow: var(--glass-shadow-lg), var(--glass-highlight);
            transform: translateY(-2px);
        }

        .rtt-card {
            grid-column: 1 / -1; min-height: 520px;
            display: flex; flex-direction: column;
            background: var(--glass-heavy);
        }
        .rtt-card .card-body { flex: 1; display: flex; flex-direction: column; padding: 24px 28px; }

        .card-header {
            padding: 20px 24px; border-bottom: 1px solid var(--divider);
            display: flex; align-items: center; gap: 14px;
        }
        .card-header i { font-size: 20px; color: var(--accent); opacity: 0.9; }
        .card-header h3 { font-size: 15px; font-weight: 600; letter-spacing: -0.2px; }
        .card-header p { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .card-body { padding: 20px 24px; }

        .info-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 11px 0; border-bottom: 1px solid var(--divider);
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 10px; }
        .info-label i { font-size: 14px; width: 18px; color: var(--accent); opacity: 0.7; }
        .info-value { font-size: 13px; font-weight: 500; font-family: var(--font-mono); color: var(--text-primary); }

        .badge {
            padding: 4px 12px; border-radius: 50px; font-size: 11px; font-weight: 600;
            display: inline-flex; align-items: center; gap: 5px;
        }
        .badge-success { background: var(--success-light); color: var(--success); border: 1px solid rgba(52, 211, 153, 0.15); }
        .badge-warning { background: var(--warning-light); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.15); }
        .badge-danger { background: var(--danger-light); color: var(--danger); border: 1px solid rgba(248, 113, 113, 0.15); }
        .badge-info { background: var(--accent-light); color: var(--accent); border: 1px solid rgba(129, 140, 248, 0.15); }
        .badge-purple { background: rgba(168, 85, 247, 0.08); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.15); }

        .rtt-display { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
        .rtt-box {
            background: var(--glass-bg); border-radius: var(--radius-md); padding: 22px 14px;
            text-align: center; border: 1px solid var(--glass-border);
            transition: all var(--transition-smooth);
        }
        .rtt-box:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); transform: translateY(-2px); }
        .rtt-value { font-size: 42px; font-weight: 700; color: var(--text-primary); line-height: 1.1; letter-spacing: -2px; font-family: var(--font-mono); }
        .rtt-label { font-size: 11px; color: var(--text-secondary); margin-top: 10px; letter-spacing: 0.3px; }
        .rtt-label i { margin-right: 4px; color: var(--accent); opacity: 0.6; }

        .chart-container {
            background: var(--glass-bg); border-radius: var(--radius-md); padding: 20px;
            margin: 16px 0; border: 1px solid var(--glass-border);
        }
        canvas { width: 100%; height: 180px; }

        .quality-grid {
            display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
            margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--divider);
        }
        .quality-card {
            background: var(--glass-bg); border-radius: var(--radius-sm); padding: 12px 14px;
            display: flex; align-items: center; justify-content: space-between;
            transition: all var(--transition-fast); border: 1px solid transparent;
        }
        .quality-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border); }
        .quality-label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 7px; }
        .quality-label i { font-size: 12px; color: var(--accent); opacity: 0.6; }
        .quality-value { font-size: 13px; font-weight: 600; }

        .button-group { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .btn {
            padding: 10px 20px; border-radius: 50px; font-size: 13px; font-weight: 500;
            border: 1px solid var(--glass-border); cursor: pointer;
            transition: all var(--transition-fast);
            display: inline-flex; align-items: center; gap: 8px;
            font-family: var(--font); letter-spacing: -0.1px;
            background: var(--glass-bg); color: var(--text-primary);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        }
        .btn i { transition: transform 0.2s ease; }
        .btn:hover i { transform: scale(1.1); }
        .btn:active { transform: scale(0.96); }
        .btn:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); transform: translateY(-1px); }

        .btn-primary {
            background: var(--accent); color: #fff; border-color: transparent;
            box-shadow: 0 4px 16px rgba(129, 140, 248, 0.25);
        }
        .btn-primary:hover { background: var(--accent-hover); box-shadow: 0 6px 24px rgba(129, 140, 248, 0.35); }

        .btn-outline { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); }
        .btn-outline:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }

        /* ==================== 按钮三级（主 / 次 / 幽灵）+ 尺寸 ==================== */
        /* 主：.btn.btn-primary（实心）  次：.btn / .btn-outline（描边）  幽灵：.btn.btn-ghost（无边框文字） */
        .btn-ghost {
            background: transparent; border-color: transparent; color: var(--text-secondary);
            box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none;
        }
        .btn-ghost:hover { background: var(--glass-bg-hover); border-color: var(--glass-border); color: var(--text-primary); }
        .btn-block { width: 100%; justify-content: center; }
        .btn-sm { height: 32px; padding: 0 13px; font-size: 12px; }
        .btn-xs { height: 28px; padding: 0 10px; font-size: 11px; border-radius: 50px; }
        .btn-icon { width: 30px; height: 30px; padding: 0; justify-content: center; border-radius: var(--radius-sm); }
        .btn[disabled], .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        .btn[disabled]:hover { background: var(--glass-bg); border-color: var(--glass-border); transform: none; }

        .btn-cyan {
            background: linear-gradient(135deg, rgba(34, 211, 238, 0.15), rgba(99, 102, 241, 0.15));
            border: 1px solid rgba(34, 211, 238, 0.2); color: var(--chart-cyan);
        }
        .btn-cyan:hover { background: linear-gradient(135deg, rgba(34, 211, 238, 0.25), rgba(99, 102, 241, 0.25)); box-shadow: 0 4px 16px rgba(34, 211, 238, 0.15); }

        .btn-purple {
            background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(99, 102, 241, 0.15));
            border: 1px solid rgba(168, 85, 247, 0.2); color: #c084fc;
        }
        .btn-purple:hover { background: linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(99, 102, 241, 0.25)); box-shadow: 0 4px 16px rgba(168, 85, 247, 0.15); }

        .result-area {
            margin-top: 14px; padding: 16px 20px; background: var(--glass-bg);
            border-radius: var(--radius-sm); font-size: 12px;
            border-left: 3px solid var(--accent); color: var(--text-secondary);
            border-top: 1px solid var(--glass-border);
            border-right: 1px solid var(--glass-border);
            border-bottom: 1px solid var(--glass-border);
            transition: all var(--transition-fast);
        }
        .speed-result { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
        .speed-item {
            background: var(--accent-glass); border-radius: 10px; padding: 8px 14px;
            font-size: 12px; border: 1px solid var(--border-accent); color: var(--text-primary);
        }

        .hw-strip {
            display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
            background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
            border: 1px solid var(--glass-border); border-radius: var(--radius-lg);
            padding: 14px 24px; margin-bottom: 28px;
            box-shadow: var(--glass-shadow), var(--glass-highlight);
            transition: all var(--transition-smooth);
        }
        .hw-strip:hover { border-color: var(--glass-border-hover); }
        .hw-strip-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .hw-strip-label i { color: var(--accent); opacity: 0.8; }
        .hw-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .hw-chip {
            background: var(--glass-bg); border-radius: 50px; padding: 7px 14px;
            font-size: 12px; display: inline-flex; align-items: center; gap: 7px;
            border: 1px solid var(--glass-border); color: var(--text-secondary);
            transition: all var(--transition-fast);
        }
        .hw-chip:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
        .hw-chip i { color: var(--accent); opacity: 0.7; font-size: 11px; }

        .footer {
            margin-top: 28px; padding: 18px 28px; text-align: center; font-size: 12px;
            color: var(--text-tertiary); display: flex; justify-content: space-between;
            flex-wrap: wrap; gap: 14px;
            background: var(--glass-heavy);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border-radius: var(--radius-lg); border: 1px solid var(--glass-border);
            box-shadow: var(--glass-shadow), var(--glass-highlight);
        }
        .copy-btn {
            background: transparent; padding: 7px 14px; border-radius: 50px;
            font-size: 12px; cursor: pointer; transition: all var(--transition-fast);
            border: 1px solid var(--glass-border); color: var(--text-secondary); font-weight: 500;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .copy-btn:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); color: var(--text-primary); }

        .driver-badge {
            width: 100%; text-align: center; padding: 12px 20px; margin-top: 16px;
            background: var(--glass-bg); border-radius: 50px; border: 1px solid var(--glass-border);
            font-size: 11px; color: var(--text-quaternary); letter-spacing: 0.2px;
            display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .driver-badge a { color: var(--accent); text-decoration: none; font-weight: 500; opacity: 0.8; transition: opacity var(--transition-fast); }
        .driver-badge a:hover { opacity: 1; }
        .driver-badge i { color: var(--accent); font-size: 10px; opacity: 0.4; }

        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .loading {
            display: inline-block; width: 14px; height: 14px;
            border: 2px solid rgba(129, 140, 248, 0.2); border-top-color: var(--accent);
            border-radius: 50%; animation: spin 0.7s linear infinite;
            margin-right: 8px; vertical-align: middle;
        }

        .stats-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 20px; margin-bottom: 28px; }
        .stats-card {
            background: var(--glass-bg);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border: 1px solid var(--glass-border); border-radius: var(--radius-lg);
            padding: 22px; overflow: hidden;
            box-shadow: var(--glass-shadow), var(--glass-highlight);
            transition: all var(--transition-smooth);
        }
        .stats-card:hover { border-color: var(--glass-border-hover); transform: translateY(-2px); }
        .stats-card .card-header {
            display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
            border-bottom: 1px solid var(--divider); padding-bottom: 12px; padding-left: 0; padding-right: 0;
        }
        .stats-card .card-header i { font-size: 17px; color: var(--accent); opacity: 0.8; }
        .stats-card .card-header h3 { font-size: 14px; font-weight: 600; }
        .stats-card .card-header p { font-size: 11px; color: var(--text-tertiary); }
        .stats-card .card-body { padding: 0; }

        .speed-history-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .speed-history-table th { text-align: left; padding: 8px 10px; color: var(--text-tertiary); font-weight: 500; border-bottom: 1px solid var(--divider); font-size: 11px; }
        .speed-history-table td { padding: 8px 10px; border-bottom: 1px solid var(--divider); color: var(--text-secondary); }
        .speed-history-table .speed-val { font-weight: 600; color: var(--accent); }
        .speed-history-table .speed-good { color: var(--success); font-weight: 600; }
        .speed-history-table .speed-mid { color: var(--warning); font-weight: 600; }
        .speed-history-table .speed-low { color: var(--danger); font-weight: 600; }
        .speed-bar { display: inline-block; height: 4px; border-radius: 2px; margin-right: 6px; vertical-align: middle; background: var(--accent); opacity: 0.6; }

        .usage-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--divider); font-size: 12px; }
        .usage-row .ep { color: var(--text-secondary); font-family: var(--font-mono); font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .usage-row .count { color: var(--accent); font-weight: 600; }
        .usage-total { text-align: center; padding: 14px; font-size: 28px; font-weight: 700; color: var(--text-primary); letter-spacing: -1px; font-family: var(--font-mono); }
        .usage-total-label { text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .no-data { text-align: center; padding: 28px; color: var(--text-quaternary); font-size: 13px; }

        .node-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        .node-table th { text-align: left; padding: 8px 12px; background: var(--glass-bg); border-bottom: 1px solid var(--border); color: var(--text-secondary); font-weight: 600; }
        .node-table td { padding: 8px 12px; border-bottom: 1px solid var(--divider); color: var(--text-primary); }
        .node-table .good { color: var(--success); font-weight: 600; }
        .node-table .mid { color: var(--warning); font-weight: 600; }
        .node-table .bad { color: var(--danger); font-weight: 600; }

        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000; opacity: 0; visibility: hidden; transition: all 0.3s ease;
        }
        .modal-overlay.active { opacity: 1; visibility: visible; }
        .modal-box {
            background: var(--glass-heavy);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            border-radius: var(--radius-xl);
            padding: 28px 32px; max-width: 560px; width: 90%;
            box-shadow: var(--glass-shadow-lg), var(--glass-highlight);
            border: 1px solid var(--glass-border);
        }
        .modal-box h3 { margin-bottom: 16px; font-weight: 600; }
        .modal-box p { color: var(--text-secondary); font-size: 13px; margin-bottom: 12px; }
        .modal-box textarea {
            width: 100%; padding: 12px; border-radius: var(--radius-sm);
            border: 1px solid var(--glass-border); background: var(--glass-bg);
            color: var(--text-primary); font-family: var(--font); font-size: 14px;
            resize: vertical; min-height: 80px; transition: all var(--transition-fast);
        }
        .modal-box textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.1); }
        .modal-box .btn-group { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; }

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 6px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        [data-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.1); }
        [data-theme="light"] ::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.2); }

        /* === Tablet landscape === */
        @media (max-width: 1024px) {
            .container { max-width: 720px; }
            .rtt-display { grid-template-columns: repeat(2, 1fr); }
            .quality-grid { grid-template-columns: repeat(2, 1fr); }
            .grid-2col { grid-template-columns: 1fr; }
            .stats-grid { grid-template-columns: 1fr; }
        }
        /* === Tablet portrait / small laptop === */
        @media (max-width: 768px) {
            body { padding: 16px 12px; }
            .container { max-width: 100%; }
            .grid { grid-template-columns: 1fr; gap: 14px; }
            .grid-2col { grid-template-columns: 1fr; gap: 14px; }
            .info-grid { grid-template-columns: 1fr; }
            .ip-val { font-size: 18px; }
            .ip-val-small { font-size: 14px; }
            .header { flex-direction: column; text-align: center; padding: 18px 20px; border-radius: var(--radius-lg); }
            .logo { flex-direction: column; gap: 8px; }
            .logo-icon { width: 40px; height: 40px; font-size: 18px; border-radius: 10px; }
            .logo h1 { font-size: 18px; }
            .button-group { justify-content: center; }
            .btn { padding: 10px 18px; font-size: 12px; }
            .rtt-value { font-size: 32px; }
            .rtt-display { grid-template-columns: 1fr 1fr; gap: 10px; }
            .rtt-box { padding: 16px 12px; }
            .stats-row { justify-content: center; }
            .footer { flex-direction: column; text-align: center; padding: 16px 20px; }
            .quality-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
            .hero-card { padding: 24px 20px; border-radius: var(--radius-lg); }
            .rtt-card { min-height: auto; }
            .rtt-card .card-body { padding: 16px; }
            .card-header { padding: 16px 18px; }
            .card-body { padding: 16px 18px; }
            .stats-grid { grid-template-columns: 1fr; gap: 14px; }
            .header-right { flex-wrap: wrap; justify-content: center; }
            .hw-strip { padding: 12px 16px; gap: 12px; }
        }
        /* === Phone === */
        @media (max-width: 480px) {
            body { padding: 12px 8px; }
            .rtt-display { grid-template-columns: 1fr 1fr; gap: 8px; }
            .rtt-value { font-size: 26px; letter-spacing: -1px; }
            .rtt-box { padding: 14px 10px; }
            .quality-grid { grid-template-columns: 1fr; }
            .ip-val { font-size: 15px; }
            .ip-val-small { font-size: 12px; }
            .btn { padding: 9px 14px; font-size: 11px; gap: 6px; }
            .hero-card { padding: 20px 16px; }
            .card-header { padding: 14px 16px; }
            .card-body { padding: 14px 16px; }
            .hw-strip { flex-direction: column; align-items: flex-start; }
            .stat-item { font-size: 11px; padding: 6px 12px; }
            .info-row { padding: 9px 0; }
            .info-label { font-size: 12px; }
            .info-value { font-size: 12px; }
        }

        /* ==================== HUD 灰度覆盖层 ==================== */
        /* 网格背景替换极光 */
        body::before {
            background-image:
                linear-gradient(var(--grid-line) 1px, transparent 1px),
                linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) !important;
            background-size: 40px 40px, 40px 40px !important;
            animation: none !important;
            filter: none !important;
            opacity: 1 !important;
            -webkit-mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 85%);
            mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 85%);
        }
        body::after { display: none !important; }

        .header, .hero-card, .card, .stats-card, .hw-strip, .footer, .theme-toggle, .lang-switcher, .stat-item, .btn { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
        .card:hover { transform: none; }
        .hw-strip-label, .logo h1, .card-header h3, .stats-card .card-header h3 { letter-spacing: 0.6px; }
        .info-label, .quality-label, .ip-label, .rtt-label, .usage-total-label {
            text-transform: uppercase; letter-spacing: 1.1px;
        }
        .logo-icon {
            background: linear-gradient(135deg, #2a2c31, #14151a) !important;
            border: 1px solid var(--glass-border);
            color: var(--text-primary) !important;
            box-shadow: none !important;
        }
        [data-theme="light"] .logo-icon { background: linear-gradient(135deg, #e9eaec, #d3d5d9) !important; color: #17181a !important; }

        /* 主按钮：灰度反白 */
        .btn-primary {
            background: var(--text-primary) !important;
            color: var(--bg-primary) !important;
            border-color: var(--text-primary) !important;
            box-shadow: none !important;
        }
        .btn-primary:hover { background: #ffffff !important; border-color: #ffffff !important; }
        [data-theme="light"] .btn-primary { background: #17181a !important; color: #ffffff !important; border-color: #17181a !important; }
        [data-theme="light"] .btn-primary:hover { background: #000000 !important; }
        .btn-cyan, .btn-purple {
            background: var(--glass-bg-hover) !important;
            border-color: var(--glass-border) !important;
            color: var(--text-secondary) !important;
            box-shadow: none !important;
        }
        .btn-cyan:hover, .btn-purple:hover { background: var(--glass-bg) !important; color: var(--text-primary) !important; box-shadow: none !important; }

        /* 状态徽章去彩，仅保留克制的语义色 */
        .badge-success { border-color: rgba(167, 182, 169, 0.28); }
        .badge-warning { border-color: rgba(200, 176, 122, 0.28); }
        .badge-danger { border-color: rgba(201, 138, 138, 0.28); }
        .badge-info { border-color: var(--glass-border); }
        .badge-purple { background: var(--glass-bg-hover); color: var(--text-secondary); border-color: var(--glass-border); }
        .copy-btn:hover { background: var(--glass-bg-hover); }
        .loading { border-color: var(--glass-border) !important; border-top-color: var(--text-secondary) !important; }
        .modal-box textarea:focus { border-color: var(--glass-border-hover) !important; box-shadow: none !important; }

        /* 标签导航 */
        .tab-nav {
            display: flex; gap: 2px; margin-bottom: 22px; padding: 4px;
            background: var(--glass-heavy);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-lg);
            overflow-x: auto; scrollbar-width: none;
        }
        .tab-nav::-webkit-scrollbar { display: none; }
        .tab-btn {
            flex: 1 1 0; min-width: max-content; white-space: nowrap;
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            padding: 10px 16px; border: none; border-radius: var(--radius-sm);
            background: transparent; color: var(--text-tertiary);
            font-family: var(--font); font-size: 13px; font-weight: 500; letter-spacing: 0.5px;
            cursor: pointer; transition: var(--transition-fast);
        }
        .tab-btn i { font-size: 12px; opacity: 0.75; }
        .tab-btn:hover { color: var(--text-primary); background: var(--glass-bg-hover); }
        .tab-btn.active {
            color: var(--text-primary); background: var(--glass-bg-hover);
            box-shadow: inset 0 -2px 0 var(--text-primary);
        }
        .tab-panel { display: none; }
        .tab-panel.active { display: block; animation: hudFade 0.25s ease; }
        @keyframes hudFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

        @media (max-width: 768px) {
            .tab-btn { padding: 9px 12px; font-size: 12px; gap: 6px; }
            .tab-btn i { display: none; }
        }

        /* ==================== 工具卡片：按类别分组 + 紧凑卡片 ==================== */
        .tool-grid { display: flex; flex-direction: column; gap: 20px; }
        .tool-group-head {
            display: flex; align-items: center; gap: 8px; margin-bottom: 9px;
            font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-tertiary);
        }
        .tool-group-head i { color: var(--accent); opacity: 0.65; font-size: 11px; }
        .tool-group-head .tg-count {
            margin-left: auto; font-family: var(--font-mono); font-size: 10px;
            padding: 1px 7px; border: 1px solid var(--glass-border); border-radius: 50px; color: var(--text-quaternary);
        }
        .tool-group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 8px; }
        .tool-card {
            display: flex; align-items: center; gap: 11px; text-align: left; width: 100%;
            padding: 10px 12px; border: 1px solid var(--glass-border); border-radius: var(--radius-md);
            background: var(--glass-bg); cursor: pointer; color: var(--text-primary);
            font-family: var(--font); transition: var(--transition-fast);
        }
        .tool-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
        .tool-card .tc-icon {
            width: 30px; height: 30px; flex: 0 0 30px; display: flex; align-items: center; justify-content: center;
            border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
            color: var(--text-secondary); font-size: 13px; background: var(--glass-heavy);
        }
        .tool-card:hover .tc-icon { color: var(--text-primary); border-color: var(--glass-border-hover); }
        .tool-card .tc-text { flex: 1; min-width: 0; }
        .tool-card .tc-name { display: block; font-size: 12.5px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tool-card .tc-go { color: var(--text-quaternary); font-size: 10px; transition: var(--transition-fast); }
        .tool-card:hover .tc-go { color: var(--text-secondary); }
        @media (max-width: 480px) {
            .tool-group-grid { grid-template-columns: 1fr 1fr; gap: 6px; }
            .tool-card { padding: 9px 10px; gap: 8px; }
            .tool-card .tc-icon { width: 26px; height: 26px; flex-basis: 26px; font-size: 12px; }
            .tool-card .tc-name { font-size: 11.5px; }
        }

        /* ==================== 工具弹层：宽屏两栏（左参数 / 右结果） ==================== */
        .tool-modal-box { max-width: 1040px; width: 94%; max-height: 86vh; display: flex; flex-direction: column; }
        .tool-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--divider); margin-bottom: 16px; }
        .tool-modal-head h3 { font-size: 16px; font-weight: 600; letter-spacing: 0.3px; }
        .tool-modal-head p { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; max-width: 640px; }
        .tool-close { flex: 0 0 auto; width: 30px; height: 30px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; transition: var(--transition-fast); }
        .tool-close:hover { color: var(--text-primary); border-color: var(--glass-border-hover); }
        .tool-modal-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .tool-rerun { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font); font-size: 12px; transition: var(--transition-fast); }
        .tool-rerun:hover { color: var(--text-primary); border-color: var(--glass-border-hover); background: var(--glass-bg-hover); }
        .tool-rerun i { font-size: 11px; }
        @media (max-width: 520px) { .tool-rerun span { display: none; } .tool-rerun { padding: 0 9px; } }

        .tool-modal-main { display: grid; grid-template-columns: 300px 1fr; gap: 20px; flex: 1 1 auto; min-height: 0; }
        .tool-modal-side { border-right: 1px solid var(--divider); padding-right: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
        .side-desc { font-size: 12px; color: var(--text-tertiary); line-height: 1.55; }
        .side-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-quaternary); }
        .side-params { display: flex; flex-direction: column; gap: 8px; }
        .side-actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 6px; }
        .side-actions .btn { width: 100%; justify-content: center; }
        /* 左栏内的表单一律竖排，避免 300px 宽度下输入框被压扁 */
        .tool-modal-side .tool-field { flex-direction: column; align-items: stretch; gap: 8px; }
        .tool-modal-side .tool-field .btn { width: 100%; height: 38px; }
        .tool-modal-side .tool-input, .tool-modal-side select.tool-input { width: 100%; max-width: none !important; }
        .tool-modal-side textarea.tool-input { height: 86px !important; }
        .tool-modal-side label { font-size: 12px; }
        .tool-modal-body { overflow-y: auto; min-height: 140px; padding-right: 2px; }

        @media (max-width: 860px) {
            .tool-modal-box { max-width: 96%; width: 96%; max-height: 90vh; }
            .tool-modal-main { grid-template-columns: 1fr; gap: 14px; }
            .tool-modal-side { border-right: none; border-bottom: 1px solid var(--divider); padding-right: 0; padding-bottom: 14px; overflow: visible; }
            .side-actions { margin-top: 0; }
            .tool-modal-body { min-height: 80px; max-height: 46vh; }
        }

        .tool-loading { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; padding: 14px 0; }
        .tool-error { display: flex; align-items: center; gap: 9px; color: var(--danger); font-size: 13px; padding: 13px 14px; border: 1px solid var(--danger-light); border-radius: var(--radius-sm); }

        /* 结果：指标卡 + 进度条 */
        .result-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.1px; color: var(--text-tertiary); margin: 2px 0 12px; }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
        .metric-card { border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: var(--glass-bg); padding: 14px; }
        .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .metric-value { font-size: 24px; font-weight: 700; font-family: var(--font-mono); letter-spacing: -0.5px; margin-top: 6px; color: var(--text-primary); }
        .metric-unit { font-size: 11px; font-weight: 500; color: var(--text-tertiary); margin-left: 4px; font-family: var(--font); letter-spacing: 0; }
        .metric-bar { height: 4px; border-radius: 2px; background: var(--divider); margin-top: 10px; overflow: hidden; }
        .metric-bar i { display: block; height: 100%; width: 0; background: var(--text-primary); border-radius: 2px; transition: width 0.4s ease; }
        .metric-card.tone-warn .metric-value { color: var(--warning); }
        .metric-card.tone-warn .metric-bar i { background: var(--warning); }
        .metric-card.tone-bad .metric-value { color: var(--danger); }
        .metric-card.tone-bad .metric-bar i { background: var(--danger); }

        /* 结果：行列表 */
        .result-rows { display: flex; flex-direction: column; gap: 6px; }
        .result-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); font-size: 12px; }
        .result-row .rr-name { color: var(--text-secondary); }
        .result-row .rr-val { font-family: var(--font-mono); color: var(--text-primary); font-weight: 600; }
        .result-row.is-bad .rr-val { color: var(--danger); }
        .result-row.is-warn .rr-val { color: var(--warning); }

        /* 站点体检：输入行 */
        .tool-field { display: flex; gap: 10px; margin-bottom: 4px; }
        .tool-input { flex: 1 1 auto; min-width: 0; height: 40px; padding: 0 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: 13px; }
        .tool-input:focus { outline: 2px solid var(--accent-hover); outline-offset: 1px; border-color: var(--glass-border-hover); }
        .tool-input::placeholder { color: var(--text-quaternary); font-family: var(--font); }
        .tool-field .btn { flex: 0 0 auto; height: 40px; }
        @media (max-width: 520px) { .tool-field { flex-direction: column; } .tool-field .btn { width: 100%; justify-content: center; } }

        /* 结果：TTFB 阶段条 */
        .ttfb-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
        .ttfb-label { min-width: 104px; font-size: 11px; color: var(--text-secondary); }
        .ttfb-track { flex: 1; height: 12px; background: var(--divider); border-radius: 6px; overflow: hidden; }
        .ttfb-track i { display: block; height: 100%; border-radius: 6px; transition: width 0.4s ease; }
        .ttfb-val { min-width: 46px; text-align: right; font-size: 11px; font-weight: 600; font-family: var(--font-mono); color: var(--text-primary); }

        /* ---------- v4.8：资源瀑布 / 网络信息 / 历史趋势 / 分享条 ---------- */
        .wf-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 14px; }
        .wf-bar-row { display: grid; grid-template-columns: minmax(120px, 210px) 1fr 62px; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--divider); font-size: 12px; }
        .wf-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
        .wf-track { display: flex; height: 13px; background: var(--divider); border-radius: 3px; overflow: hidden; }
        .wf-seg { height: 100%; min-width: 0; }
        .wf-seg-dns { background: var(--chart-cyan); }
        .wf-seg-tcp { background: var(--chart-teal); }
        .wf-seg-tls { background: var(--warning); }
        .wf-seg-ttfb { background: var(--text-secondary); }
        .wf-seg-dl { background: var(--success); }
        .wf-total { text-align: right; font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
        .wf-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--text-secondary); margin: 8px 0 12px; }
        .wf-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
        .netinfo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .netinfo-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-md); padding: 12px; }
        .netinfo-k { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: var(--text-tertiary); }
        .netinfo-v { font-size: 15px; font-weight: 600; font-family: var(--font-mono); margin-top: 4px; word-break: break-all; }
        .history-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
        .history-toolbar select { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 5px 8px; font-size: 12px; }
        .trend-canvas { width: 100%; height: 120px; display: block; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-md); }
        .share-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 10000; display: flex; align-items: center; gap: 10px; padding: 9px 14px; background: var(--glass-heavy); border-bottom: 1px solid var(--accent); box-shadow: var(--glass-shadow-lg); font-size: 12.5px; }
        .share-banner span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* 尊重系统「减少动态效果」偏好 */
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        }
`;

const APP_JS = `
        (function(){
            // ==================== 国际化（全界面覆盖） ====================
            const i18n = {
                'en': {
                    // 头部
                    subtitle: 'Aurora Diagnostics · Real-time Network Analysis',
                    edgeLabel: 'Edge Node',
                    workerLabel: 'Worker Time',
                    live: 'Live Monitoring',
                    // RTT
                    rtt: 'Real-time RTT',
                    rttSub: 'RTT · Jitter · Live Chart · Network Quality',
                    rttCurrent: 'Current RTT',
                    jitter: 'Jitter',
                    rttMin: 'Min RTT',
                    rttMax: 'Max RTT',
                    quality: 'Connection Quality',
                    stability: 'Network Stability',
                    samples: 'Samples',
                    loss: 'Loss Rate',
                    // 卡片标题
                    sec: 'Security & Protocol',
                    secSub: 'TLS · Encryption · Authentication',
                    secGroupTransport: 'Transport & Protocol',
                    secGroupOrigin: 'Origin & Fingerprint',
                    geo: 'Edge Location',
                    geoSub: 'Cloudflare Data Center',
                    userGeo: 'Client Location',
                    userGeoSub: 'Client Geolocation & Risk Score',
                    geoLoading: 'Locating...',
                    // 工具集
                    toolsTitle: 'Diagnostic Tools',
                    toolsSub: 'One-Click Tests · Full Diagnosis',
                    lossBtn: 'Packet Loss',
                    speedBtn: 'Bandwidth',
                    dnsBtn: 'DNS',
                    cpuBtn: 'CPU',
                    wsBtn: 'WebSocket',
                    concurrentBtn: 'Concurrent',
                    streamBtn: 'Stream',
                    mediaBtn: 'Streaming Connectivity',
                    multiBtn: 'Multi-Node Compare',
                    // 安全与协议字段
                    dcLabel: 'DC / Proxy',
                    risk: 'Risk Level',
                    asn: 'ASN',
                    protoLabel: 'Protocol',
                    tlsVersion: 'TLS Version',
                    cipher: 'Cipher Suite',
                    echLabel: 'ECH',
                    compressLabel: 'Compression',
                    http2Label: 'HTTP/2',
                    botLabel: 'Bot Score',
                    // 地理位置
                    geoLocation: 'Location',
                    geoCoord: 'Coordinates',
                    geoOrg: 'ISP',
                    // 用户地理位置
                    userLocation: 'Location',
                    userDistance: 'Distance to Node',
                    userOrg: 'ISP',
                    userIp: 'IP Address',
                    // 硬件
                    hw: 'Hardware Info',
                    hwSub: 'Client Environment',
                    // 历史/统计
                    historyTitle: 'Speed History',
                    historySub: 'Last 10 Bandwidth Records',
                    noRecords: 'No speed records',
                    historyKvOff: 'KV writes disabled · speed history not saved',
                    usageTitle: 'Usage Statistics',
                    usageSub: 'API Endpoint Calls',
                    usageLocalNote: 'Local session counters · no KV writes',
                    loadingStats: 'Loading...',
                    // 底部
                    clientLabel: 'Client',
                    copy: 'Copy Report',
                    copied: 'Copied!',
                    powered: 'Powered by',
                    driven: 'Driven',
                    // 状态
                    yes: 'YES', no: 'NO',
                    clean: 'Low Risk', high: 'High Risk',
                    unavailable: 'Unavailable',
                    // 测试结果
                    lossTesting: 'Testing...',
                    lossNone: '0% (no loss)',
                    lossResult: 'Loss',
                    dnsTesting: 'Testing DNS...',
                    speedTesting: 'Testing bandwidth...',
                    cpuTesting: 'CPU benchmark...',
                    wsTesting: 'WebSocket latency...',
                    concurrentTesting: 'Concurrency test...',
                    streamTesting: 'Stream throughput...',
                    mediaTesting: 'Testing connectivity from your IP...',
                    multiTesting: 'Comparing nodes...',
                    multiResult: 'Node Comparison Result',
                    nodeName: 'Node',
                    latency: 'Latency (ms)',
                    status: 'Status',
                    enterNodeUrls: 'Enter node URLs (one per line)',
                    cancel: 'Cancel',
                    start: 'Start Test',
                    // 欺诈
                    fraudScore: 'Fraud Score',
                    proxy: 'Proxy',
                    vpn: 'VPN',
                    tor: 'Tor',
                    hosting: 'Hosting',
                    fraudLow: 'Low Risk',
                    fraudMedium: 'Medium Risk',
                    fraudHigh: 'High Risk',
                    fraudUnknown: 'Unknown',
                    echEnabled: 'Enabled',
                    echDisabled: 'Disabled',
                    http2Enabled: 'HTTP/2 Enabled',
                    http2Disabled: 'HTTP/1.1',
                    earlyHints: 'Early Hints',
                    webrtcBtn: 'WebRTC Leak',
                    ttfbBtn: 'TTFB Analysis',
                    uploadBtn: 'Upload Speed',
                    webrtcTesting: 'Detecting WebRTC leak...',
                    webrtcSafe: 'No leak detected',
                    webrtcLeak: 'Leak detected',
                    webrtcLocal: 'Local IP',
                    webrtcPublic: 'Public IP',
                    webrtcNone: 'No WebRTC candidates found (safe)',
                    ttfbTesting: 'Analyzing TTFB...',
                    ttfbDns: 'DNS Lookup',
                    ttfbTcp: 'TCP Connect',
                    ttfbTls: 'TLS Handshake',
                    ttfbWait: 'Waiting (TTFB)',
                    ttfbDownload: 'Download',
                    ttfbTotal: 'Total',
                    uploadTesting: 'Testing upload speed...',
                    uploadResult: 'Upload Speed',
                    uploadFailed: 'Upload test failed',
                    // 测试结果 & 动态 UI 补充
                    geoQueryFailed: 'Geolocation query failed',
                    cores: 'cores',
                    cpuPerf: 'CPU Performance',
                    cpuFailed: 'CPU test failed',
                    wsLatency: 'WebSocket Latency',
                    wsMin: 'Min',
                    wsMax: 'Max',
                    wsConnFailed: 'WebSocket connection failed',
                    wsTestFailed: 'WebSocket test failed',
                    concurrentResultTitle: 'Concurrent Test Results',
                    concurrentRequests: 'requests',
                    concurrentFailed: 'Concurrent test failed',
                    streamThroughput: 'Stream Throughput',
                    lossPacketsLost: 'lost',
                    speedResultTitle: 'Bandwidth Results',
                    speedAvg: 'Average',
                    dnsResultTitle: 'DNS Resolution Results',
                    dnsTimeout: 'Timeout',
                    mediaResultTitle: 'IP Connectivity Results',
                    mediaBlocked: 'Blocked / Timeout',
                    mediaAvailable: 'Accessible',
                    mediaConnFailed: 'Connection failed',
                    km: 'km',
                    ttfbFailed: 'TTFB analysis failed',
                    historyAvgSpeed: 'Avg Speed',
                    historyNode: 'Node',
                    loadFailed: 'Load failed',
                    totalRequests: 'Total Requests',
                    waitingFirstReq: 'Waiting for first request...',
                    enterNodeUrlAlert: 'Please enter at least one node URL',
                    // 报告模板
                    reportTitle: 'NetSight Pro Network Diagnostic Report',
                    reportGenTime: 'Generated',
                    reportNetMetrics: 'Network Metrics',
                    reportSecProto: 'Security & Protocol',
                    reportLocation: 'Location Info',
                    reportIpRisk: 'IP Risk Info',
                    reportCompressNone: 'None',
                    reportUnknown: 'Unknown',
                    reportFooter: 'Report auto-generated by NetSight Pro · Powered by CF-workers-netdiag',
                    tabOverview: 'Overview',
                    tabNetwork: 'Network',
                    tabTools: 'Diagnostics',
                    tabHistory: 'History',
                    running: 'Running...',
                    metricDuration: 'Duration',
                    detecting: 'Detecting...',
                    themeTip: 'Toggle theme',
                    pageTitle: 'NetSight Pro | Aurora Network Diagnostics',
                    rerun: 'Re-run',
                    auditBtn: 'Site Audit',
                    auditPrompt: 'Enter a site URL to audit',
                    auditRun: 'Run Audit',
                    auditFinal: 'Final URL',
                    auditStatus: 'Status',
                    auditTtfb: 'TTFB',
                    auditTotal: 'Total',
                    auditRedirects: 'Redirects',
                    auditHeaders: 'Security Headers',
                    auditMissing: 'Missing',
                    auditInvalid: 'Enter a valid http(s) URL',
                    auditFailed: 'Audit failed',
                    quickcheckBtn: 'Quick Health Check',
                    bufferbloatBtn: 'Bufferbloat Test',
                    dnslookupBtn: 'DNS Toolbox',
                    bbIntro: 'Measures the latency increase while the link is saturated by downloads and uploads. The smaller the increase, the better (A < 30ms).',
                    bbStart: 'Start Test',
                    bbRunning: 'Testing... (~20s)',
                    bbBaseline: 'Idle Latency',
                    bbLoadedDown: 'Loaded (Download)',
                    bbLoadedUp: 'Loaded (Upload)',
                    bbDelta: 'Increase',
                    bbGrade: 'Grade',
                    bbFailed: 'Test failed',
                    bbNoSamples: 'Not enough valid samples (rate limited or network issue)',
                    bbLimited: 'Rate limit hit during load phase - results may be inaccurate',
                    bbNote: 'Traffic usage scales with bandwidth (up to hundreds of MB on fast links).',
                    dnsQueryBtn: 'Query',
                    dnsInvalidDomain: 'Enter a valid domain (e.g. example.com)',
                    dnsNoRecords: 'No records',
                    dnsLookupFailed: 'DNS lookup failed',
                    dnsblSection: 'IP Blocklist Check',
                    dnsblBtn: 'Check',
                    dnsblInvalidIp: 'Enter a valid IPv4 address',
                    dnsblListed: 'Listed',
                    dnsblClean: 'Not listed',
                    dnsblRefused: 'Refused (public resolver limit)',
                    dnsblUnknown: 'Unknown / failed',
                    dnsblNotice: 'Blocklist results are indicative only; some lists may refuse public resolver queries.',
                    qcStart: 'Start Health Check',
                    qcRunning: 'Running checks...',
                    qcScore: 'Score',
                    qcItemRtt: 'Latency & Jitter',
                    qcItemDown: 'Download',
                    qcItemUp: 'Upload',
                    qcItemProto: 'HTTP Protocol',
                    qcItemDns: 'DNS Resolution',
                    qcItemFraud: 'IP Risk Score',
                    qcIssues: 'Issues Found',
                    qcNoIssues: 'All good - no issues found',
                    qcNote: 'Runs multiple diagnostics in sequence (~20-30s) and uses some bandwidth.',
                    domaincheckBtn: 'Domain Security Check',
                    dcSelectorPh: 'DKIM selector (optional)',
                    dcBlLabel: 'Blocklists & Reputation',
                    dcFound: 'Configured',
                    dcMissing: 'Not found',
                    dcNotTested: 'Not tested',
                    dcWeak: 'Needs hardening',
                    dcListed: 'Listed',
                    dcClean: 'Clean',
                    dcA_mxMissing: 'No MX records: the domain may not be able to receive email',
                    dcA_spfMissing: 'No SPF record: receivers cannot verify senders, spam scoring risk',
                    dcA_spfMulti: 'Multiple SPF records found: this breaks SPF, merge into one',
                    dcA_spfWeak: 'SPF ends with ?all/+all: too permissive, prefer ~all or -all',
                    dcA_dmarcMissing: 'No DMARC record: spoofing protection missing',
                    dcA_dmarcNone: 'DMARC policy is p=none: monitoring only, upgrade to quarantine/reject',
                    dcA_dkimMissing: 'No DKIM record for this selector: check selector or configure DKIM signing',
                    dcA_listed: 'Domain appears on a blocklist: may affect email deliverability',
                    monitorBtn: 'Site Monitor',
                    monNote: 'Worker checks targets on schedule (requires Cron Triggers). Alerts via Webhook; storage is written only on state change.',
                    monKeyPh: 'Admin key (set MONITOR_ADMIN_KEY on deploy)',
                    monUrlsPh: 'One URL per line (max 10)',
                    monHookPh: 'Webhook URL (DingTalk / Feishu / WeCom / Slack...)',
                    monSave: 'Save Config',
                    monRun: 'Check Now',
                    monUp: 'Up',
                    monDown: 'Down',
                    monStateNone: 'Unknown',
                    monSince: 'since',
                    monEvents: 'Recent Events',
                    monNoEvents: 'No events yet',
                    monNoConfig: 'No monitor targets configured',
                    monKeyNeeded: 'Set MONITOR_ADMIN_KEY in the Worker environment first',
                    monKeyBad: 'Admin key is incorrect',
                    monKvMissing: 'KV (SPEED_HISTORY) is not bound',
                    monBadUrl: 'Contains an invalid URL',
                    monMax: 'Up to 10 URLs',
                    monKvWriteLimit: 'KV write budget for today is exhausted - config not saved, please retry later',
                    monBadPort: 'Only ports 80/443 are allowed - remove the custom port or use a reverse proxy',
                    shareImg: 'Share Image',
                    shareLink: 'Copy Share Link',
                    shareBanner: 'Shared health check result',
                    dnscompareBtn: 'DNS Compare',
                    reachBtn: 'Reachability',
                    dcPrompt: 'Domain to compare (A record)',
                    dcTitle: 'Resolver Comparison',
                    dcConsistent: 'All resolvers agree',
                    dcInconsistent: 'Resolvers disagree (possible CDN shift or poisoning)',
                    dcFailed: 'Comparison failed',
                    reachTitle: 'Network Reachability',
                    reachEdge: 'Edge',
                    reachBrowser: 'Browser',
                    reachOk: 'Reachable',
                    reachBlocked: 'Unreachable',
                    reachLikelyBlocked: 'Likely blocked for you',
                    reachEdgeBlocked: 'Unreachable from edge',
                    reachFailed: 'Probe failed',
                    reachNote: 'Probes target sites directly from your browser (no Cloudflare edge request), reflecting your local network reachability.',
                    proxyBtn: 'Proxy / VPN Check',
                    proxyEgressIp: 'HTTP Egress IP',
                    proxyWebrtcPublic: 'WebRTC Public IP',
                    proxyConsistent: 'Consistent - no proxy/VPN mismatch detected',
                    proxyMismatch: 'Mismatch - WebRTC public IP differs from HTTP egress IP',
                    proxyUndetermined: 'Undetermined - browser exposed no public WebRTC candidate',
                proxyLocalIp: 'Local IPs',
                    proxyNote: 'Compares the IP your HTTP traffic exits from with the IP visible via WebRTC. A mismatch usually means a proxy/VPN, split tunnelling, or a leaky browser configuration.',
                    qualityBtn: 'Quality Monitor',
                    qualityIntro: 'Probes once per second for the selected duration and reports latency percentiles (p50/p95/p99), jitter, loss and a stall timeline. Uses lightweight HEAD requests only.',
                    qualityStart: 'Start Monitoring',
                    qualityStop: 'Stop',
                    qualityRunning: 'Monitoring',
                    qualityP50: 'p50 (median)',
                    qualityP95: 'p95',
                    qualityP99: 'p99',
                    qualityLoss: 'Loss',
                    qualitySamples: 'Samples',
                    qualityTimeline: 'Timeline (worst per 5s bucket)',
                    qualityStalls: 'Stalls (>2x median)',
                    qualityDone: 'Monitoring finished',
                    qualityStopped: 'Monitoring stopped',
                    qualityNote: 'Long runs use the /health quota: one sample per second stays well inside the 180/min per-IP limit.',
                    multispeedBtn: 'Multi-Stream Speed',
                    multispeedIntro: 'Downloads with 4 parallel streams (about 64 MB in total) and plots the instantaneous rate, which is far closer to real bandwidth than a single-stream test.',
                    multispeedStreams: 'Streams',
                    multispeedTotal: 'Transferred',
                    multispeedAvg: 'Average',
                    multispeedP95: 'Peak (p95)',
                    multispeedStability: 'Stability',
                    multispeedRate: 'Rate (Mbps)',
                    multispeedFailed: 'Multi-stream test failed',
                    multispeedNote: 'Traffic usage scales with bandwidth; stop the test if you are on a metered connection.',
                    grpQuality: 'Network Quality & Latency',
                    grpBandwidth: 'Bandwidth & Throughput',
                    grpDns: 'DNS',
                    grpSecurity: 'Security & Compliance',
                    grpReach: 'Reachability & Nodes',
                    grpMonitor: 'Monitoring & System',
                    adviceTitle: 'Diagnosis & Advice',
                    adviceCause: 'Likely cause',
                    adviceAction: 'Suggested action',
                    historyLocalTitle: 'Test History (local)',
                    historyLocalSub: 'Last 20 results - stored in this browser only',
                    historyEmpty: 'No local records yet - run a test to start collecting',
                    historyClear: 'Clear local history',
                    historyCleared: 'Cleared',
                    histQuickcheck: 'Health check',
                    histSpeed: 'Speed test',
                    histMultispeed: 'Multi-stream',
                    histQuality: 'Quality monitor',
                    histAudit: 'Site audit',
                    auditCertLabel: 'Also check certificate expiry (+1 outbound request)',
                    certSkipped: 'Certificate check skipped',
                    certExpiring: 'TLS certificate expires soon',
                    certExpired: 'TLS certificate has expired',
                    auditScore: 'Security Score',
                    auditChecks: 'Header Checks',
                    auditIssues: 'Issues',
                    auditPass: 'Pass',
                    auditWarn: 'Warn',
                    auditFailN: 'Missing',
                    auditNoIssues: 'No issues found',
                    auditIssueMap: {
                        hsts_missing: 'HSTS is missing',
                        hsts_weak: 'HSTS max-age is too short',
                        csp_missing: 'Content-Security-Policy is missing',
                        csp_unsafe: 'CSP allows unsafe-inline',
                        xfo_missing: 'X-Frame-Options is missing',
                        xcto_missing: 'X-Content-Type-Options is missing',
                        refpol_missing: 'Referrer-Policy is missing',
                        server_leak: 'Server header reveals software info',
                        no_https: 'Final page is not HTTPS',
                        cert_expiring: 'TLS certificate expires within 14 days',
                        cert_expired: 'TLS certificate has already expired'
                    },
                    toolDesc: {
                        loss: 'Probe the endpoint repeatedly and measure packet loss',
                        speed: 'Multi-size download to estimate downstream bandwidth',
                        dns: 'Resolve popular sites and measure lookup time',
                        cpu: 'Worker-side compute benchmark',
                        ws: 'Measure WebSocket round-trip latency',
                        concurrent: 'Fire concurrent requests at several levels',
                        stream: 'Chunked streaming download throughput',
                        media: 'Check reachability of streaming services',
                        multi: 'Compare latency across multiple Worker nodes',
                        webrtc: 'Detect whether WebRTC leaks your real IP',
                        ttfb: 'Break down request timing phase by phase',
                        upload: 'Multi-size upload to estimate upstream bandwidth',
                        audit: 'Score HTTP security headers (HSTS/CSP/...) and response timing of a site',
                        quickcheck: 'Run all diagnostics and produce a scored report',
                        bufferbloat: 'Latency under load (bufferbloat) with A-F grade',
                        dnslookup: 'DNS record lookup (DoH) and IP blocklist check',
                        domaincheck: 'MX/SPF/DMARC/DKIM and reputation check for a domain',
                        monitor: 'Scheduled uptime checks with webhook alerts',
                        dnscompare: 'Query the same name on 4 public resolvers and compare answers',
                        reach: 'Probe CN and global sites from the edge and your browser',
                        proxy: 'Compare HTTP egress IP with the WebRTC-exposed IP to spot proxy/VPN',
                        quality: 'Long-running latency monitoring with p50/p95/p99 and a stall timeline',
                        multispeed: 'Parallel multi-stream download with a live rate curve'
                    },
                    advice: {
                        rtt_fail: { cause: 'Probes never completed: the edge is unreachable from this network or requests are being blocked.', action: 'Check local firewall/VPN rules, try another network, then re-run the health check.' },
                        rtt_high: { cause: 'Long round-trip time: distant edge, congested path, or a slow local link.', action: 'Compare against another network; if only this network is slow, report it to your ISP.' },
                        jitter_high: { cause: 'Unstable latency: Wi-Fi interference, bufferbloat, or a congested uplink.', action: 'Prefer wired/5 GHz Wi-Fi, stop background transfers, and re-test.' },
                        loss: { cause: 'Packet loss on the path: wireless interference, congestion, or a faulty link.', action: 'Re-test on a wired connection; if loss persists, contact your ISP.' },
                        rate_limited: { cause: 'Some probes were rate limited, so those samples were dropped.', action: 'Wait a minute and re-run, or avoid running several tools at once.' },
                        down_low: { cause: 'Low download throughput: weak signal, busy link, or server-side throttling.', action: 'Re-test with other traffic stopped and compare Wi-Fi against wired.' },
                        up_low: { cause: 'Low upload throughput: common on asymmetric links or under congestion.', action: 'Avoid uploading during the test and check router QoS settings.' },
                        proto_old: { cause: 'The connection is not using HTTP/2 or HTTP/3.', action: 'Usually a proxy or middlebox limit; try a modern browser or another network.' },
                        dns_fail: { cause: 'DNS resolution failed for the edge hostname.', action: 'Check DNS settings, try 1.1.1.1 or 8.8.8.8, and re-run.' },
                        stall: { cause: 'Repeated latency spikes above twice the median.', action: 'Look for periodic background traffic (backups, updates) or wireless roaming.' },
                        proxy_mismatch: { cause: 'HTTP egress IP and WebRTC-exposed IP differ, which indicates a proxy/VPN or split tunnelling.', action: 'If that is not expected, disable the proxy/VPN extension or tighten WebRTC policies.' }
                    }
                },
                'zh-CN': {
                    subtitle: '极光诊断 · 实时网络分析',
                    edgeLabel: '边缘节点',
                    workerLabel: 'Worker 耗时',
                    live: '实时监控',
                    rtt: '实时延迟监控',
                    rttSub: 'RTT · 抖动 · 实时图表 · 网络质量评估',
                    rttCurrent: '当前 RTT',
                    jitter: '抖动',
                    rttMin: '最低 RTT',
                    rttMax: '最高 RTT',
                    quality: '连接质量',
                    stability: '网络稳定性',
                    samples: '样本数量',
                    loss: '丢包率',
                    sec: '安全与协议',
                    secSub: 'TLS · 加密 · 身份验证',
                    secGroupTransport: '传输与协议',
                    secGroupOrigin: '来源与指纹',
                    geo: '边缘节点位置',
                    geoSub: 'Cloudflare 数据中心',
                    userGeo: '真实 IP 位置',
                    userGeoSub: '客户端地理位置 & 风险评分',
                    geoLoading: '定位中...',
                    toolsTitle: '诊断工具集',
                    toolsSub: '一键测试 · 全面诊断',
                    lossBtn: '丢包率',
                    speedBtn: '带宽测速',
                    dnsBtn: 'DNS 解析',
                    cpuBtn: 'CPU 性能',
                    wsBtn: 'WebSocket',
                    concurrentBtn: '并发测试',
                    streamBtn: '流式传输',
                    mediaBtn: '流媒体连通性',
                    multiBtn: '多节点对比',
                    dcLabel: '数据中心/代理',
                    risk: '风险等级',
                    asn: 'ASN',
                    protoLabel: '协议',
                    tlsVersion: 'TLS 版本',
                    cipher: '加密套件',
                    echLabel: 'ECH',
                    compressLabel: '压缩算法',
                    http2Label: 'HTTP/2 状态',
                    botLabel: '机器人评分',
                    geoLocation: '位置',
                    geoCoord: '坐标',
                    geoOrg: '运营商',
                    userLocation: '位置',
                    userDistance: '到节点距离',
                    userOrg: '运营商',
                    userIp: 'IP 地址',
                    hw: '硬件信息',
                    hwSub: '客户端环境',
                    historyTitle: '测速历史',
                    historySub: '最近 10 条带宽测速记录',
                    noRecords: '暂无测速记录',
                    historyKvOff: 'KV 写入已关闭 · 测速历史不保存',
                    usageTitle: '用量统计',
                    usageSub: 'API 端点调用统计',
                    usageLocalNote: '本地会话内统计 · 不写 KV',
                    loadingStats: '加载中...',
                    clientLabel: '客户端',
                    copy: '复制报告',
                    copied: '已复制!',
                    powered: '由',
                    driven: '强力驱动',
                    yes: '是', no: '否',
                    clean: '低风险', high: '高风险',
                    unavailable: '获取失败',
                    lossTesting: '测试中...',
                    lossNone: '0% (无丢包)',
                    lossResult: '丢包率',
                    dnsTesting: '正在测试 DNS...',
                    speedTesting: '正在测速...',
                    cpuTesting: 'CPU 基准测试...',
                    wsTesting: 'WebSocket 延迟测试...',
                    concurrentTesting: '并发测试中...',
                    streamTesting: '流式吞吐量测试...',
                    mediaTesting: '正在检测您 IP 的连通性...',
                    multiTesting: '正在对比节点...',
                    multiResult: '节点对比结果',
                    nodeName: '节点',
                    latency: '延迟 (ms)',
                    status: '状态',
                    enterNodeUrls: '输入节点 URL（每行一个）',
                    cancel: '取消',
                    start: '开始测试',
                    fraudScore: '欺诈评分',
                    proxy: '代理',
                    vpn: 'VPN',
                    tor: 'Tor',
                    hosting: '托管',
                    fraudLow: '低风险',
                    fraudMedium: '中风险',
                    fraudHigh: '高风险',
                    fraudUnknown: '未知',
                    echEnabled: '已启用',
                    echDisabled: '未启用',
                    http2Enabled: 'HTTP/2 已启用',
                    http2Disabled: 'HTTP/1.1',
                    earlyHints: 'Early Hints',
                    webrtcBtn: 'WebRTC 泄漏',
                    ttfbBtn: 'TTFB 分析',
                    uploadBtn: '上传测速',
                    webrtcTesting: '正在检测 WebRTC 泄漏...',
                    webrtcSafe: '未检测到泄漏',
                    webrtcLeak: '检测到泄漏',
                    webrtcLocal: '内网 IP',
                    webrtcPublic: '公网 IP',
                    webrtcNone: '未发现 WebRTC 候选地址（安全）',
                    ttfbTesting: '正在分析 TTFB...',
                    ttfbDns: 'DNS 解析',
                    ttfbTcp: 'TCP 连接',
                    ttfbTls: 'TLS 握手',
                    ttfbWait: '等待响应 (TTFB)',
                    ttfbDownload: '内容下载',
                    ttfbTotal: '总计',
                    uploadTesting: '正在测试上传速度...',
                    uploadResult: '上传速度',
                    uploadFailed: '上传测试失败',
                    geoQueryFailed: '地理位置查询失败',
                    cores: '核心',
                    cpuPerf: 'CPU 性能',
                    cpuFailed: 'CPU 测试失败',
                    wsLatency: 'WebSocket 延迟',
                    wsMin: '最小',
                    wsMax: '最大',
                    wsConnFailed: 'WebSocket 连接失败',
                    wsTestFailed: 'WebSocket 测试失败',
                    concurrentResultTitle: '并发测试结果',
                    concurrentRequests: '请求',
                    concurrentFailed: '并发测试失败',
                    streamThroughput: '流式吞吐量',
                    lossPacketsLost: '丢失',
                    speedResultTitle: '带宽测速结果',
                    speedAvg: '平均',
                    dnsResultTitle: 'DNS 解析结果',
                    dnsTimeout: '超时',
                    mediaResultTitle: 'IP 连通性检测结果',
                    mediaBlocked: '超时或被阻',
                    mediaAvailable: '可访问',
                    mediaConnFailed: '连接失败',
                    km: '公里',
                    ttfbFailed: 'TTFB 分析失败',
                    historyAvgSpeed: '平均速度',
                    historyNode: '节点',
                    loadFailed: '加载失败',
                    totalRequests: '总请求数',
                    waitingFirstReq: '等待首次请求...',
                    enterNodeUrlAlert: '请至少输入一个节点 URL',
                    reportTitle: 'NetSight Pro 网络诊断报告',
                    reportGenTime: '生成时间',
                    reportNetMetrics: '网络指标',
                    reportSecProto: '安全与协议',
                    reportLocation: '位置信息',
                    reportIpRisk: 'IP 风险信息',
                    reportCompressNone: '无',
                    reportUnknown: '未知',
                    reportFooter: '报告由 NetSight Pro 自动生成 · 由 CF-workers-netdiag 强力驱动',
                    tabOverview: '概览',
                    tabNetwork: '网络信息',
                    tabTools: '诊断工具',
                    tabHistory: '历史统计',
                    running: '运行中...',
                    metricDuration: '耗时',
                    detecting: '检测中...',
                    themeTip: '切换主题',
                    pageTitle: 'NetSight Pro | 极光网络诊断',
                    rerun: '重新运行',
                    auditBtn: '站点体检',
                    auditPrompt: '输入要检测的站点 URL',
                    auditRun: '开始检测',
                    auditFinal: '最终地址',
                    auditStatus: '状态码',
                    auditTtfb: '首字节',
                    auditTotal: '总耗时',
                    auditRedirects: '重定向',
                    auditHeaders: '安全响应头',
                    auditMissing: '缺失',
                    auditInvalid: '请输入有效的 http(s) 地址',
                    auditFailed: '检测失败',
                    quickcheckBtn: '一键体检',
                    bufferbloatBtn: '缓冲膨胀测试',
                    dnslookupBtn: 'DNS 工具箱',
                    bbIntro: '在下载/上传压满带宽的同时测量延迟变化。空闲延迟与负载延迟之差越小越好（A 级 <30ms）。',
                    bbStart: '开始测试',
                    bbRunning: '测试中...（约 20 秒）',
                    bbBaseline: '空闲延迟',
                    bbLoadedDown: '负载延迟（下载）',
                    bbLoadedUp: '负载延迟（上传）',
                    bbDelta: '延迟增幅',
                    bbGrade: '评级',
                    bbFailed: '测试失败',
                    bbNoSamples: '有效样本不足（可能触发限流或网络异常）',
                    bbLimited: '负载阶段触发限流，结果可能不准确',
                    bbNote: '流量消耗随带宽增加（高速线路可达数百 MB）。',
                    dnsQueryBtn: '查询',
                    dnsInvalidDomain: '请输入有效域名（如 example.com）',
                    dnsNoRecords: '无记录',
                    dnsLookupFailed: 'DNS 查询失败',
                    dnsblSection: 'IP 黑名单检测',
                    dnsblBtn: '检查',
                    dnsblInvalidIp: '请输入有效 IPv4 地址',
                    dnsblListed: '已列入',
                    dnsblClean: '未列入',
                    dnsblRefused: '查询被拒（公共解析器限制）',
                    dnsblUnknown: '未知/失败',
                    dnsblNotice: '黑名单结果仅供参考；部分名单可能拒绝公共解析器查询。',
                    qcStart: '开始体检',
                    qcRunning: '体检进行中...',
                    qcScore: '总分',
                    qcItemRtt: '延迟与抖动',
                    qcItemDown: '下载速度',
                    qcItemUp: '上传速度',
                    qcItemProto: 'HTTP 协议',
                    qcItemDns: 'DNS 解析',
                    qcItemFraud: 'IP 风险评分',
                    qcIssues: '发现问题',
                    qcNoIssues: '一切正常，未发现问题',
                    qcNote: '将依次运行多项检测（约 20–30 秒），消耗少量流量。',
                    domaincheckBtn: '域名安全体检',
                    dcSelectorPh: 'DKIM 选择器（可选）',
                    dcBlLabel: '黑名单/声誉',
                    dcFound: '已配置',
                    dcMissing: '未找到',
                    dcNotTested: '未检测',
                    dcWeak: '建议加强',
                    dcListed: '已被列入',
                    dcClean: '正常',
                    dcA_mxMissing: '未找到 MX 记录：域名可能无法接收邮件',
                    dcA_spfMissing: '未配置 SPF：收件方无法验证发信来源，易被标记垃圾邮件',
                    dcA_spfMulti: '发现多条 SPF 记录：会导致校验失败，应合并为一条',
                    dcA_spfWeak: 'SPF 以 ?all/+all 结尾：过于宽松，建议 ~all 或 -all',
                    dcA_dmarcMissing: '未配置 DMARC：无法防护伪造发件人',
                    dcA_dmarcNone: 'DMARC 策略为 p=none：仅监控模式，建议升级到 quarantine/reject',
                    dcA_dkimMissing: '未找到该选择器的 DKIM 记录：检查选择器拼写或配置签名',
                    dcA_listed: '域名出现在黑名单：可能影响邮件送达',
                    monitorBtn: '站点监控',
                    monNote: '由 Worker 定时巡检（需启用 Cron Triggers），异常经 Webhook 告警；仅状态变化时写入存储。',
                    monKeyPh: '管理密钥（部署时设置 MONITOR_ADMIN_KEY）',
                    monUrlsPh: '每行一个 URL（最多 10 个）',
                    monHookPh: 'Webhook 地址（钉钉 / 飞书 / 企业微信 / Slack）',
                    monSave: '保存配置',
                    monRun: '立即检测',
                    monUp: '正常',
                    monDown: '异常',
                    monStateNone: '未知',
                    monSince: '始于',
                    monEvents: '最近事件',
                    monNoEvents: '暂无事件',
                    monNoConfig: '尚未配置监控目标',
                    monKeyNeeded: '请先在 Worker 环境变量中设置 MONITOR_ADMIN_KEY',
                    monKeyBad: '管理密钥不正确',
                    monKvMissing: '未绑定 KV（SPEED_HISTORY）',
                    monBadUrl: '包含无效 URL',
                    monMax: '最多 10 个 URL',
                    monKvWriteLimit: 'KV 今日写入预算已用尽，配置未保存，请稍后重试',
                    monBadPort: '仅允许 80/443 端口（请去掉自定义端口或改用反向代理）',
                    shareImg: '生成分享图',
                    shareLink: '复制分享链接',
                    shareBanner: '来自分享的体检结果',
                    dnscompareBtn: '多解析器对比',
                    reachBtn: '网络可达性',
                    dcPrompt: '要对比的域名（A 记录）',
                    dcTitle: '解析器对比',
                    dcConsistent: '各解析器结果一致',
                    dcInconsistent: '解析器结果不一致（可能有 CDN 调度或污染）',
                    dcFailed: '对比失败',
                    reachTitle: '网络可达性检测',
                    reachEdge: '边缘侧',
                    reachBrowser: '浏览器侧',
                    reachOk: '可达',
                    reachBlocked: '不可达',
                    reachLikelyBlocked: '疑似被阻断',
                    reachEdgeBlocked: '边缘侧不可达',
                    reachFailed: '探测失败',
                    reachNote: '直接从你的浏览器探测目标站点（不经 Cloudflare 边缘），反映你本地网络的可达性。',
                    proxyBtn: '代理/VPN 检测',
                    proxyEgressIp: 'HTTP 出口 IP',
                    proxyWebrtcPublic: 'WebRTC 公网 IP',
                    proxyConsistent: '一致 · 未发现代理/VPN 迹象',
                    proxyMismatch: '不一致 · WebRTC 公网 IP 与 HTTP 出口 IP 不同',
                    proxyUndetermined: '无法判定 · 浏览器未暴露公网 WebRTC 候选',
                proxyLocalIp: '内网 IP',
                    proxyNote: '对比「HTTP 流量出口 IP」与「WebRTC 暴露的 IP」。两者不一致通常意味着使用了代理/VPN、分流（split tunnel），或浏览器 WebRTC 策略过于宽松。',
                    qualityBtn: '长时质量监控',
                    qualityIntro: '按所选时长每秒探测一次，输出延迟分位（p50/p95/p99）、抖动、丢包与卡顿时间线。仅使用轻量 HEAD 请求。',
                    qualityStart: '开始监控',
                    qualityStop: '停止',
                    qualityRunning: '监控中',
                    qualityP50: 'p50（中位）',
                    qualityP95: 'p95',
                    qualityP99: 'p99',
                    qualityLoss: '丢包率',
                    qualitySamples: '样本数',
                    qualityTimeline: '时间线（每 5 秒取最差值）',
                    qualityStalls: '卡顿次数（>2 倍中位）',
                    qualityDone: '监控结束',
                    qualityStopped: '已停止监控',
                    qualityNote: '长时间监控走 /health 配额：每秒 1 次远低于每 IP 180 次/分的上限。',
                    multispeedBtn: '多流并发测速',
                    multispeedIntro: '以 4 条并行流下载（合计约 64 MB），绘制瞬时速率曲线，比单流测试更接近真实带宽。',
                    multispeedStreams: '并发流',
                    multispeedTotal: '传输量',
                    multispeedAvg: '平均',
                    multispeedP95: '峰值(p95)',
                    multispeedStability: '稳定性',
                    multispeedRate: '速率 (Mbps)',
                    multispeedFailed: '多流测速失败',
                    multispeedNote: '流量消耗随带宽增加；若使用流量套餐请谨慎运行。',
                    grpQuality: '网络质量与延迟',
                    grpBandwidth: '带宽与吞吐',
                    grpDns: 'DNS',
                    grpSecurity: '安全与合规',
                    grpReach: '可达性与多节点',
                    grpMonitor: '监控与系统',
                    adviceTitle: '诊断与建议',
                    adviceCause: '可能原因',
                    adviceAction: '建议动作',
                    historyLocalTitle: '测试历史（本地）',
                    historyLocalSub: '最近 20 条记录 · 仅保存在本机浏览器',
                    historyEmpty: '暂无本地记录，运行一次测试即可开始收集',
                    historyClear: '清空本地记录',
                    historyCleared: '已清空',
                    histQuickcheck: '一键体检',
                    histSpeed: '带宽测速',
                    histMultispeed: '多流测速',
                    histQuality: '质量监控',
                    histAudit: '站点体检',
                    auditCertLabel: '同时检查证书到期（+1 次出站请求）',
                    certSkipped: '未检查证书',
                    certExpiring: 'TLS 证书即将到期',
                    certExpired: 'TLS 证书已过期',
                    auditScore: '安全评分',
                    auditChecks: '响应头检查',
                    auditIssues: '问题',
                    auditPass: '通过',
                    auditWarn: '警告',
                    auditFailN: '缺失',
                    auditNoIssues: '未发现问题',
                    auditIssueMap: {
                        hsts_missing: '缺少 HSTS',
                        hsts_weak: 'HSTS max-age 过短',
                        csp_missing: '缺少 Content-Security-Policy',
                        csp_unsafe: 'CSP 允许 unsafe-inline',
                        xfo_missing: '缺少 X-Frame-Options',
                        xcto_missing: '缺少 X-Content-Type-Options',
                        refpol_missing: '缺少 Referrer-Policy',
                        server_leak: 'Server 头暴露软件信息',
                        no_https: '最终页面未使用 HTTPS',
                        cert_expiring: 'TLS 证书将在 14 天内到期',
                        cert_expired: 'TLS 证书已过期'
                    },
                    toolDesc: {
                        loss: '连续探测端点，统计丢包率',
                        speed: '多档位下载，估算下行带宽',
                        dns: '解析主流站点，测量解析耗时',
                        cpu: 'Worker 端计算基准测试',
                        ws: 'WebSocket 往返延迟测量',
                        concurrent: '多档位并发请求，观察吞吐',
                        stream: '分块流式下载，测试持续吞吐',
                        media: '检测流媒体站点可达性',
                        multi: '对比多个 Worker 节点的延迟',
                        webrtc: '检测 WebRTC 是否泄漏真实 IP',
                        ttfb: '分阶段拆解请求耗时',
                        upload: '多档位上传，估算上行带宽',
                        audit: '审计目标站点 HTTP 安全响应头（HSTS/CSP…）并给出安全评分与响应性能',
                        quickcheck: '一键运行全部检测并生成评分报告',
                        bufferbloat: '负载下的延迟测试（缓冲膨胀），A–F 评级',
                        dnslookup: 'DNS 记录查询（DoH）与 IP 黑名单检测',
                        domaincheck: '域名邮件安全（MX/SPF/DMARC/DKIM）与声誉体检',
                        monitor: '定时巡检站点，异常自动 Webhook 告警',
                        dnscompare: '同一域名并发查询 4 个公共解析器并对比结果',
                        reach: '边缘侧与浏览器侧同时探测境内外站点，识别本地阻断',
                        proxy: '对比 HTTP 出口 IP 与 WebRTC 暴露 IP，识别代理/VPN',
                        quality: '长时延迟监控，输出 p50/p95/p99 与卡顿时间线',
                        multispeed: '多流并行下载，绘制实时速率曲线'
                    },
                    advice: {
                        rtt_fail: { cause: '探测全部失败：本网络无法到达边缘节点，或请求被拦截。', action: '检查本机防火墙/VPN 规则，换一个网络后重新体检。' },
                        rtt_high: { cause: '往返延迟偏高：边缘节点较远、链路拥塞，或本地接入较慢。', action: '与其他网络对比；若仅此网络慢，可向运营商反馈。' },
                        jitter_high: { cause: '延迟不稳定：Wi-Fi 干扰、缓冲膨胀（bufferbloat）或上行拥塞。', action: '优先使用有线/5GHz Wi-Fi，暂停后台传输后重测。' },
                        loss: { cause: '链路上存在丢包：无线干扰、拥塞或线路质量差。', action: '改用有线重测；若仍丢包，联系运营商排查。' },
                        rate_limited: { cause: '部分探测被限流，样本被丢弃。', action: '等 1 分钟后重跑，避免同时运行多个工具。' },
                        down_low: { cause: '下行吞吐偏低：信号弱、链路繁忙或服务端限速。', action: '关闭其它流量后重测，并对比 Wi-Fi 与有线。' },
                        up_low: { cause: '上行吞吐偏低：非对称带宽或上行拥塞时常见。', action: '测试期间避免上传，检查路由器 QoS 设置。' },
                        proto_old: { cause: '当前连接未使用 HTTP/2 或 HTTP/3。', action: '通常是代理或中间设备限制；可换现代浏览器或其它网络。' },
                        dns_fail: { cause: '边缘域名的 DNS 解析失败。', action: '检查 DNS 设置，可改用 1.1.1.1 或 8.8.8.8 后重试。' },
                        stall: { cause: '延迟多次超过中位值 2 倍。', action: '排查周期性后台流量（备份、更新）或无线漫游。' },
                        proxy_mismatch: { cause: 'HTTP 出口 IP 与 WebRTC 暴露 IP 不一致，说明存在代理/VPN 或分流。', action: '若非预期，请关闭代理/VPN 扩展或收紧浏览器的 WebRTC 策略。' }
                    }
                },
                'zh-TW': {
                    subtitle: '極光診斷 · 即時網路分析',
                    edgeLabel: '邊緣節點',
                    workerLabel: 'Worker 耗時',
                    live: '即時監控',
                    rtt: '即時延遲監控',
                    rttSub: 'RTT · 抖動 · 即時圖表 · 網路品質評估',
                    rttCurrent: '當前 RTT',
                    jitter: '抖動',
                    rttMin: '最低 RTT',
                    rttMax: '最高 RTT',
                    quality: '連線品質',
                    stability: '網路穩定性',
                    samples: '樣本數量',
                    loss: '丟包率',
                    sec: '安全與協議',
                    secSub: 'TLS · 加密 · 身份驗證',
                    secGroupTransport: '傳輸與協議',
                    secGroupOrigin: '來源與指紋',
                    geo: '邊緣節點位置',
                    geoSub: 'Cloudflare 資料中心',
                    userGeo: '真實 IP 位置',
                    userGeoSub: '客戶端地理位置 & 風險評分',
                    geoLoading: '定位中...',
                    toolsTitle: '診斷工具集',
                    toolsSub: '一鍵測試 · 全面診斷',
                    lossBtn: '丟包率',
                    speedBtn: '頻寬測速',
                    dnsBtn: 'DNS 解析',
                    cpuBtn: 'CPU 性能',
                    wsBtn: 'WebSocket',
                    concurrentBtn: '併發測試',
                    streamBtn: '串流傳輸',
                    mediaBtn: '串流媒體連通性',
                    multiBtn: '多節點對比',
                    dcLabel: '資料中心/代理',
                    risk: '風險等級',
                    asn: 'ASN',
                    protoLabel: '協議',
                    tlsVersion: 'TLS 版本',
                    cipher: '加密套件',
                    echLabel: 'ECH',
                    compressLabel: '壓縮演算法',
                    http2Label: 'HTTP/2 狀態',
                    botLabel: '機器人評分',
                    geoLocation: '位置',
                    geoCoord: '座標',
                    geoOrg: '運營商',
                    userLocation: '位置',
                    userDistance: '到節點距離',
                    userOrg: '運營商',
                    userIp: 'IP 位址',
                    hw: '硬體資訊',
                    hwSub: '客戶端環境',
                    historyTitle: '測速歷史',
                    historySub: '最近 10 條頻寬測速記錄',
                    noRecords: '暫無測速記錄',
                    historyKvOff: 'KV 寫入已關閉 · 測速歷史不儲存',
                    usageTitle: '用量統計',
                    usageSub: 'API 端點呼叫統計',
                    usageLocalNote: '本機工作階段統計 · 不寫入 KV',
                    loadingStats: '載入中...',
                    clientLabel: '客戶端',
                    copy: '複製報告',
                    copied: '已複製!',
                    powered: '由',
                    driven: '強力驅動',
                    yes: '是', no: '否',
                    clean: '低風險', high: '高風險',
                    unavailable: '獲取失敗',
                    lossTesting: '測試中...',
                    lossNone: '0% (無丟包)',
                    lossResult: '丟包率',
                    dnsTesting: '正在測試 DNS...',
                    speedTesting: '正在測速...',
                    cpuTesting: 'CPU 基準測試...',
                    wsTesting: 'WebSocket 延遲測試...',
                    concurrentTesting: '併發測試中...',
                    streamTesting: '串流吞吐量測試...',
                    mediaTesting: '正在檢測您 IP 的連通性...',
                    multiTesting: '正在對比節點...',
                    multiResult: '節點對比結果',
                    nodeName: '節點',
                    latency: '延遲 (ms)',
                    status: '狀態',
                    enterNodeUrls: '輸入節點 URL（每行一個）',
                    cancel: '取消',
                    start: '開始測試',
                    fraudScore: '詐欺評分',
                    proxy: '代理',
                    vpn: 'VPN',
                    tor: 'Tor',
                    hosting: '託管',
                    fraudLow: '低風險',
                    fraudMedium: '中風險',
                    fraudHigh: '高風險',
                    fraudUnknown: '未知',
                    echEnabled: '已啟用',
                    echDisabled: '未啟用',
                    http2Enabled: 'HTTP/2 已啟用',
                    http2Disabled: 'HTTP/1.1',
                    earlyHints: 'Early Hints',
                    webrtcBtn: 'WebRTC 洩漏',
                    ttfbBtn: 'TTFB 分析',
                    uploadBtn: '上傳測速',
                    webrtcTesting: '正在檢測 WebRTC 洩漏...',
                    webrtcSafe: '未檢測到洩漏',
                    webrtcLeak: '檢測到洩漏',
                    webrtcLocal: '內網 IP',
                    webrtcPublic: '公網 IP',
                    webrtcNone: '未發現 WebRTC 候選位址（安全）',
                    ttfbTesting: '正在分析 TTFB...',
                    ttfbDns: 'DNS 解析',
                    ttfbTcp: 'TCP 連線',
                    ttfbTls: 'TLS 握手',
                    ttfbWait: '等待回應 (TTFB)',
                    ttfbDownload: '內容下載',
                    ttfbTotal: '總計',
                    uploadTesting: '正在測試上傳速度...',
                    uploadResult: '上傳速度',
                    uploadFailed: '上傳測試失敗',
                    geoQueryFailed: '地理位置查詢失敗',
                    cores: '核心',
                    cpuPerf: 'CPU 性能',
                    cpuFailed: 'CPU 測試失敗',
                    wsLatency: 'WebSocket 延遲',
                    wsMin: '最小',
                    wsMax: '最大',
                    wsConnFailed: 'WebSocket 連線失敗',
                    wsTestFailed: 'WebSocket 測試失敗',
                    concurrentResultTitle: '併發測試結果',
                    concurrentRequests: '請求',
                    concurrentFailed: '併發測試失敗',
                    streamThroughput: '串流吞吐量',
                    lossPacketsLost: '丟失',
                    speedResultTitle: '頻寬測速結果',
                    speedAvg: '平均',
                    dnsResultTitle: 'DNS 解析結果',
                    dnsTimeout: '逾時',
                    mediaResultTitle: 'IP 連通性檢測結果',
                    mediaBlocked: '逾時或被阻',
                    mediaAvailable: '可存取',
                    mediaConnFailed: '連線失敗',
                    km: '公里',
                    ttfbFailed: 'TTFB 分析失敗',
                    historyAvgSpeed: '平均速度',
                    historyNode: '節點',
                    loadFailed: '載入失敗',
                    totalRequests: '總請求數',
                    waitingFirstReq: '等待首次請求...',
                    enterNodeUrlAlert: '請至少輸入一個節點 URL',
                    reportTitle: 'NetSight Pro 網路診斷報告',
                    reportGenTime: '產生時間',
                    reportNetMetrics: '網路指標',
                    reportSecProto: '安全與協議',
                    reportLocation: '位置資訊',
                    reportIpRisk: 'IP 風險資訊',
                    reportCompressNone: '無',
                    reportUnknown: '未知',
                    reportFooter: '報告由 NetSight Pro 自動產生 · 由 CF-workers-netdiag 強力驅動',
                    tabOverview: '概覽',
                    tabNetwork: '網路資訊',
                    tabTools: '診斷工具',
                    tabHistory: '歷史統計',
                    running: '執行中...',
                    metricDuration: '耗時',
                    detecting: '偵測中...',
                    themeTip: '切換主題',
                    pageTitle: 'NetSight Pro | 極光網路診斷',
                    rerun: '重新執行',
                    auditBtn: '站點健檢',
                    auditPrompt: '輸入要檢測的站點 URL',
                    auditRun: '開始檢測',
                    auditFinal: '最終網址',
                    auditStatus: '狀態碼',
                    auditTtfb: '首位元組',
                    auditTotal: '總耗時',
                    auditRedirects: '重新導向',
                    auditHeaders: '安全回應標頭',
                    auditMissing: '缺少',
                    auditInvalid: '請輸入有效的 http(s) 網址',
                    auditFailed: '檢測失敗',
                    quickcheckBtn: '一鍵體檢',
                    bufferbloatBtn: '緩衝膨脹測試',
                    dnslookupBtn: 'DNS 工具箱',
                    bbIntro: '在下載／上傳壓滿頻寬的同時測量延遲變化。空閒延遲與負載延遲之差越小越好（A 級 <30ms）。',
                    bbStart: '開始測試',
                    bbRunning: '測試中...（約 20 秒）',
                    bbBaseline: '空閒延遲',
                    bbLoadedDown: '負載延遲（下載）',
                    bbLoadedUp: '負載延遲（上傳）',
                    bbDelta: '延遲增幅',
                    bbGrade: '評級',
                    bbFailed: '測試失敗',
                    bbNoSamples: '有效樣本不足（可能觸發限流或網路異常）',
                    bbLimited: '負載階段觸發限流，結果可能不準確',
                    bbNote: '流量消耗隨頻寬增加（高速線路可達數百 MB）。',
                    dnsQueryBtn: '查詢',
                    dnsInvalidDomain: '請輸入有效網域（如 example.com）',
                    dnsNoRecords: '無記錄',
                    dnsLookupFailed: 'DNS 查詢失敗',
                    dnsblSection: 'IP 黑名單檢測',
                    dnsblBtn: '檢查',
                    dnsblInvalidIp: '請輸入有效 IPv4 位址',
                    dnsblListed: '已列入',
                    dnsblClean: '未列入',
                    dnsblRefused: '查詢被拒（公共解析器限制）',
                    dnsblUnknown: '未知／失敗',
                    dnsblNotice: '黑名單結果僅供參考；部分名單可能拒絕公共解析器查詢。',
                    qcStart: '開始體檢',
                    qcRunning: '體檢進行中...',
                    qcScore: '總分',
                    qcItemRtt: '延遲與抖動',
                    qcItemDown: '下載速度',
                    qcItemUp: '上傳速度',
                    qcItemProto: 'HTTP 協議',
                    qcItemDns: 'DNS 解析',
                    qcItemFraud: 'IP 風險評分',
                    qcIssues: '發現問題',
                    qcNoIssues: '一切正常，未發現問題',
                    qcNote: '將依序執行多項檢測（約 20–30 秒），消耗少量流量。',
                    domaincheckBtn: '網域安全檢查',
                    dcSelectorPh: 'DKIM 選擇器（可選）',
                    dcBlLabel: '黑名單／聲譽',
                    dcFound: '已設定',
                    dcMissing: '未找到',
                    dcNotTested: '未檢測',
                    dcWeak: '建議加強',
                    dcListed: '已被列入',
                    dcClean: '正常',
                    dcA_mxMissing: '未找到 MX 記錄：網域可能無法接收郵件',
                    dcA_spfMissing: '未設定 SPF：收件方無法驗證寄件來源，易被標記垃圾郵件',
                    dcA_spfMulti: '發現多條 SPF 記錄：會導致驗證失敗，應合併為一條',
                    dcA_spfWeak: 'SPF 以 ?all/+all 結尾：過於寬鬆，建議 ~all 或 -all',
                    dcA_dmarcMissing: '未設定 DMARC：無法防護偽造寄件人',
                    dcA_dmarcNone: 'DMARC 策略為 p=none：僅監控模式，建議升級到 quarantine/reject',
                    dcA_dkimMissing: '未找到此選擇器的 DKIM 記錄：檢查選擇器拼寫或設定簽章',
                    dcA_listed: '網域出現在黑名單：可能影響郵件送達',
                    monitorBtn: '站點監控',
                    monNote: '由 Worker 定時巡檢（需啟用 Cron Triggers），異常經 Webhook 告警；僅狀態變化時寫入儲存。',
                    monKeyPh: '管理密鑰（部署時設定 MONITOR_ADMIN_KEY）',
                    monUrlsPh: '每行一個 URL（最多 10 個）',
                    monHookPh: 'Webhook 網址（DingTalk / Feishu / WeCom / Slack）',
                    monSave: '儲存設定',
                    monRun: '立即檢測',
                    monUp: '正常',
                    monDown: '異常',
                    monStateNone: '未知',
                    monSince: '始於',
                    monEvents: '最近事件',
                    monNoEvents: '暫無事件',
                    monNoConfig: '尚未設定監控目標',
                    monKeyNeeded: '請先在 Worker 環境變數中設定 MONITOR_ADMIN_KEY',
                    monKeyBad: '管理密鑰不正確',
                    monKvMissing: '未綁定 KV（SPEED_HISTORY）',
                    monBadUrl: '包含無效 URL',
                    monMax: '最多 10 個 URL',
                    monKvWriteLimit: 'KV 今日寫入預算已用盡，設定未儲存，請稍後重試',
                    monBadPort: '僅允許 80/443 連接埠（請移除自訂連接埠或改用反向代理）',
                    shareImg: '產生分享圖',
                    shareLink: '複製分享連結',
                    shareBanner: '來自分享的體檢結果',
                    dnscompareBtn: '多解析器對比',
                    reachBtn: '網路可達性',
                    dcPrompt: '要對比的網域（A 記錄）',
                    dcTitle: '解析器對比',
                    dcConsistent: '各解析器結果一致',
                    dcInconsistent: '解析器結果不一致（可能有 CDN 調度或污染）',
                    dcFailed: '對比失敗',
                    reachTitle: '網路可達性檢測',
                    reachEdge: '邊緣側',
                    reachBrowser: '瀏覽器側',
                    reachOk: '可達',
                    reachBlocked: '不可達',
                    reachLikelyBlocked: '疑似被阻斷',
                    reachEdgeBlocked: '邊緣側不可達',
                    reachFailed: '探測失敗',
                    reachNote: '直接從你的瀏覽器探測目標站點（不經 Cloudflare 邊緣），反映你本地網路的可達性。',
                    proxyBtn: '代理/VPN 檢測',
                    proxyEgressIp: 'HTTP 出口 IP',
                    proxyWebrtcPublic: 'WebRTC 公網 IP',
                    proxyConsistent: '一致 · 未發現代理/VPN 跡象',
                    proxyMismatch: '不一致 · WebRTC 公網 IP 與 HTTP 出口 IP 不同',
                    proxyUndetermined: '無法判定 · 瀏覽器未暴露公網 WebRTC 候選',
                proxyLocalIp: '內網 IP',
                    proxyNote: '比對「HTTP 流量出口 IP」與「WebRTC 暴露的 IP」。兩者不一致通常代表使用了代理/VPN、分流（split tunnel），或瀏覽器 WebRTC 策略過於寬鬆。',
                    qualityBtn: '長時品質監控',
                    qualityIntro: '依所選時長每秒探測一次，輸出延遲分位（p50/p95/p99）、抖動、丟包與卡頓時間線。僅使用輕量 HEAD 請求。',
                    qualityStart: '開始監控',
                    qualityStop: '停止',
                    qualityRunning: '監控中',
                    qualityP50: 'p50（中位）',
                    qualityP95: 'p95',
                    qualityP99: 'p99',
                    qualityLoss: '丟包率',
                    qualitySamples: '樣本數',
                    qualityTimeline: '時間線（每 5 秒取最差值）',
                    qualityStalls: '卡頓次數（>2 倍中位）',
                    qualityDone: '監控結束',
                    qualityStopped: '已停止監控',
                    qualityNote: '長時間監控走 /health 配額：每秒 1 次遠低於每 IP 180 次/分的上限。',
                    multispeedBtn: '多流併發測速',
                    multispeedIntro: '以 4 條並行流下載（合計約 64 MB），繪製瞬時速率曲線，比單流測試更接近真實頻寬。',
                    multispeedStreams: '並行流',
                    multispeedTotal: '傳輸量',
                    multispeedAvg: '平均',
                    multispeedP95: '峰值(p95)',
                    multispeedStability: '穩定性',
                    multispeedRate: '速率 (Mbps)',
                    multispeedFailed: '多流測速失敗',
                    multispeedNote: '流量消耗隨頻寬增加；若使用計量網路請謹慎執行。',
                    grpQuality: '網路品質與延遲',
                    grpBandwidth: '頻寬與吞吐',
                    grpDns: 'DNS',
                    grpSecurity: '安全與合規',
                    grpReach: '可達性與多節點',
                    grpMonitor: '監控與系統',
                    adviceTitle: '診斷與建議',
                    adviceCause: '可能原因',
                    adviceAction: '建議動作',
                    historyLocalTitle: '測試歷史（本機）',
                    historyLocalSub: '最近 20 筆記錄 · 僅儲存在本機瀏覽器',
                    historyEmpty: '尚無本機記錄，執行一次測試即可開始收集',
                    historyClear: '清除本機記錄',
                    historyCleared: '已清除',
                    histQuickcheck: '一鍵體檢',
                    histSpeed: '頻寬測速',
                    histMultispeed: '多流測速',
                    histQuality: '品質監控',
                    histAudit: '站點健檢',
                    auditCertLabel: '同時檢查憑證到期（+1 次出站請求）',
                    certSkipped: '未檢查憑證',
                    certExpiring: 'TLS 憑證即將到期',
                    certExpired: 'TLS 憑證已過期',
                    auditScore: '安全評分',
                    auditChecks: '回應標頭檢查',
                    auditIssues: '問題',
                    auditPass: '通過',
                    auditWarn: '警告',
                    auditFailN: '缺失',
                    auditNoIssues: '未發現問題',
                    auditIssueMap: {
                        hsts_missing: '缺少 HSTS',
                        hsts_weak: 'HSTS max-age 過短',
                        csp_missing: '缺少 Content-Security-Policy',
                        csp_unsafe: 'CSP 允許 unsafe-inline',
                        xfo_missing: '缺少 X-Frame-Options',
                        xcto_missing: '缺少 X-Content-Type-Options',
                        refpol_missing: '缺少 Referrer-Policy',
                        server_leak: 'Server 標頭暴露軟體資訊',
                        no_https: '最終頁面未使用 HTTPS',
                        cert_expiring: 'TLS 憑證將在 14 天內到期',
                        cert_expired: 'TLS 憑證已過期'
                    },
                    toolDesc: {
                        loss: '連續探測端點，統計丟包率',
                        speed: '多檔位下載，估算下行頻寬',
                        dns: '解析主流站點，測量解析耗時',
                        cpu: 'Worker 端運算基準測試',
                        ws: 'WebSocket 往返延遲測量',
                        concurrent: '多檔位併發請求，觀察吞吐',
                        stream: '分塊串流下載，測試持續吞吐',
                        media: '檢測串流媒體站點可達性',
                        multi: '對比多個 Worker 節點的延遲',
                        webrtc: '檢測 WebRTC 是否洩漏真實 IP',
                        ttfb: '分階段拆解請求耗時',
                        upload: '多檔位上傳，估算上行頻寬',
                        audit: '稽核目標站點 HTTP 安全回應標頭（HSTS/CSP…）並給出安全評分與回應效能',
                        quickcheck: '一鍵執行全部檢測並生成評分報告',
                        bufferbloat: '負載下的延遲測試（緩衝膨脹），A–F 評級',
                        dnslookup: 'DNS 記錄查詢（DoH）與 IP 黑名單檢測',
                        domaincheck: '網域郵件安全（MX/SPF/DMARC/DKIM）與聲譽檢查',
                        monitor: '定時巡檢站點，異常自動 Webhook 告警',
                        dnscompare: '同一網域併發查詢 4 個公共解析器並對比結果',
                        reach: '邊緣側與瀏覽器側同時探測境內外站點，識別本地阻斷',
                        proxy: '比對 HTTP 出口 IP 與 WebRTC 暴露 IP，識別代理/VPN',
                        quality: '長時延遲監控，輸出 p50/p95/p99 與卡頓時間線',
                        multispeed: '多流並行下載，繪製即時速率曲線'
                    },
                    advice: {
                        rtt_fail: { cause: '探測全部失敗：本網路無法到達邊緣節點，或請求被封鎖。', action: '檢查本機防火牆/VPN 規則，換一個網路後重新體檢。' },
                        rtt_high: { cause: '往返延遲偏高：邊緣節點較遠、鏈路壅塞，或本地接取較慢。', action: '與其他網路對比；若僅此網路慢，可向電信商反映。' },
                        jitter_high: { cause: '延遲不穩定：Wi-Fi 干擾、緩衝膨脹（bufferbloat）或上行壅塞。', action: '優先使用有線/5GHz Wi-Fi，暫停背景傳輸後重測。' },
                        loss: { cause: '鏈路上存在丟包：無線干擾、壅塞或線路品質不佳。', action: '改以有線重測；若仍丟包，請聯繫電信商排查。' },
                        rate_limited: { cause: '部分探測被限流，樣本被丟棄。', action: '等 1 分鐘後重跑，避免同時執行多個工具。' },
                        down_low: { cause: '下行吞吐偏低：訊號弱、鏈路繁忙或伺服端限速。', action: '關閉其它流量後重測，並比較 Wi-Fi 與有線。' },
                        up_low: { cause: '上行吞吐偏低：非對稱頻寬或上行壅塞時常見。', action: '測試期間避免上傳，檢查路由器 QoS 設定。' },
                        proto_old: { cause: '目前連線未使用 HTTP/2 或 HTTP/3。', action: '通常是代理或中介設備限制；可換現代瀏覽器或其它網路。' },
                        dns_fail: { cause: '邊緣網域的 DNS 解析失敗。', action: '檢查 DNS 設定，可改用 1.1.1.1 或 8.8.8.8 後重試。' },
                        stall: { cause: '延遲多次超過中位值 2 倍。', action: '排查週期性背景流量（備份、更新）或無線漫遊。' },
                        proxy_mismatch: { cause: 'HTTP 出口 IP 與 WebRTC 暴露 IP 不一致，代表存在代理/VPN 或分流。', action: '若非預期，請關閉代理/VPN 擴充或收緊瀏覽器的 WebRTC 策略。' }
                    }
                }
            };

            // ==================== v4.8 新增功能的 i18n 扩展键（避免改动现有词典结构） ====================
            const I18N_EXTRA = {
                'en': {
                    waterfallBtn: 'Resource Waterfall',
                    waterfallNote: 'Collects Resource Timing data from this page and breaks down DNS / TCP / TLS / TTFB / download for each resource.',
                    waterfallIntro: 'Click Scan to collect resource timings from this page.',
                    waterfallScan: 'Scan',
                    wfResources: 'Resources',
                    wfProtocols: 'Protocols',
                    wfCached: 'Cached / X-origin',
                    wfDns: 'DNS',
                    wfTcp: 'TCP',
                    wfTls: 'TLS',
                    wfTtfb: 'TTFB',
                    wfDownload: 'Download',
                    wfTotal: 'Total',
                    wfEmpty: 'No resource timing data (browser may not support Resource Timing).',
                    wfNote: 'Bars are normalized per resource; values are in ms.',
                    netinfoBtn: 'Network Info',
                    netinfoNote: 'Shows browser Network Information API, storage quota and connection hints.',
                    netinfoIntro: 'Reading network info...',
                    netinfoConnType: 'Connection type',
                    netinfoDownlink: 'Downlink',
                    netinfoRtt: 'RTT',
                    netinfoSaveData: 'Data saver',
                    netinfoTimezone: 'Timezone',
                    netinfoStorage: 'Storage',
                    netinfoProtocol: 'Page protocol',
                    netinfoCores: 'CPU cores',
                    netinfoMemory: 'Device memory',
                    netinfoScreen: 'Screen',
                    netinfoPlatform: 'Platform',
                    netinfoLanguage: 'Language',
                    netinfoGeoMatch: 'Timezone / geo consistent',
                    netinfoGeoMismatch: 'Timezone / geo mismatch',
                    netinfoUnavailable: 'Unavailable',
                    netinfoYes: 'Yes',
                    netinfoNo: 'No',
                    speedModeLabel: 'Test mode',
                    speedModeQuick: 'Quick',
                    speedModeStandard: 'Standard',
                    speedModePrecise: 'Precise',
                    speedTtfb: 'First byte',
                    speedStdDev: 'Std dev',
                    speedBest: 'Best',
                    speedWorst: 'Worst',
                    speedSamples: 'Samples',
                    speedMedian: 'Median',
                    speedWarmup: 'Warming up connection...',
                    speedNote: 'Quick: 2 sizes x 1 round; Standard: 3 sizes x 2 rounds; Precise: 4 sizes x 3 rounds (more data).',
                    concurrentStreams: 'Streams',
                    concurrentSize: 'Size per stream',
                    concurrentTotal: 'Total throughput',
                    concurrentPerStream: 'Per stream',
                    concurrentNote: 'Runs real parallel downloads and reports aggregate throughput.',
                    historyTrend: 'Throughput trend',
                    historyCompare: 'Compare records',
                    historyFilter: 'Filter',
                    historyAll: 'All',
                    historyExportCsv: 'Export CSV',
                    historyExportJson: 'Export JSON',
                    historyImportJson: 'Import JSON',
                    historyNoNumeric: 'Not enough numeric history for a trend.',
                    historyCompareA: 'Record A',
                    historyCompareB: 'Record B',
                    historyCompareEmpty: 'Select two records to compare.',
                    historyTrendLabel: 'History',
                    shareBtn: 'Share',
                    shareSnapshotTitle: 'Shared snapshot',
                    shareSnapshotDesc: 'This link contains a read-only network snapshot generated by the sender.',
                    shareCopyLink: 'Copy share link',
                    shareTooLong: 'Snapshot is too large to share via URL.',
                    bbLoadLoss: 'Load loss',
                    bbSuggestion: 'Suggestion',
                    toolDesc: {
                        waterfall: 'Resource waterfall with DNS/TCP/TLS/TTFB breakdown',
                        netinfo: 'Browser network API, storage and connection details'
                    }
                },
                'zh-CN': {
                    waterfallBtn: '资源瀑布',
                    waterfallNote: '采集本页 Resource Timing 数据，拆分每个资源的 DNS / TCP / TLS / TTFB / 下载耗时。',
                    waterfallIntro: '点击「扫描」采集当前页面的资源时序数据。',
                    waterfallScan: '扫描',
                    wfResources: '资源数',
                    wfProtocols: '协议',
                    wfCached: '缓存/跨域',
                    wfDns: 'DNS',
                    wfTcp: 'TCP',
                    wfTls: 'TLS',
                    wfTtfb: '首字节',
                    wfDownload: '下载',
                    wfTotal: '总计',
                    wfEmpty: '没有可用的资源时序数据（浏览器可能不支持 Resource Timing）。',
                    wfNote: '条形按各资源自身总耗时归一化；数值单位为 ms。',
                    netinfoBtn: '网络信息',
                    netinfoNote: '展示浏览器 Network Information API、存储配额与连接提示。',
                    netinfoIntro: '正在读取网络信息...',
                    netinfoConnType: '连接类型',
                    netinfoDownlink: '下行估算',
                    netinfoRtt: 'RTT 估算',
                    netinfoSaveData: '省流模式',
                    netinfoTimezone: '时区',
                    netinfoStorage: '存储配额',
                    netinfoProtocol: '页面协议',
                    netinfoCores: 'CPU 核心',
                    netinfoMemory: '设备内存',
                    netinfoScreen: '屏幕',
                    netinfoPlatform: '平台',
                    netinfoLanguage: '语言',
                    netinfoGeoMatch: '时区/地理一致',
                    netinfoGeoMismatch: '时区/地理不一致',
                    netinfoUnavailable: '不可用',
                    netinfoYes: '是',
                    netinfoNo: '否',
                    speedModeLabel: '测试模式',
                    speedModeQuick: '快速',
                    speedModeStandard: '标准',
                    speedModePrecise: '精准',
                    speedTtfb: '首字节',
                    speedStdDev: '标准差',
                    speedBest: '最高',
                    speedWorst: '最低',
                    speedSamples: '样本数',
                    speedMedian: '中位数',
                    speedWarmup: '正在预热连接...',
                    speedNote: '快速：2 个尺寸 × 1 轮；标准：3 个尺寸 × 2 轮；精准：4 个尺寸 × 3 轮（流量更大）。',
                    concurrentStreams: '并发数',
                    concurrentSize: '单流大小',
                    concurrentTotal: '总吞吐',
                    concurrentPerStream: '单流速率',
                    concurrentNote: '真实并行下载，输出聚合吞吐。',
                    historyTrend: '吞吐趋势',
                    historyCompare: '记录对比',
                    historyFilter: '筛选',
                    historyAll: '全部',
                    historyExportCsv: '导出 CSV',
                    historyExportJson: '导出 JSON',
                    historyImportJson: '导入 JSON',
                    historyNoNumeric: '数值型历史不足，无法绘制趋势。',
                    historyCompareA: '记录 A',
                    historyCompareB: '记录 B',
                    historyCompareEmpty: '选择两条记录进行对比。',
                    historyTrendLabel: '历史',
                    shareBtn: '分享',
                    shareSnapshotTitle: '分享快照',
                    shareSnapshotDesc: '该链接包含发送方生成的只读网络快照。',
                    shareCopyLink: '复制分享链接',
                    shareTooLong: '快照过大，无法通过 URL 分享。',
                    bbLoadLoss: '加载丢包',
                    bbSuggestion: '建议',
                    toolDesc: {
                        waterfall: '资源瀑布与 DNS/TCP/TLS/TTFB 拆分',
                        netinfo: '浏览器网络 API、存储与连接详情'
                    }
                },
                'zh-TW': {
                    waterfallBtn: '資源瀑布',
                    waterfallNote: '擷取本頁 Resource Timing 資料，拆分每個資源的 DNS / TCP / TLS / TTFB / 下載耗時。',
                    waterfallIntro: '點擊「掃描」收集目前頁面的資源時序資料。',
                    waterfallScan: '掃描',
                    wfResources: '資源數',
                    wfProtocols: '協定',
                    wfCached: '快取/跨域',
                    wfDns: 'DNS',
                    wfTcp: 'TCP',
                    wfTls: 'TLS',
                    wfTtfb: '首位元組',
                    wfDownload: '下載',
                    wfTotal: '總計',
                    wfEmpty: '沒有可用的資源時序資料（瀏覽器可能不支援 Resource Timing）。',
                    wfNote: '長條依各資源自身總耗時歸一化；數值單位為 ms。',
                    netinfoBtn: '網路資訊',
                    netinfoNote: '顯示瀏覽器 Network Information API、儲存配額與連線提示。',
                    netinfoIntro: '正在讀取網路資訊...',
                    netinfoConnType: '連線類型',
                    netinfoDownlink: '下行估算',
                    netinfoRtt: 'RTT 估算',
                    netinfoSaveData: '省流模式',
                    netinfoTimezone: '時區',
                    netinfoStorage: '儲存配額',
                    netinfoProtocol: '頁面協定',
                    netinfoCores: 'CPU 核心',
                    netinfoMemory: '裝置記憶體',
                    netinfoScreen: '螢幕',
                    netinfoPlatform: '平台',
                    netinfoLanguage: '語言',
                    netinfoGeoMatch: '時區/地理一致',
                    netinfoGeoMismatch: '時區/地理不一致',
                    netinfoUnavailable: '不可用',
                    netinfoYes: '是',
                    netinfoNo: '否',
                    speedModeLabel: '測試模式',
                    speedModeQuick: '快速',
                    speedModeStandard: '標準',
                    speedModePrecise: '精準',
                    speedTtfb: '首位元組',
                    speedStdDev: '標準差',
                    speedBest: '最高',
                    speedWorst: '最低',
                    speedSamples: '樣本數',
                    speedMedian: '中位數',
                    speedWarmup: '正在預熱連線...',
                    speedNote: '快速：2 個尺寸 × 1 輪；標準：3 個尺寸 × 2 輪；精準：4 個尺寸 × 3 輪（流量更大）。',
                    concurrentStreams: '併發數',
                    concurrentSize: '單流大小',
                    concurrentTotal: '總吞吐',
                    concurrentPerStream: '單流速',
                    concurrentNote: '真實並行下載，輸出聚合吞吐。',
                    historyTrend: '吞吐趨勢',
                    historyCompare: '記錄比較',
                    historyFilter: '篩選',
                    historyAll: '全部',
                    historyExportCsv: '匯出 CSV',
                    historyExportJson: '匯出 JSON',
                    historyImportJson: '匯入 JSON',
                    historyNoNumeric: '數值型歷史不足，無法繪製趨勢。',
                    historyCompareA: '記錄 A',
                    historyCompareB: '記錄 B',
                    historyCompareEmpty: '選擇兩筆記錄進行比較。',
                    historyTrendLabel: '歷史',
                    shareBtn: '分享',
                    shareSnapshotTitle: '分享快照',
                    shareSnapshotDesc: '此連結包含寄件者產生的唯讀網路快照。',
                    shareCopyLink: '複製分享連結',
                    shareTooLong: '快照過大，無法透過 URL 分享。',
                    bbLoadLoss: '載入丟包',
                    bbSuggestion: '建議',
                    toolDesc: {
                        waterfall: '資源瀑布與 DNS/TCP/TLS/TTFB 拆分',
                        netinfo: '瀏覽器網路 API、儲存與連線詳情'
                    }
                }
            };
            (function mergeI18nExtra() {
                Object.keys(I18N_EXTRA).forEach(function (lang) {
                    const target = i18n[lang];
                    const extra = I18N_EXTRA[lang];
                    if (!target || !extra) return;
                    Object.keys(extra).forEach(function (key) {
                        if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key]) && target[key] && typeof target[key] === 'object') {
                            Object.assign(target[key], extra[key]);
                        } else {
                            target[key] = extra[key];
                        }
                    });
                });
            })();

            // ==================== v4.9 新增功能的 i18n 扩展键 ====================
            const I18N_EXTRA_V49 = {
                'en': {
                    dcDnssec: 'DNSSEC', dcCaa: 'CAA', dcMtaSts: 'MTA-STS', dcBimi: 'BIMI', dcNs: 'NS',
                    dcEnabled: 'Enabled', dcDisabled: 'Not enabled', dcAd: 'AD',
                    dcA_dnssecMissing: 'DNSSEC not enabled', dcA_caaMissing: 'No CAA record',
                    dcA_mtaStsMissing: 'No MTA-STS policy', dcA_bimiMissing: 'No BIMI record',
                    dcA_nsInsufficient: 'Fewer than 2 NS records',
                    monFormat: 'Alert format', monChatId: 'Telegram chat ID (optional)',
                    monThreshold: 'Alert after consecutive failures', monQuiet: 'Quiet hours (e.g. 23:00-08:00)',
                    monMaint: 'Maintenance minutes (0=off)', monCert: 'Certificate', monCertCheck: 'Check certificate expiry',
                    monCertDays: 'Certificate days left', monFailures: 'Consecutive failures',
                    monSuppressed: 'Suppressed by quiet hours / maintenance', monBadQuiet: 'Invalid quiet hours (use HH:MM-HH:MM)'
                },
                'zh-CN': {
                    dcDnssec: 'DNSSEC', dcCaa: 'CAA', dcMtaSts: 'MTA-STS', dcBimi: 'BIMI', dcNs: 'NS',
                    dcEnabled: '已启用', dcDisabled: '未启用', dcAd: 'AD',
                    dcA_dnssecMissing: '未启用 DNSSEC', dcA_caaMissing: '缺少 CAA 记录',
                    dcA_mtaStsMissing: '缺少 MTA-STS 策略', dcA_bimiMissing: '缺少 BIMI 记录',
                    dcA_nsInsufficient: 'NS 记录少于 2 条',
                    monFormat: '告警格式', monChatId: 'Telegram chat ID（可选）',
                    monThreshold: '连续失败几次后告警', monQuiet: '静默时段（如 23:00-08:00）',
                    monMaint: '维护窗口分钟数（0=关闭）', monCert: '证书', monCertCheck: '检查证书到期',
                    monCertDays: '证书剩余天数', monFailures: '连续失败',
                    monSuppressed: '被静默时段/维护窗口抑制', monBadQuiet: '静默时段格式错误（HH:MM-HH:MM）'
                },
                'zh-TW': {
                    dcDnssec: 'DNSSEC', dcCaa: 'CAA', dcMtaSts: 'MTA-STS', dcBimi: 'BIMI', dcNs: 'NS',
                    dcEnabled: '已啟用', dcDisabled: '未啟用', dcAd: 'AD',
                    dcA_dnssecMissing: '未啟用 DNSSEC', dcA_caaMissing: '缺少 CAA 記錄',
                    dcA_mtaStsMissing: '缺少 MTA-STS 原則', dcA_bimiMissing: '缺少 BIMI 記錄',
                    dcA_nsInsufficient: 'NS 記錄少於 2 筆',
                    monFormat: '告警格式', monChatId: 'Telegram chat ID（選填）',
                    monThreshold: '連續失敗幾次後告警', monQuiet: '靜默時段（如 23:00-08:00）',
                    monMaint: '維護視窗分鐘數（0=關閉）', monCert: '憑證', monCertCheck: '檢查憑證到期',
                    monCertDays: '憑證剩餘天數', monFailures: '連續失敗',
                    monSuppressed: '被靜默時段/維護視窗抑制', monBadQuiet: '靜默時段格式錯誤（HH:MM-HH:MM）'
                }
            };
            (function mergeI18nExtraV49() {
                Object.keys(I18N_EXTRA_V49).forEach(function (lang) {
                    const target = i18n[lang];
                    const extra = I18N_EXTRA_V49[lang];
                    if (!target || !extra) return;
                    Object.keys(extra).forEach(function (key) { target[key] = extra[key]; });
                });
            })();

            // ==================== 多语言扩展（ja / ko / es） ====================
            const I18N_MORE = {
                ja: {
  "subtitle": "Aurora Diagnostics · リアルタイムネットワーク分析",
  "edgeLabel": "エッジノード",
  "workerLabel": "Worker 時間",
  "live": "ライブ監視",
  "rtt": "リアルタイム RTT",
  "rttSub": "RTT · ジッター · ライブチャート · ネットワーク品質",
  "rttCurrent": "現在の RTT",
  "jitter": "ジッター",
  "rttMin": "最小 RTT",
  "rttMax": "最大 RTT",
  "quality": "接続品質",
  "stability": "ネットワーク安定性",
  "samples": "サンプル数",
  "loss": "損失率",
  "sec": "セキュリティとプロトコル",
  "secSub": "TLS · 暗号化 · 認証",
  "secGroupTransport": "トランスポートとプロトコル",
  "secGroupOrigin": "オリジンとフィンガープリント",
  "geo": "エッジ拠点",
  "geoSub": "Cloudflare データセンター",
  "userGeo": "クライアント拠点",
  "userGeoSub": "クライアントの位置情報とリスクスコア",
  "geoLoading": "位置情報を取得中...",
  "toolsTitle": "診断ツール",
  "toolsSub": "ワンクリックテスト · 総合診断",
  "lossBtn": "パケット損失",
  "speedBtn": "帯域幅",
  "dnsBtn": "DNS",
  "cpuBtn": "CPU",
  "wsBtn": "WebSocket",
  "concurrentBtn": "同時接続",
  "streamBtn": "ストリーム",
  "mediaBtn": "動画配信の接続性",
  "multiBtn": "複数ノード比較",
  "dcLabel": "DC / プロキシ",
  "risk": "リスクレベル",
  "asn": "ASN",
  "protoLabel": "プロトコル",
  "tlsVersion": "TLS バージョン",
  "cipher": "暗号スイート",
  "echLabel": "ECH",
  "compressLabel": "圧縮",
  "http2Label": "HTTP/2",
  "botLabel": "ボットスコア",
  "geoLocation": "場所",
  "geoCoord": "座標",
  "geoOrg": "ISP",
  "userLocation": "場所",
  "userDistance": "ノードまでの距離",
  "userOrg": "ISP",
  "userIp": "IP アドレス",
  "hw": "ハードウェア情報",
  "hwSub": "クライアント環境",
  "historyTitle": "速度履歴",
  "historySub": "直近 10 件の帯域幅記録",
  "noRecords": "速度の記録はありません",
  "historyKvOff": "KV 書き込み無効 · 速度履歴は保存されません",
  "usageTitle": "使用状況",
  "usageSub": "API エンドポイント呼び出し",
  "usageLocalNote": "ローカルセッションのカウンター · KV 書き込みなし",
  "loadingStats": "読み込み中...",
  "clientLabel": "クライアント",
  "copy": "レポートをコピー",
  "copied": "コピーしました！",
  "powered": "提供",
  "driven": "搭載",
  "yes": "はい",
  "no": "いいえ",
  "clean": "低リスク",
  "high": "高リスク",
  "unavailable": "利用不可",
  "lossTesting": "テスト中...",
  "lossNone": "0%（損失なし）",
  "lossResult": "損失",
  "dnsTesting": "DNS をテスト中...",
  "speedTesting": "帯域幅をテスト中...",
  "cpuTesting": "CPU ベンチマーク中...",
  "wsTesting": "WebSocket レイテンシ計測中...",
  "concurrentTesting": "同時接続テスト中...",
  "streamTesting": "ストリームスループット計測中...",
  "mediaTesting": "お使いの IP から接続性をテスト中...",
  "multiTesting": "ノードを比較中...",
  "multiResult": "ノード比較結果",
  "nodeName": "ノード",
  "latency": "レイテンシ (ms)",
  "status": "ステータス",
  "enterNodeUrls": "ノード URL を入力（1 行に 1 つ）",
  "cancel": "キャンセル",
  "start": "テスト開始",
  "fraudScore": "不正スコア",
  "proxy": "プロキシ",
  "vpn": "VPN",
  "tor": "Tor",
  "hosting": "ホスティング",
  "fraudLow": "低リスク",
  "fraudMedium": "中リスク",
  "fraudHigh": "高リスク",
  "fraudUnknown": "不明",
  "echEnabled": "有効",
  "echDisabled": "無効",
  "http2Enabled": "HTTP/2 有効",
  "http2Disabled": "HTTP/1.1",
  "earlyHints": "Early Hints",
  "webrtcBtn": "WebRTC リーク",
  "ttfbBtn": "TTFB 分析",
  "uploadBtn": "アップロード速度",
  "webrtcTesting": "WebRTC リークを検出中...",
  "webrtcSafe": "リークなし",
  "webrtcLeak": "リークを検出",
  "webrtcLocal": "ローカル IP",
  "webrtcPublic": "パブリック IP",
  "webrtcNone": "WebRTC 候補が見つかりません（安全）",
  "ttfbTesting": "TTFB を分析中...",
  "ttfbDns": "DNS ルックアップ",
  "ttfbTcp": "TCP 接続",
  "ttfbTls": "TLS ハンドシェイク",
  "ttfbWait": "待機 (TTFB)",
  "ttfbDownload": "ダウンロード",
  "ttfbTotal": "合計",
  "uploadTesting": "アップロード速度をテスト中...",
  "uploadResult": "アップロード速度",
  "uploadFailed": "アップロードテストに失敗しました",
  "geoQueryFailed": "位置情報の取得に失敗しました",
  "cores": "コア",
  "cpuPerf": "CPU パフォーマンス",
  "cpuFailed": "CPU テストに失敗しました",
  "wsLatency": "WebSocket レイテンシ",
  "wsMin": "最小",
  "wsMax": "最大",
  "wsConnFailed": "WebSocket 接続に失敗しました",
  "wsTestFailed": "WebSocket テストに失敗しました",
  "concurrentResultTitle": "同時接続テスト結果",
  "concurrentRequests": "リクエスト",
  "concurrentFailed": "同時接続テストに失敗しました",
  "streamThroughput": "ストリームスループット",
  "lossPacketsLost": "損失",
  "speedResultTitle": "帯域幅の結果",
  "speedAvg": "平均",
  "dnsResultTitle": "DNS 解決結果",
  "dnsTimeout": "タイムアウト",
  "mediaResultTitle": "IP 接続性の結果",
  "mediaBlocked": "ブロック / タイムアウト",
  "mediaAvailable": "アクセス可能",
  "mediaConnFailed": "接続に失敗しました",
  "km": "km",
  "ttfbFailed": "TTFB 分析に失敗しました",
  "historyAvgSpeed": "平均速度",
  "historyNode": "ノード",
  "loadFailed": "読み込みに失敗しました",
  "totalRequests": "総リクエスト数",
  "waitingFirstReq": "最初のリクエストを待機中...",
  "enterNodeUrlAlert": "ノード URL を 1 つ以上入力してください",
  "reportTitle": "NetSight Pro ネットワーク診断レポート",
  "reportGenTime": "生成日時",
  "reportNetMetrics": "ネットワーク指標",
  "reportSecProto": "セキュリティとプロトコル",
  "reportLocation": "位置情報",
  "reportIpRisk": "IP リスク情報",
  "reportCompressNone": "なし",
  "reportUnknown": "不明",
  "reportFooter": "NetSight Pro が自動生成したレポート · CF-workers-netdiag 提供",
  "tabOverview": "概要",
  "tabNetwork": "ネットワーク",
  "tabTools": "診断",
  "tabHistory": "履歴",
  "running": "実行中...",
  "metricDuration": "所要時間",
  "detecting": "検出中...",
  "themeTip": "テーマを切り替え",
  "pageTitle": "NetSight Pro | Aurora ネットワーク診断",
  "rerun": "再実行",
  "auditBtn": "サイト監査",
  "auditPrompt": "監査するサイトの URL を入力",
  "auditRun": "監査を実行",
  "auditFinal": "最終 URL",
  "auditStatus": "ステータス",
  "auditTtfb": "TTFB",
  "auditTotal": "合計",
  "auditRedirects": "リダイレクト",
  "auditHeaders": "セキュリティヘッダー",
  "auditMissing": "未設定",
  "auditInvalid": "有効な http(s) URL を入力してください",
  "auditFailed": "監査に失敗しました",
  "quickcheckBtn": "クイックヘルスチェック",
  "bufferbloatBtn": "バッファブロートテスト",
  "dnslookupBtn": "DNS ツールボックス",
  "bbIntro": "回線をダウンロードとアップロードで飽和させたときのレイテンシ増加を測定します。増加が小さいほど良好です（A < 30ms）。",
  "bbStart": "テスト開始",
  "bbRunning": "テスト中...（約 20 秒）",
  "bbBaseline": "待機時のレイテンシ",
  "bbLoadedDown": "負荷時（ダウンロード）",
  "bbLoadedUp": "負荷時（アップロード）",
  "bbDelta": "増加量",
  "bbGrade": "評価",
  "bbFailed": "テストに失敗しました",
  "bbNoSamples": "有効なサンプルが不足しています（レート制限またはネットワークの問題）",
  "bbLimited": "負荷フェーズでレート制限に達しました - 結果が不正確になる可能性があります",
  "bbNote": "通信量は帯域幅に比例します（高速回線では最大数百 MB）。",
  "dnsQueryBtn": "照会",
  "dnsInvalidDomain": "有効なドメインを入力してください（例: example.com）",
  "dnsNoRecords": "レコードがありません",
  "dnsLookupFailed": "DNS ルックアップに失敗しました",
  "dnsblSection": "IP ブロックリストチェック",
  "dnsblBtn": "チェック",
  "dnsblInvalidIp": "有効な IPv4 アドレスを入力してください",
  "dnsblListed": "登録あり",
  "dnsblClean": "登録なし",
  "dnsblRefused": "拒否されました（パブリックリゾルバーの制限）",
  "dnsblUnknown": "不明 / 失敗",
  "dnsblNotice": "ブロックリストの結果は参考情報です。一部のリストはパブリックリゾルバーからの照会を拒否する場合があります。",
  "qcStart": "ヘルスチェック開始",
  "qcRunning": "チェックを実行中...",
  "qcScore": "スコア",
  "qcItemRtt": "レイテンシとジッター",
  "qcItemDown": "ダウンロード",
  "qcItemUp": "アップロード",
  "qcItemProto": "HTTP プロトコル",
  "qcItemDns": "DNS 解決",
  "qcItemFraud": "IP リスクスコア",
  "qcIssues": "検出された問題",
  "qcNoIssues": "すべて良好 - 問題は見つかりませんでした",
  "qcNote": "複数の診断を順に実行します（約 20〜30 秒）。通信量を消費します。",
  "domaincheckBtn": "ドメインセキュリティチェック",
  "dcSelectorPh": "DKIM セレクター（任意）",
  "dcBlLabel": "ブロックリストとレピュテーション",
  "dcFound": "設定済み",
  "dcMissing": "未検出",
  "dcNotTested": "未テスト",
  "dcWeak": "強化が必要",
  "dcListed": "登録あり",
  "dcClean": "クリーン",
  "dcA_mxMissing": "MX レコードがありません。このドメインはメールを受信できない可能性があります",
  "dcA_spfMissing": "SPF レコードがありません。受信側が送信者を検証できず、スパム判定のリスクがあります",
  "dcA_spfMulti": "複数の SPF レコードが見つかりました。SPF が無効になるため 1 つに統合してください",
  "dcA_spfWeak": "SPF が ?all/+all で終わっています。緩すぎるため ~all または -all を推奨します",
  "dcA_dmarcMissing": "DMARC レコードがありません。なりすまし対策が未設定です",
  "dcA_dmarcNone": "DMARC ポリシーが p=none です。監視のみのため quarantine/reject への強化を推奨します",
  "dcA_dkimMissing": "このセレクターの DKIM レコードがありません。セレクターを確認するか DKIM 署名を設定してください",
  "dcA_listed": "ドメインがブロックリストに登録されています。メール到達率に影響する可能性があります",
  "monitorBtn": "サイトモニター",
  "monNote": "Worker がスケジュールに従って対象をチェックします（Cron Triggers が必要）。アラートは Webhook 経由で送信され、ストレージは状態変化時のみ書き込まれます。",
  "monKeyPh": "管理者キー（デプロイ時に MONITOR_ADMIN_KEY を設定）",
  "monUrlsPh": "1 行に 1 つの URL（最大 10 件）",
  "monHookPh": "Webhook URL（DingTalk / Feishu / WeCom / Slack...）",
  "monSave": "設定を保存",
  "monRun": "今すぐチェック",
  "monUp": "稼働中",
  "monDown": "停止中",
  "monStateNone": "不明",
  "monSince": "から",
  "monEvents": "最近のイベント",
  "monNoEvents": "イベントはまだありません",
  "monNoConfig": "監視対象が設定されていません",
  "monKeyNeeded": "先に Worker 環境で MONITOR_ADMIN_KEY を設定してください",
  "monKeyBad": "管理者キーが正しくありません",
  "monKvMissing": "KV (SPEED_HISTORY) がバインドされていません",
  "monBadUrl": "無効な URL が含まれています",
  "monMax": "URL は最大 10 件",
  "monKvWriteLimit": "本日の KV 書き込み上限に達しました - 設定は保存されていません。後でもう一度お試しください",
  "monBadPort": "ポートは 80/443 のみ使用できます - カスタムポートを削除するか、リバースプロキシを使用してください",
  "shareImg": "画像を共有",
  "shareLink": "共有リンクをコピー",
  "shareBanner": "共有されたヘルスチェック結果",
  "dnscompareBtn": "DNS 比較",
  "reachBtn": "到達性",
  "dcPrompt": "比較するドメイン（A レコード）",
  "dcTitle": "リゾルバー比較",
  "dcConsistent": "すべてのリゾルバーが一致",
  "dcInconsistent": "リゾルバー間で不一致（CDN の切り替えやポイズニングの可能性）",
  "dcFailed": "比較に失敗しました",
  "reachTitle": "ネットワーク到達性",
  "reachEdge": "エッジ",
  "reachBrowser": "ブラウザ",
  "reachOk": "到達可能",
  "reachBlocked": "到達不可",
  "reachLikelyBlocked": "あなたの環境ではブロックされている可能性",
  "reachEdgeBlocked": "エッジから到達不可",
  "reachFailed": "プローブに失敗しました",
  "reachNote": "対象サイトへブラウザから直接プローブします（Cloudflare エッジ経由のリクエストは行いません）。ローカルネットワークからの到達性を反映します。",
  "proxyBtn": "プロキシ / VPN チェック",
  "proxyEgressIp": "HTTP 出口 IP",
  "proxyWebrtcPublic": "WebRTC パブリック IP",
  "proxyConsistent": "一致 - プロキシ/VPN の不一致は検出されませんでした",
  "proxyMismatch": "不一致 - WebRTC のパブリック IP が HTTP 出口 IP と異なります",
  "proxyUndetermined": "判定不能 - ブラウザがパブリックな WebRTC 候補を公開しませんでした",
  "proxyLocalIp": "ローカル IP",
  "proxyNote": "HTTP 通信の出口 IP と WebRTC で見える IP を比較します。不一致は通常プロキシ/VPN、スプリットトンネリング、ブラウザ設定の不備を示します。",
  "qualityBtn": "品質モニター",
  "qualityIntro": "選択した時間中 1 秒ごとにプローブし、レイテンシのパーセンタイル（p50/p95/p99）、ジッター、損失、スタールのタイムラインを表示します。軽量な HEAD リクエストのみを使用します。",
  "qualityStart": "監視を開始",
  "qualityStop": "停止",
  "qualityRunning": "監視中",
  "qualityP50": "p50（中央値）",
  "qualityP95": "p95",
  "qualityP99": "p99",
  "qualityLoss": "損失",
  "qualitySamples": "サンプル数",
  "qualityTimeline": "タイムライン（5 秒ごとの最悪値）",
  "qualityStalls": "スタール（中央値の 2 倍超）",
  "qualityDone": "監視が完了しました",
  "qualityStopped": "監視を停止しました",
  "qualityNote": "長時間実行すると /health のクォータを消費します。1 秒 1 サンプルなら IP あたり 180 回/分の制限内に十分収まります。",
  "multispeedBtn": "マルチストリーム速度",
  "multispeedIntro": "4 並列ストリームでダウンロード（合計約 64 MB）し、瞬間速度をグラフ化します。単一ストリームのテストより実際の帯域幅に近い値が得られます。",
  "multispeedStreams": "ストリーム数",
  "multispeedTotal": "転送量",
  "multispeedAvg": "平均",
  "multispeedP95": "ピーク (p95)",
  "multispeedStability": "安定性",
  "multispeedRate": "速度 (Mbps)",
  "multispeedFailed": "マルチストリームテストに失敗しました",
  "multispeedNote": "通信量は帯域幅に比例します。従量制回線ではテストを中止してください。",
  "grpQuality": "ネットワーク品質とレイテンシ",
  "grpBandwidth": "帯域幅とスループット",
  "grpDns": "DNS",
  "grpSecurity": "セキュリティとコンプライアンス",
  "grpReach": "到達性とノード",
  "grpMonitor": "監視とシステム",
  "adviceTitle": "診断とアドバイス",
  "adviceCause": "考えられる原因",
  "adviceAction": "推奨される対処",
  "historyLocalTitle": "テスト履歴（ローカル）",
  "historyLocalSub": "直近 20 件の結果 - このブラウザにのみ保存されます",
  "historyEmpty": "ローカル記録はまだありません - テストを実行して収集を開始できます",
  "historyClear": "ローカル履歴を消去",
  "historyCleared": "消去しました",
  "histQuickcheck": "ヘルスチェック",
  "histSpeed": "速度テスト",
  "histMultispeed": "マルチストリーム",
  "histQuality": "品質モニター",
  "histAudit": "サイト監査",
  "auditCertLabel": "証明書の有効期限も確認（送信リクエスト +1）",
  "certSkipped": "証明書チェックをスキップしました",
  "certExpiring": "TLS 証明書の有効期限が近づいています",
  "certExpired": "TLS 証明書の有効期限が切れています",
  "auditScore": "セキュリティスコア",
  "auditChecks": "ヘッダーチェック",
  "auditIssues": "問題",
  "auditPass": "合格",
  "auditWarn": "警告",
  "auditFailN": "未設定",
  "auditNoIssues": "問題は見つかりませんでした",
  "auditIssueMap": {
    "hsts_missing": "HSTS が未設定です",
    "hsts_weak": "HSTS の max-age が短すぎます",
    "csp_missing": "Content-Security-Policy が未設定です",
    "csp_unsafe": "CSP が unsafe-inline を許可しています",
    "xfo_missing": "X-Frame-Options が未設定です",
    "xcto_missing": "X-Content-Type-Options が未設定です",
    "refpol_missing": "Referrer-Policy が未設定です",
    "server_leak": "Server ヘッダーがソフトウェア情報を公開しています",
    "no_https": "最終ページが HTTPS ではありません",
    "cert_expiring": "TLS 証明書が 14 日以内に期限切れになります",
    "cert_expired": "TLS 証明書は既に期限切れです"
  },
  "toolDesc": {
    "loss": "エンドポイントを繰り返しプローブしてパケット損失を測定",
    "speed": "複数サイズのダウンロードで下り帯域幅を推定",
    "dns": "人気サイトを解決してルックアップ時間を測定",
    "cpu": "Worker 側の計算ベンチマーク",
    "ws": "WebSocket の往復レイテンシを測定",
    "concurrent": "複数のレベルで同時リクエストを送信",
    "stream": "チャンクストリーミングダウンロードのスループット",
    "media": "動画配信サービスの到達性をチェック",
    "multi": "複数の Worker ノード間でレイテンシを比較",
    "webrtc": "WebRTC が実際の IP を漏らしているか検出",
    "ttfb": "リクエストのタイミングを段階ごとに分解",
    "upload": "複数サイズのアップロードで上り帯域幅を推定",
    "audit": "サイトの HTTP セキュリティヘッダー（HSTS/CSP/...）と応答時間を採点",
    "quickcheck": "すべての診断を実行し、スコア付きレポートを生成",
    "bufferbloat": "負荷時のレイテンシ（バッファブロート）を A-F 評価で表示",
    "dnslookup": "DNS レコード検索（DoH）と IP ブロックリストチェック",
    "domaincheck": "ドメインの MX/SPF/DMARC/DKIM とレピュテーションをチェック",
    "monitor": "スケジュール実行の稼働監視と Webhook アラート",
    "dnscompare": "同じ名前を 4 つのパブリックリゾルバーで照会し、応答を比較",
    "reach": "中国と世界各地のサイトをエッジとブラウザからプローブ",
    "proxy": "HTTP 出口 IP と WebRTC で公開される IP を比較してプロキシ/VPN を検出",
    "quality": "p50/p95/p99 とスタールタイムラインによる長時間レイテンシ監視",
    "multispeed": "並列マルチストリームダウンロードとリアルタイム速度グラフ",
    "waterfall": "DNS/TCP/TLS/TTFB の内訳付きリソースウォーターフォール",
    "netinfo": "ブラウザのネットワーク API、ストレージ、接続の詳細"
  },
  "advice": {
    "rtt_fail": {
      "cause": "プローブが完了しませんでした。このネットワークからエッジに到達できないか、リクエストがブロックされています。",
      "action": "ローカルのファイアウォール/VPN 設定を確認し、別のネットワークで再度ヘルスチェックを実行してください。"
    },
    "rtt_high": {
      "cause": "往復時間が長い状態です。エッジが遠い、経路が混雑している、またはローカル回線が遅い可能性があります。",
      "action": "別のネットワークと比較してください。このネットワークだけ遅い場合は ISP に報告してください。"
    },
    "jitter_high": {
      "cause": "レイテンシが不安定です。Wi-Fi の干渉、バッファブロート、上り回線の混雑が考えられます。",
      "action": "有線または 5 GHz の Wi-Fi を使用し、バックグラウンド転送を停止して再テストしてください。"
    },
    "loss": {
      "cause": "経路上でパケット損失が発生しています。無線の干渉、混雑、回線の不具合が考えられます。",
      "action": "有線接続で再テストしてください。損失が続く場合は ISP に連絡してください。"
    },
    "rate_limited": {
      "cause": "一部のプローブがレート制限され、そのサンプルは破棄されました。",
      "action": "1 分待って再実行するか、複数のツールを同時に実行しないようにしてください。"
    },
    "down_low": {
      "cause": "ダウンロードのスループットが低い状態です。電波が弱い、回線が混雑している、サーバー側で制限されている可能性があります。",
      "action": "他の通信を止めて再テストし、Wi-Fi と有線を比較してください。"
    },
    "up_low": {
      "cause": "アップロードのスループットが低い状態です。非対称回線や混雑時に多く見られます。",
      "action": "テスト中はアップロードを控え、ルーターの QoS 設定を確認してください。"
    },
    "proto_old": {
      "cause": "接続が HTTP/2 または HTTP/3 を使用していません。",
      "action": "通常はプロキシや中間機器の制限です。最新のブラウザや別のネットワークで試してください。"
    },
    "dns_fail": {
      "cause": "エッジのホスト名の DNS 解決に失敗しました。",
      "action": "DNS 設定を確認し、1.1.1.1 または 8.8.8.8 を試してから再実行してください。"
    },
    "stall": {
      "cause": "中央値の 2 倍を超えるレイテンシの急増が繰り返されています。",
      "action": "定期的なバックグラウンド通信（バックアップ、更新）や無線のローミングがないか確認してください。"
    },
    "proxy_mismatch": {
      "cause": "HTTP 出口 IP と WebRTC で公開される IP が異なります。プロキシ/VPN またはスプリットトンネリングを示します。",
      "action": "想定外の場合は、プロキシ/VPN 拡張機能を無効にするか、WebRTC ポリシーを厳格化してください。"
    }
  },
  "waterfallBtn": "リソースウォーターフォール",
  "waterfallNote": "このページの Resource Timing データを収集し、リソースごとに DNS / TCP / TLS / TTFB / ダウンロードを分解します。",
  "waterfallIntro": "「スキャン」をクリックして、このページのリソースタイミングを収集します。",
  "waterfallScan": "スキャン",
  "wfResources": "リソース",
  "wfProtocols": "プロトコル",
  "wfCached": "キャッシュ / クロスオリジン",
  "wfDns": "DNS",
  "wfTcp": "TCP",
  "wfTls": "TLS",
  "wfTtfb": "TTFB",
  "wfDownload": "ダウンロード",
  "wfTotal": "合計",
  "wfEmpty": "リソースタイミングデータがありません（ブラウザが Resource Timing に対応していない可能性があります）。",
  "wfNote": "バーはリソースごとに正規化されています。値の単位は ms です。",
  "netinfoBtn": "ネットワーク情報",
  "netinfoNote": "ブラウザの Network Information API、ストレージ容量、接続のヒントを表示します。",
  "netinfoIntro": "ネットワーク情報を取得中...",
  "netinfoConnType": "接続タイプ",
  "netinfoDownlink": "下り速度",
  "netinfoRtt": "RTT",
  "netinfoSaveData": "データセーバー",
  "netinfoTimezone": "タイムゾーン",
  "netinfoStorage": "ストレージ",
  "netinfoProtocol": "ページのプロトコル",
  "netinfoCores": "CPU コア数",
  "netinfoMemory": "デバイスメモリ",
  "netinfoScreen": "画面",
  "netinfoPlatform": "プラットフォーム",
  "netinfoLanguage": "言語",
  "netinfoGeoMatch": "タイムゾーンと位置情報が一致",
  "netinfoGeoMismatch": "タイムゾーンと位置情報が不一致",
  "netinfoUnavailable": "利用不可",
  "netinfoYes": "はい",
  "netinfoNo": "いいえ",
  "speedModeLabel": "テストモード",
  "speedModeQuick": "クイック",
  "speedModeStandard": "標準",
  "speedModePrecise": "高精度",
  "speedTtfb": "初回バイト",
  "speedStdDev": "標準偏差",
  "speedBest": "最高",
  "speedWorst": "最低",
  "speedSamples": "サンプル数",
  "speedMedian": "中央値",
  "speedWarmup": "接続をウォームアップ中...",
  "speedNote": "クイック: 2 サイズ × 1 回、標準: 3 サイズ × 2 回、高精度: 4 サイズ × 3 回（通信量が増えます）。",
  "concurrentStreams": "ストリーム数",
  "concurrentSize": "ストリームあたりのサイズ",
  "concurrentTotal": "合計スループット",
  "concurrentPerStream": "ストリームあたり",
  "concurrentNote": "実際の並列ダウンロードを実行し、合計スループットを表示します。",
  "historyTrend": "スループット推移",
  "historyCompare": "記録を比較",
  "historyFilter": "フィルター",
  "historyAll": "すべて",
  "historyExportCsv": "CSV をエクスポート",
  "historyExportJson": "JSON をエクスポート",
  "historyImportJson": "JSON をインポート",
  "historyNoNumeric": "推移を表示するのに十分な数値履歴がありません。",
  "historyCompareA": "記録 A",
  "historyCompareB": "記録 B",
  "historyCompareEmpty": "比較する記録を 2 つ選択してください。",
  "historyTrendLabel": "履歴",
  "shareBtn": "共有",
  "shareSnapshotTitle": "共有スナップショット",
  "shareSnapshotDesc": "このリンクには、送信者が生成した読み取り専用のネットワークスナップショットが含まれています。",
  "shareCopyLink": "共有リンクをコピー",
  "shareTooLong": "スナップショットが大きすぎて URL で共有できません。",
  "bbLoadLoss": "負荷時の損失",
  "bbSuggestion": "提案",
  "dcDnssec": "DNSSEC",
  "dcCaa": "CAA",
  "dcMtaSts": "MTA-STS",
  "dcBimi": "BIMI",
  "dcNs": "NS",
  "dcEnabled": "有効",
  "dcDisabled": "無効",
  "dcAd": "AD",
  "dcA_dnssecMissing": "DNSSEC が有効になっていません",
  "dcA_caaMissing": "CAA レコードがありません",
  "dcA_mtaStsMissing": "MTA-STS ポリシーがありません",
  "dcA_bimiMissing": "BIMI レコードがありません",
  "dcA_nsInsufficient": "NS レコードが 2 件未満です",
  "monFormat": "アラート形式",
  "monChatId": "Telegram チャット ID（任意）",
  "monThreshold": "連続失敗後にアラート",
  "monQuiet": "静かな時間帯（例: 23:00-08:00）",
  "monMaint": "メンテナンス時間（分、0=無効）",
  "monCert": "証明書",
  "monCertCheck": "証明書の有効期限を確認",
  "monCertDays": "証明書の残り日数",
  "monFailures": "連続失敗数",
  "monSuppressed": "静かな時間帯 / メンテナンスにより抑制",
  "monBadQuiet": "静かな時間帯の形式が正しくありません（HH:MM-HH:MM で指定）"
},
                ko: {
  "subtitle": "Aurora Diagnostics · 실시간 네트워크 분석",
  "edgeLabel": "엣지 노드",
  "workerLabel": "Worker 시간",
  "live": "실시간 모니터링",
  "rtt": "실시간 RTT",
  "rttSub": "RTT · 지터 · 실시간 차트 · 네트워크 품질",
  "rttCurrent": "현재 RTT",
  "jitter": "지터",
  "rttMin": "최소 RTT",
  "rttMax": "최대 RTT",
  "quality": "연결 품질",
  "stability": "네트워크 안정성",
  "samples": "샘플",
  "loss": "손실률",
  "sec": "보안 및 프로토콜",
  "secSub": "TLS · 암호화 · 인증",
  "secGroupTransport": "전송 및 프로토콜",
  "secGroupOrigin": "오리진 및 핑거프린트",
  "geo": "엣지 위치",
  "geoSub": "Cloudflare 데이터 센터",
  "userGeo": "클라이언트 위치",
  "userGeoSub": "클라이언트 위치 및 위험 점수",
  "geoLoading": "위치 확인 중...",
  "toolsTitle": "진단 도구",
  "toolsSub": "원클릭 테스트 · 전체 진단",
  "lossBtn": "패킷 손실",
  "speedBtn": "대역폭",
  "dnsBtn": "DNS",
  "cpuBtn": "CPU",
  "wsBtn": "WebSocket",
  "concurrentBtn": "동시 요청",
  "streamBtn": "스트림",
  "mediaBtn": "스트리밍 연결성",
  "multiBtn": "다중 노드 비교",
  "dcLabel": "DC / 프록시",
  "risk": "위험 수준",
  "asn": "ASN",
  "protoLabel": "프로토콜",
  "tlsVersion": "TLS 버전",
  "cipher": "암호 스위트",
  "echLabel": "ECH",
  "compressLabel": "압축",
  "http2Label": "HTTP/2",
  "botLabel": "봇 점수",
  "geoLocation": "위치",
  "geoCoord": "좌표",
  "geoOrg": "ISP",
  "userLocation": "위치",
  "userDistance": "노드까지 거리",
  "userOrg": "ISP",
  "userIp": "IP 주소",
  "hw": "하드웨어 정보",
  "hwSub": "클라이언트 환경",
  "historyTitle": "속도 기록",
  "historySub": "최근 대역폭 기록 10건",
  "noRecords": "속도 기록 없음",
  "historyKvOff": "KV 쓰기 비활성화됨 · 속도 기록이 저장되지 않습니다",
  "usageTitle": "사용 통계",
  "usageSub": "API 엔드포인트 호출",
  "usageLocalNote": "로컬 세션 카운터 · KV 쓰기 없음",
  "loadingStats": "불러오는 중...",
  "clientLabel": "클라이언트",
  "copy": "보고서 복사",
  "copied": "복사됨!",
  "powered": "제공",
  "driven": "구동",
  "yes": "예",
  "no": "아니요",
  "clean": "낮은 위험",
  "high": "높은 위험",
  "unavailable": "사용 불가",
  "lossTesting": "테스트 중...",
  "lossNone": "0% (손실 없음)",
  "lossResult": "손실",
  "dnsTesting": "DNS 테스트 중...",
  "speedTesting": "대역폭 테스트 중...",
  "cpuTesting": "CPU 벤치마크 중...",
  "wsTesting": "WebSocket 지연 측정 중...",
  "concurrentTesting": "동시성 테스트 중...",
  "streamTesting": "스트림 처리량 측정 중...",
  "mediaTesting": "내 IP에서 연결성 확인 중...",
  "multiTesting": "노드 비교 중...",
  "multiResult": "노드 비교 결과",
  "nodeName": "노드",
  "latency": "지연 시간 (ms)",
  "status": "상태",
  "enterNodeUrls": "노드 URL 입력 (한 줄에 하나)",
  "cancel": "취소",
  "start": "테스트 시작",
  "fraudScore": "사기 점수",
  "proxy": "프록시",
  "vpn": "VPN",
  "tor": "Tor",
  "hosting": "호스팅",
  "fraudLow": "낮은 위험",
  "fraudMedium": "보통 위험",
  "fraudHigh": "높은 위험",
  "fraudUnknown": "알 수 없음",
  "echEnabled": "활성화됨",
  "echDisabled": "비활성화됨",
  "http2Enabled": "HTTP/2 활성화됨",
  "http2Disabled": "HTTP/1.1",
  "earlyHints": "Early Hints",
  "webrtcBtn": "WebRTC 누출",
  "ttfbBtn": "TTFB 분석",
  "uploadBtn": "업로드 속도",
  "webrtcTesting": "WebRTC 누출 감지 중...",
  "webrtcSafe": "누출 없음",
  "webrtcLeak": "누출 감지됨",
  "webrtcLocal": "로컬 IP",
  "webrtcPublic": "공인 IP",
  "webrtcNone": "WebRTC 후보를 찾을 수 없음 (안전)",
  "ttfbTesting": "TTFB 분석 중...",
  "ttfbDns": "DNS 조회",
  "ttfbTcp": "TCP 연결",
  "ttfbTls": "TLS 핸드셰이크",
  "ttfbWait": "대기 (TTFB)",
  "ttfbDownload": "다운로드",
  "ttfbTotal": "합계",
  "uploadTesting": "업로드 속도 테스트 중...",
  "uploadResult": "업로드 속도",
  "uploadFailed": "업로드 테스트 실패",
  "geoQueryFailed": "위치 정보 조회 실패",
  "cores": "코어",
  "cpuPerf": "CPU 성능",
  "cpuFailed": "CPU 테스트 실패",
  "wsLatency": "WebSocket 지연",
  "wsMin": "최소",
  "wsMax": "최대",
  "wsConnFailed": "WebSocket 연결 실패",
  "wsTestFailed": "WebSocket 테스트 실패",
  "concurrentResultTitle": "동시성 테스트 결과",
  "concurrentRequests": "요청",
  "concurrentFailed": "동시성 테스트 실패",
  "streamThroughput": "스트림 처리량",
  "lossPacketsLost": "손실",
  "speedResultTitle": "대역폭 결과",
  "speedAvg": "평균",
  "dnsResultTitle": "DNS 조회 결과",
  "dnsTimeout": "시간 초과",
  "mediaResultTitle": "IP 연결성 결과",
  "mediaBlocked": "차단됨 / 시간 초과",
  "mediaAvailable": "접근 가능",
  "mediaConnFailed": "연결 실패",
  "km": "km",
  "ttfbFailed": "TTFB 분석 실패",
  "historyAvgSpeed": "평균 속도",
  "historyNode": "노드",
  "loadFailed": "불러오기 실패",
  "totalRequests": "총 요청 수",
  "waitingFirstReq": "첫 요청 대기 중...",
  "enterNodeUrlAlert": "노드 URL을 하나 이상 입력하세요",
  "reportTitle": "NetSight Pro 네트워크 진단 보고서",
  "reportGenTime": "생성 시각",
  "reportNetMetrics": "네트워크 지표",
  "reportSecProto": "보안 및 프로토콜",
  "reportLocation": "위치 정보",
  "reportIpRisk": "IP 위험 정보",
  "reportCompressNone": "없음",
  "reportUnknown": "알 수 없음",
  "reportFooter": "NetSight Pro가 자동 생성한 보고서 · CF-workers-netdiag 제공",
  "tabOverview": "개요",
  "tabNetwork": "네트워크",
  "tabTools": "진단",
  "tabHistory": "기록",
  "running": "실행 중...",
  "metricDuration": "소요 시간",
  "detecting": "감지 중...",
  "themeTip": "테마 전환",
  "pageTitle": "NetSight Pro | Aurora 네트워크 진단",
  "rerun": "다시 실행",
  "auditBtn": "사이트 점검",
  "auditPrompt": "점검할 사이트 URL 입력",
  "auditRun": "점검 실행",
  "auditFinal": "최종 URL",
  "auditStatus": "상태",
  "auditTtfb": "TTFB",
  "auditTotal": "합계",
  "auditRedirects": "리다이렉트",
  "auditHeaders": "보안 헤더",
  "auditMissing": "누락",
  "auditInvalid": "올바른 http(s) URL을 입력하세요",
  "auditFailed": "점검 실패",
  "quickcheckBtn": "빠른 상태 점검",
  "bufferbloatBtn": "버퍼블로트 테스트",
  "dnslookupBtn": "DNS 도구",
  "bbIntro": "다운로드와 업로드로 회선을 포화시킬 때 지연이 얼마나 늘어나는지 측정합니다. 증가폭이 작을수록 좋습니다 (A < 30ms).",
  "bbStart": "테스트 시작",
  "bbRunning": "테스트 중... (약 20초)",
  "bbBaseline": "유휴 지연 시간",
  "bbLoadedDown": "부하 시 (다운로드)",
  "bbLoadedUp": "부하 시 (업로드)",
  "bbDelta": "증가폭",
  "bbGrade": "등급",
  "bbFailed": "테스트 실패",
  "bbNoSamples": "유효한 샘플이 부족합니다 (속도 제한 또는 네트워크 문제)",
  "bbLimited": "부하 단계에서 속도 제한에 걸렸습니다 - 결과가 부정확할 수 있습니다",
  "bbNote": "트래픽 사용량은 대역폭에 비례합니다 (고속 회선에서는 최대 수백 MB).",
  "dnsQueryBtn": "조회",
  "dnsInvalidDomain": "올바른 도메인을 입력하세요 (예: example.com)",
  "dnsNoRecords": "레코드 없음",
  "dnsLookupFailed": "DNS 조회 실패",
  "dnsblSection": "IP 차단 목록 조회",
  "dnsblBtn": "확인",
  "dnsblInvalidIp": "올바른 IPv4 주소를 입력하세요",
  "dnsblListed": "등록됨",
  "dnsblClean": "등록되지 않음",
  "dnsblRefused": "거부됨 (공용 리졸버 제한)",
  "dnsblUnknown": "알 수 없음 / 실패",
  "dnsblNotice": "차단 목록 결과는 참고용입니다. 일부 목록은 공용 리졸버 조회를 거부할 수 있습니다.",
  "qcStart": "상태 점검 시작",
  "qcRunning": "점검 실행 중...",
  "qcScore": "점수",
  "qcItemRtt": "지연 시간 및 지터",
  "qcItemDown": "다운로드",
  "qcItemUp": "업로드",
  "qcItemProto": "HTTP 프로토콜",
  "qcItemDns": "DNS 조회",
  "qcItemFraud": "IP 위험 점수",
  "qcIssues": "발견된 문제",
  "qcNoIssues": "모두 정상 - 문제 없음",
  "qcNote": "여러 진단을 순차적으로 실행하며 (약 20~30초) 일부 대역폭을 사용합니다.",
  "domaincheckBtn": "도메인 보안 점검",
  "dcSelectorPh": "DKIM 셀렉터 (선택)",
  "dcBlLabel": "차단 목록 및 평판",
  "dcFound": "설정됨",
  "dcMissing": "찾을 수 없음",
  "dcNotTested": "테스트 안 함",
  "dcWeak": "강화 필요",
  "dcListed": "등록됨",
  "dcClean": "정상",
  "dcA_mxMissing": "MX 레코드 없음: 이 도메인은 이메일을 받지 못할 수 있습니다",
  "dcA_spfMissing": "SPF 레코드 없음: 수신자가 발신자를 검증할 수 없어 스팸 점수 상승 위험이 있습니다",
  "dcA_spfMulti": "SPF 레코드가 여러 개 있습니다: SPF가 깨지므로 하나로 통합하세요",
  "dcA_spfWeak": "SPF가 ?all/+all로 끝납니다: 너무 관대하므로 ~all 또는 -all을 사용하세요",
  "dcA_dmarcMissing": "DMARC 레코드 없음: 스푸핑 방지 기능이 없습니다",
  "dcA_dmarcNone": "DMARC 정책이 p=none입니다: 모니터링만 가능하므로 quarantine/reject로 강화하세요",
  "dcA_dkimMissing": "이 셀렉터에 대한 DKIM 레코드가 없습니다: 셀렉터를 확인하거나 DKIM 서명을 설정하세요",
  "dcA_listed": "도메인이 차단 목록에 있습니다: 이메일 전달에 영향을 줄 수 있습니다",
  "monitorBtn": "사이트 모니터",
  "monNote": "Worker가 예약에 따라 대상을 점검합니다 (Cron Triggers 필요). Webhook으로 알림을 보내며, 저장은 상태가 바뀔 때만 기록됩니다.",
  "monKeyPh": "관리자 키 (배포 시 MONITOR_ADMIN_KEY 설정)",
  "monUrlsPh": "한 줄에 URL 하나 (최대 10개)",
  "monHookPh": "Webhook URL (DingTalk / Feishu / WeCom / Slack...)",
  "monSave": "설정 저장",
  "monRun": "지금 점검",
  "monUp": "정상",
  "monDown": "중단",
  "monStateNone": "알 수 없음",
  "monSince": "이후",
  "monEvents": "최근 이벤트",
  "monNoEvents": "이벤트 없음",
  "monNoConfig": "설정된 모니터 대상 없음",
  "monKeyNeeded": "먼저 Worker 환경에 MONITOR_ADMIN_KEY를 설정하세요",
  "monKeyBad": "관리자 키가 올바르지 않습니다",
  "monKvMissing": "KV (SPEED_HISTORY)가 바인딩되지 않았습니다",
  "monBadUrl": "잘못된 URL이 포함되어 있습니다",
  "monMax": "URL은 최대 10개",
  "monKvWriteLimit": "오늘의 KV 쓰기 한도를 모두 사용했습니다 - 설정이 저장되지 않았으니 나중에 다시 시도하세요",
  "monBadPort": "80/443 포트만 사용할 수 있습니다 - 사용자 지정 포트를 제거하거나 리버스 프록시를 사용하세요",
  "shareImg": "이미지 공유",
  "shareLink": "공유 링크 복사",
  "shareBanner": "공유된 상태 점검 결과",
  "dnscompareBtn": "DNS 비교",
  "reachBtn": "연결성",
  "dcPrompt": "비교할 도메인 (A 레코드)",
  "dcTitle": "리졸버 비교",
  "dcConsistent": "모든 리졸버 응답 일치",
  "dcInconsistent": "리졸버 응답 불일치 (CDN 변경 또는 포이즈닝 가능성)",
  "dcFailed": "비교 실패",
  "reachTitle": "네트워크 연결성",
  "reachEdge": "엣지",
  "reachBrowser": "브라우저",
  "reachOk": "연결 가능",
  "reachBlocked": "연결 불가",
  "reachLikelyBlocked": "이 환경에서 차단된 것으로 보임",
  "reachEdgeBlocked": "엣지에서 연결 불가",
  "reachFailed": "프로브 실패",
  "reachNote": "대상 사이트를 브라우저에서 직접 프로브합니다 (Cloudflare 엣지 요청 없음). 로컬 네트워크의 연결성을 반영합니다.",
  "proxyBtn": "프록시 / VPN 점검",
  "proxyEgressIp": "HTTP 송신 IP",
  "proxyWebrtcPublic": "WebRTC 공인 IP",
  "proxyConsistent": "일치 - 프록시/VPN 불일치 없음",
  "proxyMismatch": "불일치 - WebRTC 공인 IP가 HTTP 송신 IP와 다릅니다",
  "proxyUndetermined": "판별 불가 - 브라우저가 공용 WebRTC 후보를 노출하지 않았습니다",
  "proxyLocalIp": "로컬 IP",
  "proxyNote": "HTTP 트래픽이 나가는 IP와 WebRTC로 노출되는 IP를 비교합니다. 불일치는 보통 프록시/VPN, 분할 터널링 또는 브라우저 설정 누수를 의미합니다.",
  "qualityBtn": "품질 모니터",
  "qualityIntro": "선택한 시간 동안 초당 1회 프로브하여 지연 백분위수(p50/p95/p99), 지터, 손실, 정체 타임라인을 보고합니다. 가벼운 HEAD 요청만 사용합니다.",
  "qualityStart": "모니터링 시작",
  "qualityStop": "중지",
  "qualityRunning": "모니터링 중",
  "qualityP50": "p50 (중앙값)",
  "qualityP95": "p95",
  "qualityP99": "p99",
  "qualityLoss": "손실",
  "qualitySamples": "샘플",
  "qualityTimeline": "타임라인 (5초 구간별 최악값)",
  "qualityStalls": "정체 (>중앙값 2배)",
  "qualityDone": "모니터링 완료",
  "qualityStopped": "모니터링 중지됨",
  "qualityNote": "장시간 실행은 /health 할당량을 사용합니다. 초당 1회 샘플링은 IP당 분당 180회 한도에 충분히 여유가 있습니다.",
  "multispeedBtn": "다중 스트림 속도",
  "multispeedIntro": "4개 병렬 스트림(총 약 64 MB)으로 다운로드하고 순간 속도를 그래프로 표시합니다. 단일 스트림 테스트보다 실제 대역폭에 훨씬 가깝습니다.",
  "multispeedStreams": "스트림",
  "multispeedTotal": "전송량",
  "multispeedAvg": "평균",
  "multispeedP95": "최고 (p95)",
  "multispeedStability": "안정성",
  "multispeedRate": "속도 (Mbps)",
  "multispeedFailed": "다중 스트림 테스트 실패",
  "multispeedNote": "트래픽 사용량은 대역폭에 비례합니다. 종량제 회선이라면 테스트를 중지하세요.",
  "grpQuality": "네트워크 품질 및 지연",
  "grpBandwidth": "대역폭 및 처리량",
  "grpDns": "DNS",
  "grpSecurity": "보안 및 규정 준수",
  "grpReach": "연결성 및 노드",
  "grpMonitor": "모니터링 및 시스템",
  "adviceTitle": "진단 및 조언",
  "adviceCause": "추정 원인",
  "adviceAction": "권장 조치",
  "historyLocalTitle": "테스트 기록 (로컬)",
  "historyLocalSub": "최근 결과 20건 - 이 브라우저에만 저장됩니다",
  "historyEmpty": "로컬 기록이 없습니다 - 테스트를 실행해 수집을 시작하세요",
  "historyClear": "로컬 기록 지우기",
  "historyCleared": "지워짐",
  "histQuickcheck": "상태 점검",
  "histSpeed": "속도 테스트",
  "histMultispeed": "다중 스트림",
  "histQuality": "품질 모니터",
  "histAudit": "사이트 점검",
  "auditCertLabel": "인증서 만료도 확인 (+1회 외부 요청)",
  "certSkipped": "인증서 확인 건너뜀",
  "certExpiring": "TLS 인증서 만료 임박",
  "certExpired": "TLS 인증서가 만료되었습니다",
  "auditScore": "보안 점수",
  "auditChecks": "헤더 점검",
  "auditIssues": "문제",
  "auditPass": "통과",
  "auditWarn": "경고",
  "auditFailN": "누락",
  "auditNoIssues": "문제 없음",
  "auditIssueMap": {
    "hsts_missing": "HSTS가 없습니다",
    "hsts_weak": "HSTS max-age가 너무 짧습니다",
    "csp_missing": "Content-Security-Policy가 없습니다",
    "csp_unsafe": "CSP가 unsafe-inline을 허용합니다",
    "xfo_missing": "X-Frame-Options가 없습니다",
    "xcto_missing": "X-Content-Type-Options가 없습니다",
    "refpol_missing": "Referrer-Policy가 없습니다",
    "server_leak": "Server 헤더가 소프트웨어 정보를 노출합니다",
    "no_https": "최종 페이지가 HTTPS가 아닙니다",
    "cert_expiring": "TLS 인증서가 14일 내에 만료됩니다",
    "cert_expired": "TLS 인증서가 이미 만료되었습니다"
  },
  "toolDesc": {
    "loss": "엔드포인트를 반복 프로브하여 패킷 손실을 측정합니다",
    "speed": "여러 크기로 다운로드하여 하향 대역폭을 추정합니다",
    "dns": "인기 사이트를 조회하고 조회 시간을 측정합니다",
    "cpu": "Worker 측 연산 벤치마크",
    "ws": "WebSocket 왕복 지연을 측정합니다",
    "concurrent": "여러 단계의 동시 요청을 발생시킵니다",
    "stream": "청크 스트리밍 다운로드 처리량",
    "media": "스트리밍 서비스의 연결성을 확인합니다",
    "multi": "여러 Worker 노드의 지연을 비교합니다",
    "webrtc": "WebRTC가 실제 IP를 누출하는지 감지합니다",
    "ttfb": "요청 타이밍을 단계별로 분석합니다",
    "upload": "여러 크기로 업로드하여 상향 대역폭을 추정합니다",
    "audit": "사이트의 HTTP 보안 헤더(HSTS/CSP/...)와 응답 시간을 점수화합니다",
    "quickcheck": "모든 진단을 실행하고 점수화된 보고서를 생성합니다",
    "bufferbloat": "부하 시 지연(버퍼블로트)을 A-F 등급으로 측정합니다",
    "dnslookup": "DNS 레코드 조회(DoH) 및 IP 차단 목록 확인",
    "domaincheck": "도메인의 MX/SPF/DMARC/DKIM 및 평판을 점검합니다",
    "monitor": "예약된 가동 시간 점검과 Webhook 알림",
    "dnscompare": "동일한 이름을 4개 공용 리졸버에 질의하고 응답을 비교합니다",
    "reach": "엣지와 브라우저에서 중국 및 글로벌 사이트를 프로브합니다",
    "proxy": "HTTP 송신 IP와 WebRTC 노출 IP를 비교하여 프록시/VPN을 확인합니다",
    "quality": "p50/p95/p99와 정체 타임라인을 제공하는 장시간 지연 모니터링",
    "multispeed": "실시간 속도 곡선과 함께 병렬 다중 스트림으로 다운로드합니다",
    "waterfall": "DNS/TCP/TLS/TTFB 분석이 포함된 리소스 워터폴",
    "netinfo": "브라우저 네트워크 API, 저장소 및 연결 정보"
  },
  "advice": {
    "rtt_fail": {
      "cause": "프로브가 완료되지 않았습니다: 이 네트워크에서 엣지에 연결할 수 없거나 요청이 차단되고 있습니다.",
      "action": "로컬 방화벽/VPN 규칙을 확인하고 다른 네트워크에서 시도한 후 상태 점검을 다시 실행하세요."
    },
    "rtt_high": {
      "cause": "왕복 시간이 깁니다: 엣지가 멀거나 경로가 혼잡하거나 로컬 회선이 느립니다.",
      "action": "다른 네트워크와 비교해 보세요. 이 네트워크만 느리다면 ISP에 문의하세요."
    },
    "jitter_high": {
      "cause": "지연이 불안정합니다: Wi-Fi 간섭, 버퍼블로트 또는 상향 링크 혼잡.",
      "action": "유선 또는 5 GHz Wi-Fi를 사용하고 백그라운드 전송을 중지한 후 다시 테스트하세요."
    },
    "loss": {
      "cause": "경로상 패킷 손실: 무선 간섭, 혼잡 또는 회선 불량.",
      "action": "유선 연결로 다시 테스트하고 손실이 계속되면 ISP에 문의하세요."
    },
    "rate_limited": {
      "cause": "일부 프로브가 속도 제한에 걸려 해당 샘플이 제외되었습니다.",
      "action": "1분 정도 기다린 후 다시 실행하거나 여러 도구를 동시에 실행하지 마세요."
    },
    "down_low": {
      "cause": "다운로드 처리량이 낮습니다: 신호 약화, 회선 혼잡 또는 서버 측 제한.",
      "action": "다른 트래픽을 중지하고 다시 테스트하며 Wi-Fi와 유선을 비교하세요."
    },
    "up_low": {
      "cause": "업로드 처리량이 낮습니다: 비대칭 회선이나 혼잡 시 흔합니다.",
      "action": "테스트 중 업로드를 피하고 라우터 QoS 설정을 확인하세요."
    },
    "proto_old": {
      "cause": "연결이 HTTP/2 또는 HTTP/3를 사용하지 않습니다.",
      "action": "보통 프록시나 미들박스 제한입니다. 최신 브라우저나 다른 네트워크에서 시도하세요."
    },
    "dns_fail": {
      "cause": "엣지 호스트 이름의 DNS 조회에 실패했습니다.",
      "action": "DNS 설정을 확인하고 1.1.1.1 또는 8.8.8.8을 사용해 다시 실행하세요."
    },
    "stall": {
      "cause": "중앙값의 2배를 넘는 지연 급증이 반복됩니다.",
      "action": "주기적인 백그라운드 트래픽(백업, 업데이트)이나 무선 로밍이 있는지 확인하세요."
    },
    "proxy_mismatch": {
      "cause": "HTTP 송신 IP와 WebRTC 노출 IP가 다릅니다. 프록시/VPN 또는 분할 터널링을 의미합니다.",
      "action": "의도한 것이 아니라면 프록시/VPN 확장을 비활성화하거나 WebRTC 정책을 강화하세요."
    }
  },
  "waterfallBtn": "리소스 워터폴",
  "waterfallNote": "이 페이지에서 Resource Timing 데이터를 수집하고 각 리소스의 DNS / TCP / TLS / TTFB / 다운로드를 분석합니다.",
  "waterfallIntro": "스캔을 클릭해 이 페이지의 리소스 타이밍을 수집하세요.",
  "waterfallScan": "스캔",
  "wfResources": "리소스",
  "wfProtocols": "프로토콜",
  "wfCached": "캐시됨 / 교차 출처",
  "wfDns": "DNS",
  "wfTcp": "TCP",
  "wfTls": "TLS",
  "wfTtfb": "TTFB",
  "wfDownload": "다운로드",
  "wfTotal": "합계",
  "wfEmpty": "리소스 타이밍 데이터가 없습니다 (브라우저가 Resource Timing을 지원하지 않을 수 있습니다).",
  "wfNote": "막대는 리소스별로 정규화되며 값은 ms 단위입니다.",
  "netinfoBtn": "네트워크 정보",
  "netinfoNote": "브라우저 Network Information API, 저장소 할당량 및 연결 힌트를 표시합니다.",
  "netinfoIntro": "네트워크 정보 읽는 중...",
  "netinfoConnType": "연결 유형",
  "netinfoDownlink": "하향 링크",
  "netinfoRtt": "RTT",
  "netinfoSaveData": "데이터 절약",
  "netinfoTimezone": "시간대",
  "netinfoStorage": "저장소",
  "netinfoProtocol": "페이지 프로토콜",
  "netinfoCores": "CPU 코어",
  "netinfoMemory": "기기 메모리",
  "netinfoScreen": "화면",
  "netinfoPlatform": "플랫폼",
  "netinfoLanguage": "언어",
  "netinfoGeoMatch": "시간대 / 위치 일치",
  "netinfoGeoMismatch": "시간대 / 위치 불일치",
  "netinfoUnavailable": "사용 불가",
  "netinfoYes": "예",
  "netinfoNo": "아니요",
  "speedModeLabel": "테스트 모드",
  "speedModeQuick": "빠르게",
  "speedModeStandard": "표준",
  "speedModePrecise": "정밀",
  "speedTtfb": "첫 바이트",
  "speedStdDev": "표준 편차",
  "speedBest": "최고",
  "speedWorst": "최저",
  "speedSamples": "샘플",
  "speedMedian": "중앙값",
  "speedWarmup": "연결 준비 중...",
  "speedNote": "빠르게: 2개 크기 x 1회, 표준: 3개 크기 x 2회, 정밀: 4개 크기 x 3회 (데이터 사용량 증가).",
  "concurrentStreams": "스트림",
  "concurrentSize": "스트림당 크기",
  "concurrentTotal": "총 처리량",
  "concurrentPerStream": "스트림당",
  "concurrentNote": "실제 병렬 다운로드를 실행하고 총 처리량을 보고합니다.",
  "historyTrend": "처리량 추세",
  "historyCompare": "기록 비교",
  "historyFilter": "필터",
  "historyAll": "전체",
  "historyExportCsv": "CSV 내보내기",
  "historyExportJson": "JSON 내보내기",
  "historyImportJson": "JSON 가져오기",
  "historyNoNumeric": "추세를 표시할 수치 기록이 부족합니다.",
  "historyCompareA": "기록 A",
  "historyCompareB": "기록 B",
  "historyCompareEmpty": "비교할 기록 두 개를 선택하세요.",
  "historyTrendLabel": "기록",
  "shareBtn": "공유",
  "shareSnapshotTitle": "공유 스냅샷",
  "shareSnapshotDesc": "이 링크에는 보낸 사람이 생성한 읽기 전용 네트워크 스냅샷이 포함되어 있습니다.",
  "shareCopyLink": "공유 링크 복사",
  "shareTooLong": "스냅샷이 너무 커서 URL로 공유할 수 없습니다.",
  "bbLoadLoss": "부하 시 손실",
  "bbSuggestion": "제안",
  "dcDnssec": "DNSSEC",
  "dcCaa": "CAA",
  "dcMtaSts": "MTA-STS",
  "dcBimi": "BIMI",
  "dcNs": "NS",
  "dcEnabled": "활성화됨",
  "dcDisabled": "활성화되지 않음",
  "dcAd": "AD",
  "dcA_dnssecMissing": "DNSSEC가 활성화되지 않았습니다",
  "dcA_caaMissing": "CAA 레코드 없음",
  "dcA_mtaStsMissing": "MTA-STS 정책 없음",
  "dcA_bimiMissing": "BIMI 레코드 없음",
  "dcA_nsInsufficient": "NS 레코드가 2개 미만입니다",
  "monFormat": "알림 형식",
  "monChatId": "Telegram 채팅 ID (선택)",
  "monThreshold": "연속 실패 후 알림",
  "monQuiet": "방해 금지 시간 (예: 23:00-08:00)",
  "monMaint": "점검 시간(분) (0=끔)",
  "monCert": "인증서",
  "monCertCheck": "인증서 만료 확인",
  "monCertDays": "인증서 남은 일수",
  "monFailures": "연속 실패",
  "monSuppressed": "방해 금지 시간 / 점검으로 보류됨",
  "monBadQuiet": "잘못된 방해 금지 시간 (HH:MM-HH:MM 형식 사용)"
},
                es: {
  "subtitle": "Diagnóstico Aurora · Análisis de red en tiempo real",
  "edgeLabel": "Nodo de borde",
  "workerLabel": "Tiempo de Worker",
  "live": "Monitoreo en vivo",
  "rtt": "RTT en tiempo real",
  "rttSub": "RTT · Jitter · Gráfico en vivo · Calidad de red",
  "rttCurrent": "RTT actual",
  "jitter": "Jitter",
  "rttMin": "RTT mín",
  "rttMax": "RTT máx",
  "quality": "Calidad de conexión",
  "stability": "Estabilidad de red",
  "samples": "Muestras",
  "loss": "Tasa de pérdida",
  "sec": "Seguridad y protocolo",
  "secSub": "TLS · Cifrado · Autenticación",
  "secGroupTransport": "Transporte y protocolo",
  "secGroupOrigin": "Origen y huella digital",
  "geo": "Ubicación del borde",
  "geoSub": "Centro de datos de Cloudflare",
  "userGeo": "Ubicación del cliente",
  "userGeoSub": "Geolocalización y puntaje de riesgo del cliente",
  "geoLoading": "Ubicando...",
  "toolsTitle": "Herramientas de diagnóstico",
  "toolsSub": "Pruebas con un clic · Diagnóstico completo",
  "lossBtn": "Pérdida de paquetes",
  "speedBtn": "Ancho de banda",
  "dnsBtn": "DNS",
  "cpuBtn": "CPU",
  "wsBtn": "WebSocket",
  "concurrentBtn": "Concurrencia",
  "streamBtn": "Streaming",
  "mediaBtn": "Conectividad de streaming",
  "multiBtn": "Comparar varios nodos",
  "dcLabel": "DC / Proxy",
  "risk": "Nivel de riesgo",
  "asn": "ASN",
  "protoLabel": "Protocolo",
  "tlsVersion": "Versión de TLS",
  "cipher": "Suite de cifrado",
  "echLabel": "ECH",
  "compressLabel": "Compresión",
  "http2Label": "HTTP/2",
  "botLabel": "Puntaje de bot",
  "geoLocation": "Ubicación",
  "geoCoord": "Coordenadas",
  "geoOrg": "ISP",
  "userLocation": "Ubicación",
  "userDistance": "Distancia al nodo",
  "userOrg": "ISP",
  "userIp": "Dirección IP",
  "hw": "Información del hardware",
  "hwSub": "Entorno del cliente",
  "historyTitle": "Historial de velocidad",
  "historySub": "Últimos 10 registros de ancho de banda",
  "noRecords": "Sin registros de velocidad",
  "historyKvOff": "Escrituras KV desactivadas · el historial de velocidad no se guarda",
  "usageTitle": "Estadísticas de uso",
  "usageSub": "Llamadas a endpoints de API",
  "usageLocalNote": "Contadores de la sesión local · sin escrituras KV",
  "loadingStats": "Cargando...",
  "clientLabel": "Cliente",
  "copy": "Copiar informe",
  "copied": "¡Copiado!",
  "powered": "Con tecnología de",
  "driven": "Impulsado por",
  "yes": "Sí",
  "no": "No",
  "clean": "Riesgo bajo",
  "high": "Riesgo alto",
  "unavailable": "No disponible",
  "lossTesting": "Probando...",
  "lossNone": "0% (sin pérdida)",
  "lossResult": "Pérdida",
  "dnsTesting": "Probando DNS...",
  "speedTesting": "Probando el ancho de banda...",
  "cpuTesting": "Prueba de CPU...",
  "wsTesting": "Latencia de WebSocket...",
  "concurrentTesting": "Prueba de concurrencia...",
  "streamTesting": "Rendimiento del streaming...",
  "mediaTesting": "Probando conectividad desde tu IP...",
  "multiTesting": "Comparando nodos...",
  "multiResult": "Resultado de la comparación de nodos",
  "nodeName": "Nodo",
  "latency": "Latencia (ms)",
  "status": "Estado",
  "enterNodeUrls": "Ingresa las URL de los nodos (una por línea)",
  "cancel": "Cancelar",
  "start": "Iniciar prueba",
  "fraudScore": "Puntaje de fraude",
  "proxy": "Proxy",
  "vpn": "VPN",
  "tor": "Tor",
  "hosting": "Hosting",
  "fraudLow": "Riesgo bajo",
  "fraudMedium": "Riesgo medio",
  "fraudHigh": "Riesgo alto",
  "fraudUnknown": "Desconocido",
  "echEnabled": "Activado",
  "echDisabled": "Desactivado",
  "http2Enabled": "HTTP/2 activado",
  "http2Disabled": "HTTP/1.1",
  "earlyHints": "Early Hints",
  "webrtcBtn": "Fuga de WebRTC",
  "ttfbBtn": "Análisis de TTFB",
  "uploadBtn": "Velocidad de subida",
  "webrtcTesting": "Detectando fuga de WebRTC...",
  "webrtcSafe": "No se detectó fuga",
  "webrtcLeak": "Fuga detectada",
  "webrtcLocal": "IP local",
  "webrtcPublic": "IP pública",
  "webrtcNone": "No se encontraron candidatos WebRTC (seguro)",
  "ttfbTesting": "Analizando TTFB...",
  "ttfbDns": "Consulta DNS",
  "ttfbTcp": "Conexión TCP",
  "ttfbTls": "Negociación TLS",
  "ttfbWait": "Espera (TTFB)",
  "ttfbDownload": "Descarga",
  "ttfbTotal": "Total",
  "uploadTesting": "Probando la velocidad de subida...",
  "uploadResult": "Velocidad de subida",
  "uploadFailed": "Falló la prueba de subida",
  "geoQueryFailed": "Falló la consulta de geolocalización",
  "cores": "núcleos",
  "cpuPerf": "Rendimiento de CPU",
  "cpuFailed": "Falló la prueba de CPU",
  "wsLatency": "Latencia de WebSocket",
  "wsMin": "Mín",
  "wsMax": "Máx",
  "wsConnFailed": "Falló la conexión WebSocket",
  "wsTestFailed": "Falló la prueba de WebSocket",
  "concurrentResultTitle": "Resultados de la prueba de concurrencia",
  "concurrentRequests": "solicitudes",
  "concurrentFailed": "Falló la prueba de concurrencia",
  "streamThroughput": "Rendimiento del streaming",
  "lossPacketsLost": "perdidos",
  "speedResultTitle": "Resultados de ancho de banda",
  "speedAvg": "Promedio",
  "dnsResultTitle": "Resultados de resolución DNS",
  "dnsTimeout": "Tiempo de espera",
  "mediaResultTitle": "Resultados de conectividad IP",
  "mediaBlocked": "Bloqueado / Tiempo de espera",
  "mediaAvailable": "Accesible",
  "mediaConnFailed": "Falló la conexión",
  "km": "km",
  "ttfbFailed": "Falló el análisis de TTFB",
  "historyAvgSpeed": "Velocidad prom.",
  "historyNode": "Nodo",
  "loadFailed": "Falló la carga",
  "totalRequests": "Solicitudes totales",
  "waitingFirstReq": "Esperando la primera solicitud...",
  "enterNodeUrlAlert": "Ingresa al menos una URL de nodo",
  "reportTitle": "Informe de diagnóstico de red de NetSight Pro",
  "reportGenTime": "Generado",
  "reportNetMetrics": "Métricas de red",
  "reportSecProto": "Seguridad y protocolo",
  "reportLocation": "Información de ubicación",
  "reportIpRisk": "Información de riesgo de IP",
  "reportCompressNone": "Ninguna",
  "reportUnknown": "Desconocido",
  "reportFooter": "Informe generado automáticamente por NetSight Pro · Con tecnología de CF-workers-netdiag",
  "tabOverview": "Resumen",
  "tabNetwork": "Red",
  "tabTools": "Diagnóstico",
  "tabHistory": "Historial",
  "running": "Ejecutando...",
  "metricDuration": "Duración",
  "detecting": "Detectando...",
  "themeTip": "Cambiar tema",
  "pageTitle": "NetSight Pro | Diagnóstico de red Aurora",
  "rerun": "Repetir",
  "auditBtn": "Auditoría del sitio",
  "auditPrompt": "Ingresa la URL de un sitio para auditar",
  "auditRun": "Ejecutar auditoría",
  "auditFinal": "URL final",
  "auditStatus": "Estado",
  "auditTtfb": "TTFB",
  "auditTotal": "Total",
  "auditRedirects": "Redirecciones",
  "auditHeaders": "Encabezados de seguridad",
  "auditMissing": "Faltante",
  "auditInvalid": "Ingresa una URL http(s) válida",
  "auditFailed": "Falló la auditoría",
  "quickcheckBtn": "Chequeo rápido de estado",
  "bufferbloatBtn": "Prueba de bufferbloat",
  "dnslookupBtn": "Herramientas DNS",
  "bbIntro": "Mide el aumento de latencia mientras el enlace se satura con descargas y subidas. Cuanto menor sea el aumento, mejor (A < 30 ms).",
  "bbStart": "Iniciar prueba",
  "bbRunning": "Probando... (~20 s)",
  "bbBaseline": "Latencia en reposo",
  "bbLoadedDown": "Con carga (descarga)",
  "bbLoadedUp": "Con carga (subida)",
  "bbDelta": "Aumento",
  "bbGrade": "Calificación",
  "bbFailed": "Falló la prueba",
  "bbNoSamples": "No hay suficientes muestras válidas (límite de solicitudes o problema de red)",
  "bbLimited": "Se alcanzó el límite de solicitudes durante la fase de carga; los resultados pueden ser imprecisos",
  "bbNote": "El consumo de datos crece con el ancho de banda (hasta cientos de MB en enlaces rápidos).",
  "dnsQueryBtn": "Consultar",
  "dnsInvalidDomain": "Ingresa un dominio válido (p. ej., example.com)",
  "dnsNoRecords": "Sin registros",
  "dnsLookupFailed": "Falló la consulta DNS",
  "dnsblSection": "Verificación de listas de bloqueo IP",
  "dnsblBtn": "Verificar",
  "dnsblInvalidIp": "Ingresa una dirección IPv4 válida",
  "dnsblListed": "En lista",
  "dnsblClean": "No está en lista",
  "dnsblRefused": "Rechazado (límite del resolutor público)",
  "dnsblUnknown": "Desconocido / falló",
  "dnsblNotice": "Los resultados de las listas de bloqueo son solo orientativos; algunas listas pueden rechazar consultas de resolutores públicos.",
  "qcStart": "Iniciar chequeo de estado",
  "qcRunning": "Ejecutando comprobaciones...",
  "qcScore": "Puntaje",
  "qcItemRtt": "Latencia y jitter",
  "qcItemDown": "Descarga",
  "qcItemUp": "Subida",
  "qcItemProto": "Protocolo HTTP",
  "qcItemDns": "Resolución DNS",
  "qcItemFraud": "Puntaje de riesgo de IP",
  "qcIssues": "Problemas encontrados",
  "qcNoIssues": "Todo bien: no se encontraron problemas",
  "qcNote": "Ejecuta varios diagnósticos en secuencia (~20-30 s) y consume algo de ancho de banda.",
  "domaincheckBtn": "Verificación de seguridad del dominio",
  "dcSelectorPh": "Selector de DKIM (opcional)",
  "dcBlLabel": "Listas de bloqueo y reputación",
  "dcFound": "Configurado",
  "dcMissing": "No encontrado",
  "dcNotTested": "Sin probar",
  "dcWeak": "Requiere refuerzo",
  "dcListed": "En lista",
  "dcClean": "Limpio",
  "dcA_mxMissing": "Sin registros MX: el dominio podría no recibir correo",
  "dcA_spfMissing": "Sin registro SPF: los receptores no pueden verificar a los remitentes; riesgo de ser marcado como spam",
  "dcA_spfMulti": "Se encontraron varios registros SPF: esto rompe SPF; combínalos en uno",
  "dcA_spfWeak": "SPF termina en ?all/+all: demasiado permisivo; usa ~all o -all",
  "dcA_dmarcMissing": "Sin registro DMARC: falta protección contra suplantación",
  "dcA_dmarcNone": "La política DMARC es p=none: solo supervisión; cámbiala a quarantine o reject",
  "dcA_dkimMissing": "Sin registro DKIM para este selector: revisa el selector o configura la firma DKIM",
  "dcA_listed": "El dominio aparece en una lista de bloqueo: puede afectar la entrega de correo",
  "monitorBtn": "Monitor del sitio",
  "monNote": "El Worker revisa los objetivos de forma programada (requiere Cron Triggers). Alertas por webhook; solo se escribe en el almacenamiento cuando cambia el estado.",
  "monKeyPh": "Clave de administrador (define MONITOR_ADMIN_KEY al desplegar)",
  "monUrlsPh": "Una URL por línea (máx. 10)",
  "monHookPh": "URL del webhook (DingTalk / Feishu / WeCom / Slack...)",
  "monSave": "Guardar configuración",
  "monRun": "Revisar ahora",
  "monUp": "En línea",
  "monDown": "Caído",
  "monStateNone": "Desconocido",
  "monSince": "desde",
  "monEvents": "Eventos recientes",
  "monNoEvents": "Aún no hay eventos",
  "monNoConfig": "No hay objetivos de monitoreo configurados",
  "monKeyNeeded": "Primero define MONITOR_ADMIN_KEY en el entorno del Worker",
  "monKeyBad": "La clave de administrador es incorrecta",
  "monKvMissing": "KV (SPEED_HISTORY) no está vinculado",
  "monBadUrl": "Contiene una URL no válida",
  "monMax": "Hasta 10 URL",
  "monKvWriteLimit": "Se agotó la cuota de escrituras KV de hoy; la configuración no se guardó. Inténtalo más tarde.",
  "monBadPort": "Solo se permiten los puertos 80/443; quita el puerto personalizado o usa un proxy inverso",
  "shareImg": "Compartir imagen",
  "shareLink": "Copiar enlace para compartir",
  "shareBanner": "Resultado de chequeo de estado compartido",
  "dnscompareBtn": "Comparar DNS",
  "reachBtn": "Alcanzabilidad",
  "dcPrompt": "Dominio a comparar (registro A)",
  "dcTitle": "Comparación de resolutores",
  "dcConsistent": "Todos los resolutores coinciden",
  "dcInconsistent": "Los resolutores no coinciden (posible cambio de CDN o envenenamiento)",
  "dcFailed": "Falló la comparación",
  "reachTitle": "Alcanzabilidad de la red",
  "reachEdge": "Borde",
  "reachBrowser": "Navegador",
  "reachOk": "Alcanzable",
  "reachBlocked": "Inalcanzable",
  "reachLikelyBlocked": "Probablemente bloqueado para ti",
  "reachEdgeBlocked": "Inalcanzable desde el borde",
  "reachFailed": "Falló la sonda",
  "reachNote": "Las sondas llegan a los sitios directamente desde tu navegador (sin solicitudes al borde de Cloudflare), por lo que reflejan la alcanzabilidad de tu red local.",
  "proxyBtn": "Verificación de proxy / VPN",
  "proxyEgressIp": "IP de salida HTTP",
  "proxyWebrtcPublic": "IP pública de WebRTC",
  "proxyConsistent": "Coherente: no se detectan diferencias por proxy/VPN",
  "proxyMismatch": "Incoherente: la IP pública de WebRTC difiere de la IP de salida HTTP",
  "proxyUndetermined": "Indeterminado: el navegador no expuso ningún candidato público de WebRTC",
  "proxyLocalIp": "IP locales",
  "proxyNote": "Compara la IP de salida de tu tráfico HTTP con la IP visible mediante WebRTC. Una diferencia suele indicar un proxy/VPN, túnel dividido o una configuración del navegador con fugas.",
  "qualityBtn": "Monitor de calidad",
  "qualityIntro": "Sondea una vez por segundo durante el tiempo seleccionado e informa percentiles de latencia (p50/p95/p99), jitter, pérdida y una línea de tiempo de pausas. Solo usa solicitudes HEAD ligeras.",
  "qualityStart": "Iniciar monitoreo",
  "qualityStop": "Detener",
  "qualityRunning": "Monitoreando",
  "qualityP50": "p50 (mediana)",
  "qualityP95": "p95",
  "qualityP99": "p99",
  "qualityLoss": "Pérdida",
  "qualitySamples": "Muestras",
  "qualityTimeline": "Línea de tiempo (peor valor por intervalo de 5 s)",
  "qualityStalls": "Pausas (>2x la mediana)",
  "qualityDone": "Monitoreo finalizado",
  "qualityStopped": "Monitoreo detenido",
  "qualityNote": "Las ejecuciones largas consumen la cuota de /health: una muestra por segundo queda muy por debajo del límite de 180/min por IP.",
  "multispeedBtn": "Velocidad multiflujo",
  "multispeedIntro": "Descarga con 4 flujos en paralelo (unos 64 MB en total) y traza la tasa instantánea, mucho más cercana al ancho de banda real que una prueba de un solo flujo.",
  "multispeedStreams": "Flujos",
  "multispeedTotal": "Transferido",
  "multispeedAvg": "Promedio",
  "multispeedP95": "Pico (p95)",
  "multispeedStability": "Estabilidad",
  "multispeedRate": "Tasa (Mbps)",
  "multispeedFailed": "Falló la prueba multiflujo",
  "multispeedNote": "El consumo de datos crece con el ancho de banda; detén la prueba si tu conexión tiene límite de datos.",
  "grpQuality": "Calidad de red y latencia",
  "grpBandwidth": "Ancho de banda y rendimiento",
  "grpDns": "DNS",
  "grpSecurity": "Seguridad y cumplimiento",
  "grpReach": "Alcanzabilidad y nodos",
  "grpMonitor": "Monitoreo y sistema",
  "adviceTitle": "Diagnóstico y recomendaciones",
  "adviceCause": "Causa probable",
  "adviceAction": "Acción sugerida",
  "historyLocalTitle": "Historial de pruebas (local)",
  "historyLocalSub": "Últimos 20 resultados; se guardan solo en este navegador",
  "historyEmpty": "Aún no hay registros locales; ejecuta una prueba para comenzar a recopilar",
  "historyClear": "Borrar historial local",
  "historyCleared": "Borrado",
  "histQuickcheck": "Chequeo de estado",
  "histSpeed": "Prueba de velocidad",
  "histMultispeed": "Multiflujo",
  "histQuality": "Monitor de calidad",
  "histAudit": "Auditoría del sitio",
  "auditCertLabel": "Verificar también el vencimiento del certificado (+1 solicitud saliente)",
  "certSkipped": "Se omitió la verificación del certificado",
  "certExpiring": "El certificado TLS vence pronto",
  "certExpired": "El certificado TLS ha vencido",
  "auditScore": "Puntaje de seguridad",
  "auditChecks": "Verificación de encabezados",
  "auditIssues": "Problemas",
  "auditPass": "Aprobado",
  "auditWarn": "Advertencia",
  "auditFailN": "Faltante",
  "auditNoIssues": "No se encontraron problemas",
  "auditIssueMap": {
    "hsts_missing": "Falta HSTS",
    "hsts_weak": "El max-age de HSTS es demasiado corto",
    "csp_missing": "Falta Content-Security-Policy",
    "csp_unsafe": "CSP permite unsafe-inline",
    "xfo_missing": "Falta X-Frame-Options",
    "xcto_missing": "Falta X-Content-Type-Options",
    "refpol_missing": "Falta Referrer-Policy",
    "server_leak": "El encabezado Server revela información del software",
    "no_https": "La página final no es HTTPS",
    "cert_expiring": "El certificado TLS vence en menos de 14 días",
    "cert_expired": "El certificado TLS ya venció"
  },
  "toolDesc": {
    "loss": "Sondea el endpoint repetidamente y mide la pérdida de paquetes",
    "speed": "Descarga de varios tamaños para estimar el ancho de banda de bajada",
    "dns": "Resuelve sitios populares y mide el tiempo de consulta",
    "cpu": "Prueba de cómputo del lado del Worker",
    "ws": "Mide la latencia de ida y vuelta de WebSocket",
    "concurrent": "Lanza solicitudes concurrentes en varios niveles",
    "stream": "Rendimiento de descarga por streaming en fragmentos",
    "media": "Comprueba la alcanzabilidad de los servicios de streaming",
    "multi": "Compara la latencia entre varios nodos de Worker",
    "webrtc": "Detecta si WebRTC filtra tu IP real",
    "ttfb": "Desglosa el tiempo de la solicitud fase por fase",
    "upload": "Subida de varios tamaños para estimar el ancho de banda de subida",
    "audit": "Califica los encabezados de seguridad HTTP (HSTS/CSP/...) y el tiempo de respuesta de un sitio",
    "quickcheck": "Ejecuta todos los diagnósticos y genera un informe con puntaje",
    "bufferbloat": "Latencia bajo carga (bufferbloat) con calificación de A a F",
    "dnslookup": "Consulta de registros DNS (DoH) y verificación de listas de bloqueo IP",
    "domaincheck": "Verificación de MX/SPF/DMARC/DKIM y reputación de un dominio",
    "monitor": "Comprobaciones de disponibilidad programadas con alertas por webhook",
    "dnscompare": "Consulta el mismo nombre en 4 resolutores públicos y compara las respuestas",
    "reach": "Sondea sitios de China y globales desde el borde y desde tu navegador",
    "proxy": "Compara la IP de salida HTTP con la IP expuesta por WebRTC para detectar proxy/VPN",
    "quality": "Monitoreo de latencia prolongado con p50/p95/p99 y una línea de tiempo de pausas",
    "multispeed": "Descarga multiflujo en paralelo con una curva de tasa en vivo",
    "waterfall": "Cascada de recursos con desglose de DNS/TCP/TLS/TTFB",
    "netinfo": "API de red del navegador, almacenamiento y detalles de la conexión"
  },
  "advice": {
    "rtt_fail": {
      "cause": "Las sondas nunca se completaron: el borde no es alcanzable desde esta red o las solicitudes están bloqueadas.",
      "action": "Revisa las reglas del firewall/VPN local, prueba otra red y vuelve a ejecutar el chequeo de estado."
    },
    "rtt_high": {
      "cause": "Tiempo de ida y vuelta largo: borde distante, ruta congestionada o enlace local lento.",
      "action": "Compara con otra red; si solo esta red es lenta, repórtalo a tu ISP."
    },
    "jitter_high": {
      "cause": "Latencia inestable: interferencia de Wi-Fi, bufferbloat o enlace de subida congestionado.",
      "action": "Prefiere conexión por cable o Wi-Fi de 5 GHz, detén las transferencias en segundo plano y vuelve a probar."
    },
    "loss": {
      "cause": "Pérdida de paquetes en la ruta: interferencia inalámbrica, congestión o un enlace defectuoso.",
      "action": "Vuelve a probar con conexión por cable; si la pérdida persiste, contacta a tu ISP."
    },
    "rate_limited": {
      "cause": "Algunas sondas se limitaron por tasa, por lo que se descartaron esas muestras.",
      "action": "Espera un minuto y vuelve a ejecutar, o evita usar varias herramientas a la vez."
    },
    "down_low": {
      "cause": "Rendimiento de bajada bajo: señal débil, enlace ocupado o limitación del servidor.",
      "action": "Vuelve a probar sin otro tráfico y compara Wi-Fi con cable."
    },
    "up_low": {
      "cause": "Rendimiento de subida bajo: es común en enlaces asimétricos o con congestión.",
      "action": "Evita subir datos durante la prueba y revisa la configuración QoS del router."
    },
    "proto_old": {
      "cause": "La conexión no usa HTTP/2 ni HTTP/3.",
      "action": "Suele ser una limitación de un proxy o intermediario; prueba un navegador moderno u otra red."
    },
    "dns_fail": {
      "cause": "Falló la resolución DNS del nombre del borde.",
      "action": "Revisa la configuración DNS, prueba con 1.1.1.1 o 8.8.8.8 y vuelve a ejecutar."
    },
    "stall": {
      "cause": "Picos de latencia repetidos por encima del doble de la mediana.",
      "action": "Busca tráfico periódico en segundo plano (copias de seguridad, actualizaciones) o roaming inalámbrico."
    },
    "proxy_mismatch": {
      "cause": "La IP de salida HTTP y la IP expuesta por WebRTC difieren, lo que indica un proxy/VPN o túnel dividido.",
      "action": "Si no es lo esperado, desactiva la extensión de proxy/VPN o restringe las políticas de WebRTC."
    }
  },
  "waterfallBtn": "Cascada de recursos",
  "waterfallNote": "Recopila datos de Resource Timing de esta página y desglosa DNS / TCP / TLS / TTFB / descarga para cada recurso.",
  "waterfallIntro": "Haz clic en Escanear para recopilar los tiempos de los recursos de esta página.",
  "waterfallScan": "Escanear",
  "wfResources": "Recursos",
  "wfProtocols": "Protocolos",
  "wfCached": "En caché / otro origen",
  "wfDns": "DNS",
  "wfTcp": "TCP",
  "wfTls": "TLS",
  "wfTtfb": "TTFB",
  "wfDownload": "Descarga",
  "wfTotal": "Total",
  "wfEmpty": "No hay datos de tiempos de recursos (puede que el navegador no admita Resource Timing).",
  "wfNote": "Las barras se normalizan por recurso; los valores están en ms.",
  "netinfoBtn": "Información de red",
  "netinfoNote": "Muestra la API Network Information del navegador, la cuota de almacenamiento y datos de la conexión.",
  "netinfoIntro": "Leyendo la información de red...",
  "netinfoConnType": "Tipo de conexión",
  "netinfoDownlink": "Bajada",
  "netinfoRtt": "RTT",
  "netinfoSaveData": "Ahorro de datos",
  "netinfoTimezone": "Zona horaria",
  "netinfoStorage": "Almacenamiento",
  "netinfoProtocol": "Protocolo de la página",
  "netinfoCores": "Núcleos de CPU",
  "netinfoMemory": "Memoria del dispositivo",
  "netinfoScreen": "Pantalla",
  "netinfoPlatform": "Plataforma",
  "netinfoLanguage": "Idioma",
  "netinfoGeoMatch": "Zona horaria y ubicación coherentes",
  "netinfoGeoMismatch": "Zona horaria y ubicación no coinciden",
  "netinfoUnavailable": "No disponible",
  "netinfoYes": "Sí",
  "netinfoNo": "No",
  "speedModeLabel": "Modo de prueba",
  "speedModeQuick": "Rápida",
  "speedModeStandard": "Estándar",
  "speedModePrecise": "Precisa",
  "speedTtfb": "Primer byte",
  "speedStdDev": "Desv. estándar",
  "speedBest": "Mejor",
  "speedWorst": "Peor",
  "speedSamples": "Muestras",
  "speedMedian": "Mediana",
  "speedWarmup": "Preparando la conexión...",
  "speedNote": "Rápida: 2 tamaños x 1 ronda; Estándar: 3 tamaños x 2 rondas; Precisa: 4 tamaños x 3 rondas (más datos).",
  "concurrentStreams": "Flujos",
  "concurrentSize": "Tamaño por flujo",
  "concurrentTotal": "Rendimiento total",
  "concurrentPerStream": "Por flujo",
  "concurrentNote": "Ejecuta descargas paralelas reales e informa el rendimiento agregado.",
  "historyTrend": "Tendencia de rendimiento",
  "historyCompare": "Comparar registros",
  "historyFilter": "Filtrar",
  "historyAll": "Todos",
  "historyExportCsv": "Exportar CSV",
  "historyExportJson": "Exportar JSON",
  "historyImportJson": "Importar JSON",
  "historyNoNumeric": "No hay suficientes datos numéricos para mostrar una tendencia.",
  "historyCompareA": "Registro A",
  "historyCompareB": "Registro B",
  "historyCompareEmpty": "Selecciona dos registros para comparar.",
  "historyTrendLabel": "Historial",
  "shareBtn": "Compartir",
  "shareSnapshotTitle": "Instantánea compartida",
  "shareSnapshotDesc": "Este enlace contiene una instantánea de red de solo lectura generada por el remitente.",
  "shareCopyLink": "Copiar enlace para compartir",
  "shareTooLong": "La instantánea es demasiado grande para compartirla por URL.",
  "bbLoadLoss": "Pérdida bajo carga",
  "bbSuggestion": "Sugerencia",
  "dcDnssec": "DNSSEC",
  "dcCaa": "CAA",
  "dcMtaSts": "MTA-STS",
  "dcBimi": "BIMI",
  "dcNs": "NS",
  "dcEnabled": "Activado",
  "dcDisabled": "No activado",
  "dcAd": "AD",
  "dcA_dnssecMissing": "DNSSEC no está activado",
  "dcA_caaMissing": "Sin registro CAA",
  "dcA_mtaStsMissing": "Sin política MTA-STS",
  "dcA_bimiMissing": "Sin registro BIMI",
  "dcA_nsInsufficient": "Menos de 2 registros NS",
  "monFormat": "Formato de alerta",
  "monChatId": "ID de chat de Telegram (opcional)",
  "monThreshold": "Alertar tras fallos consecutivos",
  "monQuiet": "Horas de silencio (p. ej., 23:00-08:00)",
  "monMaint": "Minutos de mantenimiento (0 = desactivado)",
  "monCert": "Certificado",
  "monCertCheck": "Verificar vencimiento del certificado",
  "monCertDays": "Días restantes del certificado",
  "monFailures": "Fallos consecutivos",
  "monSuppressed": "Suprimido por horas de silencio / mantenimiento",
  "monBadQuiet": "Horas de silencio no válidas (usa HH:MM-HH:MM)"
}
            };
            Object.assign(i18n, I18N_MORE);

            // ==================== v5.1 诊断向导 i18n（6 语言） ====================
            const I18N_EXTRA_V51 = {
                'en': {
                    wizardBtn: 'Smart Diagnosis', wizardNote: 'Runs latency, packet loss, DNS, throughput and protocol checks step by step, then gives a score and suggestions.',
                    wizardIntro: 'Click Start to run a guided network diagnosis.', wizardStepRtt: 'Latency & loss', wizardStepDns: 'DNS resolution', wizardStepSpeed: 'Download throughput', wizardStepProto: 'Protocol', wizardScore: 'Diagnosis score',
                    wizardLatency: 'Median RTT', wizardLoss: 'Packet loss', wizardDnsTime: 'DNS time', wizardSpeed: 'Download', wizardProtocol: 'Protocol', wizardGrade: 'Grade',
                    wizardAdviceHighLatency: 'High latency: check Wi-Fi signal / interference, or switch to wired.', wizardAdviceLoss: 'Packet loss detected: unstable link or congestion; retest on wired network.', wizardAdviceDns: 'Slow DNS: try switching to 1.1.1.1 / 8.8.8.8 or a faster resolver.', wizardAdviceSpeed: 'Low throughput: check background downloads or plan limits.', wizardAdviceOk: 'No obvious issue found.'
                },
                'zh-CN': {
                    wizardBtn: '智能诊断', wizardNote: '逐步检测延迟、丢包、DNS、下行吞吐与协议，最后给出评分与建议。',
                    wizardIntro: '点击「开始」执行引导式网络诊断。', wizardStepRtt: '延迟与丢包', wizardStepDns: 'DNS 解析', wizardStepSpeed: '下行吞吐', wizardStepProto: '协议',
                    wizardScore: '诊断评分', wizardLatency: 'RTT 中位数', wizardLoss: '丢包率', wizardDnsTime: 'DNS 耗时', wizardSpeed: '下行速度', wizardProtocol: '协议', wizardGrade: '等级',
                    wizardAdviceHighLatency: '延迟偏高：检查 Wi-Fi 信号/干扰，或改用有线。', wizardAdviceLoss: '存在丢包：链路不稳定或拥塞，建议有线重测。', wizardAdviceDns: 'DNS 较慢：可改用 1.1.1.1 / 8.8.8.8 或更快的解析器。', wizardAdviceSpeed: '吞吐偏低：检查后台下载或套餐限速。', wizardAdviceOk: '未发现明显问题。'
                },
                'zh-TW': {
                    wizardBtn: '智慧診斷', wizardNote: '逐步檢測延遲、封包遺失、DNS、下行吞吐與協定，最後給出評分與建議。',
                    wizardIntro: '點擊「開始」執行引導式網路診斷。', wizardStepRtt: '延遲與遺失', wizardStepDns: 'DNS 解析', wizardStepSpeed: '下行吞吐', wizardStepProto: '協定',
                    wizardScore: '診斷評分', wizardLatency: 'RTT 中位數', wizardLoss: '遺失率', wizardDnsTime: 'DNS 耗時', wizardSpeed: '下行速度', wizardProtocol: '協定', wizardGrade: '等級',
                    wizardAdviceHighLatency: '延遲偏高：檢查 Wi-Fi 訊號/干擾，或改用有線。', wizardAdviceLoss: '存在封包遺失：鏈路不穩定或壅塞，建議有線重測。', wizardAdviceDns: 'DNS 較慢：可改用 1.1.1.1 / 8.8.8.8 或更快的解析器。', wizardAdviceSpeed: '吞吐偏低：檢查背景下載或方案限速。', wizardAdviceOk: '未發現明顯問題。'
                },
                'ja': {
                    wizardBtn: 'スマート診断', wizardNote: '遅延・パケット損失・DNS・下り速度・プロトコルを順に検査し、スコアと提案を表示します。',
                    wizardIntro: '「開始」をクリックしてネットワーク診断を実行します。', wizardStepRtt: '遅延と損失', wizardStepDns: 'DNS 解決', wizardStepSpeed: '下り速度', wizardStepProto: 'プロトコル',
                    wizardScore: '診断スコア', wizardLatency: 'RTT 中央値', wizardLoss: 'パケット損失', wizardDnsTime: 'DNS 時間', wizardSpeed: '下り速度', wizardProtocol: 'プロトコル', wizardGrade: '評価',
                    wizardAdviceHighLatency: '遅延が大きい：Wi-Fi の電波/干渉を確認し、有線を試してください。', wizardAdviceLoss: 'パケット損失あり：回線が不安定または混雑しています。有線で再測定してください。', wizardAdviceDns: 'DNS が遅い：1.1.1.1 / 8.8.8.8 など高速なリゾルバをお試しください。', wizardAdviceSpeed: '速度が低い：バックグラウンド通信やプラン制限を確認してください。', wizardAdviceOk: '明らかな問題は見つかりませんでした。'
                },
                'ko': {
                    wizardBtn: '스마트 진단', wizardNote: '지연, 패킷 손실, DNS, 다운로드 속도, 프로토콜을 순서대로 점검하고 점수와 제안을 제공합니다.',
                    wizardIntro: '시작을 눌러 네트워크 진단을 실행하세요.', wizardStepRtt: '지연 및 손실', wizardStepDns: 'DNS 확인', wizardStepSpeed: '다운로드 속도', wizardStepProto: '프로토콜',
                    wizardScore: '진단 점수', wizardLatency: 'RTT 중앙값', wizardLoss: '패킷 손실', wizardDnsTime: 'DNS 시간', wizardSpeed: '다운로드', wizardProtocol: '프로토콜', wizardGrade: '등급',
                    wizardAdviceHighLatency: '지연이 높음: Wi-Fi 신호/간섭을 확인하거나 유선을 사용하세요.', wizardAdviceLoss: '패킷 손실 감지: 회선이 불안정하거나 혼잡합니다. 유선으로 재측정하세요.', wizardAdviceDns: 'DNS가 느림: 1.1.1.1 / 8.8.8.8 등 빠른 리졸버를 사용해 보세요.', wizardAdviceSpeed: '속도가 낮음: 백그라운드 다운로드나 요금제 제한을 확인하세요.', wizardAdviceOk: '뚜렷한 문제가 발견되지 않았습니다.'
                },
                'es': {
                    wizardBtn: 'Diagnóstico inteligente', wizardNote: 'Evalúa latencia, pérdida de paquetes, DNS, velocidad de descarga y protocolo, y ofrece una puntuación con sugerencias.',
                    wizardIntro: 'Pulsa Iniciar para ejecutar el diagnóstico guiado.', wizardStepRtt: 'Latencia y pérdida', wizardStepDns: 'Resolución DNS', wizardStepSpeed: 'Velocidad de descarga', wizardStepProto: 'Protocolo',
                    wizardScore: 'Puntuación', wizardLatency: 'RTT mediana', wizardLoss: 'Pérdida', wizardDnsTime: 'Tiempo DNS', wizardSpeed: 'Descarga', wizardProtocol: 'Protocolo', wizardGrade: 'Grado',
                    wizardAdviceHighLatency: 'Latencia alta: revisa la señal Wi-Fi/interferencias o usa cable.', wizardAdviceLoss: 'Se detectó pérdida de paquetes: enlace inestable o congestionado; reintenta por cable.', wizardAdviceDns: 'DNS lento: prueba 1.1.1.1 / 8.8.8.8 u otro resolutor más rápido.', wizardAdviceSpeed: 'Velocidad baja: revisa descargas en segundo plano o límites del plan.', wizardAdviceOk: 'No se encontraron problemas evidentes.'
                }
            };
            (function mergeI18nExtraV51() {
                Object.keys(I18N_EXTRA_V51).forEach(function (lang) {
                    const target = i18n[lang];
                    const extra = I18N_EXTRA_V51[lang];
                    if (!target || !extra) return;
                    Object.keys(extra).forEach(function (key) { target[key] = extra[key]; });
                });
            })();

            // ==================== 后端数据 ====================
            const BACKEND_DATA = window.__BACKEND__ || {};

            // ==================== 会话令牌注入 ====================
            // 对同源请求统一附加 x-ns-token（相对路径 / 绝对 URL / Request 对象均支持），跨域请求不携带令牌；
            // 403 时先通过 /api/page-token 静默续期并重试一次，避免整页 reload 造成的刷新风暴。
            let __PAGE_KEY__ = window.__PAGE_KEY__ || '';
            let __pageTokenRefreshPromise = null;
            function __sameOriginInput(input) {
                try {
                    const raw = (typeof input === 'string') ? input : ((input && input.url) ? input.url : String(input));
                    return new URL(raw, window.location.href).origin === window.location.origin;
                } catch (e) { return false; }
            }
            function __withPageToken(init, token) {
                const opts = Object.assign({}, init || {});
                const h = new Headers(opts.headers || {});
                if (!h.has('x-ns-token')) h.set('x-ns-token', token);
                opts.headers = h;
                return opts;
            }
            const __origFetchBound = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;
            function refreshPageToken() {
                if (__pageTokenRefreshPromise) return __pageTokenRefreshPromise;
                __pageTokenRefreshPromise = (async function () {
                    try {
                        if (!__origFetchBound) return false;
                        const r = await __origFetchBound('/api/page-token', { cache: 'no-store', credentials: 'same-origin' });
                        const j = await r.json();
                        if (r.ok && j && typeof j.token === 'string' && j.token) {
                            __PAGE_KEY__ = j.token;
                            try { window.__PAGE_KEY__ = j.token; } catch (e) {}
                            return true;
                        }
                    } catch (e) {}
                    return false;
                })().then(function (ok) {
                    // 成功后续期结果复用 30s（避免并发 403 触发多次续期）；失败 2s 后允许重试
                    setTimeout(function () { __pageTokenRefreshPromise = null; }, ok ? 30000 : 2000);
                    return ok;
                });
                return __pageTokenRefreshPromise;
            }
            if (__origFetchBound) {
                window.fetch = async function (input, init) {
                    const sameOrigin = __sameOriginInput(input);
                    const canAttach = sameOrigin && __PAGE_KEY__;
                    let res = await __origFetchBound(input, canAttach ? __withPageToken(init, __PAGE_KEY__) : init);
                    if (res && res.status === 403 && sameOrigin && !(init && init.__nsRetried)) {
                        if (await refreshPageToken()) {
                            const retryInit = __withPageToken(init, __PAGE_KEY__);
                            retryInit.__nsRetried = true;
                            res = await __origFetchBound(input, retryInit);
                        }
                    }
                    return res;
                };
            }

            // ==================== DOM 引用 ====================
            // 结果区元素：旧版独立展示位已移除，显式回退到工具弹层主体（toolModalBody）
            const _toolModalBody = document.getElementById('toolModalBody');
            const elements = {
                v4: document.getElementById('v4'), v6: document.getElementById('v6'),
                rttNum: document.getElementById('rtt-num'), chart: document.getElementById('chart'),
                ctx: (function() { var c = document.getElementById('chart'); return c ? c.getContext('2d') : null; })(),
                sDc: document.getElementById('s-dc'), sRisk: document.getElementById('s-risk'),
                hwInfo: document.getElementById('hw-info'), copyBtn: document.getElementById('copy-report'),
                jitterVal: document.getElementById('jitter-val'), protoVal: document.getElementById('proto-val'),
                userGeoInfo: document.getElementById('user-geo-info'), echVal: document.getElementById('ech-val'),
                botScoreVal: document.getElementById('bot-score-val'), compressVal: document.getElementById('compress-val'),
                http2Val: document.getElementById('http2-val'), lossBtn: document.getElementById('btn-loss-test'),
                lossResult: document.getElementById('loss-result') || _toolModalBody, speedBtn: document.getElementById('btn-speed-test'),
                speedResult: document.getElementById('speed-result') || _toolModalBody, dnsBtn: document.getElementById('btn-dns-test'),
                dnsResult: document.getElementById('dns-result') || _toolModalBody, cpuBtn: document.getElementById('btn-cpu-test'),
                cpuResult: document.getElementById('cpu-result') || _toolModalBody, wsBtn: document.getElementById('btn-ws-test'),
                wsResult: document.getElementById('ws-result') || _toolModalBody, concurrentBtn: document.getElementById('btn-concurrent-test'),
                concurrentResult: document.getElementById('concurrent-result') || _toolModalBody, streamBtn: document.getElementById('btn-stream-test'),
                streamResult: document.getElementById('stream-result') || _toolModalBody,
                mediaBtn: document.getElementById('btn-media-unlock'), mediaResult: document.getElementById('media-result') || _toolModalBody,
                multiBtn: document.getElementById('btn-multi-node'), multiResult: document.getElementById('multi-node-result') || _toolModalBody,
                webrtcBtn: document.getElementById('btn-webrtc-test'), webrtcResult: document.getElementById('webrtc-result') || _toolModalBody,
                ttfbBtn: document.getElementById('btn-ttfb-test'), ttfbResult: document.getElementById('ttfb-result') || _toolModalBody,
                uploadBtn: document.getElementById('btn-upload-test'), uploadResult: document.getElementById('upload-result') || _toolModalBody
            };

            // 弹层后台任务控制：关闭弹层时中止进行中的大流量/长任务，避免用户无法停止
            let activeToolAbort = null;
            let lastFocusedBeforeModal = null;

            function detectLang() {
                let saved = null;
                try { saved = localStorage.getItem('pref-lang'); } catch(e) {}
                if (saved && i18n[saved]) return saved;
                if (window.__SITE__ && window.__SITE__.defaultLang && i18n[window.__SITE__.defaultLang]) return window.__SITE__.defaultLang;
                const langs = navigator.languages || [navigator.language || ''];
                for (const l of langs) {
                    const lower = l.toLowerCase();
                    if (lower.match(/^zh-(cn|sg|my)/)) return 'zh-CN';
                    if (lower.match(/^zh/)) return 'zh-TW';
                    if (lower.match(/^ja/)) return 'ja';
                    if (lower.match(/^ko/)) return 'ko';
                    if (lower.match(/^es/)) return 'es';
                    if (lower.match(/^en/)) return 'en';
                }
                return window.__DEFAULT_LANG__ || 'en';
            }
            let currentLang = detectLang();
            const rttData = [];
            const MAX_RTT_POINTS = 40;
            const jitterHistory = [];
            const MAX_JITTER_HISTORY = 10;
            let geoRetryCount = 0;
            const MAX_GEO_RETRY = 5;
            let _userGeoCache = null; // ipapi.co 结果缓存：切语言/重复调用时不重复请求第三方
            let consecutiveLoss = 0;
            let totalLoss = 0;
            let sampleCount = 0;
            let totalAttempts = 0;
            let rttTimer = null;
            let minRtt = Infinity;
            let maxRtt = 0;
            let rttTestRunning = true;
            let lastRtt = null;
            let resolvedV4 = '';

            // ==================== 工具函数 ====================
            function isDataCenter() {
                const patterns = /data center|hosting|cloud|akamai|google|amazon|microsoft|aliyun|tencent|fastly|cloudflare|incapsula|leaseweb|ovh|digitalocean|vultr|linode/i;
                return patterns.test(BACKEND_DATA.asOrg);
            }

            function fetchWithTimeout(url, options = {}, timeout = 3000) {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeout);
                return fetch(url, { ...options, signal: controller.signal })
                    .finally(() => clearTimeout(id));
            }

            function calculateDistance(lat1, lon1, lat2, lon2) {
                const R = 6371;
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLon = (lon2 - lon1) * Math.PI / 180;
                const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                          Math.sin(dLon/2) * Math.sin(dLon/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                return Math.round(R * c);
            }

            function localeOf(lang) {
                if (lang === 'zh-CN') return 'zh-CN';
                if (lang === 'zh-TW') return 'zh-TW';
                if (lang === 'ja') return 'ja-JP';
                if (lang === 'ko') return 'ko-KR';
                if (lang === 'es') return 'es-ES';
                return 'en-US';
            }
            function cssColorVar(name, fallback) {
                try {
                    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                    return v || fallback;
                } catch (e) { return fallback; }
            }
            function withAlpha(color, alpha) {
                const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
                if (!m) return color;
                let hex = m[1];
                if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
                const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
                return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
            }
            const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            function escapeHTML(value) {
                return String(value ?? '').replace(/[&<>"']/g, function(c) { return ESC_MAP[c]; });
            }

            function showResult(element, html, isError = false) {
                const target = element || document.getElementById('toolModalBody');
                if (!target) return;
                target.innerHTML = isError ? '<div class="tool-error">' + html + '</div>' : html;
            }

            function resultTitle(text) {
                return '<div class="result-title">' + escapeHTML(text) + '</div>';
            }

            function metricCard(label, value, unit, tone, barPct) {
                const safeTone = (tone === 'ok' || tone === 'warn' || tone === 'bad') ? ' tone-' + tone : '';
                const bar = (barPct !== undefined && barPct !== null)
                    ? '<div class="metric-bar"><i style="width:' + Math.max(2, Math.min(100, Number(barPct) || 0)) + '%"></i></div>'
                    : '';
                const unitHtml = unit ? '<span class="metric-unit">' + escapeHTML(String(unit)) + '</span>' : '';
                return '<div class="metric-card' + safeTone + '">'
                    + '<div class="metric-label">' + escapeHTML(String(label)) + '</div>'
                    + '<div class="metric-value">' + escapeHTML(String(value)) + unitHtml + '</div>'
                    + bar + '</div>';
            }

            function metricGrid(cards) {
                return '<div class="metric-grid">' + cards.join('') + '</div>';
            }

            // ---------- 弹层两栏：左「说明 + 参数 + 操作」 / 右「结果」 ----------
            function toolParamsEl() { return document.getElementById('toolModalParams'); }
            function toolSideActionsEl() { return document.getElementById('toolModalSideActions'); }
            function setToolParams(html) { const el = toolParamsEl(); if (el) el.innerHTML = html || ''; }
            function setToolActions(html) { const el = toolSideActionsEl(); if (el) el.innerHTML = html || ''; }
            // 左栏操作按钮工厂：primary=实心主操作，secondary=描边次操作（事件由各工具在渲染后按 id 绑定）
            function primaryAction(id, icon, label, extraClass) {
                return '<button class="btn btn-primary ' + (extraClass || '') + '" id="' + id + '"><i class="fas ' + icon + '"></i> ' + escapeHTML(label) + '</button>';
            }
            function secondaryAction(id, icon, label, extraClass) {
                return '<button class="btn ' + (extraClass || '') + '" id="' + id + '"><i class="fas ' + icon + '"></i> ' + escapeHTML(label) + '</button>';
            }

            function lockModalScroll() {
                try { document.body.style.overflow = 'hidden'; } catch (e) {}
            }
            function unlockModalScrollIfIdle() {
                try {
                    const tm = document.getElementById('toolModal');
                    const nm = document.getElementById('nodeModal');
                    const anyOpen = (tm && tm.classList.contains('active')) || (nm && nm.classList.contains('active'));
                    if (!anyOpen) document.body.style.overflow = '';
                } catch (e) {}
            }
            function focusFirstIn(modalEl) {
                if (!modalEl) return;
                const target = modalEl.querySelector('button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])');
                if (target && typeof target.focus === 'function') { try { target.focus(); } catch (e) {} }
            }
            function stopActiveToolTask() {
                try { if (activeToolAbort) activeToolAbort.abort(); } catch (e) {}
                activeToolAbort = null;
                try { qualityStopRequested = true; } catch (e) {}
            }
            function openToolModal(title, desc) {
                stopActiveToolTask();
                try { lastFocusedBeforeModal = document.activeElement; } catch (e) {}
                const mt = document.getElementById('toolModalTitle');
                const md = document.getElementById('toolModalDesc');
                if (mt) mt.textContent = title || '';
                if (md) md.textContent = ''; // 说明文字改由左栏承载，头部只保留标题与操作
                const sd = document.getElementById('toolModalSideDesc');
                if (sd) sd.textContent = desc || '';
                setToolParams('');
                setToolActions('');
                const body = document.getElementById('toolModalBody');
                if (body) body.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(i18n[currentLang].running) + '</div>';
                const el = document.getElementById('toolModal');
                if (el) {
                    el.classList.add('active');
                    lockModalScroll();
                    setTimeout(function () { focusFirstIn(el); }, 0);
                }
            }

            function closeToolModal() {
                const el = document.getElementById('toolModal');
                if (el) el.classList.remove('active');
                stopActiveToolTask();
                unlockModalScrollIfIdle();
                try { if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus(); } catch (e) {}
            }

            // ==================== UI 更新（全界面国际化） ====================
            function updateUI() {
                const t = i18n[currentLang];
                // 所有需要国际化的文本 ID 与对应的 i18n 键
                const map = {
                    't-subtitle': t.subtitle,
                    't-edge-label': t.edgeLabel,
                    't-worker-label': t.workerLabel,
                    't-live': t.live,
                    't-rtt': t.rtt,
                    't-rtt-sub': t.rttSub,
                    't-rtt-current': t.rttCurrent,
                    't-jitter': t.jitter,
                    't-rtt-min': t.rttMin,
                    't-rtt-max': t.rttMax,
                    't-quality': t.quality,
                    't-stability': t.stability,
                    't-samples': t.samples,
                    't-loss': t.loss,
                    't-sec': t.sec,
                    't-sec-sub': t.secSub,
                    't-sec-group-transport': t.secGroupTransport,
                    't-sec-group-origin': t.secGroupOrigin,
                    't-geo': t.geo,
                    't-geo-sub': t.geoSub,
                    't-user-geo': t.userGeo,
                    't-user-geo-sub': t.userGeoSub,
                    't-geo-loading': t.geoLoading,
                    't-tools-title': t.toolsTitle,
                    't-tools-sub': t.toolsSub,
                    't-loss-btn': t.lossBtn,
                    't-speed-btn': t.speedBtn,
                    't-dns-btn': t.dnsBtn,
                    't-cpu-btn': t.cpuBtn,
                    't-ws-btn': t.wsBtn,
                    't-concurrent-btn': t.concurrentBtn,
                    't-stream-btn': t.streamBtn,
                    't-media-btn': t.mediaBtn,
                    't-multi-btn': t.multiBtn,
                    't-webrtc-btn': t.webrtcBtn,
                    't-ttfb-btn': t.ttfbBtn,
                    't-upload-btn': t.uploadBtn,
                    't-dc-label': t.dcLabel,
                    't-risk': t.risk,
                    't-asn': t.asn,
                    't-proto-label': t.protoLabel,
                    't-tls-version': t.tlsVersion,
                    't-cipher': t.cipher,
                    't-ech-label': t.echLabel,
                    't-compress-label': t.compressLabel,
                    't-http2-label': t.http2Label,
                    't-bot-label': t.botLabel,
                    't-geo-location': t.geoLocation,
                    't-geo-coord': t.geoCoord,
                    't-geo-org': t.geoOrg,
                    't-user-location': t.userLocation,
                    't-user-distance': t.userDistance,
                    't-user-org': t.userOrg,
                    't-user-ip': t.userIp,
                    't-hw': t.hw,
                    't-history-title': t.historyLocalTitle,
                    't-history-sub': t.historyLocalSub,
                    't-no-records': t.noRecords,
                    't-usage-title': t.usageTitle,
                    't-usage-sub': t.usageSub,
                    't-loading-stats': t.loadingStats,
                    't-client-label': t.clientLabel,
                    't-copy': t.copy,
                    't-share': t.shareBtn,
                    't-powered': t.powered,
                    't-driven': t.driven,
                    'modal-title': t.multiBtn,
                    'modal-desc': t.enterNodeUrls,
                    'modal-cancel': t.cancel,
                    'modal-start': t.start,
                    'tab-overview': t.tabOverview,
                    'tab-network': t.tabNetwork,
                    'tab-tools': t.tabTools,
                    'tab-history': t.tabHistory,
                    'toolModalRerunLabel': t.rerun
                };
                Object.entries(map).forEach(([id, text]) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = text;
                });

                // 语言按钮激活状态
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    const lang = btn.getAttribute('data-lang');
                    btn.classList.toggle('active', lang === currentLang);
                    btn.setAttribute('aria-pressed', lang === currentLang ? 'true' : 'false');
                });

                // 动态数据（DC/Proxy, Risk Level）
                const dc = isDataCenter();
                if (elements.sDc) {
                    elements.sDc.innerHTML = dc ? '<span class="badge badge-danger">' + t.yes + '</span>' : '<span class="badge badge-success">' + t.no + '</span>';
                }
                if (elements.sRisk) {
                    elements.sRisk.innerHTML = dc ? '<span class="badge badge-danger">' + t.high + '</span>' : '<span class="badge badge-success">' + t.clean + '</span>';
                }

                // 协议显示
                if (elements.protoVal) {
                    const rawProto = BACKEND_DATA.httpProtocolRaw || '';
                    let displayText = rawProto;
                    if (rawProto.toUpperCase().includes('HTTP/3')) {
                        displayText += ' <span class="badge badge-info">QUIC</span>';
                    }
                    elements.protoVal.innerHTML = displayText;
                }

                // ECH
                if (elements.echVal) {
                    const helloLen = BACKEND_DATA.tlsClientHelloLength;
                    if (helloLen > 0) {
                        elements.echVal.innerHTML = '<span class="badge badge-success">' + t.echEnabled + '</span>';
                    } else {
                        elements.echVal.innerHTML = '<span class="badge badge-danger">' + t.echDisabled + '</span>';
                    }
                }

                // Compression
                if (elements.compressVal) {
                    const parts = [];
                    if (BACKEND_DATA.compressionBrotli) parts.push('<span class="badge badge-info">br</span>');
                    if (BACKEND_DATA.compressionGzip) parts.push('<span class="badge badge-info">gzip</span>');
                    if (parts.length === 0) parts.push('<span class="badge">none</span>');
                    elements.compressVal.innerHTML = parts.join(' ');
                }

                // Bot Score
                if (elements.botScoreVal) {
                    const score = parseInt(BACKEND_DATA.botScore, 10);
                    let badgeClass = 'badge-info';
                    if (score >= 80) badgeClass = 'badge-success';
                    else if (score >= 30) badgeClass = 'badge-warning';
                    else badgeClass = 'badge-danger';
                    elements.botScoreVal.innerHTML = '<span class="badge ' + badgeClass + '">' + score + '</span>';
                }

                // 文档标题 / 主题按钮提示 / 未解析的 IP 占位文案（随语言切换）
                document.title = String(t.pageTitle || '').split('NetSight Pro').join((window.__SITE__ && window.__SITE__.siteName) || 'NetSight Pro');
                const themeBtn = document.getElementById('themeToggle');
                if (themeBtn) themeBtn.title = t.themeTip;
                if (elements.v4 && elements.v4.dataset.pending === '1') elements.v4.textContent = t.detecting;
                if (elements.v6 && elements.v6.dataset.pending === '1') elements.v6.textContent = t.detecting;

                renderToolCards();
            }

            window.setLang = function(lang) {
                if (!i18n[lang]) return;
                currentLang = lang;
                try { localStorage.setItem('pref-lang', lang); } catch(e) {}
                document.documentElement.lang = lang;
                updateUI();
                // 动态生成的文本也跟随语言刷新（刷新硬件信息、网络质量、真实IP位置、历史/用量面板）
                updateHardwareInfo();
                renderLocalHistory();
                loadUsageStats();
                if (lastRtt !== null) updateQuality(lastRtt);
                geoRetryCount = 0; // 重新允许地理定位重试
                fetchUserGeo();
                if (document.querySelector('.fraud-info')) loadFraudScore();
                // 若工具结果弹层正打开，按新语言重新执行，保证结果正文也同步
                if (toolModalEl && toolModalEl.classList.contains('active')) rerunCurrentTool();
            };

            // ==================== 图表 ====================
            function resizeCanvas() {
                const canvas = elements.chart;
                if (!canvas || !canvas.parentElement) return;
                const container = canvas.parentElement;
                const rect = container.getBoundingClientRect();
                if (rect.width > 0) {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    drawChart();
                }
            }

            function drawChart() {
                const canvas = elements.chart;
                const ctx = elements.ctx;
                if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (rttData.length < 2) return;
                
                ctx.beginPath();
                ctx.strokeStyle = cssColorVar('--chart-cyan', '#c3c7cd');
                ctx.lineWidth = 2.5;
                const stepX = canvas.width / (MAX_RTT_POINTS - 1);
                const maxRttVal = Math.max(...rttData, 100);
                rttData.forEach((value, index) => {
                    const x = index * stepX;
                    const y = canvas.height - (Math.min(value, maxRttVal) / maxRttVal) * (canvas.height - 20) - 10;
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
                
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                const chartColor = cssColorVar('--chart-cyan', '#c3c7cd');
                gradient.addColorStop(0, withAlpha(chartColor, 0.28));
                gradient.addColorStop(1, withAlpha(chartColor, 0));
                ctx.fillStyle = gradient;
                ctx.lineTo(canvas.width, canvas.height);
                ctx.lineTo(0, canvas.height);
                ctx.fill();
            }

            // ==================== IP 获取 ====================
            async function getIP(version) {
                const el = version === 'v4' ? elements.v4 : elements.v6;
                if (!el) return;
                const urls = version === 'v4' 
                    ? ['https://api4.ipify.org', 'https://ipv4.icanhazip.com', 'https://ip4.seeip.org']
                    : ['https://api6.ipify.org', 'https://ipv6.icanhazip.com'];
                for (const url of urls) {
                    try {
                        const res = await fetchWithTimeout(url, {}, 3000);
                        if (res.ok) {
                            const ip = (await res.text()).trim();
                            if (ip && !ip.includes('<')) {
                                el.removeAttribute('data-pending');
                                el.textContent = ip;
                                if (version === 'v4') resolvedV4 = ip;
                                return;
                            }
                        }
                    } catch (e) {}
                }
                el.removeAttribute('data-pending');
                el.textContent = i18n[currentLang].unavailable;
                el.style.opacity = '0.5';
            }

            // ==================== RTT 监控 ====================
            function updateQuality(currentRtt) {
                const qualityEl = document.getElementById('quality-badge');
                const stabilityEl = document.getElementById('stability-badge');
                const t = i18n[currentLang];
                // 质量文本（不国际化，因为值是根据数值动态显示的，但可以用固定中文/英文？为了保持统一，我们用数值对应的等级，但这里只用颜色和文本，但文本是硬编码的“优秀”“良好”等，这些也需要国际化。
                // 我们可以改成根据数值设置文本，但为了简单，我们保留原逻辑（因为“优秀”等词在中文环境下是中文，英文环境下需要英文）。但原代码是硬编码中文。
                // 修改：根据语言设置对应的等级文本。
                let qualityText = '', qualityColor = '';
                if (currentRtt < 50) {
                    qualityText = currentLang === 'en' ? 'Excellent' : (currentLang === 'zh-TW' ? '優秀' : '优秀');
                    qualityColor = 'var(--text-primary)';
                } else if (currentRtt < 100) {
                    qualityText = currentLang === 'en' ? 'Good' : (currentLang === 'zh-TW' ? '良好' : '良好');
                    qualityColor = 'var(--text-primary)';
                } else if (currentRtt < 150) {
                    qualityText = currentLang === 'en' ? 'Fair' : (currentLang === 'zh-TW' ? '一般' : '一般');
                    qualityColor = 'var(--warning)';
                } else if (currentRtt < 250) {
                    qualityText = currentLang === 'en' ? 'Poor' : (currentLang === 'zh-TW' ? '較差' : '较差');
                    qualityColor = 'var(--danger)';
                } else {
                    qualityText = currentLang === 'en' ? 'Very Poor' : (currentLang === 'zh-TW' ? '極差' : '极差');
                    qualityColor = 'var(--danger)';
                }
                if (qualityEl) {
                    qualityEl.textContent = qualityText;
                    qualityEl.style.color = qualityColor;
                }

                if (stabilityEl && jitterHistory.length > 0) {
                    const avgJitter = jitterHistory.reduce((a,b) => a+b, 0) / jitterHistory.length;
                    let stabilityText = '', stabilityColor = '';
                    if (avgJitter < 10) {
                        stabilityText = currentLang === 'en' ? 'Very Stable' : (currentLang === 'zh-TW' ? '非常穩定' : '非常稳定');
                        stabilityColor = 'var(--text-primary)';
                    } else if (avgJitter < 30) {
                        stabilityText = currentLang === 'en' ? 'Stable' : (currentLang === 'zh-TW' ? '穩定' : '稳定');
                        stabilityColor = 'var(--text-primary)';
                    } else if (avgJitter < 60) {
                        stabilityText = currentLang === 'en' ? 'Unstable' : (currentLang === 'zh-TW' ? '不穩定' : '不稳定');
                        stabilityColor = 'var(--warning)';
                    } else {
                        stabilityText = currentLang === 'en' ? 'Very Unstable' : (currentLang === 'zh-TW' ? '極不穩定' : '极不稳定');
                        stabilityColor = 'var(--danger)';
                    }
                    stabilityEl.textContent = stabilityText;
                    stabilityEl.style.color = stabilityColor;
                }
            }

            function updateLossRate() {
                const lossRateEl = document.getElementById('loss-rate');
                if (lossRateEl) {
                    const rate = totalAttempts > 0 ? Math.round((totalLoss / totalAttempts) * 100) : 0;
                    lossRateEl.textContent = rate + '%';
                    lossRateEl.style.color = rate === 0 ? 'var(--text-primary)' : (rate < 5 ? 'var(--warning)' : 'var(--danger)');
                }
            }

            function updateMinMax(currentRtt) {
                const minEl = document.getElementById('min-rtt');
                const maxEl = document.getElementById('max-rtt');
                if (currentRtt < minRtt) {
                    minRtt = currentRtt;
                    if (minEl) minEl.textContent = minRtt;
                }
                if (currentRtt > maxRtt) {
                    maxRtt = currentRtt;
                    if (maxEl) maxEl.textContent = maxRtt;
                }
            }

            function scheduleRtt(delay) {
                if (rttTimer) clearTimeout(rttTimer);
                rttTimer = setTimeout(testRtt, delay);
            }

            async function testRtt() {
                if (!rttTestRunning) return;
                const start = performance.now();
                try {
                    const rttRes = await fetchWithTimeout('/health?_=' + Date.now(),
                        { method: 'HEAD', cache: 'no-store' }, 2000);
                    if (rttRes && rttRes.status === 403) {
                        // 令牌失效：静默续期并延迟重试（不再整页刷新）；续期失败也由下一次采样再试
                        try { await refreshPageToken(); } catch (e) {}
                        scheduleRtt(2000);
                        return;
                    }
                    if (rttRes && rttRes.status === 429) {
                        // 健康检查命中独立限流：跳过本次采样，不计丢包
                        scheduleRtt(5000);
                        return;
                    }
                    const diff = Math.round(performance.now() - start);
                    lastRtt = diff;
                    if (elements.rttNum) elements.rttNum.textContent = diff;
                    
                    sampleCount++;
                    totalAttempts++;
                    const sampleEl = document.getElementById('sample-count');
                    if (sampleEl) sampleEl.textContent = sampleCount;
                    
                    updateMinMax(diff);
                    
                    if (rttData.length > 0) {
                        const jitter = Math.abs(diff - rttData[rttData.length - 1]);
                        jitterHistory.push(jitter);
                        if (jitterHistory.length > MAX_JITTER_HISTORY) jitterHistory.shift();
                        const avgJitter = Math.round(jitterHistory.reduce((a,b) => a+b, 0) / jitterHistory.length);
                        if (elements.jitterVal) elements.jitterVal.textContent = avgJitter;
                        updateQuality(diff);
                    }
                    
                    consecutiveLoss = 0;
                    updateLossRate();
                    
                    rttData.push(diff);
                    if (rttData.length > MAX_RTT_POINTS) rttData.shift();
                    drawChart();
                } catch (e) {
                    consecutiveLoss++;
                    totalLoss++;
                    totalAttempts++;
                    updateLossRate();
                    if (elements.rttNum) elements.rttNum.textContent = 'ERR';
                    updateQuality(999);
                }
                scheduleRtt(5000);
            }

            // ==================== HTTP/2 检测 ====================
            async function testHttp2() {
                if (!elements.http2Val) return;
                const t = i18n[currentLang];
                try {
                    const res = await fetch('/http2-test');
                    const data = await res.json();
                    
                    if (data.http2 || data.http3) {
                        let badgeHtml = '';
                        if (data.http3) {
                            badgeHtml = '<span class="badge badge-success"><i class="fas fa-check"></i> HTTP/3 (QUIC)</span>';
                        } else if (data.http2) {
                            badgeHtml = '<span class="badge badge-success"><i class="fas fa-check"></i> ' + t.http2Enabled + '</span>';
                        }
                        if (data.earlyHints) {
                            badgeHtml += ' <span class="badge badge-info"><i class="fas fa-rocket"></i> ' + t.earlyHints + '</span>';
                        }
                        elements.http2Val.innerHTML = badgeHtml;
                    } else {
                        elements.http2Val.innerHTML = '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> ' + t.http2Disabled + '</span>';
                    }
                } catch (e) {
                    elements.http2Val.innerHTML = '<span class="badge">N/A</span>';
                }
            }

            // ==================== 欺诈评分 ====================
            async function loadFraudScore() {
                try {
                    const res = await fetch('/api/ip-fraud');
                    if (!res.ok) return;
                    const data = await res.json();
                    const t = i18n[currentLang];
                    const geoCard = elements.userGeoInfo;
                    if (!geoCard) return;
                    let fraudSection = geoCard.querySelector('.fraud-info');
                    if (!fraudSection) {
                        fraudSection = document.createElement('div');
                        fraudSection.className = 'fraud-info';
                        fraudSection.style.marginTop = '15px';
                        fraudSection.style.paddingTop = '15px';
                        fraudSection.style.borderTop = '1px solid var(--divider)';
                        geoCard.appendChild(fraudSection);
                    }
                    
                    let riskLabel = t.fraudUnknown;
                    let riskBadge = 'badge-info';
                    if (data.score !== null) {
                        if (data.score >= 80) { riskLabel = t.fraudHigh; riskBadge = 'badge-danger'; }
                        else if (data.score >= 50) { riskLabel = t.fraudMedium; riskBadge = 'badge-warning'; }
                        else { riskLabel = t.fraudLow; riskBadge = 'badge-success'; }
                    }
                    
                    fraudSection.innerHTML = \`
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-shield-alt"></i> \${t.fraudScore}</span>
                            <span class="info-value"><span class="badge \${riskBadge}">\${data.score !== null ? data.score + ' - ' + riskLabel : 'N/A'}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-user-secret"></i> \${t.proxy}</span>
                            <span class="info-value"><span class="badge \${data.isProxy ? 'badge-danger' : 'badge-success'}">\${data.isProxy ? '⚠️ ' + t.yes : '✅ ' + t.no}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-shield-virus"></i> \${t.vpn}</span>
                            <span class="info-value"><span class="badge \${data.isVpn ? 'badge-danger' : 'badge-success'}">\${data.isVpn ? '⚠️ ' + t.yes : '✅ ' + t.no}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-route"></i> \${t.tor}</span>
                            <span class="info-value"><span class="badge \${data.isTor ? 'badge-danger' : 'badge-success'}">\${data.isTor ? '⚠️ ' + t.yes : '✅ ' + t.no}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-server"></i> \${t.hosting}</span>
                            <span class="info-value"><span class="badge \${data.isHosting ? 'badge-warning' : 'badge-success'}">\${data.isHosting ? '⚠️ ' + t.yes : '✅ ' + t.no}</span></span>
                        </div>
                    \`;
                } catch (e) {}
            }

            // ==================== 地理位置 ====================
            async function fetchUserGeo() {
                if (!elements.userGeoInfo) return;
                
                if (BACKEND_DATA.realGeoCity && BACKEND_DATA.realGeoCountry) {
                    const t = i18n[currentLang];
                    let geoHtml = '<div class="info-row"><span class="info-label"><i class="fas fa-city"></i> ' + t.userLocation + '</span>' +
                        '<span class="info-value">' + escapeHTML(BACKEND_DATA.realGeoCity) + ', ' + escapeHTML(BACKEND_DATA.realGeoRegion) + ', ' + escapeHTML(BACKEND_DATA.realGeoCountry) + '</span></div>' +
                        '<div class="info-row"><span class="info-label"><i class="fas fa-building"></i> ' + t.userOrg + '</span>' +
                        '<span class="info-value">' + escapeHTML(BACKEND_DATA.realGeoOrg) + '</span></div>' +
                        '<div class="info-row"><span class="info-label"><i class="fas fa-ethernet"></i> ' + t.userIp + '</span>' +
                        '<span class="info-value"><code>' + escapeHTML(BACKEND_DATA.realGeoIp) + '</code></span></div>';
                    elements.userGeoInfo.innerHTML = geoHtml;
                    loadFraudScore();
                    return;
                }
                
                const ip = resolvedV4;
                const t = i18n[currentLang];
                if (!ip) {
                    if (geoRetryCount < MAX_GEO_RETRY) {
                        geoRetryCount++;
                        setTimeout(fetchUserGeo, 1500);
                    } else {
                        // 重试耗尽：不要停留在初始 spinner，写入错误态
                        elements.userGeoInfo.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);"><i class="fas fa-exclamation-triangle"></i> ' + escapeHTML(i18n[currentLang].geoQueryFailed) + '</div>';
                    }
                    return;
                }
                geoRetryCount = 0;
                
                try {
                    let geoData = _userGeoCache;
                    if (!geoData) {
                        const res = await fetch(\`https://ipapi.co/\${ip}/json/\`, { signal: AbortSignal.timeout(8000) });
                        geoData = await res.json();
                        if (geoData.error) throw new Error(geoData.reason);
                        _userGeoCache = geoData;
                    }
                    
                    const distRaw = calculateDistance(
                        BACKEND_DATA.latNum, BACKEND_DATA.lonNum,
                        geoData.latitude, geoData.longitude
                    );
                    const dist = Number.isFinite(distRaw) ? distRaw : '--';
                    
                    elements.userGeoInfo.innerHTML = \`
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-city"></i> \${t.userLocation}</span>
                            <span class="info-value">\${escapeHTML(geoData.city)}, \${escapeHTML(geoData.region)}, \${escapeHTML(geoData.country_name)}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ruler"></i> \${t.userDistance}</span>
                            <span class="info-value"><span class="badge badge-info">\${dist} \${t.km}</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-building"></i> \${t.userOrg}</span>
                            <span class="info-value">\${escapeHTML(geoData.org)}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ethernet"></i> \${t.userIp}</span>
                            <span class="info-value"><code>\${escapeHTML(ip)}</code></span>
                        </div>
                    \`;
                    loadFraudScore();
                } catch (e) {
                    elements.userGeoInfo.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);"><i class="fas fa-exclamation-triangle"></i> ' + i18n[currentLang].geoQueryFailed + '</div>';
                }
            }

            // ==================== 硬件信息 ====================
            function updateHardwareInfo() {
                if (!elements.hwInfo) return;
                const t = i18n[currentLang];
                const cores = navigator.hardwareConcurrency || 'N/A';
                const screenInfo = screen.width + 'x' + screen.height;
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const language = navigator.language;
                const platform = navigator.platform;
                elements.hwInfo.innerHTML = \`
                    <div class="hw-chip"><i class="fas fa-tv"></i> \${screenInfo}</div>
                    <div class="hw-chip"><i class="fas fa-microchip"></i> \${cores} \${t.cores}</div>
                    <div class="hw-chip"><i class="fas fa-clock"></i> \${timezone}</div>
                    <div class="hw-chip"><i class="fas fa-language"></i> \${language}</div>
                    <div class="hw-chip"><i class="fas fa-desktop"></i> \${platform}</div>
                \`;
            }

            // ==================== 各测试函数 ====================
            let cpuTestRunning = false;
            async function runCpuTest() {
                if (cpuTestRunning) return;
                cpuTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.cpuResult, '<span class="loading"></span> ' + t.cpuTesting);
                
                try {
                    const res = await fetch('/cpu-test?n=20000');
                    if (!res.ok) throw new Error('http ' + res.status);
                    const data = await res.json();
                    const tone = data.opsMs > 50 ? 'ok' : (data.opsMs > 20 ? 'warn' : 'bad');
                    showResult(elements.cpuResult, resultTitle(t.cpuPerf) + metricGrid([
                        metricCard('OPS/MS', data.opsMs, 'ops/ms', tone, Math.min(100, data.opsMs)),
                        metricCard(t.metricDuration, data.duration, 'ms', null, null)
                    ]));
                } catch (e) {
                    showResult(elements.cpuResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.cpuFailed, true);
                }
                cpuTestRunning = false;
            }

            let wsTestRunning = false;
            async function runWsTest() {
                if (wsTestRunning) return;
                wsTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.wsResult, '<span class="loading"></span> ' + t.wsTesting);
                
                try {
                    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const wsUrl = wsProtocol + '//' + window.location.host + '/ws-test';
                    const ws = new WebSocket(wsUrl);
                    
                    const result = await new Promise((resolve) => {
                        const latencies = [];
                        let testCount = 0;
                        const maxTests = 5;
                        let timeoutId = setTimeout(() => {
                            ws.close();
                            resolve({ success: false });
                        }, 8000);
                        
                        ws.onopen = () => {
                            const sendPing = () => {
                                const pingStart = performance.now();
                                ws.send(JSON.stringify({ type: 'ping', timestamp: pingStart }));
                            };
                            sendPing();
                            
                            ws.onmessage = (event) => {
                                try {
                                    const data = JSON.parse(event.data);
                                    if (data.type === 'ping') {
                                        ws.send(JSON.stringify({ type: 'pong' }));
                                        return;
                                    }
                                    const pongTime = performance.now();
                                    if (data.type === 'pong') {
                                        const latency = pongTime - (data.echoTime || data.timestamp);
                                        latencies.push(latency);
                                        testCount++;
                                        
                                        if (testCount < maxTests) {
                                            setTimeout(sendPing, 200);
                                        } else {
                                            clearTimeout(timeoutId);
                                            ws.send(JSON.stringify({ type: 'close' }));
                                            setTimeout(() => ws.close(), 100);
                                            const avgLatency = Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length);
                                            resolve({ success: true, avg: avgLatency, min: Math.round(Math.min(...latencies)), max: Math.round(Math.max(...latencies)) });
                                        }
                                    }
                                } catch (e) {
                                    resolve({ success: false });
                                }
                            };
                        };
                        
                        ws.onerror = () => {
                            clearTimeout(timeoutId);
                            resolve({ success: false });
                        };
                    });
                    
                    if (result.success) {
                        const tone = result.avg < 50 ? 'ok' : (result.avg < 150 ? 'warn' : 'bad');
                        showResult(elements.wsResult, resultTitle(t.wsLatency) + metricGrid([
                            metricCard(t.wsLatency, result.avg, 'ms', tone, Math.min(100, result.avg / 3)),
                            metricCard(t.wsMin, result.min, 'ms', null, null),
                            metricCard(t.wsMax, result.max, 'ms', null, null)
                        ]));
                    } else {
                        showResult(elements.wsResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.wsConnFailed, true);
                    }
                } catch (e) {
                    showResult(elements.wsResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.wsTestFailed, true);
                }
                wsTestRunning = false;
            }

            let concurrentTestRunning = false;
            function runConcurrentTest() {
                const t = i18n[currentLang];
                const out = elements.concurrentResult;
                if (!out) return;
                setToolParams(
                    '<span class="side-label">' + escapeHTML(t.concurrentStreams) + '</span>' +
                    '<select id="ccStreams" class="tool-input"><option value="2">2</option><option value="4" selected>4</option><option value="8">8</option></select>' +
                    '<span class="side-label">' + escapeHTML(t.concurrentSize) + '</span>' +
                    '<select id="ccSize" class="tool-input"><option value="4194304">4 MB</option><option value="8388608" selected>8 MB</option><option value="16777216">16 MB</option></select>' +
                    '<div class="side-desc" style="margin:0">' + escapeHTML(t.concurrentNote) + '</div>'
                );
                setToolActions(primaryAction('ccStart', 'fa-play', t.concurrentBtn));
                out.innerHTML = '<div class="no-data">' + escapeHTML(t.concurrentNote) + '</div>';
                const go = document.getElementById('ccStart');
                if (go) go.addEventListener('click', startConcurrentTest);
            }
            async function startConcurrentTest() {
                if (concurrentTestRunning) return;
                concurrentTestRunning = true;
                const t = i18n[currentLang];
                const out = elements.concurrentResult;
                const streamsEl = document.getElementById('ccStreams');
                const sizeEl = document.getElementById('ccSize');
                const streams = Math.min(8, Math.max(2, Number(streamsEl && streamsEl.value) || 4));
                const size = Math.min(16777216, Math.max(1048576, Number(sizeEl && sizeEl.value) || 8388608));
                if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.concurrentTesting) + '</div>';
                const controller = new AbortController();
                activeToolAbort = controller;
                const started = performance.now();
                let totalBytes = 0, failed = 0;
                const perStream = [];
                const runOne = async function (idx) {
                    const t0 = performance.now();
                    let bytes = 0;
                    const res = await fetch('/speedtest?size=' + size, { cache: 'no-store', signal: controller.signal });
                    if (!res.ok) throw new Error('http ' + res.status);
                    const reader = res.body.getReader();
                    while (true) {
                        const step = await reader.read();
                        if (step.done) break;
                        bytes += step.value ? step.value.byteLength : 0;
                    }
                    const dur = performance.now() - t0;
                    totalBytes += bytes;
                    perStream.push({ idx: idx, mbps: dur > 0 ? (bytes * 8 / (dur / 1000)) / 1000000 : 0, bytes: bytes, ms: Math.round(dur) });
                };
                try {
                    const jobs = [];
                    for (let i = 0; i < streams; i++) jobs.push(runOne(i).catch(function () { failed++; }));
                    await Promise.all(jobs);
                } catch (e) {}
                const wall = Math.max(0.001, (performance.now() - started) / 1000);
                const totalMbps = (totalBytes * 8 / wall) / 1000000;
                if (activeToolAbort === controller) activeToolAbort = null;
                perStream.sort(function (a, b) { return b.mbps - a.mbps; });
                const avgPerStream = perStream.length ? perStream.reduce(function (a, b) { return a + b.mbps; }, 0) / perStream.length : 0;
                const cards = [
                    metricCard(t.concurrentTotal, totalMbps.toFixed(2), 'Mbps', totalMbps >= 50 ? 'ok' : (totalMbps >= 10 ? 'warn' : 'bad'), Math.min(100, totalMbps * 2)),
                    metricCard(t.concurrentPerStream, avgPerStream.toFixed(2), 'Mbps', null, null),
                    metricCard(t.concurrentStreams, streams, '', null, null),
                    metricCard(t.concurrentSize, Math.round(size / 1048576) + ' MB', '', null, null)
                ];
                const rows = perStream.map(function (s) {
                    return '<div class="result-row"><span class="rr-name">#' + (s.idx + 1) + '</span><span class="rr-val">' + s.mbps.toFixed(2) + ' Mbps · ' + formatBytes(s.bytes) + ' · ' + s.ms + ' ms</span></div>';
                }).join('');
                if (out) out.innerHTML = resultTitle(t.concurrentResultTitle) + metricGrid(cards) +
                    '<div class="result-rows" style="margin-top:12px">' + rows + '</div>' +
                    (failed ? '<div class="result-row is-warn" style="margin-top:10px"><span class="rr-name">' + escapeHTML(t.concurrentFailed) + '</span><span class="rr-val">' + failed + '</span></div>' : '');
                pushLocalHistory({ type: 'concurrent', label: t.concurrentBtn, value: totalMbps.toFixed(1), unit: ' Mbps', tone: totalMbps >= 50 ? 'ok' : (totalMbps >= 10 ? 'warn' : 'bad') });
                concurrentTestRunning = false;
            }

            let streamTestRunning = false;
            async function runStreamTest() {
                if (streamTestRunning) return;
                streamTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.streamResult, '<span class="loading"></span> ' + t.streamTesting);
                
                const sizes = [131072, 524288, 2097152];
                const results = [];
                
                for (const size of sizes) {
                    const start = performance.now();
                    try {
                        const res = await fetchWithTimeout(\`/stream-test?size=\${size}\`, {}, 15000);
                        const reader = res.body.getReader();
                        let bytesRead = 0;
                        
                        while (true) {
                            const {done, value} = await reader.read();
                            if (done) break;
                            bytesRead += value.length;
                        }
                        
                        const duration = performance.now() - start;
                        const speedMbps = ((bytesRead * 8) / (duration / 1000)) / 1000000;
                        results.push({ sizeKB: Math.round(size/1024), speed: speedMbps.toFixed(2) });
                    } catch (e) {
                        results.push({ sizeKB: Math.round(size/1024), speed: '0' });
                    }
                }
                
                const cards = results.map(r => metricCard(r.sizeKB + ' KB', r.speed, 'Mbps', null, Math.min(100, (parseFloat(r.speed) || 0) * 2)));
                showResult(elements.streamResult, resultTitle(t.streamThroughput) + metricGrid(cards));
                streamTestRunning = false;
            }

            let lossTestRunning = false;
            async function runLossTest() {
                if (lossTestRunning) return;
                lossTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.lossResult, '<span class="loading"></span> ' + t.lossTesting);
                
                const total = 10;
                let attempted = 0;
                let failed = 0;
                for (let i = 0; i < total; i++) {
                    try {
                        const res = await fetchWithTimeout('/health?_loss=' + Date.now() + i, 
                            { method: 'HEAD', cache: 'no-store' }, 3000);
                        if (res.status === 429) continue; // 限流响应不算成功样本，也不计入分母
                        attempted++;
                    } catch (e) {
                        attempted++;
                        failed++;
                    }
                }
                const lossPercent = attempted > 0 ? Math.round((failed / attempted) * 100) : 0;
                const tone = lossPercent === 0 ? 'ok' : (lossPercent < 5 ? 'warn' : 'bad');
                showResult(elements.lossResult, resultTitle(t.lossResult) + metricGrid([
                    metricCard(t.lossResult, attempted > 0 ? lossPercent : '--', '%', tone, lossPercent),
                    metricCard(t.samples, attempted, '', null, null),
                    metricCard(t.lossPacketsLost, failed, '', null, null)
                ]));
                lossTestRunning = false;
            }

            let speedTestRunning = false;
            const SPEED_MODES = {
                quick: { sizes: [524288, 2097152], rounds: 1 },
                standard: { sizes: [262144, 1048576, 4194304], rounds: 2 },
                precise: { sizes: [262144, 1048576, 4194304, 8388608], rounds: 3 }
            };
            function runSpeedTest() {
                const t = i18n[currentLang];
                const out = elements.speedResult;
                if (!out) return;
                setToolParams(
                    '<span class="side-label">' + escapeHTML(t.speedModeLabel) + '</span>' +
                    '<select id="speedMode" class="tool-input">' +
                    '<option value="quick">' + escapeHTML(t.speedModeQuick) + '</option>' +
                    '<option value="standard" selected>' + escapeHTML(t.speedModeStandard) + '</option>' +
                    '<option value="precise">' + escapeHTML(t.speedModePrecise) + '</option>' +
                    '</select>' +
                    '<div class="side-desc" style="margin:0">' + escapeHTML(t.speedNote) + '</div>'
                );
                setToolActions(primaryAction('speedStart', 'fa-play', t.speedBtn));
                out.innerHTML = '<div class="no-data">' + escapeHTML(t.speedModeStandard) + '</div>';
                const go = document.getElementById('speedStart');
                if (go) go.addEventListener('click', startSpeedTest);
            }
            async function measureDownload(size, controller) {
                const start = performance.now();
                const res = await fetch('/speedtest?size=' + size, {
                    cache: 'no-store',
                    signal: controller ? controller.signal : AbortSignal.timeout(30000)
                });
                if (!res.ok) throw new Error('http ' + res.status);
                let bytes = 0, firstByteAt = 0;
                const reader = res.body.getReader();
                while (true) {
                    const step = await reader.read();
                    if (step.done) break;
                    if (!firstByteAt) firstByteAt = performance.now();
                    bytes += step.value ? step.value.byteLength : 0;
                }
                const duration = performance.now() - start;
                if (bytes <= 0 || duration <= 0) throw new Error('empty body');
                return {
                    size: size,
                    bytes: bytes,
                    duration: duration,
                    ttfb: firstByteAt > 0 ? firstByteAt - start : null,
                    mbps: (bytes * 8 / (duration / 1000)) / 1000000
                };
            }
            async function startSpeedTest() {
                if (speedTestRunning) return;
                speedTestRunning = true;
                const t = i18n[currentLang];
                const out = elements.speedResult;
                const modeEl = document.getElementById('speedMode');
                const modeKey = (modeEl && SPEED_MODES[modeEl.value]) ? modeEl.value : 'standard';
                const mode = SPEED_MODES[modeKey];
                if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.speedWarmup) + '</div>';
                const controller = new AbortController();
                activeToolAbort = controller;
                const samples = [];
                try {
                    // 预热：先建立连接，避免把 TCP/TLS 握手计入首轮吞吐
                    try {
                        const warm = await fetch('/health?_warm=' + Date.now(), { cache: 'no-store', signal: controller.signal });
                        try { if (warm.body) { const rd = warm.body.getReader(); await rd.cancel(); } } catch (e0) {}
                    } catch (e0) {}
                    if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.speedTesting) + '</div>';
                    for (const size of mode.sizes) {
                        for (let round = 0; round < mode.rounds; round++) {
                            try {
                                const sample = await measureDownload(size, controller);
                                samples.push(sample);
                            } catch (e) {
                                // 单次失败不影响整体，计入失败样本
                            }
                        }
                    }
                } catch (e) {}
                if (activeToolAbort === controller) activeToolAbort = null;
                const valid = samples.filter(function (s) { return s && s.mbps > 0; });
                if (!valid.length) {
                    if (out) out.innerHTML = '<div class="tool-error"><i class="fas fa-exclamation-triangle"></i> ' + escapeHTML(t.concurrentFailed) + '</div>';
                    speedTestRunning = false;
                    return;
                }
                const bySize = {};
                valid.forEach(function (s) {
                    bySize[s.size] = bySize[s.size] || [];
                    bySize[s.size].push(s.mbps);
                });
                const sizeRows = Object.keys(bySize).map(function (k) {
                    const med = medianValue(bySize[k]);
                    return { sizeKB: Math.round(Number(k) / 1024), size: Number(k), mbps: med, count: bySize[k].length };
                }).sort(function (a, b) { return a.size - b.size; });
                const sizeMedians = sizeRows.map(function (r) { return r.mbps; });
                const avgMbps = sizeMedians.reduce(function (a, b) { return a + b; }, 0) / sizeMedians.length;
                const allVals = valid.map(function (s) { return s.mbps; });
                const best = Math.max.apply(null, allVals);
                const worst = Math.min.apply(null, allVals);
                const mean = allVals.reduce(function (a, b) { return a + b; }, 0) / allVals.length;
                const variance = allVals.reduce(function (s2, v) { return s2 + Math.pow(v - mean, 2); }, 0) / allVals.length;
                const stddev = Math.sqrt(variance);
                const ttfbVals = valid.map(function (s) { return s.ttfb; }).filter(function (v) { return typeof v === 'number' && v > 0; });
                const ttfbMed = ttfbVals.length ? medianValue(ttfbVals) : null;
                const avgTone = avgMbps > 50 ? 'ok' : (avgMbps > 10 ? 'warn' : 'bad');
                const cards = [
                    metricCard(t.speedAvg, avgMbps.toFixed(2), 'Mbps', avgTone, Math.min(100, avgMbps * 2)),
                    metricCard(t.speedMedian, medianValue(allVals).toFixed(2), 'Mbps', null, Math.min(100, medianValue(allVals) * 2)),
                    metricCard(t.speedBest, best.toFixed(2), 'Mbps', 'ok', Math.min(100, best * 2)),
                    metricCard(t.speedWorst, worst.toFixed(2), 'Mbps', 'warn', Math.min(100, worst * 2)),
                    metricCard(t.speedStdDev, stddev.toFixed(2), 'Mbps', stddev < Math.max(1, mean * 0.2) ? 'ok' : 'warn', Math.min(100, stddev * 5)),
                    metricCard(t.speedTtfb, ttfbMed === null ? '—' : Math.round(ttfbMed), 'ms', ttfbMed === null ? null : (ttfbMed < 150 ? 'ok' : (ttfbMed < 400 ? 'warn' : 'bad')), null),
                    metricCard(t.speedSamples, valid.length, '', null, null)
                ];
                const rows = sizeRows.map(function (r) {
                    return '<div class="result-row"><span class="rr-name">' + r.sizeKB + ' KB</span><span class="rr-val">' + r.mbps.toFixed(2) + ' Mbps · ' + r.count + ' ' + escapeHTML(t.speedSamples) + '</span></div>';
                }).join('');
                if (out) out.innerHTML = resultTitle(t.speedResultTitle) + metricGrid(cards) +
                    '<div class="result-rows" style="margin-top:12px">' + rows + '</div>';
                logSpeedTest(avgMbps, sizeRows.map(function (r) { return { sizeKB: r.sizeKB, speed: r.mbps.toFixed(2) }; }));
                pushLocalHistory({ type: 'speed', label: t.speedBtn, value: avgMbps.toFixed(1), unit: ' Mbps', tone: avgTone });
                speedTestRunning = false;
            }

            let dnsTestRunning = false;
            async function runDnsTest() {
                if (dnsTestRunning) return;
                dnsTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.dnsResult, '<span class="loading"></span> ' + t.dnsTesting);
                
                const domains = [
                    { name: 'Cloudflare', url: 'https://cloudflare.com/favicon.ico' },
                    { name: 'Google', url: 'https://www.google.com/favicon.ico' },
                    { name: 'GitHub', url: 'https://github.com/favicon.ico' }
                ];
                const results = [];
                
                for (const domain of domains) {
                    const start = performance.now();
                    try {
                        const loadTime = await new Promise((resolve) => {
                            const img = new Image();
                            const timeout = setTimeout(() => {
                                img.src = '';
                                resolve(null);
                            }, 5000);
                            img.onload = () => { clearTimeout(timeout); resolve(Math.round(performance.now() - start)); };
                            img.onerror = () => { clearTimeout(timeout); resolve(Math.round(performance.now() - start)); };
                            img.src = domain.url;
                        });
                        // 优先取浏览器 Resource Timing 暴露的真实 DNS 解析耗时；
                        // 跨域无 Timing-Allow-Origin 时该值为 0，退化为完整加载耗时
                        let dnsTime = loadTime;
                        try {
                            const entries = performance.getEntriesByName(domain.url);
                            if (entries.length > 0) {
                                const e = entries[entries.length - 1];
                                if (e.domainLookupEnd > 0 && e.domainLookupStart > 0 && e.domainLookupEnd >= e.domainLookupStart) {
                                    dnsTime = Math.round(e.domainLookupEnd - e.domainLookupStart);
                                }
                            }
                        } catch (e2) {}
                        results.push({ domain: domain.name, time: dnsTime });
                    } catch (e) {
                        results.push({ domain: domain.name, time: null });
                    }
                }
                
                const maxT = Math.max(...results.map(r => r.time || 0), 1);
                const cards = results.map(r => r.time !== null
                    ? metricCard(r.domain, r.time, 'ms', r.time < 50 ? 'ok' : (r.time < 150 ? 'warn' : 'bad'), (r.time / maxT) * 100)
                    : metricCard(r.domain, t.dnsTimeout, '', 'bad', 100));
                showResult(elements.dnsResult, resultTitle(t.dnsResultTitle) + metricGrid(cards));
                dnsTestRunning = false;
            }

            // ==================== 流媒体连通性（客户端检测） ====================
            let mediaTestRunning = false;
            async function runClientMediaTest() {
                if (mediaTestRunning) return;
                mediaTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.mediaResult, '<span class="loading"></span> ' + t.mediaTesting);
                
                const services = [
                    { name: 'Netflix', url: 'https://www.netflix.com/favicon.ico' },
                    { name: 'Disney+', url: 'https://www.disneyplus.com/favicon.ico' },
                    { name: 'YouTube', url: 'https://www.youtube.com/favicon.ico' },
                    { name: 'ChatGPT', url: 'https://chat.openai.com/favicon.ico' }
                ];
                
                const checkService = (service) => {
                    return new Promise((resolve) => {
                        const img = new Image();
                        const timeout = setTimeout(() => {
                            img.src = '';
                            resolve({ name: service.name, status: 'blocked', icon: '❌', color: 'var(--danger)', detail: t.mediaBlocked });
                        }, 5000);
                        img.onload = () => {
                            clearTimeout(timeout);
                            resolve({ name: service.name, status: 'available', icon: '✅', color: 'var(--success)', detail: t.mediaAvailable });
                        };
                        img.onerror = () => {
                            clearTimeout(timeout);
                            resolve({ name: service.name, status: 'blocked', icon: '❌', color: 'var(--danger)', detail: t.mediaConnFailed });
                        };
                        img.src = service.url;
                    });
                };
                
                const results = await Promise.all(services.map(s => checkService(s)));
                
                const rows = results.map(r => '<div class="result-row' + (r.status === 'available' ? '' : ' is-bad') + '"><span class="rr-name">' + escapeHTML(r.name) + '</span><span class="rr-val">' + escapeHTML(r.detail) + '</span></div>').join('');
                showResult(elements.mediaResult, resultTitle(t.mediaResultTitle) + '<div class="result-rows">' + rows + '</div>');
                mediaTestRunning = false;
            }

            // ==================================================================
            // 4.7.0 新增：A1 代理检测 · A2 长时质量监控 · A3 多流并发测速
            //            C1 本地历史 · E1 诊断结论可解释化
            // ==================================================================

            // ---------- 公用：结果行 ----------
            function rowItem(name, val, bad) {
                return '<div class="result-row' + (bad ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(String(name)) + '</span>' +
                    '<span class="rr-val" style="word-break:break-all">' + escapeHTML(String(val)) + '</span></div>';
            }

            // ---------- E1：把 findings 的 code 映射为「可能原因 + 建议动作」 ----------
            function adviceBlock(findings) {
                const t = i18n[currentLang];
                const table = t.advice || {};
                const cards = [];
                const seen = {};
                for (const f of (findings || [])) {
                    if (!f || !f.code || seen[f.code]) continue;
                    seen[f.code] = 1;
                    const a = table[f.code];
                    if (!a) continue;
                    cards.push('<div class="result-row" style="flex-direction:column;align-items:flex-start;gap:4px">' +
                        '<span class="rr-name" style="font-size:11px;color:var(--text-tertiary)"><i class="fas fa-circle-question"></i> ' + escapeHTML(t.adviceCause) + '</span>' +
                        '<span class="rr-val" style="font-weight:400;color:var(--text-secondary);white-space:normal;text-align:left">' + escapeHTML(a.cause) + '</span>' +
                        '<span class="rr-name" style="font-size:11px;color:var(--text-tertiary);margin-top:4px"><i class="fas fa-screwdriver-wrench"></i> ' + escapeHTML(t.adviceAction) + '</span>' +
                        '<span class="rr-val" style="font-weight:400;color:var(--text-primary);white-space:normal;text-align:left">' + escapeHTML(a.action) + '</span>' +
                        '</div>');
                }
                if (!cards.length) return '';
                return resultTitle(t.adviceTitle) + '<div class="result-rows">' + cards.join('') + '</div>';
            }

            // ---------- C1：本地历史（localStorage，零 KV 写入） ----------
            const LS_HISTORY_KEY = 'netsight-local-history';
            const LS_HISTORY_MAX = 100;
            const historyViewState = { filter: 'all', a: -1, b: -1 };
            function loadLocalHistoryArr() {
                try {
                    const raw = localStorage.getItem(LS_HISTORY_KEY);
                    const arr = raw ? JSON.parse(raw) : [];
                    return Array.isArray(arr) ? arr : [];
                } catch (e) { return []; }
            }
            function saveLocalHistoryArr(arr) {
                try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify((arr || []).slice(0, LS_HISTORY_MAX))); } catch (e) {}
            }
            function pushLocalHistory(entry) {
                try {
                    if (!entry || !entry.type) return;
                    const arr = loadLocalHistoryArr();
                    arr.unshift({
                        t: Date.now(),
                        type: entry.type,
                        label: entry.label || '',
                        value: entry.value === undefined || entry.value === null ? '' : String(entry.value),
                        unit: entry.unit || '',
                        tone: entry.tone || ''
                    });
                    saveLocalHistoryArr(arr);
                    renderLocalHistory();
                } catch (e) {}
            }
            function historyRecordLabel(r) {
                let time = '';
                try { time = new Date(r.t).toLocaleString(localeOf(currentLang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
                return time + ' · ' + String(r.label || r.type || '') + ' ' + String(r.value || '') + String(r.unit || '');
            }
            function drawHistoryTrend(canvas, points) {
                if (!canvas || !points || points.length < 2) return;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const dpr = window.devicePixelRatio || 1;
                const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 320, height: 120 };
                const w = Math.max(220, Math.round((rect.width || 320) * dpr));
                const h = Math.max(90, Math.round((rect.height || 120) * dpr));
                canvas.width = w;
                canvas.height = h;
                const pad = Math.round(9 * dpr);
                let minV = points[0].v, maxV = points[0].v;
                points.forEach(function (p) { if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v; });
                const span = Math.max(1, maxV - minV);
                ctx.clearRect(0, 0, w, h);
                ctx.beginPath();
                ctx.strokeStyle = cssColorVar('--chart-cyan', '#c3c7cd');
                ctx.lineWidth = Math.max(1.5, 2 * dpr);
                points.forEach(function (p, i) {
                    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
                    const y = h - pad - ((p.v - minV) / span) * (h - pad * 2);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.stroke();
                ctx.fillStyle = cssColorVar('--text-secondary', '#9a9da3');
                ctx.font = Math.round(11 * dpr) + 'px system-ui, sans-serif';
                ctx.fillText(maxV.toFixed(1) + ' Mbps', pad, pad + 11 * dpr);
                ctx.fillText(minV.toFixed(1), pad, h - pad);
            }
            function exportHistoryCsv() {
                try {
                    const arr = loadLocalHistoryArr();
                    const lines = ['time,type,label,value,unit,tone'];
                    arr.forEach(function (r) {
                        let time = '';
                        try { time = new Date(r.t).toISOString(); } catch (e) {}
                        lines.push([time, r.type, r.label, r.value, r.unit, r.tone].map(csvEscape).join(','));
                    });
                    downloadTextFile('netsight-history-' + Date.now() + '.csv', lines.join(String.fromCharCode(13) + String.fromCharCode(10)), 'text/csv;charset=utf-8');
                } catch (e) {}
            }
            function exportHistoryJson() {
                try {
                    const arr = loadLocalHistoryArr();
                    downloadTextFile('netsight-history-' + Date.now() + '.json', JSON.stringify({ v: 1, exportedAt: Date.now(), records: arr }, null, 2), 'application/json;charset=utf-8');
                } catch (e) {}
            }
            function importHistoryJson() {
                try {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'application/json,.json';
                    input.addEventListener('change', function () {
                        const file = input.files && input.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = function () {
                            try {
                                const data = JSON.parse(String(reader.result || ''));
                                const records = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
                                const cleaned = records.filter(function (r) {
                                    return r && typeof r === 'object' && Number.isFinite(Number(r.t)) && r.type;
                                }).map(function (r) {
                                    return { t: Number(r.t), type: String(r.type), label: String(r.label || ''), value: String(r.value === undefined || r.value === null ? '' : r.value), unit: String(r.unit || ''), tone: String(r.tone || '') };
                                });
                                if (!cleaned.length) return;
                                const merged = cleaned.concat(loadLocalHistoryArr());
                                merged.sort(function (a, b) { return b.t - a.t; });
                                saveLocalHistoryArr(merged);
                                renderLocalHistory();
                            } catch (e) {}
                        };
                        reader.readAsText(file);
                    });
                    input.click();
                } catch (e) {}
            }
            function renderLocalHistory() {
                const panel = document.getElementById('speed-history-panel');
                if (!panel) return;
                const t = i18n[currentLang];
                const arr = loadLocalHistoryArr();
                if (!arr.length) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-inbox"></i> ' + escapeHTML(t.historyEmpty) + '</div>';
                    return;
                }
                const types = [];
                arr.forEach(function (r) { if (r && r.type && types.indexOf(r.type) === -1) types.push(r.type); });
                if (historyViewState.filter !== 'all' && types.indexOf(historyViewState.filter) === -1) historyViewState.filter = 'all';
                const filtered = historyViewState.filter === 'all' ? arr : arr.filter(function (r) { return r.type === historyViewState.filter; });
                historyViewState.a = (historyViewState.a >= 0 && historyViewState.a < filtered.length) ? historyViewState.a : -1;
                historyViewState.b = (historyViewState.b >= 0 && historyViewState.b < filtered.length) ? historyViewState.b : -1;
                let html = '<div class="history-toolbar">' +
                    '<select id="historyFilter"><option value="all">' + escapeHTML(t.historyAll) + '</option>' +
                    types.map(function (ty) { return '<option value="' + escapeHTML(ty) + '"' + (historyViewState.filter === ty ? ' selected' : '') + '>' + escapeHTML(ty) + '</option>'; }).join('') +
                    '</select>' +
                    '<button class="btn btn-ghost btn-sm" id="historyExportCsv">' + escapeHTML(t.historyExportCsv) + '</button>' +
                    '<button class="btn btn-ghost btn-sm" id="historyExportJson">' + escapeHTML(t.historyExportJson) + '</button>' +
                    '<button class="btn btn-ghost btn-sm" id="historyImportJson">' + escapeHTML(t.historyImportJson) + '</button>' +
                    '<button class="btn btn-ghost btn-sm" id="clearLocalHistory">' + escapeHTML(t.historyClear) + '</button>' +
                    '</div>';
                const numeric = arr.filter(function (r) { return r && (r.type === 'speed' || r.type === 'concurrent'); })
                    .map(function (r) { return { t: r.t, v: parseFloat(r.value) }; })
                    .filter(function (x) { return Number.isFinite(x.v); }).reverse();
                if (numeric.length >= 2) {
                    html += '<div class="result-title">' + escapeHTML(t.historyTrend) + '</div><canvas id="historyTrendCanvas" class="trend-canvas"></canvas>';
                } else {
                    html += '<div class="no-data" style="padding:10px;font-size:12px">' + escapeHTML(t.historyNoNumeric) + '</div>';
                }
                const optionsHtml = filtered.slice(0, 50).map(function (r, i) {
                    return '<option value="' + i + '"' + (historyViewState.a === i || historyViewState.b === i ? '' : '') + '>' + escapeHTML(historyRecordLabel(r)) + '</option>';
                }).join('');
                html += '<div class="result-title" style="margin-top:12px">' + escapeHTML(t.historyCompare) + '</div>' +
                    '<div class="history-toolbar">' +
                    '<select id="historyCompareA"><option value="-1">' + escapeHTML(t.historyCompareA) + '</option>' + optionsHtml + '</select>' +
                    '<select id="historyCompareB"><option value="-1">' + escapeHTML(t.historyCompareB) + '</option>' + optionsHtml + '</select>' +
                    '</div>';
                let compareHtml = '<div class="no-data" style="padding:8px;font-size:12px">' + escapeHTML(t.historyCompareEmpty) + '</div>';
                const a = filtered[historyViewState.a], b = filtered[historyViewState.b];
                if (a && b) {
                    const av = parseFloat(a.value), bv = parseFloat(b.value);
                    const hasNum = Number.isFinite(av) && Number.isFinite(bv);
                    const diff = hasNum ? (bv - av) : null;
                    const diffText = hasNum ? ((diff > 0 ? '+' : '') + (Math.round(diff * 100) / 100)) : '—';
                    compareHtml = '<div class="result-rows">' +
                        '<div class="result-row"><span class="rr-name">A</span><span class="rr-val">' + escapeHTML(historyRecordLabel(a)) + '</span></div>' +
                        '<div class="result-row"><span class="rr-name">B</span><span class="rr-val">' + escapeHTML(historyRecordLabel(b)) + '</span></div>' +
                        '<div class="result-row"><span class="rr-name">Δ</span><span class="rr-val">' + escapeHTML(diffText + (hasNum ? (a.unit || '') : '')) + '</span></div>' +
                        '</div>';
                }
                html += '<div id="historyCompareOut">' + compareHtml + '</div>';
                html += '<div class="result-title" style="margin-top:12px">' + escapeHTML(t.historyLocalTitle) + '</div>';
                html += '<table class="speed-history-table"><thead><tr><th>' + escapeHTML(t.historyLocalTitle) + '</th><th>' + escapeHTML(t.status) + '</th></tr></thead><tbody>';
                filtered.slice(0, 50).forEach(function (r) {
                    let time = '';
                    try { time = new Date(r.t).toLocaleString(localeOf(currentLang), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
                    const cls = r.tone === 'ok' ? 'speed-good' : (r.tone === 'warn' ? 'speed-mid' : (r.tone === 'bad' ? 'speed-low' : ''));
                    html += '<tr><td><span style="color:var(--text-tertiary);font-size:11px">' + escapeHTML(time) + '</span></td>' +
                        '<td><span style="color:var(--text-tertiary);font-size:11px">' + escapeHTML(r.label) + '</span> <span class="' + cls + '">' +
                        escapeHTML(r.value) + escapeHTML(r.unit) + '</span></td></tr>';
                });
                html += '</tbody></table>';
                panel.innerHTML = html;
                const trendCanvas = document.getElementById('historyTrendCanvas');
                if (trendCanvas) drawHistoryTrend(trendCanvas, numeric);
                const filterSel = document.getElementById('historyFilter');
                if (filterSel) filterSel.addEventListener('change', function () {
                    historyViewState.filter = this.value || 'all';
                    historyViewState.a = -1;
                    historyViewState.b = -1;
                    renderLocalHistory();
                });
                const exportCsv = document.getElementById('historyExportCsv');
                if (exportCsv) exportCsv.addEventListener('click', exportHistoryCsv);
                const exportJson = document.getElementById('historyExportJson');
                if (exportJson) exportJson.addEventListener('click', exportHistoryJson);
                const importJson = document.getElementById('historyImportJson');
                if (importJson) importJson.addEventListener('click', importHistoryJson);
                const clearBtn = document.getElementById('clearLocalHistory');
                if (clearBtn) clearBtn.addEventListener('click', function () {
                    saveLocalHistoryArr([]);
                    historyViewState.a = -1;
                    historyViewState.b = -1;
                    renderLocalHistory();
                });
                const selA = document.getElementById('historyCompareA');
                const selB = document.getElementById('historyCompareB');
                if (selA) {
                    selA.value = String(historyViewState.a);
                    selA.addEventListener('change', function () { historyViewState.a = Number(this.value); renderLocalHistory(); });
                }
                if (selB) {
                    selB.value = String(historyViewState.b);
                    selB.addEventListener('change', function () { historyViewState.b = Number(this.value); renderLocalHistory(); });
                }
            }

            // ---------- 公用：WebRTC 候选 IP 采集（浏览器直连，零 Worker 出站） ----------
            function isLocalIp(ip) {
                return /^(10\\.|172\\.(1[6-9]|2\\d|3[01])\\.|192\\.168\\.|169\\.254\\.|127\\.)/.test(String(ip));
            }
            function collectWebRtcIps(timeoutMs) {
                return new Promise(function (resolve) {
                    const found = new Set();
                    let done = false;
                    const finish = function () { if (!done) { done = true; resolve(found); } };
                    const timeout = setTimeout(finish, timeoutMs || 5000);
                    try {
                        const pc = new RTCPeerConnection({ iceServers: [] });
                        pc.createDataChannel('');
                        pc.onicecandidate = function (e) {
                            if (!e.candidate) {
                                clearTimeout(timeout);
                                try { pc.close(); } catch (e1) {}
                                finish();
                                return;
                            }
                            const match = e.candidate.candidate.match(/(\\d{1,3}\\.){3}\\d{1,3}/);
                            if (match) found.add(match[0]);
                        };
                        pc.createOffer().then(function (offer) { return pc.setLocalDescription(offer); }).catch(function () {
                            clearTimeout(timeout);
                            finish();
                        });
                    } catch (e) {
                        clearTimeout(timeout);
                        finish();
                    }
                });
            }

            // ---------- A1：代理 / VPN 一致性检测 ----------
            let proxyTestRunning = false;
            async function runProxyCheckTool() {
                if (proxyTestRunning) return;
                proxyTestRunning = true;
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const ipSet = await collectWebRtcIps(5000);
                    const ipList = Array.from(ipSet);
                    const localIps = ipList.filter(isLocalIp);
                    const publicIps = ipList.filter(function (ip) { return !isLocalIp(ip); });
                    const httpIp = String(resolvedV4 || BACKEND_DATA.clientIp || '').trim();
                    const mismatch = publicIps.length > 0 && (!httpIp || publicIps.indexOf(httpIp) === -1);
                    const verdict = publicIps.length === 0 ? t.proxyUndetermined : (mismatch ? t.proxyMismatch : t.proxyConsistent);
                    const badge = publicIps.length === 0 ? 'badge' : (mismatch ? 'badge-danger' : 'badge-success');
                    let html = resultTitle(t.proxyBtn) + '<div class="result-rows">' +
                        rowItem(t.proxyEgressIp, httpIp || 'N/A') +
                        rowItem(t.proxyWebrtcPublic, publicIps.length ? publicIps.join(', ') : '—') +
                        rowItem(t.proxyLocalIp, localIps.length ? localIps.join(', ') : '—') +
                        '<div class="result-row"><span class="rr-name">' + escapeHTML(t.status) + '</span><span class="rr-val"><span class="badge ' + badge + '">' + escapeHTML(verdict) + '</span></span></div>' +
                        '</div>' +
                        '<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">' + escapeHTML(t.proxyNote) + '</div>';
                    if (mismatch) html += adviceBlock([{ code: 'proxy_mismatch' }]);
                    if (out) out.innerHTML = html;
                    pushLocalHistory({
                        type: 'proxy',
                        label: t.proxyBtn,
                        value: publicIps.length === 0 ? 'N/A' : (mismatch ? 'MISMATCH' : 'OK'),
                        tone: publicIps.length === 0 ? '' : (mismatch ? 'bad' : 'ok')
                    });
                } catch (e) {
                    if (out) out.innerHTML = '<div class="tool-error"><i class="fas fa-exclamation-triangle"></i> ' + escapeHTML(t.proxyUndetermined) + '</div>';
                }
                proxyTestRunning = false;
            }

            // ---------- A2：长时网络质量监控（p50/p95/p99 + 卡顿时间线） ----------
            let qualityRunning = false;
            let qualityStopRequested = false;
            function runQualityMonitorTool() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                if (qualityRunning) {
                    // 已有一轮监控在跑（可能被关掉弹层后重新打开）：提示并提供停止入口
                    setToolParams('');
                    setToolActions('<button class="btn" id="qmStop"><i class="fas fa-stop"></i> ' + escapeHTML(t.qualityStop) + '</button>');
                    out.innerHTML = '<div class="no-data">' + escapeHTML(t.qualityRunning) + '...</div>';
                    const stopOnly = document.getElementById('qmStop');
                    if (stopOnly) stopOnly.addEventListener('click', function () { qualityStopRequested = true; });
                    return;
                }
                setToolParams(
                    '<span class="side-label">' + escapeHTML(t.qualityBtn) + '</span>' +
                    '<select id="qmDuration" class="tool-input">' +
                    [1, 5, 10].map(function (m) { return '<option value="' + m + '"' + (m === 1 ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') +
                    '</select>' +
                    '<div class="side-desc" style="margin:0">' + escapeHTML(t.qualityNote) + '</div>');
                setToolActions(
                    primaryAction('qmStart', 'fa-play', t.qualityStart) +
                    '<button class="btn" id="qmStop" style="display:none"><i class="fas fa-stop"></i> ' + escapeHTML(t.qualityStop) + '</button>');
                out.innerHTML = '<div id="qmOut"><div class="no-data">' + escapeHTML(t.qualityIntro) + '</div></div>';
                const startBtn = document.getElementById('qmStart');
                const stopBtn = document.getElementById('qmStop');
                if (startBtn) startBtn.addEventListener('click', function () {
                    const sel = document.getElementById('qmDuration');
                    startQualityMonitor(parseInt(sel && sel.value, 10) || 1);
                });
                if (stopBtn) stopBtn.addEventListener('click', function () { qualityStopRequested = true; });
            }
            async function startQualityMonitor(minutes) {
                if (qualityRunning) return;
                qualityRunning = true;
                qualityStopRequested = false;
                const t = i18n[currentLang];
                const out = document.getElementById('qmOut');
                const startBtn = document.getElementById('qmStart');
                const stopBtn = document.getElementById('qmStop');
                if (startBtn) startBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = '';
                const points = [];
                let lost = 0, limited = 0;
                const totalMs = Math.max(1, minutes) * 60000;
                const t0 = performance.now();
                const outEl = function () { return document.getElementById('qmOut'); };
                const showProgress = function () {
                    const box = outEl();
                    if (!box) return;
                    const left = Math.max(0, Math.round((totalMs - (performance.now() - t0)) / 1000));
                    box.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.qualityRunning) +
                        ' · ' + points.length + ' ' + escapeHTML(t.qualitySamples) + ' · ' + left + 's</div>';
                };
                showProgress();
                let i = 0;
                while (!qualityStopRequested && (performance.now() - t0) < totalMs) {
                    const s = performance.now();
                    try {
                        const res = await fetchWithTimeout('/health?_qm=' + Date.now() + '_' + (i++), { method: 'HEAD', cache: 'no-store' }, 3000);
                        if (res.status === 403) {
                            try { await refreshPageToken(); } catch (e) {}
                            limited++;
                            await new Promise(function (r) { setTimeout(r, 1000); });
                            continue;
                        }
                        if (res.status === 429) limited++;
                        else points.push({ v: Math.round(performance.now() - s), t: Math.round(performance.now() - t0) });
                    } catch (e) { lost++; }
                    if (points.length % 5 === 0) showProgress();
                    await new Promise(function (r) { setTimeout(r, 1000); });
                }
                const values = points.map(function (p) { return p.v; });
                const sorted = values.slice().sort(function (a, b) { return a - b; });
                const pick = function (p) {
                    if (!sorted.length) return 0;
                    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
                    return sorted[idx];
                };
                const p50 = pick(0.5), p95 = pick(0.95), p99 = pick(0.99);
                let jit = 0;
                for (let k = 1; k < values.length; k++) jit += Math.abs(values[k] - values[k - 1]);
                jit = values.length > 1 ? Math.round(jit / (values.length - 1)) : 0;
                const attempted = values.length + lost;
                const lossPct = attempted > 0 ? Math.round((lost / attempted) * 100) : 0;
                const stallThreshold = Math.max(1, p50 * 2);
                const stalls = values.filter(function (v) { return v > stallThreshold; }).length;
                // 时间线：每 5 秒一个桶，取桶内最差延迟
                const bucketMs = 5000;
                const buckets = {};
                for (const p of points) {
                    const b = Math.floor(p.t / bucketMs);
                    buckets[b] = Math.max(buckets[b] || 0, p.v);
                }
                const strip = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
                    const v = buckets[k];
                    const color = v <= p50 * 1.5 ? 'var(--success)' : (v <= p50 * 3 ? 'var(--warning)' : 'var(--danger)');
                    return '<span title="' + escapeHTML(String(v)) + 'ms" style="flex:1 1 auto;min-width:3px;height:22px;background:' + color + ';border-radius:2px"></span>';
                }).join('');
                const tone = p95 === 0 ? 'bad' : (p95 <= 100 ? 'ok' : (p95 <= 200 ? 'warn' : 'bad'));
                const cards = [
                    metricCard(t.qualityP50, p50, 'ms', tone, Math.min(100, p50)),
                    metricCard(t.qualityP95, p95, 'ms', tone, Math.min(100, p95)),
                    metricCard(t.qualityP99, p99, 'ms', tone, Math.min(100, p99)),
                    metricCard(t.qualityLoss, lossPct, '%', lossPct === 0 ? 'ok' : (lossPct < 5 ? 'warn' : 'bad'), lossPct),
                    metricCard(t.qualitySamples, values.length, '', null, null),
                    metricCard(t.qualityStalls, stalls, '', stalls === 0 ? 'ok' : 'warn', null)
                ];
                const findings = [];
                if (!values.length) findings.push({ code: 'rtt_fail' });
                if (values.length && lossPct > 0) findings.push({ code: 'loss' });
                if (values.length && p95 > 150) findings.push({ code: 'rtt_high' });
                if (values.length && jit > 30) findings.push({ code: 'jitter_high' });
                if (stalls > 0) findings.push({ code: 'stall' });
                if (limited > 0) findings.push({ code: 'rate_limited' });
                const resultBox = outEl();
                if (resultBox) {
                    resultBox.innerHTML = resultTitle(t.qualityBtn) +
                        metricGrid(cards) +
                        resultTitle(t.qualityTimeline) +
                        '<div style="display:flex;gap:2px;align-items:flex-end">' + (strip || '<span style="font-size:12px;color:var(--text-quaternary)">—</span>') + '</div>' +
                        (qualityStopRequested ? '<div style="margin-top:8px;font-size:11px;color:var(--text-tertiary)">' + escapeHTML(t.qualityStopped) + '</div>' : '') +
                        adviceBlock(findings);
                }
                pushLocalHistory({
                    type: 'quality',
                    label: t.qualityBtn,
                    value: values.length ? ('p50 ' + p50 + '/p95 ' + p95 + ' ms') : 'N/A',
                    tone: values.length ? tone : 'bad'
                });
                if (startBtn) startBtn.style.display = '';
                if (stopBtn) stopBtn.style.display = 'none';
                qualityRunning = false;
            }

            // ---------- A3：多流并发测速 + 实时速率曲线 ----------
            let multiSpeedRunning = false;
            function runMultiSpeedTool() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.multispeedNote) + '</div>');
                setToolActions(primaryAction('msStart', 'fa-play', t.bbStart));
                out.innerHTML = '<div id="msOut"><div class="no-data">' + escapeHTML(t.multispeedIntro) + '</div></div>';
                const go = document.getElementById('msStart');
                if (go) go.addEventListener('click', startMultiSpeedTest);
            }
            async function startMultiSpeedTest() {
                if (multiSpeedRunning) return;
                multiSpeedRunning = true;
                const t = i18n[currentLang];
                const STREAMS = 4;
                const SIZE = 16777216; // 每流 16MB，合计约 64MB
                const msController = new AbortController();
                activeToolAbort = msController;
                const msOut = document.getElementById('msOut');
                if (msOut) msOut.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>' +
                    '<div class="chart-container" style="margin-top:10px"><canvas id="msChart"></canvas></div>';
                const points = [];
                let totalBytes = 0;
                const t0 = performance.now();
                const drawChartNow = function () {
                    const cv = document.getElementById('msChart');
                    if (!cv) return;
                    const rect = cv.parentElement ? cv.parentElement.getBoundingClientRect() : { width: 320 };
                    cv.width = Math.max(200, Math.round(rect.width || 320));
                    cv.height = 160;
                    const g = cv.getContext('2d');
                    if (!g) return;
                    g.clearRect(0, 0, cv.width, cv.height);
                    if (points.length < 2) return;
                    const maxV = Math.max.apply(null, points.map(function (p) { return p.v; })) || 1;
                    g.beginPath();
                    g.strokeStyle = cssColorVar('--chart-cyan', '#c3c7cd');
                    g.lineWidth = 2;
                    points.forEach(function (p, idx) {
                        const x = (idx / (points.length - 1)) * cv.width;
                        const y = cv.height - (p.v / maxV) * (cv.height - 16) - 8;
                        if (idx === 0) g.moveTo(x, y); else g.lineTo(x, y);
                    });
                    g.stroke();
                    g.fillStyle = withAlpha(cssColorVar('--chart-cyan', '#c3c7cd'), 0.18);
                    g.lineTo(cv.width, cv.height);
                    g.lineTo(0, cv.height);
                    g.fill();
                    g.fillStyle = cssColorVar('--text-secondary', '#9a9da3');
                    g.font = '11px system-ui, sans-serif';
                    g.fillText(maxV.toFixed(1) + ' Mbps', 6, 14);
                };
                const runStream = async function () {
                    try {
                        const res = await fetch('/speedtest?size=' + SIZE, { cache: 'no-store', signal: msController.signal });
                        if (!res.ok || !res.body) return;
                        const reader = res.body.getReader();
                        while (true) {
                            const step = await reader.read();
                            if (step.done) break;
                            totalBytes += step.value ? step.value.length : 0;
                        }
                    } catch (e) {}
                };
                let lastTick = performance.now();
                let lastTickBytes = 0;
                const ticker = setInterval(function () {
                    const now = performance.now();
                    const dt = now - lastTick;
                    const db = totalBytes - lastTickBytes;
                    lastTick = now;
                    lastTickBytes = totalBytes;
                    if (dt > 0) {
                        points.push({ t: Math.round(now - t0), v: ((db * 8) / (dt / 1000)) / 1000000 });
                        drawChartNow();
                    }
                }, 250);
                try {
                    const jobs = [];
                    for (let s = 0; s < STREAMS; s++) jobs.push(runStream());
                    await Promise.all(jobs);
                } catch (e) {}
                clearInterval(ticker);
                const wall = Math.max(0.001, (performance.now() - t0) / 1000);
                const avg = ((totalBytes * 8) / wall) / 1000000;
                const vals = points.map(function (p) { return p.v; }).sort(function (a, b) { return a - b; });
                const p95 = vals.length ? vals[Math.min(vals.length - 1, Math.ceil(0.95 * vals.length) - 1)] : 0;
                const stability = avg > 0 ? Math.round((p95 / avg) * 100) : 0;
                const avgTone = avg >= 50 ? 'ok' : (avg >= 10 ? 'warn' : 'bad');
                const cards = [
                    metricCard(t.multispeedAvg, avg.toFixed(2), 'Mbps', avgTone, Math.min(100, avg * 2)),
                    metricCard(t.multispeedP95, p95.toFixed(2), 'Mbps', null, Math.min(100, p95 * 2)),
                    metricCard(t.multispeedStability, stability, '%', stability > 0 && stability < 200 ? 'ok' : 'warn', null),
                    metricCard(t.multispeedStreams, STREAMS, '', null, null),
                    metricCard(t.multispeedTotal, (totalBytes / 1048576).toFixed(1), 'MB', null, null)
                ];
                const findings = [];
                if (!totalBytes) findings.push({ code: 'down_low' });
                else if (avg < 5) findings.push({ code: 'down_low' });
                const msResultEl = document.getElementById('msOut');
                if (msResultEl) {
                    msResultEl.innerHTML = !totalBytes
                        ? '<div class="tool-error"><i class="fas fa-exclamation-triangle"></i> ' + escapeHTML(t.multispeedFailed) + '</div>'
                        : resultTitle(t.multispeedBtn) + metricGrid(cards) +
                          '<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">' + escapeHTML(t.multispeedRate) + ': ' + avg.toFixed(2) + ' Mbps</div>' +
                          adviceBlock(findings);
                }
                pushLocalHistory({
                    type: 'multispeed',
                    label: t.multispeedBtn,
                    value: totalBytes ? avg.toFixed(1) : 'N/A',
                    unit: totalBytes ? ' Mbps' : '',
                    tone: totalBytes ? avgTone : 'bad'
                });
                if (activeToolAbort === msController) activeToolAbort = null;
                multiSpeedRunning = false;
            }

            // ==================== 多节点对比 ====================
            const nodeModalEl = document.getElementById('nodeModal');
            const nodeUrlsInput = document.getElementById('nodeUrls');
            const modalCancel = document.getElementById('modalCancel');
            const modalStart = document.getElementById('modalStart');
            function openNodeModal() {
                if (!nodeModalEl) return;
                try { lastFocusedBeforeModal = document.activeElement; } catch (e) {}
                nodeModalEl.classList.add('active');
                lockModalScroll();
                setTimeout(function () { focusFirstIn(nodeModalEl); }, 0);
            }
            function closeNodeModal() {
                if (nodeModalEl) { try { nodeModalEl.classList.remove('active'); } catch (e) {} }
                unlockModalScrollIfIdle();
                try { if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus(); } catch (e) {}
            }

            if (modalCancel) modalCancel.addEventListener('click', closeNodeModal);

            if (modalStart) modalStart.addEventListener('click', async () => {
                const urls = nodeUrlsInput.value.split('\\n').map(s => s.trim()).filter(s => s);
                if (urls.length === 0) {
                    nodeUrlsInput.style.borderColor = 'var(--danger)';
                    nodeUrlsInput.placeholder = i18n[currentLang].enterNodeUrlAlert;
                    return;
                }
                nodeUrlsInput.style.borderColor = '';
                try { localStorage.setItem('nodeUrls', nodeUrlsInput.value); } catch(e) {}
                closeNodeModal();
                openToolModal(i18n[currentLang].multiBtn, (i18n[currentLang].toolDesc && i18n[currentLang].toolDesc.multi) || '');
                await runMultiNodeTest(urls);
            });

            if (nodeModalEl) nodeModalEl.addEventListener('click', (e) => {
                if (e.target === nodeModalEl) nodeModalEl.classList.remove('active');
            });

            // ==================== 工具卡片 + 结果弹层 ====================
            // 分组顺序与组内顺序即界面展示顺序
            const TOOL_GROUPS = [
                { key: 'quality', icon: 'fa-wave-square', nameKey: 'grpQuality' },
                { key: 'bandwidth', icon: 'fa-gauge-high', nameKey: 'grpBandwidth' },
                { key: 'dns', icon: 'fa-server', nameKey: 'grpDns' },
                { key: 'security', icon: 'fa-shield-halved', nameKey: 'grpSecurity' },
                { key: 'reach', icon: 'fa-tower-cell', nameKey: 'grpReach' },
                { key: 'monitor', icon: 'fa-microchip', nameKey: 'grpMonitor' }
            ];
            const TOOL_LIST = [
                { key: 'quickcheck', group: 'quality', icon: 'fa-heart-pulse', nameKey: 'quickcheckBtn' },
                { key: 'quality', group: 'quality', icon: 'fa-chart-line', nameKey: 'qualityBtn' },
                { key: 'loss', group: 'quality', icon: 'fa-percent', nameKey: 'lossBtn' },
                { key: 'ttfb', group: 'quality', icon: 'fa-stopwatch', nameKey: 'ttfbBtn' },
                { key: 'waterfall', group: 'quality', icon: 'fa-water', nameKey: 'waterfallBtn' },
                { key: 'ws', group: 'quality', icon: 'fa-bolt', nameKey: 'wsBtn' },
                { key: 'proxy', group: 'quality', icon: 'fa-user-secret', nameKey: 'proxyBtn' },
                { key: 'webrtc', group: 'quality', icon: 'fa-user-shield', nameKey: 'webrtcBtn' },
                { key: 'netinfo', group: 'monitor', icon: 'fa-circle-info', nameKey: 'netinfoBtn' },
                { key: 'wizard', group: 'quality', icon: 'fa-wand-magic-sparkles', nameKey: 'wizardBtn' },
                { key: 'speed', group: 'bandwidth', icon: 'fa-gauge-high', nameKey: 'speedBtn' },
                { key: 'multispeed', group: 'bandwidth', icon: 'fa-gauge-simple-high', nameKey: 'multispeedBtn' },
                { key: 'upload', group: 'bandwidth', icon: 'fa-upload', nameKey: 'uploadBtn' },
                { key: 'bufferbloat', group: 'bandwidth', icon: 'fa-wave-square', nameKey: 'bufferbloatBtn' },
                { key: 'stream', group: 'bandwidth', icon: 'fa-stream', nameKey: 'streamBtn' },
                { key: 'concurrent', group: 'bandwidth', icon: 'fa-layer-group', nameKey: 'concurrentBtn' },
                { key: 'dns', group: 'dns', icon: 'fa-server', nameKey: 'dnsBtn' },
                { key: 'dnslookup', group: 'dns', icon: 'fa-magnifying-glass-chart', nameKey: 'dnslookupBtn' },
                { key: 'dnscompare', group: 'dns', icon: 'fa-code-compare', nameKey: 'dnscompareBtn' },
                { key: 'audit', group: 'security', icon: 'fa-stethoscope', nameKey: 'auditBtn' },
                { key: 'domaincheck', group: 'security', icon: 'fa-fingerprint', nameKey: 'domaincheckBtn' },
                { key: 'media', group: 'reach', icon: 'fa-circle-play', nameKey: 'mediaBtn' },
                { key: 'reach', group: 'reach', icon: 'fa-tower-cell', nameKey: 'reachBtn' },
                { key: 'multi', group: 'reach', icon: 'fa-diagram-project', nameKey: 'multiBtn' },
                { key: 'monitor', group: 'monitor', icon: 'fa-tower-broadcast', nameKey: 'monitorBtn' },
                { key: 'cpu', group: 'monitor', icon: 'fa-microchip', nameKey: 'cpuBtn' }
            ];
            let currentToolKey = null;
            const TOOL_RUNNERS = {
                loss: runLossTest, speed: runSpeedTest, dns: runDnsTest, cpu: runCpuTest, ws: runWsTest,
                concurrent: runConcurrentTest, stream: runStreamTest, media: runClientMediaTest,
                webrtc: runWebRtcTest, ttfb: runTtfbTest, upload: runUploadTest, audit: runSiteAudit,
                quickcheck: runQuickCheckTool, bufferbloat: runBufferbloatTool, dnslookup: runDnsLookupTool,
                domaincheck: runDomainCheckTool, monitor: runMonitorTool, dnscompare: runDnsCompare, reach: runReachCheck,
                proxy: runProxyCheckTool, quality: runQualityMonitorTool, multispeed: runMultiSpeedTool,
                waterfall: runWaterfallTool, netinfo: runNetInfoTool, wizard: runDiagnosticWizard
            };

            function isToolDisabledBySite(key) {
                return !!(window.__SITE__ && Array.isArray(window.__SITE__.disabledTools) && window.__SITE__.disabledTools.indexOf(key) >= 0);
            }
            function renderToolCards() {
                const grid = document.getElementById('toolGrid');
                if (!grid) return;
                const t = i18n[currentLang];
                grid.innerHTML = TOOL_GROUPS.map(function (g) {
                    const items = TOOL_LIST.filter(function (x) { return x.group === g.key && !isToolDisabledBySite(x.key); });
                    if (!items.length) return '';
                    const cards = items.map(function (item) {
                        const name = t[item.nameKey] || item.key;
                        const desc = (t.toolDesc && t.toolDesc[item.key]) || '';
                        return '<button class="tool-card" data-tool="' + item.key + '" title="' + escapeHTML(name + (desc ? ' — ' + desc : '')) + '">' +
                            '<span class="tc-icon"><i class="fas ' + item.icon + '"></i></span>' +
                            '<span class="tc-text"><span class="tc-name">' + escapeHTML(name) + '</span></span>' +
                            '<i class="fas fa-chevron-right tc-go"></i>' +
                            '</button>';
                    }).join('');
                    return '<div class="tool-group">' +
                        '<div class="tool-group-head"><i class="fas ' + g.icon + '"></i> <span>' + escapeHTML(t[g.nameKey] || g.key) + '</span>' +
                        '<span class="tg-count">' + items.length + '</span></div>' +
                        '<div class="tool-group-grid">' + cards + '</div>' +
                        '</div>';
                }).join('');
            }

            function handleToolClick(key) {
                if (isToolDisabledBySite(key)) return;
                const t = i18n[currentLang];
                currentToolKey = key;
                if (key === 'multi') {
                    let saved = '';
                    try { saved = localStorage.getItem('nodeUrls') || ''; } catch(e) {}
                    if (nodeUrlsInput) nodeUrlsInput.value = saved;
                    openNodeModal();
                    return;
                }
                const runner = TOOL_RUNNERS[key];
                if (!runner) return;
                const item = TOOL_LIST.find(x => x.key === key);
                openToolModal(t[item ? item.nameKey : key] || key, (t.toolDesc && t.toolDesc[key]) || '');
                runner();
            }

            const toolModalEl = document.getElementById('toolModal');
            const toolModalClose = document.getElementById('toolModalClose');
            if (toolModalClose) toolModalClose.addEventListener('click', closeToolModal);
            if (toolModalEl) toolModalEl.addEventListener('click', (e) => { if (e.target === toolModalEl) closeToolModal(); });
            const toolGridEl = document.getElementById('toolGrid');
            if (toolGridEl) toolGridEl.addEventListener('click', (e) => {
                const card = e.target.closest('.tool-card');
                if (card) handleToolClick(card.getAttribute('data-tool'));
            });

            function rerunCurrentTool() {
                if (!currentToolKey) return;
                if (currentToolKey === 'multi') {
                    openNodeModal();
                    return;
                }
                const t = i18n[currentLang];
                const runner = TOOL_RUNNERS[currentToolKey];
                if (!runner) return;
                const item = TOOL_LIST.find(x => x.key === currentToolKey);
                openToolModal(t[item ? item.nameKey : currentToolKey] || currentToolKey, (t.toolDesc && t.toolDesc[currentToolKey]) || '');
                runner();
            }
            const toolRerunBtn = document.getElementById('toolModalRerun');
            if (toolRerunBtn) toolRerunBtn.addEventListener('click', rerunCurrentTool);

            async function runMultiNodeTest(urls) {
                const t = i18n[currentLang];
                showResult(elements.multiResult, '<span class="loading"></span> ' + t.multiTesting);
                
                const nodes = urls.map(u => {
                    if (!/^https?:\\/\\//i.test(u)) u = 'https://' + u;
                    return u.replace(/\\/+$/, '');
                });

                const results = await Promise.all(nodes.map(async (node) => {
                    const start = performance.now();
                    let latency = null;
                    let status = 'error';
                    let errorMsg = '';
                    try {
                        const testUrl = node + '/node-ping';
                        const res = await fetch(testUrl, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000) });
                        if (res.ok) {
                            latency = Math.round(performance.now() - start);
                            status = 'success';
                        } else {
                            status = 'http_' + res.status;
                            errorMsg = 'HTTP ' + res.status;
                        }
                    } catch (e) {
                        status = 'error';
                        errorMsg = e.message || t.loadFailed;
                    }
                    return { node, latency, status, errorMsg };
                }));

                const rows = results.map(r => {
                    const bad = r.status !== 'success';
                    const val = r.latency !== null ? r.latency + ' ms' : (r.errorMsg || '—');
                    return '<div class="result-row' + (bad ? ' is-bad' : '') + '"><span class="rr-name">' + escapeHTML(r.node) + '</span><span class="rr-val">' + escapeHTML(String(val)) + '</span></div>';
                }).join('');
                showResult(elements.multiResult, resultTitle(t.multiResult) + '<div class="result-rows">' + rows + '</div>');
            }

            // ==================== WebRTC 泄漏检测 ====================
            let webrtcTestRunning = false;
            async function runWebRtcTest() {
                if (webrtcTestRunning) return;
                webrtcTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.webrtcResult, '<span class="loading"></span> ' + t.webrtcTesting);

                try {
                    // 复用 collectWebRtcIps：A1 代理检测与泄漏检测共用同一采集逻辑
                    const ips = await collectWebRtcIps(5000);

                    if (ips.size === 0) {
                        showResult(elements.webrtcResult, resultTitle('WebRTC') + '<div class="result-row"><span class="rr-name">' + t.webrtcSafe + '</span><span class="rr-val">OK</span></div>');
                    } else {
                        const ipList = Array.from(ips);
                        const localIps = ipList.filter(isLocalIp);
                        const publicIps = ipList.filter(function (ip) { return !isLocalIp(ip); });
                        let rows = '';
                        localIps.forEach(ip => { rows += '<div class="result-row"><span class="rr-name">' + t.webrtcLocal + '</span><span class="rr-val">' + escapeHTML(ip) + '</span></div>'; });
                        publicIps.forEach(ip => { rows += '<div class="result-row is-bad"><span class="rr-name">' + t.webrtcPublic + '</span><span class="rr-val">' + escapeHTML(ip) + '</span></div>'; });
                        const verdict = (publicIps.length > 0 || localIps.length > 0) ? t.webrtcLeak : t.webrtcSafe;
                        showResult(elements.webrtcResult, resultTitle('WebRTC · ' + verdict) + '<div class="result-rows">' + rows + '</div>');
                    }
                } catch (e) {
                    showResult(elements.webrtcResult, resultTitle('WebRTC') + '<div class="result-row"><span class="rr-name">' + t.webrtcSafe + '</span><span class="rr-val">OK</span></div>', false);
                }
                webrtcTestRunning = false;
            }

            // ==================== TTFB 分阶段分析 ====================
            let ttfbTestRunning = false;
            async function runTtfbTest() {
                if (ttfbTestRunning) return;
                ttfbTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.ttfbResult, '<span class="loading"></span> ' + t.ttfbTesting);

                try {
                    const testUrl = window.location.origin + '/health?_ttfb=' + Date.now();
                    const entry = await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, 5000);
                        const observer = new PerformanceObserver((list) => {
                            const entries = list.getEntriesByName(testUrl);
                            if (entries.length > 0) {
                                clearTimeout(timeout);
                                observer.disconnect();
                                resolve(entries[0]);
                            }
                        });
                        observer.observe({ type: 'resource', buffered: false });
                        fetch(testUrl, { cache: 'no-store' }).catch(() => {
                            clearTimeout(timeout);
                            observer.disconnect();
                            reject(new Error('fetch failed'));
                        });
                    });
                    
                    const dns = Math.round(entry.domainLookupEnd - entry.domainLookupStart);
                    const tcp = Math.round(entry.connectEnd - entry.connectStart);
                    const tls = Math.round(entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0);
                    const wait = Math.round(entry.responseStart - entry.requestStart);
                    const download = Math.round(entry.responseEnd - entry.responseStart);
                    const total = Math.round(entry.responseEnd - entry.startTime);
                    const maxVal = Math.max(dns, tcp, tls, wait, download, 1);

                    const bar = (label, val, color) => {
                        const pct = Math.max((val / maxVal) * 100, 2);
                        return '<div class="ttfb-row"><span class="ttfb-label">' + label + '</span><div class="ttfb-track"><i style="width:' + pct + '%;background:' + color + '"></i></div><span class="ttfb-val">' + val + 'ms</span></div>';
                    };

                    let html = resultTitle('TTFB') + metricGrid([
                        metricCard(t.ttfbTotal, total, 'ms', null, null)
                    ]) + '<div style="margin-top:12px;">';
                    html += bar(t.ttfbDns, dns, cssColorVar('--chart-cyan', '#c3c7cd'));
                    html += bar(t.ttfbTcp, tcp, cssColorVar('--text-secondary', '#9a9da3'));
                    html += bar(t.ttfbTls, tls, cssColorVar('--chart-teal', '#b0b4ba'));
                    html += bar(t.ttfbWait, wait, cssColorVar('--text-tertiary', '#6a6d74'));
                    html += bar(t.ttfbDownload, download, cssColorVar('--text-quaternary', '#45484e'));
                    html += '</div>';
                    showResult(elements.ttfbResult, html);
                } catch (e) {
                    showResult(elements.ttfbResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.ttfbFailed, true);
                }
                ttfbTestRunning = false;
            }

            // ==================== 上传速度测试 ====================
            let uploadTestRunning = false;
            async function runUploadTest() {
                if (uploadTestRunning) return;
                uploadTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.uploadResult, '<span class="loading"></span> ' + t.uploadTesting);

                try {
                    const sizes = [262144, 1048576, 2097152];
                    const results = [];
                    for (const size of sizes) {
                        const payload = new Uint8Array(size);
                        fillRandomLocal(payload);
                        const start = performance.now();
                        const res = await fetch('/upload-test', { method: 'POST', body: payload });
                        const clientDuration = performance.now() - start;
                        const data = await res.json();
                        const speedMbps = ((size * 8) / (clientDuration / 1000)) / 1000000;
                        results.push({ sizeKB: Math.round(size / 1024), speed: speedMbps.toFixed(2) });
                    }
                    const validResults = results.filter(r => parseFloat(r.speed) > 0);
                    const avgSpeed = validResults.length > 0 ? validResults.reduce((s, r) => s + parseFloat(r.speed), 0) / validResults.length : 0;
                    const avgTone = avgSpeed > 20 ? 'ok' : (avgSpeed > 5 ? 'warn' : 'bad');
                    const cards = results.map(r => metricCard(r.sizeKB + ' KB', r.speed, 'Mbps', null, Math.min(100, (parseFloat(r.speed) || 0) * 3)));
                    cards.push(metricCard(t.uploadResult, avgSpeed.toFixed(2), 'Mbps', avgTone, Math.min(100, avgSpeed * 3)));
                    showResult(elements.uploadResult, resultTitle(t.uploadResult) + metricGrid(cards));
                } catch (e) {
                    showResult(elements.uploadResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.uploadFailed, true);
                }
                uploadTestRunning = false;
            }

            function fillRandomLocal(arr) {
                const CHUNK = 65536;
                for (let i = 0; i < arr.length; i += CHUNK) {
                    crypto.getRandomValues(arr.subarray(i, Math.min(i + CHUNK, arr.length)));
                }
            }

            // ==================== 站点体检 ====================
            function runSiteAudit() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams(
                    '<input type="url" id="auditUrl" class="tool-input" placeholder="' + escapeHTML(t.auditPrompt) + '" value="https://">' +
                    '<label style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);cursor:pointer">' +
                    '<input type="checkbox" id="auditCert"> ' + escapeHTML(t.auditCertLabel) + '</label>');
                setToolActions(primaryAction('auditGo', 'fa-stethoscope', t.auditRun));
                body.innerHTML = '<div class="no-data">' + escapeHTML(t.auditPrompt) + '</div>';
                const input = document.getElementById('auditUrl');
                const go = document.getElementById('auditGo');
                const certBox = document.getElementById('auditCert');
                if (input && go) {
                    const submit = () => startSiteAudit(input.value, !!(certBox && certBox.checked));
                    go.addEventListener('click', submit);
                    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    input.focus();
                }
            }

            async function startSiteAudit(rawUrl, checkCert) {
                const t = i18n[currentLang];
                let u = (rawUrl || '').trim();
                if (!u) return;
                if (!/^https?:\\/\\//i.test(u)) u = 'https://' + u;
                let valid = false;
                try {
                    const p = new URL(u);
                    valid = (p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.includes('.');
                } catch (e) {}
                if (!valid) {
                    showResult(null, '<i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.auditInvalid), true);
                    return;
                }
                showResult(null, '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>');
                try {
                    const res = await fetch('/api/site-audit?url=' + encodeURIComponent(u) + (checkCert ? '&cert=1' : ''), { cache: 'no-store', signal: AbortSignal.timeout(40000) });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error(data.error || 'failed');
                    renderSiteAudit(data);
                } catch (e) {
                    showResult(null, '<i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.auditFailed), true);
                }
            }

            function renderSiteAudit(d) {
                const t = i18n[currentLang];
                const statusOk = d.status >= 200 && d.status < 400;
                const scoreVal = (typeof d.score === 'number') ? d.score : null;
                const cards = [
                    metricCard(t.auditScore, (scoreVal === null ? '--' : scoreVal), (d.grade ? (' / ' + d.grade) : ''), (scoreVal !== null && scoreVal >= 75 ? 'ok' : 'bad'), scoreVal),
                    metricCard(t.auditStatus, d.status, '', statusOk ? 'ok' : 'bad', null),
                    metricCard(t.auditTtfb, d.ttfb, 'ms', null, Math.min(100, d.ttfb)),
                    metricCard(t.auditRedirects, d.redirectCount, '', null, null)
                ];
                const checks = d.checks || [];
                const checkRows = checks.map(c => {
                    const badge = c.status === 'pass' ? t.auditPass : (c.status === 'warn' ? t.auditWarn : t.auditFailN);
                    return '<div class="result-row' + (c.status === 'pass' ? '' : ' is-warn') + '"><span class="rr-name">' + escapeHTML(c.name) + '</span>' +
                        '<span class="rr-val">' + escapeHTML(badge) + (c.detail ? (' · ' + escapeHTML(String(c.detail).slice(0, 50))) : '') + '</span></div>';
                }).join('');
                const issues = d.issues || [];
                const issueMap = t.auditIssueMap || {};
                const issueRows = issues.length
                    ? issues.map(code => '<div class="result-row is-warn"><span class="rr-name">!</span><span class="rr-val">' + escapeHTML(issueMap[code] || code) + '</span></div>').join('')
                    : '<div class="result-row"><span class="rr-name">OK</span><span class="rr-val">' + escapeHTML(t.auditNoIssues) + '</span></div>';
                const certRows = d.cert
                    ? resultTitle('TLS Certificate') +
                      '<div class="result-rows">' +
                      rowItem('notAfter', d.cert.notAfter + ' · ' + d.cert.daysLeft + 'd') +
                      rowItem('issuer', d.cert.issuer || '-') +
                      rowItem('source', d.cert.source || '-') +
                      '</div>'
                    : '';
                const html =
                    resultTitle(t.auditFinal) +
                    '<div class="result-rows" style="margin-bottom:16px;"><div class="result-row"><span class="rr-name">' + escapeHTML(d.finalUrl || '') + '</span><span class="rr-val">' + escapeHTML(String(d.status)) + '</span></div></div>' +
                    metricGrid(cards) +
                    certRows +
                    resultTitle(t.auditChecks) +
                    '<div class="result-rows">' + checkRows + '</div>' +
                    resultTitle(t.auditIssues) +
                    '<div class="result-rows">' + issueRows + '</div>';
                showResult(null, html);
                pushLocalHistory({
                    type: 'audit',
                    label: t.auditBtn,
                    value: (scoreVal === null ? '--' : scoreVal) + (d.grade ? '/' + d.grade : ''),
                    tone: scoreVal !== null && scoreVal >= 75 ? 'ok' : (scoreVal !== null && scoreVal >= 55 ? 'warn' : 'bad')
                });
            }

            function runDnsCompare() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams('<input type="text" id="dcNameInput" class="tool-input" placeholder="example.com" autocomplete="off" value="' + escapeHTML(window.location.hostname || 'example.com') + '">' +
                    '<select id="dcTypeSelect" class="tool-input">' + ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'].map(function (x) { return '<option' + (x === 'A' ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>');
                setToolActions(primaryAction('dcGo', 'fa-code-compare', t.dnsQueryBtn));
                body.innerHTML = '<div id="dcOut"><div class="no-data">' + escapeHTML(t.dcPrompt) + '</div></div>';
                const go = document.getElementById('dcGo');
                const inp = document.getElementById('dcNameInput');
                if (go) go.addEventListener('click', () => doDnsCompare());
                if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doDnsCompare(); } });
            }

            async function doDnsCompare() {
                const t = i18n[currentLang];
                const out = document.getElementById('dcOut');
                const inp = document.getElementById('dcNameInput');
                if (!out || !inp) return;
                const name = String(inp.value || '').trim().toLowerCase().replace(/\\.$/, '');
                if (!name || !/^[a-z0-9_][a-z0-9_.-]*$/.test(name) || name.indexOf('..') !== -1 || name.length > 253) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.dnsInvalidDomain) + '</div>';
                    return;
                }
                out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const typeEl = document.getElementById('dcTypeSelect');
                    const qType = typeEl ? typeEl.value : 'A';
                    const res = await fetch('/api/dns-compare?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(qType), { cache: 'no-store', signal: AbortSignal.timeout(25000) });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error('failed');
                    renderDnsCompare(data, out);
                } catch (e) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.dcFailed) + '</div>';
                }
            }

            function renderDnsCompare(d, host) {
                const t = i18n[currentLang];
                const out = host || document.getElementById('dcOut');
                if (!out) return;
                const rows = (d.resolvers || []).map(r => {
                    const val = r.status === 'ok'
                        ? ((r.answers || []).map(a => a.data).join(', ') || '(empty)')
                        : (r.status === 'nxdomain' ? 'NXDOMAIN' : (r.error || r.status));
                    const adBadge = r.ad ? ' <span class="badge badge-success" title="DNSSEC authenticated">DNSSEC</span>' : '';
                    return '<div class="result-row' + (r.status === 'ok' ? '' : ' is-warn') + '"><span class="rr-name">' + escapeHTML(r.label) + adBadge + '</span>' +
                        '<span class="rr-val" style="word-break:break-all">' + escapeHTML(String(val).slice(0, 200)) + ' · ' + escapeHTML(String(r.time || 0)) + 'ms</span></div>';
                }).join('');
                const okCount = (d.resolvers || []).filter(r => r.status === 'ok').length;
                const verdict = okCount === 0
                    ? '<div class="result-row is-warn"><span class="rr-name">' + escapeHTML(t.dcFailed) + '</span><span class="rr-val">0/' + escapeHTML(String((d.resolvers || []).length)) + ' OK</span></div>'
                    : (d.consistent
                        ? '<div class="result-row"><span class="rr-name">' + escapeHTML(t.dcConsistent) + '</span><span class="rr-val">OK</span></div>'
                        : '<div class="result-row is-warn"><span class="rr-name">' + escapeHTML(t.dcInconsistent) + '</span><span class="rr-val">' + escapeHTML(String((d.groups || []).length)) + ' groups</span></div>');
                out.innerHTML = resultTitle(t.dcTitle + ' · ' + d.name + ' (' + d.type + ')') +
                    '<div class="result-rows">' + rows + '</div>' +
                    '<div style="margin-top:12px" class="result-rows">' + verdict + '</div>';
            }

            async function runReachCheck() {
                const t = i18n[currentLang];
                showResult(null, '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>');
                // 纯浏览器侧探测：以用户网络为主，Worker 零出站请求
                const REACH_TARGETS = [
                    { id: 'baidu', label: '百度', url: 'https://www.baidu.com/favicon.ico' },
                    { id: 'qq', label: '腾讯', url: 'https://www.qq.com/favicon.ico' },
                    { id: 'taobao', label: '淘宝', url: 'https://www.taobao.com/favicon.ico' },
                    { id: 'bilibili', label: '哔哩哔哩', url: 'https://www.bilibili.com/favicon.ico' },
                    { id: 'github', label: 'GitHub', url: 'https://github.com/favicon.ico' },
                    { id: 'cloudflare', label: 'Cloudflare', url: 'https://www.cloudflare.com/favicon.ico' },
                    { id: 'google', label: 'Google', url: 'https://www.google.com/favicon.ico' },
                    { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/favicon.ico' },
                    { id: 'x', label: 'X (Twitter)', url: 'https://abs.twimg.com/favicon.ico' },
                    { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/favicon.ico' }
                ];
                const probe = async (url) => {
                    const t0 = performance.now();
                    try {
                        await fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { mode: 'no-cors', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(6000) });
                        return { ok: true, time: Math.round(performance.now() - t0) };
                    } catch (e) {
                        return { ok: false, time: Math.round(performance.now() - t0) };
                    }
                };
                const results = await Promise.all(REACH_TARGETS.map(async (tg) => {
                    const r = await probe(tg.url);
                    return { id: tg.id, label: tg.label, ok: r.ok, time: r.time };
                }));
                renderReachCheck(results);
            }

            function renderReachCheck(results) {
                const t = i18n[currentLang];
                const okCount = results.filter(r => r.ok).length;
                const rows = results.map(r => {
                    const bad = !r.ok;
                    return '<div class="result-row' + (bad ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(r.label) + '</span>' +
                        '<span class="rr-val">' + (r.ok ? '✅ ' + escapeHTML(t.reachOk) : '❌ ' + escapeHTML(t.reachBlocked)) + ' · ' + escapeHTML(String(r.time || 0)) + 'ms</span></div>';
                }).join('');
                showResult(null, resultTitle(t.reachTitle) +
                    '<div style="margin:6px 0 10px;font-size:12px;color:var(--text-secondary)">' + escapeHTML(t.reachBrowser) + ': ' + okCount + '/' + results.length + '</div>' +
                    '<div class="result-rows">' + rows + '</div>' +
                    '<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">' + escapeHTML(t.reachNote) + '</div>');
            }

            // ==================== 报告生成 ====================
            function generateReportText() {
                const t = i18n[currentLang];
                const localeMap = { 'en': 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
                const now = new Date().toLocaleString(localeMap[currentLang] || 'en-US', { timeZone: 'Asia/Shanghai' });
                const currentRtt = elements.rttNum ? elements.rttNum.textContent : '--';
                const currentJitter = elements.jitterVal ? elements.jitterVal.textContent : '--';
                const quality = document.getElementById('quality-badge') ? document.getElementById('quality-badge').textContent : '--';
                const stability = document.getElementById('stability-badge') ? document.getElementById('stability-badge').textContent : '--';
                const lossRate = document.getElementById('loss-rate') ? document.getElementById('loss-rate').textContent : '0%';
                const sampleCountVal = document.getElementById('sample-count') ? document.getElementById('sample-count').textContent : '0';
                const minRttVal = document.getElementById('min-rtt') ? document.getElementById('min-rtt').textContent : '--';
                const maxRttVal = document.getElementById('max-rtt') ? document.getElementById('max-rtt').textContent : '--';
                const clientLocation = BACKEND_DATA.realGeoCity ? BACKEND_DATA.realGeoCity + ', ' + BACKEND_DATA.realGeoCountry : t.reportUnknown;
                const http2Status = elements.http2Val ? elements.http2Val.textContent.trim() : '--';

                let fraudInfo = '';
                const fraudSection = document.querySelector('.fraud-info');
                if (fraudSection) {
                    const rows = fraudSection.querySelectorAll('.info-row');
                    rows.forEach(row => {
                        const label = row.querySelector('.info-label')?.textContent?.trim() || '';
                        const value = row.querySelector('.info-value')?.textContent?.trim() || '';
                        fraudInfo += \`    \${label}: \${value}\\n\`;
                    });
                }

                return \`# \${t.reportTitle}
**\${t.reportGenTime}**: \${now}
**\${t.edgeLabel}**: \${BACKEND_DATA.colo} (\${BACKEND_DATA.city})
**\${t.clientLabel} IPv4**: \${elements.v4 ? elements.v4.textContent : 'N/A'}
**RAY ID**: \${BACKEND_DATA.rayId}

## 📡 \${t.reportNetMetrics}
- **\${t.rttCurrent}**: \${currentRtt} ms
- **\${t.jitter}**: \${currentJitter} ms
- **\${t.rttMin}**: \${minRttVal} ms
- **\${t.rttMax}**: \${maxRttVal} ms
- **\${t.quality}**: \${quality}
- **\${t.stability}**: \${stability}
- **\${t.loss}**: \${lossRate}
- **\${t.samples}**: \${sampleCountVal}

## 🔒 \${t.reportSecProto}
- **\${t.protoLabel}**: \${BACKEND_DATA.httpProtocolRaw}
- **\${t.tlsVersion}**: \${BACKEND_DATA.tlsVersion}
- **\${t.cipher}**: \${BACKEND_DATA.tlsCipher}
- **\${t.echLabel}**: \${BACKEND_DATA.tlsClientHelloLength > 0 ? t.echEnabled : t.echDisabled}
- **\${t.compressLabel}**: \${BACKEND_DATA.compressionBrotli ? 'Brotli ' : ''}\${BACKEND_DATA.compressionGzip ? 'Gzip' : t.reportCompressNone}
- **\${t.http2Label}**: \${http2Status}
- **\${t.botLabel}**: \${BACKEND_DATA.botScore}

## 📍 \${t.reportLocation}
- **\${t.edgeLabel}**: \${BACKEND_DATA.city}, \${BACKEND_DATA.region}, \${BACKEND_DATA.country}
- **\${t.userLocation}**: \${clientLocation}
- **\${t.userOrg}**: \${BACKEND_DATA.realGeoOrg || BACKEND_DATA.asOrg}

\${fraudInfo ? '## 🛡️ ' + t.reportIpRisk + '\\n' + fraudInfo : ''}
---
*\${t.reportFooter}*\`;
            }

            async function copyReport() {
                const text = generateReportText();
                try {
                    await navigator.clipboard.writeText(text);
                    const copySpan = document.getElementById('t-copy');
                    if (copySpan) {
                        const originalText = copySpan.textContent;
                        copySpan.textContent = i18n[currentLang].copied;
                        setTimeout(() => {
                            copySpan.textContent = originalText;
                        }, 2000);
                    }
                } catch (err) {
                    console.error('复制失败:', err);
                }
            }

            // ==================== v4.8 通用助手 ====================
            function formatMs(v) {
                return (Math.round((Number(v) || 0) * 100) / 100) + ' ms';
            }
            function formatBytes(v) {
                const n = Number(v) || 0;
                if (n < 1024) return n + ' B';
                if (n < 1048576) return (Math.round(n / 102.4) / 10) + ' KB';
                return (Math.round(n / 104857.6) / 10) + ' MB';
            }
            function shortResName(u) {
                try {
                    const x = new URL(u, location.href);
                    const parts = x.pathname.split('/').filter(Boolean);
                    const name = parts.length ? parts[parts.length - 1] : '/';
                    const prefix = (x.host && x.host !== location.host) ? x.host + ' ' : '';
                    return (prefix + name).slice(0, 46) || '/';
                } catch (e) { return String(u || '').slice(0, 46); }
            }
            function downloadTextFile(filename, text, mime) {
                try {
                    const blob = new Blob([String(text)], { type: mime || 'text/plain;charset=utf-8' });
                    const a = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(function () {
                        try { URL.revokeObjectURL(url); } catch (e) {}
                        if (a.parentNode) a.parentNode.removeChild(a);
                    }, 1500);
                } catch (e) {}
            }
            function csvEscape(v) {
                const s = String(v === undefined || v === null ? '' : v);
                const hasSpecial = s.indexOf('"') >= 0 || s.indexOf(',') >= 0 || s.indexOf(String.fromCharCode(10)) >= 0 || s.indexOf(String.fromCharCode(13)) >= 0; return hasSpecial ? '"' + s.replace(/"/g, '""') + '"' : s;
            }
            function encodeSharePayload(obj) {
                const json = JSON.stringify(obj);
                let b64 = btoa(unescape(encodeURIComponent(json)));
                b64 = b64.split('+').join('-').split('/').join('_');
                while (b64.length && b64.charAt(b64.length - 1) === '=') b64 = b64.slice(0, -1);
                return b64;
            }
            function decodeSharePayload(str) {
                let raw = String(str || '').split('-').join('+').split('_').join('/');
                while (raw.length % 4) raw += '=';
                return JSON.parse(decodeURIComponent(escape(atob(raw))));
            }
            function buildShareSnapshot() {
                const nums = rttData.slice(-20);
                const avgRtt = nums.length ? Math.round(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length) : (lastRtt || 0);
                let hist = [];
                try { hist = loadLocalHistoryArr(); } catch (e) {}
                const last = hist.length ? hist[0] : null;
                return {
                    v: 1,
                    time: Date.now(),
                    lang: currentLang,
                    ip: BACKEND_DATA.clientIp || '',
                    colo: BACKEND_DATA.colo || '',
                    org: BACKEND_DATA.asOrg || '',
                    rtt: avgRtt,
                    loss: totalAttempts ? Math.round((totalLoss / totalAttempts) * 100) : 0,
                    last: last ? { label: String(last.label || ''), value: String(last.value || ''), unit: String(last.unit || '') } : null
                };
            }
            function copySnapshotLink(btn) {
                try {
                    const snap = buildShareSnapshot();
                    const url = location.origin + location.pathname + '#s=' + encodeSharePayload(snap);
                    if (url.length > 8000) {
                        showResult(null, '<i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(i18n[currentLang].shareTooLong), true);
                        return;
                    }
                    copyTextToClipboard(url, btn);
                } catch (e) {}
            }
            function showSharedSnapshot() {
                try {
                    if (!location.hash || location.hash.indexOf('#s=') !== 0) return;
                    const d = decodeSharePayload(location.hash.slice(3));
                    if (!d || d.v !== 1) return;
                    const lang = d.lang && i18n[d.lang] ? d.lang : currentLang;
                    const t = i18n[lang];
                    const parts = [];
                    if (d.ip) parts.push('IP ' + d.ip);
                    if (d.colo) parts.push('COLO ' + d.colo);
                    if (d.rtt) parts.push('RTT ' + d.rtt + ' ms');
                    if (typeof d.loss === 'number') parts.push('LOSS ' + d.loss + '%');
                    if (d.last && d.last.label) parts.push(d.last.label + ' ' + d.last.value + (d.last.unit || ''));
                    if (!parts.length) return;
                    const banner = document.createElement('div');
                    banner.className = 'share-banner';
                    banner.innerHTML = '<i class="fas fa-link"></i><span>' +
                        '<strong>' + escapeHTML(t.shareSnapshotTitle || 'Shared snapshot') + '</strong> · ' +
                        escapeHTML(parts.join(' · ')) + ' · ' + escapeHTML(t.shareSnapshotDesc || '') +
                        '</span><button class="btn btn-ghost btn-sm" id="shareBannerClose" aria-label="close">×</button>';
                    document.body.appendChild(banner);
                    const close = document.getElementById('shareBannerClose');
                    if (close) close.addEventListener('click', function () { if (banner.parentNode) banner.parentNode.removeChild(banner); });
                } catch (e) {}
            }

            // ==================== Bufferbloat 负载延迟测试 ====================
            function medianValue(arr) {
                if (!arr || arr.length === 0) return 0;
                const a = arr.slice().sort((x, y) => x - y);
                const m = Math.floor(a.length / 2);
                return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
            }
            function bufferbloatGrade(delta) {
                return delta < 30 ? 'A' : delta < 60 ? 'B' : delta < 100 ? 'C' : delta < 200 ? 'D' : 'F';
            }
            function gradeBadgeClass(g) {
                return (g === 'A' || g === 'B') ? 'badge-success' : (g === 'C' ? 'badge-warning' : 'badge-danger');
            }
            let bbRunning = false;
            let _bbUploadPayload = null;
            function getBbUploadPayload() {
                if (!_bbUploadPayload) {
                    const arr = new Uint8Array(33554432);
                    fillRandomLocal(arr);
                    _bbUploadPayload = arr;
                }
                return _bbUploadPayload;
            }
            function runBufferbloatTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.bbNote) + '</div>');
                setToolActions(primaryAction('bbStart', 'fa-wave-square', t.bbStart));
                body.innerHTML = '<div id="bbResult"><div class="no-data">' + escapeHTML(t.bbIntro) + '</div></div>';
                const go = document.getElementById('bbStart');
                if (go) go.addEventListener('click', startBufferbloatTest);
            }
            async function bbLoadPhase(dir, seconds) {
                const samples = [];
                const controller = new AbortController();
                let running = true;
                let limited = false;
                let failures = 0;
                const startLoop = () => (async () => {
                    while (running) {
                        try {
                            let r;
                            if (dir === 'down') {
                                r = await fetch('/speedtest?size=67108864', { signal: controller.signal, cache: 'no-store' });
                                if (r.status === 429) { limited = true; running = false; break; }
                                if (r.body) {
                                    const rd = r.body.getReader();
                                    while (true) {
                                        const step = await rd.read();
                                        if (step.done) break;
                                    }
                                }
                            } else {
                                r = await fetch('/upload-test', { method: 'POST', body: getBbUploadPayload(), signal: controller.signal });
                                if (r.status === 429) { limited = true; running = false; break; }
                                try { await r.arrayBuffer(); } catch (e0) {}
                            }
                        } catch (e) {
                            if (running) { failures++; await new Promise(r2 => setTimeout(r2, 100)); }
                        }
                    }
                })();
                const loops = [startLoop(), startLoop()];
                const t0 = performance.now();
                while (performance.now() - t0 < seconds * 1000) {
                    const s = performance.now();
                    try {
                        const hres = await fetchWithTimeout('/health?_bb=' + dir + Date.now(), { method: 'HEAD', cache: 'no-store' }, 2000);
                        if (hres.status !== 429) samples.push(performance.now() - s); // 429 是限流响应，不算有效样本
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 300));
                }
                running = false;
                controller.abort();
                try { await Promise.allSettled(loops); } catch (e) {}
                return { samples: samples, limited: limited, failures: failures };
            }
            async function startBufferbloatTest() {
                if (bbRunning) return;
                bbRunning = true;
                const t = i18n[currentLang];
                const out = document.getElementById('bbResult');
                const setProgress = (label) => {
                    if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(label) + '</div>';
                };
                try {
                    setProgress(t.bbRunning);
                    const baseline = [];
                    for (let i = 0; i < 6; i++) {
                        const s = performance.now();
                        try {
                            const bres = await fetchWithTimeout('/health?_bb=base' + i, { method: 'HEAD', cache: 'no-store' }, 3000);
                            if (bres.status !== 429) baseline.push(performance.now() - s);
                        } catch (e) {}
                        await new Promise(r => setTimeout(r, 250));
                    }
                    const hasBase = baseline.length > 0;
                    const baseMed = hasBase ? Math.round(medianValue(baseline)) : 0;
                    const downRes = await bbLoadPhase('down', 8);
                    const upRes = await bbLoadPhase('up', 8);
                    const downSamples = downRes.samples;
                    const upSamples = upRes.samples;
                    const downOk = downSamples.length > 0;
                    const upOk = upSamples.length > 0;
                    const downMed = downOk ? Math.round(medianValue(downSamples)) : 0;
                    const upMed = upOk ? Math.round(medianValue(upSamples)) : 0;
                    const canGrade = hasBase && (downOk || upOk);
                    const downDelta = (hasBase && downOk) ? Math.max(0, downMed - baseMed) : 0;
                    const upDelta = (hasBase && upOk) ? Math.max(0, upMed - baseMed) : 0;
                    const downGrade = bufferbloatGrade(downDelta);
                    const upGrade = bufferbloatGrade(upDelta);
                    const overall = downDelta > upDelta ? downGrade : upGrade;
                    const loadFailures = (downRes.failures || 0) + (upRes.failures || 0);
                    const cards = [
                        metricCard(t.bbBaseline, hasBase ? baseMed : 'N/A', 'ms', null, null),
                        metricCard(t.bbLoadedDown, downOk ? downMed : 'N/A', 'ms', null, Math.min(100, downDelta)),
                        metricCard(t.bbLoadedUp, upOk ? upMed : 'N/A', 'ms', null, Math.min(100, upDelta)),
                        metricCard(t.bbLoadLoss, loadFailures, '', loadFailures > 0 ? 'warn' : 'ok', null)
                    ];
                    const gradeRow = function(label, ok, grade, delta) {
                        const val = ok
                            ? '<span class="badge ' + gradeBadgeClass(grade) + '">' + grade + ' · +' + delta + ' ms</span>'
                            : '<span class="badge">N/A</span>';
                        return '<div class="result-row"><span class="rr-name">' + escapeHTML(label) + '</span><span class="rr-val">' + val + '</span></div>';
                    };
                    const rowsHtml =
                        '<div class="result-rows">' +
                        gradeRow(t.bbDelta + ' (↓)', downOk, downGrade, downDelta) +
                        gradeRow(t.bbDelta + ' (↑)', upOk, upGrade, upDelta) +
                        (canGrade
                            ? '<div class="result-row"><span class="rr-name">' + escapeHTML(t.bbGrade) + '</span><span class="rr-val"><span class="badge ' + gradeBadgeClass(overall) + '">' + overall + '</span></span></div>'
                            : '<div class="result-row is-warn"><span class="rr-name">' + escapeHTML(t.bbGrade) + '</span><span class="rr-val">' + escapeHTML(t.bbNoSamples) + '</span></div>') +
                        '</div>';
                    const limitedWarn = (downRes.limited || upRes.limited)
                        ? '<div class="result-rows" style="margin-top:10px"><div class="result-row is-warn"><span class="rr-name">⚠ ' + escapeHTML(t.bbLimited) + '</span></div></div>'
                        : '';
                    const bbFindings = [];
                    if (canGrade && (downGrade === 'D' || downGrade === 'F')) bbFindings.push({ code: 'down_low' });
                    if (canGrade && (upGrade === 'D' || upGrade === 'F')) bbFindings.push({ code: 'up_low' });
                    const adviceHtml = bbFindings.length ? adviceBlock(bbFindings) : '';
                    const html = resultTitle(t.bufferbloatBtn) + metricGrid(cards) + rowsHtml + limitedWarn + adviceHtml;
                    if (out) out.innerHTML = html;
                } catch (e) {
                    if (out) out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.bbFailed) + '</div>';
                }
                bbRunning = false;
            }

            // ==================== F6：诊断向导（引导式逐项检测） ====================
            let wizardRunning = false;
            function wizardAdvice(t, key) {
                return t[key] || '';
            }
            function runDiagnosticWizard() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.wizardNote) + '</div>');
                setToolActions(primaryAction('wizStart', 'fa-play', t.qcStart || t.start));
                out.innerHTML = '<div id="wizOut"><div class="no-data">' + escapeHTML(t.wizardIntro) + '</div></div>';
                const go = document.getElementById('wizStart');
                if (go) go.addEventListener('click', startDiagnosticWizard);
            }
            async function startDiagnosticWizard() {
                if (wizardRunning) return;
                wizardRunning = true;
                const t = i18n[currentLang];
                const out = document.getElementById('wizOut');
                const controller = new AbortController();
                activeToolAbort = controller;
                const started = Date.now();
                const setStep = function (text) {
                    if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(text) + '</div>';
                };
                const result = { rtts: [], loss: 0, dnsMs: null, dnsOk: false, speeds: [], protocol: '', http3: false, http2: false };
                try {
                    setStep(t.wizardStepRtt + ' ...');
                    for (let i = 0; i < 6; i++) {
                        const s = performance.now();
                        try {
                            const r = await fetch('/health?_wiz=' + Date.now() + '_' + i, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
                            if (r.status === 429) continue;
                            result.rtts.push(Math.round(performance.now() - s));
                        } catch (e) { result.loss++; }
                        await new Promise(function (res) { setTimeout(res, 200); });
                    }
                    setStep(t.wizardStepDns + ' ...');
                    const dnsStart = performance.now();
                    try {
                        const r = await fetch('/api/dns-lookup?name=' + encodeURIComponent(location.hostname || 'example.com') + '&type=A', { cache: 'no-store', signal: controller.signal });
                        result.dnsOk = r.ok;
                        await r.json();
                    } catch (e) { result.dnsOk = false; }
                    result.dnsMs = Math.round(performance.now() - dnsStart);
                    setStep(t.wizardStepSpeed + ' ...');
                    for (const size of [262144, 1048576]) {
                        try {
                            const s = performance.now();
                            const r = await fetch('/speedtest?size=' + size, { cache: 'no-store', signal: controller.signal });
                            if (!r.ok) continue;
                            let bytes = 0;
                            const reader = r.body.getReader();
                            while (true) { const step = await reader.read(); if (step.done) break; bytes += step.value ? step.value.byteLength : 0; }
                            const sec = (performance.now() - s) / 1000;
                            if (sec > 0 && bytes > 0) result.speeds.push((bytes * 8 / sec) / 1000000);
                        } catch (e) {}
                    }
                    setStep(t.wizardStepProto + ' ...');
                    try {
                        const r = await fetch('/http2-test', { cache: 'no-store', signal: controller.signal });
                        const d = await r.json();
                        result.http2 = !!d.http2; result.http3 = !!d.http3;
                        result.protocol = d.protocol || (result.http3 ? 'HTTP/3' : (result.http2 ? 'HTTP/2' : 'HTTP/1.1'));
                    } catch (e) {}
                } catch (e) {}
                if (activeToolAbort === controller) activeToolAbort = null;
                const rtts = result.rtts.slice().sort(function (a, b) { return a - b; });
                const rttMed = rtts.length ? rtts[Math.floor(rtts.length / 2)] : 0;
                const attempts = 6;
                const lossPct = attempts > 0 ? Math.round((result.loss / attempts) * 100) : 0;
                const speedMed = result.speeds.length ? medianValue(result.speeds) : 0;
                let score = 100;
                if (rttMed > 150) score -= Math.min(35, Math.round((rttMed - 150) / 10));
                else if (rttMed > 60) score -= Math.min(20, Math.round((rttMed - 60) / 5));
                score -= Math.min(30, lossPct * 3);
                if (result.dnsMs !== null) {
                    if (!result.dnsOk) score -= 10;
                    else if (result.dnsMs > 300) score -= 15;
                    else if (result.dnsMs > 120) score -= 8;
                }
                if (speedMed > 0) {
                    if (speedMed < 5) score -= 20;
                    else if (speedMed < 20) score -= 10;
                }
                score = Math.max(0, Math.min(100, score));
                const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
                const tone = score >= 75 ? 'ok' : (score >= 55 ? 'warn' : 'bad');
                const advice = [];
                if (rttMed > 150) advice.push(t.wizardAdviceHighLatency);
                if (lossPct > 0) advice.push(t.wizardAdviceLoss);
                if (result.dnsMs !== null && (!result.dnsOk || result.dnsMs > 250)) advice.push(t.wizardAdviceDns);
                if (speedMed > 0 && speedMed < 10) advice.push(t.wizardAdviceSpeed);
                if (!advice.length) advice.push(t.wizardAdviceOk);
                const cards = [
                    metricCard(t.wizardLatency, rttMed, 'ms', rttMed < 60 ? 'ok' : (rttMed < 150 ? 'warn' : 'bad'), null),
                    metricCard(t.wizardLoss, lossPct, '%', lossPct === 0 ? 'ok' : (lossPct < 5 ? 'warn' : 'bad'), lossPct),
                    metricCard(t.wizardDnsTime, result.dnsMs === null ? '—' : result.dnsMs, 'ms', (result.dnsOk && result.dnsMs < 120) ? 'ok' : 'warn', null),
                    metricCard(t.wizardSpeed, speedMed.toFixed(2), 'Mbps', speedMed >= 20 ? 'ok' : (speedMed >= 5 ? 'warn' : 'bad'), Math.min(100, speedMed * 2)),
                    metricCard(t.wizardProtocol, result.protocol || '—', '', null, null)
                ];
                const adviceHtml = '<div class="result-rows" style="margin-top:12px">' +
                    advice.map(function (line) { return '<div class="result-row is-warn"><span class="rr-name"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(line) + '</span></div>'; }).join('') +
                    '</div>';
                if (out) {
                    out.innerHTML = resultTitle(t.wizardBtn) +
                        '<div class="usage-total" style="font-size:44px">' + escapeHTML(String(score)) + '</div>' +
                        '<div class="usage-total-label">' + escapeHTML(t.wizardScore) + ' / 100 · <span class="badge ' + (tone === 'ok' ? 'badge-success' : (tone === 'warn' ? 'badge-warning' : 'badge-danger')) + '">' + escapeHTML(grade) + '</span> · ' + Math.round((Date.now() - started) / 1000) + 's</div>' +
                        metricGrid(cards) + adviceHtml;
                }
                pushLocalHistory({ type: 'wizard', label: t.wizardBtn, value: score + ' / ' + grade, unit: '', tone: tone });
                wizardRunning = false;
            }

            // ==================== A1：资源瀑布（Resource Timing，零 Worker 出站） ====================
            let waterfallRunning = false;
            function runWaterfallTool() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.waterfallNote) + '</div>');
                setToolActions(primaryAction('wfStart', 'fa-play', t.waterfallScan));
                out.innerHTML = '<div id="wfOut"><div class="no-data">' + escapeHTML(t.waterfallIntro) + '</div></div>';
                const go = document.getElementById('wfStart');
                if (go) go.addEventListener('click', startWaterfallScan);
            }
            async function startWaterfallScan() {
                if (waterfallRunning) return;
                waterfallRunning = true;
                const t = i18n[currentLang];
                const out = document.getElementById('wfOut');
                if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                const go = document.getElementById('wfStart');
                if (go) go.disabled = true;
                try {
                    // 触发两个新请求，确保页面已有可分析的资源时序（均为同源、零 Worker 出站）
                    await Promise.all([
                        fetch('/health?wf=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).catch(function () {}),
                        fetch('/app.js?wf=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).catch(function () {})
                    ]);
                    const entries = performance.getEntriesByType('resource') || [];
                    const rows = entries.map(function (e) {
                        const dns = Math.max(0, (e.domainLookupEnd || 0) - (e.domainLookupStart || 0));
                        const tcp = Math.max(0, (e.connectEnd || 0) - (e.connectStart || 0));
                        const tls = Math.max(0, (e.secureConnectionStart ? (e.connectEnd - e.secureConnectionStart) : 0));
                        const ttfb = Math.max(0, (e.responseStart || 0) - (e.requestStart || 0));
                        const dl = Math.max(0, (e.responseEnd || 0) - (e.responseStart || 0));
                        const total = Math.max(dns + tcp + tls + ttfb + dl, e.duration || 0);
                        return {
                            name: shortResName(e.name),
                            url: e.name,
                            protocol: e.nextHopProtocol || '',
                            dns: dns, tcp: tcp, tls: tls, ttfb: ttfb, dl: dl, total: total,
                            cache: (e.transferSize === 0 && e.decodedBodySize > 0)
                        };
                    }).filter(function (r) { return r.total > 0; }).sort(function (a, b) { return b.total - a.total; });
                    if (!rows.length) {
                        if (out) out.innerHTML = '<div class="no-data">' + escapeHTML(t.wfEmpty) + '</div>';
                        return;
                    }
                    const maxTotal = Math.max.apply(null, rows.map(function (r) { return r.total; })) || 1;
                    const protoCount = {};
                    rows.forEach(function (r) {
                        const key = r.protocol || '—';
                        protoCount[key] = (protoCount[key] || 0) + 1;
                    });
                    const protoText = Object.keys(protoCount).map(function (k) { return k + ' ×' + protoCount[k]; }).join(' · ');
                    const cachedCount = rows.filter(function (r) { return r.cache; }).length;
                    const summary = '<div class="wf-summary">' +
                        metricCard(t.wfResources, rows.length, '', null, null) +
                        metricCard(t.wfProtocols, protoText || '—', '', null, null) +
                        metricCard(t.wfCached, cachedCount, '', null, Math.min(100, cachedCount * 10)) +
                        '</div>';
                    const legend = '<div class="wf-legend">' +
                        '<span><i class="wf-seg-dns"></i>' + escapeHTML(t.wfDns) + '</span>' +
                        '<span><i class="wf-seg-tcp"></i>' + escapeHTML(t.wfTcp) + '</span>' +
                        '<span><i class="wf-seg-tls"></i>' + escapeHTML(t.wfTls) + '</span>' +
                        '<span><i class="wf-seg-ttfb"></i>' + escapeHTML(t.wfTtfb) + '</span>' +
                        '<span><i class="wf-seg-dl"></i>' + escapeHTML(t.wfDownload) + '</span>' +
                        '<span style="margin-left:auto;color:var(--text-tertiary)">' + escapeHTML(t.wfNote) + '</span>' +
                        '</div>';
                    const bars = rows.slice(0, 30).map(function (r) {
                        const pct = function (v) { return Math.min(100, (v / maxTotal) * 100); };
                        const seg = '<div class="wf-track">' +
                            '<i class="wf-seg wf-seg-dns" style="width:' + pct(r.dns) + '%"></i>' +
                            '<i class="wf-seg wf-seg-tcp" style="width:' + pct(r.tcp) + '%"></i>' +
                            '<i class="wf-seg wf-seg-tls" style="width:' + pct(r.tls) + '%"></i>' +
                            '<i class="wf-seg wf-seg-ttfb" style="width:' + pct(r.ttfb) + '%"></i>' +
                            '<i class="wf-seg wf-seg-dl" style="width:' + pct(r.dl) + '%"></i>' +
                            '</div>';
                        const proto = r.protocol ? ' <span class="badge">' + escapeHTML(r.protocol) + '</span>' : '';
                        return '<div class="wf-bar-row" title="' + escapeHTML(r.url) + '"><span class="wf-name">' + escapeHTML(r.name) + proto + '</span>' + seg + '<span class="wf-total">' + escapeHTML(formatMs(r.total)) + '</span></div>';
                    }).join('');
                    if (out) out.innerHTML = summary + legend + '<div class="result-rows">' + bars + '</div>';
                } catch (e) {
                    if (out) out.innerHTML = '<div class="no-data">' + escapeHTML(t.wfEmpty) + '</div>';
                }
                waterfallRunning = false;
                const go2 = document.getElementById('wfStart');
                if (go2) go2.disabled = false;
            }

            // ==================== A4：浏览器网络信息面板（零 Worker 出站） ====================
            function runNetInfoTool() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.netinfoNote) + '</div>');
                setToolActions('');
                out.innerHTML = '<div class="no-data">' + escapeHTML(t.netinfoIntro) + '</div>';
                startNetInfo();
            }
            async function startNetInfo() {
                const t = i18n[currentLang];
                const out = document.getElementById('toolModalBody');
                if (!out) return;
                const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
                const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
                const tz = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
                let storageText = t.netinfoUnavailable;
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        const est = await navigator.storage.estimate();
                        const used = est.usage || 0, quota = est.quota || 0;
                        storageText = formatBytes(used) + ' / ' + (quota ? formatBytes(quota) : '—');
                    }
                } catch (e) {}
                const hasGeo = !!(BACKEND_DATA.realGeoCity && BACKEND_DATA.latNum);
                const cards = [
                    [t.netinfoConnType, conn && conn.effectiveType ? conn.effectiveType : t.netinfoUnavailable],
                    [t.netinfoDownlink, conn && conn.downlink ? conn.downlink + ' Mbps' : t.netinfoUnavailable],
                    [t.netinfoRtt, conn && conn.rtt ? conn.rtt + ' ms' : t.netinfoUnavailable],
                    [t.netinfoSaveData, conn ? (conn.saveData ? t.netinfoYes : t.netinfoNo) : t.netinfoUnavailable],
                    [t.netinfoProtocol, (nav && nav.nextHopProtocol) ? nav.nextHopProtocol : (BACKEND_DATA.httpProtocolRaw || t.netinfoUnavailable)],
                    [t.netinfoTimezone, tz || t.netinfoUnavailable],
                    [t.netinfoStorage, storageText],
                    [t.netinfoCores, navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : t.netinfoUnavailable],
                    [t.netinfoMemory, navigator.deviceMemory ? navigator.deviceMemory + ' GB' : t.netinfoUnavailable],
                    [t.netinfoScreen, (screen.width || 0) + '×' + (screen.height || 0) + ' @' + (window.devicePixelRatio || 1) + 'x'],
                    [t.netinfoPlatform, navigator.platform || t.netinfoUnavailable],
                    [t.netinfoLanguage, navigator.language || t.netinfoUnavailable]
                ];
                if (hasGeo) {
                    let geoOk = false;
                    try {
                        const offset = new Date().getTimezoneOffset() / -60;
                        const expected = Math.round((BACKEND_DATA.realGeoLon || 0) / 15);
                        geoOk = Math.abs(offset - expected) <= 3;
                    } catch (e) {}
                    cards.push([t.netinfoGeoMatch, geoOk ? t.netinfoYes : t.netinfoNo]);
                }
                const grid = cards.map(function (c) {
                    return '<div class="netinfo-card"><div class="netinfo-k">' + escapeHTML(String(c[0])) + '</div><div class="netinfo-v">' + escapeHTML(String(c[1])) + '</div></div>';
                }).join('');
                out.innerHTML = resultTitle(t.netinfoBtn) + '<div class="netinfo-grid">' + grid + '</div>';
                pushLocalHistory({ type: 'netinfo', label: t.netinfoBtn, value: (conn && conn.effectiveType) || '—', unit: '', tone: '' });
            }

            // ==================== DNS 工具箱 ====================
            let dnsToolBusy = false;
            function runDnsLookupTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams(
                    '<span class="side-label">' + escapeHTML(t.dnsBtn) + '</span>' +
                    '<input type="text" id="dnsNameInput" class="tool-input" placeholder="example.com" autocomplete="off">' +
                    '<select id="dnsTypeSelect" class="tool-input">' +
                    ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'].map(x => '<option>' + x + '</option>').join('') +
                    '</select>' +
                    '<span class="side-label" style="margin-top:6px">' + escapeHTML(t.dnsblSection) + '</span>' +
                    '<input type="text" id="dnsblIpInput" class="tool-input" placeholder="1.2.3.4" autocomplete="off" value="' + escapeHTML(BACKEND_DATA.clientIp || '') + '">' +
                    '<div class="side-desc" style="margin:0">' + escapeHTML(t.dnsblNotice) + '</div>');
                setToolActions(
                    primaryAction('dnsGo', 'fa-magnifying-glass', t.dnsQueryBtn) +
                    secondaryAction('dnsblGo', 'fa-shield-halved', t.dnsblBtn));
                body.innerHTML = '<div id="dnsLookupOut"><div class="no-data">' + escapeHTML(t.dnsResultTitle) + '</div></div>' +
                    '<div id="dnsblOut" style="margin-top:14px"></div>';
                const nameInput = document.getElementById('dnsNameInput');
                const go = document.getElementById('dnsGo');
                const blGo = document.getElementById('dnsblGo');
                if (nameInput && go) {
                    const submit = () => { if (!dnsToolBusy) doDnsLookup(); };
                    go.addEventListener('click', submit);
                    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    nameInput.focus();
                }
                if (blGo) {
                    blGo.addEventListener('click', () => { doDnsblCheck(); });
                }
            }
            async function doDnsLookup() {
                const t = i18n[currentLang];
                const out = document.getElementById('dnsLookupOut');
                const input = document.getElementById('dnsNameInput');
                const sel = document.getElementById('dnsTypeSelect');
                if (!out || !input) return;
                const name = (input.value || '').trim().toLowerCase().replace(/\\.$/, '');
                const type = sel ? sel.value : 'A';
                if (!/^[a-z0-9_][a-z0-9_.-]*$/.test(name) || name.indexOf('..') !== -1 || name.length > 253) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.dnsInvalidDomain) + '</div>';
                    return;
                }
                dnsToolBusy = true;
                out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/dns-lookup?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error('failed');
                    renderDnsLookup(data);
                } catch (e) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.dnsLookupFailed) + '</div>';
                }
                dnsToolBusy = false;
            }
            function renderDnsLookup(d) {
                const t = i18n[currentLang];
                const out = document.getElementById('dnsLookupOut');
                if (!out) return;
                const answers = d.answers || [];
                if (answers.length === 0) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-inbox"></i> ' + escapeHTML(t.dnsNoRecords) + ' · status ' + escapeHTML(String(d.status)) + '</div>';
                    return;
                }
                const rows = answers.map(a =>
                    '<div class="result-row"><span class="rr-name">' + escapeHTML(d.type + ' · TTL ' + (a.ttl || 0)) + '</span>' +
                    '<span class="rr-val" style="word-break:break-all">' + escapeHTML(String(a.data)) + '</span></div>'
                ).join('');
                out.innerHTML = '<div class="result-rows">' + rows + '</div>';
            }
            async function doDnsblCheck() {
                const t = i18n[currentLang];
                const out = document.getElementById('dnsblOut');
                const input = document.getElementById('dnsblIpInput');
                if (!out || !input) return;
                const ip = (input.value || '').trim();
                const ipm = ip.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
                if (!ipm || ipm.slice(1).some(o => Number(o) > 255)) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.dnsblInvalidIp) + '</div>';
                    return;
                }
                out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/dnsbl?ip=' + encodeURIComponent(ip), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error('failed');
                    renderDnsbl(data);
                } catch (e) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.dnsLookupFailed) + '</div>';
                }
            }
            function renderDnsbl(d) {
                const t = i18n[currentLang];
                const out = document.getElementById('dnsblOut');
                if (!out) return;
                const map = { listed: [t.dnsblListed, 'badge-danger'], clean: [t.dnsblClean, 'badge-success'], refused: [t.dnsblRefused, 'badge-warning'], unknown: [t.dnsblUnknown, 'badge'] };
                const rows = (d.results || []).map(r => {
                    const m = map[r.status] || map.unknown;
                    const codes = (r.codes && r.codes.length) ? ' (' + r.codes.join(', ') + ')' : '';
                    return '<div class="result-row"><span class="rr-name">' + escapeHTML(r.zone) + '</span>' +
                        '<span class="rr-val"><span class="badge ' + m[1] + '">' + escapeHTML(m[0]) + escapeHTML(codes) + '</span></span></div>';
                }).join('');
                out.innerHTML = '<div class="result-rows">' + rows + '</div>';
            }

            // ==================== 一键体检 ====================
            let qcRunning = false;
            let qcLastReportText = '';
            let qcLastShare = null;
            let _qcUpPayloads = null;
            function getQcUpPayloads() {
                if (!_qcUpPayloads) {
                    _qcUpPayloads = [new Uint8Array(1048576), new Uint8Array(8388608)];
                    fillRandomLocal(_qcUpPayloads[0]);
                    fillRandomLocal(_qcUpPayloads[1]);
                }
                return _qcUpPayloads;
            }
            function runQuickCheckTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams('<div class="side-desc" style="margin:0">' + escapeHTML(t.qcNote) + '</div>');
                setToolActions(primaryAction('qcStart', 'fa-heart-pulse', t.qcStart));
                body.innerHTML = '<div id="qcResult"><div class="no-data">' + escapeHTML(t.qcNote) + '</div></div>';
                const go = document.getElementById('qcStart');
                if (go) go.addEventListener('click', startQuickCheck);
            }
            async function startQuickCheck() {
                if (qcRunning) return;
                qcRunning = true;
                const t = i18n[currentLang];
                const out = document.getElementById('qcResult');
                const setProgress = (label) => {
                    if (out) out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(label) + '</div>';
                };
                try {
                    setProgress(t.qcRunning + ' [1/6] ' + t.qcItemRtt);
                    const rttSamples = [];
                    let rttLost = 0;
                    let rttLimited = 0;
                    for (let i = 0; i < 8; i++) {
                        const s = performance.now();
                        try {
                            const res = await fetchWithTimeout('/health?_qc=' + i, { method: 'HEAD', cache: 'no-store' }, 3000);
                            if (res.status === 429) { rttLimited++; }
                            else { rttSamples.push(performance.now() - s); }
                        } catch (e) { rttLost++; }
                        await new Promise(r => setTimeout(r, 250));
                    }
                    const rttOk = rttSamples.length > 0;
                    const rttAvg = rttOk ? Math.round(rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length) : 0;
                    let jitter = 0;
                    for (let i = 1; i < rttSamples.length; i++) jitter += Math.abs(rttSamples[i] - rttSamples[i - 1]);
                    jitter = rttSamples.length > 1 ? Math.round(jitter / (rttSamples.length - 1)) : 0;
                    const rttAttempted = rttLost + rttSamples.length;
                    const lossPct = rttAttempted > 0 ? Math.round((rttLost / rttAttempted) * 100) : 0;

                    setProgress(t.qcRunning + ' [2/6] ' + t.qcItemDown);
                    let downMbps = 0;
                    for (const size of [524288, 2097152]) {
                        const s = performance.now();
                        try {
                            const res = await fetch('/speedtest?size=' + size, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                            if (!res.ok) throw new Error('http ' + res.status);
                            let bytesRead = 0;
                            if (res.body) {
                                const rd = res.body.getReader();
                                while (true) {
                                    const step = await rd.read();
                                    if (step.done) break;
                                    bytesRead += step.value ? step.value.byteLength : 0;
                                }
                            }
                            const sec = (performance.now() - s) / 1000;
                            const mbps = (sec > 0 && bytesRead > 0) ? ((bytesRead * 8) / sec) / 1000000 : 0;
                            if (mbps > downMbps) downMbps = mbps;
                        } catch (e) {}
                    }

                    setProgress(t.qcRunning + ' [3/6] ' + t.qcItemUp);
                    let upMbps = 0;
                    const payloads = getQcUpPayloads();
                    const upSizes = [1048576, 8388608];
                    for (let i = 0; i < payloads.length; i++) {
                        const s = performance.now();
                        try {
                            const res = await fetch('/upload-test', { method: 'POST', body: payloads[i], cache: 'no-store', signal: AbortSignal.timeout(20000) });
                            if (res.ok) {
                                const sec = (performance.now() - s) / 1000;
                                const mbps = sec > 0 ? ((upSizes[i] * 8) / sec) / 1000000 : 0;
                                if (mbps > upMbps) upMbps = mbps;
                            }
                        } catch (e) {}
                    }

                    setProgress(t.qcRunning + ' [4/6] ' + t.qcItemProto);
                    let protoLevel = 1;
                    let protoText = 'HTTP/1.1';
                    try {
                        const res = await fetch('/http2-test', { cache: 'no-store' });
                        const d = await res.json();
                        if (d.http3) { protoLevel = 5; protoText = 'HTTP/3'; }
                        else if (d.http2) { protoLevel = 4; protoText = 'HTTP/2'; }
                    } catch (e) {}

                    setProgress(t.qcRunning + ' [5/6] ' + t.qcItemDns);
                    let dnsOk = false;
                    let dnsMs = 0;
                    try {
                        const s = performance.now();
                        const res = await fetch('/api/dns-lookup?name=' + encodeURIComponent(window.location.hostname.toLowerCase()) + '&type=A', { cache: 'no-store' });
                        const d = await res.json();
                        dnsMs = performance.now() - s;
                        dnsOk = res.ok && !d.error;
                    } catch (e) {}

                    setProgress(t.qcRunning + ' [6/6] ' + t.qcItemFraud);
                    let fraudScore = null;
                    try {
                        const res = await fetch('/api/ip-fraud', { cache: 'no-store' });
                        if (res.ok) {
                            const d = await res.json();
                            if (d && typeof d.score === 'number') fraudScore = d.score;
                        }
                    } catch (e) {}

                    const score = {
                        rtt: !rttOk ? 0 : (rttAvg <= 30 ? 25 : rttAvg <= 80 ? 20 : rttAvg <= 150 ? 14 : rttAvg <= 300 ? 8 : 3),
                        jitter: !rttOk ? 0 : (jitter <= 5 ? 10 : jitter <= 15 ? 7 : jitter <= 30 ? 4 : 1),
                        loss: lossPct === 0 ? 10 : lossPct <= 2 ? 6 : lossPct <= 5 ? 3 : 0,
                        down: downMbps >= 100 ? 25 : downMbps >= 50 ? 20 : downMbps >= 20 ? 14 : downMbps >= 5 ? 8 : 3,
                        up: upMbps >= 50 ? 15 : upMbps >= 20 ? 11 : upMbps >= 5 ? 6 : 2,
                        proto: protoLevel,
                        dns: dnsOk ? 5 : 2,
                        fraud: fraudScore === null ? 3 : (fraudScore <= 20 ? 5 : fraudScore <= 50 ? 3 : 1)
                    };
                    const total = score.rtt + score.jitter + score.loss + score.down + score.up + score.proto + score.dns + score.fraud;
                    const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 55 ? 'C' : total >= 35 ? 'D' : 'F';
                    const upStr = upMbps > 0 ? upMbps.toFixed(1) + ' Mbps' : 'N/A';
                    const fraudStr = fraudScore === null ? 'N/A' : fraudScore + '/100';

                    // E1：findings 携带 code，既生成人类可读的 issues 文案，也驱动「原因 + 建议」规则表
                    const findings = [];
                    if (!rttOk) findings.push({ code: 'rtt_fail', text: t.qcItemRtt + ': FAIL (' + rttLost + ' lost, ' + rttLimited + ' limited)' });
                    if (rttOk && rttAvg > 150) findings.push({ code: 'rtt_high', text: t.qcItemRtt + ': ' + rttAvg + ' ms' });
                    if (rttOk && jitter > 30) findings.push({ code: 'jitter_high', text: t.qcItemRtt + ': jitter ' + jitter + ' ms' });
                    if (lossPct > 0) findings.push({ code: 'loss', text: t.qcItemRtt + ': loss ' + lossPct + '%' });
                    if (rttLimited > 0) findings.push({ code: 'rate_limited', text: t.qcItemRtt + ': rate limited (' + rttLimited + '/8)' });
                    if (downMbps < 20) findings.push({ code: 'down_low', text: t.qcItemDown + ': ' + downMbps.toFixed(1) + ' Mbps' });
                    if (upMbps < 5) findings.push({ code: 'up_low', text: t.qcItemUp + ': ' + upStr });
                    if (protoLevel < 4) findings.push({ code: 'proto_old', text: t.qcItemProto + ': ' + protoText });
                    if (!dnsOk) findings.push({ code: 'dns_fail', text: t.qcItemDns + ': FAIL' });
                    if (fraudScore !== null && fraudScore > 50) findings.push({ code: 'fraud_high', text: t.qcItemFraud + ': ' + fraudStr });
                    const issues = findings.map(f => f.text);

                    const qcRow = (label, val, pts, max) =>
                        '<div class="result-row' + (pts < max ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(label) + '</span>' +
                        '<span class="rr-val">' + escapeHTML(val) + ' <span class="badge ' + (pts < max ? 'badge-warning' : 'badge-success') + '">' + pts + '/' + max + '</span></span></div>';
                    const rowsHtml =
                        qcRow(t.qcItemRtt, (rttOk ? rttAvg + ' ms' : 'N/A') + ' · jitter ' + jitter + ' ms · loss ' + lossPct + '%', score.rtt + score.jitter + score.loss, 45) +
                        qcRow(t.qcItemDown, downMbps.toFixed(1) + ' Mbps', score.down, 25) +
                        qcRow(t.qcItemUp, upStr, score.up, 15) +
                        qcRow(t.qcItemProto, protoText, score.proto, 5) +
                        qcRow(t.qcItemDns, (dnsOk ? 'OK' : 'FAIL') + ' · ' + Math.round(dnsMs) + ' ms', score.dns, 5) +
                        qcRow(t.qcItemFraud, fraudStr, score.fraud, 5);
                    const issueHtml = issues.length
                        ? issues.map(x => '<div class="result-row is-warn"><span class="rr-name"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(x) + '</span></div>').join('')
                        : '<div class="result-row"><span class="rr-name"><i class="fas fa-circle-check"></i> ' + escapeHTML(t.qcNoIssues) + '</span></div>';
                    const gradeBadge = total >= 75 ? 'badge-success' : total >= 55 ? 'badge-warning' : 'badge-danger';

                    if (out) out.innerHTML =
                        '<div class="usage-total" style="font-size:44px">' + total + '</div>' +
                        '<div class="usage-total-label">' + escapeHTML(t.qcScore + ' / 100') + ' · <span class="badge ' + gradeBadge + '">' + grade + '</span></div>' +
                        '<div class="result-rows" style="margin-top:12px">' + rowsHtml + '</div>' +
                        resultTitle(t.qcIssues) +
                        '<div class="result-rows">' + issueHtml + '</div>' +
                        adviceBlock(findings) +
                        '<div class="tool-field" style="margin-top:12px"><button class="btn btn-primary" id="qcCopyBtn"><i class="fas fa-copy"></i> ' + escapeHTML(t.copy) + '</button>' +
                        '<button class="btn" id="qcShareImgBtn"><i class="fas fa-image"></i> ' + escapeHTML(t.shareImg) + '</button>' +
                        '<button class="btn btn-ghost" id="qcShareLinkBtn"><i class="fas fa-link"></i> ' + escapeHTML(t.shareLink) + '</button></div>';
                    pushLocalHistory({ type: 'quickcheck', label: t.quickcheckBtn, value: total + '/100 ' + grade, tone: total >= 75 ? 'ok' : (total >= 55 ? 'warn' : 'bad') });

                    const locale = { 'en': 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' }[currentLang] || 'en-US';
                    qcLastReportText = 'NetSight Pro - ' + t.quickcheckBtn + '\\n' +
                        new Date().toLocaleString(locale, { timeZone: 'Asia/Shanghai' }) + '\\n' +
                        t.qcScore + ': ' + total + '/100 (' + grade + ')\\n' +
                        t.qcItemRtt + ': ' + (rttOk ? rttAvg + ' ms' : 'N/A') + ' / jitter ' + jitter + ' ms / loss ' + lossPct + '%\\n' +
                        t.qcItemDown + ': ' + downMbps.toFixed(1) + ' Mbps\\n' +
                        t.qcItemUp + ': ' + upStr + '\\n' +
                        t.qcItemProto + ': ' + protoText + '\\n' +
                        t.qcItemDns + ': ' + (dnsOk ? 'OK' : 'FAIL') + ' / ' + Math.round(dnsMs) + ' ms\\n' +
                        t.qcItemFraud + ': ' + fraudStr + '\\n' +
                        (issues.length ? t.qcIssues + ':\\n' + issues.map(x => ' - ' + x).join('\\n') + '\\n' : t.qcNoIssues + '\\n');
                    qcLastShare = { total: total, grade: grade, lines: [
                        t.qcItemRtt + ': ' + (rttOk ? rttAvg + ' ms' : 'N/A') + ' / ' + jitter + ' ms / ' + lossPct + '%',
                        t.qcItemDown + ': ' + downMbps.toFixed(1) + ' Mbps',
                        t.qcItemUp + ': ' + upStr,
                        t.qcItemProto + ': ' + protoText,
                        t.qcItemDns + ': ' + (dnsOk ? 'OK' : 'FAIL') + ' / ' + Math.round(dnsMs) + ' ms',
                        t.qcItemFraud + ': ' + fraudStr
                    ] };
                    const copyBtn = document.getElementById('qcCopyBtn');
                    if (copyBtn) copyBtn.addEventListener('click', () => copyQuickCheckReport(copyBtn));
                    const qcShareImg = document.getElementById('qcShareImgBtn');
                    if (qcShareImg) qcShareImg.addEventListener('click', () => shareResultImage(t.quickcheckBtn, total, grade, qcLastShare.lines));
                    const qcShareLink = document.getElementById('qcShareLinkBtn');
                    if (qcShareLink) qcShareLink.addEventListener('click', () => copyShareLink(qcLastShare, qcShareLink));
                } catch (e) {
                    if (out) out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.loadFailed) + '</div>';
                }
                qcRunning = false;
            }
            async function copyQuickCheckReport(btn) {
                if (!qcLastReportText) return;
                let ok = false;
                try { await navigator.clipboard.writeText(qcLastReportText); ok = true; } catch (e) {}
                if (!ok) {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = qcLastReportText;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        ok = true;
                    } catch (e2) {}
                }
                if (ok && btn) {
                    const old = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> ' + escapeHTML(i18n[currentLang].copied);
                    setTimeout(() => { btn.innerHTML = old; }, 2000);
                }
            }

            // ==================== PWA：Service Worker 注册 ====================
            try {
                if ('serviceWorker' in navigator && window.isSecureContext && (!window.__SITE__ || window.__SITE__.offline !== false)) {
                    navigator.serviceWorker.register('/sw.js').catch(function() {});
                }
                if (typeof navigator.onLine === 'boolean' && !navigator.onLine) showConnectivityBanner(true);
                window.addEventListener('offline', function () { showConnectivityBanner(true); });
                window.addEventListener('online', function () { showConnectivityBanner(false); });
            } catch (e) {}

            // ==================== 分享增强（图片 / 链接） ====================
            function shareResultImage(title, score, grade, lines) {
                try {
                    const W = 720;
                    const srcLines = (lines && lines.length) ? lines : [''];
                    const H = 400 + srcLines.length * 58 + 80;
                    const cv = document.createElement('canvas');
                    cv.width = W;
                    cv.height = H;
                    const g = cv.getContext('2d');
                    if (!g) return;
                    g.fillStyle = '#0a0b0d';
                    g.fillRect(0, 0, W, H);
                    g.strokeStyle = '#24262b';
                    g.lineWidth = 2;
                    g.strokeRect(24, 24, W - 48, H - 48);
                    g.fillStyle = '#e9eaec';
                    g.font = '600 38px system-ui, -apple-system, sans-serif';
                    g.fillText(String(title || 'NetSight Pro').slice(0, 24), 60, 112);
                    g.fillStyle = '#6a6d74';
                    g.font = '400 20px system-ui, -apple-system, sans-serif';
                    g.fillText('NetSight Pro · ' + new Date().toLocaleString(localeOf(currentLang), { timeZone: 'Asia/Shanghai' }), 60, 148);
                    const gradeColor = (grade === 'A' || grade === 'B') ? '#a7b6a9' : (grade === 'C' ? '#c8b07a' : '#c98a8a');
                    g.fillStyle = '#e9eaec';
                    g.font = '700 120px system-ui, -apple-system, sans-serif';
                    g.fillText(String(score), 60, 300);
                    g.fillStyle = gradeColor;
                    g.font = '600 34px system-ui, -apple-system, sans-serif';
                    g.fillText('/ 100 · ' + String(grade || ''), 70 + String(score).length * 76, 296);
                    let y = 400;
                    g.font = '400 24px system-ui, -apple-system, sans-serif';
                    for (let i = 0; i < srcLines.length; i++) {
                        g.fillStyle = '#9a9da3';
                        g.fillText(String(srcLines[i] || '').slice(0, 56), 60, y);
                        g.strokeStyle = '#17181c';
                        g.beginPath();
                        g.moveTo(60, y + 22);
                        g.lineTo(W - 60, y + 22);
                        g.stroke();
                        y += 58;
                    }
                    g.fillStyle = '#45484e';
                    g.font = '400 18px system-ui, -apple-system, sans-serif';
                    g.fillText('NetSight Pro - Aurora Diagnostics', 60, H - 56);
                    const a = document.createElement('a');
                    a.download = 'netsight-' + Date.now() + '.png';
                    cv.toBlob(function(blob) {
                        if (!blob) return;
                        const u = URL.createObjectURL(blob);
                        a.href = u;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(function() { URL.revokeObjectURL(u); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
                    }, 'image/png');
                } catch (e) {}
            }
            function copyTextToClipboard(text, btn) {
                const done = function(ok) {
                    if (ok && btn) {
                        const old = btn.innerHTML;
                        btn.innerHTML = '<i class="fas fa-check"></i> ' + escapeHTML(i18n[currentLang].copied);
                        setTimeout(function() { btn.innerHTML = old; }, 2000);
                    }
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() { done(true); }, function() { done(false); });
                    return;
                }
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    done(true);
                } catch (e) { done(false); }
            }
            function copyShareLink(payload, btn) {
                try {
                    const json = JSON.stringify(payload);
                    let b64 = btoa(unescape(encodeURIComponent(json)));
                    b64 = b64.split('+').join('-').split('/').join('_');
                    while (b64.length && b64.charAt(b64.length - 1) === '=') b64 = b64.slice(0, -1);
                    const url = location.origin + location.pathname + '#qc=' + b64;
                    copyTextToClipboard(url, btn);
                } catch (e) {}
            }
            function showSharedResult() {
                try {
                    if (!location.hash || location.hash.indexOf('#qc=') !== 0) return;
                    let raw = location.hash.slice(4);
                    raw = raw.split('-').join('+').split('_').join('/');
                    while (raw.length > 0 && raw.length % 4 !== 0) raw += '=';
                    const json = decodeURIComponent(escape(atob(raw)));
                    const d = JSON.parse(json);
                    if (!d || typeof d.total !== 'number' || !Array.isArray(d.lines)) return;
                    setTimeout(function() {
                        const body = document.getElementById('toolModalBody');
                        const modal = document.getElementById('toolModal');
                        const titleEl = document.getElementById('toolModalTitle');
                        const descEl = document.getElementById('toolModalDesc');
                        if (!body || !modal) return;
                        if (titleEl) titleEl.textContent = i18n[currentLang].shareBanner || 'NetSight Pro';
                        if (descEl) descEl.textContent = '';
                        // 分享结果没有参数可调：左栏只留说明，清空参数与操作区
                        const sideDesc = document.getElementById('toolModalSideDesc');
                        if (sideDesc) sideDesc.textContent = i18n[currentLang].shareBanner || '';
                        setToolParams('');
                        setToolActions('');
                        body.innerHTML = '<div class="usage-total" style="font-size:44px">' + escapeHTML(String(d.total)) + '</div>' +
                            '<div class="usage-total-label">' + escapeHTML((i18n[currentLang].qcScore || 'Score') + ' / 100 · ' + String(d.grade || '')) + '</div>' +
                            '<div class="result-rows" style="margin-top:12px">' + d.lines.map(function(x) { return '<div class="result-row"><span class="rr-name" style="word-break:break-all">' + escapeHTML(String(x)) + '</span></div>'; }).join('') + '</div>';
                        modal.classList.add('active');
                    }, 700);
                } catch (e) {}
            }
            showSharedResult();

            // ==================== 域名安全体检 ====================
            function runDomainCheckTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams(
                    '<input type="text" id="dcDomain" class="tool-input" placeholder="example.com" autocomplete="off">' +
                    '<input type="text" id="dcSelector" class="tool-input" placeholder="' + escapeHTML(t.dcSelectorPh) + '" autocomplete="off">');
                setToolActions(primaryAction('dcGo', 'fa-fingerprint', t.auditRun));
                body.innerHTML = '<div id="dcOut"><div class="no-data">' + escapeHTML(t.domaincheckBtn) + '</div></div>';
                const inp = document.getElementById('dcDomain');
                const selEl = document.getElementById('dcSelector');
                const go = document.getElementById('dcGo');
                if (inp && go) {
                    const submit = function() { startDomainCheck(); };
                    go.addEventListener('click', submit);
                    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    if (selEl) selEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    inp.focus();
                }
            }
            async function startDomainCheck() {
                const t = i18n[currentLang];
                const out = document.getElementById('dcOut');
                const inp = document.getElementById('dcDomain');
                const selEl = document.getElementById('dcSelector');
                if (!out || !inp) return;
                let domain = (inp.value || '').trim().toLowerCase();
                if (domain.charAt(domain.length - 1) === '.') domain = domain.slice(0, -1);
                let validDomain = domain.length > 0 && domain.length <= 253 && domain.indexOf(' ') === -1;
                if (validDomain && domain.indexOf('..') !== -1) validDomain = false;
                if (validDomain) {
                    for (let i = 0; i < domain.length; i++) {
                        const ch = domain.charAt(i);
                        const okCh = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '.' || ch === '-' || ch === '_';
                        if (!okCh) { validDomain = false; break; }
                    }
                }
                if (!validDomain) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(t.dnsInvalidDomain) + '</div>';
                    return;
                }
                const selector = selEl ? (selEl.value || '').trim().toLowerCase() : '';
                out.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/domain-check?domain=' + encodeURIComponent(domain) + '&selector=' + encodeURIComponent(selector), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
                    const d = await res.json();
                    if (!res.ok || d.error) throw new Error('failed');
                    renderDomainCheck(d);
                } catch (e) {
                    out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.loadFailed) + '</div>';
                }
            }
            function renderDomainCheck(d) {
                const t = i18n[currentLang];
                const out = document.getElementById('dcOut');
                if (!out) return;
                const issueMap = {
                    mx_missing: t.dcA_mxMissing, spf_missing: t.dcA_spfMissing, spf_multi: t.dcA_spfMulti,
                    spf_weak: t.dcA_spfWeak, dmarc_missing: t.dcA_dmarcMissing, dmarc_none: t.dcA_dmarcNone,
                    dkim_missing: t.dcA_dkimMissing, listed: t.dcA_listed,
                    dnssec_missing: t.dcA_dnssecMissing, caa_missing: t.dcA_caaMissing,
                    mta_sts_missing: t.dcA_mtaStsMissing, bimi_missing: t.dcA_bimiMissing,
                    ns_insufficient: t.dcA_nsInsufficient
                };
                const blText = (d.blocklists || []).map(function(b) {
                    const s = b.status === 'listed' ? t.dcListed : (b.status === 'clean' ? t.dcClean : (b.status === 'refused' ? t.dnsblRefused : t.dnsblUnknown));
                    return b.zone + ': ' + s;
                }).join(' · ');
                const mxText = (d.mx && d.mx.length) ? (d.mx.length + ' · ' + String(d.mx[0]).slice(0, 60)) : t.dcMissing;
                let spfText = t.dcMissing;
                if (d.spf && d.spf.found) spfText = (d.spf.multi ? t.dcWeak + ' · ' : '') + String(d.spf.record || '').slice(0, 90);
                let dmarcText = t.dcMissing;
                if (d.dmarc && d.dmarc.found) dmarcText = (d.dmarc.policy ? 'p=' + d.dmarc.policy : 'v=DMARC1') + (d.dmarc.hasRua ? ' · rua' : '');
                let dkimText = t.dcNotTested;
                if (d.dkim && d.dkim.checked) dkimText = d.dkim.found ? t.dcFound : t.dcMissing;
                const row = function(label, val, warn) {
                    return '<div class="result-row' + (warn ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(label) + '</span><span class="rr-val" style="word-break:break-all">' + escapeHTML(val) + '</span></div>';
                };
                const issues = d.issues || [];
                const issueRows = issues.length
                    ? issues.map(function(code) { return '<div class="result-row is-warn"><span class="rr-name"><i class="fas fa-triangle-exclamation"></i> ' + escapeHTML(issueMap[code] || code) + '</span></div>'; }).join('')
                    : '<div class="result-row"><span class="rr-name"><i class="fas fa-circle-check"></i> ' + escapeHTML(t.qcNoIssues) + '</span></div>';
                const gradeBadge = d.score >= 75 ? 'badge-success' : d.score >= 55 ? 'badge-warning' : 'badge-danger';
                const blListed = (d.blocklists || []).some(function(b) { return b.status === 'listed'; });
                const dnssecOn = !!(d.dnssec && d.dnssec.enabled);
                const dnssecText = (dnssecOn ? t.dcEnabled : t.dcDisabled) + (d.dnssec && d.dnssec.ad ? ' · ' + t.dcAd : '');
                const caaText = (d.caa && d.caa.found)
                    ? ((d.caa.issue || []).concat(d.caa.issuewild || []).slice(0, 4).join(', ') || t.dcFound)
                    : t.dcMissing;
                const mtaStsText = (d.mtaSts && d.mtaSts.found) ? t.dcFound : t.dcMissing;
                const bimiText = (d.bimi && d.bimi.found) ? t.dcFound : t.dcMissing;
                const ns = (d.ns || []);
                const nsText = ns.length ? (ns.length + ' · ' + String(ns[0]).slice(0, 50)) : t.dcMissing;
                out.innerHTML =
                    '<div class="usage-total" style="font-size:44px">' + escapeHTML(String(d.score)) + '</div>' +
                    '<div class="usage-total-label">' + escapeHTML(t.qcScore + ' / 100') + ' · <span class="badge ' + gradeBadge + '">' + escapeHTML(String(d.grade)) + '</span></div>' +
                    '<div class="result-rows" style="margin-top:12px">' +
                    row('MX', mxText, !(d.mx && d.mx.length)) +
                    row('SPF', spfText, !(d.spf && d.spf.found)) +
                    row('DMARC', dmarcText, !(d.dmarc && d.dmarc.found)) +
                    row('DKIM', dkimText, !!(d.dkim && d.dkim.checked && !d.dkim.found)) +
                    row(t.dcBlLabel, blText, blListed) +
                    row(t.dcDnssec, dnssecText, !dnssecOn) +
                    row(t.dcCaa, caaText, !(d.caa && d.caa.found)) +
                    row(t.dcMtaSts, mtaStsText, !(d.mtaSts && d.mtaSts.found)) +
                    row(t.dcBimi, bimiText, !(d.bimi && d.bimi.found)) +
                    row(t.dcNs, nsText, ns.length < 2) +
                    '</div>' +
                    resultTitle(t.qcIssues) +
                    '<div class="result-rows">' + issueRows + '</div>' +
                    '<div class="tool-field" style="margin-top:12px"><button class="btn" id="dcShareBtn"><i class="fas fa-image"></i> ' + escapeHTML(t.shareImg) + '</button></div>';
                const shareBtn = document.getElementById('dcShareBtn');
                if (shareBtn) shareBtn.addEventListener('click', function() {
                    shareResultImage(t.domaincheckBtn, d.score, d.grade, [
                        'MX: ' + mxText,
                        'SPF: ' + (d.spf && d.spf.found ? (d.spf.allQualifier ? (d.spf.allQualifier + 'all') : 'found') : t.dcMissing),
                        'DMARC: ' + dmarcText,
                        'DKIM: ' + dkimText,
                        t.dcBlLabel + ': ' + blText,
                        t.dcDnssec + ': ' + dnssecText,
                        t.dcCaa + ': ' + caaText,
                        t.dcMtaSts + ': ' + mtaStsText,
                        t.dcNs + ': ' + nsText
                    ]);
                });
            }

            // ==================== 连接状态提示（PWA 离线壳配套） ====================
            function showConnectivityBanner(offline) {
                try {
                    const id = 'netConnectBanner';
                    let el = document.getElementById(id);
                    if (!offline) {
                        if (el && el.parentNode) el.parentNode.removeChild(el);
                        return;
                    }
                    if (el) return;
                    el = document.createElement('div');
                    el.id = id;
                    el.className = 'share-banner';
                    el.innerHTML = '<i class="fas fa-plug-circle-xmark"></i><span>离线 / Offline · 网络诊断需要联网，恢复网络后自动重试。</span>' +
                        '<button class="btn btn-ghost btn-sm" id="netConnectBannerClose" aria-label="close">×</button>';
                    document.body.appendChild(el);
                    const c = document.getElementById('netConnectBannerClose');
                    if (c) c.addEventListener('click', function () { if (el.parentNode) el.parentNode.removeChild(el); });
                } catch (e) {}
            }

            // ==================== 站点监控 ====================
            function monErrHtml(msg) {
                return '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(msg) + '</div>';
            }
            function monOutEl() { return document.getElementById('monOut'); }
            function monAdminKey() {
                const el = document.getElementById('monKey');
                let k = el ? (el.value || '').trim() : '';
                if (!k) { try { k = sessionStorage.getItem('mon-admin-key') || ''; } catch (e) {} }
                return k;
            }
            function runMonitorTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                setToolParams(
                    '<input type="password" id="monKey" class="tool-input" placeholder="' + escapeHTML(t.monKeyPh) + '" autocomplete="off">' +
                    '<span class="side-label">' + escapeHTML(t.monUrlsPh) + '</span>' +
                    '<textarea id="monUrls" class="tool-input" placeholder="' + escapeHTML(t.monUrlsPh) + '"></textarea>' +
                    '<input type="text" id="monHook" class="tool-input" placeholder="' + escapeHTML(t.monHookPh) + '" autocomplete="off">' +
                    '<span class="side-label">' + escapeHTML(t.monFormat) + '</span>' +
                    '<select id="monFmt" class="tool-input">' +
                    '<option value="generic">Generic JSON</option><option value="dingtalk">DingTalk</option>' +
                    '<option value="feishu">Feishu</option><option value="wecom">WeCom</option>' +
                    '<option value="slack">Slack</option><option value="discord">Discord</option>' +
                    '<option value="telegram">Telegram</option><option value="ntfy">ntfy</option></select>' +
                    '<input type="text" id="monChat" class="tool-input" placeholder="' + escapeHTML(t.monChatId) + '" autocomplete="off">' +
                    '<span class="side-label">' + escapeHTML(t.monThreshold) + '</span>' +
                    '<input type="number" id="monThreshold" class="tool-input" min="1" max="5" step="1" value="1">' +
                    '<input type="text" id="monQuiet" class="tool-input" placeholder="' + escapeHTML(t.monQuiet) + '" autocomplete="off">' +
                    '<input type="number" id="monMaint" class="tool-input" min="0" max="1440" step="1" value="0" placeholder="' + escapeHTML(t.monMaint) + '">' +
                    '<label class="side-label" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="monCertCheck" checked> ' + escapeHTML(t.monCertCheck) + '</label>' +
                    '<div class="side-desc" style="margin:0">' + escapeHTML(t.monNote) + '</div>');
                setToolActions(
                    primaryAction('monSave', 'fa-floppy-disk', t.monSave) +
                    secondaryAction('monRun', 'fa-play', t.monRun));
                body.innerHTML = '<div id="monOut"></div>';
                let savedKey = '';
                try { savedKey = sessionStorage.getItem('mon-admin-key') || ''; } catch (e) {}
                const keyEl = document.getElementById('monKey');
                if (keyEl && savedKey) keyEl.value = savedKey;
                const saveBtn = document.getElementById('monSave');
                const runBtn = document.getElementById('monRun');
                if (saveBtn) saveBtn.addEventListener('click', saveMonitorConfig);
                if (runBtn) runBtn.addEventListener('click', runMonitorNow);
                if (savedKey) loadMonitorStatus(savedKey);
            }
            async function loadMonitorStatus(key) {
                const t = i18n[currentLang];
                const o = monOutEl();
                if (!o) return;
                o.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/monitor', { headers: { 'x-admin-key': key }, cache: 'no-store' });
                    const d = await res.json();
                    if (res.status === 403) { o.innerHTML = monErrHtml(t.monKeyBad); return; }
                    if (!res.ok || d.error) {
                        const msg = d.error === 'key_not_set' ? t.monKeyNeeded : (d.error === 'kv_missing' ? t.monKvMissing : t.loadFailed);
                        o.innerHTML = monErrHtml(msg);
                        return;
                    }
                    renderMonitor(d);
                } catch (e) { o.innerHTML = monErrHtml(t.loadFailed); }
            }
            function renderMonitor(d) {
                const t = i18n[currentLang];
                const o = monOutEl();
                if (!o) return;
                const cfg = d.config || {};
                const state = d.state || {};
                const logArr = d.log || [];
                const urlsEl = document.getElementById('monUrls');
                const hookEl = document.getElementById('monHook');
                const fmtEl = document.getElementById('monFmt');
                const chatEl = document.getElementById('monChat');
                const thresholdEl = document.getElementById('monThreshold');
                const quietEl = document.getElementById('monQuiet');
                const maintEl = document.getElementById('monMaint');
                const certCheckEl = document.getElementById('monCertCheck');
                if (urlsEl && cfg.urls) urlsEl.value = cfg.urls.map(function (u) { if (u && typeof u === 'object') { return (u.label ? u.label + ' | ' : '') + (u.url || ''); } return String(u || ''); }).join(String.fromCharCode(10));
                if (hookEl) hookEl.value = cfg.webhook || '';
                if (fmtEl && cfg.format) fmtEl.value = cfg.format;
                if (chatEl) chatEl.value = cfg.chatId || '';
                if (thresholdEl) thresholdEl.value = String(cfg.failureThreshold || 1);
                if (quietEl) quietEl.value = cfg.quietHours || '';
                if (maintEl) {
                    const left = Number(cfg.maintenanceUntil) > Date.now() ? Math.round((Number(cfg.maintenanceUntil) - Date.now()) / 60000) : 0;
                    maintEl.value = String(left);
                }
                if (certCheckEl) certCheckEl.checked = cfg.certCheck !== false;
                const fmtTime = function(ts) {
                    try { return new Date(ts).toLocaleString(localeOf(currentLang), { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
                };
                const rows = (cfg.urls || []).map(function(u) {
                    const url = (u && typeof u === 'object') ? String(u.url || '') : String(u || '');
                    const label = (u && typeof u === 'object' && u.label) ? String(u.label) : '';
                    const s = state[url] || null;
                    const st = s ? (s.status === 'up' ? t.monUp : t.monDown) : t.monStateNone;
                    const cls = s ? (s.status === 'up' ? 'badge-success' : 'badge-danger') : 'badge';
                    const extra = s ? (s.code ? 'HTTP ' + s.code : (s.error || '')) : '';
                    const since = (s && s.since) ? (t.monSince + ' ' + fmtTime(s.since)) : '';
                    const cert = (s && s.certDays !== undefined && s.certDays !== null) ? (t.monCertDays + ': ' + s.certDays + 'd') : '';
                    const fails = (s && Number(s.failures) > 1) ? (t.monFailures + ': ' + s.failures) : '';
                    const sub = [since, extra, cert, fails].filter(Boolean).join(' · ');
                    const shown = (label || (s && s.label) ? (label || s.label) + ' · ' : '') + url;
                    return '<div class="result-row"><span class="rr-name" style="word-break:break-all">' + escapeHTML(shown) + (sub ? '<br><span style="font-size:11px;color:var(--text-quaternary)">' + escapeHTML(sub) + '</span>' : '') + '</span><span class="rr-val"><span class="badge ' + cls + '">' + escapeHTML(st) + '</span></span></div>';
                }).join('');
                const logRows = logArr.length ? logArr.slice(0, 8).map(function(ev) {
                    return '<div class="result-row' + (ev.status === 'down' ? ' is-warn' : '') + '"><span class="rr-name" style="font-size:12px;word-break:break-all">' + escapeHTML(fmtTime(ev.t) + ' · ' + (ev.text || '')) + '</span></div>';
                }).join('') : '<div class="result-row"><span class="rr-name" style="color:var(--text-quaternary)">' + escapeHTML(t.monNoEvents) + '</span></div>';
                o.innerHTML =
                    ((cfg.urls && cfg.urls.length) ? '<div class="result-rows" style="margin-top:12px">' + rows + '</div>' : '<div class="no-data">' + escapeHTML(t.monNoConfig) + '</div>') +
                    resultTitle(t.monEvents) +
                    '<div class="result-rows">' + logRows + '</div>';
            }
            async function saveMonitorConfig() {
                const t = i18n[currentLang];
                const key = monAdminKey();
                const o = monOutEl();
                if (!key) { if (o) o.innerHTML = monErrHtml(t.monKeyNeeded); return; }
                try { sessionStorage.setItem('mon-admin-key', key); } catch (e) {}
                const urlsEl = document.getElementById('monUrls');
                const hookEl = document.getElementById('monHook');
                const fmtEl = document.getElementById('monFmt');
                const chatEl = document.getElementById('monChat');
                const thresholdEl = document.getElementById('monThreshold');
                const quietEl = document.getElementById('monQuiet');
                const maintEl = document.getElementById('monMaint');
                const certCheckEl = document.getElementById('monCertCheck');
                const urls = (urlsEl && urlsEl.value) ? urlsEl.value.split(String.fromCharCode(10)).map(function(line) {
                    const v = String(line || '').trim();
                    if (!v) return null;
                    const idx = v.indexOf('|');
                    if (idx > 0) return { label: v.slice(0, idx).trim(), url: v.slice(idx + 1).trim() };
                    return v;
                }).filter(Boolean) : [];
                const webhook = hookEl ? (hookEl.value || '').trim() : '';
                const format = fmtEl ? fmtEl.value : 'generic';
                const chatId = chatEl ? (chatEl.value || '').trim() : '';
                const failureThreshold = thresholdEl ? (Number(thresholdEl.value) || 1) : 1;
                const quietHours = quietEl ? (quietEl.value || '').trim() : '';
                const maintMinutes = maintEl ? (Number(maintEl.value) || 0) : 0;
                const maintenanceUntil = maintMinutes > 0 ? (Date.now() + maintMinutes * 60000) : 0;
                const certCheck = certCheckEl ? !!certCheckEl.checked : true;
                if (o) o.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/monitor', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-admin-key': key },
                        body: JSON.stringify({
                            urls: urls, webhook: webhook, format: format, chatId: chatId,
                            failureThreshold: failureThreshold, quietHours: quietHours,
                            maintenanceUntil: maintenanceUntil, certCheck: certCheck
                        })
                    });
                    const d = await res.json();
                    if (res.status === 403) { if (o) o.innerHTML = monErrHtml(t.monKeyBad); return; }
                    if (!res.ok || d.error) {
                        let msg = t.loadFailed;
                        if (d.error === 'key_not_set') msg = t.monKeyNeeded;
                        else if (d.error === 'bad_url' || d.error === 'bad_webhook') msg = t.monBadUrl;
                        else if (d.error === 'bad_port') msg = t.monBadPort;
                        else if (d.error === 'too_many_urls') msg = t.monMax;
                        else if (d.error === 'write_budget_exceeded') msg = t.monKvWriteLimit;
                        else if (d.error === 'bad_quiet_hours') msg = t.monBadQuiet;
                        if (o) o.innerHTML = monErrHtml(msg);
                        return;
                    }
                    await loadMonitorStatus(key);
                } catch (e) { if (o) o.innerHTML = monErrHtml(t.loadFailed); }
            }
            async function runMonitorNow() {
                const t = i18n[currentLang];
                const key = monAdminKey();
                const o = monOutEl();
                if (!key) { if (o) o.innerHTML = monErrHtml(t.monKeyNeeded); return; }
                if (o) o.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/monitor-run', { method: 'POST', headers: { 'x-admin-key': key }, cache: 'no-store' });
                    const d = await res.json();
                    if (res.status === 403) { if (o) o.innerHTML = monErrHtml(t.monKeyBad); return; }
                    if (!res.ok || d.error) {
                        if (o) o.innerHTML = monErrHtml(d.error === 'no_config' ? t.monNoConfig : t.loadFailed);
                        return;
                    }
                } catch (e) {}
                loadMonitorStatus(key);
            }

            // ==================== 历史记录 & 统计 ====================
            async function logSpeedTest(avgSpeed, results) {
                if (!(window.__NETDIAG__ && window.__NETDIAG__.speedHistoryKv)) return;
                try {
                    await fetch('/api/log-speed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avgSpeed: avgSpeed, results: results })
                    });
                } catch (e) {}
            }

            // C1：历史面板已改为「本地历史」（localStorage，零 KV 读），保留函数名以兼容既有调用点
            async function loadSpeedHistory() {
                renderLocalHistory();
            }

            async function loadUsageStats() {
                const panel = document.getElementById('usage-stats-panel');
                if (!panel) return;
                try {
                    const res = await fetch('/api/usage-stats');
                    const stats = await res.json();
                    let html = '<div class="usage-total">' + (stats.totalRequests || 0).toLocaleString() + '</div>';
                    html += '<div class="usage-total-label">' + i18n[currentLang].totalRequests + '</div>';
                    const endpoints = stats.endpoints || {};
                    const entries = Object.entries(endpoints).sort((a, b) => b[1] - a[1]).slice(0, 8);
                    for (const [ep, count] of entries) {
                        const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
                        html += '<div class="usage-row"><span class="ep">' + escapeHTML(ep) + '</span><span class="count">' + safeCount.toLocaleString() + '</span></div>';
                    }
                    if (entries.length === 0) {
                        html += '<div class="usage-row"><span class="ep" style="color:var(--text-quaternary)">' + i18n[currentLang].waitingFirstReq + '</span></div>';
                    }
                    if (!(window.__NETDIAG__ && window.__NETDIAG__.usageBackend === 'kv')) {
                        html += '<div class="usage-total-label" style="margin-top:6px;opacity:.7">' + i18n[currentLang].usageLocalNote + '</div>';
                    }
                    panel.innerHTML = html;
                } catch (e) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + i18n[currentLang].loadFailed + '</div>';
                }
            }

            // ==================== 主题切换 ====================
            const themeToggle = document.getElementById('themeToggle');
            let currentTheme = 'auto';
            try { currentTheme = localStorage.getItem('theme') || 'auto'; } catch(e) {}
            const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
            function applyTheme(theme) {
                const html = document.documentElement;
                if (theme === 'auto') {
                    if (darkMQ.matches) html.removeAttribute('data-theme');
                    else html.setAttribute('data-theme', 'light');
                    themeToggle.innerHTML = '<i class="fas fa-adjust"></i>';
                } else if (theme === 'dark') {
                    html.removeAttribute('data-theme');
                    themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
                } else {
                    html.setAttribute('data-theme', 'light');
                    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
                }
                try { localStorage.setItem('theme', theme); } catch(e) {}
                // 同步 PWA/移动端状态栏颜色
                const themeMeta = document.querySelector('meta[name="theme-color"]');
                if (themeMeta) themeMeta.setAttribute('content', html.hasAttribute('data-theme') ? '#f4f5f6' : '#0a0b0d');
                currentTheme = theme;
            }
            // 系统主题变化时，若当前为 auto 则实时跟随
            darkMQ.addEventListener('change', () => { if (currentTheme === 'auto') applyTheme('auto'); });
            themeToggle.addEventListener('click', () => {
                if (currentTheme === 'auto') applyTheme('dark');
                else if (currentTheme === 'dark') applyTheme('light');
                else applyTheme('auto');
            });
            applyTheme(currentTheme);

            // ==================== 初始化 ====================
            function init() {
                minRtt = Infinity;
                maxRtt = 0;
                sampleCount = 0;
                consecutiveLoss = 0;
                totalLoss = 0;
                
                updateUI();
                updateHardwareInfo();
                testHttp2();
                window.addEventListener('resize', resizeCanvas);
                if (elements.chart && elements.chart.parentElement) {
                    const observer = new ResizeObserver(() => resizeCanvas());
                    observer.observe(elements.chart.parentElement);
                }
                resizeCanvas();
                getIP('v4');
                getIP('v6');
                testRtt();
                setTimeout(() => fetchUserGeo(), 500);
                if (elements.copyBtn) {
                    elements.copyBtn.setAttribute('role', 'button');
                    elements.copyBtn.setAttribute('tabindex', '0');
                    elements.copyBtn.addEventListener('click', copyReport);
                    elements.copyBtn.addEventListener('keydown', function (e) {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyReport(); }
                    });
                }
                const shareBtn = document.getElementById('share-report');
                if (shareBtn) {
                    shareBtn.addEventListener('click', function () { copySnapshotLink(shareBtn); });
                    shareBtn.addEventListener('keydown', function (e) {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copySnapshotLink(shareBtn); }
                    });
                }
                showSharedSnapshot();
                renderToolCards();
                
                loadSpeedHistory();
                loadUsageStats();
                let statsInterval = setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        clearInterval(statsInterval);
                        rttTestRunning = false;
                        if (rttTimer) { clearTimeout(rttTimer); rttTimer = null; }
                    } else {
                        clearInterval(statsInterval);
                        loadSpeedHistory(); loadUsageStats();
                        statsInterval = setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);
                        if (!rttTestRunning) { rttTestRunning = true; scheduleRtt(0); }
                    }
                });

                // 语言按钮绑定
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        setLang(this.getAttribute('data-lang'));
                    });
                });

                // 标签切换（补 tab 语义与 aria-selected）
                const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
                tabButtons.forEach(btn => {
                    btn.setAttribute('role', 'tab');
                    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
                    btn.addEventListener('click', function() {
                        const target = this.getAttribute('data-tab');
                        tabButtons.forEach(b => {
                            const active = b === this;
                            b.classList.toggle('active', active);
                            b.setAttribute('aria-selected', active ? 'true' : 'false');
                        });
                        document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + target));
                        if (target === 'overview') setTimeout(resizeCanvas, 30);
                    });
                });

                // ESC 关闭弹层（键盘可访问性）
                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape') {
                        closeToolModal();
                        closeNodeModal();
                    }
                });

            }
            
            init();
        })();
    `;

const ASSET_VER = '5.1.0-' + fnv1aHash(APP_CSS + APP_JS);

// ==================== 主请求处理 ====================
async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);
  const cache = caches.default;
  const workerStart = Date.now(); // 统计整个请求的 Worker 处理耗时（原先取在模板渲染前，恒为 ~0ms）
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const siteCfg = getSiteConfig();
  
  // 限流前置：OPTIONS 预检与已停用端点同样消耗 Worker 请求额度，不能绕过限流
  // （跳过静态资源；/health 使用独立配额，RTT/丢包轮询不挤占工具请求额度）
  const rateLimitExempt = url.pathname.startsWith('/static/') || UNLIMITED_PATHS.has(url.pathname);
  if (!rateLimitExempt) {
    const limited = url.pathname === '/health'
      ? isRateLimited(clientIp, HEALTH_RATE_MAX, 60000, healthRateLimit)
      : isRateLimited(clientIp);
    if (limited) {
      obs.status429 += 1;
      return new Response(JSON.stringify({
        error: 'Too Many Requests',
        message: '请稍后再试 / Please try again later'
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          ...corsHeaders(request),
          ...SECURITY_HEADERS
        }
      });
    }
  }

  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }
  
  // SITE_CONFIG 配置停用的端点：403（先于令牌校验与用量统计；限流已在上方执行）
  if (siteCfg.disabledEndpoints.indexOf(url.pathname) >= 0) {
    obs.disabledByConfig += 1;
    return new Response(JSON.stringify({
      error: 'endpoint_disabled_by_config',
      endpoint: url.pathname
    }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // 已停用端点：短路返回 410（先于令牌校验与用量统计；限流已在上方执行）
  if (isDisabledEndpoint(url.pathname)) {
    return new Response(JSON.stringify({
      error: 'endpoint_disabled',
      endpoint: url.pathname,
      message: '该端点已停用 / endpoint disabled'
    }), {
      status: 410,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // 自动用量记录（仅统计白名单端点；内存聚合 + 定时落盘，刻意限制 KV 写入频率）
  if (COUNTED_ENDPOINTS.has(url.pathname)) {
    event.waitUntil(recordUsage(url.pathname));
  }
  
  // ==================== 页面令牌续期端点（无状态令牌过期后前端静默换取，避免整页刷新） ====================
  if (url.pathname === '/api/page-token') {
    const newToken = await issuePageToken();
    return new Response(JSON.stringify({ ok: true, token: newToken, expiresIn: Math.floor(PAGE_TOKEN_TTL_MS / 1000) }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'set-cookie': '__ns_t=' + newToken + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600' + (url.protocol === 'https:' ? '; Secure' : ''),
        ...SECURITY_HEADERS
      }
    });
  }

  // ==================== 健康检查端点 ====================
  if (url.pathname === '/health') {
    // 会话令牌校验：/health 被 RTT 轮询高频调用，未持有主页面签发令牌的客户端一律 403（防爬虫/扫描器）
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      version: '5.1.0',
      storage: { usageBackend: USAGE_BACKEND, speedHistoryKv: SPEED_HISTORY_KV_ENABLED },
      kvWrite: {
        today: kvWriteStats.dayCount,
        blocked: kvWriteStats.blocked,
        failed: kvWriteStats.failed,
        budgetPerDay: KV_WRITE_MAX_PER_DAY,
        budgetPerMin: KV_WRITE_MAX_PER_MIN,
        note: 'per-isolate counters; writes beyond budget are dropped by design'
      },
      site: {
        siteName: siteCfg.siteName,
        defaultLang: siteCfg.defaultLang || null,
        disabledTools: siteCfg.disabledTools.length,
        disabledEndpoints: siteCfg.disabledEndpoints.length,
        offline: siteCfg.offline
      },
      metrics: {
        uptimeMs: Date.now() - obs.startedAt,
        requestsTotal: liveUsage.totalRequests,
        status403: obs.status403,
        status429: obs.status429,
        errors500: obs.errors500,
        disabledByConfig: obs.disabledByConfig,
        rateLimitKeys: { default: rateLimit.size, health: healthRateLimit.size, largeDl: largeDlRateLimit.size },
        kvWrites: { attempts: obs.kv.attempts, success: obs.kv.success, blocked: obs.kv.blocked, failed: obs.kv.failed },
        monitor: obs.monitor
      },
      note: 'Cloudflare Workers are stateless; per-request context only'
    }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS
      }
    });
  }

  // ==================== Prometheus 指标（可选，需 metricsKey 或 MONITOR_ADMIN_KEY） ====================
  if (url.pathname === '/metrics') {
    const metricsKey = siteCfg.metricsKey || ((typeof MONITOR_ADMIN_KEY !== 'undefined' && MONITOR_ADMIN_KEY) ? String(MONITOR_ADMIN_KEY) : '');
    const reqKey = request.headers.get('x-metrics-key') || request.headers.get('x-admin-key') || '';
    if (!metricsKey || !timingSafeEqualString(reqKey, metricsKey)) {
      obs.status403 += 1;
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }
      });
    }
    const lines = [
      '# HELP netsight_uptime_seconds Worker isolate uptime',
      '# TYPE netsight_uptime_seconds gauge',
      'netsight_uptime_seconds ' + Math.round((Date.now() - obs.startedAt) / 1000),
      '# HELP netsight_requests_total Requests handled by this isolate',
      '# TYPE netsight_requests_total counter',
      'netsight_requests_total ' + liveUsage.totalRequests,
      '# HELP netsight_status_403_total 403 responses',
      '# TYPE netsight_status_403_total counter',
      'netsight_status_403_total ' + obs.status403,
      '# HELP netsight_status_429_total 429 responses',
      '# TYPE netsight_status_429_total counter',
      'netsight_status_429_total ' + obs.status429,
      '# HELP netsight_errors_500_total unhandled errors',
      '# TYPE netsight_errors_500_total counter',
      'netsight_errors_500_total ' + obs.errors500,
      '# HELP netsight_kv_writes_total KV write attempts',
      '# TYPE netsight_kv_writes_total counter',
      'netsight_kv_writes_total ' + obs.kv.attempts,
      '# HELP netsight_kv_writes_blocked_total KV writes blocked by budget',
      '# TYPE netsight_kv_writes_blocked_total counter',
      'netsight_kv_writes_blocked_total ' + obs.kv.blocked,
      '# HELP netsight_kv_writes_failed_total KV write failures',
      '# TYPE netsight_kv_writes_failed_total counter',
      'netsight_kv_writes_failed_total ' + obs.kv.failed,
      '# HELP netsight_rate_limit_keys Rate limit map entries',
      '# TYPE netsight_rate_limit_keys gauge',
      'netsight_rate_limit_keys{store="default"} ' + rateLimit.size,
      'netsight_rate_limit_keys{store="health"} ' + healthRateLimit.size,
      'netsight_rate_limit_keys{store="large_dl"} ' + largeDlRateLimit.size,
      '# HELP netsight_monitor_last_run_seconds Last monitor run duration seconds',
      '# TYPE netsight_monitor_last_run_seconds gauge',
      'netsight_monitor_last_run_seconds ' + Math.round((obs.monitor.lastDurationMs || 0) / 1000),
      '# HELP netsight_monitor_last_notified Last monitor run notifications succeeded',
      '# TYPE netsight_monitor_last_notified gauge',
      'netsight_monitor_last_notified ' + (obs.monitor.lastNotified || 0),
      ''
    ];
    return new Response(lines.join('\n'), {
      headers: { 'content-type': 'text/plain;version=0.0.4;charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }
    });
  }
  
  // ==================== 静态应用资源（/app.css /app.js，长缓存） ====================
  if (url.pathname === '/app.css' || url.pathname === '/app.js') {
    const isCssAsset = url.pathname === '/app.css';
    const assetKey = new Request(url.origin + url.pathname + '?v=' + ASSET_VER, { method: 'GET' });
    const assetHit = await cache.match(assetKey);
    if (assetHit) return assetHit;
    const assetResp = new Response(isCssAsset ? APP_CSS : APP_JS, {
      headers: {
        'content-type': isCssAsset ? 'text/css;charset=UTF-8' : 'application/javascript;charset=UTF-8',
        'cache-control': 'public, max-age=31536000, immutable',
        ...SECURITY_HEADERS
      }
    });
    if (request.method === 'GET') event.waitUntil(cache.put(assetKey, assetResp.clone()));
    return assetResp;
  }
  // ==================== PWA 资源端点 ====================
  if (url.pathname === '/manifest.webmanifest') {
    const manifestLang = resolveDefaultLang(request.headers.get('accept-language') || '');
    const manifest = {
      name: siteCfg.siteName,
      short_name: siteCfg.siteName.slice(0, 20),
      description: 'Aurora Diagnostics - Real-time Network Analysis',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0a0b0d',
      theme_color: '#0a0b0d',
      lang: manifestLang,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
      ]
    };
    return new Response(JSON.stringify(manifest), {
      headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=86400', ...SECURITY_HEADERS }
    });
  }
  if (url.pathname === '/sw.js') return renderServiceWorker(siteCfg);

  if (url.pathname === '/icon.svg') {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0a0b0d"/><polyline points="77,307 189,307 241,205 297,389 348,276 435,276" fill="none" stroke="#e9eaec" stroke-width="31" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', ...SECURITY_HEADERS }
    });
  }
  if (url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png') {
    let bytes = url.pathname === '/icon-192.png' ? _icon192Bytes : _icon512Bytes;
    if (!bytes) {
      const b64 = url.pathname === '/icon-192.png' ? ICON_192_B64 : ICON_512_B64;
      bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (url.pathname === '/icon-192.png') _icon192Bytes = bytes; else _icon512Bytes = bytes;
    }
    return new Response(bytes, {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', ...SECURITY_HEADERS }
    });
  }
  
  // ==================== 静态资源缓存 ====================
  if (url.pathname.startsWith('/static/')) {
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const cachedResponse = await cache.match(cacheKey);
    if ((request.method === 'GET' || request.method === 'HEAD') && cachedResponse) return cachedResponse;
    
    let contentType = 'text/plain';
    if (url.pathname.endsWith('.css')) contentType = 'text/css';
    else if (url.pathname.endsWith('.js')) contentType = 'application/javascript';
    else if (url.pathname.endsWith('.png')) contentType = 'image/png';
    else if (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (url.pathname.endsWith('.svg')) contentType = 'image/svg+xml';
    
    if (typeof CACHE_KV !== 'undefined' && CACHE_KV) {
      const kvValue = await CACHE_KV.get(url.pathname);
      if (kvValue) {
        const response = new Response(kvValue, {
          headers: {
            'content-type': contentType,
            'cache-control': 'public, max-age=86400',
            'cdn-cache-control': 'public, max-age=604800',
            ...SECURITY_HEADERS
          }
        });
        if (request.method === 'GET') event.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
  
  // ==================== 速度测试端点 ====================
  if (url.pathname === '/speedtest') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const size = clampInt(url.searchParams.get('size'), 102400, 1, 67108864);
    if (size > 2097152) {
      // 大响应（缓冲膨胀/长时测速用）：独立配额防放大；流式生成，内存恒定
      if (isRateLimited(clientIp, LARGE_DL_MAX, 60000, largeDlRateLimit)) {
        return new Response(JSON.stringify({
          error: 'Too Many Requests',
          message: '请稍后再试 / Please try again later'
        }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60', ...corsHeaders(request), ...SECURITY_HEADERS }
        });
      }
      const CHUNK = 262144;
      let sent = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= size) { controller.close(); return; }
          const n = Math.min(CHUNK, size - sent);
          const chunk = new Uint8Array(n);
          chunk.set(getRandomTemplate().subarray(0, n));
          sent += n;
          controller.enqueue(chunk);
        }
      });
      return new Response(stream, {
        headers: {
          'content-type': 'application/octet-stream',
          ...corsHeaders(request),
          ...SECURITY_HEADERS
        }
      });
    }
    const data = fillRandom(new Uint8Array(size));
    return new Response(data, {
      headers: {
        'content-type': 'application/octet-stream',
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 上传速度测试端点 ====================
  if (url.pathname === '/upload-test' && request.method === 'POST') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    // 大 body 端点与 /speedtest 共享独立配额，防止上传流量绕过预算
    if (isRateLimited(clientIp, LARGE_DL_MAX, 60000, largeDlRateLimit)) {
      return new Response(JSON.stringify({ error: 'Too Many Requests', message: '请稍后再试 / Please try again later' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10);
    const MAX_UPLOAD = 33554432;
    const tooLargeResponse = () => new Response(JSON.stringify({ error: 'Payload too large', max: '32MB' }), {
      status: 413,
      headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
    });
    if (Number.isFinite(contentLength) && (contentLength < 0 || contentLength > MAX_UPLOAD)) {
      return tooLargeResponse();
    }
    const start = Date.now();
    let bytes = 0;
    // 统一流式读取并边读边限流，避免把整个 body 缓冲进内存
    if (request.body) {
      const reader = request.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value ? value.byteLength : 0;
        if (bytes > MAX_UPLOAD) {
          try { await reader.cancel(); } catch (e) {}
          return tooLargeResponse();
        }
      }
    }
    const duration = Date.now() - start;
    const speedMbps = duration > 0 ? ((bytes * 8) / (duration / 1000)) / 1000000 : 0;
    return new Response(JSON.stringify({
      bytes: bytes,
      duration: duration,
      speedMbps: Math.round(speedMbps * 100) / 100
    }), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(request, 'POST, OPTIONS'),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== CPU 密集型测试端点 ====================
  if (url.pathname === '/cpu-test') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const now = Date.now();
    let cpulimit = cpuRateLimit.get(clientIp);
    if (!cpulimit || now > cpulimit.resetTime) {
      cpulimit = { count: 0, resetTime: now + 60000 };
    }
    if (cpulimit.count >= 3) {
      return new Response(JSON.stringify({
        error: 'rate limited',
        retryAfter: Math.ceil((cpulimit.resetTime - now) / 1000)
      }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': String(Math.ceil((cpulimit.resetTime - now) / 1000)), ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    cpulimit.count++;
    cpuRateLimit.set(clientIp, cpulimit);
    if (cpuRateLimit.size > RATE_LIMIT_MAX_KEYS) {
      const oldestCpu = cpuRateLimit.keys().next().value;
      if (oldestCpu !== undefined) cpuRateLimit.delete(oldestCpu);
    }

    const iterations = clampInt(url.searchParams.get('n'), 20000, 1, 20000);
    const start = performance.now();
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i);
    }
    const duration = Math.round((performance.now() - start) * 100) / 100;
    return new Response(JSON.stringify({
      duration: duration,
      iterations: iterations,
      opsMs: duration > 0 ? Math.round(iterations / duration * 100) / 100 : iterations,
      result: Number.isFinite(result) ? result.toFixed(2) : '0'
    }), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 多节点对比探测端点（跨域 CORS，供其它 NetSight 部署节点互测延迟） ====================
  // 其它工具端点均有「页面会话令牌」校验，跨域调用会被 403；该端点响应极小（~60B）、
  // 不设令牌要求，仅暴露版本与时间，且受默认 60 次/分/IP 限流约束。
  if (url.pathname === '/node-ping') {
    return new Response(JSON.stringify({ ok: true, version: '5.1.0', time: Date.now() }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== DNS 代理测试端点 ====================
  if (url.pathname === '/dns-proxy') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'missing url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    
    let parsedTarget;
    try { parsedTarget = new URL(targetUrl); } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const hostname = parsedTarget.hostname;
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      return new Response(JSON.stringify({ error: 'invalid scheme' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    if (!isAllowedTargetPort(parsedTarget)) {
      return new Response(JSON.stringify({ error: 'forbidden port' }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    
    const allowed = ['cloudflare.com', 'google.com', 'github.com'];
    if (!allowed.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return new Response(JSON.stringify({ error: 'forbidden domain' }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    
    const start = Date.now();
    let status = null;
    try {
      const res = await fetch(parsedTarget.href, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      status = res.status;
    } catch (e) {
      const time = Date.now() - start;
      return new Response(JSON.stringify({ time, status: null, error: 'fetch failed' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const time = Date.now() - start;
    return new Response(JSON.stringify({ time, status }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== DNS 工具箱端点（DoH 查询 + 黑名单检测） ====================
  if (url.pathname === '/api/dns-lookup') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const qName = (url.searchParams.get('name') || '').trim().toLowerCase().replace(/\.$/, '');
    const qType = (url.searchParams.get('type') || 'A').toUpperCase();
    const ALLOWED_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];
    if (!ALLOWED_DNS_TYPES.includes(qType) || !/^[a-z0-9_][a-z0-9_.-]{0,251}$/.test(qName) || qName.includes('..')) {
      return new Response(JSON.stringify({ error: 'invalid query' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const dnsKey = qType + ':' + qName;
    const nowMs = Date.now();
    const dnsHit = dnsLookupCache.get(dnsKey);
    if (dnsHit && nowMs - dnsHit.at < DNS_LOOKUP_CACHE_MS) {
      return new Response(JSON.stringify(dnsHit.data), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    try {
      const dohRes = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(qName) + '&type=' + qType, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!dohRes.ok) throw new Error('doh ' + dohRes.status);
      const dohData = await dohRes.json();
      const answers = (Array.isArray(dohData.Answer) ? dohData.Answer : []).slice(0, 40).map(a => ({
        name: String(a.name || '').slice(0, 253),
        type: a.type,
        ttl: a.TTL,
        data: String(a.data === undefined ? '' : a.data).slice(0, 500)
      }));
      const payload = { status: dohData.Status, name: qName, type: qType, answers };
      boundedCacheSet(dnsLookupCache, dnsKey, { at: nowMs, data: payload }, 300);
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'lookup failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
  }
  
  if (url.pathname === '/api/dnsbl') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const ipRaw = (url.searchParams.get('ip') || '').trim();
    const ipm = ipRaw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipm || ipm.slice(1).some(o => Number(o) > 255)) {
      return new Response(JSON.stringify({ error: 'invalid ip' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const nowDnsbl = Date.now();
    const blHit = dnsblCache.get(ipRaw);
    if (blHit && nowDnsbl - blHit.at < DNSBL_CACHE_MS) {
      return new Response(JSON.stringify(blHit.data), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const reversedIp = ipRaw.split('.').reverse().join('.');
    const zones = ['zen.spamhaus.org', 'all.s5h.net', 'dnsbl.dronebl.org'];
    // 三个黑名单区并行查询（串行时单请求最坏 3×4s），结果写入有界缓存
    const results = await Promise.all(zones.map(async (zone) => {
      const zoneQuery = reversedIp + '.' + zone;
      let entry = { zone, status: 'unknown', codes: [] };
      try {
        const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + zoneQuery + '&type=A', {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(4000)
        });
        if (r.ok) {
          const d = await r.json();
          const ans = Array.isArray(d.Answer) ? d.Answer : [];
          const codes = ans.map(a => String(a.data || '')).filter(x => x.indexOf('127.') === 0);
          if (d.Status === 3) entry = { zone, status: 'clean', codes: [] };
          else if (codes.length > 0) {
            if (codes.some(c => c.indexOf('127.255.255') === 0)) entry = { zone, status: 'refused', codes };
            else entry = { zone, status: 'listed', codes };
          }
        }
      } catch (e) {}
      return entry;
    }));
    const blPayload = { ip: ipRaw, results, checkedAt: nowDnsbl };
    boundedCacheSet(dnsblCache, ipRaw, { at: nowDnsbl, data: blPayload }, 300);
    return new Response(JSON.stringify(blPayload), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== DNS 多解析器对比端点 ====================
  if (url.pathname === '/api/dns-compare') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const cmpJson = (data, status = 200) => new Response(JSON.stringify(data), {
      status: status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
    const cName = (url.searchParams.get('name') || '').trim().toLowerCase().replace(/\.$/, '');
    const cType = (url.searchParams.get('type') || 'A').toUpperCase();
    const CMP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
    if (!CMP_TYPES.includes(cType) || !/^[a-z0-9_][a-z0-9_.-]{0,251}$/.test(cName) || cName.includes('..')) return cmpJson({ error: 'invalid query' }, 400);
    const cKey = 'cmp:' + cType + ':' + cName;
    const nowCmp = Date.now();
    const cmpHit = dnsLookupCache.get(cKey);
    if (cmpHit && nowCmp - cmpHit.at < DNS_LOOKUP_CACHE_MS) return cmpJson(cmpHit.data);
    // RFC 8484 wireformat 查询：支持任意 DoH 服务，不依赖各家的 JSON API
    const resolverDefs = [
      { id: 'cloudflare', label: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
      { id: 'google', label: 'Google', url: 'https://dns.google/dns-query' },
      { id: 'quad9', label: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
      { id: 'adguard', label: 'AdGuard', url: 'https://dns.adguard-dns.com/dns-query' },
      { id: 'dnssb', label: 'DNS.SB', url: 'https://doh.sb/dns-query' },
      { id: 'alidns', label: 'AliDNS', url: 'https://dns.alidns.com/dns-query' }
    ];
    const cmpResults = await Promise.all(resolverDefs.map(async (rv) => {
      const t0 = Date.now();
      const out = { id: rv.id, label: rv.label, status: 'error', time: 0, answers: [], error: null, ad: false };
      const r = await dohWireQuery(rv.url, cName, cType, 5000);
      out.time = Date.now() - t0;
      if (r.error) { out.error = r.error; return out; }
      out.ad = !!r.ad;
      out.status = r.status === 0 ? 'ok' : (r.status === 3 ? 'nxdomain' : ('rcode_' + r.status));
      out.answers = (Array.isArray(r.answers) ? r.answers : []).slice(0, 20).map(a => ({
        type: a.type, ttl: a.ttl, data: String(a.data === undefined ? '' : a.data).slice(0, 300)
      }));
      return out;
    }));
    const sigMap = {};
    for (const r of cmpResults) {
      if (r.status !== 'ok') continue;
      const sig = r.answers.map(a => a.data.toLowerCase().replace(/\.$/, '')).sort().join(' | ') || '(empty)';
      if (!sigMap[sig]) sigMap[sig] = [];
      sigMap[sig].push(r.id);
    }
    const groups = Object.keys(sigMap).map(sig => ({ sig: sig, resolvers: sigMap[sig], count: sigMap[sig].length })).sort((a, b) => b.count - a.count);
    const payload = { name: cName, type: cType, resolvers: cmpResults, groups: groups, consistent: groups.length === 1 };
    boundedCacheSet(dnsLookupCache, cKey, { at: nowCmp, data: payload }, 300);
    return cmpJson(payload);
  }

  // ==================== 网络可达性探测端点（边缘侧） ====================
  // ==================== 网络可达性（已改为纯浏览器侧探测） ====================
  // 原 /api/reach-check 边缘侧探测已移除：为「以用户网络为主、少用 Worker 网络」，
  // 可达性检测现在完全由浏览器对目标站点发起 no-cors 探测，Worker 不再产生任何出站请求。

  // ==================== 域名安全体检端点（MX/SPF/DMARC/DKIM + 声誉） ====================
  if (url.pathname === '/api/domain-check') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const jsonOut = (data, status = 200) => new Response(JSON.stringify(data), {
      status: status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase().replace(/\.$/, '');
    const selector = (url.searchParams.get('selector') || '').trim().toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_.-]{0,251}$/.test(domain) || domain.includes('..')) return jsonOut({ error: 'invalid domain' }, 400);
    if (selector && !/^[a-z0-9_][a-z0-9_-]{0,62}$/.test(selector)) return jsonOut({ error: 'invalid selector' }, 400);
    const dcKey = 'dc:' + domain + ':' + selector;
    const nowDc = Date.now();
    const dcHit = dnsLookupCache.get(dcKey);
    if (dcHit && nowDc - dcHit.at < 120000) return jsonOut(dcHit.data);
    const doh = async (qName, qType) => {
      try {
        const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(qName) + '&type=' + qType, {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { return null; }
    };
    const [mxRes, txtRes, dmarcRes, dkimRes, dblRes, surblRes, nsRes, caaRes, dnskeyRes, dsRes, mtaStsRes, bimiRes] = await Promise.all([
      doh(domain, 'MX'),
      doh(domain, 'TXT'),
      doh('_dmarc.' + domain, 'TXT'),
      selector ? doh(selector + '._domainkey.' + domain, 'TXT') : null,
      doh(domain + '.dbl.spamhaus.org', 'A'),
      doh(domain + '.multi.surbl.org', 'A'),
      doh(domain, 'NS'),
      doh(domain, 'CAA'),
      doh(domain, 'DNSKEY'),
      doh(domain, 'DS'),
      doh('_mta-sts.' + domain, 'TXT'),
      doh('_bimi.' + domain, 'TXT')
    ]);
    const ansList = (res) => (res && Array.isArray(res.Answer)) ? res.Answer : [];
    const stripQ = (s) => String(s === undefined || s === null ? '' : s).replace(/^"+|"+$/g, '');
    const mx = ansList(mxRes).filter(a => a.type === 15).map(a => stripQ(a.data)).slice(0, 10);
    const spfAll = ansList(txtRes).filter(a => a.type === 16).map(a => stripQ(a.data)).filter(t => /^v=spf1(?:\s|$)/i.test(t));
    const spf = { found: spfAll.length > 0, multi: spfAll.length > 1, record: spfAll.length ? spfAll[0].slice(0, 450) : null, allQualifier: null, weak: false };
    if (spf.found) {
      const m = spfAll[0].match(/([~+\-?])all(?:\s|$)/i);
      spf.allQualifier = m ? m[1] : null;
      spf.weak = !m || m[1] === '+' || m[1] === '?';
    }
    const dmarcTxt = ansList(dmarcRes).filter(a => a.type === 16).map(a => stripQ(a.data)).find(t => /^v=DMARC1(?:\s*;|\s*$)/i.test(t)) || null;
    const dmarc = { found: !!dmarcTxt, record: dmarcTxt ? dmarcTxt.slice(0, 450) : null, policy: null, hasRua: false };
    if (dmarcTxt) {
      const pm = dmarcTxt.match(/p\s*=\s*(none|quarantine|reject)/i);
      dmarc.policy = pm ? pm[1].toLowerCase() : null;
      dmarc.hasRua = /rua\s*=/i.test(dmarcTxt);
    }
    let dkim = { checked: false, found: null, record: null };
    if (selector) {
      const dk = ansList(dkimRes).filter(a => a.type === 16).map(a => stripQ(a.data));
      dkim = { checked: true, found: dk.length > 0, record: dk.length ? dk[0].slice(0, 300) : null };
    }
    const blStatus = (res) => {
      if (!res) return 'unknown';
      if (res.Status === 3) return 'clean';
      const codes = ansList(res).map(a => String(a.data || '')).filter(x => x.indexOf('127.') === 0);
      if (!codes.length) return res.Status === 0 ? 'clean' : 'unknown';
      if (codes.some(c => c.indexOf('127.255.255') === 0)) return 'refused';
      return 'listed';
    };
    const blocklists = [
      { zone: 'dbl.spamhaus.org', status: blStatus(dblRes) },
      { zone: 'multi.surbl.org', status: blStatus(surblRes) }
    ];
    const ns = ansList(nsRes).filter(a => a.type === 2).map(a => stripQ(a.data).replace(/\.$/, '')).slice(0, 8);
    const caaRecords = ansList(caaRes).filter(a => a.type === 257).map(a => stripQ(a.data)).slice(0, 8);
    const caa = { found: caaRecords.length > 0, issue: [], issuewild: [] };
    caaRecords.forEach(function (c) {
      const m = String(c).match(/(?:^|\s)(issue|issuewild)\s+"([^"]+)"/i);
      if (!m) return;
      const arr = m[1].toLowerCase() === 'issuewild' ? caa.issuewild : caa.issue;
      if (arr.indexOf(m[2]) === -1) arr.push(m[2]);
    });
    const dnskeyCount = ansList(dnskeyRes).filter(a => a.type === 48).length;
    const dsCount = ansList(dsRes).filter(a => a.type === 43).length;
    const dnssecAd = !!(
      (dnskeyRes && (dnskeyRes.AD === true || dnskeyRes.Ad === true)) ||
      (dsRes && (dsRes.AD === true || dsRes.Ad === true)) ||
      (mxRes && (mxRes.AD === true || mxRes.Ad === true))
    );
    const dnssec = { enabled: dnskeyCount > 0 || dsCount > 0, ad: dnssecAd, dnskeyCount: dnskeyCount, dsCount: dsCount };
    const mtaStsTxt = ansList(mtaStsRes).filter(a => a.type === 16).map(a => stripQ(a.data)).find(t => /^v=STSv1/i.test(t)) || null;
    const mtaSts = { found: !!mtaStsTxt, record: mtaStsTxt ? mtaStsTxt.slice(0, 300) : null };
    const bimiTxt = ansList(bimiRes).filter(a => a.type === 16).map(a => stripQ(a.data)).find(t => /^v=BIMI1/i.test(t)) || null;
    const bimi = { found: !!bimiTxt, record: bimiTxt ? bimiTxt.slice(0, 300) : null };
    let raw = 0, max = 0;
    const issues = [];
    max += 15;
    if (mx.length > 0) raw += 15; else issues.push('mx_missing');
    max += 25;
    if (spf.found && !spf.multi) {
      if (spf.weak) { raw += 18; issues.push('spf_weak'); } else { raw += 25; }
    } else if (spf.multi) { issues.push('spf_multi'); }
    else { issues.push('spf_missing'); }
    max += 25;
    if (dmarc.found) {
      if (dmarc.policy === 'reject') raw += 25;
      else if (dmarc.policy === 'quarantine') raw += 23;
      else { raw += 18; issues.push('dmarc_none'); }
    } else { issues.push('dmarc_missing'); }
    if (dkim.checked) {
      max += 15;
      if (dkim.found) raw += 15; else issues.push('dkim_missing');
    }
    max += 20;
    if (blocklists.some(b => b.status === 'listed')) { issues.push('listed'); }
    else if (blocklists.some(b => b.status === 'clean')) { raw += 20; }
    else { raw += 10; }
    max += 5;
    if (dnssec.enabled) raw += 5; else issues.push('dnssec_missing');
    max += 5;
    if (caa.found) raw += 5; else issues.push('caa_missing');
    max += 5;
    if (mtaSts.found) raw += 5; else issues.push('mta_sts_missing');
    max += 5;
    if (bimi.found) raw += 5; else issues.push('bimi_missing');
    max += 5;
    if (ns.length >= 2) raw += 5; else issues.push('ns_insufficient');
    const score = max > 0 ? Math.round((raw / max) * 100) : 0;
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
    const payload = {
      domain: domain, selector: selector, mx: mx, spf: spf, dmarc: dmarc, dkim: dkim,
      blocklists: blocklists, ns: ns, caa: caa, dnssec: dnssec, mtaSts: mtaSts, bimi: bimi,
      score: score, grade: grade, issues: issues
    };
    boundedCacheSet(dnsLookupCache, dcKey, { at: nowDc, data: payload }, 300);
    return jsonOut(payload);
  }

  // ==================== 站点监控端点（配置 / 状态 / 立即巡检） ====================
  if (url.pathname === '/api/monitor' || url.pathname === '/api/monitor-run') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const jsonOut = (data, status = 200) => new Response(JSON.stringify(data), {
      status: status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
    const kv = monitorKv();
    if (!kv) return jsonOut({ error: 'kv_missing' }, 503);
    const adminKey = (typeof MONITOR_ADMIN_KEY !== 'undefined' && MONITOR_ADMIN_KEY) ? String(MONITOR_ADMIN_KEY) : '';
    if (!adminKey) return jsonOut({ error: 'key_not_set' }, 503);
    // 管理密钥只走请求头：放 URL query 会泄漏到访问日志/浏览器历史/Referer
    const reqKey = request.headers.get('x-admin-key') || '';
    if (!timingSafeEqualString(reqKey, adminKey)) return jsonOut({ error: 'bad_key' }, 403);
    if (url.pathname === '/api/monitor' && request.method === 'GET') {
      let config = null, state = {}, log = [];
      try { const raw = await kv.get('monitor:config'); if (raw) config = JSON.parse(raw); } catch (e) {}
      try { const raw = await kv.get('monitor:state'); if (raw) state = JSON.parse(raw); } catch (e) {}
      if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
      try { const raw = await kv.get('monitor:log'); if (raw) log = JSON.parse(raw); } catch (e) {}
      if (!Array.isArray(log)) log = [];
      return jsonOut({ ok: true, config: config, state: state, log: log });
    }
    if (url.pathname === '/api/monitor' && request.method === 'POST') {
      let body = null;
      try {
        const rawBody = await readTextCapped(request, 65536);
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch (e) {}
      if (!body || typeof body !== 'object') return jsonOut({ error: 'bad_body' }, 400);
      const urlsIn = Array.isArray(body.urls) ? body.urls : [];
      if (urlsIn.length > 10) return jsonOut({ error: 'too_many_urls' }, 400);
      const urls = [];
      for (const u of urlsIn) {
        const raw = (u && typeof u === 'object') ? u : { url: String(u || '') };
        const s = String(raw.url || '').trim();
        const label = String(raw.label || '').trim().slice(0, 60);
        if (!s) continue;
        if (s.length > 300) return jsonOut({ error: 'bad_url', detail: s.slice(0, 120) }, 400);
        let ok = false, portBlocked = false;
        try {
          const p = new URL(s);
          const schemeOk = (p.protocol === 'http:' || p.protocol === 'https:');
          const hostOk = schemeOk && p.hostname.includes('.') && !isPrivateHost(p.hostname);
          const portOk = isAllowedTargetPort(p);
          ok = hostOk && portOk;
          portBlocked = hostOk && !portOk;
        } catch (e) {}
        if (!ok) return jsonOut({ error: portBlocked ? 'bad_port' : 'bad_url', detail: s.slice(0, 120) }, 400);
        urls.push({ url: s, label: label });
      }
      const webhook = String(body.webhook || '').trim().slice(0, 500);
      if (webhook) {
        let ok = false, portBlocked = false;
        try {
          const p = new URL(webhook);
          // Webhook SSRF 防护：拒绝内网/本机主机；端口只放行 80/443
          const schemeOk = (p.protocol === 'https:' || p.protocol === 'http:');
          const hostOk = schemeOk && !isPrivateHost(p.hostname);
          const portOk = isAllowedTargetPort(p);
          ok = hostOk && portOk;
          portBlocked = hostOk && !portOk;
        } catch (e) {}
        if (!ok) return jsonOut({ error: portBlocked ? 'bad_port' : 'bad_webhook' }, 400);
      }
      const allowedFormats = ['generic', 'dingtalk', 'feishu', 'wecom', 'slack', 'discord', 'telegram', 'ntfy'];
      const format = allowedFormats.includes(body.format) ? body.format : 'generic';
      const chatId = String(body.chatId || '').trim().slice(0, 64);
      const failureThreshold = Math.min(5, Math.max(1, Number(body.failureThreshold) || 1));
      const quietHours = String(body.quietHours || '').trim().slice(0, 11);
      if (quietHours && !/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.test(quietHours)) return jsonOut({ error: 'bad_quiet_hours' }, 400);
      const maintenanceUntil = Number(body.maintenanceUntil) > Date.now() ? Number(body.maintenanceUntil) : 0;
      const certCheck = body.certCheck !== false;
      // 保存配置：跳过同键去抖（用户可能连续保存），但仍受分钟/每日写入预算约束
      const configSaved = await kvPut(kv, 'monitor:config', JSON.stringify({
        urls: urls, webhook: webhook, format: format, chatId: chatId,
        failureThreshold: failureThreshold, quietHours: quietHours,
        maintenanceUntil: maintenanceUntil, certCheck: certCheck, updatedAt: Date.now()
      }), undefined, { skipDebounce: true });
      if (!configSaved) return jsonOut({ error: 'write_budget_exceeded' }, 503);
      return jsonOut({ ok: true, urls: urls, webhook: webhook, format: format, chatId: chatId, failureThreshold: failureThreshold, quietHours: quietHours, maintenanceUntil: maintenanceUntil, certCheck: certCheck });
    }
    if (url.pathname === '/api/monitor-run' && request.method === 'POST') {
      let cfg = null;
      try { const raw = await kv.get('monitor:config'); if (raw) cfg = JSON.parse(raw); } catch (e) {}
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || !Array.isArray(cfg.urls) || cfg.urls.length === 0) return jsonOut({ error: 'no_config' }, 400);
      const result = await handleMonitorCheck();
      return jsonOut({ ok: true, result: result });
    }
    return jsonOut({ error: 'method_not_allowed' }, 405);
  }
  
  // ==================== 管理面板 API（只读概览，需 x-admin-key） ====================
  if (url.pathname === '/api/admin/overview') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const adminKey = (typeof MONITOR_ADMIN_KEY !== 'undefined' && MONITOR_ADMIN_KEY) ? String(MONITOR_ADMIN_KEY) : '';
    const reqKey = request.headers.get('x-admin-key') || '';
    if (!adminKey) {
      return new Response(JSON.stringify({ error: 'key_not_set' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    if (!timingSafeEqualString(reqKey, adminKey)) return forbiddenResponse(request);
    const kv = monitorKv();
    let config = null, state = {}, log = [];
    if (kv) {
      try { const raw = await kv.get('monitor:config'); if (raw) config = JSON.parse(raw); } catch (e) {}
      try { const raw = await kv.get('monitor:state'); if (raw) state = JSON.parse(raw); } catch (e) {}
      try { const raw = await kv.get('monitor:log'); if (raw) log = JSON.parse(raw); } catch (e) {}
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
    if (!Array.isArray(log)) log = [];
    return new Response(JSON.stringify({
      ok: true,
      version: '5.1.0',
      site: { siteName: siteCfg.siteName, defaultLang: siteCfg.defaultLang || null, offline: siteCfg.offline, disabledTools: siteCfg.disabledTools, disabledEndpoints: siteCfg.disabledEndpoints },
      config: config, state: state, log: log.slice(0, 20),
      usage: liveUsage,
      obs: obs,
      kvWrite: { today: kvWriteStats.dayCount, blocked: kvWriteStats.blocked, failed: kvWriteStats.failed, budgetPerDay: KV_WRITE_MAX_PER_DAY, budgetPerMin: KV_WRITE_MAX_PER_MIN }
    }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ==================== 站点体检端点（HTTP 安全头审计） ====================
  if (url.pathname === '/api/site-audit') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const target = url.searchParams.get('url') || '';
    let parsed;
    try { parsed = new URL(target); } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedTargetPort(parsed) || isPrivateHost(parsed.hostname) || !(await resolvesToPublicOnly(parsed.hostname))) {
      return new Response(JSON.stringify({ error: 'forbidden target' }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const auditStart = Date.now();
    const AUDIT_DEADLINE_MS = 25000;
    let current = parsed.href;
    let resp = null;
    let ttfb = 0;
    let redirectCount = 0;
    try {
      for (let hop = 0; hop < 6; hop++) {
        // 总 deadline：6 跳 × (逐跳 DoH + 8s fetch) 最坏可达 ~84s，超过客户端/平台耐心上限
        if (Date.now() - auditStart > AUDIT_DEADLINE_MS) break;
        const t0 = Date.now();
        resp = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': 'NetSight-Pro-Audit/1.0' },
          signal: AbortSignal.timeout(8000)
        });
        if (hop === 0) ttfb = Date.now() - t0;
        const loc = resp.headers.get('location');
        if (resp.status >= 300 && resp.status < 400 && loc && hop < 5) {
          let next;
          try { next = new URL(loc, current); } catch (e) { break; }
          if (!['http:', 'https:'].includes(next.protocol) || !isAllowedTargetPort(next) || isPrivateHost(next.hostname) || !(await resolvesToPublicOnly(next.hostname))) break;
          current = next.href;
          redirectCount++;
          // 不消费 3xx 响应体：显式取消，避免连接/缓冲被占用
          try { if (resp.body) await resp.body.cancel(); } catch (e) {}
          continue;
        }
        break;
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'fetch failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    // 仅需要响应头：取消最终响应体，避免大 body 占用 Worker 资源
    try { if (resp.body) await resp.body.cancel(); } catch (e) {}
    const rh = resp.headers;
    const hsts = rh.get('strict-transport-security') || null;
    const csp = rh.get('content-security-policy') || null;
    const xfo = rh.get('x-frame-options') || null;
    const xcto = rh.get('x-content-type-options') || null;
    const refpol = rh.get('referrer-policy') || null;
    const permpol = rh.get('permissions-policy') || null;
    const coop = rh.get('cross-origin-opener-policy') || null;
    const server = rh.get('server') || null;
    const checks = [];
    const issues = [];
    let score = 0;
    const hstsMax = hsts ? (hsts.match(/max-age\s*=\s*(\d+)/i) || [])[1] : null;
    const hstsStrong = !!(hstsMax && Number(hstsMax) >= 15552000);
    if (hsts) {
      score += hstsStrong ? 20 : 15;
      checks.push({ key: 'hsts', name: 'HSTS', status: hstsStrong ? 'pass' : 'warn', detail: 'max-age=' + (hstsMax || '?') });
      if (!hstsStrong) issues.push('hsts_weak');
    } else {
      checks.push({ key: 'hsts', name: 'HSTS', status: 'fail', detail: '' });
      issues.push('hsts_missing');
    }
    if (csp) {
      const unsafe = /unsafe-inline/i.test(csp);
      score += unsafe ? 18 : 25;
      checks.push({ key: 'csp', name: 'CSP', status: unsafe ? 'warn' : 'pass', detail: unsafe ? 'unsafe-inline' : '' });
      if (unsafe) issues.push('csp_unsafe');
    } else {
      checks.push({ key: 'csp', name: 'CSP', status: 'fail', detail: '' });
      issues.push('csp_missing');
    }
    if (xfo) {
      score += 15;
      checks.push({ key: 'xfo', name: 'X-Frame-Options', status: 'pass', detail: String(xfo).slice(0, 30) });
    } else if (csp && /frame-ancestors/i.test(csp)) {
      score += 15;
      checks.push({ key: 'xfo', name: 'X-Frame-Options', status: 'pass', detail: 'frame-ancestors' });
    } else {
      checks.push({ key: 'xfo', name: 'X-Frame-Options', status: 'fail', detail: '' });
      issues.push('xfo_missing');
    }
    if (xcto && /nosniff/i.test(xcto)) {
      score += 15;
      checks.push({ key: 'xcto', name: 'X-Content-Type-Options', status: 'pass', detail: 'nosniff' });
    } else {
      checks.push({ key: 'xcto', name: 'X-Content-Type-Options', status: 'fail', detail: '' });
      issues.push('xcto_missing');
    }
    if (refpol) {
      score += 10;
      checks.push({ key: 'refpol', name: 'Referrer-Policy', status: 'pass', detail: String(refpol).slice(0, 30) });
    } else {
      checks.push({ key: 'refpol', name: 'Referrer-Policy', status: 'fail', detail: '' });
      issues.push('refpol_missing');
    }
    if (permpol) {
      score += 5;
      checks.push({ key: 'permpol', name: 'Permissions-Policy', status: 'pass', detail: '' });
    } else {
      checks.push({ key: 'permpol', name: 'Permissions-Policy', status: 'warn', detail: '' });
    }
    if (coop) {
      score += 5;
      checks.push({ key: 'coop', name: 'COOP', status: 'pass', detail: '' });
    } else {
      checks.push({ key: 'coop', name: 'COOP', status: 'warn', detail: '' });
    }
    if (server && /[0-9]/.test(server)) {
      checks.push({ key: 'server', name: 'Server', status: 'warn', detail: String(server).slice(0, 30) });
      issues.push('server_leak');
    } else {
      score += 5;
      checks.push({ key: 'server', name: 'Server', status: 'pass', detail: '' });
    }
    if (current.indexOf('https:') !== 0) {
      issues.push('no_https');
      score = Math.min(score, 40);
    }
    // 可选证书检查（?cert=1）：1 次出站到 crt.sh；失败/不可用时静默跳过，不影响其余评分
    let cert = null;
    if (url.searchParams.get('cert') === '1') {
      let finalHost = parsed.hostname;
      try { finalHost = new URL(current).hostname; } catch (e) {}
      cert = await fetchCertInfo(finalHost);
      if (cert) {
        let certStatus = 'pass';
        if (cert.daysLeft < 0) {
          certStatus = 'fail';
          issues.push('cert_expired');
          score = Math.max(0, score - 10);
        } else if (cert.daysLeft <= 14) {
          certStatus = 'warn';
          issues.push('cert_expiring');
          score = Math.max(0, score - 5);
        }
        checks.push({ key: 'cert', name: 'Certificate', status: certStatus, detail: cert.daysLeft + 'd' });
      }
    }
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const auditData = {
      finalUrl: current,
      status: resp.status,
      ttfb,
      totalTime: Date.now() - auditStart,
      redirectCount,
      score: score,
      grade: grade,
      issues: issues.slice(0, 12),
      checks: checks,
      cert: cert,
      headers: {
        hsts: hsts,
        csp: csp,
        xfo: xfo,
        xcto: xcto,
        refpol: refpol,
        permpol: permpol,
        coop: coop,
        server: server,
        contentType: rh.get('content-type') || null
      }
    };
    return new Response(JSON.stringify(auditData), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ==================== WebSocket 测试端点 ====================
  if (url.pathname === '/ws-test') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('需要 WebSocket 升级', { status: 426, headers: { 'content-type': 'text/plain;charset=UTF-8', ...SECURITY_HEADERS } });
    }
    
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    server.accept();
    
    let pingInterval;
    let heartbeatInterval;
    let maxLifetimeTimeout;
    let isAlive = true;
    let closed = false;
    
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (maxLifetimeTimeout) {
        clearTimeout(maxLifetimeTimeout);
        maxLifetimeTimeout = null;
      }
    };
    
    const startHeartbeat = () => {
      pingInterval = setInterval(() => {
        if (closed || server.readyState !== 1) {
          cleanup();
          return;
        }
        try {
          server.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (e) {
          cleanup();
        }
      }, 30000);
      
      heartbeatInterval = setInterval(() => {
        if (closed) {
          cleanup();
          return;
        }
        if (!isAlive && server.readyState === 1) {
          try {
            server.close(1011, '心跳超时');
          } catch (e) {}
          cleanup();
        }
        isAlive = false;
      }, 35000);
    };
    
    server.addEventListener('message', event => {
      if (closed) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 4096) {
          server.close(1009, 'Message too large');
          cleanup();
          return;
        }
        const data = JSON.parse(event.data);
        if (data.type === 'ping') {
          isAlive = true;
          if (server.readyState === 1) {
            server.send(JSON.stringify({ 
              type: 'pong', 
              timestamp: Date.now(),
              echoTime: data.timestamp
            }));
          }
        } else if (data.type === 'pong') {
          isAlive = true;
        } else if (data.type === 'close') {
          server.close(1000, 'Client requested close');
          cleanup();
        }
      } catch (e) {
        if (server.readyState === 1) {
          server.send(JSON.stringify({ type: 'error', message: '无效消息格式' }));
        }
      }
    });
    
    server.addEventListener('close', () => {
      cleanup();
    });
    
    server.addEventListener('error', () => {
      cleanup();
    });
    
    startHeartbeat();
    maxLifetimeTimeout = setTimeout(() => {
      if (server.readyState === 1) {
        try { server.close(1000, 'Max test duration reached'); } catch (e) {}
      }
      cleanup();
    }, 300000);
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  // ==================== HTTP/2 + Early Hints 检测端点 ====================
  if (url.pathname === '/http2-test') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const cf = request.cf || {};
    const protocol = cf.httpProtocol || 'N/A';
    const isHttp2 = protocol.includes('HTTP/2');
    const isHttp3 = protocol.toUpperCase().includes('HTTP/3');
    
    let tlsProtocol = 'N/A';
    if (cf.tlsVersion) {
      tlsProtocol = cf.tlsVersion;
    }
    
    return new Response(JSON.stringify({
      http2: isHttp2,
      http3: isHttp3,
      protocol: protocol,
      tlsVersion: tlsProtocol,
      // Workers 无法主动发送 103 Early Hints，该能力未实现；此前依赖浏览器自发携带
      // Accept-Early-Hints 头（几乎恒为 null），字段无意义，现固定为 false
      earlyHints: false,
      supportsEarlyHints: false,
      alpn: cf.tlsClientAlpn || 'N/A'
    }), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 多文件并发下载测试 ====================
  if (url.pathname === '/concurrent-test') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const count = clampInt(url.searchParams.get('count'), 4, 1, 16);
    const size = clampInt(url.searchParams.get('size'), 1024, 1, 65536);
    
    const limit = pLimit(4);
    const promises = [];
    
    for (let i = 0; i < count; i++) {
      promises.push(
        limit(async () => {
          const start = Date.now();
          const data = fillRandom(new Uint8Array(size));
          await new Promise(resolve => setTimeout(resolve, 0));
          return {
            index: i,
            size: size,
            duration: Date.now() - start
          };
        })
      );
    }
    
    const results = await Promise.all(promises);
    return new Response(JSON.stringify(results), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 大文件流式传输测试 ====================
  if (url.pathname === '/stream-test') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    if (isRateLimited(clientIp, LARGE_DL_MAX, 60000, largeDlRateLimit)) {
      return new Response(JSON.stringify({ error: 'Too Many Requests', message: '请稍后再试 / Please try again later' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const size = clampInt(url.searchParams.get('size'), 1048576, 1, 5242880);
    const chunkSize = 65536;
    let sent = 0;
    
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= size) {
          controller.close();
          return;
        }
        const remaining = size - sent;
        const currentChunk = Math.min(remaining, chunkSize);
        controller.enqueue(fillRandom(new Uint8Array(currentChunk)));
        sent += currentChunk;
      }
    });
    
    return new Response(stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': size.toString(),
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 测速历史记录 (POST) ====================
  if (url.pathname === '/api/log-speed' && request.method === 'POST') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    try {
      // 有 Content-Length 时快速拒绝；缺失/非法长度（chunked、HTTP/2）改为流式限长读取，避免误拒合法客户端
      const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10);
      if (Number.isFinite(contentLength) && (contentLength < 0 || contentLength > 10240)) {
        return new Response(JSON.stringify({ ok: false, error: 'payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
        });
      }
      const rawText = await readTextCapped(request, 10240);
      if (!rawText) {
        return new Response(JSON.stringify({ ok: false, error: 'payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
        });
      }
      const body = JSON.parse(rawText);
      const avgSpeed = Math.min(Math.max(safeNumber(body.avgSpeed, 0), 0), 100000);
      const results = Array.isArray(body.results) ? body.results.slice(0, 10).map(item => ({
        sizeKB: Math.min(Math.max(safeNumber(item?.sizeKB, 0), 0), 10485760),
        speed: Math.min(Math.max(safeNumber(item?.speed, 0), 0), 100000)
      })) : [];
      const record = {
        timestamp: Date.now(),
        avgSpeed,
        results,
        colo: (request.cf || {}).colo || 'N/A',
        asn: (request.cf || {}).asn || 'N/A'
      };
      
      if (SPEED_HISTORY_KV_ENABLED && typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
        // ===== KV 防爆：单键环形缓冲写入 =====
        // 写入限制：按 IP 15s 节流 + 单 isolate 全局 30 次/分 + 功能默认关闭；
        // 每次落盘仅 1 get + 1 put，无 list/delete（旧实现见常量区注释）。
        const nowTs = Date.now();
        const lastLog = speedLogThrottle.get(clientIp) || 0;
        if (nowTs - lastLog >= SPEED_LOG_MIN_INTERVAL_MS) {
          speedLogThrottle.set(clientIp, nowTs);
          if (speedLogThrottle.size > 5000) speedLogThrottle.clear();
          if (isSpeedLogGloballyAllowed()) {
            try {
              const raw = await SPEED_HISTORY.get('speed:history');
              let arr = raw ? JSON.parse(raw) : [];
              if (!Array.isArray(arr)) arr = [];
              arr.unshift(record);
              if (arr.length > SPEED_HISTORY_MAX) arr = arr.slice(0, SPEED_HISTORY_MAX);
              const speedWrote = await kvPut(SPEED_HISTORY, 'speed:history', JSON.stringify(arr), { expirationTtl: 86400 * 7 });
              if (speedWrote) invalidateStatsCache();
            } catch (e) {
              // 落盘失败直接忽略：测速历史非关键路径，不做重试（避免失败重试放大写入）
            }
          }
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid data' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
      });
    }
  }
  
  // ==================== 测速历史查询 (GET) ====================
  if (url.pathname === '/api/speed-history') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const limit = clampInt(url.searchParams.get('limit'), 10, 1, 20);
    let records = getStatsCache('speed:' + limit);
    if (!records) {
      records = [];
      if (SPEED_HISTORY_KV_ENABLED && typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
        // KV 防爆：单键读取（speed:history）。旧实现为 list + 逐键 get（均按量计费）；
        // 现在每次查询仅 1 次 get，且结果被 statsCache 缓存 60s，读量恒定不随记录数增长
        try {
          const raw = await SPEED_HISTORY.get('speed:history');
          const arr = raw ? JSON.parse(raw) : [];
          if (Array.isArray(arr)) {
            records = arr
              .filter(r => r && typeof r === 'object')
              .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
              .slice(0, limit);
          }
        } catch (e) {}
      }
      setStatsCache('speed:' + limit, records);
    }
    
    return new Response(JSON.stringify(records.slice(0, limit)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== 用量统计 (GET) ====================
  if (url.pathname === '/api/usage-stats') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    let stats;
    if (USAGE_BACKEND === 'memory') {
      stats = liveUsage;
    } else {
      stats = getStatsCache('usage');
      if (!stats) {
        stats = { totalRequests: 0, endpoints: {}, lastReset: 0 };
        if (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
          try {
            const raw = await SPEED_HISTORY.get('usage:stats');
            if (raw) stats = JSON.parse(raw);
          } catch (e) {}
        }
        setStatsCache('usage', stats);
      }
    }
    
    return new Response(JSON.stringify(stats), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== IP 欺诈评分端点 ====================
  if (url.pathname === '/api/ip-fraud') {
    if (!(await isSameOriginNavigation(request))) return forbiddenResponse(request);
    const ip = clientIp;
    const fraudData = await getIpFraudScore(ip);
    if (!fraudData) {
      return new Response(JSON.stringify({ error: '无法获取风险数据' }), {
        status: 503,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    return new Response(JSON.stringify(fraudData), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders(request),
        ...SECURITY_HEADERS
      }
    });
  }
  
  // 未匹配的 /api/* 返回 404 JSON（旧行为会落到主页面返回 200 HTML，误导 API 调用方）
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ==================== 管理面板（/admin） ====================
  if (url.pathname === '/admin') return await renderAdminPage(siteCfg, url);

  return renderMainPage(request, url, siteCfg, clientIp, workerStart);
}

// ==================== 管理面板（/admin，只读概览；需 x-admin-key） ====================
async function renderAdminPage(siteCfg, url) {
  const nonce = crypto.randomUUID();
  const token = await issuePageToken();
  const csp = "default-src 'self'; script-src 'self' 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(siteCfg.siteName) + ' · Admin</title>' +
    '<style>' +
    ':root{--bg:#0a0b0d;--card:#101114;--line:#24262b;--text:#e9eaec;--muted:#9a9da3;--accent:#9aa0a8;--ok:#a7b6a9;--warn:#c8b07a;--bad:#c98a8a}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.6 system-ui,-apple-system,sans-serif;padding:28px}' +
    '.wrap{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}' +
    '.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}' +
    'input{background:var(--card);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:6px;font:inherit;min-width:260px}' +
    'button{background:var(--card);border:1px solid var(--line);color:var(--text);padding:8px 16px;border-radius:6px;cursor:pointer;font:inherit}' +
    'button:hover{border-color:#383b42}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0}' +
    '.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}.k{font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted)}' +
    '.v{font-size:18px;font-weight:600;font-family:ui-monospace,monospace;margin-top:4px;word-break:break-all}' +
    '.row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #1d1f24;font-size:12px}.row:last-child{border:0}' +
    '.muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}' +
    'pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:320px;font-size:11.5px}' +
    'a{color:var(--accent)}' +
    '</style></head><body><div class="wrap">' +
    '<h1>' + escapeHtml(siteCfg.siteName) + ' · Admin</h1>' +
    '<p class="sub">只读概览：监控配置/状态/日志、用量、KV 预算、可观测性指标。修改监控请回主页面「站点监控」工具。</p>' +
    '<div class="bar"><input id="key" type="password" placeholder="Admin key (x-admin-key)" autocomplete="off">' +
    '<button id="load">Load</button><button id="refresh">Refresh</button><a href="/">← Back</a></div>' +
    '<div id="out" class="muted">Enter the admin key and click Load.</div>' +
    '</div><script nonce="' + nonce + '">' +
    'window.__ADMIN_TOKEN__=' + JSON.stringify(token) + ';' +
    'var out=document.getElementById("out"),keyEl=document.getElementById("key");' +
    'try{var saved=sessionStorage.getItem("netsight-admin-key")||"";if(saved)keyEl.value=saved;}catch(e){}' +
    'function esc(v){return String(v===undefined||v===null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function card(k,v){return "<div class=\\"card\\"><div class=\\"k\\">"+esc(k)+"</div><div class=\\"v\\">"+esc(v)+"</div></div>";}' +
    'function row(k,v,cls){return "<div class=\\"row\\"><span>"+esc(k)+"</span><span class=\\""+(cls||"")+"\\">"+esc(v)+"</span></div>";}' +
    'function load(){var key=keyEl.value.trim();if(!key){out.textContent="Admin key required.";return;}try{sessionStorage.setItem("netsight-admin-key",key);}catch(e){}' +
    'out.textContent="Loading...";fetch("/api/admin/overview",{headers:{"x-admin-key":key,"x-ns-token":window.__ADMIN_TOKEN__},cache:"no-store"}).then(function(r){return r.json().then(function(d){return {s:r.status,d:d};});}).then(function(x){' +
    'if(x.s!==200){out.textContent=(x.d&&x.d.error)||("HTTP "+x.s);return;}var d=x.d;' +
    'var h="<div class=\\"grid\\">"+card("Version",d.version)+card("Site",d.site&&d.site.siteName)+card("Uptime (s)",Math.round((d.obs&&d.obs.uptimeMs||0)/1000))+card("Requests",d.usage&&d.usage.totalRequests)+card("403",d.obs&&d.obs.status403)+card("429",d.obs&&d.obs.status429)+"</div>";' +
    'h+="<h3>KV / 预算</h3><div class=\\"card\\">"+row("Writes today",d.kvWrite&&d.kvWrite.today)+row("Blocked",d.kvWrite&&d.kvWrite.blocked)+row("Failed",d.kvWrite&&d.kvWrite.failed)+row("Budget/day",d.kvWrite&&d.kvWrite.budgetPerDay)+row("Budget/min",d.kvWrite&&d.kvWrite.budgetPerMin)+"</div>";' +
    'h+="<h3>Monitor</h3><div class=\\"card\\">"+(d.config?"":"<div class=\\"muted\\">No config</div>");' +
    'if(d.config&&d.config.urls){d.config.urls.forEach(function(u){var url=(u&&typeof u==="object")?u.url:u;var label=(u&&typeof u==="object"&&u.label)?u.label:"";var s=(d.state||{})[url]||{};var cls=s.status==="up"?"ok":(s.status==="down"?"bad":"");h+=row((label?label+" · ":"")+url,(s.status||"unknown")+(s.certDays!==undefined&&s.certDays!==null?" · cert "+s.certDays+"d":""),cls);});}' +
    'h+="</div>";' +
    'var log=(d.log||[]).slice(0,10).map(function(e){return "<div class=\\"row\\"><span>"+esc(new Date(e.t).toLocaleString())+"</span><span>"+esc(e.text)+"</span></div>";}).join("");' +
    'h+="<h3>Recent events</h3><div class=\\"card\\">"+(log||"<div class=\\"muted\\">No events</div>")+"</div>";' +
    'h+="<h3>Config JSON</h3><pre>"+esc(JSON.stringify(d.config||null,null,2))+"</pre>";' +
    'out.className="";out.innerHTML=h;}).catch(function(e){out.textContent="Load failed: "+e;});}' +
    'document.getElementById("load").addEventListener("click",load);' +
    'document.getElementById("refresh").addEventListener("click",load);' +
    'keyEl.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();load();}});' +
    'if(keyEl.value){load();}' +
    '</script></body></html>';
  return new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-security-policy': csp,
      'set-cookie': '__ns_t=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600' + (url.protocol === 'https:' ? '; Secure' : ''),
      ...SECURITY_HEADERS
    }
  });
}

// ==================== 主诊断页面渲染（从 handleRequest 拆出） ====================
async function renderMainPage(request, url, siteCfg, clientIp, workerStart) {
  // ==================== 主诊断页面 ====================
  const cf = request.cf || {};
  
  const lat = safeNumber(cf.latitude, 0);
  const lon = safeNumber(cf.longitude, 0);
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  
  const data = {
    colo: escapeForJS(cf.colo || 'NRT'),
    asn: escapeForJS(cf.asn || 'N/A'),
    asOrg: escapeForJS(cf.asOrganization || '未知运营商'),
    city: escapeForJS(cf.city || '未知'),
    country: escapeForJS(cf.country || '未知'),
    region: escapeForJS(cf.region || '未知'),
    lat: Math.abs(lat).toFixed(4),
    lon: Math.abs(lon).toFixed(4),
    latDir: escapeForJS(latDir),
    lonDir: escapeForJS(lonDir),
    rayId: escapeForJS(request.headers.get('cf-ray') || 'N/A'),
    proto: escapeForJS(cf.httpProtocol || 'N/A'),
    tlsVersion: escapeForJS(cf.tlsVersion || 'N/A'),
    tlsCipher: escapeForJS(cf.tlsCipher || 'N/A'),
    botScore: cf.botManagement?.score ?? 100,
    clientIp: escapeForJS(clientIp),
    httpProtocolRaw: escapeForJS(cf.httpProtocol || 'N/A'),
    latNum: lat,
    lonNum: lon,
    tlsClientHelloLength: safeNumber(cf.tlsClientHelloLength, 0),
    httpVersion: request.cf?.httpProtocol || 'N/A',
    tlsClientAuth: cf.tlsClientAuth?.certPresent ? 'YES' : 'NO',
    requestPriority: request.headers.get('priority') || 'N/A',
    tlsClientJa3: escapeForJS(cf.tlsClientJa3 || 'N/A'),
    tlsClientJa4: escapeForJS(cf.tlsClientJa4 || 'N/A')
  };

  // HTML 上下文专用的转义值（防止注入，与 JS 上下文的 data 区分开）
  const h = {
    colo: escapeHtml(cf.colo || 'NRT'),
    asn: escapeHtml(cf.asn || 'N/A'),
    asOrg: escapeHtml(cf.asOrganization || '未知运营商'),
    city: escapeHtml(cf.city || '未知'),
    country: escapeHtml(cf.country || '未知'),
    region: escapeHtml(cf.region || '未知'),
    lat: Math.abs(lat).toFixed(4),
    lon: Math.abs(lon).toFixed(4),
    latDir: escapeHtml(latDir),
    lonDir: escapeHtml(lonDir),
    rayId: escapeHtml(request.headers.get('cf-ray') || 'N/A'),
    proto: escapeHtml(cf.httpProtocol || 'N/A'),
    tlsVersion: escapeHtml(cf.tlsVersion || 'N/A'),
    tlsCipher: escapeHtml(cf.tlsCipher || 'N/A'),
    clientIp: escapeHtml(clientIp),
    tlsClientJa3: escapeHtml(cf.tlsClientJa3 || 'N/A'),
    tlsClientJa4: escapeHtml(cf.tlsClientJa4 || 'N/A'),
    siteName: escapeHtml(siteCfg.siteName)
  };
  
  const defaultLang = siteCfg.defaultLang || resolveDefaultLang(request.headers.get('accept-language') || '');
  const PAGE_TITLES = {
    'en': 'NetSight Pro | Network Diagnostics',
    'zh-CN': 'NetSight Pro | 极光网络诊断',
    'zh-TW': 'NetSight Pro | 極光網路診斷',
    'ja': 'NetSight Pro | ネットワーク診断',
    'ko': 'NetSight Pro | 네트워크 진단',
    'es': 'NetSight Pro | Diagnóstico de red'
  };
  const pageTitle = (PAGE_TITLES[defaultLang] || PAGE_TITLES.en).split('NetSight Pro').join(siteCfg.siteName);
  
  const workerDuration = Date.now() - workerStart;
  
  // 客户端地理位置：直接使用 Cloudflare request.cf 数据（零出站请求；字段缺失时前端自动回退 ipapi.co）
  const realGeoJS = {
    city: String(cf.city || ''),
    region: String(cf.region || ''),
    country: String(cf.country || ''),
    countryCode: String(cf.country || ''),
    lat: safeNumber(cf.latitude, 0),
    lon: safeNumber(cf.longitude, 0),
    org: String(cf.asOrganization || ''),
    ip: (clientIp && clientIp !== 'unknown') ? String(clientIp) : ''
  };
  
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  const supportsBrotli = acceptEncoding.includes('br');
  const compressionInfo = {
    brotli: supportsBrotli,
    gzip: acceptEncoding.includes('gzip'),
    deflate: acceptEncoding.includes('deflate'),
    zstd: acceptEncoding.includes('zstd')
  };
  
  // 生成随机 nonce 用于 CSP
  const nonce = crypto.randomUUID();
  // 页面会话令牌：颁发给本次页面加载，API 端点凭此放行（防伪造 Origin/Referer 的脚本与爬虫）
  const pageToken = await issuePageToken();
  // connect-src 保留 'https:' 的取舍：多节点测速需由浏览器直连用户输入的任意节点 URL；
  // 站点可达性/流媒体探测走 img-src 白名单（不受 connect-src 影响）。如需收紧可改为具体域名列表。
  const cspHeader = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' https:; img-src 'self' data: https://cloudflare.com https://www.google.com https://github.com https://www.netflix.com https://www.disneyplus.com https://www.youtube.com https://chat.openai.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';`;

  // ============================================================
  // 开始 HTML 模板（全界面国际化 + 美化）
  // ============================================================
  const html = `<!DOCTYPE html>
<html lang="${defaultLang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="apple-touch-icon" href="/icon-192.png">
    <meta name="theme-color" content="#0a0b0d">
    <meta name="color-scheme" content="dark light">
    <script nonce="${nonce}">
        // 首屏主题：在外部 app.js 加载前应用，避免浅色主题闪烁
        (function () {
            try {
                var saved = localStorage.getItem('theme') || 'auto';
                var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (saved === 'light' || (saved === 'auto' && !prefersDark)) {
                    document.documentElement.setAttribute('data-theme', 'light');
                }
            } catch (e) {}
        })();
    </script>
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="NetSight Pro">
    <title>${pageTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link rel="dns-prefetch" href="https://api4.ipify.org">
    <link rel="dns-prefetch" href="https://ipv4.icanhazip.com">
    <link rel="dns-prefetch" href="https://api6.ipify.org">
    <link rel="dns-prefetch" href="https://ipv6.icanhazip.com">
    <!-- Google Fonts 改为非阻塞加载（由内联脚本注入；不可达时自动回退系统字体） -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="/app.css?v=${ASSET_VER}">
</head>
<body>
    <div class="bg-orbs"></div>
    <div class="container">
        <!-- ==================== 头部 ==================== -->
        <div class="header">
            <div class="logo">
                <div class="logo-icon"><i class="fas fa-network-wired"></i></div>
                <div>
                    <h1>${h.siteName}</h1>
                    <p><i class="fas fa-bolt"></i> <span id="t-subtitle">极光诊断 · 实时网络分析</span></p>
                </div>
            </div>
            <div class="header-right">
                <button class="theme-toggle" id="themeToggle" title="切换主题" aria-label="切换主题"><i class="fas fa-moon"></i></button>
                <div class="lang-switcher">
                    <button class="lang-btn" data-lang="en">EN</button>
                    <button class="lang-btn" data-lang="zh-CN">简体</button>
                    <button class="lang-btn" data-lang="zh-TW">繁體</button>
                    <button class="lang-btn" data-lang="ja">日本語</button>
                    <button class="lang-btn" data-lang="ko">한국어</button>
                    <button class="lang-btn" data-lang="es">Español</button>
                </div>
            </div>
        </div>

        <!-- ==================== 标签导航 ==================== -->
        <div class="tab-nav" role="tablist" aria-label="Sections">
            <button class="tab-btn active" data-tab="overview"><i class="fas fa-gauge-high"></i> <span id="tab-overview">概览</span></button>
            <button class="tab-btn" data-tab="network"><i class="fas fa-network-wired"></i> <span id="tab-network">网络信息</span></button>
            <button class="tab-btn" data-tab="tools"><i class="fas fa-flask"></i> <span id="tab-tools">诊断工具</span></button>
            <button class="tab-btn" data-tab="history"><i class="fas fa-clock-rotate-left"></i> <span id="tab-history">历史统计</span></button>
        </div>

        <div class="tab-panel active" id="panel-overview">
        <!-- ==================== Hero 卡片 ==================== -->
        <div class="hero-card">
            <div class="ip-row">
                <span class="ip-label"><i class="fas fa-globe"></i> IPv4</span>
                <span id="v4" class="ip-val" data-pending="1">检测中...</span>
            </div>
            <div class="ip-row">
                <span class="ip-label"><i class="fas fa-globe"></i> IPv6</span>
                <span id="v6" class="ip-val ip-val-small" data-pending="1">检测中...</span>
            </div>
            <div class="stats-row">
                <div class="stat-item"><i class="fas fa-map-marker-alt"></i> <span id="t-edge-label">边缘节点</span>: <strong id="colo-display">${h.colo}</strong></div>
                <div class="stat-item"><i class="far fa-clock"></i> <span id="t-worker-label">Worker 耗时</span>: <strong>${workerDuration}ms</strong></div>
                <div class="stat-item"><span class="live-dot"></span> <span id="t-live">实时监控中</span></div>
            </div>
        </div>

        <!-- ==================== RTT 监控卡片 ==================== -->
        <div class="card rtt-card">
            <div class="card-header">
                <i class="fas fa-wave-square"></i>
                <div>
                    <h3 id="t-rtt">实时延迟监控</h3>
                    <p><span id="t-rtt-sub">RTT · 抖动 · 实时图表 · 网络质量评估</span></p>
                </div>
            </div>
            <div class="card-body">
                <div class="rtt-display">
                    <div class="rtt-box">
                        <div class="rtt-value" id="rtt-num" aria-live="polite">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-right"></i> <span id="t-rtt-current">当前 RTT</span> (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="jitter-val">--</div>
                        <div class="rtt-label"><i class="fas fa-chart-line"></i> <span id="t-jitter">抖动</span> (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="min-rtt">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-down"></i> <span id="t-rtt-min">最低 RTT</span> (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="max-rtt">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-up"></i> <span id="t-rtt-max">最高 RTT</span> (ms)</div>
                    </div>
                </div>
                <div class="chart-container"><canvas id="chart"></canvas></div>
                <div class="quality-grid">
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-signal"></i> <span id="t-quality">连接质量</span></span>
                        <span class="quality-value" id="quality-badge" style="color: var(--chart-green);">--</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-chart-simple"></i> <span id="t-stability">网络稳定性</span></span>
                        <span class="quality-value" id="stability-badge" style="color: var(--chart-teal);">--</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-chart-bar"></i> <span id="t-samples">样本数量</span></span>
                        <span class="quality-value" id="sample-count" style="font-family: monospace;">0</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-exchange-alt"></i> <span id="t-loss">丢包率</span></span>
                        <span class="quality-value" id="loss-rate" style="color: var(--chart-green);" aria-live="polite">0%</span>
                    </div>
                </div>
            </div>
        </div>

        </div>

        <div class="tab-panel" id="panel-network">
        <!-- ==================== 安全与协议（全宽双列） ==================== -->
        <div class="card" style="margin-bottom:20px;">
            <div class="card-header">
                <i class="fas fa-shield-halved"></i>
                <div>
                    <h3 id="t-sec">安全与协议</h3>
                    <p><span id="t-sec-sub">TLS · 加密 · 身份验证</span></p>
                </div>
            </div>
            <div class="card-body">
                <div class="info-section-label" id="t-sec-group-transport">传输与协议</div>
                <div class="info-grid">
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-exchange-alt"></i> <span id="t-proto-label">协议</span></span>
                        <span class="info-value" id="proto-val">${h.proto}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-lock"></i> <span id="t-tls-version">TLS 版本</span></span>
                        <span class="info-value"><span class="badge badge-info">${h.tlsVersion}</span></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-key"></i> <span id="t-cipher">加密套件</span></span>
                        <span class="info-value" style="font-size:11px;font-family:var(--font-mono);">${h.tlsCipher}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-eye"></i> ECH</span>
                        <span class="info-value" id="ech-val">---</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-compress-alt"></i> <span id="t-compress-label">压缩算法</span></span>
                        <span class="info-value" id="compress-val">---</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-rocket"></i> <span id="t-http2-label">HTTP/2 状态</span></span>
                        <span class="info-value" id="http2-val">--</span>
                    </div>
                </div>
                <div class="info-section-label" id="t-sec-group-origin">来源与指纹</div>
                <div class="info-grid">
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-server"></i> <span id="t-dc-label">数据中心代理</span></span>
                        <span class="info-value" id="s-dc">---</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-chart-simple"></i> <span id="t-risk">风险等级</span></span>
                        <span class="info-value" id="s-risk">---</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-network-wired"></i> <span id="t-asn">ASN</span></span>
                        <span class="info-value">${h.asn}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-robot"></i> <span id="t-bot-label">机器人评分</span></span>
                        <span class="info-value" id="bot-score-val">${data.botScore}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-fingerprint"></i> JA3</span>
                        <span class="info-value" style="font-size:10px;word-break:break-all;">${h.tlsClientJa3}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-fingerprint"></i> JA4</span>
                        <span class="info-value" style="font-size:10px;word-break:break-all;">${h.tlsClientJa4}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ==================== 位置信息（并排双栏） ==================== -->
        <div class="grid-2col">
            <!-- 边缘节点位置 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-map-pin"></i>
                    <div>
                        <h3 id="t-geo">边缘节点位置</h3>
                        <p><span id="t-geo-sub">Cloudflare 数据中心</span></p>
                    </div>
                </div>
                <div class="card-body">
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-location-dot"></i> <span id="t-geo-location">位置</span></span>
                        <span class="info-value">${h.city}, ${h.region}, ${h.country}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-crosshairs"></i> <span id="t-geo-coord">坐标</span></span>
                        <span class="info-value">${h.lat}°${h.latDir} / ${h.lon}°${h.lonDir}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-building"></i> <span id="t-geo-org">运营商</span></span>
                        <span class="info-value" style="font-size:12px;">${h.asOrg}</span>
                    </div>
                </div>
            </div>

            <!-- 真实 IP 位置 + 欺诈评分 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-user-secret"></i>
                    <div>
                        <h3 id="t-user-geo">真实 IP 位置</h3>
                        <p><span id="t-user-geo-sub">客户端地理位置 & 风险评分</span></p>
                    </div>
                </div>
                <div class="card-body" id="user-geo-info">
                    <div style="text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i> <span id="t-geo-loading">定位中...</span></div>
                </div>
            </div>
        </div>

        <!-- ==================== 硬件信息（紧凑横条） ==================== -->
        <div class="hw-strip">
            <span class="hw-strip-label"><i class="fas fa-desktop"></i> <span id="t-hw">硬件信息</span></span>
            <div id="hw-info" class="hw-grid">--</div>
        </div>

        </div>

        <div class="tab-panel" id="panel-tools">
        <!-- ==================== 诊断工具集 ==================== -->
        <div class="card" style="margin-bottom:28px;">
            <div class="card-header">
                <i class="fas fa-flask"></i>
                <div>
                    <h3><span id="t-tools-title">诊断工具集</span></h3>
                    <p><span id="t-tools-sub">一键测试 · 全面诊断</span></p>
                </div>
            </div>
            <div class="card-body">
                <div class="tool-grid" id="toolGrid"></div>
            </div>
        </div>

        </div>

        <div class="tab-panel" id="panel-history">
        <!-- ==================== 历史与统计 ==================== -->
        <div class="stats-grid">
            <div class="stats-card">
                <div class="card-header">
                    <i class="fas fa-chart-line"></i>
                    <div>
                        <h3><span id="t-history-title">测试历史（本地）</span></h3>
                        <p><span id="t-history-sub">最近 20 条记录 · 仅保存在本机浏览器</span></p>
                    </div>
                </div>
                <div class="card-body" id="speed-history-panel">
                    <div class="no-data"><i class="fas fa-inbox"></i> <span id="t-no-records">暂无测速记录</span></div>
                </div>
            </div>
            <div class="stats-card">
                <div class="card-header">
                    <i class="fas fa-chart-bar"></i>
                    <div>
                        <h3><span id="t-usage-title">用量统计</span></h3>
                        <p><span id="t-usage-sub">API 端点调用统计</span></p>
                    </div>
                </div>
                <div class="card-body" id="usage-stats-panel">
                    <div class="no-data"><i class="fas fa-spinner fa-spin"></i> <span id="t-loading-stats">加载中...</span></div>
                </div>
            </div>
        </div>

        </div>

        <!-- ==================== 底部 ==================== -->
        <div class="footer">
            <span><i class="fas fa-fingerprint"></i> RAY ID: <span style="font-family:monospace;">${h.rayId}</span></span>
            <span><i class="fas fa-ethernet"></i> <span id="t-client-label">客户端</span>: ${h.clientIp}</span>
            <span class="copy-btn" id="copy-report" role="button" tabindex="0"><i class="fas fa-copy"></i> <span id="t-copy">复制报告</span></span>
            <span class="copy-btn" id="share-report" role="button" tabindex="0"><i class="fas fa-share-nodes"></i> <span id="t-share">分享</span></span>
        </div>

        <div class="driver-badge">
            <i class="fas fa-bolt"></i>
            <span id="t-powered">由</span>
            <a href="https://github.com/BlueDriftHK/CF-workers-netdiag" target="_blank" rel="noopener noreferrer">CF-workers-netdiag</a>
            <span style="color:var(--text-quaternary);">·</span>
            <span style="color:var(--text-quaternary);"><span id="t-driven">强力驱动</span></span>
            <i class="fas fa-rocket"></i>
        </div>
    </div>

    <!-- ====== 多节点对比对话框 ====== -->
    <div class="modal-overlay" id="nodeModal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-box">
            <h3><i class="fas fa-globe-asia"></i> <span id="modal-title">多节点对比</span></h3>
            <p id="modal-desc">输入其他 Worker 节点的完整 URL（每行一个），将并行测试延迟。</p>
            <textarea id="nodeUrls" placeholder="https://node1.example.com&#10;https://node2.example.com"></textarea>
            <div class="btn-group">
                <button class="btn btn-outline" id="modalCancel"><span id="modal-cancel">取消</span></button>
                <button class="btn btn-primary" id="modalStart"><span id="modal-start">开始测试</span></button>
            </div>
        </div>
    </div>

    <!-- ====== 工具结果弹层（宽屏两栏：左参数 / 右结果） ====== -->
    <div class="modal-overlay" id="toolModal" role="dialog" aria-modal="true" aria-labelledby="toolModalTitle">
        <div class="modal-box tool-modal-box">
            <div class="tool-modal-head">
                <div>
                    <h3 id="toolModalTitle">—</h3>
                    <p id="toolModalDesc"></p>
                </div>
                <div class="tool-modal-actions">
                    <button class="tool-rerun" id="toolModalRerun"><i class="fas fa-rotate-right"></i> <span id="toolModalRerunLabel">重新运行</span></button>
                    <button class="tool-close" id="toolModalClose" aria-label="close"><i class="fas fa-xmark"></i></button>
                </div>
            </div>
            <div class="tool-modal-main">
                <aside class="tool-modal-side" id="toolModalSide">
                    <p class="side-desc" id="toolModalSideDesc"></p>
                    <div class="side-params" id="toolModalParams"></div>
                    <div class="side-actions" id="toolModalSideActions"></div>
                </aside>
                <div class="tool-modal-body" id="toolModalBody"></div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        window.__BACKEND__ = {
                asOrg: "${data.asOrg}", asn: "${data.asn}", colo: "${data.colo}",
                city: "${data.city}", region: "${data.region}", country: "${data.country}",
                lat: "${data.lat}\u00b0${data.latDir}", lon: "${data.lon}\u00b0${data.lonDir}",
                proto: "${data.proto}", tlsVersion: "${data.tlsVersion}", tlsCipher: "${data.tlsCipher}",
                botScore: "${data.botScore}", rayId: "${data.rayId}", clientIp: "${data.clientIp}",
                httpProtocolRaw: "${data.httpProtocolRaw}", latNum: ${data.latNum}, lonNum: ${data.lonNum},
                tlsClientHelloLength: ${data.tlsClientHelloLength},
                compressionBrotli: ${compressionInfo.brotli}, compressionGzip: ${compressionInfo.gzip},
                realGeoCity: "${escapeForJS(realGeoJS.city)}", realGeoRegion: "${escapeForJS(realGeoJS.region)}",
                realGeoCountry: "${escapeForJS(realGeoJS.country)}", realGeoCountryCode: "${escapeForJS(realGeoJS.countryCode)}",
                realGeoLat: ${safeNumber(realGeoJS.lat, 0)}, realGeoLon: ${safeNumber(realGeoJS.lon, 0)},
                realGeoOrg: "${escapeForJS(realGeoJS.org)}", realGeoIp: "${escapeForJS(realGeoJS.ip)}",
                tlsClientJa3: "${data.tlsClientJa3}", tlsClientJa4: "${data.tlsClientJa4}"
            };
        window.__DEFAULT_LANG__ = '${defaultLang}';
        window.__PAGE_KEY__ = '${escapeForJS(pageToken)}';
        window.__NETDIAG__ = { usageBackend: '${USAGE_BACKEND}', speedHistoryKv: ${SPEED_HISTORY_KV_ENABLED} };
        window.__SITE__ = {
            siteName: '${escapeForJS(siteCfg.siteName)}',
            defaultLang: '${escapeForJS(siteCfg.defaultLang)}',
            disabledTools: ${safeJsonForScript(siteCfg.disabledTools)},
            offline: ${siteCfg.offline ? 'true' : 'false'},
            certCheck: ${siteCfg.certCheck ? 'true' : 'false'}
        };
        (function () {
            try {
                var fl = document.createElement('link');
                fl.rel = 'stylesheet';
                fl.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap';
                document.head.appendChild(fl);
            } catch (e) {}
        })();
    </script>
    <script src="/app.js?v=${ASSET_VER}"></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-security-policy': cspHeader,
      'set-cookie': '__ns_t=' + pageToken + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600' + (url.protocol === 'https:' ? '; Secure' : ''),
      ...SECURITY_HEADERS,
      'server-timing': `worker;dur=${Date.now() - workerStart}`
    }
  });
}

// ==================== PWA 离线壳（/sw.js） ====================
function renderServiceWorker(siteCfg) {
    // PWA 离线壳：预缓存带内容哈希的静态资源；导航请求网络优先、离线时回退到内置离线页；
    // API/健康检查与跨域请求一律直通，不缓存任何动态数据或令牌页面。
    const offlineHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(siteCfg.siteName) + ' · Offline</title>' +
      '<style>html,body{height:100%;margin:0;background:#0a0b0d;color:#e9eaec;font-family:system-ui,-apple-system,sans-serif}' +
      '.wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}' +
      '.dot{width:10px;height:10px;border-radius:50%;background:#c98a8a;box-shadow:0 0 0 6px rgba(201,138,138,.12)}' +
      'h1{font-size:20px;margin:0;letter-spacing:-.3px}p{color:#9a9da3;font-size:13px;max-width:420px;line-height:1.7;margin:0}' +
      'a{color:#c6cad0;font-size:13px;text-decoration:none;border:1px solid #383b42;padding:8px 18px;border-radius:6px}</style>' +
      '</head><body><div class="wrap"><div class="dot"></div><h1>' + escapeHtml(siteCfg.siteName) + '</h1>' +
      '<p>当前处于离线状态，网络诊断需要联网。恢复网络后点击下方按钮重新加载。<br>You are offline. Network diagnostics require connectivity.</p>' +
      '<a href="/">重新加载 / Reload</a></div></body></html>';
    const swSrc = [
      "var CACHE = 'netsight-shell-" + ASSET_VER + "';",
      "var SHELL = ['/app.js?v=" + ASSET_VER + "', '/app.css?v=" + ASSET_VER + "', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];",
      "var OFFLINE_HTML = " + JSON.stringify(offlineHtml) + ";",
      "self.addEventListener('install', function (e) {",
      "  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); }));",
      "});",
      "self.addEventListener('activate', function (e) {",
      "  e.waitUntil(caches.keys().then(function (keys) {",
      "    return Promise.all(keys.filter(function (k) { return k.indexOf('netshell-shell-') === 0 || (k.indexOf('netsight-shell-') === 0 && k !== CACHE); }).map(function (k) { return caches.delete(k); }));",
      "  }).then(function () { return self.clients.claim(); }));",
      "});",
      "self.addEventListener('fetch', function (e) {",
      "  var req = e.request;",
      "  if (req.method !== 'GET') return;",
      "  var u = new URL(req.url);",
      "  if (u.origin !== self.location.origin) return;",
      "  if (u.pathname === '/health' || u.pathname.indexOf('/api/') === 0 || u.pathname === '/metrics') return;",
      "  if (req.mode === 'navigate') {",
      "    e.respondWith(fetch(req).catch(function () { return new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'no-store' } }); }));",
      "    return;",
      "  }",
      "  if (u.pathname === '/app.js' || u.pathname === '/app.css' || u.pathname.indexOf('/icon-') === 0 || u.pathname === '/manifest.webmanifest') {",
      "    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));",
      "  }",
      "});"
    ].join('\n');
    return new Response(swSrc, {
      headers: { 'content-type': 'application/javascript;charset=UTF-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }
    });
}
