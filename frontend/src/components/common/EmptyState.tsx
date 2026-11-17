import React from 'react';
import emptyTelemetryRadar from '../../assets/empty_telemetry_radar.png';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  /** Whether to show the technical radar illustration (defaults to true if icon is omitted) */
  showRadarGraphic?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  showRadarGraphic = true,
}) => {
  const hasCustomIcon = Boolean(icon);
  const displayRadar = showRadarGraphic && !hasCustomIcon;

  return (
    <div
      className="empty-state"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        backgroundColor: 'var(--surface, #0E120F)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '8px',
        gap: '14px',
        boxShadow: 'inset 0 1px 0 0 rgba(240, 243, 239, 0.05), var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.35))',
      }}
    >
      {/* Visual Anchor: Custom Icon or Isometric Telemetry Radar */}
      {hasCustomIcon ? (
        <div style={{ color: 'var(--text-muted, #727D73)', marginBottom: '4px' }}>
          {icon}
        </div>
      ) : displayRadar ? (
        <div
          className="empty-state-radar-wrapper"
          style={{
            position: 'relative',
            width: '140px',
            height: '140px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '6px',
            background: 'radial-gradient(circle, rgba(118, 185, 0, 0.10) 0%, rgba(14, 18, 15, 0) 70%)',
          }}
        >
          <img
            src={emptyTelemetryRadar}
            alt="Isometric telemetry radar graphic showing active frequency sweep"
            style={{
              width: '128px',
              height: '128px',
              objectFit: 'contain',
              imageRendering: 'crisp-edges',
              filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.7))',
            }}
          />
        </div>
      ) : null}

      <h3
        style={{
          margin: 0,
          fontSize: '15px',
          fontWeight: 650,
          color: 'var(--text-primary, #F0F3EF)',
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin: 0,
          fontSize: '13px',
          color: 'var(--text-secondary, #A0AAA0)',
          maxWidth: '440px',
          lineHeight: 1.5,
          textWrap: 'pretty',
        }}
      >
        {description}
      </p>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="action-toolbar-btn"
          style={{
            marginTop: '8px',
            padding: '6px 16px',
            fontSize: '12px',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
