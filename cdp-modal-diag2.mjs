// 诊断2：点来源行（点击与 dump 分离，避免 eval 内长等待挂起）
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
    const t = setTimeout(() => ctrl.abort(), 20000);
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
  if (r.result?.exceptionDetails) return { jsError: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) };
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(7000);
await ev(`(() => { window.LibreTV = { pickLocalVideo(){ return true; }, pollLocalVideoResult(){ return null; } }; return true; })()`);
// 搜索
await ev(`(async () => {
  const input = document.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索').click();
  return true;
})()`);
await sleep(26000);
// 点卡片
await ev(`(() => {
  const card = [...document.querySelectorAll('[role="button"]')].find(el => (el.innerText || '').includes('长津湖') && (el.innerText || '').includes('战争片'));
  if (card) card.click();
  return !!card;
})()`);
await sleep(5000);
// 点来源行（非凡资源）
const clicked = await ev(`(() => {
  const row = [...document.querySelectorAll('[role="button"]')].find(el => {
    const t = (el.innerText || '').trim();
    return /非凡/.test(t) && !t.includes('本地') && t.length < 40;
  });
  if (!row) return 'NO ROW';
  row.click();
  return 'clicked: ' + row.innerText.trim();
})()`);
console.log('CLICK SOURCE: ' + JSON.stringify(clicked));
await sleep(12000);
// dump 弹窗
const dump = await ev(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return {
    hasDialog: !!dialog,
    dialogText: dialog ? dialog.innerText.slice(0, 600) : 'no dialog',
    buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 40),
    bodyTail: document.body.innerText.slice(-400),
  };
})()`);
console.log('DUMP: ' + JSON.stringify(dump, null, 1));
ws.close();
process.exit(0);
