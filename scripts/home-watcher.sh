#!/bin/sh
# Launch Home — intercept stock Home and open Launch Home instead.
#
# webOS always opens stock Home on the Home button first. We react when Home
# is foreground, bring Launch Home forward, close Home, then launch Launch Home AGAIN so
# webOS routes remote INPUT to our surface (launch alone often leaves input on
# Home even though Launch Home is painted on top — dock appears dead).
#
# Start detached only:
#   setsid nohup home-watcher.sh >/tmp/launch-home-watcher.log 2>&1 </dev/null &
#
# Hardened for webOS 4.x+: luna-send -w / setsid may be missing; subscribe can
# die after boot; we fall back to polling and auto-restart the subscribe loop.

APP_ID="org.webosbrew.lounge.launcher"
PIDFILE="/tmp/launch-home-watcher.pid"
LOG="/tmp/launch-home-watcher.log"
COOLDOWN_SEC=1
# At most this many activations a minute: a Home that keeps coming back
# (a dialog LG reopens, a stuck launch) must not turn into a launch storm.
MAX_PER_MIN=6

log() {
  echo "$(date '+%H:%M:%S' 2>/dev/null) $*" >>"$LOG" 2>/dev/null || true
}

# Some busybox builds only sleep whole seconds.
sleep 0.1 2>/dev/null || SLEEP_INT=1
nap() {
  case "$1" in
    *.*) if [ -n "$SLEEP_INT" ]; then sleep 1; else sleep "$1"; fi ;;
    *) sleep "$1" ;;
  esac
}

if [ -f "$PIDFILE" ]; then
  oldpid=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    if [ "$oldpid" != "$$" ]; then
      log "already running pid=$oldpid, exiting"
      exit 0
    fi
  fi
fi
echo $$ >"$PIDFILE"
log "start pid=$$"

trap 'rm -f "$PIDFILE"; log "exit"; exit 0' INT TERM HUP

is_home() {
  case "$1" in
    com.webos.app.home|com.webos.app.launcher|com.webos.app.homelauncher|\
    com.webos.app.homeupdater|com.webos.app.dashboard|com.palm.app.home|\
    com.webos.app.gamehome|com.webos.app.seniorhome)
      return 0
      ;;
  esac
  return 1
}

extract_app_id() {
  # Prefer foregroundAppInfo[0].appId, the app that owns the screen (the
  # top-level "appId" can name an overlay); fall back to the first "appId"
  # (older builds only give that).
  raw=$(printf '%s' "$1" | tr '\n' ' ')
  id=$(printf '%s' "$raw" | sed -n 's/.*"foregroundAppInfo"[^[]*\[[^]{]*{[^}]*"appId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -n "$id" ]; then
    printf '%s' "$id"
    return 0
  fi
  printf '%s' "$raw" | sed -n 's/.*"appId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

# One-shot luna-send with webOS 4-compatible fallbacks (-w / -i may be missing).
luna_once() {
  uri=$1
  payload=$2
  out=$(luna-send -i -n 1 -w 3000 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  out=$(luna-send -i -n 1 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  out=$(luna-send -n 1 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  return 1
}

subscribe_fg() {
  # Prefer interactive subscribe; fall back if -i is unavailable.
  if luna-send -i \
    'luna://com.webos.applicationManager/getForegroundAppInfo' \
    '{"subscribe":true}' 2>/dev/null; then
    return 0
  fi
  luna-send \
    'luna://com.webos.applicationManager/getForegroundAppInfo' \
    '{"subscribe":true}' 2>/dev/null
}

launch_app() {
  log "launch $APP_ID"
  luna_once 'luna://com.webos.applicationManager/launch' "{\"id\":\"${APP_ID}\"}" >>"$LOG" 2>&1 || true
}

close_home() {
  for id in com.webos.app.home com.webos.app.launcher com.webos.app.homelauncher \
            com.webos.app.dashboard com.palm.app.home; do
    luna_once 'luna://com.webos.applicationManager/closeByAppId' "{\"id\":\"${id}\"}" >/dev/null 2>&1 || true
  done
}

# Bring Launch Home to front AND own input. Order matters on webOS 25:
#   1) launch Launch Home (graphics)
#   2) close stock Home (drop its input surface)
#   3) launch Launch Home again (reclaim input after Home is gone)
activate_app() {
  log "activate Launch Home"
  launch_app
  nap 0.25
  close_home
  nap 0.15
  launch_app
}

now_sec() {
  date +%s 2>/dev/null || echo 0
}

last_app=""
last_action=0
primed=0
minute_start=0
minute_count=0

# False (and logged once) past MAX_PER_MIN activations in the same minute.
under_rate() {
  now=$(now_sec)
  if [ $((now - minute_start)) -ge 60 ]; then
    minute_start=$now
    minute_count=0
  fi
  minute_count=$((minute_count + 1))
  if [ "$minute_count" -gt "$MAX_PER_MIN" ]; then
    [ "$minute_count" -eq $((MAX_PER_MIN + 1)) ] && log "more than $MAX_PER_MIN activations in a minute: holding back"
    return 1
  fi
  return 0
}

handle_fg() {
  appId=$1
  [ -n "$appId" ] || return 0

  if [ "$primed" -eq 0 ]; then
    primed=1
    last_app="$appId"
    log "primed fg=$appId"
    return 0
  fi

  if [ "$appId" = "$APP_ID" ]; then
    last_app="$appId"
    return 0
  fi

  if is_home "$appId"; then
    now=$(now_sec)
    elapsed=$((now - last_action))
    if [ "$last_action" -ne 0 ] && [ "$elapsed" -lt "$COOLDOWN_SEC" ]; then
      return 0
    fi
    last_action=$now
    prev="$last_app"
    last_app="$appId"
    under_rate || return 0
    log "home after $prev -> activate Launch Home"
    activate_app
    return 0
  fi

  last_app="$appId"
}

run_subscribe() {
  log "subscribe start"
  buf=""
  subscribe_fg | while IFS= read -r line || [ -n "$line" ]; do
    buf="$buf $line"
    case "$buf" in
      *returnValue*)
        appId=$(extract_app_id "$buf")
        buf=""
        if [ -n "$appId" ]; then
          handle_fg "$appId"
        fi
        ;;
    esac
  done
  log "subscribe ended"
  return 0
}

# Wait briefly for LS2 after cold boot (webOS 4 init.d can start us early).
boot_wait=0
while [ "$boot_wait" -lt 30 ]; do
  # Only a reply with returnValue counts: luna-send can print nothing and
  # still exit 0 while the service is not up yet.
  probe=$(luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' 2>/dev/null)
  if printf '%s' "$probe" | grep -q returnValue; then
    log "ls2 ready after ${boot_wait}s"
    break
  fi
  boot_wait=$((boot_wait + 1))
  sleep 1
done

while true; do
  sub_start=$(now_sec)
  run_subscribe
  sub_lasted=$(( $(now_sec) - sub_start ))
  # Polling fallback while subscribe is down / between restarts. Every poll
  # spawns luna-send plus sed, so the pause between polls grows from 1 s to
  # 10 s, and when the subscribe died at once (it isn't coming back soon) the
  # polling goes on a minute before retrying it instead of hammering both.
  poll_for=10
  if [ "$sub_lasted" -lt 5 ]; then
    poll_for=60
  fi
  spent=0
  interval=1
  while [ "$spent" -lt "$poll_for" ]; do
    raw=$(luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}')
    handle_fg "$(extract_app_id "$raw")"
    nap "$interval"
    spent=$((spent + interval))
    interval=$((interval * 2))
    [ "$interval" -gt 10 ] && interval=10
  done
done
