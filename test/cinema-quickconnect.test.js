import {describe,it,expect,vi,afterEach} from 'vitest';
import {quickConnect,deviceId,quickConnectAuthorization} from '../src/js/cinema-jellyfin.js';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
// A fake server: each call answers from `routes` (method + path -> status/body).
function fakeXhr(routes){
 const calls=[];
 vi.stubGlobal('XMLHttpRequest',class{
  constructor(){this.headers={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(k,v){this.headers[k]=v;}
  abort(){this.aborted=true;if(this.onabort)this.onabort();}
  send(body){
   const path=this.url.replace(/^https?:\/\/[^/]+/,'');
   calls.push({method:this.method,path:path,headers:this.headers,body:body?JSON.parse(body):undefined});
   const answer=routes(this.method,path,calls.length);
   this.status=answer.status;this.responseText=JSON.stringify(answer.body||{});
   Promise.resolve().then(()=>{if(!this.aborted)this.onload();});
  }
 });
 return calls;
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('Jellyfin Quick Connect',()=>{
 it('keeps one random device id in localStorage and nothing else',()=>{
  const saved=new Map();vi.stubGlobal('localStorage',{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)});
  const id=deviceId();expect(id).toMatch(/^[a-z0-9]{24}$/);expect(deviceId()).toBe(id);
  expect(Array.from(saved.keys())).toEqual(['launch-home.cinema.device.v1']);
  expect(quickConnectAuthorization(id,'1.2.3')).toBe('MediaBrowser Client="Cinema", Device="LG TV", DeviceId="'+id+'", Version="1.2.3"');
 });
 it('initiates, shows the code, polls every 3 s until confirmed, then authenticates',async()=>{
  vi.useFakeTimers();
  let polls=0;
  const calls=fakeXhr((method,path)=>{
   if(method==='POST'&&path==='/QuickConnect/Initiate')return {status:200,body:{Code:'482913',Secret:'s3cr3t'}};
   if(method==='GET'&&path.indexOf('/QuickConnect/Connect?secret=s3cr3t')===0){polls++;return {status:200,body:{Authenticated:polls>=3}};}
   if(method==='POST'&&path==='/Users/AuthenticateWithQuickConnect')return {status:200,body:{AccessToken:'token-from-server',User:{Id:'f'.repeat(32),Name:'Fabio'}}};
   return {status:404};
  });
  const codes=[];
  const p=quickConnect('http://192.168.1.10:8096/',{deviceId:'devicedevicedevicedevice',version:'0.9',onCode:c=>codes.push(c)});
  await flush();expect(codes).toEqual(['482913']);expect(polls).toBe(1);
  vi.advanceTimersByTime(3000);await flush();expect(polls).toBe(2);
  vi.advanceTimersByTime(3000);await flush();
  const result=await p;
  expect(result).toEqual({server:'http://192.168.1.10:8096',userId:'f'.repeat(32),token:'token-from-server',userName:'Fabio'});
  expect(calls[0].headers.Authorization).toBe('MediaBrowser Client="Cinema", Device="LG TV", DeviceId="devicedevicedevicedevice", Version="0.9"');
  const auth=calls[calls.length-1];expect(auth.path).toBe('/Users/AuthenticateWithQuickConnect');expect(auth.body).toEqual({Secret:'s3cr3t'});
  expect(auth.headers['Content-Type']).toBe('application/json');
 });
 it('explains a server with Quick Connect switched off',async()=>{
  fakeXhr(()=>({status:401}));
  await expect(quickConnect('http://192.168.1.10:8096',{deviceId:'d'.repeat(24)})).rejects.toThrow('Quick Connect è disattivato sul server');
 });
 it('rejects a bad address, gives up after the timeout and can be cancelled',async()=>{
  vi.useFakeTimers();
  await expect(quickConnect('192.168.1.10',{deviceId:'d'.repeat(24)})).rejects.toThrow('Indirizzo del server non valido');
  fakeXhr((method,path)=>path==='/QuickConnect/Initiate'?{status:200,body:{Code:'1',Secret:'x'}}:{status:200,body:{Authenticated:false}});
  const late=quickConnect('http://h:8096',{deviceId:'d'.repeat(24),interval:1000,timeout:2500});
  late.catch(()=>{});await flush();vi.advanceTimersByTime(1000);await flush();vi.advanceTimersByTime(1000);await flush();vi.advanceTimersByTime(1000);await flush();
  await expect(late).rejects.toThrow('Tempo scaduto');
  const cancelled=quickConnect('http://h:8096',{deviceId:'d'.repeat(24)});cancelled.catch(()=>{});await flush();cancelled.cancel();vi.advanceTimersByTime(3000);await flush();
  await expect(cancelled).rejects.toThrow('annullata');
 });
});
