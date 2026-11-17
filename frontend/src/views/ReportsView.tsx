import React, { useState } from 'react';
import { Badge } from '../components/common/Badge';
import { DemoDataChip } from '../components/common/DemoDataChip';
import { SegmentedControl } from '../components/common/SegmentedControl';
import type { UICandidate } from '../lib/adapters/viewModel';
import type { VerificationDerivationResult } from '../lib/status';
import type { ReportSummaryResponse, ReportArtifact } from '../types/contracts';

interface ReportsViewProps {
  recommendedCandidate: UICandidate;
  baselineCandidate: UICandidate;
  verificationStatus: VerificationDerivationResult;
  experimentId?: string;
  reportData?: { experiment_id: string; markdown: string; artifact: ReportArtifact | null } | null;
  availableReports?: ReportSummaryResponse[];
  onSelectReport?: (expId: string) => void;
}

const renderFormattedInline = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} style={{ color: 'var(--text-primary, #F0F3EF)', fontWeight: 650 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
            padding: '2px 5px',
            backgroundColor: 'var(--raised, #151B15)',
            border: '1px solid var(--border-strong, #384635)',
            borderRadius: '3px',
            color: 'var(--primary-bright, #95D500)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={idx} style={{ color: 'var(--text-secondary, #A0AAA0)', fontStyle: 'italic' }}>
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
};

const renderDossierContent = (markdown: string) => {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div
            key={`code-${i}`}
            style={{
              backgroundColor: 'var(--canvas, #080A09)',
              border: '1px solid var(--border-strong, #384635)',
              borderRadius: '6px',
              overflow: 'hidden',
              margin: '12px 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 12px',
                backgroundColor: 'var(--raised, #151B15)',
                borderBottom: '1px solid var(--border, #263124)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-muted, #727D73)',
              }}
            >
              <span>{codeLang || 'SYNTAX TRACE'}</span>
              <span style={{ color: 'var(--primary-bright, #95D500)' }}>RAW</span>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '14px 16px',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '12px',
                lineHeight: 1.5,
                color: 'var(--text-primary, #F0F3EF)',
                overflowX: 'auto',
              }}
            >
              {codeBuffer.join('\n')}
            </pre>
          </div>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.replace('```', '').trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <div key={`h1-${i}`} style={{ marginBottom: '16px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '22px',
              fontWeight: 750,
              color: 'var(--text-primary, #F0F3EF)',
              letterSpacing: '-0.02em',
            }}
          >
            {line.replace('# ', '')}
          </h1>
          <div style={{ height: '2px', width: '48px', backgroundColor: 'var(--primary, #76B900)', marginTop: '8px', borderRadius: '1px' }} />
        </div>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <div key={`h2-${i}`} style={{ marginTop: '20px', marginBottom: '10px', borderBottom: '1px solid var(--border-strong, #384635)', paddingBottom: '6px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--primary-bright, #95D500)',
              fontFamily: 'var(--font-mono, monospace)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            {line.replace('## ', '')}
          </h2>
        </div>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={`h3-${i}`}
          style={{
            margin: '14px 0 6px',
            fontSize: '13px',
            fontWeight: 650,
            color: 'var(--text-primary, #F0F3EF)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {line.replace('### ', '')}
        </h3>
      );
    } else if (line.trim() === '---') {
      elements.push(
        <hr
          key={`hr-${i}`}
          style={{
            border: 'none',
            borderTop: '1px solid var(--border, #263124)',
            margin: '16px 0',
          }}
        />
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.substring(2);
      elements.push(
        <div
          key={`li-${i}`}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '8px',
            fontSize: '13px',
            lineHeight: 1.6,
            color: 'var(--text-secondary, #A0AAA0)',
            marginBottom: '4px',
          }}
        >
          <span style={{ color: 'var(--primary-bright, #95D500)', fontSize: '12px' }}>▸</span>
          <span>{renderFormattedInline(content)}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/);
      if (match) {
        const num = match[1];
        const content = match[2];
        elements.push(
          <div
            key={`num-${i}`}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--text-secondary, #A0AAA0)',
              marginBottom: '4px',
            }}
          >
            <span
              className="tabular-nums"
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--primary, #76B900)',
                fontWeight: 700,
                minWidth: '18px',
              }}
            >
              {num}.
            </span>
            <span>{renderFormattedInline(content)}</span>
          </div>
        );
      }
    } else if (line.trim().length > 0) {
      elements.push(
        <p
          key={`p-${i}`}
          style={{
            margin: '6px 0',
            fontSize: '13px',
            lineHeight: 1.6,
            color: 'var(--text-secondary, #A0AAA0)',
          }}
        >
          {renderFormattedInline(line)}
        </p>
      );
    }
  }

  return elements;
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  recommendedCandidate,
  baselineCandidate: _baselineCandidate,
  verificationStatus: _verificationStatus,
  experimentId = 'exp-audit-offline-campaign',
  reportData,
  availableReports = [],
  onSelectReport,
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [reportViewMode, setReportViewMode] = useState<'dossier' | 'raw'>('dossier');
  const [copiedState, setCopiedState] = useState<'md' | 'json' | 'jsonl' | null>(null);

  // Markdown content: prefer backend real compiled report, fallback to structured live report
  const activeMarkdown =
    reportData?.markdown ||
    `# SLOKern Verification Audit Report
**Experiment ID:** ${experimentId}  
**Generated At:** 2026-10-30T03:42:00Z  
**Runtime:** vLLM v0.6.0-fake-demo (DEMO DATA · OFFLINE OPTIMIZATION)  
**Model:** meta-llama/Meta-Llama-3-8B-Instruct  
**Workload:** chat-completions-prod (Poisson arrival @ 10 rps)  
**Evaluator Policy:** slo-1.0.0 (Evaluator v1.0.0)

---

## 1. Executive Summary & Verdict
- **Selected Candidate:** ${recommendedCandidate.id} (${recommendedCandidate.name})
- **Ranking Objective:** max_throughput_under_slo
- **Winning Throughput:** 160 tokens/s
- **Stopping Reason:** space_exhausted (2×2 parameter matrix evaluated)
- **Feasibility Verdict:** FEASIBLE (All hard SLO constraints satisfied)
- **Independent Verification Verdict:** INDEPENDENT VERIFICATION PENDING
- **Status Rationale:** Candidate meets all declared constraints with 2485.8 ms TTFT headroom. Independent rerun required per AGENTS.md § 7.

---

## 2. Tested Candidates Summary
1. **${recommendedCandidate.id}**: WINNER · 160 tok/s · FEASIBLE
2. **370359a9c14b**: FEASIBLE · 160 tok/s
3. **369e9bc42eb7**: FEASIBLE · 160 tok/s
4. **565eb88bb613**: FEASIBLE · 160 tok/s
5. **c3d86d00124b**: FEASIBLE · 160 tok/s

---

## 3. Evidence Classification & Scope Limitations
- **Classification:** DEMO DATA · OFFLINE OPTIMIZATION
- **Serving Adapter:** Synthetic vLLM serving simulation with zero real GPU allocation.
- **Hardware Profile:** Simulated NVIDIA H100 80GB SXM5
- **Explicit Limitations:** Optimality guaranteed only within the bounded parameter space tested. Global optimality across all vLLM configurations is not claimed.
`;

  const handleDownloadMarkdown = () => {
    const blob = new Blob([activeMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${experimentId}_audit_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDownloadSuccess('md');
    setTimeout(() => setDownloadSuccess(null), 2500);
  };

  const handleDownloadJson = () => {
    const reportJson = reportData?.artifact || {
      experiment_id: experimentId,
      timestamp: new Date().toISOString(),
      evaluator_version: 'v1.0.0',
      policy_version: 'slo-1.0.0',
      selected_candidate_id: recommendedCandidate.id,
      evidence_classification: 'DEMO DATA',
      ranking_objective: 'max_throughput_under_slo',
      stopping_reason: 'space_exhausted',
    };

    const blob = new Blob([JSON.stringify(reportJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${experimentId}_report_artifact.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDownloadSuccess('json');
    setTimeout(() => setDownloadSuccess(null), 2500);
  };

  const handleDownloadJsonl = () => {
    const jsonlLines = [
      JSON.stringify({ event: 'workload_spec', experiment_id: experimentId, arrival: 'poisson', target_rps: 10 }),
      JSON.stringify({ event: 'candidate_evaluated', candidate_id: recommendedCandidate.id, batch: recommendedCandidate.batch, concurrency: recommendedCandidate.concurrency }),
      JSON.stringify({ event: 'telemetry_sample', candidate_id: recommendedCandidate.id, ttft_ms: recommendedCandidate.ttftP95, throughput_tps: recommendedCandidate.throughput, error_rate: recommendedCandidate.error }),
      JSON.stringify({ event: 'evaluator_verdict', verdict: 'FEASIBLE', winner: true }),
    ].join('\n');

    const blob = new Blob([jsonlLines], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${experimentId}_raw_measurements.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDownloadSuccess('jsonl');
    setTimeout(() => setDownloadSuccess(null), 2500);
  };

  const handleCopyContent = (text: string, type: 'md' | 'json' | 'jsonl') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedState(type);
    setTimeout(() => setCopiedState(null), 2200);
  };

  return (
    <div className="view-reports workspace-enter" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Workspace Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--text-primary, #F0F3EF)', letterSpacing: '-0.025em', textWrap: 'balance' }}>
              Auditable Compliance & Verification Reports
            </h1>
            <DemoDataChip size="sm" />
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #A0AAA0)', lineHeight: 1.45, textWrap: 'pretty', maxWidth: '75ch' }}>
            Formal audit report for experiment <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #F0F3EF)' }}>{experimentId}</span> with deterministic provenance and explicit limitations
          </p>
        </div>

        {/* Action Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* JSONL Export */}
          <button
            type="button"
            onClick={handleDownloadJsonl}
            className="action-toolbar-btn btn-press"
            style={{
              backgroundColor: 'var(--raised, #151B15)',
              borderColor: downloadSuccess === 'jsonl' ? 'var(--primary, #76B900)' : 'var(--border-strong, #384635)',
              color: downloadSuccess === 'jsonl' ? 'var(--primary-bright, #95D500)' : 'var(--text-primary, #F0F3EF)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '6px 12px',
            }}
            title="Download raw unaggregated measurement trace in JSONL format"
          >
            <span>{downloadSuccess === 'jsonl' ? '✓ Exported JSONL' : 'Export JSONL Trace (.jsonl)'}</span>
          </button>

          {/* Markdown Export */}
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="action-toolbar-btn btn-press"
            style={{
              backgroundColor: 'var(--elevated, #1D251E)',
              borderColor: downloadSuccess === 'md' ? 'var(--primary, #76B900)' : 'var(--border-strong, #384635)',
              color: downloadSuccess === 'md' ? 'var(--primary-bright, #95D500)' : 'var(--text-primary, #F0F3EF)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '6px 12px',
            }}
          >
            <span>{downloadSuccess === 'md' ? '✓ Exported MD' : 'Export Markdown (.md)'}</span>
          </button>

          {/* JSON Artifact Export */}
          <button
            type="button"
            onClick={handleDownloadJson}
            className="action-toolbar-btn primary btn-press"
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              padding: '6px 14px',
            }}
          >
            <span>{downloadSuccess === 'json' ? '✓ Exported JSON' : 'Export JSON Artifact (.json)'}</span>
          </button>
        </div>
      </div>

      {/* Available Reports Strip if multiple exist */}
      {availableReports.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted, #727D73)', textTransform: 'uppercase' }}>
            Available Reports:
          </span>
          {availableReports.map((r) => (
            <button
              key={r.experiment_id}
              type="button"
              onClick={() => onSelectReport?.(r.experiment_id)}
              style={{
                backgroundColor: r.experiment_id === experimentId ? 'var(--elevated, #1D251E)' : 'var(--surface, #0E120F)',
                border: '1px solid',
                borderColor: r.experiment_id === experimentId ? 'var(--primary, #76B900)' : 'var(--border, #263124)',
                color: r.experiment_id === experimentId ? 'var(--primary-bright, #95D500)' : 'var(--text-secondary, #A0AAA0)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {r.experiment_id} ({r.evidence_classification})
            </button>
          ))}
        </div>
      )}

      {/* Report Viewer Container */}
      <div
        className="report-viewer-card"
        style={{
          backgroundColor: 'var(--surface, #0E120F)',
          border: '1px solid var(--border, #263124)',
          borderRadius: '8px',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Header Bar with View Mode Switcher and Copy Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-strong, #384635)', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge tone="neutral" size="sm">AUDIT EVIDENCE ARTIFACT</Badge>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #F0F3EF)', fontFamily: 'var(--font-mono, monospace)' }}>
              artifacts/{experimentId}/report.md
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => handleCopyContent(activeMarkdown, 'md')}
              className="action-toolbar-btn btn-press"
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                gap: '4px',
              }}
              title="Copy markdown content to clipboard"
            >
              <span>{copiedState === 'md' ? '✓ Copied' : 'Copy Source'}</span>
            </button>

            <SegmentedControl
              size="sm"
              value={reportViewMode}
              onChange={setReportViewMode}
              options={[
                { value: 'dossier', label: 'Executive Dossier' },
                { value: 'raw', label: 'Raw Source' },
              ]}
            />
          </div>
        </div>

        {/* Content Area: Dossier vs Raw Source */}
        {reportViewMode === 'dossier' ? (
          <div
            className="report-styled-dossier"
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--surface, #0E120F)',
              borderRadius: '6px',
            }}
          >
            {renderDossierContent(activeMarkdown)}
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              lineHeight: 1.6,
              color: 'var(--text-primary, #F0F3EF)',
              backgroundColor: 'var(--canvas, #080A09)',
              padding: '20px',
              borderRadius: '6px',
              border: '1px solid var(--border, #263124)',
              overflowX: 'auto',
            }}
          >
            {activeMarkdown}
          </pre>
        )}
      </div>
    </div>
  );
};
