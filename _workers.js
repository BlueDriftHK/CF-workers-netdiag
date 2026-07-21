// ============================================================
// NetSight Pro - Apple 极简网络诊断工具
// Cloudflare Worker 完整优化版 | 全界面国际化 + 深色/浅色切换
// 版本: 4.1 | 完整语言覆盖
// ============================================================

// ==================== 常量定义 ====================
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
  'vary': 'Origin'
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-xss-protection': '1; mode=block',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload'
};

// 简单的限流实现
const rateLimit = new Map();
const cpuRateLimit = new Map();

function cleanupRateLimit() {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [ip, timestamps] of rateLimit.entries()) {
    const valid = timestamps.filter(t => now - t < 60000);
    if (valid.length === 0) {
      rateLimit.delete(ip);
      cleanedCount++;
    } else {
      rateLimit.set(ip, valid);
    }
  }
  return cleanedCount;
}

function isRateLimited(ip, maxRequests = 60, windowMs = 60000) {
  const now = Date.now();
  const requests = rateLimit.get(ip) || [];
  const recent = requests.filter(t => now - t < windowMs);
  
  if (recent.length >= maxRequests) return true;
  
  recent.push(now);
  rateLimit.set(ip, recent);
  
  if (rateLimit.size > 10000 || (rateLimit.size > 0 && Math.random() < 0.05)) {
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

function escapeForJS(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/&/g, '\\x26');
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

// 处理 OPTIONS 预检请求
function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const headers = {
    ...CORS_HEADERS,
    'access-control-max-age': '86400',
    ...SECURITY_HEADERS
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
  }
  return new Response(null, {
    status: 204,
    headers
  });
}

// ==================== IP 欺诈评分函数 ====================
async function getIpFraudScore(ip) {
  if (!ip || ip === 'unknown') return null;
  try {
    const url = `https://scamalytics.com/api/ip/${ip}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      score: data.score !== undefined ? data.score : null,
      isProxy: data.is_proxy || false,
      isVpn: data.is_vpn || false,
      isTor: data.is_tor || false,
      isHosting: data.is_hosting || false,
      riskLevel: data.score >= 80 ? 'high' : (data.score >= 50 ? 'medium' : 'low')
    };
  } catch (e) {
    return null;
  }
}

// ==================== 主请求处理 ====================
async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);
  const cache = caches.default;
  const clientIp = request.headers.get('cf-connecting-ip') || 
                   request.headers.get('x-forwarded-for') || 
                   'unknown';
  
  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }
  
  // 限流检查（跳过静态资源和主页面）
  if (!url.pathname.startsWith('/static/') && url.pathname !== '/') {
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({
        error: 'Too Many Requests',
        message: '请稍后再试 / Please try again later'
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '60',
          ...CORS_HEADERS,
          ...SECURITY_HEADERS
        }
      });
    }
  }
  
  // ==================== 健康检查端点 ====================
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      version: '4.1',
      uptime: performance.timeOrigin ? Date.now() - performance.timeOrigin : 'unknown'
    }), {
      headers: {
        'content-type': 'application/json',
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 静态资源缓存 ====================
  if (url.pathname.startsWith('/static/')) {
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
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
        event.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
  
  // ==================== 速度测试端点 ====================
  if (url.pathname === '/speedtest') {
    const size = Math.min(parseInt(url.searchParams.get('size')) || 102400, 5242880);
    const data = fillRandom(new Uint8Array(size));
    return new Response(data, {
      headers: {
        'content-type': 'application/octet-stream',
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 上传速度测试端点 ====================
  if (url.pathname === '/upload-test' && request.method === 'POST') {
    const start = Date.now();
    const body = await request.arrayBuffer();
    const duration = Date.now() - start;
    const bytes = body.byteLength;
    const speedMbps = duration > 0 ? ((bytes * 8) / (duration / 1000)) / 1000000 : 0;
    return new Response(JSON.stringify({
      bytes: bytes,
      duration: duration,
      speedMbps: Math.round(speedMbps * 100) / 100
    }), {
      headers: {
        'content-type': 'application/json',
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== CPU 密集型测试端点 ====================
  if (url.pathname === '/cpu-test') {
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
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
        headers: { 'content-type': 'application/json', 'retry-after': String(Math.ceil((cpulimit.resetTime - now) / 1000)), ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    cpulimit.count++;
    cpuRateLimit.set(clientIP, cpulimit);

    const iterations = Math.min(parseInt(url.searchParams.get('n')) || 500000, 500000);
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
      result: result.toString().substring(0, 8)
    }), {
      headers: {
        'content-type': 'application/json',
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== DNS 代理测试端点 ====================
  if (url.pathname === '/dns-proxy') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'missing url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    
    let hostname;
    try { hostname = new URL(targetUrl).hostname; } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    
    const allowed = ['cloudflare.com', 'google.com', 'github.com'];
    if (!allowed.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return new Response(JSON.stringify({ error: 'forbidden domain' }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    
    const start = Date.now();
    let status = null;
    try {
      const res = await fetch(targetUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      status = res.status;
    } catch (e) {
      const time = Date.now() - start;
      return new Response(JSON.stringify({ time, status: null, error: 'fetch failed' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    const time = Date.now() - start;
    return new Response(JSON.stringify({ time, status }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS, ...SECURITY_HEADERS }
    });
  }
  
  // ==================== WebSocket 测试端点 ====================
  if (url.pathname === '/ws-test') {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('需要 WebSocket 升级', { status: 426 });
    }
    
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    server.accept();
    
    let pingInterval;
    let heartbeatInterval;
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
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  // ==================== HTTP/2 + Early Hints 检测端点 ====================
  if (url.pathname === '/http2-test') {
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
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 多文件并发下载测试 ====================
  if (url.pathname === '/concurrent-test') {
    const count = Math.min(parseInt(url.searchParams.get('count')) || 4, 16);
    const size = Math.min(parseInt(url.searchParams.get('size')) || 1024, 65536);
    
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
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 大文件流式传输测试 ====================
  if (url.pathname === '/stream-test') {
    const size = Math.min(parseInt(url.searchParams.get('size')) || 1048576, 10485760);
    const chunkSize = 65536;
    
    let controllerRef;
    let cancelled = false;
    
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        let sent = 0;
        
        const pushChunk = () => {
          if (cancelled || sent >= size) {
            if (!cancelled) controller.close();
            return;
          }
          
          const remaining = size - sent;
          const currentChunk = Math.min(remaining, chunkSize);
          const chunk = fillRandom(new Uint8Array(currentChunk));
          
          try {
            controller.enqueue(chunk);
            sent += currentChunk;
            
            if (sent < size) {
              if (controller.desiredSize > 0) {
                queueMicrotask(pushChunk);
              } else {
                const waitForDrain = () => {
                  if (cancelled) return;
                  if (controller.desiredSize > 0) {
                    pushChunk();
                  } else {
                    setTimeout(waitForDrain, 10);
                  }
                };
                waitForDrain();
              }
            } else {
              controller.close();
            }
          } catch (e) {
            if (!cancelled) controller.error(e);
          }
        };
        
        pushChunk();
      },
      
      cancel() {
        cancelled = true;
        if (controllerRef) {
          try {
            controllerRef.close();
          } catch (e) {}
        }
      }
    });
    
    return new Response(stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': size.toString(),
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== 测速历史记录 (POST) ====================
  if (url.pathname === '/api/log-speed' && request.method === 'POST') {
    try {
      const body = await request.json();
      const record = {
        timestamp: Date.now(),
        avgSpeed: parseFloat(body.avgSpeed) || 0,
        results: body.results || [],
        colo: (request.cf || {}).colo || 'N/A',
        asn: (request.cf || {}).asn || 'N/A'
      };
      
      if (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
        const key = `speed:${record.timestamp}`;
        await SPEED_HISTORY.put(key, JSON.stringify(record), { expirationTtl: 86400 * 7 });
        const allKeys = await SPEED_HISTORY.list({ prefix: 'speed:' });
        if (allKeys.keys.length > 5) {
          const sorted = allKeys.keys.sort((a, b) => b.name.localeCompare(a.name));
          for (const k of sorted.slice(5)) {
            await SPEED_HISTORY.delete(k.name);
          }
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid data' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
  }
  
  // ==================== 测速历史查询 (GET) ====================
  if (url.pathname === '/api/speed-history') {
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
    const records = [];
    
    if (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
      const list = await SPEED_HISTORY.list({ prefix: 'speed:', limit: limit });
      for (const key of list.keys) {
        try {
          const val = await SPEED_HISTORY.get(key.name);
          if (val) records.push(JSON.parse(val));
        } catch (e) {}
      }
      records.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    return new Response(JSON.stringify(records.slice(0, limit)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS, ...SECURITY_HEADERS }
    });
  }
  
  // ==================== 用量统计 (GET) ====================
  if (url.pathname === '/api/usage-stats') {
    let stats = { totalRequests: 0, endpoints: {}, lastReset: 0 };
    
    if (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY) {
      try {
        const raw = await SPEED_HISTORY.get('usage:stats');
        if (raw) stats = JSON.parse(raw);
      } catch (e) {}
    }
    
    return new Response(JSON.stringify(stats), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS, ...SECURITY_HEADERS }
    });
  }
  
  // ==================== IP 欺诈评分端点 ====================
  if (url.pathname === '/api/ip-fraud') {
    const ip = clientIp;
    const fraudData = await getIpFraudScore(ip);
    if (!fraudData) {
      return new Response(JSON.stringify({ error: '无法获取风险数据' }), {
        status: 503,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...SECURITY_HEADERS }
      });
    }
    return new Response(JSON.stringify(fraudData), {
      headers: {
        'content-type': 'application/json',
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // 自动用量记录（非主页面和静态资源的请求）
  event.waitUntil((async () => {
    if (typeof SPEED_HISTORY !== 'undefined' && SPEED_HISTORY && url.pathname !== '/' && !url.pathname.startsWith('/static/')) {
      try {
        const raw = await SPEED_HISTORY.get('usage:stats');
        let stats = raw ? JSON.parse(raw) : { totalRequests: 0, endpoints: {}, lastReset: 0 };
        stats.totalRequests = (stats.totalRequests || 0) + 1;
        const ep = url.pathname;
        stats.endpoints[ep] = (stats.endpoints[ep] || 0) + 1;
        if (!stats.lastReset) stats.lastReset = Date.now();
        await SPEED_HISTORY.put('usage:stats', JSON.stringify(stats), { expirationTtl: 86400 * 30 });
      } catch (e) {}
    }
  })());
  
  // ==================== 主诊断页面 ====================
  const workerStart = Date.now();
  const cf = request.cf || {};
  
  const lat = parseFloat(cf.latitude) || 0;
  const lon = parseFloat(cf.longitude) || 0;
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
    httpProtocolRaw: cf.httpProtocol || 'N/A',
    latNum: lat,
    lonNum: lon,
    tlsClientHelloLength: cf.tlsClientHelloLength || 0,
    httpVersion: request.cf?.httpProtocol || 'N/A',
    tlsClientAuth: cf.tlsClientAuth?.certPresent ? 'YES' : 'NO',
    requestPriority: request.headers.get('priority') || 'N/A',
    tlsClientJa3: escapeForJS(cf.tlsClientJa3 || 'N/A'),
    tlsClientJa4: escapeForJS(cf.tlsClientJa4 || 'N/A')
  };
  
  const acceptLang = request.headers.get('accept-language') || '';
  let defaultLang = 'en';
  if (acceptLang.match(/zh-(CN|SG|MY)/i)) defaultLang = 'zh-CN';
  else if (acceptLang.match(/zh/i)) defaultLang = 'zh-TW';
  else if (acceptLang.match(/en/i)) defaultLang = 'en';
  
  const workerDuration = Date.now() - workerStart;
  
  // 服务端直接查询真实客户端 IP 的地理位置
  let realGeoData = null;
  if (clientIp && clientIp !== 'unknown') {
    try {
      const geoRes = await fetch(`https://ipapi.co/${clientIp}/json/`, {
        headers: { 'User-Agent': 'Cloudflare-Worker/1.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (geoRes.ok) {
        const geoJson = await geoRes.json();
        if (!geoJson.error) {
          realGeoData = {
            city: geoJson.city,
            regionName: geoJson.region,
            country: geoJson.country_name,
            countryCode: geoJson.country_code,
            lat: geoJson.latitude,
            lon: geoJson.longitude,
            org: geoJson.org,
            query: geoJson.ip || clientIp
          };
        }
      }
    } catch (e) {
      // 静默失败
    }
  }
  
  const realGeo = realGeoData || {};
  const realGeoJS = {
    city: escapeForJS(realGeo.city || cf.city || ''),
    region: escapeForJS(realGeo.regionName || cf.region || ''),
    country: escapeForJS(realGeo.country || cf.country || ''),
    countryCode: escapeForJS(realGeo.countryCode || ''),
    lat: realGeo.lat || cf.latitude || 0,
    lon: realGeo.lon || cf.longitude || 0,
    org: escapeForJS(realGeo.org || cf.asOrganization || ''),
    ip: escapeForJS(realGeo.query || clientIp)
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
  const cspHeader = `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' https://ipapi.co https://api4.ipify.org https://api6.ipify.org https://ipv4.icanhazip.com https://ipv6.icanhazip.com https://ip4.seeip.org https://scamalytics.com; img-src 'self' data: https://www.netflix.com https://www.disneyplus.com https://www.youtube.com https://chat.openai.com;`;

  // ============================================================
  // 开始 HTML 模板（全界面国际化 + 美化）
  // ============================================================
  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="auto">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>NetSight Pro | 极光网络诊断</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg-primary: #f0f2f5;
            --bg-mesh: radial-gradient(ellipse at 20% 0%, rgba(120,180,255,0.15) 0%, transparent 50%),
                       radial-gradient(ellipse at 80% 100%, rgba(180,120,255,0.1) 0%, transparent 50%),
                       radial-gradient(ellipse at 50% 50%, rgba(255,180,120,0.05) 0%, transparent 60%);
            --glass-bg: rgba(255,255,255,0.55);
            --glass-bg-hover: rgba(255,255,255,0.7);
            --glass-heavy: rgba(255,255,255,0.72);
            --glass-border: rgba(255,255,255,0.6);
            --glass-border-outer: rgba(0,0,0,0.06);
            --glass-highlight: linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 50%);
            --glass-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6);
            --glass-shadow-lg: 0 20px 60px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.7);
            --text-primary: #1d1d1f;
            --text-secondary: #6e6e73;
            --text-tertiary: #aeaeb2;
            --text-quaternary: #c7c7cc;
            --accent: #007AFF;
            --accent-hover: #0066d6;
            --accent-light: rgba(0,122,255,0.08);
            --accent-glass: rgba(0,122,255,0.06);
            --success: #30d158;
            --success-light: rgba(48,209,88,0.1);
            --warning: #ff9f0a;
            --warning-light: rgba(255,159,10,0.1);
            --danger: #ff3b30;
            --danger-light: rgba(255,59,48,0.08);
            --border: rgba(0,0,0,0.06);
            --border-accent: rgba(0,122,255,0.15);
            --divider: rgba(0,0,0,0.05);
            --radius-sm: 14px; --radius-md: 18px; --radius-lg: 22px; --radius-xl: 28px;
            --transition-fast: 0.2s cubic-bezier(0.25,0.1,0.25,1);
            --transition-smooth: 0.35s cubic-bezier(0.25,0.1,0.25,1);
            --chart-cyan: #32ade6; --chart-green: #30d158; --chart-teal: #64d2ff;
            --font: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
        }
        [data-theme="auto"] {
            --bg-primary: #000000;
            --bg-mesh: radial-gradient(ellipse at 20% 0%, rgba(60,100,180,0.12) 0%, transparent 50%),
                       radial-gradient(ellipse at 80% 100%, rgba(100,60,180,0.08) 0%, transparent 50%),
                       radial-gradient(ellipse at 50% 50%, rgba(180,100,60,0.04) 0%, transparent 60%);
            --glass-bg: rgba(44,44,46,0.55);
            --glass-bg-hover: rgba(58,58,60,0.65);
            --glass-heavy: rgba(44,44,46,0.72);
            --glass-border: rgba(255,255,255,0.12);
            --glass-border-outer: rgba(255,255,255,0.06);
            --glass-highlight: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 50%);
            --glass-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08);
            --glass-shadow-lg: 0 20px 60px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
            --text-primary: #f5f5f7;
            --text-secondary: #a1a1a6;
            --text-tertiary: #636366;
            --text-quaternary: #48484a;
            --accent: #0A84FF;
            --accent-hover: #409cff;
            --accent-light: rgba(10,132,255,0.12);
            --accent-glass: rgba(10,132,255,0.08);
            --success: #30d158;
            --success-light: rgba(48,209,88,0.15);
            --warning: #ff9f0a;
            --warning-light: rgba(255,159,10,0.15);
            --danger: #ff453a;
            --danger-light: rgba(255,69,58,0.12);
            --border: rgba(255,255,255,0.08);
            --border-accent: rgba(10,132,255,0.2);
            --divider: rgba(255,255,255,0.06);
            --chart-cyan: #64d2ff; --chart-green: #30d158; --chart-teal: #6ac4dc;
        }
        html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body {
            font-family: var(--font);
            background: var(--bg-primary);
            min-height: 100vh;
            padding: 28px;
            color: var(--text-primary);
            position: relative;
            transition: background 0.4s ease, color 0.4s ease;
        }
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg-mesh);
            pointer-events: none; z-index: 0;
        }
        .container { max-width: 960px; margin: 0 auto; position: relative; z-index: 1; }

        .header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 18px 28px; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;
            background: var(--glass-heavy);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border-radius: var(--radius-xl);
            border: 1px solid var(--glass-border);
            box-shadow: var(--glass-shadow);
            position: relative; overflow: hidden;
        }
        .header::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
            background: var(--glass-highlight); pointer-events: none; border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        }
        .logo { display: flex; align-items: center; gap: 14px; position: relative; }
        .logo-icon {
            width: 48px; height: 48px;
            background: linear-gradient(135deg, var(--accent), #5856d6);
            border-radius: 14px;
            display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff;
            box-shadow: 0 4px 14px rgba(0,122,255,0.3), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .logo h1 { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; }
        .logo p { font-size: 12px; color: var(--text-secondary); margin-top: 2px; letter-spacing: 0.2px; }
        .header-right { display: flex; align-items: center; gap: 12px; position: relative; }
        .theme-toggle {
            background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 50px;
            padding: 8px 14px; cursor: pointer; font-size: 16px; line-height: 1;
            color: var(--text-secondary); transition: all var(--transition-fast);
            display: flex; align-items: center; gap: 6px;
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.4);
        }
        .theme-toggle:hover { background: var(--glass-bg-hover); box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.5); transform: scale(1.02); }
        .lang-switcher {
            display: flex; gap: 2px; background: var(--glass-bg); padding: 4px;
            border-radius: 12px; border: 1px solid var(--glass-border);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.06);
        }
        .lang-btn {
            background: transparent; border: none; color: var(--text-secondary);
            padding: 6px 14px; border-radius: 9px; cursor: pointer; font-size: 12px; font-weight: 500;
            font-family: var(--font); transition: all var(--transition-fast);
        }
        .lang-btn.active { background: #fff; color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8); font-weight: 600; }
        [data-theme="auto"] .lang-btn.active { background: rgba(255,255,255,0.12); }
        .lang-btn:hover:not(.active) { color: var(--text-primary); background: rgba(0,0,0,0.03); }

        .hero-card {
            background: var(--glass-heavy);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border-radius: var(--radius-xl); padding: 28px 32px; margin-bottom: 24px;
            border: 1px solid var(--glass-border); box-shadow: var(--glass-shadow-lg);
            position: relative; overflow: hidden;
        }
        .hero-card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 45%;
            background: var(--glass-highlight); pointer-events: none; border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        }
        .ip-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 16px; margin-bottom: 14px; position: relative; }
        .ip-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); min-width: 50px; }
        .ip-val { font-size: 28px; font-weight: 700; font-family: 'SF Mono', ui-monospace, monospace; color: var(--text-primary); word-break: break-all; letter-spacing: -0.5px; }
        .ip-val-small { font-size: 18px; color: var(--text-secondary); }
        .stats-row { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; position: relative; }
        .stat-item {
            display: flex; align-items: center; gap: 8px; font-size: 12px;
            padding: 7px 16px; background: var(--glass-bg); border-radius: 50px;
            border: 1px solid var(--glass-border); color: var(--text-secondary);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 2px 6px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.4);
        }
        .stat-item strong { color: var(--text-primary); font-weight: 600; }
        .stat-item i { color: var(--accent); font-size: 13px; }
        .live-dot {
            display: inline-block; width: 7px; height: 7px; border-radius: 50%;
            background: var(--success); animation: pulse 2s ease-in-out infinite; margin-right: 6px;
        }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.2)} }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 24px; }
        .rtt-card { grid-column: 1 / -1; min-height: 540px; display: flex; flex-direction: column; background: var(--glass-heavy); backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%); border: 1px solid var(--glass-border); box-shadow: var(--glass-shadow-lg); position: relative; overflow: hidden; }
        .rtt-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 40%; background: var(--glass-highlight); pointer-events: none; border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
        .rtt-card .card-body { flex: 1; display: flex; flex-direction: column; padding: 24px 28px; position: relative; }
        .card {
            background: var(--glass-bg);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border-radius: var(--radius-lg); border: 1px solid var(--glass-border); overflow: hidden;
            transition: all var(--transition-smooth); box-shadow: var(--glass-shadow);
            position: relative;
        }
        .card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 40%;
            background: var(--glass-highlight); pointer-events: none; border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        }
        .card:hover { box-shadow: var(--glass-shadow-lg); border-color: var(--border-accent); transform: translateY(-2px); }
        .card-header {
            padding: 18px 24px; border-bottom: 1px solid var(--divider);
            display: flex; align-items: center; gap: 14px; position: relative;
        }
        .card-header i { font-size: 22px; color: var(--accent); transition: transform 0.3s ease; }
        .card:hover .card-header i { transform: scale(1.08); }
        .card-header h3 { font-size: 15px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.2px; }
        .card-header p { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .card-body { padding: 20px 24px; position: relative; }
        .info-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 11px 0; border-bottom: 1px solid var(--divider);
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 10px; }
        .info-label i { font-size: 15px; width: 18px; color: var(--accent); opacity: 0.8; }
        .info-value { font-size: 13px; font-weight: 500; font-family: 'SF Mono', ui-monospace, monospace; color: var(--text-primary); }
        .badge {
            padding: 4px 12px; border-radius: 50px; font-size: 11px; font-weight: 600;
            display: inline-flex; align-items: center; gap: 5px;
        }
        .badge-success { background: var(--success-light); color: var(--success); border: 1px solid rgba(48,209,88,0.2); }
        .badge-warning { background: var(--warning-light); color: #b36b00; border: 1px solid rgba(255,159,10,0.2); }
        [data-theme="auto"] .badge-warning { color: var(--warning); }
        .badge-danger { background: var(--danger-light); color: var(--danger); border: 1px solid rgba(255,59,48,0.2); }
        .badge-info { background: var(--accent-light); color: var(--accent); border: 1px solid rgba(0,122,255,0.15); }
        .badge-purple { background: rgba(175,82,222,0.08); color: #8944ab; border: 1px solid rgba(175,82,222,0.15); }
        [data-theme="auto"] .badge-purple { color: #bf5af2; }

        .rtt-display { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-bottom: 22px; }
        .rtt-box {
            background: var(--glass-bg); border-radius: var(--radius-md); padding: 22px 16px;
            text-align: center; border: 1px solid var(--glass-border); transition: all var(--transition-smooth);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.4);
        }
        .rtt-box:hover { background: var(--glass-bg-hover); box-shadow: 0 4px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
        .rtt-value { font-size: 48px; font-weight: 700; color: var(--text-primary); line-height: 1.1; letter-spacing: -2px; }
        .rtt-label { font-size: 12px; color: var(--text-secondary); margin-top: 10px; letter-spacing: 0.2px; }
        .rtt-label i { margin-right: 4px; color: var(--accent); opacity: 0.7; }
        .chart-container {
            background: var(--glass-bg); border-radius: var(--radius-md); padding: 20px; margin: 18px 0;
            border: 1px solid var(--glass-border);
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.04);
        }
        canvas { width: 100%; height: 180px; }
        .quality-grid {
            display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-top: 18px;
            padding-top: 16px; border-top: 1px solid var(--divider);
        }
        .quality-card {
            background: var(--glass-bg); border-radius: var(--radius-sm); padding: 13px 15px;
            display: flex; align-items: center; justify-content: space-between;
            transition: all var(--transition-fast); border: 1px solid transparent;
        }
        .quality-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border); }
        .quality-label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 7px; }
        .quality-label i { font-size: 13px; color: var(--accent); opacity: 0.7; }
        .quality-value { font-size: 14px; font-weight: 600; }

        .button-group { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .btn {
            padding: 10px 20px; border-radius: 50px; font-size: 13px; font-weight: 500;
            border: none; cursor: pointer; transition: all var(--transition-fast);
            display: inline-flex; align-items: center; gap: 8px; font-family: var(--font); letter-spacing: -0.1px;
        }
        .btn i { transition: transform 0.2s ease; }
        .btn:hover i { transform: scale(1.12); }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 4px 14px rgba(0,122,255,0.3), inset 0 1px 0 rgba(255,255,255,0.2); }
        .btn-primary:hover { background: var(--accent-hover); box-shadow: 0 6px 20px rgba(0,122,255,0.4), inset 0 1px 0 rgba(255,255,255,0.2); transform: translateY(-1px); }
        .btn-outline { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); backdrop-filter: blur(10px); box-shadow: 0 2px 6px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.4); }
        .btn-outline:hover { background: var(--glass-bg-hover); box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .btn-cyan { background: linear-gradient(135deg, #007AFF, #5856d6); color: #fff; box-shadow: 0 4px 14px rgba(0,122,255,0.25), inset 0 1px 0 rgba(255,255,255,0.2); }
        .btn-cyan:hover { box-shadow: 0 6px 20px rgba(0,122,255,0.35); transform: translateY(-1px); }
        .btn-purple { background: linear-gradient(135deg, #5856d6, #af52de); color: #fff; box-shadow: 0 4px 14px rgba(88,86,214,0.25), inset 0 1px 0 rgba(255,255,255,0.2); }
        .btn-purple:hover { box-shadow: 0 6px 20px rgba(88,86,214,0.35); transform: translateY(-1px); }

        .result-area {
            margin-top: 14px; padding: 16px 20px; background: var(--glass-bg);
            border-radius: var(--radius-sm); font-size: 12px; border-left: 3px solid var(--accent);
            transition: all var(--transition-fast); color: var(--text-secondary);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .speed-result { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
        .speed-item {
            background: var(--accent-glass); border-radius: 10px; padding: 8px 14px;
            font-size: 12px; border: 1px solid var(--border-accent); color: var(--text-primary);
        }
        .hw-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .hw-chip {
            background: var(--glass-bg); border-radius: 50px; padding: 7px 14px;
            font-size: 12px; display: inline-flex; align-items: center; gap: 7px;
            border: 1px solid var(--glass-border); color: var(--text-secondary);
            box-shadow: 0 2px 4px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .hw-chip i { color: var(--accent); opacity: 0.7; font-size: 11px; }

        .footer {
            margin-top: 24px; padding: 18px 28px; text-align: center; font-size: 12px;
            color: var(--text-tertiary); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 14px;
            background: var(--glass-heavy);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border-radius: var(--radius-lg); border: 1px solid var(--glass-border);
            box-shadow: var(--glass-shadow); position: relative; overflow: hidden;
        }
        .footer::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: var(--glass-highlight); pointer-events: none; }
        .copy-btn {
            background: var(--accent-light); padding: 6px 16px; border-radius: 50px; font-size: 12px;
            cursor: pointer; transition: all var(--transition-fast);
            border: 1px solid var(--border-accent); color: var(--accent); font-weight: 500;
        }
        .copy-btn:hover { background: rgba(0,122,255,0.14); box-shadow: 0 2px 8px rgba(0,122,255,0.15); }

        .driver-badge {
            width: 100%; text-align: center; padding: 10px 20px; margin-top: 14px;
            background: var(--glass-bg); border-radius: 50px; border: 1px solid var(--glass-border);
            font-size: 11px; color: var(--text-quaternary); letter-spacing: 0.2px;
            display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .driver-badge a { color: var(--accent); text-decoration: none; font-weight: 500; transition: opacity var(--transition-fast); opacity: 0.7; }
        .driver-badge a:hover { opacity: 1; }
        .driver-badge i { color: var(--accent); font-size: 10px; opacity: 0.4; }

        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .loading {
            display: inline-block; width: 14px; height: 14px;
            border: 2px solid rgba(0,122,255,0.2); border-top-color: var(--accent);
            border-radius: 50%; animation: spin 0.7s linear infinite;
            margin-right: 8px; vertical-align: middle;
        }

        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 24px; }
        .stats-card {
            background: var(--glass-bg);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 22px;
            overflow: hidden; box-shadow: var(--glass-shadow); position: relative;
        }
        .stats-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 40%; background: var(--glass-highlight); pointer-events: none; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
        .stats-card .card-header {
            display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
            border-bottom: 1px solid var(--divider); padding-bottom: 12px; background: transparent; position: relative;
        }
        .stats-card .card-header i { font-size: 18px; color: var(--accent); opacity: 0.8; }
        .stats-card .card-header h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .stats-card .card-header p { font-size: 11px; color: var(--text-tertiary); }
        .stats-card .card-body { padding: 0; position: relative; }

        .speed-history-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .speed-history-table th { text-align: left; padding: 8px 10px; color: var(--text-tertiary); font-weight: 500; border-bottom: 1px solid var(--divider); font-size: 11px; }
        .speed-history-table td { padding: 8px 10px; border-bottom: 1px solid var(--divider); color: var(--text-secondary); }
        .speed-history-table .speed-val { font-weight: 600; color: var(--accent); }
        .speed-history-table .speed-good { color: var(--success); font-weight: 600; }
        .speed-history-table .speed-mid { color: var(--warning); font-weight: 600; }
        .speed-history-table .speed-low { color: var(--danger); font-weight: 600; }
        .speed-bar { display: inline-block; height: 5px; border-radius: 3px; margin-right: 6px; vertical-align: middle; background: var(--accent); opacity: 0.5; }

        .usage-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--divider); font-size: 12px; }
        .usage-row .ep { color: var(--text-secondary); font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .usage-row .count { color: var(--accent); font-weight: 600; }
        .usage-total { text-align: center; padding: 14px; font-size: 26px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; }
        .usage-total-label { text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .no-data { text-align: center; padding: 28px; color: var(--text-quaternary); font-size: 13px; }

        .node-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        .node-table th { text-align: left; padding: 8px 12px; background: var(--glass-bg); border-bottom: 1px solid var(--border); color: var(--text-secondary); font-weight: 600; }
        .node-table td { padding: 8px 12px; border-bottom: 1px solid var(--divider); color: var(--text-primary); }
        .node-table .good { color: var(--success); font-weight: 600; }
        .node-table .mid { color: var(--warning); font-weight: 600; }
        .node-table .bad { color: var(--danger); font-weight: 600; }

        .modal-overlay {
            position: fixed; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.4);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000; opacity: 0; visibility: hidden; transition: all 0.25s ease;
        }
        .modal-overlay.active { opacity: 1; visibility: visible; }
        .modal-box {
            background: var(--glass-heavy);
            backdrop-filter: blur(40px) saturate(180%);
            -webkit-backdrop-filter: blur(40px) saturate(180%);
            border-radius: var(--radius-xl);
            padding: 28px 32px; max-width: 560px; width: 90%; box-shadow: var(--glass-shadow-lg);
            border: 1px solid var(--glass-border); position: relative; overflow: hidden;
        }
        .modal-box::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 40%; background: var(--glass-highlight); pointer-events: none; }
        .modal-box h3 { margin-bottom: 16px; font-weight: 600; color: var(--text-primary); position: relative; }
        .modal-box p { color: var(--text-secondary); font-size: 13px; margin-bottom: 12px; position: relative; }
        .modal-box textarea {
            width: 100%; padding: 12px; border-radius: var(--radius-sm);
            border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary);
            font-family: var(--font); font-size: 14px; resize: vertical; min-height: 80px;
            position: relative;
        }
        .modal-box textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,122,255,0.15); }
        .modal-box .btn-group { display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end; position: relative; }

        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.15); border-radius:6px; }
        ::-webkit-scrollbar-thumb:hover { background:rgba(0,0,0,0.25); }
        [data-theme="auto"] ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); }

        @media (max-width:1024px) { .rtt-display { grid-template-columns: repeat(2,1fr); } .quality-grid { grid-template-columns: repeat(2,1fr); } }
        @media (max-width:768px) {
            body { padding:14px; } .container { max-width:100%; } .grid { grid-template-columns:1fr; gap:14px; }
            .ip-val { font-size:18px; } .ip-val-small { font-size:15px; }
            .header { flex-direction:column; text-align:center; padding:16px 20px; border-radius:var(--radius-lg); }
            .logo { flex-direction:column; gap:8px; }
            .logo-icon { width:44px; height:44px; font-size:20px; border-radius:12px; }
            .logo h1 { font-size:20px; }
            .button-group { justify-content:center; } .btn { padding:9px 16px; font-size:12px; }
            .rtt-value { font-size:36px; } .rtt-display { grid-template-columns:1fr; gap:12px; }
            .rtt-box { padding:18px 14px; } .stats-row { justify-content:center; }
            .footer { flex-direction:column; text-align:center; padding:16px 20px; }
            .quality-grid { grid-template-columns:1fr; gap:10px; }
            .hero-card { padding:22px; border-radius:var(--radius-lg); }
            .rtt-card { min-height:auto; } .rtt-card .card-body { padding:16px; }
            .card-header { padding:14px 18px; } .card-body { padding:14px 18px; }
            .stats-grid { grid-template-columns:1fr; gap:14px; }
            .header-right { flex-wrap:wrap; justify-content:center; }
        }

            </style>
</head>
<body>
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

        <!-- ==================== Hero 卡片 ==================== -->
        <div class="hero-card">
            <div class="ip-row">
                <span class="ip-label"><i class="fas fa-globe"></i> IPv4</span>
                <span id="v4" class="ip-val">检测中...</span>
            </div>
            <div class="ip-row">
                <span class="ip-label"><i class="fas fa-globe"></i> IPv6</span>
                <span id="v6" class="ip-val ip-val-small">检测中...</span>
            </div>
            <div class="stats-row">
                <div class="stat-item"><i class="fas fa-map-marker-alt"></i> <span id="t-edge-label">边缘节点</span>: <strong id="colo-display">${data.colo}</strong></div>
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
                        <span class="quality-value" id="quality-badge" style="color: var(--chart-green);">优秀</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-chart-simple"></i> <span id="t-stability">网络稳定性</span></span>
                        <span class="quality-value" id="stability-badge" style="color: var(--chart-teal);">稳定</span>
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

        <!-- ==================== 三栏信息卡片 ==================== -->
        <div class="grid">
            <!-- 安全与协议 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-shield-halved"></i>
                    <div>
                        <h3 id="t-sec">安全与协议</h3>
                        <p><span id="t-sec-sub">TLS · 加密 · 身份验证</span></p>
                    </div>
                </div>
                <div class="card-body">
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
                        <span class="info-value">${data.asn}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-exchange-alt"></i> <span id="t-proto-label">协议</span></span>
                        <span class="info-value" id="proto-val">${data.proto}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-lock"></i> <span id="t-tls-version">TLS 版本</span></span>
                        <span class="info-value"><span class="badge badge-info">${data.tlsVersion}</span></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-key"></i> <span id="t-cipher">加密套件</span></span>
                        <span class="info-value" style="font-size:11px;font-family:monospace;">${data.tlsCipher}</span>
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
                        <span class="info-value" id="http2-val">检测中...</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-robot"></i> <span id="t-bot-label">机器人评分</span></span>
                        <span class="info-value" id="bot-score-val">${data.botScore}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-fingerprint"></i> JA3</span>
                        <span class="info-value" style="font-size:10px;word-break:break-all;">${data.tlsClientJa3}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-fingerprint"></i> JA4</span>
                        <span class="info-value" style="font-size:10px;word-break:break-all;">${data.tlsClientJa4}</span>
                    </div>
                </div>
            </div>

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
                    <div style="text-align:center;margin-bottom:20px;">
                        <i class="fas fa-globe-asia" style="font-size:48px;color:var(--chart-cyan);opacity:0.7;"></i>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-location-dot"></i> <span id="t-geo-location">位置</span></span>
                        <span class="info-value">${data.city}, ${data.region}, ${data.country}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-crosshairs"></i> <span id="t-geo-coord">坐标</span></span>
                        <span class="info-value">${data.lat}°${data.latDir} / ${data.lon}°${data.lonDir}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-building"></i> <span id="t-geo-org">运营商</span></span>
                        <span class="info-value" style="font-size:12px;">${data.asOrg}</span>
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

        <!-- ==================== 硬件信息 ==================== -->
        <div class="card">
            <div class="card-header">
                <i class="fas fa-desktop"></i>
                <div>
                    <h3 id="t-hw">硬件信息</h3>
                    <p><span id="t-hw-sub">客户端环境</span></p>
                </div>
            </div>
            <div class="card-body">
                <div id="hw-info" class="hw-grid">加载中...</div>
            </div>
        </div>

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
                <div class="button-group">
                    <button class="btn btn-outline" id="btn-loss-test"><i class="fas fa-tachometer-alt"></i> <span id="t-loss-btn">丢包率</span></button>
                    <button class="btn btn-primary" id="btn-speed-test"><i class="fas fa-gauge-high"></i> <span id="t-speed-btn">带宽测速</span></button>
                    <button class="btn btn-outline" id="btn-dns-test"><i class="fas fa-server"></i> <span id="t-dns-btn">DNS 解析</span></button>
                    <button class="btn btn-cyan" id="btn-cpu-test"><i class="fas fa-microchip"></i> <span id="t-cpu-btn">CPU 性能</span></button>
                    <button class="btn btn-purple" id="btn-ws-test"><i class="fas fa-bolt"></i> <span id="t-ws-btn">WebSocket</span></button>
                    <button class="btn btn-cyan" id="btn-concurrent-test"><i class="fas fa-layer-group"></i> <span id="t-concurrent-btn">并发测试</span></button>
                    <button class="btn btn-outline" id="btn-stream-test"><i class="fas fa-stream"></i> <span id="t-stream-btn">流式传输</span></button>
                    <button class="btn btn-outline" id="btn-media-unlock"><i class="fas fa-play-circle"></i> <span id="t-media-btn">流媒体连通性</span></button>
                    <button class="btn btn-outline" id="btn-multi-node"><i class="fas fa-globe-asia"></i> <span id="t-multi-btn">多节点对比</span></button>
                    <button class="btn btn-outline" id="btn-webrtc-test"><i class="fas fa-user-shield"></i> <span id="t-webrtc-btn">WebRTC 泄漏</span></button>
                    <button class="btn btn-outline" id="btn-ttfb-test"><i class="fas fa-stopwatch"></i> <span id="t-ttfb-btn">TTFB 分析</span></button>
                    <button class="btn btn-cyan" id="btn-upload-test"><i class="fas fa-upload"></i> <span id="t-upload-btn">上传测速</span></button>
                </div>
                <div id="loss-result" class="result-area" style="display:none;"></div>
                <div id="speed-result" style="display:none;"></div>
                <div id="dns-result" class="result-area" style="display:none;"></div>
                <div id="cpu-result" class="result-area" style="display:none;"></div>
                <div id="ws-result" class="result-area" style="display:none;"></div>
                <div id="concurrent-result" class="result-area" style="display:none;"></div>
                <div id="stream-result" class="result-area" style="display:none;"></div>
                <div id="media-result" class="result-area" style="display:none;"></div>
                <div id="multi-node-result" class="result-area" style="display:none;"></div>
                <div id="webrtc-result" class="result-area" style="display:none;"></div>
                <div id="ttfb-result" class="result-area" style="display:none;"></div>
                <div id="upload-result" class="result-area" style="display:none;"></div>
            </div>
        </div>

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

        <!-- ==================== 底部 ==================== -->
        <div class="footer">
            <span><i class="fas fa-fingerprint"></i> RAY ID: <span style="font-family:monospace;">${data.rayId}</span></span>
            <span><i class="fas fa-ethernet"></i> <span id="t-client-label">客户端</span>: ${data.clientIp}</span>
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

    <script nonce="${nonce}">
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
                    usageTitle: 'Usage Statistics',
                    usageSub: 'API Endpoint Calls',
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
                    uploadFailed: 'Upload test failed'
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
                    usageTitle: '用量统计',
                    usageSub: 'API 端点调用统计',
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
                    uploadFailed: '上传测试失败'
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
                    usageTitle: '用量統計',
                    usageSub: 'API 端點呼叫統計',
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
                    uploadFailed: '上傳測試失敗'
                }
            };

            // ==================== 后端数据 ====================
            const BACKEND_DATA = {
                asOrg: "${data.asOrg}", asn: "${data.asn}", colo: "${data.colo}",
                city: "${data.city}", region: "${data.region}", country: "${data.country}",
                lat: "${data.lat}\u00b0${data.latDir}", lon: "${data.lon}\u00b0${data.lonDir}",
                proto: "${data.proto}", tlsVersion: "${data.tlsVersion}", tlsCipher: "${data.tlsCipher}",
                botScore: "${data.botScore}", rayId: "${data.rayId}", clientIp: "${data.clientIp}",
                httpProtocolRaw: "${data.httpProtocolRaw}", latNum: ${data.latNum}, lonNum: ${data.lonNum},
                tlsClientHelloLength: ${data.tlsClientHelloLength},
                compressionBrotli: ${compressionInfo.brotli}, compressionGzip: ${compressionInfo.gzip},
                realGeoCity: "${realGeoJS.city}", realGeoRegion: "${realGeoJS.region}",
                realGeoCountry: "${realGeoJS.country}", realGeoCountryCode: "${realGeoJS.countryCode}",
                realGeoLat: ${realGeoJS.lat}, realGeoLon: ${realGeoJS.lon},
                realGeoOrg: "${realGeoJS.org}", realGeoIp: "${realGeoJS.ip}",
                tlsClientJa3: "${data.tlsClientJa3}", tlsClientJa4: "${data.tlsClientJa4}"
            };

            // ==================== DOM 引用 ====================
            const elements = {
                v4: document.getElementById('v4'), v6: document.getElementById('v6'),
                rttNum: document.getElementById('rtt-num'), chart: document.getElementById('chart'),
                ctx: document.getElementById('chart').getContext('2d'),
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
                const saved = localStorage.getItem('pref-lang');
                if (saved && i18n[saved]) return saved;
                const langs = navigator.languages || [navigator.language || ''];
                for (const l of langs) {
                    const lower = l.toLowerCase();
                    if (lower.match(/^zh-(cn|sg|my)/)) return 'zh-CN';
                    if (lower.match(/^zh/)) return 'zh-TW';
                    if (lower.match(/^en/)) return 'en';
                }
                return '${defaultLang}';
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

            function showResult(element, html, isError = false) {
                if (element) {
                    element.style.display = 'block';
                    element.innerHTML = html;
                    element.style.background = isError ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.3)';
                    element.style.borderLeftColor = isError ? '#ef4444' : '#06b6d4';
                    element.style.opacity = '1';
                }
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
                    't-hw-sub': t.hwSub,
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
                    'modal-start': t.start
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
            }

            window.setLang = function(lang) {
                currentLang = lang;
                localStorage.setItem('pref-lang', lang);
                updateUI();
                // 重新加载可能已经显示的地理位置欺诈信息（可刷新，但为了简便，不强制刷新）
                // 用户切语言后欺诈信息会重新加载，但这里暂不处理，因为欺诈信息是动态加载的，其文本会在 loadFraudScore 中使用 t 变量。
                // 为了即时更新，可以重新调用 loadFraudScore，但需要确保 t 是最新的。
                // 由于 loadFraudScore 内部使用了 i18n[currentLang]，直接重新调用即可。
                // 但因为 loadFraudScore 是异步的，且在 fetchUserGeo 之后调用，我们可以在这里触发重新加载。
                // 但为了简单，用户切语言后，可以手动刷新页面，或者我们重新调用 fetchUserGeo？
                // 更好的方式：在 loadFraudScore 中读取最新的 currentLang，由于它是闭包，每次调用都会使用当前值。
                // 所以直接重新调用 loadFraudScore 即可。
                if (document.querySelector('.fraud-info')) {
                    loadFraudScore(); // 重新渲染欺诈信息
                }
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
                if (!canvas || canvas.width === 0 || canvas.height === 0) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (rttData.length < 2) return;
                
                ctx.beginPath();
                ctx.strokeStyle = '#06b6d4';
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
                gradient.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
                gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
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
                                el.textContent = ip;
                                return;
                            }
                        }
                    } catch (e) {}
                }
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
                    qualityColor = '#34d399';
                } else if (currentRtt < 100) {
                    qualityText = currentLang === 'en' ? 'Good' : (currentLang === 'zh-TW' ? '良好' : '良好');
                    qualityColor = '#34d399';
                } else if (currentRtt < 150) {
                    qualityText = currentLang === 'en' ? 'Fair' : (currentLang === 'zh-TW' ? '一般' : '一般');
                    qualityColor = '#fbbf24';
                } else if (currentRtt < 250) {
                    qualityText = currentLang === 'en' ? 'Poor' : (currentLang === 'zh-TW' ? '較差' : '较差');
                    qualityColor = '#f87171';
                } else {
                    qualityText = currentLang === 'en' ? 'Very Poor' : (currentLang === 'zh-TW' ? '極差' : '极差');
                    qualityColor = '#f87171';
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
                        stabilityColor = '#34d399';
                    } else if (avgJitter < 30) {
                        stabilityText = currentLang === 'en' ? 'Stable' : (currentLang === 'zh-TW' ? '穩定' : '稳定');
                        stabilityColor = '#22d3ee';
                    } else if (avgJitter < 60) {
                        stabilityText = currentLang === 'en' ? 'Unstable' : (currentLang === 'zh-TW' ? '不穩定' : '不稳定');
                        stabilityColor = '#fbbf24';
                    } else {
                        stabilityText = currentLang === 'en' ? 'Very Unstable' : (currentLang === 'zh-TW' ? '極不穩定' : '极不稳定');
                        stabilityColor = '#f87171';
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
                    lossRateEl.style.color = rate === 0 ? '#34d399' : (rate < 5 ? '#fbbf24' : '#f87171');
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
                    await fetchWithTimeout(window.location.href + '?_=' + Date.now(), 
                        { method: 'HEAD', cache: 'no-store' }, 2000);
                    const diff = Math.round(performance.now() - start);
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
                    const dist = calculateDistance(
                        BACKEND_DATA.latNum, BACKEND_DATA.lonNum,
                        BACKEND_DATA.realGeoLat, BACKEND_DATA.realGeoLon
                    );
                    const t = i18n[currentLang];
                    elements.userGeoInfo.innerHTML = \`
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-city"></i> \${t.userLocation}</span>
                            <span class="info-value">\${BACKEND_DATA.realGeoCity}, \${BACKEND_DATA.realGeoRegion}, \${BACKEND_DATA.realGeoCountry}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ruler"></i> \${t.userDistance}</span>
                            <span class="info-value"><span class="badge badge-info">\${dist} 公里</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-building"></i> \${t.userOrg}</span>
                            <span class="info-value">\${BACKEND_DATA.realGeoOrg}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ethernet"></i> \${t.userIp}</span>
                            <span class="info-value"><code>\${BACKEND_DATA.realGeoIp}</code></span>
                        </div>
                    \`;
                    loadFraudScore();
                    return;
                }
                
                const ip = elements.v4 ? elements.v4.textContent : '';
                const t = i18n[currentLang];
                if (!ip || ip.includes('检测中') || ip.includes(t.unavailable)) {
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
                            <span class="info-value">\${geoData.city}, \${geoData.region}, \${geoData.country_name}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ruler"></i> \${t.userDistance}</span>
                            <span class="info-value"><span class="badge badge-info">\${dist} 公里</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-building"></i> \${t.userOrg}</span>
                            <span class="info-value">\${geoData.org}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ethernet"></i> \${t.userIp}</span>
                            <span class="info-value"><code>\${ip}</code></span>
                        </div>
                    \`;
                    loadFraudScore();
                } catch (e) {
                    elements.userGeoInfo.innerHTML = '<div style="text-align:center;padding:30px;color:#f87171;"><i class="fas fa-exclamation-triangle"></i> 地理位置查询失败</div>';
                }
            }

            // ==================== 硬件信息 ====================
            function updateHardwareInfo() {
                if (!elements.hwInfo) return;
                const cores = navigator.hardwareConcurrency || 'N/A';
                const screenInfo = screen.width + 'x' + screen.height;
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const language = navigator.language;
                const platform = navigator.platform;
                elements.hwInfo.innerHTML = \`
                    <div class="hw-chip"><i class="fas fa-tv"></i> \${screenInfo}</div>
                    <div class="hw-chip"><i class="fas fa-microchip"></i> \${cores} 核心</div>
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
                    const res = await fetch('/cpu-test?n=500000');
                    const data = await res.json();
                    let badgeClass = data.opsMs > 50 ? 'badge-success' : (data.opsMs > 20 ? 'badge-warning' : 'badge-danger');
                    showResult(elements.cpuResult, \`
                        <i class="fas fa-microchip"></i> CPU 性能: <strong>\${data.opsMs}</strong> 操作/毫秒
                        <span class="badge \${badgeClass}">\${data.duration}ms</span>
                    \`);
                } catch (e) {
                    showResult(elements.cpuResult, '<i class="fas fa-exclamation-triangle"></i> CPU 测试失败', true);
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
                                    const pongTime = performance.now();
                                    const data = JSON.parse(event.data);
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
                        let badgeClass = result.avg < 50 ? 'badge-success' : (result.avg < 150 ? 'badge-warning' : 'badge-danger');
                        showResult(elements.wsResult, \`
                            <i class="fas fa-bolt"></i> WebSocket 延迟: <strong>\${result.avg}ms</strong>
                            <span class="badge \${badgeClass}">最小: \${result.min}ms / 最大: \${result.max}ms</span>
                        \`);
                    } else {
                        showResult(elements.wsResult, '<i class="fas fa-exclamation-triangle"></i> WebSocket 连接失败', true);
                    }
                } catch (e) {
                    showResult(elements.wsResult, '<i class="fas fa-exclamation-triangle"></i> WebSocket 测试失败', true);
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
                    
                    let html = '<i class="fas fa-layer-group"></i> 并发测试结果:<br><div style="display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;">';
                    results.forEach(r => {
                        const avgDuration = Math.round(r.reduce((sum, item) => sum + (item.duration || 0), 0) / r.length);
                        let badgeClass = avgDuration < 20 ? 'badge-success' : (avgDuration < 50 ? 'badge-warning' : 'badge-danger');
                        html += \`<span class="badge \${badgeClass}">\${r.length} 请求: \${avgDuration}ms</span>\`;
                    });
                    html += '</div>';
                    showResult(elements.concurrentResult, html);
                } catch (e) {
                    showResult(elements.concurrentResult, '<i class="fas fa-exclamation-triangle"></i> 并发测试失败', true);
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
                
                let html = '<i class="fas fa-stream"></i> 流式吞吐量:<br><div class="speed-result">';
                html += results.map(r => \`<div class="speed-item">\${r.sizeKB} KB: \${r.speed} Mbps</div>\`).join('');
                html += '</div>';
                showResult(elements.streamResult, html);
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
                        await fetchWithTimeout(window.location.href + '?_loss=' + Date.now() + i, 
                            { method: 'HEAD', cache: 'no-store' }, 3000);
                    } catch (e) {
                        failed++;
                    }
                }
                const lossPercent = Math.round((failed / total) * 100);
                if (lossPercent === 0) {
                    showResult(elements.lossResult, '<i class="fas fa-check-circle"></i> ' + t.lossNone);
                } else {
                    showResult(elements.lossResult, '<i class="fas fa-exclamation-triangle"></i> ' + t.lossResult + ': ' + lossPercent + '% (' + failed + '/' + total + ' 丢失)', true);
                }
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
                let avgBadge = avgSpeed > 50 ? 'badge-success' : (avgSpeed > 10 ? 'badge-warning' : 'badge-danger');
                
                let html = '<i class="fas fa-gauge-high"></i> 带宽测速结果:<br><div class="speed-result">';
                html += results.map(r => \`<div class="speed-item">\${r.sizeKB} KB: \${r.speed} Mbps</div>\`).join('');
                html += \`</div><div style="margin-top: 8px;"><span class="badge \${avgBadge}">平均: \${avgSpeed.toFixed(2)} Mbps</span></div>\`;
                showResult(elements.speedResult, html);
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
                
                let html = '<i class="fas fa-server"></i> DNS 解析结果:<br><div style="display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;">';
                results.forEach(r => {
                    if (r.time !== null) {
                        let badgeClass = r.time < 50 ? 'badge-success' : (r.time < 150 ? 'badge-warning' : 'badge-danger');
                        html += \`<span class="badge \${badgeClass}">\${r.domain}: \${r.time}ms</span>\`;
                    } else {
                        html += \`<span class="badge badge-danger">\${r.domain}: 超时</span>\`;
                    }
                });
                html += '</div>';
                showResult(elements.dnsResult, html);
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
                            resolve({ name: service.name, status: 'blocked', icon: '❌', color: '#f87171', detail: '超时或被阻' });
                        }, 5000);
                        img.onload = () => {
                            clearTimeout(timeout);
                            resolve({ name: service.name, status: 'available', icon: '✅', color: '#34d399', detail: '可访问' });
                        };
                        img.onerror = () => {
                            clearTimeout(timeout);
                            resolve({ name: service.name, status: 'blocked', icon: '❌', color: '#f87171', detail: '连接失败' });
                        };
                        img.src = service.url;
                    });
                };
                
                const results = await Promise.all(services.map(s => checkService(s)));
                
                let html = '<i class="fas fa-play-circle"></i> 您的 IP 连通性检测结果：<br><div class="speed-result" style="flex-wrap: wrap;">';
                results.forEach(r => {
                    html += \`<div class="speed-item" style="border-left-color: \${r.color};"><strong>\${r.name}</strong> \${r.icon} \${r.detail}</div>\`;
                });
                html += '</div>';
                showResult(elements.mediaResult, html);
                mediaTestRunning = false;
            }

            // ==================== 多节点对比 ====================
            const modal = document.getElementById('nodeModal');
            const nodeUrlsInput = document.getElementById('nodeUrls');
            const modalCancel = document.getElementById('modalCancel');
            const modalStart = document.getElementById('modalStart');

            elements.multiBtn.addEventListener('click', () => {
                const saved = localStorage.getItem('nodeUrls') || '';
                nodeUrlsInput.value = saved;
                modal.classList.add('active');
            });

            modalCancel.addEventListener('click', () => {
                modal.classList.remove('active');
            });

            modalStart.addEventListener('click', async () => {
                const urls = nodeUrlsInput.value.split('\\n').map(s => s.trim()).filter(s => s);
                if (urls.length === 0) {
                    alert('请至少输入一个节点 URL');
                    return;
                }
                localStorage.setItem('nodeUrls', nodeUrlsInput.value);
                modal.classList.remove('active');
                await runMultiNodeTest(urls);
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('active');
            });

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
                        errorMsg = e.message || '请求失败';
                    }
                    return { node, latency, status, errorMsg };
                }));

                let html = '<i class="fas fa-globe-asia"></i> ' + t.multiResult + '：<br><table class="node-table"><thead><tr><th>' + t.nodeName + '</th><th>' + t.latency + '</th><th>' + t.status + '</th></tr></thead><tbody>';
                results.forEach(r => {
                    let statusText = r.status === 'success' ? '✅' : '❌ ' + r.errorMsg;
                    let latencyText = r.latency !== null ? r.latency + ' ms' : '—';
                    let cls = r.status === 'success' ? (r.latency < 100 ? 'good' : (r.latency < 300 ? 'mid' : 'bad')) : 'bad';
                    html += \`<tr><td>\${r.node}</td><td class="\${cls}">\${latencyText}</td><td>\${statusText}</td></tr>\`;
                });
                html += '</tbody></table>';
                showResult(elements.multiResult, html);
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
                                const match = e.candidate.candidate.match(/(\d{1,3}\.){3}\d{1,3}/);
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
                        showResult(elements.webrtcResult, '<i class="fas fa-check-circle" style="color:#34d399;"></i> ' + t.webrtcNone);
                    } else {
                        const ipList = [...ips];
                        const localIps = ipList.filter(ip => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip));
                        const publicIps = ipList.filter(ip => !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip));
                        let html = '<i class="fas fa-user-shield"></i> WebRTC: ';
                        if (publicIps.length > 0 || localIps.length > 0) {
                            html += '<span class="badge badge-warning">' + t.webrtcLeak + '</span><br><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">';
                            localIps.forEach(ip => { html += '<span class="badge badge-info">' + t.webrtcLocal + ': ' + ip + '</span>'; });
                            publicIps.forEach(ip => { html += '<span class="badge badge-danger">' + t.webrtcPublic + ': ' + ip + '</span>'; });
                            html += '</div>';
                        } else {
                            html += '<span class="badge badge-success">' + t.webrtcSafe + '</span>';
                        }
                        showResult(elements.webrtcResult, html);
                    }
                } catch (e) {
                    showResult(elements.webrtcResult, '<i class="fas fa-check-circle" style="color:#34d399;"></i> WebRTC ' + t.webrtcSafe, false);
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
                        return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;"><span style="min-width:110px;font-size:11px;color:var(--text-secondary);">' + label + '</span><div style="flex:1;height:14px;background:rgba(0,0,0,0.06);border-radius:7px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:7px;transition:width 0.3s;"></div></div><span style="min-width:45px;font-size:11px;font-weight:600;color:var(--text-primary);text-align:right;">' + val + 'ms</span></div>';
                    };

                    let html = '<i class="fas fa-stopwatch"></i> TTFB ' + t.ttfbTotal + ': <strong>' + total + 'ms</strong><div style="margin-top:10px;">';
                    html += bar(t.ttfbDns, dns, '#06b6d4');
                    html += bar(t.ttfbTcp, tcp, '#3b82f6');
                    html += bar(t.ttfbTls, tls, '#8b5cf6');
                    html += bar(t.ttfbWait, wait, '#f59e0b');
                    html += bar(t.ttfbDownload, download, '#34d399');
                    html += '</div>';
                    showResult(elements.ttfbResult, html);
                } catch (e) {
                    showResult(elements.ttfbResult, '<i class="fas fa-exclamation-triangle"></i> TTFB 分析失败', true);
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
                    let avgBadge = avgSpeed > 20 ? 'badge-success' : (avgSpeed > 5 ? 'badge-warning' : 'badge-danger');
                    let html = '<i class="fas fa-upload"></i> ' + t.uploadResult + ':<br><div class="speed-result">';
                    html += results.map(r => '<div class="speed-item">' + r.sizeKB + ' KB: ' + r.speed + ' Mbps</div>').join('');
                    html += '</div><div style="margin-top:8px;"><span class="badge ' + avgBadge + '">' + t.uploadResult + ': ' + avgSpeed.toFixed(2) + ' Mbps</span></div>';
                    showResult(elements.uploadResult, html);
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

            // ==================== 报告生成 ====================
            function generateReportText() {
                const t = i18n[currentLang];
                const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                const currentRtt = elements.rttNum ? elements.rttNum.textContent : '--';
                const currentJitter = elements.jitterVal ? elements.jitterVal.textContent : '--';
                const quality = document.getElementById('quality-badge') ? document.getElementById('quality-badge').textContent : '--';
                const stability = document.getElementById('stability-badge') ? document.getElementById('stability-badge').textContent : '--';
                const lossRate = document.getElementById('loss-rate') ? document.getElementById('loss-rate').textContent : '0%';
                const sampleCountVal = document.getElementById('sample-count') ? document.getElementById('sample-count').textContent : '0';
                const minRttVal = document.getElementById('min-rtt') ? document.getElementById('min-rtt').textContent : '--';
                const maxRttVal = document.getElementById('max-rtt') ? document.getElementById('max-rtt').textContent : '--';
                const clientLocation = BACKEND_DATA.realGeoCity ? BACKEND_DATA.realGeoCity + ', ' + BACKEND_DATA.realGeoCountry : '未知';
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

                return \`# NetSight Pro 网络诊断报告
**生成时间**: \${now}
**边缘节点**: \${BACKEND_DATA.colo} (\${BACKEND_DATA.city})
**客户端 IPv4**: \${elements.v4 ? elements.v4.textContent : 'N/A'}
**RAY ID**: \${BACKEND_DATA.rayId}

## 📡 网络指标
- **当前 RTT**: \${currentRtt} ms
- **网络抖动**: \${currentJitter} ms
- **最低 RTT**: \${minRttVal} ms
- **最高 RTT**: \${maxRttVal} ms
- **连接质量**: \${quality}
- **网络稳定性**: \${stability}
- **丢包率**: \${lossRate}
- **样本数量**: \${sampleCountVal}

## 🔒 安全与协议
- **协议**: \${BACKEND_DATA.httpProtocolRaw}
- **TLS 版本**: \${BACKEND_DATA.tlsVersion}
- **加密套件**: \${BACKEND_DATA.tlsCipher}
- **ECH**: \${BACKEND_DATA.tlsClientHelloLength > 0 ? '已启用' : '未启用'}
- **压缩算法**: \${BACKEND_DATA.compressionBrotli ? 'Brotli ' : ''}\${BACKEND_DATA.compressionGzip ? 'Gzip' : '无'}
- **HTTP/2 状态**: \${http2Status}
- **机器人评分**: \${BACKEND_DATA.botScore}

## 📍 位置信息
- **边缘节点**: \${BACKEND_DATA.city}, \${BACKEND_DATA.region}, \${BACKEND_DATA.country}
- **客户端位置**: \${clientLocation}
- **运营商**: \${BACKEND_DATA.realGeoOrg || BACKEND_DATA.asOrg}

\${fraudInfo ? '## 🛡️ IP 风险信息\\n' + fraudInfo : ''}
---
*报告由 NetSight Pro 自动生成 · 由 CF-workers-netdiag 强力驱动*\`;
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

            // ==================== 历史记录 & 统计 ====================
            async function logSpeedTest(avgSpeed, results) {
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
                try {
                    const res = await fetch('/api/speed-history?limit=5');
                    const records = await res.json();
                    if (!records || records.length === 0) {
                        panel.innerHTML = '<div class="no-data"><i class="fas fa-inbox"></i> <span id="t-no-records">' + i18n[currentLang].noRecords + '</span></div>';
                        return;
                    }
                    let html = '<table class="speed-history-table"><thead><tr><th>' + i18n[currentLang].historyTitle + '</th><th>平均速度</th><th>节点</th></tr></thead><tbody>';
                    const maxSpeed = Math.max(...records.map(r => r.avgSpeed), 1);
                    records.forEach(r => {
                        const d = new Date(r.timestamp);
                        const time = d.toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                        const pct = Math.min((r.avgSpeed / maxSpeed) * 100, 100);
                        let cls = r.avgSpeed > 50 ? 'speed-good' : (r.avgSpeed > 10 ? 'speed-mid' : 'speed-low');
                        html += '<tr><td>' + time + '</td><td><span class="speed-bar" style="width:' + pct + 'px"></span><span class="' + cls + '">' + r.avgSpeed.toFixed(1) + ' Mbps</span></td><td>' + (r.colo || 'N/A') + '</td></tr>';
                    });
                    html += '</tbody></table>';
                    panel.innerHTML = html;
                } catch (e) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> 加载失败</div>';
                }
            }

            async function loadUsageStats() {
                const panel = document.getElementById('usage-stats-panel');
                if (!panel) return;
                try {
                    const res = await fetch('/api/usage-stats');
                    const stats = await res.json();
                    let html = '<div class="usage-total">' + (stats.totalRequests || 0).toLocaleString() + '</div>';
                    html += '<div class="usage-total-label">总请求数</div>';
                    const endpoints = stats.endpoints || {};
                    const entries = Object.entries(endpoints).sort((a, b) => b[1] - a[1]).slice(0, 8);
                    for (const [ep, count] of entries) {
                        html += '<div class="usage-row"><span class="ep">' + ep + '</span><span class="count">' + count.toLocaleString() + '</span></div>';
                    }
                    if (entries.length === 0) {
                        html += '<div class="usage-row"><span class="ep" style="color:rgba(255,255,255,0.3)">等待首次请求...</span></div>';
                    }
                    panel.innerHTML = html;
                } catch (e) {
                    panel.innerHTML = '<div class="no-data"><i class="fas fa-exclamation-circle"></i> 加载失败</div>';
                }
            }

            // ==================== 主题切换 ====================
            const themeToggle = document.getElementById('themeToggle');
            let currentTheme = localStorage.getItem('theme') || 'auto';
            function applyTheme(theme) {
                const html = document.documentElement;
                if (theme === 'auto') {
                    html.removeAttribute('data-theme');
                    themeToggle.innerHTML = '<i class="fas fa-adjust"></i>';
                } else {
                    html.setAttribute('data-theme', theme);
                    themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
                }
                localStorage.setItem('theme', theme);
                currentTheme = theme;
            }
            themeToggle.addEventListener('click', () => {
                if (currentTheme === 'auto') applyTheme('dark');
                else if (currentTheme === 'dark') applyTheme('light');
                else applyTheme('auto');
            });
            applyTheme(localStorage.getItem('theme') || 'auto');

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
                if (elements.lossBtn) elements.lossBtn.addEventListener('click', runLossTest);
                if (elements.speedBtn) elements.speedBtn.addEventListener('click', runSpeedTest);
                if (elements.dnsBtn) elements.dnsBtn.addEventListener('click', runDnsTest);
                if (elements.cpuBtn) elements.cpuBtn.addEventListener('click', runCpuTest);
                if (elements.wsBtn) elements.wsBtn.addEventListener('click', runWsTest);
                if (elements.concurrentBtn) elements.concurrentBtn.addEventListener('click', runConcurrentTest);
                if (elements.streamBtn) elements.streamBtn.addEventListener('click', runStreamTest);
                if (elements.mediaBtn) elements.mediaBtn.addEventListener('click', runClientMediaTest);
                if (elements.webrtcBtn) elements.webrtcBtn.addEventListener('click', runWebRtcTest);
                if (elements.ttfbBtn) elements.ttfbBtn.addEventListener('click', runTtfbTest);
                if (elements.uploadBtn) elements.uploadBtn.addEventListener('click', runUploadTest);
                // 多节点按钮已绑定
                
                loadSpeedHistory();
                loadUsageStats();
                setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);

                // 语言按钮绑定
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        setLang(this.getAttribute('data-lang'));
                    });
                });

            }
            
            init();
        })();
    </script>
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
