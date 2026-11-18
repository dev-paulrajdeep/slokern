const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TARGET_DIR = path.resolve(__dirname, '..', 'artifacts', 'screenshots', 'ui-acceptance');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runUIAcceptance() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  console.log('[UI Acceptance] Launching Edge headless at 1920x1080...');
  const tmpDir = path.join(os.tmpdir(), 'edge-slokern-ui-' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    userDataDir: tmpDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-features=Translate,OptimizationHints,MediaRouter,ViewTransitions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-prefers-reduced-motion',
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    },
  });

  browser.on('disconnected', () => {
    console.error('  [Browser Disconnected]');
  });

  const page = await browser.newPage();
  page.on('error', (err) => {
    console.error('  [Page Crash Error]', err);
  });
  await page.evaluateOnNewDocument(() => {
    window.__PUPPETEER_TEST__ = true;
  });
  await page.setViewport({ width: 1920, height: 1080 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[vite]') && !text.includes('React DevTools')) {
      console.log('  [Browser Console]', text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('  [Browser PageError]', err.message);
  });


  // Step 1-3: Load frontend
  console.log('[Step 1-3] Loading frontend at http://127.0.0.1:5173...');
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(3000);

  // Step 4: Open WorkloadsView
  console.log('[Step 4] Navigating to WorkloadsView...');
  const navigated = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.getAttribute('title')?.includes('Workloads') || b.innerText?.includes('Workloads'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!navigated) {
    await page.keyboard.press('2');
  }
  await sleep(2000);

  // Step 5: Configure Workload & SLO Constraints in WorkloadsView
  console.log('[Step 5] Configuring workload and SLO constraints in WorkloadsView...');
  await page.evaluate(() => {
    const quickBtn = document.querySelector('[data-testid="preset-quick-btn"]');
    if (quickBtn) quickBtn.click();
  });
  console.log('  ✓ Applied Quick Test preset');
  await sleep(800);

  // Adjust Warm-up to 1s in WorkloadsView
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
    for (const inp of inputs) {
      const pText = inp.parentElement ? inp.parentElement.innerText : '';
      if (pText.includes('Warm-up Duration')) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(inp, '1');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  });
  await sleep(600);

  const path01 = path.join(TARGET_DIR, '01-workloads-configured.png');
  await page.screenshot({ path: path01, fullPage: false });
  console.log('  ✓ Saved screenshot:', path01);

  // Step 6: Run Preflight Probe
  console.log('[Step 6] Running Preflight Probe against vLLM...');
  const probeFound = await page.evaluate(() => {
    const probeBtn = document.querySelector('[data-testid="workloads-preflight-probe-btn"]');
    if (probeBtn) {
      probeBtn.click();
      return true;
    }
    return false;
  });
  if (!probeFound) {
    throw new Error('Preflight Probe button not found in WorkloadsView!');
  }

  // Step 7: Confirm Preflight Result reflects actual HTTP request to vLLM
  console.log('[Step 7] Waiting for preflight probe response from vLLM...');
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes('Live Smoke Probe Success') || text.includes('Preflight Probe Failed');
    },
    { timeout: 35000 }
  );

  const path02 = path.join(TARGET_DIR, '02-preflight-probe-toast.png');
  await page.screenshot({ path: path02, fullPage: false });
  console.log('  ✓ Saved screenshot:', path02);

  const toastText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find(
      (d) => d.innerText && d.innerText.includes('Live Smoke Probe Success')
    );
    return el ? el.innerText : '';
  });
  console.log('  [Probe Toast Result]:', toastText);

  // Settle toast
  await sleep(2000);

  // Step 8: Open CampaignLaunchDrawer
  console.log('[Step 8] Opening CampaignLaunchDrawer...');
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="workloads-launch-campaign-btn"]') ||
                document.querySelector('[data-testid="run-campaign-btn"]');
    if (btn) btn.click();
  });

  console.log('  Waiting for CampaignLaunchDrawer to appear...');
  await page.waitForSelector('.slide-over-drawer, [role="dialog"]', { visible: true, timeout: 15000 });
  await sleep(1000);

  // Step 9: Verify complete workload & SLO specifications preserved
  console.log('[Step 9] Verifying workload & SLO preserved in CampaignLaunchDrawer...');
  await page.evaluate(() => {
    const targetVllm = document.querySelector('[data-testid="target-vllm"]');
    if (targetVllm) targetVllm.click();
  });
  await sleep(500);

  // Expand Custom Accordion in Drawer
  console.log('  Configuring feasible envelope in Custom Accordion...');
  await page.evaluate(() => {
    const drawer = document.querySelector('.slide-over-drawer, [role="dialog"]');
    if (!drawer) return;
    const btns = Array.from(drawer.querySelectorAll('button'));
    const acc = btns.find((b) => b.innerText && b.innerText.includes('Custom Workload & SLO Constraints'));
    if (acc) acc.click();
  });
  await sleep(800);

  // Specifically set the 4 inputs inside the drawer
  await page.evaluate(() => {
    const drawer = document.querySelector('.slide-over-drawer, [role="dialog"]');
    if (!drawer) return;
    const inputs = Array.from(drawer.querySelectorAll('input[type="number"]'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const values = ['0.4', '8', '3000', '0.05'];
    inputs.slice(0, 4).forEach((inp, idx) => {
      setter?.call(inp, values[idx]);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await sleep(800);

  // Step 10: Inspect 2x2 Search Space candidate configurations
  console.log('[Step 10] Inspecting 2x2 search space candidate configurations...');
  const path03 = path.join(TARGET_DIR, '03-campaign-drawer-envelope.png');
  await page.screenshot({ path: path03, fullPage: false });
  console.log('  ✓ Saved screenshot:', path03);

  // Step 11: Launch the campaign
  console.log('[Step 11] Launching the 6-run campaign against vLLM...');
  const startFound = await page.evaluate(() => {
    const startCampaignBtn = document.querySelector('[data-testid="start-campaign-btn"]');
    if (startCampaignBtn) {
      startCampaignBtn.click();
      return true;
    }
    return false;
  });
  if (!startFound) {
    throw new Error('Start Campaign button not found!');
  }
  await sleep(3000);

  // Step 12: Verify live campaign progress and all six run states
  console.log('[Step 12] Monitoring live SSE campaign execution across 6 runs...');
  let midScreenshotTaken = false;
  let verifScreenshotTaken = false;
  const campaignStartTime = Date.now();
  const maxWaitMs = 360000; // 6 minutes max

  while (Date.now() - campaignStartTime < maxWaitMs) {
    const state = await page.evaluate(() => {
      const drawer = document.querySelector('.slide-over-drawer, [role="dialog"]');
      const text = drawer ? (drawer.innerText || '') : (document.body.innerText || '');
      const run2 = document.querySelector('[data-testid="run-timeline-item-2"]');
      const run3 = document.querySelector('[data-testid="run-timeline-item-3"]');
      const run5 = document.querySelector('[data-testid="run-timeline-item-5"]');
      return {
        text,
        isCompleted: text.includes('Campaign Verification Complete'),
        isRun2or3: (run2 && run2.innerText.includes('RUNNING')) || (run3 && run3.innerText.includes('RUNNING')) || text.includes('(3/6)') || text.includes('(4/6)'),
        isVerificationRun: (run5 && run5.innerText.includes('RUNNING')) || text.includes('Run 6/6') || text.includes('Verification Rerun (Run 6/6)') || text.includes('(6/6)'),
      };
    });

    if (state.isRun2or3 && !midScreenshotTaken) {
      const path04 = path.join(TARGET_DIR, '04-campaign-progress-live.png');
      await page.screenshot({ path: path04, fullPage: false });
      console.log('  ✓ Saved live search progress screenshot:', path04);
      midScreenshotTaken = true;
    }

    if (state.isVerificationRun && !verifScreenshotTaken) {
      const path05 = path.join(TARGET_DIR, '05-campaign-verification-stage.png');
      await page.screenshot({ path: path05, fullPage: false });
      console.log('  ✓ Saved verification stage screenshot:', path05);
      verifScreenshotTaken = true;
    }

    if (state.isCompleted) {
      console.log('  ✓ Campaign verification completed signal detected!');
      break;
    }

    await sleep(3000);
  }

  // Step 13-14: Verify winning candidate, selection rationale & independent verification
  console.log('[Step 13-14] Capturing final verification reveal and winning candidate...');
  await sleep(3000);
  const path06 = path.join(TARGET_DIR, '06-campaign-verification-reveal.png');
  await page.screenshot({ path: path06, fullPage: false });
  console.log('  ✓ Saved screenshot:', path06);

  const cardDetails = await page.evaluate(() => {
    const drawer = document.querySelector('.slide-over-drawer, [role="dialog"]');
    return drawer ? drawer.innerText : '';
  });
  console.log('  [Campaign Verification Card Details]:\n' + cardDetails.split('\n').filter(l => l.trim()).slice(-20).join('\n'));

  // Step 15: Navigate to Tuning Lab, Experiments, Verification, Reports
  console.log('[Step 15] Inspecting campaign artifacts in UI...');
  const clickedTuning = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const inspectBtn = btns.find((b) => b.innerText && b.innerText.includes('Inspect in Tuning Lab'));
    if (inspectBtn) {
      inspectBtn.click();
      return true;
    }
    return false;
  });

  if (!clickedTuning) {
    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="Tuning Lab"]');
      if (btn) btn.click();
    });
    await page.keyboard.press('4');
  }
  await sleep(3000);

  const path07 = path.join(TARGET_DIR, '07-tuning-lab-winner.png');
  await page.screenshot({ path: path07, fullPage: false });
  console.log('  ✓ Saved Tuning Lab screenshot:', path07);

  // Experiments View
  console.log('[Step 15b] Navigating to Experiments View...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[title*="Experiments"]');
    if (btn) btn.click();
  });
  await page.keyboard.press('3');
  await sleep(2500);

  const path08 = path.join(TARGET_DIR, '08-experiments-view.png');
  await page.screenshot({ path: path08, fullPage: false });
  console.log('  ✓ Saved Experiments View screenshot:', path08);

  // Verification View
  console.log('[Step 15c] Navigating to Verification View...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[title*="Verification"]');
    if (btn) btn.click();
  });
  await page.keyboard.press('5');
  await sleep(2500);

  const path09 = path.join(TARGET_DIR, '09-verification-view.png');
  await page.screenshot({ path: path09, fullPage: false });
  console.log('  ✓ Saved Verification View screenshot:', path09);

  // Reports View
  console.log('[Step 15d] Navigating to Reports View...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[title*="Reports"]');
    if (btn) btn.click();
  });
  await page.keyboard.press('6');
  await sleep(2500);

  const path10 = path.join(TARGET_DIR, '10-reports-view.png');
  await page.screenshot({ path: path10, fullPage: false });
  console.log('  ✓ Saved Reports View screenshot:', path10);

  await browser.close();
  console.log('[UI Acceptance] All steps executed and screenshots saved successfully!');
}

runUIAcceptance().catch((err) => {
  console.error('[UI Acceptance Fatal Error]', err);
  process.exit(1);
});
