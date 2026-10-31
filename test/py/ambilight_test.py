import importlib.util, json, os, struct, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('ambilight', str(Path(__file__).parents[2] / 'scripts' / 'ambilight.py'))
amb = importlib.util.module_from_spec(spec); spec.loader.exec_module(amb)
amb.LOG[0] = lambda msg: None


def bmp(w, h, pixel, top_down=True):
    """A 24-bit BMP whose pixel(x, y) gives (r, g, b), y from the top."""
    stride = (w * 3 + 3) & ~3
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            r, g, b = pixel(x, y)
            row += bytes([b, g, r])
        row += b'\0' * (stride - w * 3)
        rows.append(bytes(row))
    if not top_down:
        rows.reverse()
    data = b''.join(rows)
    head = b'BM' + struct.pack('<IHHI', 54 + len(data), 0, 0, 54)
    info = struct.pack('<IiiHHIIiiII', 40, w, -h if top_down else h, 1, 24, 0, len(data), 0, 0, 0, 0)
    return head + info + data


class Frames(unittest.TestCase):
    def test_colour_power_and_brightness_frames(self):
        self.assertEqual(amb.color_frame((255, 0, 128.4)), [0x7e, 0x07, 0x05, 0x03, 255, 0, 128, 0x10, 0xef])
        self.assertEqual(amb.color_frame((300, -5, 10)), [0x7e, 0x07, 0x05, 0x03, 255, 0, 10, 0x10, 0xef])
        self.assertEqual(amb.power_frame(True), [0x7e, 0x04, 0x04, 0x01, 0x00, 0x01, 0xff, 0x00, 0xef])
        self.assertEqual(amb.power_frame(False)[3], 0)
        self.assertEqual(amb.brightness_frame(250)[3], 100)

    def test_strip_names_from_the_scan_record(self):
        # The record seen on the owner's TV: name, flags, appearance, name again.
        rec = [11, 9] + list(b'ELK-BLEDOB') + [2, 1, 6, 3, 25, 128, 1, 5, 2, 18, 24, 240, 255]
        self.assertEqual(amb.strip_name(rec), 'ELK-BLEDOB')
        self.assertTrue(amb.is_strip('ELK-BLEDOB'))
        self.assertTrue(amb.is_strip('MELK-OA10'))
        self.assertFalse(amb.is_strip('[TV] Samsung'))
        self.assertEqual(amb.strip_name([27, 255, 117, 0, 66]), '')
        self.assertEqual(amb.strip_name([]), '')


class Screen(unittest.TestCase):
    def test_bmp_both_row_orders(self):
        px = lambda x, y: (200, 0, 0) if y < 2 else (0, 0, 200)
        for top_down in (True, False):
            w, h, rows = amb.bmp_pixels(bmp(5, 4, px, top_down))
            self.assertEqual((w, h), (5, 4))
            self.assertEqual(tuple(rows[0][:3]), (0, 0, 200))     # BGR: red on top
            self.assertEqual(tuple(rows[3][:3]), (200, 0, 0))
        self.assertIsNone(amb.bmp_pixels(b'not a bmp'))

    def test_letterbox_bars_are_ignored(self):
        def px(x, y):
            return (0, 0, 0) if y < 30 or y >= 106 else (30, 60, 200)
        r, g, b = amb.screen_color(*amb.bmp_pixels(bmp(240, 136, px)))
        self.assertGreater(b, 150)
        self.assertLess(r, 60)

    def test_a_strong_colour_wins_over_a_grey_background(self):
        def px(x, y):
            return (220, 20, 20) if 100 <= x < 160 and 40 <= y < 100 else (120, 120, 120)
        r, g, b = amb.screen_color(*amb.bmp_pixels(bmp(240, 136, px)))
        self.assertGreater(r, g * 3)

    def test_a_grey_scene_gives_its_average_and_black_gives_off(self):
        grey = amb.screen_color(*amb.bmp_pixels(bmp(240, 136, lambda x, y: (150, 150, 140))))
        self.assertTrue(all(120 < c < 160 for c in grey))
        self.assertEqual(amb.screen_color(*amb.bmp_pixels(bmp(240, 136, lambda x, y: (0, 0, 0)))), (0, 0, 0))

    def test_a_mostly_black_frame_is_dim(self):
        def px(x, y):
            return (255, 255, 255) if x < 12 else (0, 0, 0)
        r, g, b = amb.screen_color(*amb.bmp_pixels(bmp(240, 136, px)))
        self.assertLess(max(r, g, b), 40)

    def test_boost_keeps_black_and_white(self):
        self.assertEqual(amb.boost((0, 0, 0)), (0.0, 0.0, 0.0))
        self.assertEqual([round(c) for c in amb.boost((255, 255, 255))], [255, 255, 255])

    def test_smoother_follows_cuts_faster(self):
        s = amb.Smoother()
        s.step((0, 0, 0))
        small = s.step((40, 0, 0))[0]
        s2 = amb.Smoother()
        s2.step((0, 0, 0))
        cut = s2.step((255, 0, 0))[0]
        self.assertLess(small / 40.0, cut / 255.0)


class Conf(unittest.TestCase):
    def test_bad_values_fall_back(self):
        c = amb.clean_conf({'address': 'BE:32:03:63:BA:78', 'follow': True, 'brightness': 500,
                            'ambient': 'disco', 'ambientBrightness': 'x'})
        self.assertEqual(c['address'], 'be:32:03:63:ba:78')
        self.assertEqual(c['brightness'], 100)
        self.assertEqual(c['ambient'], 'warm')
        self.assertEqual(c['ambientBrightness'], 60)
        self.assertTrue(c['follow'])
        self.assertFalse(amb.clean_conf({'address': 'nope', 'follow': True})['follow'])
        self.assertEqual(amb.clean_conf(None)['address'], None)

    def test_room_light_at_its_brightness(self):
        conf = amb.clean_conf({'ambient': 'white', 'ambientBrightness': 50})
        self.assertEqual(amb.ambient_color(conf), (127.5, 127.5, 127.5))
        self.assertIsNone(amb.ambient_color(amb.clean_conf({'ambient': 'keep'})))


class FakeStrip(object):
    def __init__(self, address):
        self.address = address
        self.connected = False
        self.reason = ''
        self.last_write = 0
        self.frames = []
        self.closed = 0

    def connect(self):
        self.connected = True
        return True

    def write(self, frame):
        self.frames.append(frame)
        return True

    def close(self):
        self.closed += 1
        self.connected = False

    def colors(self):
        return [tuple(f[4:7]) for f in self.frames if f[3] == 0x03]


class Loop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.saved = (amb.Strip, amb.capture, amb.reset_bluetooth, amb.stale_link, amb.PREVIEW, amb.RUN)
        amb.Strip = FakeStrip
        amb.capture = lambda: amb.bmp_pixels(bmp(16, 8, lambda x, y: (0, 0, 255)))
        self.resets = []
        amb.reset_bluetooth = lambda: self.resets.append(1)
        amb.stale_link = lambda a: False
        amb.RUN = self.tmp
        amb.PREVIEW = os.path.join(self.tmp, 'preview.json')
        self.conf = {'address': 'be:32:03:63:ba:78', 'follow': True, 'ambient': 'red', 'ambientBrightness': 100}
        self.power = ['Active']
        self.now = [1000.0]
        self.a = amb.Ambilight(conf_source=lambda: amb.clean_conf(self.conf), power=lambda: self.power[0],
                               clock=lambda: self.now[0])

    def tearDown(self):
        amb.Strip, amb.capture, amb.reset_bluetooth, amb.stale_link, amb.PREVIEW, amb.RUN = self.saved

    def test_follows_the_screen_while_on(self):
        self.a.step()
        self.assertEqual(self.a.mode, 'follow')
        r, g, b = self.a.strip.colors()[-1]
        self.assertGreater(b, 200)

    def test_room_light_once_when_the_tv_goes_off(self):
        self.a.step()
        self.power[0] = 'Suspend'
        self.a.step()
        self.a.step()
        self.assertEqual(self.a.strip.colors().count((255, 0, 0)), 1)
        self.power[0] = 'Active'
        self.a.step()
        self.assertEqual(self.a.mode, 'follow')

    def test_lgs_announcement_gives_the_room_light_before_the_state_changes(self):
        self.a.step()
        self.a.prepare_off('Suspend')
        self.assertEqual(self.a.strip.colors()[-1], (255, 0, 0))
        self.a.step()                         # still "Active": it does not go back to the film
        self.assertEqual(self.a.mode, 'ambient')
        self.now[0] += 30                     # LG changed its mind: following again
        self.a.step()
        self.assertEqual(self.a.mode, 'follow')

    def test_off_room_light_also_switches_the_strip_off(self):
        self.conf['ambient'] = 'off'
        self.a.step()
        self.a.prepare_off('PowerOff')
        self.assertEqual(self.a.strip.frames[-1], amb.power_frame(False))

    def test_keep_leaves_the_last_colour(self):
        self.conf['ambient'] = 'keep'
        self.a.step()
        n = len(self.a.strip.frames)
        self.a.prepare_off('Suspend')
        self.assertEqual(len(self.a.strip.frames), n)

    def test_follow_off_stops_and_lets_the_strip_go_with_the_room_light(self):
        self.a.step()
        strip = self.a.strip
        self.conf['follow'] = False
        self.assertIsNone(self.a.step())
        self.a.release()
        self.assertEqual(strip.colors()[-1], (255, 0, 0))
        self.assertEqual(self.resets, [1])
        self.assertIsNone(self.a.strip)

    def test_prova_shows_the_colour_and_after_it_the_colour_stays(self):
        self.conf['follow'] = False
        self.conf['address'] = None
        with open(amb.PREVIEW, 'w') as f:
            json.dump({'rgb': [10, 20, 30], 'address': 'be:32:03:63:ba:78'}, f)
        self.assertEqual(self.a.step(), 0.2)
        strip = self.a.strip
        self.assertEqual(strip.address, 'be:32:03:63:ba:78')
        self.assertEqual(strip.colors()[-1], (10, 20, 30))
        self.now[0] += amb.PREVIEW_SECONDS + 1
        self.assertIsNone(self.a.step())
        self.a.release()
        self.assertEqual(strip.colors()[-1], (10, 20, 30))

    def test_a_stale_link_is_cleared_by_restarting_bluetooth(self):
        tries = []

        class Refusing(FakeStrip):
            def connect(self):
                tries.append(1)
                self.connected = len(tries) > 1
                return self.connected
        amb.Strip = Refusing
        amb.stale_link = lambda a: True
        self.a.step()
        self.assertEqual(self.resets, [1])
        self.assertEqual(self.a.mode, 'follow')


if __name__ == '__main__':
    unittest.main()
