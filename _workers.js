// ============================================================
// NetSight Pro - 蓝色极速网络诊断工具
// Cloudflare Worker 完整优化版
// 版本: 2.1 | UI全面优化
// ============================================================

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const cache = caches.default;
  
  // ==================== KV 缓存策略：静态资源缓存 7 天 ====================
  if (url.pathname.startsWith('/static/')) {
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    if (typeof CACHE_KV !== 'undefined' && CACHE_KV) {
      const kvValue = await CACHE_KV.get(url.pathname);
      if (kvValue) {
        const response = new Response(kvValue, {
          headers: { 'content-type': 'text/css' }
        });
        event.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
    }
  }

  // ==================== 速度测试端点 ====================
  if (url.pathname === '/speedtest') {
    const size = parseInt(url.searchParams.get('size')) || 102400;
    const data = new Uint8Array(size);
    crypto.getRandomValues(data);
    return new Response(data, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*'
      }
    });
  }

  // ==================== CPU 密集型测试端点 ====================
  if (url.pathname === '/cpu-test') {
    const iterations = parseInt(url.searchParams.get('n')) || 500000;
    const start = Date.now();
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i);
    }
    const duration = Date.now() - start;
    return new Response(JSON.stringify({
      duration: duration,
      iterations: iterations,
      opsMs: Math.round(iterations / duration * 100) / 100,
      result: result.toString().substring(0, 8)
    }), {
      headers: { 
        'content-type': 'application/json', 
        'cache-control': 'no-store',
        'access-control-allow-origin': '*'
      }
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
    server.addEventListener('message', event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') {
          server.send(JSON.stringify({ 
            type: 'pong', 
            timestamp: Date.now(),
            serverTime: Date.now()
          }));
        }
      } catch (e) {
        server.send(JSON.stringify({ type: 'error', message: '无效消息格式' }));
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  // ==================== HTTP/2 Server Push 检测端点 ====================
  if (url.pathname === '/push-test') {
    const headers = new Headers({
      'content-type': 'text/plain',
      'cache-control': 'no-store',
      'link': '</push-test?pushed=true>; rel=preload; as=fetch'
    });
    
    const isPushed = url.searchParams.get('pushed') === 'true';
    return new Response(isPushed ? 'PUSHED' : 'MAIN', { headers });
  }

  // ==================== 多文件并发下载测试 ====================
  if (url.pathname === '/concurrent-test') {
    const count = parseInt(url.searchParams.get('count')) || 4;
    const size = parseInt(url.searchParams.get('size')) || 1024;
    const promises = [];
    const results = [];
    
    for (let i = 0; i < count; i++) {
      promises.push(
        (async () => {
          const start = Date.now();
          const data = new Uint8Array(size);
          crypto.getRandomValues(data);
          results.push({
            index: i,
            size: size,
            duration: Date.now() - start
          });
        })()
      );
    }
    
    await Promise.all(promises);
    return new Response(JSON.stringify(results), {
      headers: { 
        'content-type': 'application/json', 
        'cache-control': 'no-store',
        'access-control-allow-origin': '*'
      }
    });
  }

  // ==================== 大文件流式传输测试 ====================
  if (url.pathname === '/stream-test') {
    const size = parseInt(url.searchParams.get('size')) || 1048576;
    const chunkSize = 65536;
    
    const stream = new ReadableStream({
      start(controller) {
        let sent = 0;
        const pushChunk = () => {
          if (sent < size) {
            const remaining = size - sent;
            const currentChunk = Math.min(remaining, chunkSize);
            const chunk = new Uint8Array(currentChunk);
            crypto.getRandomValues(chunk);
            controller.enqueue(chunk);
            sent += currentChunk;
            if (sent < size) {
              setTimeout(pushChunk, 0);
            } else {
              controller.close();
            }
          }
        };
        pushChunk();
      }
    });
    
    return new Response(stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'content-length': size.toString(),
        'access-control-allow-origin': '*'
      }
    });
  }

  // ==================== 主诊断页面 ====================
  const workerStart = Date.now();
  const cf = request.cf || {};
  
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
    clientIp: escapeForJS(request.headers.get('cf-connecting-ip') || 'N/A'),
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
  const realClientIp = request.headers.get('cf-connecting-ip') || '';
  if (realClientIp) {
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${realClientIp}?fields=city,regionName,country,countryCode,lat,lon,org,query`, {
        headers: { 'User-Agent': 'Cloudflare-Worker/1.0' }
      });
      if (geoRes.ok) {
        realGeoData = await geoRes.json();
      }
    } catch (e) {}
  }

  const realGeo = realGeoData || {};
  const realGeoJS = {
    city: escapeForJS(realGeo.city || ''),
    region: escapeForJS(realGeo.regionName || ''),
    country: escapeForJS(realGeo.country || ''),
    countryCode: escapeForJS(realGeo.countryCode || ''),
    lat: realGeo.lat || 0,
    lon: realGeo.lon || 0,
    org: escapeForJS(realGeo.org || ''),
    ip: escapeForJS(realGeo.query || realClientIp)
  };

  // 检测接受的编码格式
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  const supportsBrotli = acceptEncoding.includes('br');
  const compressionInfo = {
    brotli: supportsBrotli,
    gzip: acceptEncoding.includes('gzip'),
    deflate: acceptEncoding.includes('deflate'),
    zstd: acceptEncoding.includes('zstd')
  };
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>NetSight Pro | 蓝色极速网络诊断</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300;14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --primary: #2563eb;
            --primary-light: #3b82f6;
            --primary-cyan: #06b6d4;
            --primary-glow: rgba(37, 99, 235, 0.4);
            --bg-dark: #0a0f1a;
            --bg-card: rgba(15, 25, 45, 0.55);
            --border-glow: rgba(59, 130, 246, 0.25);
            --text-dim: rgba(255,255,255,0.5);
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0a0f1a 0%, #0d1425 50%, #0a0c15 100%);
            min-height: 100vh;
            padding: 20px;
            color: #fff;
            position: relative;
        }

        /* 动态网格背景 */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: linear-gradient(var(--border-glow) 1px, transparent 1px), linear-gradient(90deg, var(--border-glow) 1px, transparent 1px);
            background-size: 50px 50px;
            pointer-events: none;
            z-index: 0;
            opacity: 0.4;
        }

        /* 光晕效果 */
        body::after {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.08) 0%, transparent 60%);
            pointer-events: none;
            z-index: 0;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            position: relative;
            z-index: 1;
        }

        /* 玻璃态效果 */
        .glass {
            background: var(--bg-card);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border-glow);
            border-radius: 32px;
        }

        /* 头部导航 */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 32px;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 20px;
            background: rgba(10, 15, 26, 0.7);
            backdrop-filter: blur(16px);
            border-radius: 32px;
            border: 1px solid var(--border-glow);
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .logo-icon {
            width: 52px;
            height: 52px;
            background: linear-gradient(135deg, var(--primary), var(--primary-cyan));
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            box-shadow: 0 8px 20px var(--primary-glow);
            animation: glowPulse 3s infinite;
        }

        @keyframes glowPulse {
            0%, 100% { box-shadow: 0 8px 20px var(--primary-glow); }
            50% { box-shadow: 0 8px 30px rgba(37, 99, 235, 0.6); }
        }

        .logo h1 {
            font-size: 26px;
            font-weight: 700;
            background: linear-gradient(135deg, #fff, var(--primary-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .logo p {
            font-size: 12px;
            color: var(--text-dim);
            margin-top: 4px;
        }

        .lang-switcher {
            display: flex;
            gap: 8px;
            background: rgba(59, 130, 246, 0.08);
            padding: 6px;
            border-radius: 40px;
            border: 1px solid var(--border-glow);
        }

        .lang-btn {
            background: transparent;
            border: none;
            color: var(--text-dim);
            padding: 8px 20px;
            border-radius: 32px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.3s ease;
        }

        .lang-btn.active {
            background: linear-gradient(135deg, var(--primary), var(--primary-cyan));
            color: #fff;
            box-shadow: 0 2px 8px var(--primary-glow);
        }

        .lang-btn:hover:not(.active) {
            color: #fff;
            background: rgba(59, 130, 246, 0.2);
        }

        /* IP 卡片 */
        .ip-card {
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(6, 182, 212, 0.08) 100%);
            border-radius: 36px;
            padding: 32px;
            margin-bottom: 30px;
            border: 1px solid var(--border-glow);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .ip-row {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 16px;
        }

        .ip-label {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--primary-cyan);
            min-width: 55px;
        }

        .ip-val {
            font-size: 28px;
            font-weight: 700;
            font-family: 'Monaco', 'Courier New', monospace;
            background: linear-gradient(135deg, #fff, var(--primary-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            word-break: break-all;
        }

        .ip-val-small {
            font-size: 18px;
        }

        .stats-row {
            display: flex;
            gap: 20px;
            margin-top: 24px;
            flex-wrap: wrap;
        }

        .stat-item {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
            padding: 8px 18px;
            background: rgba(59, 130, 246, 0.1);
            border-radius: 40px;
            border: 1px solid var(--border-glow);
        }

        .stat-item i {
            color: var(--primary-cyan);
        }

        /* 网格布局 */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
            gap: 24px;
            margin-bottom: 30px;
        }

        /* 卡片样式 */
        .card {
            background: var(--bg-card);
            backdrop-filter: blur(12px);
            border-radius: 28px;
            border: 1px solid var(--border-glow);
            overflow: hidden;
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .card:hover {
            transform: translateY(-6px);
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
            border-color: rgba(59, 130, 246, 0.5);
        }

        .card-header {
            padding: 20px 24px;
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(6, 182, 212, 0.04) 100%);
            border-bottom: 1px solid var(--border-glow);
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .card-header i {
            font-size: 28px;
            color: var(--primary-cyan);
        }

        .card-header h3 {
            font-size: 18px;
            font-weight: 600;
        }

        .card-header p {
            font-size: 11px;
            color: var(--text-dim);
            margin-top: 4px;
        }

        .card-body {
            padding: 24px;
        }

        /* 信息行 */
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid rgba(59, 130, 246, 0.08);
        }

        .info-row:last-child {
            border-bottom: none;
        }

        .info-label {
            font-size: 13px;
            color: var(--text-dim);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .info-label i {
            font-size: 14px;
            width: 20px;
            color: var(--primary-cyan);
        }

        .info-value {
            font-size: 14px;
            font-weight: 500;
            font-family: 'Monaco', 'Courier New', monospace;
        }

        /* 徽章 */
        .badge {
            padding: 4px 12px;
            border-radius: 30px;
            font-size: 11px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .badge-success {
            background: rgba(34, 197, 94, 0.15);
            color: #4ade80;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .badge-warning {
            background: rgba(245, 158, 11, 0.15);
            color: #fbbf24;
            border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .badge-danger {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .badge-info {
            background: rgba(6, 182, 212, 0.15);
            color: #22d3ee;
            border: 1px solid rgba(6, 182, 212, 0.3);
        }

        /* 实时延迟区域 - 拉长版 */
        .rtt-card {
            min-height: 520px;
            display: flex;
            flex-direction: column;
        }
        
        .rtt-card .card-body {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .rtt-display {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 25px;
        }

        .rtt-box {
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(37, 99, 235, 0.05));
            border-radius: 24px;
            padding: 20px 16px;
            text-align: center;
            border: 1px solid rgba(56, 189, 248, 0.2);
            transition: all 0.3s ease;
        }

        .rtt-box:hover {
            transform: translateY(-3px);
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(37, 99, 235, 0.1));
            border-color: rgba(56, 189, 248, 0.5);
        }

        .rtt-value {
            font-size: 48px;
            font-weight: 800;
            background: linear-gradient(135deg, #fff, var(--primary-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            line-height: 1.2;
        }

        .rtt-label {
            font-size: 12px;
            color: var(--text-dim);
            margin-top: 10px;
            letter-spacing: 0.5px;
        }

        .chart-container {
            background: rgba(0, 0, 0, 0.35);
            border-radius: 20px;
            padding: 20px;
            margin: 20px 0;
            border: 1px solid var(--border-glow);
        }

        canvas {
            width: 100%;
            height: 140px;
        }

        /* 质量指标行 */
        .quality-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--border-glow);
        }

        .quality-card {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 18px;
            padding: 14px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }

        .quality-card:hover {
            background: rgba(0, 0, 0, 0.45);
            border-color: rgba(56, 189, 248, 0.3);
        }

        .quality-label {
            font-size: 12px;
            color: var(--text-dim);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .quality-label i {
            font-size: 14px;
            color: var(--primary-cyan);
        }

        .quality-value {
            font-size: 15px;
            font-weight: 700;
        }

        /* 按钮组 */
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 20px;
        }

        .btn {
            padding: 10px 24px;
            border-radius: 40px;
            font-size: 13px;
            font-weight: 500;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-family: inherit;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-cyan));
            color: white;
            box-shadow: 0 2px 10px var(--primary-glow);
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(37, 99, 235, 0.4);
        }

        .btn-outline {
            background: transparent;
            border: 1px solid var(--border-glow);
            color: rgba(255,255,255,0.8);
        }

        .btn-outline:hover {
            border-color: var(--primary-cyan);
            color: var(--primary-cyan);
            background: rgba(6, 182, 212, 0.05);
        }

        .btn-cyan {
            background: linear-gradient(135deg, #0891b2, #06b6d4);
            color: white;
        }

        .btn-cyan:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(6, 182, 212, 0.3);
        }

        /* 结果区域 */
        .result-area {
            margin-top: 16px;
            padding: 14px 18px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 16px;
            font-size: 12px;
            border-left: 3px solid var(--primary-cyan);
            transition: all 0.3s ease;
        }

        .speed-result {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 12px;
        }

        .speed-item {
            background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(6, 182, 212, 0.05));
            border-radius: 14px;
            padding: 10px 16px;
            font-size: 12px;
            border-left: 3px solid var(--primary-cyan);
        }

        /* 页脚 */
        .footer {
            margin-top: 30px;
            padding: 20px 32px;
            text-align: center;
            font-size: 12px;
            color: var(--text-dim);
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 15px;
            background: rgba(10, 15, 26, 0.5);
            backdrop-filter: blur(10px);
            border-radius: 28px;
            border: 1px solid var(--border-glow);
        }

        /* 动画 */
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.15); }
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .live-dot {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #22c55e;
            animation: pulse 1.5s infinite;
            margin-right: 8px;
            box-shadow: 0 0 8px #22c55e;
        }

        .fa-spin-custom {
            animation: spin 1s linear infinite;
        }

        .loading {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(6, 182, 212, 0.3);
            border-top-color: #06b6d4;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }

        /* 响应式 */
        @media (max-width: 768px) {
            body { padding: 12px; }
            .grid { grid-template-columns: 1fr; }
            .ip-val { font-size: 16px; }
            .header { flex-direction: column; text-align: center; }
            .button-group { justify-content: center; }
            .rtt-value { font-size: 36px; }
            .stats-row { justify-content: center; }
            .footer { flex-direction: column; text-align: center; }
            .quality-grid { grid-template-columns: 1fr; gap: 10px; }
        }

        /* 滚动条 */
        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: rgba(59, 130, 246, 0.05);
            border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(59, 130, 246, 0.4);
            border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: rgba(59, 130, 246, 0.6);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 头部 -->
        <div class="header">
            <div class="logo">
                <div class="logo-icon">
                    <i class="fas fa-chart-network"></i>
                </div>
                <div>
                    <h1>NetSight Pro</h1>
                    <p><i class="fas fa-bolt"></i> 蓝色极速 · 实时网络诊断</p>
                </div>
            </div>
            <div class="lang-switcher">
                <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
                <button class="lang-btn" data-lang="zh-CN" onclick="setLang('zh-CN')">简体</button>
                <button class="lang-btn" data-lang="zh-TW" onclick="setLang('zh-TW')">繁體</button>
            </div>
        </div>

        <!-- IP 信息卡片 -->
        <div class="ip-card">
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
                <div class="stat-item"><span class="live-dot"></span> <span id="t-live">实时监控</span></div>
            </div>
        </div>

        <div class="grid">
            <!-- 安全与协议卡片 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-shield-haltered"></i>
                    <div>
                        <h3 id="t-sec">安全与协议</h3>
                        <p>连接安全状态 · TLS/SSL</p>
                    </div>
                </div>
                <div class="card-body">
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-server"></i> <span id="t-dc-label">数据中心/代理</span></span>
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
                        <span class="info-label"><i class="fas fa-rocket"></i> <span id="t-push-label">H2 推送</span></span>
                        <span class="info-value" id="push-val">---</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label"><i class="fas fa-robot"></i> <span id="t-bot-label">机器人评分</span></span>
                        <span class="info-value" id="bot-score-val">${data.botScore}</span>
                    </div>
                </div>
            </div>

            <!-- 地理位置卡片 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-map-pin"></i>
                    <div>
                        <h3 id="t-geo">边缘节点位置</h3>
                        <p>Cloudflare 数据中心</p>
                    </div>
                </div>
                <div class="card-body">
                    <div style="text-align: center; margin-bottom: 16px;">
                        <i class="fas fa-city" style="font-size: 48px; color: #06b6d4; opacity: 0.7;"></i>
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

            <!-- 真实 IP 位置卡片 -->
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-user-secret"></i>
                    <div>
                        <h3 id="t-user-geo">真实 IP 位置</h3>
                        <p>客户端地理位置</p>
                    </div>
                </div>
                <div class="card-body" id="user-geo-info">
                    <div style="text-align: center; padding: 20px;">
                        <i class="fas fa-spinner fa-spin"></i> 获取中...
                    </div>
                </div>
            </div>

            <!-- 实时延迟监控卡片 - 拉长版 -->
            <div class="card rtt-card">
                <div class="card-header">
                    <i class="fas fa-waveform"></i>
                    <div>
                        <h3 id="t-rtt">实时延迟监控</h3>
                        <p>往返时延 · 网络抖动 · 实时图表</p>
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
                    </div>
                    
                    <div class="chart-container">
                        <canvas id="chart"></canvas>
                    </div>
                    
                    <div class="quality-grid">
                        <div class="quality-card">
                            <span class="quality-label"><i class="fas fa-signal"></i> 连接质量</span>
                            <span class="quality-value" id="quality-badge" style="color: #4ade80;">优秀</span>
                        </div>
                        <div class="quality-card">
                            <span class="quality-label"><i class="fas fa-chart-simple"></i> 网络稳定性</span>
                            <span class="quality-value" id="stability-badge" style="color: #22d3ee;">稳定</span>
                        </div>
                        <div class="quality-card">
                            <span class="quality-label"><i class="fas fa-chart-bar"></i> 样本数量</span>
                            <span class="quality-value" id="sample-count" style="font-family: monospace;">0</span>
                        </div>
                        <div class="quality-card">
                            <span class="quality-label"><i class="fas fa-exchange-alt"></i> 丢包率</span>
                            <span class="quality-value" id="loss-rate" style="color: #4ade80;">0%</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 测试工具区域 -->
        <div class="card" style="margin-bottom: 24px;">
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
                    <button class="btn btn-cyan" id="btn-ws-test"><i class="fas fa-bolt"></i> <span id="t-ws-btn">WebSocket</span></button>
                    <button class="btn btn-cyan" id="btn-concurrent-test"><i class="fas fa-layer-group"></i> <span id="t-concurrent-btn">并发测试</span></button>
                    <button class="btn btn-cyan" id="btn-stream-test"><i class="fas fa-stream"></i> <span id="t-stream-btn">流式传输</span></button>
                </div>

                <!-- 测试结果区域 -->
                <div id="loss-result" class="result-area" style="display: none;"></div>
                <div id="speed-result" style="display: none;"></div>
                <div id="dns-result" class="result-area" style="display: none;"></div>
                <div id="cpu-result" class="result-area" style="display: none;"></div>
                <div id="ws-result" class="result-area" style="display: none;"></div>
                <div id="concurrent-result" class="result-area" style="display: none;"></div>
                <div id="stream-result" class="result-area" style="display: none;"></div>
            </div>
        </div>

        <!-- 硬件信息卡片 -->
        <div class="card">
            <div class="card-header">
                <i class="fas fa-desktop"></i>
                <div>
                    <h3 id="t-hw">硬件信息</h3>
                    <p>客户端环境</p>
                </div>
            </div>
            <div class="card-body">
                <div id="hw-info" style="font-family: monospace; font-size: 13px;">
                    加载中...
                </div>
            </div>
        </div>

        <!-- 页脚 -->
        <div class="footer">
            <span><i class="fas fa-fingerprint"></i> RAY ID: <span style="font-family: monospace;">${data.rayId}</span></span>
            <span><i class="fas fa-ip"></i> 客户端: ${data.clientIp}</span>
            <button class="btn" id="copy-report" style="background: rgba(6, 182, 212, 0.1); padding: 6px 16px; border-radius: 30px; font-size: 12px;">
                <i class="fas fa-copy"></i> <span id="t-copy">复制报告</span>
            </button>
        </div>
    </div>

    <script>
        (function(){
            // ==================== 国际化语言包 ====================
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
                    pushLabel: 'H2 Push', lossResult: 'Loss'
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
                    pushLabel: 'H2 推送', lossResult: '丢包率'
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
                    pushLabel: 'H2 推送', lossResult: '丟包率'
                }
            };
            
            // ==================== 服务端数据 ====================
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
            
            // ==================== DOM 元素 ====================
            const elements = {
                v4: document.getElementById('v4'), v6: document.getElementById('v6'),
                rttNum: document.getElementById('rtt-num'), chart: document.getElementById('chart'),
                ctx: document.getElementById('chart').getContext('2d'),
                sDc: document.getElementById('s-dc'), sRisk: document.getElementById('s-risk'),
                hwInfo: document.getElementById('hw-info'), copyBtn: document.getElementById('copy-report'),
                jitterVal: document.getElementById('jitter-val'), protoVal: document.getElementById('proto-val'),
                userGeoInfo: document.getElementById('user-geo-info'), echVal: document.getElementById('ech-val'),
                botScoreVal: document.getElementById('bot-score-val'), compressVal: document.getElementById('compress-val'),
                pushVal: document.getElementById('push-val'), lossBtn: document.getElementById('btn-loss-test'),
                lossResult: document.getElementById('loss-result'), speedBtn: document.getElementById('btn-speed-test'),
                speedResult: document.getElementById('speed-result'), dnsBtn: document.getElementById('btn-dns-test'),
                dnsResult: document.getElementById('dns-result'), cpuBtn: document.getElementById('btn-cpu-test'),
                cpuResult: document.getElementById('cpu-result'), wsBtn: document.getElementById('btn-ws-test'),
                wsResult: document.getElementById('ws-result'), concurrentBtn: document.getElementById('btn-concurrent-test'),
                concurrentResult: document.getElementById('concurrent-result'), streamBtn: document.getElementById('btn-stream-test'),
                streamResult: document.getElementById('stream-result')
            };
            
            // ==================== 全局变量 ====================
            let currentLang = localStorage.getItem('pref-lang') || '${defaultLang}';
            const rttData = [];
            const MAX_RTT_POINTS = 30;
            const jitterHistory = [];
            const MAX_JITTER_HISTORY = 10;
            let geoRetryCount = 0;
            const MAX_GEO_RETRY = 5;
            let consecutiveLoss = 0;
            let sampleCount = 0;
            let minRtt = Infinity;
            let maxRtt = 0;
            
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
                    element.style.background = isError ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.3)';
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
            
            // ==================== UI 更新 ====================
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
                    't-compress-label': t.compressLabel, 't-push-label': t.pushLabel
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
                const maxRtt = Math.max(...rttData, 100);
                rttData.forEach((value, index) => {
                    const x = index * stepX;
                    const y = canvas.height - (Math.min(value, maxRtt) / maxRtt) * (canvas.height - 20) - 10;
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
            
            // ==================== IP 检测 ====================
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
            
            // ==================== 连接质量评估 ====================
            function updateQuality(currentRtt) {
                const qualityEl = document.getElementById('quality-badge');
                const stabilityEl = document.getElementById('stability-badge');
                
                if (qualityEl) {
                    let qualityText = '', qualityColor = '';
                    if (currentRtt < 50) { qualityText = '优秀'; qualityColor = '#4ade80'; }
                    else if (currentRtt < 100) { qualityText = '良好'; qualityColor = '#4ade80'; }
                    else if (currentRtt < 150) { qualityText = '一般'; qualityColor = '#fbbf24'; }
                    else if (currentRtt < 250) { qualityText = '较差'; qualityColor = '#f87171'; }
                    else { qualityText = '极差'; qualityColor = '#f87171'; }
                    qualityEl.textContent = qualityText;
                    qualityEl.style.color = qualityColor;
                }
                
                if (stabilityEl && jitterHistory.length > 0) {
                    const avgJitter = jitterHistory.reduce((a,b) => a+b, 0) / jitterHistory.length;
                    let stabilityText = '', stabilityColor = '';
                    if (avgJitter < 10) { stabilityText = '非常稳定'; stabilityColor = '#4ade80'; }
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
                    lossRateEl.style.color = rate === 0 ? '#4ade80' : (rate < 5 ? '#fbbf24' : '#f87171');
                }
            }
            
            // ==================== RTT 测试 ====================
            async function testRtt() {
                const start = performance.now();
                try {
                    await fetchWithTimeout(window.location.href + '?_=' + Date.now(), 
                        { method: 'HEAD', cache: 'no-store' }, 2000);
                    const diff = Math.round(performance.now() - start);
                    if (elements.rttNum) elements.rttNum.textContent = diff;
                    
                    sampleCount++;
                    const sampleEl = document.getElementById('sample-count');
                    if (sampleEl) sampleEl.textContent = sampleCount;
                    
                    if (diff < minRtt) {
                        minRtt = diff;
                        const minEl = document.getElementById('min-rtt');
                        if (minEl) minEl.textContent = minRtt;
                    }
                    if (diff > maxRtt) {
                        maxRtt = diff;
                        const maxEl = document.getElementById('max-rtt');
                        if (maxEl) maxEl.textContent = maxRtt;
                    }
                    
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
            
            // ==================== 真实 IP 位置 ====================
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
                    elements.userGeoInfo.innerHTML = '<div style="text-align: center; padding: 20px; color: #f87171;"><i class="fas fa-exclamation-triangle"></i> 地理位置查询失败</div>';
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
                    <div style="display: flex; flex-wrap: wrap; gap: 16px;">
                        <div class="stat-item"><i class="fas fa-tv"></i> 屏幕: \${screenInfo}</div>
                        <div class="stat-item"><i class="fas fa-microchip"></i> CPU核心: \${cores}</div>
                        <div class="stat-item"><i class="fas fa-clock"></i> 时区: \${timezone}</div>
                        <div class="stat-item"><i class="fas fa-language"></i> 语言: \${language}</div>
                        <div class="stat-item"><i class="fas fa-desktop"></i> 平台: \${platform}</div>
                    </div>
                \`;
            }

            // ==================== CPU 测试 ====================
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

            // ==================== WebSocket 测试 ====================
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
                                        const latency = pongTime - data.timestamp;
                                        latencies.push(latency);
                                        testCount++;
                                        
                                        if (testCount < maxTests) {
                                            setTimeout(sendPing, 200);
                                        } else {
                                            clearTimeout(timeoutId);
                                            ws.close();
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

            // ==================== 并发测试 ====================
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

            // ==================== 流式测试 ====================
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

            // ==================== H2 Push 检测 ====================
            async function testH2Push() {
                if (!elements.pushVal) return;
                try {
                    const res = await fetch('/push-test');
                    const text = await res.text();
                    if (text === 'PUSHED') {
                        elements.pushVal.innerHTML = '<span class="badge badge-success"><i class="fas fa-check"></i> 已启用</span>';
                    } else {
                        elements.pushVal.innerHTML = '<span class="badge badge-danger"><i class="fas fa-times"></i> 未启用</span>';
                    }
                } catch (e) {
                    elements.pushVal.innerHTML = '<span class="badge">N/A</span>';
                }
            }

            // ==================== 丢包测试 ====================
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

            // ==================== 带宽测速 ====================
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
                speedTestRunning = false;
            }

            // ==================== DNS 测试 ====================
            let dnsTestRunning = false;
            async function runDnsTest() {
                if (dnsTestRunning) return;
                dnsTestRunning = true;
                const t = i18n[currentLang];
                showResult(elements.dnsResult, '<span class="loading"></span> ' + t.dnsTesting);
                
                const domains = [
                    { name: 'Cloudflare', url: 'https://cloudflare.com/cdn-cgi/trace' },
                    { name: 'Google', url: 'https://google.com/generate_204' },
                    { name: 'GitHub', url: 'https://github.com/favicon.ico' }
                ];
                const results = [];
                
                for (const domain of domains) {
                    const start = performance.now();
                    try {
                        await fetchWithTimeout(domain.url, { method: 'HEAD' }, 5000);
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

            // ==================== 生成报告 ====================
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
                
                return \`【NetSight Pro 网络诊断报告】
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
   H2 推送: \${elements.pushVal ? (elements.pushVal.textContent.includes('已启用') ? '已启用' : '未启用') : '未知'}
   机器人评分: \${BACKEND_DATA.botScore}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 位置信息
   边缘节点: \${BACKEND_DATA.city}, \${BACKEND_DATA.region}, \${BACKEND_DATA.country}
   客户端: \${clientLocation}
   运营商: \${BACKEND_DATA.realGeoOrg || BACKEND_DATA.asOrg}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 NetSight Pro - 蓝色极速网络诊断工具
\`;
            }
            
            // ==================== 复制报告 ====================
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

            // ==================== 初始化 ====================
            function init() {
                minRtt = Infinity;
                maxRtt = 0;
                sampleCount = 0;
                consecutiveLoss = 0;
                
                updateUI();
                updateHardwareInfo();
                testH2Push();
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
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-xss-protection': '1; mode=block',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'server-timing': `worker;dur=${workerDuration}`
    }
  });
}
