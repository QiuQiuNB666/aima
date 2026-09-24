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
        self.assertEqual(len(manifest['assets']),37)
        for a in manifest['assets']:
            f=STATIC/a['file']
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(),a['sha256'])
            with wave.open(str(f),'rb') as w:
                self.assertEqual((w.getnchannels(),w.getsampwidth(),w.getframerate()),(2,2,48000))
                self.assertAlmostEqual(w.getnframes()/48000,a['seconds'],places=2)
            self.assertLess(a['peakDbFS'],-3)
        self.assertEqual(len({w['theme']['style'] for w in manifest['worlds']}),7)

    def test_exact_world_snapshots_and_loop_mapping(self):
        manifest=json.loads((STATIC/'manifest.json').read_text(encoding='utf-8'))
        mapping=json.loads((STATIC/'SCENE-MAP.json').read_text(encoding='utf-8'))
        assets={a['file']:a for a in manifest['assets']}
        self.assertEqual(len(manifest['worlds']),8)
        self.assertEqual({w['id'] for w in manifest['worlds']},{w['id'] for w in mapping['routes']})
        for world in manifest['worlds']:
            self.assertEqual(world,json.loads((STATIC/'worlds'/(world['id']+'.json')).read_text(encoding='utf-8')))
            row=next(r for r in mapping['routes'] if r['id']==world['id'])
            self.assertEqual(row['total'],sum(s['steps'] for s in world['route']))
            end=0
            for segment in row['segments']:
                self.assertEqual(segment['start'],end)
                end=segment['endExclusive']
                self.assertTrue(assets[segment['ambience']]['loop'])
                if segment['kind']=='wait': self.assertIsNone(segment['footstep'])
                else: self.assertFalse(assets[segment['footstep']]['loop'])
            self.assertEqual(end,row['total'])
        for event in mapping['events']:
            self.assertFalse(assets['assets/'+event['file']]['loop'])
        for layer in mapping['layers']:
            self.assertTrue(assets['assets/'+layer['file']]['loop'])
        self.assertFalse(mapping['parkour']['followViaServerState'])

    def test_asset_provenance_is_complete(self):
        manifest=json.loads((STATIC/'manifest.json').read_text(encoding='utf-8'))
        sources={s['id']:s for s in manifest['sources']}
        for a in manifest['assets']:
            for source in a['sources']:
                self.assertTrue(source=='original' or source in sources)
        generated=sources['original-Emma0924']
        self.assertEqual(hashlib.sha256((STATIC/generated['generator']).read_bytes()).hexdigest(),generated['generatorSha256'])
        self.assertEqual(len([a for a in manifest['assets'] if 'original-Emma0924' in a['sources']]),26)

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
