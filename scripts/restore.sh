#!/bin/sh
# Cinema: give the TV back as it was before Cinema, as root.
#
# Kept on the TV as /var/lib/launch-home-cinema/restore.sh (not in the IPK:
# it must work when Cinema's own folder is already gone). Run it over SSH or
# from Homebrew Channel's exec:
#   sh /var/lib/launch-home-cinema/restore.sh
#
# What it does, in order:
#   1. the Home-key watcher and the boot launch stopped, their hooks removed
#   2. the voice assistant off (daemon, boot hook, voice card)
#   3. the TV tools off: LG's settings, services, preloading, memory manager
#      list and remote keys back, hooks, daemon and root copy removed
#   4. Litefin's index.html back from the backup kept when the adapter was
#      added, and the adapter (cinema-litefin-bridge.js) removed
#   5. Cinema removed through appInstallService dev/remove
#   6. LG's Home opened
# The other installed apps and the debloat configuration are left as they are.
#
# This TV generation's luna-send prints nothing without -i and with stdin
# open: every call has -i and </dev/null.

APP_ID=org.webosbrew.lounge.launcher
APP_DIR=/media/developer/apps/usr/palm/applications/$APP_ID
LITEFIN_DIR=/media/developer/apps/usr/palm/applications/org.litefin.app
ROOT=/var/lib/launch-home-cinema
INITD=/var/lib/webosbrew/init.d
PY=$(command -v python3 || command -v python || true)

luna() {
  luna-send -i -n 1 -w "${3:-5000}" "$1" "$2" </dev/null 2>/dev/null
}

say() {
  echo "restore: $*"
}

# The app's own disable scripts when Cinema is still there; the same by hand
# when it is not (hooks by name, processes by pid file).
run_disable() {
  if [ -f "$APP_DIR/$1" ]; then
    sh "$APP_DIR/$1" >/dev/null 2>&1 </dev/null || true
    return 0
  fi
  return 1
}

# kill_pidfile FILE WORD: stop the process a pid file names, only when its
# command line contains WORD. Pid files in /tmp can be written by any user;
# a pid alone would let one of them pick what root kills.
kill_pidfile() {
  p=$(cat "$1" 2>/dev/null)
  case "$p" in ''|*[!0-9]*) rm -f "$1"; return 0 ;; esac
  if tr '\0' ' ' 2>/dev/null <"/proc/$p/cmdline" | grep -q -- "$2"; then
    kill "$p" 2>/dev/null || true
  fi
  rm -f "$1"
}

# 1. Home key and boot launch.
say "home watcher and boot launch"
run_disable disable-home-watcher.sh || {
  rm -f "$INITD/40-launch-home-watcher" "$INITD/40-lounge-home"
  kill_pidfile /tmp/launch-home-watcher.pid home-watcher.sh
  kill_pidfile /tmp/lounge-home-watcher.pid home-watcher.sh
}
run_disable disable-boot-launch.sh || {
  rm -f "$INITD/50-launch-home-boot" "$INITD/50-lounge-boot"
  kill_pidfile /tmp/launch-home-boot.pid boot-launch.sh
}
rm -f /tmp/launch-home-user-input

# 2. Voice assistant.
say "voice assistant"
run_disable disable-voice.sh || {
  rm -f "$INITD/45-launch-home-voice"
  for pf in /tmp/launch-home-voice-run.pid /tmp/launch-home-voice.pid; do
    p=$(cat "$pf" 2>/dev/null)
    case "$p" in ''|*[!0-9]*) rm -f "$pf"; continue ;; esac
    # Only Cinema's own voice processes, never whatever pid the file names.
    if tr '\0' ' ' 2>/dev/null <"/proc/$p/cmdline" | grep -q -E 'voice-run\.sh|voice_daemon\.py'; then
      kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
    fi
    rm -f "$pf"
  done
  rm -f /tmp/launch-home-voice.ver /tmp/voiceinput_disable_set_input_event
}

# 3. TV tools: disable-tvtools.sh answers at once and restores detached, so
# the root copy's uninstall is run here in the foreground instead, to be sure
# LG has everything back before Cinema is removed.
say "tv tools"
if [ -n "$PY" ] && [ -f "$ROOT/tvtools/tvtools.py" ]; then
  kill_pidfile /run/cinema-tvtools/tvtools.pid tvtools.py
  "$PY" "$ROOT/tvtools/tvtools.py" uninstall </dev/null >/dev/null 2>&1 || true
else
  run_disable disable-tvtools.sh || true
fi
rm -f "$INITD/55-cinema-tvtools" "$INITD/45-cinema-tvtools-memory" "$INITD/55-hbchannel-watchdog"
[ -f "$ROOT/tvtools/hbchannel-watchdog.sh" ] && sh "$ROOT/tvtools/hbchannel-watchdog.sh" stop >/dev/null 2>&1
kill_pidfile /tmp/hbchannel-watchdog/watchdog.pid hbchannel-watchdog.sh
luna luna://com.webos.service.activitymanager/cancel \
  "{\"activityName\":\"$APP_ID.failsafe-check\"}" >/dev/null
rm -f "$ROOT/failsafe-rebooted" "$ROOT/tvtools.json" "$ROOT/tvtools-state.json" "$ROOT/keyfilter.js"
rm -rf "$ROOT/tvtools" "$ROOT/updates" "$ROOT/stage"

# 4. Litefin: its own index.html back, the adapter out.
if [ -d "$LITEFIN_DIR" ]; then
  say "litefin"
  restored=0
  for b in index.html.cinema-backup index.html.cinema-bak index.html.bak index.html.orig; do
    if [ -f "$LITEFIN_DIR/$b" ]; then
      cp -f "$LITEFIN_DIR/$b" "$LITEFIN_DIR/index.html" && rm -f "$LITEFIN_DIR/$b"
      restored=1
      break
    fi
  done
  if [ "$restored" -eq 0 ] && grep -q cinema-litefin-bridge "$LITEFIN_DIR/index.html" 2>/dev/null; then
    # No backup left: only the adapter's own script line goes.
    sed -i '/cinema-litefin-bridge/d' "$LITEFIN_DIR/index.html" 2>/dev/null ||
      { sed '/cinema-litefin-bridge/d' "$LITEFIN_DIR/index.html" >"$LITEFIN_DIR/index.html.tmp" &&
        mv -f "$LITEFIN_DIR/index.html.tmp" "$LITEFIN_DIR/index.html"; }
  fi
  rm -f "$LITEFIN_DIR/cinema-litefin-bridge.js"
fi

# 5. Cinema itself.
if [ -d "$APP_DIR" ]; then
  say "removing $APP_ID"
  luna luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$APP_ID\"}" >/dev/null
  luna-send -i -n 6 -w 60000 luna://com.webos.appInstallService/dev/remove \
    "{\"id\":\"$APP_ID\",\"subscribe\":true}" </dev/null >/dev/null 2>&1 &
  remover=$!
  i=0
  while [ "$i" -lt 60 ] && [ -d "$APP_DIR" ]; do
    sleep 1
    i=$((i + 1))
  done
  kill "$remover" 2>/dev/null
  [ -d "$APP_DIR" ] && say "appInstallService did not remove $APP_ID: remove it from LG's Home"
fi
rm -f /tmp/launch-home-boot.log /tmp/launch-home-watcher.log /tmp/launch-home-diagnostics.txt

# 6. LG's Home.
luna luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
say "done"
exit 0
