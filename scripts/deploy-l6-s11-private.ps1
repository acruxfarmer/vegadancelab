# Shelly's existing unlocked Bitwarden PowerShell. Pinned Development only.
# Exact S11 source deployment; no OAuth exchange, playback, or provider calls.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RuntimeCommit,[switch]$InspectOnly)
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue';Set-PSDebug -Off
if($RuntimeCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'Exact S11 Development commit required'}
$serviceId='srv-dao5cjbm8hqs73db51j0';$base='https://api.render.com/v1/services/'+$serviceId
$prefix='l6-s11-'+$RuntimeCommit
$receiptPath=Join-Path $PSScriptRoot ('../docs/layer-6/'+$prefix+'-deployment.local.json')
$marker=Join-Path $PSScriptRoot ('../docs/layer-6/'+$prefix+'-attempted.local.json')
if($InspectOnly){$receiptPath=Join-Path $PSScriptRoot ('../docs/layer-6/'+$prefix+'-inspection.local.json')}
if(-not $InspectOnly -and (Test-Path -LiteralPath $marker)){Write-Host 'Prior deployment attempt exists. Receipt preserved; request inspection before retry.';return}
$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
$receipt=[ordered]@{runtimeCommit=$RuntimeCommit;serviceId=$serviceId;status='preflight';stage='private session';inspectOnly=[bool]$InspectOnly;settingsUpdated=@();settingMutationAttempted=$false;deployAttempted=$false;deployId=$null;providerCalls=0;productionUntouched=$true;secretValuesInReceipt=$false}
$headers=$null
function Save-Receipt {$receipt|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $receiptPath -Encoding utf8}
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
 if($fields.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$fields[0].value)){throw 'Required field unavailable'}
 return [string]$fields[0].value
}
function Environment-Map {
 $map=@{};$rows=@(Api ($base+'/env-vars?limit=100'))
 if($rows.Count -ge 100){throw 'Environment pagination requires inspection'}
 foreach($row in $rows){$key=[string]$row.envVar.key;if(-not $key -or $map.ContainsKey($key)){throw 'Ambiguous setting'};$map[$key]=[string]$row.envVar.value}
 return $map
}
function Safety($map){
 foreach($pair in @(@('VEGA_ENV','development'),@('VEGA_EXTERNAL_EFFECTS','disabled'),@('VEGA_NATIVE_MEDIA_ENABLED','true'),@('VEGA_SANDBOX_PAYMENT_EXECUTION','disabled'),@('VEGA_PAYMENT_ATTEMPT_PREPARATION','disabled'),@('VEGA_SANDBOX_REFUND_EXECUTION','disabled'),@('VEGA_REFUND_PROGRAM_EXECUTION','disabled'),@('VEGA_RENTAL_VERIFICATION','disabled'))){if($map[$pair[0]] -cne $pair[1]){throw 'Disabled controls not confirmed'}}
 if($map['VEGA_MEDIA_CONNECTION_KEY'] -cnotmatch '^[a-f0-9]{64}$' -or $map['VIMEO_CLIENT_ID'] -cne (Field $vimeo 'VIMEO_CLIENT_ID') -or $map['VIMEO_CLIENT_SECRET'] -cne (Field $vimeo 'VIMEO_CLIENT_SECRET')){throw 'Provisioned Vimeo settings mismatch'}
 # Both providers configured; preserve the existing connection control and encryption key.
 if($map['VEGA_MEDIA_CONNECTIONS_ENABLED'] -cne 'true'){throw 'Existing connection control changed'}
 foreach($key in @('YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET')){if($map[$key] -cne (Field $youtube $key)){throw 'Provisioned YouTube settings mismatch'}}
}
function Application-Safety {
 $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 30 -MaximumRedirection 0
 if($config.environment -cne 'development' -or $config.squareEnabled -cne $false -or $config.paymentMode -cne 'disabled' -or $config.externalEffects -cne 'disabled'){throw 'Application safety mismatch'}
}
try {
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or (($raw -join "`n")|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder unavailable'}
 $folders=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder ambiguous'};$folder=$folders[0]
 $operator=Record 'Vega Dev - Render Operator';$headers=@{Authorization='Bearer '+(Field $operator 'RENDER_API_KEY')};$vimeo=Record 'Vega Dev - Vimeo';$youtube=Record 'Acrux Dev - YouTube'
 $receipt.stage='pinned Development service'
 $service=Api $base
 if($service.id -cne $serviceId -or $service.name -cne 'vega-development-web' -or $service.type -cne 'web_service' -or $service.ownerId -cne 'tea-dand3tajnfac7387vm30' -or $service.environmentId -cne 'evm-dao55pijnfac73akca10' -or $service.repo.TrimEnd('/') -cnotin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git') -or $service.serviceDetails.envSpecificDetails.startCommand -cne 'node scripts/start-web.mjs'){throw 'Service identity mismatch'}
 $receipt.stage='provisioned settings and disabled controls'
 $before=Environment-Map;Safety $before;Application-Safety
 $deploys=@(Api ($base+'/deploys?limit=20'))
 $active=@($deploys|Where-Object {$_.deploy.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')})
 $live=@($deploys|Where-Object {$_.deploy.status -ceq 'live'})
 if($InspectOnly){
  $receipt.autoDeploy=$service.autoDeploy;$receipt.connectionControl=$before['VEGA_MEDIA_CONNECTIONS_ENABLED'];$receipt.activeDeploymentCount=$active.Count
  $receipt.deployments=@($deploys|ForEach-Object {[ordered]@{id=$_.deploy.id;status=$_.deploy.status;commit=$_.deploy.commit.id}})
  $receipt.status='inspected';$receipt.stage='complete'
 }else{
  if($active.Count -or $live.Count -ne 1 -or $live[0].deploy.id -cne 'dep-db7aelvavr4c73ff9he0' -or $live[0].deploy.commit.id -cne '5d6babf10bbdf622602dc01ef91dd0b323f72c13'){throw 'Live checkpoint changed'}
  if($before['VEGA_MEDIA_CONNECTIONS_ENABLED'] -cne 'true'){throw 'Connection control changed'}
  if($service.autoDeploy -cne 'no'){throw 'Automatic deployment must already be disabled'}
  $receipt.stage='saved restricted-role evidence'
  $proof=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/layer-6/l6-s11-postgres.local.json') -Raw|ConvertFrom-Json
  if($proof.status -cne 'passed' -or $proof.baselineRestored -ne $true -or $proof.providerCalls -ne 0 -or $proof.committedFixtureWrites -ne 0){throw 'Restricted-role evidence mismatch'}
  $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"attempted":true}');$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)}finally{$lock.Dispose()}
  $receipt.stage='single library setting'
  if($before['VEGA_MEDIA_LIBRARY_ENABLED'] -cne 'true'){
   $receipt.settingMutationAttempted=$true;Save-Receipt
   $null=Api ($base+'/env-vars/VEGA_MEDIA_LIBRARY_ENABLED') 'PUT' @{value='true'}
   $receipt.settingsUpdated=@('VEGA_MEDIA_LIBRARY_ENABLED')
  }
  $after=Environment-Map;Safety $after
  if($after['VEGA_MEDIA_LIBRARY_ENABLED'] -cne 'true'){throw 'Library setting mismatch'}
  foreach($key in $before.Keys){if($key -cne 'VEGA_MEDIA_LIBRARY_ENABLED' -and $after[$key] -cne $before[$key]){throw 'Unrelated setting changed'}}
  $expectedCount=$before.Count;if(-not $before.ContainsKey('VEGA_MEDIA_LIBRARY_ENABLED')){$expectedCount++}
  if($after.Count -ne $expectedCount){throw 'Unexpected setting count'}
  $receipt.unrelatedSettingsUnchanged=$true
  $recent=@(Api ($base+'/deploys?limit=20'))
  if(@($recent|Where-Object {$_.deploy.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')}).Count){throw 'Deployment started unexpectedly; inspect before continuing'}
  $receipt.stage='exact Development source deployment';$receipt.deployAttempted=$true;Save-Receipt
  $deploy=Api ($base+'/deploys') 'POST' @{commitId=$RuntimeCommit;clearCache='do_not_clear'}
  if($deploy.id -cnotmatch '^dep-[a-z0-9]+$'){throw 'Deployment identity unavailable'}
  $receipt.deployId=$deploy.id;Save-Receipt
  $deadline=[datetimeoffset]::UtcNow.AddMinutes(8)
  do {
   $deploy=Api ($base+'/deploys/'+$receipt.deployId)
   if($deploy.id -cne $receipt.deployId -or $deploy.commit.id -cne $RuntimeCommit){throw 'Deployment identity mismatch'}
   $receipt.status=[string]$deploy.status;Save-Receipt
   if($deploy.status -ceq 'live'){break}
   if($deploy.status -cnotin @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')){throw 'Deployment failed'}
   Start-Sleep -Seconds 10
  }while([datetimeoffset]::UtcNow -lt $deadline)
  if($deploy.status -cne 'live'){throw 'Deployment check deadline'}
  $receipt.stage='hosted health and disabled controls'
  $health=Invoke-RestMethod 'https://vega-development-web.onrender.com/health/application' -TimeoutSec 30 -MaximumRedirection 0
  if($health.status -cne 'application_runtime_ready' -or $health.environment -cne 'development' -or $health.squareEnabled -cne $false){throw 'Hosted health mismatch'}
  Application-Safety;$final=Environment-Map;Safety $final
  foreach($key in $after.Keys){if($final[$key] -cne $after[$key]){throw 'Setting changed during deployment'}}
  if($final.Count -ne $after.Count){throw 'Setting count changed during deployment'}
  $receipt.status='live-awaiting-s11-hosted-verification';$receipt.stage='complete';$receipt.disabledControlsConfirmed=$true;$receipt.unrelatedSettingsUnchanged=$true;$receipt.connectionSettingsPreserved=$true
 }
}catch{$receipt.status='stopped-inspect-before-retry'}finally{
 $raw=$null;$folders=$null;$folder=$null;$operator=$null;$vimeo=$null;$youtube=$null;$headers=$null;$before=$null;$after=$null;$final=$null;$service=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug;$receipt.checkedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
}
if($receipt.status -ceq 'live-awaiting-s11-hosted-verification'){Write-Host 'S11 Development library live; hosted owner and member verification pending. Rental/payment controls remain disabled.'}
elseif($receipt.status -ceq 'inspected'){Write-Host 'S11 deployment inspection saved. No settings or deployment changed.'}
else{Write-Host ('S11 deployment stopped at: '+$receipt.stage+'. Tell Astra; do not rerun deployment.')}



