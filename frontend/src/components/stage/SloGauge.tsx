import React from 'react';
import { formatNumber } from '../../lib/format';

export interface SloGaugeProps {
  label: string;
  measured: number;
  threshold: number;
  unit: string;
  isUpperBound?: boolean;
  statistic?: string;
  variant?: 'linear' | 'radial';
}

export const SloGauge: React.FC<SloGaugeProps> = ({
  label,
  measured,
  threshold,
  unit,
  isUpperBound = true,
  statistic = 'p95',
  variant = 'linear',
}) => {
  const isPassing = isUpperBound ? measured <= threshold : measured >= threshold;
  const maxScale = Math.max(threshold * 1.4, measured * 1.15, 1);
  const thresholdPct = Math.min(100, Math.max(0, (threshold / maxScale) * 100));
  const measuredPct = Math.min(100, Math.max(0, (measured / maxScale) * 100));

  const headroom = isUpperBound ? threshold - measured : measured - threshold;
  const headroomStr = isPassing
    ? `+${formatNumber(headroom, 1)} ${unit} margin`
    : `-${formatNumber(Math.abs(headroom), 1)} ${unit} breach`;

  // Visual span between measured and threshold
  const deltaSpanLeft = Math.min(measuredPct, thresholdPct);
  const deltaSpanWidth = Math.abs(thresholdPct - measuredPct);

  if (variant === 'radial') {
    // Semi-circular radial arc geometry: radius 60, center (80, 75)
    // Arc spans 180 degrees from 180 deg (left) to 0 deg (right)
    const radius = 56;
    const cx = 80;
    const cy = 72;
    const arcLength = Math.PI * radius; // Half circumference ~ 175.93

    const measuredDash = (measuredPct / 100) * arcLength;
    const thresholdAngle = Math.PI - (thresholdPct / 100) * Math.PI;
    const thresholdX = cx + radius * Math.cos(thresholdAngle);
    const thresholdY = cy - radius * Math.sin(thresholdAngle);

    return (
      <div
        className="slo-gauge slo-gauge-radial"
        style={{
          padding: '16px',
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border, #263124)',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
          <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--text-secondary, #A0AAA0)', textTransform: 'uppercase' }}>
            {label} ({statistic})
          </span>
          <span style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: isPassing ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)' }}>
            {headroomStr}
          </span>
        </div>

        <svg width="160" height="85" viewBox="0 0 160 85" className="slo-radial-svg" aria-hidden="true">
          {/* Background Arc Track */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            className="slo-radial-track"
          />

          {/* Hairline Tick marks at 25%, 50%, 75% */}
          {[0.25, 0.5, 0.75].map((tick) => {
            const angle = Math.PI - tick * Math.PI;
            const x1 = cx + (radius - 6) * Math.cos(angle);
            const y1 = cy - (radius - 6) * Math.sin(angle);
            const x2 = cx + (radius + 6) * Math.cos(angle);
            const y2 = cy - (radius + 6) * Math.sin(angle);
            return <line key={tick} x1={x1} y1={y1} x2={x2} y2={y2} className="slo-radial-tick" />;
          })}

          {/* Measured Fill Arc */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            className="slo-radial-fill"
            style={{
              stroke: isPassing ? 'var(--primary, #76B900)' : 'var(--error, #FF5555)',
              strokeDasharray: `${measuredDash} ${arcLength}`,
            }}
          />

          {/* Declared Ceiling Hairline Marker */}
          <circle cx={thresholdX} cy={thresholdY} r="4" fill="var(--text-primary, #F0F3EF)" />
        </svg>

        <div style={{ textAlign: 'center', marginTop: '-12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #F0F3EF)' }}>
            {formatNumber(measured, 1)} <span style={{ fontSize: '12px', color: 'var(--text-secondary, #A0AAA0)' }}>{unit}</span>
          </div>
          <div style={{ fontSize: 'var(--text-micro, 11px)', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Ceiling: {formatNumber(threshold, 1)} {unit}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="slo-gauge"
      style={{
        padding: '12px 16px',
        backgroundColor: 'var(--surface, #0E120F)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Top Header: Metric Label, Statistic, Headroom Result */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: 'var(--text-micro, 11px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-secondary, #A0AAA0)',
              letterSpacing: '0.04em',
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 'var(--text-micro, 11px)',
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-muted, #727D73)',
            }}
          >
            ({statistic})
          </span>
        </div>

        <span
          style={{
            fontSize: 'var(--text-micro, 11px)',
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 700,
            color: isPassing ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)',
          }}
        >
          {headroomStr}
        </span>
      </div>

      {/* Numerical readout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div
          style={{
            fontSize: '18px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-primary, #F0F3EF)',
          }}
        >
          {formatNumber(measured, 1)}{' '}
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary, #A0AAA0)' }}>
            {unit}
          </span>
        </div>
        <div
          style={{
            fontSize: 'var(--text-micro, 11px)',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-muted, #727D73)',
          }}
        >
          Ceiling: <strong style={{ color: 'var(--text-secondary, #A0AAA0)' }}>{formatNumber(threshold, 1)} {unit}</strong>
        </div>
      </div>

      {/* Visual meter bar with hairline ticks and headroom span indicator */}
      <div
        style={{
          position: 'relative',
          height: '8px',
          backgroundColor: 'var(--raised, #151B15)',
          borderRadius: '4px',
          overflow: 'hidden',
          marginTop: '2px',
        }}
      >
        {/* Subtle hairline tick marks at 25%, 50%, 75% */}
        <div style={{ position: 'absolute', left: '25%', top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />
        <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />

        {/* Headroom distance highlight band */}
        <div
          style={{
            position: 'absolute',
            left: `${deltaSpanLeft}%`,
            width: `${deltaSpanWidth}%`,
            top: 0,
            bottom: 0,
            backgroundColor: isPassing ? 'rgba(118, 185, 0, 0.18)' : 'rgba(255, 85, 85, 0.22)',
            zIndex: 1,
          }}
          title={`Headroom distance: ${headroomStr}`}
        />

        {/* Measured fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${measuredPct}%`,
            backgroundColor: isPassing ? 'var(--primary, #76B900)' : 'var(--error, #FF5555)',
            borderRadius: '4px',
            transition: 'width 260ms var(--ease-spring)',
            zIndex: 2,
          }}
        />

        {/* Declared SLA Ceiling hairline marker */}
        <div
          style={{
            position: 'absolute',
            left: `${thresholdPct}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: 'var(--text-primary, #F0F3EF)',
            boxShadow: '0 0 4px rgba(255, 255, 255, 0.5)',
            zIndex: 3,
          }}
          title={`Declared ceiling: ${threshold} ${unit}`}
        />
      </div>
    </div>
  );
};
