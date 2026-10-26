console.log('start');
const UA = 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile';
const c = new AbortController();
const t = setTimeout(() => c.abort(), 15000);
fetch('https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&wd=' + encodeURIComponent('长津湖') + '&pg=1', { headers: { 'User-Agent': UA }, signal: c.signal })
  .then(r => { console.log('status ' + r.status); return r.json(); })
  .then(j => { console.log('total ' + j.total); if (j.list && j.list[0]) { const it = j.list[0]; console.log('id ' + it.vod_id + ' name ' + it.vod_name); return fetch('https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&ids=' + it.vod_id, { headers: { 'User-Agent': UA } }).then(r => r.json()); } })
  .then(d => { const di = d.list && d.list[0]; if (!di) { console.log('no detail'); return; } const first = (di.vod_play_url || '').split('#')[0].split('$$$')[0]; console.log('from=' + di.vod_play_from + ' url=' + String(first).slice(0, 90)); })
  .catch(e => console.log('ERR ' + (e.name || '') + ' ' + String(e.message).slice(0, 80)))
  .finally(() => clearTimeout(t));
