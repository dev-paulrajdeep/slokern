$ErrorActionPreference = "Stop"

$env:NO_PROXY = "127.0.0.1,localhost"
$env:no_proxy = "127.0.0.1,localhost"
$env:HTTP_PROXY = ""
$env:http_proxy = ""
$env:HTTPS_PROXY = ""
$env:https_proxy = ""
[System.Net.WebRequest]::DefaultWebProxy = $null

$rootDir = Split-Path -Parent $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }
$pythonPath = Join-Path $rootDir ".venv\Scripts\python.exe"

Write-Host "[Zero-GPU Acceptance] Starting SLOKern API on port 8001 using $pythonPath..."
$apiProcess = Start-Process -FilePath $pythonPath -ArgumentList "-m slokern.cli.main serve --port 8001" -WorkingDirectory $rootDir -PassThru -RedirectStandardError "$rootDir\api_err.log" -RedirectStandardOutput "$rootDir\api_out.log"

Write-Host "[Zero-GPU Acceptance] Starting Vite dev server on port 5173..."
$viteProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d frontend && npx vite --port 5173 --host 127.0.0.1" -WorkingDirectory $rootDir -PassThru -RedirectStandardError "$rootDir\vite_err.log" -RedirectStandardOutput "$rootDir\vite_out.log"

try {
    # Wait for API to respond
    $apiReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8001/api/health" -UseBasicParsing -TimeoutSec 10
            if ($resp.StatusCode -eq 200) {
                $apiReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $apiReady) {
        Write-Host "--- API ERROR LOG ---"
        if (Test-Path "$rootDir\api_err.log") { Get-Content "$rootDir\api_err.log" | Write-Host }
        Write-Host "--- API OUT LOG ---"
        if (Test-Path "$rootDir\api_out.log") { Get-Content "$rootDir\api_out.log" | Write-Host }
        throw "SLOKern API failed to become ready on port 8001"
    }
    Write-Host "  ✓ API is responsive on http://127.0.0.1:8001"

    # Wait for Vite dev server to respond
    $viteReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) {
                $viteReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $viteReady) {
        throw "Vite dev server failed to become ready on port 5173"
    }
    Write-Host "  ✓ Frontend is responsive on http://127.0.0.1:5173"

    # Run Node Puppeteer script
    Write-Host "[Zero-GPU Acceptance] Running capture_cmp8a_ui.cjs..."
    node frontend/capture_cmp8a_ui.cjs
    if ($LASTEXITCODE -ne 0) {
        throw "capture_cmp8a_ui.cjs failed with exit code $LASTEXITCODE"
    }
    Write-Host "  ✓ All screenshots captured successfully!"
} finally {
    Write-Host "[Zero-GPU Acceptance] Stopping background servers..."
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($viteProcess -and -not $viteProcess.HasExited) {
        cmd.exe /c "taskkill /PID $($viteProcess.Id) /T /F" 2>&1 | Out-Null
    }
    Start-Sleep -Seconds 1
    Get-NetTCPConnection -LocalPort 5173, 8001 -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
