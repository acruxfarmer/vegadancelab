# Run only in Joe's existing unlocked Bitwarden PowerShell. No secret output,
# files, clipboard, environment handoff, new provider, or credential creation.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue';Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
$stage='vault status'
$report=[ordered]@{status='blocked';projectRef='cjdoczrxcjynjhgpgqop';provider='Resend';sender='admin@acrux.co';secretsPersisted=$false}
$reportPath=Join-Path $PSScriptRoot '../docs/public-entry/resend-operator-result.json'
function ExactRecord($Items,[string]$Name){
 $matches=@($Items|Where-Object name -CEQ $Name)
 if($matches.Count -ne 1){throw 'Established record not unique'}
 return $matches[0]
}
function ExactSecret($Record,[string]$Name){
 $matches=@($Record.fields|Where-Object name -CEQ $Name)
 if($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$matches[0].value)){throw 'Established secret field not unique'}
 return [pscustomobject]@{label=('custom field: '+$Name);value=[string]$matches[0].value}
}
try{
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private unlocked session required'}
 $null=& $bw sync --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Vault sync failed'}
 $stage='Dev Stack folder'
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
 $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder not unique'}
 $raw=& $bw list items --folderid $folders[0].id --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record lookup failed'}
 $items=@(($raw|ConvertFrom-Json)|Where-Object {$_.folderId -ceq $folders[0].id -and -not $_.deletedDate});$raw=$null
 # These exact labels were established by Joe's completed private operator run.
 $stage='established Resend record and field'
 $resendRecord=ExactRecord $items 'Vega Dev - Resend'
 $resendSecret=ExactSecret $resendRecord 'RESEND_API_KEY'
 if($resendSecret.value -cnotmatch '^re_[A-Za-z0-9_\-]+$'){throw 'Selected value is not a complete Resend API key'}
 $report.resendRecord=$resendRecord.name;$report.resendField=$resendSecret.label
 $stage='established Supabase management credential'
 $supabaseRecord=ExactRecord $items 'Vega Dev - Supabase Operator'
 $supabaseSecret=ExactSecret $supabaseRecord 'SUPABASE_ACCESS_TOKEN'
 if($supabaseSecret.value -cnotmatch '^sbp_[A-Za-z0-9_\-]+$'){throw 'Selected value is not a complete Supabase management token'}
 $report.supabaseRecord=$supabaseRecord.name;$report.supabaseField=$supabaseSecret.label
 $stage='Development project identity'
 $authHeaders=@{Authorization='Bearer '+$supabaseSecret.value}
 $project=Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop' -Headers $authHeaders -Method Get -TimeoutSec 30
 if($project.id -cne 'cjdoczrxcjynjhgpgqop' -or $project.name -cne 'vega-development'){throw 'Unexpected project identity'}
 $configUrl='https://api.supabase.com/v1/projects/cjdoczrxcjynjhgpgqop/config/auth'
 $before=Invoke-RestMethod -Uri $configUrl -Headers $authHeaders -Method Get -TimeoutSec 30
 if($before.mailer_autoconfirm -ne $false -or $before.external_email_enabled -ne $true){throw 'Unexpected confirmation policy'}
 if($before.smtp_host -and $before.smtp_host -cne 'smtp.resend.com'){throw 'Different existing SMTP provider; no replacement performed'}
 # Joe verified acrux.co in the existing Resend dashboard on 2026-10-06:
 # vega-development key active, Sending access, recently used. No administrative
 # domain-list request is appropriate for that least-privilege sending key.
 $report.domainVerificationSource='Joe dashboard verification 2026-10-06'
 $report.resendKeyName='vega-development';$report.resendPermission='Sending access'
 $stage='Supabase Development SMTP configuration'
 $body=@{smtp_admin_email='admin@acrux.co';smtp_host='smtp.resend.com';smtp_port=465;smtp_user='resend';smtp_pass=$resendSecret.value;smtp_sender_name='Acrux';mailer_autoconfirm=$false}|ConvertTo-Json -Compress
 $null=Invoke-RestMethod -Uri $configUrl -Headers $authHeaders -Method Patch -ContentType 'application/json' -Body $body -TimeoutSec 30
 $body=$null
 $stage='SMTP configuration readback'
 $after=Invoke-RestMethod -Uri $configUrl -Headers $authHeaders -Method Get -TimeoutSec 30
 if($after.smtp_host -cne 'smtp.resend.com' -or [int]$after.smtp_port -ne 465 -or $after.smtp_user -cne 'resend' -or $after.smtp_admin_email -cne 'admin@acrux.co' -or $after.smtp_sender_name -cne 'Acrux' -or $after.mailer_autoconfirm -ne $false -or $after.external_email_enabled -ne $true){throw 'SMTP readback mismatch'}
 foreach($key in @('site_url','uri_allow_list','disable_signup','mailer_secure_email_change_enabled')){if($before.$key -cne $after.$key){throw 'Unrelated auth setting changed'}}
 $report.status='configured';$report.verifiedDomain='acrux.co';$report.smtpHost='smtp.resend.com';$report.smtpPort=465;$report.emailConfirmationRequired=$true;$report.unrelatedAuthSettingsUnchanged=$true
 Write-Host 'Existing Resend configured for Supabase Development. Email confirmation remains required. No secrets displayed.'
}catch{
 $report.stage=$stage
 if($null -ne $_.Exception.Response){$report.httpStatus=[int]$_.Exception.Response.StatusCode}
 Write-Host ('Stopped at '+$stage+'. No secret values displayed. Review the non-secret result file with Astra.')
}finally{
 $report.checkedAt=[DateTime]::UtcNow.ToString('o')
 $report|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $reportPath -Encoding utf8
 $env:BITWARDENCLI_DEBUG=$priorDebug
 $raw=$null;$items=$null;$resendCandidates=$null;$supabaseCandidates=$null;$resendRecord=$null;$supabaseRecord=$null;$resendSecret=$null;$supabaseSecret=$null;$authHeaders=$null;$before=$null;$after=$null;$body=$null;$domains=$null;$project=$null
}
