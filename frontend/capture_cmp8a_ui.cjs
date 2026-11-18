const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TARGET_DIR = path.resolve(__dirname, '..', 'artifacts', 'screenshots', 'ui-acceptance-cmp-8a020d00');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runZeroGpuAcceptance() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  console.log('[Zero-GPU UI Acceptance] Target directory:', TARGET_DIR);
  console.log('[Zero-GPU UI Acceptance] Launching Edge headless at 1920x1080...');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[vite]') && !text.includes('React DevTools')) {
      console.log('  [Browser Console]', text);
    }
  });

  // Step 1: Load frontend specifically targeting cmp-8a020d00
  console.log('[Step 1] Loading frontend with ?exp=cmp-8a020d00...');
  await page.goto('http://127.0.0.1:5173/?exp=cmp-8a020d00', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for initial hydration of target campaign
  console.log('  Waiting for campaign hydration...');
  await page.waitForFunction(() => {
    return document.body.innerText.includes('cmp-8a020d00');
  }, { timeout: 20000 }).catch(() => console.warn('  ⚠️ Timeout waiting for cmp-8a020d00 in body'));
  await sleep(2000);

  // Step 2: Tuning Lab View
  console.log('[Step 2] Navigating to Tuning Lab View...');
  const tuningBtn = await page.$('button[title*="Tuning Lab"]');
  if (tuningBtn) {
    await tuningBtn.click();
    await sleep(2000);
  } else {
    console.warn('  ⚠️ Tuning Lab button not found');
  }

  // Ensure candidate data is loaded and select winner 95db015e9de9 if available
  await page.waitForFunction(() => {
    return document.body.innerText.includes('95db015e9de9') || document.body.innerText.includes('95db015e');
  }, { timeout: 15000 }).catch(() => {});

  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div, g'));
    const winnerCard = cards.find(
      (el) => el.innerText && el.innerText.includes('95db015e') && (el.innerText.includes('WINNER') || el.innerText.includes('Winner'))
    );
    if (winnerCard && typeof winnerCard.click === 'function') {
      winnerCard.click();
    }
  }).catch(() => {});
  await sleep(1500);

  const tuningDetails = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasActiveExp: body.includes('cmp-8a020d00'),
      hasWinnerTag: body.includes('WINNER') || body.includes('Winner'),
      hasCandidate95: body.includes('95db015e9de9') || body.includes('95db015e'),
      hasThroughput48: body.includes('48') && body.includes('tok/s'),
    };
  }).catch(() => ({}));
  console.log('  [Tuning Lab Details]:', tuningDetails);

  const path01 = path.join(TARGET_DIR, '01-tuning-lab-winner-95db01.png');
  await page.screenshot({ path: path01, fullPage: false });
  console.log('  ✓ Saved screenshot:', path01);

  // Step 3: Experiments View
  console.log('[Step 3] Navigating to Experiments View...');
  const expBtn = await page.$('button[title*="Experiments"]');
  if (expBtn) {
    await expBtn.click();
    await sleep(2000);
  } else {
    console.warn('  ⚠️ Experiments button not found');
  }

  // Wait for experiments list to populate from /api/experiments
  console.log('  Waiting for experiments list table hydration...');
  await page.waitForFunction(() => {
    return document.querySelectorAll('tbody tr').length > 0;
  }, { timeout: 20000 });
  await sleep(1000);

  // Set the search input via native setter to filter down to cmp-8a020d00
  console.log('  Filtering search term to cmp-8a020d00...');
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="Search run ID"]');
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, 'cmp-8a020d00');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(1500);

  // Find the exact row containing 95db015e9de9 or run-04-cand-95db01
  console.log('  Selecting campaign row to activate scrubber and open SlideOverDrawer...');
  const rowFound = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find(r => 
      (r.innerText && (r.innerText.includes('95db015e') || r.innerText.includes('run-04-cand-95db01') || r.innerText.includes('vllm-live-acceptance')))
    );
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'instant', block: 'center' });
      targetRow.click();
      return true;
    }
    const fallbackRow = rows.find(r => r.innerText && r.innerText.includes('run-04-cand'));
    if (fallbackRow) {
      fallbackRow.scrollIntoView({ behavior: 'instant', block: 'center' });
      fallbackRow.click();
      return true;
    }
    return false;
  });
  console.log('  Target row found and clicked:', rowFound);
  await sleep(2000);

  // Wait for SlideOverDrawer with cmp-8a020d00 details to appear
  await page.waitForFunction(() => {
    const text = document.body.textContent || '';
    return text.includes('cmp-8a020d00') && (text.includes('6 runs') || text.includes('vllm-live-acceptance'));
  }, { timeout: 10000 }).catch(() => console.warn('  ⚠️ Timeout waiting for cmp-8a020d00 drawer'));
  await sleep(1000);

  const expDetails = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      hasCmp8a: body.includes('cmp-8a020d00'),
      hasWinnerCand: body.includes('95db015e9de9') || body.includes('95db015e'),
      hasRun04: body.includes('run-04-cand-95db01'),
      has6Runs: body.includes('6 runs') || body.includes('6 Runs'),
      hasLiveBadge: body.includes('LIVE'),
      hasVerified: body.includes('Verified') || body.includes('VERIFIED'),
    };
  }).catch(() => ({}));
  console.log('  [Experiments View Details]:', expDetails);

  const path02 = path.join(TARGET_DIR, '02-experiments-history-6runs.png');
  await page.screenshot({ path: path02, fullPage: false });
  console.log('  ✓ Saved screenshot:', path02);

  // Close the SlideOverDrawer before navigating to Verification View
  console.log('  Closing SlideOverDrawer...');
  await page.keyboard.press('Escape');
  await sleep(1000);

  // Step 4: Verification View
  console.log('[Step 4] Navigating to Verification View...');
  const verifBtn = await page.$('button[title*="Verification"]');
  if (verifBtn) {
    await verifBtn.click();
    await sleep(2500);
  } else {
    console.warn('  ⚠️ Verification button not found');
  }

  // Wait for verification record to load
  await page.waitForFunction(() => {
    const text = document.body.textContent || '';
    return text.includes('run-verify-69a57759') || text.includes('run-verify');
  }, { timeout: 15000 }).catch(() => {});
  await sleep(1500);

  const verifDetails = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      hasVerifyRunId: body.includes('run-verify-69a57759'),
      hasWinnerCandId: body.includes('95db015e9de9') || body.includes('95db015e'),
      hasVerifiedVerdict: body.includes('VERIFIED') || body.includes('PASSED'),
      hasTtftDrift: body.includes('2,095') || body.includes('20.8') || body.includes('PASS'),
      hasItlDrift: body.includes('19.3') || body.includes('0.3') || body.includes('PASS'),
      hasThroughputDrift: body.includes('48.0 tok/s') || body.includes('48.0'),
    };
  }).catch(() => ({}));
  console.log('  [Verification View Details]:', verifDetails);

  const path03 = path.join(TARGET_DIR, '03-verification-view-verified.png');
  await page.screenshot({ path: path03, fullPage: false });
  console.log('  ✓ Saved screenshot:', path03);

  // Step 5: Reports View
  console.log('[Step 5] Navigating to Reports View...');
  const reportsBtn = await page.$('button[title*="Reports"]');
  if (reportsBtn) {
    await reportsBtn.click();
    await sleep(2500);
  } else {
    console.warn('  ⚠️ Reports button not found');
  }

  // In ReportsView, click the report button for cmp-8a020d00 if available
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cmpBtn = btns.find((b) => b.innerText && b.innerText.includes('cmp-8a020d00'));
    if (cmpBtn) cmpBtn.click();
  }).catch(() => {});
  await sleep(1500);

  const reportDetails = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasCmp8a: body.includes('cmp-8a020d00'),
      hasLiveBadge: body.includes('LIVE'),
      hasVerifPassed: body.includes('INDEPENDENT VERIFICATION PASSED'),
      hasWinnerInReport: body.includes('95db015e9de9'),
    };
  }).catch(() => ({}));
  console.log('  [Reports View Details]:', reportDetails);

  const path04 = path.join(TARGET_DIR, '04-reports-view-cmp-8a020d00.png');
  await page.screenshot({ path: path04, fullPage: false });
  console.log('  ✓ Saved screenshot:', path04);

  // Step 6: Workloads View
  console.log('[Step 6] Navigating to Workloads View...');
  const workloadsBtn = await page.$('button[title*="Workloads"]');
  if (workloadsBtn) {
    await workloadsBtn.click();
    await sleep(2000);
  } else {
    console.warn('  ⚠️ Workloads button not found');
  }

  const path05 = path.join(TARGET_DIR, '05-workloads-view.png');
  await page.screenshot({ path: path05, fullPage: false });
  console.log('  ✓ Saved screenshot:', path05);

  await browser.close();
  console.log('[Zero-GPU UI Acceptance] Completed all views and saved screenshots successfully!');
}

runZeroGpuAcceptance().catch((err) => {
  console.error('[Zero-GPU UI Acceptance Fatal Error]', err);
  process.exit(1);
});
