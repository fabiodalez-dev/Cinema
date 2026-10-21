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
