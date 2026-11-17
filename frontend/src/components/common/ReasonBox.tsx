import React from 'react';
import type { ReasonCode } from '../../types/contracts';

interface ReasonBoxProps {
  reasonCode?: ReasonCode | string;
  detailText?: string;
  isPassing?: boolean;
}

export const ReasonBox: React.FC<ReasonBoxProps> = ({
  reasonCode,
  detailText,
  isPassing = false,
}) => {
  const isUnavailable =
    !reasonCode ||
    reasonCode === 'UNAVAILABLE' ||
    reasonCode === 'NONE' ||
    reasonCode === 'PENDING' ||
    reasonCode === 'N/A';
  const hasCode = !isUnavailable;

  return (
    <div
      className="reason-box"
      style={{
        padding: '10px 12px',
        backgroundColor: hasCode
          ? isPassing
            ? 'rgba(118, 185, 0, 0.08)'
            : 'rgba(255, 85, 85, 0.08)'
          : 'transparent',
        border: '1px solid',
        borderColor: hasCode
          ? isPassing
            ? 'rgba(118, 185, 0, 0.3)'
            : 'rgba(255, 85, 85, 0.3)'
          : 'var(--border, #263124)',
        borderRadius: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontFamily: 'var(--font-mono, monospace)',
          fontWeight: hasCode ? 700 : 500,
          color: hasCode
            ? isPassing
              ? 'var(--primary-bright, #95D500)'
              : 'var(--error, #FF5555)'
            : 'var(--text-muted, #727D73)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {hasCode
          ? `Reason Code: ${reasonCode}`
          : isPassing
          ? 'All hard constraints satisfied'
          : 'Evaluator reason code unavailable'}
      </div>
      {detailText && (
        <div style={{ fontSize: '12px', color: 'var(--text-primary, #F0F3EF)', lineHeight: 1.4 }}>
          {detailText}
        </div>
      )}
    </div>
  );
};
