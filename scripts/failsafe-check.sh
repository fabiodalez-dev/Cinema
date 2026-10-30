#!/bin/sh
# Cinema: get the TV out of Homebrew Channel's failsafe mode by itself.
#
# If the power goes off while Homebrew Channel runs its boot hooks, the next
# boot is in failsafe mode: no hook runs (no Cinema on boot, no Home key, no TV
# tools, no update block) until the TV restarts again. This script is run at
# every boot by a webOS activity of its own (registered by enable-tvtools.sh,
# the same mechanism Homebrew Channel uses), so it runs in failsafe mode too.
#
# A normal boot runs 45-cinema-tvtools-memory, which leaves /run/cinema-boot-ok.
# Without it, once Homebrew Channel has cleared its failsafe flag, the TV is
# restarted once. A failsafe boot right after such a restart is left alone, so
# a hook that really breaks start-up can never put the TV in a reboot loop:
# the guard is cleared by the next normal boot.
#
# The restart is announced with a toast a minute ahead, and put off while
# something is being watched (Live TV, an input, a video app): checked again
# every 5 minutes for up to 2 hours, then done anyway after a second toast.
OK=/run/cinema-boot-ok
GUARD=/var/lib/launch-home-cinema/failsafe-rebooted
LOG=/var/lib/launch-home-cinema/failsafe.log
LOG_MAX=16384

log() {
  if [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt "$LOG_MAX" ]; then
    tail -n 60 "$LOG" >"$LOG.old" 2>/dev/null && mv "$LOG.old" "$LOG"
  fi
  echo "$(date) $*" >>"$LOG"
}

# This TV's luna-send prints nothing without -i and with stdin open.
toast() {
  luna-send -i -n 1 -w 3000 luna://com.webos.notification/createToast \
    "{\"message\":\"$1\"}" </dev/null >/dev/null 2>&1
}

foreground_app() {
  luna-send -i -n 1 -w 4000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null </dev/null \
    | tr '\n' ' ' | sed -n 's/.*"appId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

# Apps that show a picture the owner is likely watching.
watching() {
  case "$(foreground_app)" in
    com.webos.app.livetv|com.webos.app.hdmi*|com.webos.app.inputcommon|com.webos.app.externalinput.*|\
    com.webos.app.photovideo|com.webos.app.mediadiscovery|com.webos.app.browser|\
    *netflix*|*youtube*|*amazon*|*disney*|*appletv*|*rakuten*|*dazn*|*spotify*|*plex*|*kodi*|\
    org.litefin.app|*jellyfin*|*moonfin*|*breezyfin*|*ocenfin*|*emby*|\
    org.bloomee.webos|org.webosbrew.lounge.launcher)
      return 0 ;;
  esac
  return 1
}

# A normal boot already left its mark: nothing to watch. The activity runs
# this again and again after start-up; each copy used to sleep its 150 s.
[ -e "$OK" ] && exit 0
# One watcher at a time while the boot is still going (mkdir is atomic).
LOCK=/run/cinema-failsafe-check.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  pid=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
fi

(
  sleep 150
  [ -e "$OK" ] && { rm -rf "$LOCK"; exit 0; }
  # Homebrew Channel's startup may still be running: give it time.
  n=0
  while [ -e /var/luna/preferences/webosbrew_failsafe ] && [ $n -lt 60 ]; do sleep 5; n=$((n + 1)); done
  sleep 20
  [ -e "$OK" ] && { rm -rf "$LOCK"; exit 0; }
  if [ -e "$GUARD" ]; then
    log "failsafe boot again after an automatic restart: left as it is"
    rm -rf "$LOCK"
    exit 0
  fi
  log "failsafe boot (no boot hooks ran): restarting once"
  toast "Cinema: la TV si riavvia tra 60 secondi per completare l’avvio"
  sleep 60
  # Something being watched: wait, 5 minutes at a time, up to 2 hours.
  waited=0
  while watching && [ "$waited" -lt 7200 ]; do
    [ "$waited" -eq 0 ] && log "something is being watched: restart put off"
    sleep 300
    waited=$((waited + 300))
  done
  if [ "$waited" -ge 7200 ]; then
    log "still watching after 2 hours: restarting anyway"
    toast "Cinema: la TV si riavvia ora per completare l’avvio"
    sleep 10
  fi
  touch "$GUARD"
  sync
  reboot
) </dev/null >/dev/null 2>&1 &
echo $! >"$LOCK/pid"
exit 0
