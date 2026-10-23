// Settings -> Salvaschermo -> Spegni la TV durante il salvaschermo: the TV is
// switched off after N hours of Cinema's screensaver with no key pressed.
// Started when the screensaver shows, cancelled when it hides, so a film or
// an app in use is never switched off (idea from TV Tools, MIT).
export function createScreensaverPowerOff(options) {
  let timer = null;
  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function shown() {
    cancel();
    const hours = Number(options.hours()) || 0;
    if (hours <= 0) return;
    timer = setTimeout(function () {
      timer = null;
      if (options.isShowing()) options.powerOff();
    }, hours * 3600 * 1000);
  }
  return {shown: shown, hidden: cancel, isArmed: function () { return timer !== null; }};
}
