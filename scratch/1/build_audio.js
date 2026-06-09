const { execSync } = require('child_process');
const path = require('path');
const A = '/Users/chasekellis/Apps/trainercenter/scratch/1/audio_out';
const OUT = path.join(A, 'mix.mp3');

// eighth-note collage (mirror of render.html): one photo every 0.25s, 4.0..7.75
const STAMP=[4.0,4.25,4.5,4.75,5.0,5.25,5.5,5.75,6.0,6.25,6.5,6.75,7.0,7.25,7.5,7.75];
const CDONE=7.75, DROP=23.0;
const HSTART=9.5, HSTEP=4.5;
const TOTAL=32;

// ---- VOICE: one distinct reaction per hero, only ONE wow ----
const voice=[];
voice.push(['oak_welcome.wav',   1.30, 1.0]);
voice.push(['oak_oh.wav',        HSTART+0.40,         1.0]); // Gengar  "Ooh!"
voice.push(['oak_wonderful.wav', HSTART+HSTEP+0.40,   1.0]); // Gardevoir "Wonderful!"
voice.push(['oak_wow.wav',       HSTART+2*HSTEP+0.40, 1.0]); // Pikachu  "Wow!"  (only wow)
voice.push(['oak_perfect.wav',   DROP+0.45,           1.0]); // Charizard "Perfect!" on the drop
voice.push(['oak_welldone.wav',  27.05, 1.0]);               // "Well done!" — lands as the shop card rises

// ---- SFX ----
const sfx=[];
// crisp photo click on every quarter-note stamp (slight build toward the accent)
STAMP.forEach((t,i)=>{ const v = 0.34 + 0.012*i; sfx.push(['photo.wav', t+0.01, v]); });
// accent boom when the collage completes, and the big boom on the drop (Charizard)
sfx.push(['kick.wav', CDONE, 0.34]);
sfx.push(['kick.wav', DROP,  0.50]);
// sparkle on hero reveals
for(let i=0;i<4;i++) sfx.push(['sparkle.wav', HSTART+i*HSTEP+0.12, 0.42]);

// buses: MUSIC (lowered + ducked under VOICE), VOICE, SFX
let inputs=[], idx=0, fc=[];
const music = idx++; inputs.push('-i', path.join(A,'music.mp3'));
const vLab=[];
voice.forEach(e=>{ const i=idx++; inputs.push('-i', path.join(A,e[0])); const ms=Math.round(e[1]*1000);
  fc.push(`[${i}:a]adelay=${ms}|${ms},volume=${e[2]}[v${i}]`); vLab.push(`[v${i}]`); });
const sLab=[];
sfx.forEach(e=>{ const i=idx++; inputs.push('-i', path.join(A,e[0])); const ms=Math.round(e[1]*1000);
  fc.push(`[${i}:a]adelay=${ms}|${ms},volume=${e[2]}[s${i}]`); sLab.push(`[s${i}]`); });

fc.push(`${vLab.join('')}amix=inputs=${vLab.length}:normalize=0:duration=longest[voice]`);
fc.push(`[voice]asplit=2[vmix][vkey]`);
fc.push(`${sLab.join('')}amix=inputs=${sLab.length}:normalize=0:duration=longest[sfx]`);
fc.push(`[${music}:a]volume=0.42[mus]`);
fc.push(`[mus][vkey]sidechaincompress=threshold=0.04:ratio=8:attack=12:release=320:makeup=1[musd]`);
fc.push(`[musd][vmix][sfx]amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.97,apad=whole_dur=${TOTAL*1000}ms,atrim=0:${TOTAL},aresample=44100[out]`);

const cmd = ['ffmpeg','-y','-loglevel','error',
  ...inputs,
  '-filter_complex', `"${fc.join(';')}"`,
  '-map','"[out]"','-t',String(TOTAL),'-c:a','libmp3lame','-q:a','2', OUT
].join(' ');
execSync(cmd,{stdio:'inherit'});
console.log('AUDIO_MIX='+OUT);
