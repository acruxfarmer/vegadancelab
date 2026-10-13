# Offline verification: shadows transport and vault executables with fixtures.
$Deployment=$true
$ErrorActionPreference='Stop'
$sourcePath=Join-Path $PSScriptRoot $(if($Deployment){'../scripts/deploy-l6-s11-private.ps1'}else{'../scripts/provision-l6-s10-youtube-private.ps1'})
$source=Get-Content -LiteralPath $sourcePath -Raw
$tokens=$null;$parseErrors=$null
[System.Management.Automation.Language.Parser]::ParseFile($sourcePath,[ref]$tokens,[ref]$parseErrors)|Out-Null
if($parseErrors.Count){throw 'Operator script syntax failed'}
function Run-Case([string]$case){
 $caseRoot=Join-Path ([IO.Path]::GetTempPath()) ('vega-s10-'+[guid]::NewGuid().ToString('N'))
 $null=New-Item -ItemType Directory -Path (Join-Path $caseRoot 'scripts') -Force
 $null=New-Item -ItemType Directory -Path (Join-Path $caseRoot 'docs/layer-6') -Force
 $script:fixtureCase=$case;$script:writes=@();$script:deploymentMode=[bool]$Deployment;$script:deployed=$false
 $script:envFixture=@{VEGA_ENV='development';VEGA_EXTERNAL_EFFECTS='disabled';VEGA_SANDBOX_PAYMENT_EXECUTION='disabled';VEGA_PAYMENT_ATTEMPT_PREPARATION='disabled';VEGA_SANDBOX_REFUND_EXECUTION='disabled';VEGA_REFUND_PROGRAM_EXECUTION='disabled';VEGA_RENTAL_VERIFICATION='disabled';UNCHANGED_SECRET='fixture-unrelated-secret';VEGA_MEDIA_CONNECTIONS_ENABLED='true';VEGA_MEDIA_CONNECTION_KEY=('a'*64);VIMEO_CLIENT_ID='preserved-vimeo';VIMEO_CLIENT_SECRET='preserved-vimeo-secret'}
 if($case -eq 'missing-key'){$script:envFixture.Remove('VEGA_MEDIA_CONNECTION_KEY')}
 if($case -eq 'connections-disabled'){$script:envFixture.VEGA_MEDIA_CONNECTIONS_ENABLED='false'}
 if($case -eq 'missing-vimeo'){$script:envFixture.Remove('VIMEO_CLIENT_SECRET')}
 if($case -eq 'rental-enabled'){$script:envFixture.VEGA_RENTAL_VERIFICATION='enabled'}
 if($case -eq 'payment-enabled'){$script:envFixture.VEGA_SANDBOX_PAYMENT_EXECUTION='enabled'}
 if($case -eq 'bad-key'){$script:envFixture.VEGA_MEDIA_CONNECTION_KEY='invalid-existing-key'}
 if($case -in @('existing-key','inspect','already-provisioned')){$script:envFixture.VEGA_MEDIA_CONNECTION_KEY='a'*64}
 if($case -eq 'already-provisioned'){$script:envFixture.VEGA_MEDIA_CONNECTIONS_ENABLED='true';$script:envFixture.YOUTUBE_CLIENT_ID='fixture-client';$script:envFixture.YOUTUBE_CLIENT_SECRET='fixture-client-secret'}
 if($Deployment){
  $script:envFixture.VEGA_NATIVE_MEDIA_ENABLED='true';$script:envFixture.VEGA_MEDIA_CONNECTIONS_ENABLED='true';$script:envFixture.YOUTUBE_CLIENT_ID='fixture-client';$script:envFixture.YOUTUBE_CLIENT_SECRET='fixture-client-secret'
  if($case -ne 'bad-key'){$script:envFixture.VEGA_MEDIA_CONNECTION_KEY='a'*64}
  @{status='passed';baselineRestored=$true;providerCalls=0;committedFixtureWrites=0}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $caseRoot 'docs/layer-6/l6-s11-postgres.local.json')
 }
 function Fixture-Bw {
  $global:LASTEXITCODE=0
  if($args[0] -ceq 'status'){return '{"status":"unlocked"}'}
  if($args[0] -ceq 'list' -and $args[1] -ceq 'folders'){return '[{"id":"folder","name":"Dev Stack"}]'}
  if($args[0] -ceq 'list' -and $args[1] -ceq 'items'){
   $name=$args[3]
   if($name -ceq 'Vega Dev - Render Operator'){$fields=@(@{name='RENDER_API_KEY';value='fixture-render-secret'})}
   elseif($name -ceq 'Vega Dev - Vimeo'){$fields=@(@{name='VIMEO_CLIENT_ID';value='preserved-vimeo'},@{name='VIMEO_CLIENT_SECRET';value='preserved-vimeo-secret'})}
   elseif($name -ceq 'Acrux Dev - YouTube'){$fields=@(@{name='YOUTUBE_CLIENT_ID';value='fixture-client';type=1},@{name='YOUTUBE_CLIENT_SECRET';value='fixture-client-secret';type=1})}
   else{throw 'Unexpected fixture vault access'}
   if($script:fixtureCase -eq 'visible-field' -and $name -ceq 'Acrux Dev - YouTube'){$fields[0].type=0}
   return (ConvertTo-Json -Depth 5 -InputObject @(@{name=$name;folderId='folder';fields=$fields}))
  }
  throw 'Unexpected fixture vault command'
 }
 function Invoke-RestMethod {
  param($Uri,$Method='GET',$Headers,$TimeoutSec,$MaximumRedirection,$ErrorAction,$ContentType,$Body)
  $base='https://api.render.com/v1/services/srv-dao5cjbm8hqs73db51j0'
  if($Uri -ceq $base){return [pscustomobject]@{id=if($script:fixtureCase -eq 'wrong-service'){'production'}else{'srv-dao5cjbm8hqs73db51j0'};autoDeploy=if($script:fixtureCase -eq 'auto-deploy'){'yes'}else{'no'};name='vega-development-web';type='web_service';ownerId='tea-dand3tajnfac7387vm30';environmentId='evm-dao55pijnfac73akca10';repo='https://github.com/acruxfarmer/vegadancelab';serviceDetails=@{envSpecificDetails=@{startCommand='node scripts/start-web.mjs'}}}}
  if($Uri -ceq ($base+'/env-vars?limit=100')){return @($script:envFixture.Keys|ForEach-Object {[pscustomobject]@{envVar=@{key=$_;value=$script:envFixture[$_]}}})}
  if($Uri -ceq ($base+'/deploys?limit=20')){return @([pscustomobject]@{deploy=@{status=if($script:fixtureCase -eq 'active-deploy'){'build_in_progress'}else{'live'};id=if($script:fixtureCase -eq 'checkpoint-changed'){'dep-newer'}else{'dep-db77sfd9fdbs73d74u70'};commit=@{id='c61be62c322431ae3e1cb43e3a49172357e85b40'}}})}
  if($Uri -ceq 'https://vega-development-web.onrender.com/api/config'){return @{environment='development';squareEnabled=$false;paymentMode='disabled';externalEffects='disabled'}}
  if($script:deploymentMode -and $Uri -ceq 'https://vega-development-web.onrender.com/health/application'){return @{status='application_runtime_ready';environment='development';squareEnabled=$false}}
  if($script:deploymentMode -and $Uri -ceq ($base+'/deploys') -and $Method -ceq 'POST'){
   if(($Body|ConvertFrom-Json).commitId -cne ('b'*40)){throw 'Wrong deploy request commit'}
   $script:deployed=$true;return @{id='dep-fixture'}
  }
  if($script:deploymentMode -and $Uri -ceq ($base+'/deploys/dep-fixture')){return @{id='dep-fixture';status=if($script:fixtureCase -eq 'deploy-failed'){'build_failed'}else{'live'};commit=@{id=if($script:fixtureCase -eq 'wrong-commit'){'c'*40}else{'b'*40}}}}
  if($Method -ceq 'PUT' -and $Uri.StartsWith($base+'/env-vars/')){
   $key=$Uri.Substring(($base+'/env-vars/').Length)
   if($key -cnotin @('VEGA_MEDIA_LIBRARY_ENABLED')){throw 'Unexpected setting mutation'}
   $script:writes+=,$key
   if($script:fixtureCase -eq 'partial-failure' -and ($key -ceq 'YOUTUBE_CLIENT_ID' -or $script:deploymentMode)){throw 'fixture-client-secret'}
   $script:envFixture[$key]=($Body|ConvertFrom-Json).value
   return @{key=$key;value=$script:envFixture[$key]}
  }
  throw 'Unexpected network request in offline test'
 }
 $escaped=(Join-Path $caseRoot 'scripts').Replace("'","''")
 $code=$source.Replace("'C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'","'Fixture-Bw'").Replace('$PSScriptRoot',("'"+$escaped+"'"))
 $block=[scriptblock]::Create($code)
 $arguments=@{};if($Deployment){$arguments.RuntimeCommit='b'*40};if($case -eq 'inspect'){$arguments.InspectOnly=$true}
 $output=& $block @arguments 6>&1|Out-String
 $filename=if($Deployment){'l6-s11-'+('b'*40)+$(if($case -eq 'inspect'){'-inspection.local.json'}else{'-deployment.local.json'})}elseif($case -eq 'inspect'){'l6-s10-youtube-provisioning-inspection.local.json'}else{'l6-s11-postgres.local.json'}
 $receiptText=Get-Content -LiteralPath (Join-Path $caseRoot ('docs/layer-6/'+$filename)) -Raw
 $receipt=$receiptText|ConvertFrom-Json
 foreach($secret in @('fixture-render-secret','fixture-client-secret','fixture-unrelated-secret',('a'*64))){if(($output+$receiptText).Contains($secret)){throw ('Secret reflected: '+$case)}}
 if($script:envFixture.UNCHANGED_SECRET -cne 'fixture-unrelated-secret'){throw 'Unrelated setting changed'}
 if($case -in @('auto-deploy','wrong-service','rental-enabled','payment-enabled','bad-key','missing-key','connections-disabled','missing-vimeo','visible-field','checkpoint-changed','active-deploy')){if($script:writes.Count -ne 0 -or $receipt.status -cne 'stopped-inspect-before-retry'){throw ('Failed closed check: '+$case)}}
 elseif($case -eq 'partial-failure'){if($receipt.status -cne 'stopped-inspect-before-retry' -or -not ($receipt.mutationAttempted -or $receipt.settingMutationAttempted)){throw 'Partial failure not recorded'}}
 elseif($case -in @('wrong-commit','deploy-failed')){if($receipt.status -cne 'stopped-inspect-before-retry' -or -not $receipt.deployAttempted){throw 'Deployment failure not recorded'}}
 elseif($case -eq 'inspect'){if($script:writes.Count -ne 0 -or $receipt.status -cne 'inspected'){throw 'Inspection mutated settings'}}
 else{
  $expectedStatus=if($Deployment){'live-awaiting-s11-hosted-verification'}else{'provisioned-awaiting-runtime'}
  $expectedControl=if($Deployment){'true'}else{'true'}
  if($receipt.status -cne $expectedStatus -or $script:envFixture.VEGA_MEDIA_CONNECTIONS_ENABLED -cne $expectedControl){throw ('Operator action failed: '+$case)}
  if($script:envFixture.VEGA_MEDIA_CONNECTION_KEY -cnotmatch '^[a-f0-9]{64}$'){throw 'Encryption key format wrong'}
  if($case -in @('existing-key','already-provisioned') -and $script:envFixture.VEGA_MEDIA_CONNECTION_KEY -cne ('a'*64)){throw 'Existing key rotated'}
  if(-not $Deployment -and $case -eq 'already-provisioned' -and $script:writes.Count -ne 0){throw 'Unnecessary setting rewrite'}
  if($Deployment -and ($script:writes.Count -ne 1 -or $script:writes[0] -cne 'VEGA_MEDIA_LIBRARY_ENABLED' -or -not $script:deployed)){throw 'Deployment mutation scope incorrect'}
  $script:writes=@();$null=& $block @arguments 6>&1
  if($script:writes.Count -ne 0){throw 'Prior attempt was blindly repeated'}
  if((Get-Content -LiteralPath (Join-Path $caseRoot ('docs/layer-6/'+$filename)) -Raw) -cne $receiptText){throw 'Prior receipt was overwritten'}
 }
 Write-Output ('PASS '+$case)
}
$cases=@('fresh','inspect','auto-deploy','wrong-service','rental-enabled','payment-enabled','bad-key','missing-vimeo','checkpoint-changed','active-deploy','partial-failure')
if($Deployment){$cases+=@('wrong-commit','deploy-failed')}
foreach($case in $cases){Run-Case $case}
Write-Output ($cases.Count.ToString()+' offline operator checks passed. No live vault or network access.')


