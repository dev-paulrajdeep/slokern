<#
.SYNOPSIS
    SLOKern Local Optimization & Product Showcase Runner.
.DESCRIPTION
    Turnkey automation script that exercises host NVIDIA GeForce RTX 5060 (8GB VRAM)
    and Ollama with qwen3:4b-instruct-2507-q4_K_M:
    1. Preflight health check (Ollama daemon & model presence)
    2. Streaming smoke-test probe
    3. Background control plane HTTP API startup (127.0.0.1:8000)
    4. 6-run optimization campaign with independent verification rerun
    5. Immutable report generation (JSON + Markdown)
    6. Launch Command Center dashboard
#>

[CmdletBinding()]
param(
    [string]$SpecPath = "experiments/configs/local_qwen3_benchmark.json",
    [string]$Model = "qwen3:4b-instruct-2507-q4_K_M",
    [string]$BaseUrl = "http://127.0.0.1:11434",
    [int]$ApiPort = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "      SLOKern - Local Serving Tuning & Benchmark Showcase        " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Hardware: NVIDIA GeForce RTX 5060 Laptop GPU (8GB VRAM)" -ForegroundColor DarkCyan
Write-Host "Model:    $Model" -ForegroundColor DarkCyan
Write-Host "Endpoint: $BaseUrl" -ForegroundColor DarkCyan
Write-Host ""

# 0. Resolve Python executable
$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

$PythonExe = "$RepoRoot\.venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
}

# 1. Preflight Health Check
Write-Host "[1/6] Preflight Health Check: Probing Ollama daemon..." -ForegroundColor Yellow
$ollamaReady = $false
try {
    $tagsResp = Invoke-RestMethod -Uri "$BaseUrl/api/tags" -Method Get -TimeoutSec 3
    $ollamaReady = $true
} catch {
    Write-Host "  -> Ollama is not responding at $BaseUrl. Attempting to start daemon with OLLAMA_NUM_PARALLEL=2, CONTEXT=4096..." -ForegroundColor DarkCyan
    $env:OLLAMA_NUM_PARALLEL = "2"
    $env:OLLAMA_CONTEXT_LENGTH = "4096"
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) {
        Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden -Environment @{ "OLLAMA_NUM_PARALLEL" = "2"; "OLLAMA_CONTEXT_LENGTH" = "4096" }
        Write-Host "  -> Started Ollama daemon in background. Waiting for startup..." -ForegroundColor DarkCyan
        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Seconds 1
            try {
                $tagsResp = Invoke-RestMethod -Uri "$BaseUrl/api/tags" -Method Get -TimeoutSec 2
                $ollamaReady = $true
                break
            } catch {
                # continue waiting
            }
        }
    }
}

if (-not $ollamaReady) {
    Write-Host "[ERROR] Cannot connect to Ollama daemon at $BaseUrl." -ForegroundColor Red
    Write-Host "Ensure Ollama is running ('ollama serve') before launching the campaign." -ForegroundColor Yellow
    exit 1
}

$models = $tagsResp.models | ForEach-Object { $_.name, $_.model }
$found = $false
foreach ($m in $models) {
    if ($m -like "$Model*" -or $m -eq $Model) {
        $found = $true
        break
    }
}
if (-not $found) {
    Write-Host "[ERROR] Ollama is reachable, but model '$Model' is not installed." -ForegroundColor Red
    Write-Host "Please pull the model: ollama pull $Model" -ForegroundColor Yellow
    exit 1
}
Write-Host "  -> Ollama daemon ready with model '$Model'." -ForegroundColor Green

# 2. Preflight Smoke Test Probe
Write-Host "`n[2/6] Executing Preflight Smoke Test Probe..." -ForegroundColor Yellow
& $PythonExe -m slokern.cli.main smoke-test --adapter local --stream
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Smoke test probe failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "  -> Smoke test probe succeeded." -ForegroundColor Green

# 3. Control Plane HTTP API Server
Write-Host "`n[3/6] Ensuring Control Plane HTTP API is running on port $ApiPort..." -ForegroundColor Yellow
$apiReady = $false
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/health" -Method Get -TimeoutSec 2
    if ($health.status -eq "ok" -or $health.status -eq "healthy") {
        $apiReady = $true
        Write-Host "  -> Control plane API is already running on port $ApiPort." -ForegroundColor Green
    }
} catch {
    $apiReady = $false
}

if (-not $apiReady) {
    Write-Host "  -> Starting background API server (127.0.0.1:$ApiPort)..." -ForegroundColor DarkCyan
    $apiProc = Start-Process -FilePath $PythonExe `
        -ArgumentList "-m slokern.cli.main serve --host 127.0.0.1 --port $ApiPort" `
        -WindowStyle Hidden `
        -PassThru
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/health" -Method Get -TimeoutSec 5
        Write-Host "  -> Control plane API server started successfully (PID: $($apiProc.Id))." -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] API server started but health check probe timed out; continuing..." -ForegroundColor Yellow
    }
}

# 4. Optimization Campaign (1 Baseline + 4 Grid Candidates + 1 Independent Verification Run)
Write-Host "`n[4/6] Launching 2x2 Optimization Campaign with Auto-Verification..." -ForegroundColor Yellow
Write-Host "  Specification: $SpecPath" -ForegroundColor DarkCyan
Write-Host "  Grid: num_batch in {256, 1024} x num_ctx in {1024, 2048}" -ForegroundColor DarkCyan

& $PythonExe -m slokern.cli.main optimize $SpecPath --adapter local --auto-verify
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Optimization campaign failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "  -> Optimization campaign & verification rerun completed successfully." -ForegroundColor Green

# 5. Report Generation
Write-Host "`n[5/6] Generating Immutable Audit & Verification Report..." -ForegroundColor Yellow
$expDir = "$RepoRoot\artifacts\experiments\exp-local-qwen3-tuning"
if (Test-Path $expDir) {
    & $PythonExe -m slokern.cli.main report $expDir --output-dir $expDir
    if (Test-Path "$expDir\report.md") {
        Copy-Item "$expDir\report.md" "$RepoRoot\final_report.md" -Force
        Write-Host "  -> Copied report to $RepoRoot\final_report.md" -ForegroundColor Green
    }
}

# 6. Launch Command Center
Write-Host "`n[6/6] Launching SLOKern Command Center..." -ForegroundColor Yellow
$dashboardUrl = "http://127.0.0.1:$ApiPort/api/experiments"

try {
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        $dashboardUrl = "http://localhost:5173"
    }
} catch {
    # fallback
}

Write-Host "  -> Dashboard URL: $dashboardUrl" -ForegroundColor Cyan
if (-not $NoBrowser) {
    Start-Process $dashboardUrl
}

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host " Showcase Completed! Audit report: final_report.md" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
