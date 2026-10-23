import importlib.util, json, os, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('tvtools', str(Path(__file__).parents[2] / 'scripts' / 'tvtools.py'))
tv = importlib.util.module_from_spec(spec); spec.loader.exec_module(tv)


class Preload(unittest.TestCase):
    def test_switches_off_only_the_owners_apps_and_never_essential_ones(self):
        lg = [{'id': 'youtube.leanback.v4', 'isEnabled': True, 'requiredMemory': 135},
              {'id': 'airplay', 'isEnabled': False},
              {'id': 'com.webos.app.home', 'isEnabled': True},
              {'id': 'com.webos.app.hdmi1', 'isEnabled': True},
              {'id': 'amazon', 'isEnabled': True}]
        out = tv.preload_target(lg, set(['amazon', 'com.webos.app.home', 'com.webos.app.hdmi1']))
        by = dict((e['id'], e['isEnabled']) for e in out)
        self.assertEqual(by, {'youtube.leanback.v4': True, 'airplay': False, 'com.webos.app.home': True,
                              'com.webos.app.hdmi1': True, 'amazon': False})
        self.assertEqual(out[0]['requiredMemory'], 135)
        self.assertTrue(lg[4]['isEnabled'], 'LG list is not modified')


class Memory(unittest.TestCase):
    def test_adds_the_apps_to_lgs_keep_list_without_dropping_lgs_own(self):
        system = {'KeepOnLaunchEx': ['com.webos.app.home', 'google.assistant'], 'KeepAlive': ['x']}
        out = tv.memory_target(system, ['org.webosbrew.lounge.launcher', 'google.assistant'])
        self.assertEqual(out['KeepOnLaunchEx'], ['com.webos.app.home', 'google.assistant', 'org.webosbrew.lounge.launcher'])
        self.assertEqual(out['KeepAlive'], ['x'])
        self.assertEqual(system['KeepOnLaunchEx'], ['com.webos.app.home', 'google.assistant'])


class Conf(unittest.TestCase):
    def test_unknown_settings_and_services_are_dropped(self):
        d = tempfile.mkdtemp(); old = tv.CONF; tv.CONF = os.path.join(d, 'c.json')
        try:
            with open(tv.CONF, 'w') as f:
                json.dump({'settingsOff': ['adCookie', 'rm -rf'], 'servicesOff': ['contentminer', 'tvdataexchanger'],
                           'preloadOff': ['amazon', 5], 'keepInMemory': ['org.bloomee.webos']}, f)
            c = tv.load_conf()
            self.assertEqual(c['settingsOff'], ['adCookie'])
            self.assertEqual(c['servicesOff'], ['contentminer'])
            self.assertEqual(c['preloadOff'], ['amazon'])
            self.assertEqual(c['keepInMemory'], ['org.bloomee.webos'])
            os.remove(tv.CONF)
            self.assertEqual(tv.load_conf(), {'preloadOff': [], 'settingsOff': [], 'servicesOff': [], 'keepInMemory': []})
        finally:
            tv.CONF = old

    def test_services_that_must_never_stop_are_not_offered(self):
        for s in ('tvdataexchanger', 'alwaysready', 'sdx'):
            self.assertNotIn(s, tv.SERVICES)


class RunDir(unittest.TestCase):
    def test_refuses_a_runtime_directory_others_can_write(self):
        d = tempfile.mkdtemp(); os.chmod(d, 0o777); old = tv.RUN; tv.RUN = d
        try:
            with self.assertRaises(RuntimeError):
                tv.run_dir()
            os.chmod(d, 0o700)
            self.assertEqual(tv.run_dir(), d)
        finally:
            tv.RUN = old


if __name__ == '__main__':
    unittest.main()
