import {describe, it, expect, beforeEach, vi} from 'vitest';

async function loadConfigModule() {
  vi.resetModules();
  return import('../src/js/config.js');
}

describe('settings storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps unreadable settings beside the key instead of losing them', async () => {
    localStorage.setItem('lounge.config.v1', '{"launcher": {broken');
    const config = await loadConfigModule();
    const loaded = config.loadConfig();
    expect(loaded.launcher).toBeTruthy();
    expect(config.configWasCorrupt()).toBe(true);
    expect(localStorage.getItem(config.CORRUPT_STORAGE_KEY)).toBe('{"launcher": {broken');
  });

  it('saveConfig reports a full storage instead of throwing', async () => {
    const config = await loadConfigModule();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };
    try {
      expect(config.saveConfig({launcher: {}})).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(config.saveConfig({launcher: {}})).toBe(true);
  });

  it('migrating old settings leaves music switched off and the dock as arranged', async () => {
    localStorage.setItem('lounge.config.v1', JSON.stringify({
      version: 5,
      launcher: {pinnedApps: ['netflix']},
      music: {enabled: false, volume: 0.1}
    }));
    const config = await loadConfigModule();
    const loaded = config.loadConfig();
    expect(loaded.music.enabled).toBe(false);
    expect(loaded.music.volume).toBe(0.1);
    expect(loaded.launcher.pinnedApps).toEqual(['netflix']);
  });
});
