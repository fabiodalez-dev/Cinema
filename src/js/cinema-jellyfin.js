// Small Jellyfin client for older webOS browsers. Never blocks the local Home.
export function request(url, token, blob) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    if (token) xhr.setRequestHeader('Authorization', 'MediaBrowser Token="' + token.replace(/["\r\n]/g, '') + '"');
    if (blob) xhr.responseType = 'blob';
    xhr.onerror = xhr.ontimeout = function () { reject(new Error('Server non raggiungibile')); };
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('Jellyfin: ' + xhr.status)); return; }
      try {
        if (!blob) { resolve(JSON.parse(xhr.responseText)); return; }
        if (xhr.response.size > 800000) { reject(new Error('Immagine troppo grande')); return; }
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('Immagine non leggibile')); };
        reader.readAsDataURL(xhr.response);
      } catch (err) { reject(err); }
    };
    xhr.send();
  });
}

export function validConnection(c) {
  return !!(c && /^https?:\/\/[^\s]+$/.test(c.server || '') &&
    /^[a-f0-9-]{32,36}$/i.test(c.userId || '') && typeof c.token === 'string' && c.token.length > 8);
}

export function normalizeItem(item) {
  const duration = Number(item.RunTimeTicks) || 0;
  const position = Number(item.UserData && item.UserData.PlaybackPositionTicks) || 0;
  let imageId = item.Id;
  let imageType = 'Primary';
  if (item.BackdropImageTags && item.BackdropImageTags.length) imageType = 'Backdrop';
  else if (item.ParentBackdropItemId) { imageId = item.ParentBackdropItemId; imageType = 'Backdrop'; }
  else if (item.ImageTags && item.ImageTags.Thumb) imageType = 'Thumb';
  return {
    id: item.Id, title: item.SeriesName || item.Name || 'Senza titolo',
    episode: item.SeriesName ? item.Name : '', type: item.Type,
    year: item.ProductionYear || '', overview: String(item.Overview || '').replace(/<[^>]*>/g, '').slice(0, 650),
    genres: (item.Genres || []).slice(0, 2), rating: item.OfficialRating || '',
    artist: item.AlbumArtist || (item.Artists || []).join(', '),
    isMusic: item.Type === 'MusicAlbum' || item.Type === 'Audio' || item.Type === 'MusicArtist',
    minutes: Math.round(duration / 600000000),
    progress: duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0,
    remaining: duration > position ? Math.ceil((duration - position) / 600000000) : 0,
    season: item.ParentIndexNumber, episodeNumber: item.IndexNumber,
    imageId: imageId, imageType: imageType,
    image: '', backdrop: ''
  };
}

export function createJellyfinClient(connection) {
  if (!validConnection(connection)) throw new Error('Collegamento Jellyfin non valido');
  const base = connection.server.replace(/\/+$/, '');
  function api(path) { return request(base + path, connection.token, false); }
  return {
    load: function (kind, query) {
      const user = encodeURIComponent(connection.userId);
      const common = 'Fields=Overview,Genres,ParentId&EnableImageTypes=Backdrop,Primary,Thumb&ImageTypeLimit=1&Limit=12';
      let path;
      if (kind === 'resume') path = '/Users/' + user + '/Items/Resume?MediaTypes=Video&' + common;
      else {
        const type = kind === 'series' ? 'Series' : kind === 'movies' ? 'Movie' :
          kind === 'music' ? 'MusicAlbum' : query ? 'Movie,Series,MusicAlbum,Audio,MusicArtist' : 'Movie,Series';
        path = '/Users/' + user + '/Items?Recursive=true&IncludeItemTypes=' + type +
          '&SortBy=DateCreated&SortOrder=Descending&' + common;
        if (query) path += '&SearchTerm=' + encodeURIComponent(query);
      }
      return api(path).then(function (data) { return (data.Items || []).map(normalizeItem); });
    },
    image: function (item, width) {
      if (!/^[a-f0-9-]{32,36}$/i.test(item.imageId || '')) return Promise.resolve('');
      return request(base + '/Items/' + encodeURIComponent(item.imageId) + '/Images/' + item.imageType +
        (item.imageType === 'Backdrop' ? '/0' : '') + '?MaxWidth=' + width + '&Quality=75&Format=jpg', connection.token, true);
    }
  };
}
