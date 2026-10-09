# Run in Joe's existing unlocked Bitwarden PowerShell. Development only.
# Deploys the reviewed generic commerce runtime using existing Development settings.
# Deployment only; hosted ordinary-path playback is a separate bounded verification.
# No ScaleEngine requests, tickets, uploads, or Production changes.
[CmdletBinding()]
param([switch]$InspectServiceOnly,[switch]$InspectSafetyOnly)
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'; $DebugPreference='SilentlyContinue'; Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG; $env:BITWARDENCLI_DEBUG='false'
$commit='6860adbf7e9e7f50940a420ea7e1a14a32adcf3a'
$serviceId='srv-dao5cjbm8hqs73db51j0'
$base='https://api.render.com/v1/services/'+$serviceId
$receiptPath=Join-Path $PSScriptRoot '../docs/layer-6/l6-s8b-execution-shutdown-deployment.local.json'
$marker=Join-Path $PSScriptRoot '../docs/layer-6/l6-s8b-execution-shutdown-deployment-attempted.local.json'
$inspectionPath=Join-Path $PSScriptRoot '../docs/layer-6/l6-s8b-execution-shutdown-service-inspection.local.json'
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
function Inspect-Service {
 $safe=[ordered]@{method='GET';endpoint=$base;httpStatus=$null;responseParsed=$false;checks=$null;errorCategory=$null;providerRequests=0;mutations=0;secretsPersisted=$false}
 try {
  $response=Invoke-WebRequest -UseBasicParsing -Uri $base -Method Get -Headers $headers -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction Stop
  $safe.httpStatus=[int]$response.StatusCode
  $s=$response.Content|ConvertFrom-Json -ErrorAction Stop
  $safe.responseParsed=$true
  $safe.checks=[ordered]@{
   serviceId=($s.id -ceq $serviceId)
   serviceName=($s.name -ceq 'vega-development-web')
   serviceType=($s.type -ceq 'web_service')
   ownerId=($s.ownerId -ceq 'tea-dand3tajnfac7387vm30')
   environmentId=($s.environmentId -ceq 'evm-dao55pijnfac73akca10')
   repository=($s.repo -is [string] -and $s.repo.TrimEnd('/') -cin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git'))
   branch=($s.branch -ceq 'product/layer3-public-entry')
   startCommand=($s.serviceDetails.envSpecificDetails.startCommand -ceq 'node scripts/start-web.mjs')
  }
  $safe.responseShape=[ordered]@{hasId=($null -ne $s.id);hasServiceWrapper=($null -ne $s.service);hasServiceDetails=($null -ne $s.serviceDetails);hasEnvironmentId=($null -ne $s.environmentId);hasBranch=($null -ne $s.branch)}
  # The service may track a different branch. Deployment below pins commitId
  # and verifies the returned commit; it does not change the configured branch.
  $safe.branchMatchRequired=$false
  $safe.deploymentSelection='explicit-reviewed-commit'
  if(@($safe.checks.Keys|Where-Object {$_ -ne 'branch' -and $safe.checks[$_] -ne $true}).Count){$safe.errorCategory='identity-check-mismatch'}
 } catch {
  if($null -ne $_.Exception.Response.StatusCode){$safe.httpStatus=[int]$_.Exception.Response.StatusCode}
  $safe.errorCategory=if($safe.httpStatus -and $safe.httpStatus -notin 200..299){'http-rejection'}elseif($safe.httpStatus){'response-parse-failure'}else{'transport-failure'}
 } finally {
  $safe|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $inspectionPath -Encoding utf8
  $response=$null;$s=$null
 }
 return ($null -eq $safe.errorCategory)
}
function Inspect-Safety {
 $safe=[ordered]@{stage='environment-settings';httpStatus=$null;environmentChecks=$null;applicationChecks=$null;activeDeploymentCount=$null;errorCategory=$null;mutations=0;secretsPersisted=$false}
 try {
  $envVars=@(Api ($base+'/env-vars?limit=100'))
  $safe.environmentChecks=[ordered]@{}
  foreach($pair in @(@('VEGA_ENV','development'),@('VEGA_EXTERNAL_EFFECTS','disabled'),@('VEGA_NATIVE_MEDIA_ENABLED','true'))){
   $v=@($envVars|Where-Object {$_.envVar.key -ceq $pair[0]})
   $safe.environmentChecks[$pair[0]]=@{matchCount=$v.Count;expectedValueMatches=($v.Count -eq 1 -and $v[0].envVar.value -ceq $pair[1])}
  }
  $safe.stage='public-application-config'
  $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 30 -MaximumRedirection 0
  $safe.applicationChecks=[ordered]@{development=($config.environment -ceq 'development');squareDisabled=($config.squareEnabled -ceq $false);externalEffectsDisabled=($config.externalEffects -ceq 'disabled');paymentModeDisabled=($config.paymentMode -ceq 'disabled')}
  $safe.stage='active-deployments'
  $active=@((Api ($base+'/deploys?limit=20'))|Where-Object {$_.deploy.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')})
  $safe.activeDeploymentCount=$active.Count
  if(@($safe.environmentChecks.Values|Where-Object {-not $_.expectedValueMatches}).Count){$safe.errorCategory='environment-setting-mismatch'}
  elseif(@($safe.applicationChecks.Values|Where-Object {$_ -ne $true}).Count){$safe.errorCategory='application-gate-mismatch'}
  elseif($active.Count){$safe.errorCategory='deployment-in-progress'}
  $safe.stage='checks-complete'
 } catch {
  if($null -ne $_.Exception.Response.StatusCode){$safe.httpStatus=[int]$_.Exception.Response.StatusCode}
  $safe.errorCategory=if($safe.httpStatus){'http-rejection'}else{'transport-or-response-failure'}
 } finally {
  $safe|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/layer-6/l6-s8b-execution-shutdown-safety-inspection.local.json') -Encoding utf8
  $envVars=$null;$v=$null;$config=$null;$active=$null
 }
 return ($null -eq $safe.errorCategory)
}
try {
 if(-not ($InspectServiceOnly -or $InspectSafetyOnly) -and (Test-Path -LiteralPath $marker)){throw 'Prior attempt requires reconciliation'}
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
 $receipt.stage='Development service identity'
 $identityValid=Inspect-Service
 if($InspectServiceOnly){Write-Host 'Read-only service inspection saved. Tell Astra done. No settings or deployment changed.';return}
 if(-not $identityValid){throw 'Service identity not confirmed'}
 $receipt.stage='existing Development safety settings'
 $safetyValid=Inspect-Safety
 if($InspectSafetyOnly){Write-Host 'Read-only safety inspection saved. Tell Astra done. No settings or deployment changed.';return}
 if(-not $safetyValid){throw 'Development safety checks not confirmed'}
 # A crash or uncertain outcome must be reconciled; never blindly redeploy.
 $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"attempted":true}');$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)}finally{$lock.Dispose()}
 $acquired=$true;Save-Receipt
 $receipt.stage='disable all bounded payment and refund execution';Save-Receipt
 foreach($key in @('VEGA_SANDBOX_PAYMENT_EXECUTION','VEGA_PAYMENT_ATTEMPT_PREPARATION','VEGA_SANDBOX_REFUND_EXECUTION','VEGA_REFUND_PROGRAM_EXECUTION')){
  $null=Api ($base+'/env-vars/'+$key) 'PUT' @{value='disabled'}
  $receipt.settingsUpdated+=$key;Save-Receipt
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
 $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 30 -MaximumRedirection 0
 if($config.environment -cne 'development' -or $config.squareEnabled -cne $false -or $config.paymentMode -cne 'disabled' -or $config.externalEffects -cne 'disabled'){throw 'Post-deployment safety mismatch'}
 $receipt.status='live-awaiting-browser-proof';$receipt.stage='complete';Save-Receipt
 Write-Host 'Development payment and refund execution disabled. Tell Astra done.'
} catch {
 if($acquired){$receipt.status='stopped-reconcile-before-retry';Save-Receipt}
 Write-Host ('Stopped at: '+$receipt.stage+'. No secret details printed. Tell Astra; do not rerun after a deployment attempt.')
} finally {
 $raw=$null;$folders=$null;$folder=$null;$operator=$null;$scale=$null;$headers=$null;$values=$null;$envVars=$null;$v=$null;$database=$null;$appDatabaseUrl=$null;$payload=$null
 $env:BITWARDENCLI_DEBUG=$priorDebug
}



