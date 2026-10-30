import {describe,it,expect,vi,afterEach} from 'vitest';
import {normalizeItem,validConnection,createJellyfinClient,request} from '../src/js/cinema-jellyfin.js';
const connection={server:'https://example.org/jellyfin',userId:'a'.repeat(32),token:'private-test-token'};
afterEach(()=>vi.unstubAllGlobals());
describe('Jellyfin fallback and metadata',()=>{
 it('rejects malformed connections before requesting anything',()=>{
  expect(validConnection({...connection,server:'javascript:alert(1)'})).toBe(false);
  expect(()=>createJellyfinClient({...connection,userId:'bad'})).toThrow();
 });
 it('caps progress, handles missing durations and uses series backdrops',()=>{
  const item=normalizeItem({Id:'b'.repeat(32),Name:'Episode',SeriesName:'Series',RunTimeTicks:600000000,UserData:{PlaybackPositionTicks:1200000000},ParentBackdropItemId:'c'.repeat(32),Overview:'<b>A story</b>'});
  expect(item.progress).toBe(100);expect(item.remaining).toBe(0);expect(item.title).toBe('Series');expect(item.imageType).toBe('Backdrop');expect(item.overview).toBe('A story');
  expect(normalizeItem({}).progress).toBe(0);
 });
 it('uses the Authorization header accepted by current Jellyfin, never a token in URLs',async()=>{
  let xhr;
  vi.stubGlobal('XMLHttpRequest',class{
   constructor(){xhr=this;this.headers={};}
   open(method,url){this.url=url;}
   setRequestHeader(k,v){this.headers[k]=v;}
   send(){this.status=200;this.responseText='{"Items":[]}';this.onload();}
  });
  await createJellyfinClient(connection).load('movies','a & b');
  expect(xhr.headers.Authorization).toBe('MediaBrowser Token="private-test-token"');
  expect(xhr.url).not.toContain(connection.token);expect(xhr.url).toContain('a%20%26%20b');
 });
 it('rejects timed out and unauthorized requests so the local UI can remain available',async()=>{
  let xhr;
  vi.stubGlobal('XMLHttpRequest',class{constructor(){xhr=this;}open(){}setRequestHeader(){}send(){}});
  const p=request('https://example.org',connection.token);xhr.ontimeout();await expect(p).rejects.toThrow('raggiungibile');
  const denied=request('https://example.org',connection.token);xhr.status=401;xhr.onload();await expect(denied).rejects.toThrow('401');
 });
});
describe('Jellyfin artwork store and Next Up',()=>{
 it('degrades to memory without IndexedDB and prunes the oldest images',async()=>{
  const {createImageStore}=await import('../src/js/cinema-jellyfin.js');
  const store=createImageStore({indexedDB:null});
  const now=vi.spyOn(Date,'now');
  for(let i=0;i<5;i++){now.mockReturnValue(1000+i);await store.put('item'+i+':Primary:640',{size:i});}
  expect(await store.get('item2:Primary:640')).toEqual({size:2});expect(await store.get('missing')).toBeNull();
  expect(await store.prune(3)).toBe(2);expect(store.memorySize()).toBe(3);
  expect(await store.get('item0:Primary:640')).toBeNull();expect(await store.get('item4:Primary:640')).toEqual({size:4});
  now.mockRestore();
 });
 it('serves object URLs from the store before the network, with DPR-2 sizes and abort',async()=>{
  const {createImageStore,createJellyfinClient}=await import('../src/js/cinema-jellyfin.js');
  const urls=[];vi.stubGlobal('URL',{createObjectURL:b=>{urls.push(b);return 'blob:'+urls.length;},revokeObjectURL:()=>{}});
  const requests=[];
  vi.stubGlobal('XMLHttpRequest',class{constructor(){requests.push(this);}open(m,u){this.url=u;}setRequestHeader(){}abort(){this.onabort&&this.onabort();}send(){this.status=200;this.response={size:10,tag:this.url};Promise.resolve().then(()=>this.onload());}});
  const store=createImageStore({indexedDB:null});
  const client=createJellyfinClient(connection,{store});
  const item={imageId:'d'.repeat(32),imageType:'Backdrop'};
  const url=await client.image(item,1920);
  expect(url).toBe('blob:1');expect(requests[0].url).toContain('/Images/Backdrop/0?MaxWidth=1920&Quality=70&Format=jpg');
  expect(await client.image(item,1920)).toBe('blob:1');expect(requests).toHaveLength(1);
  expect(await store.get(item.imageId+':Backdrop:1920')).toEqual({size:10,tag:requests[0].url});
  const other={imageId:'e'.repeat(32),imageType:'Primary'};
  const pending=client.image(other,640);pending.abort();
  await expect(pending).rejects.toThrow('annullata');expect(requests).toHaveLength(1);// dropped before any request
  expect(await client.image(other,640)).toBe('blob:2');expect(requests[1].url).toContain('/Images/Primary?MaxWidth=640');
  expect(await client.image({imageId:'nope',imageType:'Primary'},640)).toBe('');
 });
 it('asks Next Up for the user and merges it after Resume without repeating a series',async()=>{
  const {createJellyfinClient,mergeContinue}=await import('../src/js/cinema-jellyfin.js');
  let url='';
  vi.stubGlobal('XMLHttpRequest',class{open(m,u){url=u;}setRequestHeader(){}send(){this.status=200;this.responseText='{"Items":[{"Id":"'+'1'.repeat(32)+'","Name":"Ep 2","SeriesName":"Show","SeriesId":"s1"}]}';this.onload();}});
  const next=await createJellyfinClient(connection).load('nextup');
  expect(url).toContain('/Shows/NextUp?UserId='+'a'.repeat(32)+'&');expect(url).toContain('Limit=12');expect(next[0].seriesId).toBe('s1');
  const merged=mergeContinue([{id:'r1',seriesId:'s1',title:'Show'},{id:'r2',seriesId:'',title:'Film'}],[{id:'n1',seriesId:'s1'},{id:'n2',seriesId:'s2'},{id:'r2',seriesId:''}]);
  expect(merged.map(i=>i.id)).toEqual(['r1','r2','n2']);
 });
});
