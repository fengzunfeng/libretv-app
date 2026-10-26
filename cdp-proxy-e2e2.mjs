// v4 全链路端到端测试 v2（带壳代理模拟 + 注入 JS 桥）：
// CDP Fetch 拦截 -> node fetch 转发 -> CORS 头（等效真机壳）
// T1 首页+本地视频(注入桥) -> T2 搜索 -> T3 详情 -> T4 播放(m3u8) -> T5 设置
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function getPageWs() {
  const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const page = pages.find(p => p.type === 'page' && p.url.includes('127.0.0.1:8777'));
  if (!page) throw new Error('no page');
  return page.webSocketDebuggerUrl;
}
const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
let mid = 0;
const pending = new Map();
const proxyStats = { total: 0, ok: 0, err: 0, m3u8: 0 };
const reqLog = [];
const CONSOLE_ERRS = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') handlePaused(m.params).catch(() => {});
  if (m.method === 'Runtime.exceptionThrown') CONSOLE_ERRS.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') CONSOLE_ERRS.push('CONSOLE: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
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
    if (url.includes('127.0.0.1:8777')) { await send('Fetch.continueRequest', { requestId }); return; }
    let target = url;
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
    if (target.includes('.m3u8') || (resp.headers.get('content-type') || '').includes('mpegurl')) proxyStats.m3u8++;
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
    reqLog.push('PROXY-ERR: ' + url.slice(0, 90) + ' -> ' + String(e.message).slice(0, 60));
    await send('Fetch.fulfillRequest', { requestId, responseCode: 502, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('proxy error').toString('base64') });
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
await sleep(7000);

// 注入模拟 JS 桥（等效真机壳注入）
await ev(`(() => { window.LibreTV = window.LibreTV || {}; window.LibreTV.pickLocalVideo = function(){ window.__pickCalled = true; return true; }; window.LibreTV.pollLocalVideoResult = function(){ return null; }; return true; })()`);

// T1 首页 + 本地视频按钮
const t1 = await ev(`(async () => {
  const hasLocalBtn = [...document.querySelectorAll('button')].some(b => (b.innerText || '').includes('本地视频'));
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').includes('本地视频'));
  let pickCalled = false;
  if (btn) { btn.click(); await new Promise(r => setTimeout(r, 1500)); pickCalled = window.__pickCalled === true; }
  return { hasLocalBtn, pickCalled, buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 12) };
})()`);
test('T1 首页渲染', t1 && t1.buttons.length > 5, JSON.stringify(t1 && t1.buttons));
test('T1 本地视频按钮(注入桥后显示)', t1 && t1.hasLocalBtn, JSON.stringify(t1 && t1.buttons));
test('T1 本地视频按钮调用JS桥', t1 && t1.pickCalled, 'pickCalled=' + t1?.pickCalled);

// T2 搜索
const t2 = await ev(`(async () => {
  const input = document.querySelector('input');
  if (!input) return { fail: 'no input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 28000));
  const body = document.body.innerText;
  return {
    hasResults: body.includes('部影片') && !body.includes('0 部影片'),
    hasNoFailures: !body.includes('源失败'),
    bodySnippet: body.slice(0, 260),
  };
})()`);
test('T2 搜索返回结果(4源聚合)', t2 && t2.hasResults, JSON.stringify(t2 && t2.bodySnippet));
test('T2 无源失败', t2 && t2.hasNoFailures, 'noFailures=' + t2?.hasNoFailures);

// T3 详情：点结果卡片（按文本定位可点击元素）
const t3 = await ev(`(async () => {
  const candidates = [...document.querySelectorAll('div, a, button')].filter(el => {
    const t = (el.innerText || '').trim();
    return (t.includes('长津湖') && t.includes('战争片')) || (t.startsWith('长津湖') && t.includes('来源'));
  });
  if (!candidates.length) return { fail: 'no card: ' + document.body.innerText.slice(0, 200) };
  const el = candidates[0];
  // 若 div 无 onClick，找其子 a/button；都没有则点击 div 本身（冒泡）
  const clickable = el.tagName === 'A' || el.tagName === 'BUTTON' ? el : (el.querySelector('a, button') || el);
  clickable.click();
  await new Promise(r => setTimeout(r, 12000));
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  return {
    url: location.href,
    episodeCount: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).length,
    episodeBtns: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).slice(0, 5),
    bodySnippet: document.body.innerText.slice(0, 160),
  };
})()`);
test('T3 详情页导航', t3 && t3.url.includes('/watch'), JSON.stringify(t3 && t3.url));
test('T3 详情有分集', t3 && t3.episodeCount > 0, JSON.stringify(t3 && t3.episodeBtns));

// T4 播放
const t4 = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /^(第|HD|超清|4K|1080|720)/.test((b.innerText || '').trim()));
  if (!btn) return { fail: 'no episode btn' };
  btn.click();
  await new Promise(r => setTimeout(r, 20000));
  const v = document.querySelector('video');
  const body = document.body.innerText;
  return {
    hasVideo: !!v,
    videoSrc: v ? (v.currentSrc || v.src || '').slice(0, 130) : '',
    readyState: v ? v.readyState : -1,
    hasPlayError: body.includes('播放失败') || body.includes('加载失败') || body.includes('无法播放'),
    bodySnippet: body.slice(0, 140),
  };
})()`);
test('T4 播放器出现', t4 && t4.hasVideo, JSON.stringify(t4 && t4.videoSrc));
test('T4 播放无报错', t4 && !t4.hasPlayError, 'readyState=' + t4?.readyState + ' ' + JSON.stringify(t4 && t4.bodySnippet));

// T5 设置页
const t5 = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '设置');
  if (!btn) return { fail: 'no settings btn' };
  btn.click();
  await new Promise(r => setTimeout(r, 6000));
  const body = document.body.innerText;
  return { url: location.href, hasSource: body.includes('点播源'), hasTest: body.includes('测活'), snippet: body.slice(0, 160) };
})()`);
test('T5 设置页打开', t5 && t5.url.includes('settings'), JSON.stringify(t5 && t5.url));
test('T5 源管理+测活', t5 && t5.hasSource && t5.hasTest, JSON.stringify(t5 && t5.snippet));

console.log('---PROXY STATS---');
console.log(JSON.stringify(proxyStats));
console.log('---CONSOLE ERRS (' + CONSOLE_ERRS.length + ')---');
CONSOLE_ERRS.slice(0, 10).forEach(l => console.log('  ' + l));
console.log('---REQLOG---');
reqLog.slice(0, 10).forEach(l => console.log('  ' + l));
console.log('---SUMMARY---');
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
