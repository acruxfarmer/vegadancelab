$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/verify-fresh-preparation.ps1')
$service=@{id='srv-dao5cjbm8hqs73db51j0';name='vega-development-web';type='web_service';ownerId='tea-dand3tajnfac7387vm30';environmentId='evm-dao55pijnfac73akca10';repo='https://github.com/acruxfarmer/vegadancelab';serviceDetails=@{healthCheckPath='/health/application';envSpecificDetails=@{startCommand='node scripts/start-web.mjs'}}}
$deploys=@(@{id='dep-fixture';status='live';commit=@{id='d9dffd4f2125612448d5fbcb28f0c0b6b5723d9e'}})
$purchase='86902504-8bbe-4e38-9c99-dfc19b249ee6'
$configuration=@{VEGA_ENV='development';VEGA_EXTERNAL_EFFECTS='disabled';VEGA_PAYMENT_ATTEMPT_PREPARATION='enabled';VEGA_SANDBOX_PAYMENT_EXECUTION='disabled';SQUARE_ENVIRONMENT='sandbox';SQUARE_APPLICATION_ID='sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw';SQUARE_MERCHANT_ID='MLJGVWY9QZ66R';SQUARE_LOCATION_ID='L7EMFD4DPV27P';VEGA_SANDBOX_PURCHASE_ID=$purchase}
$health=@{status='application_runtime_ready';environment='development';squareEnabled=$false}
Assert-Fresh69Environment $service $deploys $configuration $health $purchase
$count=1
foreach($key in $configuration.Keys){
 $bad=$configuration.Clone();$bad[$key]='unexpected'
 $rejected=$false
 try{Assert-Fresh69Environment $service $deploys $bad $health $purchase}catch{$rejected=$true}
 if(-not $rejected){throw "Unsafe configuration accepted: $key"};$count++
}
foreach($key in @('id','name','type','ownerId','environmentId','repo')){
 $bad=$service.Clone();$bad[$key]='wrong'
 $rejected=$false
 try{Assert-Fresh69Environment $bad $deploys $configuration $health $purchase}catch{$rejected=$true}
 if(-not $rejected){throw "Wrong service accepted: $key"};$count++
}
$cases=@(
 @{deploys=@(@{status='live';commit=@{id='other'}});health=$health},
 @{deploys=@($deploys[0],@{status='queued'});health=$health},
 @{deploys=@($deploys[0],$deploys[0]);health=$health},
 @{deploys=$deploys;health=@{status='application_runtime_ready';environment='production';squareEnabled=$false}},
 @{deploys=$deploys;health=@{status='application_runtime_ready';environment='development';squareEnabled=$true}},
 @{deploys=$deploys;health=@{status='not_ready';environment='development';squareEnabled=$false}}
)
foreach($case in $cases){
 $rejected=$false
 try{Assert-Fresh69Environment $service $case.deploys $configuration $case.health $purchase}catch{$rejected=$true}
 if(-not $rejected){throw 'Unsafe runtime accepted'};$count++
}
Write-Output "$count offline handoff preflight cases passed; no network, credentials, or hosted mutations."
