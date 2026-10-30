import {describe, expect, it, vi} from 'vitest';
import {mountTvToolsSettings, preloadRows, tvToolsDraft} from '../src/js/tv-tools-settings.js';

function status(extra) {
  return Object.assign({
    conf: {preloadOff: ['vudu', 'amazon'], settingsOff: ['adCookie'], servicesOff: ['contentminer'], keepInMemory: ['org.webosbrew.lounge.launcher']},
    preload: [
      {id: 'youtube.leanback.v4', title: 'YouTube', installed: true, enabled: true, lgEnabled: true, memoryMb: 135, essential: false},
      {id: 'amazon', title: 'Prime Video', installed: true, enabled: false, lgEnabled: true, memoryMb: 100, essential: false},
      {id: 'vudu', title: null, installed: false, enabled: false, lgEnabled: true, essential: false},
      {id: 'airplay', title: 'AirPlay', installed: true, enabled: false, lgEnabled: false, essential: true},
      {id: 'com.webos.app.hdmi1', title: 'HDMI 1', installed: true, enabled: true, lgEnabled: true, essential: true}
    ],
    settings: {adCookie: 'off', livePlus: 'off'},
    services: {contentminer: 'inactive', remotelogger: 'active'},
    remoteKeys: ['blue', 'netflix', 'unknown'],
    consent: [
      {key: 'customAdAllowed', on: true, docs: ['Termini di uso', 'Pubblicità'], peers: ['acrAdAllowed']},
      {key: 'acrAdAllowed', on: true, docs: [], peers: ['customAdAllowed']},
      {key: 'voiceAllowed', on: true, docs: [], peers: []}
    ],
    apps: {'org.bloomee.webos': 'Bloomee', 'com.webos.app.hdmi1': 'HDMI 1', 'netflix': 'Netflix', 'com.webos.app.settings': 'Impostazioni', 'kodi': 'Kodi'},
    installed: {'org.bloomee.webos': true},
    memorySupported: true,
    daemon: 123
  }, extra || {});
}

async function mounted(st, apply) {
  document.body.innerHTML = '<div id="p"><div class="settings-tab-pane" data-tab="tv"></div></div>';
  const panel = document.getElementById('p');
  mountTvToolsSettings(panel, {status: () => Promise.resolve(st), apply: apply || vi.fn(async () => true)});
  await new Promise((r) => setTimeout(r, 0));
  return panel;
}

describe('TV tools settings', () => {
  it('lists only installed, non-essential apps LG preloads, or ones switched off here', () => {
    expect(preloadRows(status()).map((e) => e.id)).toEqual(['amazon', 'youtube.leanback.v4']);
  });

  it('shows only the settings and services this TV has', async () => {
    const panel = await mounted(status());
    const labels = [...panel.querySelectorAll('.settings-row span')].map((s) => s.textContent);
    expect(labels).toContain('Disattiva: ID pubblicitario');
    expect(labels).toContain('Disattiva: Live Plus (riconoscimento dei contenuti)');
    expect(labels.some((l) => /LG Channels/.test(l))).toBe(false);
    expect(labels).toContain('Ferma: Analisi dei contenuti (ACR)');
    expect(labels.some((l) => /Webcam/.test(l))).toBe(false);
    expect(labels).toContain('Tieni aperte Cinema e Bloomee');
  });

  it('switching an app back on removes it from the list, hidden apps keep their state', async () => {
    const apply = vi.fn(async () => true);
    const panel = await mounted(status(), apply);
    const prime = [...panel.querySelectorAll('.settings-row')].find((r) => /Prime Video/.test(r.textContent)).querySelector('input');
    expect(prime.checked).toBe(false);
    prime.checked = true;
    await panel.__tvToolsSave();
    const conf = apply.mock.calls[0][0];
    expect(conf.preloadOff).toEqual(['vudu']);
    expect(conf.settingsOff).toEqual(['adCookie']);
    expect(conf.servicesOff).toEqual(['contentminer']);
    expect(conf.keepInMemory).toEqual(['org.webosbrew.lounge.launcher']);
  });

  it('switching memory on keeps Bloomee too when it is installed', async () => {
    const apply = vi.fn(async () => true);
    const st = status(); st.conf.keepInMemory = [];
    const panel = await mounted(st, apply);
    [...panel.querySelectorAll('.settings-row')].find((r) => /Tieni aperte/.test(r.textContent)).querySelector('input').checked = true;
    await panel.__tvToolsSave();
    expect(apply.mock.calls[0][0].keepInMemory).toEqual(['org.webosbrew.lounge.launcher', 'org.bloomee.webos']);
  });

  it('remote keys: offers only the keys this TV has, Cinema, Bloomee and inputs first, and stores the choice', async () => {
    const apply = vi.fn(async () => true);
    const panel = await mounted(status(), apply);
    const selects = [...panel.querySelectorAll('select')].filter((s) => /^Tasto/.test(s.getAttribute('aria-label')));
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['Tasto blu', 'Tasto Netflix']);
    const options = [...selects[0].options].map((o) => o.textContent);
    expect(options.slice(0, 5)).toEqual(['Come LG', 'Nessuna azione', 'Cinema', 'Bloomee', 'HDMI 1']);
    expect(options).toContain('Kodi');
    expect(options).not.toContain('Impostazioni');
    selects[0].value = 'com.webos.app.hdmi1';
    selects[1].value = '';
    await panel.__tvToolsSave();
    expect(apply.mock.calls[0][0].remoteKeys).toEqual({blue: 'com.webos.app.hdmi1', netflix: ''});
  });

  it('data agreements: says what goes off together, applies only the changed ones', async () => {
    const apply = vi.fn(async () => true);
    const consent = vi.fn(async () => ({ok: true}));
    document.body.innerHTML = '<div id="p"><div class="settings-tab-pane" data-tab="tv"></div></div>';
    const panel = document.getElementById('p');
    mountTvToolsSettings(panel, {status: () => Promise.resolve(status()), apply, consent});
    await new Promise((r) => setTimeout(r, 0));
    const row = [...panel.querySelectorAll('.settings-row')].find((r) => r.textContent === 'Pubblicità personalizzata');
    expect(row.nextElementSibling.textContent).toBe('Spegnendolo si spengono anche: Pubblicità basata su ciò che guardi.');
    expect(panel.textContent).toContain('Senza, i comandi vocali non funzionano.');
    row.querySelector('input').checked = false;
    await panel.__tvToolsSave();
    expect(consent.mock.calls).toEqual([['customAdAllowed', false]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('scheduled power-off: Mai by default, a half-hour time once chosen', async () => {
    const apply = vi.fn(async () => true);
    const panel = await mounted(status(), apply);
    const select = panel.querySelector('select[aria-label="Spegni la TV ogni giorno alle"]');
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe('Mai');
    expect([...select.options].map((o) => o.value)).toContain('02:00');
    expect(select.options.length).toBe(49);
    select.value = '02:00';
    await panel.__tvToolsSave();
    expect(apply.mock.calls[0][0].powerOffAt).toBe('02:00');
  });

  it('Salva applies nothing when nothing changed', async () => {
    const apply = vi.fn(async () => true);
    const panel = await mounted(status(), apply);
    expect(await panel.__tvToolsSave()).toBe(null);
    expect(apply).not.toHaveBeenCalled();
  });

  it('LG settings button gives everything back', async () => {
    const apply = vi.fn(async () => false);
    const panel = await mounted(status(), apply);
    [...panel.querySelectorAll('button')].find((b) => /Ripristina/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(apply.mock.calls[0][0]).toEqual({preloadOff: [], settingsOff: [], servicesOff: [], keepInMemory: [], remoteKeys: {}, powerOffAt: null, cinemaFirst: false});
  });

  it('says so on a TV without root or Python', async () => {
    const panel = await mounted(null);
    expect(panel.textContent).toMatch(/non sono disponibili/);
  });

  it('draft keeps the stored choice for rows not shown', () => {
    expect(tvToolsDraft(status(), {preload: {}, settings: {}, services: {}, memory: null}))
      .toEqual({preloadOff: ['vudu', 'amazon'], settingsOff: ['adCookie'], servicesOff: ['contentminer'], keepInMemory: ['org.webosbrew.lounge.launcher'], remoteKeys: {}, powerOffAt: null, cinemaFirst: false});
  });
});

describe('updates', () => {
  it('lists each app with its state and installs on request', async () => {
    const {mountUpdates} = await import('../src/js/tv-tools-settings.js');
    document.body.innerHTML = '<div class="settings-panel"><div id="c"></div></div>';
    const install = vi.fn(async () => 'started');
    let calls = 0;
    const progress = vi.fn(async () => (++calls < 2 ? {app: 'org.bloomee.webos', state: 'downloading', version: '0.3.5'} : {app: 'org.bloomee.webos', state: 'installed', version: '0.3.5'}));
    vi.useFakeTimers();
    mountUpdates(document.getElementById('c'), {
      check: async () => ({
        'org.webosbrew.lounge.launcher': {name: 'Cinema', installed: '0.2.0', latest: '0.2.0', update: false},
        'org.bloomee.webos': {name: 'Bloomee', installed: '0.3.4', latest: '0.3.5', update: true}
      }),
      install, progress
    }, (() => { let i = 0; return () => i++; })());
    await vi.runAllTimersAsync();
    const rows = [...document.querySelectorAll('.settings-row')];
    expect(rows[0].textContent).toBe('Cinema 0.2.0 · aggiornata');
    expect(rows[1].textContent).toContain('Bloomee 0.3.4 · disponibile 0.3.5');
    rows[1].querySelector('button').click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(install).toHaveBeenCalledWith('org.bloomee.webos');
    expect(rows[1].textContent).toBe('Bloomee 0.3.5 · installata');
    vi.useRealTimers();
  });
});


describe('TV tools: Cinema at power-on', () => {
  it('keeps the stored choice when the switch is not shown, and follows the switch when it is', async () => {
    const {tvToolsDraft} = await import('../src/js/tv-tools-settings.js');
    const base = {preload: {}, settings: {}, services: {}, memory: null, keys: {}, consent: {}, powerOffAt: null};
    expect(tvToolsDraft({conf: {cinemaFirst: true}}, Object.assign({}, base, {cinemaFirst: null})).cinemaFirst).toBe(true);
    expect(tvToolsDraft({conf: {}}, Object.assign({}, base, {cinemaFirst: null})).cinemaFirst).toBe(false);
    expect(tvToolsDraft({conf: {cinemaFirst: true}}, Object.assign({}, base, {cinemaFirst: {checked: false}})).cinemaFirst).toBe(false);
  });
});
