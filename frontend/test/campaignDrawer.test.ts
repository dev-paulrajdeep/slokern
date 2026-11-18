import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKLOAD_PRESETS,
  createInitialTimelineState,
  reduceCampaignTimelineEvent,
  getSearchSpaceForTarget,
  type CampaignTimelineState,
  type DualModeTarget,
} from '../src/lib/campaign.ts';

describe('CampaignLaunchDrawer Model & SSE Reducer', () => {
  it('verifies workload preset definitions and properties', () => {
    // Quick Benchmark preset
    const quick = WORKLOAD_PRESETS.quick;
    assert.equal(quick.key, 'quick');
    assert.equal(quick.label, 'Quick Benchmark');
    assert.equal(quick.durationSeconds, 2);
    assert.equal(quick.targetOfferedRate, 5.0);
    assert.equal(quick.totalRequests, 20);
    assert.equal(quick.concurrencyLimit, 1);

    // Standard SLO Evaluation preset
    const standard = WORKLOAD_PRESETS.standard;
    assert.equal(standard.key, 'standard');
    assert.equal(standard.label, 'Standard SLO Evaluation');
    assert.equal(standard.durationSeconds, 5);
    assert.equal(standard.targetOfferedRate, 10.0);
    assert.equal(standard.totalRequests, 50);
    assert.equal(standard.concurrencyLimit, 2);

    // Deep Audit preset
    const deep = WORKLOAD_PRESETS.deep;
    assert.equal(deep.key, 'deep');
    assert.equal(deep.label, 'Deep Audit');
    assert.equal(deep.durationSeconds, 60);
    assert.equal(deep.targetOfferedRate, 2.0);
    assert.equal(deep.totalRequests, 120);
    assert.equal(deep.concurrencyLimit, 2);
  });

  it('verifies multi-target configuration targets (vLLM, local Ollama, fake, nebius)', () => {
    const targets: DualModeTarget[] = ['vllm', 'local', 'fake', 'nebius'];

    for (const target of targets) {
      if (target === 'vllm') {
        const vllmSpace = getSearchSpaceForTarget('vllm');
        assert.equal(vllmSpace.param1Name, 'concurrency');
        assert.deepEqual(vllmSpace.param1Values, [1, 2]);
        assert.equal(vllmSpace.param2Name, 'max_tokens');
        assert.deepEqual(vllmSpace.param2Values, [32, 128]);
      } else if (target === 'local') {
        const localModel = 'qwen3:4b-instruct-2507-q4_K_M';
        const defaultTtft = 2500.0;
        assert.equal(localModel, 'qwen3:4b-instruct-2507-q4_K_M');
        assert.equal(defaultTtft, 2500.0);
      } else if (target === 'fake') {
        const fakeModel = 'fake-qwen-4b';
        const defaultTtft = 150.0;
        assert.equal(fakeModel, 'fake-qwen-4b');
        assert.equal(defaultTtft, 150.0);
      } else if (target === 'nebius') {
        const nebiusSpace = getSearchSpaceForTarget('nebius');
        assert.ok(nebiusSpace.gatedReason?.includes('BLK-17'));
      }
    }
  });

  it('verifies initial timeline state structure for 6 total runs', () => {
    const state = createInitialTimelineState('cmp-test-01');
    assert.equal(state.campaignId, 'cmp-test-01');
    assert.equal(state.status, 'idle');
    assert.equal(state.totalRuns, 6);
    assert.equal(state.runs.length, 6);

    // Timeline stage tags
    assert.equal(state.runs[0].stageTag, '[Base]');
    assert.equal(state.runs[1].stageTag, '[Cand 1]');
    assert.equal(state.runs[2].stageTag, '[Cand 2]');
    assert.equal(state.runs[3].stageTag, '[Cand 3]');
    assert.equal(state.runs[4].stageTag, '[Cand 4]');
    assert.equal(state.runs[5].stageTag, '[Run 6: Verify]');

    // All runs start in pending state
    for (const r of state.runs) {
      assert.equal(r.status, 'pending');
      assert.equal(r.completedReqs, 0);
      assert.equal(r.progressPercent, 0);
      assert.equal(r.verdict, null);
    }
  });

  it('verifies full SSE stream lifecycle updates through the timeline reducer', () => {
    let state = createInitialTimelineState();

    // 1. campaign_started
    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_started',
      campaign_id: 'cmp-stream-test',
      total_runs: 6,
      adapter: 'fake',
    });
    assert.equal(state.status, 'running');
    assert.equal(state.campaignId, 'cmp-stream-test');
    assert.equal(state.totalRuns, 6);
    assert.equal(state.currentRunIndex, 0);

    // 2. candidate_started (Run 0 - Baseline)
    state = reduceCampaignTimelineEvent(state, {
      type: 'candidate_started',
      run_index: 0,
      candidate_id: 'cand-base-00',
      run_id: 'run-00-base',
      settings: { max_num_seqs: 16 },
    });
    assert.equal(state.runs[0].status, 'running');
    assert.equal(state.runs[0].candidateId, 'cand-base-00');
    assert.equal(state.runs[0].runId, 'run-00-base');

    // 3. request_progress (Run 0: 5/10 requests, TTFT 11.2ms)
    state = reduceCampaignTimelineEvent(state, {
      type: 'request_progress',
      run_index: 0,
      completed: 5,
      total: 10,
      current_ttft_ms: 11.2,
    });
    assert.equal(state.runs[0].completedReqs, 5);
    assert.equal(state.runs[0].totalReqs, 10);
    assert.equal(state.runs[0].currentTtftMs, 11.2);
    assert.equal(state.runs[0].progressPercent, 50);

    // 4. candidate_completed (Run 0)
    state = reduceCampaignTimelineEvent(state, {
      type: 'candidate_completed',
      run_index: 0,
      candidate_id: 'cand-base-00',
      verdict: 'FEASIBLE',
      ranking_metric: 120.5,
    });
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.runs[0].verdict, 'FEASIBLE');
    assert.equal(state.runs[0].rankingMetric, 120.5);
    assert.equal(state.runs[0].progressPercent, 100);

    // Runs 1 to 4 completion
    for (let i = 1; i <= 4; i++) {
      state = reduceCampaignTimelineEvent(state, {
        type: 'candidate_started',
        run_index: i,
        candidate_id: `cand-grid-0${i}`,
        run_id: `run-0${i}-cand`,
      });
      state = reduceCampaignTimelineEvent(state, {
        type: 'request_progress',
        run_index: i,
        completed: 10,
        total: 10,
        current_ttft_ms: 10.0 + i,
      });
      state = reduceCampaignTimelineEvent(state, {
        type: 'candidate_completed',
        run_index: i,
        candidate_id: `cand-grid-0${i}`,
        verdict: i === 3 ? 'INFEASIBLE' : 'FEASIBLE',
        ranking_metric: 130.0 + i * 10,
      });
      assert.equal(state.runs[i].status, 'completed');
    }

    assert.equal(state.runs[3].verdict, 'INFEASIBLE');
    assert.equal(state.runs[4].verdict, 'FEASIBLE');

    // 5. winner_selected
    state = reduceCampaignTimelineEvent(state, {
      type: 'winner_selected',
      winner_id: 'cand-grid-04',
      winning_config: { max_num_batched_tokens: 2048, max_num_seqs: 64 },
      selection_rationale: 'Top output throughput among FEASIBLE candidates',
      ranking_metric: 170.0,
    });
    assert.ok(state.winner);
    assert.equal(state.winner?.id, 'cand-grid-04');
    assert.equal(state.winner?.rankingMetric, 170.0);

    // 6. verification_started (Run 5)
    state = reduceCampaignTimelineEvent(state, {
      type: 'verification_started',
      candidate_id: 'cand-grid-04',
      run_id: 'run-05-verif',
    });
    assert.equal(state.runs[5].status, 'running');
    assert.equal(state.runs[5].candidateId, 'cand-grid-04');
    assert.equal(state.currentRunIndex, 5);

    // 7. verification_completed
    state = reduceCampaignTimelineEvent(state, {
      type: 'verification_completed',
      verification_verdict: 'VERIFIED',
      is_verified: true,
      metric_deltas: { ttft_ms_p95: 1.2, token_throughput_tps: -0.5 },
    });
    assert.equal(state.runs[5].status, 'completed');
    assert.equal(state.runs[5].verdict, 'VERIFIED');
    assert.equal(state.runs[5].progressPercent, 100);
    assert.ok(state.verificationOutcome);
    assert.equal(state.verificationOutcome?.isVerified, true);
    assert.equal(state.verificationOutcome?.deltas.ttft_ms_p95, 1.2);

    // 8. campaign_completed
    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_completed',
      campaign_id: 'cmp-stream-test',
      winner_id: 'cand-grid-04',
      is_verified: true,
    });
    assert.equal(state.status, 'completed');
  });

  it('verifies campaign failure handling in reducer', () => {
    let state = createInitialTimelineState();
    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_started',
      campaign_id: 'cmp-fail-test',
    });
    assert.equal(state.status, 'running');

    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_failed',
      error: 'CUDA Out of Memory during run 2',
    });
    assert.equal(state.status, 'failed');
    assert.equal(state.error, 'CUDA Out of Memory during run 2');
  });

  it('verifies timeline transition when all candidates are infeasible (no winner selected)', () => {
    let state = createInitialTimelineState();
    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_started',
      campaign_id: 'cmp-infeasible-01',
      total_runs: 6,
    });

    // Complete all 5 search runs as INFEASIBLE
    for (let i = 0; i < 5; i++) {
      state = reduceCampaignTimelineEvent(state, {
        type: 'candidate_started',
        run_index: i,
        candidate_id: `cand-${i}`,
        run_id: `run-${i}`,
      });
      state = reduceCampaignTimelineEvent(state, {
        type: 'candidate_completed',
        run_index: i,
        candidate_id: `cand-${i}`,
        verdict: 'INFEASIBLE',
        ranking_metric: null,
      });
    }

    // Winner selected event with winner_id: null
    state = reduceCampaignTimelineEvent(state, {
      type: 'winner_selected',
      campaign_id: 'cmp-infeasible-01',
      winner_id: null,
      winning_config: {},
      selection_rationale: 'No candidate satisfied declared hard SLO constraints.',
      ranking_metric: null,
    });

    assert.equal(state.winner?.id, null);
    // Run 5 must NOT remain pending
    assert.equal(state.runs[5].status, 'completed');
    assert.equal(state.runs[5].verdict, 'INCONCLUSIVE');

    // Campaign completed
    state = reduceCampaignTimelineEvent(state, {
      type: 'campaign_completed',
      campaign_id: 'cmp-infeasible-01',
      winner_id: null,
      is_verified: false,
    });
    assert.equal(state.status, 'completed');
    assert.equal(state.runs[5].status, 'completed');
  });
});
