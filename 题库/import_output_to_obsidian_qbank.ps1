$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$pythonExe = "E:\anaconda\python.exe"
$qbankFolderName = [string][char]0x9898 + [string][char]0x5e93
$vault = Join-Path "D:\obrepo\papers" $qbankFolderName
$output = Join-Path $projectRoot "output"
$tool = Join-Path $projectRoot "obsidian_question_bank\bank_tool.py"

if (-not (Test-Path $pythonExe)) {
    Write-Host "Anaconda Python not found:"
    Write-Host $pythonExe
    exit 1
}

if (-not (Test-Path $tool)) {
    Write-Host "bank_tool.py not found:"
    Write-Host $tool
    exit 1
}

if (-not (Test-Path $output)) {
    Write-Host "output folder not found:"
    Write-Host $output
    exit 1
}

& $pythonExe $tool --vault $vault import --from $output
Write-Host "Imported to:"
Write-Host $vault
