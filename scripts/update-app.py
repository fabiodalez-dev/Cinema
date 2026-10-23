# -*- coding: utf-8 -*-
"""Cinema: updates for Cinema and Bloomee from their GitHub releases, as root.

    update-app.py check              JSON: installed and latest version of each
    update-app.py install <app-id>   download, check SHA-256, install, reopen

Only the two apps below, from their own repositories: the release's IPK is
installed only if its SHA-256 matches the release's SHA256SUMS.txt. The
install closes the app being updated (Cinema included), so `install` is meant
to run detached; its progress is in /run/cinema-tvtools/update.json.
Runs on the TV's Python 2.7 and on Python 3.
"""
from __future__ import print_function

import hashlib
import json
import os
import re
import subprocess
import sys
import time

try:
    from urllib2 import Request, urlopen
except ImportError:
    from urllib.request import Request, urlopen

APPS = {
    'org.webosbrew.lounge.launcher': {'name': 'Cinema', 'repo': 'fabiodalez-dev/Cinema', 'tag': r'^v(\d+\.\d+\.\d+)$'},
    'org.bloomee.webos': {'name': 'Bloomee', 'repo': 'fabiodalez-dev/BloomeeWebOS', 'tag': r'^webos-v(\d+\.\d+\.\d+)$'},
}
APPS_DIR = '/media/developer/apps/usr/palm/applications'
RUN = '/run/cinema-tvtools'
PROGRESS = os.path.join(RUN, 'update.json')
UA = 'Cinema-webOS-updater'


def http(url, binary=False):
    r = urlopen(Request(url, headers={'User-Agent': UA, 'Accept': 'application/vnd.github+json'}), timeout=30)
    try:
        data = r.read()
    finally:
        r.close()
    return data if binary else json.loads(data.decode('utf-8'))


def version_tuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except Exception:
        return (0,)


def installed_version(app_id):
    try:
        with open(os.path.join(APPS_DIR, app_id, 'appinfo.json')) as f:
            return json.load(f).get('version')
    except Exception:
        return None


def latest_release(app_id):
    """The newest published, non-prerelease release with a matching tag, its
    IPK and its SHA256SUMS.txt; None when there is none."""
    spec = APPS[app_id]
    tag_re = re.compile(spec['tag'])
    ipk_re = re.compile('^' + re.escape(app_id) + r'_(\d+\.\d+\.\d+)_all\.ipk$')
    best = None
    for rel in http('https://api.github.com/repos/%s/releases?per_page=15' % spec['repo']):
        if rel.get('draft') or rel.get('prerelease'):
            continue
        m = tag_re.match(rel.get('tag_name') or '')
        if not m:
            continue
        assets = dict((a.get('name'), a.get('browser_download_url')) for a in rel.get('assets') or [])
        ipk = [n for n in assets if ipk_re.match(n or '')]
        if not ipk or 'SHA256SUMS.txt' not in assets:
            continue
        cand = {'version': m.group(1), 'ipk': ipk[0], 'ipkUrl': assets[ipk[0]],
                'sumsUrl': assets['SHA256SUMS.txt'], 'notes': (rel.get('body') or '')[:1500],
                'url': rel.get('html_url')}
        if best is None or version_tuple(cand['version']) > version_tuple(best['version']):
            best = cand
    return best


def allowed_url(url, repo):
    return url.startswith('https://github.com/%s/releases/download/' % repo)


def check():
    out = {}
    for app_id, spec in APPS.items():
        cur = installed_version(app_id)
        entry = {'name': spec['name'], 'installed': cur}
        try:
            rel = latest_release(app_id)
            if rel:
                entry.update({'latest': rel['version'], 'notes': rel['notes'], 'url': rel['url'],
                              'update': not cur or version_tuple(rel['version']) > version_tuple(cur)})
        except Exception as e:
            entry['error'] = str(e)[:200]
        out[app_id] = entry
    return out


def run_dir():
    """/run/cinema-tvtools, root only; refused if it is a link or not ours."""
    import stat
    try:
        os.mkdir(RUN, 0o700)
    except OSError:
        pass
    st = os.lstat(RUN)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise RuntimeError('unsafe ' + RUN)


def progress(state, **extra):
    run_dir()
    data = dict(extra, state=state, at=int(time.time()))
    tmp = PROGRESS + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f)
    os.rename(tmp, PROGRESS)


def luna_install(app_id, path, timeout=180):
    """appInstallService dev/install, waiting for the final state."""
    p = subprocess.Popen(['luna-send', '-i', 'luna://com.webos.appInstallService/dev/install',
                          json.dumps({'id': app_id, 'ipkUrl': path, 'subscribe': True})],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.devnull, 'w'))
    end = time.time() + timeout
    buf = ''
    state = None
    import select
    while time.time() < end and state is None:
        r, _, _ = select.select([p.stdout], [], [], 1)
        if r:
            line = p.stdout.readline()
            if not line:
                break
            buf += line.decode('utf-8', 'replace')
            m = re.search(r'"state"\s*:\s*"(installed|failed)"', buf)
            if m:
                state = m.group(1)
    try:
        p.kill()
    except Exception:
        pass
    return state == 'installed'


def install(app_id):
    if app_id not in APPS:
        raise SystemExit('unknown app')
    spec = APPS[app_id]
    progress('checking', app=app_id)
    rel = latest_release(app_id)
    if not rel or not allowed_url(rel['ipkUrl'], spec['repo']) or not allowed_url(rel['sumsUrl'], spec['repo']):
        progress('failed', app=app_id, error='Nessuna release valida')
        return False
    progress('downloading', app=app_id, version=rel['version'])
    sums = http(rel['sumsUrl'], binary=True).decode('utf-8', 'replace')
    expected = None
    for line in sums.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip('*') == rel['ipk']:
            expected = parts[0].lower()
    data = http(rel['ipkUrl'], binary=True)
    if not expected or hashlib.sha256(data).hexdigest() != expected:
        progress('failed', app=app_id, error='SHA-256 non corrisponde')
        return False
    # Staged where only root can reach it (appinstalld runs as root): the
    # usual /media/developer/temp is writable by every app, which could swap
    # the package between the SHA-256 check and the install.
    import shutil
    import tempfile
    stage = tempfile.mkdtemp(prefix='update-', dir=RUN)
    try:
        os.chmod(stage, 0o700)
        path = os.path.join(stage, rel['ipk'])
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        progress('installing', app=app_id, version=rel['version'])
        ok = luna_install(app_id, path)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if not ok or installed_version(app_id) != rel['version']:
        progress('failed', app=app_id, error='Installazione non riuscita')
        return False
    progress('installed', app=app_id, version=rel['version'])
    # Updating Cinema closed it, with the owner in front of it: open it again
    # once the app manager has the new copy (a launch right after an install
    # can be dropped). Another app updated from Cinema stays closed.
    if app_id == 'org.webosbrew.lounge.launcher':
        for _ in range(5):
            time.sleep(3)
            subprocess.call(['luna-send', '-i', '-n', '1', '-w', '5000', 'luna://com.webos.applicationManager/launch',
                             json.dumps({'id': app_id})], stdin=open(os.devnull), stdout=open(os.devnull, 'w'),
                            stderr=open(os.devnull, 'w'))
            fg = subprocess.Popen(['luna-send', '-i', '-n', '1', '-w', '4000',
                                   'luna://com.webos.applicationManager/getForegroundAppInfo', '{}'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE).communicate()[0]
            if app_id.encode('utf-8') in fg:
                break
    return True


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if cmd == 'install' and len(sys.argv) > 2:
        try:
            install(sys.argv[2])
        except Exception as e:
            progress('failed', app=sys.argv[2], error=str(e)[:200])
    else:
        print(json.dumps(check()))
