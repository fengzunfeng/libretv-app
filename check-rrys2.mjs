fetch('http://43.139.196.163:31308/gather/json?ac=videolist&ids=30343')
  .then(r => r.json())
  .then(j => {
    const it = j.list && j.list[0];
    if (it) {
      console.log('play_from: ' + it.vod_play_from);
      console.log('play_url full: ' + it.vod_play_url);
      console.log('first url entry: ' + it.vod_play_url.split('#')[0]);
    } else {
      console.log('no detail, total=' + j.total);
    }
  })
  .catch(e => console.log('ERR ' + e.message));
