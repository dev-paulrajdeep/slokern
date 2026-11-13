import React, { useState, useEffect } from 'react';
import { SlideOverDrawer } from '../layout/SlideOverDrawer';
import { Badge } from '../common/Badge';
import { DemoDataChip } from '../common/DemoDataChip';
import { VerifiedReveal } from '../stage/VerifiedReveal';
import { launchCampaign, subscribeCampaignStream } from '../../api/client';
import { formatNumber, formatLatency } from '../../lib/format';
import {
  WORKLOAD_PRESETS,
  createInitialTimelineState,
  reduceCampaignTimelineEvent,
  type DualModeTarget,
  type CampaignPresetKey,
  type WorkloadPresetConfig,
  type RunTimelineItem,
  type CampaignTimelineState,
} from '../../lib/campaign';

export {
  WORKLOAD_PRESETS,
  createInitialTimelineState,
  reduceCampaignTimelineEvent,
  type DualModeTarget,
  type CampaignPresetKey,
  type WorkloadPresetConfig,
  type RunTimelineItem,
  type CampaignTimelineState,
};

interface CampaignLaunchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCampaignCompleted?: (campaignId: string) => void;
  onSelectExperiment?: (experimentId: string) => void;
}

export const CampaignLaunchDrawer: React.FC<CampaignLaunchDrawerProps> = ({
  isOpen,
  onClose,
  onCampaignCompleted,
  onSelectExperiment,
}) => {
  // Dual-mode Serving Target Selection
  const [servingTarget, setServingTarget] = useState<DualModeTarget>('local');
  const [presetKey, setPresetKey] = useState<CampaignPresetKey>('quick');

  // Custom Workload & SLO State
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [targetRate, setTargetRate] = useState<number>(5.0);
  const [durationSeconds, setDurationSeconds] = useState<number>(2);
  const [concurrencyLimit, setConcurrencyLimit] = useState<number>(1);
  const [ttftThreshold, setTtftThreshold] = useState<number>(2500.0);
  const [maxErrorRate, setMaxErrorRate] = useState<number>(0.05);

  // Live SSE Timeline State
  const [timeline, setTimeline] = useState<CampaignTimelineState>(createInitialTimelineState());
  const [isLaunching, setIsLaunching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeSubscriptionRef = React.useRef<(() => void) | null>(null);

  // Sync preset changes to input values
  const handleSelectPreset = (key: CampaignPresetKey) => {
    setPresetKey(key);
    if (key === 'quick') {
      setTargetRate(WORKLOAD_PRESETS.quick.targetOfferedRate);
      setDurationSeconds(WORKLOAD_PRESETS.quick.durationSeconds);
      setConcurrencyLimit(WORKLOAD_PRESETS.quick.concurrencyLimit);
    } else if (key === 'standard') {
      setTargetRate(WORKLOAD_PRESETS.standard.targetOfferedRate);
      setDurationSeconds(WORKLOAD_PRESETS.standard.durationSeconds);
      setConcurrencyLimit(WORKLOAD_PRESETS.standard.concurrencyLimit);
    }
  };

  // Adjust default TTFT threshold depending on target
  useEffect(() => {
    if (servingTarget === 'local') {
      setTtftThreshold(2500.0);
    } else {
      setTtftThreshold(150.0);
    }
  }, [servingTarget]);

  // Clean up any active stream on unmount
  useEffect(() => {
    return () => {
      activeSubscriptionRef.current?.();
      activeSubscriptionRef.current = null;
    };
  }, []);

  const handleLaunchCampaign = async () => {
    setIsLaunching(true);
    setErrorMessage(null);
    activeSubscriptionRef.current?.();
    const initial = createInitialTimelineState();
    setTimeline(initial);

    try {
      const payload: Record<string, any> = {
        adapter: servingTarget,
        model_name:
          servingTarget === 'local'
            ? 'qwen3:4b-instruct-2507-q4_K_M'
            : 'fake-qwen-4b',
        workload: {
          workload_name: `${servingTarget}-tuning-run`,
          arrival_mode: 'constant',
          target_offered_rate: Number(targetRate),
          measurement_duration_s: Number(durationSeconds),
          warmup_duration_s: 0,
          concurrency_limit: Number(concurrencyLimit),
          max_input_tokens: 64,
          max_output_tokens: 32,
        },
        slo: {
          p95_ttft_threshold: Number(ttftThreshold),
          max_error_rate: Number(maxErrorRate),
        },
      };

      const res = await launchCampaign(payload);
      setTimeline((prev) => ({ ...prev, campaignId: res.campaign_id, status: 'running' }));

      // Subscribe to real-time SSE stream
      activeSubscriptionRef.current = subscribeCampaignStream(
        res.campaign_id,
        (event) => {
          setTimeline((prev) => {
            const next = reduceCampaignTimelineEvent(prev, event);
            if (event.type === 'campaign_completed') {
              setIsLaunching(false);
              onCampaignCompleted?.(res.campaign_id);
            }
            return next;
          });
        },
        () => {
          setIsLaunching(false);
        },
        (err) => {
          console.warn('Campaign SSE connection notice:', err);
        }
      );
    } catch (err: any) {
      setIsLaunching(false);
      setErrorMessage(err.message || 'Failed to start optimization campaign');
      setTimeline((prev) => ({ ...prev, status: 'failed', error: err.message }));
    }
  };

  const isCompleted = timeline.status === 'completed';
  const isRunning = timeline.status === 'running' || isLaunching;
  const isVerifiedWinner = timeline.verificationOutcome?.isVerified ?? false;

  return (
    <SlideOverDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Optimization Campaign Runner"
      subtitle="Bounded 2x2 Grid Search with Real-Time SSE Verification"
      width="640px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Error Banner */}
        {errorMessage && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: 'rgba(224, 82, 82, 0.12)',
              border: '1px solid var(--danger, #E05252)',
              borderRadius: '4px',
              color: 'var(--danger, #E05252)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Section 1: Dual-Mode Serving Target Selector */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-secondary, #A0AAA0)',
              marginBottom: '8px',
            }}
          >
            Serving Target
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Local Ollama Option */}
            <div
              onClick={() => !isRunning && setServingTarget('local')}
              data-testid="target-local"
              style={{
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor:
                  servingTarget === 'local' ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                backgroundColor:
                  servingTarget === 'local' ? 'var(--raised, #151B15)' : 'var(--surface, #0E120F)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                boxShadow: servingTarget === 'local' ? '0 0 12px rgba(118, 185, 0, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--text-primary, #F0F3EF)',
                  }}
                >
                  Local Ollama
                </span>
                <Badge tone="verified" size="sm">
                  LIVE
                </Badge>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)' }}>
                Host RTX 5060 · Loopback 127.0.0.1:11434
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--primary-bright, #95D500)',
                }}
              >
                qwen3:4b-instruct-2507-q4_K_M
              </span>
            </div>

            {/* Fake Serving Adapter Option */}
            <div
              onClick={() => !isRunning && setServingTarget('fake')}
              data-testid="target-fake"
              style={{
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor:
                  servingTarget === 'fake' ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                backgroundColor:
                  servingTarget === 'fake' ? 'var(--raised, #151B15)' : 'var(--surface, #0E120F)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                boxShadow: servingTarget === 'fake' ? '0 0 12px rgba(118, 185, 0, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--text-primary, #F0F3EF)',
                  }}
                >
                  Fake Adapter
                </span>
                <DemoDataChip size="sm" />
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)' }}>
                In-process simulated inference model
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-secondary, #A0AAA0)',
                }}
              >
                fake-qwen-4b (Fast Mock)
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Workload Presets */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-secondary, #A0AAA0)',
              marginBottom: '8px',
            }}
          >
            Workload Evaluation Presets
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => handleSelectPreset('quick')}
              data-testid="preset-quick"
              style={{
                padding: '10px 12px',
                backgroundColor:
                  presetKey === 'quick' ? 'var(--raised, #151B15)' : 'var(--surface, #0E120F)',
                border: '1px solid',
                borderColor:
                  presetKey === 'quick' ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                borderRadius: '4px',
                color:
                  presetKey === 'quick'
                    ? 'var(--text-primary, #F0F3EF)'
                    : 'var(--text-secondary, #A0AAA0)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '2px' }}>
                Quick Benchmark
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)' }}>
                2s duration · 5 rps · 20 reqs
              </div>
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={() => handleSelectPreset('standard')}
              data-testid="preset-standard"
              style={{
                padding: '10px 12px',
                backgroundColor:
                  presetKey === 'standard' ? 'var(--raised, #151B15)' : 'var(--surface, #0E120F)',
                border: '1px solid',
                borderColor:
                  presetKey === 'standard' ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                borderRadius: '4px',
                color:
                  presetKey === 'standard'
                    ? 'var(--text-primary, #F0F3EF)'
                    : 'var(--text-secondary, #A0AAA0)',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '2px' }}>
                Standard SLO Evaluation
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)' }}>
                5s duration · 10 rps · 50 reqs
              </div>
            </button>
          </div>
        </div>

        {/* Section 3: Advanced Workload & SLO Accordion */}
        <div style={{ border: '1px solid var(--border, #263124)', borderRadius: '4px' }}>
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: 'var(--surface, #0E120F)',
              border: 'none',
              color: 'var(--text-secondary, #A0AAA0)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <span>Custom Workload & SLO Constraints</span>
            <span>{isAdvancedOpen ? '▲ Hide' : '▼ Expand'}</span>
          </button>

          {isAdvancedOpen && (
            <div
              style={{
                padding: '12px',
                backgroundColor: 'var(--raised, #151B15)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              <div>
                <label style={{ display: 'block', color: 'var(--text-muted, #727D73)', marginBottom: '4px' }}>
                  Target Rate (rps):
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  disabled={isRunning}
                  value={targetRate}
                  onChange={(e) => {
                    setTargetRate(parseFloat(e.target.value) || 1.0);
                    setPresetKey('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    backgroundColor: 'var(--surface, #0E120F)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '3px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-muted, #727D73)', marginBottom: '4px' }}>
                  Duration (seconds):
                </label>
                <input
                  type="number"
                  min="1"
                  disabled={isRunning}
                  value={durationSeconds}
                  onChange={(e) => {
                    setDurationSeconds(parseInt(e.target.value, 10) || 1);
                    setPresetKey('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    backgroundColor: 'var(--surface, #0E120F)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '3px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-muted, #727D73)', marginBottom: '4px' }}>
                  P95 TTFT Ceiling (ms):
                </label>
                <input
                  type="number"
                  min="10"
                  step="50"
                  disabled={isRunning}
                  value={ttftThreshold}
                  onChange={(e) => {
                    setTtftThreshold(parseFloat(e.target.value) || 2500.0);
                    setPresetKey('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    backgroundColor: 'var(--surface, #0E120F)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '3px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-muted, #727D73)', marginBottom: '4px' }}>
                  Max Error Rate (fraction):
                </label>
                <input
                  type="number"
                  min="0.0"
                  max="1.0"
                  step="0.01"
                  disabled={isRunning}
                  value={maxErrorRate}
                  onChange={(e) => {
                    setMaxErrorRate(parseFloat(e.target.value) || 0.05);
                    setPresetKey('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    backgroundColor: 'var(--surface, #0E120F)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '3px',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Action Button */}
        <div>
          <button
            type="button"
            onClick={handleLaunchCampaign}
            disabled={isRunning}
            data-testid="start-campaign-btn"
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: isRunning ? 'var(--raised, #151B15)' : 'var(--primary, #76B900)',
              border: 'none',
              borderRadius: '4px',
              color: isRunning ? 'var(--text-secondary, #A0AAA0)' : '#0E120F',
              fontSize: '13px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: isRunning ? 'none' : '0 0 16px rgba(118, 185, 0, 0.3)',
            }}
          >
            {isRunning ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    border: '2px solid var(--text-secondary, #A0AAA0)',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span>Campaign Executing in Background ({timeline.currentRunIndex + 1}/6)...</span>
              </>
            ) : (
              <>
                <span>▶</span>
                <span>Start 6-Run Optimization Campaign</span>
              </>
            )}
          </button>
        </div>

        {/* Section 5: Live 6-Run Visual Timeline */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <label
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-secondary, #A0AAA0)',
              }}
            >
              Execution Timeline (6 Runs Total)
            </label>
            {timeline.campaignId && (
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-muted, #727D73)',
                }}
              >
                ID: {timeline.campaignId}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {timeline.runs.map((run) => {
              const isRunActive = run.status === 'running';
              const isRunDone = run.status === 'completed';

              return (
                <div
                  key={run.runIndex}
                  data-testid={`run-timeline-item-${run.runIndex}`}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: isRunActive
                      ? 'var(--raised, #151B15)'
                      : 'var(--surface, #0E120F)',
                    border: '1px solid',
                    borderColor: isRunActive
                      ? 'var(--primary, #76B900)'
                      : isRunDone
                      ? 'var(--border-strong, #384635)'
                      : 'var(--border, #263124)',
                    borderRadius: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono, monospace)',
                          color: isRunActive
                            ? 'var(--primary-bright, #95D500)'
                            : 'var(--text-primary, #F0F3EF)',
                        }}
                      >
                        {run.stageTag}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary, #A0AAA0)' }}>
                        {run.stageName}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {run.verdict && (
                        <Badge
                          tone={
                            run.verdict === 'FEASIBLE' || run.verdict === 'VERIFIED'
                              ? 'verified'
                              : 'infeasible'
                          }
                          size="sm"
                        >
                          {run.verdict}
                        </Badge>
                      )}
                      {isRunActive && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono, monospace)',
                            color: 'var(--primary-bright, #95D500)',
                            animation: 'pulse 1.5s infinite',
                          }}
                        >
                          ● RUNNING
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Settings or Candidate ID */}
                  {run.candidateId && (
                    <div
                      style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono, monospace)',
                        color: 'var(--text-muted, #727D73)',
                      }}
                    >
                      Candidate: {run.candidateId}
                      {run.rankingMetric != null && ` · Throughput: ${formatNumber(run.rankingMetric, 1)} tok/s`}
                    </div>
                  )}

                  {/* Progress Bar */}
                  {(isRunActive || isRunDone) && (
                    <div style={{ marginTop: '2px' }}>
                      <div
                        style={{
                          width: '100%',
                          height: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${run.progressPercent}%`,
                            height: '100%',
                            backgroundColor: isRunDone
                              ? run.verdict === 'FEASIBLE' || run.verdict === 'VERIFIED'
                                ? 'var(--primary, #76B900)'
                                : 'var(--danger, #E05252)'
                              : 'var(--primary-bright, #95D500)',
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>
                      {isRunActive && run.totalReqs > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono, monospace)',
                            color: 'var(--text-secondary, #A0AAA0)',
                            marginTop: '4px',
                          }}
                        >
                          <span>Progress: {run.completedReqs}/{run.totalReqs} reqs</span>
                          {run.currentTtftMs != null && (
                            <span>TTFT: {formatLatency(run.currentTtftMs)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 6: Final Verification Reveal & Winner Details */}
        {isCompleted && (
          <div style={{ marginTop: '10px' }}>
            <VerifiedReveal isVerified={isVerifiedWinner}>
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--surface, #0E120F)',
                  border: '1px solid',
                  borderColor: isVerifiedWinner
                    ? 'var(--primary, #76B900)'
                    : 'var(--border-strong, #384635)',
                  borderRadius: '6px',
                  boxShadow: isVerifiedWinner
                    ? '0 0 24px rgba(118, 185, 0, 0.2)'
                    : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)' }}>
                    Campaign Verification Complete
                  </div>
                  <Badge tone={isVerifiedWinner ? 'verified' : 'infeasible'}>
                    {timeline.verificationOutcome?.verdict || 'COMPLETED'}
                  </Badge>
                </div>

                {timeline.winner && timeline.winner.id ? (
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted, #727D73)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Winning Configuration
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono, monospace)',
                        color: 'var(--primary-bright, #95D500)',
                        marginTop: '2px',
                      }}
                    >
                      {timeline.winner.id}
                    </div>
                    {timeline.winner.rankingMetric != null && (
                      <div
                        style={{
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--text-primary, #F0F3EF)',
                          marginTop: '2px',
                        }}
                      >
                        Throughput: {formatNumber(timeline.winner.rankingMetric, 1)} tokens/s
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary, #A0AAA0)',
                        marginTop: '6px',
                        lineHeight: 1.4,
                      }}
                    >
                      {timeline.winner.rationale}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--warning, #E9B949)' }}>
                    No tested configuration satisfied all declared hard SLO constraints.
                  </div>
                )}

                {/* Metric Drift Breakdown */}
                {timeline.verificationOutcome && (
                  <div
                    style={{
                      padding: '10px 12px',
                      backgroundColor: 'var(--raised, #151B15)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    <div
                      style={{
                        color: 'var(--text-secondary, #A0AAA0)',
                        fontWeight: 700,
                        marginBottom: '6px',
                      }}
                    >
                      Independent Verification Drift Breakdown:
                    </div>
                    {Object.keys(timeline.verificationOutcome.deltas).length > 0 ? (
                      Object.entries(timeline.verificationOutcome.deltas).map(([k, v]) => (
                        <div
                          key={k}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            color: 'var(--text-primary, #F0F3EF)',
                            padding: '2px 0',
                          }}
                        >
                          <span>{k} drift</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === 'number' ? (v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`) : `${v}%`}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: 'var(--text-muted, #727D73)' }}>
                        Drift within declared tolerance thresholds.
                      </div>
                    )}
                  </div>
                )}

                {/* Finish actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  {timeline.campaignId && onSelectExperiment && (
                    <button
                      type="button"
                      onClick={() => {
                        if (timeline.campaignId) {
                          onSelectExperiment(timeline.campaignId);
                          onClose();
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        backgroundColor: 'var(--elevated, #1D251E)',
                        border: '1px solid var(--border-strong, #384635)',
                        borderRadius: '4px',
                        color: 'var(--primary-bright, #95D500)',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Inspect in Tuning Lab →
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'var(--raised, #151B15)',
                      border: '1px solid var(--border, #263124)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary, #A0AAA0)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono, monospace)',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </VerifiedReveal>
          </div>
        )}
      </div>
    </SlideOverDrawer>
  );
};
