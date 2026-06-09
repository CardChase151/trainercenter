const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIR = '/Users/chasekellis/Apps/trainercenter/scratch/1';
const FPS = 30;
const DUR = 32.0;
const N = Math.round(FPS * DUR);

// optional: node capture.js preview  -> only renders a handful of key frames
const PREVIEW = process.argv[2] === 'preview';
const previewTimes = [0.6, 2.4, 5.0, 8.5, 15.0, 24.5, 32.0, 34.0, 40.5, 43.5, 47.2, 49.5];

(async () => {
  const outDir = path.join(DIR, PREVIEW ? 'preview' : 'frames');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({
    viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,
  }).then(c => c.newPage());

  await page.goto('file://' + path.join(DIR, 'render.html'));
  await page.waitForFunction('window.__ready === true');
  await page.evaluate(() => document.fonts.ready);

  if (PREVIEW) {
    for (let i = 0; i < previewTimes.length; i++) {
      const t = previewTimes[i];
      await page.evaluate((tt) => window.render(tt), t);
      await page.screenshot({ path: path.join(outDir, `p_${String(i).padStart(2,'0')}_t${t}.jpg`), type: 'jpeg', quality: 90 });
    }
    console.log('PREVIEW_DONE ' + previewTimes.length);
  } else {
    const t0 = Date.now();
    for (let f = 0; f < N; f++) {
      const t = f / FPS;
      await page.evaluate((tt) => window.render(tt), t);
      await page.screenshot({ path: path.join(outDir, `f_${String(f).padStart(5,'0')}.jpg`), type: 'jpeg', quality: 92 });
      if (f % 60 === 0) console.log(`frame ${f}/${N}  ${((Date.now()-t0)/1000).toFixed(1)}s`);
    }
    console.log('DONE ' + N + ' frames in ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  }
  await browser.close();
})();
