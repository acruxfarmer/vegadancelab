# Release template: Astra copies this to the private deployment directory and
# replaces only __RELEASE_COMMIT__ after committing the reviewed runner.
[CmdletBinding()]
param([switch]$JoeAuthorized)
if(-not $JoeAuthorized){Write-Output 'Prepared only. Stop for Joe + Chett review.';return}
$ErrorActionPreference='Stop';$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue';Set-PSDebug -Off
$commit='__RELEASE_COMMIT__'
if($commit -cnotmatch '^[a-f0-9]{40}$'){throw 'Unsealed release template; no management action permitted'}
$serviceId='srv-dao5cjbm8hqs73db51j0';$owner='tea-dand3tajnfac7387vm30'
$base="https://api.render.com/v1/services/$serviceId";$plan='plan-srv-006'
# Exact artifact gate executes before Node or a database connection. No target overrides.
$command='test "$RENDER_GIT_COMMIT" = "'+$commit+'" && timeout --signal=TERM --kill-after=5s 120s env -u NODE_OPTIONS -u NODE_PATH VEGA_REFUND_VERIFY_COMMIT='+$commit+' node scripts/verify-refund-composition-job.mjs'
$dir=Join-Path $PSScriptRoot ('refund-composition-verification-'+$commit)
$marker=Join-Path $dir 'dispatch-attempted.json';$receiptPath=Join-Path $dir 'operator-receipt.json'
$receipt=@{version=1;commit=$commit;serviceId=$serviceId;planId=$plan;status='preflight';jobId=$null;dispatchAttempted=$false;cancelAttempted=$false;evidence=$null;independentReconciliationRequired=$true}
# Reject before the receipt-writing catch so existing evidence stays immutable.
if(Test-Path -LiteralPath $marker){throw 'Prior dispatch attempt; reconciliation required'}
$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
$stage='existing credential';$job=$null;$headers=$null;$terminal=$false
function Save-Receipt {$receipt|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $receiptPath -Encoding utf8}
function Api([string]$path,[string]$method='Get',$body=$null){
 $p=@{Uri=$path;Method=$method;Headers=$headers;TimeoutSec=15;MaximumRedirection=0;ErrorAction='Stop'}
 if($null -ne $body){$p.ContentType='application/json';$p.Body=($body|ConvertTo-Json -Compress)}
 Invoke-RestMethod @p
}
function Check-Service {
 $s=Api $base
 if($s.id -cne $serviceId -or $s.name -cne 'vega-development-web' -or $s.type -cne 'web_service' -or $s.ownerId -cne $owner -or $s.environmentId -cne 'evm-dao55pijnfac73akca10' -or $s.repo.TrimEnd('/') -cnotin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git') -or $s.serviceDetails.envSpecificDetails.startCommand -cne 'node scripts/start-web.mjs'){throw 'Identity mismatch'}
 $d=@((Api ($base+'/deploys?limit=20'))|ForEach-Object {$_.deploy}|Sort-Object {[datetimeoffset]$_.createdAt} -Descending)
 if($d.Count -eq 0 -or $d[0].status -cne 'live' -or $d[0].commit.id -cne $commit -or @($d|Where-Object {$_.status -in @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')}).Count -ne 0){throw 'Build not ready'}
 if($d[0].id -cnotmatch '^dep-[a-z0-9]+$'){throw 'Invalid deployment'}
 return $d[0].id
}
function Digest([object]$v,[int]$length){if($v -isnot [string] -or $v -cnotmatch ('^[a-f0-9]{'+$length+'}$')){throw 'Invalid evidence'};return $v}
function Safe-Checkpoint($p){
 if($p.revision -cne '127'){throw 'Baseline mismatch'}
 $out=@{revision='127';historicalMd5=(Digest $p.historicalMd5 32);canonicalStateSha256=(Digest $p.canonicalStateSha256 64);frozenTermsSha256=(Digest $p.frozenTermsSha256 64)}
 if($out.historicalMd5 -cne '2697037513f331bcf116a37d2bd003bc' -or $out.canonicalStateSha256 -cne 'd0871b339c712e6dd11f0288261174a579e25903877d2020c0d97d9c20c8c6c8' -or $out.frozenTermsSha256 -cne '5774a6c42989d2f65fd2aaf48fca1cbbb98369734d85f4285ccaa8bed477b62e'){throw 'Baseline mismatch'}
 $out.componentDigest=Digest $p.componentDigest 64
 foreach($key in @('commandsDigest','recoveryDigest','membersDigest','integrationsDigest')){$out[$key]=Digest $p.$key 32}
 return $out
}
try {
 if(Test-Path -LiteralPath $marker){throw 'Prior dispatch attempt; reconciliation required'}
 $raw=& bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -cne 'unlocked'){throw 'Vault locked'}
 $raw=& bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Vault lookup failed'}
 $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Ambiguous folder'}
 $raw=& bw list items --folderid $folders[0].id --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Vault lookup failed'}
 $records=@(($raw|ConvertFrom-Json)|Where-Object {$_.name -ceq 'Vega Dev - Render Operator' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate})
 if($records.Count -ne 1 -or $records[0].type -ne 2){throw 'Ambiguous credential'}
 $fields=@($records[0].fields|Where-Object name -CEQ 'RENDER_API_KEY')
 if($fields.Count -ne 1 -or -not $fields[0].value){throw 'Missing existing credential'}
 $headers=@{Authorization='Bearer '+[string]$fields[0].value};$raw=$null;$records=$null;$fields=$null
 $stage='exact Development build';$deployment=Check-Service
 $stage='disabled execution gates'
 $health=Invoke-RestMethod 'https://vega-development-web.onrender.com/health/application' -TimeoutSec 15 -MaximumRedirection 0
 $config=Invoke-RestMethod 'https://vega-development-web.onrender.com/api/config' -TimeoutSec 15 -MaximumRedirection 0
 if($health.status -cne 'application_runtime_ready' -or $health.environment -cne 'development' -or $health.squareEnabled -cne $false -or $config.environment -cne 'development' -or $config.squareEnabled -cne $false -or $config.paymentMode -cne 'disabled' -or $config.externalEffects -cne 'disabled'){throw 'Execution gates changed'}
 $stage='existing jobs'
 $jobs=@(Api ($base+'/jobs?limit=100'))
 if($jobs.Count -ge 100 -or @($jobs|Where-Object {$_.job.status -in @('pending','running') -or $_.job.startCommand -like '*scripts/verify-refund-composition-job.mjs*'}).Count -gt 0){throw 'Existing jobs require reconciliation'}
 # Last build read immediately before dispatch; the command also rejects any race.
 if((Check-Service) -cne $deployment){throw 'Deployment changed'}
 $null=New-Item -ItemType Directory -Path $dir -Force
 $receipt.deploymentId=$deployment;$receipt.status='dispatch_outcome_pending';$receipt.dispatchAttempted=$true
 $stage='dispatch_transport'
 # Atomic local lock survives a lost response/crash. Never delete it automatically.
 $lock=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"dispatchAttempted":true}');$lock.Write($bytes,0,$bytes.Length);$lock.Flush($true)}finally{$lock.Dispose()}
 Save-Receipt
 $started=[datetimeoffset]::UtcNow
 $receipt.dispatchDiagnostics=@{requestStart=$started.ToString('o');requestEnd=$null;elapsedMilliseconds=$null;failureStage=$null;exceptionCategory=$null;httpStatus=$null;providerRequestId=$null;validJobIdReturned=$false}
 $timer=[Diagnostics.Stopwatch]::StartNew()
 try {
  $response=Invoke-WebRequest -UseBasicParsing -Uri ($base+'/jobs') -Method Post -Headers $headers -ContentType 'application/json' -Body (@{startCommand=$command;planId=$plan}|ConvertTo-Json -Compress) -TimeoutSec 60 -MaximumRedirection 0 -ErrorAction Stop
  $stage='dispatch_http_response'
  $receipt.dispatchDiagnostics.httpStatus=[int]$response.StatusCode
  if([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300){throw 'HTTP rejection'}
  $stage='dispatch_job_identity_validation'
  $job=$response.Content|ConvertFrom-Json -ErrorAction Stop
  if($job.id -isnot [string] -or $job.id -cnotmatch '^job-[a-z0-9]{20}$'){throw 'Unknown dispatch outcome'}
  $receipt.dispatchDiagnostics.validJobIdReturned=$true
 } catch {
  $dispatchException=$_.Exception
  while($dispatchException.InnerException -and $null -eq $dispatchException.Response){$dispatchException=$dispatchException.InnerException}
  if($null -ne $dispatchException.Response -and $null -ne $dispatchException.Response.StatusCode){
   $response=$dispatchException.Response;$stage='dispatch_http_response'
   $receipt.dispatchDiagnostics.httpStatus=[int]$response.StatusCode
  }
  $receipt.dispatchDiagnostics.failureStage=$stage
  $receipt.dispatchDiagnostics.exceptionCategory=switch($stage){
   'dispatch_http_response' {'http_rejection'}
   'dispatch_job_identity_validation' {'invalid_job_identity'}
   default {if($dispatchException -is [TimeoutException] -or $dispatchException -is [OperationCanceledException] -or ($dispatchException -is [Net.WebException] -and $dispatchException.Status -eq [Net.WebExceptionStatus]::Timeout)){'transport_timeout'}else{'transport_failure'}}
  }
  throw
 } finally {
  $timer.Stop();$receipt.dispatchDiagnostics.requestEnd=[datetimeoffset]::UtcNow.ToString('o')
  $receipt.dispatchDiagnostics.elapsedMilliseconds=$timer.ElapsedMilliseconds
  # Retain only a UUID-shaped request identifier, never arbitrary header text.
  foreach($name in @('x-request-id','request-id')){
   $value=$null
   if($response.Headers -is [System.Net.Http.Headers.HttpHeaders]){
    if($response.Headers.Contains($name)){$value=@($response.Headers.GetValues($name)) -join ','}
   }elseif($null -ne $response.Headers){$value=[string]$response.Headers[$name]}
   if($value -cmatch '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'){$receipt.dispatchDiagnostics.providerRequestId=$value;break}
  }
  $response=$null;$value=$null;$dispatchException=$null
  Save-Receipt
 }
 $receipt.jobId=$job.id;Save-Receipt
 if($job.serviceId -cne $serviceId -or $job.startCommand -cne $command -or $job.planId -cne $plan){throw 'Job identity mismatch'}
 $stage='bounded job status'
 while(([datetimeoffset]::UtcNow-$started).TotalSeconds -lt 180){
  $job=Api ($base+'/jobs/'+$receipt.jobId)
  if($job.id -cne $receipt.jobId -or $job.serviceId -cne $serviceId -or $job.startCommand -cne $command -or $job.planId -cne $plan -or $job.status -cnotin @('pending','running','succeeded','failed','canceled')){throw 'Job identity/status mismatch'}
  $receipt.status=$job.status;Save-Receipt
  if($job.status -in @('succeeded','failed','canceled')){$terminal=$true;break}
  Start-Sleep -Seconds 5
 }
 if(-not $terminal){throw 'Job deadline'}
 if($job.status -cne 'succeeded'){throw 'Job did not succeed'}
 $stage='sanitized job evidence'
 Start-Sleep -Seconds 10
 $start=[uri]::EscapeDataString($started.ToString('o'));$end=[uri]::EscapeDataString([datetimeoffset]::UtcNow.ToString('o'))
 $logs=Api ('https://api.render.com/v1/logs?ownerId='+$owner+'&resource='+$receipt.jobId+'&direction=forward&limit=100&text=VEGA_COMPOSITION_RECEIPT&startTime='+$start+'&endTime='+$end)
 $lines=@($logs.logs|Where-Object {$_.message -clike 'VEGA_COMPOSITION_RECEIPT *'})
 if($logs.hasMore -ne $false -or $lines.Count -ne 1 -or $lines[0].message.Length -gt 8192){throw 'Evidence unavailable/ambiguous'}
 $e=$lines[0].message.Substring('VEGA_COMPOSITION_RECEIPT '.Length)|ConvertFrom-Json
 if($e.version -ne 1 -or $e.commit -cne $commit -or $e.status -cne 'passed' -or $e.provider -cne 'provider_unknown' -or $e.owned -cne 'incomplete' -or $e.executionAuthorized -cne $false -or $e.independentReconciliationRequired -cne $true -or ($e.policies -join ',') -cne 'REFUND_CUTOFF_POLICY_UNRESOLVED,RESTORED_USAGE_POLICY_UNRESOLVED' -or ($e.boundaryChecks -join ',') -cne 'staff,unauthorized,member,missing-purchase,foreign-business,foreign-tenant'){throw 'Evidence contract mismatch'}
 if($e.assessmentUnchanged -cne $true -or @($e.staffDiagnostics).Count -eq 0 -or @($e.staffDiagnostics).Count -gt 100){throw 'Composition evidence missing'}
 $safeGaps=@($e.staffDiagnostics|ForEach-Object {
  if($_.category -cnotin @('purchase','confirmation','refunds','issuance','consumption','restoration','reservations','clocks','ownership','recovery','audit','inventory','provider_activity') -or $_.kind -cnotin @('missing_owned_history','missing_provider_activity','coverage_unasserted','coverage_incomplete','stale','conflicting','provenance_unverified','recovery_unacknowledged','audit_incomplete') -or $_.origin -cnotin @('owned','provider') -or $_.blocksAffirmativeEligibility -cne $true -or $_.blocksExecution -cne $true){throw 'Unsafe gap evidence'}
  @{category=$_.category;kind=$_.kind;origin=$_.origin;blocksAffirmativeEligibility=$true;blocksExecution=$true}
 })
 if(@($safeGaps|Where-Object {$_.kind -ceq 'missing_provider_activity' -and $_.origin -ceq 'provider'}).Count -eq 0 -or @($safeGaps|Where-Object origin -CEQ 'owned').Count -eq 0){throw 'Expected gaps missing'}
 $before=Safe-Checkpoint $e.before;$after=Safe-Checkpoint $e.after
 foreach($key in $before.Keys){if($before[$key] -cne $after[$key]){throw 'State changed'}}
 $receipt.evidence=@{before=$before;after=$after;projectedPayloadSha256=(Digest $e.projectedPayloadSha256 64);provider='provider_unknown';owned='incomplete';executionAuthorized=$false;boundaryChecks='staff,unauthorized,member,missing-purchase,foreign-business,foreign-tenant';policies='REFUND_CUTOFF_POLICY_UNRESOLVED,RESTORED_USAGE_POLICY_UNRESOLVED'}
 $receipt.evidence.staffDiagnostics=$safeGaps;$receipt.evidence.assessmentUnchanged=$true
 $receipt.status='passed_pending_independent_reconciliation';Save-Receipt
 Write-Output ('Non-secret receipt: '+$receiptPath)
} catch {
 if($receipt.jobId -and -not $terminal){
  $receipt.cancelAttempted=$true
  try{$null=Api ($base+'/jobs/'+$receipt.jobId+'/cancel') 'Post';$receipt.cancelRequestAccepted=$true}catch{$receipt.cancelRequestAccepted=$false}
 }
 if(Test-Path -LiteralPath $dir){$receipt.status='stopped';$receipt.stopStage=$stage;Save-Receipt}
 throw ('Stopped at '+$stage+'. No retry. Astra must reconcile the receipt and any dispatch attempt; no secret or raw provider error displayed.')
} finally {$raw=$null;$records=$null;$fields=$null;$headers=$null;$logs=$null;$e=$null;$env:BITWARDENCLI_DEBUG=$priorDebug}
