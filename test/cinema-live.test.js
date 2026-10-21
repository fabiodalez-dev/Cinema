import {describe,it,expect,vi,afterEach} from 'vitest';
import {createLivePreview,liveSource,liveDevices} from '../src/js/cinema-live.js';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();document.body.innerHTML='';});
describe('Native Live TV preview',()=>{
 it('maps only known TV/external sources and keeps TV first without duplicates',()=>{
  expect(liveSource('TV')).toEqual({src:'tv://',type:'service/webos-broadcast'});
  expect(liveSource('HDMI_2').src).toBe('ext://hdmi:2');
  expect(liveSource('HDMI_5')).toBeNull();expect(liveSource('javascript:bad')).toBeNull();
  expect(liveDevices([{id:'HDMI_1'},{id:'LIVE_TV'},{id:'HDMI_1'}],{HDMI_1:'Console'}).map(d=>[d.id,d.label])).toEqual([['TV','Live TV'],['HDMI_1','Console']]);
 });
 it('releases the previous native pipeline before switching, and ignores stale events',async()=>{
  vi.useFakeTimers();
  const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  const load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  const status=vi.fn();const root=document.createElement('div');document.body.appendChild(root);
  const preview=createLivePreview(root,{supported:true,onStatus:status});
  preview.start('TV');const old=root.querySelector('video');const oldLoaded=old.onloadeddata;
  preview.start('HDMI_1');
  expect(old.isConnected).toBe(false);expect(old.querySelector('source')).toBeNull();
  expect(pause).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledOnce();expect(play).toHaveBeenCalledTimes(2);
  status.mockClear();oldLoaded();expect(status).not.toHaveBeenCalled();
  expect(root.querySelector('source').getAttribute('src')).toBe('ext://hdmi:1');
  preview.stop();vi.runAllTimers();expect(root.querySelector('video')).toBeNull();expect(status).not.toHaveBeenCalled();
 });
 it('keeps full-screen fallback available when preview fails or runs on desktop',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'play').mockRejectedValue(new Error('no pipeline'));
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  const status=vi.fn();const root=document.createElement('div');
  const preview=createLivePreview(root,{supported:true,onStatus:status});preview.start('TV');
  await Promise.resolve();expect(status).toHaveBeenLastCalledWith(expect.stringContaining('Riprova'),'error');preview.stop();
  expect(preview.start('UNKNOWN')).toBe(false);
  const desktop=createLivePreview(root,{supported:false,onStatus:status});expect(desktop.start('TV')).toBe(true);
  expect(root.querySelector('video')).toBeNull();expect(status).toHaveBeenLastCalledWith(expect.any(String),'desktop');
 });
});
