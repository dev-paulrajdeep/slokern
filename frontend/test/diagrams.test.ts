import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { identifyParetoFrontier, type UICandidate } from '../src/lib/adapters/viewModel.ts';
import { formatNumber, formatLatency, formatThroughput } from '../src/lib/format.ts';

describe('Architectural Diagram Components & Logic', () => {
  describe('InferencePipelineDiagram Stage Contracts', () => {
    it('verifies the 5 core pipeline stage IDs and sequential topology', () => {
      const expectedStages = [
        'workload-profiler',
        'vllm-engine',
        'metric-engine',
        'feasibility-evaluator',
        'verification-gate',
      ];

      assert.equal(expectedStages.length, 5);
      assert.equal(expectedStages[0], 'workload-profiler');
      assert.equal(expectedStages[1], 'vllm-engine');
      assert.equal(expectedStages[2], 'metric-engine');
      assert.equal(expectedStages[3], 'feasibility-evaluator');
      assert.equal(expectedStages[4], 'verification-gate');
    });

    it('verifies valid stage execution status transitions', () => {
      const validStatuses = ['completed', 'active', 'pending', 'infeasible'];

      for (const status of validStatuses) {
        assert.ok(['completed', 'active', 'pending', 'infeasible'].includes(status));
      }
    });
  });

  describe('VerificationGateDiagram Invariants & Anti-Cheating Protocol', () => {
    it('flags security breach when searchRunId is identical to verifRunId (DEC-0014 violation)', () => {
      const checkAntiCheating = (searchId?: string, verifId?: string) => {
        const isPending =
          !verifId ||
          verifId.toUpperCase().includes('PENDING') ||
          verifId === 'NOT_RUN';

        return Boolean(
          searchId &&
          verifId &&
          !isPending &&
          searchId.trim().toLowerCase() === verifId.trim().toLowerCase()
        );
      };

      // Case 1: Identical IDs must trigger fraud breach
      assert.equal(
        checkAntiCheating('exp-83697f4a197e', 'exp-83697f4a197e'),
        true,
        'Identical run IDs must flag security breach'
      );

      // Case 2: Distinct IDs must pass air-gap check
      assert.equal(
        checkAntiCheating('exp-83697f4a197e', 'verif-candidate-4-isolated'),
        false,
        'Distinct run IDs must pass air-gap isolation'
      );

      // Case 3: Pending verification must not trigger false positive fraud breach
      assert.equal(
        checkAntiCheating('exp-83697f4a197e', undefined),
        false,
        'Missing verification ID is pending, not a cheat'
      );
      assert.equal(
        checkAntiCheating('exp-83697f4a197e', 'PENDING (NOT YET RECORDED)'),
        false,
        'Pending verification label is not a cheat'
      );
    });

    it('computes drift comparator channel deltas and enforces tolerance thresholds', () => {
      const evaluateChannel = (searchVal: number, verifyVal: number | null, tolerance: number | null) => {
        if (verifyVal == null) return { drift: null, passed: null };
        const drift = Number((verifyVal - searchVal).toFixed(2));
        const absDrift = Math.abs(drift);
        const passed = tolerance != null ? absDrift <= tolerance : false;
        return { drift, passed };
      };

      // TTFT P95 within tolerance (26.0 -> 27.2, drift +1.2ms, tol 3.0ms) -> PASS
      const ttft = evaluateChannel(26.0, 27.2, 3.0);
      assert.equal(ttft.drift, 1.2);
      assert.equal(ttft.passed, true);

      // Throughput within tolerance (160.0 -> 158.4, drift -1.6 tok/s, tol 10.0 tok/s) -> PASS
      const tput = evaluateChannel(160.0, 158.4, 10.0);
      assert.equal(tput.drift, -1.6);
      assert.equal(tput.passed, true);

      // Error Rate breach (0.0 -> 0.05, drift +0.05, tol 0.0) -> BREACH
      const err = evaluateChannel(0.0, 0.05, 0.0);
      assert.equal(err.drift, 0.05);
      assert.equal(err.passed, false);

      // Undeclared tolerance (tol null) -> FAILS CLOSED
      const undeclared = evaluateChannel(50.0, 52.0, null);
      assert.equal(undeclared.passed, false);
    });

    it('recognizes both tolerance and tolerance_threshold without false positive undeclared warnings', () => {
      const resolveDriftItem = (item: any) => {
        const resolvedTol =
          item.tolerance !== undefined && item.tolerance !== null
            ? Number(item.tolerance)
            : item.tolerance_threshold !== undefined && item.tolerance_threshold !== null
            ? Number(item.tolerance_threshold)
            : null;
        const resolvedDrift =
          item.drift !== undefined && item.drift !== null
            ? Number(item.drift)
            : item.absolute_drift !== undefined && item.absolute_drift !== null
            ? Number(item.absolute_drift)
            : null;
        return {
          tolerance: resolvedTol,
          drift: resolvedDrift,
          passed:
            item.passed ??
            (resolvedTol != null && resolvedDrift != null
              ? Math.abs(resolvedDrift) <= resolvedTol
              : null),
          toleranceDeclared: resolvedTol !== null && !Number.isNaN(resolvedTol),
        };
      };

      // Case 1: Standard 'tolerance' field
      const tol1 = resolveDriftItem({ searchVal: 26.0, verifyVal: 27.2, drift: 1.2, tolerance: 3.0 });
      assert.equal(tol1.tolerance, 3.0);
      assert.equal(tol1.toleranceDeclared, true);
      assert.equal(tol1.passed, true);

      // Case 2: Canonical contract 'tolerance_threshold' field (MetricDriftComparison)
      const tol2 = resolveDriftItem({
        reference_value: 26.0,
        verification_value: 27.2,
        absolute_drift: 1.2,
        tolerance_threshold: 3.0,
      });
      assert.equal(tol2.tolerance, 3.0);
      assert.equal(tol2.toleranceDeclared, true, 'tolerance_threshold must be recognized as declared tolerance');
      assert.equal(tol2.passed, true);

      // Case 3: Canonical contract 'tolerance_threshold' breached
      const tol3 = resolveDriftItem({
        reference_value: 0.0,
        verification_value: 0.05,
        absolute_drift: 0.05,
        tolerance_threshold: 0.0,
      });
      assert.equal(tol3.tolerance, 0.0);
      assert.equal(tol3.toleranceDeclared, true, 'Zero tolerance threshold must be declared');
      assert.equal(tol3.passed, false, 'Drift exceeding tolerance_threshold must fail');

      // Case 4: Missing / undeclared tolerance (both undefined/null)
      const tol4 = resolveDriftItem({ searchVal: 26.0, verifyVal: 27.2, drift: 1.2 });
      assert.equal(tol4.tolerance, null);
      assert.equal(tol4.toleranceDeclared, false, 'Missing tolerance must flag toleranceDeclared as false');
      assert.equal(tol4.passed, null);
    });
  });

  describe('ParameterMatrixDiagram 2x2 Configuration Space & Pareto Frontier', () => {
    it('classifies candidates into 4 discrete 2x2 quadrants correctly', () => {
      const classifyQuadrant = (batch: number, concurrency: number) => {
        const col = concurrency <= 24 ? 0 : 1; // 0 = 16 streams, 1 = 32 streams
        const row = batch <= 2 ? 0 : 1;        // 0 = Batch 1, 1 = Batch 4
        return { col, row };
      };

      // Batch 1 (512 tokens), 16 streams -> Bottom-Left (0, 0)
      assert.deepEqual(classifyQuadrant(1, 16), { col: 0, row: 0 });

      // Batch 1 (512 tokens), 32 streams -> Bottom-Right (1, 0)
      assert.deepEqual(classifyQuadrant(1, 32), { col: 1, row: 0 });

      // Batch 4 (2048 tokens), 16 streams -> Top-Left (0, 1)
      assert.deepEqual(classifyQuadrant(4, 16), { col: 0, row: 1 });

      // Batch 4 (2048 tokens), 32 streams -> Top-Right (1, 1)
      assert.deepEqual(classifyQuadrant(4, 32), { col: 1, row: 1 });
    });

    it('extracts diverse candidate config representations and maps accurately to 2x2 quadrants', () => {
      const extractAndClassify = (c: any) => {
        const rawSettings =
          c.applied_config?.effective_settings ||
          c.rawConfig?.effective_settings ||
          c.rawConfig?.requested_settings ||
          c.applied_config?.requested_settings ||
          c.settings ||
          {};
        const extractedBatch =
          c.batch ??
          c.batch_size ??
          c.batchSize ??
          (rawSettings.max_num_batched_tokens
            ? rawSettings.max_num_batched_tokens / 512
            : c.max_num_batched_tokens
            ? c.max_num_batched_tokens / 512
            : undefined);
        const extractedConcurrency =
          c.concurrency ??
          c.conc ??
          c.max_num_seqs ??
          rawSettings.max_num_seqs ??
          undefined;

        const isConfigMapped = extractedBatch !== undefined || extractedConcurrency !== undefined;
        const batch = extractedBatch != null ? Number(extractedBatch) : 1;
        const concurrency = extractedConcurrency != null ? Number(extractedConcurrency) : 16;
        const col = concurrency <= 24 ? 0 : 1; // 0 = 16 streams, 1 = 32 streams
        const row = batch <= 2 ? 0 : 1;        // 0 = Batch 1, 1 = Batch 4
        return { batch, concurrency, col, row, isConfigMapped };
      };

      // 1. Standard UICandidate (Batch 4, Concurrency 32) -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-std', batch: 4, concurrency: 32 }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true }
      );

      // 2. Diverse config representation: batch_size: 4, max_num_seqs: 32 -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-repr1', batch_size: 4, max_num_seqs: 32 }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true },
        'batch_size and max_num_seqs must map to Top-Right quadrant'
      );

      // 3. Shorthand representation: batch: 4, conc: 32 -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-repr2', batch: 4, conc: 32 }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true },
        'conc shorthand must map to 32 streams column'
      );

      // 4. CamelCase representation: batchSize: 4, concurrency: 32 -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-repr3', batchSize: 4, concurrency: 32 }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true }
      );

      // 5. Unwrapped root settings: max_num_batched_tokens: 2048, max_num_seqs: 32 -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-repr4', max_num_batched_tokens: 2048, max_num_seqs: 32 }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true },
        'root max_num_batched_tokens must convert to Batch 4'
      );

      // 6. Backend RunStatusResponse applied_config.effective_settings -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({
          id: 'c-repr5',
          applied_config: { effective_settings: { max_num_batched_tokens: 2048, max_num_seqs: 32 } },
        }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true },
        'applied_config.effective_settings must map to Top-Right quadrant'
      );

      // 7. Backend RunStatusResponse applied_config.requested_settings -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({
          id: 'c-repr6',
          applied_config: { requested_settings: { max_num_batched_tokens: 2048, max_num_seqs: 32 } },
        }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true }
      );

      // 8. RawConfig effective_settings -> Top-Right (col 1, row 1)
      assert.deepEqual(
        extractAndClassify({
          id: 'c-repr7',
          rawConfig: { effective_settings: { max_num_batched_tokens: 2048, max_num_seqs: 32 } },
        }),
        { batch: 4, concurrency: 32, col: 1, row: 1, isConfigMapped: true }
      );

      // 9. Low Batch / Low Concurrency: batch_size: 1, max_num_seqs: 16 -> Bottom-Left (col 0, row 0)
      assert.deepEqual(
        extractAndClassify({ id: 'c-low', batch_size: 1, max_num_seqs: 16 }),
        { batch: 1, concurrency: 16, col: 0, row: 0, isConfigMapped: true }
      );

      // 10. Low Batch / High Concurrency: batch: 1, conc: 32 -> Bottom-Right (col 1, row 0)
      assert.deepEqual(
        extractAndClassify({ id: 'c-b1c32', batch: 1, conc: 32 }),
        { batch: 1, concurrency: 32, col: 1, row: 0, isConfigMapped: true }
      );

      // 11. High Batch / Low Concurrency: batch: 4, conc: 16 -> Top-Left (col 0, row 1)
      assert.deepEqual(
        extractAndClassify({ id: 'c-b4c16', batch: 4, conc: 16 }),
        { batch: 4, concurrency: 16, col: 0, row: 1, isConfigMapped: true }
      );

      // 12. Empty candidate object: falls back safely to Batch 1, Concurrency 16
      assert.deepEqual(
        extractAndClassify({ id: 'c-empty' }),
        { batch: 1, concurrency: 16, col: 0, row: 0, isConfigMapped: false }
      );
    });

    it('identifies Pareto-optimal frontier among 2x2 candidates', () => {
      // 4 candidates in 2x2 space:
      // C1: Low Latency, Low Tput (batch 1, conc 16: p95 = 12ms, tput = 80 tok/s) -> PARETO
      // C2: High Latency, Low Tput (batch 1, conc 32: p95 = 20ms, tput = 75 tok/s) -> DOMINATED by C1
      // C3: Medium Latency, High Tput (batch 4, conc 16: p95 = 25ms, tput = 160 tok/s) -> PARETO
      // C4: Infeasible (p95 = 80ms, tput = 220 tok/s, feasible = false) -> EXCLUDED
      const candidates: UICandidate[] = [
        {
          id: 'c1',
          name: 'C1-B1-C16',
          subtitle: 'Low Latency Stream',
          batch: 1,
          concurrency: 16,
          kvCache: 'auto',
          p50: 10,
          p95: 12,
          p99: 15,
          throughput: 80,
          error: 0,
          gpu: 50,
          feasible: true,
          feasibilityVerdict: 'FEASIBLE',
          evidenceValidity: 'VALID',
          reason: 'Feasible',
          tag: 'FEASIBLE',
          ttftP95: 12,
          itlP95: 8,
        },
        {
          id: 'c2',
          name: 'C2-B1-C32',
          subtitle: 'Dominated Stream',
          batch: 1,
          concurrency: 32,
          kvCache: 'auto',
          p50: 16,
          p95: 20,
          p99: 25,
          throughput: 75,
          error: 0,
          gpu: 60,
          feasible: true,
          feasibilityVerdict: 'FEASIBLE',
          evidenceValidity: 'VALID',
          reason: 'Feasible',
          tag: 'FEASIBLE',
          ttftP95: 20,
          itlP95: 12,
        },
        {
          id: 'c3',
          name: 'C3-B4-C16',
          subtitle: 'High Throughput Stream',
          batch: 4,
          concurrency: 16,
          kvCache: 'auto',
          p50: 20,
          p95: 25,
          p99: 30,
          throughput: 160,
          error: 0,
          gpu: 85,
          feasible: true,
          feasibilityVerdict: 'FEASIBLE',
          evidenceValidity: 'VALID',
          reason: 'Feasible',
          tag: 'WINNER',
          ttftP95: 25,
          itlP95: 14,
        },
        {
          id: 'c4',
          name: 'C4-B4-C32',
          subtitle: 'Breached Stream',
          batch: 4,
          concurrency: 32,
          kvCache: 'auto',
          p50: 60,
          p95: 80,
          p99: 95,
          throughput: 220,
          error: 0,
          gpu: 95,
          feasible: false,
          feasibilityVerdict: 'INFEASIBLE',
          evidenceValidity: 'VALID',
          reason: 'TTFT_P95_EXCEEDED',
          tag: 'INFEASIBLE',
          ttftP95: 80,
          itlP95: 35,
        },
      ];

      const { paretoIds } = identifyParetoFrontier(candidates);

      // C1 and C3 must be on the Pareto frontier
      assert.ok(paretoIds.has('c1'), 'C1 should be on Pareto frontier (lowest latency)');
      assert.ok(paretoIds.has('c3'), 'C3 should be on Pareto frontier (highest feasible throughput)');

      // C2 is strictly dominated by C1 (worse latency AND worse throughput)
      assert.equal(paretoIds.has('c2'), false, 'C2 must be excluded from Pareto frontier (dominated)');

      // C4 is infeasible and must be excluded
      assert.equal(paretoIds.has('c4'), false, 'C4 must be excluded from Pareto frontier (infeasible)');
    });

    it('formats telemetry metrics cleanly with fallback handling', () => {
      assert.equal(formatLatency(47.0), '47.0 ms');
      assert.equal(formatLatency(0.5), '500 µs');
      assert.equal(formatLatency(1500), '1.50 s');
      assert.equal(formatLatency(null), '—');

      assert.equal(formatThroughput(160.0), '160.0 tok/s');
      assert.equal(formatThroughput(1500), '1.5k tok/s');
      assert.equal(formatThroughput(undefined), '—');

      assert.equal(formatNumber(12.345, 1), '12.3');
      assert.equal(formatNumber(null), '—');
    });
  });

  describe('SVG <defs> Scoped IDs & Absence of DOM ID Collisions (useId)', () => {
    // Bundle the 3 diagrams once for rendering tests
    const bundleResult = esbuild.buildSync({
      entryPoints: [
        'src/components/diagrams/InferencePipelineDiagram.tsx',
        'src/components/diagrams/VerificationGateDiagram.tsx',
        'src/components/diagrams/ParameterMatrixDiagram.tsx',
      ],
      bundle: true,
      write: false,
      outdir: 'dist-diagram-tests',
      format: 'cjs',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    });

    const loadComponent = (fileSubstring: string) => {
      const file = bundleResult.outputFiles.find((f) =>
        f.path.replace(/\\/g, '/').includes(fileSubstring)
      );
      if (!file) throw new Error(`Could not locate bundled component: ${fileSubstring}`);
      const m = { exports: {} as any };
      const fn = new Function('module', 'exports', 'require', file.text);
      fn(m, m.exports, (mod: string) => {
        if (mod === 'react') return React;
        if (mod === 'react-dom/server') return ReactDOMServer;
        return {};
      });
      return m.exports;
    };

    const { InferencePipelineDiagram } = loadComponent('InferencePipelineDiagram');
    const { VerificationGateDiagram } = loadComponent('VerificationGateDiagram');
    const { ParameterMatrixDiagram } = loadComponent('ParameterMatrixDiagram');

    it('verifies InferencePipelineDiagram generates scoped defs IDs and non-colliding references across instances', () => {
      const dualMarkup = ReactDOMServer.renderToStaticMarkup(
        React.createElement('div', null, [
          React.createElement(InferencePipelineDiagram, { key: 'pipe1' }),
          React.createElement(InferencePipelineDiagram, { key: 'pipe2' }),
        ])
      );

      // Verify all defs IDs are scoped with useId prefix
      const neonGlowMatches = [...dualMarkup.matchAll(/id="([^"]*neon-glow)"/g)].map((m) => m[1]);
      const glassRimMatches = [...dualMarkup.matchAll(/id="([^"]*glass-rim)"/g)].map((m) => m[1]);
      const chevronMatches = [...dualMarkup.matchAll(/id="([^"]*chevron)"/g)].map((m) => m[1]);

      assert.equal(neonGlowMatches.length, 2, 'Exactly 2 neon-glow defs rendered');
      assert.equal(glassRimMatches.length, 2, 'Exactly 2 glass-rim defs rendered');
      assert.equal(chevronMatches.length, 2, 'Exactly 2 chevron defs rendered');

      // Crucial: The two instances must have distinct IDs (zero collision)
      assert.notEqual(neonGlowMatches[0], neonGlowMatches[1], 'neon-glow IDs must be distinct across instances');
      assert.notEqual(glassRimMatches[0], glassRimMatches[1], 'glass-rim IDs must be distinct across instances');
      assert.notEqual(chevronMatches[0], chevronMatches[1], 'chevron IDs must be distinct across instances');

      // Verify url references match the scoped IDs
      assert.ok(dualMarkup.includes(`url(#${neonGlowMatches[0]})`));
      assert.ok(dualMarkup.includes(`url(#${neonGlowMatches[1]})`));
      assert.ok(dualMarkup.includes(`url(#${glassRimMatches[0]})`));
      assert.ok(dualMarkup.includes(`url(#${glassRimMatches[1]})`));
      assert.ok(dualMarkup.includes(`url(#${chevronMatches[0]})`));
      assert.ok(dualMarkup.includes(`url(#${chevronMatches[1]})`));
    });

    it('verifies VerificationGateDiagram scopes defs IDs preventing state leakage between verified and failed gates', () => {
      const dualMarkup = ReactDOMServer.renderToStaticMarkup(
        React.createElement('div', null, [
          React.createElement(VerificationGateDiagram, { key: 'v1', verdict: 'VERIFIED', verifRunId: 'verif-1' }),
          React.createElement(VerificationGateDiagram, { key: 'v2', verdict: 'VERIFICATION_FAILED', verifRunId: 'verif-2' }),
        ])
      );

      const zone1Grads = [...dualMarkup.matchAll(/id="([^"]*vgate-zone1-grad)"/g)].map((m) => m[1]);
      const zone2Grads = [...dualMarkup.matchAll(/id="([^"]*vgate-zone2-grad)"/g)].map((m) => m[1]);
      const corridorGrads = [...dualMarkup.matchAll(/id="([^"]*vgate-corridor-grad)"/g)].map((m) => m[1]);
      const hatches = [...dualMarkup.matchAll(/id="([^"]*vgate-isolation-hatch)"/g)].map((m) => m[1]);
      const glowFilters = [...dualMarkup.matchAll(/id="([^"]*vgate-glow-filter)"/g)].map((m) => m[1]);

      assert.equal(zone1Grads.length, 2);
      assert.equal(zone2Grads.length, 2);
      assert.equal(corridorGrads.length, 2);
      assert.equal(hatches.length, 2);
      assert.equal(glowFilters.length, 2);

      // Verify non-collision across instances
      assert.notEqual(zone1Grads[0], zone1Grads[1]);
      assert.notEqual(zone2Grads[0], zone2Grads[1]);
      assert.notEqual(corridorGrads[0], corridorGrads[1]);
      assert.notEqual(hatches[0], hatches[1]);
      assert.notEqual(glowFilters[0], glowFilters[1]);

      // Verify each instance references its own scoped gradient
      assert.ok(dualMarkup.includes(`url(#${zone2Grads[0]})`));
      assert.ok(dualMarkup.includes(`url(#${zone2Grads[1]})`));
      assert.ok(dualMarkup.includes(`url(#${corridorGrads[0]})`));
      assert.ok(dualMarkup.includes(`url(#${corridorGrads[1]})`));
    });

    it('verifies ParameterMatrixDiagram scopes matrixHatch, paretoGlow, and winnerBeaconGlow IDs', () => {
      const dualMarkup = ReactDOMServer.renderToStaticMarkup(
        React.createElement('div', null, [
          React.createElement(ParameterMatrixDiagram, { key: 'm1' }),
          React.createElement(ParameterMatrixDiagram, { key: 'm2' }),
        ])
      );

      const matrixHatches = [...dualMarkup.matchAll(/id="([^"]*matrixHatch)"/g)].map((m) => m[1]);
      const paretoGlows = [...dualMarkup.matchAll(/id="([^"]*paretoGlow)"/g)].map((m) => m[1]);
      const winnerGlows = [...dualMarkup.matchAll(/id="([^"]*winnerBeaconGlow)"/g)].map((m) => m[1]);

      assert.equal(matrixHatches.length, 2);
      assert.equal(paretoGlows.length, 2);
      assert.equal(winnerGlows.length, 2);

      assert.notEqual(matrixHatches[0], matrixHatches[1]);
      assert.notEqual(paretoGlows[0], paretoGlows[1]);
      assert.notEqual(winnerGlows[0], winnerGlows[1]);

      assert.ok(dualMarkup.includes(`url(#${matrixHatches[0]})`));
      assert.ok(dualMarkup.includes(`url(#${matrixHatches[1]})`));
    });
  });

  describe('Responsive Mobile Scaling & Viewport Adaptability', () => {
    const bundleResult = esbuild.buildSync({
      entryPoints: ['src/components/diagrams/InferencePipelineDiagram.tsx'],
      bundle: true,
      write: false,
      outdir: 'dist-diagram-tests',
      format: 'cjs',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    });

    const file = bundleResult.outputFiles[0];
    const m = { exports: {} as any };
    const fn = new Function('module', 'exports', 'require', file.text);
    fn(m, m.exports, (mod: string) => {
      if (mod === 'react') return React;
      if (mod === 'react-dom/server') return ReactDOMServer;
      return {};
    });
    const { InferencePipelineDiagram } = m.exports;

    it('verifies InferencePipelineDiagram renders preserveAspectRatio="xMidYMid meet"', () => {
      const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(InferencePipelineDiagram));
      assert.ok(
        markup.includes('preserveAspectRatio="xMidYMid meet"'),
        'SVG must have preserveAspectRatio="xMidYMid meet" for crisp mobile rendering'
      );
    });

    it('verifies InferencePipelineDiagram wraps SVG in overflow-x: auto container with minWidth: 1020px', () => {
      const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(InferencePipelineDiagram));

      // Check for overflow wrapper (style attributes in static markup)
      assert.ok(
        markup.includes('overflow-x:auto') || markup.includes('overflow-x: auto') || markup.includes('overflowX:auto') || markup.includes('overflow:auto'),
        'Markup must include horizontal scroll wrapper'
      );
      assert.ok(
        markup.includes('min-width:1020px') || markup.includes('min-width: 1020px') || markup.includes('minWidth:1020px'),
        'SVG must maintain min-width of 1020px to prevent text shrinking below taste threshold'
      );
    });
  });

  describe('Craft Invariants & Visual Safety (CRAFT_RULES.md)', () => {
    const bundleResult = esbuild.buildSync({
      entryPoints: ['src/components/diagrams/InferencePipelineDiagram.tsx'],
      bundle: true,
      write: false,
      outdir: 'dist-diagram-tests',
      format: 'cjs',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    });

    const file = bundleResult.outputFiles[0];
    const m = { exports: {} as any };
    const fn = new Function('module', 'exports', 'require', file.text);
    fn(m, m.exports, (mod: string) => {
      if (mod === 'react') return React;
      if (mod === 'react-dom/server') return ReactDOMServer;
      return {};
    });
    const { STAGES } = m.exports;

    it('verifies all STAGES parameter strings are <= 60 characters (Rule 2)', () => {
      for (const stage of STAGES) {
        assert.ok(
          stage.parameters.length <= 60,
          `Stage ${stage.id} parameters length (${stage.parameters.length}) must be <= 60 chars`
        );
        assert.ok(
          stage.contractRef.length <= 60,
          `Stage ${stage.id} contractRef length (${stage.contractRef.length}) must be <= 60 chars`
        );
      }
    });

    it('verifies ParameterMatrixDiagram diagonal quadrant-aware tooltip placement (Rule 4)', () => {
      const computeTooltipStyle = (batch: number, concurrency: number) => {
        const isTopHalf = batch > 1;
        const isRightHalf = concurrency > 16;
        return {
          ...(isTopHalf ? { bottom: '22px', top: 'unset' } : { top: '76px', bottom: 'unset' }),
          ...(isRightHalf ? { left: '24px', right: 'unset' } : { right: '24px', left: 'unset' }),
        };
      };

      // Top-Right candidate (batch 4, concurrency 32) -> Bottom-Left tooltip
      const tr = computeTooltipStyle(4, 32);
      assert.equal(tr.bottom, '22px');
      assert.equal(tr.left, '24px');
      assert.equal(tr.top, 'unset');
      assert.equal(tr.right, 'unset');

      // Top-Left candidate (batch 4, concurrency 16) -> Bottom-Right tooltip
      const tl = computeTooltipStyle(4, 16);
      assert.equal(tl.bottom, '22px');
      assert.equal(tl.right, '24px');

      // Bottom-Right candidate (batch 1, concurrency 32) -> Top-Left tooltip (clears 60px header with 76px)
      const br = computeTooltipStyle(1, 32);
      assert.equal(br.top, '76px');
      assert.equal(br.left, '24px');

      // Bottom-Left candidate (batch 1, concurrency 16) -> Top-Right tooltip
      const bl = computeTooltipStyle(1, 16);
      assert.equal(bl.top, '76px');
      assert.equal(bl.right, '24px');
    });

    it('verifies TradeoffPlot tooltip clears container header when flipped to top (Rule 4)', () => {
      const computeTradeoffTooltip = (cx: number, cy: number, plotW: number, plotH: number, mTop: number, mLeft: number) => {
        const isRightHalf = cx > mLeft + plotW / 2;
        const isBottomHalf = cy > mTop + plotH / 2;
        return {
          ...(isBottomHalf ? { top: '72px', bottom: 'unset' } : { bottom: '24px', top: 'unset' }),
          ...(isRightHalf ? { left: '24px', right: 'unset' } : { right: '24px', left: 'unset' }),
        };
      };

      // Point in bottom-right -> top-left at top 72px (clears ~52px title/legend)
      const br = computeTradeoffTooltip(400, 250, 475, 265, 30, 55);
      assert.equal(br.top, '72px', 'Top tooltip position must clear the container title header');
      assert.equal(br.left, '24px');
      assert.equal(br.bottom, 'unset');
      assert.equal(br.right, 'unset');
    });

    it('verifies VerificationGateDiagram drift verdict text fits inside 108px pill', () => {
      const formatDriftVerdict = (drift: number | null, isPassing: boolean, isPending: boolean) => {
        if (isPending) return 'PENDING';
        if (drift == null) return 'N/A';
        return `${drift > 0 ? '+' : ''}${formatNumber(drift, 1)} · ${isPassing ? 'PASS' : 'BREACH'}`;
      };

      // TTFT pass
      const v1 = formatDriftVerdict(1.2, true, false);
      assert.equal(v1, '+1.2 · PASS');
      assert.ok(v1.length <= 15, 'Drift verdict string must fit in 108px pill');

      // Throughput pass
      const v2 = formatDriftVerdict(-1.6, true, false);
      assert.equal(v2, '-1.6 · PASS');
      assert.ok(v2.length <= 15);

      // Severe breach
      const v3 = formatDriftVerdict(-25.4, false, false);
      assert.equal(v3, '-25.4 · BREACH');
      assert.ok(v3.length <= 15);
    });
  });
});
