# Start Muse Development Server (Backend + Frontend)
# Run from project root: .\run-muse.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host "========================================"
Write-Host "  Starting Muse Development Server"
Write-Host "========================================"
Write-Host ""

# Backend
$BackendDir = Join-Path $ProjectRoot "muse_backend"
if (-not (Test-Path $BackendDir)) { Write-Error "muse_backend not found at $BackendDir" }

Write-Host "[1/2] Starting Python Backend..."
$backendScript = @"
Set-Location -LiteralPath '$BackendDir'
if (Test-Path '.venv\Scripts\Activate.ps1') {
    & '.venv\Scripts\Activate.ps1'
    python run.py
} else {
    python run.py
}
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript -WorkingDirectory $BackendDir

Start-Sleep -Seconds 2

# Frontend
$FrontendDir = Join-Path $ProjectRoot "muse-studio"
if (-not (Test-Path $FrontendDir)) { Write-Error "muse-studio not found at $FrontendDir" }

Write-Host "[2/2] Starting Next.js Frontend..."
$frontendScript = @"
Set-Location -LiteralPath '$FrontendDir'
`$env:NODE_OPTIONS = '--max-old-space-size=4096'
npm run dev
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript -WorkingDirectory $FrontendDir

Write-Host ""
Write-Host "========================================"
Write-Host "  Both servers starting in new windows"
Write-Host "  Backend:  http://localhost:8000"
Write-Host "  Frontend: http://localhost:3000"
Write-Host "========================================"
