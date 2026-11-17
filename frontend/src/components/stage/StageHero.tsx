import React, { useState } from 'react';
import { Badge } from '../common/Badge';
import type { HeadroomResult } from '../../lib/format';
import type { VerificationDerivationResult } from '../../lib/status';
import { buildVllmLaunchFlags } from '../../lib/vllm';
import heroAmbientMesh from '../../assets/hero_ambient_mesh.jpg';

interface StageHeroProps {
  candidateName: string;
  candidateId: string;
  runtimeModel: string;
  bindingHeadroom: HeadroomResult | null;
  verificationStatus: VerificationDerivationResult;
  throughputDelta?: string;
  onOpenDetails?: () => void;
  onReplay?: () => void;
  onCopyFlags?: () => void;
  vllmFlags?: string;
}

export const StageHero: React.FC<StageHeroProps> = ({
  candidateName,
  candidateId,
  runtimeModel,
  bindingHeadroom,
  verificationStatus,
  throughputDelta = '+41.1% throughput vs baseline',
  onOpenDetails,
  onReplay,
  onCopyFlags,
  vllmFlags,
}) => {
  const [copied, setCopied] = useState(false);
  const isPassing = bindingHeadroom ? bindingHeadroom.isPassing : verificationStatus.isVerifiedWinner;
  const absHeadroom = bindingHeadroom ? Math.abs(bindingHeadroom.absoluteHeadroom).toFixed(1) : '3.0';
  const unit = bindingHeadroom?.unit || 'ms';
  const constraintMetricName = bindingHeadroom?.constraintName || 'P95 TTFT';
  const constraintLabel = bindingHeadroom
    ? `${bindingHeadroom.constraintName} (${bindingHeadroom.threshold} ${unit} CEILING)`
    : 'P95 TTFT (50 ms CEILING)';

  const measuredValue = bindingHeadroom?.measured ?? (isPassing ? 47.0 : 53.0);
  const ceilingValue = bindingHeadroom?.threshold ?? 50.0;
  const maxScale = Math.max(ceilingValue * 1.35, measuredValue * 1.15, 1);
  const measuredPct = Math.min(100, Math.max(0, (measuredValue / maxScale) * 100));
  const ceilingPct = Math.min(100, Math.max(0, (ceilingValue / maxScale) * 100));

  const resolvedFlags =
    vllmFlags ||
    buildVllmLaunchFlags({
      id: candidateId,
      name: candidateName,
      concurrency: 32,
      batch: 4,
      kvCache: 'AUTO',
    } as any);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(resolvedFlags).catch(() => {});
    }
    setCopied(true);
    onCopyFlags?.();
    setTimeout(() => setCopied(false), 2200);
  };

  const statusClass = verificationStatus.isVerifiedWinner
    ? 'winner-status'
    : verificationStatus.statusType === 'infeasible'
      ? 'infeasible-status'
      : 'pending-status';

  return (
    <section
      className={`stage-hero stage-hero-container ${statusClass}`}
      aria-label="Optimization Outcome Summary"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {/* Ambient Tensor Mesh Texture (7% subtle opacity) */}
      <div
        className="stage-hero-mesh-texture"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${heroAmbientMesh})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.07,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
          zIndex: 0,
        }}
        aria-hidden="true"
      />

      {/* Radial Vignette Overlay */}
      <div
        className="stage-hero-vignette"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at 50% 25%, transparent 25%, rgba(8, 10, 9, 0.75) 80%, rgba(8, 10, 9, 0.95) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
        aria-hidden="true"
      />

      {/* Interactive content layer */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* Top Meta Line: Badges + Candidate Info + Quick Actions */}
        <div className="stage-meta-bar">
          <div className="stage-meta-info">
            <Badge tone={verificationStatus.statusType} size="md">
              {verificationStatus.badgeLabel}
            </Badge>
            <span className="stage-candidate-title">
              {candidateId} · {candidateName}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted, #727D73)' }}>|</span>
            <span className="stage-candidate-model">
              {runtimeModel}
            </span>
          </div>

          <div className="stage-meta-actions">
            {/* Quick-action trigger: Deploy Flags (Hotkey: V) */}
            <button
              type="button"
              onClick={handleCopy}
              className="action-toolbar-btn"
              style={{ padding: '4px 10px', fontSize: '11px', gap: '6px' }}
              title="Copy vLLM CLI launch flags for this candidate (Hotkey: V)"
              aria-label="Deploy Flags"
            >
              <span className="keycap-badge">V</span>
              <span>{copied ? 'Copied Flags ✓' : 'Deploy Flags'}</span>
            </button>

            {/* Quick-action trigger: Replay Reveal (R) */}
            {onReplay && (
              <button
                type="button"
                onClick={onReplay}
                className="action-toolbar-btn"
                style={{ padding: '4px 10px', fontSize: '11px', gap: '6px' }}
                title="Replay verified reveal sequence (Hotkey: R)"
                aria-label="Replay reveal animation"
              >
                <span className="keycap-badge">R</span>
                <span>Replay ↻</span>
              </button>
            )}

            {/* Inspect Parameters & Artifacts */}
            {onOpenDetails && (
              <button
                type="button"
                onClick={onOpenDetails}
                className="action-toolbar-btn primary"
                style={{ padding: '4px 12px', fontSize: '12px' }}
              >
                Inspect Parameters & Artifacts →
              </button>
            )}
          </div>
        </div>

        {/* Hero Headroom Numeral (Apple-grade Monospace Stage Scale) */}
        <div className="stage-headroom-row">
          <div className={`stage-numeral hero-headroom-value ${isPassing ? '' : 'breach'} tabular-nums`}>
            {isPassing ? `+${absHeadroom}` : `-${absHeadroom}`}
          </div>
          <div className="stage-headroom-meta">
            <span className="hero-unit-numeral">
              {unit}
            </span>
            <span className="hero-headroom-subtext">
              {isPassing ? 'HEADROOM WON UNDER' : 'BREACH OVER'} {constraintLabel}
            </span>
          </div>
        </div>

        {/* Dynamic Binding Constraint Gauge (Comparing actual performance against SLA ceiling) */}
        <div className="stage-binding-gauge">
          <div className="stage-binding-gauge-header">
            <div className="stage-binding-gauge-title">
              <span className={`hero-constraint-badge ${isPassing ? '' : 'breach'}`}>
                BINDING CONSTRAINT
              </span>
              <span className="stage-binding-gauge-lead">
                {absHeadroom} {unit} {constraintMetricName} {isPassing ? 'headroom won under' : 'breach over'} {ceilingValue} {unit} SLA ceiling
              </span>
            </div>

            <div className="stage-binding-gauge-telemetry">
              Observed: <strong style={{ color: isPassing ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)' }}>{measuredValue.toFixed(1)} {unit}</strong> / Ceiling: {ceilingValue.toFixed(1)} {unit}
            </div>
          </div>

          {/* Hairline constraint bar */}
          <div className="stage-binding-gauge-track">
            {/* Measured Fill */}
            <div
              className={`stage-binding-gauge-fill ${isPassing ? 'passing' : 'breach'}`}
              style={{ width: `${measuredPct}%` }}
            />
            {/* Declared SLA Ceiling hairline marker */}
            <div
              className="stage-binding-gauge-ceiling"
              style={{ left: `${ceilingPct}%` }}
              title={`Declared SLA Ceiling: ${ceilingValue} ${unit}`}
            />
          </div>
        </div>

        {/* Bottom Summary Callout */}
        <div className="stage-summary-bar">
          <p className="stage-summary-text">
            {verificationStatus.reasonText}
          </p>

          <span className={`stage-summary-delta ${isPassing ? 'passing' : 'muted'}`}>
            {throughputDelta}
          </span>
        </div>
      </div>
    </section>
  );
};
