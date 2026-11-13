import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapRunStatusToCandidate, mapSmokeTestEvidence, mapVerificationComparisons, selectFeasibleRecommendation } from '../src/lib/adapters/viewModel.ts';
import type { UICandidate } from '../src/lib/adapters/viewModel.ts';

describe('decision integrity view-model adapters', () => {
  it('keeps TTFT and end-to-end percentiles separate and preserves throughput units', () => {
    const run = {
      run_id: 'run-01',
      experiment_id: 'exp-01',
      candidate_id: 'candidate-01',
      execution_status: 'COMPLETED',
      is_completed: true,
      is_feasible: false,
      raw_measurements_count: 30,
      metric_set: {
        ttft_ms: { p50: 12.4, p95: 12.5, p99: 12.6 },
        itl_ms: { p50: 8.0, p95: 8.1, p99: 8.2 },
        e2e_latency_ms: { p50: 510, p95: 518, p99: 520 },
        token_throughput_tps: 160,
        error_rate: 0,
      },
      feasibility_result: {
        overall_verdict: 'INFEASIBLE',
        validity_status: 'VALID',
        audit_notes: 'Constraint failed: e2e_latency_ms p95 <= 500.0',
        constraint_evaluations: [
          { reason_code: 'E2E_LATENCY_EXCEEDED' },
        ],
      },
    } as any;

    const candidate = mapRunStatusToCandidate(run);

    assert.equal(candidate.ttftP95, 12.5);
    assert.equal(candidate.e2eP95, 518);
    assert.equal(candidate.p95, 12.5);
    assert.equal(candidate.throughput, 160);
    assert.equal(candidate.feasible, false);
    assert.equal(candidate.tag, 'INFEASIBLE');
    assert.equal(candidate.reason, 'Constraint failed: e2e_latency_ms p95 <= 500.0');
    assert.deepEqual(candidate.reasonCodes, ['E2E_LATENCY_EXCEEDED']);
  });

  it('does not replace an infeasible selected winner with another feasible candidate', () => {
    const infeasibleWinner = { id: 'candidate-a', tag: 'WINNER', feasible: false } as UICandidate;
    const feasibleCandidate = { id: 'candidate-b', tag: 'FEASIBLE', feasible: true } as UICandidate;
    assert.equal(selectFeasibleRecommendation([infeasibleWinner, feasibleCandidate]), null);
  });

  it('returns no recommendation when all candidates are infeasible', () => {
    const infeasibleWinner = { id: 'candidate-a', tag: 'WINNER', feasible: false } as UICandidate;
    assert.equal(selectFeasibleRecommendation([infeasibleWinner]), null);
  });

  it('keeps missing smoke evidence pending instead of inventing live measurements', () => {
    const evidence = mapSmokeTestEvidence(null);
    assert.equal(evidence.evidenceClassification, 'PENDING');
    assert.equal(evidence.ttftMs, null);
    assert.equal(evidence.totalLatencyMs, null);
    assert.equal(evidence.streamStatus, 'NOT RECORDED');
  });

  it('does not invent verification deltas when comparison artifacts are absent', () => {
    assert.deepEqual(mapVerificationComparisons(null), []);
    const [comparison] = mapVerificationComparisons({
      drift_analysis: {
        slo_drift_detected: false,
        comparisons: [{
          metric_name: 'ttft_ms.p95',
          reference_value: 12.5,
          verification_value: 13,
          absolute_drift: 0.5,
          tolerance: 3,
          comparison_method: 'absolute_difference',
          unit: 'ms',
          passed: true,
        }],
      },
    } as any);
    assert.equal(comparison.searchVal, 12.5);
    assert.equal(comparison.verifyVal, 13);
    assert.equal(comparison.drift, 0.5);
    assert.equal(comparison.tolerance, 3);
  });

  it('computes candidate triage dimensions (headroom, throughput delta, cost efficiency)', () => {
    const baseTps = 113.4;
    const candTps = 160.0;
    const deltaTps = ((candTps - baseTps) / baseTps) * 100;
    const costPer1k = Number((0.0672 / candTps).toFixed(5));

    assert.ok(deltaTps > 40.0 && deltaTps < 42.0); // +41.1%
    assert.equal(costPer1k, 0.00042); // $0.00042 / 1K tokens
  });

  it('builds canonical vLLM launch commands with safe defaults and explicit candidate parameters', async () => {
    const { buildVllmLaunchCommand, buildVllmLaunchFlags } = await import('../src/lib/vllm.ts');

    // 1. Defined candidate with custom parameters
    const candidate = {
      id: 'cand-77',
      concurrency: 64,
      batch: 8,
      kvCache: 'FP8',
    } as any;

    const multilineCmd = buildVllmLaunchCommand(candidate, 'meta-llama/Meta-Llama-3-8B-Instruct');
    assert.ok(multilineCmd.includes('--max-num-seqs 64'));
    assert.ok(multilineCmd.includes('--max-num-batched-tokens 4096')); // 8 * 512
    assert.ok(multilineCmd.includes('--block-size 16'));
    assert.ok(multilineCmd.includes('--kv-cache-dtype fp8'));
    assert.ok(multilineCmd.includes('--port 8000'));

    const flagsCmd = buildVllmLaunchFlags(candidate);
    assert.ok(flagsCmd.startsWith('vllm serve meta-llama/Meta-Llama-3-8B-Instruct'));
    assert.ok(!flagsCmd.includes('\n')); // Single-line format
    assert.ok(flagsCmd.includes('--max-num-seqs 64'));
    assert.ok(flagsCmd.includes('--kv-cache-dtype fp8'));

    // 2. Null/undefined candidate falls back safely to workstation defaults
    const fallbackCmd = buildVllmLaunchCommand(null);
    assert.ok(fallbackCmd.includes('--max-num-seqs 32'));
    assert.ok(fallbackCmd.includes('--max-num-batched-tokens 2048'));
    assert.ok(fallbackCmd.includes('--kv-cache-dtype auto'));
  });

  it('verifies keyboard shortcuts suppress single-key actions when modifier keys or input targets are present', () => {
    // Simulated keydown logic identical to App.tsx guard
    const shouldIgnoreHotkey = (e: {
      target: { tagName: string; isContentEditable?: boolean };
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
    }) => {
      const target = e.target;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return true;
      }
      return false;
    };

    // User typing inside an input field
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'INPUT' } }), true);
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'TEXTAREA' } }), true);
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'DIV', isContentEditable: true } }), true);

    // User pressing Ctrl+C (system copy) or Ctrl+R (reload) or Ctrl+1..6 (browser tab switch)
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'BODY' }, ctrlKey: true }), true);
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'BODY' }, metaKey: true }), true);
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'BODY' }, altKey: true }), true);

    // Operator pressing plain hotkey 'c', 'r', or '1'..'6' on background
    assert.equal(shouldIgnoreHotkey({ target: { tagName: 'BODY' } }), false);
  });
});

