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


def log(msg):
    try:
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
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f)
    os.chmod(tmp, 0o600)
    os.rename(tmp, path)


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


def apply_preload(conf, state):
    current = preload_list()
    if current is None:
        return
    if not state.get('preloadLg'):
        # LG's own list, kept once, to switch apps back to LG's setting.
        state['preloadLg'] = current
        write_json(STATE, state)
    lg = state['preloadLg']
    target = preload_target(lg, set(conf['preloadOff']))
    if json.dumps(target, sort_keys=True) != json.dumps(current, sort_keys=True):
        luna('luna://com.webos.service.config/setConfigs', {'configs': {PRELOAD_KEY: target}})
        log('preload list written: off=%s' % ','.join(conf['preloadOff']))
    # Takes effect at once on newer firmware. On webOS 5 the call never answers
    # and changes nothing: the configd list counts from the next restart. The
    # preload manager must not be restarted to apply it sooner: on webOS 5
    # that closes every app in use.
    for e in target:
        if e.get('id') in ESSENTIAL:
            continue
        luna('luna://com.webos.service.preloadmanager/setPreloadPolicy',
             {'application': {'id': e['id'], 'isEnabled': bool(e.get('isEnabled'))}}, wait=1500)


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


def filter_source():
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
        'function init() {',
        '    try {',
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
    if remove or (not conf['remoteKeys'] and not ours):
        if ours:
            write_chain(rest)
            log('remote key filter taken out of the chain')
        luna('luna://com.webos.service.config/setConfigs', {'configs': {KEYS_VALUE: {'keys': {}}}}) if ours else None
        if remove and os.path.exists(FILTER_FILE):
            os.remove(FILTER_FILE)
        return
    src = filter_source()
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
# shown a minute before. Checked against the TV's own clock every 20 s, so a
# clock set late after a power cut only delays it.

TIME_RE = __import__('re').compile(r'^([01]\d|2[0-3]):([0-5]\d)$')
ON_STATES = ('Active', 'Screen Off', 'Screen Saver')


def clean_time(value):
    return value if isinstance(value, (str, type(u''))) and TIME_RE.match(value) else None


def minutes_of(hhmm):
    h, m = hhmm.split(':')
    return int(h) * 60 + int(m)


def power_off_due(at, now_struct, done_day, warned_day):
    """What to do now for a power-off at `at` (HH:MM): 'warn' a minute before,
    'off' at the minute, None otherwise; once per day each."""
    if not at:
        return None
    day = time.strftime('%Y-%m-%d', now_struct)
    now = now_struct.tm_hour * 60 + now_struct.tm_min
    target = minutes_of(at)
    if now == target and done_day != day:
        return 'off'
    if now == (target - 1) % 1440 and warned_day != day and done_day != day:
        return 'warn'
    return None


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
    while True:
        try:
            at = load_conf()['powerOffAt']
            now = time.localtime()
            action = power_off_due(at, now, done['day'], done['warned'])
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
    """Follows a luna subscription; restarts it if luna-send exits."""
    while True:
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
                try:
                    on_reply(msg)
                except Exception as e:
                    log('handler error: %s' % e)
            p.wait()
        except Exception as e:
            log('subscription %s: %s' % (uri, e))
        time.sleep(10)


def daemon():
    if daemon_running():
        print('already running')
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
    elif cmd == 'daemon':
        daemon()
    else:
        status()
