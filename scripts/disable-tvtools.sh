#!/bin/sh
# Cinema: stop the TV tools daemon and give everything back to LG's settings:
# apps kept loaded, the LG settings it kept off, the services it stopped and
# the memory manager's list. Then remove the boot hook and the root copy.
D=/var/lib/launch-home-cinema/tvtools
HOOK=/var/lib/webosbrew/init.d/55-cinema-tvtools
MEMHOOK=/var/lib/webosbrew/init.d/45-cinema-tvtools-memory
PY=$(command -v python3 || command -v python || true)
PID=$(cat /run/cinema-tvtools/tvtools.pid 2>/dev/null || true)
if [ -n "$PID" ] && grep -q tvtools.py "/proc/$PID/cmdline" 2>/dev/null; then kill "$PID" 2>/dev/null || true; fi
rm -f /run/cinema-tvtools/tvtools.pid "$HOOK" "$MEMHOOK"
if [ -n "$PY" ] && [ -f "$D/tvtools.py" ]; then
  printf '{}' > /var/lib/launch-home-cinema/tvtools.json
  "$PY" "$D/tvtools.py" apply
  "$PY" "$D/tvtools.py" restore-keys
fi
# The boot activity of failsafe-check.sh (see enable-tvtools.sh).
luna-send -i -n 1 -w 5000 luna://com.webos.service.activitymanager/cancel \
  '{"activityName":"org.webosbrew.lounge.launcher.failsafe-check"}' </dev/null >/dev/null 2>&1
rm -f /var/lib/launch-home-cinema/failsafe-rebooted
rm -rf "$D"
echo "disabled"
