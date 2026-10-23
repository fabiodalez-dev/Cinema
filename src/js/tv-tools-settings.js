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
  return {preloadOff: preloadOff, settingsOff: settingsOff, servicesOff: servicesOff, keepInMemory: keepInMemory,
    remoteKeys: remoteKeys};
}

function normalized(conf) {
  function sorted(list) { return (list || []).slice().sort(); }
  const keys = {};
  Object.keys(conf.remoteKeys || {}).sort().forEach(function (k) { keys[k] = conf.remoteKeys[k]; });
  return {preloadOff: sorted(conf.preloadOff), settingsOff: sorted(conf.settingsOff),
    servicesOff: sorted(conf.servicesOff), keepInMemory: sorted(conf.keepInMemory), remoteKeys: keys};
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
export function mountTvToolsSettings(panel, api) {
  const pane = panel.querySelector('.settings-tab-pane[data-tab="tv"]');
  if (!pane || pane.querySelector('.tv-tools-settings')) return;
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
  function button(label, handler) {
    const b = node('button', 'settings-button focusable', label);
    b.type = 'button';
    b.dataset.focusIndex = String(focusIndex++);
    b.addEventListener('click', handler);
    return b;
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
    const controls = {preload: {}, settings: {}, services: {}, memory: null, keys: {}};

    if (status.memorySupported) {
      const mem = section('Memoria', 'Con poca memoria webOS chiude le app aperte quando ne apri un’altra. Così Cinema riparte da zero a ogni tasto Home e la musica di Bloomee si ferma.');
      controls.memory = toggle(mem, status.installed && status.installed[BLOOMEE_ID] ? 'Tieni aperte Cinema e Bloomee' : 'Tieni aperta Cinema',
        (conf.keepInMemory || []).length > 0, 'Vale dal prossimo riavvio della TV.');
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
        if (select.value !== (current === undefined ? KEEP_LG : current)) select.value = KEEP_LG;
        row.appendChild(select);
        rk.appendChild(row);
        controls.keys[k] = select;
      });
    }

    const actions = node('div', 'cinema-settings-actions');
    const state = node('p', 'settings-hint', status.daemon ? 'Attivo.' : 'Non attivo.');
    // Saved with the panel's own Salva, like every other setting.
    panel.__tvToolsSave = async function () {
      const next = tvToolsDraft(status, controls);
      if (JSON.stringify(normalized(next)) === JSON.stringify(normalized(conf))) return null;
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
        await api.apply({preloadOff: [], settingsOff: [], servicesOff: [], keepInMemory: [], remoteKeys: {}});
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
