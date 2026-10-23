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
    expect(apply.mock.calls[0][0]).toEqual({preloadOff: [], settingsOff: [], servicesOff: [], keepInMemory: []});
  });

  it('says so on a TV without root or Python', async () => {
    const panel = await mounted(null);
    expect(panel.textContent).toMatch(/non sono disponibili/);
  });

  it('draft keeps the stored choice for rows not shown', () => {
    expect(tvToolsDraft(status(), {preload: {}, settings: {}, services: {}, memory: null}))
      .toEqual({preloadOff: ['vudu', 'amazon'], settingsOff: ['adCookie'], servicesOff: ['contentminer'], keepInMemory: ['org.webosbrew.lounge.launcher']});
  });
});
