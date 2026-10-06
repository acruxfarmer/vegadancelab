# Run only in Joe's existing private unlocked Bitwarden PowerShell.
# Reuses established records. No secret output/files; no send or deploy.
[CmdletBinding()] param()
$ErrorActionPreference='Stop';$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue';Set-PSDebug -Off
$priorDebug=$env:BITWARDENCLI_DEBUG;$env:BITWARDENCLI_DEBUG='false'
$stage='private vault session';$report=[ordered]@{status='blocked';serviceId='srv-dao5cjbm8hqs73db51j0';provider='Resend';deliveryEnabled=$false;sent=0;secretsDisplayed=$false}
function ExactSecret($items,[string]$record,[string]$field){
 $records=@($items|Where-Object {$_.name -ceq $record -and -not $_.deletedDate})
 if($records.Count -ne 1){throw 'Established record not unique'}
 $fields=@($records[0].fields|Where-Object name -CEQ $field)
 if($fields.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$fields[0].value)){throw 'Established secret field not unique'}
 return [string]$fields[0].value
}
try{
 $bw='C:/Users/Joe Graham/Tools/BitwardenCLI/bw.exe'
 $raw=& $bw status --nointeraction 2>$null
 if($LASTEXITCODE -ne 0 -or ($raw|ConvertFrom-Json).status -cne 'unlocked'){throw 'Private unlocked session required'}
 $raw=& $bw list folders --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Folder lookup failed'}
 $folders=@(($raw|ConvertFrom-Json)|Where-Object name -CEQ 'Dev Stack')
 if($folders.Count -ne 1){throw 'Folder not unique'}
 $raw=& $bw list items --folderid $folders[0].id --nointeraction 2>$null
 if($LASTEXITCODE -ne 0){throw 'Record lookup failed'}
 $items=@(($raw|ConvertFrom-Json)|Where-Object {$_.folderId -ceq $folders[0].id -and -not $_.deletedDate});$raw=$null
 $resend=ExactSecret $items 'Vega Dev - Resend' 'RESEND_API_KEY'
 $render=ExactSecret $items 'Vega Dev - Render Operator' 'RENDER_API_KEY'
 if($resend -cnotmatch '^re_[A-Za-z0-9_-]+$'){throw 'Existing Resend key invalid'}
 $headers=@{Authorization='Bearer '+$render};$base='https://api.render.com/v1/services/srv-dao5cjbm8hqs73db51j0'
 $stage='Development service identity'
 $service=Invoke-RestMethod -Uri $base -Headers $headers -TimeoutSec 30
 if($service.id -cne 'srv-dao5cjbm8hqs73db51j0' -or $service.name -cne 'vega-development-web' -or $service.ownerId -cne 'tea-dand3tajnfac7387vm30' -or $service.environmentId -cne 'evm-dao55pijnfac73akca10'){throw 'Development service identity mismatch'}
 $stage='disable unattended booking email delivery'
 $null=Invoke-RestMethod -Uri ($base+'/env-vars/BOOKING_EMAIL_DELIVERY') -Headers $headers -Method Put -ContentType 'application/json' -Body '{"value":"disabled"}' -TimeoutSec 30
 $stage='install existing sending credential'
 $body=@{value=$resend}|ConvertTo-Json -Compress
 $null=Invoke-RestMethod -Uri ($base+'/env-vars/RESEND_API_KEY') -Headers $headers -Method Put -ContentType 'application/json' -Body $body -TimeoutSec 30
 $body=$null
 $stage='private readback verification'
 $check=Invoke-RestMethod -Uri ($base+'/env-vars/RESEND_API_KEY') -Headers $headers -TimeoutSec 30
 $flag=Invoke-RestMethod -Uri ($base+'/env-vars/BOOKING_EMAIL_DELIVERY') -Headers $headers -TimeoutSec 30
 if($check.value -cne $resend -or $flag.value -cne 'disabled'){throw 'Readback mismatch'}
 $report.status='configured';$report.resendRecord='Vega Dev - Resend';$report.resendField='RESEND_API_KEY';$report.permission='Existing Sending access unchanged'
 Write-Host 'Existing Resend credential configured for Development. Delivery remains disabled. No email sent. Astra can continue the authorized one-message test.'
}catch{
 $report.stage=$stage
 if($null -ne $_.Exception.Response){$report.httpStatus=[int]$_.Exception.Response.StatusCode}
 Write-Host ('Stopped at '+$stage+'. No secret values displayed. Review the non-secret result with Astra.')
}finally{
 $report.checkedAt=[DateTime]::UtcNow.ToString('o')
 $report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/layer-4/booking-email-credential-result.json') -Encoding utf8
 $env:BITWARDENCLI_DEBUG=$priorDebug
 $raw=$null;$folders=$null;$items=$null;$resend=$null;$render=$null;$headers=$null;$body=$null;$check=$null;$flag=$null
}
