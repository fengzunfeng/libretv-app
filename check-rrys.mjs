fetch('http://43.139.196.163:31308/gather/json?wd=' + encodeURIComponent('长津湖'))
  .then(r => r.json())
  .then(j => {
    console.log('code=' + j.code + ' total=' + j.total);
    const it = j.list && j.list[0];
    if (it) {
      console.log('keys: ' + Object.keys(it).join(','));
      console.log('name=' + it.vod_name + ' id=' + it.vod_id + ' from=' + it.vod_play_from + ' hasplay=' + (!!it.vod_play_url));
      console.log('playurl head: ' + String(it.vod_play_url || '').slice(0, 80));
    }
  })
  .catch(e => console.log('ERR ' + e.message));
