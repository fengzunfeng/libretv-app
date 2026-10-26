// 诊断2：水合状态 + 点击搜索按钮交互
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
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const args = m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 250);
    events.push('CONSOLE[' + m.params.type + ']: ' + args);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    events.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 250));
  }
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
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(8000);

const s1 = await ev(`(() => ({
  nextF: typeof window.__next_f,
  nextFLen: Array.isArray(window.__next_f) ? window.__next_f.length : -1,
  nextRoot: !!document.querySelector('#__next'),
  nextRootHTML: document.querySelector('#__next') ? document.querySelector('#__next').innerHTML.slice(0, 150) : 'none',
  inputCount: document.querySelectorAll('input').length,
  hasSearchBtn: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === '搜索'),
}))()`);
console.log('HYDRATION STATE: ' + JSON.stringify(s1, null, 1));

// 交互：输入 + 点搜索按钮
const s2 = await ev(`(async () => {
  const input = document.querySelector('input');
  if (!input) return { fail: 'no input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));
  const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '搜索');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 15000));
  const body = document.body.innerText;
  const links = document.querySelectorAll('a[href*="/watch"]').length;
  return { bodySnippet: body.slice(0, 300), links, url: location.href };
})()`);
console.log('SEARCH RESULT: ' + JSON.stringify(s2, null, 1));
console.log('EVENTS (' + events.length + '):');
events.slice(0, 30).forEach(e => console.log('  ' + e));
ws.close();
process.exit(0);
