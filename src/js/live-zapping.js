// Channel zapping on Cinema's embedded Live TV picture, as on LG's own Live TV:
// CH+/CH- step through the channels, number keys type a channel number, and a
// banner shows the channel. The tuner moves by making the channel the TV's last
// one and reopening tv://, so LG's Live TV never comes to the front.

/** Channels CH+/CH- step through: watchable TV channels, in number order. */
export function zapChannels(list) {
  return (list || []).filter(function (c) {
    return c && c.id && !c.hidden && !c.radio;
  }).map(function (c, i) { return {c: c, i: i}; }).sort(function (a, b) {
    return (numberOf(a.c) - numberOf(b.c)) || (a.i - b.i);
  }).map(function (x) { return x.c; });
}

function numberOf(channel) {
  const n = parseFloat(String(channel.number));
  return isNaN(n) ? Infinity : n;
}

/** The channel `delta` steps from `currentId`, wrapping around the list. */
export function stepChannel(list, currentId, delta) {
  if (!list.length) return null;
  const i = list.findIndex(function (c) { return c.id === currentId; });
  if (i < 0) return delta > 0 ? list[0] : list[list.length - 1];
  return list[(i + delta % list.length + list.length) % list.length];
}

/** The visible channel (radio too) whose number is `typed`, or null. */
export function channelByNumber(list, typed) {
  const visible = (list || []).filter(function (c) { return c && c.id && !c.hidden; });
  return visible.find(function (c) { return String(c.number) === typed; }) ||
    visible.find(function (c) { return numberOf(c) === Number(typed); }) || null;
}

// No other channel number starts with `typed`: nothing left to wait for.
function typedComplete(list, typed) {
  return !(list || []).some(function (c) {
    const n = String(c && c.number);
    return !c.hidden && n.length > typed.length && n.indexOf(typed) === 0;
  });
}

/**
 * options:
 *   channels()     Promise of the channel list ({id, number, name, radio, hidden})
 *   currentId()    Promise of the id the tuner is on
 *   tune(channel)  Promise; moves the tuner (the last channel)
 *   reopen()       reopens the embedded picture on the tuned channel
 *   banner(state)  {channel} | {typed} | {typed, missing: true} | {failed: channel}
 *                  | {empty: true} (no channel tuned on this TV)
 *   delay          ms CH+/CH- presses are gathered before tuning (default 450)
 *   typeDelay      ms after the last digit before the number is taken (default 1800)
 */
export function createZapper(options) {
  const delay = options.delay === undefined ? 450 : options.delay;
  const typeDelay = options.typeDelay === undefined ? 1800 : options.typeDelay;
  let current = null, target = null, typed = '';
  let stepTimer = null, typeTimer = null, tuning = false, generation = 0;

  function list() { return Promise.resolve(options.channels()).then(function (l) { return l || []; }); }

  function apply() {
    stepTimer = null;
    if (tuning || !target || (current && target.id === current.id)) return;
    const channel = target, mark = generation;
    tuning = true;
    Promise.resolve(options.tune(channel)).then(function () {
      if (mark !== generation) return;
      current = channel;
      options.reopen(channel);
    }, function () {
      if (mark !== generation) return;
      target = current;
      options.banner({failed: channel});
    }).then(function () {
      if (mark !== generation) return;
      tuning = false;
      // More presses while the tuner was moving: follow them.
      if (target && current && target.id !== current.id) apply();
    });
  }

  function aim(channel, wait) {
    target = channel;
    options.banner({channel: channel});
    clearTimeout(stepTimer);
    stepTimer = setTimeout(apply, wait);
  }

  function takeTyped() {
    clearTimeout(typeTimer); typeTimer = null;
    const number = typed; typed = '';
    if (!number) return Promise.resolve(false);
    return list().then(function (l) {
      const channel = channelByNumber(l, number);
      if (!channel) { options.banner(l.length ? {typed: number, missing: true} : {empty: true}); return false; }
      aim(channel, 0);
      return true;
    });
  }

  return {
    /** CH+ (1) or CH- (-1). */
    step: function (delta) {
      typed = ''; clearTimeout(typeTimer); typeTimer = null;
      return list().then(function (l) {
        const base = target || current;
        const next = stepChannel(zapChannels(l), base && base.id, delta);
        if (next) aim(next, delay);
        else options.banner({empty: true});
        return next;
      });
    },
    /** A number key. */
    digit: function (d) {
      typed = (typed.length >= 4 ? '' : typed) + String(d);
      options.banner({typed: typed});
      clearTimeout(typeTimer);
      const now = typed;
      return list().then(function (l) {
        if (typed !== now) return;
        if (typed.length >= 4 || (channelByNumber(l, typed) && typedComplete(l, typed))) takeTyped();
        else typeTimer = setTimeout(takeTyped, typeDelay);
      });
    },
    /** Straight to `channel` (the Channels strip). */
    go: function (channel) {
      typed = ''; clearTimeout(typeTimer); typeTimer = null;
      if (channel) aim(channel, 0);
    },
    /** OK while a number is being typed takes it at once; false otherwise. */
    enter: function () {
      if (!typed) return false;
      takeTyped();
      return true;
    },
    typing: function () { return !!typed; },
    /** Read which channel the tuner is on (entering Live) and show it. */
    sync: function () {
      const mark = ++generation;
      typed = ''; clearTimeout(typeTimer); clearTimeout(stepTimer); tuning = false;
      return Promise.all([list(), Promise.resolve(options.currentId())]).then(function (r) {
        if (mark !== generation) return null;
        current = target = r[0].find(function (c) { return c.id === r[1]; }) || null;
        if (current) options.banner({channel: current});
        return current;
      }, function () { return null; });
    },
    /** Leaving Live: drop pending presses. */
    stop: function () {
      generation++;
      typed = ''; clearTimeout(typeTimer); clearTimeout(stepTimer); tuning = false;
      target = current;
    },
    current: function () { return current; }
  };
}
