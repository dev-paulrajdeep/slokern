import React from 'react';
import { DemoDataChip } from '../common/DemoDataChip';
import logo from '../../assets/slokern_logo.png';

interface ContextBarProps {
  experimentId?: string;
  runtimeName?: string;
  onOpenRuntimeModal?: () => void;
  onRunSmokeProbe?: () => void;
  onOpenCampaignDrawer?: () => void;
  isProbing?: boolean;
}

export const ContextBar: React.FC<ContextBarProps> = ({
  experimentId = 'EXP-0248',
  runtimeName = 'vLLM v0.6.3 · Nebius H100 SXM5',
  onOpenRuntimeModal,
  onRunSmokeProbe,
  onOpenCampaignDrawer,
  isProbing = false,
}) => {
  return (
    <header
      className="context-bar glass-chrome"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 'var(--context-bar-height, 44px)',
        padding: '0 16px',
        backgroundColor: 'var(--glass-chrome, rgba(14, 18, 15, 0.72))',
        backdropFilter: 'var(--glass-blur-chrome, blur(28px) saturate(150%))',
        WebkitBackdropFilter: 'var(--glass-blur-chrome, blur(28px) saturate(150%))',
        borderBottom: '1px solid var(--border, #263124)',
        boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05)), inset 0 -1px 0 var(--glass-hairline, rgba(240, 243, 239, 0.08))',
        zIndex: 50,
        flexShrink: 0,
      }}
      role="banner"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Brand Mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src={logo}
            alt="SLOKern Logo"
            style={{
              width: '20px',
              height: '20px',
              display: 'block',
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 6px rgba(118, 185, 0, 0.45))',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: 800,
              fontSize: '13px',
              letterSpacing: '0.08em',
              color: 'var(--text-primary, #F0F3EF)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            SLOKERN
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted, #727D73)',
              fontFamily: 'var(--font-mono, monospace)',
              borderLeft: '1px solid var(--border, #263124)',
              paddingLeft: '8px',
            }}
          >
            v1.0-prod
          </span>
        </div>

        {/* Experiment Breadcrumb */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-secondary, #A0AAA0)',
          }}
        >
          <span style={{ color: 'var(--border-strong, #384635)', userSelect: 'none' }}>/</span>
          <span style={{ color: 'var(--text-tertiary, #7A857B)', letterSpacing: '0.04em' }}>active-exp:</span>
          <span
            className="tabular-nums glass-float"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--text-primary, #F0F3EF)',
              fontWeight: 600,
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              fontVariantNumeric: 'tabular-nums',
              fontFeatureSettings: '"tnum" 1',
              letterSpacing: '0.04em',
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'rgba(29, 37, 30, 0.65)',
              border: '1px solid var(--glass-hairline, rgba(240, 243, 239, 0.08))',
              boxShadow: 'inset 0 1px 0 var(--glass-highlight, rgba(240, 243, 239, 0.05)), 0 1px 3px rgba(0, 0, 0, 0.3)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            {experimentId}
          </span>
        </div>
      </div>

      {/* Right Controls: Runtime Profile, Smoke Probe, Demo Chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={onOpenRuntimeModal}
          className="btn-press context-bar-runtime-btn"
          style={{
            border: '1px solid var(--border, #263124)',
            backgroundColor: 'var(--raised, #151B15)',
            color: 'var(--text-secondary, #A0AAA0)',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)',
            padding: '4px 9px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 70ms ease',
          }}
          title="Inspect active serving runtime environment & hardware fingerprint"
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'var(--primary, #76B900)',
              boxShadow: '0 0 6px rgba(118, 185, 0, 0.6)',
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <span>{runtimeName}</span>
        </button>

        {onOpenCampaignDrawer && (
          <button
            type="button"
            onClick={onOpenCampaignDrawer}
            data-testid="run-campaign-btn"
            className="btn-press context-bar-campaign-btn"
            style={{
              background: 'var(--primary, #76B900)',
              border: '1px solid var(--primary-bright, #95D500)',
              color: '#080D06',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '0.04em',
              boxShadow: '0 0 12px rgba(118, 185, 0, 0.28), var(--shadow-sm)',
              transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 70ms ease',
            }}
            title="Open Optimization Campaign Execution Drawer"
          >
            <span style={{ fontSize: '9px' }}>▶</span>
            <span>Run Campaign</span>
          </button>
        )}

        {onRunSmokeProbe && (
          <button
            type="button"
            onClick={onRunSmokeProbe}
            disabled={isProbing}
            className="btn-press context-bar-smoke-btn"
            style={{
              border: '1px solid var(--border-strong, #384635)',
              backgroundColor: isProbing ? 'var(--raised, #151B15)' : 'var(--elevated, #1D251E)',
              color: isProbing ? 'var(--text-tertiary, #7A857B)' : 'var(--text-primary, #F0F3EF)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: isProbing ? 'not-allowed' : 'pointer',
              opacity: isProbing ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: 'var(--shadow-sm)',
              transition: 'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 70ms ease',
            }}
            title="Execute preflight smoke test probe"
          >
            {isProbing ? 'Probing...' : 'Smoke Probe'}
          </button>
        )}

        <DemoDataChip />
      </div>
    </header>
  );
};
