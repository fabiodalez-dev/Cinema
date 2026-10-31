// LG's own screensaver asks every registered app before it starts
// (tvpower registerScreenSaverRequest). While Cinema is in front and its
// own screensaver will take over, Cinema answers no; in the background, or
// with Cinema's screensaver switched off, it answers yes and LG's runs as
// before. Without this LG's timer only stays out of the way because Cinema
// pushes it to its longest value. Idea from Free My TV (MIT).
const TVPOWER = 'luna://com.webos.service.tvpower/power';

export const CLIENT_NAME = 'org.webosbrew.lounge.launcher';

/**
 * @param {object} options
 * @param {(uri: string, options: object) => any} options.request  webOS.service.request
 * @param {() => boolean} options.hold  true while Cinema's screensaver is the one to show
 * @param {(asked: object, ack: boolean) => void} [options.onAnswer]
 */
export function createLgScreensaverGuard(options) {
  let handle = null;
  let answers = 0;
  let last = null;

  function answer(message) {
    if (!message || message.timestamp === undefined) return;
    let hold = false;
    try { hold = !!options.hold(); } catch (err) { hold = false; }
    const ack = !hold;
    answers += 1;
    last = ack;
    options.request(TVPOWER, {
      method: 'responseScreenSaverRequest',
      parameters: {clientName: CLIENT_NAME, ack: ack, timestamp: message.timestamp},
      onSuccess: function () {},
      onFailure: function () {}
    });
    if (options.onAnswer) options.onAnswer(message, ack);
  }

  function start() {
    if (handle) return true;
    try {
      handle = options.request(TVPOWER, {
        method: 'registerScreenSaverRequest',
        parameters: {subscribe: true, clientName: CLIENT_NAME},
        onSuccess: answer,
        onFailure: function () { handle = null; }
      }) || {};
    } catch (err) {
      handle = null;
    }
    return !!handle;
  }

  function stop() {
    if (handle && typeof handle.cancel === 'function') {
      try { handle.cancel(); } catch (err) { /* ignore */ }
    }
    handle = null;
  }

  return {
    start: start,
    stop: stop,
    status: function () { return {registered: !!handle, answers: answers, lastAck: last}; }
  };
}
