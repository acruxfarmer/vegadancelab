$ErrorActionPreference='Stop'
$source=Get-Content -Raw (Join-Path $PSScriptRoot '../scripts/configure-resend-auth-development.ps1')
$parseErrors=$null;$tokens=$null
$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Operator script parse failure'}
$testReportPath=Join-Path ([IO.Path]::GetTempPath()) ('resend-test-'+[guid]::NewGuid()+'.json')
$source=$source.Replace("'C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'","'Invoke-TestBw'").Replace("Join-Path `$PSScriptRoot '../docs/public-entry/resend-operator-result.json'",'$testReportPath')
if($source.Contains('Tools/BitwardenCLI/bw.exe')){throw 'Test isolation failed'}
function Invoke-TestBw {
 $global:LASTEXITCODE=0
 switch(($args -join ' ')){
  'status --nointeraction' {'{"status":"unlocked"}'}
  'sync --nointeraction' {''}
  'list folders --nointeraction' {'[{"id":"folder","name":"Dev Stack"}]'}
  'list items --folderid folder --nointeraction' {'[{"id":"r","folderId":"folder","name":"Existing Resend workspace","fields":[{"name":"Unrelated label","value":"not-the-key"},{"name":"Unestablished field label","value":"re_fake_test_only"}]},{"id":"s","folderId":"folder","name":"Existing Supabase access","fields":[{"name":"Another unknown label","value":"sbp_fake_test_only"}]}]'}
  default {throw 'Unexpected vault operation'}
 }
}
function Read-Host {param($Prompt);return $script:choices.Dequeue()}
function Invoke-RestMethod {
 param($Uri,$Headers,$Method,$TimeoutSec,$ContentType,$Body)
 if($Uri -eq 'https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop') {return @{id='cjdoczrxcjynjhgpgqop';name='vega-development'}}
 if($Uri -eq 'https://api.resend.com/domains') {return @{data=@(@{name='acrux.co';status=$script:domainStatus})}}
 if($Uri -ne 'https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop/config/auth'){throw 'Unexpected external destination'}
 if($Method -eq 'Patch'){
  $payload=$Body|ConvertFrom-Json
  if($payload.smtp_pass -cne 're_fake_test_only'){throw 'Wrong selected secret'}
  if(($payload.PSObject.Properties.Name|Sort-Object)-join ',' -cne 'mailer_autoconfirm,smtp_admin_email,smtp_host,smtp_pass,smtp_port,smtp_sender_name,smtp_user'){throw 'Unexpected configuration mutation'}
  $script:patches++
  foreach($p in $payload.PSObject.Properties){$script:config[$p.Name]=$p.Value}
 }
 return $script:config
}
try{
 foreach($domainStatus in @('verified','pending')){
  $script:domainStatus=$domainStatus;$script:patches=0
  $script:choices=[Collections.Generic.Queue[string]]::new();foreach($n in @('1','2','1','1')){$script:choices.Enqueue($n)}
  $script:config=@{mailer_autoconfirm=$false;external_email_enabled=$true;site_url='existing';uri_allow_list='existing';disable_signup=$false;mailer_secure_email_change_enabled=$true}
  & ([scriptblock]::Create($source)) | Out-Null
  $json=Get-Content -Raw -LiteralPath $testReportPath;$result=$json|ConvertFrom-Json
  if($json -match 're_fake_test_only|sbp_fake_test_only|smtp_pass'){throw 'Secret in operator report'}
  if($domainStatus -eq 'verified'){
   if($result.status -cne 'configured' -or $script:patches -ne 1 -or $result.resendField -cne 'custom field: Unestablished field label'){throw 'Explicit field selection/configuration failed'}
  }elseif($result.status -cne 'blocked' -or $script:patches -ne 0){throw 'Unverified domain did not stop before mutation'}
 }
 Write-Host 'PASS: explicit discovered field selection, exact Development-only SMTP update, secret-free report, unverified-domain stop.'
}finally{if(Test-Path -LiteralPath $testReportPath){Remove-Item -LiteralPath $testReportPath}}
