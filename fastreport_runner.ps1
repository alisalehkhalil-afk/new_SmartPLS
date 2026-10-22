# FastReport Bridge Runner for New_SmartPLS
# Ministry of Finance - Executive IT Unit
param (
    [string]$Action = "version",
    [string]$SurveyId = "101",
    [string]$OutputFile = "report.html"
)

$dllPath = "F:\Software Reuse\Test_Soft\new SmartPLS\FastReport.dll"

if (-not (Test-Path $dllPath)) {
    Write-Output "ERROR: FastReport.dll not found at $dllPath"
    exit 1
}

try {
    $asm = [Reflection.Assembly]::LoadFrom($dllPath)
    $version = $asm.GetName().Version.ToString()
    
    if ($Action -eq "version") {
        Write-Output "FASTREPORT_READY: Version $version successfully loaded."
        exit 0
    }

    # Create FastReport report instance
    $reportType = $asm.GetType("FastReport.Report")
    if ($reportType -ne $null) {
        $report = [Activator]::CreateInstance($reportType)
        Write-Output "FASTREPORT_INSTANCE: Report engine initialized successfully."
    } else {
        Write-Output "FASTREPORT_LOADED: Assembly loaded ($version)."
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
    exit 1
}
