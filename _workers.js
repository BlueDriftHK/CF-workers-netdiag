// ============================================================
// NetSight Pro - Apple 极简网络诊断工具
// Cloudflare Worker 完整优化版 | iOS/macOS 原生设计体系
// 版本: 3.6 | 视觉重构: 苹果极简风格
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

// 注意：清理函数将在 fetch 事件中按需调用，而不是使用 setInterval
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
  
  // 每 100 次请求清理一次，而不是使用 setInterval
  if (rateLimit.size > 0 && Math.random() < 0.01) {
    cleanupRateLimit();
  }
  
  return false;
}

function escapeForJS(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// 修复后的并发限制器
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
      version: '3.5',
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
    const data = new Uint8Array(size);
    crypto.getRandomValues(data);
    return new Response(data, {
      headers: {
        'content-type': 'application/octet-stream',
        ...CORS_HEADERS,
        ...SECURITY_HEADERS
      }
    });
  }
  
  // ==================== CPU 密集型测试端点 ====================
  if (url.pathname === '/cpu-test') {
    // CPU 速率限制：每IP每分钟最多3次
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

    const iterations = Math.min(parseInt(url.searchParams.get('n')) || 500000, 2000000);
    const start = Date.now();
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i);
    }
    const duration = Date.now() - start;
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
    
    // 心跳保持
    const startHeartbeat = () => {
      // 发送 ping 的间隔
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
      
      // 心跳超时检测
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
          const data = new Uint8Array(size);
          crypto.getRandomValues(data);
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
          const chunk = new Uint8Array(currentChunk);
          crypto.getRandomValues(chunk);
          
          try {
            controller.enqueue(chunk);
            sent += currentChunk;
            
            if (sent < size) {
              // 检查背压
              if (controller.desiredSize > 0) {
                queueMicrotask(pushChunk);
              } else {
                // 等待背压解除
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
        // 仅保留最近5条记录
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
    requestPriority: request.headers.get('priority') || 'N/A'
  };
  
  const acceptLang = request.headers.get('accept-language') || '';
  let defaultLang = 'zh-CN';
  if (acceptLang.match(/zh-(CN|SG|MY)/i)) defaultLang = 'zh-CN';
  else if (acceptLang.match(/zh/i)) defaultLang = 'zh-TW';
  else if (acceptLang.match(/en/i)) defaultLang = 'en';
  
  const workerDuration = Date.now() - workerStart;
  
  // 服务端直接查询真实客户端 IP 的地理位置
  let realGeoData = null;
  if (clientIp && clientIp !== 'unknown') {
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=city,regionName,country,countryCode,lat,lon,org,query`, {
        headers: { 'User-Agent': 'Cloudflare-Worker/1.0' }
      });
      if (geoRes.ok) {
        realGeoData = await geoRes.json();
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
  const cspHeader = `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://ipapi.co https://api4.ipify.org https://api6.ipify.org https://ipv4.icanhazip.com https://ipv6.icanhazip.com https://ip4.seeip.org; img-src 'self' data:;`;
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --bg-primary: #f5f5f7;
            --bg-card: rgba(255, 255, 255, 0.72);
            --bg-card-hover: rgba(255, 255, 255, 0.88);
            --bg-glass: rgba(255, 255, 255, 0.64);
            --text-primary: #1d1d1f;
            --text-secondary: #86868b;
            --text-tertiary: #aeaeb2;
            --text-quaternary: #c7c7cc;
            --accent: #007AFF;
            --accent-hover: #0066d6;
            --accent-light: rgba(0, 122, 255, 0.08);
            --accent-glass: rgba(0, 122, 255, 0.06);
            --success: #34c759;
            --success-light: rgba(52, 199, 89, 0.1);
            --warning: #ff9f0a;
            --warning-light: rgba(255, 159, 10, 0.1);
            --danger: #ff3b30;
            --danger-light: rgba(255, 59, 48, 0.08);
            --border: rgba(0, 0, 0, 0.06);
            --border-accent: rgba(0, 122, 255, 0.12);
            --divider: rgba(0, 0, 0, 0.04);
            --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
            --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
            --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.05);
            --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.07);
            --radius-sm: 12px;
            --radius-md: 16px;
            --radius-lg: 20px;
            --radius-xl: 24px;
            --transition-fast: 0.18s ease;
            --transition-smooth: 0.25s cubic-bezier(0.25, 0.1, 0.25, 1);
            --chart-cyan: #06b6d4;
            --chart-green: #34d399;
            --chart-teal: #22d3ee;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg-primary: #1c1c1e;
                --bg-card: rgba(255, 255, 255, 0.08);
                --bg-card-hover: rgba(255, 255, 255, 0.12);
                --bg-glass: rgba(255, 255, 255, 0.06);
                --text-primary: #f5f5f7;
                --text-secondary: #a1a1a6;
                --text-tertiary: #636366;
                --text-quaternary: #48484a;
                --accent: #0A84FF;
                --accent-hover: #409cff;
                --accent-light: rgba(10, 132, 255, 0.12);
                --accent-glass: rgba(10, 132, 255, 0.08);
                --success: #30d158;
                --success-light: rgba(48, 209, 88, 0.15);
                --warning: #ff9f0a;
                --warning-light: rgba(255, 159, 10, 0.15);
                --danger: #ff453a;
                --danger-light: rgba(255, 69, 58, 0.12);
                --border: rgba(255, 255, 255, 0.1);
                --border-accent: rgba(10, 132, 255, 0.2);
                --divider: rgba(255, 255, 255, 0.06);
                --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
                --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.3);
                --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.3);
                --chart-cyan: #22d3ee;
                --chart-green: #34d399;
                --chart-teal: #2dd4bf;
            }
        }

        html {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
            background: var(--bg-primary);
            min-height: 100vh;
            padding: 28px;
            color: var(--text-primary);
            position: relative;
        }

        /* Subtle background texture */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background:
                radial-gradient(ellipse at 30% 20%, rgba(0, 122, 255, 0.03) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 60%, rgba(0, 122, 255, 0.02) 0%, transparent 45%),
                radial-gradient(ellipse at 50% 90%, rgba(100, 100, 110, 0.02) 0%, transparent 40%);
            pointer-events: none;
            z-index: 0;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
            z-index: 1;
        }

        /* ========== Header ========== */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 28px;
            margin-bottom: 28px;
            flex-wrap: wrap;
            gap: 16px;
            background: var(--bg-glass);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border-radius: var(--radius-xl);
            border: 1px solid var(--border);
            box-shadow: var(--shadow-sm);
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .logo-icon {
            width: 48px;
            height: 48px;
            background: var(--accent);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            color: #fff;
            box-shadow: 0 4px 14px rgba(0, 122, 255, 0.2);
        }

        .logo h1 {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.3px;
        }

        .logo p {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 2px;
            letter-spacing: 0.2px;
        }

        .lang-switcher {
            display: flex;
            gap: 3px;
            background: rgba(0, 0, 0, 0.04);
            padding: 4px;
            border-radius: 10px;
            border: 1px solid var(--border);
        }

        .lang-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            padding: 7px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all var(--transition-fast);
        }

        .lang-btn.active {
            background: #fff;
            color: var(--accent);
            box-shadow: var(--shadow-xs);
            font-weight: 600;
        }

        .lang-btn:hover:not(.active) {
            color: var(--text-primary);
            background: rgba(0, 0, 0, 0.04);
        }

        /* ========== Hero Card ========== */
        .hero-card {
            background: var(--bg-card);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border-radius: var(--radius-xl);
            padding: 28px 32px;
            margin-bottom: 28px;
            border: 1px solid var(--border);
            box-shadow: var(--shadow-md);
            position: relative;
            overflow: hidden;
        }

        .hero-card::before {
            content: '';
            position: absolute;
            top: -30%;
            left: -10%;
            width: 60%;
            height: 160%;
            background: radial-gradient(ellipse, rgba(0, 122, 255, 0.04), transparent 70%);
            pointer-events: none;
            border-radius: 50%;
        }

        .ip-row {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 14px;
        }

        .ip-label {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--accent);
            min-width: 50px;
        }

        .ip-val {
            font-size: 28px;
            font-weight: 700;
            font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
            color: var(--text-primary);
            word-break: break-all;
            letter-spacing: -0.5px;
        }

        .ip-val-small {
            font-size: 18px;
            color: var(--text-secondary);
        }

        .stats-row {
            display: flex;
            gap: 14px;
            margin-top: 20px;
            flex-wrap: wrap;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            padding: 7px 16px;
            background: rgba(0, 0, 0, 0.03);
            border-radius: 20px;
            border: 1px solid rgba(0, 0, 0, 0.05);
            color: var(--text-secondary);
        }

        .stat-item strong {
            color: var(--text-primary);
            font-weight: 600;
        }

        .stat-item i {
            color: var(--accent);
            font-size: 13px;
        }

        .live-dot {
            display: inline-block;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--success);
            animation: pulse 2s ease-in-out infinite;
            margin-right: 6px;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.45; transform: scale(1.25); }
        }

        /* ========== Grid & Cards ========== */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
            gap: 20px;
            margin-bottom: 28px;
        }

        .rtt-card {
            grid-column: 1 / -1;
            min-height: 560px;
            display: flex;
            flex-direction: column;
            background: var(--bg-card);
            border: 1px solid var(--border-accent);
            box-shadow: var(--shadow-md);
        }

        .rtt-card .card-body {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 24px 28px;
        }

        .card {
            background: var(--bg-card);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            overflow: hidden;
            transition: all var(--transition-smooth);
            box-shadow: var(--shadow-xs);
        }

        .card:hover {
            box-shadow: var(--shadow-md);
            border-color: var(--border-accent);
        }

        .card-header {
            padding: 18px 24px;
            background: rgba(0, 0, 0, 0.015);
            border-bottom: 1px solid var(--divider);
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .card-header i {
            font-size: 22px;
            color: var(--accent);
            opacity: 0.8;
        }

        .card-header h3 {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.2px;
        }

        .card-header p {
            font-size: 11px;
            color: var(--text-tertiary);
            margin-top: 2px;
        }

        .card-body {
            padding: 20px 24px;
        }

        /* ========== Info Rows ========== */
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid var(--divider);
        }

        .info-row:last-child {
            border-bottom: none;
        }

        .info-label {
            font-size: 13px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .info-label i {
            font-size: 14px;
            width: 18px;
            color: var(--accent);
            opacity: 0.7;
        }

        .info-value {
            font-size: 13px;
            font-weight: 500;
            font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
            color: var(--text-primary);
        }

        /* ========== Badges ========== */
        .badge {
            padding: 4px 12px;
            border-radius: 14px;
            font-size: 11px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }

        .badge-success {
            background: var(--success-light);
            color: var(--success);
            border: 1px solid rgba(52, 199, 89, 0.2);
        }

        .badge-warning {
            background: var(--warning-light);
            color: #cc7a00;
            border: 1px solid rgba(255, 159, 10, 0.2);
        }

        .badge-danger {
            background: var(--danger-light);
            color: var(--danger);
            border: 1px solid rgba(255, 59, 48, 0.2);
        }

        .badge-info {
            background: var(--accent-light);
            color: var(--accent);
            border: 1px solid rgba(0, 122, 255, 0.18);
        }

        .badge-purple {
            background: rgba(175, 82, 222, 0.08);
            color: #8944ab;
            border: 1px solid rgba(175, 82, 222, 0.18);
        }

        /* ========== RTT Display ========== */
        .rtt-display {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 18px;
            margin-bottom: 24px;
        }

        .rtt-box {
            background: rgba(0, 0, 0, 0.02);
            border-radius: var(--radius-lg);
            padding: 24px 18px;
            text-align: center;
            border: 1px solid var(--border);
            transition: all var(--transition-smooth);
        }

        .rtt-box:hover {
            background: rgba(0, 122, 255, 0.03);
            border-color: var(--border-accent);
        }

        .rtt-value {
            font-size: 52px;
            font-weight: 700;
            color: var(--text-primary);
            line-height: 1.15;
            letter-spacing: -1.5px;
        }

        .rtt-label {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 10px;
            letter-spacing: 0.2px;
        }

        /* ========== Chart ========== */
        .chart-container {
            background: rgba(0, 0, 0, 0.015);
            border-radius: var(--radius-md);
            padding: 20px;
            margin: 20px 0;
            border: 1px solid var(--border);
        }

        canvas {
            width: 100%;
            height: 180px;
        }

        /* ========== Quality Grid ========== */
        .quality-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-top: 20px;
            padding-top: 18px;
            border-top: 1px solid var(--divider);
        }

        .quality-card {
            background: rgba(0, 0, 0, 0.02);
            border-radius: var(--radius-md);
            padding: 14px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all var(--transition-fast);
            border: 1px solid transparent;
        }

        .quality-card:hover {
            background: rgba(0, 0, 0, 0.04);
            border-color: var(--border);
        }

        .quality-label {
            font-size: 12px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .quality-label i {
            font-size: 13px;
            color: var(--accent);
            opacity: 0.7;
        }

        .quality-value {
            font-size: 15px;
            font-weight: 600;
        }

        /* ========== Buttons ========== */
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 20px;
        }

        .btn {
            padding: 10px 22px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            border: none;
            cursor: pointer;
            transition: all var(--transition-fast);
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-family: inherit;
            letter-spacing: -0.1px;
        }

        .btn-primary {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 2px 8px rgba(0, 122, 255, 0.25);
        }

        .btn-primary:hover {
            background: var(--accent-hover);
            box-shadow: 0 4px 14px rgba(0, 122, 255, 0.35);
            transform: translateY(-1px);
        }

        .btn-outline {
            background: rgba(0, 0, 0, 0.03);
            border: 1px solid var(--border);
            color: var(--text-primary);
        }

        .btn-outline:hover {
            background: rgba(0, 0, 0, 0.06);
            border-color: rgba(0, 0, 0, 0.12);
        }

        .btn-cyan {
            background: #007AFF;
            color: #fff;
            box-shadow: 0 2px 8px rgba(0, 122, 255, 0.2);
        }

        .btn-cyan:hover {
            background: #0066d6;
            box-shadow: 0 4px 14px rgba(0, 122, 255, 0.3);
            transform: translateY(-1px);
        }

        .btn-purple {
            background: #5856d6;
            color: #fff;
            box-shadow: 0 2px 8px rgba(88, 86, 214, 0.2);
        }

        .btn-purple:hover {
            background: #4b49c4;
            box-shadow: 0 4px 14px rgba(88, 86, 214, 0.3);
            transform: translateY(-1px);
        }

        /* ========== Result Area ========== */
        .result-area {
            margin-top: 16px;
            padding: 14px 18px;
            background: rgba(0, 0, 0, 0.02);
            border-radius: var(--radius-sm);
            font-size: 12px;
            border-left: 3px solid var(--accent);
            transition: all var(--transition-fast);
            color: var(--text-secondary);
        }

        .speed-result {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
        }

        .speed-item {
            background: var(--accent-glass);
            border-radius: var(--radius-sm);
            padding: 8px 14px;
            font-size: 12px;
            border-left: 2px solid var(--accent);
            color: var(--text-primary);
        }

        .hw-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .hw-chip {
            background: rgba(0, 0, 0, 0.03);
            border-radius: 20px;
            padding: 7px 14px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            border: 1px solid var(--border);
            color: var(--text-secondary);
        }

        .hw-chip i {
            color: var(--accent);
            opacity: 0.7;
            font-size: 11px;
        }

        /* ========== Footer ========== */
        .footer {
            margin-top: 28px;
            padding: 18px 28px;
            text-align: center;
            font-size: 12px;
            color: var(--text-tertiary);
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 14px;
            background: var(--bg-glass);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
        }

        .copy-btn {
            background: var(--accent-light);
            padding: 6px 16px;
            border-radius: 16px;
            font-size: 12px;
            cursor: pointer;
            transition: all var(--transition-fast);
            border: 1px solid rgba(0, 122, 255, 0.15);
            color: var(--accent);
            font-weight: 500;
        }

        .copy-btn:hover {
            background: rgba(0, 122, 255, 0.14);
            border-color: rgba(0, 122, 255, 0.3);
        }

        .driver-badge {
            width: 100%;
            text-align: center;
            padding: 10px 20px;
            margin-top: 14px;
            background: rgba(0, 0, 0, 0.02);
            border-radius: 20px;
            border: 1px solid var(--border);
            font-size: 11px;
            color: var(--text-quaternary);
            letter-spacing: 0.2px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .driver-badge a {
            color: var(--accent);
            text-decoration: none;
            font-weight: 500;
            transition: color var(--transition-fast);
            opacity: 0.7;
        }

        .driver-badge a:hover {
            color: var(--accent-hover);
            opacity: 1;
        }

        .driver-badge i {
            color: var(--accent);
            font-size: 10px;
            opacity: 0.4;
        }

        /* ========== Loading ========== */
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .loading {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(0, 122, 255, 0.2);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }

        /* ========== Stats & History ========== */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .stats-card {
            background: var(--bg-card);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 22px;
            overflow: hidden;
            box-shadow: var(--shadow-xs);
        }

        .stats-card .card-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
            border-bottom: 1px solid var(--divider);
            padding-bottom: 12px;
            background: transparent;
        }

        .stats-card .card-header i {
            font-size: 18px;
            color: var(--accent);
            opacity: 0.8;
        }

        .stats-card .card-header h3 {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
        }

        .stats-card .card-header p {
            font-size: 11px;
            color: var(--text-tertiary);
        }

        .stats-card .card-body {
            padding: 0;
        }

        .speed-history-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        .speed-history-table th {
            text-align: left;
            padding: 8px 10px;
            color: var(--text-tertiary);
            font-weight: 500;
            border-bottom: 1px solid var(--divider);
            font-size: 11px;
        }

        .speed-history-table td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--divider);
            color: var(--text-secondary);
        }

        .speed-history-table .speed-val {
            font-weight: 600;
            color: var(--accent);
        }

        .speed-history-table .speed-good { color: var(--success); font-weight: 600; }
        .speed-history-table .speed-mid { color: var(--warning); font-weight: 600; }
        .speed-history-table .speed-low { color: var(--danger); font-weight: 600; }

        .speed-bar {
            display: inline-block;
            height: 5px;
            border-radius: 3px;
            margin-right: 6px;
            vertical-align: middle;
            background: var(--accent);
            opacity: 0.5;
        }

        .usage-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 7px 0;
            border-bottom: 1px solid var(--divider);
            font-size: 12px;
        }

        .usage-row .ep {
            color: var(--text-secondary);
            font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
            font-size: 11px;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .usage-row .count {
            color: var(--accent);
            font-weight: 600;
        }

        .usage-total {
            text-align: center;
            padding: 14px;
            font-size: 26px;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.5px;
        }

        .usage-total-label {
            text-align: center;
            font-size: 11px;
            color: var(--text-tertiary);
            margin-top: 2px;
        }

        .no-data {
            text-align: center;
            padding: 28px;
            color: var(--text-quaternary);
            font-size: 13px;
        }

        /* ========== Scrollbar ========== */
        ::-webkit-scrollbar {
            width: 5px;
            height: 5px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.15);
            border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: rgba(0, 0, 0, 0.25);
        }

        /* ========== Responsive ========== */
        @media (max-width: 1024px) {
            .rtt-display {
                grid-template-columns: repeat(2, 1fr);
            }
            .quality-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (max-width: 768px) {
            body {
                padding: 14px;
            }
            .container {
                max-width: 100%;
            }
            .grid {
                grid-template-columns: 1fr;
                gap: 14px;
            }
            .ip-val {
                font-size: 18px;
            }
            .ip-val-small {
                font-size: 15px;
            }
            .header {
                flex-direction: column;
                text-align: center;
                padding: 14px 20px;
                border-radius: var(--radius-lg);
            }
            .logo {
                flex-direction: column;
                gap: 8px;
            }
            .logo-icon {
                width: 44px;
                height: 44px;
                font-size: 20px;
                border-radius: var(--radius-sm);
            }
            .logo h1 {
                font-size: 22px;
            }
            .button-group {
                justify-content: center;
            }
            .btn {
                padding: 9px 18px;
                font-size: 12px;
            }
            .rtt-value {
                font-size: 36px;
            }
            .rtt-display {
                grid-template-columns: 1fr;
                gap: 12px;
            }
            .rtt-box {
                padding: 18px 14px;
            }
            .stats-row {
                justify-content: center;
            }
            .footer {
                flex-direction: column;
                text-align: center;
                padding: 14px 20px;
                border-radius: var(--radius-md);
            }
            .quality-grid {
                grid-template-columns: 1fr;
                gap: 10px;
            }
            .hero-card {
                padding: 20px;
                border-radius: var(--radius-lg);
            }
            .rtt-card {
                min-height: auto;
            }
            .rtt-card .card-body {
                padding: 16px;
            }
            .card-header {
                padding: 14px 18px;
            }
            .card-body {
                padding: 14px 18px;
            }
            .stats-grid {
                grid-template-columns: 1fr;
                gap: 14px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <div class="logo-icon">
                    <i class="fas fa-chart-network"></i>
                </div>
                <div>
                    <h1>NetSight Pro</h1>
                    <p><i class="fas fa-bolt"></i> 极光诊断 · 实时网络分析</p>
                </div>
            </div>
            <div class="lang-switcher">
                <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
                <button class="lang-btn" data-lang="zh-CN" onclick="setLang('zh-CN')">简体</button>
                <button class="lang-btn" data-lang="zh-TW" onclick="setLang('zh-TW')">繁體</button>
            </div>
        </div>

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
                <div class="stat-item"><i class="fas fa-map-marker-alt"></i> 边缘节点: <strong id="colo-display">${data.colo}</strong></div>
                <div class="stat-item"><i class="far fa-clock"></i> Worker 耗时: <strong>${workerDuration}ms</strong></div>
                <div class="stat-item"><span class="live-dot"></span> <span id="t-live">实时监控中</span></div>
            </div>
        </div>

        <div class="card rtt-card">
            <div class="card-header">
                <i class="fas fa-waveform"></i>
                <div>
                    <h3 id="t-rtt">实时延迟监控</h3>
                    <p>RTT · 抖动 · 实时图表 · 网络质量评估</p>
                </div>
            </div>
            <div class="card-body">
                <div class="rtt-display">
                    <div class="rtt-box">
                        <div class="rtt-value" id="rtt-num">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-right"></i> 当前 RTT (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="jitter-val">--</div>
                        <div class="rtt-label"><i class="fas fa-chart-line"></i> <span id="t-jitter">抖动</span> (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="min-rtt">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-down"></i> 最低 RTT (ms)</div>
                    </div>
                    <div class="rtt-box">
                        <div class="rtt-value" id="max-rtt">--</div>
                        <div class="rtt-label"><i class="fas fa-arrow-up"></i> 最高 RTT (ms)</div>
                    </div>
                </div>
                
                <div class="chart-container">
                    <canvas id="chart"></canvas>
                </div>
                
                <div class="quality-grid">
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-signal"></i> 连接质量</span>
                        <span class="quality-value" id="quality-badge" style="color: var(--chart-green);">优秀</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-chart-simple"></i> 网络稳定性</span>
                        <span class="quality-value" id="stability-badge" style="color: var(--chart-teal);">稳定</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-chart-bar"></i> 样本数量</span>
                        <span class="quality-value" id="sample-count" style="font-family: monospace;">0</span>
                    </div>
                    <div class="quality-card">
                        <span class="quality-label"><i class="fas fa-exchange-alt"></i> 丢包率</span>
                        <span class="quality-value" id="loss-rate" style="color: var(--chart-green);">0%</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-shield-haltered"></i>
                    <div>
                        <h3 id="t-sec">安全与协议</h3>
                        <p>TLS · 加密 · 身份验证</p>
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
                        <span class="info-label"><i class="fas fa-network-wired"></i> ASN</span>
                        <span class="info-value">${data.asn}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-exchange-alt"></i> <span id="t-proto-label">协议</span></span>
                        <span class="info-value" id="proto-val">${data.proto}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-lock"></i> TLS 版本</span>
                        <span class="info-value"><span class="badge badge-info">${data.tlsVersion}</span></span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-key"></i> <span id="t-cipher-label">加密套件</span></span>
                        <span class="info-value" style="font-size: 11px; font-family: monospace;">${data.tlsCipher}</span>
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
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <i class="fas fa-map-pin"></i>
                    <div>
                        <h3 id="t-geo">边缘节点位置</h3>
                        <p>Cloudflare 数据中心</p>
                    </div>
                </div>
                <div class="card-body">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-globe-asia" style="font-size: 48px; color: var(--chart-cyan); opacity: 0.7;"></i>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-location-dot"></i> 位置</span>
                        <span class="info-value">${data.city}, ${data.region}, ${data.country}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-crosshairs"></i> 坐标</span>
                        <span class="info-value">${data.lat}°${data.latDir} / ${data.lon}°${data.lonDir}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-building"></i> 运营商</span>
                        <span class="info-value" style="font-size: 12px;">${data.asOrg}</span>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <i class="fas fa-user-secret"></i>
                    <div>
                        <h3 id="t-user-geo">真实 IP 位置</h3>
                        <p>客户端地理位置</p>
                    </div>
                </div>
                <div class="card-body" id="user-geo-info">
                    <div style="text-align: center; padding: 30px;">
                        <i class="fas fa-spinner fa-spin"></i> 定位中...
                    </div>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom: 28px;">
            <div class="card-header">
                <i class="fas fa-flask"></i>
                <div>
                    <h3>诊断工具集</h3>
                    <p>一键测试 · 全面诊断</p>
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
                </div>

                <div id="loss-result" class="result-area" style="display: none;"></div>
                <div id="speed-result" style="display: none;"></div>
                <div id="dns-result" class="result-area" style="display: none;"></div>
                <div id="cpu-result" class="result-area" style="display: none;"></div>
                <div id="ws-result" class="result-area" style="display: none;"></div>
                <div id="concurrent-result" class="result-area" style="display: none;"></div>
                <div id="stream-result" class="result-area" style="display: none;"></div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <i class="fas fa-desktop"></i>
                <div>
                    <h3 id="t-hw">硬件信息</h3>
                    <p>客户端环境</p>
                </div>
            </div>
            <div class="card-body">
                <div id="hw-info" class="hw-grid">
                    加载中...
                </div>
            </div>
        </div>

        
        <div class="stats-grid">
            <div class="stats-card">
                <div class="card-header">
                    <i class="fas fa-chart-line"></i>
                    <div>
                        <h3>测速历史</h3>
                        <p>最近 10 条带宽测速记录</p>
                    </div>
                </div>
                <div class="card-body" id="speed-history-panel">
                    <div class="no-data"><i class="fas fa-inbox"></i> 暂无测速记录</div>
                </div>
            </div>
            <div class="stats-card">
                <div class="card-header">
                    <i class="fas fa-chart-bar"></i>
                    <div>
                        <h3>用量统计</h3>
                        <p>API 端点调用统计</p>
                    </div>
                </div>
                <div class="card-body" id="usage-stats-panel">
                    <div class="no-data"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                </div>
            </div>
        </div>


        <div class="footer">
            <span><i class="fas fa-fingerprint"></i> RAY ID: <span style="font-family: monospace;">${data.rayId}</span></span>
            <span><i class="fas fa-ip"></i> 客户端: ${data.clientIp}</span>
            <span class="copy-btn" id="copy-report"><i class="fas fa-copy"></i> <span id="t-copy">复制报告</span></span>
        </div>

        <!-- CF-workers-netdiag 驱动声明 -->
        <div class="driver-badge">
            <i class="fas fa-bolt"></i>
            由 
            <a href="https://github.com/BlueDriftHK/CF-workers-netdiag" 
               target="_blank" 
               rel="noopener noreferrer">
                CF-workers-netdiag
            </a>
            <span style="color: var(--text-quaternary);">·</span>
            <span style="color: var(--text-quaternary);">强力驱动</span>
            <i class="fas fa-rocket"></i>
        </div>
    </div>

    <script nonce="${nonce}">
        (function(){
            const i18n = {
                'en': { 
                    sec: 'Security & Protocol', geo: 'Edge Location', userGeo: 'Client Location',
                    rtt: 'Real-time RTT', hw: 'Hardware Info', live: 'Live Monitoring',
                    risk: 'Risk Level', clean: 'Low Risk', high: 'High Risk', yes: 'YES', no: 'NO',
                    unavailable: 'Unavailable', copy: 'Copy Report', copied: 'Copied!',
                    dcLabel: 'DC / Proxy', protoLabel: 'Protocol', echLabel: 'ECH',
                    echEnabled: 'Enabled', echDisabled: 'Disabled', botLabel: 'Bot Score',
                    lossBtn: 'Packet Loss', speedBtn: 'Bandwidth', dnsBtn: 'DNS',
                    cpuBtn: 'CPU', wsBtn: 'WebSocket', concurrentBtn: 'Concurrent', streamBtn: 'Stream',
                    lossTesting: 'Testing...', lossNone: '0% (no loss)',
                    jitter: 'Jitter', dnsTesting: 'Testing DNS...',
                    speedTesting: 'Testing bandwidth...', cpuTesting: 'CPU benchmark...',
                    wsTesting: 'WebSocket latency...', concurrentTesting: 'Concurrency test...',
                    streamTesting: 'Stream throughput...', compressLabel: 'Compression',
                    http2Label: 'HTTP/2', lossResult: 'Loss', http2Enabled: 'HTTP/2 Enabled',
                    http2Disabled: 'HTTP/1.1', earlyHints: 'Early Hints'
                },
                'zh-CN': { 
                    sec: '安全与协议', geo: '边缘节点位置', userGeo: '真实 IP 位置',
                    rtt: '实时延迟监控', hw: '硬件信息', live: '实时监控',
                    risk: '风险等级', clean: '低风险', high: '高风险', yes: '是', no: '否',
                    unavailable: '获取失败', copy: '复制报告', copied: '已复制!',
                    dcLabel: '数据中心/代理', protoLabel: '协议', echLabel: 'ECH',
                    echEnabled: '已启用', echDisabled: '未启用', botLabel: '机器人评分',
                    lossBtn: '丢包率', speedBtn: '带宽测速', dnsBtn: 'DNS 解析',
                    cpuBtn: 'CPU 性能', wsBtn: 'WebSocket', concurrentBtn: '并发测试', streamBtn: '流式传输',
                    lossTesting: '测试中...', lossNone: '0% (无丢包)',
                    jitter: '抖动', dnsTesting: '正在测试 DNS...',
                    speedTesting: '正在测速...', cpuTesting: 'CPU 基准测试...',
                    wsTesting: 'WebSocket 延迟测试...', concurrentTesting: '并发测试中...',
                    streamTesting: '流式吞吐量测试...', compressLabel: '压缩算法',
                    http2Label: 'HTTP/2 状态', lossResult: '丢包率', http2Enabled: 'HTTP/2 已启用',
                    http2Disabled: 'HTTP/1.1', earlyHints: 'Early Hints'
                },
                'zh-TW': { 
                    sec: '安全與協議', geo: '邊緣節點位置', userGeo: '真實 IP 位置',
                    rtt: '即時延遲監控', hw: '硬體資訊', live: '即時監控',
                    risk: '風險等級', clean: '低風險', high: '高風險', yes: '是', no: '否',
                    unavailable: '獲取失敗', copy: '複製報告', copied: '已複製!',
                    dcLabel: '資料中心/代理', protoLabel: '協議', echLabel: 'ECH',
                    echEnabled: '已啟用', echDisabled: '未啟用', botLabel: '機器人評分',
                    lossBtn: '丟包率', speedBtn: '頻寬測速', dnsBtn: 'DNS 解析',
                    cpuBtn: 'CPU 性能', wsBtn: 'WebSocket', concurrentBtn: '併發測試', streamBtn: '串流傳輸',
                    lossTesting: '測試中...', lossNone: '0% (無丟包)',
                    jitter: '抖動', dnsTesting: '正在測試 DNS...',
                    speedTesting: '正在測速...', cpuTesting: 'CPU 基準測試...',
                    wsTesting: 'WebSocket 延遲測試...', concurrentTesting: '併發測試中...',
                    streamTesting: '串流吞吐量測試...', compressLabel: '壓縮演算法',
                    http2Label: 'HTTP/2 狀態', lossResult: '丟包率', http2Enabled: 'HTTP/2 已啟用',
                    http2Disabled: 'HTTP/1.1', earlyHints: 'Early Hints'
                }
            };
            
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
                realGeoOrg: "${realGeoJS.org}", realGeoIp: "${realGeoJS.ip}"
            };
            
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
                streamResult: document.getElementById('stream-result')
            };
            
            let currentLang = localStorage.getItem('pref-lang') || '${defaultLang}';
            const rttData = [];
            const MAX_RTT_POINTS = 40;
            const jitterHistory = [];
            const MAX_JITTER_HISTORY = 10;
            let geoRetryCount = 0;
            const MAX_GEO_RETRY = 5;
            let consecutiveLoss = 0;
            let sampleCount = 0;
            let minRtt = Infinity;
            let maxRtt = 0;
            let rttTestRunning = true;
            
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
                    setTimeout(() => {
                        if (element.innerHTML === html && element.style.display === 'block') {
                            element.style.opacity = '0.5';
                            setTimeout(() => {
                                if (element.innerHTML === html) {
                                    element.style.display = 'none';
                                    element.style.opacity = '1';
                                }
                            }, 3000);
                        }
                    }, 5000);
                }
            }
            
            function updateUI() {
                const t = i18n[currentLang];
                const textIds = {
                    't-sec': t.sec, 't-geo': t.geo, 't-user-geo': t.userGeo,
                    't-rtt': t.rtt, 't-hw': t.hw, 't-live': t.live,
                    't-risk': t.risk, 't-copy': t.copy,
                    't-dc-label': t.dcLabel, 't-proto-label': t.protoLabel,
                    't-ech-label': t.echLabel, 't-bot-label': t.botLabel,
                    't-jitter': t.jitter, 't-loss-btn': t.lossBtn,
                    't-speed-btn': t.speedBtn, 't-dns-btn': t.dnsBtn,
                    't-cpu-btn': t.cpuBtn, 't-ws-btn': t.wsBtn,
                    't-concurrent-btn': t.concurrentBtn, 't-stream-btn': t.streamBtn,
                    't-compress-label': t.compressLabel, 't-http2-label': t.http2Label
                };
                Object.entries(textIds).forEach(([id, text]) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = text;
                });
                
                document.querySelectorAll('.lang-btn').forEach(btn => {
                    const lang = btn.getAttribute('data-lang');
                    btn.classList.toggle('active', lang === currentLang);
                });
                
                const dc = isDataCenter();
                if (elements.sDc) {
                    elements.sDc.innerHTML = dc ? '<span class="badge badge-danger">' + t.yes + '</span>' : '<span class="badge badge-success">' + t.no + '</span>';
                }
                if (elements.sRisk) {
                    elements.sRisk.innerHTML = dc ? '<span class="badge badge-danger">' + t.high + '</span>' : '<span class="badge badge-success">' + t.clean + '</span>';
                }

                if (elements.protoVal) {
                    const rawProto = BACKEND_DATA.httpProtocolRaw;
                    let displayText = rawProto;
                    if (rawProto.toUpperCase().includes('HTTP/3')) {
                        displayText += ' <span class="badge badge-info">QUIC</span>';
                    }
                    elements.protoVal.innerHTML = displayText;
                }

                if (elements.echVal) {
                    const helloLen = BACKEND_DATA.tlsClientHelloLength;
                    if (helloLen > 0) {
                        elements.echVal.innerHTML = '<span class="badge badge-success">' + t.echEnabled + '</span>';
                    } else {
                        elements.echVal.innerHTML = '<span class="badge badge-danger">' + t.echDisabled + '</span>';
                    }
                }

                if (elements.compressVal) {
                    const parts = [];
                    if (BACKEND_DATA.compressionBrotli) parts.push('<span class="badge badge-info">br</span>');
                    if (BACKEND_DATA.compressionGzip) parts.push('<span class="badge badge-info">gzip</span>');
                    if (parts.length === 0) parts.push('<span class="badge">none</span>');
                    elements.compressVal.innerHTML = parts.join(' ');
                }

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
            };
            
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
            
            function updateQuality(currentRtt) {
                const qualityEl = document.getElementById('quality-badge');
                const stabilityEl = document.getElementById('stability-badge');
                
                if (qualityEl) {
                    let qualityText = '', qualityColor = '';
                    if (currentRtt < 50) { qualityText = '优秀'; qualityColor = '#34d399'; }
                    else if (currentRtt < 100) { qualityText = '良好'; qualityColor = '#34d399'; }
                    else if (currentRtt < 150) { qualityText = '一般'; qualityColor = '#fbbf24'; }
                    else if (currentRtt < 250) { qualityText = '较差'; qualityColor = '#f87171'; }
                    else { qualityText = '极差'; qualityColor = '#f87171'; }
                    qualityEl.textContent = qualityText;
                    qualityEl.style.color = qualityColor;
                }
                
                if (stabilityEl && jitterHistory.length > 0) {
                    const avgJitter = jitterHistory.reduce((a,b) => a+b, 0) / jitterHistory.length;
                    let stabilityText = '', stabilityColor = '';
                    if (avgJitter < 10) { stabilityText = '非常稳定'; stabilityColor = '#34d399'; }
                    else if (avgJitter < 30) { stabilityText = '稳定'; stabilityColor = '#22d3ee'; }
                    else if (avgJitter < 60) { stabilityText = '不稳定'; stabilityColor = '#fbbf24'; }
                    else { stabilityText = '极不稳定'; stabilityColor = '#f87171'; }
                    stabilityEl.textContent = stabilityText;
                    stabilityEl.style.color = stabilityColor;
                }
            }
            
            function updateLossRate() {
                const lossRateEl = document.getElementById('loss-rate');
                if (lossRateEl) {
                    const rate = sampleCount > 0 ? Math.round((consecutiveLoss / Math.min(sampleCount, 10)) * 100) : 0;
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
                    updateLossRate();
                    if (elements.rttNum) elements.rttNum.textContent = 'ERR';
                    updateQuality(999);
                }
                setTimeout(testRtt, 2000);
            }
            
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
            
            async function fetchUserGeo() {
                if (!elements.userGeoInfo) return;
                
                if (BACKEND_DATA.realGeoCity && BACKEND_DATA.realGeoCountry) {
                    const dist = calculateDistance(
                        BACKEND_DATA.latNum, BACKEND_DATA.lonNum,
                        BACKEND_DATA.realGeoLat, BACKEND_DATA.realGeoLon
                    );
                    
                    elements.userGeoInfo.innerHTML = \`
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-city"></i> 位置</span>
                            <span class="info-value">\${BACKEND_DATA.realGeoCity}, \${BACKEND_DATA.realGeoRegion}, \${BACKEND_DATA.realGeoCountry}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ruler"></i> 到节点距离</span>
                            <span class="info-value"><span class="badge badge-info">\${dist} 公里</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-building"></i> 运营商</span>
                            <span class="info-value">\${BACKEND_DATA.realGeoOrg}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ip"></i> IP 地址</span>
                            <span class="info-value"><code>\${BACKEND_DATA.realGeoIp}</code></span>
                        </div>
                    \`;
                    return;
                }
                
                const ip = elements.v4 ? elements.v4.textContent : '';
                if (!ip || ip.includes('检测中') || ip.includes(i18n[currentLang].unavailable)) {
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
                            <span class="info-label"><i class="fas fa-city"></i> 位置</span>
                            <span class="info-value">\${geoData.city}, \${geoData.region}, \${geoData.country_name}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ruler"></i> 到节点距离</span>
                            <span class="info-value"><span class="badge badge-info">\${dist} 公里</span></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-building"></i> 运营商</span>
                            <span class="info-value">\${geoData.org}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label"><i class="fas fa-ip"></i> IP 地址</span>
                            <span class="info-value"><code>\${ip}</code></span>
                        </div>
                    \`;
                } catch (e) {
                    elements.userGeoInfo.innerHTML = '<div style="text-align: center; padding: 30px; color: #f87171;"><i class="fas fa-exclamation-triangle"></i> 地理位置查询失败</div>';
                }
            }
            
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

            function generateReportText() {
                const t = i18n[currentLang];
                const now = new Date().toLocaleString('zh-CN');
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
                
                return \`【NetSight Pro 极光网络诊断报告】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 生成时间: \${now}
📍 边缘节点: \${BACKEND_DATA.colo} (\${BACKEND_DATA.city})
🌐 客户端 IPv4: \${elements.v4 ? elements.v4.textContent : 'N/A'}
🔑 RAY ID: \${BACKEND_DATA.rayId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 网络指标
   当前 RTT: \${currentRtt} ms
   网络抖动: \${currentJitter} ms
   最低 RTT: \${minRttVal} ms
   最高 RTT: \${maxRttVal} ms
   连接质量: \${quality}
   网络稳定性: \${stability}
   丢包率: \${lossRate}
   样本数量: \${sampleCountVal}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 安全与协议
   协议: \${BACKEND_DATA.httpProtocolRaw}
   TLS 版本: \${BACKEND_DATA.tlsVersion}
   加密套件: \${BACKEND_DATA.tlsCipher}
   ECH: \${BACKEND_DATA.tlsClientHelloLength > 0 ? '已启用' : '未启用'}
   压缩算法: \${BACKEND_DATA.compressionBrotli ? 'Brotli ' : ''}\${BACKEND_DATA.compressionGzip ? 'Gzip' : '无'}
   HTTP/2 状态: \${http2Status}
   机器人评分: \${BACKEND_DATA.botScore}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 位置信息
   边缘节点: \${BACKEND_DATA.city}, \${BACKEND_DATA.region}, \${BACKEND_DATA.country}
   客户端: \${clientLocation}
   运营商: \${BACKEND_DATA.realGeoOrg || BACKEND_DATA.asOrg}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 NetSight Pro - 极光网络诊断工具
💡 由 CF-workers-netdiag · 强力驱动
\`;
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
                        panel.innerHTML = '<div class="no-data"><i class="fas fa-inbox"></i> 暂无测速记录</div>';
                        return;
                    }
                    let html = '<table class="speed-history-table"><thead><tr><th>时间</th><th>平均速度</th><th>节点</th></tr></thead><tbody>';
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
            

            function init() {
                minRtt = Infinity;
                maxRtt = 0;
                sampleCount = 0;
                consecutiveLoss = 0;
                
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
                loadSpeedHistory();
                loadUsageStats();
                setInterval(() => { loadSpeedHistory(); loadUsageStats(); }, 30000);
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
