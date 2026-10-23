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
OK=/run/cinema-boot-ok
GUARD=/var/lib/launch-home-cinema/failsafe-rebooted
LOG=/var/lib/launch-home-cinema/failsafe.log
(
  sleep 150
  [ -e "$OK" ] && exit 0
  # Homebrew Channel's startup may still be running: give it time.
  n=0
  while [ -e /var/luna/preferences/webosbrew_failsafe ] && [ $n -lt 60 ]; do sleep 5; n=$((n + 1)); done
  sleep 20
  [ -e "$OK" ] && exit 0
  if [ -e "$GUARD" ]; then
    echo "$(date) failsafe boot again after an automatic restart: left as it is" >> "$LOG"
    exit 0
  fi
  echo "$(date) failsafe boot (no boot hooks ran): restarting once" >> "$LOG"
  touch "$GUARD"
  sync
  reboot
) </dev/null >/dev/null 2>&1 &
exit 0
