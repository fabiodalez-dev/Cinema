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
            self.assertEqual(tv.load_conf(), {'preloadOff': [], 'settingsOff': [], 'servicesOff': [], 'keepInMemory': [], 'remoteKeys': {}, 'powerOffAt': None, 'cinemaFirst': False})
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


class PowerOffAt(unittest.TestCase):
    def at(self, hhmm):
        import time as t
        return t.strptime('2026-10-24 ' + hhmm, '%Y-%m-%d %H:%M')

    def test_warns_a_minute_before_then_switches_off_once_a_day(self):
        self.assertEqual(tv.power_off_due('02:00', self.at('01:59'), None, None), 'warn')
        self.assertEqual(tv.power_off_due('02:00', self.at('01:59'), None, '2026-10-24'), None)
        self.assertEqual(tv.power_off_due('02:00', self.at('02:00'), None, '2026-10-24'), 'off')
        self.assertEqual(tv.power_off_due('02:00', self.at('02:00'), '2026-10-24', '2026-10-24'), None)
        self.assertEqual(tv.power_off_due('00:00', self.at('23:59'), None, None), 'warn')
        self.assertEqual(tv.power_off_due(None, self.at('02:00'), None, None), None)

    def test_only_a_valid_time_is_kept(self):
        self.assertEqual(tv.clean_time('02:00'), '02:00')
        for bad in ('2:00', '24:00', '02:60', '', None, 5, '02:00; reboot'):
            self.assertIsNone(tv.clean_time(bad))

    def test_due_when_the_minute_was_passed_since_the_last_check(self):
        at = self.at
        # Reached between two checks 20 s apart, also when the loop was slow and skipped the minute.
        self.assertTrue(tv.due(at('02:00'), at('01:59'), '02:00', None))
        self.assertTrue(tv.due(at('02:03'), at('01:59'), '02:00', None))
        self.assertFalse(tv.due(at('01:59'), at('01:58'), '02:00', None))
        self.assertFalse(tv.due(at('02:03'), at('02:01'), '02:00', None))
        # Once a day: the local date of the last power-off blocks it.
        self.assertFalse(tv.due(at('02:00'), at('01:59'), '02:00', '2026-10-24'))
        self.assertTrue(tv.due(at('02:00'), at('01:59'), '02:00', '2026-10-23'))
        # Same minute twice: only the exact minute, so done_date is what stops a second power-off.
        self.assertTrue(tv.due(at('02:00'), at('02:00'), '02:00', None))
        self.assertFalse(tv.due(at('02:01'), at('02:01'), '02:00', None))
        # First check ever: exact minute only.
        self.assertTrue(tv.due(at('02:00'), None, '02:00', None))
        self.assertFalse(tv.due(at('02:01'), None, '02:00', None))
        self.assertFalse(tv.due(at('02:00'), None, None, None))

    def test_due_across_midnight_and_a_dst_jump_but_not_across_a_clock_set(self):
        import time as t
        at = self.at
        self.assertTrue(tv.due(at('00:00'), at('23:59'), '00:00', None))
        self.assertTrue(tv.due(t.strptime('2026-10-25 00:00', '%Y-%m-%d %H:%M'), at('23:58'), '23:59', None))
        # 23:59 was current at the last check: that check fired it.
        self.assertFalse(tv.due(t.strptime('2026-10-25 00:00', '%Y-%m-%d %H:%M'), at('23:59'), '23:59', None))
        self.assertFalse(tv.due(at('00:00'), at('23:59'), '12:00', None))
        # Spring forward: 01:59:50 -> 03:00:10 local, 20 s apart on the epoch; 02:30 is not skipped.
        last = t.localtime(t.mktime(t.strptime('2026-03-29 01:59:50', '%Y-%m-%d %H:%M:%S')))
        now = t.localtime(t.mktime(last) + 20)
        if now.tm_hour == 3:  # only where the test machine's zone has that jump
            self.assertTrue(tv.due(now, last, '02:30', None))
        # A clock set forward by hours (NTP after a power cut) is not a window to catch up on.
        self.assertFalse(tv.due(at('07:10'), t.strptime('1970-01-01 00:00', '%Y-%m-%d %H:%M'), '02:00', None))
        self.assertFalse(tv.due(at('07:10'), at('01:00'), '02:00', None))
        self.assertTrue(tv.due(at('02:00'), t.strptime('1970-01-01 00:00', '%Y-%m-%d %H:%M'), '02:00', None))

    def test_warn_and_off_follow_due(self):
        self.assertEqual(tv.power_off_due('02:00', self.at('02:01'), None, None, self.at('01:59')), 'off')
        self.assertEqual(tv.power_off_due('02:00', self.at('01:59'), None, None, self.at('01:58')), 'warn')
        self.assertEqual(tv.power_off_due('02:00', self.at('01:59'), None, '2026-10-24', self.at('01:58')), None)

    def test_clock_is_trusted_from_its_source_or_as_a_fallback(self):
        self.assertFalse(tv.clock_trusted({'returnValue': True, 'source': 'micom', 'utc': 1}, 2026, 9999))
        self.assertTrue(tv.clock_trusted({'returnValue': True, 'source': 'ntp', 'utc': 1}, 2026, 10))
        self.assertTrue(tv.clock_trusted({'returnValue': True, 'source': 'micom', 'systemTimeSource': 'broadcast'}, 2026, 10))
        self.assertTrue(tv.clock_trusted({'returnValue': True, 'source': 'micom', 'systemTimeSource': 'ntp'}, 2026, 10))
        # No usable reply: a sane year on a TV up for ten minutes.
        self.assertTrue(tv.clock_trusted({}, 2026, 600))
        self.assertFalse(tv.clock_trusted({}, 2026, 120))
        self.assertFalse(tv.clock_trusted({}, 1970, 9999))
        self.assertFalse(tv.clock_trusted({'returnValue': False, 'errorText': 'x'}, 2010, 9999))
        self.assertTrue(tv.clock_trusted(None, 2026, 601))


class PreloadBaseline(unittest.TestCase):
    def test_lgs_list_is_merged_by_id(self):
        base = [{'id': 'amazon', 'isEnabled': True, 'requiredMemory': 100}, {'id': 'gone', 'isEnabled': True}]
        cur = [{'id': 'amazon', 'isEnabled': False, 'requiredMemory': 120}, {'id': 'new', 'isEnabled': True}]
        out = tv.merge_preload_baseline(base, cur)
        self.assertEqual(out, [{'id': 'amazon', 'isEnabled': True, 'requiredMemory': 120}, {'id': 'new', 'isEnabled': True}])
        self.assertEqual(tv.merge_preload_baseline(None, cur), cur)
        self.assertEqual(tv.merge_preload_baseline(out, cur), out, 'stable')


class WriteJson(unittest.TestCase):
    def test_unchanged_content_is_not_rewritten(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, 's.json')
        self.assertTrue(tv.write_json(p, {'a': 1, 'b': [2]}))
        before = os.stat(p).st_ino, open(p).read()
        self.assertFalse(tv.write_json(p, {'b': [2], 'a': 1}))
        self.assertEqual((os.stat(p).st_ino, open(p).read()), before)
        self.assertTrue(tv.write_json(p, {'a': 2}))
        self.assertEqual(json.load(open(p)), {'a': 2})


class Uninstalled(unittest.TestCase):
    """Cinema removed from LG's Home: the tools take themselves out."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.saved = dict((k, getattr(tv, k)) for k in
                          ('ROOT', 'STATE', 'CONF', 'PIDFILE', 'HOOKS', 'APP_DIR', 'HBC_DIR', 'UPDATE_JSON', 'WATCHDOG_PID'))
        tv.ROOT = self.d
        tv.STATE = os.path.join(self.d, 'tvtools-state.json'); tv.CONF = os.path.join(self.d, 'tvtools.json')
        tv.PIDFILE = os.path.join(self.d, 'pid'); tv.WATCHDOG_PID = os.path.join(self.d, 'none.pid')
        tv.HOOKS = [os.path.join(self.d, h) for h in ('55-cinema-tvtools', '45-cinema-tvtools-memory')]
        tv.APP_DIR = os.path.join(self.d, 'apps', 'cinema'); tv.HBC_DIR = os.path.join(self.d, 'apps', 'hbchannel')
        tv.UPDATE_JSON = os.path.join(self.d, 'update.json')
        tv.UNINSTALL['misses'] = 0
        for p in tv.HOOKS + [tv.STATE, tv.CONF]:
            open(p, 'w').write('{}')
        os.makedirs(os.path.join(self.d, 'tvtools')); os.makedirs(tv.HBC_DIR)

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(tv, k, v)
        tv.UNINSTALL['misses'] = 0

    def test_removed_only_when_the_apps_partition_is_there_and_no_update_runs(self):
        self.assertTrue(tv.app_removed())
        os.makedirs(tv.APP_DIR); open(os.path.join(tv.APP_DIR, 'appinfo.json'), 'w').write('{}')
        self.assertFalse(tv.app_removed())
        os.remove(os.path.join(tv.APP_DIR, 'appinfo.json')); os.rmdir(tv.HBC_DIR)
        self.assertFalse(tv.app_removed(), 'partition not mounted: nothing is known')
        import time as t
        json.dump({'state': 'installing', 'at': int(t.time())}, open(tv.UPDATE_JSON, 'w'))
        self.assertTrue(tv.update_in_progress())
        json.dump({'state': 'installed', 'at': int(t.time())}, open(tv.UPDATE_JSON, 'w'))
        self.assertFalse(tv.update_in_progress())
        json.dump({'state': 'installing', 'at': int(t.time()) - 3600}, open(tv.UPDATE_JSON, 'w'))
        self.assertFalse(tv.update_in_progress(), 'a stale installer is not waited for')

    def test_three_misses_in_a_row_then_everything_goes(self):
        exits = []
        old_exit = os._exit; os._exit = lambda code: exits.append(code)
        try:
            tv.check_uninstalled(); tv.check_uninstalled()
            self.assertEqual(exits, []); self.assertTrue(os.path.exists(tv.HOOKS[0]))
            tv.check_uninstalled()
        finally:
            os._exit = old_exit
        self.assertEqual(exits, [0])
        for p in tv.HOOKS + [tv.STATE, tv.CONF, os.path.join(self.d, 'tvtools')]:
            self.assertFalse(os.path.exists(p), p)

    def test_a_short_absence_during_an_update_is_not_an_uninstall(self):
        import time as t
        json.dump({'state': 'installing', 'at': int(t.time())}, open(tv.UPDATE_JSON, 'w'))
        for _ in range(5):
            tv.check_uninstalled()
        self.assertTrue(os.path.exists(tv.HOOKS[0]))
        self.assertEqual(tv.UNINSTALL['misses'], 0)


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




class PowerOnInput(unittest.TestCase):
    def test_first_free_hdmi_is_the_boot_input(self):
        devices = [{'id': 'HDMI_1', 'connected': True, 'appId': 'com.webos.app.hdmi1'},
                   {'id': 'HDMI_3', 'connected': False, 'appId': 'com.webos.app.hdmi3'},
                   {'id': 'HDMI_4', 'connected': False, 'appId': 'com.webos.app.hdmi4'}]
        self.assertEqual(tv.boot_input(devices), ('HDMI_3', 'com.webos.app.hdmi3'))

    def test_live_tv_when_every_hdmi_is_used_or_unknown(self):
        self.assertEqual(tv.boot_input([{'id': 'HDMI_1', 'connected': True, 'appId': 'com.webos.app.hdmi1'}]),
                         ('DTV', 'com.webos.app.livetv'))
        self.assertEqual(tv.boot_input(None), ('DTV', 'com.webos.app.livetv'))

    def test_pinned_file_names_cinema_on_that_input(self):
        self.assertEqual(tv.pinned_lastinput('HDMI_3'),
                         {'type': 'MVPD_IP', 'appId': 'org.webosbrew.lounge.launcher', 'physicalLastSourceId': 'HDMI_3',
                          'physicalLastSourceAppId': 'org.webosbrew.lounge.launcher'})

    def test_switching_off_puts_lgs_file_back(self):
        d = tempfile.mkdtemp()
        old = (tv.LASTINPUT, tv.PINNED, tv.LG_LASTINPUT, tv.lastinput_pinned)
        tv.LASTINPUT = os.path.join(d, 'lastinput'); tv.PINNED = os.path.join(d, 'pinned'); tv.LG_LASTINPUT = os.path.join(d, 'lg')
        tv.lastinput_pinned = lambda: False
        try:
            lg = {'type': 'DTV', 'appId': 'com.webos.app.livetv', 'physicalLastSourceId': 'DTV',
                  'physicalLastSourceAppId': 'com.webos.app.livetv'}
            json.dump(lg, open(tv.LG_LASTINPUT, 'w'))
            json.dump(tv.pinned_lastinput('HDMI_3'), open(tv.PINNED, 'w'))
            json.dump(tv.pinned_lastinput('HDMI_3'), open(tv.LASTINPUT, 'w'))
            tv.apply_first_app({'cinemaFirst': False})
            self.assertEqual(json.load(open(tv.LASTINPUT)), lg)
            self.assertFalse(os.path.exists(tv.PINNED))
            self.assertFalse(os.path.exists(tv.LG_LASTINPUT))
        finally:
            tv.LASTINPUT, tv.PINNED, tv.LG_LASTINPUT, tv.lastinput_pinned = old


class BootFilter(unittest.TestCase):
    def test_boot_filter_only_when_asked(self):
        self.assertNotIn('cinemaStartWatch', tv.filter_source(False))
        src = tv.filter_source(True)
        self.assertIn('cinemaStartWatch();', src)
        self.assertIn('applicationManager.launch("org.webosbrew.lounge.launcher", "{}")', src)
        self.assertIn('"boot-done"', src)


class WayOut(unittest.TestCase):
    DEVICES = (
        'I: Bus=0019\nN: Name="CHECK INPUT"\nH: Handlers=kbd event0 \n\n'
        'N: Name="LGE RCU"\nH: Handlers=kbd event1 \n\n'
        'N: Name="Bluetooth-audio-source"\nH: Handlers=kbd event2 \n\n'
        'N: Name="LGE M-RCU - Builtin [0]"\nH: Handlers=kbd mouse0 js0 event3 \n\n'
        'N: Name="LGE Simple Premium"\nH: Handlers=mouse4 event7 \n')

    def test_only_lg_remotes_with_keys(self):
        self.assertEqual(tv.remote_devices(self.DEVICES), ['/dev/input/event1', '/dev/input/event3'])

    def taps(self, m, start, n, held=0.1, gap=0.3):
        out, t = [], start
        for _ in range(n):
            out.append(m.key(tv.KEY_HOME, 1, t))
            out.append(m.key(tv.KEY_HOME, 0, t + held))
            t += held + gap
        return [x for x in out if x]

    def test_three_short_home_presses(self):
        self.assertEqual(self.taps(tv.EscapeKeys(), 100.0, 3), ['home3'])

    def test_two_presses_or_slow_presses_do_nothing(self):
        self.assertEqual(self.taps(tv.EscapeKeys(), 100.0, 2), [])
        self.assertEqual(self.taps(tv.EscapeKeys(), 100.0, 3, gap=1.5), [])
        self.assertEqual(self.taps(tv.EscapeKeys(), 100.0, 3, held=0.8), [])

    def test_another_key_breaks_the_series(self):
        m = tv.EscapeKeys()
        self.taps(m, 100.0, 2)
        m.key(103, 1, 100.9); m.key(103, 0, 101.0)
        self.assertEqual(self.taps(m, 101.1, 1), [])

    def test_back_held_counts_when_let_go(self):
        m = tv.EscapeKeys()
        self.assertIsNone(m.key(tv.KEY_BACK, 1, 50.0))
        self.assertIsNone(m.key(tv.KEY_BACK, 2, 51.0))
        self.assertIsNone(m.key(tv.KEY_BACK, 2, 51.5))
        self.assertEqual(m.key(tv.KEY_BACK, 0, 51.6), 'backhold')
        self.assertIsNone(m.key(tv.KEY_BACK, 0, 52.0))

    def test_short_back_does_nothing(self):
        m = tv.EscapeKeys()
        m.key(tv.KEY_BACK, 1, 50.0)
        self.assertIsNone(m.key(tv.KEY_BACK, 0, 50.3))


class LastInputApp(unittest.TestCase):
    def run_with(self, settings):
        calls, old = [], tv.luna
        def fake(uri, payload, wait=5000):
            calls.append((uri.rsplit('/', 1)[1], payload))
            return {'settings': settings} if uri.endswith('getSystemSettings') else {'returnValue': True}
        tv.luna = fake
        try:
            return calls, fake
        finally:
            pass

    def tearDown(self):
        tv.luna = self.old

    def setUp(self):
        self.old = tv.luna

    def test_sets_cinema_when_lg_has_live_tv(self):
        calls, _ = self.run_with({'lastInputApp': 'com.webos.app.livetv', 'physicalLastInputApp': 'com.webos.app.livetv'})
        self.assertTrue(tv.keep_last_input_app())
        self.assertEqual(calls[-1], ('setSystemSettings', {'category': 'general', 'settings': {
            'lastInputApp': 'org.webosbrew.lounge.launcher', 'physicalLastInputApp': 'org.webosbrew.lounge.launcher'}}))

    def test_nothing_to_do_when_already_cinema(self):
        calls, _ = self.run_with({'lastInputApp': 'org.webosbrew.lounge.launcher', 'physicalLastInputApp': 'org.webosbrew.lounge.launcher'})
        self.assertFalse(tv.keep_last_input_app())
        self.assertEqual([c[0] for c in calls], ['getSystemSettings'])

    def test_release_gives_live_tv_back_only_where_cinema_was(self):
        calls, _ = self.run_with({'lastInputApp': 'org.webosbrew.lounge.launcher', 'physicalLastInputApp': 'com.webos.app.hdmi2'})
        tv.release_last_input_app()
        self.assertEqual(calls[-1], ('setSystemSettings', {'category': 'general', 'settings': {'lastInputApp': 'com.webos.app.livetv'}}))

if __name__ == '__main__':
    unittest.main()
