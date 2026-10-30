import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The photo sources ask the TV for USB folders (Luna); not here.
vi.mock('../src/js/usb.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    resolveLoungePaths: vi.fn(async () => ({root: '', usbConfig: null, musicPath: '', backgroundPath: ''}))
  });
});

import {createBackgroundController} from '../src/js/background.js';
import {AERIAL_BACKGROUNDS} from '../src/js/aerials.js';

let controller = null;

afterEach(() => {
  if (controller && typeof controller.destroy === 'function') controller.destroy();
  controller = null;
  document.body.className = '';
});

function makeElements() {
  return {
    backgroundLayer: document.createElement('div'),
    scrim: document.createElement('div')
  };
}

function aerialConfig(overrides) {
  return {
    profile: 'default',
    launcher: {},
    background: Object.assign({
      source: 'aerial',
      mode: 'static',
      aerial: AERIAL_BACKGROUNDS[0].id,
      shuffle: false
    }, overrides)
  };
}

function mount(config) {
  const elements = makeElements();
  const changes = [];
  elements.onAerialChange = function (change) { changes.push(change); };
  controller = createBackgroundController(elements, function () { return config; });
  return {elements: elements, changes: changes};
}

describe('background controller: aerial channel stepping', () => {
  it('steps the aerial catalog in Single mode, in settings order', async () => {
    const config = aerialConfig({});
    const mounted = mount(config);
    await controller.refresh();

    const next = controller.stepAerial(1);
    expect(next).toEqual({
      id: AERIAL_BACKGROUNDS[1].id,
      title: AERIAL_BACKGROUNDS[1].title,
      mode: 'single'
    });
    expect(mounted.changes).toEqual([next]);

    const back = controller.stepAerial(-1);
    expect(back.id).toBe(AERIAL_BACKGROUNDS[0].id);
  });

  it('wraps Single mode at both ends of the catalog', async () => {
    const config = aerialConfig({});
    mount(config);
    await controller.refresh();

    const first = controller.stepAerial(-1);
    expect(first.id).toBe(AERIAL_BACKGROUNDS[AERIAL_BACKGROUNDS.length - 1].id);

    const wrapped = controller.stepAerial(1);
    expect(wrapped.id).toBe(AERIAL_BACKGROUNDS[0].id);
  });

  it('steps the playing order in Slideshow mode and wraps', async () => {
    const config = aerialConfig({mode: 'slideshow'});
    mount(config);
    await controller.refresh();

    const second = controller.stepAerial(1);
    expect(second.id).toBe(AERIAL_BACKGROUNDS[1].id);
    expect(second.mode).toBe('slideshow');

    const third = controller.stepAerial(1);
    expect(third.id).toBe(AERIAL_BACKGROUNDS[2].id);
  });

  it('wraps Slideshow mode at the start of the order', async () => {
    const config = aerialConfig({mode: 'slideshow'});
    mount(config);
    await controller.refresh();

    const last = controller.stepAerial(-1);
    expect(last.id).toBe(AERIAL_BACKGROUNDS[AERIAL_BACKGROUNDS.length - 1].id);
  });

  it('does nothing when the resolved source is not aerial', async () => {
    const config = aerialConfig({source: 'preset', preset: 'warm-gradient'});
    const mounted = mount(config);
    await controller.refresh();

    expect(controller.stepAerial(1)).toBeNull();
    expect(mounted.changes).toEqual([]);
  });

  it('does nothing when the aerial wallpaper fell back to the gradient', async () => {
    const config = aerialConfig({});
    const mounted = mount(config);
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {value: false, configurable: true});
    try {
      await controller.refresh();
      expect(controller.stepAerial(1)).toBeNull();
      expect(mounted.changes).toEqual([]);
    } finally {
      if (original) Object.defineProperty(window.navigator, 'onLine', original);
    }
  });
});

describe('background controller: online wallpaper that does not load', () => {
  // jsdom never loads images; this Image fails every URL on the next tick.
  class FailingImage {
    set src(value) {
      this._src = value;
      const self = this;
      setTimeout(function () { if (self.onerror) self.onerror(new Event('error')); }, 0);
    }
    get src() { return this._src; }
  }

  beforeEach(() => {
    vi.stubGlobal('Image', FailingImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function urlConfig(overrides) {
    return {
      profile: 'default',
      launcher: {},
      background: Object.assign({
        source: 'url',
        mode: 'static',
        preset: 'warm-gradient',
        url: 'https://example.org/gallery/page-not-an-image'
      }, overrides)
    };
  }

  it('falls back to the gradient and reports the link once (static)', async () => {
    const mounted = mount(urlConfig({}));
    const toasts = [];
    mounted.elements.onToast = function (message) { toasts.push(message); };

    await expect(controller.refresh()).resolves.toBeUndefined();

    expect(toasts.length).toBe(1);
    expect(toasts[0]).toMatch(/direct image link/);
    expect(mounted.elements.backgroundLayer.classList.contains('has-image')).toBe(false);
    expect(mounted.elements.backgroundLayer.style.backgroundImage).toMatch(/linear-gradient/);

    // Same link again: already reported.
    await controller.refresh();
    expect(toasts.length).toBe(1);
  });

  it('falls back to the gradient and reports once for a slideshow list', async () => {
    const mounted = mount(urlConfig({
      mode: 'slideshow',
      url: '',
      urls: ['https://example.org/a/not-an-image', 'https://example.org/b/not-an-image']
    }));
    const toasts = [];
    mounted.elements.onToast = function (message) { toasts.push(message); };

    await expect(controller.refresh()).resolves.toBeUndefined();

    expect(toasts.length).toBe(1);
    expect(mounted.elements.backgroundLayer.classList.contains('has-image')).toBe(false);
  });
});

describe('background controller: photo crossfade', () => {
  // Every URL loads at once, decoded.
  class LoadingImage {
    set src(value) {
      this._src = value;
      const self = this;
      setTimeout(function () { if (self.onload) self.onload(new Event('load')); }, 0);
    }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  }

  beforeEach(() => {
    vi.stubGlobal('Image', LoadingImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fades the decoded photo in on the overlay, then hands it to the layer', async () => {
    vi.useFakeTimers();
    try {
      const mounted = mount({
        profile: 'default',
        launcher: {},
        background: {source: 'url', mode: 'static', url: 'https://example.org/photo.jpg'}
      });
      const layer = mounted.elements.backgroundLayer;
      const refreshed = controller.refresh();
      await vi.advanceTimersByTimeAsync(10);
      await refreshed;

      const overlay = layer.querySelector('.background-photo');
      expect(overlay).not.toBeNull();
      expect(overlay.classList.contains('is-front')).toBe(true);
      expect(overlay.style.backgroundImage).toContain('photo.jpg');
      expect(layer.classList.contains('has-image')).toBe(true);
      // The layer still shows what was there until the fade is over.
      expect(layer.style.backgroundImage).not.toContain('photo.jpg');

      await vi.advanceTimersByTimeAsync(700);
      expect(layer.style.backgroundImage).toContain('photo.jpg');
      expect(overlay.classList.contains('is-front')).toBe(false);
      expect(overlay.classList.contains('is-settled')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
