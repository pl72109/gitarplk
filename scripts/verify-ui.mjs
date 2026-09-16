/**
 * End-to-end smoke test of the AlphaTab integration in a real browser.
 * Run with: node scripts/verify-ui.mjs   (server must be running on :3000)
 *
 * The seeded catalogue is gear-only - every entry has a rig but no score - so
 * this test POSTs its own throwaway song (a plain alphaTex scale exercise) to
 * have something to render, and deletes it again at the end. That also keeps
 * the test independent of whatever is in data/songs.json.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/* ------------------------------------------------------------------ *
 * Fixture: a throwaway song with a real score attached.
 * An ascending scale, written by hand - no copyrighted material.
 * ------------------------------------------------------------------ */

const FIXTURE = {
  title: `Verify Fixture ${Date.now()}`,
  artist: 'GITARPLK Test Harness',
  bpm: 120,
  difficulty: 'Beginner',
  tuning: 'Standard (E A D G B E)',
  tuningPitches: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
  capo: 0,
  rig: {
    preset: 'Test Preset',
    guitar: 'Test Guitar',
    amp: { model: 'Test Amp', settings: { Gain: 7, Bass: 6, Mid: 4, Treble: 8 } },
    cab: 'Test 4x12',
    pedals: [{ model: 'Test Overdrive', type: 'Overdrive', settings: { Drive: '6' } }],
    notes: 'Fixture created by verify-ui.mjs.',
  },
  source: {
    format: 'alphatex',
    data: '\\title "Scale Exercise"\n\\tempo 120\n.\n0.6.4 2.6.4 3.6.4 5.6.4 | 0.5.4 2.5.4 3.5.4 5.5.4 |\n0.4.4 2.4.4 3.4.4 5.4.4 | 0.3.4 2.3.4 4.3.4 5.3.4 |',
  },
};

const created = await fetch(`${BASE}/api/songs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(FIXTURE),
}).then((r) => r.json());

check('fixture song created via API', Boolean(created.id), `id=${created.id}`);

const browser = await chromium.launch();
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

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- 1. AlphaTab global loaded -------------------------------------
  check('alphaTab global is available', await page.evaluate(() => typeof alphaTab !== 'undefined'));

  // --- 2. Song list populated ----------------------------------------
  await page.waitForSelector('#song-list li', { timeout: 10000 });
  const songCount = await page.locator('#song-list li').count();
  check('song list renders', songCount > 0, `${songCount} songs`);

  // --- 3. Artist filter chips ----------------------------------------
  const chipCount = await page.locator('.artist-chip').count();
  check('artist filter chips render', chipCount > 1, `${chipCount} chips`);

  // --- 4. Rig-only entries show the no-score state --------------------
  const rigOnly = page.locator('#song-list li', { has: page.locator('.badge-needs-score') }).first();
  if (await rigOnly.count()) {
    await rigOnly.click();
    await page.waitForTimeout(400);
    const noScore = await page.evaluate(() => ({
      shown: !document.querySelector('#no-score-state').classList.contains('hidden'),
      viewportHidden: document.querySelector('#tab-viewport').classList.contains('hidden'),
      amp: document.querySelector('#rig-amp-title').textContent,
      knobs: document.querySelectorAll('#rig-amp-knobs .knob-unit').length,
    }));
    check('rig-only song shows the no-score state', noScore.shown && noScore.viewportHidden);
    check('rig-only song still shows its rig', noScore.knobs > 0, `amp="${noScore.amp}", ${noScore.knobs} knobs`);
  } else {
    check('rig-only song shows the no-score state', false, 'no needs-score entry found');
  }

  // --- 5. Select the fixture and wait for AlphaTab to render ----------
  await page.fill('#song-search', FIXTURE.title);
  await page.waitForTimeout(300);
  await page.locator('#song-list li').first().click();

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

  // --- 6. SoundFont loads and player becomes ready --------------------
  await page.waitForFunction(() => document.querySelector('#tp-status').textContent === 'Ready', {
    timeout: 60000,
  });
  check('player reports ready (SoundFont decoded)', true);
  check('play button enabled', !(await page.locator('#tp-play-pause').isDisabled()));

  // --- 7. Mixer is guitar-only ----------------------------------------
  const mixerRows = await page.locator('.mixer-row').count();
  const mixerCount = await page.locator('#mixer-count').textContent();
  check('mixer lists the guitar track', mixerRows === 1, `${mixerRows} rows, label "${mixerCount}"`);
  check('mixer label says guitar', /guitar/i.test(mixerCount), mixerCount);

  const trackNames = await page.locator('.mx-name').allTextContents();
  check('track names populated', trackNames.every(Boolean), trackNames.join(', '));
  check(
    'no bass or drum track in the mixer',
    !trackNames.some((n) => /bass|drum|percussion/i.test(n)),
    trackNames.join(', ')
  );

  // --- 8. Playback actually advances ---------------------------------
  await page.locator('#tp-play-pause').click();
  await page.waitForTimeout(2500);

  const afterPlay = await page.evaluate(() => ({
    status: document.querySelector('#tp-status').textContent,
    time: document.querySelector('#tp-time-current').textContent,
    total: document.querySelector('#tp-time-total').textContent,
    fill: document.querySelector('#tp-progress-fill').style.width,
  }));
  check('playback state is Playing', afterPlay.status === 'Playing', afterPlay.status);
  check('position clock advances', afterPlay.time !== '0:00', `${afterPlay.time} / ${afterPlay.total}`);
  check('progress bar fills', parseFloat(afterPlay.fill) > 0, `width=${afterPlay.fill}`);

  // --- 9. Cursor is drawn ---------------------------------------------
  const cursor = await page.evaluate(() => ({
    hasBar: !!document.querySelector('.at-cursor-bar'),
    hasBeat: !!document.querySelector('.at-cursor-beat'),
  }));
  check('bar cursor present', cursor.hasBar);
  check('beat cursor present', cursor.hasBeat);

  // --- 10. Pause -------------------------------------------------------
  await page.locator('#tp-play-pause').click();
  await page.waitForTimeout(600);
  check('pause works', (await page.locator('#tp-status').textContent()) === 'Paused');

  // --- 11. Speed control ------------------------------------------------
  await page.locator('#tp-speed').fill('75');
  await page.dispatchEvent('#tp-speed', 'input');
  const speed = await page.evaluate(() => document.querySelector('#tp-speed-label').textContent);
  check('speed control updates', speed === '75%', speed);

  // --- 12. Zoom re-renders ---------------------------------------------
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

  // --- 13. Stop ---------------------------------------------------------
  await page.locator('#tp-stop').click();
  await page.waitForTimeout(600);
  const stopped = await page.evaluate(() => document.querySelector('#tp-time-current').textContent);
  check('stop rewinds to start', stopped === '0:00', `time=${stopped}`);

  /* ---------------------------------------------------------------- *
   * Add Song dashboard
   * ---------------------------------------------------------------- */

  await page.locator('#btn-open-modal').click();
  await page.waitForTimeout(300);
  check('add-song modal opens', !(await page.locator('#add-song-modal').evaluate((el) => el.classList.contains('hidden'))));

  // No instrument picker may exist - the app is guitar-only.
  check(
    'no Guitar/Bass instrument picker exists',
    (await page.locator('#new-instrument').count()) === 0
  );

  const tuningOptions = await page.locator('#new-tuning option').allTextContents();
  check('tuning list is populated', tuningOptions.length > 5, `${tuningOptions.length} tunings`);
  check(
    'tuning list has no 4-string bass tuning',
    !tuningOptions.some((t) => /bass/i.test(t)),
    tuningOptions.slice(0, 3).join(' | ')
  );

  const ampKnobs = await page.locator('#amp-knobs .knob-control').count();
  check('amp knob sliders render', ampKnobs >= 4, `${ampKnobs} knobs`);

  // Step navigation
  await page.locator('.step-item[data-tab="tab-rig"]').click();
  await page.waitForTimeout(200);
  check(
    'step rail switches panes',
    await page.locator('#tab-rig').evaluate((el) => el.classList.contains('active'))
  );

  // Pedal picker adds a pedal to the chain and the live preview.
  await page.fill('#pedal-search', 'RAT');
  await page.waitForTimeout(300);
  const suggestions = await page.locator('.pedal-suggestion').count();
  check('pedal search suggests matches', suggestions > 0, `${suggestions} suggestions`);

  if (suggestions > 0) {
    await page.locator('.pedal-suggestion').first().click();
    await page.waitForTimeout(300);
    const chainCards = await page.locator('.pedal-card').count();
    const previewPedals = await page.locator('#pv-pedals .pedal-row').count();
    check('pedal added to the chain', chainCards === 1, `${chainCards} cards`);
    check('live preview reflects the pedal', previewPedals === 1, `${previewPedals} in preview`);
  }

  // Amp slider drives the live preview.
  await page.locator('#amp-knobs input[type="range"]').first().fill('9');
  await page.dispatchEvent('#amp-knobs input[type="range"]', 'input');
  await page.waitForTimeout(200);
  const previewKnobs = await page.locator('#pv-knobs .knob-unit').count();
  check('live preview shows amp knobs', previewKnobs >= 4, `${previewKnobs} knobs`);

  // Validation: saving with no artist/title must not silently succeed.
  await page.locator('#btn-submit-song').click();
  await page.waitForTimeout(400);
  const errorShown = await page
    .locator('#form-error')
    .evaluate((el) => !el.classList.contains('hidden'));
  check('empty form shows a validation error', errorShown);

  await page.locator('#btn-close-modal').click();

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
} finally {
  await browser.close();
  // Always clean the fixture up, even if an assertion threw.
  if (created.id) {
    await fetch(`${BASE}/api/songs/${created.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
