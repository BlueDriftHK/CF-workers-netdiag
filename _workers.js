addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const cache = caches.default;
  
  // KV 缓存策略：静态资源缓存 7 天
  if (url.pathname.startsWith('/static/')) {
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    if (typeof CACHE_KV !== 'undefined') {
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

  // CPU 密集型测试端点
  if (url.pathname === '/cpu-test') {
    const iterations = parseInt(url.searchParams.get('n')) || 1000000;
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
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  // WebSocket 测试端点
  if (url.pathname === '/ws-test') {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    server.accept();
    server.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        server.send(JSON.stringify({ 
          type: 'pong', 
          timestamp: Date.now(),
          serverTime: Date.now()
        }));
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  // HTTP/2 Server Push 检测端点
  if (url.pathname === '/push-test') {
    const headers = new Headers({
      'content-type': 'text/plain',
      'cache-control': 'no-store',
      'link': '</push-test?pushed=true>; rel=preload; as=fetch'
    });
    
    const isPushed = url.searchParams.get('pushed') === 'true';
    return new Response(isPushed ? 'PUSHED' : 'MAIN', { headers });
  }

  // 多文件并发下载测试
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
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  // 大文件流式传输测试
  if (url.pathname === '/stream-test') {
    const size = parseInt(url.searchParams.get('size')) || 1048576; // 1MB
    const chunkSize = 65536; // 64KB chunks
    
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
        'content-length': size.toString()
      }
    });
  }

  // 主诊断页面
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
    asOrg: escapeForJS(cf.asOrganization || 'Unknown ISP'),
    city: escapeForJS(cf.city || 'Unknown'),
    country: escapeForJS(cf.country || 'Unknown'),
    region: escapeForJS(cf.region || 'Unknown'),
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
  let defaultLang = 'en';
  if (acceptLang.match(/zh-(CN|SG|MY)/i)) defaultLang = 'zh-CN';
  else if (acceptLang.match(/zh/i)) defaultLang = 'zh-TW';
  
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
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NETWORK DIAGNOSTICS MAX</title>
    <style>
        :root { --blue: #2196f3; --bg: #0a0b0d; --dim: #666; --red: #ff5252; --orange: #ffa726; --yellow: #ffd600; --card-bg: rgba(33,150,243,0.03); --purple: #7c4dff; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: var(--bg); 
            color: #fff; 
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace; 
            display: flex; 
            flex-direction: column; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            padding: 16px;
        }
        body::before { 
            content: ""; 
            position: fixed; 
            top: 0; left: 0; 
            width: 100%; height: 100%; 
            background: linear-gradient(rgba(33,150,243,0.03) 1px, transparent 1px), 
                        linear-gradient(90deg, rgba(33,150,243,0.03) 1px, transparent 1px); 
            background-size: 30px 30px; 
            z-index: -1; 
        }
        .terminal { 
            width: 100%; 
            max-width: 1000px; 
            background: rgba(16,18,22,0.98); 
            border: 1px solid var(--blue); 
            padding: 24px; 
            box-shadow: 0 0 30px rgba(33,150,243,0.12); 
        }
        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .header { 
            display: flex; 
            justify-content: space-between; 
            font-size: 11px; 
            color: var(--blue); 
            border-bottom: 1px solid var(--blue); 
            padding-bottom: 10px; 
            margin-bottom: 20px; 
            flex-wrap: wrap;
            gap: 10px;
            width: 100%;
        }
        .lang-switcher { 
            display: flex; 
            gap: 6px;
            flex-shrink: 0;
        }
        .lang-btn { 
            background: rgba(255,255,255,0.05); 
            border: 1px solid var(--dim); 
            color: var(--dim); 
            font-size: 10px; 
            cursor: pointer; 
            padding: 3px 8px; 
            transition: 0.3s; 
            font-family: inherit;
        }
        .lang-btn.active { 
            border-color: var(--blue); 
            color: var(--blue); 
            box-shadow: 0 0 5px var(--blue); 
        }
        .ip-section { margin-bottom: 15px; }
        .ip-row {
            display: flex;
            align-items: baseline;
            gap: 10px;
            margin-bottom: 5px;
            flex-wrap: wrap;
        }
        .ip-label {
            color: var(--dim);
            font-size: 10px;
            text-transform: uppercase;
            min-width: 45px;
        }
        .ip-val { 
            font-size: clamp(1.1rem, 4.5vw, 2rem); 
            font-weight: bold; 
            color: var(--blue); 
            text-shadow: 0 0 10px rgba(33,150,243,0.3); 
            word-break: break-all; 
            flex: 1;
        }
        .label { 
            color: var(--dim); 
            font-size: 10px; 
            text-transform: uppercase; 
            margin-bottom: 6px; 
            letter-spacing: 0.5px;
        }
        .grid { 
            display: grid; 
            grid-template-columns: 1fr 1.2fr; 
            gap: 20px; 
            border-top: 1px solid #222; 
            padding-top: 20px; 
        }
        .item-box { 
            background: var(--card-bg); 
            padding: 12px; 
            border-left: 2px solid var(--blue); 
            margin-bottom: 12px; 
            transition: all 0.3s;
        }
        .item-box:hover {
            background: rgba(33,150,243,0.06);
        }
        .row { 
            display: flex; 
            justify-content: space-between; 
            font-size: 11px; 
            margin-bottom: 4px; 
            border-bottom: 1px solid rgba(255,255,255,0.05); 
            padding-bottom: 4px; 
        }
        .chart-container {
            width: 100%;
            height: 50px;
            margin-top: 6px;
        }
        canvas { 
            display: block;
            width: 100% !important; 
            height: 50px !important; 
            background: rgba(33,150,243,0.02); 
        }
        .blink { animation: b 1.5s infinite; }
        @keyframes b { 50% { opacity: 0; } }
        .footer {
            margin-top: 24px; 
            font-size: 9px; 
            display: flex; 
            justify-content: space-between; 
            color: var(--blue); 
            opacity: 0.6;
            flex-wrap: wrap;
            gap: 10px;
        }
        .action-btn {
            background: transparent;
            border: 1px solid var(--dim);
            color: var(--dim);
            font-size: 9px;
            padding: 5px 10px;
            cursor: pointer;
            font-family: inherit;
            transition: 0.3s;
            margin-right: 8px;
            margin-bottom: 6px;
        }
        .action-btn:hover {
            border-color: var(--blue);
            color: var(--blue);
        }
        .action-btn.purple {
            border-color: var(--purple);
            color: var(--purple);
        }
        .action-btn.purple:hover {
            background: rgba(124,77,255,0.1);
        }
        .result-text {
            margin-top: 5px;
            font-size: 10px;
            color: var(--dim);
        }
        .speed-result {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            margin-top: 8px;
        }
        .speed-item {
            background: var(--card-bg);
            padding: 8px 12px;
            border-left: 2px solid var(--blue);
            font-size: 10px;
        }
        .perf-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            margin-left: 5px;
        }
        .perf-badge.good { background: rgba(76,175,80,0.2); color: #66bb6a; }
        .perf-badge.warn { background: rgba(255,167,38,0.2); color: var(--orange); }
        .perf-badge.bad { background: rgba(255,82,82,0.2); color: var(--red); }
        @media (max-width: 600px) { 
            .grid { grid-template-columns: 1fr; gap: 15px; } 
            .terminal { padding: 16px; }
            .top-bar { flex-direction: column; align-items: flex-start; }
            .header { margin-top: 0; }
        }
    </style>
</head>
<body>
    <div class="terminal">
        <div class="top-bar">
            <div class="lang-switcher">
                <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
                <button class="lang-btn" data-lang="zh-CN" onclick="setLang('zh-CN')">简体</button>
                <button class="lang-btn" data-lang="zh-TW" onclick="setLang('zh-TW')">繁體</button>
            </div>
        </div>
        <div class="header">
            <span id="t-status">⚡ MAX PERFORMANCE MODE</span>
            <span>NODE: ${data.colo}</span>
        </div>
        <div class="ip-section">
            <div class="ip-row">
                <span class="ip-label">IPv4:</span>
                <span id="v4" class="ip-val">Detecting...</span>
            </div>
            <div class="ip-row">
                <span class="ip-label">IPv6:</span>
                <span id="v6" class="ip-val ip-val-small" style="font-size: 1rem; color: var(--dim);">Detecting...</span>
            </div>
        </div>
        <div class="grid">
            <div class="col">
                <div class="label" id="t-sec">SECURITY & PROTOCOL</div>
                <div class="item-box">
                    <div class="row"><span id="t-dc-label">DC / PROXY</span><span id="s-dc">---</span></div>
                    <div class="row"><span id="t-risk">RISK LEVEL</span><span id="s-risk">---</span></div>
                    <div class="row"><span id="t-asn-label">ASN</span><span>${data.asn}</span></div>
                    <div class="row"><span id="t-proto-label">PROTOCOL</span><span id="proto-val">${data.proto}</span></div>
                    <div class="row"><span id="t-tls-label">TLS</span><span>${data.tlsVersion}</span></div>
                    <div class="row"><span id="t-cipher-label">CIPHER</span><span style="font-size:9px;">${data.tlsCipher}</span></div>
                    <div class="row"><span id="t-ech-label">ECH</span><span id="ech-val">---</span></div>
                    <div class="row"><span id="t-compress-label">COMPRESSION</span><span id="compress-val">---</span></div>
                    <div class="row"><span id="t-push-label">H2 PUSH</span><span id="push-val">---</span></div>
                    <div class="row"><span id="t-bot-label">BOT SCORE</span><span id="bot-score-val">${data.botScore}</span></div>
                    <div class="row"><span id="t-worker">WORKER TIME</span><span>${workerDuration}ms</span></div>
                </div>
                
                <div class="label" id="t-geo">LOCATION / ISP</div>
                <div class="item-box" style="font-size: 12px;">
                    ${data.city}, ${data.region}, ${data.country}<br>
                    <span style="color: var(--dim); font-size: 10px;">${data.lat}°${data.latDir} / ${data.lon}°${data.lonDir}</span><br>
                    <span style="color: var(--dim); font-size: 10px;">${data.asOrg}</span>
                </div>

                <div class="label" style="margin-top:15px" id="t-user-geo">USER IP LOCATION</div>
                <div class="item-box" style="font-size: 12px;" id="user-geo-info">
                    <span style="color: var(--dim);">Fetching...</span>
                </div>
            </div>
            
            <div class="col">
                <div class="label" style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;">
                    <span id="t-rtt">LOCAL RTT</span>
                    <span id="rtt-num">--</span>ms
                    <span style="margin-left: 8px; color: var(--dim);" id="t-jitter">JITTER</span>
                    <span id="jitter-val">--</span>
                </div>
                <div class="chart-container">
                    <canvas id="chart"></canvas>
                </div>
                
                <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
                    <button class="action-btn" id="btn-loss-test"><span id="t-loss-btn">PACKET LOSS</span></button>
                    <button class="action-btn" id="btn-speed-test"><span id="t-speed-btn">BANDWIDTH</span></button>
                    <button class="action-btn" id="btn-dns-test"><span id="t-dns-btn">DNS</span></button>
                    <button class="action-btn purple" id="btn-cpu-test"><span id="t-cpu-btn">CPU</span></button>
                    <button class="action-btn purple" id="btn-ws-test"><span id="t-ws-btn">WS</span></button>
                    <button class="action-btn purple" id="btn-concurrent-test"><span id="t-concurrent-btn">CONCURRENT</span></button>
                    <button class="action-btn purple" id="btn-stream-test"><span id="t-stream-btn">STREAM</span></button>
                </div>
                <div id="loss-result" class="result-text"></div>
                <div id="speed-result" class="speed-result"></div>
                <div id="dns-result" class="result-text"></div>
                <div id="cpu-result" class="result-text"></div>
                <div id="ws-result" class="result-text"></div>
                <div id="concurrent-result" class="result-text"></div>
                <div id="stream-result" class="result-text"></div>

                <div class="label" style="margin-top:15px" id="t-hw">HARDWARE INFO</div>
                <div id="hw-info" style="font-size: 10px; color: var(--dim); border-left: 2px solid var(--dim); padding-left: 10px;">Loading...</div>
            </div>
        </div>
        <div class="footer">
            <span>RAY: ${data.rayId} | IP: ${data.clientIp}</span>
            <span style="display: flex; gap: 15px; align-items: center;">
                <button class="action-btn" id="copy-report" style="font-size: 9px;">
                    <span id="t-copy">COPY REPORT</span>
                </button>
                <span><span class="blink">●</span> <span id="t-live">LIVE_TRACE</span></span>
            </span>
        </div>
    </div>
    <script>
        (function(){
            const i18n = {
                'en': { 
                    status: '⚡ MAX PERFORMANCE MODE',
                    geo: 'LOCATION / ISP',
                    rtt: 'LOCAL RTT',
                    live: 'LIVE_TRACE',
                    sec: 'SECURITY & PROTOCOL',
                    hw: 'HARDWARE INFO',
                    risk: 'RISK LEVEL',
                    clean: 'LOW RISK',
                    high: 'HIGH RISK',
                    yes: 'YES',
                    no: 'NO',
                    unavailable: 'Unavailable',
                    worker: 'WORKER TIME',
                    copy: 'COPY REPORT',
                    copied: 'COPIED!',
                    dcLabel: 'DC / PROXY',
                    asnLabel: 'ASN',
                    protoLabel: 'PROTOCOL',
                    tlsLabel: 'TLS',
                    cipherLabel: 'CIPHER',
                    echLabel: 'ECH',
                    echEnabled: 'ENABLED',
                    echDisabled: 'DISABLED',
                    botLabel: 'BOT SCORE',
                    lossBtn: 'PACKET LOSS',
                    speedBtn: 'BANDWIDTH',
                    dnsBtn: 'DNS',
                    cpuBtn: 'CPU',
                    wsBtn: 'WS',
                    concurrentBtn: 'CONCURRENT',
                    streamBtn: 'STREAM',
                    lossTesting: 'Testing...',
                    lossNone: '0% (no loss)',
                    jitter: 'JITTER',
                    userGeo: 'USER IP LOCATION',
                    reportTitle: 'NETWORK DIAGNOSTICS MAX REPORT',
                    dnsTesting: 'Testing DNS...',
                    speedTesting: 'Testing bandwidth...',
                    cpuTesting: 'CPU benchmark...',
                    wsTesting: 'WebSocket latency...',
                    concurrentTesting: 'Concurrency test...',
                    streamTesting: 'Stream throughput...',
                    compressLabel: 'COMPRESSION',
                    pushLabel: 'H2 PUSH'
                },
                'zh-CN': { 
                    status: '⚡ 性能极限模式',
                    geo: '地理位置 / 运营商',
                    rtt: '本地往返时延',
                    live: '实时追踪中',
                    sec: '安全及协议',
                    hw: '硬件摘要',
                    risk: '风控评级',
                    clean: '低风险',
                    high: '高风险',
                    yes: '是',
                    no: '否',
                    unavailable: '获取失败',
                    worker: 'Worker 耗时',
                    copy: '复制报告',
                    copied: '已复制!',
                    dcLabel: '数据中心/代理',
                    asnLabel: 'ASN',
                    protoLabel: '协议',
                    tlsLabel: 'TLS',
                    cipherLabel: '加密套件',
                    echLabel: 'ECH',
                    echEnabled: '已启用',
                    echDisabled: '未启用',
                    botLabel: '机器人评分',
                    lossBtn: '丢包率',
                    speedBtn: '带宽',
                    dnsBtn: 'DNS',
                    cpuBtn: 'CPU',
                    wsBtn: 'WS',
                    concurrentBtn: '并发',
                    streamBtn: '流性能',
                    lossTesting: '测试中...',
                    lossNone: '0% (无丢包)',
                    jitter: '抖动',
                    userGeo: '真实IP位置',
                    reportTitle: '网络诊断极限版报告',
                    dnsTesting: '正在测试 DNS...',
                    speedTesting: '正在测速...',
                    cpuTesting: 'CPU 基准测试...',
                    wsTesting: 'WebSocket 延迟...',
                    concurrentTesting: '并发测试...',
                    streamTesting: '流式吞吐量...',
                    compressLabel: '压缩算法',
                    pushLabel: 'H2 推送'
                },
                'zh-TW': { 
                    status: '⚡ 效能極限模式',
                    geo: '地理位置 / 運營商',
                    rtt: '本地往返時延',
                    live: '實時追蹤中',
                    sec: '安全及協議',
                    hw: '硬體摘要',
                    risk: '風控評級',
                    clean: '低風險',
                    high: '高風險',
                    yes: '是',
                    no: '否',
                    unavailable: '獲取失敗',
                    worker: 'Worker 耗時',
                    copy: '複製報告',
                    copied: '已複製!',
                    dcLabel: '資料中心/代理',
                    asnLabel: 'ASN',
                    protoLabel: '協定',
                    tlsLabel: 'TLS',
                    cipherLabel: '加密套件',
                    echLabel: 'ECH',
                    echEnabled: '已啟用',
                    echDisabled: '未啟用',
                    botLabel: '機器人評分',
                    lossBtn: '丟包率',
                    speedBtn: '頻寬',
                    dnsBtn: 'DNS',
                    cpuBtn: 'CPU',
                    wsBtn: 'WS',
                    concurrentBtn: '併發',
                    streamBtn: '串流效能',
                    lossTesting: '測試中...',
                    lossNone: '0% (無丟包)',
                    jitter: '抖動',
                    userGeo: '真實IP位置',
                    reportTitle: '網路診斷極限版報告',
                    dnsTesting: '正在測試 DNS...',
                    speedTesting: '正在測速...',
                    cpuTesting: 'CPU 基準測試...',
                    wsTesting: 'WebSocket 延遲...',
                    concurrentTesting: '併發測試...',
                    streamTesting: '串流吞吐量...',
                    compressLabel: '壓縮演算法',
                    pushLabel: 'H2 推送'
                }
            };
            
            const BACKEND_DATA = {
                asOrg: "${data.asOrg}",
                asn: "${data.asn}",
                colo: "${data.colo}",
                city: "${data.city}",
                region: "${data.region}",
                country: "${data.country}",
                lat: "${data.lat}\u00b0${data.latDir}",
                lon: "${data.lon}\u00b0${data.lonDir}",
                proto: "${data.proto}",
                tlsVersion: "${data.tlsVersion}",
                tlsCipher: "${data.tlsCipher}",
                botScore: "${data.botScore}",
                rayId: "${data.rayId}",
                clientIp: "${data.clientIp}",
                workerDuration: "${workerDuration}",
                httpProtocolRaw: "${data.httpProtocolRaw}",
                latNum: ${data.latNum},
                lonNum: ${data.lonNum},
                tlsClientHelloLength: ${data.tlsClientHelloLength},
                compressionBrotli: ${compressionInfo.brotli},
                compressionGzip: ${compressionInfo.gzip},
                realGeoCity: "${realGeoJS.city}",
                realGeoRegion: "${realGeoJS.region}",
                realGeoCountry: "${realGeoJS.country}",
                realGeoCountryCode: "${realGeoJS.countryCode}",
                realGeoLat: ${realGeoJS.lat},
                realGeoLon: ${realGeoJS.lon},
                realGeoOrg: "${realGeoJS.org}",
                realGeoIp: "${realGeoJS.ip}"
            };
            
            // ... [之前的 elements 对象保持不变，新增以下元素]
            const elements = {
                v4: document.getElementById('v4'),
                v6: document.getElementById('v6'),
                rttNum: document.getElementById('rtt-num'),
                chart: document.getElementById('chart'),
                ctx: document.getElementById('chart').getContext('2d'),
                sDc: document.getElementById('s-dc'),
                sRisk: document.getElementById('s-risk'),
                hwInfo: document.getElementById('hw-info'),
                copyBtn: document.getElementById('copy-report'),
                jitterVal: document.getElementById('jitter-val'),
                protoVal: document.getElementById('proto-val'),
                userGeoInfo: document.getElementById('user-geo-info'),
                echVal: document.getElementById('ech-val'),
                botScoreVal: document.getElementById('bot-score-val'),
                compressVal: document.getElementById('compress-val'),
                pushVal: document.getElementById('push-val'),
                lossBtn: document.getElementById('btn-loss-test'),
                lossResult: document.getElementById('loss-result'),
                speedBtn: document.getElementById('btn-speed-test'),
                speedResult: document.getElementById('speed-result'),
                dnsBtn: document.getElementById('btn-dns-test'),
                dnsResult: document.getElementById('dns-result'),
                cpuBtn: document.getElementById('btn-cpu-test'),
                cpuResult: document.getElementById('cpu-result'),
                wsBtn: document.getElementById('btn-ws-test'),
                wsResult: document.getElementById('ws-result'),
                concurrentBtn: document.getElementById('btn-concurrent-test'),
                concurrentResult: document.getElementById('concurrent-result'),
                streamBtn: document.getElementById('btn-stream-test'),
                streamResult: document.getElementById('stream-result')
            };
            
            let currentLang = localStorage.getItem('pref-lang') || '${defaultLang}';
            const rttData = [];
            const MAX_RTT_POINTS = 40;
            const jitterHistory = [];
            const MAX_JITTER_HISTORY = 10;
            let geoRetryCount = 0;
            const MAX_GEO_RETRY = 5;
            
            // ... [isDataCenter, fetchWithTimeout, updateUI 等函数保持不变]
            
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
            
            function updateUI() {
                const t = i18n[currentLang];
                const textIds = {
                    't-status': t.status,
                    't-geo': t.geo,
                    't-sec': t.sec,
                    't-rtt': t.rtt,
                    't-hw': t.hw,
                    't-live': t.live,
                    't-risk': t.risk,
                    't-worker': t.worker,
                    't-copy': t.copy,
                    't-dc-label': t.dcLabel,
                    't-asn-label': t.asnLabel,
                    't-proto-label': t.protoLabel,
                    't-tls-label': t.tlsLabel,
                    't-cipher-label': t.cipherLabel,
                    't-ech-label': t.echLabel,
                    't-bot-label': t.botLabel,
                    't-jitter': t.jitter,
                    't-user-geo': t.userGeo,
                    't-loss-btn': t.lossBtn,
                    't-speed-btn': t.speedBtn,
                    't-dns-btn': t.dnsBtn,
                    't-cpu-btn': t.cpuBtn,
                    't-ws-btn': t.wsBtn,
                    't-concurrent-btn': t.concurrentBtn,
                    't-stream-btn': t.streamBtn,
                    't-compress-label': t.compressLabel,
                    't-push-label': t.pushLabel
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
                    elements.sDc.textContent = dc ? t.yes : t.no;
                    elements.sDc.style.color = dc ? 'var(--red)' : 'var(--blue)';
                }
                if (elements.sRisk) {
                    elements.sRisk.textContent = dc ? t.high : t.clean;
                    elements.sRisk.style.color = dc ? 'var(--red)' : 'var(--blue)';
                }

                if (elements.protoVal) {
                    const rawProto = BACKEND_DATA.httpProtocolRaw;
                    let displayText = rawProto;
                    if (rawProto.toUpperCase().includes('HTTP/3')) {
                        displayText += ' ⚡ QUIC';
                        elements.protoVal.style.color = 'var(--blue)';
                        elements.protoVal.style.fontWeight = 'bold';
                    } else {
                        elements.protoVal.style.color = '';
                        elements.protoVal.style.fontWeight = '';
                    }
                    elements.protoVal.textContent = displayText;
                }

                if (elements.echVal) {
                    const helloLen = BACKEND_DATA.tlsClientHelloLength;
                    if (helloLen > 0) {
                        elements.echVal.textContent = t.echEnabled + ' (len:' + helloLen + ')';
                        elements.echVal.style.color = 'var(--blue)';
                    } else {
                        elements.echVal.textContent = t.echDisabled;
                        elements.echVal.style.color = 'var(--red)';
                    }
                }

                if (elements.compressVal) {
                    const parts = [];
                    if (BACKEND_DATA.compressionBrotli) parts.push('br ✓');
                    if (BACKEND_DATA.compressionGzip) parts.push('gzip ✓');
                    if (parts.length === 0) parts.push('none');
                    elements.compressVal.textContent = parts.join(', ');
                    elements.compressVal.style.color = parts.length > 0 ? 'var(--blue)' : 'var(--red)';
                }

                if (elements.botScoreVal) {
                    const score = parseInt(BACKEND_DATA.botScore, 10);
                    let levelText = '';
                    let color = '';
                    if (score >= 100) { levelText = ' 👤 HUMAN'; color = 'var(--blue)'; }
                    else if (score >= 80) { levelText = ' ✓ LOW'; color = 'var(--yellow)'; }
                    else if (score >= 30) { levelText = ' ⚠ MEDIUM'; color = 'var(--orange)'; }
                    else { levelText = ' ❌ HIGH'; color = 'var(--red)'; }
                    elements.botScoreVal.innerHTML = score + '<span style="color:' + color + '; margin-left: 6px;">' + levelText + '</span>';
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
                if (rttData.length === 0) return;
                ctx.beginPath();
                ctx.strokeStyle = '#2196f3';
                ctx.lineWidth = 2;
                const stepX = canvas.width / (MAX_RTT_POINTS - 1);
                const maxRtt = 500;
                rttData.forEach((value, index) => {
                    const x = index * stepX;
                    const y = canvas.height - (Math.min(value, maxRtt) / maxRtt) * (canvas.height - 10);
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
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
                            if (ip) {
                                el.textContent = ip;
                                el.style.color = '';
                                return;
                            }
                        }
                    } catch (e) {}
                }
                if (el) {
                    el.textContent = i18n[currentLang].unavailable;
                    el.style.color = 'var(--red)';
                }
            }
            
            async function testRtt() {
                const start = performance.now();
                try {
                    await fetchWithTimeout(window.location.href + '?_=' + Date.now(), 
                        { method: 'HEAD', cache: 'no-store' }, 2000);
                    const diff = Math.round(performance.now() - start);
                    if (elements.rttNum) elements.rttNum.textContent = diff;
                    
                    if (rttData.length > 0) {
                        const jitter = Math.abs(diff - rttData[rttData.length - 1]);
                        jitterHistory.push(jitter);
                        if (jitterHistory.length > MAX_JITTER_HISTORY) jitterHistory.shift();
                        const avgJitter = Math.round(jitterHistory.reduce((a,b) => a+b, 0) / jitterHistory.length);
                        if (elements.jitterVal) elements.jitterVal.textContent = avgJitter + 'ms';
                    }
                    
                    rttData.push(diff);
                    if (rttData.length > MAX_RTT_POINTS) rttData.shift();
                    drawChart();
                } catch (e) {}
                setTimeout(testRtt, 2000);
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
            
            async function fetchUserGeo() {
                if (!elements.userGeoInfo) return;
                
                if (BACKEND_DATA.realGeoCity && BACKEND_DATA.realGeoCountry) {
                    const dist = calculateDistance(
                        BACKEND_DATA.latNum, BACKEND_DATA.lonNum,
                        BACKEND_DATA.realGeoLat, BACKEND_DATA.realGeoLon
                    );
                    
                    elements.userGeoInfo.innerHTML = \`
                        <div style="display: flex; justify-content: space-between;">
                            <span>\${BACKEND_DATA.realGeoCity}, \${BACKEND_DATA.realGeoRegion}, \${BACKEND_DATA.realGeoCountry}</span>
                            <span style="color: var(--yellow);">\${dist} km</span>
                        </div>
                        <div style="color: var(--dim); font-size: 10px; margin-top: 4px;">
                            ISP: \${BACKEND_DATA.realGeoOrg} | IP: \${BACKEND_DATA.realGeoIp}
                        </div>
                    \`;
                    return;
                }
                
                const ip = elements.v4 ? elements.v4.textContent : '';
                if (!ip || ip.includes('Detecting') || ip.includes(i18n[currentLang].unavailable)) {
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
                        <div style="display: flex; justify-content: space-between;">
                            <span>\${geoData.city}, \${geoData.region}, \${geoData.country_name}</span>
                            <span style="color: var(--yellow);">\${dist} km</span>
                        </div>
                        <div style="color: var(--dim); font-size: 10px; margin-top: 4px;">
                            ISP: \${geoData.org} | IP: \${ip}
                        </div>
                    \`;
                } catch (e) {
                    elements.userGeoInfo.innerHTML = '<span style="color: var(--red);">Geo lookup failed</span>';
                }
            }
            
            function updateHardwareInfo() {
                if (!elements.hwInfo) return;
                const cores = navigator.hardwareConcurrency || 'N/A';
                const screenInfo = screen.width + 'x' + screen.height;
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                elements.hwInfo.textContent = [screenInfo, cores + ' CORE', timezone].join(' | ');
            }

            // CPU 性能测试
            let cpuTestRunning = false;
            async function runCpuTest() {
                if (cpuTestRunning || !elements.cpuResult) return;
                cpuTestRunning = true;
                const t = i18n[currentLang];
                elements.cpuResult.textContent = t.cpuTesting;
                elements.cpuResult.style.color = 'var(--yellow)';
                
                const start = Date.now();
                try {
                    const res = await fetch('/cpu-test?n=500000');
                    const data = await res.json();
                    elements.cpuResult.innerHTML = \`
                        <span style="color: var(--blue);">CPU: \${data.opsMs} ops/ms</span>
                        <span class="perf-badge good">\${data.duration}ms</span>
                    \`;
                } catch (e) {
                    elements.cpuResult.innerHTML = '<span style="color: var(--red);">CPU test failed</span>';
                }
                cpuTestRunning = false;
            }

            // WebSocket 延迟测试
            let wsTestRunning = false;
            async function runWsTest() {
                if (wsTestRunning || !elements.wsResult) return;
                wsTestRunning = true;
                const t = i18n[currentLang];
                elements.wsResult.textContent = t.wsTesting;
                elements.wsResult.style.color = 'var(--yellow)';
                
                try {
                    const wsUrl = window.location.href.replace('http', 'ws') + '/ws-test';
                    const ws = new WebSocket(wsUrl);
                    
                    const result = await new Promise((resolve) => {
                        const latencies = [];
                        let testCount = 0;
                        const maxTests = 5;
                        
                        ws.onopen = () => {
                            const sendPing = () => {
                                const pingStart = performance.now();
                                ws.send(JSON.stringify({ type: 'ping', timestamp: pingStart }));
                            };
                            sendPing();
                            
                            ws.onmessage = (event) => {
                                const pongTime = performance.now();
                                const data = JSON.parse(event.data);
                                if (data.type === 'pong') {
                                    latencies.push(pongTime - data.timestamp);
                                    testCount++;
                                    
                                    if (testCount < maxTests) {
                                        setTimeout(sendPing, 100);
                                    } else {
                                        ws.close();
                                        const avgLatency = Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length);
                                        resolve({ success: true, avg: avgLatency, min: Math.min(...latencies), max: Math.max(...latencies) });
                                    }
                                }
                            };
                        };
                        
                        ws.onerror = () => resolve({ success: false });
                        setTimeout(() => resolve({ success: false }), 5000);
                    });
                    
                    if (result.success) {
                        elements.wsResult.innerHTML = \`
                            <span style="color: var(--blue);">WS: \${result.avg}ms</span>
                            <span class="perf-badge good">min: \${result.min}ms</span>
                            <span class="perf-badge warn">max: \${result.max}ms</span>
                        \`;
                    } else {
                        elements.wsResult.innerHTML = '<span style="color: var(--red);">WebSocket failed</span>';
                    }
                } catch (e) {
                    elements.wsResult.innerHTML = '<span style="color: var(--red);">WebSocket failed</span>';
                }
                wsTestRunning = false;
            }

            // 并发请求测试
            let concurrentTestRunning = false;
            async function runConcurrentTest() {
                if (concurrentTestRunning || !elements.concurrentResult) return;
                concurrentTestRunning = true;
                const t = i18n[currentLang];
                elements.concurrentResult.textContent = t.concurrentTesting;
                elements.concurrentResult.style.color = 'var(--yellow)';
                
                const start = performance.now();
                try {
                    const urls = [4, 6, 8].map(count => 
                        fetchWithTimeout(\`/concurrent-test?count=\${count}&size=1024\`, {}, 5000)
                            .then(r => r.json())
                    );
                    
                    const results = await Promise.all(urls);
                    const totalDuration = performance.now() - start;
                    
                    let summaryHtml = '<span style="color: var(--blue);">Concurrent: ' + totalDuration + 'ms</span>';
                    results.forEach(r => {
                        const avgDuration = r.reduce((sum, item) => sum + (item.duration || 0), 0) / r.length;
                        summaryHtml += \` <span class="perf-badge good">\${r.length}req: \${Math.round(avgDuration)}ms</span>\`;
                    });
                    
                    elements.concurrentResult.innerHTML = summaryHtml;
                } catch (e) {
                    elements.concurrentResult.innerHTML = '<span style="color: var(--red);">Concurrent test failed</span>';
                }
                concurrentTestRunning = false;
            }

            // 流式传输测试
            let streamTestRunning = false;
            async function runStreamTest() {
                if (streamTestRunning || !elements.streamResult) return;
                streamTestRunning = true;
                const t = i18n[currentLang];
                elements.streamResult.textContent = t.streamTesting;
                elements.streamResult.style.color = 'var(--yellow)';
                
                const sizes = [65536, 262144, 1048576]; // 64KB, 256KB, 1MB
                const results = [];
                
                for (const size of sizes) {
                    const start = performance.now();
                    try {
                        const res = await fetchWithTimeout(\`/stream-test?size=\${size}\`, {}, 10000);
                        const reader = res.body.getReader();
                        let bytesRead = 0;
                        
                        while (true) {
                            const {done, value} = await reader.read();
                            if (done) break;
                            bytesRead += value.length;
                        }
                        
                        const duration = performance.now() - start;
                        const speedMbps = ((bytesRead * 8) / (duration / 1000)) / 1000000;
                        results.push({ sizeKB: Math.round(size/1024), speed: speedMbps.toFixed(2), duration: Math.round(duration) });
                    } catch (e) {
                        results.push({ sizeKB: Math.round(size/1024), speed: '0', duration: 'timeout' });
                    }
                }
                
                if (results.length > 0) {
                    elements.streamResult.innerHTML = results.map(r => 
                        \`<span class="speed-item" style="background: rgba(124,77,255,0.1); border-left-color: var(--purple);">Stream \${r.sizeKB}KB: \${r.speed} Mbps</span>\`
                    ).join('');
                }
                streamTestRunning = false;
            }

            // HTTP/2 Push 检测
            async function testH2Push() {
                if (!elements.pushVal) return;
                try {
                    const res = await fetch('/push-test');
                    const text = await res.text();
                    if (text === 'PUSHED') {
                        elements.pushVal.textContent = '✓ ENABLED';
                        elements.pushVal.style.color = 'var(--blue)';
                    } else {
                        elements.pushVal.textContent = '✗ DISABLED';
                        elements.pushVal.style.color = 'var(--red)';
                    }
                } catch (e) {
                    elements.pushVal.textContent = 'N/A';
                    elements.pushVal.style.color = 'var(--dim)';
                }
            }

            // 原有的丢包、速度、DNS 测试函数保持不变
            let lossTestRunning = false;
            async function runLossTest() {
                if (lossTestRunning || !elements.lossResult) return;
                lossTestRunning = true;
                const t = i18n[currentLang];
                elements.lossResult.textContent = t.lossTesting;
                elements.lossResult.style.color = 'var(--yellow)';
                
                const total = 10;
                let failed = 0;
                for (let i = 0; i < total; i++) {
                    try {
                        await fetchWithTimeout(window.location.href + '?_loss=' + Date.now() + i, 
                            { method: 'HEAD', cache: 'no-store' }, 2000);
                    } catch (e) {
                        failed++;
                    }
                }
                const lossPercent = Math.round((failed / total) * 100);
                if (lossPercent === 0) {
                    elements.lossResult.textContent = t.lossNone;
                    elements.lossResult.style.color = 'var(--blue)';
                } else {
                    elements.lossResult.textContent = t.lossResult + ' ' + lossPercent + '% (' + failed + '/' + total + ' lost)';
                    elements.lossResult.style.color = 'var(--red)';
                }
                lossTestRunning = false;
            }

            let speedTestRunning = false;
            async function runSpeedTest() {
                if (speedTestRunning || !elements.speedResult) return;
                speedTestRunning = true;
                const t = i18n[currentLang];
                elements.speedResult.innerHTML = '<span style="color: var(--yellow);">' + t.speedTesting + '</span>';
                
                const sizes = [102400, 512000, 1048576];
                const results = [];
                
                for (const size of sizes) {
                    const start = performance.now();
                    try {
                        await fetchWithTimeout(\`/speedtest?size=\${size}\`, {}, 10000);
                        const duration = performance.now() - start;
                        const speedMbps = ((size * 8) / (duration / 1000)) / 1000000;
                        results.push({ sizeKB: Math.round(size/1024), speed: speedMbps.toFixed(2), duration: Math.round(duration) });
                    } catch (e) {
                        results.push({ sizeKB: Math.round(size/1024), speed: '0', duration: 'timeout' });
                    }
                }
                
                if (results.length > 0) {
                    const avgSpeed = results.filter(r => r.speed !== '0').reduce((sum, r) => sum + parseFloat(r.speed), 0) / results.filter(r => r.speed !== '0').length;
                    elements.speedResult.innerHTML = results.map(r => 
                        \`<div class="speed-item">\${r.sizeKB}KB: \${r.speed} Mbps (\${r.duration}ms)</div>\`
                    ).join('') + \`<div style="font-size: 10px; margin-top: 4px; color: var(--blue);">Avg: \${avgSpeed.toFixed(2)} Mbps</div>\`;
                } else {
                    elements.speedResult.innerHTML = '<span style="color: var(--red);">Speed test failed</span>';
                }
                speedTestRunning = false;
            }

            let dnsTestRunning = false;
            async function runDnsTest() {
                if (dnsTestRunning || !elements.dnsResult) return;
                dnsTestRunning = true;
                const t = i18n[currentLang];
                elements.dnsResult.textContent = t.dnsTesting;
                elements.dnsResult.style.color = 'var(--yellow)';
                
                const domains = [
                    { name: 'cloudflare.com', url: 'https://cloudflare.com/cdn-cgi/trace' },
                    { name: 'google.com', url: 'https://google.com/generate_204' }
                ];
                const results = [];
                
                for (const domain of domains) {
                    const start = performance.now();
                    try {
                        await fetchWithTimeout(domain.url, {}, 5000);
                        const dnsTime = Math.round(performance.now() - start);
                        results.push({ domain: domain.name, time: dnsTime });
                    } catch (e) {
                        results.push({ domain: domain.name, time: 'timeout' });
                    }
                }
                
                elements.dnsResult.innerHTML = results.map(r => 
                    \`<span style="margin-right: 15px;">\${r.domain}: \${r.time}ms</span>\`
                ).join('');
                elements.dnsResult.style.color = 'var(--dim)';
                dnsTestRunning = false;
            }

            function generateReportText() {
                const t = i18n[currentLang];
                const now = new Date().toISOString();
                return \`[\${t.reportTitle}]
Generated: \${now}
Node: \${BACKEND_DATA.colo}
IPv4: \${elements.v4 ? elements.v4.textContent : 'N/A'}
IPv6: \${elements.v6 ? elements.v6.textContent : 'N/A'}
Ray: \${BACKEND_DATA.rayId}
---
RTT: \${elements.rttNum ? elements.rttNum.textContent : 'N/A'}
Jitter: \${elements.jitterVal ? elements.jitterVal.textContent : 'N/A'}
Protocol: \${BACKEND_DATA.httpProtocolRaw}
TLS: \${BACKEND_DATA.tlsVersion}
Cipher: \${BACKEND_DATA.tlsCipher}
ECH: \${elements.echVal ? elements.echVal.textContent : 'N/A'}
Compression: \${elements.compressVal ? elements.compressVal.textContent : 'N/A'}
H2 Push: \${elements.pushVal ? elements.pushVal.textContent : 'N/A'}
Bot Score: \${BACKEND_DATA.botScore}
Location: \${BACKEND_DATA.realGeoCity}, \${BACKEND_DATA.realGeoCountry}
\`;
            }
            
            async function copyReport() {
                if (!elements.copyBtn) return;
                const text = generateReportText();
                try {
                    await navigator.clipboard.writeText(text);
                    const copySpan = document.getElementById('t-copy');
                    if (copySpan) {
                        const originalText = copySpan.textContent;
                        copySpan.textContent = i18n[currentLang].copied;
                        setTimeout(() => {
                            copySpan.textContent = originalText;
                        }, 1500);
                    }
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            }

            function init() {
                updateUI();
                updateHardwareInfo();
                testH2Push(); // 检测 HTTP/2 Push
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
      'server-timing': `worker;dur=${workerDuration}`
    }
  });
}
