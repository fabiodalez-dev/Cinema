// Settings -> TV: memory, apps LG keeps loaded, advertising settings and LG's
// background services, applied as root by scripts/tvtools.py. Everything shown
// is read from the TV first, so a TV without a setting, a service or Python
// simply does not list it. Every switch can be put back, and "LG's settings"
// gives everything back at once.
import {decorateSettings} from './settings-design.js';

const CINEMA_ID = 'org.webosbrew.lounge.launcher';
const BLOOMEE_ID = 'org.bloomee.webos';

// LG settings the daemon can keep off, in the order shown.
export const TV_SETTINGS = [
  {key: 'adCookie', label: 'ID pubblicitario', hint: 'L’identificativo che LG usa per la pubblicità mirata.'},
  {key: 'livePlus', label: 'Live Plus (riconoscimento dei contenuti)', hint: 'Riconosce cosa guardi, anche dagli ingressi HDMI.'},
  {key: 'homePromotion', label: 'Promozioni nella Home LG', hint: ''},
  {key: 'livePromotion', label: 'Promozioni nella Live TV', hint: ''},
  {key: 'sportsAlarm', label: 'Avvisi sportivi', hint: ''},
  {key: 'channelplus', label: 'LG Channels', hint: 'I canali in streaming di LG nella lista dei canali.'}
];

// LG's data agreement flags (eulaStatus), as LG's own menu names them.
export const CONSENT_LABELS = {
  customAdAllowed: 'Pubblicità personalizzata',
  customadsAllowed: 'Pubblicità personalizzata negli annunci',
  cookiesAllowed: 'Cookie pubblicitari',
  acrAdAllowed: 'Pubblicità basata su ciò che guardi',
  acrAllowed: 'Riconoscimento dei contenuti (ACR)',
  acrOnAllowed: 'Riconoscimento dei contenuti (ACR)',
  acrGdprAllowed: 'Riconoscimento dei contenuti (ACR, GDPR)',
  voiceAllowed: 'Riconoscimento vocale',
  voice2Allowed: 'Dati vocali',
  additionalDataAllowed: 'Dati aggiuntivi sull’utilizzo',
  remoteDiagAllowed: 'Diagnostica remota',
  thirdPartySharingAllowed: 'Condivisione con terze parti',
  marketingOnAllowed: 'Comunicazioni di marketing',
  shoppingOnAllowed: 'Shopping in TV',
  takeOnAllowed: 'Servizi aggiuntivi LG'
};

function consentLabel(key) {
  if (CONSENT_LABELS[key]) return CONSENT_LABELS[key];
  const m = /^additional(\d+)Allowed$/.exec(key);
  return m ? 'Accordo aggiuntivo ' + m[1] : key;
}

export const TV_SERVICES = [
  {id: 'contentminer', label: 'Analisi dei contenuti (ACR)'},
  {id: 'remotelogger', label: 'Invio dei log a LG'},
  {id: 'uploadd', label: 'Invio della diagnostica a LG'},
  {id: 'rdxd', label: 'Diagnostica remota'},
  {id: 'nudge', label: 'Suggerimenti e promozioni LG'},
  {id: 'com.webos.service.mycar', label: 'Servizio auto connessa'},
  {id: 'com.webos.service.camera', label: 'Webcam USB'}
];

export const REMOTE_KEY_LABELS = {
  netflix: 'Tasto Netflix', amazon: 'Tasto Prime Video', disneyplus: 'Tasto Disney+', lgchannels: 'Tasto LG Channels',
  rakutentv: 'Tasto Rakuten TV', red: 'Tasto rosso', green: 'Tasto verde', yellow: 'Tasto giallo', blue: 'Tasto blu',
  guide: 'Tasto Guida', info: 'Tasto Info', input: 'Tasto Ingressi', livetv: 'Tasto TV', search: 'Tasto Cerca', help: 'Tasto ?'
};
const KEEP_LG = '__lg';

// Settings -> TV -> Luci LED: the room light the strip keeps with the TV off
// (scripts/ambilight.py AMBIENT, same names and colours).
export const LED_AMBIENT = [
  {value: 'warm', label: 'Bianco caldo', rgb: [255, 120, 30]},
  {value: 'white', label: 'Bianco', rgb: [255, 255, 255]},
  {value: 'orange', label: 'Arancione', rgb: [255, 70, 0]},
  {value: 'red', label: 'Rosso', rgb: [255, 0, 0]},
  {value: 'pink', label: 'Rosa', rgb: [255, 30, 110]},
  {value: 'purple', label: 'Viola', rgb: [140, 0, 255]},
  {value: 'blue', label: 'Blu', rgb: [0, 40, 255]},
  {value: 'sky', label: 'Azzurro', rgb: [0, 170, 255]},
  {value: 'green', label: 'Verde', rgb: [0, 255, 40]},
  {value: 'off', label: 'Spenta', rgb: [0, 0, 0]},
  {value: 'keep', label: 'Lascia l’ultimo colore', rgb: null}
];
export const LED_DEFAULT = {address: null, name: '', follow: false, brightness: 100, ambient: 'warm', ambientBrightness: 60};

/** The colour Prova shows: the room light at its brightness, null for "keep". */
export function ambientRgb(ambient, brightness) {
  const entry = LED_AMBIENT.find(function (a) { return a.value === ambient; });
  if (!entry || !entry.rgb) return null;
  return entry.rgb.map(function (c) { return Math.round(c * brightness / 100); });
}

/** The ledStrip configuration from the LED controls (null: not shown). */
export function ledDraft(stored, led) {
  const base = Object.assign({}, LED_DEFAULT, stored || {});
  if (!led) return base;
  const address = led.strip.value || null;
  const option = led.strip.selectedOptions && led.strip.selectedOptions[0];
  return {
    address: address,
    name: address ? ((option && option.dataset.name) || (address === base.address ? base.name : '')) : '',
    follow: !!address && !!led.follow.checked,
    brightness: parseInt(led.brightness.value, 10) || 100,
    ambient: led.ambient.value,
    ambientBrightness: parseInt(led.ambientBrightness.value, 10) || 60
  };
}

/** What a key can open: Cinema and Bloomee first, then the inputs, then the other apps. */
export function keyTargets(status) {
  const apps = status.apps || {};
  const first = [{value: CINEMA_ID, label: 'Cinema'}];
  if (apps[BLOOMEE_ID]) first.push({value: BLOOMEE_ID, label: 'Bloomee'});
  const inputs = [];
  for (let i = 1; i <= 4; i += 1) {
    if (apps['com.webos.app.hdmi' + i]) inputs.push({value: 'com.webos.app.hdmi' + i, label: 'HDMI ' + i});
  }
  if (apps['com.webos.app.livetv']) inputs.push({value: 'com.webos.app.livetv', label: 'Live TV'});
  const others = Object.keys(apps).filter(function (id) {
    return id !== CINEMA_ID && id !== BLOOMEE_ID && !/^com\.webos\.app\.(hdmi\d|livetv)/.test(id) &&
      !/^com\.(webos|palm|lge)\./.test(id) && !/\.service$/.test(id);
  }).map(function (id) { return {value: id, label: apps[id]}; })
    .sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
  return first.concat(inputs, others);
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls || '';
  if (text) n.textContent = text;
  return n;
}

/**
 * The configuration to store from the switches. Apps or settings not shown
 * (not installed, not on this TV) keep what the stored configuration says.
 */
export function tvToolsDraft(status, controls) {
  const conf = status.conf || {};
  const shownPreload = Object.keys(controls.preload);
  const preloadOff = (conf.preloadOff || []).filter(function (id) { return shownPreload.indexOf(id) < 0; });
  shownPreload.forEach(function (id) { if (!controls.preload[id].checked) preloadOff.push(id); });
  const shownSettings = Object.keys(controls.settings);
  const settingsOff = (conf.settingsOff || []).filter(function (k) { return shownSettings.indexOf(k) < 0; });
  shownSettings.forEach(function (k) { if (controls.settings[k].checked) settingsOff.push(k); });
  const shownServices = Object.keys(controls.services);
  const servicesOff = (conf.servicesOff || []).filter(function (s) { return shownServices.indexOf(s) < 0; });
  shownServices.forEach(function (s) { if (controls.services[s].checked) servicesOff.push(s); });
  let keepInMemory = conf.keepInMemory || [];
  if (controls.memory && controls.memory.checked !== keepInMemory.length > 0) {
    keepInMemory = controls.memory.checked
      ? [CINEMA_ID].concat(status.installed && status.installed[BLOOMEE_ID] ? [BLOOMEE_ID] : [])
      : [];
  }
  let remoteKeys = Object.assign({}, conf.remoteKeys || {});
  Object.keys(controls.keys || {}).forEach(function (k) {
    const v = controls.keys[k].value;
    if (v === KEEP_LG) delete remoteKeys[k];
    else remoteKeys[k] = v;
  });
  let powerOffAt = conf.powerOffAt || null;
  if (controls.powerOffAt) powerOffAt = controls.powerOffAt.value || null;
  const cinemaFirst = controls.cinemaFirst ? !!controls.cinemaFirst.checked : conf.cinemaFirst === true;
  const ledStrip = ledDraft(conf.ledStrip, controls.led);
  return {preloadOff: preloadOff, settingsOff: settingsOff, servicesOff: servicesOff, keepInMemory: keepInMemory,
    remoteKeys: remoteKeys, powerOffAt: powerOffAt, cinemaFirst: cinemaFirst, ledStrip: ledStrip};
}

/** Every half hour of the day, as HH:MM. */
export function powerOffTimes() {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  }
  return out;
}

function normalized(conf) {
  function sorted(list) { return (list || []).slice().sort(); }
  const keys = {};
  Object.keys(conf.remoteKeys || {}).sort().forEach(function (k) { keys[k] = conf.remoteKeys[k]; });
  return {preloadOff: sorted(conf.preloadOff), settingsOff: sorted(conf.settingsOff),
    servicesOff: sorted(conf.servicesOff), keepInMemory: sorted(conf.keepInMemory), remoteKeys: keys,
    powerOffAt: conf.powerOffAt || null, cinemaFirst: conf.cinemaFirst === true,
    ledStrip: Object.assign({}, LED_DEFAULT, conf.ledStrip || {})};
}

/** The apps to list: installed, not essential, and loaded by LG (or switched off here). */
export function preloadRows(status) {
  const off = (status.conf && status.conf.preloadOff) || [];
  return (status.preload || []).filter(function (e) {
    return e.installed && !e.essential && (e.lgEnabled || off.indexOf(e.id) >= 0);
  }).sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
}

/**
 * Mount the TV pane. api: {status(): Promise<status|null>, apply(conf): Promise,
 * toast(text)}.
 */
/**
 * Aggiornamenti: Cinema and Bloomee from their GitHub releases. api:
 * {check(): Promise<{id: {name, installed, latest, update, error}}|null>,
 *  install(id): Promise, progress(): Promise<{state, app, version, error}|null>}
 */
export function mountUpdates(container, api, nextFocus) {
  const section = node('section', 'settings-section tv-updates');
  section.appendChild(node('h3', '', 'Aggiornamenti'));
  const list = node('div', 'tv-updates-list');
  section.appendChild(list);
  section.appendChild(node('p', 'settings-hint', 'Dalle release ufficiali su GitHub. Il pacchetto viene installato solo se la sua impronta SHA-256 corrisponde a quella pubblicata. Aggiornando Cinema, Cinema si chiude e si riapre da sola.'));
  container.appendChild(section);
  list.appendChild(node('p', 'settings-hint', 'Controllo delle versioni…'));

  function row(id, info) {
    const r = node('div', 'settings-row');
    const text = node('span', '', '');
    const name = info.name + (info.installed ? ' ' + info.installed : '');
    let detail = '';
    if (info.error) detail = ' · controllo non riuscito';
    else if (!info.installed && info.latest) detail = ' · non installata, ultima ' + info.latest;
    else if (info.update) detail = ' · disponibile ' + info.latest;
    else if (info.latest) detail = ' · aggiornata';
    text.textContent = name + detail;
    r.appendChild(text);
    if (info.update && !info.error) {
      const b = node('button', 'settings-button focusable', info.installed ? 'Aggiorna' : 'Installa');
      b.type = 'button';
      b.dataset.focusIndex = String(nextFocus());
      b.addEventListener('click', function () { start(id, info, b, text); });
      r.appendChild(b);
    }
    return r;
  }

  async function start(id, info, button, text) {
    button.disabled = true;
    text.textContent = info.name + ' · avvio…';
    try {
      await api.install(id);
    } catch (err) {
      text.textContent = info.name + ' · non riuscito';
      button.disabled = false;
      return;
    }
    const labels = {checking: 'controllo', downloading: 'scaricamento', installing: 'installazione'};
    for (let i = 0; i < 120; i += 1) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      let p = null;
      try { p = await api.progress(); } catch (err) { /* Cinema itself may be closing */ }
      if (!p || p.app !== id) continue;
      if (p.state === 'installed') {
        text.textContent = info.name + ' ' + p.version + ' · installata';
        button.remove();
        return;
      }
      if (p.state === 'failed') {
        text.textContent = info.name + ' · non riuscito: ' + (p.error || '');
        button.disabled = false;
        return;
      }
      if (p.state === 'rolled_back') {
        text.textContent = info.name + ' · aggiornamento non riuscito, versione precedente ripristinata' + (p.error ? ': ' + p.error : '');
        button.disabled = false;
        return;
      }
      text.textContent = info.name + ' · ' + (labels[p.state] || p.state) + (p.version ? ' ' + p.version : '') + '…';
    }
    // Four minutes without a final state: say so instead of "avvio…" for good.
    text.textContent = info.name + ' · nessun esito dopo 4 minuti: riapri Impostazioni → TV più tardi';
    button.disabled = false;
  }

  api.check().then(function (result) {
    list.textContent = '';
    if (!result) {
      list.appendChild(node('p', 'settings-hint', 'Richiede root (Homebrew Channel) e Python sulla TV.'));
      return;
    }
    Object.keys(result).forEach(function (id) { list.appendChild(row(id, result[id])); });
    decorateSettings(container.closest('.settings-panel') || container);
  }).catch(function () {
    list.textContent = '';
    list.appendChild(node('p', 'settings-hint', 'GitHub non ha risposto. Riprova più tardi.'));
  });
}

export function mountTvToolsSettings(panel, api) {
  const pane = panel.querySelector('.settings-tab-pane[data-tab="tv"]');
  if (!pane || pane.querySelector('.tv-tools-settings')) return;
  if (api.updates) {
    let updateFocus = 1180;
    mountUpdates(pane, api.updates, function () { return updateFocus++; });
  }
  const root = node('div', 'tv-tools-settings');
  pane.appendChild(root);
  let focusIndex = 1200;
  const message = node('p', 'settings-hint', 'Lettura delle impostazioni della TV…');
  root.appendChild(message);

  function toggle(section, label, checked, hint) {
    const row = node('div', 'settings-row');
    const text = node('span', '', label);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'focusable';
    input.checked = !!checked;
    input.dataset.focusIndex = String(focusIndex++);
    input.setAttribute('aria-label', label);
    input.setAttribute('role', 'switch');
    row.appendChild(text);
    row.appendChild(input);
    section.appendChild(row);
    if (hint) section.appendChild(node('p', 'settings-hint', hint));
    return input;
  }
  function section(title, hint) {
    const s = node('section', 'settings-section');
    s.appendChild(node('h3', '', title));
    if (hint) s.appendChild(node('p', 'settings-hint', hint));
    root.appendChild(s);
    return s;
  }
  function select(sectionNode, label, options, value) {
    const row = node('div', 'settings-row');
    row.appendChild(node('span', '', label));
    const sel = document.createElement('select');
    sel.className = 'focusable';
    sel.dataset.focusIndex = String(focusIndex++);
    sel.setAttribute('aria-label', label);
    options.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = value;
    row.appendChild(sel);
    sectionNode.appendChild(row);
    return sel;
  }
  function button(label, handler) {
    const b = node('button', 'settings-button focusable', label);
    b.type = 'button';
    b.dataset.focusIndex = String(focusIndex++);
    b.addEventListener('click', handler);
    return b;
  }

  function percentOptions(from) {
    const out = [];
    for (let p = 100; p >= from; p -= 10) out.push({value: String(p), label: p + '%'});
    return out;
  }

  // Luci LED: the strip behind the TV (scripts/ambilight.py). The strip list
  // starts with the saved one; Cerca adds the ones in range.
  function ledSection(led) {
    const sec = section('Luci LED dietro la TV', 'Una striscia LED Bluetooth (quelle dell’app Lotus Lantern, che si chiamano ELK-BLEDOM o simili) segue i colori del film. Quando spegni la TV con il telecomando, o si spegne solo lo schermo, la striscia passa alla luce d’ambiente scelta qui e la tiene. Mentre la TV è accesa la striscia è collegata alla TV: l’app del telefono la raggiunge con la TV spenta.');
    const strip = select(sec, 'Striscia', [{value: '', label: 'Nessuna'}], '');
    function addStrip(address, name, rssi) {
      if (!address) return;
      const existing = Array.prototype.find.call(strip.options, function (o) { return o.value === address; });
      const label = (name || 'Striscia LED') + ' · ' + address.toUpperCase() + (rssi != null ? ' · segnale ' + rssi + ' dBm' : '');
      if (existing) {
        existing.textContent = label;
        if (name) existing.dataset.name = name;
        return;
      }
      const o = document.createElement('option');
      o.value = address;
      o.textContent = label;
      o.dataset.name = name || '';
      strip.appendChild(o);
    }
    if (led.address) addStrip(led.address, led.name);
    strip.value = led.address || '';
    const found = node('p', 'settings-hint', led.address ? '' : 'Premi Cerca con la striscia accesa e l’app del telefono chiusa.');
    const scanRow = node('div', 'settings-row');
    scanRow.appendChild(node('span', '', 'Strisce nelle vicinanze'));
    const scanButton = button('Cerca', async function () {
      scanButton.disabled = true;
      found.textContent = 'Ricerca in corso, circa 10 secondi…';
      try {
        const list = await api.ledScan();
        list.forEach(function (d) { addStrip(d.address, d.name, d.rssi); });
        if (list.length && !strip.value) strip.value = list[0].address;
        found.textContent = list.length
          ? 'Trovate: ' + list.length + '. Scegli la striscia, poi Salva.'
          : 'Nessuna striscia trovata. Controlla che sia accesa e che il telefono non sia collegato.';
      } catch (err) {
        found.textContent = 'Ricerca non riuscita: ' + (err && err.message ? err.message : err);
      } finally {
        scanButton.disabled = false;
      }
    });
    scanRow.appendChild(scanButton);
    sec.appendChild(scanRow);
    sec.appendChild(found);
    const follow = toggle(sec, 'I LED seguono i colori dello schermo', led.follow,
      'Circa dieci colori al secondo, presi da tutta l’immagine: le bande nere sono ignorate.');
    const brightness = select(sec, 'Luminosità mentre guardi', percentOptions(10), String(led.brightness));
    const ambient = select(sec, 'Luce d’ambiente a TV spenta', LED_AMBIENT, led.ambient);
    const ambientBrightness = select(sec, 'Luminosità della luce d’ambiente', percentOptions(10), String(led.ambientBrightness));
    const tryRow = node('div', 'settings-row');
    tryRow.appendChild(node('span', '', 'Prova la luce d’ambiente'));
    const tried = node('p', 'settings-hint', '');
    const tryButton = button('Prova', async function () {
      const rgb = ambientRgb(ambient.value, parseInt(ambientBrightness.value, 10) || 60);
      if (!strip.value) { tried.textContent = 'Scegli prima una striscia.'; return; }
      if (!rgb) { tried.textContent = 'Con “Lascia l’ultimo colore” la striscia resta com’è.'; return; }
      tryButton.disabled = true;
      tried.textContent = 'Collegamento alla striscia…';
      try {
        await api.ledPreview(strip.value, rgb);
        tried.textContent = follow.checked
          ? 'Colore inviato: resta per qualche secondo.'
          : 'Colore inviato: resta acceso. Il Bluetooth della TV si riavvia per lasciare la striscia all’app del telefono.';
      } catch (err) {
        tried.textContent = 'Non riuscito: ' + (err && err.message ? err.message : err);
      } finally {
        tryButton.disabled = false;
      }
    });
    tryRow.appendChild(tryButton);
    sec.appendChild(tryRow);
    sec.appendChild(tried);
    return {strip: strip, follow: follow, brightness: brightness, ambient: ambient, ambientBrightness: ambientBrightness};
  }

  function render(status) {
    root.textContent = '';
    focusIndex = 1200;
    if (!status) {
      root.appendChild(node('p', 'settings-hint',
        'Queste funzioni richiedono una TV con root (Homebrew Channel) e Python. Su questa TV non sono disponibili.'));
      decorateSettings(panel);
      return;
    }
    const conf = status.conf || {};
    const controls = {preload: {}, settings: {}, services: {}, memory: null, keys: {}, consent: {}, powerOffAt: null, cinemaFirst: null, led: null};

    if (status.memorySupported) {
      const mem = section('Memoria', 'Con poca memoria webOS chiude le app aperte quando ne apri un’altra. Così Cinema riparte da zero a ogni tasto Home e la musica di Bloomee si ferma.');
      controls.memory = toggle(mem, status.installed && status.installed[BLOOMEE_ID] ? 'Tieni aperte Cinema e Bloomee' : 'Tieni aperta Cinema',
        (conf.keepInMemory || []).length > 0, 'Vale dal prossimo riavvio della TV.');
    }

    const off = section('Spegnimento programmato', 'Ogni giorno all’orario scelto la TV si spegne come con il tasto di accensione, se è accesa. Un minuto prima compare un avviso. Comodo se la presa della TV ha un timer: così la corrente va via con la TV già spenta.');
    const offRow = node('div', 'settings-row');
    offRow.appendChild(node('span', '', 'Spegni la TV ogni giorno alle'));
    const offSelect = document.createElement('select');
    offSelect.className = 'focusable';
    offSelect.dataset.focusIndex = String(focusIndex++);
    offSelect.setAttribute('aria-label', 'Spegni la TV ogni giorno alle');
    [''].concat(powerOffTimes()).forEach(function (t) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t || 'Mai';
      offSelect.appendChild(o);
    });
    offSelect.value = conf.powerOffAt && powerOffTimes().indexOf(conf.powerOffAt) >= 0 ? conf.powerOffAt : '';
    offRow.appendChild(offSelect);
    off.appendChild(offRow);
    controls.powerOffAt = offSelect;

    const first = section('Accensione', 'All’accensione la TV apre Cinema da sola, come prima app, invece della TV o dell’ultimo ingresso: dopo il logo di LG compare Cinema. Canali e ingressi si aprono come prima.');
    controls.cinemaFirst = toggle(first, 'Apri Cinema all’accensione', conf.cinemaFirst === true, '');

    if (status.ledStrip && status.ledStrip.supported && api.ledScan) {
      controls.led = ledSection(Object.assign({}, LED_DEFAULT, conf.ledStrip || {}));
    }

    let blockUpdates = null;
    if (typeof status.blockUpdates === 'boolean' && api.blockUpdates) {
      const upd = section('Aggiornamenti di LG', 'Un aggiornamento del software di LG può togliere il root, e con lui gli strumenti di Cinema. Homebrew Channel può bloccarli. Restano bloccati anche gli aggiornamenti di sicurezza. Vale dal prossimo riavvio della TV.');
      blockUpdates = toggle(upd, 'Blocca gli aggiornamenti del software LG', status.blockUpdates, '');
    }

    const rows = preloadRows(status);
    if (rows.length) {
      const pre = section('App caricate in background', 'LG tiene alcune app pronte in memoria anche se non le usi. Spegni quelle che non ti servono: si apriranno qualche secondo più lentamente. Vale dal prossimo riavvio della TV.');
      rows.forEach(function (e) {
        const label = e.title + (e.memoryMb ? ' · circa ' + e.memoryMb + ' MB' : '');
        controls.preload[e.id] = toggle(pre, label, (conf.preloadOff || []).indexOf(e.id) < 0);
      });
    }

    const settings = TV_SETTINGS.filter(function (s) { return status.settings && status.settings[s.key] != null; });
    if (settings.length) {
      const adv = section('Pubblicità e tracciamento', 'Le voci attive restano spente: se LG le riaccende, Cinema le rispegne. Spegnendo l’interruttore torna il valore che avevi prima.');
      settings.forEach(function (s) {
        controls.settings[s.key] = toggle(adv, 'Disattiva: ' + s.label, (conf.settingsOff || []).indexOf(s.key) >= 0, s.hint);
      });
    }

    const services = TV_SERVICES.filter(function (s) { return status.services && status.services[s.id] != null; });
    if (services.length) {
      const srv = section('Servizi LG in background', 'Fermati a ogni avvio della TV. Spegnendo l’interruttore il servizio riparte subito.');
      services.forEach(function (s) {
        controls.services[s.id] = toggle(srv, 'Ferma: ' + s.label, (conf.servicesOff || []).indexOf(s.id) >= 0);
      });
    }

    const keys = (status.remoteKeys || []).filter(function (k) { return REMOTE_KEY_LABELS[k]; });
    if (keys.length) {
      const rk = section('Tasti del telecomando', 'Scegli cosa apre ciascun tasto, da qualsiasi app. Vale subito e resta dopo il riavvio. Il tasto giallo in Cinema alterna la vista: se lo assegni qui, quella funzione non c’è più. Home, Indietro, volume e canali restano di LG.');
      const targets = keyTargets(status);
      keys.forEach(function (k) {
        const row = node('div', 'settings-row');
        row.appendChild(node('span', '', REMOTE_KEY_LABELS[k]));
        const select = document.createElement('select');
        select.className = 'focusable';
        select.dataset.focusIndex = String(focusIndex++);
        select.setAttribute('aria-label', REMOTE_KEY_LABELS[k]);
        [{value: KEEP_LG, label: 'Come LG'}, {value: '', label: 'Nessuna azione'}].concat(targets).forEach(function (t) {
          const o = document.createElement('option');
          o.value = t.value;
          o.textContent = t.label;
          select.appendChild(o);
        });
        const current = (conf.remoteKeys || {})[k];
        select.value = current === undefined ? KEEP_LG : current;
        if (select.value !== (current === undefined ? KEEP_LG : current)) {
          // Mapped to an app that is not installed now: kept, and said, not
          // silently reset to LG's action and dropped at the next Salva.
          const o = document.createElement('option');
          o.value = current;
          o.textContent = 'App non installata: ' + current;
          select.appendChild(o);
          select.value = current;
        }
        row.appendChild(select);
        rk.appendChild(row);
        controls.keys[k] = select;
      });
    }

    const consent = status.consent || [];
    if (consent.length) {
      const ag = section('Accordi sui dati', 'Gli accordi che hai accettato con LG. Spegnerne uno ritira anche il documento LG da cui dipende, così non torna acceso al riavvio; i termini d’uso non vengono toccati. Le voci che usano lo stesso documento si spengono insieme.');
      consent.forEach(function (c) {
        const others = (c.peers || []).filter(function (p) {
          return consent.some(function (o) { return o.key === p && o.on; });
        }).map(consentLabel);
        let hint = '';
        if (others.length) hint = 'Spegnendolo si spengono anche: ' + others.join(', ') + '.';
        if (/^voice/.test(c.key)) hint = (hint ? hint + ' ' : '') + 'Senza, i comandi vocali non funzionano.';
        controls.consent[c.key] = toggle(ag, consentLabel(c.key), c.on, hint);
      });
    }

    const actions = node('div', 'cinema-settings-actions');
    const state = node('p', 'settings-hint', status.daemon ? 'Attivo.' : 'Non attivo.');
    // Saved with the panel's own Salva, like every other setting.
    panel.__tvToolsSave = async function () {
      let changedUpdates = false;
      if (blockUpdates && blockUpdates.checked !== status.blockUpdates) {
        try {
          await api.blockUpdates(blockUpdates.checked);
          status.blockUpdates = blockUpdates.checked;
          changedUpdates = true;
          state.textContent = blockUpdates.checked ? 'Aggiornamenti di LG bloccati dal prossimo riavvio.' : 'Aggiornamenti di LG di nuovo permessi dal prossimo riavvio.';
        } catch (err) {
          state.textContent = 'Blocco degli aggiornamenti non cambiato.';
          throw err;
        }
      }
      const next = tvToolsDraft(status, controls);
      const consentChanges = (status.consent || []).filter(function (c) {
        return controls.consent[c.key] && controls.consent[c.key].checked !== c.on;
      });
      if (consentChanges.length && api.consent) {
        state.textContent = 'Aggiornamento degli accordi…';
        // Each one is tried; the ones LG refused are named instead of the
        // loop stopping at the first with the rest silently left as before.
        const failed = [];
        for (const c of consentChanges) {
          try {
            await api.consent(c.key, controls.consent[c.key].checked);
          } catch (err) {
            failed.push(consentLabel(c.key));
          }
        }
        if (failed.length) {
          state.textContent = 'Non applicati: ' + failed.join(', ') + '. Gli altri accordi sono aggiornati.';
          refresh();
          throw new Error('accordi non applicati: ' + failed.join(', '));
        }
        if (JSON.stringify(normalized(next)) === JSON.stringify(normalized(conf))) {
          state.textContent = 'Accordi aggiornati.';
          refresh();
          return true;
        }
      }
      if (JSON.stringify(normalized(next)) === JSON.stringify(normalized(conf))) return changedUpdates ? true : null;
      state.textContent = 'Applicazione in corso…';
      try {
        const on = await api.apply(next);
        state.textContent = on ? 'Applicato. Le voci con “vale dal prossimo riavvio” cambiano dopo il riavvio della TV.' : 'Tutto riportato alle impostazioni di LG.';
        refresh();
        return on;
      } catch (err) {
        state.textContent = 'Non riuscito: ' + (err && err.message ? err.message : err);
        throw err;
      }
    };
    const reset = button('Ripristina tutto come LG', async function () {
      reset.disabled = true;
      state.textContent = 'Ripristino in corso…';
      try {
        await api.apply({preloadOff: [], settingsOff: [], servicesOff: [], keepInMemory: [], remoteKeys: {}, powerOffAt: null, cinemaFirst: false,
          ledStrip: Object.assign({}, LED_DEFAULT, status.conf && status.conf.ledStrip, {follow: false})});
        state.textContent = 'Tutto riportato alle impostazioni di LG.';
        refresh();
      } catch (err) {
        state.textContent = 'Non riuscito: ' + (err && err.message ? err.message : err);
      } finally {
        reset.disabled = false;
      }
    });
    actions.appendChild(reset);
    root.appendChild(actions);
    root.appendChild(state);
    decorateSettings(panel);
  }

  function refresh() {
    return api.status().then(render).catch(function () {
      root.textContent = '';
      root.appendChild(node('p', 'settings-hint', 'La TV non ha risposto. Riapri le impostazioni tra qualche secondo.'));
    });
  }
  refresh();
}
