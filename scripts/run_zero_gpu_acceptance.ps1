$ErrorActionPreference = "Stop"

Write-Host "[Zero-GPU Acceptance] Starting SLOKern API on port 8001..."
$apiProcess = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "-m slokern.cli.main serve --port 8001" -PassThru

Write-Host "[Zero-GPU Acceptance] Starting Vite dev server on port 5173..."
$viteProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d frontend && npx vite --port 5173 --host 127.0.0.1" -PassThru

try {
    # Wait for API to respond
    $apiReady = $false
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8001/api/health" -UseBasicParsing -TimeoutSec 1
            if ($resp.StatusCode -eq 200) {
                $apiReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $apiReady) {
        throw "SLOKern API failed to become ready on port 8001"
    }
    Write-Host "  ✓ API is responsive on http://127.0.0.1:8001"

    # Wait for Vite dev server to respond
    $viteReady = $false
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing -TimeoutSec 1
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
