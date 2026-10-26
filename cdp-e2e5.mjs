// e2e5：完整链路 + 请求日志；等待全部放 node 侧，eval 只做同步动作
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
const reqLog = [];
const CONSOLE_ERRS = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') handlePaused(m.params).catch(() => {});
  if (m.method === 'Runtime.exceptionThrown') CONSOLE_ERRS.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 160));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') CONSOLE_ERRS.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m));
  ws.send(JSON.stringify({ id, method, params }));
});
async function handlePaused(p) {
  const { requestId, request } = p;
  const url = request.url;
  try {
    if (url.includes('127.0.0.1:8777')) { await send('Fetch.continueRequest', { requestId }); return; }
    let target = url;
    if (url.includes('libretv.local')) {
      try { target = new URL(url).searchParams.get('url'); if (!target) throw new Error('x'); }
      catch { await send('Fetch.fulfillRequest', { requestId, responseCode: 400, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }); return; }
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': '*/*', Referer: request.headers?.referer || '' }, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const buf = Buffer.from(await resp.arrayBuffer());
    reqLog.push({ url: target.slice(0, 110), status: resp.status, kb: Math.round(buf.length / 1024) });
    await send('Fetch.fulfillRequest', { requestId, responseCode: resp.status, responseHeaders: [
      { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: resp.headers.get('content-type') || 'application/octet-stream' },
    ], body: buf.toString('base64') });
  } catch (e) {
    reqLog.push({ url: url.slice(0, 110), status: 'ERR ' + e.message.slice(0, 30) });
    await send('Fetch.fulfillRequest', { requestId, responseCode: 502, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('proxy error').toString('base64') });
  }
}
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) return { jsError: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) };
  return r.result?.result?.value;
};
const results = [];
const test = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + String(detail).slice(0, 260)); };

await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(7000);
await ev(`(() => { window.LibreTV = { pickLocalVideo(){ window.__pickCalled = true; return true; }, pollLocalVideoResult(){ return null; } }; return true; })()`);

// T1
const t1 = await ev(`(() => ({ hasInput: !!document.querySelector('input') }))()`);
test('T1 首页渲染', t1 && t1.hasInput, 'ok');

// T2 搜索（同步输入 + 点击，等待放 node 侧）
await ev(`(() => {
  const input = document.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(600);
await ev(`(() => { [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索').click(); return true; })()`);
await sleep(28000);
const t2 = await ev(`(() => {
  const body = document.body.innerText;
  return { hasResults: body.includes('部影片') && !body.includes('0 部影片'), hasNoFailures: !body.includes('源失败'), hasLocalBtn: body.includes('播放本地视频'), snippet: body.slice(0, 140) };
})()`);
test('T2 搜索返回结果', t2 && t2.hasResults, JSON.stringify(t2 && t2.snippet));
test('T2 无源失败', t2 && t2.hasNoFailures, 'ok');
test('T2 本地视频按钮', t2 && t2.hasLocalBtn, 'ok');

// T3 点卡片 -> 展开 -> 点来源 -> 等 -> dump 弹窗
await ev(`(() => {
  const card = [...document.querySelectorAll('[role="button"]')].find(el => (el.innerText || '').includes('长津湖') && (el.innerText || '').includes('战争片'));
  if (card) card.click();
  return !!card;
})()`);
await sleep(4500);
await ev(`(() => {
  const row = [...document.querySelectorAll('[role="button"]')].find(el => { const t = (el.innerText || '').trim(); return /非凡/.test(t) && !t.includes('本地') && t.length < 40; });
  if (row) row.click();
  return !!row;
})()`);
await sleep(15000);
const t3 = await ev(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  return {
    hasDialog: !!dialog,
    dialogText: dialog ? dialog.innerText.slice(0, 500) : 'no dialog',
    episodeBtns: btns.filter(b => /^\d{1,3}$/.test(b)).slice(0, 5),
    btns: btns.slice(0, 20),
  };
})()`);
test('T3 详情弹窗打开', t3 && t3.hasDialog, JSON.stringify(t3 && (t3.dialogText || '').slice(0, 120)));
test('T3 选集按钮出现', t3 && t3.episodeBtns.length > 0, JSON.stringify(t3 && t3.episodeBtns));

// T4 播放：若有数字按钮则点击，否则跳过
if (t3 && t3.episodeBtns && t3.episodeBtns.length > 0) {
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /^\d{1,3}$/.test((b.innerText || '').trim()));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(20000);
  const t4 = await ev(`(() => {
    const v = document.querySelector('video');
    const body = document.body.innerText;
    return { url: location.href, hasVideo: !!v, videoSrc: v ? (v.currentSrc || v.src || '').slice(0, 100) : '', readyState: v ? v.readyState : -1, hasPlayError: body.includes('播放失败') || body.includes('加载失败') || body.includes('无法播放') || body.includes('未找到播放资源'), snippet: body.slice(0, 120) };
  })()`);
  test('T4 跳转播放页', t4 && t4.url.includes('/watch'), JSON.stringify(t4 && t4.url));
  test('T4 播放器出现', t4 && t4.hasVideo, JSON.stringify(t4 && t4.videoSrc));
  test('T4 无播放报错', t4 && !t4.hasPlayError, 'readyState=' + t4?.readyState);
} else {
  console.log('SKIP T4 (no episode button in modal)');
}

// T5 设置
await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '设置');
  if (btn) btn.click();
  return !!btn;
})()`);
await sleep(5000);
const t5 = await ev(`(() => {
  const body = document.body.innerText;
  return { url: location.href, hasSource: body.includes('点播源'), hasTest: body.includes('测活'), snippet: body.slice(0, 120) };
})()`);
test('T5 设置页打开', t5 && t5.url.includes('settings'), JSON.stringify(t5 && t5.url));
test('T5 源管理+测活UI', t5 && t5.hasSource && t5.hasTest, JSON.stringify(t5 && t5.snippet));

console.log('---REQ LOG (' + reqLog.length + ')---');
reqLog.slice(-15).forEach(l => console.log('  ' + JSON.stringify(l)));
console.log('---CONSOLE ERRS (' + CONSOLE_ERRS.length + ')---');
CONSOLE_ERRS.slice(0, 8).forEach(l => console.log('  ' + l));
console.log('---SUMMARY---');
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
