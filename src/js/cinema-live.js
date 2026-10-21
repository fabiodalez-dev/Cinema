// webOS' native broadcast/external-input media services, one pipeline at a time.
// https://www.webosbrew.org/develop/guides/web-app/#inputtv-embedding
export function liveSource(id) {
  if (/^(TV|LIVE_TV|TUNER)$/.test(id)) return {src: 'tv://', type: 'service/webos-broadcast'};
  const hdmi = /^HDMI_([1-4])$/.exec(id || '');
  if (hdmi) return {src: 'ext://hdmi:' + hdmi[1], type: 'service/webos-external'};
  const av = /^(AV|COMP)_([1-2])$/.exec(id || '');
  if (av && (av[1] !== 'COMP' || av[2] === '1')) {
    return {src: 'ext://' + (av[1] === 'AV' ? 'av' : 'comp') + ':' + av[2], type: 'service/webos-external'};
  }
  return null;
}

export function liveDevices(devices, labels) {
  const result = [{id: 'TV', label: (labels || {}).TV || 'Live TV', appId: 'com.webos.app.livetv'}];
  (devices || []).forEach(function (device) {
    if (!device || !device.id || /^(TV|LIVE_TV|TUNER)$/.test(device.id) || result.some(function (d) {return d.id === device.id;})) return;
    result.push(Object.assign({}, device, {label: (labels || {})[device.id] || device.label || device.id.replace(/_/g, ' ')}));
  });
  return result;
}

export function createLivePreview(root, options) {
  let video = null, timer = null, generation = 0;
  function stop() {
    generation++;
    clearTimeout(timer); timer = null;
    if (!video) return;
    const old = video; video = null;
    old.onloadeddata = old.onerror = null;
    try { old.pause(); } catch (_) { /* media may already be gone */ }
    old.removeAttribute('src');
    while (old.firstChild) old.removeChild(old.firstChild);
    try { old.load(); } catch (_) { /* release hardware source */ }
    old.remove();
  }
  function start(id) {
    const source = liveSource(id);
    stop();
    if (!source) { options.onStatus('Questa fonte si apre a schermo intero.', 'unsupported'); return false; }
    if (!options.supported) { options.onStatus('Anteprima disponibile sulla TV.', 'desktop'); return true; }
    const mark = generation;
    const next = document.createElement('video'); video = next;
    next.id = 'cinema-live-video'; next.autoplay = true; next.setAttribute('playsinline', '');
    next.setAttribute('aria-hidden', 'true');
    const media = document.createElement('source'); media.type = source.type; media.src = source.src;
    next.appendChild(media); root.insertBefore(next, root.firstChild);
    options.onStatus('Apertura della fonte…', 'loading');
    function update(text, state) {
      if (mark !== generation || video !== next) return;
      clearTimeout(timer); timer = null; options.onStatus(text, state);
    }
    next.onloadeddata = function () { update('In diretta', 'playing'); };
    next.onerror = function () { update('Video non disponibile. Prova a schermo intero o scegli un’altra fonte.', 'error'); };
    timer = setTimeout(function () {
      update(next.readyState >= 2 ? 'In diretta' : 'In attesa del segnale. Puoi scegliere un’altra fonte.', next.readyState >= 2 ? 'playing' : 'waiting');
    }, 8000);
    try {
      const playing = next.play();
      if (playing && playing.catch) playing.catch(function () {
        update('Premi Riprova oppure apri la fonte a schermo intero.', 'error');
      });
    } catch (_) { next.onerror(); }
    return true;
  }
  return {start: start, stop: stop};
}
