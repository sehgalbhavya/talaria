# Talaria's first-run setup. Talaria.bat runs this before every start: it returns at once when everything
# Talaria needs is in place, and otherwise opens a window that lists what's missing, what each part is for
# and how big it is. Nothing is downloaded until you press Install; every step and message is shown in
# the window's details and saved to data\setup-log.txt. The window is drawn to match the app (controls.cs).
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [switch]$Show,          # open the window even when nothing is missing
  [switch]$PortableNode,  # use Talaria's own Node.js even when the computer has one
  [switch]$AutoTest,      # testing: press Install by itself and close when done
  [string]$Screenshot     # testing: save pictures of the window to this folder
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DataDir = if ($env:TALARIA_DATA_DIR) { $env:TALARIA_DATA_DIR } else { Join-Path $Root 'data' }
$RuntimeNode = Join-Path $Root 'runtime\node'
$Marker = Join-Path $DataDir 'setup.json'
$LogFile = Join-Path $DataDir 'setup-log.txt'
$HermesBin = Join-Path $env:LOCALAPPDATA 'hermes\bin'
$MinNode = [version]'20.19.0'

function Add-ToPath([string]$Dir) {
  if ((Test-Path $Dir) -and -not (($env:PATH -split ';') -contains $Dir)) { $env:PATH = "$Dir;$env:PATH" }
}
Add-ToPath $HermesBin
Add-ToPath $RuntimeNode

# ---------------- what's on this computer ----------------

function Get-NodeVersion {
  try {
    $v = & node --version 2>$null
    if ($v -match 'v(\d+\.\d+\.\d+)') { return [version]$Matches[1] }
  } catch {}
  return $null
}

function Test-Node {
  if ($PortableNode) { return Test-Path (Join-Path $RuntimeNode 'node.exe') }
  $v = Get-NodeVersion
  return [bool]($v -and $v -ge $MinNode)
}

function Test-Hermes { return [bool]((Test-Path (Join-Path $HermesBin 'hermes.exe')) -or (Get-Command hermes -ErrorAction SilentlyContinue)) }

function Test-Packages { return Test-Path (Join-Path $Root 'node_modules\.package-lock.json') }

function Test-Chromium {
  if (-not (Test-Packages) -or -not (Test-Node)) { return $false }
  try {
    Push-Location $Root
    $r = & node -e "const p=require('playwright');process.stdout.write(require('fs').existsSync(p.chromium.executablePath())?'yes':'no')" 2>$null
    return $r -eq 'yes'
  } catch { return $false } finally { Pop-Location }
}

function Test-Latex {
  if (Get-Command pdflatex -ErrorAction SilentlyContinue) { return $true }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\MiKTeX\miktex\bin\x64\pdflatex.exe'),
    (Join-Path $env:ProgramFiles 'MiKTeX\miktex\bin\x64\pdflatex.exe')
  )
  return [bool]($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}

$Items = @(
  [ordered]@{ Id = 'node'; SizeMB = 30; Name = 'Node.js'; Required = $true; Default = $true; Size = 'about 30 MB'
    What = 'Runs Talaria. A private copy goes in the Talaria folder; nothing else on your computer changes.'; Present = (Test-Node) },
  [ordered]@{ Id = 'hermes'; SizeMB = 1000; Name = 'Hermes, the AI assistant'; Required = $true; Default = $true; Size = 'about 1 GB'
    What = 'Reads your resume, scores jobs and writes your applications. Installed by its own official installer.'; Present = (Test-Hermes) },
  [ordered]@{ Id = 'packages'; SizeMB = 200; Name = "Talaria's packages"; Required = $true; Default = $true; Size = 'about 200 MB'
    What = 'The building blocks Talaria is made of. They go in the Talaria folder.'; Present = (Test-Packages) },
  [ordered]@{ Id = 'chromium'; SizeMB = 150; Name = 'Browser for applications'; Required = $false; Default = $true; Size = 'about 150 MB'
    What = 'A separate browser that fills in and submits application forms. Your own browser is not touched.'; Present = $false },
  [ordered]@{ Id = 'latex'; SizeMB = 250; Name = 'MiKTeX (LaTeX)'; Required = $false; Default = $false; Size = 'about 250 MB'
    What = 'Only if your resume is a LaTeX file: keeps its exact design. Windows may ask you to allow it.'; Present = (Test-Latex) }
)
$missingRequired = @($Items | Where-Object { $_.Required -and -not $_.Present })
if (-not $Show -and -not $missingRequired) {
  # Everything required is here. The very first time, offer the application browser if it's missing; after that,
  # stay out of the way (and skip that check, the slow one, so starting Talaria stays quick).
  if (Test-Path $Marker) { exit 0 }
  $Items[3].Present = Test-Chromium
  if ($Items[3].Present) { New-Item -ItemType Directory -Force $DataDir | Out-Null; '{"done": true}' | Set-Content $Marker; exit 0 }
}
if (-not $Items[3].Present) { $Items[3].Present = Test-Chromium }

# ---------------- the window ----------------

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Net.Http
Add-Type -Namespace Talaria -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Talaria.Dpi]::SetProcessDPIAware()
Add-Type -Path (Join-Path $PSScriptRoot 'controls.cs') -ReferencedAssemblies System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Everything is laid out on an 8-pixel grid in 96-dpi units, then scaled to the screen: sharp at 125% and
# 150%, and shrunk to fit when the screen is short (a 1080p laptop at 150%).
$Pad = 32                 # outer margin
$CW = 576                 # content width
$ListTop = 168            # where the list (or the details) starts
$Gap = 10                 # between cards
$CardPad = 16             # inside each card, top and bottom alike
$DescW = 352              # description column, clear of the status and switch on the right

$measure = New-Object Drawing.Font('Segoe UI', [float](9 * 96 / 72), [Drawing.GraphicsUnit]::Pixel)
foreach ($it in $Items) {
  $it.DescH = [Windows.Forms.TextRenderer]::MeasureText($it.What, $measure, (New-Object Drawing.Size($DescW, 1000)), [Windows.Forms.TextFormatFlags]::WordBreak).Height
  $it.CardH = $CardPad + 22 + 2 + $it.DescH + $CardPad
}
$ListH = ($Items | ForEach-Object { $_.CardH } | Measure-Object -Sum).Sum + $Gap * ($Items.Count - 1)
$FormH = $ListTop + $ListH + 24 + 102 + 40 + 32

$g = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $Scale = $g.DpiX / 96; $g.Dispose()
$room = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height - 60
if ($FormH * $Scale -gt $room) { $Scale = $room / $FormH }
[TalariaSetup.Theme]::S = [float]$Scale
function Pt([double]$x, [double]$y) { New-Object Drawing.Point([int]($x * $Scale), [int]($y * $Scale)) }
function Sz([double]$w, [double]$h) { New-Object Drawing.Size([int]($w * $Scale), [int]($h * $Scale)) }
function F([string]$name, [double]$pt) { New-Object Drawing.Font($name, [float]($pt * 96 / 72 * $Scale), [Drawing.GraphicsUnit]::Pixel) }

$T = [TalariaSetup.Theme]
$FTitle = F 'Segoe UI Semibold' 17
$FBody = F 'Segoe UI' 9.75
$FName = F 'Segoe UI Semibold' 10.5
$FSmall = F 'Segoe UI' 9
$FKicker = F 'Segoe UI Semibold' 8
$FButton = F 'Segoe UI Semibold' 10

$form = New-Object Windows.Forms.Form
$form.Text = 'Set up Talaria'
$form.Font = $FBody
$form.AutoScaleMode = 'None'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.BackColor = $T::Bg
$form.ClientSize = (Sz ($CW + 2 * $Pad) $FormH)

function New-Label($parent, $text, $x, $y, $w, $h, $font = $FBody, $color = $T::Ink) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $text; $l.Location = (Pt $x $y); $l.Size = (Sz $w $h); $l.Font = $font; $l.ForeColor = $color
  $l.BackColor = $parent.BackColor; $l.UseMnemonic = $false
  $parent.Controls.Add($l); return $l
}

# Header: the Talaria mark, a gold kicker and the title, like the onboarding's step headers.
$logo = New-Object TalariaSetup.LogoMark
$logo.Location = (Pt $Pad 32); $logo.Size = (Sz 44 44); $form.Controls.Add($logo)
$kicker = New-Label $form 'FIRST-TIME SETUP' 92 32 400 16 $FKicker $T::Gold
$title = New-Label $form "Let's get Talaria ready." 90 48 500 34 $FTitle $T::Ink
$subtitle = New-Label $form "Here is what Talaria needs on this computer and what each part is for. Nothing is downloaded until you press Install." $Pad 104 $CW 44 $FBody $T::Muted

# The list: one card per part. Name and size on the first line, what it's for below, status or switch on the right.
$list = New-Object Windows.Forms.Panel
$list.Location = (Pt $Pad $ListTop); $list.Size = (Sz $CW $ListH); $list.BackColor = $T::Bg
$form.Controls.Add($list)

$n = 0; $cy = 0
foreach ($it in $Items) {
  $h = $it.CardH
  $card = New-Object TalariaSetup.CardPanel
  $card.Location = (Pt 0 $cy); $card.Size = (Sz $CW $h)
  $list.Controls.Add($card)
  # Icon, status and switch sit on the card's vertical centre; the text block has the same padding above and below.
  $icon = New-Object TalariaSetup.StepIcon
  $icon.Number = $n + 1; $icon.Location = (Pt 20 (($h - 28) / 2)); $icon.Size = (Sz 28 28); $icon.BackColor = $T::Card
  $card.Controls.Add($icon)
  $nameW = [Windows.Forms.TextRenderer]::MeasureText($it.Name, $FName).Width / $Scale + 4
  $name = New-Label $card $it.Name 64 $CardPad $nameW 22 $FName $T::Ink
  $name.BackColor = $T::Card
  $size = New-Label $card $it.Size (64 + $nameW + 4) ($CardPad + 2) 120 20 $FSmall $T::Faint
  $size.BackColor = $T::Card
  $desc = New-Label $card $it.What 64 ($CardPad + 24) $DescW ($it.DescH + 2) $FSmall $T::Muted
  $desc.BackColor = $T::Card
  $optional = -not $it.Required -and -not $it.Present
  $right = New-Label $card '' $(if ($optional) { 420 } else { 436 }) (($h - 20) / 2) $(if ($optional) { 86 } else { 120 }) 20 $FSmall $T::Faint
  $right.BackColor = $T::Card; $right.TextAlign = 'MiddleRight'
  $it.Card = $card; $it.Icon = $icon; $it.Right = $right
  if ($optional) {
    $tg = New-Object TalariaSetup.Toggle
    $tg.Location = (Pt 518 (($h - 22) / 2)); $tg.Size = (Sz 38 22); $tg.BackColor = $T::Card
    $tg.Set([bool]$it.Default)
    $tg.Add_CheckedChanged({ Update-Plan })
    $card.Controls.Add($tg)
    $it.Toggle = $tg
  }
  $cy += $h + $Gap
  $n++
}

# The details: same place as the list, shown instead of it.
$logCard = New-Object TalariaSetup.CardPanel
$logCard.Location = (Pt $Pad $ListTop); $logCard.Size = (Sz $CW $ListH); $logCard.Visible = $false
$form.Controls.Add($logCard)
$log = New-Object Windows.Forms.TextBox
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'; $log.WordWrap = $true; $log.BorderStyle = 'None'
$log.Font = F 'Cascadia Mono' 8.5; if ($log.Font.Name -ne 'Cascadia Mono') { $log.Font = F 'Consolas' 8.75 }
$log.BackColor = $T::Card; $log.ForeColor = $T::Ink2
$log.Location = (Pt 16 16); $log.Size = (Sz ($CW - 32) ($ListH - 32))
$logCard.Controls.Add($log)

# Progress: what's happening now, the overall bar, then the current download or task.
$py = $ListTop + $ListH + 24
$stepLabel = New-Label $form '' $Pad $py $CW 22 $FName $T::Ink
$overall = New-Object TalariaSetup.ProgressLine
$overall.Location = (Pt $Pad ($py + 30)); $overall.Size = (Sz $CW 6); $form.Controls.Add($overall)
$detailLabel = New-Label $form '' $Pad ($py + 44) $CW 20 $FSmall $T::Muted
$current = New-Object TalariaSetup.ProgressLine
$current.Location = (Pt $Pad ($py + 70)); $current.Size = (Sz $CW 4); $current.Visible = $false; $form.Controls.Add($current)

# Footer: details link on the left, buttons on the right.
$fy = $py + 102
$detailsLink = New-Object Windows.Forms.LinkLabel
$detailsLink.Text = 'Show details'; $detailsLink.Location = (Pt $Pad ($fy + 11)); $detailsLink.AutoSize = $true; $detailsLink.Font = $FBody
$detailsLink.LinkColor = $T::Accent; $detailsLink.ActiveLinkColor = $T::Accent; $detailsLink.LinkBehavior = 'HoverUnderline'; $detailsLink.BackColor = $T::Bg
$form.Controls.Add($detailsLink)
$installBtn = New-Object TalariaSetup.FlatButton
$installBtn.Primary = $true; $installBtn.Font = $FButton; $installBtn.Location = (Pt ($Pad + $CW - 148) $fy); $installBtn.Size = (Sz 148 40)
$form.Controls.Add($installBtn)
$cancelBtn = New-Object TalariaSetup.FlatButton
$cancelBtn.Text = 'Cancel'; $cancelBtn.Font = $FButton; $cancelBtn.Location = (Pt ($Pad + $CW - 148 - 12 - 108) $fy); $cancelBtn.Size = (Sz 108 40)
$form.Controls.Add($cancelBtn)

$detailsLink.Add_LinkClicked({
  $show = -not $logCard.Visible
  $logCard.Visible = $show; $list.Visible = -not $show
  $detailsLink.Text = if ($show) { 'Hide details' } else { 'Show details' }
  if ($show) { $log.SelectionStart = $log.TextLength; $log.ScrollToCaret() }
})

# ---------------- helpers ----------------

$script:cancelled = $false
$script:running = $false
$script:finished = $false

function Pump { [Windows.Forms.Application]::DoEvents() }

function Write-Log([string]$text) {
  $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $text
  try { New-Item -ItemType Directory -Force $DataDir | Out-Null; Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
  $log.AppendText($line + "`r`n")
  Pump
}

# The current bar: a fraction (0..1), or -1 for "working, no percentage to show".
function Set-Current([double]$fraction, [string]$text) {
  $current.Visible = $true
  if ($fraction -lt 0) { $current.Busy = $true } else { $current.Value = [float]$fraction }
  if ($text) { $detailLabel.Text = $text }
  Pump
}

function Set-Item($it, [string]$state, [string]$text, $color) {
  $it.Icon.State = $state
  $it.Right.Text = $text
  if ($color) { $it.Right.ForeColor = $color }
  Pump
}

function Save-Shot([string]$name) {
  if (-not $Screenshot) { return }
  New-Item -ItemType Directory -Force $Screenshot | Out-Null
  $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
  $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
  $bmp.Save((Join-Path $Screenshot "$name.png"), [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

$Ansi = [regex]'\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07]*\x07'

# Run a program, show its output in the details and turn any "NN%" it prints into the current progress bar.
function Invoke-Program([string]$File, [string]$Arguments, [string]$What) {
  Write-Log "> $File $Arguments"
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $File; $psi.Arguments = $Arguments; $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $p = [Diagnostics.Process]::Start($psi)
  $reads = @{ out = $p.StandardOutput.ReadLineAsync(); err = $p.StandardError.ReadLineAsync() }
  $started = Get-Date; $shot = $false
  while ($reads.Count) {
    $busy = $false
    foreach ($k in @($reads.Keys)) {
      $t = $reads[$k]
      if (-not $t.IsCompleted) { continue }
      $busy = $true
      $line = $t.Result
      if ($null -eq $line) { $reads.Remove($k); continue }
      $line = $Ansi.Replace($line, '').Trim()
      if ($line) {
        Write-Log $line
        $m = [regex]::Matches($line, '(\d{1,3}(?:\.\d+)?)\s?%')
        if ($m.Count) { Set-Current ([double]$m[$m.Count - 1].Groups[1].Value / 100) "$What, $([int]$m[$m.Count - 1].Groups[1].Value)%" }
      }
      $reads[$k] = if ($k -eq 'out') { $p.StandardOutput.ReadLineAsync() } else { $p.StandardError.ReadLineAsync() }
    }
    if ($script:cancelled) { try { & taskkill /PID $p.Id /T /F 2>$null | Out-Null } catch {}; throw 'Cancelled.' }
    Pump
    if ($Screenshot -and -not $shot -and ((Get-Date) - $started).TotalSeconds -gt 3) { $shot = $true; Save-Shot ('busy-' + ($What -replace '[^A-Za-z]', '')) }
    if (-not $busy) { Start-Sleep -Milliseconds 30 }
  }
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "$What stopped with an error (exit code $($p.ExitCode)). Show details has what it said." }
}

# Download with a real progress bar (megabytes done of the total).
function Get-Download([string]$Url, [string]$Dest, [string]$What) {
  Write-Log "Downloading $Url"
  $client = New-Object Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMinutes(30)
  try {
    $resp = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    [void]$resp.EnsureSuccessStatusCode()
    $total = $resp.Content.Headers.ContentLength
    $in = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $out = [IO.File]::Create($Dest)
    try {
      $buf = New-Object byte[] 262144
      $done = 0
      while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
        $out.Write($buf, 0, $n); $done += $n
        $mb = '{0:N1} of {1:N1} MB' -f ($done / 1MB), ($total / 1MB)
        Set-Current $(if ($total) { $done / $total } else { -1 }) "$What, $mb"
        if ($Screenshot -and -not $script:shotDownload -and $total -and ($done / $total) -gt 0.5) { $script:shotDownload = $true; Save-Shot 'downloading' }
        if ($script:cancelled) { throw 'Cancelled.' }
      }
    } finally { $out.Dispose(); $in.Dispose() }
  } finally { $client.Dispose() }
}

# ---------------- the installs ----------------

$Steps = @{
  node = {
    Set-Current -1 'Finding the current Node.js release'
    # Assign first: Windows PowerShell passes a JSON array down a pipe as one object.
    $releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $rel = $releases | Where-Object { $_.lts } | Select-Object -First 1
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $name = "node-$($rel.version)-win-$arch"
    $base = "https://nodejs.org/dist/$($rel.version)"
    Write-Log "Node.js $($rel.version) (LTS '$($rel.lts)')"
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape("$name.zip"))\s*$" } | Select-Object -First 1
    if (-not $line) { throw "nodejs.org lists no checksum for $name.zip." }
    $expected = ($line.Trim() -split '\s+')[0]
    $zip = Join-Path $env:TEMP "$name.zip"
    Get-Download "$base/$name.zip" $zip "Downloading Node.js $($rel.version)"
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash
    if ($actual -ne $expected) { Remove-Item $zip -Force; throw "The Node.js download doesn't match nodejs.org's checksum, so it wasn't used. Try again." }
    Write-Log "Checksum matches nodejs.org ($expected)"
    Set-Current -1 'Unpacking Node.js'
    $unpack = Join-Path $Root 'runtime\_unpack'
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
    # Unpack in a separate process so this window keeps responding.
    Invoke-Program 'powershell.exe' "-NoProfile -Command `"Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('$zip', '$unpack')`"" 'Unpacking Node.js'
    if (Test-Path $RuntimeNode) { Remove-Item $RuntimeNode -Recurse -Force }
    Move-Item (Join-Path $unpack $name) $RuntimeNode
    Remove-Item $unpack -Recurse -Force; Remove-Item $zip -Force
    Add-ToPath $RuntimeNode
    Write-Log "Node.js is in $RuntimeNode ($(& (Join-Path $RuntimeNode 'node.exe') --version))"
  }
  hermes = {
    Set-Current -1 "Running Hermes' official installer. This is the longest step, often 5 to 15 minutes."
    $cmd = "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; `$s = Invoke-RestMethod 'https://hermes-agent.nousresearch.com/install.ps1'; & ([scriptblock]::Create(`$s)) -NonInteractive"
    Invoke-Program 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`"" 'Installing Hermes'
    Add-ToPath $HermesBin
    if (-not (Test-Hermes)) { throw "Hermes' installer finished, but Hermes isn't where it should be ($HermesBin)." }
  }
  packages = {
    Set-Current -1 "Installing Talaria's packages, usually a minute or two"
    Invoke-Program 'cmd.exe' '/d /s /c "npm ci --no-audit --no-fund"' "Installing Talaria's packages"
  }
  chromium = {
    Set-Current -1 'Downloading the browser for applications'
    Invoke-Program 'cmd.exe' '/d /s /c "npx playwright install chromium"' 'Downloading the browser for applications'
  }
  latex = {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Windows' app installer (winget) isn't available here. Install MiKTeX from https://miktex.org instead; Talaria works without it." }
    Set-Current -1 'Installing MiKTeX. Windows may ask you to allow it.'
    Invoke-Program 'winget.exe' 'install --id MiKTeX.MiKTeX --exact --silent --accept-package-agreements --accept-source-agreements' 'Installing MiKTeX'
  }
}

function Test-Wanted($it) { return (-not $it.Present) -and ($it.Required -or ($it.Toggle -and $it.Toggle.Checked)) }
function Get-Planned { @($Items | Where-Object { Test-Wanted $_ }) }

function Update-Plan {
  if ($script:running) { return }
  foreach ($it in $Items) {
    if ($it.Present) { Set-Item $it 'done' 'Installed' $T::Ok; continue }
    if (Test-Wanted $it) { Set-Item $it 'pending' $(if ($it.Toggle) { '' } else { 'Required' }) $T::Faint }
    else { Set-Item $it 'skipped' 'Skipped' $T::Faint }
  }
  $planned = Get-Planned
  $count = $planned.Count
  $installBtn.Text = if ($count) { 'Install' } else { 'Start Talaria' }
  if ($count) {
    $title.Text = "Let's get Talaria ready."
    $stepLabel.Text = "$count thing$(if ($count -ne 1) { 's' }) to install. Press Install when you're ready."
  } else {
    $title.Text = 'Everything Talaria needs is here.'
    $stepLabel.Text = 'Nothing to install.'
  }
  $stepLabel.ForeColor = $T::Ink
  $overall.Jump(0); $current.Visible = $false
  $mb = ($planned | ForEach-Object { $_.SizeMB } | Measure-Object -Sum).Sum
  $latex = [bool]($planned | Where-Object { $_.Id -eq 'latex' })
  $amount = if ($mb -ge 1000) { '{0:N1} GB' -f ($mb / 1000) } else { "$mb MB" }
  $detailLabel.Text = if ($count) { "About $amount to download. No admin rights needed$(if ($latex) { ', except for MiKTeX' })." } else { '' }
}

function Start-Install {
  $planned = Get-Planned
  if (-not $planned.Count) { Complete-Setup; $form.Tag = 0; $form.Close(); return }
  $script:running = $true; $script:cancelled = $false
  $installBtn.Enabled = $false
  foreach ($it in $Items) { if ($it.Toggle) { $it.Toggle.Enabled = $false } }
  $kicker.Text = 'INSTALLING'; $kicker.ForeColor = $T::Gold
  $title.Text = 'Setting up Talaria...'
  $subtitle.Text = 'This can take a while, mostly for Hermes. You can keep using your computer; Cancel stops it safely.'
  $installBtn.Text = 'Installing...'
  Write-Log "Installing: $(($planned | ForEach-Object { $_.Name }) -join ', ')"
  $i = 0
  try {
    foreach ($it in $planned) {
      $i++
      $stepLabel.Text = "Step $i of $($planned.Count): $($it.Name)"; $stepLabel.ForeColor = $T::Ink
      $overall.Value = [float](($i - 1) / $planned.Count)
      Set-Item $it 'active' 'Installing...' $T::Accent
      & $Steps[$it.Id]
      $it.Present = $true
      if ($it.Toggle) { $it.Toggle.Visible = $false; $it.Right.Left = [int](436 * $Scale); $it.Right.Width = [int](120 * $Scale) } # nothing left to switch
      Set-Item $it 'done' 'Done' $T::Ok
      Write-Log "$($it.Name): done"
    }
    Complete-Setup
  } catch {
    $msg = "$($_.Exception.Message)"
    Write-Log "Stopped: $msg"
    $failed = $planned[$i - 1]
    if ($failed) { Set-Item $failed $(if ($script:cancelled) { 'pending' } else { 'failed' }) $(if ($script:cancelled) { 'Cancelled' } else { 'Failed' }) $T::Bad }
    $kicker.Text = 'SETUP PAUSED'; $kicker.ForeColor = $T::Bad
    $subtitle.Text = "What's already installed stays. Try again carries on from where it stopped."
    $title.Text = if ($script:cancelled) { 'Stopped. Nothing more will be downloaded.' } else { 'Something went wrong.' }
    $stepLabel.Text = if ($script:cancelled) { 'Press Try again to carry on, or Cancel to close.' } else { $msg }
    $stepLabel.ForeColor = if ($script:cancelled) { $T::Ink } else { $T::Bad }
    $current.Visible = $false; $detailLabel.Text = 'What happened is saved in data\setup-log.txt.'
    $installBtn.Text = 'Try again'; $installBtn.Enabled = $true
    foreach ($it in $Items) { if ($it.Toggle -and -not $it.Present) { $it.Toggle.Enabled = $true } }
    $script:running = $false
    Save-Shot 'failed'
    if ($AutoTest) { $form.Tag = 1; $form.Close() }
  }
}

function Complete-Setup {
  $script:running = $false
  $script:finished = $true
  New-Item -ItemType Directory -Force $DataDir | Out-Null
  '{"done": true}' | Set-Content $Marker
  $overall.Fill = $T::Ok; $overall.Value = 1
  $current.Visible = $false
  $kicker.Text = 'ALL SET'; $kicker.ForeColor = $T::Ok
  $title.Text = "You're ready to go."
  $subtitle.Text = 'Everything Talaria needs is installed. Next, Talaria walks you through connecting your AI account and adding your resume.'
  $stepLabel.Text = 'Everything is installed. Talaria opens in your browser when you press Start Talaria.'
  $stepLabel.ForeColor = $T::Ink
  $detailLabel.Text = 'Everything that happened is saved in data\setup-log.txt.'
  Write-Log 'Setup finished.'
  $installBtn.Text = 'Start Talaria'; $installBtn.Enabled = $true
  $cancelBtn.Visible = $false
  if ($Screenshot) { for ($k = 0; $k -lt 30; $k++) { Pump; Start-Sleep -Milliseconds 16 } } # let the bar glide in
  Save-Shot 'done'
  if ($AutoTest) { $form.Tag = 0; $form.Close() }
}

$installBtn.Add_Click({
  if ($script:finished) { $form.Tag = 0; $form.Close(); return }
  Start-Install
})
$cancelBtn.Add_Click({
  if ($script:running) { $script:cancelled = $true; Write-Log 'Cancelling...' }
  else { $form.Tag = 1; $form.Close() }
})
$form.Add_FormClosing({
  param($s, $e)
  if ($script:running) { $script:cancelled = $true; $e.Cancel = $true; Write-Log 'Cancelling...' }
})
$form.Add_Shown({
  $form.Activate()
  Save-Shot 'start'
  if ($AutoTest) { Start-Install }
})

Update-Plan
Write-Log "Talaria folder: $Root"
foreach ($it in $Items) { Write-Log ("{0}: {1}" -f $it.Name, $(if ($it.Present) { 'installed' } elseif ($it.Required) { 'missing (required)' } else { 'not installed (optional)' })) }

$form.Tag = 1
[void]$form.ShowDialog()
exit [int]$form.Tag
