const sources = [
  { key: 'ffm3u8', name: '非凡资源', url: 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8' },
  { key: 'lzm3u8', name: '量子资源', url: 'https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8' },
  { key: 'bfm3u8', name: '暴风资源', url: 'https://cj.bfzyapi.com/api.php/provide/vod/from/bfm3u8' },
  { key: 'gsm3u8', name: '光速资源', url: 'https://cj.gsuapi.com/api.php/provide/vod/from/gsm3u8' },
  { key: 'slm3u8', name: '顺连资源', url: 'https://cj.slapi.com/api.php/provide/vod/from/slm3u8' },
  { key: 'kkm3u8', name: '快看资源', url: 'https://cj.kuaikanapi.com/api.php/provide/vod/from/kkzy' },
  { key: 'hnm3u8', name: '红牛资源', url: 'https://cj.hnzyapi.com/api.php/provide/vod/from/hnm3u8' },
  { key: 'tkm3u8', name: '天空资源', url: 'https://cj.tiankongapi.com/api.php/provide/vod' },
  { key: 'wlm3u8', name: '卧龙资源', url: 'https://cj.wolongapi.com/api.php/provide/vod' },
  { key: 'xmm3u8', name: '小米资源', url: 'https://cj.xmzyapi.com/api.php/provide/vod' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function probe(s) {
  const api = `${s.url.replace(/\/+$/, '')}?ac=videolist&wd=${encodeURIComponent('庆余年')}&pg=1`;
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(api, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) return `${s.name}: HTTP ${res.status} (${ms}ms)`;
    const data = await res.json();
    const n = Array.isArray(data.list) ? data.list.length : -1;
    return `${s.name}: OK ${res.status}, list=${n} (${ms}ms)`;
  } catch (e) {
    return `${s.name}: FAIL ${e.name}:${e.message.slice(0, 60)} (${Date.now() - t0}ms)`;
  }
}

const results = await Promise.all(sources.map(probe));
for (const r of results) console.log(r);
