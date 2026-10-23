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
fi
rm -rf "$D"
echo "disabled"
