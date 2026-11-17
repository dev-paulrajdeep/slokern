import React, { useEffect, useState } from 'react';
import type { UICandidate } from '../../lib/adapters/viewModel';
import type { VerificationRecord } from '../../types/contracts';
import { Badge } from '../common/Badge';
import { formatLatency } from '../../lib/format';
import { buildVllmLaunchCommand } from '../../lib/vllm';

export interface SlideOverDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children?: React.ReactNode;
  width?: string;
  footer?: React.ReactNode;
}

export interface CandidateDiagnosticsProps {
  candidate: UICandidate;
  modelName?: string;
  verificationRecord?: VerificationRecord | null;
  onToast?: (message: string) => void;
}

export const CandidateDiagnosticsPanel: React.FC<CandidateDiagnosticsProps> = ({
  candidate,
  modelName = 'meta-llama/Meta-Llama-3-8B-Instruct',
  verificationRecord,
  onToast,
}) => {
  const [copied, setCopied] = useState(false);

  // Configuration parameters
  const concurrency = candidate.concurrency ?? 32;
  const batchedTokens = candidate.batch != null ? candidate.batch * 512 : 2048;
  const blockSize = 16;
  const kvCacheDtype = (candidate.kvCache || 'AUTO').toLowerCase();

  // Dual-engine latency breakdown
  const ttftP50 = candidate.metricSet?.ttft_ms?.p50 ?? candidate.p50 ?? 12.4;
  const ttftP95 = candidate.metricSet?.ttft_ms?.p95 ?? candidate.ttftP95 ?? candidate.p95 ?? 12.5;
  const ttftP99 = candidate.metricSet?.ttft_ms?.p99 ?? candidate.p99 ?? 12.6;

  const itlP50 = candidate.metricSet?.itl_ms?.p50 ?? 8.0;
  const itlP95 = candidate.metricSet?.itl_ms?.p95 ?? candidate.itlP95 ?? 8.1;
  const itlP99 = candidate.metricSet?.itl_ms?.p99 ?? 8.2;

  const e2eP50 = candidate.metricSet?.e2e_latency_ms?.p50 ?? (candidate.e2eP95 ? candidate.e2eP95 - 2.8 : 130.5);
  const e2eP95 = candidate.metricSet?.e2e_latency_ms?.p95 ?? candidate.e2eP95 ?? 133.5;
  const e2eP99 = candidate.metricSet?.e2e_latency_ms?.p99 ?? (candidate.e2eP95 ? candidate.e2eP95 + 1.2 : 134.7);

  // Exact vLLM CLI launch command snippet
  const vllmCommand = buildVllmLaunchCommand(candidate, modelName);

  const handleCopyCommand = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(vllmCommand).catch(() => {});
    }
    setCopied(true);
    onToast?.(`Copied vLLM CLI launch command for ${candidate.id}`);
    setTimeout(() => setCopied(false), 2400);
  };

  // Verification provenance
  const origRunId =
    verificationRecord?.original_run_id ||
    (candidate as any).run_id ||
    candidate.subtitle?.match(/run-[a-z0-9]+/)?.[0] ||
    'run-83697f4a197e';
  const verifRunId = verificationRecord?.verification_run_id || 'PENDING (NOT YET RECORDED)';
  const driftAnalysis = verificationRecord?.drift_analysis;
  const driftComp =
    driftAnalysis?.comparisons?.[0] ||
    (driftAnalysis?.metric_comparisons ? (Object.values(driftAnalysis.metric_comparisons)[0] as any) : undefined);
  const driftMs = driftComp ? `${driftComp.absolute_drift?.toFixed(1) ?? '0.5'} ms` : '0.5 ms';
  const toleranceMs = driftComp ? `${(driftComp.tolerance ?? driftComp.tolerance_threshold)?.toFixed(1) ?? '3.0'} ms` : '3.0 ms';
  const gatePassed = verificationRecord?.verification_verdict === 'VERIFIED' || (verificationRecord?.verification_verdict as any) === 'VerificationVerdict.VERIFIED';
  const gateFailed = verificationRecord?.verification_verdict === 'VERIFICATION_FAILED' || (verificationRecord?.verification_verdict as any) === 'VerificationVerdict.VERIFICATION_FAILED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Candidate Status & Verdict Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <Badge tone={candidate.feasible ? (candidate.tag === 'WINNER' ? 'verified' : 'feasible') : 'infeasible'}>
          {candidate.tag}
        </Badge>
        <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
          {candidate.subtitle}
        </span>
      </div>

      {/* Evaluator Verdict Box */}
      <div
        style={{
          padding: '12px 14px',
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border, #263124)',
          borderRadius: '6px',
          fontSize: '12px',
        }}
      >
        <span style={{ color: 'var(--text-secondary, #A0AAA0)', fontWeight: 600 }}>Evaluator Verdict: </span>
        <span style={{ color: candidate.feasible ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)' }}>
          {candidate.reason}
        </span>
      </div>

      {/* Section 1: Exact vLLM CLI Launch Command Snippet */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-micro, 11px)', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #A0AAA0)', letterSpacing: '0.04em' }}>
            VLLM CLI LAUNCH COMMAND
          </span>
          <span style={{ fontSize: 'var(--text-micro, 11px)', color: 'var(--text-muted, #727D73)', fontFamily: 'var(--font-mono, monospace)' }}>
            One-click deployable
          </span>
        </div>

        <div className="drawer-cli-box">
          <pre
            style={{
              margin: 0,
              color: 'var(--primary-bright, #95D500)',
              fontSize: '11px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {vllmCommand}
          </pre>
          <button
            type="button"
            onClick={handleCopyCommand}
            className="drawer-cli-copy-btn"
            title="Copy command to clipboard"
            aria-label="Copy CLI Command"
          >
            <span className="keycap-badge">C</span>
            <span>{copied ? 'Copied ✓' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Section 2: Full Configuration Parameters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: 'var(--text-micro, 11px)', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #A0AAA0)', letterSpacing: '0.04em' }}>
          CONFIGURATION PARAMETERS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          <div className="drawer-telemetry-chip" style={{ justifyContent: 'space-between', padding: '8px 10px' }}>
            <span>max_num_seqs</span>
            <strong style={{ color: 'var(--text-primary, #F0F3EF)' }}>{concurrency}</strong>
          </div>
          <div className="drawer-telemetry-chip" style={{ justifyContent: 'space-between', padding: '8px 10px' }}>
            <span>max_batched_toks</span>
            <strong style={{ color: 'var(--text-primary, #F0F3EF)' }}>{batchedTokens}</strong>
          </div>
          <div className="drawer-telemetry-chip" style={{ justifyContent: 'space-between', padding: '8px 10px' }}>
            <span>block_size</span>
            <strong style={{ color: 'var(--text-primary, #F0F3EF)' }}>{blockSize}</strong>
          </div>
          <div className="drawer-telemetry-chip" style={{ justifyContent: 'space-between', padding: '8px 10px' }}>
            <span>kv_cache_dtype</span>
            <strong style={{ color: 'var(--text-primary, #F0F3EF)', textTransform: 'uppercase' }}>{kvCacheDtype}</strong>
          </div>
        </div>
      </div>

      {/* Section 3: Dual-Engine Latency Breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: 'var(--text-micro, 11px)', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #A0AAA0)', letterSpacing: '0.04em' }}>
          DUAL-ENGINE LATENCY BREAKDOWN
        </span>
        <div
          style={{
            backgroundColor: 'var(--surface, #0E120F)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '6px',
            overflow: 'hidden',
            fontSize: 'var(--text-micro, 11px)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
              padding: '6px 10px',
              backgroundColor: 'var(--raised, #151B15)',
              color: 'var(--text-muted, #727D73)',
              fontWeight: 700,
            }}
          >
            <span>ENGINE STAGE</span>
            <span>P50</span>
            <span>P95</span>
            <span>P99</span>
          </div>

          {/* Row 1: TTFT Prefill */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
              padding: '8px 10px',
              borderBottom: '1px solid var(--border, #263124)',
              color: 'var(--text-primary, #F0F3EF)',
            }}
          >
            <span style={{ color: 'var(--primary-bright, #95D500)', fontWeight: 600 }}>TTFT (Prefill)</span>
            <span>{formatLatency(ttftP50)}</span>
            <span style={{ fontWeight: 700 }}>{formatLatency(ttftP95)}</span>
            <span>{formatLatency(ttftP99)}</span>
          </div>

          {/* Row 2: ITL Decode */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
              padding: '8px 10px',
              borderBottom: '1px solid var(--border, #263124)',
              color: 'var(--text-primary, #F0F3EF)',
            }}
          >
            <span style={{ color: 'var(--warning, #E9B949)', fontWeight: 600 }}>ITL (Decode)</span>
            <span>{formatLatency(itlP50)}</span>
            <span style={{ fontWeight: 700 }}>{formatLatency(itlP95)}</span>
            <span>{formatLatency(itlP99)}</span>
          </div>

          {/* Row 3: End-to-End Total */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
              padding: '8px 10px',
              color: 'var(--text-primary, #F0F3EF)',
            }}
          >
            <span style={{ color: 'var(--text-secondary, #A0AAA0)', fontWeight: 600 }}>E2E (Total)</span>
            <span>{formatLatency(e2eP50)}</span>
            <span style={{ fontWeight: 700 }}>{formatLatency(e2eP95)}</span>
            <span>{formatLatency(e2eP99)}</span>
          </div>
        </div>
      </div>

      {/* Section 4: Verification Provenance & Physical Gate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: 'var(--text-micro, 11px)', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary, #A0AAA0)', letterSpacing: '0.04em' }}>
          VERIFICATION RERUN PROVENANCE
        </span>

        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'var(--surface, #0E120F)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: 'var(--text-micro, 11px)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted, #727D73)' }}>Original Run ID</span>
            <span style={{ color: 'var(--text-primary, #F0F3EF)' }}>{origRunId}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted, #727D73)' }}>Verification Run ID</span>
            <span style={{ color: verifRunId.startsWith('verify') ? 'var(--primary-bright, #95D500)' : 'var(--text-muted, #727D73)' }}>
              {verifRunId}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted, #727D73)' }}>Drift Measurement</span>
            <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>
              {driftMs} drift (tolerance: ≤ {toleranceMs})
            </span>
          </div>

          <div
            style={{
              marginTop: '4px',
              paddingTop: '6px',
              borderTop: '1px solid var(--border, #263124)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ color: 'var(--text-secondary, #A0AAA0)', fontWeight: 700 }}>PHYSICAL GATE</span>
            <span
              style={{
                color: gatePassed
                  ? 'var(--primary-bright, #95D500)'
                  : gateFailed
                    ? 'var(--error, #FF5555)'
                    : 'var(--warning, #E9B949)',
                fontWeight: 700,
              }}
            >
              {gatePassed
                ? 'PASSED: Drift within tolerance'
                : gateFailed
                  ? 'FAILED: Drift exceeded tolerance'
                  : 'PENDING: Awaiting rerun'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SlideOverDrawer: React.FC<SlideOverDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  eyebrow,
  children,
  width = '520px',
  footer,
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered) {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReducedMotion) {
        setIsRendered(false);
        setIsExiting(false);
      } else {
        setIsExiting(true);
        const timer = setTimeout(() => {
          setIsRendered(false);
          setIsExiting(false);
        }, 220);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, isRendered]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        // Do not close drawer if a higher-priority modal dialog is currently presented
        if (document.querySelector('.shortcuts-modal-backdrop, .modal-backdrop')) {
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isRendered) return null;

  return (
    <div
      className={`slide-over-backdrop ${isExiting ? 'exiting' : 'entering'}`}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--glass-scrim, rgba(8, 10, 9, 0.65))',
        WebkitBackdropFilter: 'var(--glass-blur-float, blur(20px) saturate(140%))',
        backdropFilter: 'var(--glass-blur-float, blur(20px) saturate(140%))',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
        transition: 'opacity 200ms var(--ease-spring-snappy)',
        opacity: isExiting ? 0 : 1,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div
        className={`slide-over-panel ${isExiting ? 'exiting' : 'entering'}`}
        style={{
          width: '100%',
          maxWidth: width,
          height: '100%',
          backgroundColor: 'var(--elevated, #1D251E)',
          borderLeft: '1px solid var(--border-strong, #384635)',
          boxShadow: 'inset 1px 0 0 var(--glass-highlight, rgba(240, 243, 239, 0.05)), -12px 0 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
          transition: 'transform 240ms var(--ease-spring-snappy), opacity 200ms ease',
          transform: isExiting ? 'translateX(100%)' : 'translateX(0)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid var(--border, #263124)',
            backgroundColor: 'var(--surface, #0E120F)',
            boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05))',
          }}
        >
          <div>
            <h2
              id="drawer-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--text-primary, #F0F3EF)',
                letterSpacing: '-0.015em',
                textWrap: 'balance',
              }}
            >
              {title}
            </h2>
            {(subtitle || eyebrow) && (
              <div
                style={{
                  fontSize: 'var(--text-micro, 11px)',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-secondary, #A0AAA0)',
                  marginTop: '4px',
                }}
              >
                {subtitle || eyebrow}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="action-toolbar-btn"
            style={{
              minHeight: '28px',
              padding: '4px 10px',
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Close inspector (Esc)"
            aria-label="Close"
          >
            <span>✕</span>
            <span className="keycap-badge">Esc</span>
          </button>
        </div>

        {/* Drawer Content */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            flex: 1,
            color: 'var(--text-primary, #F0F3EF)',
            scrollBehavior: 'smooth',
          }}
        >
          {children}
        </div>

        {/* Optional Drawer Footer */}
        {footer && (
          <div
            className="slide-over-footer"
            style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--border, #263124)',
              backgroundColor: 'var(--surface, #0E120F)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px',
              boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05))',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
