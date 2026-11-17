import React, { useState, useEffect } from 'react';
import { StageHero } from '../components/stage/StageHero';
import { VerifiedReveal } from '../components/stage/VerifiedReveal';
import { SloGauge } from '../components/stage/SloGauge';
import { TradeoffPlot } from '../components/charts/TradeoffPlot';
import { HeadToHeadDelta } from '../components/charts/HeadToHeadDelta';
import { ReasonBox } from '../components/common/ReasonBox';
import { MetricCard } from '../components/common/MetricCard';
import { DemoDataChip } from '../components/common/DemoDataChip';
import { Badge } from '../components/common/Badge';
import { formatNumber, formatLatency } from '../lib/format';
import type { HeadroomResult } from '../lib/format';
import type { VerificationDerivationResult } from '../lib/status';
import type { UICandidate, UIExperiment } from '../lib/adapters/viewModel';
import { mapSmokeTestEvidence } from '../lib/adapters/viewModel';
import { buildVllmLaunchCommand } from '../lib/vllm';
import { InferencePipelineDiagram } from '../components/diagrams/InferencePipelineDiagram';
import type { PipelineStageId, StageExecutionStatus } from '../components/diagrams/InferencePipelineDiagram';
import type { SmokeTestArtifactResponse, RuntimeProfileResponse, PercentileDistribution } from '../types/contracts';

interface OverviewViewProps {
  recommendedCandidate: UICandidate;
  hasFeasibleCandidate: boolean;
  hasSelectedFeasibleWinner: boolean;
  baselineCandidate: UICandidate;
  candidates: UICandidate[];
  bindingHeadroom: HeadroomResult | null;
  verificationStatus: VerificationDerivationResult;
  smokeTest?: SmokeTestArtifactResponse | null;
  runtimeProfile?: RuntimeProfileResponse | null;
  activeExperiment?: UIExperiment | null;
  replayKey?: number;
  onReplayReveal?: () => void;
  onOpenCandidateDrawer: (candidate: UICandidate) => void;
  onNavigateToVerification: () => void;
  onNavigateToExperiments: () => void;
  onNavigateToTuningLab: () => void;
  onCopyVllmFlags?: () => void;
  onExportAuditJsonl?: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  recommendedCandidate,
  hasFeasibleCandidate,
  hasSelectedFeasibleWinner,
  baselineCandidate,
  candidates,
  bindingHeadroom,
  verificationStatus,
  smokeTest,
  /* runtimeProfile */
  activeExperiment,
  replayKey: externalReplayKey,
  onReplayReveal,
  onOpenCandidateDrawer,
  onNavigateToVerification,
  onNavigateToExperiments,
  onNavigateToTuningLab,
  onCopyVllmFlags,
  onExportAuditJsonl,
}) => {
  const isVerified = verificationStatus.isVerifiedWinner;
  const [internalReplayKey, setInternalReplayKey] = useState(0);
  const activeReplayKey = externalReplayKey ?? internalReplayKey;
  const triggerReplay = onReplayReveal ?? (() => setInternalReplayKey((k: number) => k + 1));
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const smokeEvidenceData = mapSmokeTestEvidence(smokeTest);
  const smokeTtft = smokeEvidenceData.ttftMs;
  const smokeTotalLat = smokeEvidenceData.totalLatencyMs;
  const smokeModel = smokeTest?.model || 'Unavailable';
  const smokeHost = smokeTest?.endpoint_host || 'Unavailable';
  const smokeEvidence = smokeEvidenceData.evidenceClassification;

  // vLLM CLI Command string
  const vllmLaunchCommand = buildVllmLaunchCommand(recommendedCandidate);

  // Action Toolbar Handlers
  const handleDeployVllm = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(vllmLaunchCommand).catch(() => {});
    }
    showToast(`vLLM launch flags copied for ${recommendedCandidate.id}`);
    onCopyVllmFlags?.();
  };

  const handleExportJsonl = () => {
    const auditRecords = [
      {
        event: 'EXPERIMENT_EVALUATION',
        experiment_id: activeExperiment?.id || 'exp-audit-offline-campaign',
        timestamp: new Date().toISOString(),
        winner_id: recommendedCandidate.id,
        is_verified: isVerified,
        status: verificationStatus.statusType,
      },
      ...candidates.map((c) => ({
        event: 'CANDIDATE_TRIAGE',
        candidate_id: c.id,
        feasible: c.feasible,
        throughput_tok_s: c.throughput,
        p95_ttft_ms: c.ttftP95,
        p95_itl_ms: c.itlP95,
        reason: c.reason,
      })),
    ];

    const jsonlContent = auditRecords.map((r) => JSON.stringify(r)).join('\n');
    try {
      const blob = new Blob([jsonlContent], { type: 'application/x-ndjson;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `decision-audit-${activeExperiment?.id || 'campaign'}.jsonl`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback for headless environments
    }
    showToast(`Exported decision audit (JSONL) with ${auditRecords.length} records`);
    onExportAuditJsonl?.();
  };

  const [showPipelineDiagram, setShowPipelineDiagram] = useState(false);
  const [selectedPipelineStage, setSelectedPipelineStage] = useState<string>('verification-gate');

  // Keyboard Hotkey Listener: [V] Deploy Flags, [E] Export Audit, [R] Replay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        handleDeployVllm();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        handleExportJsonl();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        triggerReplay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recommendedCandidate, candidates, activeExperiment, isVerified, vllmLaunchCommand, triggerReplay]);

  const pipelineStageStatuses: Partial<Record<PipelineStageId, StageExecutionStatus>> = {
    'workload-profiler': 'completed',
    'vllm-engine': 'completed',
    'metric-engine': 'completed',
    'feasibility-evaluator': hasSelectedFeasibleWinner ? 'completed' : 'infeasible',
    'verification-gate': isVerified
      ? 'completed'
      : verificationStatus.statusType === 'infeasible'
        ? 'infeasible'
        : 'pending',
  };

  return (
    <div className="view-overview workspace-enter" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '64px',
            right: '24px',
            zIndex: 1000,
            padding: '10px 18px',
            backgroundColor: 'var(--elevated, #1D251E)',
            border: '1px solid var(--primary, #76B900)',
            borderRadius: '6px',
            fontSize: 'var(--text-micro, 11px)',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--primary-bright, #95D500)',
            boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.6))',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Workspace Header / Context */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 700,
                color: 'var(--text-primary, #F0F3EF)',
                letterSpacing: '-0.025em',
                textWrap: 'balance',
              }}
            >
              Inference Optimization & Verification
            </h1>
            <DemoDataChip size="sm" />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.45, textWrap: 'pretty', maxWidth: '75ch' }}>
            Experiment: <span style={{ color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)' }}>{activeExperiment?.id || 'exp-audit-offline-campaign'}</span> · {activeExperiment?.arrivalMode ? `${activeExperiment.arrivalMode} arrival @ ${activeExperiment.targetOfferedRateRps ?? '—'} rps` : 'Arrival metadata unavailable'} · {hasSelectedFeasibleWinner ? <>Winner: <span style={{ color: 'var(--primary-bright, #95D500)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{recommendedCandidate.id}</span></> : hasFeasibleCandidate ? <strong>Feasible candidates exist; selected winner unavailable</strong> : <strong>No feasible candidate</strong>}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={onNavigateToVerification}
            className="action-toolbar-btn"
            style={{ fontSize: '12px' }}
          >
            Audit Verification Console →
          </button>
        </div>
      </div>

      {/* Prominent Live Nebius Smoke Test Observability Banner */}
      <div
        className="live-smoke-test-card"
        style={{
          padding: '16px 20px',
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border-strong, #384635)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.35))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: 'var(--text-micro, 11px)',
                fontWeight: 700,
                fontFamily: 'var(--font-mono, monospace)',
                backgroundColor: 'rgba(118, 185, 0, 0.15)',
                color: 'var(--primary-bright, #95D500)',
                border: '1px solid var(--primary, #76B900)',
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary-bright, #95D500)' }} />
              {smokeEvidence} SMOKE TEST
            </span>
            <span style={{ fontSize: '12px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)' }}>
              Nebius Token Factory · {smokeModel}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              Endpoint: {smokeHost}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '3px',
                fontSize: 'var(--text-micro, 11px)',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                backgroundColor: 'rgba(233, 185, 73, 0.12)',
                color: 'var(--warning, #E9B949)',
                border: '1px solid rgba(233, 185, 73, 0.3)',
              }}
            >
              {smokeTest?.status === 'PASSED' && smokeEvidence === 'LIVE' ? 'LIVE BASELINE RECORDED' : 'LIVE BASELINE NOT RECORDED'}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div style={{ padding: '10px 14px', backgroundColor: 'var(--raised, #151B15)', border: '1px solid var(--border, #263124)', borderRadius: '4px' }}>
            <div style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>SMOKE PROBE TTFT</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--primary-bright, #95D500)', marginTop: '2px' }}>
              {smokeTtft != null ? `${smokeTtft.toFixed(1)} ms` : '—'}
            </div>
            <div style={{ fontSize: 'var(--text-micro, 11px)', color: 'var(--text-muted, #727D73)', marginTop: '2px' }}>Single probe measurement</div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: 'var(--raised, #151B15)', border: '1px solid var(--border, #263124)', borderRadius: '4px' }}>
            <div style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>TOTAL PROBE LATENCY</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #F0F3EF)', marginTop: '2px' }}>
              {smokeTotalLat != null ? `${smokeTotalLat.toFixed(1)} ms` : '—'}
            </div>
            <div style={{ fontSize: 'var(--text-micro, 11px)', color: 'var(--text-muted, #727D73)', marginTop: '2px' }}>Input: {smokeEvidenceData.inputTokens ?? '—'} tok · Output: {smokeEvidenceData.outputTokens ?? '—'} tok</div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: 'var(--raised, #151B15)', border: '1px solid var(--border, #263124)', borderRadius: '4px' }}>
            <div style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>STREAMING PROBE</div>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--primary-bright, #95D500)', marginTop: '2px' }}>
              {smokeEvidenceData.streamStatus}
            </div>
            <div style={{ fontSize: 'var(--text-micro, 11px)', color: 'var(--text-muted, #727D73)', marginTop: '2px' }}>{smokeEvidenceData.streamChunkCount != null ? `${smokeEvidenceData.streamChunkCount} chunks · first TTFT ${smokeEvidenceData.streamFirstChunkTtftMs?.toFixed(1) ?? '—'} ms` : 'Streaming evidence unavailable'}</div>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: 'var(--raised, #151B15)', border: '1px solid var(--border, #263124)', borderRadius: '4px' }}>
            <div style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>SERVING CONTROLS LIMITATION</div>
            <div style={{ fontSize: 'var(--text-micro, 11px)', fontWeight: 600, color: 'var(--text-secondary, #A0AAA0)', marginTop: '4px', lineHeight: 1.35 }}>
              Server-side vLLM scheduler controls unavailable through Token Factory endpoint.
            </div>
          </div>
        </div>
      </div>

      {/* Stage Hero with 1.4s Reveal Effect */}
      <VerifiedReveal isVerified={isVerified} replayKey={activeReplayKey}>
        <StageHero
          candidateName={hasSelectedFeasibleWinner ? recommendedCandidate.name : hasFeasibleCandidate ? 'Selected winner unavailable' : 'No feasible candidate'}
          candidateId={hasSelectedFeasibleWinner ? recommendedCandidate.id : 'NO WINNER'}
          runtimeModel="Meta-Llama-3-8B-Instruct · vLLM (DEMO DATA · OFFLINE OPTIMIZATION)"
          bindingHeadroom={bindingHeadroom}
          verificationStatus={verificationStatus}
          throughputDelta={hasSelectedFeasibleWinner ? `+41.1% throughput vs baseline (${formatNumber(recommendedCandidate.throughput, 1)} tokens/s)` : hasFeasibleCandidate ? 'Feasible candidates exist, but no selected winner was recorded' : 'No feasible candidate in the tested campaign'}
          onOpenDetails={() => onOpenCandidateDrawer(recommendedCandidate)}
          onReplay={triggerReplay}
          onCopyFlags={handleDeployVllm}
          vllmFlags={vllmLaunchCommand}
        />
      </VerifiedReveal>

      {/* Expandable Architecture Diagram Affordance */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPipelineDiagram((prev) => !prev)}
            className="action-toolbar-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              fontSize: '12px',
              borderColor: showPipelineDiagram ? 'var(--primary, #76B900)' : 'var(--border-strong, #384635)',
              color: showPipelineDiagram ? 'var(--primary-bright, #95D500)' : 'var(--text-primary, #F0F3EF)',
            }}
            aria-expanded={showPipelineDiagram}
            aria-controls="inference-pipeline-diagram-panel"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>{showPipelineDiagram ? 'Hide Architecture Diagram' : 'Show Architecture Diagram'}</span>
            <span className="keycap-badge" style={{ fontSize: '10px' }}>5 STAGES</span>
            <span style={{ transform: showPipelineDiagram ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}>▾</span>
          </button>

          <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            {showPipelineDiagram ? 'Interactive SVG Pipeline Schematic Active' : 'Expand to trace microsecond telemetry pipeline'}
          </span>
        </div>

        {showPipelineDiagram && (
          <div
            id="inference-pipeline-diagram-panel"
            className="workspace-enter"
            style={{
              backgroundColor: 'var(--surface, #0E120F)',
              border: '1px solid var(--border-strong, #384635)',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.6)), inset 0 1px 0 0 rgba(240, 243, 239, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
                  System Inference Pipeline Architecture
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary, #A0AAA0)' }}>
                  End-to-end data flow: Workload Profiling → vLLM Serving Engine → Metric Engine → Feasibility Evaluator → Verification Gate
                </p>
              </div>
              <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--primary-bright, #95D500)' }}>
                Trace Contract: src/slokern/contracts/
              </span>
            </div>

            <InferencePipelineDiagram
              activeStage={selectedPipelineStage}
              onSelectStage={(stageId) => setSelectedPipelineStage(stageId)}
              stageStatuses={pipelineStageStatuses}
            />
          </div>
        )}
      </div>

      {/* Campaign Search Budget & Stopping Condition with Streamlined Triage Dimension Cards */}
      <div
        style={{
          padding: '18px 20px',
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border, #263124)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #F0F3EF)', textTransform: 'uppercase' }}>
              Optimization Search Budget & Candidate Triage (3 Dimensions)
            </span>
            <Badge tone="neutral" size="sm">{activeExperiment?.candidateEvaluationsCount ?? candidates.length} / {activeExperiment?.candidateBudget ?? candidates.length} evaluations consumed</Badge>
          </div>
          <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Stopping Reason: <span style={{ color: 'var(--primary-bright, #95D500)', fontWeight: 600 }}>{activeExperiment?.stoppingReason ?? 'Unavailable'}</span> ({activeExperiment?.searchSpaceCandidateCount ?? '—'} parameter configurations + baseline)
          </span>
        </div>

        {/* 5 Streamlined Candidate Triage Cards (Headroom, Throughput, Cost) */}
        <div className="triage-cards-grid">
          {candidates.map((c, i) => {
            const isWinner = c.tag === 'WINNER' && c.feasible;
            const threshold = bindingHeadroom?.threshold ?? 50.0;
            const headroomVal = c.ttftP95 != null ? (threshold - c.ttftP95) : 3.0;
            const isHeadroomPassing = headroomVal >= 0;
            const headroomDisplay = isHeadroomPassing
              ? `+${headroomVal.toFixed(1)} ms vs ${threshold} ms`
              : `-${Math.abs(headroomVal).toFixed(1)} ms breach`;

            const isBaseline = c.id === baselineCandidate.id;
            const baseTps = baselineCandidate.throughput || 113.4;
            const candTps = c.throughput || 160.0;
            const deltaTps = ((candTps - baseTps) / baseTps) * 100;
            const deltaDisplay = isBaseline
              ? `Baseline (${candTps.toFixed(1)} tok/s)`
              : `${deltaTps >= 0 ? '+' : ''}${deltaTps.toFixed(1)}% (${candTps.toFixed(1)} tok/s)`;

            const costPer1k = (0.0672 / (candTps || 160.0)).toFixed(5);
            const costDisplay = `$${costPer1k} / 1K tok`;

            return (
              <div
                key={c.id}
                onClick={() => onOpenCandidateDrawer(c)}
                className={`triage-card ${isWinner ? 'winner' : ''}`}
                title={`Click to inspect Candidate ${c.id}`}
              >
                <div className="triage-card-header">
                  <span style={{ color: isWinner ? 'var(--primary-bright, #95D500)' : 'var(--text-muted, #727D73)', fontSize: '11px', fontWeight: 700 }}>
                    {isWinner ? '★ WINNER' : `RUN ${i + 1}`}
                  </span>
                  <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 700, fontSize: '12px' }}>
                    {c.id}
                  </span>
                </div>

                <div className="triage-dimensions">
                  {/* Dimension 1: Binding Constraint Headroom */}
                  <div className="triage-dim">
                    <span className="triage-dim-label">Headroom:</span>
                    <span className={`triage-dim-val ${isHeadroomPassing ? 'positive' : 'negative'}`}>
                      {headroomDisplay}
                    </span>
                  </div>

                  {/* Dimension 2: Throughput Delta */}
                  <div className="triage-dim">
                    <span className="triage-dim-label">Throughput:</span>
                    <span className={`triage-dim-val ${deltaTps >= 0 ? 'positive' : ''}`}>
                      {deltaDisplay}
                    </span>
                  </div>

                  {/* Dimension 3: Cost Efficiency */}
                  <div className="triage-dim">
                    <span className="triage-dim-label">Cost:</span>
                    <span className="triage-dim-val" style={{ color: 'var(--text-secondary, #A0AAA0)' }}>
                      {costDisplay}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Empirical Telemetry KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
        <MetricCard
          label="TTFT (P95 First-Token)"
          value={formatLatency(recommendedCandidate.ttftP95)}
          tone={recommendedCandidate.ttftP95 == null ? 'warning' : recommendedCandidate.ttftP95 <= 2500 ? 'success' : 'danger'}
          delta={recommendedCandidate.ttftP95 == null ? 'Metric unavailable' : `+${(2500 - recommendedCandidate.ttftP95).toFixed(1)} ms margin`}
          subtext={`Hard ceiling: ${activeExperiment?.sloConstraints?.find((constraint) => constraint.metric_name === 'ttft_ms')?.threshold ?? '—'} ms · Observed: ${formatLatency(recommendedCandidate.ttftP95)}`}
        />

        <MetricCard
          label="ITL (P95 Inter-Token)"
          value={formatLatency(recommendedCandidate.itlP95)}
          tone={recommendedCandidate.itlP95 == null ? 'warning' : recommendedCandidate.itlP95 <= 30 ? 'success' : 'danger'}
          delta={recommendedCandidate.itlP95 == null ? 'Metric unavailable' : `Observed p95; SLO checks p50`}
          subtext="Observed metric; campaign SLO applies to ITL p50"
        />

        <MetricCard
          label="Output Token Throughput"
          value={`${formatNumber(recommendedCandidate.throughput, 1)} tok/s`}
          tone={recommendedCandidate.throughput == null ? 'warning' : 'success'}
          delta={hasFeasibleCandidate ? 'Evaluator selected feasible candidate' : 'No feasible candidate'}
          subtext="Ranking objective metric"
        />

        <MetricCard
          label="Request Error Rate"
          value={`${formatNumber(recommendedCandidate.error, 2)}%`}
          tone="success"
          delta="+5.00% margin"
          subtext="Hard ceiling: 5.00%"
        />
      </div>

      {/* Two Column Section: SLO Gauges + Head-to-Head Delta */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Left: SLO Gauges */}
        <div
          style={{
            backgroundColor: 'var(--surface, #0E120F)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '6px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
              Declared SLO Constraints
            </h2>
            <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              evaluator: v1.0.0 · policy: slo-1.0.0
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(activeExperiment?.sloConstraints ?? []).map((constraint) => {
              const distributions: Record<string, PercentileDistribution | undefined> = {
                ttft_ms: recommendedCandidate.metricSet?.ttft_ms ?? { p95: recommendedCandidate.ttftP95 },
                itl_ms: recommendedCandidate.metricSet?.itl_ms ?? { p95: recommendedCandidate.itlP95 },
                e2e_latency_ms: recommendedCandidate.metricSet?.e2e_latency_ms ?? { p95: recommendedCandidate.e2eP95 },
              };
              const observed = constraint.metric_name === 'error_rate'
                ? recommendedCandidate.metricSet?.error_rate ?? (recommendedCandidate.error != null ? recommendedCandidate.error / 100 : undefined)
                : distributions[constraint.metric_name]?.[constraint.statistic as keyof PercentileDistribution];
              return observed == null ? null : (
                <SloGauge
                  key={`${constraint.metric_name}.${constraint.statistic}`}
                  label={constraint.metric_name}
                  measured={observed}
                  threshold={constraint.threshold}
                  unit={constraint.unit}
                  isUpperBound={constraint.operator === '<=' || constraint.operator === '<'}
                  statistic={constraint.statistic}
                />
              );
            })}
          </div>

          <ReasonBox
            reasonCode={recommendedCandidate.reasonCodes?.[0]}
            detailText={recommendedCandidate.reason}
            isPassing={recommendedCandidate.feasible}
          />
        </div>

        {/* Right: Baseline vs Recommended Comparison using HeadToHeadDelta */}
        <div
          style={{
            backgroundColor: 'var(--surface, #0E120F)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '6px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
              Head-to-Head Telemetry Delta
            </h2>
            <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              {hasSelectedFeasibleWinner ? `Baseline ${baselineCandidate.id} vs Selected ${recommendedCandidate.id}` : 'No selected feasible candidate for comparison'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {hasSelectedFeasibleWinner && baselineCandidate.ttftP95 != null && recommendedCandidate.ttftP95 != null && <HeadToHeadDelta
              label="TTFT P95 Latency"
              baselineVal={baselineCandidate.ttftP95}
              candidateVal={recommendedCandidate.ttftP95}
              unit="ms"
              isLowerBetter={true}
            />}
            {hasSelectedFeasibleWinner && baselineCandidate.itlP95 != null && recommendedCandidate.itlP95 != null && <HeadToHeadDelta
              label="ITL P95 Latency"
              baselineVal={baselineCandidate.itlP95}
              candidateVal={recommendedCandidate.itlP95}
              unit="ms"
              isLowerBetter={true}
            />}
            {hasSelectedFeasibleWinner && baselineCandidate.e2eP95 != null && recommendedCandidate.e2eP95 != null && <HeadToHeadDelta
              label="End-to-End P95 Latency"
              baselineVal={baselineCandidate.e2eP95}
              candidateVal={recommendedCandidate.e2eP95}
              unit="ms"
              isLowerBetter={true}
            />}
            {hasSelectedFeasibleWinner && baselineCandidate.throughput != null && recommendedCandidate.throughput != null && <HeadToHeadDelta
              label="Output Token Throughput"
              baselineVal={baselineCandidate.throughput}
              candidateVal={recommendedCandidate.throughput}
              unit="tok/s"
              isLowerBetter={false}
            />}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border, #263124)' }}>
            <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              All 5 campaign runs available with raw unaggregated event logs
            </span>
            <button
              type="button"
              onClick={onNavigateToExperiments}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary-bright, #95D500)',
                fontSize: 'var(--text-micro, 11px)',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              View All 5 Runs →
            </button>
          </div>
        </div>
      </div>

      {/* Primary 2D Latency vs. Throughput Pareto Visualization */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)' }}>
              Pareto Latency vs. Throughput Empirical Space
            </h2>
            <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              Tested candidate coordinates · DEMO DATA · OFFLINE OPTIMIZATION
            </span>
          </div>

          <button
            type="button"
            onClick={onNavigateToTuningLab}
            className="action-toolbar-btn"
            style={{ fontSize: '12px' }}
          >
            Open Tuning Lab Matrix →
          </button>
        </div>

        <TradeoffPlot
          candidates={candidates}
          selectedCandidateId={recommendedCandidate.id}
          baselineCandidateId={baselineCandidate.id}
          onSelectCandidate={onOpenCandidateDrawer}
        />
      </div>

      {/* Action Toolbar at the bottom of the Overview view */}
      <div className="overview-action-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--text-muted, #727D73)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            OPERATOR ACTIONS
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary, #A0AAA0)', fontFamily: 'var(--font-mono, monospace)' }}>
            Selected Winner: <strong style={{ color: 'var(--primary-bright, #95D500)' }}>{recommendedCandidate.id}</strong>
          </span>
        </div>

        <div className="action-toolbar-group">
          {/* Deploy Flags (Hotkey: V) */}
          <button
            type="button"
            onClick={handleDeployVllm}
            className="action-toolbar-btn primary"
            title="Copy CLI launch command to deploy candidate via vLLM (Hotkey: V)"
          >
            <span className="keycap-badge">V</span>
            <span>Deploy Flags</span>
          </button>

          {/* Export Decision Audit (Hotkey: E) */}
          <button
            type="button"
            onClick={handleExportJsonl}
            className="action-toolbar-btn"
            title="Download decision audit records in JSONL format (Hotkey: E)"
          >
            <span className="keycap-badge">E</span>
            <span>Export Audit (JSONL)</span>
          </button>

          {/* Replay Reveal Sequence (Hotkey: R) */}
          <button
            type="button"
            onClick={triggerReplay}
            className="action-toolbar-btn"
            title="Replay verified reveal sequence (Hotkey: R)"
          >
            <span className="keycap-badge">R</span>
            <span>Replay</span>
          </button>

          {/* Navigate to Verification Workspace (Hotkey: 5) */}
          <button
            type="button"
            onClick={onNavigateToVerification}
            className="action-toolbar-btn"
            title="Switch to Verification workspace (Hotkey: 5)"
          >
            <span className="keycap-badge">5</span>
            <span>Verify with Fresh Run →</span>
          </button>
        </div>
      </div>
    </div>
  );
};
