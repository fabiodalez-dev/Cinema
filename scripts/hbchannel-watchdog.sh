#!/bin/sh
#
# hbchannel-watchdog.sh — unstick the Homebrew Channel root service.
#
# Installed on the TV as /var/lib/webosbrew/init.d/55-hbchannel-watchdog, so
# Homebrew Channel's startup (run-parts) starts it on every boot.
#
# The Homebrew Channel JS service (a node process titled
# org.webosbrew.hbchannel.service) forks a child for each `exec`. On this TV a
# forked child once deadlocked in futex_wait before it could exec: it kept the
# service's title, the service waited on its pipe forever and every
# luna://org.webosbrew.hbchannel.service call timed out (Cinema, Bloomee and
# anything else needing root). Killing that child frees the service at once.
#
# Every INTERVAL seconds this looks for a process that carries the service's
# title, whose parent carries it too (a fork that never exec'd), that sleeps in
# a futex wait and is older than MIN_AGE seconds; it kills it and logs to LOG.
#
# Usage:
#   hbchannel-watchdog.sh        start the loop in the background and return
#   hbchannel-watchdog.sh run    run the loop in the foreground
#   hbchannel-watchdog.sh once   scan once and exit (for testing)
#   hbchannel-watchdog.sh stop   stop a running loop
#
# Log and pid file live in /tmp/hbchannel-watchdog/, a directory only root may
# write to, so no other user can plant a symlink where root writes.
#
# Environment: HBC_WATCHDOG_INTERVAL (30), HBC_WATCHDOG_MIN_AGE (20)

NAME="org.webosbrew.hbchannel.service"
INTERVAL="${HBC_WATCHDOG_INTERVAL:-30}"
MIN_AGE="${HBC_WATCHDOG_MIN_AGE:-20}"
DIR="/tmp/hbchannel-watchdog"
LOG="$DIR/watchdog.log"
PIDFILE="$DIR/watchdog.pid"
LOG_MAX=65536

HZ="$(getconf CLK_TCK 2>/dev/null)"
case "$HZ" in ''|*[!0-9]*) HZ=100 ;; esac

# Create DIR, or accept it only as a real directory owned by root and closed
# to everyone else.
own_dir() {
  mkdir -m 700 "$DIR" 2>/dev/null
  [ -d "$DIR" ] && [ ! -L "$DIR" ] || return 1
  [ "$(stat -c '%u %a' "$DIR" 2>/dev/null)" = "0 700" ]
}

log() {
  if [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt "$LOG_MAX" ]; then
    tail -n 200 "$LOG" >"$LOG.old" && mv "$LOG.old" "$LOG"
  fi
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"
}

# Seconds since process $1 started, or nothing if it is gone.
age_of() {
  stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  # Fields after "(comm) ": state is field 3, starttime is field 22.
  # shellcheck disable=SC2086 # split the fields on purpose
  set -- ${stat##*") "}
  shift 19
  read -r up _ </proc/uptime
  echo $(( ${up%%.*} - $1 / HZ ))
}

ppid_of() {
  while read -r key value; do
    if [ "$key" = "PPid:" ]; then echo "$value"; return 0; fi
  done <"/proc/$1/status" 2>/dev/null
  return 1
}

scan() {
  pids=" $(pgrep -f "^$NAME( |\$)" | tr '\n' ' ') "
  for pid in $pids; do
    parent="$(ppid_of "$pid")" || continue
    case "$pids" in *" $parent "*) ;; *) continue ;; esac
    wchan="$(cat "/proc/$pid/wchan" 2>/dev/null)"
    case "$wchan" in *futex*) ;; *) continue ;; esac
    age="$(age_of "$pid")" || continue
    [ "$age" -ge "$MIN_AGE" ] || continue
    parent_wchan="$(cat "/proc/$parent/wchan" 2>/dev/null)"
    if kill -9 "$pid" 2>/dev/null; then
      log "killed stuck child $pid (age ${age}s, wchan $wchan) of $parent (wchan $parent_wchan)"
    else
      log "could not kill stuck child $pid of $parent"
    fi
  done
}

running_pid() {
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null &&
    grep -q hbchannel-watchdog "/proc/$pid/cmdline" 2>/dev/null && echo "$pid"
}

if ! own_dir; then
  echo "refusing to run: $DIR is not a root-only directory" >&2
  exit 1
fi

case "$1" in
  once)
    scan
    ;;
  run)
    if other="$(running_pid)" && [ "$other" != "$$" ]; then
      echo "already running as $other" >&2
      exit 0
    fi
    echo $$ >"$PIDFILE"
    trap 'rm -f "$PIDFILE"; exit 0' INT TERM
    log "started (pid $$, every ${INTERVAL}s, min age ${MIN_AGE}s)"
    while :; do
      scan
      sleep "$INTERVAL"
    done
    ;;
  stop)
    pid="$(running_pid)" && kill "$pid" && echo "stopped $pid"
    ;;
  *)
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup "$0" run >/dev/null 2>&1 </dev/null &
    else
      nohup "$0" run >/dev/null 2>&1 </dev/null &
    fi
    ;;
esac
exit 0
