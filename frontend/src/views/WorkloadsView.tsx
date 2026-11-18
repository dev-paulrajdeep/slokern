import React, { useState } from 'react';
import { DemoDataChip } from '../components/common/DemoDataChip';
import type { WorkloadSpec, ArrivalMode } from '../types/contracts';

interface PrecisionSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  subtext?: string;
  onChange: (val: number) => void;
  formatValue?: (val: number) => string;
}

export const PrecisionSlider: React.FC<PrecisionSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  subtext,
  onChange,
  formatValue,
}) => {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Label and Live Tabular Pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label
          htmlFor={id}
          style={{
            fontSize: '12px',
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 600,
            color: 'var(--text-secondary, #A0AAA0)',
          }}
        >
          {label}
        </label>
        <div
          className="tabular-nums"
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '4px',
            padding: '2px 8px',
            backgroundColor: 'var(--elevated, #1D251E)',
            border: '1px solid var(--border-strong, #384635)',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 700,
            color: 'var(--primary-bright, #95D500)',
            boxShadow: 'inset 0 1px 0 rgba(240, 243, 239, 0.05)',
          }}
        >
          <span>{formatValue ? formatValue(value) : value}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)', fontWeight: 500 }}>
            {unit}
          </span>
        </div>
      </div>

      {/* Track & Apple-grade Range Control */}
      <div style={{ position: 'relative', width: '100%', height: '26px', display: 'flex', alignItems: 'center' }}>
        {/* Track Rail */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '6px',
            backgroundColor: 'var(--raised, #151B15)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          {/* Neon Active Progress */}
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--primary, #76B900) 0%, var(--primary-bright, #95D500) 100%)',
              boxShadow: '0 0 8px rgba(118, 185, 0, 0.35)',
              transition: 'width 60ms linear',
            }}
          />
        </div>

        {/* Accessible Range Input */}
        <input
          type="range"
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={formatValue ? `${formatValue(value)} ${unit}` : `${value} ${unit}`}
          className="apple-range-slider"
          style={{
            position: 'relative',
            width: '100%',
            height: '26px',
            background: 'transparent',
            WebkitAppearance: 'none',
            appearance: 'none',
            cursor: 'pointer',
            zIndex: 2,
            margin: 0,
          }}
        />
      </div>

      {/* Min/Max Bound Annotations */}
      <div
        className="tabular-nums"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px',
          fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--text-muted, #727D73)',
        }}
      >
        <span>{min} {unit}</span>
        <span>{Math.round((min + max) / 2)} {unit}</span>
        <span>{max} {unit}</span>
      </div>

      {subtext && (
        <span style={{ fontSize: '11px', color: 'var(--text-muted, #727D73)', lineHeight: 1.35 }}>
          {subtext}
        </span>
      )}
    </div>
  );
};

interface TokenDistributionPreviewProps {
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const TokenDistributionPreview: React.FC<TokenDistributionPreviewProps> = ({
  maxInputTokens,
  maxOutputTokens,
}) => {
  const safeIn = Math.max(1, maxInputTokens);
  const safeOut = Math.max(1, maxOutputTokens);
  const ratio = (safeIn / safeOut).toFixed(1);
  const isPrefillHeavy = safeIn >= safeOut * 2;

  // Generate SVG curve points for prompt (prefill) and output (decode) distributions
  // Width: 420, Height: 90. Baseline at Y = 80.
  const promptPeakX = 130;
  const promptPath = `M 10 80 Q 70 80, 100 50 T ${promptPeakX} 18 T 170 55 T 260 78 L 290 80 L 10 80 Z`;
  const promptStroke = `M 10 80 Q 70 80, 100 50 T ${promptPeakX} 18 T 170 55 T 260 78 L 290 80`;

  const outputPath = `M 10 80 Q 30 75, 45 40 T 75 22 T 120 58 T 190 78 L 210 80 L 10 80 Z`;
  const outputStroke = `M 10 80 Q 30 75, 45 40 T 75 22 T 120 58 T 190 78 L 210 80`;

  return (
    <div
      style={{
        backgroundColor: 'var(--raised, #151B15)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '6px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)' }}>
            Empirical Token Distribution Preview
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: '3px',
              backgroundColor: isPrefillHeavy ? 'rgba(118, 185, 0, 0.12)' : 'rgba(233, 185, 73, 0.12)',
              border: `1px solid ${isPrefillHeavy ? 'rgba(118, 185, 0, 0.35)' : 'rgba(233, 185, 73, 0.35)'}`,
              color: isPrefillHeavy ? 'var(--primary-bright, #95D500)' : 'var(--warning, #E9B949)',
            }}
          >
            {isPrefillHeavy ? 'Prefill-Bound (GEMM)' : 'Decode-Bound (KV-Bandwidth)'}
          </span>
        </div>

        <div className="tabular-nums" style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #A0AAA0)' }}>
          Ratio: <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>{ratio}:1</span> (In/Out)
        </div>
      </div>

      {/* SVG Distribution Plot */}
      <div style={{ width: '100%', height: '95px', position: 'relative' }}>
        <svg viewBox="0 0 420 90" width="100%" height="95" preserveAspectRatio="none">
          <defs>
            <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#76B900" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#76B900" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E9B949" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#E9B949" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="10" y1="25" x2="410" y2="25" stroke="rgba(240, 243, 239, 0.05)" strokeDasharray="3 3" />
          <line x1="10" y1="52" x2="410" y2="52" stroke="rgba(240, 243, 239, 0.05)" strokeDasharray="3 3" />
          <line x1="10" y1="80" x2="410" y2="80" stroke="var(--border, #263124)" strokeWidth="1" />

          {/* Prompt Area & Line */}
          <path d={promptPath} fill="url(#promptGrad)" />
          <path d={promptStroke} fill="none" stroke="var(--primary, #76B900)" strokeWidth="2" strokeLinecap="round" />

          {/* Output Area & Line */}
          <path d={outputPath} fill="url(#outputGrad)" />
          <path d={outputStroke} fill="none" stroke="var(--warning, #E9B949)" strokeWidth="1.75" strokeDasharray="4 2" strokeLinecap="round" />

          {/* Cutoff Reference Markers */}
          <line x1="290" y1="12" x2="290" y2="80" stroke="var(--primary-bright, #95D500)" strokeWidth="1" strokeDasharray="2 2" />
          <text x="294" y="24" fill="var(--text-secondary, #A0AAA0)" fontSize="9" fontFamily="var(--font-mono, monospace)">
            Max In ({safeIn})
          </text>

          <line x1="210" y1="35" x2="210" y2="80" stroke="var(--warning, #E9B949)" strokeWidth="1" strokeDasharray="2 2" />
          <text x="214" y="45" fill="var(--warning, #E9B949)" fontSize="9" fontFamily="var(--font-mono, monospace)">
            Max Out ({safeOut})
          </text>
        </svg>
      </div>

      {/* Legend & Context Footprint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--primary-bright, #95D500)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'var(--primary, #76B900)' }} />
            Prompt Input (0–{safeIn} tok)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--warning, #E9B949)' }}>
            <span style={{ width: '8px', height: '2px', backgroundColor: 'var(--warning, #E9B949)' }} />
            Output Decode (0–{safeOut} tok)
          </span>
        </div>

        <div className="tabular-nums" style={{ color: 'var(--text-muted, #727D73)' }}>
          Total Context Window: <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>{safeIn + safeOut} tok</span>
        </div>
      </div>
    </div>
  );
};

interface WorkloadsViewProps {
  onSaveWorkload?: (spec: WorkloadSpec) => void;
  onLaunchBenchmark?: (spec: WorkloadSpec) => void;
  onOpenCampaignDrawer?: (workloadSpec: WorkloadSpec, sloSpec: any) => void;
  onRunProbe?: () => void;
  isLaunching?: boolean;
  isProbing?: boolean;
}

export const WorkloadsView: React.FC<WorkloadsViewProps> = ({
  onLaunchBenchmark,
  onOpenCampaignDrawer,
  onRunProbe,
  isLaunching = false,
  isProbing = false,
}) => {
  const [workloadName, setWorkloadName] = useState('chat-completions-prod');
  const [arrivalMode, setArrivalMode] = useState<ArrivalMode>('poisson');
  const [targetRate, setTargetRate] = useState(16);
  const [concurrency, setConcurrency] = useState(32);
  const [warmupSec, setWarmupSec] = useState(15);
  const [measureSec, setMeasureSec] = useState(60);
  const [maxInputTok, setMaxInputTok] = useState(1024);
  const [maxOutputTok, setMaxOutputTok] = useState(256);

  // SLO Ceilings
  const [ttftCeiling, setTtftCeiling] = useState(50);
  const [itlCeiling, setItlCeiling] = useState(15);
  const [throughputFloor, setThroughputFloor] = useState(50);
  const [errorRateCeiling, setErrorRateCeiling] = useState(1.0);

  const applyPreset = (preset: 'quick' | 'standard' | 'deep') => {
    if (preset === 'quick') {
      setWorkloadName('quick-test');
      setArrivalMode('constant');
      setTargetRate(5);
      setConcurrency(1);
      setWarmupSec(5);
      setMeasureSec(2);
      setMaxInputTok(64);
      setMaxOutputTok(32);
      setTtftCeiling(2500);
      setItlCeiling(25);
      setThroughputFloor(20);
      setErrorRateCeiling(1.0);
    } else if (preset === 'standard') {
      setWorkloadName('standard-eval');
      setArrivalMode('constant');
      setTargetRate(10);
      setConcurrency(2);
      setWarmupSec(8);
      setMeasureSec(15);
      setMaxInputTok(128);
      setMaxOutputTok(64);
      setTtftCeiling(2500);
      setItlCeiling(25);
      setThroughputFloor(20);
      setErrorRateCeiling(1.0);
    } else if (preset === 'deep') {
      setWorkloadName('deep-audit');
      setArrivalMode('poisson');
      setTargetRate(16);
      setConcurrency(32);
      setWarmupSec(15);
      setMeasureSec(60);
      setMaxInputTok(1024);
      setMaxOutputTok(256);
      setTtftCeiling(2500);
      setItlCeiling(25);
      setThroughputFloor(20);
      setErrorRateCeiling(1.0);
    }
  };

  // Hardened Validation (guards against NaN, Infinity, negative values, and empty strings)
  const errors: string[] = [];
  if (!workloadName || workloadName.trim().length === 0) {
    errors.push('Workload identifier cannot be empty');
  }
  if (arrivalMode === 'closed') {
    errors.push('Closed Concurrency (Contract declared; deferred in runner)');
  }
  if (Number.isNaN(targetRate) || !Number.isFinite(targetRate) || targetRate <= 0) {
    errors.push('Target rate must be a valid number > 0 rps');
  }
  if (Number.isNaN(concurrency) || !Number.isFinite(concurrency) || concurrency <= 0) {
    errors.push('Concurrency limit must be a valid integer > 0');
  }
  if (Number.isNaN(warmupSec) || !Number.isFinite(warmupSec) || warmupSec < 0) {
    errors.push('Warm-up duration must be >= 0s');
  }
  if (Number.isNaN(measureSec) || !Number.isFinite(measureSec) || measureSec < 2) {
    errors.push('Measurement duration must be at least 2s for reproducible benchmarking');
  }
  if (Number.isNaN(maxInputTok) || !Number.isFinite(maxInputTok) || maxInputTok <= 0) {
    errors.push('Max input tokens must be > 0');
  }
  if (Number.isNaN(maxOutputTok) || !Number.isFinite(maxOutputTok) || maxOutputTok <= 0) {
    errors.push('Max output tokens must be > 0');
  }
  if (Number.isNaN(ttftCeiling) || !Number.isFinite(ttftCeiling) || ttftCeiling <= 0) {
    errors.push('TTFT ceiling must be > 0 ms');
  }
  if (Number.isNaN(itlCeiling) || !Number.isFinite(itlCeiling) || itlCeiling <= 0) {
    errors.push('ITL ceiling must be > 0 ms');
  }
  if (Number.isNaN(throughputFloor) || !Number.isFinite(throughputFloor) || throughputFloor <= 0) {
    errors.push('Throughput floor must be > 0 tok/s');
  }
  if (Number.isNaN(errorRateCeiling) || !Number.isFinite(errorRateCeiling) || errorRateCeiling < 0) {
    errors.push('Error rate ceiling must be >= 0%');
  }

  const isValid = errors.length === 0;

  const currentSpec: WorkloadSpec = {
    schema_version: '1.0.0',
    workload_name: workloadName,
    fixture_id: 'sharegpt-v3-eval',
    arrival_mode: arrivalMode,
    target_offered_rate: targetRate,
    concurrency_limit: concurrency,
    warmup_duration_s: warmupSec,
    measurement_duration_s: measureSec,
    max_input_tokens: maxInputTok,
    max_output_tokens: maxOutputTok,
  };

  const currentSLOSpec = {
    slo_id: 'slo-custom',
    min_sample_count: 2,
    p95_ttft_threshold: ttftCeiling,
    itl_p95_threshold: itlCeiling,
    throughput_floor: throughputFloor,
    max_error_rate: errorRateCeiling / 100,
    constraints: [
      {
        metric_name: 'ttft_ms',
        statistic: 'p95' as const,
        threshold: ttftCeiling,
        unit: 'ms' as const,
        operator: '<=' as const,
      },
      {
        metric_name: 'itl_ms',
        statistic: 'p95' as const,
        threshold: itlCeiling,
        unit: 'ms' as const,
        operator: '<=' as const,
      },
      {
        metric_name: 'token_throughput_tps',
        statistic: 'mean' as const,
        threshold: throughputFloor,
        unit: 'requests/s' as const,
        operator: '>=' as const,
      },
      {
        metric_name: 'error_rate',
        statistic: 'mean' as const,
        threshold: errorRateCeiling / 100,
        unit: 'fraction' as const,
        operator: '<=' as const,
      },
    ],
  };

  return (
    <div className="view-workloads workspace-enter" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', letterSpacing: '-0.025em', textWrap: 'balance' }}>
              Workload & Service-Level Objectives
            </h1>
            <DemoDataChip size="sm" />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.45, textWrap: 'pretty', maxWidth: '75ch' }}>
            Define arrival patterns, token distributions, and hard constraint thresholds before measuring
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Secondary Action: Run Preflight Probe */}
          {onRunProbe && (
            <button
              type="button"
              onClick={onRunProbe}
              disabled={isProbing}
              data-testid="workloads-preflight-probe-btn"
              style={{
                backgroundColor: 'var(--surface, #0E120F)',
                border: '1px solid var(--border-strong, #384635)',
                color: isProbing ? 'var(--text-muted, #727D73)' : 'var(--text-primary, #F0F3EF)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
                padding: '8px 14px',
                borderRadius: '4px',
                cursor: isProbing ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>⚡</span>
              <span>{isProbing ? 'Running Preflight Probe...' : 'Run Preflight Probe'}</span>
            </button>
          )}

          {/* Primary Action: Configure & Launch 6-Run Campaign → */}
          <button
            type="button"
            onClick={() => {
              if (onOpenCampaignDrawer) {
                onOpenCampaignDrawer(currentSpec, currentSLOSpec);
              } else if (onLaunchBenchmark) {
                onLaunchBenchmark(currentSpec);
              }
            }}
            disabled={!isValid || isLaunching}
            data-testid="workloads-launch-campaign-btn"
            style={{
              backgroundColor: isValid && !isLaunching ? 'var(--primary, #76B900)' : 'var(--raised, #151B15)',
              border: '1px solid',
              borderColor: isValid && !isLaunching ? 'var(--primary-bright, #95D500)' : 'var(--border, #263124)',
              color: isValid && !isLaunching ? '#080A09' : 'var(--text-muted, #727D73)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              padding: '8px 18px',
              borderRadius: '4px',
              cursor: isValid && !isLaunching ? 'pointer' : 'not-allowed',
              boxShadow: isValid && !isLaunching ? '0 0 14px rgba(118, 185, 0, 0.25)' : 'none',
            }}
          >
            {isLaunching ? 'Launching Campaign...' : 'Configure & Launch 6-Run Campaign →'}
          </button>
        </div>
      </div>

      {/* Validation Errors Notice */}
      {errors.length > 0 && (
        <div style={{ padding: '12px 16px', backgroundColor: 'rgba(255, 85, 85, 0.1)', border: '1px solid rgba(255, 85, 85, 0.35)', borderRadius: '4px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--error, #FF5555)', marginBottom: '4px' }}>
            Specification Validation Blockers:
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-primary, #F0F3EF)' }}>
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Two Column Grid: Workload Parameters + Hard SLO Constraints */}
      <div className="workloads-form-grid">
        {/* Left: Workload Parameters */}
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
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
            Workload Traffic Profile
          </h2>

          {/* Quick-fill Workload Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary, #A0AAA0)', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
              Workload Quick Presets:
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => applyPreset('quick')}
                data-testid="preset-quick-btn"
                style={{
                  padding: '5px 10px',
                  backgroundColor: measureSec === 2 ? 'var(--elevated, #1D251E)' : 'var(--raised, #151B15)',
                  border: '1px solid',
                  borderColor: measureSec === 2 ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                  borderRadius: '3px',
                  color: measureSec === 2 ? 'var(--primary-bright, #95D500)' : 'var(--text-secondary, #A0AAA0)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Quick Test (2s)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('standard')}
                data-testid="preset-standard-btn"
                style={{
                  padding: '5px 10px',
                  backgroundColor: measureSec === 15 ? 'var(--elevated, #1D251E)' : 'var(--raised, #151B15)',
                  border: '1px solid',
                  borderColor: measureSec === 15 ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                  borderRadius: '3px',
                  color: measureSec === 15 ? 'var(--primary-bright, #95D500)' : 'var(--text-secondary, #A0AAA0)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Standard Evaluation (15s)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('deep')}
                data-testid="preset-deep-btn"
                style={{
                  padding: '5px 10px',
                  backgroundColor: measureSec === 60 ? 'var(--elevated, #1D251E)' : 'var(--raised, #151B15)',
                  border: '1px solid',
                  borderColor: measureSec === 60 ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                  borderRadius: '3px',
                  color: measureSec === 60 ? 'var(--primary-bright, #95D500)' : 'var(--text-secondary, #A0AAA0)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Deep Audit (60s)
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px', fontFamily: 'var(--font-mono, monospace)' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                Workload Identifier
              </label>
              <input
                type="text"
                value={workloadName}
                onChange={(e) => setWorkloadName(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  backgroundColor: 'var(--raised, #151B15)',
                  border: '1px solid var(--border, #263124)',
                  color: 'var(--text-primary, #F0F3EF)',
                  borderRadius: '4px',
                }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)' }}>
                  Arrival Pattern
                </label>
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--text-muted, #727D73)',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    padding: '1px 6px',
                    borderRadius: '2px',
                    border: '1px solid var(--border, #263124)',
                  }}
                >
                  Closed Concurrency (Contract declared; deferred in runner)
                </span>
              </div>
              <select
                value={arrivalMode}
                onChange={(e) => setArrivalMode(e.target.value as ArrivalMode)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  backgroundColor: 'var(--raised, #151B15)',
                  border: '1px solid var(--border, #263124)',
                  color: 'var(--text-primary, #F0F3EF)',
                  borderRadius: '4px',
                }}
              >
                <option value="poisson">Poisson Process (Stochastic Memoryless Inter-Arrivals)</option>
                <option value="constant">Constant Interval (Deterministic Cadence)</option>
                <option value="closed" disabled>
                  Closed Loop — Closed Concurrency (Contract declared; deferred in runner)
                </option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Target Offered Rate (rps)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isNaN(targetRate) ? '' : targetRate}
                  onChange={(e) => setTargetRate(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Concurrency Limit
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isNaN(concurrency) ? '' : concurrency}
                  onChange={(e) => setConcurrency(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Warm-up Duration (s)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={Number.isNaN(warmupSec) ? '' : warmupSec}
                  onChange={(e) => setWarmupSec(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Measure Duration (s)
                </label>
                <input
                  type="number"
                  min="2"
                  step="1"
                  value={Number.isNaN(measureSec) ? '' : measureSec}
                  onChange={(e) => setMeasureSec(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Max Input Tokens
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isNaN(maxInputTok) ? '' : maxInputTok}
                  onChange={(e) => setMaxInputTok(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-secondary, #A0AAA0)', marginBottom: '4px' }}>
                  Max Output Tokens
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isNaN(maxOutputTok) ? '' : maxOutputTok}
                  onChange={(e) => setMaxOutputTok(e.target.value === '' ? NaN : Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    backgroundColor: 'var(--raised, #151B15)',
                    border: '1px solid var(--border, #263124)',
                    color: 'var(--text-primary, #F0F3EF)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            {/* Empirical Token Distribution Preview */}
            <TokenDistributionPreview
              maxInputTokens={Number.isNaN(maxInputTok) ? 1024 : maxInputTok}
              maxOutputTokens={Number.isNaN(maxOutputTok) ? 256 : maxOutputTok}
            />
          </div>
        </div>

        {/* Right: Hard SLO Constraints */}
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
              Deterministic Hard Constraints
            </h2>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--primary-bright, #95D500)' }}>
              policy: slo-prod-03
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <PrecisionSlider
              id="slo-ttft-slider"
              label="TTFT Ceiling (P95 Latency)"
              value={ttftCeiling}
              min={20}
              max={150}
              step={1}
              unit="ms"
              subtext="Maximum allowable time to first token for prefill burst."
              onChange={setTtftCeiling}
            />

            <PrecisionSlider
              id="slo-itl-slider"
              label="ITL Ceiling (P95 Inter-Token Latency)"
              value={itlCeiling}
              min={5}
              max={50}
              step={1}
              unit="ms"
              subtext="Maximum token generation cadence during decode phase."
              onChange={setItlCeiling}
            />

            <PrecisionSlider
              id="slo-throughput-slider"
              label="Throughput Floor"
              value={throughputFloor}
              min={20}
              max={120}
              step={1}
              unit="k tok/s"
              subtext="Minimum aggregate token throughput required to pass."
              onChange={setThroughputFloor}
            />

            <PrecisionSlider
              id="slo-error-slider"
              label="Error Rate Ceiling"
              value={errorRateCeiling}
              min={0.1}
              max={5.0}
              step={0.1}
              unit="%"
              formatValue={(val) => val.toFixed(1)}
              subtext="Strict rejection threshold for non-200 HTTP responses."
              onChange={setErrorRateCeiling}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
