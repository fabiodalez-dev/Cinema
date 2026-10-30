import {it,expect,vi} from 'vitest';
import {createCinematic} from '../src/js/cinematic.js';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const key=(k,c)=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,keyCode:c,bubbles:true,cancelable:true}));
it('changes channel inside the Live picture with CH+/CH-, numbers and the Channels strip',async()=>{
 vi.useFakeTimers();const saved=new Map();vi.stubGlobal('localStorage',{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),clear:()=>saved.clear()});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 window.PalmSystem={};
 document.body.innerHTML='<div id="app"><div id="background-layer"></div><header class="top-bar"></header></div>';
 const focus={focusHomeDock:vi.fn(),focusElement:vi.fn(),focusWithin:vi.fn()};
 const channels=[{id:'c4',number:'4',name:'Rete4 HD'},{id:'c5',number:'5',name:'Canale5 HD'},{id:'c6',number:'6',name:'Italia1 HD'}];
 const tuned=[],beforePreview=vi.fn(),bubbled=vi.fn();
 const cinema=createCinematic({focus,getConfig:()=>({launcher:{}}),getInputs:()=>[{id:'HDMI_1',label:'Console'}],beforePreview,afterPreview:vi.fn(),switchInput:vi.fn(),showToast:vi.fn(),
  getChannels:()=>Promise.resolve(channels),getCurrentChannelId:()=>Promise.resolve('c5'),tuneChannel:ch=>{tuned.push(ch.id);return Promise.resolve(true);},getProgramme:()=>Promise.resolve('Caduta libera'),
  getProgrammeInfo:ch=>ch.id==='c5'?Promise.resolve({name:'Caduta libera',start:Date.now()/1000-1800,end:Date.now()/1000+600,next:'Striscia la notizia'}):Promise.reject(new Error('no guide'))});
 document.addEventListener('keydown',bubbled);
 document.querySelector('[data-cinema-tab=live]').click();await flush();
 const banner=document.querySelector('.cinema-live-banner');
 expect(banner.classList.contains('visible')).toBe(true);expect(banner.textContent).toContain('Canale5 HD');expect(banner.textContent).toContain('Caduta libera');
 // Guide times: a progress bar three quarters in and what follows.
 expect(banner.textContent).toContain('A seguire: Striscia la notizia');expect(banner.querySelector('.cinema-live-banner-progress').hidden).toBe(false);
 expect(parseFloat(banner.querySelector('.cinema-live-banner-progress i').style.width)).toBeCloseTo(75,0);
 vi.advanceTimersByTime(4500);expect(banner.classList.contains('visible')).toBe(false);
 // Info brings the banner back for six seconds and stays inside Live.
 key('Info',457);await flush();expect(bubbled).not.toHaveBeenCalled();expect(banner.classList.contains('visible')).toBe(true);expect(banner.textContent).toContain('Canale5 HD');
 vi.advanceTimersByTime(5900);expect(banner.classList.contains('visible')).toBe(true);vi.advanceTimersByTime(100);expect(banner.classList.contains('visible')).toBe(false);
 expect(document.querySelector('#cinema-live-controls h1').textContent).toBe('5  Canale5 HD');
 const first=document.querySelector('video');
 // CH+ arrives as PageUp on the LG remote; the launcher keeps it to itself.
 key('PageUp',33);await flush();expect(bubbled).not.toHaveBeenCalled();
 expect(banner.textContent).toContain('Italia1 HD');expect(tuned).toEqual([]);
 // No guide for this channel: the name only, no stale bar or "A seguire".
 expect(banner.textContent).toContain('Caduta libera');expect(banner.textContent).not.toContain('A seguire');expect(banner.querySelector('.cinema-live-banner-progress').hidden).toBe(true);
 vi.advanceTimersByTime(450);await flush();
 expect(tuned).toEqual(['c6']);expect(document.querySelector('video')).not.toBe(first);
 expect(document.querySelector('source').getAttribute('src')).toBe('tv://');
 expect(beforePreview).toHaveBeenCalledOnce();// channel changes leave volume and music alone
 key('PageDown',34);await flush();vi.advanceTimersByTime(450);await flush();expect(tuned).toEqual(['c6','c5']);
 // A number on an HDMI source goes back to TV and tunes it.
 document.querySelector('[data-live-source=HDMI_1]').click();expect(document.querySelector('source').getAttribute('src')).toBe('ext://hdmi:1');
 key('4',52);await flush();vi.advanceTimersByTime(0);await flush();vi.advanceTimersByTime(0);await flush();
 expect(document.querySelector('source').getAttribute('src')).toBe('tv://');expect(tuned).toEqual(['c6','c5','c4']);
 // The Channels strip tunes in place while Live is open, and not elsewhere.
 expect(cinema.tuneChannel(channels[1])).toBe(true);vi.advanceTimersByTime(0);await flush();expect(tuned).toEqual(['c6','c5','c4','c5']);
 document.querySelector('[data-cinema-tab=home]').click();expect(cinema.tuneChannel(channels[2])).toBe(false);
 key('PageUp',33);expect(bubbled).toHaveBeenCalledOnce();
 document.removeEventListener('keydown',bubbled);
 vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();delete window.PalmSystem;document.body.innerHTML='';vi.unstubAllGlobals();
});

it('says when no channel is tuned instead of zapping into nothing',async()=>{
 vi.useFakeTimers();const saved=new Map();vi.stubGlobal('localStorage',{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),clear:()=>saved.clear()});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 window.PalmSystem={};document.body.innerHTML='<div id="app"><div id="background-layer"></div><header class="top-bar"></header></div>';
 const focus={focusHomeDock:vi.fn(),focusElement:vi.fn(),focusWithin:vi.fn()};
 createCinematic({focus,getConfig:()=>({launcher:{}}),getInputs:()=>[],beforePreview:vi.fn(),afterPreview:vi.fn(),switchInput:vi.fn(),showToast:vi.fn(),
  getChannels:()=>Promise.resolve([]),getCurrentChannelId:()=>Promise.resolve(''),tuneChannel:()=>Promise.resolve(true),getProgramme:()=>Promise.resolve('')});
 document.querySelector('[data-cinema-tab=live]').click();await flush();
 const banner=document.querySelector('.cinema-live-banner');expect(banner.classList.contains('visible')).toBe(false);
 key('PageUp',33);await flush();
 expect(banner.classList.contains('visible')).toBe(true);expect(banner.textContent).toContain('Nessun canale sintonizzato');
 vi.advanceTimersByTime(4500);key('Guide',458);await flush();expect(banner.textContent).toContain('Nessun canale sintonizzato');
 vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();delete window.PalmSystem;document.body.innerHTML='';vi.unstubAllGlobals();
});
