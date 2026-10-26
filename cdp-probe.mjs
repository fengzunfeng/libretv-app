// 最小探针：CDP 连接 + 简单 evaluate（无 awaitPromise、无 Fetch 拦截）
async function getPageWs() {
  const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const page = pages.find(p => p.type === 'page' && p.url.includes('127.0.0.1:8777'));
  if (!page) throw new Error('no page, pages=' + JSON.stringify(pages.map(p => p.type + ':' + p.url)));
  return page.webSocketDebuggerUrl;
}
console.log('PAGE: ' + await getPageWs());
const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
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
await send('Runtime.enable');
const r = await send('Runtime.evaluate', { expression: 'document.title + " | " + location.href', returnByValue: true });
console.log('EVAL: ' + JSON.stringify(r.result?.result?.value));
ws.close();
process.exit(0);
