#!/bin/sh
# Launch Home voice assistant: runs voice/daemon/voice_daemon.py as root and
# starts it again when it exits (settings changes restart it that way).
#
#   voice-run.sh          the run loop itself (start detaches it)
#   voice-run.sh start    start the loop in the background unless it runs
#   voice-run.sh stop     stop the loop and the daemon with its helpers
#   voice-run.sh status   "running pid=N current|outdated" or "stopped"
#
# Everything here is Launch Home's own (port 8678, /tmp/launch-home-voice*,
# /home/root/.config/launch-home-voice). Another voice assistant on the TV,
# such as VoxRelay, is never stopped or changed.

APPDIR="${LH_APPDIR:-/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher}"
RUN="$APPDIR/voice-run.sh"
DAEMON="$APPDIR/voice/daemon/voice_daemon.py"
RUNPID=/tmp/launch-home-voice-run.pid
PIDF=/tmp/launch-home-voice.pid
STOP=/tmp/launch-home-voice.stop
VER=/tmp/launch-home-voice.ver
LOG=/tmp/launch-home-voice.log

log() {
  echo "[voice-run] $(date '+%H:%M:%S') $*" >>"$LOG"
}

# Fingerprint of the code a running daemon was started from, so enable can
# restart it after Launch Home is updated.
code_version() {
  cat "$APPDIR"/voice/daemon/*.py "$RUN" 2>/dev/null | md5sum | cut -c1-32
}

pid_alive() {
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

loop_pid() {
  p=$(cat "$RUNPID" 2>/dev/null)
  if pid_alive "$p"; then
    echo "$p"
  fi
}

# Some busybox builds only sleep whole seconds.
sleep 0.1 2>/dev/null || SLEEP_INT=1

# Wait in the background so a TERM from stop is handled at once, not after
# the sleep ends.
nap() {
  d=$1
  case "$d" in *.*) [ -n "$SLEEP_INT" ] && d=1 ;; esac
  sleep "$d" &
  wait $!
}

# python3 of a version the daemon runs on (3.7 up to 3.12): prints its path,
# or "python: unsupported X.Y, need 3.7-3.12" and fails. No python at all
# fails silently (enable-voice.sh reports missing_python).
voice_python() {
  py=$(command -v python3 || command -v python || true)
  [ -n "$py" ] || return 1
  ver=$("$py" -c 'import sys; sys.stdout.write("%d.%d" % sys.version_info[:2])' 2>/dev/null)
  maj=${ver%%.*}
  min=${ver#*.}
  case "$maj.$min" in
    3.7|3.8|3.9|3.10|3.11|3.12) echo "$py"; return 0 ;;
  esac
  echo "python: unsupported ${ver:-?}, need 3.7-3.12"
  return 1
}

stop_all() {
  touch "$STOP"
  runpid=$(cat "$RUNPID" 2>/dev/null)
  pid=$(cat "$PIDF" 2>/dev/null)
  if [ -n "$runpid" ]; then
    kill -TERM "$runpid" 2>/dev/null
  fi
  if [ -n "$pid" ]; then
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  fi
  # Loops or daemons whose pidfile is gone. Whole command lines only, so these
  # never match this script (`sh .../voice-run.sh stop`) or VoxRelay.
  pkill -TERM -f "^sh $RUN\$" 2>/dev/null
  pkill -TERM -f "^/bin/sh $RUN\$" 2>/dev/null
  pkill -TERM -f "^[^ ]*python[0-9.]* $DAEMON" 2>/dev/null
  i=0
  while [ "$i" -lt 20 ]; do
    if ! pid_alive "$runpid" && ! pid_alive "$pid" &&
       ! pgrep -f "^[^ ]*python[0-9.]* $DAEMON" >/dev/null 2>&1; then
      break
    fi
    nap 0.25
    i=$((i + 1))
  done
  if [ -n "$pid" ]; then
    kill -KILL -"$pid" 2>/dev/null
  fi
  pkill -KILL -f "^[^ ]*python[0-9.]* $DAEMON" 2>/dev/null
  if [ -n "$runpid" ]; then
    kill -KILL "$runpid" 2>/dev/null
  fi
  pkill -KILL -f "^sh $RUN\$" 2>/dev/null
  pkill -KILL -f "^/bin/sh $RUN\$" 2>/dev/null
  rm -f "$RUNPID" "$PIDF" "$VER"
}

start_loop() {
  rm -f "$STOP"
  p=$(loop_pid)
  if [ -n "$p" ]; then
    echo "running pid=$p"
    return 0
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup sh "$RUN" >/dev/null 2>&1 </dev/null &
  elif command -v nohup >/dev/null 2>&1; then
    nohup sh "$RUN" >/dev/null 2>&1 </dev/null &
  else
    sh "$RUN" >/dev/null 2>&1 </dev/null &
  fi
  i=0
  while [ "$i" -lt 20 ]; do
    p=$(loop_pid)
    if [ -n "$p" ]; then
      echo "started pid=$p"
      return 0
    fi
    nap 0.25
    i=$((i + 1))
  done
  echo start_failed
  return 1
}

case "$1" in
  start)
    # A TV whose Python cannot run the daemon: say so (exit 0, parsable) and
    # start nothing, so nothing retries at every start.
    if ! PY=$(voice_python); then
      [ -n "$PY" ] && echo "$PY"
      exit 0
    fi
    start_loop
    exit $?
    ;;
  stop)
    stop_all
    echo stopped
    exit 0
    ;;
  status)
    p=$(loop_pid)
    if [ -z "$p" ]; then
      echo stopped
    elif [ "$(cat "$VER" 2>/dev/null)" = "$(code_version)" ]; then
      echo "running pid=$p current"
    else
      echo "running pid=$p outdated"
    fi
    exit 0
    ;;
  "")
    ;;
  *)
    echo "usage: voice-run.sh [start|stop|status]"
    exit 2
    ;;
esac

# --- The run loop --------------------------------------------------------

p=$(loop_pid)
if [ -n "$p" ] && [ "$p" != "$$" ]; then
  exit 0
fi
echo $$ >"$RUNPID"

child=""
on_term() {
  if [ -n "$child" ]; then
    kill -TERM -"$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null
  fi
  rm -f "$RUNPID" "$PIDF"
  exit 0
}
trap on_term TERM INT

if ! PY=$(voice_python); then
  log "${PY:-python3 not found}; voice assistant cannot run on this TV"
  rm -f "$RUNPID"
  exit 1
fi

# At power-on, wait until the TV's services answer (the daemon talks to them).
i=0
while [ "$i" -lt 90 ] && [ ! -f "$STOP" ]; do
  if luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  nap 2
done

fast=0
while [ ! -f "$STOP" ] && [ -f "$DAEMON" ]; do
  code_version >"$VER"
  started=$(date +%s)
  # The daemon makes itself a process-group leader (os.setsid), so its
  # helpers stop with it. Bytecode goes to /tmp, not into the app folder.
  PYTHONUNBUFFERED=1 PYTHONPYCACHEPREFIX=/tmp/launch-home-voice-pycache \
    "$PY" "$DAEMON" </dev/null >/dev/null 2>&1 &
  child=$!
  echo "$child" >"$PIDF"
  wait "$child"
  rc=$?
  kill -TERM -"$child" 2>/dev/null
  child=""
  rm -f "$PIDF"
  if [ -f "$STOP" ]; then
    break
  fi
  ran=$(($(date +%s) - started))
  if [ "$ran" -ge 30 ]; then
    fast=0
  fi
  fast=$((fast + 1))
  # Exit 0 is a requested restart: come back quickly. Repeated early exits
  # back off (up to a minute) instead of spinning the TV's CPU.
  if [ "$rc" -eq 0 ] && [ "$fast" -le 1 ]; then
    delay=1
  else
    delay=$((fast * 3))
    if [ "$delay" -gt 60 ]; then
      delay=60
    fi
    log "daemon exited rc=$rc after ${ran}s; restarting in ${delay}s"
  fi
  nap "$delay"
done

rm -f "$RUNPID"
exit 0
