// 验证 4 个内置源的搜索 + 详情播放地址格式
const sources = [
  ['ffzy', 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8'],
  ['guangsu', 'https://api.guangsuapi.com/api.php/provide/vod'],
  ['360zy', 'https://360zy.com/api.php/provide/vod'],
  ['apibdzy', 'https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8'],
];
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile';
(async () => {
  for (const [name, base] of sources) {
    try {
      const s = await fetch(base.replace(/\/+$/, '') + '?ac=videolist&wd=' + encodeURIComponent('长津湖') + '&pg=1', { headers: { 'User-Agent': UA } }).then(r => r.json());
      const it = s.list && s.list[0];
      if (!it) { console.log(name + ': NO RESULT'); continue; }
      console.log(name + ': id=' + it.vod_id + ' name=' + it.vod_name);
      // 详情
      const d = await fetch(base.replace(/\/+$/, '') + '?ac=videolist&ids=' + encodeURIComponent(it.vod_id), { headers: { 'User-Agent': UA } }).then(r => r.json());
      const di = d.list && d.list[0];
      if (!di) { console.log(name + ': NO DETAIL'); continue; }
      const pu = di.vod_play_url || '';
      const first = pu.split('#')[0].split('$$$')[0];
      const urlPart = first.split('$')[1] || first;
      console.log(name + ': play_from=' + di.vod_play_from + ' url=' + String(urlPart).slice(0, 70) + (String(urlPart).startsWith('http') ? ' [HTTP OK]' : ' [NOT-URL!]'));
    } catch (e) {
      console.log(name + ': ERR ' + e.message.slice(0, 80));
    }
  }
})();
