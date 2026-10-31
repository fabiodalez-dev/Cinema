# -*- coding: utf-8 -*-
"""Cinema TV tools: keeps LG's background extras switched off, as root.

    tvtools.py apply    apply tvtools.json once (Cinema runs it after Save)
    tvtools.py memory   boot only, before Cinema starts: the memory manager list
    tvtools.py daemon   apply, then re-apply when LG switches things back on
    tvtools.py status   print the current state as JSON (for Settings)

Runs on the TV's Python 2.7 (and Python 3 for the tests). Configuration is
/var/lib/launch-home-cinema/tvtools.json, written by Cinema:

    {"preloadOff": ["amazon", ...],      apps LG must not keep loaded
     "settingsOff": ["adCookie", ...],   LG settings kept "off"
     "servicesOff": ["contentminer"]}    background services kept stopped

Apps kept loaded: configd's com.webos.service.preloadmanager.supportAppList
outlives reboots; the preload manager's setPreloadPolicy takes effect at once
but is lost when it restarts, and on newer firmware at each switch-on, so it is
sent again at start and every time the TV reports Active. The preload
manager's own /var/preferences file is not used: it rewrites it by itself.
Technique from Glasshouse (MIT, github.com/rorygallagher2024/glasshouse).

LG settings: LG turns some of them back on at boot and at power-on; the daemon
subscribes to them and switches them off again (idea from TV Tools, MIT,
github.com/theo78825/tv-tools-public).

Services: masked for this boot only (systemctl mask --runtime), so a restart
always brings LG's own state back before the daemon applies the list again.
"""
from __future__ import print_function

import json
import os
import subprocess
import sys
import threading
import time

ROOT = os.environ.get('TVTOOLS_ROOT', '/var/lib/launch-home-cinema')
CONF = os.path.join(ROOT, 'tvtools.json')
STATE = os.path.join(ROOT, 'tvtools-state.json')
# Runtime files in RAM, in a directory only root can enter: /tmp is writable
# by every app, which could plant a symlink for root to write through.
RUN = '/run/cinema-tvtools'
PIDFILE = os.path.join(RUN, 'tvtools.pid')
LOG = os.path.join(RUN, 'tvtools.log')
PRELOAD_KEY = 'com.webos.service.preloadmanager.supportAppList'

# Never offered: the TV relies on them (Home, inputs, guide, screen sharing,
# voice, the web app container). Same list as Glasshouse's ESSENTIAL.
ESSENTIAL = set(['com.webos.app.home', 'com.webos.app.fullhome', 'com.webos.app.livetv',
                 'com.webos.app.livemenu', 'com.webos.app.miracast', 'com.webos.app.miracast-overlay',
                 'com.webos.app.voice', 'com.webos.app.container', 'com.webos.app.inputcommon',
                 'airplay'] + ['com.webos.app.hdmi%d' % i for i in range(1, 5)])

# LG settings that can be kept off: key -> category. Each exists on webOS 5.
SETTINGS = {
    'adCookie': 'general',       # advertising ID / ad tracking
    'homePromotion': 'general',  # promotions on the Home screen
    'sportsAlarm': 'general',    # sports alerts
    'livePlus': 'option',        # Live Plus, content recognition (ACR)
    'livePromotion': 'option',   # Live TV promotions
    'channelplus': 'option',     # LG Channels
}

# Background services that can be stopped, checked on webOS 5.6 (Glasshouse's
# catalogue, minus the ones that must never stop: tvdataexchanger, alwaysready).
SERVICES = ('contentminer', 'remotelogger', 'nudge', 'uploadd', 'rdxd',
            'com.webos.service.mycar', 'com.webos.service.camera')


def run_dir():
    """The runtime directory, created root-only; refuses one that is a
    symlink or that someone else owns."""
    try:
        os.mkdir(RUN, 0o700)
    except OSError:
        pass
    st = os.lstat(RUN)
    import stat
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise RuntimeError('unsafe runtime directory ' + RUN)
    return RUN


def open_private(path, flags):
    run_dir()
    return os.fdopen(os.open(path, flags | os.O_NOFOLLOW, 0o600), 'a' if flags & os.O_APPEND else 'w')


LOG_MAX = 65536


def log(msg):
    try:
        # Bounded like hbchannel-watchdog.sh's log: past 64 KB only the tail stays.
        try:
            if os.path.getsize(LOG) > LOG_MAX:
                with open(LOG) as f:
                    tail = f.readlines()[-200:]
                with open_private(LOG + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC) as f:
                    f.writelines(tail)
                os.rename(LOG + '.tmp', LOG)
        except OSError:
            pass
        with open_private(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND) as f:
            f.write(time.strftime('%H:%M:%S ') + msg + '\n')
    except Exception:
        pass


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    """Written only when the content changes: the state file lives on flash
    and is rewritten at every apply."""
    text = json.dumps(data, sort_keys=True)
    try:
        with open(path) as f:
            if f.read() == text:
                return False
    except (IOError, OSError):
        pass
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        f.write(text)
    os.chmod(tmp, 0o600)
    os.rename(tmp, path)
    return True


def luna(uri, payload, wait=5000):
    """One luna call as root. luna-send prints nothing without -i, and nothing
    when its stdin is at end of file before the reply: keep stdin open."""
    try:
        p = subprocess.Popen(['luna-send', '-i', '-n', '1', '-w', str(wait), uri, json.dumps(payload)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out = p.stdout.read()
        p.wait()
        try:
            p.stdin.close()
        except Exception:
            pass
        return json.loads(out.decode('utf-8', 'replace') or '{}')
    except Exception as e:
        log('luna %s failed: %s' % (uri, e))
        return {}


def load_conf():
    c = read_json(CONF, {})
    if not isinstance(c, dict):
        c = {}
    return {
        'preloadOff': [a for a in c.get('preloadOff') or [] if isinstance(a, type(u'')) or isinstance(a, str)],
        'settingsOff': [k for k in c.get('settingsOff') or [] if k in SETTINGS],
        'servicesOff': [s for s in c.get('servicesOff') or [] if s in SERVICES],
        'keepInMemory': [a for a in c.get('keepInMemory') or [] if isinstance(a, type(u'')) or isinstance(a, str)],
        'remoteKeys': clean_keys(c.get('remoteKeys')),
        'powerOffAt': clean_time(c.get('powerOffAt')),
        'cinemaFirst': c.get('cinemaFirst') is True,
    }


# ---- apps kept loaded -------------------------------------------------------

def preload_list():
    r = luna('luna://com.webos.service.config/getConfigs', {'configNames': [PRELOAD_KEY]})
    lst = (r.get('configs') or {}).get(PRELOAD_KEY)
    return lst if isinstance(lst, list) else None


def preload_target(lg, off):
    """LG's list with the owner's apps switched off; essential apps and the
    rest keep LG's own isEnabled."""
    out = []
    for e in lg:
        o = dict(e)
        if e.get('id') in off and e.get('id') not in ESSENTIAL:
            o['isEnabled'] = False
        out.append(o)
    return out


def merge_preload_baseline(baseline, current):
    """LG's own list as first seen, brought up to date with the list now: apps
    LG added since are taken as they are, apps gone are dropped, the rest keep
    the isEnabled LG had (ours may have changed the current one)."""
    kept = dict((e.get('id'), e) for e in baseline or [] if isinstance(e, dict))
    out = []
    for e in current:
        if not isinstance(e, dict):
            continue
        o = dict(e)
        if e.get('id') in kept:
            o['isEnabled'] = kept[e.get('id')].get('isEnabled')
        out.append(o)
    return out


def boot_id():
    try:
        with open('/proc/sys/kernel/random/boot_id') as f:
            return f.read().strip()
    except (IOError, OSError):
        return None


def apply_preload(conf, state):
    current = preload_list()
    if current is None:
        return
    # LG's own list, kept to switch apps back to LG's setting, merged by id
    # with the list of today (apps come and go with LG's updates).
    merged = merge_preload_baseline(state.get('preloadLg'), current)
    if merged != state.get('preloadLg'):
        state['preloadLg'] = merged
        write_json(STATE, state)
    lg = state['preloadLg']
    target = preload_target(lg, set(conf['preloadOff']))
    if json.dumps(target, sort_keys=True) != json.dumps(current, sort_keys=True):
        luna('luna://com.webos.service.config/setConfigs', {'configs': {PRELOAD_KEY: target}})
        log('preload list written: off=%s' % ','.join(conf['preloadOff']))
    # Takes effect at once on newer firmware. On webOS 5 the call never answers
    # and changes nothing: the configd list counts from the next restart. The
    # preload manager must not be restarted to apply it sooner: on webOS 5
    # that closes every app in use. When the first call gets no answer the
    # rest are skipped (each would wait its 1.5 s) and it is tried again once
    # per boot only.
    boot = boot_id()
    if state.get('preloadPolicyUnsupported') and state.get('preloadPolicyCheckedBoot') == boot:
        return
    first = True
    for e in target:
        if e.get('id') in ESSENTIAL:
            continue
        r = luna('luna://com.webos.service.preloadmanager/setPreloadPolicy',
                 {'application': {'id': e['id'], 'isEnabled': bool(e.get('isEnabled'))}}, wait=1500)
        if first:
            first = False
            unsupported = not r
            if unsupported != bool(state.get('preloadPolicyUnsupported')):
                log('setPreloadPolicy %s' % ('does not answer: skipped' if unsupported else 'answers again'))
            state['preloadPolicyUnsupported'] = unsupported
            state['preloadPolicyCheckedBoot'] = boot
            write_json(STATE, state)
            if unsupported:
                return


# ---- LG settings ----------------------------------------------------------

def setting_values():
    vals = {}
    for cat in sorted(set(SETTINGS.values())):
        keys = [k for k, c in SETTINGS.items() if c == cat]
        r = luna('luna://com.webos.settingsservice/getSystemSettings', {'category': cat, 'keys': keys})
        for k, v in (r.get('settings') or {}).items():
            if isinstance(v, dict):
                v = v.get('value')
            vals[k] = v
    return vals


def apply_settings(conf, state, vals=None):
    if not conf['settingsOff']:
        return
    vals = vals if vals is not None else setting_values()
    orig = state.setdefault('settingsLg', {})
    changed = False
    for k in conf['settingsOff']:
        v = vals.get(k)
        if v is None or v == 'off':
            continue
        if k not in orig:
            orig[k] = v
            changed = True
        luna('luna://com.webos.settingsservice/setSystemSettings',
             {'category': SETTINGS[k], 'settings': {k: 'off'}})
        log('setting %s was %s, switched off' % (k, v))
    if changed:
        write_json(STATE, state)


def restore_settings(conf, state):
    """Settings no longer kept off go back to the value LG had before."""
    orig = state.get('settingsLg') or {}
    for k in list(orig.keys()):
        if k not in conf['settingsOff']:
            value = orig.pop(k)
            luna('luna://com.webos.settingsservice/setSystemSettings',
                 {'category': SETTINGS[k], 'settings': {k: value}})
            log('setting %s back to %s' % (k, value))
    write_json(STATE, state)


# ---- services ---------------------------------------------------------------

def systemctl(*args):
    try:
        return subprocess.call(['systemctl'] + list(args), stdout=open(os.devnull, 'w'), stderr=subprocess.STDOUT)
    except Exception:
        return 1


def restart_bounded(unit, seconds):
    """systemctl restart that never holds the boot hook more than `seconds`:
    Homebrew Channel's startup waits for every hook, and a reboot before it
    finishes puts the TV in failsafe mode."""
    try:
        p = subprocess.Popen(['systemctl', 'restart', unit], stdout=open(os.devnull, 'w'), stderr=subprocess.STDOUT)
    except Exception:
        return False
    end = time.time() + seconds
    while time.time() < end:
        if p.poll() is not None:
            return p.returncode == 0
        time.sleep(0.2)
    log('%s restart still running after %ds, not waiting' % (unit, seconds))
    return False


def service_active(name):
    try:
        out = subprocess.check_output(['systemctl', 'is-active', name + '.service'], stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as e:
        out = e.output
    except Exception:
        return None
    return out.decode('utf-8', 'replace').strip()


def service_exists(name):
    """systemctl is-active says "inactive" for units that do not exist too;
    is-enabled prints nothing for those."""
    try:
        out = subprocess.check_output(['systemctl', 'is-enabled', name + '.service'], stderr=open(os.devnull, 'w'))
    except subprocess.CalledProcessError as e:
        out = e.output or b''
    except Exception:
        return False
    return bool(out.decode('utf-8', 'replace').strip())


def unmask_runtime(unit):
    """Undo `mask --runtime`. Older systemd (webOS 5) refuses
    `unmask --runtime`: the runtime mask is a symlink to /dev/null in
    /run/systemd/system, removed here only when it is exactly that."""
    if systemctl('unmask', '--runtime', unit) == 0:
        return
    link = os.path.join('/run/systemd/system', unit)
    if os.path.islink(link) and os.readlink(link) == '/dev/null':
        os.remove(link)
        systemctl('daemon-reload')


def apply_services(conf, state):
    stopped = set(state.get('servicesStopped') or [])
    for s in conf['servicesOff']:
        systemctl('mask', '--runtime', '--now', s + '.service')
        stopped.add(s)
    for s in list(stopped):
        if s not in conf['servicesOff']:
            unmask_runtime(s + '.service')
            systemctl('start', s + '.service')
            stopped.discard(s)
            log('service %s started again: %s' % (s, service_active(s)))
    state['servicesStopped'] = sorted(stopped)
    write_json(STATE, state)


# ---- apps kept in memory ----------------------------------------------------
# webOS's memory manager (memchute) closes apps to make room, except those in
# its KeepOnLaunchEx list (LG's own Home is there). It reads
# /home/root/memorymanager-conf.json before the system file, but it starts
# before /home is mounted: after writing the copy it is restarted once.

MEM_SYSTEM = '/etc/palm/memorymanager-conf.json'
MEM_OVERRIDE = '/home/root/memorymanager-conf.json'
MEM_MARK = '/home/root/.cinema-memorymanager'


def memory_target(system, keep):
    conf = json.loads(json.dumps(system))
    lst = conf.get('KeepOnLaunchEx')
    if not isinstance(lst, list):
        lst = []
    for a in keep:
        if a not in lst:
            lst.append(a)
    conf['KeepOnLaunchEx'] = lst
    return conf


def apply_memory(conf, state, boot=False):
    if not os.path.exists(MEM_SYSTEM) or not os.path.isdir(os.path.dirname(MEM_OVERRIDE)):
        return
    ours = os.path.exists(MEM_MARK)
    if not conf['keepInMemory']:
        if ours:
            for f in (MEM_OVERRIDE, MEM_MARK):
                try:
                    os.remove(f)
                except OSError:
                    pass
            log('memory manager back to LG list from the next restart')
        return
    if os.path.exists(MEM_OVERRIDE) and not ours:
        log('memory manager override exists and is not ours: left alone')
        return
    target = memory_target(read_json(MEM_SYSTEM, {}), conf['keepInMemory'])
    changed = read_json(MEM_OVERRIDE, None) != target
    if changed:
        tmp = MEM_OVERRIDE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(target, f, indent=4)
        os.chmod(tmp, 0o644)
        os.rename(tmp, MEM_OVERRIDE)
        open(MEM_MARK, 'w').close()
    # Restarting the memory manager closes apps it is tracking: it is done
    # only at boot, from an early hook, before Cinema is launched (see
    # enable-tvtools.sh). A change made with the TV in use counts from the
    # next restart.
    if boot:
        restart_bounded('memchute.service', 10)
        log('memory manager keeps %s' % ','.join(conf['keepInMemory']))


# ---- remote keys ---------------------------------------------------------------
# The compositor (surface-manager) runs every key through the handlers listed
# in configd's com.webos.surfacemanager.keyFilters, in order; LG's are in
# /usr/lib/qt5/qml/KeyFilters. A handler returns KeyPolicy.Accepted to keep
# the key, NextPolicy to pass it on. Our filter goes first and keeps only the
# keys set here, read from the configd value cinema.remoteKeys, which it
# follows by subscription: a change applies at once, and configd keeps it
# across reboots, so it works before anything of Cinema has started. The
# chain is written as little as possible: each write reloads every filter.
# Technique from Glasshouse (MIT, github.com/rorygallagher2024/glasshouse),
# verified there on a CX with webOS 5.6.

CHAIN_KEY = 'com.webos.surfacemanager.keyFilters'
KEYS_VALUE = 'cinema.remoteKeys'
LG_FILTERS = '/usr/lib/qt5/qml/KeyFilters'
FILTER_FILE = os.path.join(ROOT, 'keyfilter.js')
FILTER_HANDLER = 'handleCinemaKeys'
# Keys that can be set: name -> the compositor's symbol. Offered only when one
# of LG's filters names the symbol, i.e. this TV's remotes can send it.
REMOTE_KEYS = [
    ('netflix', 'WebOS.Key_webOS_Netflix'), ('amazon', 'WebOS.Key_webOS_Amazon'),
    ('disneyplus', 'WebOS.Key_webOS_Disneyplus'), ('lgchannels', 'WebOS.Key_webOS_LGChannels'),
    ('rakutentv', 'WebOS.Key_webOS_RakutenTV'), ('red', 'WebOS.Key_webOS_Red'),
    ('green', 'WebOS.Key_webOS_Green'), ('yellow', 'WebOS.Key_webOS_Yellow'),
    ('blue', 'WebOS.Key_webOS_Blue'), ('guide', 'WebOS.Key_webOS_TVGuide'),
    ('info', 'WebOS.Key_webOS_Info'), ('input', 'WebOS.Key_webOS_InputSource'),
    ('livetv', 'WebOS.Key_webOS_InputTV'), ('search', 'Qt.Key_Search'), ('help', 'Qt.Key_Help'),
]
APP_ID_RE = __import__('re').compile(r'^[A-Za-z0-9._-]{1,128}$')


def clean_keys(value):
    """{name: app id or "" for nothing}, names and ids checked: they end up
    in a file the compositor runs."""
    names = dict(REMOTE_KEYS)
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            if k in names and (v == '' or (isinstance(v, (str, type(u''))) and APP_ID_RE.match(v))):
                out[k] = v
    return out


def available_keys():
    text = ''
    try:
        for name in os.listdir(LG_FILTERS):
            if name.endswith('.js'):
                with open(os.path.join(LG_FILTERS, name)) as f:
                    text += f.read()
    except OSError:
        return []
    return [k for k, sym in REMOTE_KEYS if sym.split('.')[-1] in text]


# Settings -> TV -> "Apri Cinema all'accensione": the filter also starts
# Cinema during a cold boot. LG's compositor loads it within seconds of
# power-on, long before Homebrew Channel's hooks (about 55 s), and it may call
# the app manager directly. While bootd's input stand-in (Cinema's id,
# windowGroup true), an input or nothing is in front, Cinema is launched every
# few seconds until the real one is there; LG takes launches of normal apps
# from about 25-35 s. Reloaded while the TV is in use (boot-done already true)
# it does nothing. Idea from lg-luma's home-filter.js (PR #89).
START_FIRST_JS = [
    'var cinemaBoot = "";',
    'var cinemaFront = "";',
    'var cinemaStandin = false;',
    'var cinemaLaunches = 0;',
    'var cinemaSeen = 0;',
    'var cinemaTicking = false;',
    'var cinemaLiveShown = 0;',
    'var cinemaAppsReady = false;',
    'function cinemaIsInput(id) {',
    '    return /^com\\.webos\\.app\\.(livetv|hdmi\\d|inputcommon|externalinput\\..*)$/.test(id);',
    '}',
    'function cinemaTick() {',
    '    try {',
    '        if (cinemaBoot !== "booting") { cinemaTicking = false; return; }',
    '        // While Cinema cannot load yet, Live TV covers bootd\'s empty card for',
    '        // Cinema (about 21 s, on an HDMI with nothing on it, see',
    '        // apply_first_app), again whenever that card comes back in front.',
    '        if (cinemaStandin && cinemaLiveShown < 6) {',
    '            cinemaLiveShown++;',
    '            applicationManager.launch("com.webos.app.livetv", "{}");',
    '        }',
    '        if (cinemaFront === "%s" && !cinemaStandin) {' % 'org.webosbrew.lounge.launcher',
    '            cinemaSeen++;',
    '            if (cinemaSeen >= 2) { cinemaTicking = false; return; }',
    '        } else {',
    '            cinemaSeen = 0;',
    '            var free = !cinemaFront || cinemaFront === "%s" || cinemaIsInput(cinemaFront);' % 'org.webosbrew.lounge.launcher',
    '            // Before minimal-boot-done a launch only puts Cinema\'s empty card',
    '            // over Live TV (seen: black from 22 s to 38 s).',
    '            if (free && cinemaAppsReady && cinemaLaunches < 40) {',
    '                cinemaLaunches++;',
    '                applicationManager.launch("%s", "{}");' % 'org.webosbrew.lounge.launcher',
    '            }',
    '        }',
    '        genericTimer.set(1500, cinemaTick);',
    '    } catch (e) {',
    '        cinemaTicking = false;',
    '        console.warn("cinema keyfilter: " + e + "; start left to the boot hook");',
    '    }',
    '}',
    'function cinemaStartWatch() {',
    '    lunaCall.subscribe("com.webos.bootManager", "/getBootStatus", "{\\"subscribe\\":true}", function (payload) {',
    '        try {',
    '            var r = typeof payload === "string" ? JSON.parse(payload) : payload;',
    '            if (!r || !r.signals) return;',
    '            if (cinemaBoot === "") cinemaBoot = r.signals["boot-done"] ? "done" : "booting";',
    '            if (r.signals["minimal-boot-done"]) cinemaAppsReady = true;',
    '            if (cinemaBoot === "booting" && !cinemaTicking) { cinemaTicking = true; cinemaTick(); }',
    '        } catch (e) { console.warn("cinema keyfilter: " + e); }',
    '    }, true);',
    '    lunaCall.subscribe("com.webos.applicationManager", "/getForegroundAppInfo", "{\\"subscribe\\":true,\\"extraInfo\\":true}", function (payload) {',
    '        try {',
    '            var r = typeof payload === "string" ? JSON.parse(payload) : payload;',
    '            var info = r && r.foregroundAppInfo && r.foregroundAppInfo.length ? r.foregroundAppInfo[0] : r;',
    '            if (!info || info.returnValue === false) return;',
    '            cinemaFront = info.appId || "";',
    '            cinemaStandin = info.windowGroup === true;',
    '        } catch (e) { console.warn("cinema keyfilter: " + e); }',
    '    }, true);',
    '}',
]


def filter_source(start_first=False):
    lines = [
        '/* Written by Cinema (Settings -> TV): the remote keys set there, read from',
        ' * configd ' + KEYS_VALUE + '. First in ' + CHAIN_KEY + ',',
        ' * so a key set here never reaches LG\'s filters. */',
        'var cinemaKeyIds = {};',
        'function cinemaKeyCodes() {',
        '    var codes = {};',
    ]
    for k, sym in REMOTE_KEYS:
        lines.append('    try { codes["%s"] = %s; } catch (e) {}' % (k, sym))
    lines += [
        '    return codes;',
        '}',
        'function cinemaKeysChanged(payload) {',
        '    try {',
        '        var r = typeof payload === "string" ? JSON.parse(payload) : payload;',
        '        var set = ((r && r.configs && r.configs["%s"]) || {}).keys || {};' % KEYS_VALUE,
        '        var codes = cinemaKeyCodes(), ids = {};',
        '        for (var name in set) {',
        '            if (set.hasOwnProperty(name) && codes[name] !== undefined && typeof set[name] === "string") ids[codes[name]] = set[name];',
        '        }',
        '        cinemaKeyIds = ids;',
        '    } catch (e) {',
        '        console.warn("cinema keyfilter: " + e + "; keys left as they were");',
        '    }',
        '}',
    ]
    if start_first:
        lines += START_FIRST_JS
    lines += [
        'function init() {',
        '    try {',
    ]
    if start_first:
        lines += ['        cinemaStartWatch();']
    lines += [
        '        lunaCall.subscribe("com.webos.service.config", "/getConfigs",',
        '            JSON.stringify({ "configNames": ["%s"], "subscribe": true }), cinemaKeysChanged, true);' % KEYS_VALUE,
        '    } catch (e) {',
        '        console.warn("cinema keyfilter: " + e + "; no keys set");',
        '    }',
        '}',
        '// First in the chain, it sees every key: an error must pass the key on.',
        'function %s(key, pressed, autoRepeat) {' % FILTER_HANDLER,
        '    try {',
        '        if (!cinemaKeyIds.hasOwnProperty(key)) return KeyPolicy.NextPolicy;',
        '        var id = cinemaKeyIds[key];',
        '        if (pressed && !autoRepeat && id) applicationManager.launch(id, "{}");',
        '        return KeyPolicy.Accepted;',
        '    } catch (e) {',
        '        console.warn("cinema keyfilter: " + e + "; key passed on");',
        '        return KeyPolicy.NextPolicy;',
        '    }',
        '}',
        '',
    ]
    return '\n'.join(lines)


def key_chain():
    r = luna('luna://com.webos.service.config/getConfigs', {'configNames': [CHAIN_KEY]})
    lst = (r.get('configs') or {}).get(CHAIN_KEY)
    return lst if isinstance(lst, list) else None


def write_chain(lst):
    luna('luna://com.webos.service.config/setConfigs', {'configs': {CHAIN_KEY: lst}})


def apply_keys(conf, remove=False):
    chain = key_chain()
    if chain is None:
        return
    ours = [e for e in chain if isinstance(e, dict) and e.get('file') == FILTER_FILE]
    rest = [e for e in chain if not (isinstance(e, dict) and e.get('file') == FILTER_FILE)]
    if remove or (not conf['remoteKeys'] and not conf.get('cinemaFirst')):
        if ours:
            write_chain(rest)
            log('remote key filter taken out of the chain')
        luna('luna://com.webos.service.config/setConfigs', {'configs': {KEYS_VALUE: {'keys': {}}}}) if ours else None
        if remove and os.path.exists(FILTER_FILE):
            os.remove(FILTER_FILE)
        return
    src = filter_source(bool(conf.get('cinemaFirst')))
    current = None
    try:
        with open(FILTER_FILE) as f:
            current = f.read()
    except IOError:
        pass
    changed = current != src
    if changed:
        tmp = FILTER_FILE + '.tmp'
        with open(tmp, 'w') as f:
            f.write(src)
        os.chmod(tmp, 0o644)
        os.rename(tmp, FILTER_FILE)
    luna('luna://com.webos.service.config/setConfigs', {'configs': {KEYS_VALUE: {'keys': conf['remoteKeys']}}})
    entry = {'file': FILTER_FILE, 'handler': FILTER_HANDLER}
    if not ours:
        write_chain([entry] + rest)
        log('remote key filter first in the chain')
    elif changed:
        # configd says nothing when the same list is written again: take the
        # entry out and back in so the compositor loads the new file.
        write_chain(rest)
        write_chain([entry] + rest)
        log('remote key filter reloaded')


# ---- data agreements ---------------------------------------------------------
# settingsservice keeps the consent flags in eulaStatus, but rebuilds them at
# boot from eulaInfoNetwork, LG's agreement documents with an accepted mark on
# each: a flag written alone comes back. So switching a flag off withdraws the
# documents it rests on, except those a flag that cannot be switched off still
# needs (the terms of use); flags resting on a withdrawn document go off with
# it. Logic from Glasshouse's privacy.js (MIT), measured there on webOS 4.4.

EULA_FILE = '/var/palm/license/eulaInfoNetwork.json'
CONSENT_LOCKED = set(['generalTermsAllowed', 'networkAllowed', 'firstUseAllowed', 'allAllowed'])
CONSENT_HIDDEN = set(['chpAllowed'])


def consent_groups():
    """flag -> the documents it needs, from LG's own mapping."""
    groups = {}
    mapping = read_json(EULA_FILE, {}).get('eulaMappingList') or {}
    for e in mapping.get('eulaInfo') or []:
        if isinstance(e, dict) and e.get('settingKey'):
            groups[e['settingKey']] = sorted(e.get('mandatory') or e.get('generalSelectAll') or [])
    return groups


def consent_read():
    st = luna('luna://com.webos.settingsservice/getSystemSettings', {'keys': ['eulaStatus']})
    docs = luna('luna://com.webos.settingsservice/getSystemSettings', {'keys': ['eulaInfoNetwork']})
    flags = (st.get('settings') or {}).get('eulaStatus')
    eln = (docs.get('settings') or {}).get('eulaInfoNetwork')
    if not isinstance(flags, dict) or not isinstance(eln, dict) or not isinstance(eln.get('eulaList'), list):
        return None, None
    return flags, eln


def plan_consent(key, on, flags, eln, groups):
    accepted = set(d['id'] for d in eln['eulaList'] if isinstance(d, dict) and d.get('accepted'))
    need = groups.get(key) or []
    if on:
        accepted.update(need)
    else:
        protected = set()
        for k, docs in groups.items():
            if k in CONSENT_LOCKED and flags.get(k):
                protected.update(docs)
        accepted.difference_update([d for d in need if d not in protected])
    next_flags = dict(flags)
    changed = []
    for k, docs in groups.items():
        if k not in next_flags or k in CONSENT_LOCKED:
            continue
        if next_flags[k] and not (docs and all(d in accepted for d in docs)):
            next_flags[k] = False
            changed.append(k)
    if next_flags.get(key) != on:
        next_flags[key] = on
        if key not in changed:
            changed.append(key)
    next_docs = json.loads(json.dumps(eln))
    for d in next_docs['eulaList']:
        if isinstance(d, dict):
            d['accepted'] = d.get('id') in accepted
    return next_flags, next_docs, changed


def consent_settable(key, groups):
    return key not in CONSENT_LOCKED and key not in CONSENT_HIDDEN and key in groups


def consent_status():
    flags, eln = consent_read()
    if flags is None:
        return None
    groups = consent_groups()
    titles = dict((d.get('id'), d.get('title') or d.get('name') or d.get('id')) for d in eln['eulaList'] if isinstance(d, dict))
    out = []
    for k in sorted(flags):
        if not consent_settable(k, groups):
            continue
        # Flags sharing a document with this one go off with it.
        peers = sorted(o for o in groups if o != k and consent_settable(o, groups) and o in flags
                       and set(groups[o]) & (set(groups[k]) - set(groups.get('generalTermsAllowed') or [])))
        out.append({'key': k, 'on': bool(flags[k]), 'docs': [titles.get(d, d) for d in groups[k]], 'peers': peers})
    return out


def set_consent(key, on):
    groups = consent_groups()
    flags, eln = consent_read()
    if flags is None or key not in flags or not consent_settable(key, groups):
        return {'ok': False, 'error': 'not settable'}
    next_flags, next_docs, changed = plan_consent(key, on, flags, eln, groups)
    if not changed:
        return {'ok': True, 'changed': []}
    luna('luna://com.webos.settingsservice/setSystemSettings',
         {'settings': {'eulaInfoNetwork': next_docs, 'eulaStatus': next_flags}})
    now, _ = consent_read()
    ok = bool(now) and now.get(key) == on
    log('consent %s -> %s (%s)%s' % (key, on, ','.join(changed), '' if ok else ' NOT applied'))
    return {'ok': ok, 'changed': changed}


# ---- daily power-off ---------------------------------------------------------
# Settings -> TV -> Spegnimento programmato: every day at HH:MM the TV is
# switched off as the remote's power key does, if it is on then. A notice is
# shown a minute before. Checked against the TV's own clock every 20 s: a
# check fires when the minute was reached or passed since the check before
# (a DST jump or a slow loop cannot skip it), once a day (local date). Nothing
# is done in the first 10 minutes after boot, nor until the clock is trusted:
# the TV's RTC starts from a stale time after a power cut.

TIME_RE = __import__('re').compile(r'^([01]\d|2[0-3]):([0-5]\d)$')
ON_STATES = ('Active', 'Screen Off', 'Screen Saver')
MIN_UPTIME = 600
# A gap this long between two checks (clock set, daemon paused) is not a
# window to catch up on: only the exact minute counts then.
MAX_GAP = 600


def clean_time(value):
    return value if isinstance(value, (str, type(u''))) and TIME_RE.match(value) else None


def minutes_of(hhmm):
    h, m = hhmm.split(':')
    return int(h) * 60 + int(m)


def due(now_struct, last_struct, target_hhmm, done_date):
    """True when target_hhmm (local) was reached or passed between last_struct
    (the check before, None at the first one) and now_struct, and it was not
    done yet on now's date."""
    if not target_hhmm:
        return False
    if done_date == time.strftime('%Y-%m-%d', now_struct):
        return False
    target = minutes_of(target_hhmm)
    now = now_struct.tm_hour * 60 + now_struct.tm_min
    if last_struct is None:
        return now == target
    try:
        gap = time.mktime(now_struct) - time.mktime(last_struct)
    except (OverflowError, ValueError):
        gap = MAX_GAP + 1
    if gap < 0 or gap > MAX_GAP:
        return now == target
    last = last_struct.tm_hour * 60 + last_struct.tm_min
    if now == last:
        return now == target
    if now > last:
        return last < target <= now
    return target > last or target <= now  # past midnight


def power_off_due(at, now_struct, done_day, warned_day, last_struct=None):
    """What to do now for a power-off at `at` (HH:MM): 'warn' a minute before,
    'off' at the minute, None otherwise; once per day each."""
    if not at:
        return None
    if due(now_struct, last_struct, at, done_day):
        return 'off'
    day = time.strftime('%Y-%m-%d', now_struct)
    warn_at = '%02d:%02d' % divmod((minutes_of(at) - 1) % 1440, 60)
    if done_day != day and due(now_struct, last_struct, warn_at, warned_day):
        return 'warn'
    return None


def uptime_seconds():
    try:
        with open('/proc/uptime') as f:
            return float(f.read().split()[0])
    except Exception:
        return None


def clock_trusted(reply, year, uptime):
    """Whether the clock can be trusted, from systemservice's clock/getTime
    reply: a source other than the RTC (micom) or a manual one, or a time
    source set from NTP or the broadcast. Without a usable reply, a sane year
    on a TV up long enough to have synced."""
    if isinstance(reply, dict) and reply.get('returnValue') is not False:
        src = str(reply.get('source') or '').lower()
        sys_src = str(reply.get('systemTimeSource') or reply.get('utcSource') or '').lower()
        if src or sys_src:
            if any(k in sys_src for k in ('ntp', 'broadcast', 'network', 'tv')):
                return True
            return src not in ('', 'micom', 'local', 'manual', 'rtc')
    return bool(year and year >= 2024 and uptime is not None and uptime >= MIN_UPTIME)


CLOCK = {'ok': False}


def clock_reliable():
    """Cached once true: the clock does not get worse while the TV is on."""
    if CLOCK['ok']:
        return True
    r = luna('luna://com.webos.service.systemservice/clock/getTime', {}, wait=3000)
    ok = clock_trusted(r, time.localtime().tm_year, uptime_seconds())
    if ok:
        CLOCK['ok'] = True
        log('clock trusted (%s)' % (r.get('source') or r.get('systemTimeSource') or 'fallback'))
    return ok


def tv_power_state():
    return luna('luna://com.webos.service.tvpower/power/getPowerState', {}).get('state')


def toast(message):
    try:
        subprocess.call(['luna-send', '-i', '-n', '1', '-w', '3000', '-a', 'org.webosbrew.lounge.launcher',
                         'luna://com.webos.notification/createToast',
                         json.dumps({'sourceId': 'org.webosbrew.lounge.launcher', 'message': message})],
                        stdin=open(os.devnull), stdout=open(os.devnull, 'w'), stderr=open(os.devnull, 'w'))
    except Exception:
        pass


def power_off_loop():
    done = {'day': None, 'warned': None}
    last = None
    while True:
        try:
            check_uninstalled()
            at = load_conf()['powerOffAt']
            now = time.localtime()
            action = None
            up = uptime_seconds()
            if at and (up is None or up >= MIN_UPTIME) and clock_reliable():
                action = power_off_due(at, now, done['day'], done['warned'], last)
            last = now
            day = time.strftime('%Y-%m-%d', now)
            if action and tv_power_state() in ON_STATES:
                if action == 'warn':
                    toast('La TV si spegne tra un minuto (spegnimento programmato alle %s).' % at)
                    done['warned'] = day
                else:
                    log('scheduled power-off at %s' % at)
                    r = luna('luna://com.webos.service.tvpower/power/powerOff', {'reason': 'remoteKey'}, wait=6000)
                    if not r.get('returnValue'):
                        luna('luna://com.webos.service.tvpower/power/powerOff', {'reason': 'localKey'}, wait=6000)
                    done['day'] = day
            elif action == 'off':
                done['day'] = day
        except Exception as e:
            log('power-off check: %s' % e)
        time.sleep(20)


# ---- Cinema uninstalled -------------------------------------------------------
# Removing Cinema from LG's Home leaves the root copy, its boot hooks and the
# daemon behind, with nothing to switch them off. So the daemon (at start and
# every 20 s) and the boot hook look for Cinema's appinfo.json: gone, while
# Homebrew Channel's own folder on the same partition is there (so the
# partition is mounted) and no update of Cinema is running (the installer
# takes the folder away for a moment), everything is given back to LG and
# removed.

APPS_DIR = '/media/developer/apps/usr/palm/applications'
APP_DIR = os.path.join(APPS_DIR, 'org.webosbrew.lounge.launcher')
HBC_DIR = os.path.join(APPS_DIR, 'org.webosbrew.hbchannel')
HOOKS = ['/var/lib/webosbrew/init.d/55-cinema-tvtools', '/var/lib/webosbrew/init.d/45-cinema-tvtools-memory',
         '/var/lib/webosbrew/init.d/55-hbchannel-watchdog']
UPDATE_JSON = os.path.join(RUN, 'update.json')
WATCHDOG_PID = '/tmp/hbchannel-watchdog/watchdog.pid'
EMPTY_CONF = {'preloadOff': [], 'settingsOff': [], 'servicesOff': [], 'keepInMemory': [], 'remoteKeys': {},
              'powerOffAt': None, 'cinemaFirst': False}
UNINSTALL = {'misses': 0}


# ---- way out with the remote ------------------------------------------------
# Read from the kernel's input devices without grabbing them, so LG and LG
# Input Hook get every key as before. Three short presses of Home within 2 s,
# or Back held for 1.2 s and let go while Cinema is in front, open LG's Home: a way out
# when Cinema hangs or LG Input Hook keeps reopening it.

KEY_HOME = 773
KEY_BACK = 412
EVENT_SIZE = 16          # struct input_event on 32-bit ARM: llHHi
KEYLOG_MARK = '/tmp/cinema-keylog'   # when it exists, every key code is logged


def remote_devices(text):
    """/dev/input/eventN of the LG remotes, from /proc/bus/input/devices."""
    found, name = [], ''
    for line in (text or '').splitlines():
        if line.startswith('N: Name='):
            name = line[8:].strip().strip('"')
        elif line.startswith('H: Handlers=') and name.startswith('LGE') and 'kbd' in line[12:].split():
            for h in line[12:].split():
                if h.startswith('event'):
                    found.append('/dev/input/' + h)
    return found


class EscapeKeys(object):
    """Turns key events (code, value, time) into 'home3' or 'backhold'.
    value is 1 for a press, 0 for a release and 2 for autorepeat. Back held
    counts when it is let go: while it is still down its repeats would reach
    LG's Home and close it again."""
    SHORT_MIN, SHORT_MAX, WINDOW, HOLD = 0.04, 0.5, 2.0, 1.2

    def __init__(self):
        self.home_down = None
        self.home_taps = []
        self.back_down = None

    def key(self, code, value, t):
        if code == KEY_HOME:
            if value == 1:
                self.home_down = t
            elif value == 0 and self.home_down is not None:
                held = t - self.home_down
                self.home_down = None
                if self.SHORT_MIN <= held <= self.SHORT_MAX:
                    self.home_taps = [x for x in self.home_taps if t - x <= self.WINDOW] + [t]
                    if len(self.home_taps) >= 3:
                        self.home_taps = []
                        return 'home3'
                else:
                    self.home_taps = []
        elif code == KEY_BACK:
            if value == 1:
                self.back_down = t
            elif value == 0 and self.back_down is not None:
                held = t - self.back_down
                self.back_down = None
                if held >= self.HOLD:
                    return 'backhold'
        elif value == 1:
            self.home_taps = []
        return None


def foreground_app():
    return (luna('luna://com.webos.applicationManager/getForegroundAppInfo', {}) or {}).get('appId')


def open_lg_home(why):
    log('way out (%s): LG Home' % why)
    luna('luna://com.webos.applicationManager/launch', {'id': 'com.webos.app.home'})


def escape_action(what):
    if what == 'home3':
        # LG Input Hook opens Cinema on each press: let the last one land first.
        time.sleep(0.8)
        open_lg_home('Home three times')
    elif what == 'backhold' and foreground_app() == CINEMA_ID:
        open_lg_home('Back held')


def escape_loop():
    import select
    import struct
    machine = EscapeKeys()
    fds, rescan = {}, 0
    while True:
        now = time.time()
        if not fds or now >= rescan:
            for fd in fds:
                try:
                    os.close(fd)
                except OSError:
                    pass
            fds = {}
            try:
                paths = remote_devices(open('/proc/bus/input/devices').read())
            except IOError:
                paths = []
            for path in paths:
                try:
                    fds[os.open(path, os.O_RDONLY | os.O_NONBLOCK)] = path
                except OSError:
                    pass
            rescan = now + 300
            if not fds:
                time.sleep(30)
                continue
        try:
            ready = select.select(list(fds), [], [], 30)[0]
        except (select.error, OSError, ValueError):
            rescan = 0
            continue
        events = []
        for fd in ready:
            try:
                data = os.read(fd, EVENT_SIZE * 32)
            except OSError:
                rescan = 0
                continue
            for i in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
                sec, usec, etype, code, value = struct.unpack('llHHi', data[i:i + EVENT_SIZE])
                if etype == 1:
                    events.append((code, value, sec + usec / 1e6))
        if events and os.path.exists(KEYLOG_MARK):
            log('keys %s' % ' '.join('%d:%d' % (c, v) for c, v, _ in events))
        fired = [machine.key(c, v, t) for c, v, t in events]
        for what in fired:
            if what:
                try:
                    escape_action(what)
                except Exception as e:
                    log('way out failed: %s' % e)


def app_removed():
    return os.path.isdir(HBC_DIR) and not os.path.isfile(os.path.join(APP_DIR, 'appinfo.json'))


def update_in_progress():
    p = read_json(UPDATE_JSON, {})
    return isinstance(p, dict) and p.get('state') in ('checking', 'downloading', 'installing') \
        and time.time() - (p.get('at') or 0) < 900


def check_uninstalled():
    """Every 20 s from the daemon: three checks in a row without Cinema."""
    if app_removed() and not update_in_progress():
        UNINSTALL['misses'] += 1
        if UNINSTALL['misses'] >= 3:
            log('Cinema is no longer installed: TV tools switched off and removed')
            self_uninstall()
            os._exit(0)
    else:
        UNINSTALL['misses'] = 0


def kill_pidfile(path, word):
    try:
        pid = int(open(path).read().strip())
        with open('/proc/%d/cmdline' % pid) as f:
            if word in f.read():
                os.kill(pid, 15)
    except Exception:
        pass


def self_uninstall():
    """Everything back to LG, then the hooks, the activity, the state and the
    root copy removed. Also what disable-tvtools.sh runs."""
    state = read_json(STATE, {})
    for step in (lambda: apply_memory(EMPTY_CONF, state), lambda: apply_preload(EMPTY_CONF, state),
                 lambda: restore_settings(EMPTY_CONF, state), lambda: apply_services(EMPTY_CONF, state),
                 lambda: apply_keys(EMPTY_CONF, remove=True), lambda: apply_first_app(EMPTY_CONF)):
        try:
            step()
        except Exception as e:
            log('restore step failed: %s' % e)
    for path in HOOKS + [STATE, CONF, PIDFILE, os.path.join(ROOT, 'failsafe-rebooted')]:
        try:
            os.remove(path)
        except OSError:
            pass
    kill_pidfile(WATCHDOG_PID, 'hbchannel-watchdog')
    luna('luna://com.webos.service.activitymanager/cancel',
         {'activityName': 'org.webosbrew.lounge.launcher.failsafe-check'})
    import shutil
    shutil.rmtree(os.path.join(ROOT, 'updates'), ignore_errors=True)
    shutil.rmtree(os.path.join(ROOT, 'tvtools'), ignore_errors=True)
    log('tools removed')


# ---- Cinema at power-on instead of Live TV --------------------------------------
#
# At power-on LG's bootd launches the app named in /var/lib/eim/lastinput
# (physicalLastSourceAppId) at about 16 s, before any Homebrew Channel hook, and
# at the end of its boot it opens the last input again over whatever is in
# front. With Cinema named there (LG's own input kept, so Live TV shows while
# Cinema starts), the end of LG's boot leaves Cinema alone. A web app named
# there only gets an input stand-in (com.webos.app.inputcommon, windowGroup
# true): the compositor key filter launches the real Cinema as soon as LG takes
# launches, and boot-launch.sh does it too when Homebrew Channel starts. The file is pinned read-only with a bind mount,
# as LG rewrites it whenever an input is used (its rewrite then fails and EIM
# keeps the real input in memory). Same idea as lgtv-webos-root-launcher and
# lg-luma (PR #89).

LASTINPUT = '/var/lib/eim/lastinput'
PINNED = os.path.join(ROOT, 'lastinput.pinned')
LG_LASTINPUT = os.path.join(ROOT, 'lastinput.lg')
CINEMA_ID = 'org.webosbrew.lounge.launcher'
DEFAULT_LASTINPUT = {'type': 'DTV', 'appId': 'com.webos.app.livetv', 'physicalLastSourceId': 'DTV',
                     'physicalLastSourceAppId': 'com.webos.app.livetv'}


def boot_input(inputs):
    """(id, appId) of the first HDMI with nothing connected, from EIM's
    getAllInputStatus devices; Live TV when every HDMI is in use."""
    for d in inputs or []:
        if isinstance(d, dict) and str(d.get('id', '')).startswith('HDMI_') and d.get('connected') is False and d.get('appId'):
            return d['id'], d['appId']
    return 'DTV', 'com.webos.app.livetv'


def pinned_lastinput(input_id):
    """The last input bootd reads at power-on: Cinema as an app input
    (MVPD_IP). bootd then starts Cinema itself as the first app ("OTT GIP"
    in bootd.log) at about 24 s, the real app and not the empty input card
    it opens for an HDMI or Live TV entry. physicalLastSourceId is a free
    HDMI: with Live TV there, LG reopened Live TV over Cinema at the end of
    its boot (seen at 82 s)."""
    return {'type': 'MVPD_IP', 'appId': CINEMA_ID, 'physicalLastSourceId': input_id,
            'physicalLastSourceAppId': CINEMA_ID}


LAST_APP_KEYS = ('lastInputApp', 'physicalLastInputApp')


def keep_last_input_app():
    """LG's settings lastInputApp/physicalLastInputApp (category general) are
    what SAM's last-input handler opens at normal-boot-done (about 70 s);
    EIM rewrites them whenever the input changes. With Live TV there LG
    opened Live TV over Cinema at the end of the boot; with Cinema there it
    opens Cinema again."""
    cur = (luna('luna://com.webos.settingsservice/getSystemSettings',
                {'category': 'general', 'keys': list(LAST_APP_KEYS)}) or {}).get('settings') or {}
    if all(cur.get(k) == CINEMA_ID for k in LAST_APP_KEYS):
        return False
    luna('luna://com.webos.settingsservice/setSystemSettings',
         {'category': 'general', 'settings': dict((k, CINEMA_ID) for k in LAST_APP_KEYS)})
    return True


def release_last_input_app():
    cur = (luna('luna://com.webos.settingsservice/getSystemSettings',
                {'category': 'general', 'keys': list(LAST_APP_KEYS)}) or {}).get('settings') or {}
    back = dict((k, 'com.webos.app.livetv') for k in LAST_APP_KEYS if cur.get(k) == CINEMA_ID)
    if back:
        luna('luna://com.webos.settingsservice/setSystemSettings', {'category': 'general', 'settings': back})


def lastinput_pinned():
    try:
        return any(line.split()[1] == LASTINPUT for line in open('/proc/mounts'))
    except Exception:
        return False


def write_plain(path, text, mode=0o644):
    tmp = path + '.cinema'
    with open(tmp, 'w') as f:
        f.write(text)
    os.chmod(tmp, mode)
    os.rename(tmp, path)


def apply_first_app(conf):
    if conf.get('cinemaFirst'):
        if not os.path.exists(LG_LASTINPUT):
            current = read_json(LASTINPUT, None)
            if isinstance(current, dict) and current.get('physicalLastSourceAppId') != CINEMA_ID:
                write_plain(LG_LASTINPUT, json.dumps(current, separators=(',', ':')), 0o600)
        # Cinema registered as an app input. Without it LG hid Cinema at
        # normal-boot-done (about 70 s) and its last-input handler opened
        # Live TV; with it Cinema stays. EIM keeps it across reboots and
        # answers true again when it is already there.
        # Once a boot is enough.
        mark = os.path.join(RUN, 'eim-registered')
        if not os.path.exists(mark):
            r = luna('luna://com.webos.service.eim/addDevice', {'appId': CINEMA_ID, 'pigImage': '', 'mvpdIcon': ''})
            if r.get('returnValue'):
                try:
                    open(mark, 'w').close()
                except IOError:
                    pass
                log('power-on: Cinema registered as an app input')
        if keep_last_input_app():
            log('power-on: Cinema is LG\'s last input app')
        # The key filter (START_FIRST_JS) stays as the fallback: it covers
        # an input card with Live TV and relaunches Cinema if bootd did not.
        inputs = luna('luna://com.webos.service.eim/getAllInputStatus', {}).get('devices')
        want = json.dumps(pinned_lastinput(boot_input(inputs)[0]), separators=(',', ':'))
        have = None
        try:
            have = open(PINNED).read()
        except IOError:
            pass
        if have != want:
            # A new file is a new inode: the bind mount would keep the old one.
            if lastinput_pinned():
                subprocess.call(['umount', LASTINPUT])
            write_plain(PINNED, want)
        if not lastinput_pinned():
            text = open(PINNED).read()
            if open(LASTINPUT).read() != text:
                write_plain(LASTINPUT, text)
            if subprocess.call(['mount', '--bind', PINNED, LASTINPUT]) == 0:
                subprocess.call(['mount', '-o', 'remount,ro,bind', LASTINPUT])
            log('power-on: Cinema on %s' % json.loads(text).get('physicalLastSourceId'))
        return
    if lastinput_pinned():
        subprocess.call(['umount', LASTINPUT])
    if os.path.exists(PINNED) or (read_json(LASTINPUT, {}) or {}).get('physicalLastSourceAppId') == CINEMA_ID:
        lg = read_json(LG_LASTINPUT, None)
        write_plain(LASTINPUT, json.dumps(lg if isinstance(lg, dict) else DEFAULT_LASTINPUT, separators=(',', ':')))
        for path in (PINNED, LG_LASTINPUT):
            try:
                os.remove(path)
            except OSError:
                pass
        luna('luna://com.webos.service.eim/deleteDevice', {'appId': CINEMA_ID})
        release_last_input_app()
        log('power-on: LG last input back')


# ---- entry points -----------------------------------------------------------

def apply_all(boot=False):
    conf = load_conf()
    state = read_json(STATE, {})
    apply_memory(conf, state, boot)
    apply_preload(conf, state)
    restore_settings(conf, state)
    apply_settings(conf, state)
    apply_services(conf, state)
    apply_keys(conf)
    apply_first_app(conf)
    log('applied')


def installed_titles():
    r = luna('luna://com.webos.applicationManager/listApps', {}, wait=8000)
    out = {}
    for a in r.get('apps') or []:
        if isinstance(a, dict) and a.get('id'):
            out[a['id']] = a.get('title') or a['id']
    return out


def status():
    conf = load_conf()
    state = read_json(STATE, {})
    # LG's own values, so Settings shows what switching an app back on gives.
    lg = dict((e.get('id'), bool(e.get('isEnabled'))) for e in state.get('preloadLg') or [])
    lst = preload_list() or []
    titles = installed_titles()
    print(json.dumps({
        'conf': conf,
        'python': True,
        'preload': [{'id': e.get('id'), 'title': titles.get(e.get('id')), 'installed': e.get('id') in titles,
                     'enabled': bool(e.get('isEnabled')), 'lgEnabled': lg.get(e.get('id'), bool(e.get('isEnabled'))),
                     'memoryMb': e.get('requiredMemory'), 'essential': e.get('id') in ESSENTIAL} for e in lst],
        'installed': dict((a, a in titles) for a in conf['keepInMemory'] + ['org.bloomee.webos']),
        'memorySupported': os.path.exists(MEM_SYSTEM),
        'remoteKeys': available_keys() if key_chain() is not None else [],
        'consent': consent_status(),
        'apps': titles,
        'settings': setting_values(),
        'services': dict((s, service_active(s)) for s in SERVICES if service_exists(s)),
        'daemon': daemon_running(),
        'memoryOverride': os.path.exists(MEM_MARK),
    }))


def daemon_running():
    try:
        pid = int(open(PIDFILE).read().strip())
        os.kill(pid, 0)
        return pid
    except Exception:
        return None


def subscribe(uri, payload, on_reply):
    """Follows a luna subscription; restarts it if luna-send exits. One that
    ends without a reply is retried with a growing pause (10 s up to 60 s),
    logged when it goes down and when it is back, not at every try."""
    down = 0
    while True:
        replies = 0
        try:
            p = subprocess.Popen(['luna-send', '-i', uri, json.dumps(payload)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.devnull, 'w'))
            buf = ''
            for line in iter(p.stdout.readline, b''):
                buf += line.decode('utf-8', 'replace')
                try:
                    msg = json.loads(buf)
                except ValueError:
                    if len(buf) > 200000:
                        buf = ''
                    continue
                buf = ''
                replies += 1
                if down:
                    log('subscription %s back' % uri)
                    down = 0
                try:
                    on_reply(msg)
                except Exception as e:
                    log('handler error: %s' % e)
            p.wait()
        except Exception as e:
            if not down:
                log('subscription %s: %s' % (uri, e))
        if replies:
            down = 0
            time.sleep(10)
            continue
        down += 1
        if down == 1:
            log('subscription %s not answering, retrying' % uri)
        time.sleep(min(10 * (2 ** (down - 1)), 60))


def daemon():
    if daemon_running():
        print('already running')
        return
    if app_removed() and not update_in_progress():
        log('Cinema is no longer installed: TV tools switched off and removed')
        self_uninstall()
        return
    with open_private(PIDFILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC) as f:
        f.write(str(os.getpid()))
    log('daemon start')
    lock = threading.Lock()
    apply_all()
    last = {'state': None}

    def on_power(msg):
        st = msg.get('state')
        if st and st != last['state']:
            log('power %s -> %s' % (last['state'], st))
            if st != 'Active' and last['state'] == 'Active' and load_conf()['cinemaFirst']:
                # Going off: the next power-on reads LG's last input app.
                try:
                    keep_last_input_app()
                except Exception as e:
                    log('last input app: %s' % e)
            if st == 'Active' and last['state'] not in (None, 'Active'):
                # Switched on: LG may have put preloading and settings back.
                time.sleep(1)
                with lock:
                    apply_all()
            last['state'] = st

    def on_settings(msg):
        vals = {}
        for k, v in (msg.get('settings') or {}).items():
            vals[k] = v.get('value') if isinstance(v, dict) else v
        conf = load_conf()
        if any(vals.get(k) not in (None, 'off') for k in conf['settingsOff']):
            with lock:
                apply_settings(conf, read_json(STATE, {}), vals)

    threads = [threading.Thread(target=subscribe, args=('luna://com.webos.service.tvpower/power/getPowerState',
                                                        {'subscribe': True}, on_power))]
    for cat in sorted(set(SETTINGS.values())):
        keys = [k for k, c in SETTINGS.items() if c == cat]
        threads.append(threading.Thread(target=subscribe, args=('luna://com.webos.settingsservice/getSystemSettings',
                                                                {'category': cat, 'keys': keys, 'subscribe': True},
                                                                on_settings)))
    threads.append(threading.Thread(target=power_off_loop))
    threads.append(threading.Thread(target=escape_loop))
    for t in threads:
        t.daemon = True
        t.start()
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'apply':
        apply_all()
    elif cmd == 'consent' and len(sys.argv) > 3:
        print(json.dumps(set_consent(sys.argv[2], sys.argv[3] == 'on')))
    elif cmd == 'restore-keys':
        apply_keys(load_conf(), remove=True)
    elif cmd == 'memory':
        apply_memory(load_conf(), read_json(STATE, {}), boot=True)
    elif cmd == 'uninstall':
        self_uninstall()
    elif cmd == 'daemon':
        daemon()
    else:
        status()
