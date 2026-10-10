# Run in Joe's existing unlocked Bitwarden PowerShell. No deployment/provider I/O.
[CmdletBinding()]
param([switch]$RentalVerification)
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue';Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
$raw=$null;$record=$null;$field=$null;$payload=$null
try {
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or (($raw -join "`n")|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder unavailable'}
 $folders=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder ambiguous'}
 $raw=& $bw list items --search 'Vega Dev - Supabase' --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record unavailable'}
 $records=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object {$_.name -ceq 'Vega Dev - Supabase' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate})
 if($records.Count -ne 1){throw 'Record ambiguous'}
 $record=$records[0];$field=@($record.fields|Where-Object name -CEQ 'APP_DATABASE_URL')
 if($field.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$field[0].value)){throw 'Field unavailable'}
 $payload=@{appDatabaseUrl=[string]$field[0].value}|ConvertTo-Json -Compress
 $node='C:/Users/Joe Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 $runner=if($RentalVerification){'verify-vod-rental-postgres-private.mjs'}else{'verify-l6-s8a-postgres-private.mjs'}
 $payload|& $node (Join-Path $PSScriptRoot $runner) 2>$null
 if($LASTEXITCODE -ne 0){throw 'Proof stopped'}
 Write-Host 'Tell Astra done. No provider calls, deployment, or committed business changes.'
}catch{Write-Host 'L6-S8A database verification stopped. No secret details printed. Tell Astra.'}
finally{$raw=$null;$record=$null;$records=$null;$field=$null;$payload=$null;$env:BITWARDENCLI_DEBUG=$priorDebug}
