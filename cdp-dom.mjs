// 诊断3：搜索后 DOM 结构 + 首页按钮/链接 + 设置入口
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');

// 当前页面可能是搜索结果页（上次测试遗留）——重新导航首页再搜索
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(6000);
const home = await ev(`(() => {
  const clickables = [];
  document.querySelectorAll('a, button, [role="button"]').forEach(el => {
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (t) clickables.push({ tag: el.tagName, text: t.slice(0, 20), href: el.getAttribute('href') || '' });
  });
  return { clickables: clickables.slice(0, 25), navText: document.querySelector('nav')?.innerText || document.body.innerText.slice(0, 150) };
})()`);
console.log('HOME CLICKABLES: ' + JSON.stringify(home, null, 1));

// 搜索
const sr = await ev(`(async () => {
  const input = document.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '搜索');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 20000));
  // 抓结果区 DOM
  const cards = [];
  document.querySelectorAll('[class*="card"], [class*="item"], [class*="result"], article, li').forEach(el => {
    const t = (el.innerText || '').trim().slice(0, 40);
    const tag = el.tagName;
    const clickable = el.querySelector('a, button');
    if (t && t.length > 2) cards.push({ tag, text: t, childA: !!el.querySelector('a'), childBtn: !!el.querySelector('button'), href: el.querySelector('a')?.getAttribute('href') || '' });
  });
  return { cards: cards.slice(0, 15), allA: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(Boolean).slice(0, 10) };
})()`);
console.log('SEARCH CARDS: ' + JSON.stringify(sr, null, 1));
ws.close();
process.exit(0);
