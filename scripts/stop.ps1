# 停止 studier 学习工作台：只杀命令行里带 .dsh-studier-home 的 node 进程
$ErrorActionPreference = 'Continue'
$pattern = 'dsh-studier-home'
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$pattern*" }

if (-not $procs) {
  Write-Host "没有在运行中的 studier 实例。" -ForegroundColor Yellow
} else {
  foreach ($p in $procs) {
    Write-Host ("停止 PID {0}" -f $p.ProcessId) -ForegroundColor Cyan
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { Write-Host (" 失败：{0}" -f $_.Exception.Message) -ForegroundColor Red }
  }
  Start-Sleep -Milliseconds 700
  $left = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$pattern*" }
  if ($left) { Write-Host "还有进程没退出，稍等或手动检查。" -ForegroundColor Yellow }
  else { Write-Host "已停止。" -ForegroundColor Green }
}
Start-Sleep -Seconds 1
