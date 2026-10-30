import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {createFocusManager} from '../src/js/focus.js';

const onNumber = vi.fn();
const onChannelUp = vi.fn();
const onChannelDown = vi.fn();
const onBlue = vi.fn();
let root;

function press(keyCode, key, repeat) {
  const event = new KeyboardEvent('keydown', {key: key || '', bubbles: true, cancelable: true, repeat: !!repeat});
  Object.defineProperty(event, 'keyCode', {value: keyCode});
  document.dispatchEvent(event);
  return event;
}

// jsdom has no layout: give a tile a place on screen.
function tileAt(x, index) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'app-tile focusable';
  tile.dataset.focusIndex = String(index);
  const rect = {left: x, top: 900, width: 80, height: 80, right: x + 80, bottom: 980, x: x, y: 900};
  tile.getBoundingClientRect = function () { return rect; };
  tile.getClientRects = function () { return [rect]; };
  return tile;
}

beforeAll(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  createFocusManager(root, {
    nativeTvKeys: function(){return document.body.classList.contains("test-live");},
    onNumber: onNumber,
    onChannelUp: onChannelUp,
    onChannelDown: onChannelDown,
    onBlue: onBlue
  });
});

afterEach(() => {
  onNumber.mockClear();
  onChannelUp.mockClear();
  onChannelDown.mockClear();
  onBlue.mockClear();
  document.body.className = '';
  root.innerHTML = '';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});

afterAll(() => {
  root.remove();
});

describe('number-key routing', () => {
  it('calls onNumber with the digit on the home screen', () => {
    press(49, '1');
    expect(onNumber).toHaveBeenCalledWith(1);
    press(57, '9');
    expect(onNumber).toHaveBeenCalledWith(9);
  });

  it('maps the numeric keypad too', () => {
    press(97, '');
    expect(onNumber).toHaveBeenCalledWith(1);
  });

  it('ignores 0 and non-number keys', () => {
    press(48, '0');
    press(37, 'ArrowLeft');
    press(13, 'Enter');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while a settings text field is being edited', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = false;
    input.dataset.tvEdit = '1';
    root.appendChild(input);
    input.focus();
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while Settings is open', () => {
    document.body.classList.add('settings-open');
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });

  it('ignores numbers while the All apps overlay is open', () => {
    const overlay = document.createElement('div');
    overlay.className = 'all-apps';
    overlay.appendChild(document.createElement('button'));
    root.appendChild(overlay);
    press(49, '1');
    expect(onNumber).not.toHaveBeenCalled();
  });
});

describe('native TV key routing',()=>{
  it('leaves numbers, volume and channel keys to the platform while Live is open',()=>{
    document.body.classList.add('test-live');
    expect(press(49,'1').defaultPrevented).toBe(false);
    expect(press(447).defaultPrevented).toBe(false);
    expect(press(427).defaultPrevented).toBe(false);
    expect(onNumber).not.toHaveBeenCalled();expect(onChannelUp).not.toHaveBeenCalled();
  });
});

describe('channel-key routing', () => {
  it('fires onChannelUp / onChannelDown for the remote keycodes', () => {
    press(427);
    expect(onChannelUp).toHaveBeenCalledTimes(1);
    press(428);
    expect(onChannelDown).toHaveBeenCalledTimes(1);
  });

  it('normalises the ChannelUp / ChannelDown keyboard keys', () => {
    press(0, 'ChannelUp');
    expect(onChannelUp).toHaveBeenCalledTimes(1);
    press(0, 'ChannelDown');
    expect(onChannelDown).toHaveBeenCalledTimes(1);
  });

  it('does not fire for other keys', () => {
    press(37, 'ArrowLeft');
    press(38, 'ArrowUp');
    press(403, 'Red');
    press(13, 'Enter');
    press(49, '1');
    expect(onChannelUp).not.toHaveBeenCalled();
    expect(onChannelDown).not.toHaveBeenCalled();
  });
});

describe('blue-key routing', () => {
  it('fires onBlue for the remote keycode', () => {
    press(406);
    expect(onBlue).toHaveBeenCalledTimes(1);
  });

  it('does not fire onBlue for other colour keys', () => {
    press(403);
    press(404);
    press(405);
    expect(onBlue).not.toHaveBeenCalled();
  });
});

describe('spatial navigation on key repeat', () => {
  it('moves once per animation frame while an arrow key repeats', async () => {
    const grid = document.createElement('section');
    grid.id = 'app-grid';
    const first = tileAt(0, 0);
    const second = tileAt(100, 1);
    const third = tileAt(200, 2);
    grid.appendChild(first);
    grid.appendChild(second);
    grid.appendChild(third);
    root.appendChild(grid);
    first.focus();
    expect(document.activeElement).toBe(first);

    press(39, 'ArrowRight');
    expect(document.activeElement).toBe(second);

    // A repeat in the same frame is dropped (still consumed).
    const repeated = press(39, 'ArrowRight', true);
    expect(repeated.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);

    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    press(39, 'ArrowRight', true);
    expect(document.activeElement).toBe(third);
  });

  it('always moves on a fresh press', () => {
    const grid = document.createElement('section');
    grid.id = 'app-grid';
    const first = tileAt(0, 0);
    const second = tileAt(100, 1);
    const third = tileAt(200, 2);
    grid.appendChild(first);
    grid.appendChild(second);
    grid.appendChild(third);
    root.appendChild(grid);
    first.focus();

    press(39, 'ArrowRight');
    press(39, 'ArrowRight');
    expect(document.activeElement).toBe(third);
  });
});
