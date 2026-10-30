#!/bin/sh
# Launch Home: Live TV channels for the Channels chip (run as root via
# hbchannel exec). Uses LG's API adapter, the service LG's phone apps use.
#
#   channels.sh list           one line per channel:
#                              id<TAB>number<TAB>name<TAB>radio<TAB>hidden<TAB>favourite
#   channels.sh now            number<TAB>name<TAB>programme on now
#   channels.sh open ID NUMBER switch Live TV to that channel; prints "opened"
#   channels.sh current        id of the channel the tuner shows (the last one)
#   channels.sh tune ID        make ID the last channel: the embedded tv://
#                              picture opens on it; prints "tuned"
#   channels.sh programme ID   name of the programme on ID now
#   channels.sh programme-info ID
#                              the same, as one JSON line:
#                              {"name":"…","start":EPOCH,"end":EPOCH,"next":"…"}
#                              (0 and "" when the guide does not say)
#
# A channel list can be big (a satellite scan has 1000+ channels at about 1 KB
# each), so it is cut down here to one short line per channel.

API=luna://com.webos.service.apiadapter/tv

# Some busybox builds only sleep whole seconds.
sleep 0.1 2>/dev/null || SLEEP_INT=1
nap() {
  case "$1" in
    *.*) if [ -n "$SLEEP_INT" ]; then sleep 1; else sleep "$1"; fi ;;
    *) sleep "$1" ;;
  esac
}

# One Luna reply on a single line.
call() {
  luna-send -i -n 1 -w "${3:-8000}" "$1" "$2" 2>/dev/null </dev/null | tr -d '\n'
}

# awk helper: the value of "key" in the current line (a JSON fragment): a
# string (without quotes), a number or true/false, or an [array].
AWK_FIELD='
function field(key,    v) {
  if (!match($0, "\"" key "\" *: *(\"[^\"]*\"|\\[[^]]*\\]|[^,}]*)")) return ""
  v = substr($0, RSTART, RLENGTH)
  sub(/^[^:]*: */, "", v)
  sub(/[ \t]+$/, "", v)
  gsub(/^"|"$/, "", v)
  return v
}'

case "$1" in
  list)
    # One channel object per line. Each object opens with "channelNumber" and
    # has "channelId" further on: splitting at "channelId" paired every id
    # with the next channel's number and name.
    call "$API/getChannelList" '{}' 15000 | sed 's/{ *"channelNumber"/\
{"channelNumber"/g' | awk "$AWK_FIELD"'
      index($0, "{\"channelNumber\"") == 1 {
        id = field("channelId"); num = field("channelNumber"); name = field("channelName")
        if (id == "" || name == "") next
        radio = (field("Radio") == "true") ? 1 : 0
        hidden = (field("Invisible") == "true" || field("skipped") == "true") ? 1 : 0
        fav = field("favoriteGroup")
        fav = (fav != "" && fav != "[]") ? 1 : 0
        gsub(/\t/, " ", name)
        printf "%s\t%s\t%s\t%d\t%d\t%d\n", id, num, name, radio, hidden, fav
      }'
    ;;
  now)
    cur=$(call "$API/getCurrentChannel" '{}')
    prog=$(call "$API/getChannelProgramInfo" '{}')
    printf '%s\n%s\n' "$cur" "$prog" | awk "$AWK_FIELD"'
      NR == 1 { num = field("channelNumber"); name = field("channelName") }
      NR == 2 { prog = field("programName") }
      END { printf "%s\t%s\t%s\n", num, name, prog }'
    ;;
  open)
    # Only characters channel ids and numbers use: nothing else reaches JSON.
    id=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9_.-')
    num=$(printf '%s' "$3" | tr -cd '0-9.-')
    luna-send -n 1 -w 5000 luna://com.webos.applicationManager/launch \
      '{"id":"com.webos.app.livetv"}' >/dev/null 2>&1 </dev/null
    try=0
    while [ "$try" -lt 2 ]; do
      for req in "$API/openChannel {\"channelId\":\"$id\"}" \
                 "$API/openChannel {\"channelNumber\":\"$num\"}" \
                 "luna://com.webos.service.iepg/openChannel {\"channelNumber\":\"$num\"}"; do
        uri=${req%% *}
        body=${req#* }
        case "$body" in *'""'*) continue ;; esac
        if call "$uri" "$body" | grep -q '"returnValue": *true'; then
          echo opened
          exit 0
        fi
      done
      # Live TV may still be starting: give it a moment, then try once more.
      try=$((try + 1))
      nap 1.5
    done
    echo failed
    exit 1
    ;;
  current)
    call luna://com.webos.service.utp.channel/getLastChannelId '{"sourceType":"INPUTSOURCE_NONE"}' |
      awk "$AWK_FIELD"'{ print field("channelId") }'
    ;;
  tune)
    id=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9_.-')
    [ -n "$id" ] || { echo failed; exit 1; }
    if call luna://com.webos.service.utp.channel/setLastChannelId "{\"channelId\":\"$id\"}" |
        grep -q '"returnValue": *true'; then
      echo tuned
      exit 0
    fi
    echo failed
    exit 1
    ;;
  programme)
    id=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9_.-')
    [ -n "$id" ] || exit 1
    call "$API/getChannelCurrentProgramInfo" "{\"channelId\":\"$id\"}" |
      awk "$AWK_FIELD"'{ print field("programName") }'
    ;;
  programme-info)
    # Name, start and end as epoch seconds, and the programme after, from the
    # same reply. The guide gives times as epoch seconds or milliseconds
    # (startTime/endTime), as "YYYY,MM,DD,hh,mm,ss" strings (localStartTime)
    # or as start + duration in seconds; 0 when none of them is there.
    id=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9_.-')
    [ -n "$id" ] || exit 1
    call "$API/getChannelCurrentProgramInfo" "{\"channelId\":\"$id\"}" |
      awk "$AWK_FIELD"'
      function epoch(v,    n, p) {
        if (v == "") return 0
        if (v ~ /^[0-9]+$/) { if (length(v) > 11) v = substr(v, 1, length(v) - 3); return v + 0 }
        n = split(v, p, /[-,T: ]/)
        if (n >= 5 && p[1] ~ /^[0-9]{4}$/) return mktime(p[1] " " p[2] " " p[3] " " p[4] " " p[5] " " (n >= 6 ? p[6] : 0))
        return 0
      }
      # field() leaves a string JSON-escaped (inner quotes stay \"): it goes
      # out as it is, minus a lone trailing backslash from a cut value.
      function jsonq(s,    n) {
        n = 0
        while (n < length(s) && substr(s, length(s) - n, 1) == "\\") n++
        if (n % 2) s = substr(s, 1, length(s) - 1)
        gsub(/\t/, " ", s)
        return s
      }
      {
        name = field("programName")
        st = epoch(field("startTime")); if (!st) st = epoch(field("localStartTime"))
        en = epoch(field("endTime")); if (!en) en = epoch(field("localEndTime"))
        dur = field("duration")
        if (!en && st && dur ~ /^[0-9]+$/) en = st + dur
        nxt = field("nextProgramName"); if (nxt == "") nxt = field("nextProgram")
        printf "{\"name\":\"%s\",\"start\":%d,\"end\":%d,\"next\":\"%s\"}\n", jsonq(name), st, en, jsonq(nxt)
      }'
    ;;
  *)
    echo "usage: channels.sh list | now | open ID NUMBER | current | tune ID | programme ID | programme-info ID"
    exit 2
    ;;
esac
