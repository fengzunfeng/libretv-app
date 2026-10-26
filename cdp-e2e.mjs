// v4 全功能端到端测试：CDP 驱动真实浏览器（Edge headless）
// T1 首页UI -> T2 搜索 -> T3 详情 -> T4 播放 -> T5 设置页 -> T6 本地视频按钮
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPageWs() {
  const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const page = pages.find(p => p.type === 'page' && p.url.includes('127.0.0.1:8777'));
  if (!page) throw new Error('no page found: ' + pages.map(p => p.type + ':' + p.url).join(' | '));
  return page.webSocketDebuggerUrl;
}

const ws = new WebSocket(await getPageWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
let mid = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid;
  pending.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { jsError: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const wait = (ms) => sleep(ms);
const results = [];
const test = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail); };

await send('Page.enable');
await send('Runtime.enable');
// 确保停在首页
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await wait(7000);

// ---- T1 首页 UI ----
const home = await ev(`(() => {
  const input = document.querySelector('input');
  return {
    hasInput: !!input,
    inputPlaceholder: input ? input.placeholder : '',
    inputType: input ? input.type : '',
    buttons: [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 15),
    title: document.title,
    hasMain: !!document.querySelector('main'),
    bodyLen: document.body.innerText.length,
  };
})()`);
test('T1 首页渲染(搜索框)', home && home.hasInput, JSON.stringify(home));
test('T1 首页含本地视频按钮', home && home.buttons.some(b => b.includes('本地视频')), JSON.stringify(home && home.buttons));
test('T1 首页非RSC原文', home && home.bodyLen > 500 && !String(home).includes('$Sreact.fragment'), 'bodyLen=' + (home && home.bodyLen));

// ---- T2 搜索 ----
const search = await ev(`(async () => {
  const input = document.querySelector('input');
  if (!input) return { fail: 'no input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '长津湖');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  // 尝试回车
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 13 }));
  await new Promise(r => setTimeout(r, 16000));
  const cards = document.querySelectorAll('a[href*="/watch"], [class*="grid"] a, article a');
  const body = document.body.innerText;
  return {
    resultLinks: cards.length,
    bodySnippet: body.slice(0, 220),
    hasLoading: body.includes('加载') || body.includes('搜索中'),
    hasNoResult: body.includes('未找到') || body.includes('没有找到'),
  };
})()`);
test('T2 搜索有结果链接', search && search.resultLinks > 0, JSON.stringify(search));
test('T2 页面显示片名', search && search.bodySnippet.includes('长津湖'), JSON.stringify(search && search.bodySnippet));

// ---- T3 详情 ----
const detail = await ev(`(async () => {
  const link = document.querySelector('a[href*="/watch"]');
  if (!link) return { fail: 'no result link' };
  link.click();
  await new Promise(r => setTimeout(r, 9000));
  const body = document.body.innerText;
  const buttons = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 20);
  return {
    url: location.href,
    bodySnippet: body.slice(0, 260),
    hasEpisodes: buttons.length > 2,
    episodeButtons: buttons.slice(0, 8),
    hasPlayButton: buttons.some(b => b.includes('播放') || /^第|^HD|^超清|^01|^1$/.test(b)),
  };
})()`);
test('T3 详情页导航成功', detail && detail.url.includes('/watch'), JSON.stringify(detail && detail.url));
test('T3 详情有分集列表', detail && detail.hasEpisodes, JSON.stringify(detail && detail.episodeButtons));

// ---- T4 播放 ----
const play = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /^第|^HD|^超清|^01|^1$/.test(b.innerText.trim()) && !b.innerText.includes('本地'));
  if (!btn) return { fail: 'no episode button: ' + [...document.querySelectorAll('button')].map(b => b.innerText.trim()).slice(0,15).join(',') };
  btn.click();
  await new Promise(r => setTimeout(r, 12000));
  const v = document.querySelector('video');
  return {
    hasVideo: !!v,
    videoSrc: v ? v.currentSrc || v.src : '',
    bodySnippet: document.body.innerText.slice(0, 200),
    url: location.href,
  };
})()`);
test('T4 播放器元素出现', play && play.hasVideo, JSON.stringify(play && play.videoSrc));
test('T4 播放页非报错', play && !String(play.bodySnippet).includes('未找到播放资源') && !String(play.bodySnippet).includes('播放失败'), JSON.stringify(play && play.bodySnippet));

// ---- T5 设置页 ----
const settings = await ev(`(async () => {
  // 找设置入口（底部导航或按钮）
  const btn = [...document.querySelectorAll('button, a, nav a, footer a')].find(b => (b.innerText || '').trim() === '设置' || (b.innerText || '').includes('设置'));
  if (!btn) return { fail: 'no settings entry: ' + [...document.querySelectorAll('a, button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0,12).join(',') };
  btn.click();
  await new Promise(r => setTimeout(r, 6000));
  const body = document.body.innerText;
  return {
    url: location.href,
    hasSourceMgmt: body.includes('点播源') || body.includes('源管理'),
    hasTestBtn: body.includes('测活') || body.includes('批量测活'),
    bodySnippet: body.slice(0, 220),
  };
})()`);
test('T5 设置页打开', settings && settings.url.includes('settings'), JSON.stringify(settings && settings.url));
test('T5 源管理+测活UI', settings && settings.hasSourceMgmt && settings.hasTestBtn, JSON.stringify(settings && settings.bodySnippet));

// ---- T6 本地视频按钮存在 + 代码路径 ----
const local = await ev(`(async () => {
  // 回首页
  const homeLink = [...document.querySelectorAll('a')].find(a => (a.getAttribute('href') === '/' || (a.innerText||'').trim() === '首页'));
  if (homeLink) homeLink.click();
  await new Promise(r => setTimeout(r, 4000));
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').includes('本地视频'));
  if (!btn) return { fail: 'no local video button on home' };
  // 点击前先注入 mock 桥，验证前端是否正确调用
  let called = false;
  window.LibreTV = window.LibreTV || {};
  const orig = window.LibreTV.pickLocalVideo;
  window.LibreTV.pickLocalVideo = function() { called = true; return true; };
  btn.click();
  await new Promise(r => setTimeout(r, 2000));
  return { pickCalled: called, hasBridge: 'LibreTV' in window };
})()`);
test('T6 本地视频按钮调用JS桥', local && local.pickCalled, JSON.stringify(local));

console.log('---SUMMARY---');
console.log(JSON.stringify(results, null, 1));
ws.close();
process.exit(0);
