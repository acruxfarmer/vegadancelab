# Run once in the already-unlocked Bitwarden terminal. All secret transport is in memory/stdin.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'; $VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$stage='local release verification'
function Field($Record,[string]$Name,[switch]$Optional) {
    $matched=@($Record.fields|Where-Object name -CEQ $Name)
    if($matched.Count -gt 1){throw 'Duplicate field'}
    if($matched.Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$matched[0].value)){if($Optional){return ''};throw 'Missing field'}
    return [string]$matched[0].value
}
function ExactRecord($Items,[string]$Name){
    $matched=@($Items|Where-Object name -CEQ $Name)
    if($matched.Count -ne 1 -or $matched[0].type -ne 2){throw 'Record not unique secure note'}
    return $matched[0]
}
function Invoke-Handoff($InputRecord){
    $serialized=$InputRecord|ConvertTo-Json -Depth 8 -Compress
    $output=$serialized|& $node (Join-Path $PSScriptRoot 'handoff-operational-application.mjs') 2>$null
    $serialized=$null
    return (($output|Out-String)|ConvertFrom-Json)
}
try {
    $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $node=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $git=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'
    $branch=& $git -C $root branch --show-current 2>$null
    if($LASTEXITCODE -ne 0 -or $branch -cne 'main'){throw 'Main release required'}
    $commit=& $git -C $root rev-parse HEAD 2>$null
    if($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$'){throw 'Missing release'}
    $origin=& $git -C $root remote get-url origin 2>$null
    if($LASTEXITCODE -ne 0 -or $origin.TrimEnd('/') -notin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git','git@github.com:acruxfarmer/vegadancelab.git')){throw 'Unexpected repository'}
    $remote=& $git -C $root ls-remote origin refs/heads/main 2>$null
    if($LASTEXITCODE -ne 0 -or @($remote).Count -ne 1 -or ($remote -split '\s+')[0] -cne $commit){throw 'Release not published'}
    $stage='Bitwarden unlocked status'
    $raw=& bw status --nointeraction 2>$null
    if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -ne 'unlocked'){throw 'Unlock required'}
    $null=& bw sync --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Sync failed'}
    $stage='Dev Stack runtime records'
    $raw=& bw list folders --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
    $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
    if($folders.Count -ne 1){throw 'Folder not unique'}
    $raw=& bw list items --folderid $folders[0].id --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Item lookup failed'}
    $items=@(($raw|ConvertFrom-Json)|Where-Object {$_.folderId -eq $folders[0].id -and -not $_.deletedDate})
    $database=ExactRecord $items 'Vega Dev - Supabase'
    $render=ExactRecord $items 'Vega Dev - Render Operator'
    if((Field $database 'VEGA_NONPRODUCTION_PROJECT_REF') -cne 'cjdoczrxcjynjhgpgqop'){throw 'Wrong database project'}
    $pooler=Field $database 'SUPABASE_POOLER_HOST'
    if($pooler -notmatch '^aws-\d+-us-west-1\.pooler\.supabase\.com$'){throw 'Unexpected pooler'}
    $stage='restricted runtime URL storage'
    $changed=$false
    foreach($entry in @(@{name='APP_DATABASE_URL';role='vega_app_runtime'},@{name='WORKER_DATABASE_URL';role='vega_worker_runtime'})){
        $existing=Field $database $entry.name -Optional
        if(-not $existing){
            $bytes=New-Object byte[] 32
            $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
            try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
            $password=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
            $existing='postgresql://'+$entry.role+'.cjdoczrxcjynjhgpgqop:'+$password+'@'+$pooler+':5432/postgres'
            $field=@($database.fields|Where-Object name -CEQ $entry.name)
            if($field.Count -eq 1){$field[0].value=$existing;$field[0].type=1}
            else{$database.fields=@($database.fields)+@([pscustomobject]@{name=$entry.name;value=$existing;type=1})}
            $changed=$true
        }else{
            # Preserve existing password exactly; hide the field if an earlier entry was visible.
            $field=@($database.fields|Where-Object name -CEQ $entry.name)
            if($field[0].type -ne 1){$field[0].type=1;$changed=$true}
        }
    }
    if($changed){
        $encoded=($database|ConvertTo-Json -Depth 50 -Compress)|& bw encode 2>$null
        if($LASTEXITCODE -ne 0){throw 'Encoding failed'}
        $saved=$encoded|& bw edit item $database.id --nointeraction 2>$null
        if($LASTEXITCODE -ne 0){throw 'Save failed'}
    }
    $raw=& bw get item $database.id --nointeraction 2>$null
    if($LASTEXITCODE -ne 0){throw 'Readback failed'}
    $readback=$raw|ConvertFrom-Json
    if($readback.id -cne $database.id -or $readback.folderId -cne $database.folderId){throw 'Readback identity mismatch'}
    foreach($fieldName in @('APP_DATABASE_URL','WORKER_DATABASE_URL')){
        if((Field $readback $fieldName) -cne (Field $database $fieldName) -or @($readback.fields|Where-Object name -CEQ $fieldName)[0].type -ne 1){throw 'Readback value mismatch'}
    }
    $payload=@{mode='probe';appDatabaseUrl=(Field $readback 'APP_DATABASE_URL');workerDatabaseUrl=(Field $readback 'WORKER_DATABASE_URL');supabaseUrl=(Field $database 'SUPABASE_URL');supabasePublishableKey=(Field $database 'SUPABASE_PUBLISHABLE_KEY');renderApiKey=(Field $render 'RENDER_API_KEY');commit=$commit}
    $stage='restricted runtime and Render identity verification'
    $report=Invoke-Handoff $payload
    if($report.status -eq 'activation_required'){
        $stage='Vega Dev - Supabase Operator / ADMIN_DATABASE_URL for new login activation'
        $operator=ExactRecord $items 'Vega Dev - Supabase Operator'
        $payload.adminDatabaseUrl=Field $operator 'ADMIN_DATABASE_URL'
    }elseif($report.status -ne 'restricted_logins_verified'){
        Write-Host ('Operational handoff incomplete at '+$report.stage+'. No secrets displayed. Saved passwords retained for retry.')
        return
    }
    $stage='protected activation and development deployment'
    $payload.mode='handoff'
    $report=Invoke-Handoff $payload
    $report|ConvertTo-Json -Depth 6
    if($report.status -eq 'operational_deployments_requested'){Write-Host 'Development web and worker deployments requested. Square, ingestion credentials and B2 unchanged.'}
    else{Write-Host 'Operational handoff incomplete. Saved passwords retained; retry never resets an existing database password.'}
}catch{Write-Host ('Stopped at: '+$stage+'. No secret values displayed. Square and B2 unchanged.')}
finally{
    $env:BITWARDENCLI_DEBUG=$priorDebug
    $raw=$null;$items=$null;$database=$null;$render=$null;$operator=$null;$payload=$null;$password=$null;$bytes=$null;$encoded=$null;$saved=$null;$readback=$null;$existing=$null;$field=$null
}
