// Generate a portable, exact map from the same resolver used by the listening lab.
import { readFile, writeFile } from 'node:fs/promises';
import { profiles, mixFor } from '../state.mjs';
import { events, layers } from '../catalog.mjs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const routes = manifest.worlds.map(world => {
  let start=0;
  const total=world.route.reduce((n,s)=>n+s.steps,0);
  return {id:world.id,name:world.name,theme:world.theme.style,total,
    segments:world.route.map(s=>{
      const pos=start;start+=s.steps;
      const mix=mixFor({...s,segment:s.kind,pos,total,world});
      return {label:s.label,kind:s.kind,start:pos,endExclusive:start,
        ambience:'assets/'+mix.file,ambienceGain:mix.gain,
        footstep:mix.stepAllowed?'assets/step_'+mix.material+'.wav':null};
    })};
});
const doc={version:2,label:'Emma0923',updated:'2026-09-24',sourceCommit:manifest.sourceCommit,
  coordinateConvention:'zero-based game T.pos; endExclusive is exclusive; not physical distance',
  integration:'Asset package and lab only. Main game hooks are documented replacement points, not installed patches.',
  profiles,routes,events,layers,
  parkour:{path:'/parkour',profile:'parkour_rooftop',ambience:'assets/parkour_rooftop.wav',
    stateSource:'Client-side run in parkour/main.js. The server /state terrain does not describe parkour events.',
    followViaServerState:false},
  mixing:{defaultMaster:.25,crossfadeSeconds:.8,narrationAmbienceMultiplier:.22,
    narrationEffectsMultiplier:.45,trainingDefault:'mute',
    note:'Do not run file-based layers together with equivalent kit.sfx/sfxLoop synthesis.'}};
await writeFile(new URL('SCENE-MAP.json',root),JSON.stringify(doc,null,2)+'\n');
console.log(`Mapped ${routes.length} routes, ${routes.reduce((n,w)=>n+w.segments.length,0)} segments, parkour, ${events.length} events.`);
