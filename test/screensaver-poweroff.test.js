import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createScreensaverPowerOff} from '../src/js/screensaver-poweroff.js';

describe('screensaver power off', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function make(hours, showing) {
    const powerOff = vi.fn();
    const p = createScreensaverPowerOff({hours: () => hours, isShowing: () => showing.value, powerOff});
    return {p, powerOff};
  }
  it('switches the TV off after N hours of screensaver', () => {
    const showing = {value: true};
    const {p, powerOff} = make(2, showing);
    p.shown();
    vi.advanceTimersByTime(2 * 3600 * 1000 - 1);
    expect(powerOff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(powerOff).toHaveBeenCalledTimes(1);
  });
  it('a key press (screensaver hidden) cancels it', () => {
    const showing = {value: true};
    const {p, powerOff} = make(1, showing);
    p.shown();
    vi.advanceTimersByTime(30 * 60 * 1000);
    p.hidden();
    vi.advanceTimersByTime(3600 * 1000);
    expect(powerOff).not.toHaveBeenCalled();
  });
  it('never when set to Mai, and not if the screensaver is no longer showing', () => {
    const {p, powerOff} = make(0, {value: true});
    p.shown();
    expect(p.isArmed()).toBe(false);
    const showing = {value: true};
    const b = make(1, showing);
    b.p.shown();
    showing.value = false;
    vi.advanceTimersByTime(3600 * 1000);
    expect(b.powerOff).not.toHaveBeenCalled();
  });
});
