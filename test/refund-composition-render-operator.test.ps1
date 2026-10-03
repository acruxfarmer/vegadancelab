# Fully mocked management/vault interfaces. Never invokes Render or Bitwarden.
$ErrorActionPreference='Stop'
$source=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../scripts/refund-composition-render-operator.ps1')
$tokens=$null;$parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Operator script parse failure'}
$pin='a'*40;$serviceId='srv-dao5cjbm8hqs73db51j0';$jobId='job-12345678901234567890'
$checkpoint=@{revision='127';historicalMd5='2697037513f331bcf116a37d2bd003bc';canonicalStateSha256='d0871b339c712e6dd11f0288261174a579e25903877d2020c0d97d9c20c8c6c8';frozenTermsSha256='5774a6c42989d2f65fd2aaf48fca1cbbb98369734d85f4285ccaa8bed477b62e';componentDigest=('b'*64);commandsDigest=('c'*32);recoveryDigest=('d'*32);membersDigest=('e'*32);integrationsDigest=('f'*32)}
function bw {
 $global:LASTEXITCODE=0
 if($args[0] -eq 'status'){return '{"status":"unlocked"}'}
 if($args[1] -eq 'folders'){return '[{"id":"folder","name":"Dev Stack"}]'}
 if($args[1] -eq 'items'){return '[{"name":"Vega Dev - Render Operator","folderId":"folder","type":2,"fields":[{"name":"RENDER_API_KEY","value":"SECRET_TEST_TOKEN"}]}]'}
 throw 'Unexpected vault access'
}
function Start-Sleep {param($Seconds)}
function Invoke-WebRequest {
 param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection,$ErrorAction,$ContentType,$Body,[switch]$UseBasicParsing)
 if(-not $UseBasicParsing -or $TimeoutSec -ne 60 -or $MaximumRedirection -ne 0){throw 'Transport guard changed'}
 $forward=@{}; foreach($key in $PSBoundParameters.Keys){if($key -ne 'UseBasicParsing'){$forward[$key]=$PSBoundParameters[$key]}}
 $job=Invoke-RestMethod @forward
 if($global:VegaRefundMock_mode -eq 'timeout'){throw [TimeoutException]::new('SECRET_TEST_TOKEN')}
 if($global:VegaRefundMock_mode -eq 'http-rejection'){
  $r=[Net.Http.HttpResponseMessage]::new([Net.HttpStatusCode]::Forbidden)
  $r.Headers.Add('x-request-id','12345678-1234-1234-1234-123456789abc')
  throw [Microsoft.PowerShell.Commands.HttpResponseException]::new('SECRET_TEST_TOKEN',$r)
 }
 if($global:VegaRefundMock_mode -eq 'missing-id'){$job.Remove('id')}
 if($global:VegaRefundMock_mode -eq 'invalid-id'){$job.id='SECRET_TEST_TOKEN'}
 $content=if($global:VegaRefundMock_mode -eq 'invalid-json'){'SECRET_TEST_TOKEN'}else{$job|ConvertTo-Json -Compress}
 return @{StatusCode=201;Content=$content;Headers=@{'x-request-id'=$(if($global:VegaRefundMock_mode -eq 'unsafe-request-id'){'SECRET_TEST_TOKEN'}else{'12345678-1234-1234-1234-123456789abc'});Authorization='SECRET_TEST_TOKEN'}}
}
function Invoke-RestMethod {
 param($Uri,$Method='Get',$Headers,$TimeoutSec,$MaximumRedirection,$ErrorAction,$ContentType,$Body)
 $global:VegaRefundMock_calls.Add([pscustomobject]@{Uri=$Uri;Method=$Method})
 if($Uri -like '*/cancel'){$global:VegaRefundMock_cancels++;return @{}}
 if($Method -eq 'Post'){
  if($Uri -cne "https://api.render.com/v1/services/$serviceId/jobs"){throw 'Unexpected mutation'}
  $global:VegaRefundMock_posts++;$b=$Body|ConvertFrom-Json;$global:VegaRefundMock_jobCommand=$b.startCommand
  if($b.planId -cne 'plan-srv-006' -or $b.startCommand -notlike '*120s*verify-refund-composition-job.mjs'){throw 'Unsafe dispatch'}
  if($global:VegaRefundMock_mode -eq 'ambiguous'){throw 'SECRET_TEST_TOKEN uncertain response'}
  return @{id=$jobId;serviceId=$serviceId;startCommand=$b.startCommand;planId=$b.planId;status='pending'}
 }
 if($Uri -like '*/deploys?*'){return @(@{deploy=@{id='dep-test';status='live';createdAt='2026-10-03T00:00:00Z';commit=@{id=$(if($global:VegaRefundMock_mode -eq 'wrong-build'){'b'*40}else{$pin})}}})}
 if($Uri -match '/jobs\?'){if($global:VegaRefundMock_mode -eq 'existing-job'){return @(@{job=@{status='succeeded';startCommand='node scripts/verify-refund-composition-job.mjs'}})};return @()}
 if($Uri -like '*/jobs/job-*'){
  if($global:VegaRefundMock_mode -eq 'poll-failure'){throw 'SECRET_TEST_TOKEN status failure'}
  return @{id=$jobId;serviceId=$serviceId;startCommand=$global:VegaRefundMock_jobCommand;planId='plan-srv-006';status=$(if($global:VegaRefundMock_mode -eq 'job-failure'){'failed'}else{'succeeded'})}
 }
 if($Uri -like '*/logs?*'){
  if($Uri -notlike "*resource=$jobId&*"){throw 'Unscoped logs'}
  $e=@{version=1;commit=$pin;status='passed';before=$checkpoint.Clone();after=$checkpoint.Clone();projectedPayloadSha256=('9'*64);provider='provider_unknown';owned='incomplete';executionAuthorized=$false;independentReconciliationRequired=$true;policies=@('REFUND_CUTOFF_POLICY_UNRESOLVED','RESTORED_USAGE_POLICY_UNRESOLVED');boundaryChecks=@('staff','unauthorized','member','missing-purchase','foreign-business','foreign-tenant');assessmentUnchanged=$true;staffDiagnostics=@(@{category='provider_activity';kind='missing_provider_activity';origin='provider';blocksAffirmativeEligibility=$true;blocksExecution=$true},@{category='refunds';kind='coverage_incomplete';origin='owned';blocksAffirmativeEligibility=$true;blocksExecution=$true});unknownSecret='SECRET_TEST_TOKEN'}
  if($global:VegaRefundMock_mode -eq 'changed-state'){$e.after.commandsDigest='0'*32}
  if($global:VegaRefundMock_mode -eq 'bad-evidence'){$e.projectedPayloadSha256='SECRET_TEST_TOKEN'}
  return @{hasMore=$false;logs=@(@{message=('VEGA_COMPOSITION_RECEIPT '+($e|ConvertTo-Json -Depth 10 -Compress))})}
 }
 if($Uri -like '*/health/application'){return @{status='application_runtime_ready';environment='development';squareEnabled=$false}}
 if($Uri -like '*/api/config'){return @{environment='development';squareEnabled=($global:VegaRefundMock_mode -eq 'enabled');paymentMode='disabled';externalEffects='disabled'}}
 if($Uri -ceq "https://api.render.com/v1/services/$serviceId"){return @{id=$serviceId;name=$(if($global:VegaRefundMock_mode -eq 'wrong-service'){'production'}else{'vega-development-web'});type='web_service';ownerId='tea-dand3tajnfac7387vm30';environmentId='evm-dao55pijnfac73akca10';repo='https://github.com/acruxfarmer/vegadancelab.git';serviceDetails=@{envSpecificDetails=@{startCommand='node scripts/start-web.mjs'}}}}
 throw 'Unexpected network operation'
}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('vega-refund-operator-tests-'+[guid]::NewGuid())
$null=New-Item -ItemType Directory -Path $testRoot
$passed=0
foreach($mode in @('success','unsafe-request-id','timeout','http-rejection','missing-id','invalid-id','invalid-json','wrong-service','wrong-build','existing-job','enabled','ambiguous','poll-failure','job-failure','changed-state','bad-evidence')){
 $global:VegaRefundMock_mode=$mode;$global:VegaRefundMock_posts=0;$global:VegaRefundMock_cancels=0;$global:VegaRefundMock_calls=[Collections.Generic.List[object]]::new()
 $caseDir=Join-Path $testRoot $mode;$null=New-Item -ItemType Directory -Path $caseDir
 $scriptPath=Join-Path $caseDir 'operator.ps1';$source.Replace('__RELEASE_COMMIT__',$pin)|Set-Content -LiteralPath $scriptPath
 $failure=$null
 try{$null=& $scriptPath -JoeAuthorized}catch{$failure=$_.Exception.Message}
 if($mode -in @('success','unsafe-request-id')){
  if($failure -or $global:VegaRefundMock_posts -ne 1 -or $global:VegaRefundMock_cancels -ne 0){throw "Success case failed: $failure"}
  $receipt=Get-Content -Raw -LiteralPath (Join-Path $caseDir "refund-composition-verification-$pin/operator-receipt.json")
  if($receipt -match 'SECRET_TEST_TOKEN' -or ($receipt|ConvertFrom-Json).status -cne 'passed_pending_independent_reconciliation'){throw 'Receipt not sanitized'}
  $originalReceipt=$receipt
  try{$null=& $scriptPath -JoeAuthorized;throw 'Unexpected retry'}catch{if($_.Exception.Message -eq 'Unexpected retry'){throw}}
  if((Get-Content -Raw -LiteralPath (Join-Path $caseDir "refund-composition-verification-$pin/operator-receipt.json")) -cne $originalReceipt){throw 'Prior receipt overwritten'}
  if($global:VegaRefundMock_posts -ne 1){throw 'Duplicate dispatch'}
 }else{
  if(-not $failure -or $failure -match 'SECRET_TEST_TOKEN'){throw "Failure not sanitized: $mode"}
  $expected=if($mode -in @('timeout','http-rejection','missing-id','invalid-id','invalid-json','ambiguous','poll-failure','job-failure','changed-state','bad-evidence')){1}else{0}
  if($global:VegaRefundMock_posts -ne $expected){throw "Dispatch count mismatch: $mode"}
  if($global:VegaRefundMock_cancels -ne $(if($mode -eq 'poll-failure'){1}else{0})){throw "Cancel mismatch: $mode"}
 }
 if($global:VegaRefundMock_posts -eq 1){
  $rp=Join-Path $caseDir "refund-composition-verification-$pin/operator-receipt.json"
  $saved=Get-Content -Raw -LiteralPath $rp
  if($saved -match 'SECRET_TEST_TOKEN'){throw 'Diagnostic secret leak'}
  $diag=($saved|ConvertFrom-Json).dispatchDiagnostics
  if(-not $diag.requestStart -or -not $diag.requestEnd -or $null -eq $diag.elapsedMilliseconds -or $diag.elapsedMilliseconds -lt 0){throw 'Timing missing'}
  $category=switch($mode){'timeout'{'transport_timeout'} 'ambiguous'{'transport_failure'} 'http-rejection'{'http_rejection'} {$_ -in @('missing-id','invalid-id','invalid-json')}{'invalid_job_identity'} default {$null}}
  if($diag.exceptionCategory -cne $category){throw "Wrong category $mode"}
  $status=if($mode -eq 'http-rejection'){403}elseif($mode -in @('timeout','ambiguous')){$null}else{201}
  if($diag.httpStatus -ne $status){throw "Wrong HTTP status $mode"}
  if($diag.validJobIdReturned -ne ($null -eq $category)){throw 'Wrong identity outcome'}
  if($mode -eq 'unsafe-request-id' -and $null -ne $diag.providerRequestId){throw 'Unsafe request ID retained'}
  if($mode -eq 'http-rejection' -and $diag.providerRequestId -cne '12345678-1234-1234-1234-123456789abc'){throw 'Request ID lost'}
  $markerPath=Join-Path $caseDir "refund-composition-verification-$pin/dispatch-attempted.json"
  $markerHash=(Get-FileHash -LiteralPath $markerPath).Hash
  try{$null=& $scriptPath -JoeAuthorized;throw 'Unexpected retry'}catch{if($_.Exception.Message -eq 'Unexpected retry'){throw}}
  if((Get-Content -Raw -LiteralPath $rp) -cne $saved -or (Get-FileHash -LiteralPath $markerPath).Hash -cne $markerHash -or $global:VegaRefundMock_posts -ne 1){throw 'Prior evidence/retry guard changed'}
 }
 $passed++;Write-Output "PASS $mode"
}
# Unsealed/default templates and unknown overrides cannot reach the vault/network.
$global:VegaRefundMock_posts=0;$global:VegaRefundMock_calls.Clear();$unsealed=Join-Path $testRoot 'unsealed.ps1';$source|Set-Content -LiteralPath $unsealed
$null=& $unsealed
try{$null=& $unsealed -JoeAuthorized;throw 'Unexpected template execution'}catch{if($_.Exception.Message -eq 'Unexpected template execution'){throw}}
try{$null=& $unsealed -JoeAuthorized -Purchase 'other';throw 'Unexpected override'}catch{if($_.Exception.Message -eq 'Unexpected override'){throw}}
if($global:VegaRefundMock_calls.Count -ne 0){throw 'Unsealed template made network call'}
$passed++;Write-Output "PASS unsealed/default/override guards"
Write-Output "$passed/17 operator scenarios passed; all management and vault calls mocked."
# Only remove this freshly created, resolved test directory.
$resolved=[IO.Path]::GetFullPath($testRoot);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'vega-refund-operator-tests-*'){throw 'Unexpected cleanup path'}
Remove-Item -LiteralPath $resolved -Recurse -Force
