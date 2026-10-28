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
                        '  *getChannelCurrentProgramInfo*) echo \'{"returnValue":true,"programName":"Tg4"}\' ;;\n'
                        'esac\n')
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


if __name__ == '__main__':
    unittest.main()
