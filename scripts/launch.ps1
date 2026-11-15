# studier 学习工作台启动器
# 桌面快捷方式调用：powershell -NoProfile -ExecutionPolicy Bypass -File launch.ps1
#
# 设计说明（踩过的坑）：
#   1. DSH 的 web 服务在「隐藏窗口 + 重定向输出」下会启动不起来（端口一直不监听），
#      必须是真实控制台窗口 —— 所以这个脚本在前台跑 node，窗口关掉=服务停止。
#   2. 不要用 --no-open：让它自己把带 token 的 URL 交给默认浏览器，
#      这样不用去解析输出里那串每次启动都变的 token。
$ErrorActionPreference = 'Continue'

$root    = 'E:\studier'
$dshHome = Join-Path $root '.dsh-studier-home'
$bin     = Join-Path $dshHome 'profiles\web\node_modules\@deepseek-ai\dsh\lib\bin.js'
$node    = 'C:\Program Files\nodejs\node.exe'
$port    = 3080
$base    = "http://127.0.0.1:$port/"

function Test-Port {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $true }
  catch { return $false }
  finally { try { $client.Close() } catch {} }
}

Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '  studier 学习工作台' -ForegroundColor Cyan
Write-Host '  DSH 0.2.2-rc.1 + Notara 全套 + studier-kit' -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkCyan

if (-not (Test-Path $bin)) {
  Write-Host "找不到 DSH 入口：$bin" -ForegroundColor Red
  Write-Host "先跑体检修复：node `"$root\dsh-instance\repair.mjs`" --check" -ForegroundColor Yellow
  Read-Host '按回车关闭'
  exit 1
}
if (-not (Test-Path $node)) {
  Write-Host "找不到 node.exe：$node" -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}

if (Test-Port) {
  Write-Host '实例已经在运行了。' -ForegroundColor Green
  Write-Host '正在打开浏览器（如果提示未授权，说明当前浏览器没有这次的访问 token，' -ForegroundColor DarkGray
  Write-Host '请回到正在运行的那个窗口，用它打印出来的带 token 的地址）。' -ForegroundColor DarkGray
  Start-Process $base
  Start-Sleep -Seconds 2
  exit 0
}

Write-Host '正在启动服务，浏览器会自动打开…（本窗口就是服务进程，关掉它=停止服务）' -ForegroundColor Yellow
Write-Host ''

$env:DSH_HOME = $dshHome
Push-Location $root
try {
  & $node $bin web
}
finally {
  Pop-Location
}

$code = $LASTEXITCODE
Write-Host ''
if ($code -ne 0) {
  Write-Host "服务已退出（退出码 $code）。" -ForegroundColor Red
  Read-Host '按回车关闭'
} else {
  Write-Host '服务已正常停止。' -ForegroundColor Green
  Start-Sleep -Seconds 2
}
