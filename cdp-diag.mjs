// 诊断：抓取首页加载时的 console 错误 + 网络失败
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
const events = [];
ws.onmessage2 = null;
// 收集事件
const orig = ws.onmessage;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    events.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    const args = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    events.push('CONSOLE[' + m.params.type + ']: ' + args.slice(0, 300));
  }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    events.push('HTTP' + m.params.response.status + ': ' + m.params.response.url.slice(0, 150));
  }
  if (m.method === 'Network.loadingFailed') {
    events.push('LOADFAIL: ' + (m.params.errorText || '') + ' ' + (m.params.blockedReason || '') + ' url=' + (m.params.requestId || ''));
  }
};
await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleep(9000);
// 额外抓页面状态
const state = await send('Runtime.evaluate', {
  expression: `(() => {
    const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
    return { scripts, bodyLen: document.body.innerText.length, readyState: document.readyState, hasLibreTV: 'LibreTV' in window };
  })()`,
  returnByValue: true,
}).then(r => r.result?.result?.value);
console.log('STATE: ' + JSON.stringify(state, null, 1));
console.log('EVENTS (' + events.length + '):');
events.slice(0, 40).forEach(e => console.log('  ' + e));
ws.close();
process.exit(0);
