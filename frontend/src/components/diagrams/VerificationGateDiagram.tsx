import React, { useState, useMemo, useId } from 'react';
import { formatNumber } from '../../lib/format';

export interface DriftMetricItem {
  name: string;
  searchVal: number;
  verifyVal?: number | null;
  drift?: number | null;
  tolerance?: number | null;
  unit: string;
  passed?: boolean | null;
  toleranceDeclared?: boolean;
}

export interface VerificationGateDiagramProps {
  searchRunId?: string;
  verifRunId?: string;
  driftSummary?: DriftMetricItem[] | any;
  candidateId?: string;
  candidateName?: string;
  appliedParams?: any;
  durationMultiplier?: number | null;
  verdict?: 'VERIFIED' | 'VERIFICATION_FAILED' | 'VERIFICATION_INCONCLUSIVE' | 'PENDING' | string;
  className?: string;
  height?: number;
}

export const VerificationGateDiagram: React.FC<VerificationGateDiagramProps> = ({
  searchRunId = 'exp-83697f4a197e',
  verifRunId,
  driftSummary,
  candidateId = 'C-02',
  candidateName = 'vLLM-FP8-B4-C32',
  appliedParams = 'Batch: 4 · Concurrency: 32 · KV Cache: FP8',
  durationMultiplier = 1.5,
  verdict,
  className = '',
  height,
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const [hoveredChannel, setHoveredChannel] = useState<number | null>(null);

  // 1. Determine execution state & anti-cheating security status
  const effectiveVerifId = verifRunId || 'PENDING (NOT YET RECORDED)';
  const isPending =
    !verifRunId ||
    verifRunId.toUpperCase().includes('PENDING') ||
    verdict === 'PENDING' ||
    verdict === 'INDEPENDENT VERIFICATION PENDING' ||
    verdict === 'NOT_RUN';

  // Anti-cheating check: Identical run IDs violates DEC-0014 & AGENTS.md § 4, 7
  const isCheatingBreach = Boolean(
    searchRunId &&
    verifRunId &&
    !isPending &&
    searchRunId.trim().toLowerCase() === verifRunId.trim().toLowerCase()
  );

  const isVerified = !isPending && !isCheatingBreach && (verdict === 'VERIFIED' || verdict === 'VERIFIED WINNER');
  const isFailed = !isPending && (isCheatingBreach || verdict === 'VERIFICATION_FAILED' || verdict === 'DRIFT BREACH');

  // Format applied parameters string if passed as object
  const formattedParams = useMemo(() => {
    if (typeof appliedParams === 'string') return appliedParams;
    if (appliedParams && typeof appliedParams === 'object') {
      const parts: string[] = [];
      if (appliedParams.batch != null) parts.push(`Batch: ${appliedParams.batch}`);
      if (appliedParams.concurrency != null) parts.push(`Concurrency: ${appliedParams.concurrency}`);
      if (appliedParams.kv_cache != null) parts.push(`KV: ${appliedParams.kv_cache}`);
      return parts.join(' · ') || 'Applied Parameters Configured';
    }
    return 'Batch: 4 · Concurrency: 32 · KV Cache: FP8';
  }, [appliedParams]);

  // 2. Normalize Drift Comparison Items (resilient fallback to 3 canonical metrics)
  const normalizedMetrics: DriftMetricItem[] = useMemo(() => {
    if (Array.isArray(driftSummary) && driftSummary.length > 0) {
      return driftSummary.filter(Boolean).slice(0, 3).map((item) => {
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
          name: item.name || 'Metric',
          searchVal: Number(item.searchVal ?? item.reference_value ?? 0),
          verifyVal:
            item.verifyVal !== undefined && item.verifyVal !== null
              ? Number(item.verifyVal)
              : item.verification_value !== undefined && item.verification_value !== null
              ? Number(item.verification_value)
              : null,
          drift: resolvedDrift,
          tolerance: resolvedTol,
          unit: item.unit || '',
          passed:
            item.passed ??
            (resolvedTol != null && resolvedDrift != null
              ? Math.abs(resolvedDrift) <= resolvedTol
              : null),
          toleranceDeclared: resolvedTol !== null && !Number.isNaN(resolvedTol),
        };
      });
    }

    // Default canonical metrics fallback
    return [
      {
        name: 'TTFT P95',
        searchVal: 26.0,
        verifyVal: isPending ? null : 27.2,
        drift: isPending ? null : 1.2,
        tolerance: 3.0,
        unit: 'ms',
        passed: isPending ? null : true,
        toleranceDeclared: true,
      },
      {
        name: 'Throughput',
        searchVal: 160.0,
        verifyVal: isPending ? null : 158.4,
        drift: isPending ? null : -1.6,
        tolerance: 10.0,
        unit: 'tok/s',
        passed: isPending ? null : true,
        toleranceDeclared: true,
      },
      {
        name: 'Error Rate',
        searchVal: 0.0,
        verifyVal: isPending ? null : 0.0,
        drift: isPending ? null : 0.0,
        tolerance: 0.0,
        unit: '%',
        passed: isPending ? null : true,
        toleranceDeclared: true,
      },
    ];
  }, [driftSummary, isPending]);

  // Color variables based on status
  const sealColor = isCheatingBreach || isFailed
    ? 'var(--error, #FF5555)'
    : isVerified
    ? 'var(--primary-bright, #95D500)'
    : isPending
    ? 'var(--warning, #E9B949)'
    : 'var(--error, #FF5555)';

  const zone2Border = isCheatingBreach || isFailed
    ? 'var(--error, #FF5555)'
    : isVerified
    ? 'var(--primary, #76B900)'
    : isPending
    ? 'rgba(233, 185, 73, 0.45)'
    : 'var(--error, #FF5555)';

  return (
    <div
      className={`verification-gate-diagram-card ${className}`}
      style={{
        position: 'relative',
        backgroundColor: 'var(--surface, #0E120F)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '8px',
        padding: '20px 24px',
        overflow: 'hidden',
        boxShadow: isVerified ? 'var(--glow-winner)' : isCheatingBreach ? 'var(--glow-infeasible)' : 'none',
        transition: 'border-color 220ms ease, box-shadow 220ms ease',
      }}
    >
      {/* Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: sealColor,
              boxShadow: `0 0 8px ${sealColor}`,
            }}
          />
          <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>
            Tamper-Evident Verification Isolation Boundary
          </h2>
        </div>

        <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
          DEC-0014 § 3 · Physical Separation & Replay Quarantine
        </div>
      </div>

      {/* Security Breach Banner if Anti-Cheating Invariant Triggered */}
      {isCheatingBreach && (
        <div
          style={{
            marginBottom: '14px',
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(255, 85, 85, 0.15)',
            border: '1px solid var(--error, #FF5555)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: 'var(--error, #FF5555)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          <span>⚠</span>
          <span>SECURITY BREACH · IDENTICAL RUN IDS DETECTED (DEC-0014 VIOLATION: Verification Run ID must not equal Search Run ID)</span>
        </div>
      )}

      {/* SVG Diagram Canvas */}
      <div style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
        <svg
          viewBox="0 0 880 370"
          style={{
            width: '100%',
            height: height ? `${height}px` : 'auto',
            display: 'block',
            overflow: 'visible',
          }}
          role="img"
          aria-label="Tamper-evident verification gate diagram showing separation between search run ID and independent verification run ID"
        >
          <defs>
            {/* Ambient gradients */}
            <linearGradient id={`${idPrefix}-vgate-zone1-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#151B15" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0E120F" stopOpacity="0.95" />
            </linearGradient>

            <linearGradient id={`${idPrefix}-vgate-zone2-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isVerified ? '#182417' : isPending ? '#1B1A13' : '#221515'} stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0E120F" stopOpacity="0.95" />
            </linearGradient>

            <linearGradient id={`${idPrefix}-vgate-corridor-grad`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor={sealColor} stopOpacity="0.08" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>

            {/* Diagonal Hazard Hatch Pattern for Isolation Corridor */}
            <pattern id={`${idPrefix}-vgate-isolation-hatch`} width="16" height="16" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="16" stroke={isCheatingBreach ? 'rgba(255,85,85,0.25)' : 'rgba(240,243,239,0.04)'} strokeWidth="2.5" />
            </pattern>

            {/* Glowing filter */}
            <filter id={`${idPrefix}-vgate-glow-filter`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* ============================================================ */}
          {/* CENTRAL AIR-GAP CORRIDOR (X: 376 to 504)                     */}
          {/* ============================================================ */}
          <rect x="376" y="24" width="128" height="326" fill={`url(#${idPrefix}-vgate-corridor-grad)`} />
          <rect x="376" y="24" width="128" height="326" fill={`url(#${idPrefix}-vgate-isolation-hatch)`} />

          {/* Dual Boundary Laser Rails */}
          <line x1="380" y1="24" x2="380" y2="340" stroke="var(--border-strong, #384635)" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="500" y1="24" x2="500" y2="340" stroke="var(--border-strong, #384635)" strokeWidth="1.5" strokeDasharray="4 3" />

          {/* Micro chevrons on boundary */}
          <path d="M 380 40 L 388 44 L 380 48" fill="none" stroke="var(--border-strong, #384635)" strokeWidth="1.5" />
          <path d="M 500 40 L 492 44 L 500 48" fill="none" stroke="var(--border-strong, #384635)" strokeWidth="1.5" />
          <path d="M 380 180 L 388 184 L 380 188" fill="none" stroke="var(--border-strong, #384635)" strokeWidth="1.5" />
          <path d="M 500 180 L 492 184 L 500 188" fill="none" stroke="var(--border-strong, #384635)" strokeWidth="1.5" />

          {/* Top Corridor Label */}
          <text x="440" y="38" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" textAnchor="middle" letterSpacing="0.08em">
            AIR-GAP PROTOCOL
          </text>

          {/* ============================================================ */}
          {/* ZONE 01: SEARCH SWEEP & FROZEN WINNER (X: 24 to 360)         */}
          {/* ============================================================ */}
          <text x="24" y="22" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" letterSpacing="0.06em">
            ZONE 01 · SEARCH SWEEP & SELECTION
          </text>

          <rect
            x="24"
            y="28"
            width="336"
            height="156"
            rx="6"
            fill={`url(#${idPrefix}-vgate-zone1-grad)`}
            stroke="var(--border, #263124)"
            strokeWidth="1.5"
          />

          {/* Search Run ID Header Pill */}
          <rect x="36" y="40" width="312" height="42" rx="4" fill="var(--raised, #151B15)" stroke="var(--border, #263124)" />
          <text x="48" y="55" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600">
            ORIGINAL SEARCH RUN ID
          </text>
          <text x="48" y="73" fill="var(--text-primary, #F0F3EF)" fontSize="12" fontFamily="var(--font-mono, monospace)" fontWeight="700">
            {searchRunId}
          </text>

          {/* Selected Candidate Meta */}
          <g transform="translate(36, 94)">
            <rect x="0" y="0" width="94" height="20" rx="3" fill="rgba(118, 185, 0, 0.12)" stroke="rgba(118, 185, 0, 0.35)" />
            <text x="47" y="14" fill="var(--primary-bright, #95D500)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="700" textAnchor="middle">
              {candidateId} · WINNER
            </text>
            <text x="104" y="14" fill="var(--text-primary, #F0F3EF)" fontSize="12" fontFamily="var(--font-mono, monospace)" fontWeight="650">
              {candidateName}
            </text>
          </g>

          {/* Applied Serving Parameters */}
          <text x="36" y="132" fill="var(--text-secondary, #A0AAA0)" fontSize="11" fontFamily="var(--font-mono, monospace)">
            {formattedParams}
          </text>

          {/* Cryptographic Freeze Badge */}
          <g transform="translate(36, 148)">
            <circle cx="5" cy="5" r="4" fill="var(--text-tertiary, #7A857B)" />
            <text x="16" y="9" fill="var(--text-tertiary, #7A857B)" fontSize="11" fontFamily="var(--font-mono, monospace)">
              State Frozen · Search Sweep Complete · Snapshot
            </text>
          </g>

          {/* Data Flow Laser into Gate */}
          <line x1="360" y1="106" x2="380" y2="106" stroke="var(--border-strong, #384635)" strokeWidth="1.5" />
          <polygon points="378,103 384,106 378,109" fill="var(--border-strong, #384635)" />

          {/* ============================================================ */}
          {/* CENTRAL CRYPTOGRAPHIC ISOLATION SEAL (Center: 440, 106)      */}
          {/* ============================================================ */}
          <g transform="translate(440, 106)">
            {/* Outer Rotating Concentric Reticle */}
            <circle cx="0" cy="0" r="34" fill="none" stroke={sealColor} strokeWidth="1" strokeDasharray="6 4" opacity="0.6" />
            <circle cx="0" cy="0" r="26" fill="var(--surface, #0E120F)" stroke={sealColor} strokeWidth="2" filter={isVerified ? `url(#${idPrefix}-vgate-glow-filter)` : undefined} />

            {/* Seal Icon */}
            {isCheatingBreach ? (
              // Alert Warning Glyph
              <path d="M 0 -10 L 10 8 L -10 8 Z M 0 -4 L 0 1 M 0 4 L 0 5.5" stroke="var(--error, #FF5555)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            ) : isVerified ? (
              // Shield with Checkmark
              <g stroke="var(--primary-bright, #95D500)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M -8 -8 L 0 -12 L 8 -8 L 8 1 C 8 7 0 11 0 11 C 0 11 -8 7 -8 1 Z" />
                <path d="M -3 0 L -1 3 L 4 -2" strokeWidth="2" />
              </g>
            ) : isPending ? (
              // Lock / Air-Gap Arming Reticle
              <g stroke="var(--warning, #E9B949)" strokeWidth="1.8" fill="none" strokeLinecap="round">
                <rect x="-7" y="-2" width="14" height="11" rx="2" />
                <path d="M -4 -2 L -4 -6 C -4 -8 4 -8 4 -6 L 4 -2" />
                <circle cx="0" cy="3.5" r="1.5" fill="var(--warning, #E9B949)" />
              </g>
            ) : (
              // Breach / Failure X
              <g stroke="var(--error, #FF5555)" strokeWidth="2" strokeLinecap="round">
                <line x1="-6" y1="-6" x2="6" y2="6" />
                <line x1="6" y1="-6" x2="-6" y2="6" />
              </g>
            )}

            {/* Seal Status Pill Badge */}
            <rect x="-56" y="38" width="112" height="18" rx="3" fill="var(--raised, #151B15)" stroke={sealColor} strokeWidth="1" />
            <text x="0" y="51" fill={sealColor} fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="700" textAnchor="middle" letterSpacing="0.04em">
              {isCheatingBreach
                ? 'SECURITY BREACH'
                : isVerified
                ? 'SEAL INTACT'
                : isPending
                ? 'AIR-GAP ARMED'
                : 'VERIF FAILED'}
            </text>
          </g>

          {/* Laser Exit from Gate into Zone 2 */}
          <line x1="500" y1="106" x2="520" y2="106" stroke={zone2Border} strokeWidth="1.5" strokeDasharray={isPending ? '3 2' : 'none'} />
          <polygon points="518,103 524,106 518,109" fill={zone2Border} />

          {/* ============================================================ */}
          {/* ZONE 02: INDEPENDENT RE-EXECUTION (X: 520 to 856)            */}
          {/* ============================================================ */}
          <text x="520" y="22" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" letterSpacing="0.06em">
            ZONE 02 · INDEPENDENT RE-EXECUTION
          </text>

          <rect
            x="520"
            y="28"
            width="336"
            height="156"
            rx="6"
            fill={`url(#${idPrefix}-vgate-zone2-grad)`}
            stroke={zone2Border}
            strokeWidth={isVerified ? 1.8 : 1.5}
            strokeDasharray={isPending ? '5 3' : 'none'}
          />

          {/* Verification Run ID Header Pill */}
          <rect x="532" y="40" width="312" height="42" rx="4" fill="var(--raised, #151B15)" stroke={zone2Border} strokeWidth="1" />
          <text x="544" y="55" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600">
            INDEPENDENT VERIFICATION RUN ID
          </text>
          <text
            x="544"
            y="73"
            fill={isCheatingBreach ? 'var(--error, #FF5555)' : isVerified ? 'var(--primary-bright, #95D500)' : isPending ? 'var(--warning, #E9B949)' : 'var(--error, #FF5555)'}
            fontSize="12"
            fontFamily="var(--font-mono, monospace)"
            fontWeight="700"
          >
            {isCheatingBreach ? `${effectiveVerifId} [IDENTICAL RUN ID!]` : effectiveVerifId}
          </text>

          {/* Independent Protocol Details */}
          <g transform="translate(532, 94)">
            <rect
              x="0"
              y="0"
              width="130"
              height="20"
              rx="3"
              fill={isVerified ? 'rgba(118,185,0,0.12)' : isPending ? 'rgba(233,185,73,0.12)' : 'rgba(255,85,85,0.12)'}
              stroke={zone2Border}
            />
            <text
              x="65"
              y="14"
              fill={isVerified ? 'var(--primary-bright, #95D500)' : isPending ? 'var(--warning, #E9B949)' : 'var(--error, #FF5555)'}
              fontSize="11"
              fontFamily="var(--font-mono, monospace)"
              fontWeight="700"
              textAnchor="middle"
            >
              {isCheatingBreach ? 'FRAUD BREACH' : isVerified ? 'VERIFIED WINNER' : isPending ? 'PENDING RERUN' : 'FAILED'}
            </text>
            <text x="140" y="14" fill="var(--text-secondary, #A0AAA0)" fontSize="11" fontFamily="var(--font-mono, monospace)">
              {durationMultiplier ? `${durationMultiplier}× duration protocol` : 'Fresh execution'}
            </text>
          </g>

          {/* Execution Environment Trace Meta */}
          <text x="532" y="132" fill="var(--text-secondary, #A0AAA0)" fontSize="11" fontFamily="var(--font-mono, monospace)">
            {isPending
              ? 'Distinct subprocess instance pending dispatch'
              : 'Isolated process · Distinct unaggregated JSONL trace'}
          </text>

          {/* Verdict Note */}
          <g transform="translate(532, 148)">
            <circle cx="5" cy="5" r="4" fill={isVerified ? 'var(--primary, #76B900)' : isPending ? 'var(--warning, #E9B949)' : 'var(--error, #FF5555)'} />
            <text x="16" y="9" fill={isVerified ? 'var(--primary-bright, #95D500)' : isPending ? 'var(--text-muted, #727D73)' : 'var(--error, #FF5555)'} fontSize="11" fontFamily="var(--font-mono, monospace)">
              {isCheatingBreach
                ? 'DEC-0014 Violation: Run ID equals search run ID'
                : isVerified
                ? 'All physical drift within declared tolerance'
                : isPending
                ? 'Awaiting fresh independent execution'
                : 'Drift breach or constraint failure'}
            </text>
          </g>

          {/* ============================================================ */}
          {/* DRIFT COMPARATOR CHANNELS (Y: 200 to 326)                    */}
          {/* ============================================================ */}
          <rect x="24" y="202" width="832" height="122" rx="6" fill="var(--surface, #0E120F)" stroke="var(--border, #263124)" strokeWidth="1" />

          {/* Corridor Table Header */}
          <text x="36" y="222" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="700" letterSpacing="0.06em">
            DRIFT COMPARATOR CHANNELS
          </text>
          <text x="210" y="222" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" textAnchor="end">
            SEARCH
          </text>
          <text x="440" y="222" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" textAnchor="middle">
            TOLERANCE
          </text>
          <text x="650" y="222" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" textAnchor="start">
            RERUN
          </text>
          <text x="844" y="222" fill="var(--text-muted, #727D73)" fontSize="11" fontFamily="var(--font-mono, monospace)" textAnchor="end">
            VERDICT
          </text>

          {/* 3 Telemetry Drift Channels */}
          {normalizedMetrics.map((m, idx) => {
            const yPos = 246 + idx * 28;
            const isHovered = hoveredChannel === idx;
            const isItemPassing = isPending ? null : m.passed;
            const itemColor = isPending
              ? 'var(--text-muted, #727D73)'
              : isItemPassing
              ? 'var(--primary-bright, #95D500)'
              : 'var(--error, #FF5555)';

            return (
              <g
                key={m.name}
                onMouseEnter={() => setHoveredChannel(idx)}
                onMouseLeave={() => setHoveredChannel(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Channel Highlight Row */}
                {isHovered && (
                  <rect x="28" y={yPos - 16} width="824" height="24" rx="4" fill="rgba(240, 243, 239, 0.03)" />
                )}

                {/* Metric Name */}
                <text x="36" y={yPos} fill={isHovered ? 'var(--text-primary, #F0F3EF)' : 'var(--text-secondary, #A0AAA0)'} fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="650">
                  {m.name}
                </text>

                {/* Search Value */}
                <text x="210" y={yPos} fill="var(--text-primary, #F0F3EF)" fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" textAnchor="end">
                  {formatNumber(m.searchVal, 1)} {m.unit}
                </text>

                {/* Connector Laser Line across Zone 1 to Gate */}
                <line x1="222" y1={yPos - 4} x2="380" y2={yPos - 4} stroke="var(--border-strong, #384635)" strokeWidth={isHovered ? 1.5 : 1} />

                {/* Gate Corridor Tolerance Box */}
                <rect
                  x="396"
                  y={yPos - 13}
                  width="88"
                  height="18"
                  rx="3"
                  fill="var(--raised, #151B15)"
                  stroke={isHovered ? itemColor : 'var(--border-strong, #384635)'}
                  strokeWidth="1"
                />
                <text x="440" y={yPos} fill={m.toleranceDeclared ? 'var(--text-secondary, #A0AAA0)' : 'var(--warning, #E9B949)'} fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600" textAnchor="middle">
                  {m.toleranceDeclared ? `±${formatNumber(m.tolerance, 1)} ${m.unit}` : 'TOL UNDECLARED'}
                </text>

                {/* Connector Laser Line from Gate to Zone 2 */}
                <line x1="500" y1={yPos - 4} x2="638" y2={yPos - 4} stroke="var(--border-strong, #384635)" strokeWidth={isHovered ? 1.5 : 1} strokeDasharray={isPending ? '3 2' : 'none'} />

                {/* Verification Value */}
                <text x="650" y={yPos} fill={isPending ? 'var(--text-muted, #727D73)' : 'var(--text-primary, #F0F3EF)'} fontSize="11" fontFamily="var(--font-mono, monospace)" fontWeight="600">
                  {isPending || m.verifyVal == null ? '— (Pending)' : `${formatNumber(m.verifyVal, 1)} ${m.unit}`}
                </text>

                {/* Drift Delta Tag & Verdict */}
                <rect
                  x="736"
                  y={yPos - 13}
                  width="108"
                  height="18"
                  rx="3"
                  fill={isPending ? 'rgba(233, 185, 73, 0.08)' : isItemPassing ? 'rgba(118, 185, 0, 0.12)' : 'rgba(255, 85, 85, 0.12)'}
                  stroke={isPending ? 'rgba(233, 185, 73, 0.3)' : isItemPassing ? 'rgba(118, 185, 0, 0.35)' : 'rgba(255, 85, 85, 0.35)'}
                  strokeWidth="1"
                />
                <text x="790" y={yPos} fill={itemColor} fontSize="10px" fontFamily="var(--font-mono, monospace)" fontWeight="700" textAnchor="middle">
                  {isPending
                    ? 'PENDING'
                    : m.drift != null
                    ? `${m.drift > 0 ? '+' : ''}${formatNumber(m.drift, 1)} · ${isItemPassing ? 'PASS' : 'BREACH'}`
                    : 'N/A'}
                </text>
              </g>
            );
          })}

          {/* ============================================================ */}
          {/* BOTTOM TECHNICAL TELEMETRY FOOTER                            */}
          {/* ============================================================ */}
          <text x="24" y="352" fill="var(--text-tertiary, #7A857B)" fontSize="11" fontFamily="var(--font-mono, monospace)">
            FRESH INSTANCE · SEED ROTATION · DEC-0014
          </text>
        </svg>

        {/* Hover Card / Glass Tooltip overlay for detailed math audit — positioned in central corridor to avoid occluding table rows */}
        {hoveredChannel !== null && (
          <div
            style={{
              position: 'absolute',
              top: '28px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--glass-float, rgba(29, 37, 30, 0.94))',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border-strong, #384635)',
              borderRadius: '6px',
              padding: '12px 18px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary, #F0F3EF)',
              pointerEvents: 'none',
              zIndex: 20,
              boxShadow: 'var(--shadow-lg)',
              maxWidth: '480px',
              width: '90%',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', marginBottom: '4px' }}>
              Metric Drift Audit: {normalizedMetrics[hoveredChannel].name}
            </div>
            <div style={{ color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.5 }}>
              <div>Search Baseline: {formatNumber(normalizedMetrics[hoveredChannel].searchVal, 2)} {normalizedMetrics[hoveredChannel].unit}</div>
              <div>
                Verification Re-run: {isPending || normalizedMetrics[hoveredChannel].verifyVal == null
                  ? 'Awaiting fresh independent rerun'
                  : `${formatNumber(normalizedMetrics[hoveredChannel].verifyVal, 2)} ${normalizedMetrics[hoveredChannel].unit}`}
              </div>
              <div>
                Observed Drift: {isPending || normalizedMetrics[hoveredChannel].drift == null
                  ? 'Pending'
                  : `${Math.abs(normalizedMetrics[hoveredChannel].drift).toFixed(2)} ${normalizedMetrics[hoveredChannel].unit} (Tolerance Gate: ±${normalizedMetrics[hoveredChannel].tolerance} ${normalizedMetrics[hoveredChannel].unit})`}
              </div>
              <div style={{ marginTop: '4px', fontWeight: 600, color: normalizedMetrics[hoveredChannel].passed ? 'var(--primary-bright, #95D500)' : isPending ? 'var(--warning, #E9B949)' : 'var(--error, #FF5555)' }}>
                {isPending
                  ? 'Status: Air-gap armed. Candidate awaiting independent re-execution.'
                  : normalizedMetrics[hoveredChannel].passed
                  ? `Gate Passed: Observed drift within declared tolerance threshold.`
                  : `Drift Breach: Measured delta exceeds declared gate tolerance.`}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
