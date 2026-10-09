# Run in Joe's existing unlocked Bitwarden PowerShell. Development only.
# Installs three server-only settings and deploys the exact reviewed runtime.
# Then creates one approved temporary ALL placement through the existing services.
# No ScaleEngine requests, tickets, uploads, or Production changes.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$commit='ce63723bab8d7961371b9ccf49d8121e57587883'
$serviceId='srv-dao5cjbm8hqs73db51j0'
$base='https://api.render.com/v1/services/'+$serviceId
$receiptPath=Join-Path $PSScriptRoot '../docs/layer-6/l6-s5-hosted-deployment.local.json'
$marker=Join-Path $PSScriptRoot '../docs/layer-6/l6-s5-hosted-deployment-attempted.local.json'
$receipt=[ordered]@{runtimeCommit=$commit;serviceId=$serviceId;status='preflight';stage='private session';environment='development';settingsUpdated=@();deployAttempted=$false;deployId=$null;productionUntouched=$true;providerRequests=0;secretsPersisted=$false}
$headers=$null; $values=@{}; $acquired=$false
function Save-Receipt { $receipt|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $receiptPath -Encoding utf8 }
function Api([string]$url,[string]$method='GET',$body=$null){
 $requestOptions=@{Uri=$url;Method=$method;Headers=$headers;TimeoutSec=30;MaximumRedirection=0;ErrorAction='Stop'}
 if($null -ne $body){$requestOptions.ContentType='application/json';$requestOptions.Body=($body|ConvertTo-Json -Compress)}
 Invoke-RestMethod @requestOptions
}
function Field($record,[string]$name){
 $f=@($record.fields|Where-Object name -CEQ $name)
 if($f.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$f[0].value) -or ([string]$f[0].value).Trim() -cne [string]$f[0].value){throw 'Required field invalid'}
 return [string]$f[0].value
}
function Record([string]$name){
 $raw=& $bw list items --search $name --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record unavailable'}
 $r=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object {$_.name -ceq $name -and $_.folderId -ceq $folder.id -and -not $_.deletedDate})
 if($r.Count -ne 1){throw 'Record ambiguous'}
 return $r[0]
}
try {
 if(Test-Path -LiteralPath $marker){throw 'Prior attempt requires reconciliation'}
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or (($raw -join "`n")|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private session unavailable'}
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder unavailable'}
 $folders=@((($raw -join "`n")|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder ambiguous'}
 $folder=$folders[0]
 $receipt.stage='existing credentials'
 $operator=Record 'Vega Dev - Render Operator'
 $headers=@{Authorization='Bearer '+(Field $operator 'RENDER_API_KEY')}
 $scale=Record 'ScaleEngine'
 $values['SCALEENGINE_CDN_ID']=Field $scale 'CDN ID'
 $values['SCALEENGINE_API_SECRET']=Field $scale 'API Secret Key'
 $values['VEGA_NATIVE_MEDIA_ENABLED']='true'
 $database=Record 'Vega Dev - Supabase'
 $appDatabaseUrl=Field $database 'APP_DATABASE_URL'
 if($values['SCALEENGINE_CDN_ID'] -cnotmatch '^\d+$'){throw 'CDN field invalid'}
 $receipt.stage='Development service identity'
 $service=Api $base
 if($service.id -cne $serviceId -or $service.name -cne 'vega-development-web' -or $service.type -cne 'web_service' -or $service.ownerId -cne 'tea-dand3tajnfac7387vm30' -or $service.environmentId -cne 'evm-dao55pijnfac73akca10' -or $service.repo.TrimEnd('/') -cnotin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git') -or $service.branch -cne 'product/layer3-public-entry' -or $service.serviceDetails.envSpecificDetails.startCommand -cne 'node scripts/start-web.mjs'){throw 'Service mismatch'}
 $receipt.stage='existing Development safety settings'
 $envVars=@(Api ($base+'/env-vars?limit=100'))
 foreach($pair in @(@('VEGA_ENV','development'),@('VEGA_EXTERNAL_EFFECTS','disabled'))){
  $v=@($envVars|Where-Object {$_.envVar.key -ceq $pair[0]})
  if($v.Count -ne 1 -or $v[0].envVar.value -cne $pair[1]){throw 'Environment mismatch'}
 }
 $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 30 -MaximumRedirection 0
 if($config.environment -cne 'development' -or $config.squareEnabled -cne $false -or $config.externalEffects -cne 'disabled' -or $config.paymentMode -cne 'disabled'){throw 'Execution gate mismatch'}
 $active=@((Api ($base+'/deploys?limit=20'))|Where-Object {$_.deploy.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')})
 if($active.Count){throw 'Wait for existing deployment before private setup'}
 # A crash or uncertain outcome must be reconciled; never blindly redeploy.
 $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"attempted":true}');$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)}finally{$lock.Dispose()}
 $acquired=$true;Save-Receipt
 $receipt.stage='server-only native media settings'
 foreach($name in @('SCALEENGINE_CDN_ID','SCALEENGINE_API_SECRET','VEGA_NATIVE_MEDIA_ENABLED')){
  $null=Api ($base+'/env-vars/'+$name) 'PUT' @{value=$values[$name]}
  $receipt.settingsUpdated+= $name;Save-Receipt
 }
 $receipt.stage='exact runtime deployment';$receipt.deployAttempted=$true;Save-Receipt
 $deploy=Api ($base+'/deploys') 'POST' @{commitId=$commit;clearCache='do_not_clear'}
 if($deploy.id -cnotmatch '^dep-[a-z0-9]+$'){throw 'Deployment identity unavailable'}
 $receipt.deployId=$deploy.id;Save-Receipt
 $deadline=[datetimeoffset]::UtcNow.AddMinutes(8)
 do {
  $deploy=Api ($base+'/deploys/'+$receipt.deployId)
  if($deploy.id -cne $receipt.deployId -or $deploy.commit.id -cne $commit){throw 'Deployment identity mismatch'}
  $receipt.status=[string]$deploy.status;Save-Receipt
  if($deploy.status -eq 'live'){break}
  if($deploy.status -notin @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')){throw 'Deployment did not become live'}
  Start-Sleep -Seconds 10
 } while([datetimeoffset]::UtcNow -lt $deadline)
 if($deploy.status -ne 'live'){throw 'Deployment check deadline'}
 $receipt.stage='hosted application health'
 $health=Invoke-RestMethod 'https://vega-development-web.onrender.com/health/application' -TimeoutSec 30 -MaximumRedirection 0
 if($health.status -cne 'application_runtime_ready' -or $health.environment -cne 'development' -or $health.squareEnabled -cne $false){throw 'Runtime health mismatch'}
 $receipt.stage='temporary ALL placement';Save-Receipt
 $payload=@{appDatabaseUrl=$appDatabaseUrl}|ConvertTo-Json -Compress
 $node='C:/Users/Joe Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 $payload | & $node (Join-Path $PSScriptRoot 'prepare-l6-s5-hosted-placement-private.mjs') 2>$null
 if($LASTEXITCODE -ne 0){throw 'Placement preparation stopped'}
 $receipt.status='live-awaiting-browser-proof';$receipt.stage='complete';Save-Receipt
 Write-Host 'Development deployment ready. Tell Astra done. No playback or provider request was made.'
} catch {
 if($acquired){$receipt.status='stopped-reconcile-before-retry';Save-Receipt}
 Write-Host ('Stopped at: '+$receipt.stage+'. No secret details printed. Tell Astra; do not rerun after a deployment attempt.')
} finally {
 $raw=$null;$folders=$null;$folder=$null;$operator=$null;$scale=$null;$headers=$null;$values=$null;$envVars=$null;$v=$null;$database=$null;$appDatabaseUrl=$null;$payload=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug
}
