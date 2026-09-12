/**
 * End-to-end smoke test of the AlphaTab integration in a real browser.
 * Run with: node scripts/verify-ui.mjs   (server must be running on :3000)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch();
// Fake audio device so AlphaSynth can start without real hardware.
const context = await browser.newContext({
  permissions: [],
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

// --- 1. AlphaTab global loaded -------------------------------------
check('alphaTab global is available', await page.evaluate(() => typeof alphaTab !== 'undefined'));

// --- 2. Song list populated ----------------------------------------
await page.waitForSelector('#song-list li', { timeout: 10000 });
const songCount = await page.locator('#song-list li').count();
check('song list renders', songCount === 2, `${songCount} songs`);

// --- 3. Select a song and wait for AlphaTab to render --------------
await page.locator('#song-list li').first().click();

// AlphaTab draws into <canvas>/<svg> inside the render surface.
await page.waitForFunction(
  () => {
    const el = document.querySelector('#alphatab-surface');
    return el && el.querySelectorAll('canvas, svg').length > 0;
  },
  { timeout: 30000 }
);
const surfaceInfo = await page.evaluate(() => {
  const el = document.querySelector('#alphatab-surface');
  return {
    children: el.querySelectorAll('canvas, svg').length,
    height: el.getBoundingClientRect().height,
    width: el.getBoundingClientRect().width,
  };
});
check(
  'score renders to canvas/svg',
  surfaceInfo.children > 0 && surfaceInfo.height > 100,
  `${surfaceInfo.children} surfaces, ${Math.round(surfaceInfo.width)}x${Math.round(surfaceInfo.height)}px`
);

// --- 4. SoundFont loads and player becomes ready --------------------
await page.waitForFunction(() => document.querySelector('#tp-status').textContent === 'Ready', {
  timeout: 60000,
});
check('player reports ready (SoundFont decoded)', true);
check('play button enabled', !(await page.locator('#tp-play-pause').isDisabled()));

// --- 5. Mixer built from score tracks ------------------------------
const mixerRows = await page.locator('.mixer-row').count();
const mixerCount = await page.locator('#mixer-count').textContent();
check('mixer lists both tracks', mixerRows === 2, `${mixerRows} rows, label "${mixerCount}"`);
const trackNames = await page.locator('.mx-name').allTextContents();
check('track names populated', trackNames.every(Boolean), trackNames.join(', '));

// --- 6. Playback actually advances ---------------------------------
await page.locator('#tp-play-pause').click();
await page.waitForTimeout(2500);

const afterPlay = await page.evaluate(() => ({
  status: document.querySelector('#tp-status').textContent,
  time: document.querySelector('#tp-time-current').textContent,
  total: document.querySelector('#tp-time-total').textContent,
  fill: document.querySelector('#tp-progress-fill').style.width,
  progress: document.querySelector('#tp-progress').value,
}));
check('playback state is Playing', afterPlay.status === 'Playing', afterPlay.status);
check('position clock advances', afterPlay.time !== '0:00', `${afterPlay.time} / ${afterPlay.total}`);
check(
  'progress bar fills',
  parseFloat(afterPlay.fill) > 0,
  `width=${afterPlay.fill}, range=${afterPlay.progress}`
);

// --- 7. Cursor is drawn and moving ---------------------------------
const cursor = await page.evaluate(() => {
  const bar = document.querySelector('.at-cursor-bar');
  const beat = document.querySelector('.at-cursor-beat');
  return {
    hasBar: !!bar,
    hasBeat: !!beat,
    beatLeft: beat ? beat.style.left || getComputedStyle(beat).left : null,
  };
});
check('bar cursor present', cursor.hasBar);
check('beat cursor present', cursor.hasBeat, `left=${cursor.beatLeft}`);

// --- 8. Pause -------------------------------------------------------
await page.locator('#tp-play-pause').click();
await page.waitForTimeout(600);
check(
  'pause works',
  (await page.locator('#tp-status').textContent()) === 'Paused',
  await page.locator('#tp-status').textContent()
);

// --- 9. Speed control ------------------------------------------------
await page.locator('#tp-speed').fill('75');
await page.dispatchEvent('#tp-speed', 'input');
const speed = await page.evaluate(() => document.querySelector('#tp-speed-label').textContent);
check('speed control updates', speed === '75%', speed);

// --- 10. Zoom re-renders ---------------------------------------------
const beforeZoom = await page.evaluate(
  () => document.querySelector('#alphatab-surface').getBoundingClientRect().height
);
await page.locator('#tp-zoom-in').click();
await page.waitForTimeout(2500);
const afterZoom = await page.evaluate(() => ({
  height: document.querySelector('#alphatab-surface').getBoundingClientRect().height,
  label: document.querySelector('#tp-zoom-label').textContent,
}));
check(
  'zoom in re-renders larger',
  afterZoom.height > beforeZoom,
  `${Math.round(beforeZoom)}px -> ${Math.round(afterZoom.height)}px, label ${afterZoom.label}`
);

// --- 11. Mute / solo --------------------------------------------------
await page.locator('.mixer-row').nth(1).locator('.mx-solo').click();
await page.waitForTimeout(300);
const soloState = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.mixer-row')];
  return rows.map((r) => ({
    solo: r.querySelector('.mx-solo').classList.contains('active'),
    silent: r.classList.contains('is-silent'),
  }));
});
check(
  'solo silences the other track',
  soloState[1].solo && soloState[0].silent && !soloState[1].silent,
  JSON.stringify(soloState)
);

// --- 12. Track visibility toggle -------------------------------------
await page.locator('.mixer-row').nth(1).locator('.mx-visible').click();
await page.waitForTimeout(2000);
check(
  'hiding a track re-renders the score',
  await page.evaluate(() => document.querySelectorAll('#alphatab-surface canvas, #alphatab-surface svg').length > 0)
);

// --- 13. Stop ---------------------------------------------------------
await page.locator('#tp-stop').click();
await page.waitForTimeout(600);
const stopped = await page.evaluate(() => ({
  time: document.querySelector('#tp-time-current').textContent,
  fill: document.querySelector('#tp-progress-fill').style.width,
}));
check('stop rewinds to start', stopped.time === '0:00', `time=${stopped.time} fill=${stopped.fill}`);

// --- 14. Responsive reflow -------------------------------------------
await page.setViewportSize({ width: 800, height: 800 });
await page.waitForTimeout(2500);
check(
  'score reflows to narrow viewport',
  await page.evaluate(() => {
    const surface = document.querySelector('#alphatab-surface');
    const viewport = document.querySelector('#tab-viewport');
    return surface.getBoundingClientRect().width <= viewport.getBoundingClientRect().width + 2;
  })
);

await page.screenshot({ path: 'scripts/screenshot.png', fullPage: false });

// --- 15. No console errors -------------------------------------------
const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
