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
  await sleep(3500);

  // Step 2: Tuning Lab View
  console.log('[Step 2] Navigating to Tuning Lab View...');
  const tuningBtn = await page.$('button[title*="Tuning Lab"]');
  if (tuningBtn) {
    await tuningBtn.click();
    await sleep(2500);
  } else {
    console.warn('  ⚠️ Tuning Lab button not found');
  }

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
    await sleep(2500);
  } else {
    console.warn('  ⚠️ Experiments button not found');
  }

  const expDetails = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasBaseline: body.includes('run-00-baseline') || body.includes('e52525257b48'),
      hasCand1: body.includes('run-01-cand') || body.includes('09618034778e'),
      hasCand2: body.includes('run-02-cand') || body.includes('fe984b310e35'),
      hasCand3: body.includes('run-03-cand') || body.includes('b2e1f07e45ad'),
      hasCand4: body.includes('run-04-cand') || body.includes('95db015e9de9'),
      hasVerify: body.includes('run-verify-69a57759'),
      hasInconclusive: body.includes('INCONCLUSIVE'),
      hasInfeasible: body.includes('INFEASIBLE'),
      hasFeasible: body.includes('FEASIBLE'),
    };
  }).catch(() => ({}));
  console.log('  [Experiments View Details]:', expDetails);

  const path02 = path.join(TARGET_DIR, '02-experiments-history-6runs.png');
  await page.screenshot({ path: path02, fullPage: false });
  console.log('  ✓ Saved screenshot:', path02);

  // Step 4: Verification View
  console.log('[Step 4] Navigating to Verification View...');
  const verifBtn = await page.$('button[title*="Verification"]');
  if (verifBtn) {
    await verifBtn.click();
    await sleep(2500);
  } else {
    console.warn('  ⚠️ Verification button not found');
  }

  const verifDetails = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasVerifyRunId: body.includes('run-verify-69a57759'),
      hasWinnerCandId: body.includes('95db015e9de9') || body.includes('95db015e'),
      hasVerifiedVerdict: body.includes('VERIFIED') || body.includes('PASSED'),
      hasTtftDrift: body.includes('-0.99') || body.includes('-1.0'),
      hasItlDrift: body.includes('-1.57') || body.includes('-1.6'),
      hasThroughputDrift: body.includes('0.0%') || body.includes('0.0'),
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
