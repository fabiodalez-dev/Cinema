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
describe('Cinema settings: Jellyfin states and Quick Connect',()=>{
 it('names the four connection states and points an expired login to Quick Connect',()=>{
  const {panel,api}=fixture();const account=panel.querySelector('[data-connection=jellyfin] strong');
  expect(account.textContent).toBe('Collegato a Jellyfin');
  const states={unconfigured:'Jellyfin da collegare',offline:'Jellyfin non raggiungibile',unauthorized:'Accesso Jellyfin scaduto: collega di nuovo',online:'Collegato a Jellyfin'};
  Object.keys(states).forEach(state=>{document.body.innerHTML='';const info={state,online:state==='online',userName:'',server:''};
   const p=document.createElement('div');p.innerHTML='<div class="settings-tab-pane" data-tab="cinema"></div>';document.body.appendChild(p);
   mountCinemaSettings(p,{...api,getInfo:()=>info});
   expect(p.querySelector('[data-connection=jellyfin] strong').textContent).toBe(states[state]);expect(p.querySelector('[data-connection=jellyfin]').dataset.state).toBe(state);
  });
  expect(document.body.textContent).toContain('Quick Connect');
 });
 it('runs Quick Connect from a typed server address and shows the code until the login lands',async()=>{
  document.body.innerHTML='<div id="settings-panel"><div class="settings-tab-pane" data-tab="cinema"></div></div>';const panel=document.getElementById('settings-panel');
  let resolveLogin;const quick=vi.fn((server,onCode)=>new Promise(r=>{onCode('482913');resolveLogin=r;}));
  const info={state:'unconfigured',online:false,userName:'',server:'',serverUrl:''};
  mountCinemaSettings(panel,{prefs:{enabled:true,jellyfin:true,backdrops:true,motion:true,liveShadow:true},getInfo:()=>info,refresh:vi.fn(),openLitefin:vi.fn(),openDiscover:vi.fn(),checkSeerr:vi.fn(),homeStatus:vi.fn().mockResolvedValue({home:true}),openInputHook:vi.fn(),quickConnect:quick});
  const input=panel.querySelector('input[type=url][data-quick-server]');const button=panel.querySelector('[data-quick-connect-button]');const code=panel.querySelector('.cinema-quick-code');const status=panel.querySelector('.cinema-quick-status');
  expect(input.classList.contains('focusable')).toBe(true);expect(input.readOnly).toBe(true);
  input.click();expect(input.readOnly).toBe(false);input.value='media.local';input.dispatchEvent(new Event('blur'));expect(input.readOnly).toBe(true);
  button.click();expect(quick).not.toHaveBeenCalled();expect(status.textContent).toContain('http://192.168.1.10:8096');
  input.value='http://192.168.1.10:8096';button.click();
  expect(quick).toHaveBeenCalledWith('http://192.168.1.10:8096',expect.any(Function));expect(code.textContent).toBe('482913');expect(button.disabled).toBe(true);
  info.state='online';info.online=true;info.userName='Fabio';info.server='192.168.1.10:8096';
  resolveLogin({userName:'Fabio',server:'http://192.168.1.10:8096'});await vi.waitFor(()=>expect(button.disabled).toBe(false));
  expect(code.textContent).toBe('');expect(status.textContent).toBe('Collegato come Fabio.');expect(panel.querySelector('[data-connection=jellyfin] strong').textContent).toBe('Collegato a Jellyfin');
  quick.mockRejectedValueOnce(new Error('Quick Connect è disattivato sul server: abilitalo in Dashboard → Generale'));button.click();await vi.waitFor(()=>expect(button.disabled).toBe(false));
  expect(status.textContent).toContain('disattivato sul server');
 });
});
