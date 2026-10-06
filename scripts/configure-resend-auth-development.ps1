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
function Select-ExistingRecord($Candidates,[string]$Purpose){
 $choices=@($Candidates)
 if($choices.Count -eq 0){throw 'No matching existing record'}
 Write-Host "Existing Dev Stack records for ${Purpose}:"
 for($i=0;$i -lt $choices.Count;$i++){Write-Host ('{0}: {1}' -f ($i+1),$choices[$i].name)}
 $selection=Read-Host 'Select the existing record number (blank stops)'
 $number=0
 if(-not [int]::TryParse($selection,[ref]$number) -or $number -lt 1 -or $number -gt $choices.Count){throw 'No explicit record selection'}
 return $choices[$number-1]
}
function Select-ExistingSecret($Record,[string]$Purpose){
 $slots=@()
 foreach($f in @($Record.fields)){if($null -ne $f -and -not [string]::IsNullOrWhiteSpace([string]$f.value)){$slots+=,[pscustomobject]@{label=('custom field: '+$f.name);value=[string]$f.value}}}
 if(-not [string]::IsNullOrWhiteSpace([string]$Record.login.password)){$slots+=,[pscustomobject]@{label='login password';value=[string]$Record.login.password}}
 if(-not [string]::IsNullOrWhiteSpace([string]$Record.notes)){$slots+=,[pscustomobject]@{label='secure note (only if the entire note is the token)';value=[string]$Record.notes}}
 if($slots.Count -eq 0){throw 'No existing secret slots'}
 Write-Host "Select the stored ${Purpose}. Values are hidden."
 for($i=0;$i -lt $slots.Count;$i++){Write-Host ('{0}: {1}' -f ($i+1),$slots[$i].label)}
 $selection=Read-Host 'Select the exact secret field number (blank stops)';$number=0
 if(-not [int]::TryParse($selection,[ref]$number) -or $number -lt 1 -or $number -gt $slots.Count){throw 'No explicit field selection'}
 return $slots[$number-1]
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
 $stage='existing Resend record and field selection'
 $resendCandidates=@($items|Where-Object {$_.name -match '(?i)resend' -or (@($_.login.uris|ForEach-Object {$_.uri}) -join ' ') -match '(?i)resend\.com' -or (@($_.fields|ForEach-Object {$_.name}) -join ' ') -match '(?i)resend'})
 $resendRecord=Select-ExistingRecord $resendCandidates 'Resend'
 $resendSecret=Select-ExistingSecret $resendRecord 'Resend API key used as SMTP password'
 if($resendSecret.value -cnotmatch '^re_[A-Za-z0-9_\-]+$'){throw 'Selected value is not a complete Resend API key'}
 $report.resendRecord=$resendRecord.name;$report.resendField=$resendSecret.label
 $stage='existing Supabase management credential selection'
 $supabaseCandidates=@($items|Where-Object {$_.name -match '(?i)supabase' -or (@($_.fields|ForEach-Object {$_.name}) -join ' ') -match '(?i)supabase.*(access|management).*token'})
 $supabaseRecord=Select-ExistingRecord $supabaseCandidates 'Supabase Management API access (not the database password or publishable/service-role key)'
 $supabaseSecret=Select-ExistingSecret $supabaseRecord 'Supabase personal/management access token'
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
 $stage='approved Resend sender domain verification'
 # This read verifies that the selected existing key belongs to a workspace
 # with the approved sending domain. A sending-only key may deny this read;
 # in that case stop for a separate workspace-domain check, never broaden it.
 $domains=Invoke-RestMethod -Uri 'https://api.resend.com/domains' -Headers @{Authorization='Bearer '+$resendSecret.value} -Method Get -TimeoutSec 30
 $approved=@($domains.data|Where-Object {$_.name -ceq 'acrux.co' -and $_.status -ceq 'verified'})
 if($approved.Count -ne 1){throw 'Approved sender domain not uniquely verified'}
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
