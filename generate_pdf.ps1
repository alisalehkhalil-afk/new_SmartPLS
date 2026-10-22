param (
    [string]$SurveyId = "101",
    [string]$OutputFile = ""
)

$edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
    $edgePath = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
}

if (-not (Test-Path $edgePath)) {
    Write-Output "ERROR: Edge not found"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $OutputFile = "F:\Software Reuse\Test_Soft\new SmartPLS\public\reports_archive\report_$SurveyId.pdf"
}

$url = "http://localhost:3000/report.html?surveyId=$SurveyId"
$pdfArg = "--print-to-pdf=`"$OutputFile`""

Start-Process -FilePath $edgePath -ArgumentList "--headless", "--disable-gpu", "--run-all-compositor-stages-before-draw", $pdfArg, $url -Wait -NoNewWindow

if (Test-Path $OutputFile) {
    $size = (Get-Item $OutputFile).Length
    Write-Output "SUCCESS: $OutputFile ($size bytes)"
    exit 0
} else {
    Write-Output "ERROR: Failed to generate PDF"
    exit 1
}
