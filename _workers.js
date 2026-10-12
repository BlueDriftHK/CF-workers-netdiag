// ============================================================
// NetSight Pro - Apple 极简网络诊断工具
// Cloudflare Worker 完整优化版 | 全界面国际化 + 深色/浅色切换
// 版本: 4.6.0 | 新增：DNS 多解析器对比 · 网络可达性检测 · 安全响应头评分
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
    .filter(Boolean);
}

function isAllowedOrigin(request, origin) {
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    if (origin === requestOrigin) return true;
    const allowed = getConfiguredOrigins();
    return allowed.includes('*') || allowed.includes(origin);
  } catch (e) {
    return false;
  }
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

function isSameOriginNavigation(request) {
  const origin = request.headers.get('Origin');
  if (origin) return isAllowedOrigin(request, origin);
  const referer = request.headers.get('Referer');
  if (!referer) return false; // fail-closed：无 Origin 且无 Referer 时拒绝，防止非浏览器客户端绕过同源校验
  try {
    return new URL(referer).origin === new URL(request.url).origin;
  } catch (e) {
    return false;
  }
}

function forbiddenResponse(request) {
  return new Response(JSON.stringify({
    error: 'forbidden',
    message: 'Origin is not allowed'
  }), {
    status: 403,
    headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
  });
}

// 简单的限流实现（注意：Map 为 per-isolate 内存，非全局共享；高并发场景如需全局限流应使用 KV 或 Durable Object）
const rateLimit = new Map();
const healthRateLimit = new Map(); // /health 独立配额：RTT/丢包轮询频繁，避免挤占工具请求额度
const HEALTH_RATE_MAX = 180;       // /health 每 IP 每分钟上限（RTT 轮询约 30 次/分）
const largeDlRateLimit = new Map(); // 大响应下载（缓冲膨胀/长时测速）独立配额，防放大
const LARGE_DL_MAX = 30;            // 每 IP 每分钟大响应次数上限（单次最大 64MB）
const cpuRateLimit = new Map();
// 测速历史写入节流：同一客户端最小落盘间隔（限制 KV 写入）
const SPEED_LOG_MIN_INTERVAL_MS = 15000;
const speedLogThrottle = new Map();
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

function cleanupRateLimit() {
  const now = Date.now();
  let cleanedCount = 0;
  for (const store of [rateLimit, healthRateLimit, largeDlRateLimit]) {
    for (const [ip, timestamps] of store.entries()) {
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

function isRateLimited(ip, maxRequests = 60, windowMs = 60000, store = rateLimit) {
  const now = Date.now();
  const requests = store.get(ip) || [];
  const recent = requests.filter(t => now - t < windowMs);
  
  if (recent.length >= maxRequests) return true;
  
  recent.push(now);
  store.set(ip, recent);
  
  if (store.size > 10000 || (store.size > 0 && Math.random() < 0.05)) {
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

function isPrivateIp(ip) {
  const h = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return true;
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('ff')) return true;
    if (h.startsWith('2002:') || h.startsWith('2001:0')) return true;
    const m = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (m) return isPrivateIp(m[1]);
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
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (isIpLiteral(h)) return isPrivateIp(h);
  return !h.includes('.');
}

// DNS 解析缓存（per-isolate，仅用于站点体检的 SSRF 校验）
const dnsCheckCache = new Map();

// 通过 DoH(cloudflare-dns.com) 解析域名，确认所有解析结果均为公网地址；解析不到结果时按不安全处理
async function resolvesToPublicOnly(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (isIpLiteral(h)) return !isPrivateIp(h);
  if (dnsCheckCache.has(h)) return dnsCheckCache.get(h);
  const ips = [];
  for (const type of ['A', 'AAAA']) {
    try {
      const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(h) + '&type=' + type, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000)
      });
      if (!r.ok) continue;
      const j = await r.json();
      for (const ans of (j.Answer || [])) {
        if (ans.type === 1 || ans.type === 28) ips.push(ans.data);
      }
    } catch (e) {}
  }
  const safe = ips.length > 0 && ips.every(ip => !isPrivateIp(ip));
  if (dnsCheckCache.size < 500) dnsCheckCache.set(h, safe);
  return safe;
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
  event.respondWith(handleRequest(event));
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

// ==================== IP 欺诈评分函数 ====================
// 数据源: proxycheck.io（HTTPS）。原先使用明文 HTTP 的 ip-api.com，导致客户端 IP 被明文传输，已修复。
// 说明: 依据 proxy/vpn/tor/hosting 标记派生风险分（0-100）；免费额度有限，可选配置 PROXYCHECK_KEY 提升配额。
async function getIpFraudScore(ip) {
  if (!ip || ip === 'unknown') return null;
  try {
    const key = (typeof PROXYCHECK_KEY !== 'undefined' && PROXYCHECK_KEY) ? '&key=' + encodeURIComponent(PROXYCHECK_KEY) : '';
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&asn=1${key}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.status !== 'ok') return null;
    const info = data[ip] || Object.values(data).find(v => v && typeof v === 'object') || null;
    if (!info) return null;
    const type = String(info.type || '').toLowerCase();
    const proxyFlag = String(info.proxy || '').toLowerCase() === 'yes';
    const isTor = type.includes('tor');
    const isVpn = type.includes('vpn');
    const isHosting = type.includes('hosting') || type.includes('ddos') || type.includes('compromised');
    const isProxy = proxyFlag || isTor || isVpn;
    let score = 0;
    if (isTor) score += 90;
    else if (isVpn) score += 70;
    else if (proxyFlag) score += 60;
    if (isHosting) score += 30;
    score = Math.min(score, 100);
    return {
      score,
      isProxy,
      isVpn,
      isTor,
      isHosting,
      riskLevel: score >= 80 ? 'high' : (score >= 50 ? 'medium' : 'low')
    };
  } catch (e) {
    return null;
  }
}

// 允许计入用量统计的端点白名单（避免任意路径撑爆 KV）
const COUNTED_ENDPOINTS = new Set([
  '/health', '/speedtest', '/upload-test', '/cpu-test', '/dns-proxy',
  '/api/site-audit', '/ws-test', '/http2-test', '/concurrent-test', '/stream-test',
  '/api/log-speed', '/api/speed-history', '/api/usage-stats', '/api/ip-fraud',
  '/api/dns-lookup', '/api/dnsbl', '/api/domain-check', '/api/monitor', '/api/monitor-run'
]);

// ==================== KV 用量策略（防止 KV 额度被写爆/读爆）====================
// USAGE_BACKEND:
//   'memory'（默认）：用量统计只保留在 isolate 内存，对 KV 零写入；重启/换 isolate 后归零。
//   'kv'：聚合后落盘到 SPEED_HISTORY（跨 isolate 持久），会消耗 KV 写额度。
const USAGE_BACKEND = 'memory';
const USAGE_FLUSH_MS = 3600000;   // kv 模式下最长 1 小时落盘一次
const USAGE_MAX_PENDING = 2000;   // kv 模式下待写条数达阈值时立即落盘
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
  if (statsCache.size > 100) statsCache.clear();
  statsCache.set(key, { at: Date.now(), value });
}
function invalidateStatsCache() {
  statsCache.clear();
}

let liveUsage = { totalRequests: 0, endpoints: {}, lastReset: Date.now() };
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
  const due = (now - usageLastFlush >= USAGE_FLUSH_MS) || (usagePending.total >= USAGE_MAX_PENDING);
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
      await SPEED_HISTORY.put('usage:stats', JSON.stringify(stats), { expirationTtl: 86400 * 30 });
      invalidateStatsCache();
    } catch (e) {
      // 落盘失败则把计数还回缓冲，避免丢失，并允许尽快重试
      usagePending.total += snapshot.total;
      for (const [ep, count] of Object.entries(snapshot.endpoints)) {
        usagePending.endpoints[ep] = (usagePending.endpoints[ep] || 0) + count;
      }
      usageLastFlush = 0;
    } finally {
      usageFlushInFlight = false;
    }
  })();
}

// ==================== 站点监控（Cron 巡检 + Webhook 告警；仅状态变化/每小时时写 KV） ====================
const MONITOR_STATE_REFRESH_MS = 3600000;
const MONITOR_LOG_MAX = 20;

function monitorKv() {
  return (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) ? SPEED_HISTORY : null;
}

function buildNotifyPayload(format, text) {
  if (format === 'dingtalk') return { msgtype: 'text', text: { content: text } };
  if (format === 'feishu') return { msg_type: 'text', content: { text: text } };
  if (format === 'wecom') return { msgtype: 'text', text: { content: text } };
  return { text: text, source: 'NetSight Pro' };
}

async function postMonitorWebhook(webhook, format, text) {
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildNotifyPayload(format, text)),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {}
}

async function runMonitorChecks(urls) {
  const results = [];
  for (const target of urls) {
    const started = Date.now();
    let status = 'down', code = null, error = '';
    try {
      let hostname = '';
      try { hostname = new URL(target).hostname; } catch (e) { throw new Error('invalid url'); }
      if (isPrivateHost(hostname) || !(await resolvesToPublicOnly(hostname))) throw new Error('blocked target');
      const res = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'NetSight-Monitor/1.0' },
        signal: AbortSignal.timeout(10000)
      });
      code = res.status;
      status = code < 400 ? 'up' : 'down';
      try { if (res.body) { const rd = res.body.getReader(); try { await rd.cancel(); } catch (e2) {} } } catch (e3) {}
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 120);
    }
    results.push({ url: target, status: status, code: code, error: error, ms: Date.now() - started });
  }
  return results;
}

async function handleMonitorCheck() {
  const kv = monitorKv();
  if (!kv) return { skipped: 'kv_missing' };
  let cfg = null, prevState = {}, log = [];
  try { const raw = await kv.get('monitor:config'); if (raw) cfg = JSON.parse(raw); } catch (e) {}
  if (!cfg || !Array.isArray(cfg.urls) || cfg.urls.length === 0) return { skipped: 'no_config' };
  try { const raw = await kv.get('monitor:state'); if (raw) prevState = JSON.parse(raw); } catch (e) {}
  try { const raw = await kv.get('monitor:log'); if (raw) log = JSON.parse(raw); } catch (e) {}

  const now = Date.now();
  const results = await runMonitorChecks(cfg.urls.slice(0, 10));
  let changed = false;
  const nextState = {};
  const events = [];
  for (const r of results) {
    const prev = prevState[r.url] || null;
    const since = (prev && prev.status === r.status) ? prev.since : now;
    nextState[r.url] = { status: r.status, code: r.code, since: since, lastCheck: now, error: r.error || '' };
    if (!prev || prev.status !== r.status) {
      changed = true;
      const isRecovery = prev && prev.status === 'down' && r.status === 'up';
      const isDown = r.status === 'down' && (!prev || prev.status === 'up');
      if (isRecovery || isDown) {
        const text = isRecovery
          ? '[NetSight] 恢复: ' + r.url + ' 已恢复正常 (' + r.ms + 'ms)'
          : '[NetSight] 异常: ' + r.url + ' ' + (r.code ? ('HTTP ' + r.code) : (r.error || '连接失败'));
        events.push({ t: now, url: r.url, status: r.status, text: text });
        if (cfg.webhook) await postMonitorWebhook(cfg.webhook, cfg.format || 'generic', text);
      }
    }
  }
  const currentMonSet = new Set(results.map(x => x.url));
  for (const k of Object.keys(prevState)) {
    if (k !== '__meta' && !currentMonSet.has(k)) changed = true;
  }
  const lastWrite = (prevState.__meta && prevState.__meta.writtenAt) ? prevState.__meta.writtenAt : 0;
  if (changed || (now - lastWrite) > MONITOR_STATE_REFRESH_MS) {
    nextState.__meta = { writtenAt: now };
    try { await kv.put('monitor:state', JSON.stringify(nextState)); } catch (e) {}
  }
  if (events.length) {
    try { await kv.put('monitor:log', JSON.stringify(events.concat(log).slice(0, MONITOR_LOG_MAX))); } catch (e) {}
  }
  return { results: results, changed: changed, notified: events.length };
}

// ==================== 前端静态资源（外置 /app.css 与 /app.js，可长缓存） ====================
const ASSET_VER = '4.6.0';
const UNLIMITED_PATHS = new Set(['/app.js', '/app.css', '/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']);

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
            --text-tertiary: #6a6d74;
            --text-quaternary: #45484e;

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
            --text-tertiary: #8a8d93;
            --text-quaternary: #b7b9bd;

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
            display: flex; gap: 2px; background: var(--glass-bg); padding: 4px;
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

        .stats-row { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
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
            background: var(--accent-light); padding: 6px 16px; border-radius: 50px;
            font-size: 12px; cursor: pointer; transition: all var(--transition-fast);
            border: 1px solid var(--border-accent); color: var(--accent); font-weight: 500;
        }
        .copy-btn:hover { background: rgba(129, 140, 248, 0.15); box-shadow: var(--accent-glow); }

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

        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 28px; }
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

        /* ==================== 工具卡片网格 ==================== */
        .tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
        .tool-card {
            display: flex; align-items: center; gap: 14px; text-align: left; width: 100%;
            padding: 15px; border: 1px solid var(--glass-border); border-radius: var(--radius-md);
            background: var(--glass-bg); cursor: pointer; color: var(--text-primary);
            font-family: var(--font); transition: var(--transition-fast);
        }
        .tool-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
        .tool-card .tc-icon {
            width: 38px; height: 38px; flex: 0 0 38px; display: flex; align-items: center; justify-content: center;
            border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
            color: var(--text-secondary); font-size: 15px; background: var(--glass-heavy);
        }
        .tool-card:hover .tc-icon { color: var(--text-primary); border-color: var(--glass-border-hover); }
        .tool-card .tc-text { flex: 1; min-width: 0; }
        .tool-card .tc-name { display: block; font-size: 13px; font-weight: 600; letter-spacing: 0.3px; }
        .tool-card .tc-desc { display: block; font-size: 11px; color: var(--text-tertiary); margin-top: 3px; line-height: 1.35; }
        .tool-card .tc-go { color: var(--text-quaternary); font-size: 10px; transition: var(--transition-fast); }
        .tool-card:hover .tc-go { color: var(--text-secondary); }

        /* ==================== 工具结果弹层 ==================== */
        .tool-modal-box { max-width: 620px; width: 92%; max-height: 84vh; display: flex; flex-direction: column; }
        .tool-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--divider); margin-bottom: 16px; }
        .tool-modal-head h3 { font-size: 16px; font-weight: 600; letter-spacing: 0.3px; }
        .tool-modal-head p { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
        .tool-close { flex: 0 0 auto; width: 30px; height: 30px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; transition: var(--transition-fast); }
        .tool-close:hover { color: var(--text-primary); border-color: var(--glass-border-hover); }
        .tool-modal-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .tool-rerun { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font); font-size: 12px; transition: var(--transition-fast); }
        .tool-rerun:hover { color: var(--text-primary); border-color: var(--glass-border-hover); background: var(--glass-bg-hover); }
        .tool-rerun i { font-size: 11px; }
        @media (max-width: 520px) { .tool-rerun span { display: none; } .tool-rerun { padding: 0 9px; } }
        .tool-modal-body { overflow-y: auto; min-height: 80px; }

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
        .tool-input:focus { outline: none; border-color: var(--glass-border-hover); }
        .tool-input::placeholder { color: var(--text-quaternary); font-family: var(--font); }
        .tool-field .btn { flex: 0 0 auto; height: 40px; }
        @media (max-width: 520px) { .tool-field { flex-direction: column; } .tool-field .btn { width: 100%; justify-content: center; } }

        /* 结果：TTFB 阶段条 */
        .ttfb-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
        .ttfb-label { min-width: 104px; font-size: 11px; color: var(--text-secondary); }
        .ttfb-track { flex: 1; height: 12px; background: var(--divider); border-radius: 6px; overflow: hidden; }
        .ttfb-track i { display: block; height: 100%; border-radius: 6px; transition: width 0.4s ease; }
        .ttfb-val { min-width: 46px; text-align: right; font-size: 11px; font-weight: 600; font-family: var(--font-mono); color: var(--text-primary); }
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
                    reachNote: 'Compares reachability from the Cloudflare edge and from your browser. Edge OK plus browser fail usually means local blocking.',
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
                        no_https: 'Final page is not HTTPS'
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
                        reach: 'Probe CN and global sites from the edge and your browser'
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
                    reachNote: '同时从 Cloudflare 边缘与你的浏览器探测目标站点；边缘可达而浏览器不可达，通常说明本地网络存在阻断。',
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
                        no_https: '最终页面未使用 HTTPS'
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
                        reach: '边缘侧与浏览器侧同时探测境内外站点，识别本地阻断'
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
                    reachNote: '同時從 Cloudflare 邊緣與你的瀏覽器探測目標站點；邊緣可達而瀏覽器不可達，通常說明本地網路存在阻斷。',
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
                        no_https: '最終頁面未使用 HTTPS'
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
                        reach: '邊緣側與瀏覽器側同時探測境內外站點，識別本地阻斷'
                    }
                }
            };

            // ==================== 后端数据 ====================
            const BACKEND_DATA = window.__BACKEND__ || {};

            // ==================== DOM 引用 ====================
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
                lossResult: document.getElementById('loss-result'), speedBtn: document.getElementById('btn-speed-test'),
                speedResult: document.getElementById('speed-result'), dnsBtn: document.getElementById('btn-dns-test'),
                dnsResult: document.getElementById('dns-result'), cpuBtn: document.getElementById('btn-cpu-test'),
                cpuResult: document.getElementById('cpu-result'), wsBtn: document.getElementById('btn-ws-test'),
                wsResult: document.getElementById('ws-result'), concurrentBtn: document.getElementById('btn-concurrent-test'),
                concurrentResult: document.getElementById('concurrent-result'), streamBtn: document.getElementById('btn-stream-test'),
                streamResult: document.getElementById('stream-result'),
                mediaBtn: document.getElementById('btn-media-unlock'), mediaResult: document.getElementById('media-result'),
                multiBtn: document.getElementById('btn-multi-node'), multiResult: document.getElementById('multi-node-result'),
                webrtcBtn: document.getElementById('btn-webrtc-test'), webrtcResult: document.getElementById('webrtc-result'),
                ttfbBtn: document.getElementById('btn-ttfb-test'), ttfbResult: document.getElementById('ttfb-result'),
                uploadBtn: document.getElementById('btn-upload-test'), uploadResult: document.getElementById('upload-result')
            };

            function detectLang() {
                let saved = null;
                try { saved = localStorage.getItem('pref-lang'); } catch(e) {}
                if (saved && i18n[saved]) return saved;
                const langs = navigator.languages || [navigator.language || ''];
                for (const l of langs) {
                    const lower = l.toLowerCase();
                    if (lower.match(/^zh-(cn|sg|my)/)) return 'zh-CN';
                    if (lower.match(/^zh/)) return 'zh-TW';
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
            let consecutiveLoss = 0;
            let totalLoss = 0;
            let sampleCount = 0;
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

            function openToolModal(title, desc) {
                const mt = document.getElementById('toolModalTitle');
                const md = document.getElementById('toolModalDesc');
                if (mt) mt.textContent = title || '';
                if (md) md.textContent = desc || '';
                const body = document.getElementById('toolModalBody');
                if (body) body.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(i18n[currentLang].running) + '</div>';
                const el = document.getElementById('toolModal');
                if (el) el.classList.add('active');
            }

            function closeToolModal() {
                const el = document.getElementById('toolModal');
                if (el) el.classList.remove('active');
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
                    't-history-title': t.historyTitle,
                    't-history-sub': t.historySub,
                    't-no-records': t.noRecords,
                    't-usage-title': t.usageTitle,
                    't-usage-sub': t.usageSub,
                    't-loading-stats': t.loadingStats,
                    't-client-label': t.clientLabel,
                    't-copy': t.copy,
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
                    const rawProto = BACKEND_DATA.httpProtocolRaw;
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
                document.title = t.pageTitle;
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
                updateUI();
                // 动态生成的文本也跟随语言刷新（刷新硬件信息、网络质量、真实IP位置）
                updateHardwareInfo();
                if (lastRtt !== null) updateQuality(lastRtt);
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
                ctx.strokeStyle = '#c3c7cd';
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
                gradient.addColorStop(0, 'rgba(195, 199, 205, 0.28)');
                gradient.addColorStop(1, 'rgba(195, 199, 205, 0)');
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
                    const rate = sampleCount > 0 ? Math.round((totalLoss / sampleCount) * 100) : 0;
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

            async function testRtt() {
                if (!rttTestRunning) return;
                const start = performance.now();
                try {
                    const rttRes = await fetchWithTimeout(window.location.origin + '/health?_=' + Date.now(), 
                        { method: 'HEAD', cache: 'no-store' }, 2000);
                    if (rttRes && rttRes.status === 429) {
                        // 健康检查命中独立限流：跳过本次采样，不计丢包
                        setTimeout(testRtt, 2000);
                        return;
                    }
                    const diff = Math.round(performance.now() - start);
                    lastRtt = diff;
                    if (elements.rttNum) elements.rttNum.textContent = diff;
                    
                    sampleCount++;
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
                    updateLossRate();
                    if (elements.rttNum) elements.rttNum.textContent = 'ERR';
                    updateQuality(999);
                }
                setTimeout(testRtt, 2000);
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
                    }
                    return;
                }
                
                try {
                    const res = await fetch(\`https://ipapi.co/\${ip}/json/\`);
                    const geoData = await res.json();
                    if (geoData.error) throw new Error(geoData.reason);
                    
                    const dist = calculateDistance(
                        BACKEND_DATA.latNum, BACKEND_DATA.lonNum,
                        geoData.latitude, geoData.longitude
                    );
                    
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
            async function runConcurrentTest() {
                if (concurrentTestRunning) return;
                concurrentTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.concurrentResult, '<span class="loading"></span> ' + t.concurrentTesting);
                
                try {
                    const results = await Promise.all([4, 6, 8].map(count => 
                        fetchWithTimeout(\`/concurrent-test?count=\${count}&size=2048\`, {}, 8000).then(r => r.json())
                    ));
                    
                    const cards = results.map(r => {
                        const avgDuration = Math.round(r.reduce((sum, item) => sum + (item.duration || 0), 0) / r.length);
                        const tone = avgDuration < 20 ? 'ok' : (avgDuration < 50 ? 'warn' : 'bad');
                        return metricCard(r.length + ' ' + t.concurrentRequests, avgDuration, 'ms', tone, Math.min(100, avgDuration * 2));
                    });
                    showResult(elements.concurrentResult, resultTitle(t.concurrentResultTitle) + metricGrid(cards));
                } catch (e) {
                    showResult(elements.concurrentResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.concurrentFailed, true);
                }
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
                let failed = 0;
                for (let i = 0; i < total; i++) {
                    try {
                        await fetchWithTimeout(window.location.origin + '/health?_loss=' + Date.now() + i, 
                            { method: 'HEAD', cache: 'no-store' }, 3000);
                    } catch (e) {
                        failed++;
                    }
                }
                const lossPercent = Math.round((failed / total) * 100);
                const tone = lossPercent === 0 ? 'ok' : (lossPercent < 5 ? 'warn' : 'bad');
                showResult(elements.lossResult, resultTitle(t.lossResult) + metricGrid([
                    metricCard(t.lossResult, lossPercent, '%', tone, lossPercent),
                    metricCard(t.samples, total, '', null, null),
                    metricCard(t.lossPacketsLost, failed, '', null, null)
                ]));
                lossTestRunning = false;
            }

            let speedTestRunning = false;
            async function runSpeedTest() {
                if (speedTestRunning) return;
                speedTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.speedResult, '<span class="loading"></span> ' + t.speedTesting);
                
                const sizes = [102400, 512000, 2097152];
                const results = [];
                
                for (const size of sizes) {
                    const start = performance.now();
                    try {
                        await fetchWithTimeout(\`/speedtest?size=\${size}\`, {}, 15000);
                        const duration = performance.now() - start;
                        const speedMbps = ((size * 8) / (duration / 1000)) / 1000000;
                        results.push({ sizeKB: Math.round(size/1024), speed: speedMbps.toFixed(2) });
                    } catch (e) {
                        results.push({ sizeKB: Math.round(size/1024), speed: '0' });
                    }
                }
                
                const validResults = results.filter(r => r.speed !== '0');
                const avgSpeed = validResults.length > 0 
                    ? validResults.reduce((sum, r) => sum + parseFloat(r.speed), 0) / validResults.length 
                    : 0;
                const avgTone = avgSpeed > 50 ? 'ok' : (avgSpeed > 10 ? 'warn' : 'bad');
                
                const cards = results.map(r => metricCard(r.sizeKB + ' KB', r.speed, 'Mbps', null, Math.min(100, (parseFloat(r.speed) || 0) * 2)));
                cards.push(metricCard(t.speedAvg, avgSpeed.toFixed(2), 'Mbps', avgTone, Math.min(100, avgSpeed * 2)));
                showResult(elements.speedResult, resultTitle(t.speedResultTitle) + metricGrid(cards));
                logSpeedTest(avgSpeed, results);
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
                        await new Promise((resolve, reject) => {
                            const img = new Image();
                            const timeout = setTimeout(() => {
                                img.src = '';
                                reject(new Error('timeout'));
                            }, 5000);
                            img.onload = () => { clearTimeout(timeout); resolve(); };
                            img.onerror = () => { clearTimeout(timeout); resolve(); };
                            img.src = domain.url;
                        });
                        const dnsTime = Math.round(performance.now() - start);
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

            // ==================== 多节点对比 ====================
            const nodeModalEl = document.getElementById('nodeModal');
            const nodeUrlsInput = document.getElementById('nodeUrls');
            const modalCancel = document.getElementById('modalCancel');
            const modalStart = document.getElementById('modalStart');

            if (modalCancel) modalCancel.addEventListener('click', () => {
                if (nodeModalEl) nodeModalEl.classList.remove('active');
            });

            if (modalStart) modalStart.addEventListener('click', async () => {
                const urls = nodeUrlsInput.value.split('\\n').map(s => s.trim()).filter(s => s);
                if (urls.length === 0) {
                    nodeUrlsInput.style.borderColor = 'var(--danger)';
                    nodeUrlsInput.placeholder = i18n[currentLang].enterNodeUrlAlert;
                    return;
                }
                nodeUrlsInput.style.borderColor = '';
                try { localStorage.setItem('nodeUrls', nodeUrlsInput.value); } catch(e) {}
                if (nodeModalEl) nodeModalEl.classList.remove('active');
                openToolModal(i18n[currentLang].multiBtn, (i18n[currentLang].toolDesc && i18n[currentLang].toolDesc.multi) || '');
                await runMultiNodeTest(urls);
            });

            if (nodeModalEl) nodeModalEl.addEventListener('click', (e) => {
                if (e.target === nodeModalEl) nodeModalEl.classList.remove('active');
            });

            // ==================== 工具卡片 + 结果弹层 ====================
            const TOOL_LIST = [
                { key: 'quickcheck', icon: 'fa-heart-pulse', nameKey: 'quickcheckBtn' },
                { key: 'loss', icon: 'fa-percent', nameKey: 'lossBtn' },
                { key: 'speed', icon: 'fa-gauge-high', nameKey: 'speedBtn' },
                { key: 'bufferbloat', icon: 'fa-wave-square', nameKey: 'bufferbloatBtn' },
                { key: 'dns', icon: 'fa-server', nameKey: 'dnsBtn' },
                { key: 'dnslookup', icon: 'fa-magnifying-glass-chart', nameKey: 'dnslookupBtn' },
                { key: 'domaincheck', icon: 'fa-fingerprint', nameKey: 'domaincheckBtn' },
                { key: 'monitor', icon: 'fa-tower-broadcast', nameKey: 'monitorBtn' },
                { key: 'cpu', icon: 'fa-microchip', nameKey: 'cpuBtn' },
                { key: 'ws', icon: 'fa-bolt', nameKey: 'wsBtn' },
                { key: 'concurrent', icon: 'fa-layer-group', nameKey: 'concurrentBtn' },
                { key: 'stream', icon: 'fa-stream', nameKey: 'streamBtn' },
                { key: 'media', icon: 'fa-circle-play', nameKey: 'mediaBtn' },
                { key: 'multi', icon: 'fa-diagram-project', nameKey: 'multiBtn' },
                { key: 'webrtc', icon: 'fa-user-shield', nameKey: 'webrtcBtn' },
                { key: 'ttfb', icon: 'fa-stopwatch', nameKey: 'ttfbBtn' },
                { key: 'upload', icon: 'fa-upload', nameKey: 'uploadBtn' },
                { key: 'audit', icon: 'fa-stethoscope', nameKey: 'auditBtn' },
                { key: 'dnscompare', icon: 'fa-code-compare', nameKey: 'dnscompareBtn' },
                { key: 'reach', icon: 'fa-tower-cell', nameKey: 'reachBtn' }
            ];
            let currentToolKey = null;
            const TOOL_RUNNERS = {
                loss: runLossTest, speed: runSpeedTest, dns: runDnsTest, cpu: runCpuTest, ws: runWsTest,
                concurrent: runConcurrentTest, stream: runStreamTest, media: runClientMediaTest,
                webrtc: runWebRtcTest, ttfb: runTtfbTest, upload: runUploadTest, audit: runSiteAudit,
                quickcheck: runQuickCheckTool, bufferbloat: runBufferbloatTool, dnslookup: runDnsLookupTool,
                domaincheck: runDomainCheckTool, monitor: runMonitorTool, dnscompare: runDnsCompare, reach: runReachCheck
            };

            function renderToolCards() {
                const grid = document.getElementById('toolGrid');
                if (!grid) return;
                const t = i18n[currentLang];
                grid.innerHTML = TOOL_LIST.map(item =>
                    '<button class="tool-card" data-tool="' + item.key + '">' +
                        '<span class="tc-icon"><i class="fas ' + item.icon + '"></i></span>' +
                        '<span class="tc-text"><span class="tc-name">' + escapeHTML(t[item.nameKey] || item.key) + '</span>' +
                        '<span class="tc-desc">' + escapeHTML((t.toolDesc && t.toolDesc[item.key]) || '') + '</span></span>' +
                        '<i class="fas fa-chevron-right tc-go"></i>' +
                    '</button>'
                ).join('');
            }

            function handleToolClick(key) {
                const t = i18n[currentLang];
                currentToolKey = key;
                if (key === 'multi') {
                    let saved = '';
                    try { saved = localStorage.getItem('nodeUrls') || ''; } catch(e) {}
                    if (nodeUrlsInput) nodeUrlsInput.value = saved;
                    if (nodeModalEl) nodeModalEl.classList.add('active');
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
                    if (nodeModalEl) nodeModalEl.classList.add('active');
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
                        const testUrl = node + '/speedtest?size=1';
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
                    const ips = await new Promise((resolve) => {
                        const found = new Set();
                        const timeout = setTimeout(() => resolve(found), 5000);
                        try {
                            const pc = new RTCPeerConnection({ iceServers: [] });
                            pc.createDataChannel('');
                            pc.onicecandidate = (e) => {
                                if (!e.candidate) {
                                    clearTimeout(timeout);
                                    pc.close();
                                    resolve(found);
                                    return;
                                }
                                const match = e.candidate.candidate.match(/(\\d{1,3}\\.){3}\\d{1,3}/);
                                if (match) found.add(match[0]);
                            };
                            pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {
                                clearTimeout(timeout);
                                resolve(found);
                            });
                        } catch (e) {
                            clearTimeout(timeout);
                            resolve(found);
                        }
                    });

                    if (ips.size === 0) {
                        showResult(elements.webrtcResult, resultTitle('WebRTC') + '<div class="result-row"><span class="rr-name">' + t.webrtcSafe + '</span><span class="rr-val">OK</span></div>');
                    } else {
                        const ipList = [...ips];
                        const localRe = /^(10\\.|172\\.(1[6-9]|2\\d|3[01])\\.|192\\.168\\.)/;
                        const localIps = ipList.filter(ip => localRe.test(ip));
                        const publicIps = ipList.filter(ip => !localRe.test(ip));
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
                    html += bar(t.ttfbDns, dns, '#e9eaec');
                    html += bar(t.ttfbTcp, tcp, '#c3c7cd');
                    html += bar(t.ttfbTls, tls, '#a5abb3');
                    html += bar(t.ttfbWait, wait, '#878d95');
                    html += bar(t.ttfbDownload, download, '#697076');
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
                body.innerHTML = '<div class="tool-field">' +
                    '<input type="url" id="auditUrl" class="tool-input" placeholder="' + escapeHTML(t.auditPrompt) + '" value="https://">' +
                    '<button class="btn btn-primary" id="auditGo"><i class="fas fa-stethoscope"></i> ' + escapeHTML(t.auditRun) + '</button>' +
                    '</div>';
                const input = document.getElementById('auditUrl');
                const go = document.getElementById('auditGo');
                if (input && go) {
                    const submit = () => startSiteAudit(input.value);
                    go.addEventListener('click', submit);
                    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    input.focus();
                }
            }

            async function startSiteAudit(rawUrl) {
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
                    const res = await fetch('/api/site-audit?url=' + encodeURIComponent(u), { cache: 'no-store' });
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
                const html =
                    resultTitle(t.auditFinal) +
                    '<div class="result-rows" style="margin-bottom:16px;"><div class="result-row"><span class="rr-name">' + escapeHTML(d.finalUrl || '') + '</span><span class="rr-val">' + escapeHTML(String(d.status)) + '</span></div></div>' +
                    metricGrid(cards) +
                    resultTitle(t.auditChecks) +
                    '<div class="result-rows">' + checkRows + '</div>' +
                    resultTitle(t.auditIssues) +
                    '<div class="result-rows">' + issueRows + '</div>';
                showResult(null, html);
            }

            async function runDnsCompare() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                body.innerHTML =
                    '<div class="tool-field">' +
                    '<input type="text" id="dcNameInput" class="tool-input" placeholder="example.com" autocomplete="off" value="' + escapeHTML(window.location.hostname || 'example.com') + '">' +
                    '<button class="btn btn-primary" id="dcGo"><i class="fas fa-code-compare"></i> ' + escapeHTML(t.dnsQueryBtn) + '</button>' +
                    '</div><div id="dcOut"></div>';
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
                    const res = await fetch('/api/dns-compare?name=' + encodeURIComponent(name) + '&type=A', { cache: 'no-store' });
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
                    return '<div class="result-row' + (r.status === 'ok' ? '' : ' is-warn') + '"><span class="rr-name">' + escapeHTML(r.label) + '</span>' +
                        '<span class="rr-val" style="word-break:break-all">' + escapeHTML(String(val).slice(0, 200)) + ' · ' + escapeHTML(String(r.time || 0)) + 'ms</span></div>';
                }).join('');
                const verdict = d.consistent
                    ? '<div class="result-row"><span class="rr-name">' + escapeHTML(t.dcConsistent) + '</span><span class="rr-val">OK</span></div>'
                    : '<div class="result-row is-warn"><span class="rr-name">' + escapeHTML(t.dcInconsistent) + '</span><span class="rr-val">' + escapeHTML(String((d.groups || []).length)) + ' groups</span></div>';
                out.innerHTML = resultTitle(t.dcTitle + ' · ' + d.name + ' (' + d.type + ')') +
                    '<div class="result-rows">' + rows + '</div>' +
                    '<div style="margin-top:12px" class="result-rows">' + verdict + '</div>';
            }

            async function runReachCheck() {
                const t = i18n[currentLang];
                showResult(null, '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>');
                const edgeP = fetch('/api/reach-check', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
                const probe = async (url) => {
                    const t0 = performance.now();
                    try {
                        await fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), { mode: 'no-cors', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(6000) });
                        return { ok: true, time: Math.round(performance.now() - t0) };
                    } catch (e) {
                        return { ok: false, time: Math.round(performance.now() - t0) };
                    }
                };
                const edgeData = await edgeP;
                if (!edgeData || !edgeData.targets) {
                    showResult(null, '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.reachFailed) + '</div>', true);
                    return;
                }
                const browser = await Promise.all(edgeData.targets.map(async (tg) => {
                    const r = await probe(tg.url);
                    return { id: tg.id, ok: r.ok, time: r.time };
                }));
                renderReachCheck(edgeData, browser);
            }

            function renderReachCheck(edgeData, browser) {
                const t = i18n[currentLang];
                const bMap = {};
                (browser || []).forEach(b => { bMap[b.id] = b; });
                const rows = (edgeData.edge || []).map(e => {
                    const b = bMap[e.id] || { ok: false, time: 0 };
                    const verdict = (e.ok && b.ok) ? t.reachOk : (e.ok && !b.ok) ? t.reachLikelyBlocked : (!e.ok && b.ok) ? t.reachEdgeBlocked : t.reachBlocked;
                    const bad = !(e.ok && b.ok);
                    return '<div class="result-row' + (bad ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(e.label) + '</span>' +
                        '<span class="rr-val">' + escapeHTML(verdict) + ' · ' + escapeHTML(t.reachEdge) + ' ' + (e.ok ? '✓' : '×') + ' ' + escapeHTML(String(e.time || 0)) + 'ms' +
                        ' · ' + escapeHTML(t.reachBrowser) + ' ' + (b.ok ? '✓' : '×') + ' ' + escapeHTML(String(b.time || 0)) + 'ms</span></div>';
                }).join('');
                showResult(null, resultTitle(t.reachTitle) + '<div class="result-rows">' + rows + '</div>' +
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
                body.innerHTML = '<div class="result-rows"><div class="result-row"><span class="rr-name">' + escapeHTML(t.bbIntro) + '</span></div></div>' +
                    '<div class="tool-field" style="margin-top:12px">' +
                    '<button class="btn btn-primary" id="bbStart"><i class="fas fa-wave-square"></i> ' + escapeHTML(t.bbStart) + '</button>' +
                    '</div><div id="bbResult"></div>' +
                    '<div class="result-rows" style="margin-top:10px"><div class="result-row"><span class="rr-name" style="font-size:12px;color:var(--text-tertiary)">' + escapeHTML(t.bbNote) + '</span></div></div>';
                const go = document.getElementById('bbStart');
                if (go) go.addEventListener('click', startBufferbloatTest);
            }
            async function bbLoadPhase(dir, seconds) {
                const samples = [];
                const controller = new AbortController();
                let running = true;
                const startLoop = () => (async () => {
                    while (running) {
                        try {
                            let r;
                            if (dir === 'down') {
                                r = await fetch('/speedtest?size=67108864', { signal: controller.signal, cache: 'no-store' });
                                if (r.status === 429) { running = false; break; }
                                if (r.body) {
                                    const rd = r.body.getReader();
                                    while (true) {
                                        const step = await rd.read();
                                        if (step.done) break;
                                    }
                                }
                            } else {
                                r = await fetch('/upload-test', { method: 'POST', body: getBbUploadPayload(), signal: controller.signal });
                                if (r.status === 429) { running = false; break; }
                                try { await r.arrayBuffer(); } catch (e0) {}
                            }
                        } catch (e) {
                            if (running) { await new Promise(r2 => setTimeout(r2, 100)); }
                        }
                    }
                })();
                const loops = [startLoop(), startLoop()];
                const t0 = performance.now();
                while (performance.now() - t0 < seconds * 1000) {
                    const s = performance.now();
                    try {
                        await fetchWithTimeout(window.location.origin + '/health?_bb=' + dir + Date.now(), { method: 'HEAD', cache: 'no-store' }, 2000);
                        samples.push(performance.now() - s);
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 300));
                }
                running = false;
                controller.abort();
                try { await Promise.allSettled(loops); } catch (e) {}
                return samples;
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
                            await fetchWithTimeout(window.location.origin + '/health?_bb=base' + i, { method: 'HEAD', cache: 'no-store' }, 3000);
                            baseline.push(performance.now() - s);
                        } catch (e) {}
                        await new Promise(r => setTimeout(r, 250));
                    }
                    const baseMed = Math.round(medianValue(baseline));
                    const downSamples = await bbLoadPhase('down', 8);
                    const upSamples = await bbLoadPhase('up', 8);
                    const downMed = Math.round(medianValue(downSamples)) || baseMed;
                    const upMed = Math.round(medianValue(upSamples)) || baseMed;
                    const downDelta = Math.max(0, downMed - baseMed);
                    const upDelta = Math.max(0, upMed - baseMed);
                    const downGrade = bufferbloatGrade(downDelta);
                    const upGrade = bufferbloatGrade(upDelta);
                    const overall = downDelta > upDelta ? downGrade : upGrade;
                    const cards = [
                        metricCard(t.bbBaseline, baseMed, 'ms', null, null),
                        metricCard(t.bbLoadedDown, downMed, 'ms', null, Math.min(100, downDelta)),
                        metricCard(t.bbLoadedUp, upMed, 'ms', null, Math.min(100, upDelta))
                    ];
                    const html =
                        resultTitle(t.bufferbloatBtn) +
                        metricGrid(cards) +
                        '<div class="result-rows">' +
                        '<div class="result-row"><span class="rr-name">' + escapeHTML(t.bbDelta) + ' (↓)</span><span class="rr-val"><span class="badge ' + gradeBadgeClass(downGrade) + '">' + downGrade + ' · +' + downDelta + ' ms</span></span></div>' +
                        '<div class="result-row"><span class="rr-name">' + escapeHTML(t.bbDelta) + ' (↑)</span><span class="rr-val"><span class="badge ' + gradeBadgeClass(upGrade) + '">' + upGrade + ' · +' + upDelta + ' ms</span></span></div>' +
                        '<div class="result-row"><span class="rr-name">' + escapeHTML(t.bbGrade) + '</span><span class="rr-val"><span class="badge ' + gradeBadgeClass(overall) + '">' + overall + '</span></span></div>' +
                        '</div>';
                    if (out) out.innerHTML = html;
                } catch (e) {
                    if (out) out.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(t.bbFailed) + '</div>';
                }
                bbRunning = false;
            }

            // ==================== DNS 工具箱 ====================
            let dnsToolBusy = false;
            function runDnsLookupTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                body.innerHTML =
                    '<div class="tool-field">' +
                    '<input type="text" id="dnsNameInput" class="tool-input" placeholder="example.com" autocomplete="off">' +
                    '<select id="dnsTypeSelect" class="tool-input" style="max-width:120px">' +
                    ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'].map(x => '<option>' + x + '</option>').join('') +
                    '</select>' +
                    '<button class="btn btn-primary" id="dnsGo"><i class="fas fa-magnifying-glass"></i> ' + escapeHTML(t.dnsQueryBtn) + '</button>' +
                    '</div><div id="dnsLookupOut"></div>' +
                    '<div class="result-rows" style="margin-top:16px"><div class="result-row"><span class="rr-name">' + escapeHTML(t.dnsblSection) + '</span></div></div>' +
                    '<div class="tool-field" style="margin-top:8px">' +
                    '<input type="text" id="dnsblIpInput" class="tool-input" placeholder="1.2.3.4" autocomplete="off" value="' + escapeHTML(BACKEND_DATA.clientIp || '') + '">' +
                    '<button class="btn btn-primary" id="dnsblGo"><i class="fas fa-shield-halved"></i> ' + escapeHTML(t.dnsblBtn) + '</button>' +
                    '</div><div id="dnsblOut"></div>' +
                    '<div class="result-rows" style="margin-top:10px"><div class="result-row"><span class="rr-name" style="font-size:12px;color:var(--text-tertiary)">' + escapeHTML(t.dnsblNotice) + '</span></div></div>';
                const nameInput = document.getElementById('dnsNameInput');
                const go = document.getElementById('dnsGo');
                const blInput = document.getElementById('dnsblIpInput');
                const blGo = document.getElementById('dnsblGo');
                if (nameInput && go) {
                    const submit = () => { if (!dnsToolBusy) doDnsLookup(); };
                    go.addEventListener('click', submit);
                    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
                    nameInput.focus();
                }
                if (blInput && blGo) {
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
                    const res = await fetch('/api/dns-lookup?name=' + encodeURIComponent(name) + '&type=' + encodeURIComponent(type), { cache: 'no-store' });
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
                    const res = await fetch('/api/dnsbl?ip=' + encodeURIComponent(ip), { cache: 'no-store' });
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
                body.innerHTML = '<div class="result-rows"><div class="result-row"><span class="rr-name">' + escapeHTML(t.qcNote) + '</span></div></div>' +
                    '<div class="tool-field" style="margin-top:12px">' +
                    '<button class="btn btn-primary" id="qcStart"><i class="fas fa-heart-pulse"></i> ' + escapeHTML(t.qcStart) + '</button>' +
                    '</div><div id="qcResult"></div>';
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
                    for (let i = 0; i < 8; i++) {
                        const s = performance.now();
                        try {
                            await fetchWithTimeout(window.location.origin + '/health?_qc=' + i, { method: 'HEAD', cache: 'no-store' }, 3000);
                            rttSamples.push(performance.now() - s);
                        } catch (e) { rttLost++; }
                        await new Promise(r => setTimeout(r, 250));
                    }
                    const rttAvg = Math.round(rttSamples.length ? rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length : 0);
                    let jitter = 0;
                    for (let i = 1; i < rttSamples.length; i++) jitter += Math.abs(rttSamples[i] - rttSamples[i - 1]);
                    jitter = rttSamples.length > 1 ? Math.round(jitter / (rttSamples.length - 1)) : 0;
                    const lossPct = Math.round((rttLost / 8) * 100);

                    setProgress(t.qcRunning + ' [2/6] ' + t.qcItemDown);
                    let downMbps = 0;
                    for (const size of [524288, 2097152]) {
                        const s = performance.now();
                        try {
                            const res = await fetch('/speedtest?size=' + size, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                            if (res.body) {
                                const rd = res.body.getReader();
                                while (true) {
                                    const step = await rd.read();
                                    if (step.done) break;
                                }
                            }
                            const sec = (performance.now() - s) / 1000;
                            const mbps = sec > 0 ? ((size * 8) / sec) / 1000000 : 0;
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
                        rtt: rttAvg <= 30 ? 25 : rttAvg <= 80 ? 20 : rttAvg <= 150 ? 14 : rttAvg <= 300 ? 8 : 3,
                        jitter: jitter <= 5 ? 10 : jitter <= 15 ? 7 : jitter <= 30 ? 4 : 1,
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

                    const issues = [];
                    if (rttAvg > 150) issues.push(t.qcItemRtt + ': ' + rttAvg + ' ms');
                    if (jitter > 30) issues.push(t.qcItemRtt + ': jitter ' + jitter + ' ms');
                    if (lossPct > 0) issues.push(t.qcItemRtt + ': loss ' + lossPct + '%');
                    if (downMbps < 20) issues.push(t.qcItemDown + ': ' + downMbps.toFixed(1) + ' Mbps');
                    if (upMbps < 5) issues.push(t.qcItemUp + ': ' + upStr);
                    if (protoLevel < 4) issues.push(t.qcItemProto + ': ' + protoText);
                    if (!dnsOk) issues.push(t.qcItemDns + ': FAIL');
                    if (fraudScore !== null && fraudScore > 50) issues.push(t.qcItemFraud + ': ' + fraudStr);

                    const qcRow = (label, val, pts, max) =>
                        '<div class="result-row' + (pts < max ? ' is-warn' : '') + '"><span class="rr-name">' + escapeHTML(label) + '</span>' +
                        '<span class="rr-val">' + escapeHTML(val) + ' <span class="badge ' + (pts < max ? 'badge-warning' : 'badge-success') + '">' + pts + '/' + max + '</span></span></div>';
                    const rowsHtml =
                        qcRow(t.qcItemRtt, rttAvg + ' ms · ' + jitter + ' ms · ' + lossPct + '%', score.rtt + score.jitter + score.loss, 45) +
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
                        '<div class="tool-field" style="margin-top:12px"><button class="btn btn-primary" id="qcCopyBtn"><i class="fas fa-copy"></i> ' + escapeHTML(t.copy) + '</button>' +
                        '<button class="btn" id="qcShareImgBtn"><i class="fas fa-image"></i> ' + escapeHTML(t.shareImg) + '</button>' +
                        '<button class="btn" id="qcShareLinkBtn"><i class="fas fa-link"></i> ' + escapeHTML(t.shareLink) + '</button></div>';

                    const locale = { 'en': 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' }[currentLang] || 'en-US';
                    qcLastReportText = 'NetSight Pro - ' + t.quickcheckBtn + '\\n' +
                        new Date().toLocaleString(locale, { timeZone: 'Asia/Shanghai' }) + '\\n' +
                        t.qcScore + ': ' + total + '/100 (' + grade + ')\\n' +
                        t.qcItemRtt + ': ' + rttAvg + ' ms / jitter ' + jitter + ' ms / loss ' + lossPct + '%\\n' +
                        t.qcItemDown + ': ' + downMbps.toFixed(1) + ' Mbps\\n' +
                        t.qcItemUp + ': ' + upStr + '\\n' +
                        t.qcItemProto + ': ' + protoText + '\\n' +
                        t.qcItemDns + ': ' + (dnsOk ? 'OK' : 'FAIL') + ' / ' + Math.round(dnsMs) + ' ms\\n' +
                        t.qcItemFraud + ': ' + fraudStr + '\\n' +
                        (issues.length ? t.qcIssues + ':\\n' + issues.map(x => ' - ' + x).join('\\n') + '\\n' : t.qcNoIssues + '\\n');
                    qcLastShare = { total: total, grade: grade, lines: [
                        t.qcItemRtt + ': ' + rttAvg + ' ms / ' + jitter + ' ms / ' + lossPct + '%',
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
                if ('serviceWorker' in navigator && window.isSecureContext) {
                    navigator.serviceWorker.register('/sw.js').catch(function() {});
                }
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
                    g.fillText('NetSight Pro · ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }), 60, 148);
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
                body.innerHTML =
                    '<div class="tool-field">' +
                    '<input type="text" id="dcDomain" class="tool-input" placeholder="example.com" autocomplete="off">' +
                    '<input type="text" id="dcSelector" class="tool-input" style="max-width:200px" placeholder="' + escapeHTML(t.dcSelectorPh) + '" autocomplete="off">' +
                    '<button class="btn btn-primary" id="dcGo"><i class="fas fa-fingerprint"></i> ' + escapeHTML(t.auditRun) + '</button>' +
                    '</div><div id="dcOut"></div>';
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
                    const res = await fetch('/api/domain-check?domain=' + encodeURIComponent(domain) + '&selector=' + encodeURIComponent(selector), { cache: 'no-store' });
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
                    dkim_missing: t.dcA_dkimMissing, listed: t.dcA_listed
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
                out.innerHTML =
                    '<div class="usage-total" style="font-size:44px">' + escapeHTML(String(d.score)) + '</div>' +
                    '<div class="usage-total-label">' + escapeHTML(t.qcScore + ' / 100') + ' · <span class="badge ' + gradeBadge + '">' + escapeHTML(String(d.grade)) + '</span></div>' +
                    '<div class="result-rows" style="margin-top:12px">' +
                    row('MX', mxText, !(d.mx && d.mx.length)) +
                    row('SPF', spfText, !(d.spf && d.spf.found)) +
                    row('DMARC', dmarcText, !(d.dmarc && d.dmarc.found)) +
                    row('DKIM', dkimText, !!(d.dkim && d.dkim.checked && !d.dkim.found)) +
                    row(t.dcBlLabel, blText, blListed) +
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
                        t.dcBlLabel + ': ' + blText
                    ]);
                });
            }

            // ==================== 站点监控 ====================
            function monErrHtml(msg) {
                return '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + escapeHTML(msg) + '</div>';
            }
            function monOutEl() { return document.getElementById('monOut'); }
            function monAdminKey() {
                const el = document.getElementById('monKey');
                let k = el ? (el.value || '').trim() : '';
                if (!k) { try { k = localStorage.getItem('mon-admin-key') || ''; } catch (e) {} }
                return k;
            }
            function runMonitorTool() {
                const t = i18n[currentLang];
                const body = document.getElementById('toolModalBody');
                if (!body) return;
                body.innerHTML =
                    '<div class="tool-field"><input type="password" id="monKey" class="tool-input" placeholder="' + escapeHTML(t.monKeyPh) + '" autocomplete="off"></div>' +
                    '<div class="result-rows" style="margin-top:8px"><div class="result-row"><span class="rr-name" style="font-size:12px;color:var(--text-tertiary)">' + escapeHTML(t.monNote) + '</span></div></div>' +
                    '<div class="tool-field" style="margin-top:10px"><textarea id="monUrls" class="tool-input" style="height:96px;padding:8px 12px;resize:vertical" placeholder="' + escapeHTML(t.monUrlsPh) + '"></textarea></div>' +
                    '<div class="tool-field" style="margin-top:8px"><input type="text" id="monHook" class="tool-input" placeholder="' + escapeHTML(t.monHookPh) + '" autocomplete="off">' +
                    '<select id="monFmt" class="tool-input" style="max-width:150px"><option value="generic">Generic JSON</option><option value="dingtalk">DingTalk</option><option value="feishu">Feishu</option><option value="wecom">WeCom</option></select></div>' +
                    '<div class="tool-field" style="margin-top:8px"><button class="btn btn-primary" id="monSave"><i class="fas fa-floppy-disk"></i> ' + escapeHTML(t.monSave) + '</button>' +
                    '<button class="btn" id="monRun"><i class="fas fa-play"></i> ' + escapeHTML(t.monRun) + '</button></div>' +
                    '<div id="monOut"></div>';
                let savedKey = '';
                try { savedKey = localStorage.getItem('mon-admin-key') || ''; } catch (e) {}
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
                    const res = await fetch('/api/monitor?key=' + encodeURIComponent(key), { cache: 'no-store' });
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
                if (urlsEl && cfg.urls) urlsEl.value = cfg.urls.join(String.fromCharCode(10));
                if (hookEl) hookEl.value = cfg.webhook || '';
                if (fmtEl && cfg.format) fmtEl.value = cfg.format;
                const fmtTime = function(ts) {
                    try { return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
                };
                const rows = (cfg.urls || []).map(function(u) {
                    const s = state[u] || null;
                    const st = s ? (s.status === 'up' ? t.monUp : t.monDown) : t.monStateNone;
                    const cls = s ? (s.status === 'up' ? 'badge-success' : 'badge-danger') : 'badge';
                    const extra = s ? (s.code ? 'HTTP ' + s.code : (s.error || '')) : '';
                    const since = (s && s.since) ? (t.monSince + ' ' + fmtTime(s.since)) : '';
                    const sub = [since, extra].filter(Boolean).join(' · ');
                    return '<div class="result-row"><span class="rr-name" style="word-break:break-all">' + escapeHTML(u) + (sub ? '<br><span style="font-size:11px;color:var(--text-quaternary)">' + escapeHTML(sub) + '</span>' : '') + '</span><span class="rr-val"><span class="badge ' + cls + '">' + escapeHTML(st) + '</span></span></div>';
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
                try { localStorage.setItem('mon-admin-key', key); } catch (e) {}
                const urlsEl = document.getElementById('monUrls');
                const hookEl = document.getElementById('monHook');
                const fmtEl = document.getElementById('monFmt');
                const urls = (urlsEl && urlsEl.value) ? urlsEl.value.split(String.fromCharCode(10)).map(function(s) { return s.trim(); }).filter(Boolean) : [];
                const webhook = hookEl ? (hookEl.value || '').trim() : '';
                const format = fmtEl ? fmtEl.value : 'generic';
                if (o) o.innerHTML = '<div class="tool-loading"><span class="loading"></span> ' + escapeHTML(t.running) + '</div>';
                try {
                    const res = await fetch('/api/monitor', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-admin-key': key },
                        body: JSON.stringify({ urls: urls, webhook: webhook, format: format })
                    });
                    const d = await res.json();
                    if (res.status === 403) { if (o) o.innerHTML = monErrHtml(t.monKeyBad); return; }
                    if (!res.ok || d.error) {
                        let msg = t.loadFailed;
                        if (d.error === 'key_not_set') msg = t.monKeyNeeded;
                        else if (d.error === 'bad_url' || d.error === 'bad_webhook') msg = t.monBadUrl;
                        else if (d.error === 'too_many_urls') msg = t.monMax;
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

            async function loadSpeedHistory() {
                const panel = document.getElementById('speed-history-panel');
                if (!panel) return;
                if (!(window.__NETDIAG__ && window.__NETDIAG__.speedHistoryKv)) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-database"></i> ' + i18n[currentLang].historyKvOff + '</div>';
                    return;
                }
                try {
                    const res = await fetch('/api/speed-history?limit=5');
                    const records = await res.json();
                    if (!records || records.length === 0) {
                        panel.innerHTML = '<div class="no-data"><i class="fas fa-inbox"></i> <span id="t-no-records">' + i18n[currentLang].noRecords + '</span></div>';
                        return;
                    }
                    let html = '<table class="speed-history-table"><thead><tr><th>' + i18n[currentLang].historyTitle + '</th><th>' + i18n[currentLang].historyAvgSpeed + '</th><th>' + i18n[currentLang].historyNode + '</th></tr></thead><tbody>';
                    const maxSpeed = Math.max(...records.map(r => Number.isFinite(Number(r.avgSpeed)) ? Number(r.avgSpeed) : 0), 1);
                    records.forEach(r => {
                        const d = new Date(r.timestamp);
                        const time = d.toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                        const avg = Number.isFinite(Number(r.avgSpeed)) ? Number(r.avgSpeed) : 0;
                        const pct = Math.min((avg / maxSpeed) * 100, 100);
                        let cls = avg > 50 ? 'speed-good' : (avg > 10 ? 'speed-mid' : 'speed-low');
                        html += '<tr><td>' + escapeHTML(time) + '</td><td><span class="speed-bar" style="width:' + pct + 'px"></span><span class="' + cls + '">' + avg.toFixed(1) + ' Mbps</span></td><td>' + escapeHTML(r.colo || 'N/A') + '</td></tr>';
                    });
                    html += '</tbody></table>';
                    panel.innerHTML = html;
                } catch (e) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> ' + i18n[currentLang].loadFailed + '</div>';
                }
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
                if (elements.copyBtn) elements.copyBtn.addEventListener('click', copyReport);
                renderToolCards();
                
                loadSpeedHistory();
                loadUsageStats();
                let statsInterval = setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        clearInterval(statsInterval);
                        rttTestRunning = false;
                    } else {
                        clearInterval(statsInterval);
                        loadSpeedHistory(); loadUsageStats();
                        statsInterval = setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);
                        if (!rttTestRunning) { rttTestRunning = true; testRtt(); }
                    }
                });

                // 语言按钮绑定
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        setLang(this.getAttribute('data-lang'));
                    });
                });

                // 标签切换
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const target = this.getAttribute('data-tab');
                        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === this));
                        document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + target));
                        if (target === 'overview') setTimeout(resizeCanvas, 30);
                    });
                });

            }
            
            init();
        })();
    `;

// ==================== 主请求处理 ====================
async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);
  const cache = caches.default;
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  
  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }
  
  // 限流检查（跳过静态资源；/health 使用独立配额，RTT/丢包轮询不挤占工具请求额度）
  const rateLimitExempt = url.pathname.startsWith('/static/') || UNLIMITED_PATHS.has(url.pathname);
  if (!rateLimitExempt) {
    const limited = url.pathname === '/health'
      ? isRateLimited(clientIp, HEALTH_RATE_MAX, 60000, healthRateLimit)
      : isRateLimited(clientIp);
    if (limited) {
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

  // 自动用量记录（仅统计白名单端点；内存聚合 + 定时落盘，刻意限制 KV 写入频率）
  if (COUNTED_ENDPOINTS.has(url.pathname)) {
    event.waitUntil(recordUsage(url.pathname));
  }
  
  // ==================== 健康检查端点 ====================
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      version: '4.6.0',
      storage: { usageBackend: USAGE_BACKEND, speedHistoryKv: SPEED_HISTORY_KV_ENABLED },
      note: 'Cloudflare Workers are stateless; per-request context only'
    }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS
      }
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
    const manifest = {
      name: 'NetSight Pro',
      short_name: 'NetSight Pro',
      description: 'Aurora Diagnostics - Real-time Network Analysis',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0a0b0d',
      theme_color: '#0a0b0d',
      lang: 'zh-CN',
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
  if (url.pathname === '/sw.js') {
    const swSrc = "self.addEventListener('install', function(e){ self.skipWaiting(); });\n" +
      "self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });\n" +
      "self.addEventListener('fetch', function(e){ /* 网络直通：诊断数据实时优先，不做离线缓存 */ });\n";
    return new Response(swSrc, {
      headers: { 'content-type': 'application/javascript;charset=UTF-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }
    });
  }
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    const clientIP = request.headers.get('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    let cpulimit = cpuRateLimit.get(clientIP);
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
    cpuRateLimit.set(clientIP, cpulimit);
    if (cpuRateLimit.size > 5000 || Math.random() < 0.05) {
      cleanupRateLimit();
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
  
  // ==================== DNS 代理测试端点 ====================
  if (url.pathname === '/dns-proxy') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
      if (dnsLookupCache.size > 300) dnsLookupCache.clear();
      dnsLookupCache.set(dnsKey, { at: nowMs, data: payload });
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    const results = [];
    for (const zone of zones) {
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
      results.push(entry);
    }
    const blPayload = { ip: ipRaw, results, checkedAt: nowDnsbl };
    if (dnsblCache.size > 300) dnsblCache.clear();
    dnsblCache.set(ipRaw, { at: nowDnsbl, data: blPayload });
    return new Response(JSON.stringify(blPayload), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== DNS 多解析器对比端点 ====================
  if (url.pathname === '/api/dns-compare') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    const resolverDefs = [
      { id: 'cloudflare', label: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(cName) + '&type=' + cType },
      { id: 'google', label: 'Google', url: 'https://dns.google/resolve?name=' + encodeURIComponent(cName) + '&type=' + cType },
      { id: 'quad9', label: 'Quad9', url: 'https://dns.quad9.net:5053/dns-query?name=' + encodeURIComponent(cName) + '&type=' + cType },
      { id: 'alidns', label: 'AliDNS', url: 'https://dns.alidns.com/resolve?name=' + encodeURIComponent(cName) + '&type=' + cType }
    ];
    const cmpResults = await Promise.all(resolverDefs.map(async (rv) => {
      const t0 = Date.now();
      const out = { id: rv.id, label: rv.label, status: 'error', time: 0, answers: [], error: null };
      try {
        const r = await fetch(rv.url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
        out.time = Date.now() - t0;
        if (!r.ok) { out.error = 'http_' + r.status; return out; }
        const d = await r.json();
        out.status = d.Status === 0 ? 'ok' : (d.Status === 3 ? 'nxdomain' : ('rcode_' + d.Status));
        out.answers = (Array.isArray(d.Answer) ? d.Answer : []).slice(0, 20).map(a => ({
          type: a.type,
          ttl: a.TTL,
          data: String(a.data === undefined ? '' : a.data).slice(0, 300)
        }));
        return out;
      } catch (e) {
        out.time = Date.now() - t0;
        out.error = 'unreachable';
        return out;
      }
    }));
    const sigMap = {};
    for (const r of cmpResults) {
      if (r.status !== 'ok') continue;
      const sig = r.answers.map(a => a.data.toLowerCase().replace(/\.$/, '')).sort().join(' | ') || '(empty)';
      if (!sigMap[sig]) sigMap[sig] = [];
      sigMap[sig].push(r.id);
    }
    const groups = Object.keys(sigMap).map(sig => ({ sig: sig, resolvers: sigMap[sig], count: sigMap[sig].length })).sort((a, b) => b.count - a.count);
    const payload = { name: cName, type: cType, resolvers: cmpResults, groups: groups, consistent: groups.length <= 1 };
    if (dnsLookupCache.size > 300) dnsLookupCache.clear();
    dnsLookupCache.set(cKey, { at: nowCmp, data: payload });
    return cmpJson(payload);
  }

  // ==================== 网络可达性探测端点（边缘侧） ====================
  if (url.pathname === '/api/reach-check') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    const reachKey = 'reach:v1';
    const nowReach = Date.now();
    const reachHit = dnsLookupCache.get(reachKey);
    if (reachHit && nowReach - reachHit.at < 60000) {
      return new Response(JSON.stringify(reachHit.data), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const edge = await Promise.all(REACH_TARGETS.map(async (tg) => {
      const t0 = Date.now();
      const out = { id: tg.id, label: tg.label, ok: false, status: null, time: 0 };
      try {
        const r = await fetch(tg.url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'NetSight-Pro/1.0' }, signal: AbortSignal.timeout(6000) });
        out.status = r.status;
        out.ok = r.status > 0 && r.status < 500;
        try { if (r.body) await r.body.cancel(); } catch (e) {}
      } catch (e) {
        out.status = null;
      }
      out.time = Date.now() - t0;
      return out;
    }));
    const reachPayload = { targets: REACH_TARGETS.map(t => ({ id: t.id, label: t.label, url: t.url })), edge: edge, checkedAt: nowReach };
    if (dnsLookupCache.size > 300) dnsLookupCache.clear();
    dnsLookupCache.set(reachKey, { at: nowReach, data: reachPayload });
    return new Response(JSON.stringify(reachPayload), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }

  // ==================== 域名安全体检端点（MX/SPF/DMARC/DKIM + 声誉） ====================
  if (url.pathname === '/api/domain-check') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    const [mxRes, txtRes, dmarcRes, dkimRes, dblRes, surblRes] = await Promise.all([
      doh(domain, 'MX'),
      doh(domain, 'TXT'),
      doh('_dmarc.' + domain, 'TXT'),
      selector ? doh(selector + '._domainkey.' + domain, 'TXT') : null,
      doh(domain + '.dbl.spamhaus.org', 'A'),
      doh(domain + '.multi.surbl.org', 'A')
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
    const score = max > 0 ? Math.round((raw / max) * 100) : 0;
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
    const payload = { domain: domain, selector: selector, mx: mx, spf: spf, dmarc: dmarc, dkim: dkim, blocklists: blocklists, score: score, grade: grade, issues: issues };
    if (dnsLookupCache.size > 300) dnsLookupCache.clear();
    dnsLookupCache.set(dcKey, { at: nowDc, data: payload });
    return jsonOut(payload);
  }

  // ==================== 站点监控端点（配置 / 状态 / 立即巡检） ====================
  if (url.pathname === '/api/monitor' || url.pathname === '/api/monitor-run') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    const jsonOut = (data, status = 200) => new Response(JSON.stringify(data), {
      status: status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
    const kv = monitorKv();
    if (!kv) return jsonOut({ error: 'kv_missing' }, 503);
    const adminKey = (typeof MONITOR_ADMIN_KEY !== 'undefined' && MONITOR_ADMIN_KEY) ? String(MONITOR_ADMIN_KEY) : '';
    if (!adminKey) return jsonOut({ error: 'key_not_set' }, 503);
    const reqKey = request.headers.get('x-admin-key') || url.searchParams.get('key') || '';
    if (reqKey !== adminKey) return jsonOut({ error: 'bad_key' }, 403);
    if (url.pathname === '/api/monitor' && request.method === 'GET') {
      let config = null, state = {}, log = [];
      try { const raw = await kv.get('monitor:config'); if (raw) config = JSON.parse(raw); } catch (e) {}
      try { const raw = await kv.get('monitor:state'); if (raw) state = JSON.parse(raw); } catch (e) {}
      try { const raw = await kv.get('monitor:log'); if (raw) log = JSON.parse(raw); } catch (e) {}
      return jsonOut({ ok: true, config: config, state: state, log: log });
    }
    if (url.pathname === '/api/monitor' && request.method === 'POST') {
      let body = null;
      try { body = await request.json(); } catch (e) {}
      if (!body || typeof body !== 'object') return jsonOut({ error: 'bad_body' }, 400);
      const urlsIn = Array.isArray(body.urls) ? body.urls : [];
      if (urlsIn.length > 10) return jsonOut({ error: 'too_many_urls' }, 400);
      const urls = [];
      for (const u of urlsIn) {
        const s = String(u || '').trim();
        if (!s) continue;
        if (s.length > 300) return jsonOut({ error: 'bad_url', detail: s.slice(0, 120) }, 400);
        let ok = false;
        try { const p = new URL(s); ok = (p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.includes('.'); } catch (e) {}
        if (!ok) return jsonOut({ error: 'bad_url', detail: s.slice(0, 120) }, 400);
        urls.push(s);
      }
      const webhook = String(body.webhook || '').trim().slice(0, 500);
      if (webhook) {
        let ok = false;
        try { const p = new URL(webhook); ok = (p.protocol === 'https:' || p.protocol === 'http:'); } catch (e) {}
        if (!ok) return jsonOut({ error: 'bad_webhook' }, 400);
      }
      const format = ['generic', 'dingtalk', 'feishu', 'wecom'].includes(body.format) ? body.format : 'generic';
      await kv.put('monitor:config', JSON.stringify({ urls: urls, webhook: webhook, format: format, updatedAt: Date.now() }));
      return jsonOut({ ok: true, urls: urls, webhook: webhook, format: format });
    }
    if (url.pathname === '/api/monitor-run' && request.method === 'POST') {
      let cfg = null;
      try { const raw = await kv.get('monitor:config'); if (raw) cfg = JSON.parse(raw); } catch (e) {}
      if (!cfg || !Array.isArray(cfg.urls) || cfg.urls.length === 0) return jsonOut({ error: 'no_config' }, 400);
      const result = await handleMonitorCheck();
      return jsonOut({ ok: true, result: result });
    }
    return jsonOut({ error: 'method_not_allowed' }, 405);
  }
  
  // ==================== 站点体检端点（HTTP 安全头审计） ====================
  if (url.pathname === '/api/site-audit') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    const target = url.searchParams.get('url') || '';
    let parsed;
    try { parsed = new URL(target); } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHost(parsed.hostname) || !(await resolvesToPublicOnly(parsed.hostname))) {
      return new Response(JSON.stringify({ error: 'forbidden target' }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
    const auditStart = Date.now();
    let current = parsed.href;
    let resp = null;
    let ttfb = 0;
    let redirectCount = 0;
    try {
      for (let hop = 0; hop < 6; hop++) {
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
          if (!['http:', 'https:'].includes(next.protocol) || isPrivateHost(next.hostname) || !(await resolvesToPublicOnly(next.hostname))) break;
          current = next.href;
          redirectCount++;
          continue;
        }
        break;
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'fetch failed' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
      });
    }
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    const cf = request.cf || {};
    const protocol = cf.httpProtocol || 'N/A';
    const isHttp2 = protocol.includes('HTTP/2');
    const isHttp3 = protocol.toUpperCase().includes('HTTP/3');
    const acceptEarlyHints = request.headers.get('Accept-Early-Hints');
    
    let tlsProtocol = 'N/A';
    if (cf.tlsVersion) {
      tlsProtocol = cf.tlsVersion;
    }
    
    return new Response(JSON.stringify({
      http2: isHttp2,
      http3: isHttp3,
      protocol: protocol,
      tlsVersion: tlsProtocol,
      earlyHints: acceptEarlyHints === 'early-hints',
      supportsEarlyHints: acceptEarlyHints !== null,
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    try {
      const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10);
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 10240) {
        return new Response(JSON.stringify({ ok: false, error: 'payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json', ...corsHeaders(request, 'POST, OPTIONS'), ...SECURITY_HEADERS }
        });
      }
      const body = await request.json();
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
        // 限制 KV 写入：同一客户端在 SPEED_LOG_MIN_INTERVAL_MS 内只落盘一次，避免高频 POST 放大写入
        const nowTs = Date.now();
        const lastLog = speedLogThrottle.get(clientIp) || 0;
        if (nowTs - lastLog >= SPEED_LOG_MIN_INTERVAL_MS) {
          speedLogThrottle.set(clientIp, nowTs);
          if (speedLogThrottle.size > 5000) speedLogThrottle.clear();
          const key = `speed:${record.timestamp}`;
          await SPEED_HISTORY.put(key, JSON.stringify(record), { expirationTtl: 86400 * 7 });
          const allKeys = await SPEED_HISTORY.list({ prefix: 'speed:' });
          if (allKeys.keys.length > 5) {
            const sorted = allKeys.keys.sort((a, b) => b.name.localeCompare(a.name));
            for (const k of sorted.slice(5)) {
              await SPEED_HISTORY.delete(k.name);
            }
          }
          invalidateStatsCache();
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
    const limit = clampInt(url.searchParams.get('limit'), 10, 1, 20);
    let records = getStatsCache('speed:' + limit);
    if (!records) {
      records = [];
      if (SPEED_HISTORY_KV_ENABLED && typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
        const list = await SPEED_HISTORY.list({ prefix: 'speed:', limit: limit });
        for (const key of list.keys) {
          try {
            const val = await SPEED_HISTORY.get(key.name);
            if (val) records.push(JSON.parse(val));
          } catch (e) {}
        }
        records.sort((a, b) => b.timestamp - a.timestamp);
      }
      setStatsCache('speed:' + limit, records);
    }
    
    return new Response(JSON.stringify(records.slice(0, limit)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(request), ...SECURITY_HEADERS }
    });
  }
  
  // ==================== 用量统计 (GET) ====================
  if (url.pathname === '/api/usage-stats') {
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
    if (!isSameOriginNavigation(request)) return forbiddenResponse(request);
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
  
  // ==================== 主诊断页面 ====================
  const workerStart = Date.now();
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
    tlsClientJa4: escapeHtml(cf.tlsClientJa4 || 'N/A')
  };
  
  const acceptLang = request.headers.get('accept-language') || '';
  let defaultLang = 'en';
  if (acceptLang.match(/zh-(CN|SG|MY)/i)) defaultLang = 'zh-CN';
  else if (acceptLang.match(/zh/i)) defaultLang = 'zh-TW';
  else if (acceptLang.match(/en/i)) defaultLang = 'en';
  
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
  // connect-src 保留 'https:' 的取舍：多节点测速需由浏览器直连用户输入的任意节点 URL；
  // 站点可达性/流媒体探测走 img-src 白名单（不受 connect-src 影响）。如需收紧可改为具体域名列表。
  const cspHeader = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' https:; img-src 'self' data: https://cloudflare.com https://www.google.com https://github.com https://www.netflix.com https://www.disneyplus.com https://www.youtube.com https://chat.openai.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';`;

  // ============================================================
  // 开始 HTML 模板（全界面国际化 + 美化）
  // ============================================================
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="apple-touch-icon" href="/icon-192.png">
    <meta name="theme-color" content="#0a0b0d">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="NetSight Pro">
    <title>NetSight Pro | 极光网络诊断</title>
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
                    <h1>NetSight Pro</h1>
                    <p><i class="fas fa-bolt"></i> <span id="t-subtitle">极光诊断 · 实时网络分析</span></p>
                </div>
            </div>
            <div class="header-right">
                <button class="theme-toggle" id="themeToggle" title="切换主题"><i class="fas fa-moon"></i></button>
                <div class="lang-switcher">
                    <button class="lang-btn" data-lang="en">EN</button>
                    <button class="lang-btn" data-lang="zh-CN">简体</button>
                    <button class="lang-btn" data-lang="zh-TW">繁體</button>
                </div>
            </div>
        </div>

        <!-- ==================== 标签导航 ==================== -->
        <div class="tab-nav">
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
                        <div class="rtt-value" id="rtt-num">--</div>
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
                        <span class="quality-value" id="loss-rate" style="color: var(--chart-green);">0%</span>
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
                        <h3><span id="t-history-title">测速历史</span></h3>
                        <p><span id="t-history-sub">最近 10 条带宽测速记录</span></p>
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
            <span class="copy-btn" id="copy-report"><i class="fas fa-copy"></i> <span id="t-copy">复制报告</span></span>
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
    <div class="modal-overlay" id="nodeModal">
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

    <!-- ====== 工具结果弹层 ====== -->
    <div class="modal-overlay" id="toolModal">
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
            <div class="tool-modal-body" id="toolModalBody"></div>
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
        window.__NETDIAG__ = { usageBackend: '${USAGE_BACKEND}', speedHistoryKv: ${SPEED_HISTORY_KV_ENABLED} };
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
      ...SECURITY_HEADERS,
      'server-timing': `worker;dur=${workerDuration}`
    }
  });
}
