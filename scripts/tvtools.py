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


def apply_services(conf, state):
    stopped = set(state.get('servicesStopped') or [])
    for s in conf['servicesOff']:
        systemctl('mask', '--runtime', '--now', s + '.service')
        stopped.add(s)
    for s in list(stopped):
        if s not in conf['servicesOff']:
            systemctl('unmask', '--runtime', s + '.service')
            systemctl('start', s + '.service')
            stopped.discard(s)
            log('service %s started again' % s)
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


# ---- entry points -----------------------------------------------------------

def apply_all(boot=False):
    conf = load_conf()
    state = read_json(STATE, {})
    apply_memory(conf, state, boot)
    apply_preload(conf, state)
    restore_settings(conf, state)
    apply_settings(conf, state)
    apply_services(conf, state)
    log('applied')


def status():
    conf = load_conf()
    lst = preload_list() or []
    print(json.dumps({
        'conf': conf,
        'preload': [{'id': e.get('id'), 'enabled': bool(e.get('isEnabled')), 'memoryMb': e.get('requiredMemory'),
                     'essential': e.get('id') in ESSENTIAL} for e in lst],
        'settings': setting_values(),
        'services': dict((s, service_active(s)) for s in SERVICES),
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
    for t in threads:
        t.daemon = True
        t.start()
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'apply':
        apply_all()
    elif cmd == 'memory':
        apply_memory(load_conf(), read_json(STATE, {}), boot=True)
    elif cmd == 'daemon':
        daemon()
    else:
        status()
