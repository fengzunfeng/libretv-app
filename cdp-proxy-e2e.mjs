// v4 全链路端到端测试（带壳代理模拟）：
// CDP Fetch 域拦截所有 http/https 请求 -> node fetch 转发 -> 附加 CORS 头（等效真机壳 shouldInterceptRequest）
// 覆盖：首页 -> 搜索(4源聚合) -> 详情 -> 播放(m3u8 via libretv.local 代理) -> 设置页
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function getPageWs() {
  const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const page = pages.find(p => p.type === 'page' && p.url.includes('127.0.0.1:8777'));
  if (!page) throw new Error('no page: ' + pages.map(p => p.type + ':' + p.url).join(' | '));
  return page.webSocketDebuggerUrl;
}
const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws err')); });
let mid = 0;
const pending = new Map();
let proxyStats = { total: 0, ok: 0, err: 0 };
const reqLog = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    handlePaused(m.params).catch(() => {});
  }
  if (m.method === 'Runtime.exceptionThrown') {
    reqLog.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    reqLog.push('CONSOLE: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m));
  ws.send(JSON.stringify({ id, method, params }));
});

async function handlePaused(p) {
  const { requestId, request } = p;
  const url = request.url;
  proxyStats.total++;
  try {
    if (url.includes('127.0.0.1:8777')) {
      await send('Fetch.continueRequest', { requestId });
      return;
    }
    let target = url;
    // libretv.local 虚拟代理：解码 url 参数（壳代理形态）
    if (url.includes('libretv.local')) {
      try {
        const u = new URL(url);
        target = u.searchParams.get('url');
        if (!target) throw new Error('no url param');
      } catch { await send('Fetch.fulfillRequest', { requestId, responseCode: 400, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('bad proxy url').toString('base64') }); return; }
    }
    const hdrs = { 'User-Agent': UA, 'Accept': '*/*' };
    if (request.headers?.referer) hdrs['Referer'] = request.headers.referer;
    if (request.headers?.range) hdrs['Range'] = request.headers.range;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(target, { headers: hdrs, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get('content-type') || 'application/octet-stream';
    const rh = [
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
      { name: 'Access-Control-Allow-Headers', value: '*' },
      { name: 'Content-Type', value: ct },
    ];
    const ar = resp.headers.get('accept-ranges'); if (ar) rh.push({ name: 'Accept-Ranges', value: ar });
    const cr = resp.headers.get('content-range'); if (cr) rh.push({ name: 'Content-Range', value: cr });
    proxyStats.ok++;
    await send('Fetch.fulfillRequest', { requestId, responseCode: resp.status, responseHeaders: rh, body: buf.toString('base64') });
  } catch (e) {
    proxyStats.err++;
    const msg = 'proxy error: ' + (e.name || '') + ' ' + String(e.message).slice(0, 60);
    reqLog.push('PROXY-ERR: ' + url.slice(0, 90) + ' -> ' + msg);
    await send('Fetch.fulfillRequest', { requestId, responseCode: 502, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(msg).toString('base64') });
  }
}

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { jsError: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 200) };
  return r.result?.result?.value;
};
const results = [];
const test = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + String(detail).slice(0, 300)); };

await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(8000);

// T1 首页
const home = await ev(`(() => ({
  hasInput: !!document.querySelector('input'),
  inputPlaceholder: document.querySelector('input')?.placeholder || '',
  hasLocalBtn: [...document.querySelectorAll('button')].some(b => (b.innerText || '').includes('本地视频')),
  buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 12),
}))()`);
test('T1 首页渲染+搜索框', home && home.hasInput, JSON.stringify(home));
test('T1 首页本地视频按钮', home && home.hasLocalBtn, JSON.stringify(home && home.buttons));

// T2 搜索（输入 + 点击搜索按钮）
const search = await ev(`(async () => {
  const input = document.querySelector('input');
  if (!input) return { fail: 'no input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 28000));
  const body = document.body.innerText;
  return {
    links: document.querySelectorAll('a[href*="/watch"]').length,
    bodySnippet: body.slice(0, 320),
    hasFailures: body.includes('源失败') || body.includes('请求失败'),
    hasNoResult: body.includes('没有找到'),
  };
})()`);
test('T2 搜索返回结果', search && search.links > 0, JSON.stringify(search && { links: search.links, snippet: search.bodySnippet }));
test('T2 无源失败提示', search && !search.hasFailures, JSON.stringify(search && search.bodySnippet));

// T3 详情
const detail = await ev(`(async () => {
  const link = document.querySelector('a[href*="/watch"]');
  if (!link) return { fail: 'no result link' };
  link.click();
  await new Promise(r => setTimeout(r, 12000));
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  const body = document.body.innerText;
  return {
    url: location.href,
    hasDetail: body.length > 300,
    episodeCount: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).length,
    episodeBtns: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).slice(0, 6),
    bodySnippet: body.slice(0, 200),
  };
})()`);
test('T3 详情页打开', detail && detail.hasDetail && !detail.fail, JSON.stringify(detail));
test('T3 有分集列表', detail && detail.episodeCount > 0, JSON.stringify(detail && detail.episodeBtns));

// T4 播放（点分集 -> hls 经代理加载）
const play = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /^(第|HD|超清|4K|1080|720)/.test((b.innerText || '').trim()));
  if (!btn) return { fail: 'no episode btn' };
  btn.click();
  await new Promise(r => setTimeout(r, 20000));
  const v = document.querySelector('video');
  const body = document.body.innerText;
  return {
    hasVideo: !!v,
    videoSrc: v ? (v.currentSrc || v.src || '').slice(0, 120) : '',
    videoReady: v ? v.readyState : -1,
    bodySnippet: body.slice(0, 200),
    hasError: body.includes('播放失败') || body.includes('加载失败'),
  };
})()`);
test('T4 播放器出现', play && play.hasVideo, JSON.stringify(play && play.videoSrc));
test('T4 无播放报错', play && !play.hasError, JSON.stringify(play && play.bodySnippet));

// T5 设置页
const settings = await ev(`(async () => {
  const btn = [...document.querySelectorAll('a, button')].find(b => (b.innerText || '').trim() === '设置');
  if (!btn) return { fail: 'no settings entry: ' + [...document.querySelectorAll('a, button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 10).join(',') };
  btn.click();
  await new Promise(r => setTimeout(r, 6000));
  const body = document.body.innerText;
  return { url: location.href, hasSource: body.includes('点播源'), hasTest: body.includes('测活'), snippet: body.slice(0, 180) };
})()`);
test('T5 设置页打开', settings && settings.url.includes('settings'), JSON.stringify(settings && settings.url));
test('T5 源管理+测活UI', settings && settings.hasSource && settings.hasTest, JSON.stringify(settings && settings.snippet));

console.log('---PROXY STATS---');
console.log(JSON.stringify(proxyStats));
console.log('---REQLOG (' + reqLog.length + ')---');
reqLog.slice(0, 15).forEach(l => console.log('  ' + l));
console.log('---SUMMARY---');
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
