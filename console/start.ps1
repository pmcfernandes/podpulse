param([string]$param1, [string]$param2, [string]$param3)

Set-Variable CONFIG_PATH ..\backend\config

if (-not (Test-Path -Path ..\backend\downloads)) {
  New-Item -Path ..\backend\downloads -ItemType Directory
}

if (-not (Test-Path -Path ..\backend\config)) {
  New-Item -Path ..\backend\config -ItemType Directory
}

if (-not (Test-Path -Path .\downloads)) {
  New-Item -Path .\downloads -ItemType SymbolicLink -Value ..\backend\downloads
}

if (-not (Test-Path -Path .\config)) {
  New-Item -Path .\config -ItemType SymbolicLink -Value ..\backend\config
}

python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt; python pod.py $param1 $param2 $param3
