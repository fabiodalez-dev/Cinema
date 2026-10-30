import {describe, it, expect} from 'vitest';
import {resolveVoiceLaunch, stripLaunchVerb} from '../src/js/voice-launch.js';

describe('voice launch phrases', () => {
  it('understands Italian verbs and articles', () => {
    expect(stripLaunchVerb('apri netflix')).toBe('netflix');
    expect(stripLaunchVerb("apri l'app youtube")).toBe('youtube');
    expect(stripLaunchVerb('vai su prime video')).toBe('prime video');
    expect(stripLaunchVerb('metti la tv')).toBe('tv');
  });

  it('resolves Italian requests to the same apps as English ones', () => {
    expect(resolveVoiceLaunch('apri netflix', {}).id).toBe('netflix');
    expect(resolveVoiceLaunch('open netflix', {}).id).toBe('netflix');
    expect(resolveVoiceLaunch('avvia disney più', {}).id).toBe('com.disney.disneyplus');
    expect(resolveVoiceLaunch('vai su prime video', {}).id).toBe('amazon.html');
    expect(resolveVoiceLaunch('apri le impostazioni', {}).id).toBe('com.webos.app.settings');
  });

  it('still leaves questions alone', () => {
    expect(resolveVoiceLaunch('che tempo fa domani a milano e dopodomani', {})).toBeNull();
    expect(resolveVoiceLaunch('what is the weather like', {})).toBeNull();
  });
});
