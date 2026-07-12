param(
    [Parameter(Mandatory = $true)]
    [string]$MarkdownPath,

    [Parameter(Mandatory = $true)]
    [string]$AttachmentFolder
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $MarkdownPath -PathType Leaf)) {
    Write-Host "Markdown file not found: $MarkdownPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $AttachmentFolder -PathType Container)) {
    Write-Host "Attachment folder not found: $AttachmentFolder" -ForegroundColor Red
    exit 1
}

$mdFile = Get-Item -LiteralPath $MarkdownPath
$lectureName = [System.IO.Path]::GetFileNameWithoutExtension($mdFile.Name)

$outputFolder = Join-Path $mdFile.DirectoryName ($lectureName + "_PPT")
$imageFolder = Join-Path $outputFolder "images"

New-Item -ItemType Directory -Path $imageFolder -Force | Out-Null

$content = Get-Content -LiteralPath $MarkdownPath -Raw -Encoding UTF8

$pattern = '!\[\[([^\]\|]+\.(?:png|jpg|jpeg|webp|gif|svg|bmp))(?:\|[^\]]*)?\]\]'

$matches = [regex]::Matches(
    $content,
    $pattern,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

$imageReferences = @(
    $matches |
    ForEach-Object { $_.Groups[1].Value.Trim() } |
    Sort-Object -Unique
)

if ($imageReferences.Count -eq 0) {
    Write-Host "No image references found in this Markdown file." -ForegroundColor Yellow
    exit 0
}

Write-Host "Scanning attachment folder..." -ForegroundColor Cyan

$allAttachmentFiles = Get-ChildItem -LiteralPath $AttachmentFolder -File -Recurse

$fileIndex = @{}

foreach ($file in $allAttachmentFiles) {
    $key = $file.Name.ToLowerInvariant()

    if (-not $fileIndex.ContainsKey($key)) {
        $fileIndex[$key] = @()
    }

    $fileIndex[$key] += $file
}

$copiedCount = 0
$missingFiles = @()
$duplicateFiles = @()

foreach ($reference in $imageReferences) {
    $normalizedReference = $reference.Replace("/", "\")
    $fileName = [System.IO.Path]::GetFileName($normalizedReference)
    $key = $fileName.ToLowerInvariant()

    if (-not $fileIndex.ContainsKey($key)) {
        $missingFiles += $reference
        Write-Host "Missing: $reference" -ForegroundColor Red
        continue
    }

    $candidates = @($fileIndex[$key])

    if ($candidates.Count -gt 1) {
        $duplicateFiles += $reference
        Write-Host "Duplicate filename found; using first match: $reference" -ForegroundColor Yellow
        Write-Host "Source: $($candidates[0].FullName)" -ForegroundColor DarkGray
    }

    $sourceFile = $candidates[0]
    $destination = Join-Path $imageFolder $fileName

    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination -Force

    $copiedCount++
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

$reportLines = @()
$reportLines += "Markdown: $($mdFile.Name)"
$reportLines += "Images referenced: $($imageReferences.Count)"
$reportLines += "Images copied: $copiedCount"
$reportLines += "Missing: $($missingFiles.Count)"
$reportLines += "Duplicate filenames: $($duplicateFiles.Count)"
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
