# -*- coding: utf-8 -*-
"""Cinema: the LED strip behind the TV follows the colours on screen.

A process of its own, started by tvtools.py's daemon:

    ambilight.py daemon             hold the strip and follow the screen
    ambilight.py scan [SECONDS]     strips in range, as JSON
    ambilight.py preview ADDR R G B show a colour on that strip
    ambilight.py ambient-preview    show the room light chosen in Settings
    ambilight.py status             running or not, and the settings

Settings live in tvtools.json under "ledStrip": {"address", "name", "follow",
"brightness", "ambient", "ambientBrightness"}. With the TV on and "follow",
the strip follows the screen; at a clean power-off, or when only the screen
goes off, it takes the room light ("ambient": a colour name, "off" or "keep").

The screen: com.webos.service.capture/executeOneShot writes a 240x136 BMP
(about 40 ms; sizes that are not multiples of 8 are refused) with the video
and the interface together. The strip: ELK-BLEDOM family controllers (the
"Lotus Lantern" app, names ELK-*, MELK-*), service FFF0, characteristic
FFF3, nine-byte frames 7E 07 05 03 RR GG BB 10 EF. Bluetooth goes through
LG's own service (com.webos.service.bluetooth2): the GATT client lives as
long as the gatt/connect subscription, and writes name that client. A strip
takes one connection at a time: the phone app reaches it when the TV is in
standby, or once this process lets it go.
Protocol from Rxflex/LotusLantern and dave-code-ruiz/elkbledom (MIT).

Runs on the TV's Python 2.7 and on Python 3 for the tests.
"""
from __future__ import print_function

import json
import os
import struct
import subprocess
import sys
import threading
import time

BT = 'luna://com.webos.service.bluetooth2'
CAPTURE = 'luna://com.webos.service.capture/executeOneShot'
SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
WRITE_CHAR = '0000fff3-0000-1000-8000-00805f9b34fb'
NAME_PREFIXES = ('ELK-', 'MELK', 'ELK~', 'LEDBLE', 'LED LIGHT STRIP', 'XSL-')
WIDTH, HEIGHT = 240, 136
STEP = 8                 # every 8th pixel in both directions: 30 x 17 samples
DARK = 24                # a pixel whose brightest channel is below this is black
INTERVAL = 0.1           # seconds per frame: about 10 colours a second
MIN_GAP = 0.06           # never two writes closer than this (the strip drops them)


def say(msg):
    sys.stderr.write(time.strftime('%H:%M:%S ') + msg + '\n')


LOG = [say]


def log(msg):
    try:
        LOG[0](msg)
    except Exception:
        pass


# ---- frames -----------------------------------------------------------------

def power_frame(on):
    return [0x7e, 0x04, 0x04, 0x01 if on else 0x00, 0x00, 0x01 if on else 0x00, 0xff, 0x00, 0xef]


def color_frame(rgb):
    r, g, b = [max(0, min(255, int(round(c)))) for c in rgb]
    return [0x7e, 0x07, 0x05, 0x03, r, g, b, 0x10, 0xef]


def brightness_frame(percent):
    return [0x7e, 0x04, 0x01, max(0, min(100, int(percent))), 0x00, 0xff, 0xff, 0x00, 0xef]


def strip_name(record):
    """The advertised name in a scan record (AD type 0x08 or 0x09), or ''."""
    i = 0
    rec = list(record or [])
    while i < len(rec):
        n = rec[i]
        if n == 0 or i + n >= len(rec) + 1:
            break
        kind = rec[i + 1] if i + 1 < len(rec) else None
        if kind in (0x08, 0x09):
            try:
                return bytearray(rec[i + 2:i + 1 + n]).decode('utf-8', 'replace')
            except Exception:
                return ''
        i += n + 1
    return ''


def is_strip(name):
    return bool(name) and any(name.upper().startswith(p) for p in NAME_PREFIXES)


# ---- the screen ---------------------------------------------------------------

def bmp_pixels(data):
    """(width, height, rows) from a 24-bit BMP; rows[y] is the BGR bytes of
    line y from the top. None when the data is not that."""
    if len(data) < 54 or data[:2] != b'BM':
        return None
    offset = struct.unpack('<I', data[10:14])[0]
    w, h = struct.unpack('<ii', data[18:26])
    bpp = struct.unpack('<H', data[28:30])[0]
    if bpp != 24 or w <= 0 or h == 0:
        return None
    top_down = h < 0
    h = abs(h)
    stride = (w * 3 + 3) & ~3
    if len(data) < offset + stride * h:
        return None
    rows = []
    for y in range(h):
        src = y if top_down else h - 1 - y
        rows.append(data[offset + src * stride:offset + src * stride + w * 3])
    return w, h, rows


def hue_bin(r, g, b, bins=12):
    mx = max(r, g, b)
    mn = min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0
    if mx == r:
        h = ((g - b) / float(d)) % 6
    elif mx == g:
        h = (b - r) / float(d) + 2
    else:
        h = (r - g) / float(d) + 4
    return int(h * bins / 6.0) % bins


def screen_color(w, h, rows, step=STEP):
    """The colour the strip shows for one frame, (r, g, b) 0-255.

    Black (letterbox bars, dark scenes) is left out. The pixels are grouped by
    hue, each counted by how coloured and how bright it is, and the strongest
    group wins: a red car in a grey street gives red, not the muddy average.
    A scene with little colour gives its own average (white-ish, warm or
    cold). A screen almost all black gives a dim version of what is there."""
    bins = {}
    total = [0, 0, 0, 0]
    lit = 0
    seen = 0
    for y in range(step // 2, h, step):
        row = rows[y]
        if isinstance(row, str):
            row = bytearray(row)
        for x in range(step // 2, w, step):
            i = x * 3
            b, g, r = row[i], row[i + 1], row[i + 2]
            seen += 1
            mx = max(r, g, b)
            if mx < DARK:
                continue
            lit += 1
            total[0] += r
            total[1] += g
            total[2] += b
            total[3] += 1
            sat = (mx - min(r, g, b)) / float(mx)
            if sat < 0.2:
                continue
            weight = sat * sat * mx
            k = hue_bin(r, g, b)
            acc = bins.get(k)
            if acc is None:
                acc = bins[k] = [0.0, 0.0, 0.0, 0.0]
            acc[0] += r * weight
            acc[1] += g * weight
            acc[2] += b * weight
            acc[3] += weight
    if not seen or not total[3]:
        return (0, 0, 0)
    avg = (total[0] / float(total[3]), total[1] / float(total[3]), total[2] / float(total[3]))
    # How much of the screen is lit: a mostly black frame gives a dim light.
    share = lit / float(seen)
    level = min(1.0, share * 2.5)
    if bins:
        best = max(bins.values(), key=lambda a: a[3])
        colorful = sum(a[3] for a in bins.values()) / (255.0 * total[3])
        if colorful > 0.05:
            col = (best[0] / best[3], best[1] / best[3], best[2] / best[3])
            # Keep the hue of the winner at the brightness of the scene.
            bright = max(avg) / float(max(col) or 1)
            col = tuple(c * max(bright, 0.6) for c in col)
            return tuple(c * level for c in col)
    return tuple(c * level for c in avg)


def boost(rgb, saturation=1.15, gamma=1.6):
    """Screens look less saturated on a wall, and LEDs are brightest at the
    bottom of their range: colour pushed out from grey, then a gamma curve so
    that a dim scene gives a dim light and not half brightness."""
    r, g, b = rgb
    grey = (r + g + b) / 3.0
    out = []
    for c in (r, g, b):
        c = grey + (c - grey) * saturation
        c = max(0.0, min(255.0, c)) / 255.0
        out.append(255.0 * (c ** gamma))
    return tuple(out)


class Smoother(object):
    """Follows the target colour a step at a time, faster on a big change (a
    cut) than on a small one, so the light neither flickers nor drags."""

    def __init__(self, slow=0.25, fast=0.6):
        self.slow = slow
        self.fast = fast
        self.value = None

    def step(self, target):
        if self.value is None:
            self.value = tuple(float(c) for c in target)
            return self.value
        dist = max(abs(a - b) for a, b in zip(self.value, target))
        k = self.fast if dist > 90 else self.slow
        self.value = tuple(a + (b - a) * k for a, b in zip(self.value, target))
        return self.value


def changed(prev, cur, threshold=3):
    if prev is None:
        return True
    return max(abs(int(round(a)) - int(round(b))) for a, b in zip(prev, cur)) >= threshold


# ---- luna -------------------------------------------------------------------

def luna(uri, payload, timeout=8.0):
    """One reply from a luna call. luna-send stays silent when its stdin is at
    end of file, so stdin is a pipe kept open until the reply is read."""
    p = subprocess.Popen(['luna-send', '-i', '-n', '1', uri, json.dumps(payload)],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    timer = threading.Timer(timeout, p.kill)
    timer.start()
    try:
        buf = b''
        while True:
            line = p.stdout.readline()
            if not line:
                break
            buf += line
            try:
                return json.loads(buf.decode('utf-8', 'replace'))
            except ValueError:
                continue
        return {}
    finally:
        timer.cancel()
        try:
            p.kill()
        except Exception:
            pass
        try:
            p.wait()
        except Exception:
            pass


class Subscription(object):
    """A luna subscription read by a thread; each reply goes to on_reply."""

    def __init__(self, uri, payload, on_reply):
        self.p = subprocess.Popen(['luna-send', '-i', uri, json.dumps(payload)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.on_reply = on_reply
        self.thread = threading.Thread(target=self._read)
        self.thread.daemon = True
        self.thread.start()

    def _read(self):
        buf = b''
        for line in iter(self.p.stdout.readline, b''):
            buf += line
            try:
                msg = json.loads(buf.decode('utf-8', 'replace'))
            except ValueError:
                if len(buf) > 500000:
                    buf = b''
                continue
            buf = b''
            try:
                self.on_reply(msg)
            except Exception as e:
                log('ambilight: reply handler: %s' % e)
        self.on_reply(None)

    def alive(self):
        return self.p.poll() is None

    def close(self):
        try:
            self.p.kill()
            self.p.wait()
        except Exception:
            pass


def scan(seconds=10):
    found = {}

    def on(msg):
        for d in (msg or {}).get('devices') or []:
            addr = d.get('address')
            name = strip_name(d.get('scanRecord')) or d.get('name') or ''
            if addr and (is_strip(name) or addr in found):
                prev = found.get(addr) or {}
                found[addr] = {'address': addr, 'name': name or prev.get('name', ''),
                               'rssi': max(d.get('rssi', -127), prev.get('rssi', -127))}
    s = Subscription(BT + '/le/startScan', {'subscribe': True}, on)
    time.sleep(seconds)
    s.close()
    return sorted(found.values(), key=lambda d: -d['rssi'])


# ---- the strip ----------------------------------------------------------------

class Strip(object):
    def __init__(self, address):
        self.address = address.lower()
        self.client = None
        self.sub = None
        self.connected = False
        self.last_write = 0.0
        self.failures = 0

    def _on_connect(self, msg):
        if msg is None:
            self.connected = False
            return
        if msg.get('clientId'):
            self.client = msg['clientId']
            self.connected = True
        if msg.get('returnValue') is False or msg.get('connected') is False:
            self.connected = False
            self.reason = msg.get('errorText') or 'disconnected'

    def connect(self, wait=12.0):
        """True once the GATT client is up. LG's service connects only to a
        device it has seen in a scan, so a scan runs until then."""
        self.close()
        self.reason = ''
        scanner = Subscription(BT + '/le/startScan', {'subscribe': True}, lambda m: None)
        try:
            time.sleep(1.5)
            self.sub = Subscription(BT + '/gatt/connect', {'address': self.address, 'subscribe': True},
                                    self._on_connect)
            end = time.time() + wait
            while time.time() < end and not self.connected and self.sub.alive() and not self.reason:
                time.sleep(0.1)
        finally:
            scanner.close()
        if not self.connected:
            log('ambilight: no connection to %s (%s)' % (self.address, self.reason or 'timeout'))
            if self.sub:
                self.sub.close()
            self.sub = None
            return False
        # The controller wants a moment before the first write.
        time.sleep(1.0)
        self.failures = 0
        log('ambilight: connected to %s' % self.address)
        return True

    def write(self, frame):
        if not self.connected or not self.client:
            return False
        gap = MIN_GAP - (time.time() - self.last_write)
        if gap > 0:
            time.sleep(gap)
        r = luna(BT + '/gatt/writeCharacteristicValue',
                 {'clientId': self.client, 'service': SERVICE, 'characteristic': WRITE_CHAR,
                  'value': {'bytes': frame}}, timeout=3.0)
        self.last_write = time.time()
        if r.get('returnValue'):
            self.failures = 0
            return True
        self.failures += 1
        if self.failures >= 5:
            log('ambilight: writes failing (%s), reconnecting' % (r.get('errorText') or 'no reply'))
            self.connected = False
        return False

    def close(self):
        if self.client and self.connected:
            luna(BT + '/gatt/disconnect', {'clientId': self.client}, timeout=4.0)
        if self.sub:
            self.sub.close()
        self.sub = None
        self.client = None
        self.connected = False


def stale_link(address):
    """LG's service keeps the link of a client whose subscription died (a
    crash, a kill -9): connect then answers "Already connected" for good.
    Only restarting the service clears it; the remote reconnects by itself."""
    r = luna(BT + '/gatt/getStatus', {'address': address}, timeout=4.0)
    return r.get('connected') is True


def reset_bluetooth():
    log('ambilight: Bluetooth service restarted to clear a stale connection')
    subprocess.call(['restart', 'webos-bluetooth-service'])
    time.sleep(8)


# ---- the loop -----------------------------------------------------------------

ROOT = os.environ.get('TVTOOLS_ROOT', '/var/lib/launch-home-cinema')
CONF = os.path.join(ROOT, 'tvtools.json')
RUN = os.environ.get('TVTOOLS_RUN', '/run/cinema-tvtools')
PIDFILE = os.path.join(RUN, 'ambilight.pid')
LOGFILE = os.environ.get('AMBILIGHT_LOG') or os.path.join(RUN, 'ambilight.log')
PREVIEW = os.path.join(RUN, 'ambilight-preview.json')
# The capture service runs as root and follows the path it is given: the frame
# goes in this root-only folder, never at a fixed name under /tmp, where any
# app could put a symlink to a file to overwrite.
FRAME_PATH = os.path.join(RUN, 'ambilight-frame.bmp')
PREVIEW_SECONDS = 6
ADDRESS_RE = __import__('re').compile(r'^[0-9a-f]{2}(:[0-9a-f]{2}){5}$')
ON = 'Active'

# Room light when the TV is off, as Settings names them.
AMBIENT = {
    'warm': (255, 120, 30), 'white': (255, 255, 255), 'orange': (255, 70, 0), 'red': (255, 0, 0),
    'pink': (255, 30, 110), 'purple': (140, 0, 255), 'blue': (0, 40, 255), 'sky': (0, 170, 255),
    'green': (0, 255, 40), 'off': (0, 0, 0),
}
KEEP = 'keep'            # the strip is left as the film left it


def clean_conf(c):
    """The ledStrip part of tvtools.json, every field checked."""
    c = c if isinstance(c, dict) else {}
    addr = c.get('address')
    addr = addr.lower() if isinstance(addr, (type(u''), str)) and ADDRESS_RE.match(addr.lower()) else None
    name = c.get('name') if isinstance(c.get('name'), (type(u''), str)) else ''

    def pct(v, default):
        try:
            return max(5, min(100, int(v)))
        except (TypeError, ValueError):
            return default
    ambient = c.get('ambient')
    if ambient != KEEP and ambient not in AMBIENT:
        ambient = 'warm'
    return {'address': addr, 'name': name[:40], 'follow': c.get('follow') is True and addr is not None,
            'brightness': pct(c.get('brightness'), 100), 'ambient': ambient,
            'ambientBrightness': pct(c.get('ambientBrightness'), 60)}


def load_conf():
    try:
        with open(CONF) as f:
            return clean_conf(json.load(f).get('ledStrip'))
    except Exception:
        return clean_conf(None)


def scaled(rgb, percent):
    return tuple(c * percent / 100.0 for c in rgb)


def ambient_color(conf):
    """The room light for the TV off: None to leave the strip alone."""
    if conf['ambient'] == KEEP:
        return None
    return scaled(AMBIENT[conf['ambient']], conf['ambientBrightness'])


def capture():
    if not os.path.isdir(RUN):
        os.makedirs(RUN)
        os.chmod(RUN, 0o700)
    try:
        os.remove(FRAME_PATH)
    except OSError:
        pass
    r = luna(CAPTURE, {'path': FRAME_PATH, 'method': 'SCREEN', 'width': WIDTH, 'height': HEIGHT,
                       'format': 'BMP'}, timeout=3.0)
    if not r.get('returnValue'):
        return None
    try:
        with open(FRAME_PATH, 'rb') as f:
            return bmp_pixels(f.read())
    except (IOError, OSError):
        return None


def read_preview(now):
    """A colour asked by Settings' Prova, for a few seconds: (rgb, until,
    address). The address is the strip chosen on screen, maybe not saved."""
    try:
        with open(PREVIEW) as f:
            p = json.load(f)
        os.remove(PREVIEW)
        rgb = tuple(max(0, min(255, int(v))) for v in p['rgb'][:3])
        addr = p.get('address')
        addr = addr.lower() if isinstance(addr, (type(u''), str)) and ADDRESS_RE.match(addr.lower()) else None
        return rgb, now + PREVIEW_SECONDS, addr
    except Exception:
        return None


class Ambilight(object):
    """One process holds the strip while the TV is on. With the TV on and
    "follow" set, the strip follows the screen; when the TV goes off (or
    only the screen does) it gets the room light; when "follow" is switched
    off or another strip is chosen, it gets the room light and is let go.

    LG's gatt/disconnect answers but keeps the link, and a new connection is
    then refused: letting go means restarting LG's Bluetooth service. So the
    connection is kept while the TV is on, and settings are read again while
    running instead of restarting this process."""

    def __init__(self, conf_source=None, power=lambda: ON, clock=time.time):
        self.conf_source = conf_source or load_conf
        self.power = power
        self.clock = clock
        self.conf = self.conf_source()
        self.strip = None
        self.stopping = threading.Event()
        self.smooth = Smoother()
        self.sent = None
        self.mode = None            # 'follow', 'ambient' or 'preview': what the strip shows
        self.preview_until = 0
        self.preview_address = None
        self.misses = 0
        self.retry_at = 0
        self.retries = 0
        self.lock = threading.RLock()
        self.going_off = 0          # when LG announced a power-off: off from then on

    def stop(self):
        self.stopping.set()

    # -- the strip

    def _strip(self):
        """The connected strip, or None (and a later retry)."""
        addr = self.conf['address']
        if not addr:
            return None
        if self.strip and self.strip.address != addr:
            self.release()
        if self.strip and self.strip.connected:
            return self.strip
        if self.clock() < self.retry_at:
            return None
        s = self.strip or Strip(addr)
        self.strip = s
        ok = s.connect()
        if not ok and stale_link(addr):
            reset_bluetooth()
            ok = s.connect()
        if not ok:
            self.retries = min(self.retries + 1, 6)
            self.retry_at = self.clock() + 5 * self.retries
            return None
        self.retries = 0
        s.write(power_frame(True))
        s.write(brightness_frame(100))
        self.sent = None
        self.mode = None
        return s

    def show(self, rgb, mode):
        s = self._strip()
        if s is None:
            return False
        ok = s.write(color_frame(rgb))
        if ok:
            self.sent = tuple(rgb)
            self.mode = mode
        return ok

    def show_ambient(self):
        """The room light, once per change of state. True when done."""
        if self.mode == 'ambient':
            return True
        rgb = ambient_color(self.conf)
        if rgb is None:
            self.mode = 'ambient'
            log('ambilight: TV off, strip left as it is')
            return True
        if self.show(rgb, 'ambient'):
            if max(rgb) < 1:
                self.strip.write(power_frame(False))
            log('ambilight: room light %s' % self.conf['ambient'])
            return True
        return False

    def release(self):
        """Room light, then the strip let go so the phone app reaches it."""
        if self.strip and self.strip.connected:
            if self.mode != 'preview':
                # After Prova the colour tried stays: it is the one chosen.
                self.show_ambient()
            self.strip.close()
            reset_bluetooth()
            log('ambilight: strip released')
        elif self.strip:
            self.strip.close()
        self.strip = None
        self.mode = None
        self.sent = None

    def prepare_off(self, kind):
        """LG is about to switch off (or into standby): its radio goes with
        it about two seconds later, so the room light is written now."""
        with self.lock:
            self.going_off = self.clock()
            if self.strip and self.strip.connected:
                log('ambilight: %s announced' % kind)
                self.show_ambient()

    def tv_on(self):
        if self.power() != ON:
            self.going_off = 0
            return False
        # Announced but still Active: off, unless LG changed its mind.
        return not (self.going_off and self.clock() - self.going_off < 20)

    # -- one step of the loop: what to show now, and how long to wait

    def step(self):
        with self.lock:
            return self._step()

    def _step(self):
        now = self.clock()
        conf = self.conf_source()
        p = read_preview(now)
        if p:
            self.preview_address = p[2] or conf['address']
            self.preview_until = p[1]
        if self.preview_address and now < self.preview_until:
            conf = dict(conf, address=self.preview_address)
        self.conf = conf
        if p:
            ok = self.show(p[0], 'preview')
            log('ambilight: Prova %s %s' % (list(p[0]), 'shown' if ok else 'not shown'))
            return 0.2
        if self.mode == 'preview' and now < self.preview_until:
            return 0.2
        if not self.conf['follow']:
            return None                       # the caller lets the strip go and stops
        if not self.tv_on():
            if self.strip and self.strip.connected:
                self.show_ambient()
            self.smooth = Smoother()
            return 1.0
        s = self._strip()
        if s is None:
            return 1.0
        t0 = self.clock()
        frame = capture()
        if frame is None:
            self.misses += 1
            if self.misses == 20:
                log('ambilight: the screen cannot be read (protected video?)')
            return 0.5
        self.misses = 0
        color = scaled(self.smooth.step(boost(screen_color(*frame))), self.conf['brightness'])
        if self.mode != 'follow' or changed(self.sent, color) or self.clock() - s.last_write > 2:
            self.show(color, 'follow')
        return max(0.0, INTERVAL - (self.clock() - t0))

    def run(self):
        try:
            while not self.stopping.is_set():
                wait = self.step()
                if wait is None:
                    break
                if wait:
                    self.stopping.wait(wait)
        finally:
            with self.lock:
                self.release()


# ---- the process ---------------------------------------------------------------

def open_private(path, mode):
    if not os.path.isdir(RUN):
        os.makedirs(RUN)
        os.chmod(RUN, 0o700)
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | (os.O_APPEND if mode == 'a' else os.O_TRUNC)
    return os.fdopen(os.open(path, flags, 0o600), mode)


def file_log(msg):
    try:
        if os.path.exists(LOGFILE) and os.path.getsize(LOGFILE) > 32768:
            with open(LOGFILE) as f:
                tail = f.readlines()[-100:]
            with open_private(LOGFILE, 'w') as f:
                f.writelines(tail)
        with open_private(LOGFILE, 'a') as f:
            f.write(time.strftime('%H:%M:%S ') + msg + '\n')
    except Exception:
        pass


def running():
    try:
        pid = int(open(PIDFILE).read().strip())
        with open('/proc/%d/cmdline' % pid) as f:
            if 'ambilight' in f.read():
                return pid
    except Exception:
        pass
    return None


def daemon():
    if running():
        return 0
    # Two starts close together (tvtools.py applies, then checks): the lock
    # lets one through, held until this process ends.
    import fcntl
    lock = open_private(PIDFILE + '.lock', 'a')
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        return 0
    LOG[0] = file_log
    with open_private(PIDFILE, 'w') as f:
        f.write(str(os.getpid()))
    state = {'power': ON}
    going_off = [None]

    def on_power(msg):
        msg = msg or {}
        if msg.get('state'):
            state['power'] = msg['state']
        if msg.get('onOff') == 'off' and msg.get('processing'):
            # "Request Power Off" comes with the state still Active, about
            # 2.5 s before standby. (Registering for LG's prepare steps
            # instead turns every standby into a full restart.)
            going_off[0] = msg['processing']


    power = Subscription('luna://com.webos.service.tvpower/power/getPowerState', {'subscribe': True}, on_power)
    a = Ambilight(power=lambda: state['power'])

    def watch_off():
        while not a.stopping.is_set():
            if going_off[0]:
                kind, going_off[0] = going_off[0], None
                log('ambilight: LG: %s' % kind)
                a.prepare_off(kind)
            a.stopping.wait(0.05)
    t = threading.Thread(target=watch_off)
    t.daemon = True
    t.start()
    import signal
    signal.signal(signal.SIGTERM, lambda *args: a.stop())
    log('ambilight: start, strip %s' % (a.conf['address'] or 'none'))
    try:
        a.run()
    finally:
        power.close()
        try:
            os.remove(PIDFILE)
        except OSError:
            pass
        log('ambilight: stop')
    return 0


def preview(rgb, address=None):
    """Settings' Prova: the colour goes to the process that holds the strip,
    started for the purpose when "follow" is off (it shows the colour for a
    few seconds, leaves it on and lets the strip go)."""
    address = address.lower() if address and ADDRESS_RE.match(address.lower()) else load_conf()['address']
    if not address:
        return {'ok': False, 'error': 'nessuna striscia scelta'}
    with open_private(PREVIEW + '.tmp', 'w') as f:
        json.dump({'rgb': [int(round(c)) for c in rgb], 'address': address}, f)
    os.rename(PREVIEW + '.tmp', PREVIEW)
    if not running():
        subprocess.Popen([sys.executable, os.path.abspath(__file__), 'daemon'], stdin=open(os.devnull),
                         stdout=open(os.devnull, 'w'), stderr=open(os.devnull, 'w'), close_fds=True,
                         preexec_fn=os.setsid)
    return {'ok': True}


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd == 'scan':
        print(json.dumps(scan(float(argv[2]) if len(argv) > 2 else 10)))
    elif cmd == 'preview' and len(argv) >= 6:
        print(json.dumps(preview([max(0, min(255, int(v))) for v in argv[3:6]], argv[2])))
    elif cmd == 'ambient-preview':
        rgb = ambient_color(load_conf())
        print(json.dumps(preview(rgb) if rgb is not None else {'ok': True, 'via': 'none'}))
    elif cmd == 'daemon':
        return daemon()
    elif cmd == 'status':
        print(json.dumps({'running': bool(running()), 'conf': load_conf()}))
    else:
        print(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
