$ErrorActionPreference = "Stop"

$port = 1420

function Get-ListeningPid([int]$TargetPort) {
    $netstatLines = cmd /c "netstat -ano | findstr LISTENING | findstr :$TargetPort" 2>$null
    if (-not $netstatLines) {
        return $null
    }

    foreach ($line in $netstatLines) {
        if ($line -match "LISTENING\s+(\d+)\s*$") {
            return [int]$Matches[1]
        }
    }

    return $null
}

function Get-ProcessCommandLine([int]$ProcessId) {
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
    } catch {
        return $null
    }
}

function Test-HealthyViteServer([int]$TargetPort) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

$existingPid = Get-ListeningPid -TargetPort $port
if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    $commandLine = Get-ProcessCommandLine -ProcessId $existingPid
    $looksLikeVite = $existingProcess -and (
        $existingProcess.ProcessName -match "node|bun|vite" -or
        $commandLine -match "vite"
    )

    if ($looksLikeVite -and (Test-HealthyViteServer -TargetPort $port)) {
        Write-Host "Port $port is already served by an active Vite process (PID $existingPid). Reusing it."
        exit 0
    }

    Write-Host "Port $port is already in use by PID $existingPid. Stopping it before launching Vite..."
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# Kill any stale vocaltype instance to avoid single-instance blocking the new dev session
$stale = Get-Process -Name "vocaltype" -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "Stopping stale vocaltype instance(s)..."
    $stale | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

$viteArgs = @("run", "dev", "--", "--strictPort")
& bun @viteArgs
exit $LASTEXITCODE
