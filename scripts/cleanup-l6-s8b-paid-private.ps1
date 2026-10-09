# Run only in Joe's unlocked private Bitwarden PowerShell.
# Retire the exact refunded fixture and delete its one disposable upload. Preserve financial history.
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
 $stage='existing restricted Development database credential'
 $raw=& $bw list items --search 'Vega Dev - Supabase' --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Database record unavailable'}
 $databaseRecords=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object { $_.name -ceq 'Vega Dev - Supabase' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate })
 if($databaseRecords.Count -ne 1){throw 'Database record not unique'}
 $dbFields=@($databaseRecords[0].fields|Where-Object name -CEQ 'APP_DATABASE_URL')
 if($dbFields.Count -ne 1 -or -not $dbFields[0].value){throw 'Existing runtime URL unavailable'}
 $stage='Development recovery public key'
 $raw=& $bw list items --search 'Vega Dev - Render Operator' --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Operator record unavailable'}
 $operators=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object {$_.name -ceq 'Vega Dev - Render Operator' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate})
 if($operators.Count -ne 1){throw 'Operator not unique'}
 $fields=@($operators[0].fields|Where-Object name -CEQ 'RENDER_API_KEY')
 if($fields.Count -ne 1 -or -not $fields[0].value){throw 'Operator field unavailable'}
 $headers=@{Authorization='Bearer '+[string]$fields[0].value}
 $vars=Invoke-RestMethod -Uri 'https://api.render.com/v1/services/srv-dao5cjbm8hqs73db51j0/env-vars?limit=100' -Headers $headers -MaximumRedirection 0 -TimeoutSec 30
 $keys=@($vars|Where-Object {$_.envVar.key -ceq 'RECEIPT_PUBLIC_KEY'})
 if($keys.Count -ne 1 -or -not $keys[0].envVar.value){throw 'Recovery public key unavailable'}
 $payload=@{cdnId=$values['CDN ID'];apiSecret=$values['API Secret Key'];appDatabaseUrl=[string]$dbFields[0].value;receiptPublicKey=[string]$keys[0].envVar.value}|ConvertTo-Json -Compress
 $stage='bounded refunded-fixture cleanup'
 $node='C:/Users/Joe Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 $payload | & $node (Join-Path $PSScriptRoot 'cleanup-l6-s8b-paid-private.mjs') 2>$null
 if($LASTEXITCODE -ne 0){throw 'Runner stopped'}
} catch {
 Write-Host ('Paid offer preparation stopped at: '+$stage+'. No secret details printed. Review saved evidence before any retry.')
} finally {
 $raw=$null; $decoded=$null; $record=$null; $records=$null; $values=$null; $matches=$null; $databaseRecords=$null; $dbFields=$null; $payload=$null
 $operators=$null;$fields=$null;$headers=$null;$vars=$null;$keys=$null; $env:BITWARDENCLI_DEBUG=$priorDebug
}



