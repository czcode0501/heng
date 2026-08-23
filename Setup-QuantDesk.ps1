param(
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RequirementsPath = Join-Path $ProjectRoot "requirements.txt"
$StartScript = Join-Path $ProjectRoot "Start-QuantDesk.ps1"
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$BrandName = (([char]0x8861).ToString() + ([char]0x7B56).ToString() + " Quant Desk")

function Stop-WithMessage([string]$Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "HengCe Quant Desk setup" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$NpmPath = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NodePath -or -not $NpmPath) {
  Stop-WithMessage "Node.js 20 or newer is required. Install Node.js, then run setup-windows.cmd again."
}

$NodeMajor = [int]((& $NodePath --version).TrimStart("v").Split(".")[0])
if ($NodeMajor -lt 20) {
  Stop-WithMessage "Node.js 20 or newer is required."
}

$PythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
$PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $PythonLauncher -and -not $PythonCommand) {
  Stop-WithMessage "Python 3.10 or newer is required. Install Python, then run setup-windows.cmd again."
}

if (-not (Test-Path -LiteralPath $VenvPython)) {
  Write-Host "[1/4] Creating Python virtual environment..."
  if ($PythonLauncher) {
    & $PythonLauncher.Source -3 -m venv (Join-Path $ProjectRoot ".venv")
  } else {
    & $PythonCommand.Source -m venv (Join-Path $ProjectRoot ".venv")
  }
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Unable to create the Python virtual environment." }
} else {
  Write-Host "[1/4] Python virtual environment already exists."
}

$PythonVersion = (& $VenvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
$PythonParts = $PythonVersion.Split(".")
if ([int]$PythonParts[0] -lt 3 -or ([int]$PythonParts[0] -eq 3 -and [int]$PythonParts[1] -lt 10)) {
  Stop-WithMessage "Python 3.10 or newer is required."
}

Write-Host "[2/4] Installing Python data adapters..."
& $VenvPython -m pip install --disable-pip-version-check --requirement $RequirementsPath
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Python dependency installation failed." }

Write-Host "[3/4] Installing web dependencies..."
Push-Location $ProjectRoot
try {
  & $NpmPath ci
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Node dependency installation failed." }
} finally {
  Pop-Location
}

Write-Host "[4/4] Creating a shortcut for this computer..."
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "$BrandName.lnk"
$PowerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellPath
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "Start HengCe Quant Desk on this computer"
$Shortcut.Save()

Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Shortcut: $ShortcutPath"
if (-not $NoLaunch) {
  Start-Process -FilePath $PowerShellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $StartScript) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
}
