"""Asset QA and read-only bridge invariants; no device calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import wave

ROOT=Path(__file__).resolve().parents[1]
STATIC=ROOT
spec=importlib.util.spec_from_file_location('audio_bridge',ROOT/'tools/serve_soundscape.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)


class SoundscapeTests(unittest.TestCase):
    def test_assets(self):
        manifest=json.loads((STATIC/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['assets']),11)
        for a in manifest['assets']:
            f=STATIC/a['file']
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(),a['sha256'])
            with wave.open(str(f),'rb') as w:
                self.assertEqual((w.getnchannels(),w.getsampwidth(),w.getframerate()),(2,2,48000))
                self.assertAlmostEqual(w.getnframes()/48000,a['seconds'],places=2)
            self.assertLess(a['peakDbFS'],-3)
        self.assertEqual(len({w['theme']['style'] for w in manifest['worlds']}),5)

    def test_source_stays_loopback(self):
        self.assertEqual(bridge.source_url('http://127.0.0.1:8877'),'http://127.0.0.1:8877/state')
        for value in ['https://example.com','http://127.0.0.1/secret','http://user:pass@localhost:9','http://192.168.1.1:8877']:
            with self.assertRaises(Exception):bridge.source_url(value)

    def test_strip_private_and_control_fields(self):
        state={'t':1,'memory':{'secret':'x'},'wearer':'name','gait':{'moving':True,'strides':12},
               'terrain':{'preset':'demo','pos':0,'total':2,'laps':0,'force':999,'world':{'theme':{'style':'grid'}}}}
        r=bridge.filtered_state(state)
        self.assertNotIn('memory',r);self.assertNotIn('wearer',r)
        self.assertNotIn('force',r['terrain']);self.assertEqual(r['gait'],{'moving':True})


if __name__=='__main__': unittest.main()
