# Answers CourtPlus's native "choose a folder" dialog in a packaged build, where the fused exe gives
# the smoke test no main-process hook to stub dialog.showOpenDialog. UI Automation finds the dialog;
# its Win32 controls expose no UIA patterns, so they are driven with window messages, which also
# work without keyboard focus.
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Folder,
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace CourtPlusSmoke -Name Win32 -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
[DllImport("user32.dll")]
public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
[DllImport("user32.dll")]
public static extern bool IsWindow(IntPtr hWnd);
'@
$A = [System.Windows.Automation.AutomationElement]
$Children = [System.Windows.Automation.TreeScope]::Children
$Descendants = [System.Windows.Automation.TreeScope]::Descendants
$named = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $Title)
$WM_SETTEXT = 0x000C
$WM_COMMAND = 0x0111
$IDOK = 1

function Find-Dialog {
  $root = $A::RootElement
  $dialog = $root.FindFirst($Children, $named)
  if ($dialog) { return $dialog }
  # A modal dialog owned by the app window can also appear as that window's child.
  foreach ($window in $root.FindAll($Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    try { $dialog = $window.FindFirst($Children, $named) } catch { continue }
    if ($dialog) { return $dialog }
  }
  return $null
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = $null
while (-not $dialog) {
  if ((Get-Date) -gt $deadline) { throw "Dialog '$Title' did not open within $TimeoutSeconds s." }
  $dialog = Find-Dialog
  if (-not $dialog) { Start-Sleep -Milliseconds 250 }
}
$dialogHandle = [IntPtr]$dialog.Current.NativeWindowHandle

# 1152 is the common file dialog's name box ("Folder:"); it may wrap the real Edit in a combo box.
$nameId = New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, '1152')
$nameBox = $null
while (-not $nameBox) {
  if ((Get-Date) -gt $deadline) { throw "Dialog '$Title' has no folder name box." }
  $nameBox = $dialog.FindFirst($Descendants, $nameId)
  if (-not $nameBox) { Start-Sleep -Milliseconds 250 }
}
$edit = [IntPtr]$nameBox.Current.NativeWindowHandle
$inner = [CourtPlusSmoke.Win32]::FindWindowEx($edit, [IntPtr]::Zero, 'Edit', $null)
if ($inner -ne [IntPtr]::Zero) { $edit = $inner }

[void][CourtPlusSmoke.Win32]::SendMessage($edit, $WM_SETTEXT, [IntPtr]::Zero, $Folder)
for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
  # Same as pressing "Select Folder". Typing a path may only navigate into it; a second OK then
  # selects the folder now shown.
  [void][CourtPlusSmoke.Win32]::PostMessage($dialogHandle, $WM_COMMAND, [IntPtr]$IDOK, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 800
  if (-not [CourtPlusSmoke.Win32]::IsWindow($dialogHandle)) { exit 0 }
}
throw "Dialog '$Title' stayed open."
