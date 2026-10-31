#!/bin/sh
# Cinema: install and (re)start the TV tools daemon (Settings -> TV), as root.
# The daemon runs from a root-only copy: app folders under /media/developer
# are writable by every app, and a boot hook must never run code from there.
#   sh enable-tvtools.sh <app-dir>
set -e
APP_DIR=${1:-/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher}
APPINFO=/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher/appinfo.json
D=/var/lib/launch-home-cinema/tvtools
HOOK=/var/lib/webosbrew/init.d/55-cinema-tvtools
MEMHOOK=/var/lib/webosbrew/init.d/45-cinema-tvtools-memory
WDHOOK=/var/lib/webosbrew/init.d/55-hbchannel-watchdog
PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || { echo "no-python"; exit 2; }
mkdir -p /var/lib/launch-home-cinema "$D"
chown root:root /var/lib/launch-home-cinema "$D"
chmod 700 /var/lib/launch-home-cinema "$D"
# A new ambilight.py: the running one is stopped (it gives the strip its room
# light and lets it go); the daemon starts the new one within 20 s.
if [ -f "$APP_DIR/ambilight.py" ] && ! cmp -s "$APP_DIR/ambilight.py" "$D/ambilight.py"; then
  APID=$(cat /run/cinema-tvtools/ambilight.pid 2>/dev/null || true)
  if [ -n "$APID" ] && grep -q ambilight "/proc/$APID/cmdline" 2>/dev/null; then kill "$APID" 2>/dev/null || true; fi
fi
for f in tvtools.py ambilight.py failsafe-check.sh hbchannel-watchdog.sh; do
  [ -f "$APP_DIR/$f" ] || continue
  cp "$APP_DIR/$f" "$D/$f.part"
  chmod 600 "$D/$f.part"
  mv -f "$D/$f.part" "$D/$f"
done
[ -f "$D/tvtools.py" ] || { echo "missing tvtools.py"; exit 2; }
mkdir -p /var/lib/webosbrew/init.d

# $1 written from $1.part only when the content changed: the hooks are on
# flash and this runs at every start of Cinema.
place() {
  chmod 755 "$1.part"
  if cmp -s "$1.part" "$1" 2>/dev/null; then
    rm -f "$1.part"
  else
    mv -f "$1.part" "$1"
  fi
}

cat > "$HOOK.part" <<HOOK
#!/bin/sh
# Cinema TV tools: keeps LG's extras off (Cinema -> Settings -> TV).
# Turn it off from Cinema's settings, or delete this file and restart the TV.
[ -f $D/tvtools.py ] || exit 0
# Cinema uninstalled (its folder gone, the apps partition there): give LG its
# settings back and remove the tools, this hook included.
if [ -d /media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel ] && [ ! -f $APPINFO ]; then
  $PY $D/tvtools.py uninstall </dev/null >/dev/null 2>&1
  exit 0
fi
setsid $PY $D/tvtools.py daemon </dev/null >/dev/null 2>&1 &
exit 0
HOOK
place "$HOOK"
# The memory manager reads its list at start, before /home is mounted, and
# restarting it closes the apps it tracks: so it runs here, synchronously and
# before 50-launch-home-boot brings Cinema up.
cat > "$MEMHOOK.part" <<HOOK
#!/bin/sh
# Cinema TV tools: Cinema and Bloomee kept in memory (Cinema -> Settings -> TV).
# First of all, whatever Python does: a normal boot, so failsafe-check.sh has
# nothing to do, and the loop guard of an automatic restart is cleared.
touch /run/cinema-boot-ok
rm -f /var/lib/launch-home-cinema/failsafe-rebooted
[ -f $D/tvtools.py ] || exit 0
$PY $D/tvtools.py memory </dev/null >/dev/null 2>&1
exit 0
HOOK
place "$MEMHOOK"
# The Homebrew Channel service watchdog (hbchannel-watchdog.sh), from the
# root copy, when Cinema ships it.
if [ -f "$D/hbchannel-watchdog.sh" ]; then
  cat > "$WDHOOK.part" <<HOOK
#!/bin/sh
# Cinema: unsticks the Homebrew Channel root service (hbchannel-watchdog.sh).
[ -f $D/hbchannel-watchdog.sh ] || exit 0
sh $D/hbchannel-watchdog.sh </dev/null >/dev/null 2>&1
exit 0
HOOK
  place "$WDHOOK"
  sh "$D/hbchannel-watchdog.sh" </dev/null >/dev/null 2>&1 || true
fi

# Restart a running daemon so it reads the new copy and configuration.
PID=$(cat /run/cinema-tvtools/tvtools.pid 2>/dev/null || true)
if [ -n "$PID" ] && grep -q tvtools.py "/proc/$PID/cmdline" 2>/dev/null; then kill "$PID" 2>/dev/null || true; sleep 1; fi
rm -f /run/cinema-tvtools/tvtools.pid
setsid "$PY" "$D/tvtools.py" daemon </dev/null >/dev/null 2>&1 &

# A webOS activity of Cinema's own runs failsafe-check.sh at every boot, also
# when Homebrew Channel is in failsafe mode and runs no hook (the same
# mechanism Homebrew Channel uses for its own start). A failure here (the
# activity manager busy, luna-send missing) is reported and does not stop the
# enable: the daemon is already running.
"$PY" - "$D/failsafe-check.sh" <<'PYEOF' || true
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
try:
    p = subprocess.Popen(['luna-send', '-i', '-n', '1', '-w', '5000', 'luna://com.webos.service.activitymanager/create',
                          json.dumps(activity)], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    out = p.stdout.read(); p.wait()
    print('activity: ' + out.decode('utf-8', 'replace').replace('\n', ' ')[:200])
except Exception as e:
    print('activity: failed %s' % e)
PYEOF
echo "enabled"
