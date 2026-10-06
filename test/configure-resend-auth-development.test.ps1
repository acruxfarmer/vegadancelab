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
  'list items --folderid folder --nointeraction' {'[{"id":"r","folderId":"folder","name":"Vega Dev - Resend","fields":[{"name":"Unrelated label","value":"not-the-key"},{"name":"RESEND_API_KEY","value":"re_fake_test_only"}]},{"id":"s","folderId":"folder","name":"Vega Dev - Supabase Operator","fields":[{"name":"SUPABASE_ACCESS_TOKEN","value":"sbp_fake_test_only"}]}]'}
  default {throw 'Unexpected vault operation'}
 }
}
function Read-Host {throw 'No repeated credential selection or entry permitted'}
function Invoke-RestMethod {
 param($Uri,$Headers,$Method,$TimeoutSec,$ContentType,$Body)
 $script:requests.Add($Uri)
 if($Uri -eq 'https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop') {return @{id='cjdoczrxcjynjhgpgqop';name=$script:projectName}}
 if($Uri -ne 'https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop/config/auth'){throw 'Unexpected external destination'}
 if($Method -eq 'Patch'){
  $payload=$Body|ConvertFrom-Json
  if($payload.smtp_pass -cne 're_fake_test_only'){throw 'Wrong selected secret'}
  if(($payload.PSObject.Properties.Name|Sort-Object)-join ',' -cne 'mailer_autoconfirm,smtp_admin_email,smtp_host,smtp_pass,smtp_port,smtp_sender_name,smtp_user'){throw 'Unexpected configuration mutation'}
  $script:patches++
  foreach($p in $payload.PSObject.Properties){$script:config[$p.Name]=$p.Value}
 }
 return ($script:config|ConvertTo-Json|ConvertFrom-Json)
}
try{
 foreach($projectName in @('vega-development','wrong-project')){
  $script:projectName=$projectName;$script:patches=0;$script:requests=[Collections.Generic.List[string]]::new()
  $script:config=@{mailer_autoconfirm=$false;external_email_enabled=$true;site_url='existing';uri_allow_list='existing';disable_signup=$false;mailer_secure_email_change_enabled=$true}
  & ([scriptblock]::Create($source)) | Out-Null
  $json=Get-Content -Raw -LiteralPath $testReportPath;$result=$json|ConvertFrom-Json
  if($json -match 're_fake_test_only|sbp_fake_test_only|smtp_pass'){throw 'Secret in operator report'}
  if($script:requests|Where-Object {$_ -like '*api.resend.com*'}){throw 'Sending key used for administrative API call'}
  if($projectName -eq 'vega-development'){
   if($result.status -cne 'configured' -or $script:patches -ne 1 -or $result.resendField -cne 'custom field: RESEND_API_KEY' -or $result.resendPermission -cne 'Sending access'){throw 'Established field/configuration failed'}
  }elseif($result.status -cne 'blocked' -or $script:patches -ne 0){throw 'Wrong project did not stop before mutation'}
 }
 Write-Host 'PASS: established records without prompts, no Resend administrative calls, exact Development-only SMTP update, secret-free report, wrong-project stop.'
}finally{if(Test-Path -LiteralPath $testReportPath){Remove-Item -LiteralPath $testReportPath}}
