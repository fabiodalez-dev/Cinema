import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

// Fake Luna bus: every hbchannel exec is parked until the test answers it.
let pending;
let inFlight;
let maxInFlight;

function installBus() {
  pending = [];
  inFlight = 0;
  maxInFlight = 0;
  window.PalmServiceBridge = function () {};
  window.webOS = {
    service: {
      request: function (uri, opts) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        let done = false;
        function settle(fn, value) {
          if (done) return;
          done = true;
          inFlight--;
          fn(value);
        }
        pending.push({
          uri: uri,
          command: opts.parameters.command,
          ok: function (stdout) { settle(opts.onSuccess, {returnValue: true, stdoutString: stdout}); },
          fail: function () { settle(opts.onFailure, {errorText: 'boom'}); },
          hang: function () { done = true; inFlight--; }
        });
      }
    }
  };
}

async function loadLuna() {
  vi.resetModules();
  return import('../src/js/luna.js');
}

// Let queued promise callbacks run.
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('execRoot queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installBus();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.PalmServiceBridge;
    delete window.webOS;
  });

  it('sends one command at a time, in call order', async () => {
    const {execRoot} = await loadLuna();
    const results = [execRoot('a'), execRoot('b'), execRoot('c')];
    await flush();
    expect(pending.map((p) => p.command)).toEqual(['a']);

    pending[0].ok('A');
    await flush();
    expect(pending.map((p) => p.command)).toEqual(['a', 'b']);
    pending[1].ok('B');
    await flush();
    pending[2].ok('C');

    const out = await Promise.all(results);
    expect(out.map((r) => r.stdoutString)).toEqual(['A', 'B', 'C']);
    expect(maxInFlight).toBe(1);
    expect(pending[0].uri).toBe('luna://org.webosbrew.hbchannel.service');
  });

  it('keeps going after a command fails', async () => {
    const {execRoot} = await loadLuna();
    const first = execRoot('bad');
    const second = execRoot('good');
    await flush();
    pending[0].fail();
    await expect(first).rejects.toBeTruthy();
    await flush();
    pending[1].ok('fine');
    await expect(second).resolves.toMatchObject({stdoutString: 'fine'});
  });

  it('abandons a hung command after its timeout and starts the next', async () => {
    const {execRoot} = await loadLuna();
    const hung = execRoot('stuck', 5000);
    const next = execRoot('after', 5000);
    const hungResult = hung.catch((err) => err);
    await flush();
    expect(pending).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await hungResult).message).toMatch(/timed out/);

    await flush();
    expect(pending.map((p) => p.command)).toEqual(['stuck', 'after']);
    pending[1].ok('ok');
    await expect(next).resolves.toMatchObject({stdoutString: 'ok'});
  });

  it('starts the timeout only when the command leaves the queue', async () => {
    const {execRoot} = await loadLuna();
    execRoot('slow', 10000);
    const quick = execRoot('quick', 3000);
    let quickSettled = false;
    quick.then(() => { quickSettled = true; }, () => { quickSettled = true; });
    await flush();

    // 'quick' waits 8 s behind 'slow' without timing out.
    await vi.advanceTimersByTimeAsync(8000);
    pending[0].ok('done');
    await flush();
    expect(quickSettled).toBe(false);
    expect(pending[1].command).toBe('quick');

    await vi.advanceTimersByTimeAsync(2000);
    pending[1].ok('fast');
    await expect(quick).resolves.toMatchObject({stdoutString: 'fast'});
  });

  it('falls back to the default limit when no timeout is given', async () => {
    const {execRoot, ROOT_EXEC_TIMEOUT_MS} = await loadLuna();
    const res = execRoot('forever').catch((err) => err);
    await flush();
    await vi.advanceTimersByTimeAsync(ROOT_EXEC_TIMEOUT_MS - 1);
    let settled = false;
    res.then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await res).message).toMatch(/timed out/);
  });

  it('serializes the parallel root calls fired on a Cinema cold start', async () => {
    const luna = await loadLuna();
    const calls = [
      luna.isHomeWatcherRunning(),
      luna.getAllInputStatusViaRoot(),
      luna.execRoot('cat /var/lib/launch-home-cinema/jellyfin.json', 5000),
      luna.execRoot('cat /tmp/launch-home-preview-ss')
    ];
    for (let i = 0; i < calls.length; i++) {
      await flush();
      expect(inFlight).toBe(1);
      pending[i].ok('{}');
    }
    await Promise.allSettled(calls);
    expect(pending).toHaveLength(calls.length);
    expect(maxInFlight).toBe(1);
  });
});
