import {it,expect,vi,afterEach} from 'vitest';
import {createLiveControls} from '../src/js/cinema-live-controls.js';
afterEach(()=>vi.useRealTimers());
it('hides after ten seconds and resets the deadline on interaction',()=>{
 vi.useFakeTimers();const paint=vi.fn();const c=createLiveControls({isEligible:()=>true,onHidden:paint});c.enter();vi.advanceTimersByTime(9999);expect(c.isHidden()).toBe(false);c.activity();vi.advanceTimersByTime(9999);expect(c.isHidden()).toBe(false);vi.advanceTimersByTime(1);expect(c.isHidden()).toBe(true);expect(c.activity()).toBe(true);expect(c.isHidden()).toBe(false);expect(paint.mock.calls.map(a=>a[0])).toEqual([true,false]);
});
it('fullscreen hides immediately without launching another app',()=>{
 vi.useFakeTimers();const c=createLiveControls({isEligible:()=>true,onHidden:vi.fn()});c.enter();c.hide();expect(c.isHidden()).toBe(true);vi.advanceTimersByTime(20000);expect(c.isHidden()).toBe(true);
});
it('pauses for overlays and gets a fresh deadline when they close',()=>{
 vi.useFakeTimers();let eligible=true;const c=createLiveControls({isEligible:()=>eligible,onHidden:vi.fn()});c.enter();vi.advanceTimersByTime(9000);eligible=false;c.pause();vi.advanceTimersByTime(20000);expect(c.isHidden()).toBe(false);eligible=true;c.resume();vi.advanceTimersByTime(10000);expect(c.isHidden()).toBe(true);
});
it('leaving releases the timer and never hides another page later',()=>{
 vi.useFakeTimers();const paint=vi.fn();const c=createLiveControls({isEligible:()=>true,onHidden:paint});c.enter();c.leave();vi.runAllTimers();expect(paint).not.toHaveBeenCalled();expect(c.activity()).toBe(false);
});
