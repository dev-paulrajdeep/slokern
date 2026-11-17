import React from 'react';
import { DemoDataChip } from '../common/DemoDataChip';

export type ScenarioType = 'standard' | 'verification-pending' | 'verification-failed' | 'no-feasible' | 'stale-evidence';

interface StatusBarProps {
  scenario: ScenarioType;
  onScenarioChange: (s: ScenarioType) => void;
  healthStatus?: 'ok' | 'degraded' | 'error';
  healthPingMs?: number;
  activeRunId?: string;
  throughput?: string | number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  scenario,
  onScenarioChange,
  healthStatus = 'ok',
  healthPingMs = 14,
  activeRunId = 'run_01HZX8F2',
  throughput,
}) => {
  const getHealthColor = () => {
    switch (healthStatus) {
      case 'ok':
        return 'var(--primary, #76B900)';
      case 'degraded':
        return 'var(--warning, #E9B949)';
      case 'error':
      default:
        return 'var(--error, #FF5555)';
    }
  };

  return (
    <footer
      className="status-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '32px',
        padding: '0 16px',
        backgroundColor: 'var(--glass-chrome, rgba(14, 18, 15, 0.72))',
        backdropFilter: 'var(--glass-blur-chrome, blur(28px) saturate(150%))',
        WebkitBackdropFilter: 'var(--glass-blur-chrome, blur(28px) saturate(150%))',
        borderTop: '1px solid var(--border, #263124)',
        boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05))',
        fontSize: '11px',
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-secondary, #A0AAA0)',
        zIndex: 40,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      role="contentinfo"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <DemoDataChip size="sm" />

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--text-muted, #727D73)' }}>scenario:</span>
          <select
            value={scenario}
            onChange={(e) => onScenarioChange(e.target.value as ScenarioType)}
            style={{
              backgroundColor: 'var(--raised, #151B15)',
              border: '1px solid var(--border, #263124)',
              color: 'var(--text-primary, #F0F3EF)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              padding: '2px 6px',
              borderRadius: '3px',
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Switch deterministic demo scenario"
            aria-label="Demo Scenario Selector"
          >
            <option value="standard">standard (15594344 Verified Winner)</option>
            <option value="verification-pending">verification-pending (Verification Pending)</option>
            <option value="verification-failed">verification-failed (Drift Breach)</option>
            <option value="no-feasible">no-feasible (All Breaching)</option>
            <option value="stale-evidence">stale-evidence (Clock Expired)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--text-muted, #727D73)' }}>active_run:</span>
          <span
            className="tabular-nums num"
            style={{
              color: 'var(--text-primary, #F0F3EF)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              fontFeatureSettings: "'tnum' 1",
            }}
          >
            {activeRunId}
          </span>
        </div>

        {throughput != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: 'var(--text-muted, #727D73)' }}>throughput:</span>
            <span
              className="tabular-nums num"
              style={{
                color: 'var(--text-primary, #F0F3EF)',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                fontFeatureSettings: "'tnum' 1",
              }}
            >
              {typeof throughput === 'number' ? `${throughput.toFixed(1)} req/s` : throughput}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div
          className="status-ping-pill"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 8px',
            backgroundColor: 'var(--raised, #151B15)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '12px',
            boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05))',
          }}
        >
          {/* Dual-layer Heartbeat Pulse */}
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '8px', height: '8px' }}>
            {healthStatus === 'ok' && (
              <span
                className="ping-heartbeat"
                style={{
                  position: 'absolute',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: getHealthColor(),
                  opacity: 0.5,
                }}
                aria-hidden="true"
              />
            )}
            <span
              style={{
                position: 'relative',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: getHealthColor(),
                boxShadow: `0 0 6px ${getHealthColor()}`,
              }}
              aria-hidden="true"
            />
          </span>

          <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>control-plane: {healthStatus}</span>
          <span style={{ color: 'var(--text-muted, #727D73)' }}>
            (
            <span
              className="tabular-nums num"
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontFeatureSettings: "'tnum' 1",
                display: 'inline-block',
                minWidth: '22px',
                textAlign: 'right',
              }}
            >
              {healthPingMs}
            </span>
            ms)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted, #727D73)' }}>
          <span>Switch:</span>
          <kbd style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '1px 4px', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.08)' }}>1-6</kbd>
        </div>
      </div>
    </footer>
  );
};
