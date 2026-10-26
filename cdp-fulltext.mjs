// 快速：搜索 -> 卡片 -> 来源 -> dump 完整 dialogText（选集区）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') handlePaused(m.params).catch(() => {});
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m));
  ws.send(JSON.stringify({ id, method, params }));
});
async function handlePaused(p) {
  const { requestId, request } = p;
  try {
    if (request.url.includes('127.0.0.1:8777')) { await send('Fetch.continueRequest', { requestId }); return; }
    let target = request.url;
    if (request.url.includes('libretv.local')) {
      try { target = new URL(request.url).searchParams.get('url'); if (!target) throw new Error('x'); }
      catch { await send('Fetch.fulfillRequest', { requestId, responseCode: 400, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }); return; }
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': '*/*', Referer: request.headers?.referer || '' }, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const buf = Buffer.from(await resp.arrayBuffer());
    await send('Fetch.fulfillRequest', { requestId, responseCode: resp.status, responseHeaders: [
      { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: resp.headers.get('content-type') || 'application/octet-stream' },
    ], body: buf.toString('base64') });
  } catch (e) {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 502, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from('proxy error').toString('base64') });
  }
}
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) return { jsError: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 200) };
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(7000);
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
await sleep(12000);
const dump = await ev(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return { noDialog: true };
  const txt = dialog.innerText;
  const allBtns = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
  return {
    fullText: txt,
    tail: txt.slice(-400),
    allBtns,
    digitBtns: allBtns.filter(b => /^\d{1,3}$/.test(b)).slice(0, 8),
    hasEmpty: txt.includes('未找到播放资源'),
    hasEpisodes: txt.includes('集') || txt.includes('选集'),
  };
})()`);
console.log('=== FULL DIALOG TEXT ===');
console.log(dump && dump.fullText);
console.log('=== TAIL ===');
console.log(dump && dump.tail);
console.log('=== BTNS ===');
console.log(JSON.stringify(dump && dump.allBtns));
console.log('=== SUMMARY ===');
console.log(JSON.stringify(dump && { digitBtns: dump.digitBtns, hasEmpty: dump.hasEmpty, hasEpisodes: dump.hasEpisodes }));
ws.close();
process.exit(0);
