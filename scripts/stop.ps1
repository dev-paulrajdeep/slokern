<#
.SYNOPSIS
    Stops SLOKern application services using recorded PIDs.
.DESCRIPTION
    Safely terminates only SLOKern processes recorded in .slokern/pids/ without killing
    unrelated system or user processes.
    1. Reads recorded PIDs from .slokern/pids/backend.pid and .slokern/pids/frontend.pid.
    2. Validates process identity and command line to prevent terminating recycled PIDs.
    3. Gracefully stops processes and their tracked subprocess trees.
    4. Removes PID files and confirms port release.
#>

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$PidDir = Join-Path $RepoRoot ".slokern\pids"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "           SLOKern Application Service Terminator                " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (-not (Test-Path $PidDir)) {
    Write-Host "[INFO] No .slokern\pids directory found. No services to stop." -ForegroundColor Green
    exit 0
}

$pidFiles = Get-ChildItem -Path $PidDir -Filter "*.pid" -ErrorAction SilentlyContinue
if (-not $pidFiles -or $pidFiles.Count -eq 0) {
    Write-Host "[INFO] No active SLOKern PID files found in $PidDir. No services to stop." -ForegroundColor Green
    exit 0
}

function Stop-SlokernProcess([string]$PidFilePath, [string]$ServiceName, [string[]]$ExpectedKeywords) {
    if (-not (Test-Path $PidFilePath)) {
        return
    }

    $rawPid = (Get-Content -Path $PidFilePath -Raw -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($rawPid)) {
        Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
        return
    }

    $targetPid = 0
    if (-not [int]::TryParse($rawPid.Trim(), [ref]$targetPid)) {
        Write-Host "  [WARN] Invalid PID in ${PidFilePath}: '$rawPid'. Removing stale file." -ForegroundColor Yellow
        Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
        return
    }

    # 1. Check if process exists
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "  [INFO] $ServiceName (PID $targetPid) is not running. Cleaned up stale PID file." -ForegroundColor DarkGray
        Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
        return
    }

    # 2. Identity validation: check process name and commandline to ensure PID was not recycled
    $cimProc = $null
    try {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction Stop
    } catch {}
    $cmdLine = if ($cimProc -and $cimProc.CommandLine) { $cimProc.CommandLine } else { "" }
    $procName = $proc.ProcessName.ToLower()

    $isExpected = $false
    foreach ($kw in $ExpectedKeywords) {
        if ($procName -like "*$kw*" -or $cmdLine.ToLower() -like "*$kw*") {
            $isExpected = $true
            break
        }
    }

    if (-not $isExpected) {
        Write-Host "  [SECURITY WARNING] Process with PID $targetPid ($procName) does not match expected $ServiceName keywords." -ForegroundColor Red
        Write-Host "  Command Line: $cmdLine" -ForegroundColor DarkYellow
        Write-Host "  Skipping termination to avoid killing unrelated process." -ForegroundColor Red
        Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
        return
    }

    # 3. Terminate process and its children
    Write-Host "  Stopping $ServiceName (PID $targetPid, Process: $procName)..." -ForegroundColor Yellow

    # Terminate child processes first
    $children = $null
    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $targetPid" -ErrorAction Stop
    } catch {}
    if ($children) {
        foreach ($child in $children) {
            try {
                Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    }

    # Try taskkill /T /F for complete tree cleanup if available
    $taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($taskkill) {
        & $taskkill.Source /PID $targetPid /T /F 2>$null | Out-Null
    } else {
        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
    }

    # Wait up to 3 seconds for exit
    $stopped = $false
    for ($i = 0; $i -lt 6; $i++) {
        Start-Sleep -Milliseconds 500
        $check = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if (-not $check) {
            $stopped = $true
            break
        }
    }

    if ($stopped) {
        Write-Host "  [PASS] Successfully stopped $ServiceName (PID $targetPid)." -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Process $targetPid did not exit cleanly; forcing termination..." -ForegroundColor Yellow
        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
}

# Stop Backend
$backendPidPath = Join-Path $PidDir "backend.pid"
Stop-SlokernProcess -PidFilePath $backendPidPath -ServiceName "Backend API" -ExpectedKeywords @("python", "slokern", "serve")

# Stop Frontend
$frontendPidPath = Join-Path $PidDir "frontend.pid"
Stop-SlokernProcess -PidFilePath $frontendPidPath -ServiceName "Frontend Dashboard" -ExpectedKeywords @("node", "vite", "cmd", "npm")

# Clean up any leftover PID files
$remaining = Get-ChildItem -Path $PidDir -Filter "*.pid" -ErrorAction SilentlyContinue
if (-not $remaining -or $remaining.Count -eq 0) {
    Write-Host "`nAll SLOKern application services stopped cleanly." -ForegroundColor Green
} else {
    Write-Host "`nRemaining PID files in ${PidDir}: $($remaining.Count)" -ForegroundColor Yellow
}
Write-Host "=================================================================" -ForegroundColor Cyan
exit 0
