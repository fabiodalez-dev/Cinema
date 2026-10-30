import {describe,it,expect,vi,afterEach} from 'vitest';
import {zapChannels,stepChannel,channelByNumber,createZapper} from '../src/js/live-zapping.js';

const LIST=[
 {id:'c7',number:'7',name:'LA7 HD'},{id:'c5',number:'5',name:'Canale5 HD'},{id:'r1',number:'701',name:'Radio',radio:true},
 {id:'h9',number:'9',name:'Hidden',hidden:true},{id:'c50',number:'50',name:'Cinquanta'},{id:'c2',number:'2',name:'Rai 2'}
];
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
afterEach(()=>{vi.useRealTimers();});

describe('Live TV zapping',()=>{
 it('steps through watchable TV channels in number order and wraps',()=>{
  const list=zapChannels(LIST);
  expect(list.map(c=>c.id)).toEqual(['c2','c5','c7','c50']);
  expect(stepChannel(list,'c5',1).id).toBe('c7');expect(stepChannel(list,'c50',1).id).toBe('c2');
  expect(stepChannel(list,'c2',-1).id).toBe('c50');expect(stepChannel(list,'r1',1).id).toBe('c2');
  expect(stepChannel([],'c2',1)).toBeNull();
 });
 it('finds typed numbers among visible channels, radio included',()=>{
  expect(channelByNumber(LIST,'701').id).toBe('r1');expect(channelByNumber(LIST,'9')).toBeNull();
  expect(channelByNumber(LIST,'05').id).toBe('c5');expect(channelByNumber(LIST,'3')).toBeNull();
 });
 function zapper(over){
  const calls={tune:[],reopen:0,banner:[]};
  const z=createZapper(Object.assign({channels:()=>Promise.resolve(LIST),currentId:()=>Promise.resolve('c5'),
   tune:ch=>{calls.tune.push(ch.id);return Promise.resolve();},reopen:()=>{calls.reopen++;},banner:s=>calls.banner.push(s)},over));
  return {z,calls};
 }
 it('gathers quick CH+ presses into one tune, then reopens the picture',async()=>{
  vi.useFakeTimers();const {z,calls}=zapper();
  await z.sync();expect(z.current().id).toBe('c5');expect(calls.banner.pop().channel.id).toBe('c5');
  await z.step(1);await z.step(1);
  expect(calls.banner.map(b=>b.channel.id)).toEqual(['c7','c50']);expect(calls.tune).toEqual([]);
  vi.advanceTimersByTime(450);await flush();
  expect(calls.tune).toEqual(['c50']);expect(calls.reopen).toBe(1);expect(z.current().id).toBe('c50');
  await z.step(-1);vi.advanceTimersByTime(450);await flush();expect(calls.tune).toEqual(['c50','c7']);
 });
 it('takes a typed number when no longer number can follow, on OK, or after a pause',async()=>{
  vi.useFakeTimers();const {z,calls}=zapper();await z.sync();calls.banner.length=0;
  await z.digit(2);await flush();vi.advanceTimersByTime(0);await flush();
  expect(calls.tune).toEqual(['c2']);
  // 7 could still become 701.
  await z.digit(7);await flush();expect(calls.tune).toEqual(['c2']);expect(calls.banner.pop()).toEqual({typed:'7'});
  vi.advanceTimersByTime(1800);await flush();vi.advanceTimersByTime(0);await flush();expect(calls.tune).toEqual(['c2','c7']);
  await z.digit(7);expect(z.typing()).toBe(true);expect(z.enter()).toBe(true);await flush();vi.advanceTimersByTime(0);await flush();
  expect(calls.tune).toEqual(['c2','c7']);// already on 7: nothing to tune
  expect(z.enter()).toBe(false);
  await z.digit(3);await flush();vi.advanceTimersByTime(1800);await flush();
  expect(calls.banner.pop()).toEqual({typed:'3',missing:true});
 });
 it('reports a refused tune and stays on the channel it was on',async()=>{
  vi.useFakeTimers();const {z,calls}=zapper({tune:()=>Promise.reject(new Error('no'))});
  await z.sync();await z.step(1);vi.advanceTimersByTime(450);await flush();
  expect(calls.banner.pop()).toEqual({failed:expect.objectContaining({id:'c7'})});expect(z.current().id).toBe('c5');expect(calls.reopen).toBe(0);
 });
 it('drops pending presses when Live is left',async()=>{
  vi.useFakeTimers();const {z,calls}=zapper();await z.sync();await z.step(1);z.stop();
  vi.advanceTimersByTime(1000);await flush();expect(calls.tune).toEqual([]);
 });
});
describe('Live TV zapping without channels',()=>{
 it('tells the banner there is nothing tuned on CH+/CH- or a typed number',async()=>{
  vi.useFakeTimers();const calls=[];
  const z=createZapper({channels:()=>Promise.resolve([]),currentId:()=>Promise.resolve(''),tune:()=>Promise.resolve(),reopen:()=>{},banner:s=>calls.push(s)});
  expect(await z.step(1)).toBeNull();expect(calls.pop()).toEqual({empty:true});
  await z.digit(5);await flush();vi.advanceTimersByTime(1800);await flush();
  expect(calls.pop()).toEqual({empty:true});
 });
});
