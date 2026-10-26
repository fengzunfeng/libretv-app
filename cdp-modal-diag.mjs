// 诊断：点卡片 -> 展开 -> 点来源行 -> dump 弹窗内容
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(7000);
// 搜索
await ev(`(async () => {
  const input = document.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索').click();
  await new Promise(r => setTimeout(r, 26000));
  return true;
})()`);
// 点卡片（长津湖 战争片）
const step1 = await ev(`(() => {
  const card = [...document.querySelectorAll('[role="button"]')].find(el => (el.innerText || '').includes('长津湖') && (el.innerText || '').includes('战争片'));
  if (!card) return 'NO CARD';
  card.click();
  return 'clicked card, body now: ' + document.body.innerText.slice(0, 200);
})()`);
console.log('STEP1: ' + step1);
await sleep(5000);
const step2 = await ev(`(() => {
  const sources = [...document.querySelectorAll('[role="button"]')].filter(el => {
    const t = (el.innerText || '').trim();
    return /非凡|百度|光速|360/.test(t) && !t.includes('本地') && t.length < 40;
  }).map(el => el.innerText.trim());
  return 'source rows: ' + JSON.stringify(sources);
})()`);
console.log('STEP2: ' + step2);
await sleep(1000);
const step3 = await ev(`(async () => {
  const row = [...document.querySelectorAll('[role="button"]')].find(el => {
    const t = (el.innerText || '').trim();
    return /非凡|百度|光速|360/.test(t) && !t.includes('本地') && t.length < 40;
  });
  if (!row) return 'NO ROW';
  row.click();
  await new Promise(r => setTimeout(r, 10000));
  const dialog = document.querySelector('[role="dialog"]');
  const body = document.body.innerText;
  return {
    hasDialog: !!dialog,
    dialogText: dialog ? dialog.innerText.slice(0, 400) : 'no dialog',
    allButtons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 30),
    bodyTail: body.slice(-300),
  };
})()`);
console.log('STEP3: ' + JSON.stringify(step3, null, 1));
ws.close();
process.exit(0);
