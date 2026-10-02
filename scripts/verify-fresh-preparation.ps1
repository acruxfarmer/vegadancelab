# Narrow private operator handoff: existing Render credential and private member/staff login.
# Uses the already deployed runtime unchanged. Never contacts Square or enables execution.
[CmdletBinding()]
param([string]$OutputDirectory='D:/JOES WIP/ACRUX/Codex Projects/vega-commerce-68a-deployment/fresh-20261002')
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue'
Set-PSDebug -Off

function Assert-Fresh69Environment($Service,$Deploys,$Configuration,$Health,$Purchase) {
 if($Service.id -cne 'srv-dao5cjbm8hqs73db51j0' -or $Service.name -cne 'vega-development-web' -or $Service.type -cne 'web_service' -or $Service.ownerId -cne 'tea-dand3tajnfac7387vm30' -or $Service.environmentId -cne 'evm-dao55pijnfac73akca10' -or $Service.repo.TrimEnd('/') -notin @('https://github.com/acruxfarmer/vegadancelab','https://github.com/acruxfarmer/vegadancelab.git') -or $Service.serviceDetails.envSpecificDetails.startCommand -cne 'node scripts/start-web.mjs' -or $Service.serviceDetails.healthCheckPath -cne '/health/application'){throw 'Development service identity mismatch'}
 $live=@($Deploys|Where-Object status -CEQ 'live')
 if($live.Count -ne 1 -or $live[0].commit.id -cne 'd9dffd4f2125612448d5fbcb28f0c0b6b5723d9e'){throw 'Pinned runtime baseline mismatch'}
 if(@($Deploys|Where-Object status -In @('created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress')).Count){throw 'Another deployment is active'}
 $expected=@{VEGA_ENV='development';VEGA_EXTERNAL_EFFECTS='disabled';VEGA_PAYMENT_ATTEMPT_PREPARATION='enabled';VEGA_SANDBOX_PAYMENT_EXECUTION='disabled';SQUARE_ENVIRONMENT='sandbox';SQUARE_APPLICATION_ID='sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw';SQUARE_MERCHANT_ID='MLJGVWY9QZ66R';SQUARE_LOCATION_ID='L7EMFD4DPV27P';VEGA_SANDBOX_PURCHASE_ID=$Purchase}
 foreach($key in $expected.Keys){if($Configuration[$key] -cne $expected[$key]){throw ('Development configuration mismatch: '+$key)}}
 if($Health.status -cne 'application_runtime_ready' -or $Health.environment -cne 'development' -or $Health.squareEnabled -ne $false){throw 'Disabled Development runtime is not healthy'}
}

function Invoke-Fresh69Verification {
 $candidate='d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e'
 $oldPurchase='86902504-8bbe-4e38-9c99-dfc19b249ee6'
 $app='https://vega-development-web.onrender.com'
 $render='https://api.render.com/v1/services/srv-dao5cjbm8hqs73db51j0'
 $output=Join-Path $OutputDirectory 'operator-results.json'
 if(Test-Path -LiteralPath $output){throw 'Existing receipt must be reconciled. Refusing automatic rerun or new identifiers.'}
 New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
 $report=@{status='started';candidate=$candidate;startedAt=[DateTime]::UtcNow.ToString('o');previousPurchaseId=$oldPurchase;draftRequestId='fresh69-20261002-draft';requestIds=@('fresh69-20261002-shared','fresh69-20261002-distinct');checks=@();requests=@();providerExecution='disabled';squareRequestsByVerifier=0;productionChanged=$false;workerChanged=$false}
 $stage='private credentials';$client=[System.Net.Http.HttpClient]::new();$client.Timeout=[TimeSpan]::FromSeconds(45)
 $member=$null;$staff=$null;$headers=$null;$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
 function Save-Fresh { $report.stage=$stage;$report|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $output -Encoding utf8 }
 function Require-Fresh($Condition,$Reason){if(-not $Condition){throw $Reason}}
 function Send-Fresh($Method,$Path,$Body,$Token){
  $message=[System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method),$app+$Path)
  if($Token){$message.Headers.Authorization=[System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$Token)}
  if($null -ne $Body){$message.Content=[System.Net.Http.StringContent]::new(($Body|ConvertTo-Json -Depth 10 -Compress),[Text.Encoding]::UTF8,'application/json')}
  return @{task=$client.SendAsync($message);message=$message}
 }
 function Finish-Fresh($Pending){
  $response=$null
  try{$response=$Pending.task.GetAwaiter().GetResult();return @{status=[int]$response.StatusCode;data=($response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json)}}
  finally{if($response){$response.Dispose()};$Pending.message.Dispose()}
 }
 function Call-Fresh($Method,$Path,$Body,$Token){Finish-Fresh (Send-Fresh $Method $Path $Body $Token)}
 function Check-Fresh($Name,$Reply,$Expected){$report.checks+=@{name=$Name;status=$Reply.status;expected=$Expected;passed=($Reply.status -eq $Expected)};Save-Fresh;Require-Fresh ($Reply.status -eq $Expected) ($Name+' HTTP status mismatch')}
 function Login-Fresh($Email){
  $secure=Read-Host ('Password for '+$Email+' (private; never saved)') -AsSecureString
  $plain=[System.Net.NetworkCredential]::new('',$secure).Password
  try{$login=Call-Fresh 'POST' '/api/auth/sign-in' @{email=$Email;password=$plain} $null}finally{$plain=$null;$secure=$null}
  Require-Fresh ($login.status -eq 200 -and $login.data.accessToken) 'Private login failed'
  return $login.data.accessToken
 }
 function View-Fresh($Token,$Role,$User){
  $reply=Call-Fresh 'GET' '/api/app' $null $Token;Check-Fresh ($Role+' read') $reply 200
  $ctx=$reply.data.context
  Require-Fresh ($ctx.userId -ceq $User -and $ctx.role -ceq $Role -and $ctx.tenantId -ceq 'vega-development' -and $ctx.businessId -ceq 'vega-dance-lab') 'Authenticated identity mismatch'
  Require-Fresh ($reply.data.squareEnabled -eq $false -and $reply.data.paymentExecution.enabled -eq $false) 'Payment execution must remain disabled'
  return $reply.data
 }
 function Await-FreshReceipt($Receipt,$Token){
  Require-Fresh ($Receipt.operationId -match '^[a-f0-9]{64}$') 'Independent operation ID missing'
  for($i=0;$i -lt 30;$i++){
   $reply=Call-Fresh 'GET' ('/api/recovery/operations/'+$Receipt.operationId) $null $Token
   Require-Fresh ($reply.status -in @(200,202)) 'Receipt lookup failed'
   if($reply.status -eq 200 -and $reply.data.independentReceipt.state -ceq 'acknowledged'){return $reply.data}
   Start-Sleep -Seconds 2
  }
  throw 'Independent acknowledgment pending; reconcile saved receipt without creating a new operation'
 }
 function Get-FreshConfiguration {
  $configuration=@{}
  foreach($key in @('VEGA_ENV','VEGA_EXTERNAL_EFFECTS','VEGA_PAYMENT_ATTEMPT_PREPARATION','VEGA_SANDBOX_PAYMENT_EXECUTION','SQUARE_ENVIRONMENT','SQUARE_APPLICATION_ID','SQUARE_MERCHANT_ID','SQUARE_LOCATION_ID','VEGA_SANDBOX_PURCHASE_ID')){
   $entry=Invoke-RestMethod -Uri ($render+'/env-vars/'+$key) -Headers $headers -TimeoutSec 30
   $configuration[$key]=$entry.value
  }
  return $configuration
 }
 function Assert-FreshDraft($Draft){
  Require-Fresh ($Draft.currency -ceq 'USD' -and $Draft.totalMinor -eq 6000 -and $Draft.taxMinor -eq 0 -and $Draft.fulfillmentStatus -ceq 'not_issued') 'Unpaid offer/fulfillment mismatch'
  foreach($key in @('paymentConfirmedAt','validFrom','expiresAt','refundWindowStartsAt')){Require-Fresh ($null -eq $Draft.$key) ('Unexpected clock: '+$key)}
 }
 try {
  Save-Fresh
  $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
  $raw=& $bw status --nointeraction 2>$null
  Require-Fresh ($LASTEXITCODE -eq 0 -and ($raw|ConvertFrom-Json).status -ceq 'unlocked') 'Bitwarden unlock required in this private terminal'
  $raw=& $bw list folders --nointeraction 2>$null;Require-Fresh ($LASTEXITCODE -eq 0) 'Vault folder lookup failed'
  $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack');Require-Fresh ($folders.Count -eq 1) 'Vault folder not unique'
  $raw=& $bw list items --folderid $folders[0].id --nointeraction 2>$null;Require-Fresh ($LASTEXITCODE -eq 0) 'Vault record lookup failed'
  $records=@(($raw|ConvertFrom-Json)|Where-Object {$_.name -ceq 'Vega Dev - Render Operator' -and $_.folderId -ceq $folders[0].id -and -not $_.deletedDate})
  Require-Fresh ($records.Count -eq 1 -and $records[0].type -eq 2) 'Render operator record not unique'
  $fields=@($records[0].fields|Where-Object name -CEQ 'RENDER_API_KEY');Require-Fresh ($fields.Count -eq 1 -and $fields[0].value) 'Render credential unavailable'
  $headers=@{Authorization='Bearer '+[string]$fields[0].value};$raw=$null;$records=$null;$fields=$null
  $stage='read-only Render preflight';Save-Fresh
  $service=Invoke-RestMethod -Uri $render -Headers $headers -TimeoutSec 30
  $deploys=@(Invoke-RestMethod -Uri ($render+'/deploys?limit=20') -Headers $headers -TimeoutSec 30|ForEach-Object {$_.deploy})
  $configuration=Get-FreshConfiguration
  $health=Invoke-RestMethod -Uri ($app+'/health/application') -TimeoutSec 30
  Assert-Fresh69Environment $service $deploys $configuration $health $oldPurchase
  $report.configurationBefore=$configuration;$report.deploymentBefore=@($deploys|Where-Object status -CEQ 'live')[0].id
  $stage='private member and staff identity';Save-Fresh
  $member=Login-Fresh 'joe@tradewaters.co';$staff=Login-Fresh 'joe@acrux.co'
  $before=View-Fresh $member 'member' 'e5946b40-9839-4a96-99d5-93262d9573f0'
  $null=View-Fresh $staff 'staff' '4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124'
  Require-Fresh ($before.revision -eq 120 -and @($before.purchaseDrafts).Count -eq 6) 'Application baseline changed; independent reconciliation required'
  Require-Fresh (@($before.purchaseDrafts|Where-Object requestId -CEQ $report.draftRequestId).Count -eq 0) 'Fresh draft request already exists'
  $report.beforeRevision=$before.revision;$report.originalPurchaseIds=@($before.purchaseDrafts.id)
  $stage='create one fresh unpaid draft';Save-Fresh
  $draftReply=Call-Fresh 'POST' '/api/commerce/drafts' @{requestId=$report.draftRequestId;offerId='development-three-class-pack-usd60-v1'} $member
  Require-Fresh ($draftReply.status -in @(200,202)) 'Draft creation failed'
  $report.draftReceipt=$draftReply.data.independentReceipt;Save-Fresh
  $draft=Await-FreshReceipt $draftReply.data.independentReceipt $member
  Require-Fresh ($draft.id -match '^[a-f0-9-]{36}$' -and $draft.id -notin $report.originalPurchaseIds) 'Draft is not fresh'
  Assert-FreshDraft $draft
  Require-Fresh ($draft.paymentStatus -ceq 'not_started' -and -not $draft.activeAttemptId) 'Draft already has a payment attempt'
  $report.purchaseId=$draft.id;$report.freshDraftBefore=$draft;Save-Fresh
  $stage='designate fresh draft with execution disabled';Save-Fresh
  $service=Invoke-RestMethod -Uri $render -Headers $headers -TimeoutSec 30
  $deploys=@(Invoke-RestMethod -Uri ($render+'/deploys?limit=20') -Headers $headers -TimeoutSec 30|ForEach-Object {$_.deploy})
  $health=Invoke-RestMethod -Uri ($app+'/health/application') -TimeoutSec 30
  Assert-Fresh69Environment $service $deploys (Get-FreshConfiguration) $health $oldPurchase
  # The ONLY configuration write. All execution/provider gates were verified disabled.
  $null=Invoke-RestMethod -Method Put -Uri ($render+'/env-vars/VEGA_SANDBOX_PURCHASE_ID') -Headers $headers -ContentType 'application/json' -Body (@{value=$draft.id}|ConvertTo-Json -Compress) -TimeoutSec 30
  $configuration=Get-FreshConfiguration
  Assert-Fresh69Environment $service $deploys $configuration $health $draft.id
  $report.configurationAfter=$configuration
  $stage='redeploy unchanged pinned Development web runtime';$report.deploymentRequest='outcome_pending';Save-Fresh
  $deployment=Invoke-RestMethod -Method Post -Uri ($render+'/deploys') -Headers $headers -ContentType 'application/json' -Body (@{commitId=$candidate}|ConvertTo-Json -Compress) -TimeoutSec 30
  Require-Fresh ($deployment.id -match '^dep-[a-z0-9]+$') 'Deployment identity missing'
  $report.deployment=$deployment.id;$report.deploymentRequest='recorded';Save-Fresh
  for($i=0;$i -lt 32;$i++){
   $deployment=Invoke-RestMethod -Uri ($render+'/deploys/'+$report.deployment) -Headers $headers -TimeoutSec 30
   $report.deploymentStatus=$deployment.status;Save-Fresh
   if($deployment.status -in @('live','build_failed','update_failed','pre_deploy_failed','canceled','deactivated')){break}
   Write-Host ('Development web: '+$deployment.status);Start-Sleep -Seconds 15
  }
  Require-Fresh ($deployment.status -ceq 'live' -and $deployment.commit.id -ceq $candidate) 'Pinned redeployment did not become live'
  $service=Invoke-RestMethod -Uri $render -Headers $headers -TimeoutSec 30
  $deploys=@(Invoke-RestMethod -Uri ($render+'/deploys?limit=20') -Headers $headers -TimeoutSec 30|ForEach-Object {$_.deploy})
  $health=Invoke-RestMethod -Uri ($app+'/health/application') -TimeoutSec 30
  Assert-Fresh69Environment $service $deploys (Get-FreshConfiguration) $health $draft.id
  $stage='prove zero prior attempts and dispatch first-time requests';Save-Fresh
  $view=View-Fresh $member 'member' 'e5946b40-9839-4a96-99d5-93262d9573f0'
  $fresh=@($view.purchaseDrafts|Where-Object id -CEQ $draft.id)
  Require-Fresh ($fresh.Count -eq 1 -and $fresh[0].paymentStatus -ceq 'not_started' -and -not $fresh[0].activeAttemptId -and -not $fresh[0].paymentSummary) 'First-time attempt precondition failed'
  $report.beforeFirstAttempt=$fresh[0];$pending=@()
  foreach($request in @($report.requestIds[0],$report.requestIds[0],$report.requestIds[0],$report.requestIds[0],$report.requestIds[1])){
   $pending+=@{requestId=$request;startedAt=[DateTime]::UtcNow.ToString('o');pending=(Send-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$draft.id;requestId=$request} $member)}
  }
  foreach($item in $pending){
   try{$reply=Finish-Fresh $item.pending;$report.requests+=@{requestId=$item.requestId;startedAt=$item.startedAt;finishedAt=[DateTime]::UtcNow.ToString('o');status=$reply.status;attemptId=$reply.data.attemptId;receipt=$reply.data.independentReceipt;executionEnabled=$reply.data.executionEnabled}}
   catch{$report.requests+=@{requestId=$item.requestId;transportError=$_.Exception.GetType().Name}}
   Save-Fresh
  }
  Require-Fresh (@($report.requests|Where-Object {$_.status -ne 202 -or -not $_.attemptId -or $_.executionEnabled -ne $false}).Count -eq 0) 'Concurrent requests require reconciliation'
  $attempts=@($report.requests.attemptId|Sort-Object -Unique);Require-Fresh ($attempts.Count -eq 1 -and $attempts[0] -cne 'e81f8bc6-b0f8-4896-9708-69db493030c0') 'Fresh concurrent attempt identity mismatch'
  $report.attemptId=$attempts[0];$stage='independent acknowledgment and identical retries';Save-Fresh
  foreach($request in $report.requestIds){
   $record=@($report.requests|Where-Object requestId -CEQ $request)[0]
   $ack=Await-FreshReceipt $record.receipt $member;Require-Fresh ($ack.attemptId -ceq $report.attemptId) 'Acknowledged attempt mismatch'
   $retry=Call-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$draft.id;requestId=$request} $member;Check-Fresh 'identical retry' $retry 202
   Require-Fresh ($retry.data.attemptId -ceq $report.attemptId -and $retry.data.independentReceipt.state -ceq 'acknowledged') 'Retry identity/acknowledgment mismatch'
  }
  $stage='negative authority and disabled execution checks';Save-Fresh
  Check-Fresh 'changed command conflict' (Call-Fresh 'POST' '/api/commerce/drafts' @{requestId=$report.requestIds[0];offerId='development-three-class-pack-usd60-v1'} $member) 409
  Check-Fresh 'client amount denied' (Call-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$draft.id;requestId=$report.requestIds[0];amount=1} $member) 400
  Check-Fresh 'historical purchase not designated' (Call-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$oldPurchase;requestId=$report.requestIds[0]} $member) 403
  Check-Fresh 'anonymous denied' (Call-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$draft.id;requestId='fresh69-anonymous-denied'} $null) 401
  Check-Fresh 'staff preparation denied' (Call-Fresh 'POST' '/api/commerce/payments/prepare' @{purchaseId=$draft.id;requestId='fresh69-staff-denied'} $staff) 403
  foreach($path in @('/api/commerce/payments','/api/commerce/payments/resume')){Check-Fresh 'execution route unavailable' (Call-Fresh 'POST' $path @{purchaseId=$draft.id;attemptId=$report.attemptId;requestId='fresh69-execution-denied'} $member) 404}
  $stage='member and staff reopening';Save-Fresh
  foreach($actor in @(@{token=$member;role='member';id='e5946b40-9839-4a96-99d5-93262d9573f0'},@{token=$staff;role='staff';id='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124'})){
   $view=View-Fresh $actor.token $actor.role $actor.id;$found=@($view.purchaseDrafts|Where-Object id -CEQ $draft.id)
   Require-Fresh ($found.Count -eq 1) 'Fresh purchase visibility mismatch';Assert-FreshDraft $found[0]
   Require-Fresh ($found[0].activeAttemptId -ceq $report.attemptId -and $found[0].paymentSummary.reason -ceq 'prepared_execution_disabled' -and $found[0].paymentSummary.integrationRef.id -ceq 'vega-development-card' -and $found[0].paymentSummary.integrationRef.version -eq 1) 'Provider-neutral prepared state missing'
   $report[$actor.role+'Draft']=$found[0];$report.finalRevision=$view.revision;Save-Fresh
  }
  $report.status='api_checks_passed_independent_database_reconciliation_required'
 } catch {
  $report.status='stopped_reconciliation_required';$report.exceptionType=$_.Exception.GetType().Name
  # Never serialize exceptions: transport errors can contain authenticated request details.
  Write-Host ('Stopped at '+$stage+'. Reconcile the saved receipt before any retry.')
 } finally {
  $report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Fresh
  $member=$null;$staff=$null;$headers=$null;$raw=$null;$records=$null;$fields=$null;$client.Dispose();$env:BITWARDENCLI_DEBUG=$priorDebug
 }
 Write-Output ('Non-secret receipt: '+$output)
}

if($MyInvocation.InvocationName -ne '.') { Invoke-Fresh69Verification }
