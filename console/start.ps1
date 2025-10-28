param([string]$param1, [string]$param2, [string]$param3)

Set-Variable CONFIG_PATH ..\backend

if (-not (Test-Path -Path ..\backend\downloads)) {
  New-Item -Path ..\backend\downloads -ItemType Directory
}

if (-not (Test-Path -Path .\downloads)) {
  New-Item -Path .\downloads -ItemType SymbolicLink -Value ..\backend\downloads
}

python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt; python pod.py $param1 $param2 $param3
