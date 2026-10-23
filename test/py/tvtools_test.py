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
            self.assertEqual(tv.load_conf(), {'preloadOff': [], 'settingsOff': [], 'servicesOff': [], 'keepInMemory': [], 'remoteKeys': {}})
        finally:
            tv.CONF = old

    def test_services_that_must_never_stop_are_not_offered(self):
        for s in ('tvdataexchanger', 'alwaysready', 'sdx'):
            self.assertNotIn(s, tv.SERVICES)


class Keys(unittest.TestCase):
    def test_only_known_keys_and_plain_app_ids_reach_the_filter(self):
        self.assertEqual(tv.clean_keys({'blue': 'com.webos.app.hdmi2', 'red': '', 'netflix': 'x"); evil(); ("',
                                        'power': 'org.bloomee.webos', 'green': 5}),
                         {'blue': 'com.webos.app.hdmi2', 'red': ''})
        self.assertEqual(tv.clean_keys(None), {})

    def test_filter_passes_every_key_it_does_not_hold(self):
        src = tv.filter_source()
        self.assertIn('function handleCinemaKeys(key, pressed, autoRepeat)', src)
        self.assertIn('return KeyPolicy.NextPolicy;', src)
        self.assertIn('"cinema.remoteKeys"', src)
        for name, sym in tv.REMOTE_KEYS:
            self.assertIn('codes["%s"] = %s;' % (name, sym), src)
        self.assertEqual(src.count('{'), src.count('}'))


class Consent(unittest.TestCase):
    groups = {'generalTermsAllowed': ['S_SVC'], 'customAdAllowed': ['S_SVC', 'S_TAG'],
              'acrAdAllowed': ['S_SVC', 'S_ADG', 'S_TAG'], 'acrOnAllowed': ['S_SVC', 'S_ADG'],
              'voiceAllowed': ['S_SVC', 'S_VNG']}
    flags = {'generalTermsAllowed': True, 'customAdAllowed': True, 'acrAdAllowed': True, 'acrOnAllowed': True, 'voiceAllowed': True}
    eln = {'eulaList': [{'id': i, 'accepted': True} for i in ('S_SVC', 'S_TAG', 'S_ADG', 'S_VNG')]}

    def test_switching_off_withdraws_its_documents_but_never_the_terms(self):
        flags, docs, changed = tv.plan_consent('customAdAllowed', False, self.flags, self.eln, self.groups)
        accepted = dict((d['id'], d['accepted']) for d in docs['eulaList'])
        self.assertEqual(accepted, {'S_SVC': True, 'S_TAG': False, 'S_ADG': True, 'S_VNG': True})
        # acrAdAllowed rests on S_TAG too: it goes off with it.
        self.assertEqual(sorted(changed), ['acrAdAllowed', 'customAdAllowed'])
        self.assertTrue(flags['generalTermsAllowed'] and flags['acrOnAllowed'] and flags['voiceAllowed'])

    def test_switching_on_accepts_what_it_needs(self):
        off = dict(self.flags, customAdAllowed=False)
        eln = {'eulaList': [{'id': 'S_SVC', 'accepted': True}, {'id': 'S_TAG', 'accepted': False}]}
        flags, docs, changed = tv.plan_consent('customAdAllowed', True, off, eln, self.groups)
        self.assertTrue(flags['customAdAllowed'])
        self.assertTrue([d for d in docs['eulaList'] if d['id'] == 'S_TAG'][0]['accepted'])

    def test_locked_and_hidden_flags_are_not_offered(self):
        self.assertFalse(tv.consent_settable('generalTermsAllowed', self.groups))
        self.assertFalse(tv.consent_settable('chpAllowed', dict(self.groups, chpAllowed=['S_SVC'])))
        self.assertTrue(tv.consent_settable('customAdAllowed', self.groups))


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
