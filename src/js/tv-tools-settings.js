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
  return {preloadOff: preloadOff, settingsOff: settingsOff, servicesOff: servicesOff, keepInMemory: keepInMemory};
}

function normalized(conf) {
  function sorted(list) { return (list || []).slice().sort(); }
  return {preloadOff: sorted(conf.preloadOff), settingsOff: sorted(conf.settingsOff),
    servicesOff: sorted(conf.servicesOff), keepInMemory: sorted(conf.keepInMemory)};
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
    const controls = {preload: {}, settings: {}, services: {}, memory: null};

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
        await api.apply({preloadOff: [], settingsOff: [], servicesOff: [], keepInMemory: []});
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
