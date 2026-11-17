import React, { useState } from 'react';
import { Badge } from '../components/common/Badge';
import { DemoDataChip } from '../components/common/DemoDataChip';
import { SegmentedControl } from '../components/common/SegmentedControl';
import { EmptyState } from '../components/common/EmptyState';
import { TelemetryScrubber } from '../components/charts/TelemetryScrubber';
import type { UIExperiment } from '../lib/adapters/viewModel';

interface ExperimentsViewProps {
  experiments: UIExperiment[];
  onSelectRun: (exp: UIExperiment) => void;
}

export const ExperimentsView: React.FC<ExperimentsViewProps> = ({
  experiments,
  onSelectRun,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Completed' | 'Running' | 'Failed'>('all');
  const [selectedScrubberRun, setSelectedScrubberRun] = useState<string>('run_01HZX8F2');

  const filtered = experiments.filter((e) => {
    const matchesSearch =
      e.run.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.workload.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.model.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || e.state === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getFeasibilityTone = (f: string) => {
    if (f === 'Feasible') return 'feasible';
    if (f === 'Infeasible') return 'infeasible';
    return 'inconclusive';
  };

  const getVerificationTone = (v: string) => {
    if (v === 'Verified') return 'verified';
    if (v === 'Failed') return 'infeasible';
    if (v === 'Pending') return 'warning';
    return 'neutral';
  };

  const getEvidenceTone = (ev?: string) => {
    if (ev === 'LIVE') return 'verified';
    if (ev === 'DEMO DATA') return 'demo';
    return 'neutral';
  };

  const getValidityTone = (v?: string) => {
    if (v === 'VALID') return 'neutral';
    if (v === 'STALE') return 'warning';
    return 'infeasible';
  };

  const hasDemoData = experiments.some(
    (e) => e.evidenceClassification === 'DEMO DATA' || (e as any).isSimulated
  );

  return (
    <div className="view-experiments workspace-enter" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', letterSpacing: '-0.025em', textWrap: 'balance' }}>
              Experiment Runs & Telemetry History
            </h1>
            {hasDemoData && <DemoDataChip size="sm" />}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.45, textWrap: 'pretty', maxWidth: '75ch' }}>
            Search runs, execution states, offered-vs-achieved load audits, and unaggregated trace evidence
          </p>
        </div>
      </div>

      {/* Time-Series Empirical Request Scrubber Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 650, color: 'var(--text-secondary, #A0AAA0)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Sample Stream Inspection · Active Run: {selectedScrubberRun}
          </span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Arrow keys scrub empirical samples (clamped HUD 16–84%)
          </span>
        </div>
        <TelemetryScrubber ttftCeilingMs={50.0} />
      </div>

      {/* Filter & Search Bar with SegmentedControl */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '400px' }}>
          <input
            type="text"
            placeholder="Search run ID, workload, model, or candidate..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--surface, #0E120F)',
              border: '1px solid var(--border, #263124)',
              borderRadius: '4px',
              padding: '6px 12px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary, #F0F3EF)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            State:
          </span>
          <SegmentedControl
            options={[
              { value: 'all', label: 'All Runs' },
              { value: 'Completed', label: 'Completed' },
              { value: 'Running', label: 'Running' },
              { value: 'Failed', label: 'Failed' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            size="sm"
          />
        </div>
      </div>

      {/* Table or EmptyState */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No experiment runs match filter"
          description={`No recorded experiment runs matched query "${searchTerm}" under filter "${statusFilter}". Try searching by a different run ID or reset filters.`}
          actionLabel="Reset Filters & Search"
          showRadarGraphic={true}
          onAction={() => {
            setSearchTerm('');
            setStatusFilter('all');
          }}
        />
      ) : (
        <div
          style={{
            backgroundColor: 'var(--surface, #0E120F)',
            border: '1px solid var(--border, #263124)',
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          <div
            className="table-scroll"
            style={{
              maxHeight: 'calc(100vh - 360px)',
              overflowY: 'auto',
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '12px',
                fontFamily: 'var(--font-mono, monospace)',
                textAlign: 'left',
              }}
            >
              <thead>
                <tr
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    backgroundColor: 'var(--raised, #151B15)',
                    boxShadow: 'inset 0 -1px 0 var(--border, #263124)',
                    color: 'var(--text-secondary, #A0AAA0)',
                    fontSize: '11px',
                    letterSpacing: '0.06em',
                  }}
                >
                  <th style={{ padding: '10px 14px', width: '130px', minWidth: '130px' }}>RUN ID</th>
                  <th style={{ padding: '10px 14px', width: '140px', minWidth: '140px' }}>WORKLOAD</th>
                  <th style={{ padding: '10px 14px', width: '120px', minWidth: '120px' }}>MODEL</th>
                  <th style={{ padding: '10px 14px', width: '90px', minWidth: '90px' }}>CONFIG</th>
                  <th style={{ padding: '10px 14px', width: '110px', minWidth: '110px' }}>EVIDENCE</th>
                  <th style={{ padding: '10px 14px', width: '130px', minWidth: '130px' }}>OFFERED / ACH.</th>
                  <th style={{ padding: '10px 14px', width: '90px', minWidth: '90px' }}>TTFT P95</th>
                  <th style={{ padding: '10px 14px', width: '85px', minWidth: '85px' }}>ITL P95</th>
                  <th style={{ padding: '10px 14px', width: '100px', minWidth: '100px' }}>THROUGHPUT</th>
                  <th style={{ padding: '10px 14px', width: '90px', minWidth: '90px' }}>VALIDITY</th>
                  <th style={{ padding: '10px 14px', width: '85px', minWidth: '85px' }}>STATE</th>
                  <th style={{ padding: '10px 14px', width: '100px', minWidth: '100px' }}>FEASIBILITY</th>
                  <th style={{ padding: '10px 14px', width: '110px', minWidth: '110px' }}>VERIFICATION</th>
                  <th style={{ padding: '10px 14px', width: '80px', minWidth: '80px' }}>UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((exp, idx) => {
                  const isScrubberActive = selectedScrubberRun === exp.run;
                  const reqRate = exp.requestedRateRps;
                  const achRate = exp.achievedRateRps;
                  const validity = exp.measurementValidity ?? 'Unavailable';
                  const ttft = exp.metrics?.ttft_ms?.p95;
                  const itl = exp.metrics?.itl_ms?.p95;
                  const tps = exp.metrics?.output_token_throughput_tps ?? exp.metrics?.token_throughput_tps;

                  return (
                    <tr
                      key={exp.run}
                      onClick={() => {
                        setSelectedScrubberRun(exp.run);
                        onSelectRun(exp);
                      }}
                      className={`experiment-table-row ${isScrubberActive ? 'active-scrubber-row' : ''}`}
                      style={{
                        borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border, #263124)',
                        cursor: 'pointer',
                        backgroundColor: isScrubberActive
                          ? 'rgba(118, 185, 0, 0.08)'
                          : idx % 2 === 0
                          ? 'transparent'
                          : 'rgba(255, 255, 255, 0.01)',
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={isScrubberActive}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setSelectedScrubberRun(exp.run);
                          onSelectRun(exp);
                        }
                      }}
                    >
                      {/* RUN ID */}
                      <td style={{ padding: '10px 14px', color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isScrubberActive && (
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary-bright, #95D500)', boxShadow: '0 0 6px var(--primary-bright, #95D500)' }} />
                          )}
                          <span>{exp.run}</span>
                        </div>
                      </td>

                      {/* WORKLOAD */}
                      <td style={{ padding: '10px 14px', color: 'var(--text-primary, #F0F3EF)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                        {exp.workload}
                      </td>

                      {/* MODEL */}
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary, #A0AAA0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                        {exp.model}
                      </td>

                      {/* CANDIDATE CONFIG */}
                      <td style={{ padding: '10px 14px', color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>
                        {exp.candidateId}
                      </td>

                      {/* EVIDENCE CLASSIFICATION */}
                      <td style={{ padding: '10px 14px' }}>
                        <Badge tone={getEvidenceTone(exp.evidenceClassification)} size="sm">
                          {exp.evidenceClassification ?? 'UNVERIFIED'}
                        </Badge>
                      </td>

                      {/* OFFERED / ACHIEVED RATE (.tabular-nums) */}
                      <td className="tabular-nums" style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-primary, #F0F3EF)' }}>{reqRate?.toFixed(1) ?? '—'}</span>
                        <span style={{ color: 'var(--text-muted, #727D73)', margin: '0 4px' }}>/</span>
                        <span
                          style={{
                            color:
                              achRate != null && reqRate != null && achRate >= reqRate * 0.95
                                ? 'var(--primary-bright, #95D500)'
                                : 'var(--warning, #E9B949)',
                            fontWeight: 600,
                          }}
                        >
                          {achRate?.toFixed(1) ?? '—'} rps
                        </span>
                      </td>

                      {/* TTFT P95 (.tabular-nums) */}
                      <td className="tabular-nums" style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            color: ttft != null ? (ttft <= 50 ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)') : 'var(--text-muted, #727D73)',
                            fontWeight: ttft != null ? 600 : 400,
                          }}
                        >
                          {ttft != null ? `${ttft.toFixed(1)} ms` : '—'}
                        </span>
                      </td>

                      {/* ITL P95 (.tabular-nums) */}
                      <td className="tabular-nums" style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            color: itl != null ? (itl <= 15 ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)') : 'var(--text-muted, #727D73)',
                            fontWeight: itl != null ? 600 : 400,
                          }}
                        >
                          {itl != null ? `${itl.toFixed(1)} ms` : '—'}
                        </span>
                      </td>

                      {/* THROUGHPUT (.tabular-nums) */}
                      <td className="tabular-nums" style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            color: tps != null ? 'var(--text-primary, #F0F3EF)' : 'var(--text-muted, #727D73)',
                            fontWeight: tps != null ? 600 : 400,
                          }}
                        >
                          {tps != null ? `${Math.round(tps).toLocaleString()} tok/s` : '—'}
                        </span>
                      </td>

                      {/* VALIDITY */}
                      <td style={{ padding: '10px 14px' }}>
                        <Badge tone={getValidityTone(validity)} size="sm">
                          {validity}
                        </Badge>
                      </td>

                      {/* STATE */}
                      <td style={{ padding: '10px 14px' }}>
                        <Badge
                          tone={exp.state === 'Completed' ? 'neutral' : exp.state === 'Running' ? 'warning' : 'infeasible'}
                          size="sm"
                        >
                          {exp.state}
                        </Badge>
                      </td>

                      {/* FEASIBILITY */}
                      <td style={{ padding: '10px 14px' }}>
                        <Badge tone={getFeasibilityTone(exp.feasibility)} size="sm">
                          {exp.feasibility}
                        </Badge>
                      </td>

                      {/* VERIFICATION */}
                      <td style={{ padding: '10px 14px' }}>
                        <Badge tone={getVerificationTone(exp.verification)} size="sm">
                          {exp.verification}
                        </Badge>
                      </td>

                      {/* UPDATED */}
                      <td style={{ padding: '10px 14px', color: 'var(--text-muted, #727D73)' }}>
                        {exp.updated}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
