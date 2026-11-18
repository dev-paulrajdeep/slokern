import React, { useState } from 'react';
import { Badge } from '../components/common/Badge';
import { DemoDataChip } from '../components/common/DemoDataChip';
import { DriftGateBar } from '../components/charts/DriftGateBar';
import { VerificationGateDiagram } from '../components/diagrams/VerificationGateDiagram';
import { formatNumber } from '../lib/format';
import type { VerificationDerivationResult } from '../lib/status';
import type { UICandidate } from '../lib/adapters/viewModel';
import { mapVerificationComparisons } from '../lib/adapters/viewModel';
import type { VerificationRecord } from '../types/contracts';
import { fetchRunTrace } from '../api/client';

interface VerificationViewProps {
  recommendedCandidate: UICandidate;
  verificationStatus: VerificationDerivationResult;
  verificationRecord?: VerificationRecord | null;
  searchRunId?: string;
  verificationRunId?: string;
  arrivalMode?: string | null;
  durationMultiplier?: number | null;
}

interface ComparisonMetric {
  name: string;
  searchVal: number;
  verifyVal: number;
  drift: number;
  tolerance: number;
  unit: string;
  format: (value: number) => string;
  passed: boolean;
}

interface TriageCategory {
  id: string;
  title: string;
  tolerance: string;
  status: 'PASSED' | 'FAILED' | 'PENDING';
  tone: 'verified' | 'infeasible' | 'warning' | 'neutral';
  description: string;
  reasonCodes: string[];
}

const getClinicalTriageCategories = (
  candidate: UICandidate,
  isPending: boolean,
  _isVerified: boolean,
  verificationFailed: boolean
): TriageCategory[] => {
  const codes = candidate.reasonCodes || [];
  const hasHardBreach = !candidate.feasible || codes.some((c) => c.includes('EXCEEDED') || c.includes('DEFICIT'));
  const hasDriftBreach = verificationFailed || codes.some((c) => c.includes('DRIFT'));
  const hasEvidenceIssue =
    candidate.evidenceValidity === 'INVALID' ||
    candidate.evidenceValidity === 'CONTAMINATED' ||
    codes.some((c) => c.includes('INSUFFICIENT') || c.includes('CONTAMINATED') || c.includes('MISSING'));

  return [
    {
      id: 'hard-slo',
      title: 'Hard SLO Constraints',
      tolerance: '0.0% Breach Tolerance (Strict Floor/Ceiling)',
      status: hasHardBreach ? 'FAILED' : 'PASSED',
      tone: hasHardBreach ? 'infeasible' : 'verified',
      description: 'Evaluates TTFT, ITL, and Error Rate against declared service-level thresholds.',
      reasonCodes: codes.filter((c) => c.includes('EXCEEDED') || c.includes('DEFICIT') || c === 'HARD_CONSTRAINTS_PASSED'),
    },
    {
      id: 'boundary-drift',
      title: 'Physical Boundary Drift',
      tolerance: '±3.0 ms TTFT · ±10.0 tok/s Throughput Gate',
      status: isPending ? 'PENDING' : hasDriftBreach ? 'FAILED' : 'PASSED',
      tone: isPending ? 'warning' : hasDriftBreach ? 'infeasible' : 'verified',
      description: 'Audits empirical metric variance between search campaign and verification rerun.',
      reasonCodes: codes.filter((c) => c.includes('DRIFT')),
    },
    {
      id: 'feasibility',
      title: 'Feasibility Space Boundary',
      tolerance: 'Bounded 2×2 Parameter Envelope (Batch × Concurrency)',
      status: candidate.feasible ? 'PASSED' : 'FAILED',
      tone: candidate.feasible ? 'verified' : 'infeasible',
      description: 'Confirms applied serving parameters match declared legal search envelope.',
      reasonCodes: codes.filter((c) => c === 'HARD_CONSTRAINTS_PASSED' || c === 'PARETO_OPTIMAL'),
    },
    {
      id: 'evidence-validity',
      title: 'Evidence Validity & Sample Integrity',
      tolerance: '≥100 Valid Samples · Uncontaminated Arrival Pattern',
      status: hasEvidenceIssue ? 'FAILED' : 'PASSED',
      tone: hasEvidenceIssue ? 'infeasible' : 'verified',
      description: 'Ensures load generator saturation and sample contamination do not compromise integrity.',
      reasonCodes: codes.filter((c) => c.includes('SAMPLES') || c.includes('CONTAMINATED') || c.includes('MISSING')),
    },
  ];
};

export const VerificationView: React.FC<VerificationViewProps> = ({
  recommendedCandidate,
  verificationStatus,
  verificationRecord,
  searchRunId = 'run-83697f4a197e',
  verificationRunId = 'PENDING (NOT YET RECORDED)',
  arrivalMode,
  durationMultiplier,
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isVerified = verificationRecord
    ? verificationRecord.verification_verdict === 'VERIFIED'
    : verificationStatus.isVerifiedWinner;
  const verificationFailed = verificationRecord?.verification_verdict === 'VERIFICATION_FAILED';
  const isPending =
    (verificationRecord?.verification_verdict as any) === 'INDEPENDENT VERIFICATION PENDING' ||
    !verificationRunId ||
    verificationRunId.includes('PENDING');
  const verificationLabel = isPending
    ? 'INDEPENDENT VERIFICATION PENDING'
    : isVerified
      ? 'VERIFIED'
      : verificationFailed ? 'VERIFICATION FAILED' : 'VERIFICATION INCONCLUSIVE';

  const availableMetrics: ComparisonMetric[] = mapVerificationComparisons(verificationRecord).map((comparison) => ({
    ...comparison,
    format: (value: number) => `${formatNumber(value, 2)} ${comparison.unit}`,
  }));

  const effectiveCandidateId = verificationRecord?.candidate_id || recommendedCandidate.id;
  const effectiveCandidateName = verificationRecord?.candidate_id
    ? (verificationRecord.candidate_id === recommendedCandidate.id
        ? recommendedCandidate.name
        : `Candidate ${verificationRecord.candidate_id.slice(0, 8)}`)
    : recommendedCandidate.name;
  const effectiveThroughput =
    verificationRecord?.metric_set?.token_throughput_tps ??
    verificationRecord?.drift_analysis?.metric_comparisons?.['token_throughput_tps']?.reference_value ??
    verificationRecord?.drift_analysis?.metric_comparisons?.['token_throughput_tps_mean']?.reference_value ??
    recommendedCandidate.throughput;

  const handleDownloadTrace = async () => {
    setDownloading(true);
    try {
      const traceText = await fetchRunTrace(searchRunId);
      const blob = new Blob([traceText], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${searchRunId}_raw_measurements.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } catch {
      // If run trace not directly fetchable, export candidate metric payload
      const payload = JSON.stringify(recommendedCandidate, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${searchRunId}_evidence.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="view-verification workspace-enter" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Workspace Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', letterSpacing: '-0.025em', textWrap: 'balance' }}>
              Independent Decision Verification & Drift Auditing
            </h1>
            <DemoDataChip size="sm" />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.45, textWrap: 'pretty', maxWidth: '75ch' }}>
            Fresh execution protocol verifying candidate recommendation under identical arrival distribution
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadTrace}
          disabled={downloading}
          style={{
            background: 'none',
            border: '1px solid var(--border-strong, #384635)',
            backgroundColor: 'var(--elevated, #1D251E)',
            color: downloadSuccess ? 'var(--primary-bright, #95D500)' : 'var(--text-primary, #F0F3EF)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 600,
            padding: '6px 14px',
            borderRadius: '4px',
            cursor: downloading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{downloadSuccess ? '✓ Downloaded Trace!' : downloading ? 'Exporting...' : 'Export Raw Measurements Trace (.jsonl)'}</span>
        </button>
      </div>

      {/* Verification Independence Card: Search Run ID vs Verification Run ID */}
      <div
        style={{
          padding: '20px 24px',
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid',
          borderColor: isPending ? 'var(--warning, #E9B949)' : isVerified ? 'var(--border-strong, #384635)' : 'var(--border, #263124)',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: isVerified ? 'var(--glow-winner)' : 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge tone={isPending ? 'warning' : isVerified ? 'verified' : verificationFailed ? 'infeasible' : 'neutral'} size="md">
              {verificationLabel}
            </Badge>
            <span style={{ fontSize: '14px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
              Candidate: {effectiveCandidateId} · {effectiveCandidateName}
            </span>
          </div>

          <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
              Protocol: {durationMultiplier != null && arrivalMode ? `${durationMultiplier}× duration · ${arrivalMode} arrival · ` : 'Protocol metadata unavailable · '}Distinct Run ID
          </div>
        </div>

        {/* Side-by-Side Run IDs */}
        <div className="verification-runs-grid" style={{ fontSize: '12px', fontFamily: 'var(--font-mono, monospace)' }}>
          {/* Search Run */}
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--raised, #151B15)', borderRadius: '4px', border: '1px solid var(--border, #263124)' }}>
            <div style={{ color: 'var(--text-muted, #727D73)', fontSize: '11px', marginBottom: '4px' }}>ORIGINAL SEARCH RUN ID</div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)' }}>{searchRunId}</div>
            <div style={{ color: 'var(--text-secondary, #A0AAA0)', fontSize: '11px', marginTop: '4px' }}>
              Completed in campaign · Candidate: {effectiveCandidateId} ({formatNumber(effectiveThroughput, 1)} tok/s)
            </div>
          </div>

          {/* Verification Run */}
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--raised, #151B15)', borderRadius: '4px', border: '1px solid', borderColor: isPending ? 'rgba(233, 185, 73, 0.4)' : isVerified ? 'var(--primary, #76B900)' : 'var(--error, #FF5555)' }}>
            <div style={{ color: 'var(--text-muted, #727D73)', fontSize: '11px', marginBottom: '4px' }}>INDEPENDENT VERIFICATION RUN ID</div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: isPending ? 'var(--warning, #E9B949)' : isVerified ? 'var(--primary-bright, #95D500)' : 'var(--error, #FF5555)' }}>
              {verificationRunId}
            </div>
            <div style={{ color: 'var(--text-secondary, #A0AAA0)', fontSize: '11px', marginTop: '4px' }}>
              {isPending
                ? 'Pending independent rerun under declared verification protocol'
                : 'Completed with distinct execution run ID'}
            </div>
          </div>
        </div>

        {/* Reason / Clinical verdict note */}
        <div style={{ fontSize: '12px', color: 'var(--text-secondary, #A0AAA0)', borderTop: '1px solid var(--border, #263124)', paddingTop: '10px' }}>
          <strong>Verdict Rationale:</strong>{' '}
          {isPending
            ? 'Independent verification rerun has not yet been executed for this campaign. In accordance with AGENTS.md § 1, 5, 7, candidate selection must be confirmed experimentally through a fresh, independent rerun with a distinct run ID before production deployment.'
            : verificationRecord?.final_decision_notes || verificationStatus.reasonText}
        </div>
      </div>

      {/* Verification Gate Isolation Diagram */}
      <VerificationGateDiagram
        searchRunId={searchRunId}
        verifRunId={verificationRunId}
        driftSummary={availableMetrics}
        candidateId={effectiveCandidateId}
        candidateName={effectiveCandidateName}
        appliedParams={{
          batch: recommendedCandidate.batch,
          concurrency: recommendedCandidate.concurrency,
          kv_cache: recommendedCandidate.kvCache,
        }}
        durationMultiplier={durationMultiplier}
        verdict={verificationLabel}
      />

      {/* Clinical Verification Triage Categories */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 650, color: 'var(--text-secondary, #A0AAA0)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Clinical Verification Triage Categories
          </h2>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
            Deterministic Reason Code Mapping
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          {getClinicalTriageCategories(recommendedCandidate, isPending, isVerified, verificationFailed).map((cat) => (
            <div
              key={cat.id}
              className="triage-card"
              style={{
                backgroundColor: 'var(--surface, #0E120F)',
                border: '1px solid var(--border, #263124)',
                borderRadius: '6px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {cat.title}
                </span>
                <Badge tone={cat.tone} size="sm">
                  {cat.status}
                </Badge>
              </div>
              <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--primary-bright, #95D500)' }}>
                {cat.tolerance}
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.4 }}>
                {cat.description}
              </p>
              {cat.reasonCodes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                  {cat.reasonCodes.map((code) => (
                    <span
                      key={code}
                      style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono, monospace)',
                        padding: '2px 6px',
                        backgroundColor: 'var(--raised, #151B15)',
                        border: '1px solid var(--border-strong, #384635)',
                        borderRadius: '3px',
                        color: 'var(--text-primary, #F0F3EF)',
                      }}
                    >
                      {code}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Drift Gate Gauges Section */}
      <div>
        <h2 style={{ fontSize: '14px', fontWeight: 650, color: 'var(--text-secondary, #A0AAA0)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px' }}>
          Declared Drift Gate Meters
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {availableMetrics.map((m) => (
            <DriftGateBar
              key={m.name}
              metricName={m.name.split('(')[0].trim()}
              measuredDrift={m.drift}
              toleranceThreshold={m.tolerance}
              unit={m.unit}
              
            />
          ))}
        </div>
      </div>

      {/* Head-to-Head Verification Delta Table */}
      <div
        style={{
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border, #263124)',
          borderRadius: '6px',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 650, color: 'var(--text-primary, #F0F3EF)' }}>
            Empirical Drift Telemetry Audit Table
          </h2>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)' }}>
          {availableMetrics.length ? 'Gate: persisted tolerances' : 'No persisted drift comparisons available'}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'var(--font-mono, monospace)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-strong, #384635)', color: 'var(--text-muted, #727D73)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Metric</th>
                <th style={{ padding: '8px 12px' }}>Search Run ({searchRunId})</th>
                <th style={{ padding: '8px 12px' }}>Verification Run ({verificationRunId.slice(0, 16)})</th>
                <th style={{ padding: '8px 12px' }}>Observed Drift</th>
                <th style={{ padding: '8px 12px' }}>Declared Gate</th>
                <th style={{ padding: '8px 12px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {availableMetrics.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '14px 12px', color: 'var(--text-muted, #727D73)' }}>No independent verification comparison artifact is available.</td></tr>
              )}
              {availableMetrics.map((m) => (
                <tr key={m.name} style={{ borderBottom: '1px solid var(--border, #263124)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary, #F0F3EF)', fontWeight: 600 }}>{m.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary, #A0AAA0)' }}>{m.format(m.searchVal)}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary, #A0AAA0)' }}>
                    {isPending ? '— (Pending)' : m.format(m.verifyVal)}
                  </td>
                  <td style={{ padding: '10px 12px', color: isPending ? 'var(--text-muted, #727D73)' : 'var(--primary-bright, #95D500)' }}>
                    {isPending ? '—' : `${m.drift > 0 ? '+' : ''}${m.drift.toFixed(1)} ${m.unit}`}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted, #727D73)' }}>±{m.tolerance} {m.unit}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge tone={isPending ? 'warning' : m.passed ? 'verified' : 'infeasible'} size="sm">
                      {isPending ? 'PENDING' : m.passed ? 'PASSED' : 'FAILED'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
