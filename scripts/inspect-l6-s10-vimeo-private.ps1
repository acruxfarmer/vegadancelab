# Run in Shelly's existing unlocked Bitwarden PowerShell.
# Reads only the designated vault item. No provider requests or deployment.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$receipt=[ordered]@{status='stopped';stage='private session';provider='vimeo';record='Vega Dev - Vimeo';requiredFieldsPresent=$false;providerCalls=0;deployments=0;settingsChanged=$false;secretValuesPersisted=$false}
try {
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or (($raw -join "`n")|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $receipt.stage='Dev Stack folder'
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder unavailable'}
 $folders=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder ambiguous'}
 $receipt.stage='Vimeo application record'
 $raw=& $bw list items --search 'Vega Dev - Vimeo' --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record unavailable'}
 $records=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object {$_.name -ceq 'Vega Dev - Vimeo' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate})
 if($records.Count -ne 1){throw 'Record ambiguous'}
 foreach($name in @('VIMEO_CLIENT_ID','VIMEO_CLIENT_SECRET')){
  $receipt.stage='required field: '+$name
  $fields=@($records[0].fields|Where-Object name -CEQ $name)
  if($fields.Count -ne 1 -or $fields[0].type -ne 1){throw 'Hidden field required'}
  $value=[string]$fields[0].value
  if([string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 8192 -or $value -match '[\s\x00-\x1f]'){throw 'Field invalid'}
 }
 $receipt.requiredFieldsPresent=$true
 $receipt.stage='complete'; $receipt.status='ready-for-private-provisioning'
} catch {
 # Exception text and command output can contain secrets; never emit either.
 $receipt.status='stopped'
} finally {
 $raw=$null; $records=$null; $fields=$null; $value=$null; $folders=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug
 $receipt.checkedAt=[DateTime]::UtcNow.ToString('o')
 $receipt|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/layer-6/l6-s10-vimeo-vault.local.json') -Encoding utf8
}
if($receipt.status -ceq 'ready-for-private-provisioning'){Write-Host 'S10 Vimeo vault readiness passed. No provider calls or deployment.'}
else{Write-Host ('S10 Vimeo vault readiness stopped at: '+$receipt.stage)}
