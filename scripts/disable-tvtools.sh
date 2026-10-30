#!/bin/sh
# Cinema: stop the TV tools daemon and give everything back to LG's settings:
# apps kept loaded, the LG settings it kept off, the services it stopped and
# the memory manager's list. Then remove the boot hooks, the state and the
# root copy. The hooks go at once; the restore (luna calls that can each wait
# seconds) runs detached and "disabled" is answered right away.
D=/var/lib/launch-home-cinema/tvtools
HOOK=/var/lib/webosbrew/init.d/55-cinema-tvtools
MEMHOOK=/var/lib/webosbrew/init.d/45-cinema-tvtools-memory
WDHOOK=/var/lib/webosbrew/init.d/55-hbchannel-watchdog
PY=$(command -v python3 || command -v python || true)
PID=$(cat /run/cinema-tvtools/tvtools.pid 2>/dev/null || true)
if [ -n "$PID" ] && grep -q tvtools.py "/proc/$PID/cmdline" 2>/dev/null; then kill "$PID" 2>/dev/null || true; fi
rm -f /run/cinema-tvtools/tvtools.pid "$HOOK" "$MEMHOOK" "$WDHOOK"
if [ -f "$D/hbchannel-watchdog.sh" ]; then sh "$D/hbchannel-watchdog.sh" stop >/dev/null 2>&1 || true; fi
rm -f /var/lib/launch-home-cinema/failsafe-rebooted
if [ -n "$PY" ] && [ -f "$D/tvtools.py" ]; then
  printf '{}' > /var/lib/launch-home-cinema/tvtools.json
  # tvtools.py uninstall: restore with an empty configuration, the key filter
  # out of the chain, the boot activity cancelled, then the state file and
  # the root copy removed (the state is needed by the restore: it goes last).
  setsid "$PY" "$D/tvtools.py" uninstall </dev/null >/dev/null 2>&1 &
else
  luna-send -i -n 1 -w 5000 luna://com.webos.service.activitymanager/cancel \
    '{"activityName":"org.webosbrew.lounge.launcher.failsafe-check"}' </dev/null >/dev/null 2>&1
  rm -f /var/lib/launch-home-cinema/tvtools-state.json
  rm -rf "$D"
fi
echo "disabled"
