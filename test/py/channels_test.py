import json, os, stat, subprocess, tempfile, unittest
from pathlib import Path

SCRIPT = str(Path(__file__).parents[2] / 'scripts' / 'channels.sh')

# Two channels as LG's API adapter lists them: number and name come before the id.
LIST = {'returnValue': True, 'channelListCount': 2, 'channelList': [
    {'channelNumber': '4', 'channelName': 'Rete4 HD', 'channelId': '1_38_4_4_930_3004_272',
     'Radio': False, 'Invisible': False, 'skipped': False, 'CASystemIDList': {}, 'favoriteGroup': []},
    {'channelNumber': '701', 'channelName': 'Radio Uno', 'channelId': '1_44_17085_701_31000_1_8572',
     'Radio': True, 'Invisible': False, 'skipped': True, 'CASystemIDList': {}, 'favoriteGroup': ['A']}]}


class ChannelsScript(unittest.TestCase):
    def run_script(self, *args):
        with tempfile.TemporaryDirectory() as bin_dir:
            log = os.path.join(bin_dir, 'calls')
            fake = os.path.join(bin_dir, 'luna-send')
            with open(fake, 'w') as f:
                f.write('#!/bin/sh\n'
                        'printf "%s\\n" "$*" >> "' + log + '"\n'
                        'case "$*" in\n'
                        '  *getChannelList*) cat "' + bin_dir + '/list.json" ;;\n'
                        '  *getLastChannelId*) echo \'{"channelId":"1_38_4_4_930_3004_272","returnValue":true}\' ;;\n'
                        '  *setLastChannelId*) echo \'{ "returnValue": true }\' ;;\n'
                        '  *getChannelCurrentProgramInfo*) cat "' + bin_dir + '/programme.json" ;;\n'
                        'esac\n')
            with open(os.path.join(bin_dir, 'programme.json'), 'w') as f:
                json.dump(getattr(self, 'programme', {'returnValue': True, 'programName': 'Tg4'}), f, indent=2)
            os.chmod(fake, stat.S_IRWXU)
            # Pretty-printed, as luna-send prints it.
            with open(os.path.join(bin_dir, 'list.json'), 'w') as f:
                json.dump(LIST, f, indent=2)
            env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ['PATH'])
            out = subprocess.run(['sh', SCRIPT] + list(args), env=env, capture_output=True, text=True).stdout
            calls = open(log).read() if os.path.exists(log) else ''
            return out, calls

    def test_each_id_keeps_its_own_number_and_name(self):
        out, _ = self.run_script('list')
        self.assertEqual(out.splitlines(), ['1_38_4_4_930_3004_272\t4\tRete4 HD\t0\t0\t0',
                                            '1_44_17085_701_31000_1_8572\t701\tRadio Uno\t1\t1\t1'])

    def test_current_tune_and_programme(self):
        self.assertEqual(self.run_script('current')[0].strip(), '1_38_4_4_930_3004_272')
        out, calls = self.run_script('tune', '1_38_4_4_930_3004_272";rm -rf /')
        self.assertEqual(out.strip(), 'tuned')
        self.assertIn('setLastChannelId {"channelId":"1_38_4_4_930_3004_272rm-rf"}', calls)
        self.assertEqual(self.run_script('programme', '1_38_4_4_930_3004_272')[0].strip(), 'Tg4')

    def test_programme_info_is_one_json_line_from_the_same_reply(self):
        # Epoch seconds, as the EPG gives them, and the programme after.
        self.programme = {'returnValue': True, 'programName': 'Tg4 "Sera"', 'startTime': 1761771600,
                          'endTime': 1761773400, 'nextProgramName': 'Film'}
        out, calls = self.run_script('programme-info', '1_38_4_4_930_3004_272')
        self.assertEqual(json.loads(out), {'name': 'Tg4 "Sera"', 'start': 1761771600, 'end': 1761773400, 'next': 'Film'})
        self.assertEqual(len(out.strip().splitlines()), 1)
        self.assertIn('getChannelCurrentProgramInfo {"channelId":"1_38_4_4_930_3004_272"}', calls)
        # Milliseconds and a duration instead of an end.
        self.programme = {'returnValue': True, 'programName': 'Tg4', 'startTime': 1761771600000, 'duration': 1800}
        self.assertEqual(json.loads(self.run_script('programme-info', '1_38_4_4_930_3004_272')[0]),
                         {'name': 'Tg4', 'start': 1761771600, 'end': 1761773400, 'next': ''})
        # Nothing known: zeros and empty strings, still valid JSON.
        self.programme = {'returnValue': False, 'errorText': 'no programme'}
        self.assertEqual(json.loads(self.run_script('programme-info', '1_38_4_4_930_3004_272')[0]),
                         {'name': '', 'start': 0, 'end': 0, 'next': ''})
        # The plain subcommand is unchanged.
        self.programme = {'returnValue': True, 'programName': 'Tg4', 'startTime': 1}
        self.assertEqual(self.run_script('programme', '1_38_4_4_930_3004_272')[0].strip(), 'Tg4')


if __name__ == '__main__':
    unittest.main()
