const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRATCH = '/Users/chasekellis/Apps/trainercenter/scratch';
const FRAMES_DIR = path.join(SCRATCH, 'video-out', 'frames');
const MANIFEST = path.join(SCRATCH, 'video-out', 'manifest.json');
const CONCAT_FILE = path.join(SCRATCH, 'video-out', 'concat.txt');
const SILENT_MP4 = path.join(SCRATCH, 'video-out', 'silent.mp4');
const FINAL_MP4 = path.join(SCRATCH, 'gameboy-trade-night.mp4');

const TARGET_FPS = 30;
const TOTAL_SEC = 12;

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const frames = m.frames;
const firstMs = frames[0].captureMs;

// Build concat file with per-frame durations.
// concat demuxer expects: file ...\nduration <sec>\nfile ...\n... and the LAST file repeated.
let lines = [];
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const next = frames[i + 1];
  const durMs = next ? (next.captureMs - f.captureMs) : 200; // tail
  // Trim to keep total <= TOTAL_SEC
  const offsetSec = (f.captureMs - firstMs) / 1000;
  if (offsetSec >= TOTAL_SEC) break;
  const dur = Math.max(0.001, Math.min(durMs / 1000, TOTAL_SEC - offsetSec));
  lines.push(`file 'frames/${path.basename(`frame_${String(f.seq).padStart(5, '0')}.jpg`)}'`);
  lines.push(`duration ${dur.toFixed(4)}`);
}
// Repeat the last file (concat demuxer requirement)
const last = frames[Math.min(frames.length - 1, lines.length / 2 - 1)];
lines.push(`file 'frames/frame_${String(last.seq).padStart(5, '0')}.jpg'`);
fs.writeFileSync(CONCAT_FILE, lines.join('\n') + '\n');

// Stage 1: encode the silent video from concat-with-durations, normalized to TARGET_FPS
const encodeCmd = [
  'ffmpeg', '-y', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0',
  '-i', path.basename(CONCAT_FILE),
  '-vf', `fps=${TARGET_FPS},format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow',
  '-tune', 'stillimage',
  '-qp', '14',
  '-x264-params', 'aq-mode=0:psy=0:no-mbtree=1:rc-lookahead=0',
  '-t', String(TOTAL_SEC),
  path.basename(SILENT_MP4),
].join(' ');
execSync(encodeCmd, { cwd: path.join(SCRATCH, 'video-out'), stdio: 'inherit' });

// Stage 2: mux audio. Click times in manifest are relative to startCaptureMs;
// video time 0 = first captured frame, so subtract firstMs.
const clickMs = m.clicksMs
  .map((c) => c - firstMs)
  .filter((c) => c >= 0 && c < TOTAL_SEC * 1000)
  .slice(0, 6); // only first cycle's 6 clicks

const vols = [0.55, 0.55, 0.55, 0.55, 0.6, 0.9];
const adelays = clickMs.map(
  (ms, i) => `[${i + 1}:a]adelay=${Math.round(ms)}|${Math.round(ms)},volume=${vols[i] ?? 0.55}[a${i + 1}]`,
);
const mix = clickMs.map((_, i) => `[a${i + 1}]`).join('') +
  `amix=inputs=${clickMs.length}:normalize=0:duration=longest,apad=whole_dur=${TOTAL_SEC * 1000}ms[aout]`;

const audioInputs = clickMs.map(() => ['-i', 'Select.mp3']).flat();
const muxCmd = [
  'ffmpeg', '-y', '-loglevel', 'error',
  '-i', SILENT_MP4,
  ...audioInputs,
  '-filter_complex', `"${adelays.join(';')};${mix}"`,
  '-map', '0:v', '-map', '"[aout]"',
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k',
  '-t', String(TOTAL_SEC),
  FINAL_MP4,
].join(' ');
execSync(muxCmd, { cwd: SCRATCH, stdio: 'inherit' });

console.log('CLICK_OFFSETS_IN_VIDEO_MS=' + clickMs.join(','));
console.log('FINAL=' + FINAL_MP4);
