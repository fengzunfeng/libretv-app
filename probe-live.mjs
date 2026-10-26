// 逐个验证内置点播源当前可用性（node 直连，模拟浏览器 fetch）
const names = ['ffzy非凡', 'lziapi量子', 'guangsu光速', 'wujin无尽', '360zy', 'apibdzy百度'];
const urls = [
  'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
  'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
  'https://api.guangsuapi.com/api.php/provide/vod?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
  'https://api.wujinapi.com/api.php/provide/vod?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
  'https://360zy.com/api.php/provide/vod?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
  'https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8?ac=videolist&wd=' + encodeURIComponent('热门') + '&pg=1',
];
const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
(async () => {
  for (let i = 0; i < urls.length; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(urls[i], { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      let ok = false, total = 0;
      try { const j = JSON.parse(text); ok = j.code === 1; total = j.total ?? 0; } catch { ok = /"list"/.test(text); }
      console.log(`${names[i]}: HTTP ${res.status} code=${ok} total=${total} len=${text.length}`);
    } catch (e) {
      console.log(`${names[i]}: FAIL ${e.name}: ${e.message}`);
    }
  }
})();
