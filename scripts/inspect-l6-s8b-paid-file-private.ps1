# Run only in Joe's unlocked private Bitwarden PowerShell.
# One read-only GET for the recorded file. No upload, binding or payment mutations.
# New disposable asset remains for the paid-placement proof and eventual cleanup.
# Never prints credentials or raw provider responses. Do not rerun after an attempt.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$stage='private vault session'
try {
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $stage='approved folder'
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
 $decoded=ConvertFrom-Json -InputObject ($raw -join "`n")
 $folders=@($decoded|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder not unique'}
 $stage='approved record'
 $raw=& $bw list items --search 'ScaleEngine' --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record lookup failed'}
 $decoded=ConvertFrom-Json -InputObject ($raw -join "`n")
 $records=@($decoded|Where-Object { $_.name -ceq 'ScaleEngine' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate })
 if($records.Count -ne 1){throw 'Record not unique'}
 $record=$records[0]; $values=@{}
 foreach($label in @('CDN ID','API Secret Key')){
   $stage='required field: '+$label
   $matches=@($record.fields|Where-Object name -CEQ $label)
   if($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$matches[0].value)){throw 'Required field unavailable'}
   $values[$label]=[string]$matches[0].value
 }
 $payload=@{cdnId=$values['CDN ID'];apiSecret=$values['API Secret Key']}|ConvertTo-Json -Compress
 $stage='read-only exact file inspection'
 $node='C:/Users/Joe Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 $payload | & $node (Join-Path $PSScriptRoot 'inspect-l6-s8b-paid-file-private.mjs') 2>$null
 if($LASTEXITCODE -ne 0){throw 'Runner stopped'}
} catch {
 Write-Host ('Paid-media upload stopped at: '+$stage+'. No secret details printed. Review saved evidence before any retry.')
} finally {
 $raw=$null; $decoded=$null; $record=$null; $records=$null; $values=$null; $matches=$null; $databaseRecords=$null; $dbFields=$null; $payload=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug
}


