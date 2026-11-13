import React, { useEffect, useState } from 'react';
import { useReducedMotion } from '../../lib/motion';

interface VerifiedRevealProps {
  isVerified: boolean;
  replayKey?: number;
  children: React.ReactNode;
}

type RevealStage = 'idle' | 'scanning' | 'lockin' | 'bloom' | 'revealed';

export const VerifiedReveal: React.FC<VerifiedRevealProps> = ({ isVerified, replayKey = 0, children }) => {
  const prefersReduced = useReducedMotion();
  const [hasRevealed, setHasRevealed] = useState(false);
  const [glowActive, setGlowActive] = useState(false);
  const [revealStage, setRevealStage] = useState<RevealStage>('idle');

  useEffect(() => {
    if (!isVerified) {
      setHasRevealed(false);
      setGlowActive(false);
      setRevealStage('idle');
      return;
    }

    if (prefersReduced) {
      setHasRevealed(true);
      setGlowActive(true);
      setRevealStage('revealed');
      return;
    }

    // Step 1 (0–600ms): Scanning telemetry and constraint evaluation
    setHasRevealed(false);
    setGlowActive(false);
    setRevealStage('scanning');

    // Step 2 (600–1180ms): Drift gate verification lock-in
    const lockinTimer = setTimeout(() => {
      setRevealStage('lockin');
    }, 600);

    // Step 3 (1180–1400ms): First green activation with subtle luminance bloom
    const glowTimer = setTimeout(() => {
      setGlowActive(true);
      setRevealStage('bloom');
    }, 1180);

    // Step 4 (1400ms+): Final locked-in revealed state
    const completeTimer = setTimeout(() => {
      setHasRevealed(true);
      setRevealStage('revealed');
    }, 1400);

    return () => {
      clearTimeout(lockinTimer);
      clearTimeout(glowTimer);
      clearTimeout(completeTimer);
    };
  }, [isVerified, replayKey, prefersReduced]);

  if (!isVerified) {
    return <>{children}</>;
  }

  const containerClasses = [
    'verified-reveal-container',
    `step-${revealStage}`,
    hasRevealed ? 'revealed' : 'revealing',
    glowActive ? 'winner-glow' : '',
  ].filter(Boolean).join(' ');

  const showTelemetryBanner = !prefersReduced && !hasRevealed && revealStage !== 'idle';

  return (
    <div
      key={replayKey}
      className={containerClasses}
      style={{
        position: 'relative',
        transition: prefersReduced ? 'opacity 120ms ease' : 'box-shadow 380ms var(--ease-spring), border-color 380ms ease',
      }}
    >
      {/* Telemetry Stage Sequence Indicator (fades out when locked) */}
      {showTelemetryBanner && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            zIndex: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '3px 10px',
            borderRadius: '4px',
            backgroundColor: 'rgba(8, 10, 9, 0.85)',
            border: '1px solid',
            borderColor:
              revealStage === 'bloom'
                ? 'var(--primary, #76B900)'
                : revealStage === 'lockin'
                  ? 'var(--warning, #E9B949)'
                  : 'var(--text-muted, #727D73)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 'var(--text-micro, 11px)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            color:
              revealStage === 'bloom'
                ? 'var(--primary-bright, #95D500)'
                : revealStage === 'lockin'
                  ? 'var(--warning, #E9B949)'
                  : 'var(--text-secondary, #A0AAA0)',
            animation: 'fadeIn 160ms ease-out',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'currentColor',
              boxShadow: '0 0 8px currentColor',
            }}
          />
          {revealStage === 'scanning' && 'STAGE 1/3: SCANNING TELEMETRY'}
          {revealStage === 'lockin' && 'STAGE 2/3: DRIFT GATE LOCK-IN'}
          {revealStage === 'bloom' && 'STAGE 3/3: FIRST GREEN VERIFIED WINNER'}
        </div>
      )}

      {children}
    </div>
  );
};
