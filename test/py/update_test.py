import importlib.util, io, json, os, shutil, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('update_app', str(Path(__file__).parents[2] / 'scripts' / 'update-app.py'))
up = importlib.util.module_from_spec(spec); spec.loader.exec_module(up)

CINEMA = 'org.webosbrew.lounge.launcher'
IPK = CINEMA + '_0.3.0_all.ipk'
IPK_BYTES = b'ipk-bytes-' * 20000  # bigger than one 64 KB block
import hashlib
IPK_SHA = hashlib.sha256(IPK_BYTES).hexdigest()
DL = 'https://github.com/fabiodalez-dev/Cinema/releases/download/v0.3.0/'


def release(tag, assets, **extra):
    r = {'tag_name': tag, 'draft': False, 'prerelease': False, 'body': 'notes', 'html_url': 'u',
         'assets': [{'name': n, 'browser_download_url': DL + n} for n in assets]}
    r.update(extra)
    return r


class Sums(unittest.TestCase):
    def test_parses_gnu_and_binary_marked_lines(self):
        text = 'abc  other.ipk\nABCDEF *' + IPK + '\nmalformed line here\n'
        self.assertEqual(up.parse_sums(text, IPK), 'abcdef')
        self.assertIsNone(up.parse_sums(text, 'missing.ipk'))
        self.assertIsNone(up.parse_sums('', IPK))


class Releases(unittest.TestCase):
    def setUp(self):
        self.old_http = up.http

    def tearDown(self):
        up.http = self.old_http

    def test_release_without_sums_is_an_explicit_error(self):
        up.http = lambda url, binary=False: [release('v0.3.0', [IPK])]
        rel, err = up.find_release(CINEMA)
        self.assertIsNone(rel)
        self.assertEqual(err, 'SHA256SUMS.txt assente nella release')
        old = up.installed_version; up.installed_version = lambda a: '0.2.0'
        try:
            self.assertEqual(up.check()[CINEMA]['error'], 'SHA256SUMS.txt assente nella release')
        finally:
            up.installed_version = old

    def test_an_older_complete_release_is_still_found(self):
        up.http = lambda url, binary=False: [release('v0.3.0', [IPK]),
                                             release('v0.2.9', [CINEMA + '_0.2.9_all.ipk', 'SHA256SUMS.txt']),
                                             release('v0.2.8', [CINEMA + '_0.2.8_all.ipk', 'SHA256SUMS.txt'], prerelease=True)]
        rel, err = up.find_release(CINEMA)
        self.assertEqual(rel['version'], '0.2.9')
        self.assertIsNone(err)


class Install(unittest.TestCase):
    """install() against a fake GitHub, a fake appinstalld and a temp app folder."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.saved = dict((k, getattr(up, k)) for k in
                          ('APPS_DIR', 'RUN', 'PROGRESS', 'UPDATES', 'open_url', 'luna_install', '_sleep', 'relaunch'))
        up.APPS_DIR = os.path.join(self.d, 'apps'); os.makedirs(os.path.join(up.APPS_DIR, CINEMA))
        up.RUN = os.path.join(self.d, 'run'); os.mkdir(up.RUN, 0o700)
        up.PROGRESS = os.path.join(up.RUN, 'update.json')
        up.UPDATES = os.path.join(self.d, 'updates')
        up._sleep = lambda s: None
        self.relaunched = []
        up.relaunch = lambda a: self.relaunched.append(a)
        self.write_appinfo('0.2.0')
        self.installs = []
        releases = json.dumps([release('v0.3.0', [IPK, 'SHA256SUMS.txt'])]).encode('utf-8')
        bodies = {'releases?per_page=15': releases, 'SHA256SUMS.txt': (IPK_SHA + '  ' + IPK + '\n').encode('utf-8'),
                  IPK: IPK_BYTES}

        def open_url(url):
            for k, v in bodies.items():
                if url.endswith(k):
                    return io.BytesIO(v)
            raise IOError(url)
        up.open_url = open_url

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(up, k, v)
        shutil.rmtree(self.d, ignore_errors=True)

    def write_appinfo(self, version):
        with open(os.path.join(up.APPS_DIR, CINEMA, 'appinfo.json'), 'w') as f:
            json.dump({'id': CINEMA, 'version': version}, f)

    def progress(self):
        with open(up.PROGRESS) as f:
            return json.load(f)

    def fake_install(self, outcomes):
        def luna_install(app_id, path, timeout=180):
            self.installs.append(path)
            outcome = outcomes.pop(0)
            if callable(outcome):
                return outcome()
            return outcome
        up.luna_install = luna_install

    def test_good_install_keeps_the_ipk_as_last_good_and_relaunches(self):
        def ok():
            self.write_appinfo('0.3.0')
            return 'installed'
        self.fake_install([ok])
        self.assertTrue(up.install(CINEMA))
        self.assertEqual(self.progress()['state'], 'installed')
        good = up.last_good_path(CINEMA)
        with open(good, 'rb') as f:
            self.assertEqual(f.read(), IPK_BYTES)
        self.assertEqual(oct(os.stat(good).st_mode & 0o777), oct(0o600))
        self.assertEqual(oct(os.stat(up.UPDATES).st_mode & 0o777), oct(0o700))
        self.assertFalse([n for n in os.listdir(up.UPDATES) if n.startswith('stage-')], 'stage cleaned')
        # The folder tar made before the first install is kept: last-good covers it from now on.
        self.assertEqual(self.installs[0], os.path.join(up.UPDATES, 'stage-%d' % os.getpid(), IPK))
        self.assertEqual(self.relaunched, [CINEMA])

    def test_wrong_checksum_installs_nothing(self):
        self.fake_install(['installed'])
        old = up.open_url
        up.open_url = lambda url: io.BytesIO(b'tampered') if url.endswith(IPK) else old(url)
        self.assertFalse(up.install(CINEMA))
        self.assertEqual(self.progress()['error'], 'SHA-256 non corrisponde')
        self.assertEqual(self.installs, [])

    def test_failed_install_rolls_back_to_the_last_good_ipk(self):
        os.makedirs(up.UPDATES, 0o700)
        with open(up.last_good_path(CINEMA), 'wb') as f:
            f.write(b'previous-good')
        self.fake_install(['failed', 'installed'])
        self.assertFalse(up.install(CINEMA))
        self.assertEqual(len(self.installs), 2)
        self.assertEqual(self.installs[1], up.last_good_path(CINEMA))
        p = self.progress()
        self.assertEqual(p['state'], 'rolled_back')
        self.assertIn('Installazione non riuscita', p['error'])
        self.assertEqual(self.relaunched, [CINEMA], 'Cinema reopened after the rollback too')
        with open(up.last_good_path(CINEMA), 'rb') as f:
            self.assertEqual(f.read(), b'previous-good', 'last-good untouched')

    def test_failed_rollback_is_reported_as_failed(self):
        os.makedirs(up.UPDATES, 0o700)
        with open(up.last_good_path(CINEMA), 'wb') as f:
            f.write(b'previous-good')
        shutil.rmtree(os.path.join(up.APPS_DIR, CINEMA))
        self.fake_install(['failed', 'failed'])
        self.assertFalse(up.install(CINEMA))
        self.assertEqual(self.progress()['state'], 'failed')
        self.assertEqual(self.relaunched, [])

    def test_folder_comes_back_from_the_tar_when_the_install_removed_it(self):
        def gone():
            shutil.rmtree(os.path.join(up.APPS_DIR, CINEMA))
            return 'failed'
        self.fake_install([gone])
        self.assertFalse(up.install(CINEMA))
        self.assertEqual(self.progress()['state'], 'rolled_back')
        self.assertEqual(up.installed_version(CINEMA), '0.2.0')
        self.assertTrue(os.path.isfile(os.path.join(up.UPDATES, CINEMA + '-0.2.0.tar.gz')))

    def test_timeout_rechecks_the_installed_version_before_giving_up(self):
        slept = []
        checks = {'n': 0}

        def timeout():
            return None
        self.fake_install([timeout])
        up._sleep = lambda s: slept.append(s)
        real = up.installed_version

        def late(app_id):
            checks['n'] += 1
            if checks['n'] >= 4:
                self.write_appinfo('0.3.0')
            return real(app_id)
        up.installed_version = late
        try:
            self.assertTrue(up.install(CINEMA))
        finally:
            up.installed_version = real
        self.assertEqual(self.progress()['state'], 'installed')
        self.assertTrue(slept and all(s == 5 for s in slept))
        self.assertEqual(len(self.installs), 1)

    def test_timeout_without_the_new_version_rolls_back(self):
        self.fake_install([None, 'installed'])
        os.makedirs(up.UPDATES, 0o700)
        with open(up.last_good_path(CINEMA), 'wb') as f:
            f.write(b'previous-good')
        self.assertFalse(up.install(CINEMA))
        self.assertEqual(self.progress()['state'], 'rolled_back')
        self.assertEqual(len(self.installs), 2)


if __name__ == '__main__':
    unittest.main()
