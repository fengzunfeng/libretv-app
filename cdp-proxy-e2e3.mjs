// v4 全链路端到端测试 v3：修正选择器（role=button 卡片、DetailModal、播放跳转）
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
      try { const u = new URL(url); target = u.searchParams.get('url'); if (!target) throw new Error('x'); }
      catch { await send('Fetch.fulfillRequest', { requestId, responseCode: 400, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('bad proxy url').toString('base64') }); return; }
    }
    const hdrs = { 'User-Agent': UA, 'Accept': '*/*' };
    if (request.headers?.referer) hdrs['Referer'] = request.headers.referer;
    if (request.headers?.range) hdrs['Range'] = request.headers.range;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(target, { headers: hdrs, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    if ((resp.headers.get('content-type') || '').includes('mpegurl') || target.includes('.m3u8')) proxyStats.m3u8++;
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
await ev(`(() => { window.LibreTV = window.LibreTV || {}; window.LibreTV.pickLocalVideo = function(){ window.__pickCalled = true; return true; }; window.LibreTV.pollLocalVideoResult = function(){ return null; }; return true; })()`);

// T1 首页
const t1 = await ev(`(() => ({
  hasInput: !!document.querySelector('input'),
  buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 12),
}))()`);
test('T1 首页渲染', t1 && t1.hasInput, JSON.stringify(t1));

// T2 搜索
const t2 = await ev(`(async () => {
  const input = document.querySelector('input');
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
    hasLocalBtn: body.includes('播放本地视频'),
    snippet: body.slice(0, 200),
  };
})()`);
test('T2 搜索返回结果', t2 && t2.hasResults, JSON.stringify(t2 && t2.snippet));
test('T2 无源失败', t2 && t2.hasNoFailures, 'ok');
test('T2 本地视频按钮(重渲染后)', t2 && t2.hasLocalBtn, 'hasLocalBtn=' + t2?.hasLocalBtn);

// T3 详情弹窗
const t3 = await ev(`(async () => {
  const card = [...document.querySelectorAll('[role="button"]')].find(el => (el.innerText || '').includes('长津湖'));
  if (!card) return { fail: 'no card' };
  card.click();
  await new Promise(r => setTimeout(r, 10000));
  const body = document.body.innerText;
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  return {
    hasModal: body.includes('长津湖') && (body.includes('简介') || body.includes('选集') || body.includes('演员')),
    episodeCount: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).length,
    episodeBtns: btns.filter(b => /^(第|HD|超清|4K|1080|720)/.test(b)).slice(0, 4),
    snippet: body.slice(0, 180),
  };
})()`);
test('T3 详情弹窗打开', t3 && t3.hasModal && !t3.fail, JSON.stringify(t3 && t3.snippet));
test('T3 详情含分集', t3 && t3.episodeCount > 0, JSON.stringify(t3 && t3.episodeBtns));

// T4 播放（弹窗内点分集 -> /watch 路由 -> 播放器）
const t4 = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /^(第|HD|超清|4K|1080|720)/.test((b.innerText || '').trim()));
  if (!btn) return { fail: 'no episode btn in modal' };
  btn.click();
  await new Promise(r => setTimeout(r, 20000));
  const v = document.querySelector('video');
  const body = document.body.innerText;
  return {
    url: location.href,
    hasVideo: !!v,
    videoSrc: v ? (v.currentSrc || v.src || '').slice(0, 130) : '',
    readyState: v ? v.readyState : -1,
    hasPlayError: body.includes('播放失败') || body.includes('加载失败') || body.includes('无法播放') || body.includes('未找到播放资源'),
    snippet: body.slice(0, 150),
  };
})()`);
test('T4 跳转播放页', t4 && t4.url.includes('/watch'), JSON.stringify(t4 && t4.url));
test('T4 播放器出现', t4 && t4.hasVideo, JSON.stringify(t4 && t4.videoSrc));
test('T4 播放加载正常(无报错)', t4 && !t4.hasPlayError, 'readyState=' + t4?.readyState);

// T5 设置页
const t5 = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '设置');
  if (!btn) return { fail: 'no settings btn: ' + [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).slice(0,10).join(',') };
  btn.click();
  await new Promise(r => setTimeout(r, 6000));
  const body = document.body.innerText;
  return { url: location.href, hasSource: body.includes('点播源'), hasTest: body.includes('测活'), snippet: body.slice(0, 160) };
})()`);
test('T5 设置页打开', t5 && t5.url.includes('settings'), JSON.stringify(t5 && t5.url));
test('T5 源管理+测活UI', t5 && t5.hasSource && t5.hasTest, JSON.stringify(t5 && t5.snippet));

console.log('---PROXY STATS---');
console.log(JSON.stringify(proxyStats));
console.log('---CONSOLE ERRS (' + CONSOLE_ERRS.length + ')---');
CONSOLE_ERRS.slice(0, 10).forEach(l => console.log('  ' + l));
console.log('---SUMMARY---');
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
