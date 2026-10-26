// 逐个验证详情播放地址（带超时）
const sources = [
  ['ffzy', 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8'],
  ['guangsu', 'https://api.guangsuapi.com/api.php/provide/vod'],
  ['360zy', 'https://360zy.com/api.php/provide/vod'],
];
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile';
const fetchT = async (u, ms = 12000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(u, { headers: { 'User-Agent': UA }, signal: c.signal }); }
  finally { clearTimeout(t); }
};
(async () => {
  for (const [name, base] of sources) {
    try {
      const s = await fetchT(base.replace(/\/+$/, '') + '?ac=videolist&wd=' + encodeURIComponent('长津湖') + '&pg=1').then(r => r.json());
      const it = s.list && s.list[0];
      if (!it) { console.log(name + ': NO RESULT'); continue; }
      const d = await fetchT(base.replace(/\/+$/, '') + '?ac=videolist&ids=' + encodeURIComponent(it.vod_id)).then(r => r.json());
      const di = d.list && d.list[0];
      if (!di) { console.log(name + ': NO DETAIL'); continue; }
      const pu = di.vod_play_url || '';
      const first = pu.split('#')[0].split('$$$')[0];
      const urlPart = first.split('$')[1] || first;
      console.log(name + ': from=' + di.vod_play_from + ' url=' + String(urlPart).slice(0, 80) + (String(urlPart).startsWith('http') ? ' [HTTP OK]' : ' [NOT-URL!]'));
    } catch (e) {
      console.log(name + ': ERR ' + (e.name || '') + ' ' + String(e.message).slice(0, 60));
    }
  }
})();
