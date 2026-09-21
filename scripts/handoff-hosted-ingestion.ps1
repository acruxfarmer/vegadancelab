# Run in the already-unlocked Bitwarden terminal. Secrets travel only in memory.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$stage='local prerequisites'
function Field($Record,[string]$Name,[switch]$Optional) {
    $fields=@($Record.fields|Where-Object name -CEQ $Name)
    if($fields.Count -gt 1){throw 'Duplicate field'}
    if($fields.Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$fields[0].value)){if($Optional){return ''};throw 'Missing field'}
    return [string]$fields[0].value
}
try {
    $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $node=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $git=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'
    $commit=& $git -C $root rev-parse HEAD 2>$null
    if($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$'){throw 'Missing release'}
    $remote=& $git -C $root ls-remote origin refs/heads/main 2>$null
    if($LASTEXITCODE -ne 0 -or -not $remote.StartsWith($commit)){throw 'Local release not on remote main'}
    $raw=& bw status --nointeraction 2>$null
    if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -ne 'unlocked'){throw 'Unlock required'}
    $null=& bw sync --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Sync failed'}
    $raw=& bw list folders --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
    $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
    if($folders.Count -ne 1){throw 'Folder not unique'}
    $raw=& bw list items --folderid $folders[0].id --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Items lookup failed'}
    $items=@(($raw|ConvertFrom-Json)|Where-Object { $_.folderId -eq $folders[0].id -and -not $_.deletedDate })
    $records=@{}
    foreach($name in @('Vega Dev - Supabase','Vega Dev - Render Operator','Vega Dev - Square Sandbox')) {
        $stage='Bitwarden item: '+$name
        $matches=@($items|Where-Object name -CEQ $name)
        if($matches.Count -ne 1 -or $matches[0].type -ne 2){throw 'Item not unique secure note'}
        $records[$name]=$matches[0]
    }
    $stage='Vega Dev - Render Operator / RENDER_API_KEY'
    $renderKey=Field $records['Vega Dev - Render Operator'] 'RENDER_API_KEY'
    $stage='Square sandbox webhook configuration'
    $square=$records['Vega Dev - Square Sandbox']
    if((Field $square 'SQUARE_ENVIRONMENT') -cne 'sandbox'){throw 'Wrong environment'}
    $signature=Field $square 'SQUARE_WEBHOOK_SIGNATURE_KEY'
    $notification=Field $square 'SQUARE_WEBHOOK_NOTIFICATION_URL'
    if($notification -cne 'https://vega-development-web.onrender.com/webhooks/square'){throw 'Wrong notification URL'}
    $stage='development database identity'
    $database=$records['Vega Dev - Supabase']
    if((Field $database 'VEGA_NONPRODUCTION_PROJECT_REF') -cne 'cjdoczrxcjynjhgpgqop'){throw 'Wrong project'}
    $pooler=Field $database 'SUPABASE_POOLER_HOST'
    if($pooler -notmatch '^aws-\d+-us-west-1\.pooler\.supabase\.com$'){throw 'Unexpected pooler'}
    $databaseUrl=Field $database 'DATABASE_URL' -Optional
    if(-not $databaseUrl){throw 'Existing restricted DATABASE_URL required'}
    $stage='restricted database and Render handoff'
    $payload=@{databaseUrl=$databaseUrl;renderApiKey=$renderKey;squareSignature=$signature;squareNotificationUrl=$notification;commit=$commit}|ConvertTo-Json -Compress
    $result=$payload|& $node (Join-Path $PSScriptRoot 'handoff-hosted-ingestion.mjs') 2>$null
    $report=($result|Out-String)|ConvertFrom-Json
    if($report.status -eq 'ingestion_deployment_requested'){Write-Host 'Restricted database login verified; Render ingestion deployment requested. Square subscription unchanged. No secrets displayed.'}
    else{Write-Host ('Hosted ingestion incomplete at: '+$report.stage+' ['+($report.codes -join ',')+']. No secrets displayed. Existing login credentials will not be reset on retry.')}
}catch{Write-Host ('Stopped at: '+$stage+'. No secret values displayed. Square and B2 unchanged.')}
finally{$env:BITWARDENCLI_DEBUG=$priorDebug;$raw=$null;$records=$null;$items=$null;$matches=$null;$database=$null;$fields=$null;$existing=$null;$signature=$null;$renderKey=$null;$adminUrl=$null;$databaseUrl=$null;$password=$null;$bytes=$null;$encoded=$null;$saved=$null;$verified=$null;$payload=$null}
