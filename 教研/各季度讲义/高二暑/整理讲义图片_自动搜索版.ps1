param(
    [Parameter(Mandatory = $true)]
    [string]$MarkdownPath,

    [Parameter(Mandatory = $false)]
    [string]$RootFolder = "."
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $MarkdownPath -PathType Leaf)) {
    Write-Host "Markdown file not found: $MarkdownPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $RootFolder -PathType Container)) {
    Write-Host "Root folder not found: $RootFolder" -ForegroundColor Red
    exit 1
}

$mdFile = Get-Item -LiteralPath $MarkdownPath
$root = (Resolve-Path -LiteralPath $RootFolder).Path
$lectureName = [System.IO.Path]::GetFileNameWithoutExtension($mdFile.Name)

$baseName = $lectureName
$baseName = $baseName -replace '_知识点$', ''
$baseName = $baseName -replace '（知识点）$', ''
$baseName = $baseName -replace '\(知识点\)$', ''

$outputFolder = Join-Path $mdFile.DirectoryName ($lectureName + "_PPT")
$imageFolder = Join-Path $outputFolder "images"
New-Item -ItemType Directory -Path $imageFolder -Force | Out-Null

$content = Get-Content -LiteralPath $MarkdownPath -Raw -Encoding UTF8
$pattern = '!\[\[([^\]\|]+\.(?:png|jpg|jpeg|webp|gif|svg|bmp))(?:\|[^\]]*)?\]\]'

$matches = [regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$imageReferences = @($matches | ForEach-Object { $_.Groups[1].Value.Trim() } | Sort-Object -Unique)

if ($imageReferences.Count -eq 0) {
    Write-Host "No image references found in this Markdown file." -ForegroundColor Yellow
    exit 0
}

$preferredFolders = @()
$lectureFolders = Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -like "$baseName*_files" }
$preferredFolders += $lectureFolders

$attachmentsFolder = Join-Path $root "attachments"
if (Test-Path -LiteralPath $attachmentsFolder -PathType Container) {
    $preferredFolders += Get-Item -LiteralPath $attachmentsFolder
}

$otherFolders = Get-ChildItem -LiteralPath $root -Directory | Where-Object {
    $_.FullName -ne $outputFolder -and
    $_.Name -notlike "*_PPT" -and
    $_.Name -notlike "*_PPT素材" -and
    $_.Name -ne "attachments" -and
    $_.Name -notlike "$baseName*_files"
}

$searchFolders = @($preferredFolders + $otherFolders)

Write-Host "Search order:" -ForegroundColor Cyan
foreach ($folder in $searchFolders) {
    Write-Host "  $($folder.FullName)" -ForegroundColor DarkGray
}

$fileIndex = @{}
foreach ($folder in $searchFolders) {
    $files = Get-ChildItem -LiteralPath $folder.FullName -File -Recurse -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $key = $file.Name.ToLowerInvariant()
        if (-not $fileIndex.ContainsKey($key)) { $fileIndex[$key] = @() }
        $fileIndex[$key] += $file
    }
}

$copiedCount = 0
$missingFiles = @()
$duplicateFiles = @()
$chosenSources = @()

foreach ($reference in $imageReferences) {
    $fileName = [System.IO.Path]::GetFileName($reference.Replace("/", "\"))
    $key = $fileName.ToLowerInvariant()

    if (-not $fileIndex.ContainsKey($key)) {
        $missingFiles += $reference
        Write-Host "Missing: $reference" -ForegroundColor Red
        continue
    }

    $candidates = @($fileIndex[$key])
    if ($candidates.Count -gt 1) {
        $duplicateFiles += $reference
        Write-Host "Duplicate filename found; using highest-priority match: $reference" -ForegroundColor Yellow
    }

    $sourceFile = $candidates[0]
    $destination = Join-Path $imageFolder $fileName
    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination -Force

    $copiedCount++
    $chosenSources += "$fileName <- $($sourceFile.FullName)"
    Write-Host "Copied: $fileName" -ForegroundColor Green
}

$newContent = [regex]::Replace(
    $content,
    $pattern,
    {
        param($match)
        $reference = $match.Groups[1].Value.Trim()
        $fileName = [System.IO.Path]::GetFileName($reference.Replace("/", "\"))
        return "![](images/$fileName)"
    },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

$newMarkdownPath = Join-Path $outputFolder $mdFile.Name
Set-Content -LiteralPath $newMarkdownPath -Value $newContent -Encoding UTF8

$reportPath = Join-Path $outputFolder "report.txt"
$reportLines = @(
    "Markdown: $($mdFile.Name)",
    "Images referenced: $($imageReferences.Count)",
    "Images copied: $copiedCount",
    "Missing: $($missingFiles.Count)",
    "Duplicate filenames: $($duplicateFiles.Count)",
    "",
    "Chosen sources:"
)
$reportLines += $chosenSources
$reportLines += ""
$reportLines += "Missing files:"
$reportLines += $missingFiles
$reportLines += ""
$reportLines += "Duplicate filenames:"
$reportLines += $duplicateFiles
Set-Content -LiteralPath $reportPath -Value $reportLines -Encoding UTF8

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "Images referenced: $($imageReferences.Count)"
Write-Host "Images copied: $copiedCount"
Write-Host "Output folder: $outputFolder"
