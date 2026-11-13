"""
Purpose: Experiment discovery, candidate hierarchy, search space retrieval, and verification status.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 4, 5, 7, 14 and DEC-0014
"""

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from slokern.api.routes.runs import get_run_status
from slokern.contracts.enums import FeasibilityVerdict


def _find_experiment_dir(experiment_id: str, artifacts_root: str = "artifacts") -> Optional[Path]:
    """
    Safely locates an experiment directory under artifacts_root.
    Prevents path traversal attacks using strict regex validation.
    Prioritizes audit-offline-validation for campaign artifacts.
    """
    if not re.match(r"^[a-zA-Z0-9_\-]+$", experiment_id):
        return None

    root = Path(artifacts_root)
    # 1. Audit offline validation path (authoritative for demo campaign)
    p_audit = root / "audit-offline-validation" / "experiments" / experiment_id
    if p_audit.is_dir():
        return p_audit

    # 2. Direct artifacts/experiments/<id>
    p_direct = root / "experiments" / experiment_id
    if p_direct.is_dir():
        return p_direct

    # 3. Bootstrap / Codex validation path
    p_codex = root / "codex-validation-nebius-bootstrap-20261030" / "experiments" / experiment_id
    if p_codex.is_dir():
        return p_codex

    # 4. Glob fallback under artifacts root
    matches = list(root.glob(f"**/experiments/{experiment_id}"))
    if matches and matches[0].is_dir():
        return matches[0]

    return None


def _find_campaign_spec(
    experiment_id: str,
    fixtures_root: str = "fixtures/campaigns",
    artifacts_root: str = "artifacts",
    exp_dir: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """
    Return the persisted campaign spec matching an experiment ID using multi-tier recovery:
    1. Direct experiment_spec.json in the experiment directory
    2. Embedded experiment_spec in report.json
    3. Persisted fixtures in fixtures_root
    4. Reconstructed spec from top-level workload_spec / slo_spec in report.json
    """
    if exp_dir is None:
        exp_dir = _find_experiment_dir(experiment_id, artifacts_root=artifacts_root)

    # Tier 1: Direct experiment_spec.json in experiment directory
    if exp_dir and (exp_dir / "experiment_spec.json").is_file():
        try:
            spec = json.loads((exp_dir / "experiment_spec.json").read_text(encoding="utf-8"))
            if isinstance(spec, dict) and (spec.get("experiment_id") == experiment_id or "workload" in spec):
                return spec
        except (OSError, json.JSONDecodeError):
            pass

    # Tier 2: Embedded experiment_spec inside report.json in experiment directory
    if exp_dir and (exp_dir / "report.json").is_file():
        try:
            report_data = json.loads((exp_dir / "report.json").read_text(encoding="utf-8"))
            if isinstance(report_data, dict):
                embedded_spec = report_data.get("experiment_spec")
                if isinstance(embedded_spec, dict) and "workload" in embedded_spec:
                    return embedded_spec
                # Tier 4: Fallback to top-level workload_spec / slo_spec in report.json
                if "workload_spec" in report_data or "slo_spec" in report_data:
                    return {
                        "experiment_id": experiment_id,
                        "workload": report_data.get("workload_spec", {}),
                        "slo": report_data.get("slo_spec", {}),
                        "search_space": report_data.get("search_space", {}),
                        "budget": report_data.get("budget", {}),
                        "verification_policy": report_data.get("verification_policy", {}),
                    }
        except (OSError, json.JSONDecodeError):
            pass

    # Tier 3: Fixtures root and experiments configs fallback
    search_dirs = [Path(fixtures_root), Path("experiments/configs")]
    for s_dir in search_dirs:
        if s_dir.is_dir():
            for spec_file in sorted(s_dir.glob("*.json")):
                try:
                    spec = json.loads(spec_file.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if isinstance(spec, dict) and spec.get("experiment_id") == experiment_id:
                    return spec

    # Tier 5: Recover spec metadata from experiment run artifacts if present
    if exp_dir and (exp_dir / "runs").is_dir():
        runs_dir = exp_dir / "runs"
        for r_dir in sorted(runs_dir.iterdir()):
            if not r_dir.is_dir():
                continue
            m_file = r_dir / "metrics.json"
            f_file = r_dir / "feasibility.json"
            if m_file.is_file():
                try:
                    m_data = json.loads(m_file.read_text(encoding="utf-8"))
                    offered_load = m_data.get("offered_load_rps")
                    constraints = []
                    if f_file.is_file():
                        try:
                            f_data = json.loads(f_file.read_text(encoding="utf-8"))
                            evals = f_data.get("constraint_evaluations", [])
                            constraints = [
                                {
                                    "metric_name": ev.get("metric_name"),
                                    "statistic": ev.get("statistic"),
                                    "threshold": ev.get("required_threshold"),
                                    "operator": ev.get("operator", "<="),
                                }
                                for ev in evals
                                if ev.get("metric_name")
                            ]
                        except Exception:
                            pass
                    return {
                        "experiment_id": experiment_id,
                        "workload": {
                            "workload_name": "Metadata unavailable",
                            "target_offered_rate": offered_load,
                        },
                        "slo": {"constraints": constraints},
                    }
                except Exception:
                    pass

    return None


def _classify_evidence(
    fp: Optional[Dict[str, Any]] = None,
    is_simulated: Optional[bool] = None,
    mode: Optional[str] = None,
) -> str:
    """
    Strict evidence classification adhering to AGENTS.md § 1, 4, 8:
    - DEMO DATA: synthetic adapters, simulated mode, or explicit DEMO DATA label.
    - LIVE: verified physical inference against real serving engines (nebius, ollama, vllm).
    - UNVERIFIED: missing or inconclusive environment metadata.
    """
    if not fp and is_simulated is None and mode is None:
        return "UNVERIFIED"
    fp = fp or {}
    mode_val = mode if mode is not None else fp.get("mode")
    is_sim = is_simulated if is_simulated is not None else fp.get("is_simulated")
    provider = str(fp.get("provider", "")).lower()
    runtime = str(fp.get("runtime_name", "")).lower()

    if (
        mode_val == "DEMO DATA"
        or is_sim is True
        or provider in ("fake", "mock")
        or "fake" in runtime
        or "fake" in provider
    ):
        return "DEMO DATA"
    if provider in ("nebius", "ollama", "vllm") and is_sim is False and mode_val != "DEMO DATA":
        return "LIVE"
    if provider and is_sim is False and mode_val != "DEMO DATA":
        return "LIVE"
    return "UNVERIFIED"


def _validity_score(val: Optional[str]) -> int:
    return {"VALID": 3, "STALE": 2, None: 1, "INVALID": 0, "CONTAMINATED": -1}.get(val, 1)


def _verdict_score(verd: Optional[str]) -> int:
    return {"FEASIBLE": 2, "INFEASIBLE": 1, "INCONCLUSIVE": 0}.get(verd, 0)



def list_experiments(artifacts_root: str = "artifacts") -> List[Dict[str, Any]]:
    """
    Discovers all persisted experiments across the filesystem hierarchy.
    Extracts metadata, run counts, models, and explicit evidence classification.
    """
    root = Path(artifacts_root)
    exp_dirs: List[Path] = []
    seen_ids = set()

    # Prioritize audit-offline-validation first so it claims exp-audit-offline-campaign
    search_roots = [
        root / "audit-offline-validation" / "experiments",
        root / "experiments",
        root / "codex-validation-nebius-bootstrap-20261030" / "experiments",
    ]

    for s_root in search_roots:
        if s_root.is_dir():
            for p in s_root.iterdir():
                if p.is_dir() and p.name not in seen_ids and not p.name.startswith("."):
                    seen_ids.add(p.name)
                    exp_dirs.append(p)

    # Glob fallback for any remaining experiments
    for p in root.glob("**/experiments/*"):
        if p.is_dir() and p.name not in seen_ids and not p.name.startswith("."):
            seen_ids.add(p.name)
            exp_dirs.append(p)

    results: List[Dict[str, Any]] = []

    for d in exp_dirs:
        exp_id = d.name
        campaign_spec = _find_campaign_spec(exp_id, artifacts_root=artifacts_root, exp_dir=d)

        # Read search_result.json
        search_res = None
        sr_file = d / "search_result.json"
        if sr_file.exists():
            try:
                search_res = json.loads(sr_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Discover runs
        runs_dir = d / "runs"
        run_subdirs = [r for r in runs_dir.iterdir() if r.is_dir()] if runs_dir.is_dir() else []
        runs_count = len(run_subdirs)

        # Verification status record
        verif_file = d / "verification_record.json"
        verif_status = "Pending"
        vdata = None
        if verif_file.exists():
            try:
                vdata = json.loads(verif_file.read_text(encoding="utf-8"))
                verdict = vdata.get("verification_verdict", "")
                if verdict in ("VERIFIED", "VerificationVerdict.VERIFIED"):
                    verif_status = "Verified"
                elif "FAIL" in verdict:
                    verif_status = "Failed"
                else:
                    verif_status = "Inconclusive"
            except Exception:
                verif_status = "Pending"

        # Candidates resolution
        candidates = get_experiment_candidates(exp_id, artifacts_root=artifacts_root)

        selected_candidate = search_res.get("selected_candidate_id") if search_res else None
        if not selected_candidate and vdata:
            selected_candidate = vdata.get("candidate_id")

        # Authoritative sample run resolution:
        # 1. Authoritative original_run_id from verification_record.json if verified
        # 2. Winning candidate's best valid run from get_experiment_candidates
        # 3. First candidate run
        # 4. Fallback to newest run in directory
        orig_run_id = vdata.get("original_run_id") if vdata else None
        sample_run_id = ""
        if orig_run_id and (runs_dir / orig_run_id).is_dir():
            sample_run_id = orig_run_id
        elif selected_candidate:
            cand_match = next((c for c in candidates if c.get("id") == selected_candidate), None)
            if cand_match and cand_match.get("run_id"):
                sample_run_id = cand_match["run_id"]
        if not sample_run_id and candidates:
            sample_run_id = candidates[0].get("run_id", "")
        if not sample_run_id and run_subdirs:
            sample_run_id = sorted(run_subdirs, key=lambda p: p.stat().st_mtime, reverse=True)[0].name

        model_name = "Unavailable"
        runtime_name = "Unavailable"
        evidence_class = "UNVERIFIED"
        achieved_load = None
        error_rate = None
        measurement_validity = None
        client_saturation = None
        exclusions_count = None
        status: Dict[str, Any] = {}

        if sample_run_id:
            status = get_run_status(sample_run_id, artifacts_root=artifacts_root)
            if status.get("applied_config"):
                ac = status["applied_config"]
                model_name = ac.get("model_name", model_name)
                runtime_name = ac.get("runtime_name", runtime_name)
                fp = ac.get("environment_fingerprint", {})
                evidence_class = _classify_evidence(fp, is_simulated=fp.get("is_simulated"))

            ms = status.get("metric_set") or {}
            achieved_load = ms.get("achieved_load_rps")
            error_rate = ms.get("error_rate")
            client_saturation = ms.get("generator_saturated")
            feas = status.get("feasibility_result") or {}
            measurement_validity = feas.get("validity_status")
            raw_count = status.get("raw_measurements_count")
            sample_count = ms.get("sample_count")
            if isinstance(raw_count, int) and isinstance(sample_count, int):
                exclusions_count = raw_count - sample_count

        # Fallback evidence classification if sample run did not determine it
        if evidence_class == "UNVERIFIED":
            rep_file = d / "report.json"
            if rep_file.is_file():
                try:
                    rep_data = json.loads(rep_file.read_text(encoding="utf-8"))
                    evidence_class = _classify_evidence(
                        rep_data.get("environment_fingerprint"),
                        is_simulated=rep_data.get("is_simulated"),
                    )
                    if model_name == "Unavailable":
                        model_name = rep_data.get("workload_spec", {}).get("model_name", model_name)
                except Exception:
                    pass

        if evidence_class == "UNVERIFIED" and run_subdirs:
            for r_dir in run_subdirs:
                try:
                    ac_f = r_dir / "applied_config.json"
                    if ac_f.is_file():
                        ac_d = json.loads(ac_f.read_text(encoding="utf-8"))
                        c_cls = _classify_evidence(ac_d.get("environment_fingerprint"))
                        if c_cls != "UNVERIFIED":
                            evidence_class = c_cls
                            break
                except Exception:
                    pass

        selected_candidate_data = next(
            (candidate for candidate in candidates
             if candidate.get("id") == selected_candidate),
            None,
        ) if selected_candidate else None
        selected_verdict = (
            selected_candidate_data.get("feasibilityVerdict")
            if selected_candidate_data else None
        )
        if not selected_verdict and search_res:
            c_summaries = search_res.get("candidate_summaries", {})
            if selected_candidate in c_summaries:
                s_sum = c_summaries[selected_candidate]
                if isinstance(s_sum, dict) and s_sum.get("verdict"):
                    selected_verdict = s_sum["verdict"]
        if not selected_verdict and vdata:
            if status.get("feasibility_result"):
                selected_verdict = status["feasibility_result"].get("overall_verdict")
            elif vdata.get("verification_verdict") in ("VERIFIED", "VerificationVerdict.VERIFIED"):
                selected_verdict = "FEASIBLE"
        if not selected_verdict:
            selected_verdict = "INCONCLUSIVE"

        feasibility_status = {
            "FEASIBLE": "Feasible",
            "INFEASIBLE": "Infeasible",
            "INCONCLUSIVE": "Inconclusive",
        }.get(selected_verdict, "Inconclusive")

        # Independent execution completion status
        if runs_count == 0:
            exec_state = "Pending"
        else:
            exec_st = status.get("execution_status")
            if exec_st == "COMPLETED":
                exec_state = "Completed"
            elif exec_st == "RUNNING":
                exec_state = "Running"
            elif exec_st in ("FAILED", "CANCELLED"):
                exec_state = "Failed"
            else:
                exec_state = "Completed"

        tested_candidates = (search_res or {}).get("tested_candidates", [])
        space = (campaign_spec or {}).get("search_space", {})
        search_space_count = math.prod(len(values) for values in space.values()) if space else None

        slo_constraints = (campaign_spec or {}).get("slo", {}).get("constraints", [])
        feas_res = status.get("feasibility_result") or {}
        if not slo_constraints and feas_res.get("constraint_evaluations"):
            slo_constraints = [
                {
                    "metric_name": item.get("metric_name"),
                    "statistic": item.get("statistic"),
                    "threshold": item.get("required_threshold"),
                    "operator": item.get("operator", "<="),
                }
                for item in feas_res["constraint_evaluations"]
                if item.get("metric_name")
            ]

        mtime = d.stat().st_mtime
        updated_str = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

        results.append({
            "id": exp_id,
            "run": sample_run_id or "run-none",
            "workload": (campaign_spec or {}).get("workload", {}).get("workload_name", "Metadata unavailable"),
            "arrivalMode": (campaign_spec or {}).get("workload", {}).get("arrival_mode"),
            "targetOfferedRateRps": (campaign_spec or {}).get("workload", {}).get("target_offered_rate"),
            "sloConstraints": slo_constraints,
            "model": model_name,
            "state": exec_state,
            "feasibility": feasibility_status,
            "verification": verif_status,
            "updated": updated_str,
            "candidateId": selected_candidate or "",
            "baselineCandidateId": (search_res or {}).get("baseline_candidate_id"),
            "runsCount": runs_count,
            "evidenceClassification": evidence_class,
            "durationSeconds": (campaign_spec or {}).get("workload", {}).get("measurement_duration_s"),
            "verificationDurationMultiplier": (campaign_spec or {}).get("verification_policy", {}).get("duration_multiplier"),
            "requestedRateRps": (campaign_spec or {}).get("workload", {}).get("target_offered_rate"),
            "achievedRateRps": achieved_load,
            "measurementValidity": measurement_validity,
            "clientSaturation": client_saturation,
            "errorRatePct": error_rate * 100 if error_rate is not None else None,
            "exclusionsCount": exclusions_count,
            "selected_candidate_id": selected_candidate,
            "candidateEvaluationsCount": len(tested_candidates) or len(candidates),
            "candidateBudget": (campaign_spec or {}).get("budget", {}).get("max_candidates"),
            "searchSpaceCandidateCount": search_space_count,
            "rankingObjective": search_res.get("ranking_objective") if search_res else None,
            "ranking_objective": search_res.get("ranking_objective") if search_res else None,
            "stopping_reason": search_res.get("stopping_reason") if search_res else None,
            "selection_rationale": search_res.get("selection_rationale") if search_res else None,
        })

    return results


def get_experiment_detail(experiment_id: str, artifacts_root: str = "artifacts") -> Dict[str, Any]:
    """
    Returns complete detail for a single experiment including search result and child runs.
    """
    exp_dir = _find_experiment_dir(experiment_id, artifacts_root=artifacts_root)
    if not exp_dir:
        return {"error": f"Experiment '{experiment_id}' not found"}

    search_res = None
    sr_file = exp_dir / "search_result.json"
    if sr_file.exists():
        try:
            search_res = json.loads(sr_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    verif_record = None
    verif_file = exp_dir / "verification_record.json"
    if verif_file.exists():
        try:
            verif_record = json.loads(verif_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    runs = []
    runs_dir = exp_dir / "runs"
    if runs_dir.is_dir():
        for r_dir in sorted(runs_dir.iterdir(), key=lambda p: p.stat().st_mtime):
            if r_dir.is_dir():
                r_status = get_run_status(r_dir.name, artifacts_root=artifacts_root)
                if r_status.get("error") != "Run not found":
                    runs.append(r_status)

    evidence_class = "UNVERIFIED"
    if runs:
        for r in runs:
            ac = r.get("applied_config") or {}
            rfp = ac.get("environment_fingerprint") or {}
            if rfp:
                evidence_class = _classify_evidence(rfp, is_simulated=rfp.get("is_simulated"))
                if evidence_class in ("LIVE", "DEMO DATA"):
                    break
    if evidence_class == "UNVERIFIED" and (exp_dir / "report.json").exists():
        try:
            rdata = json.loads((exp_dir / "report.json").read_text(encoding="utf-8"))
            evidence_class = _classify_evidence(
                rdata.get("environment_fingerprint"),
                is_simulated=rdata.get("is_simulated"),
            )
        except Exception:
            pass

    return {
        "experiment_id": experiment_id,
        "search_result": search_res,
        "verification_record": verif_record,
        "runs": runs,
        "runs_count": len(runs),
        "evidence_classification": evidence_class,
    }


def get_experiment_candidates(experiment_id: str, artifacts_root: str = "artifacts") -> List[Dict[str, Any]]:
    """
    Constructs UICandidate view models for all candidate configurations evaluated in the experiment.
    Binds empirical metrics (TTFT, ITL, throughput) and evaluator feasibility verdicts.
    Groups multiple runs per candidate to present distinct candidate profiles.
    """
    exp_dir = _find_experiment_dir(experiment_id, artifacts_root=artifacts_root)
    if not exp_dir:
        return []

    search_res = None
    sr_file = exp_dir / "search_result.json"
    if sr_file.exists():
        try:
            search_res = json.loads(sr_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    verif_file = exp_dir / "verification_record.json"
    orig_verified_run_id = None
    if verif_file.exists():
        try:
            vrec = json.loads(verif_file.read_text(encoding="utf-8"))
            orig_verified_run_id = vrec.get("original_run_id")
        except Exception:
            pass

    winner_id = search_res.get("selected_candidate_id") if search_res else None

    runs_dir = exp_dir / "runs"
    if not runs_dir.is_dir():
        return []

    candidates_map: Dict[str, tuple] = {}
    has_non_verification_runs = any(
        r_dir.is_dir() and "verify" not in r_dir.name for r_dir in runs_dir.iterdir()
    )

    for r_dir in sorted(runs_dir.iterdir(), key=lambda p: p.name):
        if not r_dir.is_dir():
            continue

        run_id = r_dir.name
        # Skip verification runs in the candidate search list only when search runs exist
        if has_non_verification_runs and "verify" in run_id:
            continue

        run_data = get_run_status(run_id, artifacts_root=artifacts_root)
        if run_data.get("error") == "Run not found":
            continue

        cid = run_data.get("candidate_id") or run_id
        applied = run_data.get("applied_config") or {}
        eff = applied.get("effective_settings", {})
        m = run_data.get("metric_set") or {}
        feas = run_data.get("feasibility_result") or {}

        ttft_p50 = m.get("ttft_ms", {}).get("p50")
        ttft_p95 = m.get("ttft_ms", {}).get("p95")
        ttft_p99 = m.get("ttft_ms", {}).get("p99")
        itl_p95 = m.get("itl_ms", {}).get("p95")
        e2e_p95 = m.get("e2e_latency_ms", {}).get("p95")
        throughput = m.get("token_throughput_tps")
        err_pct = m.get("error_rate")
        err_pct = err_pct * 100 if err_pct is not None else None

        verdict = feas.get("overall_verdict", "INCONCLUSIVE")
        is_feasible = verdict == FeasibilityVerdict.FEASIBLE.value
        is_winner = (cid == winner_id)
        tag = "WINNER" if is_winner and is_feasible else verdict
        evaluations = feas.get("constraint_evaluations", [])
        failed_reason_codes = [
            item.get("reason_code", item.get("reason"))
            for item in evaluations
            if item.get("passed") is False and item.get("reason_code", item.get("reason"))
        ]
        reason_codes = failed_reason_codes or [
            item.get("reason_code", item.get("reason"))
            for item in evaluations
            if item.get("reason_code", item.get("reason"))
        ]

        config_summary = []
        if eff.get("max_num_seqs") is not None:
            config_summary.append(f"max_seqs={eff['max_num_seqs']}")
        if eff.get("max_num_batched_tokens") is not None:
            config_summary.append(f"max_batched_tokens={eff['max_num_batched_tokens']}")
        if eff.get("num_batch") is not None:
            config_summary.append(f"num_batch={eff['num_batch']}")
        if eff.get("num_ctx") is not None:
            config_summary.append(f"num_ctx={eff['num_ctx']}")

        batch_val = None
        if eff.get("num_batch") is not None:
            batch_val = eff["num_batch"]
        elif eff.get("max_num_batched_tokens") is not None:
            batch_val = eff["max_num_batched_tokens"] // 512

        concurrency_val = eff.get("num_ctx") if eff.get("num_ctx") is not None else eff.get("max_num_seqs")

        candidate_obj = {
            "id": cid,
            "name": f"Candidate {cid[:8]}",
            "subtitle": f"Run {run_id}" + (f" · {', '.join(config_summary)}" if config_summary else ""),
            "batch": batch_val,
            "concurrency": concurrency_val,
            "kvCache": eff["kv_cache_dtype"].upper() if eff.get("kv_cache_dtype") is not None else None,
            "p50": round(ttft_p50, 1) if ttft_p50 is not None else None,
            "p95": round(ttft_p95, 1) if ttft_p95 is not None else None,
            "p99": round(ttft_p99, 1) if ttft_p99 is not None else None,
            "throughput": round(throughput, 1) if throughput is not None else None,
            "error": round(err_pct, 2) if err_pct is not None else None,
            "gpu": int(eff["gpu_memory_utilization"] * 100) if eff.get("gpu_memory_utilization") is not None else None,
            "feasible": is_feasible,
            "feasibilityVerdict": verdict,
            "evidenceValidity": feas.get("validity_status"),
            "reason": feas.get("audit_notes", "Evaluator result unavailable."),
            "reasonCodes": reason_codes,
            "tag": tag,
            "ttftP95": round(ttft_p95, 1) if ttft_p95 is not None else None,
            "itlP95": round(itl_p95, 1) if itl_p95 is not None else None,
            "e2eP95": round(e2e_p95, 1) if e2e_p95 is not None else None,
            "run_id": run_id,
            "rawConfig": applied,
            "metricSet": m,
            "feasibilityResult": feas,
        }

        # Score run quality to prevent contaminated/inconclusive runs from overwriting valid/authoritative runs
        is_auth = (run_id == orig_verified_run_id)
        val_score = _validity_score(feas.get("validity_status"))
        verd_score = _verdict_score(verdict)
        rec_data = run_data.get("run_record") or {}
        comp_score = 1 if rec_data.get("execution_status") == "COMPLETED" else 0
        t_score = r_dir.stat().st_mtime
        run_score = (is_auth, val_score, verd_score, comp_score, t_score)

        if cid not in candidates_map or run_score > candidates_map[cid][1]:
            candidates_map[cid] = (candidate_obj, run_score)

    candidates = [obj for obj, _ in candidates_map.values()]
    candidates.sort(key=lambda c: (c["tag"] != "WINNER", c["id"]))
    return candidates


def get_experiment_verification(experiment_id: str, artifacts_root: str = "artifacts") -> Dict[str, Any]:
    """
    Returns independent verification status.
    If no verification record exists, returns honest PENDING status per AGENTS.md Section 7.
    """
    exp_dir = _find_experiment_dir(experiment_id, artifacts_root=artifacts_root)
    if not exp_dir:
        return {
            "status": "pending",
            "verification_verdict": "INDEPENDENT VERIFICATION PENDING",
            "is_verified": False,
            "final_decision_notes": f"Experiment '{experiment_id}' not found.",
        }

    verif_file = exp_dir / "verification_record.json"
    if verif_file.exists():
        try:
            data = json.loads(verif_file.read_text(encoding="utf-8"))
            data["is_verified"] = data.get("verification_verdict") in ("VERIFIED", "VerificationVerdict.VERIFIED")
            data["status"] = "completed"
            return data
        except Exception as e:
            return {
                "status": "error",
                "verification_verdict": "ERROR",
                "is_verified": False,
                "error": str(e),
            }

    search_res = None
    sr_file = exp_dir / "search_result.json"
    if sr_file.exists():
        try:
            search_res = json.loads(sr_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    selected_cand = search_res.get("selected_candidate_id") if search_res else None
    original_run_id = None
    runs_dir = exp_dir / "runs"
    if selected_cand:
        candidates = get_experiment_candidates(experiment_id, artifacts_root=artifacts_root)
        cand_match = next((c for c in candidates if c.get("id") == selected_cand), None)
        if cand_match and cand_match.get("run_id"):
            original_run_id = cand_match["run_id"]
        elif runs_dir.is_dir():
            for run_dir in runs_dir.iterdir():
                if not run_dir.is_dir():
                    continue
                try:
                    run_record = json.loads((run_dir / "run_record.json").read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if run_record.get("candidate_id") == selected_cand and not run_record.get("is_verification_run"):
                    original_run_id = run_record.get("run_id", run_dir.name)
                    break

    return {
        "status": "pending",
        "verification_verdict": "INDEPENDENT VERIFICATION PENDING",
        "is_verified": False,
        "verification_id": "verif-pending",
        "experiment_id": experiment_id,
        "candidate_id": selected_cand,
        "original_run_id": original_run_id,
        "verification_run_id": None,
        "final_decision_notes": (
            "Independent verification rerun has not yet been executed for this campaign. "
            "Verification must be executed independently with a fresh run ID per AGENTS.md § 7."
        ),
        "drift_analysis": None,
    }


def list_all_reports(artifacts_root: str = "artifacts") -> List[Dict[str, Any]]:
    """
    Discovers all compiled reports across artifacts_root.
    """
    root = Path(artifacts_root)
    reports = []
    seen = set()

    for r_json in root.glob("**/report.json"):
        exp_id = r_json.parent.name
        if exp_id in seen:
            continue
        seen.add(exp_id)

        try:
            data = json.loads(r_json.read_text(encoding="utf-8"))
            mtime = r_json.stat().st_mtime
            updated_str = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

            evidence_class = _classify_evidence(
                data.get("environment_fingerprint"),
                is_simulated=data.get("is_simulated"),
            )

            reports.append({
                "experiment_id": exp_id,
                "report_id": data.get("report_id", f"rep-{exp_id}"),
                "created_at": data.get("generated_at", updated_str),
                "model": data.get("workload_spec", {}).get("model_name", "meta-llama/Meta-Llama-3-8B-Instruct"),
                "evidence_classification": evidence_class,
                "selected_candidate_id": data.get("selected_candidate_id", ""),
                "has_markdown": (r_json.parent / "report.md").exists(),
                "path": str(r_json),
            })
        except Exception:
            pass

    reports.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return reports
