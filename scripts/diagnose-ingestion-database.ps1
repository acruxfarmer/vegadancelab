# Read-only database diagnosis; no vault edits, role activation, or provider changes.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'; $VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$stage='Bitwarden unlocked status'
try {
    $raw=& bw status --nointeraction 2>$null
    if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -ne 'unlocked'){throw 'Unlock required'}
    $stage='Bitwarden sync'
    $null=& bw sync --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Sync failed'}
    $stage='Dev Stack database records'
    $raw=& bw list folders --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
    $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
    if($folders.Count -ne 1){throw 'Folder not unique'}
    $raw=& bw list items --folderid $folders[0].id --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Item lookup failed'}
    $items=@(($raw|ConvertFrom-Json)|Where-Object { $_.folderId -eq $folders[0].id -and -not $_.deletedDate })
    $runtime=@($items|Where-Object name -CEQ 'Vega Dev - Supabase')
    if($runtime.Count -ne 1 -or $runtime[0].type -ne 2){throw 'Record not unique secure note'}
    $stage='Vega Dev - Supabase / DATABASE_URL'
    $database=@($runtime[0].fields|Where-Object name -CEQ 'DATABASE_URL')
    if($database.Count -ne 1 -or -not $database[0].value){throw 'Missing or duplicate field'}
    $stage='read-only restricted connection diagnostic'
    $node=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $payload=@{databaseUrl=$database[0].value}|ConvertTo-Json -Compress
    $result=$payload|& $node (Join-Path $PSScriptRoot 'diagnose-ingestion-database.mjs') 2>$null
    $report=($result|Out-String)|ConvertFrom-Json
    $report|ConvertTo-Json -Depth 6
}catch{Write-Host ('Stopped at: '+$stage+'. No secret values displayed or credentials changed.')}
finally{$env:BITWARDENCLI_DEBUG=$priorDebug;$raw=$null;$items=$null;$runtime=$null;$database=$null;$payload=$null}
