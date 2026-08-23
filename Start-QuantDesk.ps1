$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppUrl = "http://127.0.0.1:5173/#overview"
$NpmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VenvPython) -or -not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Quant Desk is not installed on this computer. Run setup-windows.cmd first.", "Quant Desk") | Out-Null
  exit 1
}

function Test-LocalPort([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

if (-not (Test-LocalPort 8000)) {
  Start-Process -FilePath $NpmPath -ArgumentList @("run", "dev:api") -WorkingDirectory $ProjectRoot -WindowStyle Hidden
}

if (-not (Test-LocalPort 5173)) {
  Start-Process -FilePath $NpmPath -ArgumentList @("run", "dev:web") -WorkingDirectory $ProjectRoot -WindowStyle Hidden
}

$Deadline = (Get-Date).AddSeconds(25)
while (-not (Test-LocalPort 5173) -and (Get-Date) -lt $Deadline) {
  Start-Sleep -Milliseconds 300
}

if (-not (Test-LocalPort 5173)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Quant Desk startup timed out. Run npm run dev and npm run dev:api in the project folder to inspect the error.", "Quant Desk") | Out-Null
  exit 1
}

Start-Process $AppUrl
