# -*- coding: utf-8 -*-
"""Cinema: updates for Cinema and Bloomee from their GitHub releases, as root.

    update-app.py check              JSON: installed and latest version of each
    update-app.py install <app-id>   download, check SHA-256, install, reopen

Only the two apps below, from their own repositories: the release's IPK is
installed only if its SHA-256 matches the release's SHA256SUMS.txt. The
install closes the app being updated (Cinema included), so `install` is meant
to run detached; its progress is in /run/cinema-tvtools/update.json.

Before installing, the app in place is kept for a rollback: the last IPK that
installed fine (updates/last-good-<app>.ipk) or, when there is none yet, a
tar of its folder. A failed install puts that back and reports rolled_back.
Runs on the TV's Python 2.7 and on Python 3.
"""
from __future__ import print_function

import hashlib
import json
import os
import re
import shutil
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
# Downloads and rollback copies: on flash (an IPK can be tens of MB, /run is
# RAM), root only.
UPDATES = '/var/lib/launch-home-cinema/updates'
UA = 'Cinema-webOS-updater'
NO_SUMS = 'SHA256SUMS.txt assente nella release'
BLOCK = 65536
_sleep = time.sleep


def open_url(url):
    return urlopen(Request(url, headers={'User-Agent': UA, 'Accept': 'application/vnd.github+json'}), timeout=30)


def http(url, binary=False):
    r = open_url(url)
    try:
        data = r.read()
    finally:
        r.close()
    return data if binary else json.loads(data.decode('utf-8'))


def download(url, path):
    """Streams url to path (new, root-only file) in 64 KB blocks; returns the
    SHA-256 of what was written."""
    h = hashlib.sha256()
    r = open_url(url)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f:
            while True:
                block = r.read(BLOCK)
                if not block:
                    break
                h.update(block)
                f.write(block)
    finally:
        r.close()
    return h.hexdigest()


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


def parse_sums(text, name):
    """The hex SHA-256 listed for `name` in a SHA256SUMS.txt, or None."""
    expected = None
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip('*') == name:
            expected = parts[0].lower()
    return expected


def find_release(app_id):
    """(release, error): the newest published, non-prerelease release with a
    matching tag, its IPK and its SHA256SUMS.txt. A release that ships the IPK
    without the sums is skipped; when nothing valid is left, error says so."""
    spec = APPS[app_id]
    tag_re = re.compile(spec['tag'])
    ipk_re = re.compile('^' + re.escape(app_id) + r'_(\d+\.\d+\.\d+)_all\.ipk$')
    best = None
    no_sums = False
    for rel in http('https://api.github.com/repos/%s/releases?per_page=15' % spec['repo']):
        if rel.get('draft') or rel.get('prerelease'):
            continue
        m = tag_re.match(rel.get('tag_name') or '')
        if not m:
            continue
        assets = dict((a.get('name'), a.get('browser_download_url')) for a in rel.get('assets') or [])
        ipk = [n for n in assets if ipk_re.match(n or '')]
        if not ipk:
            continue
        if 'SHA256SUMS.txt' not in assets:
            no_sums = True
            continue
        cand = {'version': m.group(1), 'ipk': ipk[0], 'ipkUrl': assets[ipk[0]],
                'sumsUrl': assets['SHA256SUMS.txt'], 'notes': (rel.get('body') or '')[:1500],
                'url': rel.get('html_url')}
        if best is None or version_tuple(cand['version']) > version_tuple(best['version']):
            best = cand
    return best, (NO_SUMS if best is None and no_sums else None)


def latest_release(app_id):
    return find_release(app_id)[0]


def allowed_url(url, repo):
    return url.startswith('https://github.com/%s/releases/download/' % repo)


def check():
    out = {}
    for app_id, spec in APPS.items():
        cur = installed_version(app_id)
        entry = {'name': spec['name'], 'installed': cur}
        try:
            rel, err = find_release(app_id)
            if rel:
                entry.update({'latest': rel['version'], 'notes': rel['notes'], 'url': rel['url'],
                              'update': not cur or version_tuple(rel['version']) > version_tuple(cur)})
            elif err:
                entry['error'] = err
        except Exception as e:
            entry['error'] = str(e)[:200]
        out[app_id] = entry
    return out


def private_dir(path):
    """path as a root-only directory; refused if it is a link or not ours."""
    import stat
    try:
        os.mkdir(path, 0o700)
    except OSError:
        pass
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise RuntimeError('unsafe ' + path)
    if st.st_mode & 0o077:
        os.chmod(path, 0o700)
    return path


def run_dir():
    """/run/cinema-tvtools, root only; refused if it is a link or not ours."""
    return private_dir(RUN)


def updates_dir():
    parent = os.path.dirname(UPDATES)
    if not os.path.isdir(parent):
        os.makedirs(parent, 0o700)
    return private_dir(UPDATES)


def progress(state, **extra):
    run_dir()
    data = dict(extra, state=state, at=int(time.time()))
    tmp = PROGRESS + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f)
    os.rename(tmp, PROGRESS)


def luna_install(app_id, path, timeout=180):
    """appInstallService dev/install, waiting for the final state: 'installed',
    'failed', or None when nothing final came within timeout."""
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
    return state


def wait_installed(app_id, version, total=60, step=5):
    """appinstalld can finish after luna-send stopped answering: look at the
    installed version every `step` s for `total` s."""
    waited = 0
    while waited < total:
        if installed_version(app_id) == version:
            return True
        _sleep(step)
        waited += step
    return installed_version(app_id) == version


def last_good_path(app_id):
    return os.path.join(UPDATES, 'last-good-%s.ipk' % app_id)


def backup_app(app_id, version):
    """What to put back if the install fails: ('ipk', path) when the last IPK
    that installed fine is kept, else ('tar', path) of the app's folder, else
    None (nothing installed)."""
    good = last_good_path(app_id)
    if os.path.isfile(good):
        return ('ipk', good)
    folder = os.path.join(APPS_DIR, app_id)
    if not os.path.isdir(folder):
        return None
    private_dir(os.path.dirname(UPDATES))
    private_dir(UPDATES)
    tar = os.path.join(UPDATES, '%s-%s.tar.gz' % (app_id, version or 'unknown'))
    tmp = tar + '.part'
    try:
        os.remove(tmp)
    except OSError:
        pass
    rc = subprocess.call(['tar', '-C', APPS_DIR, '-czf', tmp, app_id],
                         stdout=open(os.devnull, 'w'), stderr=subprocess.STDOUT)
    if rc != 0 or not os.path.isfile(tmp):
        return None
    os.chmod(tmp, 0o600)
    os.rename(tmp, tar)
    return ('tar', tar)


def prune_backups(app_id, keep):
    for name in os.listdir(UPDATES):
        path = os.path.join(UPDATES, name)
        if name.startswith(app_id + '-') and name.endswith('.tar.gz') and path != keep:
            try:
                os.remove(path)
            except OSError:
                pass


def keep_last_good(app_id, path):
    """The IPK that just installed becomes the rollback copy (same file
    system: a rename, no second copy on flash)."""
    good = last_good_path(app_id)
    tmp = good + '.part'
    try:
        os.rename(path, tmp)
    except OSError:
        shutil.copyfile(path, tmp)
    os.chmod(tmp, 0o600)
    os.rename(tmp, good)


def restore_folder(app_id, tar):
    """The app folder back from its tar, renamed into place in one step."""
    folder = os.path.join(APPS_DIR, app_id)
    if os.path.exists(folder):
        return False
    work = os.path.join(APPS_DIR, '.restore-%s-%d' % (app_id, os.getpid()))
    shutil.rmtree(work, ignore_errors=True)
    os.mkdir(work, 0o755)
    try:
        rc = subprocess.call(['tar', '-C', work, '-xzf', tar], stdout=open(os.devnull, 'w'), stderr=subprocess.STDOUT)
        src = os.path.join(work, app_id)
        if rc != 0 or not os.path.isdir(src):
            return False
        os.rename(src, folder)
        return True
    finally:
        shutil.rmtree(work, ignore_errors=True)


def rollback(app_id, backup, error):
    """After a failed install: the last good IPK installed again, or the
    folder put back from its tar when the install took it away. Writes and
    returns the final state."""
    if backup and backup[0] == 'ipk':
        state = luna_install(app_id, backup[1])
        waited = 0
        while state is None and waited < 60 and not installed_version(app_id):
            _sleep(5)
            waited += 5
        if state == 'installed' or installed_version(app_id):
            progress('rolled_back', app=app_id, version=installed_version(app_id),
                     error=error + '; ripristinata la versione precedente')
            return 'rolled_back'
        progress('failed', app=app_id, error=error + '; ripristino non riuscito')
        return 'failed'
    if backup and backup[0] == 'tar' and not os.path.isdir(os.path.join(APPS_DIR, app_id)):
        try:
            ok = restore_folder(app_id, backup[1])
        except Exception:
            ok = False
        if ok:
            progress('rolled_back', app=app_id, version=installed_version(app_id),
                     error=error + '; cartella ripristinata dalla copia')
            return 'rolled_back'
        progress('failed', app=app_id, error=error + '; ripristino non riuscito')
        return 'failed'
    progress('failed', app=app_id, error=error)
    return 'failed'


def relaunch(app_id):
    """Updating Cinema closed it, with the owner in front of it: open it again
    once the app manager has the new copy (a launch right after an install can
    be dropped). Another app updated from Cinema stays closed."""
    if app_id != 'org.webosbrew.lounge.launcher':
        return
    for _ in range(5):
        _sleep(3)
        subprocess.call(['luna-send', '-i', '-n', '1', '-w', '5000', 'luna://com.webos.applicationManager/launch',
                         json.dumps({'id': app_id})], stdin=open(os.devnull), stdout=open(os.devnull, 'w'),
                        stderr=open(os.devnull, 'w'))
        fg = subprocess.Popen(['luna-send', '-i', '-n', '1', '-w', '4000',
                               'luna://com.webos.applicationManager/getForegroundAppInfo', '{}'],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE).communicate()[0]
        if app_id.encode('utf-8') in fg:
            break


def install(app_id):
    if app_id not in APPS:
        raise SystemExit('unknown app')
    spec = APPS[app_id]
    progress('checking', app=app_id)
    rel, err = find_release(app_id)
    if not rel or not allowed_url(rel['ipkUrl'], spec['repo']) or not allowed_url(rel['sumsUrl'], spec['repo']):
        progress('failed', app=app_id, error=err or 'Nessuna release valida')
        return False
    progress('downloading', app=app_id, version=rel['version'])
    expected = parse_sums(http(rel['sumsUrl'], binary=True).decode('utf-8', 'replace'), rel['ipk'])
    # Staged where only root can reach it (appinstalld runs as root): the
    # usual /media/developer/temp is writable by every app, which could swap
    # the package between the SHA-256 check and the install. On flash, not
    # in RAM: streamed to the file block by block.
    updates_dir()
    stage = os.path.join(UPDATES, 'stage-%d' % os.getpid())
    shutil.rmtree(stage, ignore_errors=True)
    os.mkdir(stage, 0o700)
    final = None
    try:
        path = os.path.join(stage, rel['ipk'])
        if not expected or download(rel['ipkUrl'], path) != expected:
            progress('failed', app=app_id, error='SHA-256 non corrisponde')
            return False
        backup = backup_app(app_id, installed_version(app_id))
        progress('installing', app=app_id, version=rel['version'])
        state = luna_install(app_id, path)
        if state is None and wait_installed(app_id, rel['version']):
            state = 'installed'
        if state == 'installed' and installed_version(app_id) == rel['version']:
            keep_last_good(app_id, path)
            if backup and backup[0] == 'tar':
                prune_backups(app_id, backup[1])
            progress('installed', app=app_id, version=rel['version'])
            final = 'installed'
        else:
            final = rollback(app_id, backup, 'Installazione non riuscita')
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if final in ('installed', 'rolled_back'):
        relaunch(app_id)
    return final == 'installed'


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if cmd == 'install' and len(sys.argv) > 2:
        try:
            install(sys.argv[2])
        except Exception as e:
            progress('failed', app=sys.argv[2], error=str(e)[:200])
    else:
        print(json.dumps(check()))
