import React, { useState, useMemo, useId } from 'react';
import { identifyParetoFrontier, type UICandidate } from '../../lib/adapters/viewModel';
import { formatNumber, formatLatency } from '../../lib/format';

export interface ParameterMatrixDiagramProps {
  candidates?: any[];
  selectedCandidateId?: string;
  onSelectCandidate?: (candidateId: string) => void;
  className?: string;
  height?: number;
}

interface NormalizedCandidate {
  id: string;
  name: string;
  batch: number;
  concurrency: number;
  maxTokens?: number;
  isConfigMapped?: boolean;
  p95: number | null;
  ttftP95: number | null;
  itlP95: number | null;
  throughput: number | null;
  error: number | null;
  costLabel: string;
  feasible: boolean;
  feasibilityVerdict: 'FEASIBLE' | 'INFEASIBLE' | 'INCONCLUSIVE';
  tag: string;
  reason: string;
  reasonCodes: string[];
  isWinner: boolean;
  raw: any;
}

interface QuadrantSlot {
  col: 0 | 1; // 0 = Concurrency 16, 1 = Concurrency 32
  row: 0 | 1; // 0 = Batch 1 (Bottom), 1 = Batch 4 (Top)
  concurrencyLabel: string;
  batchLabel: string;
  tokensLabel: string;
  boxX: number;
  boxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  candidate: NormalizedCandidate | null;
}

export const ParameterMatrixDiagram: React.FC<ParameterMatrixDiagramProps> = ({
  candidates = [],
  selectedCandidateId,
  onSelectCandidate,
  className = '',
  height,
}) => {
  const idPrefix = useId().replace(/:/g, '');
  const [hoveredCandidate, setHoveredCandidate] = useState<NormalizedCandidate | null>(null);

  // 1. Normalize candidate inputs safely
  const normalizedCandidates: NormalizedCandidate[] = useMemo(() => {
    if (!Array.isArray(candidates)) return [];
    return candidates.filter(Boolean).map((c) => {
      const rawSettings =
        c.applied_config?.effective_settings ||
        c.rawConfig?.effective_settings ||
        c.rawConfig?.requested_settings ||
        c.applied_config?.requested_settings ||
        c.settings ||
        {};
      const extractedBatch =
        c.batch ??
        c.batch_size ??
        c.batchSize ??
        (rawSettings.max_num_batched_tokens
          ? rawSettings.max_num_batched_tokens / 512
          : c.max_num_batched_tokens
          ? c.max_num_batched_tokens / 512
          : undefined);
      const extractedConcurrency =
        c.concurrency ??
        c.conc ??
        c.max_num_seqs ??
        rawSettings.max_num_seqs ??
        rawSettings.concurrency ??
        rawSettings.concurrency_limit ??
        c.rawConfig?.environment_fingerprint?.max_num_seqs ??
        undefined;
      const extractedMaxTokens =
        rawSettings.max_tokens ??
        c.max_tokens ??
        rawSettings.max_new_tokens ??
        undefined;

      const isConfigMapped =
        extractedBatch !== undefined ||
        extractedConcurrency !== undefined ||
        extractedMaxTokens !== undefined;
      const batchVal = extractedBatch != null ? Number(extractedBatch) : 1;
      const concurrencyVal = extractedConcurrency != null ? Number(extractedConcurrency) : 16;
      const maxTokensVal = extractedMaxTokens != null ? Number(extractedMaxTokens) : undefined;
      const ttftVal = c.ttftP95 ?? c.p95 ?? c.metricSet?.ttft_ms?.p95 ?? null;
      const throughputVal = c.throughput ?? c.metricSet?.token_throughput_tps ?? null;
      const itlVal = c.itlP95 ?? c.metricSet?.itl_ms?.p95 ?? null;
      const isFeasible = c.feasible === true || c.feasibilityVerdict === 'FEASIBLE';
      const isWinner = (c.tag === 'WINNER' || c.isWinner === true) && isFeasible;

      // Extract or estimate cost with explicit disclosure
      let costLabel = 'Cost N/A';
      if (c.metricSet?.monetary_cost_per_token != null) {
        costLabel = `$${(c.metricSet.monetary_cost_per_token * 1000).toFixed(4)}/1k tok`;
      } else if (c.metricSet?.gpu_seconds_per_request != null) {
        costLabel = `${c.metricSet.gpu_seconds_per_request.toFixed(3)}s GPU/req`;
      } else if (c.gpu != null && throughputVal != null && throughputVal > 0) {
        const est = ((c.gpu / 100) * 0.00002 * (1000 / throughputVal)).toFixed(4);
        costLabel = `~$${est}/1k tok (est)`;
      }

      return {
        id: c.id || `c-${Math.random().toString(36).substring(2, 7)}`,
        name: c.name || `Candidate ${c.id || 'Unknown'}`,
        batch: Number(batchVal),
        concurrency: Number(concurrencyVal),
        maxTokens: maxTokensVal,
        isConfigMapped,
        p95: ttftVal != null ? Number(ttftVal) : null,
        ttftP95: ttftVal != null ? Number(ttftVal) : null,
        itlP95: itlVal != null ? Number(itlVal) : null,
        throughput: throughputVal != null ? Number(throughputVal) : null,
        error: c.error != null ? Number(c.error) : null,
        costLabel,
        feasible: isFeasible,
        feasibilityVerdict: c.feasibilityVerdict || (isFeasible ? 'FEASIBLE' : 'INFEASIBLE'),
        tag: c.tag || (isWinner ? 'WINNER' : isFeasible ? 'FEASIBLE' : 'INFEASIBLE'),
        reason: c.reason || (isFeasible ? 'All hard constraints satisfied.' : 'Hard constraint threshold exceeded.'),
        reasonCodes: Array.isArray(c.reasonCodes) ? c.reasonCodes : [],
        isWinner,
        raw: c,
      };
    });
  }, [candidates]);

  // 2. Identify Pareto-optimal frontier
  const { paretoIds } = useMemo(() => {
    try {
      // Cast to UICandidate array for standard adapter reuse
      return identifyParetoFrontier(normalizedCandidates as unknown as UICandidate[]);
    } catch {
      return { paretoIds: new Set<string>(), sortedCandidates: [] };
    }
  }, [normalizedCandidates]);

  // Determine whether candidate configurations use client-side loadgen parameters
  const isClientLoadgen = useMemo(() => {
    return normalizedCandidates.some(
      (c) => c.maxTokens != null || (c.concurrency <= 4 && c.batch === 1)
    );
  }, [normalizedCandidates]);

  // 3. Map candidates to the 4 Quadrants
  // Dimensions for SVG viewBox="0 0 760 440"
  const quadrants: QuadrantSlot[] = useMemo(() => {
    // Quadrant layout definitions
    const layout = isClientLoadgen
      ? [
          // Top-Left: High Tokens (128), Low Concurrency (1)
          { col: 0 as const, row: 1 as const, concurrencyLabel: '1 stream', batchLabel: 'Tokens 128', tokensLabel: '128 max tokens', boxX: 100, boxY: 65, width: 285, height: 135, cx: 242, cy: 132 },
          // Top-Right: High Tokens (128), High Concurrency (2)
          { col: 1 as const, row: 1 as const, concurrencyLabel: '2 streams', batchLabel: 'Tokens 128', tokensLabel: '128 max tokens', boxX: 415, boxY: 65, width: 285, height: 135, cx: 557, cy: 132 },
          // Bottom-Left: Low Tokens (32), Low Concurrency (1)
          { col: 0 as const, row: 0 as const, concurrencyLabel: '1 stream', batchLabel: 'Tokens 32', tokensLabel: '32 max tokens', boxX: 100, boxY: 230, width: 285, height: 135, cx: 242, cy: 297 },
          // Bottom-Right: Low Tokens (32), High Concurrency (2)
          { col: 1 as const, row: 0 as const, concurrencyLabel: '2 streams', batchLabel: 'Tokens 32', tokensLabel: '32 max tokens', boxX: 415, boxY: 230, width: 285, height: 135, cx: 557, cy: 297 },
        ]
      : [
          // Top-Left: Batch 4, Concurrency 16
          { col: 0 as const, row: 1 as const, concurrencyLabel: '16 streams', batchLabel: 'Batch 4', tokensLabel: '2048 batched tokens', boxX: 100, boxY: 65, width: 285, height: 135, cx: 242, cy: 132 },
          // Top-Right: Batch 4, Concurrency 32
          { col: 1 as const, row: 1 as const, concurrencyLabel: '32 streams', batchLabel: 'Batch 4', tokensLabel: '2048 batched tokens', boxX: 415, boxY: 65, width: 285, height: 135, cx: 557, cy: 132 },
          // Bottom-Left: Batch 1, Concurrency 16
          { col: 0 as const, row: 0 as const, concurrencyLabel: '16 streams', batchLabel: 'Batch 1', tokensLabel: '512 batched tokens', boxX: 100, boxY: 230, width: 285, height: 135, cx: 242, cy: 297 },
          // Bottom-Right: Batch 1, Concurrency 32
          { col: 1 as const, row: 0 as const, concurrencyLabel: '32 streams', batchLabel: 'Batch 1', tokensLabel: '512 batched tokens', boxX: 415, boxY: 230, width: 285, height: 135, cx: 557, cy: 297 },
        ];

    return layout.map((q) => {
      // Find matching candidates for this quadrant
      const matching = normalizedCandidates.filter((c) => {
        if (isClientLoadgen) {
          const matchesCol = q.col === 0 ? c.concurrency <= 1 : c.concurrency > 1;
          const matchesRow = q.row === 0
            ? (c.maxTokens != null ? c.maxTokens <= 64 : c.batch <= 2)
            : (c.maxTokens != null ? c.maxTokens > 64 : c.batch > 2);
          return matchesCol && matchesRow;
        }
        const matchesCol = q.col === 0 ? c.concurrency <= 24 : c.concurrency > 24;
        const matchesRow = q.row === 0 ? c.batch <= 2 : c.batch > 2;
        return matchesCol && matchesRow;
      });

      // Prefer candidate matching selectedCandidateId, else winner, else first
      const selectedMatch = matching.find((c) => c.id === selectedCandidateId);
      const winnerMatch = matching.find((c) => c.isWinner);
      const cand = selectedMatch || winnerMatch || matching[0] || null;

      return {
        ...q,
        candidate: cand,
      };
    });
  }, [normalizedCandidates, selectedCandidateId, isClientLoadgen]);

  // 4. Calculate Pareto frontier curve path
  const paretoPoints = useMemo(() => {
    const points: { cx: number; cy: number; id: string; cand: NormalizedCandidate }[] = [];
    quadrants.forEach((q) => {
      if (q.candidate && q.candidate.feasible && paretoIds.has(q.candidate.id)) {
        points.push({ cx: q.cx, cy: q.cy, id: q.candidate.id, cand: q.candidate });
      }
    });

    // Sort points by X coordinate (concurrency) then Y coordinate
    return points.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  }, [quadrants, paretoIds]);

  const paretoPathD = useMemo(() => {
    if (paretoPoints.length < 2) return '';
    // Generate smooth bezier curve between points
    if (paretoPoints.length === 2) {
      const [p1, p2] = paretoPoints;
      const midX = (p1.cx + p2.cx) / 2;
      return `M ${p1.cx} ${p1.cy} Q ${midX} ${(p1.cy + p2.cy) / 2 - 20} ${p2.cx} ${p2.cy}`;
    }
    // 3 or more points
    let d = `M ${paretoPoints[0].cx} ${paretoPoints[0].cy}`;
    for (let i = 1; i < paretoPoints.length; i++) {
      const prev = paretoPoints[i - 1];
      const curr = paretoPoints[i];
      const mx = (prev.cx + curr.cx) / 2;
      d += ` C ${mx} ${prev.cy}, ${mx} ${curr.cy}, ${curr.cx} ${curr.cy}`;
    }
    return d;
  }, [paretoPoints]);

  return (
    <div
      className={`parameter-matrix-container ${className}`}
      style={{
        position: 'relative',
        backgroundColor: 'var(--surface, #0E120F)',
        border: '1px solid var(--border, #263124)',
        borderRadius: '8px',
        padding: '18px 20px',
        overflow: 'hidden',
      }}
    >
      {/* Header & Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>
              2×2 Configuration Space & Pareto Frontier
            </span>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '3px',
                backgroundColor: 'rgba(233, 185, 73, 0.12)',
                color: 'var(--warning, #E9B949)',
                border: '1px solid rgba(233, 185, 73, 0.25)',
              }}
            >
              DEMO DATA · BOUNDED MATRIX
            </span>
          </div>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Batch Size (Tokens) × Max Concurrency (Streams) · Empirical 4-Quadrant Feasibility Grid
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary-bright, #95D500)', boxShadow: '0 0 8px rgba(149, 213, 0, 0.6)' }} />
            <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>Winner</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid var(--primary, #76B900)', backgroundColor: 'rgba(118, 185, 0, 0.2)' }} />
            <span style={{ color: 'var(--text-secondary, #A0AAA0)' }}>Feasible</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '7px', height: '7px', transform: 'rotate(45deg)', backgroundColor: 'var(--error, #FF5555)' }} />
            <span style={{ color: 'var(--text-secondary, #A0AAA0)' }}>Infeasible</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', border: '1px dashed var(--border-strong, #384635)' }} />
            <span style={{ color: 'var(--text-muted, #727D73)' }}>Untested</span>
          </div>
          {paretoPoints.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '14px', height: '2px', backgroundColor: 'var(--primary-bright, #95D500)', boxShadow: '0 0 6px rgba(149, 213, 0, 0.8)' }} />
              <span style={{ color: 'var(--primary-bright, #95D500)', fontWeight: 700 }}>Pareto Frontier</span>
            </div>
          )}
        </div>
      </div>

      {/* Main SVG Visualization */}
      <svg
        viewBox="0 0 760 440"
        style={{
          width: '100%',
          height: height || 'auto',
          display: 'block',
          overflow: 'visible',
          fontFamily: 'var(--font-mono, monospace)',
        }}
        role="region"
        aria-label="2x2 Parameter Matrix Configuration Space"
      >
        <defs>
          {/* Subtle Cyberpunk Grid Hatch Pattern */}
          <pattern id={`${idPrefix}-matrixHatch`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="16" stroke="var(--border, #263124)" strokeWidth="0.75" opacity="0.4" />
          </pattern>

          {/* Glow Filters */}
          <filter id={`${idPrefix}-paretoGlow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id={`${idPrefix}-winnerBeaconGlow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="blur1" />
            <feGaussianBlur stdDeviation="2" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Beacon Pulse Style Animation */}
          <style>{`
            @keyframes tensorPulse {
              0% { r: 10px; opacity: 0.9; stroke-width: 1.5px; }
              50% { r: 24px; opacity: 0.2; stroke-width: 2.5px; }
              100% { r: 10px; opacity: 0.9; stroke-width: 1.5px; }
            }
            .winner-pulse-ring {
              animation: tensorPulse 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
              transform-origin: center;
            }
            .matrix-node-interactive {
              transition: transform 160ms ease, filter 160ms ease;
            }
            .matrix-node-interactive:hover {
              filter: brightness(1.12);
            }
            .matrix-node-interactive:focus-visible {
              outline: 2px solid var(--primary-bright, #95D500);
              outline-offset: 4px;
            }
          `}</style>
        </defs>

        {/* Background Grid Separator Lines */}
        <line x1="400" y1="50" x2="400" y2="385" stroke="var(--border-strong, #384635)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
        <line x1="80" y1="215" x2="720" y2="215" stroke="var(--border-strong, #384635)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />

        {/* Y-Axis Label: Batch Size */}
        <text
          transform="rotate(-90) translate(-215, 24)"
          fill="var(--text-secondary, #A0AAA0)"
          fontSize="11px"
          fontWeight="700"
          letterSpacing="0.08em"
          textAnchor="middle"
        >
          {isClientLoadgen ? 'MAX OUTPUT TOKENS ↑' : 'BATCH SIZE (TOKENS) ↑'}
        </text>

        {/* Y-Axis Row Ticks */}
        <text x="75" y="136" fill="var(--text-primary, #F0F3EF)" fontSize="11px" fontWeight="600" textAnchor="end">
          {isClientLoadgen ? '128 tok' : 'Batch 4'}
        </text>
        <text x="75" y="150" fill="var(--text-muted, #727D73)" fontSize="11px" textAnchor="end">
          {isClientLoadgen ? '(Max Tokens)' : '(2048 tok)'}
        </text>

        <text x="75" y="301" fill="var(--text-primary, #F0F3EF)" fontSize="11px" fontWeight="600" textAnchor="end">
          {isClientLoadgen ? '32 tok' : 'Batch 1'}
        </text>
        <text x="75" y="315" fill="var(--text-muted, #727D73)" fontSize="11px" textAnchor="end">
          {isClientLoadgen ? '(Max Tokens)' : '(512 tok)'}
        </text>

        {/* X-Axis Column Ticks */}
        <text x="242" y="398" fill="var(--text-primary, #F0F3EF)" fontSize="11px" fontWeight="600" textAnchor="middle">
          {isClientLoadgen ? '1 stream' : '16 streams'}
        </text>
        <text x="242" y="412" fill="var(--text-muted, #727D73)" fontSize="11px" textAnchor="middle">
          (Low Concurrency)
        </text>

        <text x="557" y="398" fill="var(--text-primary, #F0F3EF)" fontSize="11px" fontWeight="600" textAnchor="middle">
          {isClientLoadgen ? '2 streams' : '32 streams'}
        </text>
        <text x="557" y="412" fill="var(--text-muted, #727D73)" fontSize="11px" textAnchor="middle">
          (High Concurrency)
        </text>

        {/* X-Axis Label: Concurrency */}
        <text x="400" y="432" fill="var(--text-secondary, #A0AAA0)" fontSize="11px" fontWeight="700" letterSpacing="0.08em" textAnchor="middle">
          {isClientLoadgen ? 'CLIENT CONCURRENCY (STREAMS) →' : 'MAX CONCURRENCY (STREAMS) →'}
        </text>

        {/* Pareto Frontier Curve Layer (Underneath nodes) */}
        {paretoPathD && (
          <g className="pareto-frontier-layer">
            <path
              d={paretoPathD}
              fill="none"
              stroke="var(--primary-bright, #95D500)"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              filter={`url(#${idPrefix}-paretoGlow)`}
              opacity="0.9"
            />
            {/* Pareto Frontier Floating Label */}
            {paretoPoints.length >= 2 && (
              <g transform={`translate(${(paretoPoints[0].cx + paretoPoints[paretoPoints.length - 1].cx) / 2}, ${(paretoPoints[0].cy + paretoPoints[paretoPoints.length - 1].cy) / 2 - 14})`}>
                <rect x="-56" y="-10" width="112" height="20" rx="3" fill="var(--canvas, #080A09)" stroke="var(--primary, #76B900)" strokeWidth="1" />
                <text x="0" y="4" fill="var(--primary-bright, #95D500)" fontSize="11px" fontWeight="700" textAnchor="middle">
                  PARETO FRONTIER
                </text>
              </g>
            )}
          </g>
        )}

        {/* 4 Quadrant Candidate Cards */}
        {quadrants.map((q, idx) => {
          const c = q.candidate;
          const isSelected = c ? c.id === selectedCandidateId : false;
          const isPareto = c ? paretoIds.has(c.id) : false;

          if (!c) {
            // UNTESTED / PENDING QUADRANT SLOT
            return (
              <g key={`quadrant-empty-${idx}`} transform={`translate(${q.boxX}, ${q.boxY})`}>
                <rect
                  width={q.width}
                  height={q.height}
                  rx="6"
                  fill={`url(#${idPrefix}-matrixHatch)`}
                  stroke="var(--border, #263124)"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <text x={q.width / 2} y="55" fill="var(--text-muted, #727D73)" fontSize="11px" fontWeight="600" textAnchor="middle">
                  {q.batchLabel} × {q.concurrencyLabel}
                </text>
                <text x={q.width / 2} y="74" fill="var(--text-tertiary, #7A857B)" fontSize="11px" textAnchor="middle">
                  [ UNTESTED / PENDING ]
                </text>
                <text x={q.width / 2} y="92" fill="var(--text-muted, #727D73)" fontSize="11px" opacity="0.6" textAnchor="middle">
                  Declared search space slot
                </text>
              </g>
            );
          }

          // TESTED CANDIDATE NODE
          const isWinner = c.isWinner;
          const isFeasible = c.feasible;

          // Visual styles based on state
          const cardBg = isWinner
            ? 'var(--elevated, #1D251E)'
            : isFeasible
            ? 'var(--raised, #151B15)'
            : 'rgba(255, 85, 85, 0.06)';

          const cardBorder = isWinner
            ? 'var(--primary-bright, #95D500)'
            : isSelected
            ? 'var(--text-primary, #F0F3EF)'
            : isFeasible
            ? 'var(--border-strong, #384635)'
            : 'rgba(255, 85, 85, 0.45)';

          return (
            <g
              key={c.id}
              className="matrix-node-interactive"
              transform={`translate(${q.boxX}, ${q.boxY})`}
              tabIndex={0}
              role="button"
              aria-label={`Candidate ${c.id}: ${c.tag}, TTFT P95: ${c.ttftP95 ?? 'N/A'}ms, Throughput: ${c.throughput ?? 'N/A'} tok/s`}
              aria-pressed={isSelected}
              onClick={() => onSelectCandidate?.(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCandidate?.(c.id);
                }
              }}
              onMouseEnter={() => setHoveredCandidate(c)}
              onMouseLeave={() => setHoveredCandidate(null)}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              {/* Outer Selection Highlight Outline */}
              {isSelected && (
                <rect
                  x="-3"
                  y="-3"
                  width={q.width + 6}
                  height={q.height + 6}
                  rx="9"
                  fill="none"
                  stroke={isWinner ? 'var(--primary, #76B900)' : 'var(--text-primary, #F0F3EF)'}
                  strokeWidth="2"
                  strokeDasharray={isWinner ? undefined : '3 2'}
                />
              )}

              {/* Main Card Background */}
              <rect
                width={q.width}
                height={q.height}
                rx="6"
                fill={cardBg}
                stroke={cardBorder}
                strokeWidth={isWinner ? '1.8' : '1.2'}
                filter={isWinner ? `url(#${idPrefix}-winnerBeaconGlow)` : undefined}
              />

              {/* Card Header: Candidate ID & Status Badge */}
              <text x="14" y="24" fill="var(--text-primary, #F0F3EF)" fontSize="12px" fontWeight="700">
                {c.id.substring(0, 10)}
              </text>

              <g transform={`translate(${q.width - 14}, 18)`}>
                {isWinner ? (
                  <g>
                    <rect x="-84" y="-8" width="84" height="18" rx="3" fill="var(--primary-bright, #95D500)" />
                    <text x="-42" y="5" fill="#080A09" fontSize="11px" fontWeight="800" textAnchor="middle">
                      ★ WINNER
                    </text>
                  </g>
                ) : isFeasible ? (
                  <g>
                    <rect
                      x="-72"
                      y="-8"
                      width="72"
                      height="18"
                      rx="3"
                      fill="rgba(118, 185, 0, 0.16)"
                      stroke="var(--primary, #76B900)"
                      strokeWidth="0.8"
                    />
                    <text x="-36" y="5" fill="var(--primary-bright, #95D500)" fontSize="11px" fontWeight="700" textAnchor="middle">
                      {isPareto ? 'PARETO' : 'FEASIBLE'}
                    </text>
                  </g>
                ) : (
                  <g>
                    <rect
                      x="-88"
                      y="-8"
                      width="88"
                      height="18"
                      rx="3"
                      fill="rgba(255, 85, 85, 0.16)"
                      stroke="var(--error, #FF5555)"
                      strokeWidth="0.8"
                    />
                    <text x="-44" y="5" fill="var(--error, #FF5555)" fontSize="11px" fontWeight="700" textAnchor="middle">
                      ✕ INFEASIBLE
                    </text>
                  </g>
                )}
              </g>

              {/* Sub-label: Configuration Profile */}
              <text x="14" y="42" fill="var(--text-muted, #727D73)" fontSize="11px">
                {c.maxTokens != null
                  ? `max_tokens=${c.maxTokens} · conc=${c.concurrency}`
                  : `batch=${c.batch} (${c.batch * 512}t) · conc=${c.concurrency}${c.isConfigMapped === false ? ' (est)' : ''}`}
              </text>

              {/* Hairline Separator */}
              <line x1="14" y1="50" x2={q.width - 14} y2="50" stroke="var(--border, #263124)" strokeWidth="1" />

              {/* Metrics Grid */}
              {isFeasible ? (
                <g transform="translate(14, 68)">
                  {/* Metric 1: TTFT P95 */}
                  <text x="0" y="0" fill="var(--text-muted, #727D73)" fontSize="11px">TTFT (P95)</text>
                  <text x="0" y="18" fill="var(--text-primary, #F0F3EF)" fontSize="13px" fontWeight="700">
                    {formatLatency(c.ttftP95)}
                  </text>

                  {/* Metric 2: Throughput */}
                  <text x="88" y="0" fill="var(--text-muted, #727D73)" fontSize="11px">THROUGHPUT</text>
                  <text x="88" y="18" fill="var(--primary-bright, #95D500)" fontSize="13px" fontWeight="700">
                    {formatNumber(c.throughput, 1)} <tspan fontSize="11px">tok/s</tspan>
                  </text>

                  {/* Metric 3: Cost */}
                  <text x="180" y="0" fill="var(--text-muted, #727D73)" fontSize="11px">COST</text>
                  <text x="180" y="18" fill="var(--text-secondary, #A0AAA0)" fontSize="11px" fontWeight="600">
                    {c.costLabel}
                  </text>
                </g>
              ) : (
                <g transform="translate(14, 68)">
                  {/* Infeasible Reason Callout Banner */}
                  <rect x="0" y="-4" width={q.width - 28} height="28" rx="3" fill="rgba(255, 85, 85, 0.12)" stroke="rgba(255, 85, 85, 0.3)" strokeWidth="0.8" />
                  <text x="8" y="14" fill="var(--error, #FF5555)" fontSize="10px" fontWeight="700">
                    Breach: {(c.reasonCodes[0] || c.reason || 'SLO Latency Exceeded').slice(0, 26)}
                  </text>

                  <text x="0" y="44" fill="var(--text-muted, #727D73)" fontSize="11px">
                    TTFT: <tspan fill="var(--error, #FF5555)" fontWeight="600">{formatLatency(c.ttftP95)}</tspan> · <tspan fill="var(--text-primary, #F0F3EF)">{formatNumber(c.throughput, 1)} tok/s</tspan>
                  </text>
                </g>
              )}

              {/* Tensor Beacon Indicator Pip at Center of Quadrant */}
              <g transform={`translate(${q.width - 24}, ${q.height - 20})`}>
                {isWinner ? (
                  <g>
                    <circle cx="0" cy="0" r="14" fill="none" stroke="var(--primary-bright, #95D500)" className="winner-pulse-ring" />
                    <circle cx="0" cy="0" r="6" fill="var(--primary-bright, #95D500)" stroke="#080A09" strokeWidth="1.5" />
                  </g>
                ) : isFeasible ? (
                  <circle cx="0" cy="0" r="4.5" fill="var(--primary, #76B900)" stroke="#080A09" strokeWidth="1" />
                ) : (
                  <rect x="-3.5" y="-3.5" width="7" height="7" transform="rotate(45)" fill="var(--error, #FF5555)" />
                )}
              </g>
            </g>
          );
        })}
      </svg>

      {/* Floating Hover Glass Tooltip — quadrant-aware positioning to prevent edge overflow and card occlusion */}
      {hoveredCandidate && (() => {
        const isTopHalf = hoveredCandidate.batch > 1;
        const isRightHalf = hoveredCandidate.concurrency > 16;
        return (
          <div
            style={{
              position: 'absolute',
              ...(isTopHalf ? { bottom: '22px', top: 'unset' as const } : { top: '76px', bottom: 'unset' as const }),
              ...(isRightHalf ? { left: '24px', right: 'unset' as const } : { right: '24px', left: 'unset' as const }),
              backgroundColor: 'var(--glass-float, rgba(29, 37, 30, 0.94))',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border-strong, #384635)',
              borderRadius: '6px',
              padding: '12px 16px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary, #F0F3EF)',
              pointerEvents: 'none',
              zIndex: 20,
              boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.6))',
              maxWidth: '340px',
            }}
          >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary, #F0F3EF)' }}>
              {hoveredCandidate.name}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: hoveredCandidate.isWinner
                  ? 'var(--primary-bright, #95D500)'
                  : hoveredCandidate.feasible
                  ? 'var(--primary, #76B900)'
                  : 'var(--error, #FF5555)',
              }}
            >
              {hoveredCandidate.tag}
            </span>
          </div>

          <div style={{ color: 'var(--text-secondary, #A0AAA0)', marginBottom: '8px', fontSize: '11px' }}>
            Configuration: batch={hoveredCandidate.batch} ({hoveredCandidate.batch * 512} tokens), concurrency={hoveredCandidate.concurrency} streams
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
            <div>
              <span style={{ color: 'var(--text-muted, #727D73)' }}>TTFT P95: </span>
              <span style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>{formatLatency(hoveredCandidate.ttftP95)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted, #727D73)' }}>Throughput: </span>
              <span style={{ color: 'var(--primary-bright, #95D500)', fontWeight: 700 }}>
                {formatNumber(hoveredCandidate.throughput, 1)} tok/s
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted, #727D73)' }}>ITL P95: </span>
              <span style={{ color: 'var(--text-primary, #F0F3EF)' }}>{formatLatency(hoveredCandidate.itlP95)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted, #727D73)' }}>Cost Proxy: </span>
              <span style={{ color: 'var(--text-secondary, #A0AAA0)' }}>{hoveredCandidate.costLabel}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border, #263124)', paddingTop: '6px', fontSize: '11px', color: 'var(--text-muted, #727D73)' }}>
            <strong>Status:</strong> {hoveredCandidate.reason}
          </div>
        </div>
        );
      })()}
    </div>
  );
};
