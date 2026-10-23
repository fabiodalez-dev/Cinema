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
