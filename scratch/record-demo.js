const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '/Users/chasekellis/Apps/trainercenter/scratch';
const FRAMES_DIR = path.join(SCRATCH, 'video-out', 'frames');

const CAPTURE_DURATION_MS = 13500;
const TARGET_FPS = 30;

(async () => {
  // Clean output dir
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });

  const clickOffsetsMs = [];
  const frameRecords = []; // {seq, captureMs}

  const page = await ctx.newPage();

  // Track click events from the page
  let t0Click = null;
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('CLICK ')) {
      const pageDateNow = parseInt(text.split(' ')[1], 10);
      if (!Number.isFinite(pageDateNow)) return;
      if (t0Click === null) t0Click = pageDateNow; // first click as anchor
      clickOffsetsMs.push(pageDateNow);
    }
  });

  // Use CDP screencast for fast lossless-quality JPEG frames
  const client = await ctx.newCDPSession(page);

  let seq = 0;
  const startCaptureMs = Date.now();
  client.on('Page.screencastFrame', async (frame) => {
    const t = Date.now() - startCaptureMs;
    const outPath = path.join(FRAMES_DIR, `frame_${String(seq).padStart(5, '0')}.jpg`);
    fs.writeFileSync(outPath, Buffer.from(frame.data, 'base64'));
    frameRecords.push({ seq, captureMs: t });
    seq++;
    try { await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch (e) {}
  });

  await page.goto('file://' + path.join(SCRATCH, 'gameboy-trade-night.html'));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  // Start screencast - format jpeg quality 100 ~= lossless visually, every frame
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 100,
    everyNthFrame: 1,
    maxWidth: 1080,
    maxHeight: 1920,
  });

  await page.waitForTimeout(CAPTURE_DURATION_MS);

  await client.send('Page.stopScreencast');
  await ctx.close();
  await browser.close();

  // Anchor: first click. clickOffsets are wall-clock (Date.now). Frames are relative to startCaptureMs.
  // We need to convert click times to be relative to startCaptureMs.
  const captureStartDateNow = startCaptureMs;
  const clicksRelative = clickOffsetsMs.map((d) => d - captureStartDateNow);

  fs.writeFileSync(
    path.join(SCRATCH, 'video-out', 'manifest.json'),
    JSON.stringify({ frames: frameRecords, clicksMs: clicksRelative, fps: TARGET_FPS }, null, 2)
  );

  console.log('FRAMES=' + frameRecords.length);
  console.log('CLICKS_MS=' + JSON.stringify(clicksRelative));
  console.log('FIRST_FRAME_AT=' + frameRecords[0].captureMs + 'ms');
  console.log('LAST_FRAME_AT=' + frameRecords[frameRecords.length - 1].captureMs + 'ms');
})();
