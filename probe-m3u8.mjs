// 测试 ffzy-play m3u8 可达性（不同 UA/Referer 组合）
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const url = 'https://vip.ffzy-play.com/20221015/1046_3db8a942/index.m3u8';
const combos = [
  { name: 'no-hdrs', headers: { 'User-Agent': UA } },
  { name: 'referer-same', headers: { 'User-Agent': UA, 'Referer': 'https://vip.ffzy-play.com/' } },
  { name: 'referer-cj', headers: { 'User-Agent': UA, 'Referer': 'https://cj.ffzyapi.com/' } },
  { name: 'referer-http', headers: { 'User-Agent': UA, 'Referer': 'http://vip.ffzy-play.com/' } },
];
for (const c of combos) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { headers: c.headers, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const txt = await r.text();
    console.log(`${c.name}: HTTP ${r.status}, len=${txt.length}, head=${txt.slice(0, 80).replace(/\n/g, '|')}`);
  } catch (e) {
    console.log(`${c.name}: ERR ${e.message.slice(0, 80)}`);
  }
}
