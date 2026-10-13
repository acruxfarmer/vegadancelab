# Shelly's existing unlocked Bitwarden session. Development settings only.
# No deployment, database operation, OAuth exchange, or provider request.
[CmdletBinding()]
param([switch]$InspectOnly)
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$serviceId='srv-dao5cjbm8hqs73db51j0'
$base='https://api.render.com/v1/services/'+$serviceId
$receiptPath=Join-Path $PSScriptRoot '../docs/layer-6/l6-s10-youtube-provisioning.local.json'
$marker=Join-Path $PSScriptRoot '../docs/layer-6/l6-s10-youtube-provisioning-attempted.local.json'
if($InspectOnly){$receiptPath=Join-Path $PSScriptRoot '../docs/layer-6/l6-s10-youtube-provisioning-inspection.local.json'}
if(-not $InspectOnly -and (Test-Path -LiteralPath $marker)){Write-Host 'Prior provisioning attempt exists. Receipt preserved; request inspection before retry.';return}
$receipt=[ordered]@{status='preflight';stage='private session';serviceId=$serviceId;inspectOnly=[bool]$InspectOnly;settingsUpdated=@();mutationAttempted=$false;deployments=0;providerCalls=0;secretValuesInReceipt=$false;productionUntouched=$true}
$headers=$null; $values=@{}
function Save-Receipt {$receipt|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $receiptPath -Encoding utf8}
function Api([string]$url,[string]$method='GET',$body=$null){
 $options=@{Uri=$url;Method=$method;Headers=$headers;TimeoutSec=30;MaximumRedirection=0;ErrorAction='Stop'}
 if($null -ne $body){$options.ContentType='application/json';$options.Body=($body|ConvertTo-Json -Compress)}
 $result=Invoke-RestMethod @options
 if($result -is [array]){foreach($item in $result){Write-Output -NoEnumerate $item}}else{Write-Output -NoEnumerate $result}
}
function Record([string]$name){
 $raw=& $bw list items --search $name --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record unavailable'}
 $records=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object {$_.name -ceq $name -and $_.folderId -ceq $folder.id -and -not $_.deletedDate})
 if($records.Count -ne 1){throw 'Record ambiguous'}
 return $records[0]
}
function Field($record,[string]$name){
 $fields=@($record.fields|Where-Object name -CEQ $name)
 if($fields.Count -ne 1 -or ($name -like 'YOUTUBE_*' -and $fields[0].type -ne 1)){throw 'Field ambiguous'}
 $value=[string]$fields[0].value
 if([string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 8192 -or $value -match '[\s\x00-\x1f]'){throw 'Field invalid'}
 return $value
}
function Environment-Map {
 $map=@{}
 $rows=@(Api ($base+'/env-vars?limit=100'))
 # Never silently accept a truncated or ambiguous environment listing.
 if($rows.Count -ge 100){throw 'Environment pagination requires inspection'}
 foreach($row in $rows){
  $key=[string]$row.envVar.key
  if(-not $key -or $map.ContainsKey($key)){throw 'Environment response invalid'}
  $map[$key]=[string]$row.envVar.value
 }
 return $map
}
function Safety($map){
 foreach($pair in @(@('VEGA_ENV','development'),@('VEGA_EXTERNAL_EFFECTS','disabled'),@('VEGA_SANDBOX_PAYMENT_EXECUTION','disabled'),@('VEGA_PAYMENT_ATTEMPT_PREPARATION','disabled'),@('VEGA_SANDBOX_REFUND_EXECUTION','disabled'),@('VEGA_REFUND_PROGRAM_EXECUTION','disabled'),@('VEGA_RENTAL_VERIFICATION','disabled'))){
  if(-not $map.ContainsKey($pair[0]) -or $map[$pair[0]] -cne $pair[1]){throw 'Disabled controls not confirmed'}
 }
 if($map['VEGA_MEDIA_CONNECTIONS_ENABLED'] -cne 'true'){throw 'Existing connections must remain enabled'}
}
function Live-Checkpoint {
 $deploys=@(Api ($base+'/deploys?limit=20'))
 if(@($deploys|Where-Object {$_.deploy.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')}).Count){throw 'Deployment in progress'}
 $live=@($deploys|Where-Object {$_.deploy.status -ceq 'live'})
 if($live.Count -ne 1 -or $live[0].deploy.id -cne 'dep-db6ov78u01pc73b0fu60' -or $live[0].deploy.commit.id -cne 'd1bc2941487a708fccb150809bf44f57f17d75e3'){throw 'Live checkpoint changed'}
}
try {
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or (($raw -join "`n")|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder unavailable'}
 $folders=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder ambiguous'}
 $folder=$folders[0]
 $receipt.stage='existing private credentials'
 $operator=Record 'Vega Dev - Render Operator'
 $headers=@{Authorization='Bearer '+(Field $operator 'RENDER_API_KEY')}
 $youtube=Record 'Acrux Dev - YouTube'
 foreach($key in @('YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET')){$values[$key]=Field $youtube $key}
 $receipt.stage='pinned Development service'
 $service=Api $base
 if($service.id -cne $serviceId -or $service.name -cne 'vega-development-web' -or $service.type -cne 'web_service' -or $service.ownerId -cne 'tea-dand3tajnfac7387vm30' -or $service.environmentId -cne 'evm-dao55pijnfac73akca10' -or $service.repo.TrimEnd('/') -cnotin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git') -or $service.serviceDetails.envSpecificDetails.startCommand -cne 'node scripts/start-web.mjs'){throw 'Service identity mismatch'}
 $receipt.stage='disabled controls and live checkpoint'
 $before=Environment-Map; Safety $before; Live-Checkpoint
 if($before['VEGA_MEDIA_CONNECTION_KEY'] -cnotmatch '^[a-f0-9]{64}$'){throw 'Existing encryption key required; do not rotate'}
 foreach($key in @('VIMEO_CLIENT_ID','VIMEO_CLIENT_SECRET')){if([string]::IsNullOrWhiteSpace($before[$key])){throw 'Existing Vimeo configuration required'}}
 $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 30 -MaximumRedirection 0
 if($config.environment -cne 'development' -or $config.squareEnabled -cne $false -or $config.paymentMode -cne 'disabled' -or $config.externalEffects -cne 'disabled'){throw 'Application safety mismatch'}
 if($InspectOnly){
  $receipt.matches=[ordered]@{clientId=($before['YOUTUBE_CLIENT_ID'] -ceq $values['YOUTUBE_CLIENT_ID']);clientSecret=($before['YOUTUBE_CLIENT_SECRET'] -ceq $values['YOUTUBE_CLIENT_SECRET']);encryptionKey=($before['VEGA_MEDIA_CONNECTION_KEY'] -cmatch '^[a-f0-9]{64}$');connectionsEnabled=($before['VEGA_MEDIA_CONNECTIONS_ENABLED'] -ceq 'true')}
  $receipt.status='inspected';$receipt.stage='complete'
 }else{
  $receipt.encryptionKey='preserved'
  $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$markerBytes=[Text.Encoding]::UTF8.GetBytes('{"attempted":true}');$lock.Write($markerBytes,0,$markerBytes.Length);$lock.Flush($true)}finally{$lock.Dispose()}
  foreach($key in @('YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET')){
   if($before.ContainsKey($key) -and $before[$key] -ceq $values[$key]){continue}
   $receipt.stage='Development setting: '+$key;$receipt.mutationAttempted=$true;Save-Receipt
   $null=Api ($base+'/env-vars/'+$key) 'PUT' @{value=$values[$key]}
   $receipt.settingsUpdated+=,$key;Save-Receipt
  }
  $receipt.stage='settings readback and unchanged controls'
  $after=Environment-Map;Safety $after;Live-Checkpoint
  foreach($key in $values.Keys){if($after[$key] -cne $values[$key]){throw 'Provisioned setting mismatch'}}
  foreach($key in $before.Keys){if(-not $values.ContainsKey($key) -and (-not $after.ContainsKey($key) -or $after[$key] -cne $before[$key])){throw 'Unrelated setting changed'}}
  foreach($key in $after.Keys){if(-not $before.ContainsKey($key) -and -not $values.ContainsKey($key)){throw 'Unexpected setting added'}}
  $receipt.status='provisioned-awaiting-runtime';$receipt.stage='complete';$receipt.unrelatedSettingsUnchanged=$true
 }
} catch {
 $receipt.status='stopped-inspect-before-retry'
 # Never serialize exception text, request bodies, or environment values.
} finally {
 $raw=$null;$folders=$null;$folder=$null;$operator=$null;$youtube=$null;$values=$null;$headers=$null;$before=$null;$after=$null;$service=$null;$config=$null;$bytes=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug
 $receipt.checkedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
}
if($receipt.status -ceq 'provisioned-awaiting-runtime'){Write-Host 'S10 YouTube Development settings provisioned; existing connections preserved. No deployment or provider calls.'}
elseif($receipt.status -ceq 'inspected'){Write-Host 'S10 YouTube provisioning inspection saved. No changes.'}
else{Write-Host ('S10 YouTube provisioning stopped at: '+$receipt.stage+'. Tell Astra; do not rerun provisioning.')}

