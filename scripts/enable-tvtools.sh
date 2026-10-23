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
for f in tvtools.py failsafe-check.sh; do
  cp "$APP_DIR/$f" "$D/$f.part"
  chmod 600 "$D/$f.part"
  mv -f "$D/$f.part" "$D/$f"
done
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
# A normal boot: failsafe-check.sh has nothing to do, and the loop guard of
# an automatic restart is cleared.
touch /run/cinema-boot-ok
rm -f /var/lib/launch-home-cinema/failsafe-rebooted
exit 0
HOOK
chmod 755 "$MEMHOOK.part"
mv -f "$MEMHOOK.part" "$MEMHOOK"
# A webOS activity of Cinema's own runs failsafe-check.sh at every boot, also
# when Homebrew Channel is in failsafe mode and runs no hook (the same
# mechanism Homebrew Channel uses for its own start).
"$PY" - "$D/failsafe-check.sh" <<'PYEOF'
import json, subprocess, sys
activity = {'activity': {
    'name': 'org.webosbrew.lounge.launcher.failsafe-check',
    'description': 'Cinema: restart the TV once after a failsafe boot',
    'type': {'foreground': True, 'persist': True, 'continuous': True},
    'trigger': {'method': 'luna://com.webos.bootManager/getBootStatus', 'params': {'subscribe': True},
                'where': {'prop': ['signals', 'core-boot-done'], 'op': '=', 'val': True}},
    'callback': {'method': 'luna://org.webosbrew.hbchannel.service/exec',
                 'params': {'command': 'sh ' + sys.argv[1]}}},
    'start': True, 'replace': True}
p = subprocess.Popen(['luna-send', '-i', '-n', '1', '-w', '5000', 'luna://com.webos.service.activitymanager/create',
                      json.dumps(activity)], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
out = p.stdout.read(); p.wait()
print('activity: ' + out.decode('utf-8', 'replace').replace('\n', ' ')[:200])
PYEOF

# Restart a running daemon so it reads the new copy and configuration.
PID=$(cat /run/cinema-tvtools/tvtools.pid 2>/dev/null || true)
if [ -n "$PID" ] && grep -q tvtools.py "/proc/$PID/cmdline" 2>/dev/null; then kill "$PID" 2>/dev/null || true; sleep 1; fi
rm -f /run/cinema-tvtools/tvtools.pid
setsid "$PY" "$D/tvtools.py" daemon </dev/null >/dev/null 2>&1 &
echo "enabled"
