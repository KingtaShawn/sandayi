$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$tmp = 'C:\Users\baicells\AppData\Local\Temp\edge-dbg'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$argline = '--headless=new --disable-gpu --no-first-run --no-default-browser-check --remote-debugging-port=9222 --user-data-dir=' + $tmp + ' --no-sandbox'
$proc = Start-Process -FilePath $edgePath -ArgumentList $argline -PassThru
Start-Sleep -Seconds 10
Write-Output ('HasExited: ' + $proc.HasExited)
$listen = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if ($listen) { Write-Output 'PORT-OK' } else { Write-Output 'PORT-FAIL' }
