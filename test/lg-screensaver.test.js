import {describe, expect, it} from 'vitest';
import {createLgScreensaverGuard, CLIENT_NAME} from '../src/js/lg-screensaver.js';

function fakeBus() {
  const calls = [];
  return {
    calls,
    request(uri, opts) {
      calls.push({uri, opts});
      return {cancel() { calls.push({cancelled: true}); }};
    },
    register() { return calls.find(c => c.opts && c.opts.method === 'registerScreenSaverRequest'); },
    responses() { return calls.filter(c => c.opts && c.opts.method === 'responseScreenSaverRequest').map(c => c.opts.parameters); }
  };
}

describe('LG screensaver guard', () => {
  it('registers under Cinema\'s name', () => {
    const bus = fakeBus();
    const guard = createLgScreensaverGuard({request: bus.request, hold: () => true});
    expect(guard.start()).toBe(true);
    expect(bus.register().uri).toBe('luna://com.webos.service.tvpower/power');
    expect(bus.register().opts.parameters).toEqual({subscribe: true, clientName: CLIENT_NAME});
    expect(guard.start()).toBe(true);
    expect(bus.calls.filter(c => c.opts && c.opts.method === 'registerScreenSaverRequest').length).toBe(1);
  });

  it('says no while Cinema holds the screen and yes otherwise', () => {
    const bus = fakeBus();
    let hold = true;
    const guard = createLgScreensaverGuard({request: bus.request, hold: () => hold});
    guard.start();
    const onSuccess = bus.register().opts.onSuccess;
    onSuccess({returnValue: true, subscribed: true});
    onSuccess({timestamp: 111});
    hold = false;
    onSuccess({timestamp: 222});
    expect(bus.responses()).toEqual([
      {clientName: CLIENT_NAME, ack: false, timestamp: 111},
      {clientName: CLIENT_NAME, ack: true, timestamp: 222}
    ]);
    expect(guard.status()).toEqual({registered: true, answers: 2, lastAck: true});
  });

  it('lets LG\'s screensaver run when the hold check throws', () => {
    const bus = fakeBus();
    const guard = createLgScreensaverGuard({request: bus.request, hold: () => { throw new Error('x'); }});
    guard.start();
    bus.register().opts.onSuccess({timestamp: 5});
    expect(bus.responses()[0].ack).toBe(true);
  });

  it('stops and can register again', () => {
    const bus = fakeBus();
    const guard = createLgScreensaverGuard({request: bus.request, hold: () => true});
    guard.start();
    guard.stop();
    expect(bus.calls.some(c => c.cancelled)).toBe(true);
    expect(guard.status().registered).toBe(false);
  });
});
