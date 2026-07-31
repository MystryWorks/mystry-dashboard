Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Normalize-ProcessPath {
  $variables = [Environment]::GetEnvironmentVariables('Process')
  $pathKeys = @($variables.Keys | Where-Object {
    ([string]$_).Equals('path', [StringComparison]::OrdinalIgnoreCase)
  })
  if ($pathKeys.Count -le 1) { return }

  $entries = New-Object Collections.Generic.List[string]
  foreach ($key in $pathKeys) {
    foreach ($entry in ([string]$variables[$key] -split ';')) {
      $trimmed = $entry.Trim()
      $alreadyExists = $entries | Where-Object {
        $_.Equals($trimmed, [StringComparison]::OrdinalIgnoreCase)
      }
      if ($trimmed -and -not $alreadyExists) {
        $entries.Add($trimmed)
      }
    }
    [Environment]::SetEnvironmentVariable([string]$key, $null, 'Process')
  }
  [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'Process')
}

Normalize-ProcessPath

$script:ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:EnvPath = Join-Path $script:ProjectRoot '.env'
$script:EnvExamplePath = Join-Path $script:ProjectRoot '.env.example'
$script:LauncherDir = if ($env:MMD_PANEL_MANAGER_LAUNCHER_DIR) {
  [IO.Path]::GetFullPath($env:MMD_PANEL_MANAGER_LAUNCHER_DIR)
} else {
  Join-Path $script:ProjectRoot 'data\launcher'
}
$script:LogDir = Join-Path $script:LauncherDir 'logs'
$script:StatePath = Join-Path $script:LauncherDir 'state.json'
$script:SettingsPath = Join-Path $script:LauncherDir 'settings.json'
$script:StdoutLog = Join-Path $script:LogDir 'panel.stdout.log'
$script:StderrLog = Join-Path $script:LogDir 'panel.stderr.log'
$script:ServerEntry = Join-Path $script:ProjectRoot 'apps\server\dist\index.js'
$script:SetupStatusScript = Join-Path $PSScriptRoot 'setup-status.cjs'
$script:Language = 'en-US'
$script:EnvBackupPath = ''

$script:Resources = @{
  'zh-CN' = @{
    Title = 'Minecraft Mystery Dashboard 面板管理器'
    StateRunning = '状态：正在运行  {0}'
    StateStopped = '状态：未运行'
    MenuStopped = @(
      '[1] 后台启动面板（直接回车）',
      '[2] 前台启动并查看日志',
      '[3] 安装依赖并重新构建',
      '[4] 查看最近日志',
      '[L] 切换到 English',
      '[0] 退出'
    )
    MenuRunning = @(
      '[1] 打开管理页面（直接回车）',
      '[2] 查看实时日志',
      '[3] 重启面板',
      '[4] 优雅停止面板',
      '[5] 重新构建并重启',
      '[L] 切换到 English',
      '[0] 退出'
    )
    SelectAction = '请选择操作'
    InvalidAction = '无法识别该操作。'
    AnotherManager = '另一个 PanelManager 正在运行，请稍后再试。'
    CheckingEnvironment = '正在检查运行环境…'
    NodeMissing = '未找到 Node.js。请先安装 Node.js 22 或更高版本：https://nodejs.org/'
    NodeTooOld = 'Node.js 版本过低：{0}。本项目要求 22 或更高版本。'
    NpmMissing = '未找到 npm.cmd，请修复 Node.js 安装。'
    JavaMissing = '警告：未找到 Java。面板可以启动，但 Minecraft 实例无法启动。'
    JavaFound = 'Java 已检测到。'
    Installing = '正在根据 package-lock.json 安装依赖，这可能需要几分钟…'
    InstallFailed = '依赖安装失败，请检查上方 npm 输出和网络连接。'
    Building = '正在构建 shared、server 和 web…'
    BuildFailed = '项目构建失败，不会启动旧的构建产物。'
    DependenciesReady = '依赖无需重新安装。'
    BuildReady = '构建产物已是最新。'
    EnvCreated = '已从 .env.example 创建 .env。'
    JwtGenerated = '已生成 JWT_SECRET。'
    LauncherGenerated = '已生成 LAUNCHER_TOKEN。'
    SetupGenerated = '已生成首次初始化令牌。'
    SecretRepaired = '{0} 格式无效；原配置已备份到 {1}，并已自动生成新值。'
    SecretInvalid = '{0} 必须是 64 位十六进制字符串；为保护已有配置，管理器没有覆盖它。'
    SecretDuplicate = '{0} 不能与 {1} 相同；为保护进程环境变量，管理器没有覆盖它。'
    SecretSeparated = '{0} 与 {1} 重复；原配置已备份到 {2}，并已自动生成不同的新值。'
    DatabaseCheckFailed = '无法检查管理员初始化状态：{0}'
    StartingBackground = '正在后台启动面板…'
    StartingForeground = '正在前台启动面板。按 Ctrl+C 将安全停止面板。'
    Started = '面板已启动：{0}'
    AlreadyRunning = '面板已经运行，正在打开管理页面。'
    StartupFailed = '面板未能在规定时间内启动。最近的错误日志：'
    PortBusy = '端口 {0} 已被其他程序占用，或者运行的是无法识别的旧版面板。'
    OpeningBrowser = '正在打开管理页面：{0}'
    SetupCopied = '首次初始化令牌已复制到剪贴板，请粘贴到“初始化令牌”输入框。'
    SetupClipboardFailed = '无法写入剪贴板，请从 .env 中复制 SETUP_TOKEN。'
    SetupCleaned = '管理员初始化完成，已清理 SETUP_TOKEN。'
    Stopping = '正在安全停止面板：实例 {0} 个，运行任务 {1} 个，排队任务 {2} 个…'
    Stopped = '面板已安全停止。'
    StopFailed = '无法通过安全关闭接口停止面板：{0}'
    StopTimeout = '等待面板停止超时。不会强制杀死进程，请检查日志。'
    NotRunning = '面板当前没有运行。'
    Restarting = '正在重启面板…'
    RebuildOnlyDone = '依赖安装和项目构建已完成。'
    LiveLogs = '正在新窗口中打开实时日志。'
    NoLogs = '还没有可查看的日志。'
    RecentStdout = '--- 最近的标准输出 ---'
    RecentStderr = '--- 最近的错误输出 ---'
    TailHint = '实时日志窗口：按 Ctrl+C 或关闭窗口即可退出；不会停止面板。'
    LanguageSaved = '语言已切换为简体中文。'
    StatusPid = '进程 PID：{0}'
    UnknownCommand = '未知命令：{0}'
    SupportedCommands = '支持：start, foreground, stop, restart, logs, rebuild, status'
    PressEnter = '按回车返回…'
    PressAnyKeyExit = '按任意键关闭窗口…'
  }
  'en-US' = @{
    Title = 'Minecraft Mystery Dashboard Panel Manager'
    StateRunning = 'Status: Running  {0}'
    StateStopped = 'Status: Stopped'
    MenuStopped = @(
      '[1] Start Panel in Background (Enter)',
      '[2] Start in Foreground and View Logs',
      '[3] Install Dependencies and Rebuild',
      '[4] View Recent Logs',
      '[L] Switch to Simplified Chinese',
      '[0] Exit'
    )
    MenuRunning = @(
      '[1] Open Dashboard (Enter)',
      '[2] View Live Logs',
      '[3] Restart Panel',
      '[4] Stop Panel Safely',
      '[5] Rebuild and Restart',
      '[L] Switch to Simplified Chinese',
      '[0] Exit'
    )
    SelectAction = 'Select an action'
    InvalidAction = 'The selected action is not recognized.'
    AnotherManager = 'Another PanelManager process is running. Please try again later.'
    CheckingEnvironment = 'Checking runtime prerequisites…'
    NodeMissing = 'Node.js was not found. Install Node.js 22 or newer first: https://nodejs.org/'
    NodeTooOld = 'Node.js is too old: {0}. This project requires version 22 or newer.'
    NpmMissing = 'npm.cmd was not found. Repair the Node.js installation.'
    JavaMissing = 'Warning: Java was not found. The panel can start, but Minecraft instances cannot.'
    JavaFound = 'Java was detected.'
    Installing = 'Installing dependencies from package-lock.json. This may take a few minutes…'
    InstallFailed = 'Dependency installation failed. Check the npm output and network connection above.'
    Building = 'Building shared, server, and web…'
    BuildFailed = 'The build failed. An older build will not be started.'
    DependenciesReady = 'Dependencies are already up to date.'
    BuildReady = 'Build output is already up to date.'
    EnvCreated = 'Created .env from .env.example.'
    JwtGenerated = 'Generated JWT_SECRET.'
    LauncherGenerated = 'Generated LAUNCHER_TOKEN.'
    SetupGenerated = 'Generated the initial setup token.'
    SecretRepaired = '{0} was invalid. The old configuration was backed up to {1}, and a new value was generated.'
    SecretInvalid = '{0} must be a 64-character hexadecimal value. The existing value was not overwritten.'
    SecretDuplicate = '{0} must differ from {1}. The process environment value was not overwritten.'
    SecretSeparated = '{0} duplicated {1}. The old configuration was backed up to {2}, and a different value was generated.'
    DatabaseCheckFailed = 'Unable to check administrator setup state: {0}'
    StartingBackground = 'Starting the panel in the background…'
    StartingForeground = 'Starting in the foreground. Press Ctrl+C to stop the panel safely.'
    Started = 'Panel started: {0}'
    AlreadyRunning = 'The panel is already running. Opening the dashboard.'
    StartupFailed = 'The panel did not start in time. Latest error output:'
    PortBusy = 'Port {0} is occupied by another program or an unrecognized older panel.'
    OpeningBrowser = 'Opening dashboard: {0}'
    SetupCopied = 'The setup token was copied to the clipboard. Paste it into the Setup Token field.'
    SetupClipboardFailed = 'Unable to write to the clipboard. Copy SETUP_TOKEN from .env.'
    SetupCleaned = 'Administrator setup completed. SETUP_TOKEN was removed.'
    Stopping = 'Stopping safely: {0} instance(s), {1} running task(s), {2} queued task(s)…'
    Stopped = 'The panel stopped safely.'
    StopFailed = 'Unable to stop the panel through the safe shutdown endpoint: {0}'
    StopTimeout = 'Timed out waiting for shutdown. The process will not be force-killed; check the logs.'
    NotRunning = 'The panel is not running.'
    Restarting = 'Restarting the panel…'
    RebuildOnlyDone = 'Dependencies were installed and the project was rebuilt.'
    LiveLogs = 'Opening live logs in a new window.'
    NoLogs = 'No logs are available yet.'
    RecentStdout = '--- Recent standard output ---'
    RecentStderr = '--- Recent error output ---'
    TailHint = 'Live log window: press Ctrl+C or close the window to exit. The panel will keep running.'
    LanguageSaved = 'Language switched to English.'
    StatusPid = 'Process PID: {0}'
    UnknownCommand = 'Unknown command: {0}'
    SupportedCommands = 'Supported: start, foreground, stop, restart, logs, rebuild, status'
    PressEnter = 'Press Enter to return…'
    PressAnyKeyExit = 'Press any key to close this window…'
  }
}

function Get-Message {
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Key,
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][object[]]$Values
  )
  $text = $script:Resources[$script:Language][$Key]
  if ($null -eq $text) { return $Key }
  $formattedValues = [object[]]$Values
  if ($null -ne $formattedValues -and $formattedValues.Length -gt 0) {
    return [string]::Format([string]$text, $formattedValues)
  }
  return $text
}

function Write-Manager {
  param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Key,
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][object[]]$Values
  )
  Write-Host (Get-Message $Key @Values)
}

function Ensure-LauncherDirectories {
  [IO.Directory]::CreateDirectory($script:LauncherDir) | Out-Null
  [IO.Directory]::CreateDirectory($script:LogDir) | Out-Null
}

function Write-Utf8Lines {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$Lines
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Read-JsonMap {
  param([Parameter(Mandatory = $true)][string]$Path)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  try {
    $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $value.PSObject.Properties) {
      $map[$property.Name] = $property.Value
    }
  } catch {
    return @{}
  }
  return $map
}

function Write-JsonMap {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Value
  )
  Ensure-LauncherDirectories
  $json = $Value | ConvertTo-Json -Depth 5
  Write-Utf8Lines -Path $Path -Lines @($json)
}

function Parse-ManagerArguments {
  param([string[]]$InputArguments)
  $result = @{ Command = ''; Language = ''; Error = '' }
  for ($index = 0; $index -lt $InputArguments.Count; $index++) {
    $item = $InputArguments[$index]
    if ($item -eq '--lang') {
      if ($index + 1 -ge $InputArguments.Count) {
        $result.Error = '--lang requires zh-CN or en-US'
        break
      }
      $index += 1
      $result.Language = $InputArguments[$index]
    } elseif ($item -like '--lang=*') {
      $result.Language = $item.Substring(7)
    } elseif ([string]::IsNullOrWhiteSpace([string]$result.Command)) {
      $result.Command = $item.ToLowerInvariant()
    } else {
      $result.Error = "Unexpected argument: $item"
      break
    }
  }
  return $result
}

function Initialize-Language {
  param([string]$Override)
  if ($Override -in @('zh-CN', 'en-US')) {
    $script:Language = $Override
    return
  }
  $settings = Read-JsonMap $script:SettingsPath
  if ($settings.ContainsKey('language') -and $settings.language -in @('zh-CN', 'en-US')) {
    $script:Language = [string]$settings.language
    return
  }
  $uiCulture = [Globalization.CultureInfo]::CurrentUICulture.Name
  $script:Language = if ($uiCulture.StartsWith('zh-', [StringComparison]::OrdinalIgnoreCase)) {
    'zh-CN'
  } else {
    'en-US'
  }
}

function Switch-Language {
  $script:Language = if ($script:Language -eq 'zh-CN') { 'en-US' } else { 'zh-CN' }
  Write-JsonMap -Path $script:SettingsPath -Value @{ language = $script:Language }
  Write-Manager 'LanguageSaved'
}

function Read-EnvMap {
  $map = @{}
  if (-not (Test-Path -LiteralPath $script:EnvPath)) { return $map }
  foreach ($line in [IO.File]::ReadAllLines($script:EnvPath)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
      $value = $matches[2].Trim()
      $doubleQuoted = $value.Length -ge 2 `
        -and $value[0] -eq '"' `
        -and $value[$value.Length - 1] -eq '"'
      $singleQuoted = $value.Length -ge 2 `
        -and $value[0] -eq "'" `
        -and $value[$value.Length - 1] -eq "'"
      if ($doubleQuoted -or $singleQuoted) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $map[$matches[1]] = $value
    }
  }
  # 与 dotenv 默认行为保持一致：当前进程环境变量优先于 .env。
  foreach ($name in @('HOST', 'PORT', 'DATA_DIR', 'JWT_SECRET', 'SETUP_TOKEN', 'LAUNCHER_TOKEN')) {
    $processValue = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($null -ne $processValue) { $map[$name] = $processValue }
  }
  return $map
}

function Set-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $lines = [Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $script:EnvPath) {
    $lines.AddRange([string[]][IO.File]::ReadAllLines($script:EnvPath))
  }
  $pattern = '^\s*' + [Regex]::Escape($Name) + '\s*='
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  Write-Utf8Lines -Path $script:EnvPath -Lines ([string[]]$lines)
}

function Remove-EnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Test-Path -LiteralPath $script:EnvPath)) { return }
  $pattern = '^\s*' + [Regex]::Escape($Name) + '\s*='
  $lines = @([IO.File]::ReadAllLines($script:EnvPath) | Where-Object { $_ -notmatch $pattern })
  Write-Utf8Lines -Path $script:EnvPath -Lines $lines
}

function New-RandomHex {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Test-ValidSecret {
  param([AllowEmptyString()][string]$Value)
  return $Value -match '^[0-9a-fA-F]{64}$'
}

function Backup-EnvironmentOnce {
  if ($script:EnvBackupPath) { return $script:EnvBackupPath }
  $backupDirectory = Join-Path $script:LauncherDir 'config-backups'
  [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
  $backupName = 'env-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '.bak'
  $script:EnvBackupPath = Join-Path $backupDirectory $backupName
  Copy-Item -LiteralPath $script:EnvPath -Destination $script:EnvBackupPath
  return $script:EnvBackupPath
}

function Repair-InvalidFileSecret {
  param([Parameter(Mandatory = $true)][string]$Name)
  $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($null -ne $processValue) {
    throw (Get-Message 'SecretInvalid' $Name)
  }
  $backupPath = Backup-EnvironmentOnce
  Set-EnvValue $Name (New-RandomHex)
  Write-Manager 'SecretRepaired' $Name $backupPath
}

function Repair-DuplicateFileSecret {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$OtherName,
    [Parameter(Mandatory = $true)][hashtable]$Environment
  )
  $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($null -ne $processValue) {
    throw (Get-Message 'SecretDuplicate' $Name $OtherName)
  }
  $backupPath = Backup-EnvironmentOnce
  do {
    $replacement = New-RandomHex
  } while ($Environment.Values -contains $replacement)
  Set-EnvValue $Name $replacement
  Write-Manager 'SecretSeparated' $Name $OtherName $backupPath
}

function Assert-Secret {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][string]$Value
  )
  if (-not (Test-ValidSecret $Value)) {
    throw (Get-Message 'SecretInvalid' $Name)
  }
}

function Get-DataDirectory {
  param([hashtable]$Environment)
  $configured = if ($Environment.ContainsKey('DATA_DIR') -and $Environment.DATA_DIR) {
    [string]$Environment.DATA_DIR
  } else {
    'data'
  }
  if ([IO.Path]::IsPathRooted($configured)) {
    return [IO.Path]::GetFullPath($configured)
  }
  return [IO.Path]::GetFullPath((Join-Path $script:ProjectRoot $configured))
}

function Test-NeedsSetup {
  param([hashtable]$Environment)
  $databasePath = Join-Path (Get-DataDirectory $Environment) 'panel.db'
  if (-not (Test-Path -LiteralPath $databasePath)) { return $true }
  try {
    $result = & node.exe --no-warnings --experimental-sqlite $script:SetupStatusScript $databasePath
    if ($LASTEXITCODE -ne 0) { throw "node exit code $LASTEXITCODE" }
    return ([string]$result).Trim() -eq '1'
  } catch {
    throw (Get-Message 'DatabaseCheckFailed' $_.Exception.Message)
  }
}

function Ensure-EnvironmentConfiguration {
  if (-not (Test-Path -LiteralPath $script:EnvPath)) {
    if (-not (Test-Path -LiteralPath $script:EnvExamplePath)) {
      throw '.env.example was not found.'
    }
    Copy-Item -LiteralPath $script:EnvExamplePath -Destination $script:EnvPath
    Write-Manager 'EnvCreated'
  }

  $environment = Read-EnvMap
  if (-not $environment.ContainsKey('JWT_SECRET') -or [string]::IsNullOrWhiteSpace($environment.JWT_SECRET)) {
    Set-EnvValue 'JWT_SECRET' (New-RandomHex)
    Write-Manager 'JwtGenerated'
    $environment = Read-EnvMap
  } elseif (-not (Test-ValidSecret ([string]$environment.JWT_SECRET))) {
    Repair-InvalidFileSecret 'JWT_SECRET'
    $environment = Read-EnvMap
  } else {
    Assert-Secret 'JWT_SECRET' ([string]$environment.JWT_SECRET)
  }

  $launcherTokenMissing = -not $environment.ContainsKey('LAUNCHER_TOKEN') `
    -or [string]::IsNullOrWhiteSpace($environment.LAUNCHER_TOKEN)
  if ($launcherTokenMissing) {
    Set-EnvValue 'LAUNCHER_TOKEN' (New-RandomHex)
    Write-Manager 'LauncherGenerated'
    $environment = Read-EnvMap
  } elseif (-not (Test-ValidSecret ([string]$environment.LAUNCHER_TOKEN))) {
    Repair-InvalidFileSecret 'LAUNCHER_TOKEN'
    $environment = Read-EnvMap
  } else {
    Assert-Secret 'LAUNCHER_TOKEN' ([string]$environment.LAUNCHER_TOKEN)
  }
  if ([string]$environment.JWT_SECRET -eq [string]$environment.LAUNCHER_TOKEN) {
    Repair-DuplicateFileSecret 'LAUNCHER_TOKEN' 'JWT_SECRET' $environment
    $environment = Read-EnvMap
  }

  $needsSetup = Test-NeedsSetup $environment
  if ($needsSetup) {
    $setupTokenMissing = -not $environment.ContainsKey('SETUP_TOKEN') `
      -or [string]::IsNullOrWhiteSpace($environment.SETUP_TOKEN)
    if ($setupTokenMissing) {
      Set-EnvValue 'SETUP_TOKEN' (New-RandomHex)
      Write-Manager 'SetupGenerated'
      $environment = Read-EnvMap
    } elseif (-not (Test-ValidSecret ([string]$environment.SETUP_TOKEN))) {
      Repair-InvalidFileSecret 'SETUP_TOKEN'
      $environment = Read-EnvMap
    } else {
      Assert-Secret 'SETUP_TOKEN' ([string]$environment.SETUP_TOKEN)
    }
    if ([string]$environment.SETUP_TOKEN -eq [string]$environment.JWT_SECRET) {
      Repair-DuplicateFileSecret 'SETUP_TOKEN' 'JWT_SECRET' $environment
      $environment = Read-EnvMap
    } elseif ([string]$environment.SETUP_TOKEN -eq [string]$environment.LAUNCHER_TOKEN) {
      Repair-DuplicateFileSecret 'SETUP_TOKEN' 'LAUNCHER_TOKEN' $environment
      $environment = Read-EnvMap
    }
  } elseif ($environment.ContainsKey('SETUP_TOKEN')) {
    Remove-EnvValue 'SETUP_TOKEN'
    $environment = Read-EnvMap
  }
  return @{ Environment = $environment; NeedsSetup = $needsSetup }
}

function Get-StringHash {
  param([Parameter(Mandatory = $true)][string]$Value)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-SourceFingerprint {
  $files = New-Object Collections.Generic.List[IO.FileInfo]
  foreach ($relative in @('package.json', 'package-lock.json')) {
    $path = Join-Path $script:ProjectRoot $relative
    if (Test-Path -LiteralPath $path) { $files.Add((Get-Item -LiteralPath $path)) }
  }
  foreach ($pattern in @('apps\*\package.json', 'apps\*\tsconfig*.json', 'packages\*\package.json', 'packages\*\tsconfig*.json')) {
    foreach ($file in Get-ChildItem -Path (Join-Path $script:ProjectRoot $pattern) -File -ErrorAction SilentlyContinue) {
      $files.Add($file)
    }
  }
  foreach ($relative in @('apps\server\src', 'apps\web\src', 'packages\shared\src')) {
    $path = Join-Path $script:ProjectRoot $relative
    if (Test-Path -LiteralPath $path) {
      foreach ($file in Get-ChildItem -LiteralPath $path -File -Recurse) { $files.Add($file) }
    }
  }
  foreach ($relative in @('apps\web\index.html', 'apps\web\vite.config.ts')) {
    $path = Join-Path $script:ProjectRoot $relative
    if (Test-Path -LiteralPath $path) { $files.Add((Get-Item -LiteralPath $path)) }
  }
  $parts = foreach ($file in $files | Sort-Object FullName -Unique) {
    $relativePath = $file.FullName.Substring($script:ProjectRoot.Length).TrimStart('\', '/')
    "$relativePath|$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
  }
  return Get-StringHash ($parts -join "`n")
}

function Assert-Prerequisites {
  Write-Manager 'CheckingEnvironment'
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw (Get-Message 'NodeMissing') }
  $nodeVersionText = [string](& node.exe --version)
  if ($LASTEXITCODE -ne 0) { throw (Get-Message 'NodeMissing') }
  $nodeVersion = [version]$nodeVersionText.Trim().TrimStart('v')
  if ($nodeVersion.Major -lt 22) {
    throw (Get-Message 'NodeTooOld' $nodeVersionText.Trim())
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw (Get-Message 'NpmMissing')
  }
  if (Get-Command java.exe -ErrorAction SilentlyContinue) {
    Write-Manager 'JavaFound'
  } else {
    Write-Warning (Get-Message 'JavaMissing')
  }
}

function Test-BuildOutput {
  return (Test-Path -LiteralPath (Join-Path $script:ProjectRoot 'packages\shared\dist\index.js')) `
    -and (Test-Path -LiteralPath $script:ServerEntry) `
    -and (Test-Path -LiteralPath (Join-Path $script:ProjectRoot 'apps\web\dist\index.html'))
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessageKey
  )
  Push-Location $script:ProjectRoot
  try {
    & npm.cmd @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw (Get-Message $FailureMessageKey) }
  } finally {
    Pop-Location
  }
}

function Prepare-Project {
  param(
    [switch]$ForceInstall,
    [switch]$ForceBuild
  )
  Assert-Prerequisites
  Ensure-LauncherDirectories
  $configuration = Ensure-EnvironmentConfiguration
  $state = Read-JsonMap $script:StatePath
  $lockPath = Join-Path $script:ProjectRoot 'package-lock.json'
  $dependencyHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $dependencyChanged = -not $state.ContainsKey('dependencyHash') `
    -or [string]$state.dependencyHash -ne $dependencyHash
  if ($ForceInstall -or -not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot 'node_modules')) -or $dependencyChanged) {
    Write-Manager 'Installing'
    Invoke-Npm -Arguments @('ci') -FailureMessageKey 'InstallFailed'
    $state['dependencyHash'] = $dependencyHash
  } else {
    Write-Manager 'DependenciesReady'
  }

  $sourceHash = Get-SourceFingerprint
  $sourceChanged = -not $state.ContainsKey('sourceHash') -or [string]$state.sourceHash -ne $sourceHash
  if ($ForceBuild -or $sourceChanged -or -not (Test-BuildOutput)) {
    Write-Manager 'Building'
    Invoke-Npm -Arguments @('run', 'build') -FailureMessageKey 'BuildFailed'
    $state['sourceHash'] = $sourceHash
  } else {
    Write-Manager 'BuildReady'
  }
  Write-JsonMap -Path $script:StatePath -Value $state
  return $configuration
}

function Get-PanelConnection {
  $environment = Read-EnvMap
  $portText = if ($environment.ContainsKey('PORT') -and $environment.PORT) {
    [string]$environment.PORT
  } else {
    '3000'
  }
  $port = 0
  if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "PORT must be an integer between 1 and 65535: $portText"
  }
  $hostValue = if ($environment.ContainsKey('HOST') -and $environment.HOST) {
    [string]$environment.HOST
  } else {
    '127.0.0.1'
  }
  $browserHost = if ($hostValue -in @('0.0.0.0', '::', '[::]')) { '127.0.0.1' } else { $hostValue }
  return @{
    Environment = $environment
    Port = $port
    Url = "http://${browserHost}:$port"
    HealthUrl = "http://${browserHost}:$port/api/health"
    AuthStatusUrl = "http://${browserHost}:$port/api/auth/status"
    ShutdownUrl = "http://127.0.0.1:$port/api/launcher/shutdown"
  }
}

function Get-PanelHealth {
  try {
    $connection = Get-PanelConnection
    $response = Invoke-RestMethod -Uri $connection.HealthUrl -Method Get -TimeoutSec 2
    if ($response.ok -eq $true -and $response.service -eq 'minecraft-mystery-dashboard') {
      return $response
    }
  } catch {
    return $null
  }
  return $null
}

function Test-PortOpen {
  param([int]$Port)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Open-PanelBrowser {
  $connection = Get-PanelConnection
  Write-Manager 'OpeningBrowser' $connection.Url
  if ($env:MMD_PANEL_MANAGER_NO_BROWSER -eq '1') { return }
  Start-Process $connection.Url
}

function Save-ProcessState {
  param([Diagnostics.Process]$Process)
  $state = Read-JsonMap $script:StatePath
  $state['pid'] = $Process.Id
  $state['startedAt'] = [DateTime]::UtcNow.ToString('o')
  $state['url'] = (Get-PanelConnection).Url
  Write-JsonMap -Path $script:StatePath -Value $state
}

function Clear-ProcessState {
  $state = Read-JsonMap $script:StatePath
  $state.Remove('pid')
  $state.Remove('startedAt')
  $state.Remove('url')
  Write-JsonMap -Path $script:StatePath -Value $state
}

function Rotate-Logs {
  Ensure-LauncherDirectories
  foreach ($current in @($script:StdoutLog, $script:StderrLog)) {
    if (Test-Path -LiteralPath $current) {
      $previous = "$current.previous"
      Move-Item -LiteralPath $current -Destination $previous -Force
    }
  }
}

function Copy-SetupToken {
  $environment = Read-EnvMap
  if (-not $environment.ContainsKey('SETUP_TOKEN') -or -not $environment.SETUP_TOKEN) { return }
  if ($env:MMD_PANEL_MANAGER_NO_CLIPBOARD -eq '1') { return }
  try {
    Set-Clipboard -Value ([string]$environment.SETUP_TOKEN)
    Write-Manager 'SetupCopied'
  } catch {
    Write-Warning (Get-Message 'SetupClipboardFailed')
  }
  $quotedScript = '"' + $PSCommandPath.Replace('"', '\"') + '"'
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $quotedScript,
    '__finalize-setup',
    '--lang', $script:Language
  )
  Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}

function Wait-ForPanelStart {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 60
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $false }
    if ($null -ne (Get-PanelHealth)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Show-StartupFailure {
  Write-Warning (Get-Message 'StartupFailed')
  if (Test-Path -LiteralPath $script:StderrLog) {
    Get-Content -LiteralPath $script:StderrLog -Tail 40
  }
}

function Start-PanelBackground {
  param([hashtable]$Configuration)
  if ($null -ne (Get-PanelHealth)) {
    Write-Manager 'AlreadyRunning'
    Open-PanelBrowser
    return
  }
  $connection = Get-PanelConnection
  if (Test-PortOpen $connection.Port) {
    throw (Get-Message 'PortBusy' $connection.Port)
  }

  Rotate-Logs
  Write-Manager 'StartingBackground'
  $nodePath = (Get-Command node.exe).Source
  $entryArgument = '"' + $script:ServerEntry.Replace('"', '\"') + '"'
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('--experimental-sqlite', $entryArgument) `
    -WorkingDirectory $script:ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $script:StdoutLog `
    -RedirectStandardError $script:StderrLog `
    -PassThru
  Save-ProcessState $process

  if (-not (Wait-ForPanelStart -Process $process)) {
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    Clear-ProcessState
    Show-StartupFailure
    throw (Get-Message 'StartupFailed')
  }

  Write-Manager 'Started' $connection.Url
  Open-PanelBrowser
  if ($Configuration.NeedsSetup) { Copy-SetupToken }
}

function Invoke-SafeShutdown {
  if ($null -eq (Get-PanelHealth)) {
    Clear-ProcessState
    Write-Manager 'NotRunning'
    return
  }
  $connection = Get-PanelConnection
  $environment = $connection.Environment
  if (-not $environment.ContainsKey('LAUNCHER_TOKEN')) {
    throw (Get-Message 'StopFailed' 'LAUNCHER_TOKEN is missing')
  }
  Assert-Secret 'LAUNCHER_TOKEN' ([string]$environment.LAUNCHER_TOKEN)
  try {
    $response = Invoke-RestMethod `
      -Uri $connection.ShutdownUrl `
      -Method Post `
      -ContentType 'application/json' `
      -Body '{}' `
      -Headers @{ 'X-Launcher-Token' = [string]$environment.LAUNCHER_TOKEN } `
      -TimeoutSec 10
  } catch {
    throw (Get-Message 'StopFailed' $_.Exception.Message)
  }

  Write-Manager 'Stopping' $response.runningInstances $response.runningTasks $response.queuedTasks
  $timeoutSeconds = [Math]::Min(
    1800,
    60 + (20 * [int]$response.runningInstances) + (60 * [int]$response.runningTasks)
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq (Get-PanelHealth)) {
      Clear-ProcessState
      Write-Manager 'Stopped'
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw (Get-Message 'StopTimeout')
}

function Start-PanelForeground {
  param([hashtable]$Configuration)
  if ($null -ne (Get-PanelHealth)) {
    Write-Manager 'AlreadyRunning'
    Open-PanelBrowser
    return
  }
  $connection = Get-PanelConnection
  if (Test-PortOpen $connection.Port) {
    throw (Get-Message 'PortBusy' $connection.Port)
  }

  Write-Manager 'StartingForeground'
  $nodePath = (Get-Command node.exe).Source
  $entryArgument = '"' + $script:ServerEntry.Replace('"', '\"') + '"'
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('--experimental-sqlite', $entryArgument) `
    -WorkingDirectory $script:ProjectRoot `
    -NoNewWindow `
    -PassThru
  Save-ProcessState $process
  try {
    if (-not (Wait-ForPanelStart -Process $process)) {
      throw (Get-Message 'StartupFailed')
    }
    Write-Manager 'Started' $connection.Url
    Open-PanelBrowser
    if ($Configuration.NeedsSetup) { Copy-SetupToken }
    Wait-Process -Id $process.Id
  } finally {
    if ($null -ne (Get-PanelHealth)) {
      try { Invoke-SafeShutdown } catch { Write-Warning $_.Exception.Message }
    }
    Clear-ProcessState
  }
}

function Show-RecentLogs {
  $hasLogs = $false
  if (Test-Path -LiteralPath $script:StdoutLog) {
    $hasLogs = $true
    Write-Manager 'RecentStdout'
    Get-Content -LiteralPath $script:StdoutLog -Tail 100
  }
  if (Test-Path -LiteralPath $script:StderrLog) {
    $hasLogs = $true
    Write-Manager 'RecentStderr'
    Get-Content -LiteralPath $script:StderrLog -Tail 100
  }
  if (-not $hasLogs) { Write-Manager 'NoLogs' }
}

function Open-LiveLogs {
  if (-not (Test-Path -LiteralPath $script:StdoutLog) -and -not (Test-Path -LiteralPath $script:StderrLog)) {
    Write-Manager 'NoLogs'
    return
  }
  Write-Manager 'LiveLogs'
  $quotedScript = '"' + $PSCommandPath.Replace('"', '\"') + '"'
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $quotedScript,
    '__tail',
    '--lang', $script:Language
  )
  Start-Process powershell.exe -ArgumentList $arguments | Out-Null
}

function Invoke-FinalizeSetup {
  $connection = Get-PanelConnection
  $environment = $connection.Environment
  if (-not $environment.ContainsKey('SETUP_TOKEN') -or -not $environment.SETUP_TOKEN) { return }
  $token = [string]$environment.SETUP_TOKEN
  $deadline = [DateTime]::UtcNow.AddMinutes(30)
  $consecutiveFailures = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $status = Invoke-RestMethod -Uri $connection.AuthStatusUrl -Method Get -TimeoutSec 2
      $consecutiveFailures = 0
      if ($status.needsSetup -eq $false) {
        Remove-EnvValue 'SETUP_TOKEN'
        try {
          if ([string](Get-Clipboard -Raw) -eq $token) { Set-Clipboard -Value '' }
        } catch {
          # 剪贴板清理失败不影响配置清理。
        }
        return
      }
    } catch {
      $consecutiveFailures += 1
      if ($consecutiveFailures -ge 10) { return }
    }
    Start-Sleep -Seconds 2
  }
}

function Invoke-TailLogs {
  Write-Manager 'TailHint'
  if (Test-Path -LiteralPath $script:StderrLog) {
    Write-Manager 'RecentStderr'
    Get-Content -LiteralPath $script:StderrLog -Tail 40
  }
  if (Test-Path -LiteralPath $script:StdoutLog) {
    Write-Manager 'RecentStdout'
    Get-Content -LiteralPath $script:StdoutLog -Tail 100 -Wait
  } elseif (Test-Path -LiteralPath $script:StderrLog) {
    Get-Content -LiteralPath $script:StderrLog -Tail 0 -Wait
  }
}

function Show-Status {
  $health = Get-PanelHealth
  $connection = Get-PanelConnection
  if ($null -ne $health) {
    Write-Manager 'StateRunning' $connection.Url
    $state = Read-JsonMap $script:StatePath
    if ($state.ContainsKey('pid')) { Write-Manager 'StatusPid' $state.pid }
  } else {
    Write-Manager 'StateStopped'
  }
}

function Invoke-Command {
  param([Parameter(Mandatory = $true)][string]$Command)
  switch ($Command) {
    'start' {
      $configuration = Prepare-Project
      Start-PanelBackground $configuration
    }
    'foreground' {
      $configuration = Prepare-Project
      Start-PanelForeground $configuration
    }
    'stop' {
      Invoke-SafeShutdown
    }
    'restart' {
      Write-Manager 'Restarting'
      if ($null -ne (Get-PanelHealth)) { Invoke-SafeShutdown }
      $configuration = Prepare-Project
      Start-PanelBackground $configuration
    }
    'logs' {
      if ($null -ne (Get-PanelHealth)) { Open-LiveLogs } else { Show-RecentLogs }
    }
    'rebuild' {
      $wasRunning = $null -ne (Get-PanelHealth)
      if ($wasRunning) { Invoke-SafeShutdown }
      $configuration = Prepare-Project -ForceInstall -ForceBuild
      if ($wasRunning) {
        Start-PanelBackground $configuration
      } else {
        Write-Manager 'RebuildOnlyDone'
      }
    }
    'status' {
      Show-Status
    }
    default {
      throw (Get-Message 'UnknownCommand' $Command) + "`n" + (Get-Message 'SupportedCommands')
    }
  }
}

function Show-InteractiveMenu {
  while ($true) {
    Clear-Host
    Write-Host '============================================================'
    Write-Host (Get-Message 'Title')
    Write-Host '============================================================'
    $running = $null -ne (Get-PanelHealth)
    $connection = Get-PanelConnection
    if ($running) {
      Write-Manager 'StateRunning' $connection.Url
      Write-Host ''
      foreach ($line in $script:Resources[$script:Language].MenuRunning) { Write-Host $line }
    } else {
      Write-Manager 'StateStopped'
      Write-Host ''
      foreach ($line in $script:Resources[$script:Language].MenuStopped) { Write-Host $line }
    }
    Write-Host ''
    $selection = (Read-Host (Get-Message 'SelectAction')).Trim()
    if ($selection -match '^[lL]$') {
      Switch-Language
      Start-Sleep -Milliseconds 500
      continue
    }
    if ($selection -eq '0') { return }

    if ($running) {
      switch ($selection) {
        '' { Open-PanelBrowser; return }
        '1' { Open-PanelBrowser; return }
        '2' { Open-LiveLogs; return }
        '3' { Invoke-Command 'restart'; return }
        '4' { Invoke-Command 'stop'; return }
        '5' { Invoke-Command 'rebuild'; return }
        default { Write-Warning (Get-Message 'InvalidAction'); Start-Sleep -Seconds 1 }
      }
    } else {
      switch ($selection) {
        '' { Invoke-Command 'start'; return }
        '1' { Invoke-Command 'start'; return }
        '2' { Invoke-Command 'foreground'; return }
        '3' { Invoke-Command 'rebuild'; return }
        '4' { Show-RecentLogs; [void](Read-Host (Get-Message 'PressEnter')) }
        default { Write-Warning (Get-Message 'InvalidAction'); Start-Sleep -Seconds 1 }
      }
    }
  }
}

if ($env:MMD_PANEL_MANAGER_LIBRARY_ONLY -eq '1') {
  return
}

$parsed = Parse-ManagerArguments @($args)
Initialize-Language ([string]$parsed.Language)

if ($parsed.Error) {
  Write-Error $parsed.Error
  exit 2
}
if ($parsed.Language -and $parsed.Language -notin @('zh-CN', 'en-US')) {
  Write-Error '--lang must be zh-CN or en-US'
  exit 2
}

if ($parsed.Command -eq '__finalize-setup') {
  Invoke-FinalizeSetup
  exit 0
}
if ($parsed.Command -eq '__tail') {
  Invoke-TailLogs
  exit 0
}

$mutexName = 'Local\MMDPanelManager_' + (Get-StringHash $script:ProjectRoot).Substring(0, 16)
$mutex = New-Object Threading.Mutex($false, $mutexName)
$mutexAcquired = $false
try {
  $mutexAcquired = $mutex.WaitOne(0)
  if (-not $mutexAcquired) {
    Write-Error (Get-Message 'AnotherManager')
    exit 3
  }
  if ([string]::IsNullOrWhiteSpace([string]$parsed.Command)) {
    Show-InteractiveMenu
  } else {
    Invoke-Command ([string]$parsed.Command)
  }
} catch {
  if ($env:MMD_PANEL_MANAGER_DEBUG -eq '1') {
    Write-Host $_.ScriptStackTrace
  }
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ([string]::IsNullOrWhiteSpace([string]$parsed.Command)) {
    Write-Host ''
    Write-Host (Get-Message 'PressAnyKeyExit')
    [void][Console]::ReadKey($true)
  }
  exit 1
} finally {
  if ($mutexAcquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
