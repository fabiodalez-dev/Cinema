import {describe,it,expect,vi,afterEach} from 'vitest';
import {createCinematic} from '../src/js/cinematic.js';
import {createJellyfinClient} from '../src/js/cinema-jellyfin.js';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const ID='a'.repeat(32), USER='b'.repeat(32);
function storage(initial){const saved=new Map(Object.entries(initial||{}));vi.stubGlobal('localStorage',{getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k),clear:()=>saved.clear()});return saved;}
function mount(){
 document.body.innerHTML='<div id="app"><div id="background-layer"></div><header class="top-bar"><span id="clock-date"></span></header></div><div id="settings-panel"><div class="settings-tab-pane" data-tab="cinema"></div></div>';
 const focus={focusHomeDock:vi.fn(),focusElement:vi.fn(),focusWithin:vi.fn()};
 return createCinematic({focus,getConfig:()=>({launcher:{}}),getInputs:()=>[],beforePreview:vi.fn(),afterPreview:vi.fn(),switchInput:vi.fn(),showToast:vi.fn()});
}
// Jellyfin on the desktop preview: /preview/connection, then library calls answered by `answer(url)`.
function fakeServer(answer){
 const urls=[];
 vi.stubGlobal('XMLHttpRequest',class{open(m,u){this.url=u;urls.push(u);}setRequestHeader(){}abort(){}send(){const a=answer(this.url);this.status=a.status;this.responseText=JSON.stringify(a.body||{});Promise.resolve().then(()=>this.onload());}});
 return urls;
}
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();document.body.innerHTML='';vi.unstubAllGlobals();});
describe('Cinema media cache and Jellyfin states',()=>{
 it('drops data URLs from the old cache at start and never writes artwork again',async()=>{
  vi.useFakeTimers();
  const saved=storage({'launch-home.cinema.media.v1':JSON.stringify({items:[{id:ID,title:'Film',type:'Movie',genres:[],image:'data:image/jpeg;base64,AAAA',backdrop:'data:image/jpeg;base64,BBBB',imageId:ID,imageType:'Primary'}],resume:[],at:5})});
  mount();
  const cache=JSON.parse(saved.get('launch-home.cinema.media.v1'));
  expect(cache.items[0].title).toBe('Film');expect(cache.items[0].image).toBe('');expect(cache.items[0].backdrop).toBe('');
  expect(saved.get('launch-home.cinema.media.v1')).not.toContain('data:');
  const card=document.querySelector('.cinema-card img');expect(card.getAttribute('src')).toBe('assets/backgrounds/thumbs/mountain-sunset.jpg');expect(card.decoding).toBe('async');
 });
 it('reports unauthorized on 401, forgets the client and reads the connection again',async()=>{
  vi.useFakeTimers();storage({});
  let status=401;
  const urls=fakeServer(url=>url==='/preview/connection'?{status:200,body:{server:'http://media.test:8096',userId:USER,token:'private-test-token',userName:'Fabio'}}:{status,body:{Items:[]}});
  const cinema=mount();cinema.mountSettings(document.getElementById('settings-panel'));
  const account=document.querySelector('[data-connection=jellyfin] strong');
  expect(account.textContent).toBe('Jellyfin da collegare');
  vi.advanceTimersByTime(300);await flush();await flush();
  expect(document.getElementById('cinema-status').textContent).toBe('Accesso Jellyfin scaduto: collega di nuovo');
  const connectionReads=()=>urls.filter(u=>u==='/preview/connection').length;
  expect(connectionReads()).toBe(1);
  status=200;await cinema.refresh(true);await flush();
  expect(connectionReads()).toBe(2);expect(document.getElementById('cinema-status').textContent).toBe('Fabio');
  expect(urls.some(u=>u.indexOf('/Shows/NextUp?UserId='+USER)===0||u.indexOf('http://media.test:8096/Shows/NextUp?UserId='+USER)===0)).toBe(true);
  const refreshButton=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Aggiorna libreria');refreshButton.click();await flush();await flush();
  expect(account.textContent).toBe('Collegato a Jellyfin');
 });
 it('capitalises only the first letter of the date line',async()=>{
  vi.useFakeTimers();storage({});mount();
  const date=document.getElementById('clock-date');date.textContent='giovedì 30 ottobre';await flush();
  expect(date.textContent).toBe('Giovedì 30 ottobre');
 });

 it('loads one hero per settled focus, at 1920 for DPR 2, and no artwork from localStorage',async()=>{
  vi.useFakeTimers();const saved=storage({});
  const urls=[];vi.stubGlobal('URL',{createObjectURL:()=>'blob:'+(urls.length+1),revokeObjectURL:()=>{}});
  const items=[1,2,3].map(n=>({Id:String(n).repeat(32),Name:'Film '+n,Type:'Movie',BackdropImageTags:['t']}));
  vi.stubGlobal('XMLHttpRequest',class{open(m,u){this.url=u;}setRequestHeader(){}abort(){this.aborted=true;if(this.onabort)this.onabort();}
   send(){urls.push(this.url);if(this.url==='/preview/connection'){this.status=200;this.responseText=JSON.stringify({server:'http://media.test:8096',userId:USER,token:'private-test-token',userName:'Fabio'});}
    else if(this.url.indexOf('/Images/')>0){this.status=200;this.response={size:10};}else{this.status=200;this.responseText=JSON.stringify({Items:this.url.indexOf('/Items?')>0?items:[]});}
    Promise.resolve().then(()=>{if(!this.aborted)this.onload();});}});
  const cinema=mount();vi.advanceTimersByTime(300);await flush();await flush();
  const cards=document.querySelectorAll('.cinema-card');expect(cards).toHaveLength(3);
  const heroes=()=>urls.filter(u=>u.indexOf('MaxWidth=1920&Quality=70')>0);
  await flush();expect(heroes()).toHaveLength(1);expect(heroes()[0]).toContain('/Items/'+'1'.repeat(32)+'/Images/Backdrop/0?');
  // Two quick focus moves: one hero request, for the card the focus settled on.
  cards[1].dispatchEvent(new Event('focus'));vi.advanceTimersByTime(100);cards[2].dispatchEvent(new Event('focus'));vi.advanceTimersByTime(100);await flush();
  expect(heroes()).toHaveLength(1);vi.advanceTimersByTime(150);await flush();
  expect(heroes()).toHaveLength(2);expect(heroes()[1]).toContain('/Items/'+'3'.repeat(32)+'/');
  expect(urls.filter(u=>u.indexOf('MaxWidth=640&Quality=70')>0).length).toBeGreaterThan(0);
  vi.advanceTimersByTime(1000);
  const stored=saved.get('launch-home.cinema.media.v1');expect(stored).toContain('Film 3');expect(stored).not.toContain('blob:');expect(stored).not.toContain('"image"');
  expect(document.body.classList.contains('cinema-has-backdrop')).toBe(false);// jsdom never decodes the image
  void cinema;
 });
});
