export type DualModeTarget = 'local' | 'fake';
export type CampaignPresetKey = 'quick' | 'standard' | 'custom';

export interface WorkloadPresetConfig {
  key: CampaignPresetKey;
  label: string;
  durationSeconds: number;
  targetOfferedRate: number;
  totalRequests: number;
  concurrencyLimit: number;
  description: string;
}

export const WORKLOAD_PRESETS: Record<'quick' | 'standard', WorkloadPresetConfig> = {
  quick: {
    key: 'quick',
    label: 'Quick Benchmark',
    durationSeconds: 2,
    targetOfferedRate: 5.0,
    totalRequests: 20,
    concurrencyLimit: 1,
    description: '2s duration, 5 rps target, 20 requests total',
  },
  standard: {
    key: 'standard',
    label: 'Standard SLO Evaluation',
    durationSeconds: 5,
    targetOfferedRate: 10.0,
    totalRequests: 50,
    concurrencyLimit: 2,
    description: '5s duration, 10 rps target, 50 requests total',
  },
};

export interface RunTimelineItem {
  runIndex: number;
  stageName: string;
  stageTag: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  candidateId: string | null;
  runId: string | null;
  settings: Record<string, any>;
  completedReqs: number;
  totalReqs: number;
  currentTtftMs: number | null;
  verdict: 'FEASIBLE' | 'INFEASIBLE' | 'VERIFIED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE' | null;
  rankingMetric: number | null;
  progressPercent: number;
}

export interface CampaignTimelineState {
  campaignId: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  totalRuns: number;
  currentRunIndex: number;
  runs: RunTimelineItem[];
  winner: {
    id: string | null;
    config: Record<string, any>;
    rationale: string;
    rankingMetric: number | null;
  } | null;
  verificationOutcome: {
    verdict: string;
    isVerified: boolean;
    deltas: Record<string, number>;
  } | null;
  error: string | null;
}

export function createInitialTimelineState(campaignId: string | null = null): CampaignTimelineState {
  const stageLabels = [
    { name: 'Baseline Configuration', tag: '[Base]' },
    { name: 'Grid Candidate 1', tag: '[Cand 1]' },
    { name: 'Grid Candidate 2', tag: '[Cand 2]' },
    { name: 'Grid Candidate 3', tag: '[Cand 3]' },
    { name: 'Grid Candidate 4', tag: '[Cand 4]' },
    { name: 'Verification Rerun', tag: '[Run 6: Verify]' },
  ];

  const runs: RunTimelineItem[] = stageLabels.map((s, idx) => ({
    runIndex: idx,
    stageName: s.name,
    stageTag: s.tag,
    status: 'pending',
    candidateId: null,
    runId: null,
    settings: {},
    completedReqs: 0,
    totalReqs: 0,
    currentTtftMs: null,
    verdict: null,
    rankingMetric: null,
    progressPercent: 0,
  }));

  return {
    campaignId,
    status: 'idle',
    totalRuns: 6,
    currentRunIndex: -1,
    runs,
    winner: null,
    verificationOutcome: null,
    error: null,
  };
}

export function reduceCampaignTimelineEvent(
  prevState: CampaignTimelineState,
  event: any
): CampaignTimelineState {
  const state: CampaignTimelineState = {
    ...prevState,
    runs: prevState.runs.map((r) => ({ ...r })),
  };

  switch (event.type) {
    case 'campaign_started': {
      state.campaignId = event.campaign_id;
      state.status = 'running';
      state.totalRuns = event.total_runs || 6;
      state.currentRunIndex = 0;
      state.error = null;
      return state;
    }

    case 'candidate_started': {
      const idx = event.run_index ?? 0;
      state.currentRunIndex = idx;
      if (state.runs[idx]) {
        state.runs[idx].status = 'running';
        state.runs[idx].candidateId = event.candidate_id;
        state.runs[idx].runId = event.run_id;
        if (event.settings) {
          state.runs[idx].settings = event.settings;
        }
      }
      return state;
    }

    case 'request_progress': {
      const idx = event.run_index ?? state.currentRunIndex;
      if (state.runs[idx]) {
        state.runs[idx].completedReqs = event.completed ?? state.runs[idx].completedReqs;
        state.runs[idx].totalReqs = event.total ?? state.runs[idx].totalReqs;
        state.runs[idx].currentTtftMs = event.current_ttft_ms ?? state.runs[idx].currentTtftMs;
        if (event.total && event.total > 0) {
          state.runs[idx].progressPercent = Math.min(
            100,
            Math.round((event.completed / event.total) * 100)
          );
        }
      }
      return state;
    }

    case 'candidate_completed': {
      const idx = event.run_index ?? 0;
      if (state.runs[idx]) {
        state.runs[idx].status = 'completed';
        state.runs[idx].verdict = event.verdict;
        state.runs[idx].rankingMetric = event.ranking_metric;
        state.runs[idx].progressPercent = 100;
        if (event.candidate_id) {
          state.runs[idx].candidateId = event.candidate_id;
        }
      }
      return state;
    }

    case 'winner_selected': {
      state.winner = {
        id: event.winner_id,
        config: event.winning_config || {},
        rationale: event.selection_rationale || '',
        rankingMetric: event.ranking_metric,
      };
      return state;
    }

    case 'verification_started': {
      state.currentRunIndex = 5;
      if (state.runs[5]) {
        state.runs[5].status = 'running';
        state.runs[5].candidateId = event.candidate_id;
        state.runs[5].runId = event.run_id;
      }
      return state;
    }

    case 'verification_completed': {
      if (state.runs[5]) {
        state.runs[5].status = 'completed';
        state.runs[5].verdict = event.verification_verdict;
        state.runs[5].progressPercent = 100;
      }
      state.verificationOutcome = {
        verdict: event.verification_verdict,
        isVerified: event.is_verified,
        deltas: event.metric_deltas || {},
      };
      return state;
    }

    case 'campaign_completed': {
      state.status = 'completed';
      return state;
    }

    case 'campaign_failed': {
      state.status = 'failed';
      state.error = event.error || 'Optimization campaign failed';
      return state;
    }

    default:
      return state;
  }
}
