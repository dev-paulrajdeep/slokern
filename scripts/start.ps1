<#
.SYNOPSIS
    Starts SLOKern application services (API Control Plane and Vite Dashboard) in the background.
.DESCRIPTION
    1. Checks port availability for backend (8001) and frontend (5173).
    2. Starts backend (slokern serve) and frontend (Vite) as tracked background processes.
    3. Saves process IDs to .slokern/pids/backend.pid and .slokern/pids/frontend.pid.
    4. Redirects stdout and stderr to logs/backend.log and logs/frontend.log.
    5. Probes health endpoints to verify readiness before returning.
    6. Displays dashboard and API URLs with actionable status.
.PARAMETER BackendPort
    Port for SLOKern control plane HTTP API (default: 8001).
.PARAMETER FrontendPort
    Port for SLOKern frontend Vite server (default: 5173).
.PARAMETER HostAddress
    Host interface to bind services (default: 127.0.0.1).
.PARAMETER NoFrontend
    Skip starting frontend dashboard (backend API only).
.PARAMETER NoBrowser
    Do not automatically open dashboard in default web browser.
.PARAMETER Preview
    Use production preview server (vite preview) if frontend/dist exists.
#>

[CmdletBinding()]
param(
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 5173,
    [string]$HostAddress = "127.0.0.1",
    [switch]$NoFrontend,
    [switch]$NoBrowser,
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$PidDir = Join-Path $RepoRoot ".slokern\pids"
$LogDir = Join-Path $RepoRoot "logs"

# Ensure runtime directories exist
if (-not (Test-Path $PidDir)) {
    New-Item -ItemType Directory -Path $PidDir -Force | Out-Null
}
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$env:PYTHONPATH = "$RepoRoot\src;$($env:PYTHONPATH)"

function Test-PortOpen([string]$HostName, [int]$Port, [int]$TimeoutMs = 600) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Probe-ApiHealth([string]$HostName, [int]$Port, [int]$TimeoutSec = 2) {
    try {
        $url = "http://$HostName`:$Port/api/health"
        $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop
        if ($resp -and ($resp.status -or $resp.runtime -or $resp.version)) {
            return $true
        }
        return $false
    } catch {
        # Check if error response contains valid JSON status (e.g. degraded HTTP 503)
        if ($_.Exception -and $_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                if ($body -match '"status"') {
                    return $true
                }
            } catch {}
        }
        return $false
    }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "          SLOKern Application Service Lifecycle Launcher         " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Workspace:    $RepoRoot" -ForegroundColor DarkGray
Write-Host "  Backend Port: $BackendPort" -ForegroundColor DarkGray
Write-Host "  Frontend Port:$FrontendPort" -ForegroundColor DarkGray
Write-Host ""

# 1. Resolve Python executable
$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        $PythonExe = $pythonCmd.Source
    } else {
        Write-Host "[ERROR] Python executable not found. Ensure .venv or python is installed and in PATH." -ForegroundColor Red
        exit 1
    }
}

# 2. Check Backend Port Status
$backendPidFile = Join-Path $PidDir "backend.pid"
$backendAlreadyRunning = $false

if (Test-PortOpen -HostName $HostAddress -Port $BackendPort) {
    if (Probe-ApiHealth -HostName $HostAddress -Port $BackendPort) {
        Write-Host "[INFO] Backend API is already running and healthy on port $BackendPort." -ForegroundColor Green
        $backendAlreadyRunning = $true
        if (-not (Test-Path $backendPidFile)) {
            # Attempt to record owning PID if possible
            $conn = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn -and $conn.OwningProcess) {
                $conn.OwningProcess | Out-File -FilePath $backendPidFile -Encoding ascii
            }
        }
    } else {
        Write-Host "[ERROR] Port $BackendPort is already in use by an unrecognized service." -ForegroundColor Red
        Write-Host "Please terminate the process on port $BackendPort or run scripts/stop.ps1 before launching." -ForegroundColor Yellow
        exit 1
    }
}

# 3. Start Backend if not already running
if (-not $backendAlreadyRunning) {
    Write-Host "[1/3] Starting SLOKern Control Plane API on http://$HostAddress`:$BackendPort..." -ForegroundColor Yellow

    $backendOutLog = Join-Path $LogDir "backend.log"
    $backendErrLog = Join-Path $LogDir "backend.err"

    # Truncate/touch logs
    "" | Out-File -FilePath $backendOutLog -Encoding utf8 -Force
    "" | Out-File -FilePath $backendErrLog -Encoding utf8 -Force

    $backendProc = Start-Process -FilePath $PythonExe `
        -ArgumentList "-u -m slokern.cli.main serve --host $HostAddress --port $BackendPort" `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $backendOutLog `
        -RedirectStandardError $backendErrLog `
        -WindowStyle Hidden `
        -PassThru

    $backendProc.Id | Out-File -FilePath $backendPidFile -Encoding ascii
    Write-Host "  -> Backend process spawned (PID: $($backendProc.Id)). Waiting for health probe..." -ForegroundColor DarkCyan

    # Poll /api/health for up to 15 seconds
    $backendHealthy = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if ($backendProc.HasExited) {
            Write-Host "[ERROR] Backend process exited unexpectedly with code $($backendProc.ExitCode)." -ForegroundColor Red
            if (Test-Path $backendErrLog) {
                Write-Host "Recent error log output:" -ForegroundColor Yellow
                Get-Content $backendErrLog -Tail 15 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
            }
            Remove-Item $backendPidFile -Force -ErrorAction SilentlyContinue
            exit 1
        }
        if (Probe-ApiHealth -HostName $HostAddress -Port $BackendPort) {
            $backendHealthy = $true
            break
        }
    }

    if (-not $backendHealthy) {
        Write-Host "[ERROR] Backend started but failed to respond to /api/health within 15 seconds." -ForegroundColor Red
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
        Remove-Item $backendPidFile -Force -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "  -> Backend health check verified (HTTP 200 OK)." -ForegroundColor Green
}

# 4. Check & Start Frontend Dashboard
$frontendPidFile = Join-Path $PidDir "frontend.pid"
$frontendRunning = $false

if (-not $NoFrontend) {
    $frontendDir = Join-Path $RepoRoot "frontend"
    $nodeModulesDir = Join-Path $frontendDir "node_modules"

    if (Test-PortOpen -HostName $HostAddress -Port $FrontendPort) {
        Write-Host "[INFO] Frontend dashboard is already active on port $FrontendPort." -ForegroundColor Green
        $frontendRunning = $true
        if (-not (Test-Path $frontendPidFile)) {
            $conn = Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn -and $conn.OwningProcess) {
                $conn.OwningProcess | Out-File -FilePath $frontendPidFile -Encoding ascii
            }
        }
    } elseif (-not (Test-Path $nodeModulesDir)) {
        Write-Host "[WARN] frontend/node_modules not found. Skipping frontend dashboard." -ForegroundColor Yellow
        Write-Host "To install frontend: npm --prefix frontend install (or run scripts/setup.ps1)" -ForegroundColor DarkGray
    } else {
        Write-Host "[2/3] Starting Frontend Dashboard on http://$HostAddress`:$FrontendPort..." -ForegroundColor Yellow

        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCmd) {
            Write-Host "[WARN] node executable not found in PATH. Skipping frontend dashboard." -ForegroundColor Yellow
        } else {
            $frontendOutLog = Join-Path $LogDir "frontend.log"
            $frontendErrLog = Join-Path $LogDir "frontend.err"
            "" | Out-File -FilePath $frontendOutLog -Encoding utf8 -Force
            "" | Out-File -FilePath $frontendErrLog -Encoding utf8 -Force

            $viteJs = Join-Path $frontendDir "node_modules\vite\bin\vite.js"
            $distDir = Join-Path $frontendDir "dist"

            $viteArgs = ""
            if ($Preview -and (Test-Path $distDir)) {
                $viteArgs = "preview --host $HostAddress --port $FrontendPort"
            } else {
                $viteArgs = "--host $HostAddress --port $FrontendPort"
            }

            $frontendProc = $null
            if (Test-Path $viteJs) {
                # Launch node directly with vite script
                $frontendProc = Start-Process -FilePath $nodeCmd.Source `
                    -ArgumentList "`"$viteJs`" $viteArgs" `
                    -WorkingDirectory $frontendDir `
                    -RedirectStandardOutput $frontendOutLog `
                    -RedirectStandardError $frontendErrLog `
                    -WindowStyle Hidden `
                    -PassThru
            } else {
                # Fallback to npx
                $frontendProc = Start-Process -FilePath "cmd.exe" `
                    -ArgumentList "/c npx vite $viteArgs" `
                    -WorkingDirectory $frontendDir `
                    -RedirectStandardOutput $frontendOutLog `
                    -RedirectStandardError $frontendErrLog `
                    -WindowStyle Hidden `
                    -PassThru
            }

            $frontendProc.Id | Out-File -FilePath $frontendPidFile -Encoding ascii
            Write-Host "  -> Frontend process spawned (PID: $($frontendProc.Id)). Waiting for port readiness..." -ForegroundColor DarkCyan

            # Poll frontend port for up to 12 seconds
            for ($j = 0; $j -lt 24; $j++) {
                Start-Sleep -Milliseconds 500
                if ($frontendProc.HasExited) {
                    Write-Host "[WARN] Frontend process exited with code $($frontendProc.ExitCode)." -ForegroundColor Yellow
                    Remove-Item $frontendPidFile -Force -ErrorAction SilentlyContinue
                    break
                }
                if (Test-PortOpen -HostName $HostAddress -Port $FrontendPort) {
                    $frontendRunning = $true
                    break
                }
            }

            if ($frontendRunning) {
                Write-Host "  -> Frontend dashboard verified (Port $FrontendPort listening)." -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Frontend started but did not open port $FrontendPort in time. Check $frontendErrLog" -ForegroundColor Yellow
            }
        }
    }
}

# 5. Output Service URLs & Status Summary
Write-Host "`n[3/3] Service Status Summary" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "      SLOKern Application Services Ready & Operational           " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
if ($frontendRunning) {
    Write-Host "  Dashboard UI:         http://localhost:$FrontendPort" -ForegroundColor Cyan
} else {
    Write-Host "  Dashboard UI:         Disabled/Offline" -ForegroundColor DarkGray
}
Write-Host "  API Control Plane:    http://$HostAddress`:$BackendPort" -ForegroundColor Cyan
Write-Host "  API Health Endpoint:  http://$HostAddress`:$BackendPort/api/health" -ForegroundColor Cyan
Write-Host "  API Docs / Endpoints: http://$HostAddress`:$BackendPort/api/experiments" -ForegroundColor DarkCyan
Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray

$bPid = if (Test-Path $backendPidFile) { (Get-Content $backendPidFile).Trim() } else { "N/A" }
$fPid = if (Test-Path $frontendPidFile) { (Get-Content $frontendPidFile).Trim() } else { "N/A" }
Write-Host "  Backend PID:          $bPid (saved in .slokern\pids\backend.pid)" -ForegroundColor DarkGray
Write-Host "  Frontend PID:         $fPid (saved in .slokern\pids\frontend.pid)" -ForegroundColor DarkGray
Write-Host "  Log Files:            logs\backend.log, logs\frontend.log" -ForegroundColor DarkGray
Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  To stop services:     .\scripts\stop.ps1" -ForegroundColor Yellow
Write-Host "  To diagnose health:   python scripts/doctor.py" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Green

if ($frontendRunning -and (-not $NoBrowser)) {
    Start-Process "http://localhost:$FrontendPort"
}

exit 0
