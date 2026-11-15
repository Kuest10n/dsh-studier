# studier 学习工作台 —— 一键安装 / 体检（幂等，可重复跑）
#
#   双击桌面快捷方式之外，只有这一条是「换机器 / 重装」的入口：
#     powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Check      # 只体检，不动任何文件
#     powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1              # 装一遍（约 25 分钟，主要花在 pnpm install）
#     powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -SkipInstall # 依赖已装好，只重写配置 + 体检
#
# 参数：
#   -VaultRoot <path>   vault 根目录，默认 E:\studier\vault
#   -DshHome <path>     实例自己的 DSH_HOME，默认 E:\studier\.dsh-studier-home
#   -Force              覆盖已存在的 profile package.json / cordis.patch.yml
#   -Check              只体检（不写文件、不装依赖）

[CmdletBinding()]
param(
  [string]$VaultRoot = 'E:\studier\vault',
  [string]$DshHome = 'E:\studier\.dsh-studier-home',
  [switch]$Force,
  [switch]$SkipInstall,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
# 本脚本里所有 dsh CLI / adapter 调用都必须指向「这个实例」的 HOME，否则会去读桌面端那套
$env:DSH_HOME = $DshHome
$here = $PSScriptRoot
$repo = Split-Path -Parent $here
$kit = Join-Path $repo 'dsh-studier-kit'
$vendor = Join-Path $here 'vendor\notara-bundle'
$profileDir = Join-Path $DshHome 'profiles\web'
$profilePkg = Join-Path $profileDir 'package.json'
$rootPatch = Join-Path $DshHome 'cordis.patch.yml'
$dshVersion = '0.2.2-rc.1'

$notaraPackages = @(
  '@oh-my-student/plugin-presets',
  '@oh-my-student/plugin-vault-sqlite',
  '@oh-my-student/plugin-home-recommend',
  '@oh-my-student/plugin-vault-views',
  '@oh-my-student/plugin-graph-and-blocks',
  '@oh-my-student/plugin-pomodoro',
  '@oh-my-student/plugin-calendar'
)

$problems = New-Object System.Collections.Generic.List[string]
$actions = New-Object System.Collections.Generic.List[string]

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Ok($msg) { Say "  OK   $msg" 'Green' }
function Todo($msg) { Say "  TODO $msg" 'Yellow'; $actions.Add($msg) | Out-Null }
function Bad($msg) { Say "  BAD  $msg" 'Red'; $problems.Add($msg) | Out-Null }

Say ''
Say '=== studier 学习工作台 · 安装/体检 ===' 'Cyan'
Say "  仓库      $repo"
Say "  DSH_HOME  $DshHome"
Say "  vault     $VaultRoot"
Say "  模式      $(if ($Check) { '只体检（不写、不装）' } elseif ($SkipInstall) { '写配置 + 体检' } else { '完整安装' })"
Say ''

# --- 1. 前置：node 版本、三个目录 ---
Say '[1/7] 前置检查'
try {
  $nodeVersion = (& node --version).Trim()
  $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($major -ge 24) { Ok "node $nodeVersion（profile 要求 >=24）" }
  else { Bad "node $nodeVersion 太旧，profile 的 engines 要求 >=24" }
} catch { Bad ' 找不到 node，请先安装 Node.js 24+' }

if (Test-Path $kit) { Ok "kit 源码 $kit" } else { Bad "缺少 kit 源码：$kit" }
if (Test-Path $vendor) { Ok "Notara bundle 副本 $vendor" } else { Bad "缺少 Notara bundle：$vendor" }
if (Test-Path $VaultRoot) { Ok "vault 存在" } else { Bad "vault 不存在：$VaultRoot（-VaultRoot 指到真的学习库）" }
if ((Test-Path $VaultRoot) -and -not (Test-Path (Join-Path $VaultRoot '10知识'))) {
  Bad "vault 里没有 '10知识' 目录，路径可能指错了"
}

# --- 2. profile package.json ---
Say ''
Say '[2/7] profile 清单'
$profileJson = @"
{
  "name": "studier-web-profile",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "description": "studier 学习工作台专用瘦身 DSH web 实例（Notara 全功能 + dsh-studier-kit）",
  "dependencies": {
    "@deepseek-ai/dsh": "$dshVersion",
    "@deepseek-ai/dsh-client-ui-primitives": "$dshVersion",
    "@oh-my-student/dsh-bundle": "file:$($vendor -replace '\\','/')",
    "dsh-studier-kit": "link:$($kit -replace '\\','/')"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@oh-my-student/dsh-bundle",
        "dsh-studier-kit",
        "@deepseek-ai/dsh-experimental-agent-team-profile",
        "@deepseek-ai/dsh-experimental-auto-review",
        "@deepseek-ai/dsh-experimental-forge-bundle"
      ]
    }
  }
}
"@
if ((Test-Path $profilePkg) -and -not $Force) {
  Ok 'profile package.json 已存在（加 -Force 可重写）'
} elseif ($Check) {
  Todo "将写入 $profilePkg"
} else {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  [System.IO.File]::WriteAllText($profilePkg, $profileJson, (New-Object System.Text.UTF8Encoding($false)))
  Ok "已写入 $profilePkg"
}

# --- 3. $DSH_HOME\cordis.patch.yml（vault 根路径只能写这里）---
Say ''
Say '[3/7] vault 根路径（$DSH_HOME\cordis.patch.yml）'
$patchYaml = @"
# studier 实例根补丁：为 notara-vault-sqlite 注入 vault 根路径
# （pnpm 把 file: 依赖拷进 node_modules，改 vendor 副本不生效；这一层按 id 整行覆盖 bundle 的行）
- insert:
    - id: notara-vault-sqlite
      name: '@oh-my-student/plugin-vault-sqlite'
      config:
        root: '$VaultRoot'
"@
if ((Test-Path $rootPatch) -and -not $Force) {
  $current = Get-Content $rootPatch -Raw
  if ($current -match [regex]::Escape($VaultRoot)) { Ok "已指向 $VaultRoot" }
  else { Todo "$rootPatch 已存在但没指向 $VaultRoot（加 -Force 可重写）" }
} elseif ($Check) {
  Todo "将写入 $rootPatch（root = $VaultRoot）"
} else {
  New-Item -ItemType Directory -Force -Path $DshHome | Out-Null
  [System.IO.File]::WriteAllText($rootPatch, $patchYaml, (New-Object System.Text.UTF8Encoding($false)))
  Ok "已写入 $rootPatch"
}

# --- 4. 凭证 ---
Say ''
Say '[4/7] 模型凭证'
$cred = Join-Path $DshHome '.credentials.yaml'
$desktopCred = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (Test-Path $cred) {
  Ok '本实例已有 .credentials.yaml'
} elseif (Test-Path $desktopCred) {
  if ($Check) { Todo "将从桌面端复制 $desktopCred → $cred" }
  else {
    Copy-Item $desktopCred $cred
    Ok '已从桌面端复制 .credentials.yaml（内容未打印）'
  }
} else {
  Todo "没有凭证：把桌面端的 .credentials.yaml 拷到 $DshHome（或启动后在界面里配模型）"
}

# --- 5. pnpm install ---
Say ''
Say '[5/7] 依赖安装'
$nodeModules = Join-Path $profileDir 'node_modules'
if ($SkipInstall) {
  Ok '跳过（-SkipInstall）'
} elseif (Test-Path (Join-Path $nodeModules '@deepseek-ai\dsh')) {
  Ok '依赖已存在（要重装：删 node_modules 后不加 -SkipInstall 重跑）'
} elseif ($Check) {
  Todo '将执行 pnpm install --dir <profile>（约 25 分钟）'
} else {
  Say '  跑 pnpm install，这一步最慢（~25 分钟），失败先看是不是 registry 网络问题' 'Yellow'
  Push-Location $profileDir
  try {
    & pnpm install
    if ($LASTEXITCODE -ne 0) { Bad "pnpm install 退出码 $LASTEXITCODE" } else { Ok '依赖安装完成' }
  } finally { Pop-Location }
  # pnpm 10/11 会拦构建脚本，原生组件（node-pty/koffi）必须放行
  $ws = Join-Path $profileDir 'pnpm-workspace.yaml'
  if (-not (Test-Path $ws)) {
    $wsContent = @"
onlyBuiltDependencies:
  - '@deepseek-ai/dsh-subprocess-local'
  - '@google/genai'
  - koffi
  - node-pty
  - protobufjs
"@
    [System.IO.File]::WriteAllText($ws, $wsContent, (New-Object System.Text.UTF8Encoding($false)))
    Ok '已写 pnpm-workspace.yaml（放行原生组件构建脚本）'
  }
  Push-Location $profileDir
  try { & pnpm rebuild 2>&1 | Out-Null; Ok 'pnpm rebuild 完成' } finally { Pop-Location }
}

# --- 6. 版本豁免（Notara 7 包钉 0.2.1-rc.4，宿主是 0.2.2-rc.1）---
Say ''
Say '[6/7] 版本豁免'
$bin = Join-Path $nodeModules '@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path $bin)) {
  Todo '宿主未安装，跳过豁免（装完依赖后重跑本脚本）'
} else {
  $existing = & node $bin plugin --profile web version-exemptions 2>&1 | Out-String
  $missing = @($notaraPackages | Where-Object { $existing -notmatch [regex]::Escape($_) })
  if ($existing -match [regex]::Escape($dshVersion)) { Ok "豁免表里已有 $dshVersion" }
  if ($missing.Count -eq 0) {
    Ok "7 个 Notara 包豁免已就位"
  } elseif ($Check) {
    Todo "将给 $($missing.Count) 个包授豁免（$dshVersion）：$($missing -join ', ')"
  } else {
    $granted = 0
    foreach ($pkg in $missing) {
      & node $bin plugin --profile web allow-version "$pkg@0.1.1" --dsh-version $dshVersion --accept-risk 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $granted++ } else { Bad "豁免失败：$pkg" }
    }
    Ok "新授豁免 $granted 项"
  }
}

# --- 7. 缺件手术 + host 补丁 + skills junction ---
Say ''
Say '[7/7] 实例体检/修复（repair.mjs）'
$repair = Join-Path $here 'repair.mjs'
if (-not (Test-Path $repair)) {
  Bad "缺少 repair.mjs：$repair"
} elseif ($Check) {
  & node $repair --check --dsh-home $DshHome
  if ($LASTEXITCODE -ne 0) { Bad 'repair.mjs --check 报告异常（见上）' }
} else {
  & node $repair --dsh-home $DshHome
  if ($LASTEXITCODE -ne 0) { Bad 'repair.mjs 修复失败（见上）' }
}

# --- 汇总 ---
Say ''
Say '=== 结果 ===' 'Cyan'
if ($problems.Count -eq 0 -and $actions.Count -eq 0) {
  Say '  全部就绪。启动：双击桌面「studier 学习工作台」（或 powershell -File launch.ps1）' 'Green'
} else {
  if ($problems.Count) { Say "  阻断项 $($problems.Count) 个：" 'Red'; $problems | ForEach-Object { Say "    - $_" 'Red' } }
  if ($actions.Count) { Say "  待办 $($actions.Count) 项：" 'Yellow'; $actions | ForEach-Object { Say "    - $_" 'Yellow' } }
}
Say ''
if ($problems.Count -gt 0) { exit 1 } else { exit 0 }
