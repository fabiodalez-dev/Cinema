// Small Jellyfin client for older webOS browsers. Never blocks the local Home.
const IMAGE_DB = 'cinema-media', IMAGE_STORE = 'images', MAX_IMAGES = 60, MAX_OBJECT_URLS = 90;
const DEVICE_KEY = 'launch-home.cinema.device.v1';

/**
 * One XHR as a promise with `.abort()`. `extra`: {method, body, authorization}
 * for POSTs and the Quick Connect headers; `blob` resolves with the Blob itself.
 */
export function request(url, token, blob, extra) {
  const options = extra || {};
  let xhr = null;
  const promise = new Promise(function (resolve, reject) {
    xhr = new XMLHttpRequest();
    xhr.open(options.method || 'GET', url, true);
    xhr.timeout = options.timeout || 5000;
    if (options.authorization) xhr.setRequestHeader('Authorization', options.authorization);
    else if (token) xhr.setRequestHeader('Authorization', 'MediaBrowser Token="' + token.replace(/["\r\n]/g, '') + '"');
    if (options.body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    if (blob) xhr.responseType = 'blob';
    xhr.onerror = xhr.ontimeout = function () { reject(new Error('Server non raggiungibile')); };
    xhr.onabort = function () { reject(new Error('Richiesta annullata')); };
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('Jellyfin: ' + xhr.status)); return; }
      try {
        if (!blob) { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {}); return; }
        if (xhr.response.size > 800000) { reject(new Error('Immagine troppo grande')); return; }
        resolve(xhr.response);
      } catch (err) { reject(err); }
    };
    xhr.send(options.body === undefined ? null : JSON.stringify(options.body));
  });
  promise.abort = function () { try { xhr.abort(); } catch (_) { /* already done */ } };
  return promise;
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
    episode: item.SeriesName ? item.Name : '', type: item.Type, seriesId: item.SeriesId || '',
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

/** "Continua a guardare": Resume first, then Next Up without a second entry per series. */
export function mergeContinue(resume, nextUp) {
  const out = (resume || []).slice();
  (nextUp || []).forEach(function (item) {
    const dup = out.some(function (n) { return n.id === item.id || (item.seriesId && n.seriesId === item.seriesId); });
    if (!dup) out.push(item);
  });
  return out;
}

/**
 * Artwork store: IndexedDB `cinema-media`/`images`, keyed `itemId:type:width`,
 * value {blob, at}. Without IndexedDB (desktop tests) it degrades to a Map.
 */
export function createImageStore(options) {
  const idb = options && 'indexedDB' in options ? options.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  const memory = new Map();
  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise(function (resolve) {
      if (!idb) { resolve(null); return; }
      try {
        const req = idb.open(IMAGE_DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(IMAGE_STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = req.onblocked = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
    return opening;
  }
  // `run(store)` returns a value or a function read once the transaction is complete.
  function tx(mode, run) {
    return open().then(function (db) {
      if (!db) throw new Error('no IndexedDB');
      return new Promise(function (resolve, reject) {
        const t = db.transaction(IMAGE_STORE, mode);
        const out = run(t.objectStore(IMAGE_STORE));
        t.oncomplete = function () { resolve(typeof out === 'function' ? out() : out && typeof out === 'object' && 'result' in out ? out.result : out); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('IndexedDB')); };
      });
    });
  }
  function pruneMemory(max) {
    const rows = Array.from(memory.entries()).sort(function (a, b) { return b[1].at - a[1].at; }).slice(max);
    rows.forEach(function (r) { memory.delete(r[0]); });
    return rows.length;
  }
  return {
    get: function (key) {
      if (memory.has(key)) return Promise.resolve(memory.get(key).blob);
      return tx('readonly', function (s) { return s.get(key); }).then(function (r) { return r && r.blob ? r.blob : null; }, function () { return null; });
    },
    put: function (key, blob) {
      const entry = {blob: blob, at: Date.now()};
      return tx('readwrite', function (s) { return s.put(entry, key); }).catch(function () { memory.set(key, entry); });
    },
    prune: function (max) {
      const limit = max || MAX_IMAGES;
      return tx('readwrite', function (s) {
        const rows = [];
        const cursor = s.openCursor();
        cursor.onsuccess = function () {
          const c = cursor.result;
          if (c) { rows.push({key: c.key, at: (c.value && c.value.at) || 0}); c.continue(); return; }
          rows.sort(function (a, b) { return b.at - a.at; }).splice(limit).forEach(function (r) { s.delete(r.key); });
        };
        return function () { return Math.max(0, rows.length - limit); };
      }).catch(function () { return pruneMemory(limit); });
    },
    memorySize: function () { return memory.size; }
  };
}
export const imageStore = createImageStore();

// Object URLs for the session, shared by every client; the oldest are revoked.
const objectUrls = new Map();
function objectUrl(key, blob) {
  if (objectUrls.has(key)) return objectUrls.get(key);
  const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
  objectUrls.set(key, url);
  if (objectUrls.size > MAX_OBJECT_URLS) {
    const oldest = objectUrls.keys().next().value;
    try { URL.revokeObjectURL(objectUrls.get(oldest)); } catch (_) { /* best effort */ }
    objectUrls.delete(oldest);
  }
  return url;
}

/** A random id for this TV, the only Quick Connect detail kept in localStorage. */
export function deviceId() {
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (_) { /* storage off */ }
  if (/^[a-z0-9]{16,}$/.test(id)) return id;
  id = '';
  while (id.length < 24) id += Math.random().toString(36).slice(2);
  id = id.slice(0, 24);
  try { localStorage.setItem(DEVICE_KEY, id); } catch (_) { /* fine, a new one next time */ }
  return id;
}

export function quickConnectAuthorization(device, version) {
  return 'MediaBrowser Client="Cinema", Device="LG TV", DeviceId="' + device + '", Version="' + String(version || '0').replace(/["\r\n]/g, '') + '"';
}

/**
 * Quick Connect: Initiate -> show the code -> poll Connect every `interval`
 * until Authenticated -> AuthenticateWithQuickConnect. Resolves
 * {server, userId, token, userName}; the promise has `.cancel()`.
 * options: {version, onCode(code), interval (3000), timeout (300000), deviceId}
 */
export function quickConnect(server, options) {
  const o = options || {};
  const base = String(server || '').trim().replace(/\/+$/, '');
  const auth = quickConnectAuthorization(o.deviceId || deviceId(), o.version);
  const interval = o.interval === undefined ? 3000 : o.interval, limit = o.timeout === undefined ? 300000 : o.timeout;
  let cancelled = false, timer = null, inflight = null, giveUp = null;
  function call(path, extra) { inflight = request(base + path, '', false, Object.assign({authorization: auth, timeout: 8000}, extra || {})); return inflight; }
  const promise = new Promise(function (resolve, reject) {
    if (!/^https?:\/\/[^\s]+$/.test(base)) { reject(new Error('Indirizzo del server non valido: usa http://indirizzo:8096')); return; }
    const started = Date.now();
    call('/QuickConnect/Initiate', {method: 'POST'}).catch(function (err) {
      // Initiate answers 401 when the feature is off on the server.
      if (/Jellyfin: 40[13]/.test(err.message)) throw new Error('Quick Connect è disattivato sul server: abilitalo in Dashboard → Generale');
      throw err;
    }).then(function (init) {
      if (cancelled) throw new Error('Richiesta annullata');
      if (!init || !init.Secret || !init.Code) throw new Error('Quick Connect non ha risposto come previsto');
      if (o.onCode) o.onCode(String(init.Code));
      return new Promise(function (ok, ko) {
        giveUp = ko;
        function poll() {
          if (cancelled) { ko(new Error('Richiesta annullata')); return; }
          if (Date.now() - started > limit) { ko(new Error('Tempo scaduto: nessuna conferma dal server Jellyfin')); return; }
          call('/QuickConnect/Connect?secret=' + encodeURIComponent(init.Secret)).then(function (state) {
            if (state && state.Authenticated) { ok(init.Secret); return; }
            timer = setTimeout(poll, interval);
          }, function (err) {
            if (/Jellyfin: 404/.test(err.message)) { ko(new Error('Codice scaduto: richiedine uno nuovo')); return; }
            if (/Jellyfin: 40[13]/.test(err.message) || cancelled) { ko(err); return; }
            timer = setTimeout(poll, interval); // a blip on the LAN: keep waiting
          });
        }
        poll();
      });
    }).then(function (secret) {
      return call('/Users/AuthenticateWithQuickConnect', {method: 'POST', body: {Secret: secret}});
    }).then(function (result) {
      const c = {server: base, userId: result && result.User && result.User.Id, token: result && result.AccessToken, userName: (result && result.User && result.User.Name) || ''};
      if (!validConnection(c)) throw new Error('Risposta di accesso incompleta');
      resolve(c);
    }).catch(reject);
  });
  promise.cancel = function () { cancelled = true; clearTimeout(timer); if (inflight && inflight.abort) inflight.abort(); if (giveUp) giveUp(new Error('Richiesta annullata')); };
  return promise;
}

export function createJellyfinClient(connection, options) {
  if (!validConnection(connection)) throw new Error('Collegamento Jellyfin non valido');
  const base = connection.server.replace(/\/+$/, '');
  const store = (options && options.store) || imageStore;
  const pending = new Map();
  function api(path) { return request(base + path, connection.token, false); }
  return {
    load: function (kind, query) {
      const user = encodeURIComponent(connection.userId);
      const common = 'Fields=Overview,Genres,ParentId&EnableImageTypes=Backdrop,Primary,Thumb&ImageTypeLimit=1&Limit=12';
      let path;
      if (kind === 'resume') path = '/Users/' + user + '/Items/Resume?MediaTypes=Video&' + common;
      else if (kind === 'nextup') path = '/Shows/NextUp?UserId=' + user + '&' + common;
      else {
        const type = kind === 'series' ? 'Series' : kind === 'movies' ? 'Movie' :
          kind === 'music' ? 'MusicAlbum' : query ? 'Movie,Series,MusicAlbum,Audio,MusicArtist' : 'Movie,Series';
        path = '/Users/' + user + '/Items?Recursive=true&IncludeItemTypes=' + type +
          '&SortBy=DateCreated&SortOrder=Descending&' + common;
        if (query) path += '&SearchTerm=' + encodeURIComponent(query);
      }
      return api(path).then(function (data) { return (data.Items || []).map(normalizeItem); });
    },
    /**
     * An object URL for the item's artwork at `width`: from memory, then the
     * store, then the server (stored for next time). Has `.abort()`.
     */
    image: function (item, width) {
      if (!/^[a-f0-9-]{32,36}$/i.test(item.imageId || '')) return Promise.resolve('');
      const key = item.imageId + ':' + item.imageType + ':' + width;
      if (objectUrls.has(key)) return Promise.resolve(objectUrls.get(key));
      if (pending.has(key)) return pending.get(key);
      let xhr = null, aborted = false;
      const promise = store.get(key).then(function (blob) {
        if (blob) return blob;
        if (aborted) throw new Error('Richiesta annullata');
        xhr = request(base + '/Items/' + encodeURIComponent(item.imageId) + '/Images/' + item.imageType +
          (item.imageType === 'Backdrop' ? '/0' : '') + '?MaxWidth=' + width + '&Quality=70&Format=jpg', connection.token, true);
        return xhr.then(function (fresh) { store.put(key, fresh).then(function () { return store.prune(MAX_IMAGES); }).catch(function () {}); return fresh; });
      }).then(function (blob) { pending.delete(key); return objectUrl(key, blob); }, function (err) { pending.delete(key); throw err; });
      promise.abort = function () { aborted = true; if (xhr) xhr.abort(); };
      pending.set(key, promise);
      return promise;
    }
  };
}
