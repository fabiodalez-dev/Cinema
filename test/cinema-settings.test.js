import {afterEach,describe,it,expect,vi} from 'vitest';
import {mountCinemaSettings,cinemaDraft,normalizeCinemaPrefs} from '../src/js/cinema-settings.js';
import {decorateSettings,SETTINGS_CATEGORIES} from '../src/js/settings-design.js';
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
function fixture(){
 document.body.innerHTML='<div id="settings-panel"><div class="settings-tab-pane" data-tab="cinema"></div><section><div class="settings-row"><span>Avvio</span><input type="checkbox" data-setting="boot"></div><p class="settings-hint">Avvia all’accensione</p></section></div>';
 const panel=document.getElementById('settings-panel');
 const api={prefs:{enabled:true,jellyfin:true,backdrops:true,motion:true,liveShadow:true},getInfo:()=>({online:true,userName:'Test account',server:'media.example.test'}),refresh:vi.fn().mockResolvedValue(),openLitefin:vi.fn(),openDiscover:vi.fn(),checkSeerr:vi.fn().mockResolvedValue({configured:true,available:true}),homeStatus:vi.fn().mockResolvedValue({home:true}),openInputHook:vi.fn()};
 mountCinemaSettings(panel,api);return {panel,api};
}
describe('Cinema settings',()=>{
 it('only exports supported preferences to backups',()=>{
  expect(normalizeCinemaPrefs({enabled:false,motion:false,token:'must-not-save',server:'private'})).toEqual({enabled:false,jellyfin:true,backdrops:true,motion:false,liveShadow:true,client:'auto'});
 });
 it('keeps drafts separate, preserves existing boot input handlers and mounts only once',()=>{
  const {panel,api}=fixture();
  const boot=panel.querySelector('[data-setting=boot]');const changed=vi.fn();boot.addEventListener('change',changed);
  expect(boot.closest('.cinema-remote-settings')).not.toBeNull();boot.click();expect(changed).toHaveBeenCalledOnce();
  const motion=panel.querySelector('[data-cinema-pref=motion]');motion.click();
  const client=panel.querySelector('[data-cinema-client]');client.value='org.moonfin.webos';expect(cinemaDraft(panel,api.prefs).client).toBe('org.moonfin.webos');
  expect(api.prefs.motion).toBe(true);expect(cinemaDraft(panel,api.prefs).motion).toBe(false);
  mountCinemaSettings(panel,api);expect(panel.querySelectorAll('.cinema-settings')).toHaveLength(1);expect(cinemaDraft(panel,api.prefs).motion).toBe(false);
  expect(panel.textContent).not.toMatch(/Launch Home|Come home to/);
 });
 it('verifies Seerr through the current connection and shows a useful failure without trapping controls',async()=>{
  const {panel,api}=fixture();const check=Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='Verifica Seerr');
  check.click();await vi.waitFor(()=>expect(check.disabled).toBe(false));expect(panel.textContent).toContain('Seerr disponibile');
  api.checkSeerr.mockRejectedValueOnce(new Error('offline'));check.click();await vi.waitFor(()=>expect(check.disabled).toBe(false));expect(panel.textContent).toContain('Le app restano disponibili');
  expect(panel.querySelector('[data-cinema-pref=enabled]').disabled).toBe(false);
 });
 it('uses labelled native switches and updates range readouts without duplicate listeners',()=>{
  const {panel}=fixture();const range=document.createElement('input');range.type='range';range.value='20';panel.appendChild(range);
  decorateSettings(panel);decorateSettings(panel);expect(panel.querySelectorAll('output')).toHaveLength(1);
  range.value='35';range.dispatchEvent(new Event('input'));expect(panel.querySelector('output').textContent).toBe('35');
  const motion=panel.querySelector('[data-cinema-pref=motion]');expect(motion.getAttribute('aria-label')).toBe('Animazioni leggere');expect(motion.getAttribute('role')).toBe('switch');
  motion.closest('.settings-row').querySelector('span').click();expect(motion.checked).toBe(false);
  expect(SETTINGS_CATEGORIES.map(c=>c.id)).toEqual(expect.arrayContaining(['cinema','look','music','screensaver','apps','inputs','weather','system','ai','tools']));
 });
});
