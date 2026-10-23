#!/bin/sh
# Cinema: install and (re)start the TV tools daemon (Settings -> TV), as root.
# The daemon runs from a root-only copy: app folders under /media/developer
# are writable by every app, and a boot hook must never run code from there.
#   sh enable-tvtools.sh <app-dir>
set -e
APP_DIR=${1:-/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher}
D=/var/lib/launch-home-cinema/tvtools
HOOK=/var/lib/webosbrew/init.d/55-cinema-tvtools
MEMHOOK=/var/lib/webosbrew/init.d/45-cinema-tvtools-memory
PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || { echo "no-python"; exit 2; }
mkdir -p /var/lib/launch-home-cinema "$D"
chown root:root /var/lib/launch-home-cinema "$D"
chmod 700 /var/lib/launch-home-cinema "$D"
cp "$APP_DIR/tvtools.py" "$D/tvtools.py.part"
chmod 600 "$D/tvtools.py.part"
mv -f "$D/tvtools.py.part" "$D/tvtools.py"
mkdir -p /var/lib/webosbrew/init.d
cat > "$HOOK.part" <<HOOK
#!/bin/sh
# Cinema TV tools: keeps LG's extras off (Cinema -> Settings -> TV).
# Turn it off from Cinema's settings, or delete this file and restart the TV.
[ -f $D/tvtools.py ] || exit 0
setsid $PY $D/tvtools.py daemon </dev/null >/dev/null 2>&1 &
exit 0
HOOK
chmod 755 "$HOOK.part"
mv -f "$HOOK.part" "$HOOK"
# The memory manager reads its list at start, before /home is mounted, and
# restarting it closes the apps it tracks: so it runs here, synchronously and
# before 50-launch-home-boot brings Cinema up.
cat > "$MEMHOOK.part" <<HOOK
#!/bin/sh
# Cinema TV tools: Cinema and Bloomee kept in memory (Cinema -> Settings -> TV).
[ -f $D/tvtools.py ] || exit 0
$PY $D/tvtools.py memory </dev/null >/dev/null 2>&1
exit 0
HOOK
chmod 755 "$MEMHOOK.part"
mv -f "$MEMHOOK.part" "$MEMHOOK"
# Restart a running daemon so it reads the new copy and configuration.
PID=$(cat /run/cinema-tvtools/tvtools.pid 2>/dev/null || true)
if [ -n "$PID" ] && grep -q tvtools.py "/proc/$PID/cmdline" 2>/dev/null; then kill "$PID" 2>/dev/null || true; sleep 1; fi
rm -f /run/cinema-tvtools/tvtools.pid
setsid "$PY" "$D/tvtools.py" daemon </dev/null >/dev/null 2>&1 &
echo "enabled"
