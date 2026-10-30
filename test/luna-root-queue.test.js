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
          command: unwrap(opts.parameters.command),
          rawCommand: opts.parameters.command,
          ok: function (stdout) { settle(opts.onSuccess, {returnValue: true, stdoutString: stdout}); },
          fail: function () { settle(opts.onFailure, {errorText: 'boom'}); },
          hang: function () { done = true; inFlight--; }
        });
      }
    }
  };
}

// execRoot wraps every command so the shell ends it at the limit; the tests
// look at the command inside the wrapper.
function unwrap(command) {
  const m = /^sh -c '((?:[^']|'\\'')*)' & __p=\$!; \( sleep (\d+); kill/.exec(command);
  return m ? m[1].replace(/'\\''/g, "'") : command;
}
function wrapperSeconds(command) {
  const m = /& __p=\$!; \( sleep (\d+); kill/.exec(command);
  return m ? Number(m[1]) : null;
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
    const {execRoot, ROOT_EXEC_GRACE_MS} = await loadLuna();
    const hung = execRoot('stuck', 5000);
    const next = execRoot('after', 5000);
    const hungResult = hung.catch((err) => err);
    await flush();
    expect(pending).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4999 + ROOT_EXEC_GRACE_MS);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await hungResult).message).toMatch(/timed out/);
    // The shell itself kills the command at the limit, before JS gives up.
    expect(wrapperSeconds(pending[0].rawCommand)).toBe(5);

    await flush();
    expect(pending.map((p) => p.command)).toEqual(['stuck', 'after']);
    pending[1].ok('ok');
    await expect(next).resolves.toMatchObject({stdoutString: 'ok'});
  });

  it('starts the timeout only when the command leaves the queue', async () => {
    const {execRoot, ROOT_EXEC_GRACE_MS} = await loadLuna();
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

    await vi.advanceTimersByTimeAsync(2000 + ROOT_EXEC_GRACE_MS);
    pending[1].ok('fast');
    await expect(quick).resolves.toMatchObject({stdoutString: 'fast'});
  });

  it('falls back to the default limit when no timeout is given', async () => {
    const {execRoot, ROOT_EXEC_TIMEOUT_MS, ROOT_EXEC_GRACE_MS} = await loadLuna();
    const res = execRoot('forever').catch((err) => err);
    await flush();
    await vi.advanceTimersByTimeAsync(ROOT_EXEC_TIMEOUT_MS + ROOT_EXEC_GRACE_MS - 1);
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

  it('runs interactive commands before queued maintenance ones', async () => {
    const {execRoot, execRootLater} = await loadLuna();
    execRoot('first');
    execRootLater('hooks');
    execRootLater('daemon');
    execRoot('zap');
    await flush();
    pending[0].ok('');
    await flush();
    expect(pending.map((p) => p.command)).toEqual(['first', 'zap']);
    pending[1].ok('');
    await flush();
    pending[2].ok('');
    await flush();
    pending[3].ok('');
    await flush();
    expect(pending.map((p) => p.command)).toEqual(['first', 'zap', 'hooks', 'daemon']);
    expect(maxInFlight).toBe(1);
  });

  it('runs a long command detached and reads its output between other commands', async () => {
    const {execRoot, execRootLong} = await loadLuna();
    const long = execRootLong('sh diagnostics.sh', 60000);
    await flush();
    expect(pending[0].command).toMatch(/setsid sh -c/);
    expect(pending[0].command).toMatch(/sh diagnostics\.sh/);
    pending[0].ok('started');
    await flush();
    // Nothing is read before the poll interval; an interactive command goes first.
    const zap = execRoot('tune 7');
    await flush();
    expect(pending[1].command).toBe('tune 7');
    pending[1].ok('tuned');
    await expect(zap).resolves.toMatchObject({stdoutString: 'tuned'});
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(pending[2].command).toMatch(/__running/);
    pending[2].ok('__running');
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    pending[3].ok('report line\n__rc=0\n');
    await expect(long).resolves.toMatchObject({stdoutString: 'report line'});
  });

  it('reports a detached command that exited non-zero with its output', async () => {
    const {execRootLong} = await loadLuna();
    const long = execRootLong('sh fails.sh', 30000).catch((err) => err);
    await flush();
    pending[0].ok('started');
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    pending[1].ok('missing_voice\n__rc=1\n');
    const err = await long;
    expect(err).toMatchObject({returnValue: false, stdoutString: 'missing_voice'});
  });

  it('marks a chosen input before launching it, so the boot guard leaves it alone', async () => {
    const {launchApp} = await loadLuna();
    launchApp('com.webos.app.livetv');
    await flush();
    expect(pending[0].command).toBe('touch /tmp/launch-home-user-input');
    expect(pending[0].uri).toBe('luna://org.webosbrew.hbchannel.service');
    expect(pending[1].uri).toBe('luna://com.webos.applicationManager');
  });
});
