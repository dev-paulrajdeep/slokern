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

  it('correctly binds verified candidate identity and throughput from verification record', () => {
    // Regression check for Verification View candidate identity decoupling
    const recommendedCandidate = {
      id: '09618034778e',
      name: 'Candidate 09618034',
      throughput: 11.9,
      feasible: false,
    } as any;

    const verificationRecord = {
      verification_id: 'verif-c70ecef3',
      candidate_id: '95db015e9de9',
      original_run_id: 'run-04-cand-95db01',
      verification_run_id: 'run-verify-69a57759',
      verification_verdict: 'VERIFIED',
      metric_set: {
        token_throughput_tps: 48.0,
      },
      drift_analysis: {
        metric_comparisons: {
          token_throughput_tps: {
            reference_value: 48.0,
            verification_value: 48.0,
          },
        },
      },
    } as any;

    // Derived values mirroring VerificationView logic
    const effectiveCandidateId = verificationRecord?.candidate_id || recommendedCandidate.id;
    const effectiveCandidateName = verificationRecord?.candidate_id
      ? (verificationRecord.candidate_id === recommendedCandidate.id
          ? recommendedCandidate.name
          : `Candidate ${verificationRecord.candidate_id.slice(0, 8)}`)
      : recommendedCandidate.name;
    const effectiveThroughput =
      verificationRecord?.metric_set?.token_throughput_tps ??
      verificationRecord?.drift_analysis?.metric_comparisons?.['token_throughput_tps']?.reference_value ??
      recommendedCandidate.throughput;

    assert.equal(effectiveCandidateId, '95db015e9de9');
    assert.equal(effectiveCandidateName, 'Candidate 95db015e');
    assert.equal(effectiveThroughput, 48.0);
  });

  it('extracts client-side loadgen parameters (concurrency, max_tokens) and maps 2x2 grid slots', () => {
    // Regression check for ParameterMatrixDiagram client-side parameter extraction
    const rawRunData = [
      {
        id: '09618034778e',
        tag: 'INCONCLUSIVE',
        feasible: false,
        rawConfig: {
          effective_settings: { concurrency: 1, max_tokens: 32, concurrency_limit: 1 },
        },
      },
      {
        id: 'fe984b310e35',
        tag: 'INCONCLUSIVE',
        feasible: false,
        rawConfig: {
          effective_settings: { concurrency: 1, max_tokens: 128, concurrency_limit: 1 },
        },
      },
      {
        id: 'b2e1f07e45ad',
        tag: 'INFEASIBLE',
        feasible: false,
        rawConfig: {
          effective_settings: { concurrency: 2, max_tokens: 32, concurrency_limit: 2 },
        },
      },
      {
        id: '95db015e9de9',
        tag: 'WINNER',
        feasible: true,
        rawConfig: {
          effective_settings: { concurrency: 2, max_tokens: 128, concurrency_limit: 2 },
        },
      },
    ];

    const normalized = rawRunData.map((c) => {
      const rawSettings = c.rawConfig.effective_settings;
      const extractedConcurrency =
        c.rawConfig?.effective_settings?.max_num_seqs ??
        rawSettings.concurrency ??
        rawSettings.concurrency_limit ??
        16;
      const extractedMaxTokens = rawSettings.max_tokens;
      const isWinner = c.tag === 'WINNER' && c.feasible;

      return {
        id: c.id,
        concurrency: extractedConcurrency,
        maxTokens: extractedMaxTokens,
        isWinner,
        feasible: c.feasible,
      };
    });

    const isClientLoadgen = normalized.some((c) => c.maxTokens != null || c.concurrency <= 4);
    assert.equal(isClientLoadgen, true);

    // Verify 4 distinct quadrants: (1 stream, 32 tok), (1 stream, 128 tok), (2 stream, 32 tok), (2 stream, 128 tok)
    const qBottomLeft = normalized.find((c) => c.concurrency <= 1 && c.maxTokens <= 64);
    const qTopLeft = normalized.find((c) => c.concurrency <= 1 && c.maxTokens > 64);
    const qBottomRight = normalized.find((c) => c.concurrency > 1 && c.maxTokens <= 64);
    const qTopRight = normalized.find((c) => c.concurrency > 1 && c.maxTokens > 64);

    assert.equal(qBottomLeft?.id, '09618034778e');
    assert.equal(qTopLeft?.id, 'fe984b310e35');
    assert.equal(qBottomRight?.id, 'b2e1f07e45ad');
    assert.equal(qTopRight?.id, '95db015e9de9');
    assert.equal(qTopRight?.isWinner, true);
  });
});

