import React, { useState, useId } from 'react';

export type PipelineStageId =
  | 'workload-profiler'
  | 'vllm-engine'
  | 'metric-engine'
  | 'feasibility-evaluator'
  | 'verification-gate';

export type StageExecutionStatus = 'completed' | 'active' | 'pending' | 'infeasible';

export interface InferencePipelineDiagramProps {
  /** The currently selected or active stage ID */
  activeStage?: string;
  /** Callback triggered when a stage card is clicked or activated via keyboard */
  onSelectStage?: (stageId: string) => void;
  /** Optional container CSS class name */
  className?: string;
  /** Optional explicit height in pixels (defaults to auto based on viewBox) */
  height?: number;
  /** Optional override for stage execution statuses */
  stageStatuses?: Partial<Record<PipelineStageId, StageExecutionStatus>>;
}

interface StageMetadata {
  id: PipelineStageId;
  index: string;
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
  metricSub: string;
  role: string;
  parameters: string;
  contractRef: string;
  defaultStatus: StageExecutionStatus;
  glyph: 'waveform' | 'tensor' | 'stopwatch' | 'evaluator' | 'verification';
}

export const STAGES: StageMetadata[] = [
  {
    id: 'workload-profiler',
    index: '01',
    title: 'Workload Profiler',
    subtitle: 'Traffic & Distribution',
    metricLabel: 'OFFERED LOAD',
    metricValue: '10.0 RPS',
    metricSub: '512 in / 128 out (Poisson)',
    role: 'Simulates request arrivals and token distributions under declared workload contracts',
    parameters: 'Poisson @ 10 RPS · 512 in / 128 gen',
    contractRef: 'contracts/workload.py',
    defaultStatus: 'completed',
    glyph: 'waveform',
  },
  {
    id: 'vllm-engine',
    index: '02',
    title: 'vLLM Serving Engine',
    subtitle: 'Batch & Scheduling',
    metricLabel: 'CONFIG APPLIED',
    metricValue: 'Batch 4 · C-32',
    metricSub: 'KV Cache Auto (0.90 Util)',
    role: 'Executes inference on GPU accelerator with parameter read-back verification',
    parameters: 'Llama-3-8B · vLLM 0.6.3 · PagedAttention',
    contractRef: 'contracts/candidate.py',
    defaultStatus: 'completed',
    glyph: 'tensor',
  },
  {
    id: 'metric-engine',
    index: '03',
    title: 'Metric Engine',
    subtitle: 'Microsecond Telemetry',
    metricLabel: 'TTFT P95 LATENCY',
    metricValue: '47.0 ms',
    metricSub: 'ITL: 18.2 ms · 160.0 tok/s',
    role: 'Captures unaggregated microsecond-precision JSONL traces and computes percentiles',
    parameters: 'RawRequestMeasurement · TTFT/ITL p95',
    contractRef: 'contracts/metrics.py',
    defaultStatus: 'completed',
    glyph: 'stopwatch',
  },
  {
    id: 'feasibility-evaluator',
    index: '04',
    title: 'Feasibility Evaluator',
    subtitle: 'Deterministic Verdict',
    metricLabel: 'BINDING HEADROOM',
    metricValue: '+3.0 ms',
    metricSub: 'TTFT p95 <= 50ms Ceiling',
    role: 'Applies versioned deterministic decision rules against hard SLO constraints',
    parameters: 'slo-1.0.0 · Maximize Throughput policy',
    contractRef: 'contracts/evaluator.py',
    defaultStatus: 'active',
    glyph: 'evaluator',
  },
  {
    id: 'verification-gate',
    index: '05',
    title: 'Verification Gate',
    subtitle: 'Isolation & Drift Audit',
    metricLabel: 'MEASURED DRIFT',
    metricValue: '+0.6 ms',
    metricSub: 'Within declared ±5.0% SLA',
    role: 'Reruns winning candidate with fresh run ID to verify performance reproducibility',
    parameters: 'Isolated Rerun · Drift Gate ±2.5ms',
    contractRef: 'contracts/verification.py',
    defaultStatus: 'completed',
    glyph: 'verification',
  },
];

const CONNECTORS = [
  { from: 0, to: 1, label: 'WorkloadSpec', x1: 188, x2: 223 },
  { from: 1, to: 2, label: 'TokenEvents', x1: 391, x2: 426 },
  { from: 2, to: 3, label: 'RawMetrics', x1: 594, x2: 629 },
  { from: 3, to: 4, label: 'CandidateWinner', x1: 797, x2: 832 },
];

export const InferencePipelineDiagram: React.FC<InferencePipelineDiagramProps> = ({
  activeStage = 'feasibility-evaluator',
  onSelectStage,
  className = '',
  height,
  stageStatuses = {},
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);

  const selectedStage =
    STAGES.find((s) => s.id === (hoveredStageId || activeStage)) || STAGES[3];

  const getStatusTone = (status: StageExecutionStatus) => {
    switch (status) {
      case 'completed':
        return {
          stroke: 'var(--primary, #76B900)',
          badgeFill: 'rgba(118, 185, 0, 0.15)',
          badgeText: 'var(--primary-bright, #95D500)',
          badgeLabel: 'DONE',
        };
      case 'active':
        return {
          stroke: 'var(--primary-bright, #95D500)',
          badgeFill: 'rgba(149, 213, 0, 0.25)',
          badgeText: 'var(--primary-bright, #95D500)',
          badgeLabel: 'ACTIVE',
        };
      case 'infeasible':
        return {
          stroke: 'var(--error, #FF5555)',
          badgeFill: 'rgba(255, 85, 85, 0.15)',
          badgeText: 'var(--error, #FF5555)',
          badgeLabel: 'BREACH',
        };
      case 'pending':
      default:
        return {
          stroke: 'var(--border, #263124)',
          badgeFill: 'rgba(143, 154, 165, 0.15)',
          badgeText: 'var(--text-muted, #727D73)',
          badgeLabel: 'PENDING',
        };
    }
  };

  const renderGlyph = (glyph: string, cx: number, cy: number, isCurrent: boolean) => {
    const strokeColor = isCurrent ? 'var(--primary-bright, #95D500)' : 'var(--text-secondary, #A0AAA0)';
    switch (glyph) {
      case 'waveform':
        return (
          <path
            d={`M ${cx - 10} ${cy + 5} Q ${cx - 5} ${cy - 12} ${cx} ${cy + 2} T ${cx + 10} ${cy - 4}`}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        );
      case 'tensor':
        return (
          <g>
            <rect x={cx - 8} y={cy - 8} width="16" height="16" rx="2" fill="none" stroke={strokeColor} strokeWidth="1.6" />
            <circle cx={cx - 3} cy={cy - 3} r="1.5" fill={strokeColor} />
            <circle cx={cx + 3} cy={cy - 3} r="1.5" fill={strokeColor} />
            <circle cx={cx - 3} cy={cy + 3} r="1.5" fill={strokeColor} />
            <circle cx={cx + 3} cy={cy + 3} r="1.5" fill={strokeColor} />
          </g>
        );
      case 'stopwatch':
        return (
          <g>
            <circle cx={cx} cy={cy + 1} r="8" fill="none" stroke={strokeColor} strokeWidth="1.6" />
            <line x1={cx} y1={cy + 1} x2={cx + 4} y2={cy - 3} stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" />
            <line x1={cx - 3} y1={cy - 9} x2={cx + 3} y2={cy - 9} stroke={strokeColor} strokeWidth="1.6" strokeLinecap="round" />
          </g>
        );
      case 'evaluator':
        return (
          <g>
            <polygon
              points={`${cx},${cy - 8} ${cx + 8},${cy - 3} ${cx + 8},${cy + 4} ${cx},${cy + 9} ${cx - 8},${cy + 4} ${cx - 8},${cy - 3}`}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.6"
            />
            <path
              d={`M ${cx - 3} ${cy + 1} L ${cx - 1} ${cy + 3} L ${cx + 4} ${cy - 2}`}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      case 'verification':
        return (
          <g>
            <rect x={cx - 8} y={cy - 7} width="6" height="14" rx="1.5" fill="none" stroke={strokeColor} strokeWidth="1.4" />
            <rect x={cx + 2} y={cy - 7} width="6" height="14" rx="1.5" fill="none" stroke={strokeColor} strokeWidth="1.4" />
            <line x1={cx - 2} y1={cy} x2={cx + 2} y2={cy} stroke={strokeColor} strokeWidth="1.4" strokeDasharray="1.5 1.5" />
          </g>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`inference-pipeline-diagram-container ${className}`}
      style={{
        position: 'relative',
        backgroundColor: 'var(--surface, #0E120F)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '8px',
        padding: '16px 20px',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: 'var(--primary-bright, #95D500)',
              boxShadow: '0 0 8px rgba(118, 185, 0, 0.4)',
            }}
          />
          <h3
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary, #F0F3EF)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            SLOKern 5-Stage Optimization Pipeline
          </h3>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Deterministic Architecture
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)' }}>
          <span style={{ color: 'var(--text-muted, #727D73)' }}>Active:</span>
          <span style={{ color: 'var(--primary-bright, #95D500)', fontWeight: 600 }}>{selectedStage.title}</span>
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <svg
          viewBox="0 0 1020 280"
          preserveAspectRatio="xMidYMid meet"
          style={{ minWidth: '1020px', width: '100%', height: height ? `${height}px` : 'auto', display: 'block' }}
          role="region"
          aria-label="SLOKern 5-Stage Inference Optimization Pipeline Diagram"
        >
          <defs>
            <filter id={`${idPrefix}-neon-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={`${idPrefix}-glass-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(240, 243, 239, 0.12)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <marker id={`${idPrefix}-chevron`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 1 L 7 5 L 0 9 z" fill="var(--border-strong, #384635)" />
            </marker>
          </defs>

        {/* Inter-stage Connector Buses */}
        {CONNECTORS.map((conn, idx) => (
          <g key={idx}>
            <line
              x1={conn.x1}
              y1={127.5}
              x2={conn.x2}
              y2={127.5}
              stroke="var(--border-strong, #384635)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              markerEnd={`url(#${idPrefix}-chevron)`}
            />
            {/* Animated or styled data pulse indicator */}
            <circle
              cx={(conn.x1 + conn.x2) / 2}
              cy={127.5}
              r="2.5"
              fill="var(--primary, #76B900)"
              filter={`url(#${idPrefix}-neon-glow)`}
            />
            {/* Bus Label */}
            <text
              x={(conn.x1 + conn.x2) / 2}
              y={118}
              textAnchor="middle"
              fill="var(--text-muted, #727D73)"
              fontSize="11"
              fontFamily="var(--font-mono, monospace)"
              letterSpacing="0.04em"
            >
              {conn.label}
            </text>
          </g>
        ))}

        {/* 5 Stage Cards */}
        {STAGES.map((stage, idx) => {
          const cardX = 20 + idx * (168 + 35);
          const cardY = 35;
          const cardW = 168;
          const cardH = 185;
          const isSelected = stage.id === (activeStage || 'feasibility-evaluator');
          const isHovered = stage.id === hoveredStageId;
          const currentStatus = stageStatuses[stage.id] || stage.defaultStatus;
          const tone = getStatusTone(currentStatus);

          return (
            <g
              key={stage.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${stage.title}: ${stage.subtitle}`}
              onClick={() => onSelectStage?.(stage.id)}
              onMouseEnter={() => setHoveredStageId(stage.id)}
              onMouseLeave={() => setHoveredStageId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectStage?.(stage.id);
                }
              }}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              {/* Card Base */}
              <rect
                x={cardX}
                y={cardY}
                width={cardW}
                height={cardH}
                rx={8}
                ry={8}
                fill={isSelected ? 'var(--raised, #151B15)' : isHovered ? 'var(--hover, #1F281E)' : 'var(--surface, #0E120F)'}
                stroke={isSelected ? 'var(--primary, #76B900)' : isHovered ? 'var(--border-strong, #384635)' : 'var(--border, #263124)'}
                strokeWidth={isSelected ? '1.5' : '1'}
              />

              {/* Top Glass Rim Specular Highlight */}
              <rect
                x={cardX + 1}
                y={cardY + 1}
                width={cardW - 2}
                height={2}
                rx={1}
                fill={`url(#${idPrefix}-glass-rim)`}
              />

              {/* Stage Index */}
              <text
                x={cardX + 12}
                y={cardY + 22}
                fill={isSelected ? 'var(--primary-bright, #95D500)' : 'var(--text-muted, #727D73)'}
                fontSize="11"
                fontFamily="var(--font-mono, monospace)"
                fontWeight="700"
              >
                {stage.index}
              </text>

              {/* Status Pill Badge */}
              <rect
                x={cardX + cardW - 56}
                y={cardY + 10}
                width={46}
                height={16}
                rx={3}
                fill={tone.badgeFill}
                stroke={tone.stroke}
                strokeWidth="1"
              />
              <text
                x={cardX + cardW - 33}
                y={cardY + 22}
                textAnchor="middle"
                fill={tone.badgeText}
                fontSize="11"
                fontFamily="var(--font-mono, monospace)"
                fontWeight="700"
                letterSpacing="0.04em"
              >
                {tone.badgeLabel}
              </text>

              {/* Stage Icon Center */}
              <circle
                cx={cardX + cardW / 2}
                cy={cardY + 54}
                r="16"
                fill="var(--raised, #151B15)"
                stroke={isSelected ? 'var(--primary, #76B900)' : 'var(--border, #263124)'}
                strokeWidth="1"
              />
              {renderGlyph(stage.glyph, cardX + cardW / 2, cardY + 54, isSelected)}

              {/* Stage Title & Subtitle */}
              <text
                x={cardX + cardW / 2}
                y={cardY + 88}
                textAnchor="middle"
                fill="var(--text-primary, #F0F3EF)"
                fontSize="12"
                fontFamily="var(--font-mono, monospace)"
                fontWeight="700"
              >
                {stage.title}
              </text>
              <text
                x={cardX + cardW / 2}
                y={cardY + 104}
                textAnchor="middle"
                fill="var(--text-secondary, #A0AAA0)"
                fontSize="11"
                fontFamily="var(--font-mono, monospace)"
              >
                {stage.subtitle}
              </text>

              {/* Telemetry Metric Pill */}
              <rect
                x={cardX + 10}
                y={cardY + 118}
                width={cardW - 20}
                height={54}
                rx={4}
                fill="var(--raised, #151B15)"
                stroke="var(--border, #263124)"
                strokeWidth="1"
              />
              <text
                x={cardX + cardW / 2}
                y={cardY + 132}
                textAnchor="middle"
                fill="var(--text-muted, #727D73)"
                fontSize="11"
                fontFamily="var(--font-mono, monospace)"
                fontWeight="600"
              >
                {stage.metricLabel}
              </text>
              <text
                x={cardX + cardW / 2}
                y={cardY + 148}
                textAnchor="middle"
                fill={isSelected ? 'var(--primary-bright, #95D500)' : 'var(--text-primary, #F0F3EF)'}
                fontSize="12"
                fontFamily="var(--font-mono, monospace)"
                fontWeight="700"
              >
                {stage.metricValue}
              </text>
              <text
                x={cardX + cardW / 2}
                y={cardY + 162}
                textAnchor="middle"
                fill="var(--text-secondary, #A0AAA0)"
                fontSize="11"
                fontFamily="var(--font-mono, monospace)"
              >
                {stage.metricSub}
              </text>

              {/* Active Selection Neon Bar */}
              {isSelected && (
                <rect
                  x={cardX + 24}
                  y={cardY + cardH - 3}
                  width={cardW - 48}
                  height={3}
                  rx={1.5}
                  fill="var(--primary-bright, #95D500)"
                  filter={`url(#${idPrefix}-neon-glow)`}
                />
              )}
            </g>
          );
        })}

        {/* Contextual Inspector Telemetry Ribbon at Bottom */}
        <g>
          <rect
            x={20}
            y={232}
            width={980}
            height={40}
            rx={6}
            fill="var(--raised, #151B15)"
            stroke="var(--border-strong, #384635)"
            strokeWidth="1"
          />
          {/* Specular Edge */}
          <rect
            x={21}
            y={233}
            width={978}
            height={1}
            fill="rgba(240, 243, 239, 0.08)"
          />
          {/* Left: Stage Title & ID */}
          <text
            x={36}
            y={256}
            fill="var(--primary-bright, #95D500)"
            fontSize="11"
            fontFamily="var(--font-mono, monospace)"
            fontWeight="700"
          >
            STAGE {selectedStage.index}: {selectedStage.title.toUpperCase()}
          </text>
          {/* Center: Stage Role & Parameters */}
          <text
            x={280}
            y={256}
            fill="var(--text-secondary, #A0AAA0)"
            fontSize="11"
            fontFamily="var(--font-mono, monospace)"
          >
            {selectedStage.parameters}
          </text>
          {/* Right: Contract Reference */}
          <text
            x={980}
            y={256}
            textAnchor="end"
            fill="var(--text-muted, #727D73)"
            fontSize="11"
            fontFamily="var(--font-mono, monospace)"
          >
            {selectedStage.contractRef}
          </text>
        </g>
      </svg>
      </div>
    </div>
  );
};
