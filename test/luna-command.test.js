import {describe, expect, it} from 'vitest';
import {lunaSendRootCommand} from '../src/js/luna.js';

describe('lunaSendRootCommand', () => {
  it('asks for compact JSON so a large reply fits in the exec output limit', () => {
    const command = lunaSendRootCommand('luna://com.webos.applicationManager/listApps', '{}', 5000);
    expect(command).toBe("luna-send -i -n 1 -w 5000 'luna://com.webos.applicationManager/listApps' '{}'");
    expect(command).not.toMatch(/ -f /);
  });

  it('escapes single quotes in the payload for the shell', () => {
    const command = lunaSendRootCommand('luna://x/y', '{"a":"it\'s"}');
    expect(command).toBe("luna-send -i -n 1 -w 4000 'luna://x/y' '{\"a\":\"it'\\''s\"}'");
  });
});

describe('rootWriteCommands', () => {
  it('writes root-only files from the first byte', async () => {
    const {rootWriteCommands} = await import('../src/js/luna.js');
    const cmds = rootWriteCommands('/var/lib/launch-home-cinema/jellyfin.json', '{"token":"x"}');
    expect(cmds.length).toBeGreaterThan(1);
    cmds.forEach((cmd) => expect(cmd.indexOf('umask 077 && ')).toBe(0));
  });
});
