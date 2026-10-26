// 批量探测候选源（http/https 双版本），结果写入文件避免输出丢失
import fs from 'node:fs';
const candidates = [
  ['ffzy-http', 'http://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8'],
  ['ffzy-https', 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8'],
  ['lziapi-http', 'http://cj.lziapi.com/api.php/provide/vod/from/lzm3u8'],
  ['lziapi-https', 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8'],
  ['bfzy', 'https://bfzyapi.com/api.php/provide/vod/from/bfzym3u8'],
  ['guangsu', 'https://api.guangsuapi.com/api.php/provide/vod/from/gsm3u8'],
  ['kczy', 'https://caiji.kczyapi.com/api.php/provide/vod/from/kcm3u8'],
  ['tiankong', 'http://m3u8.tiankongapi.com/api.php/provide/vod/from/tkm3u8'],
  ['hongniu', 'https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8'],
  ['jszy', 'https://jszyapi.com/api.php/provide/vod/from/jsm3u8'],
  ['hhzy', 'https://hhzyapi.com/api.php/provide/vod/from/hhm3u8'],
  ['suoniapi', 'https://suoniapi.com/api.php/provide/vod/from/snm3u8'],
  ['wujin', 'https://api.wujinapi.com/api.php/provide/vod/from/wjm3u8'],
  ['apibdzy', 'https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8'],
  ['dyttzy', 'http://caiji.dyttzyapi.com/api.php/provide/vod/from/dyttm3u8'],
  ['1080zyku', 'http://api.1080zyku.com/inc/api.php/provide/vod'],
  ['360zy', 'https://360zy.com/api.php/provide/vod'],
  ['rrys', 'http://43.139.196.163:31308/gather/json'],
  ['88ys-http', 'http://cj.88ysapi.com/api.php/provide/vod'],
  ['88ys-https', 'https://cj.88ysapi.com/api.php/provide/vod'],
  ['modu', 'https://caiji.moduapi.cc/api.php/provide/vod'],
  ['kaazy', 'https://api.kaazyapi.com/api.php/provide/vod'],
];
const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const out = [];
async function testOne(name, base) {
  const url = base + '?ac=videolist&wd=' + encodeURIComponent('热') + '&pg=1';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    let ok = false, total = 0;
    try { const j = JSON.parse(text); ok = j.code === 1; total = j.total ?? 0; } catch { ok = false; }
    if (res.status === 200 && ok && total > 0) out.push('ALIVE ' + name + ' total=' + total + ' ' + base);
    else out.push('dead  ' + name + ' http=' + res.status + ' ok=' + ok + ' total=' + total);
  } catch (e) {
    out.push('dead  ' + name + ' ' + (e.name || 'err') + ' ' + String(e.message).slice(0, 30));
  }
}
(async () => {
  for (const [n, b] of candidates) await testOne(n, b);
  out.push('SCAN DONE ' + candidates.length);
  fs.writeFileSync('C:/LibreTV/scan-result.txt', out.join('\n'), 'utf8');
})();
