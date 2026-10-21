/* Optional, reversible launch-parameter adapter for Litefin 2.x.
 * No authentication or playback logic is changed. Uses Litefin's own router.
 */
(function () {
  'use strict';
  var timer = null;
  function parse(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw.params || raw;
    try { return parse(JSON.parse(raw)); } catch (_) { return {}; }
  }
  function handle(raw) {
    var p = parse(raw);
    if (p.cinemaPage !== 'discover' && !/^[a-f0-9]{32}$/i.test(p.cinemaItemId || '')) return;
    clearTimeout(timer);
    var attempts = 0;
    function open() {
      if (!window.router || typeof window.router.navigate !== 'function') {
        if (++attempts < 40) timer = setTimeout(open, 250);
        return;
      }
      var path = p.cinemaPage === 'discover' ? '/discover' : p.cinemaAction === 'resume'
        ? '/player/' + p.cinemaItemId + '/false?fromDetails=true'
        : '/details/' + p.cinemaItemId;
      // Preserve a useful Back target; app-native routing owns everything else.
      if (typeof window.router.setHistory === 'function') window.router.setHistory(['/home']);
      window.router.navigate(path);
    }
    timer = setTimeout(open, 250);
  }
  document.addEventListener('webOSRelaunch', function (event) {
    handle(event.detail || (window.PalmSystem && window.PalmSystem.launchParams));
  });
  if (window.PalmSystem) handle(window.PalmSystem.launchParams);
}());
