<#
.SYNOPSIS
    SLOKern Turnkey Installation Launcher (Windows PowerShell)
.DESCRIPTION
    Thin, robust launcher for scripts/setup.py. Discovers system Python 3,
    forwards all arguments, and delegates all bootstrap logic to setup.py.
.EXAMPLE
    .\scripts\setup.ps1
    .\scripts\setup.ps1 --check-only
    .\scripts\setup.ps1 --dev --non-interactive
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if (-not $RepoRoot) { $RepoRoot = (Get-Location).Path }
Set-Location $RepoRoot

# Find suitable Python 3 executable
$PythonExe = $null
$UsePyLauncher = $false

# 1. Existing virtual environment python
$VenvPy = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
    $PythonExe = $VenvPy
}

# 2. Python launcher 'py -3'
if (-not $PythonExe) {
    try {
        $pyCmd = Get-Command "py" -ErrorAction SilentlyContinue
        if ($pyCmd) {
            $pyTest = & py -3 -c "import sys; print(sys.version_info[0])" 2>$null
            if ($pyTest -eq "3") {
                $PythonExe = "py"
                $UsePyLauncher = $true
            }
        }
    } catch {}
}

# 3. System 'python'
if (-not $PythonExe) {
    try {
        $pyCmd = Get-Command "python" -ErrorAction SilentlyContinue
        if ($pyCmd) {
            $pyTest = & python -c "import sys; print(sys.version_info[0])" 2>$null
            if ($pyTest -eq "3") {
                $PythonExe = "python"
            }
        }
    } catch {}
}

# 4. System 'python3'
if (-not $PythonExe) {
    try {
        $pyCmd = Get-Command "python3" -ErrorAction SilentlyContinue
        if ($pyCmd) {
            $PythonExe = "python3"
        }
    } catch {}
}

if (-not $PythonExe) {
    Write-Host "[ERROR] Python 3.10+ was not found on PATH." -ForegroundColor Red
    Write-Host "Please install Python 3.11 from https://www.python.org/downloads/ or via:" -ForegroundColor Yellow
    Write-Host "  winget install Python.Python.3.11" -ForegroundColor Yellow
    exit 1
}

$SetupScript = Join-Path $ScriptDir "setup.py"
if (-not (Test-Path $SetupScript)) {
    Write-Host "[ERROR] setup.py not found at $SetupScript" -ForegroundColor Red
    exit 1
}

if ($UsePyLauncher) {
    & py -3 $SetupScript @RemainingArgs
} else {
    & $PythonExe $SetupScript @RemainingArgs
}

exit $LASTEXITCODE
