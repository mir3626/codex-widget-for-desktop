param()

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$SchemaVersion = "browser-native-desktop-helper.v1"
$HelperVersion = "0.1.0"
$BrowserProcessNames = @("chrome", "msedge", "chromium", "brave", "firefox")
$MaxVisitedNodes = 450
$MaxElements = 120
$MaxDepth = 9

function Write-JsonResponse {
  param([hashtable]$Value)
  [Console]::Out.Write(($Value | ConvertTo-Json -Depth 16 -Compress))
}

function Write-ErrorResponse {
  param(
    [string]$Message,
    [hashtable]$Metadata = @{}
  )
  Write-JsonResponse @{
    ok = $false
    error = $Message
    metadata = @{
      helper = "browser-native-desktop-helper"
      helperVersion = $HelperVersion
      schemaVersion = $SchemaVersion
    } + $Metadata
  }
  exit 0
}

try {
  Add-Type -AssemblyName UIAutomationClient | Out-Null
  Add-Type -AssemblyName UIAutomationTypes | Out-Null
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
} catch {
  Write-ErrorResponse "Windows UI Automation assemblies are unavailable: $($_.Exception.Message)"
}

try {
  $RawInput = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($RawInput)) {
    Write-ErrorResponse "Native desktop helper received an empty request."
  }
  $Request = $RawInput | ConvertFrom-Json
} catch {
  Write-ErrorResponse "Native desktop helper received invalid JSON: $($_.Exception.Message)"
}

if ($Request.schemaVersion -ne $SchemaVersion) {
  Write-ErrorResponse "Unsupported native desktop helper schemaVersion: $($Request.schemaVersion)"
}

function Get-SafeString {
  param(
    [object]$Value,
    [int]$MaxLength = 240
  )
  if ($null -eq $Value) {
    return ""
  }
  $text = [string]$Value
  if ($text.Length -gt $MaxLength) {
    return $text.Substring(0, $MaxLength)
  }
  return $text
}

function Test-SensitiveText {
  param([object]$Value)
  if ($null -eq $Value) {
    return $false
  }
  $text = [string]$Value
  return $text -match "(?i)(password|passwd|passcode|token|cookie|secret|api[_-]?key|bearer\s+|sk-[a-z0-9]|payment|card\s*number|cvv)"
}

function Get-CurrentProperty {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationProperty]$Property
  )
  try {
    $value = $Element.GetCurrentPropertyValue($Property, $true)
    if ($value -eq [System.Windows.Automation.AutomationElement]::NotSupported) {
      return $null
    }
    return $value
  } catch {
    return $null
  }
}

function Get-ControlRole {
  param([System.Windows.Automation.AutomationElement]$Element)
  $controlType = Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::ControlTypeProperty)
  if ($null -eq $controlType) {
    return "unknown"
  }
  $name = [string]$controlType.ProgrammaticName
  if ($name.StartsWith("ControlType.")) {
    return $name.Substring("ControlType.".Length).ToLowerInvariant()
  }
  return $name.ToLowerInvariant()
}

function Get-ElementRuntimeSelector {
  param([System.Windows.Automation.AutomationElement]$Element)
  try {
    $runtimeId = $Element.GetRuntimeId()
    if ($null -eq $runtimeId -or $runtimeId.Length -eq 0) {
      return $null
    }
    $joined = [string]::Join(".", $runtimeId)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    $hex = -join ($hash[0..7] | ForEach-Object { $_.ToString("x2") })
    return "uia:$hex"
  } catch {
    return $null
  }
}

function Get-Bounds {
  param([System.Windows.Automation.AutomationElement]$Element)
  try {
    $rect = $Element.Current.BoundingRectangle
    if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) {
      return $null
    }
    return @{
      x = [Math]::Round($rect.X)
      y = [Math]::Round($rect.Y)
      w = [Math]::Round($rect.Width)
      h = [Math]::Round($rect.Height)
    }
  } catch {
    return $null
  }
}

function Test-PasswordElement {
  param([System.Windows.Automation.AutomationElement]$Element)
  try {
    $value = $Element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty, $true)
    return $value -eq $true
  } catch {
    return $false
  }
}

function Get-ElementValue {
  param([System.Windows.Automation.AutomationElement]$Element)
  if (Test-PasswordElement $Element) {
    return $null
  }
  try {
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = $pattern.Current.Value
      if (Test-SensitiveText $value) {
        return $null
      }
      return Get-SafeString $value 160
    }
  } catch {
    return $null
  }
  return $null
}

function Get-BrowserProcesses {
  $processes = @()
  foreach ($name in $BrowserProcessNames) {
    try {
      $processes += Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) }
    } catch {
    }
  }
  return @($processes | Sort-Object ProcessName, Id)
}

function Convert-ProcessToWindow {
  param([System.Diagnostics.Process]$Process)
  return @{
    processName = $Process.ProcessName
    id = $Process.Id
    title = Get-SafeString $Process.MainWindowTitle 300
  }
}

function Get-TopLevelElementFromProcess {
  param([System.Diagnostics.Process]$Process)
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  } catch {
    return $null
  }
}

function Resolve-BrowserWindow {
  param([object]$Session)
  $processes = Get-BrowserProcesses
  if ($processes.Count -eq 0) {
    return @{
      process = $null
      element = $null
      windows = @()
    }
  }

  $requestedWindowId = Get-SafeString $Session.source.windowId 80
  if ($requestedWindowId -match "^\d+$") {
    $matched = $processes | Where-Object { $_.Id -eq [int]$requestedWindowId } | Select-Object -First 1
    if ($null -ne $matched) {
      return @{
        process = $matched
        element = Get-TopLevelElementFromProcess $matched
        windows = @($processes | ForEach-Object { Convert-ProcessToWindow $_ })
      }
    }
  }

  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $focusedPid = Get-CurrentProperty $focused ([System.Windows.Automation.AutomationElement]::ProcessIdProperty)
    $focusedProcess = $processes | Where-Object { $_.Id -eq $focusedPid } | Select-Object -First 1
    if ($null -ne $focusedProcess) {
      return @{
        process = $focusedProcess
        element = Get-TopLevelElementFromProcess $focusedProcess
        windows = @($processes | ForEach-Object { Convert-ProcessToWindow $_ })
      }
    }
  } catch {
  }

  $selected = $processes | Select-Object -First 1
  return @{
    process = $selected
    element = Get-TopLevelElementFromProcess $selected
    windows = @($processes | ForEach-Object { Convert-ProcessToWindow $_ })
  }
}

function Test-InterestingElement {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [int]$Depth
  )
  $role = Get-ControlRole $Element
  $name = Get-SafeString (Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::NameProperty)) 160
  $automationId = Get-SafeString (Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::AutomationIdProperty)) 120
  $bounds = Get-Bounds $Element
  $interestingRoles = @(
    "button", "hyperlink", "edit", "combobox", "checkbox", "radiobutton",
    "tabitem", "menuitem", "listitem", "dataitem", "treeitem", "document",
    "pane", "window"
  )
  if ($interestingRoles -contains $role) {
    return $true
  }
  if ($Depth -le 4 -and $bounds -ne $null -and ($name.Length -gt 0 -or $automationId.Length -gt 0)) {
    return $true
  }
  return $false
}

function Convert-ElementForObservation {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [int]$Index
  )
  $role = Get-ControlRole $Element
  $name = Get-SafeString (Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::NameProperty)) 180
  $automationId = Get-SafeString (Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::AutomationIdProperty)) 120
  $className = Get-SafeString (Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::ClassNameProperty)) 80
  $isEnabled = Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::IsEnabledProperty)
  $isOffscreen = Get-CurrentProperty $Element ([System.Windows.Automation.AutomationElement]::IsOffscreenProperty)
  $isPassword = Test-PasswordElement $Element
  $selector = Get-ElementRuntimeSelector $Element
  if ([string]::IsNullOrWhiteSpace($selector)) {
    $selector = "uia:fallback-$Index"
  }
  $riskHints = @()
  if ($isPassword -or (Test-SensitiveText $name) -or (Test-SensitiveText $automationId)) {
    $riskHints += "password"
    $riskHints += "auth"
  }
  if ($role -eq "button" -and $name -match "(?i)(delete|remove|discard)") {
    $riskHints += "delete"
  }
  if ($role -eq "button" -and $name -match "(?i)(submit|send|post|publish|pay|purchase|buy)") {
    $riskHints += "submit"
  }

  return @{
    id = $selector.Replace(":", "-")
    role = $role
    tagName = "uia-$role"
    label = $name
    text = $name
    value = Get-ElementValue $Element
    selector = $selector
    visible = -not ($isOffscreen -eq $true)
    enabled = -not ($isEnabled -eq $false)
    editable = $role -eq "edit" -or $role -eq "combobox"
    confidence = 0.78
    bbox = Get-Bounds $Element
    riskHints = @($riskHints | Select-Object -Unique)
    automationId = $automationId
    className = $className
  }
}

function Collect-Elements {
  param([System.Windows.Automation.AutomationElement]$Root)
  $items = @()
  if ($null -eq $Root) {
    return @()
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object "System.Collections.Generic.Queue[object]"
  $queue.Enqueue(@{ element = $Root; depth = 0 })
  $visited = 0

  while ($queue.Count -gt 0 -and $visited -lt $MaxVisitedNodes -and $items.Count -lt $MaxElements) {
    $node = $queue.Dequeue()
    $element = [System.Windows.Automation.AutomationElement]$node.element
    $depth = [int]$node.depth
    $visited += 1

    if (Test-InterestingElement $element $depth) {
      $json = Convert-ElementForObservation $element $items.Count
      $items += ,@{ element = $element; json = $json }
    }

    if ($depth -ge $MaxDepth) {
      continue
    }
    try {
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child -and $queue.Count -lt $MaxVisitedNodes) {
        $queue.Enqueue(@{ element = $child; depth = $depth + 1 })
        $child = $walker.GetNextSibling($child)
      }
    } catch {
    }
  }

  return $items
}

function Build-Observation {
  param([hashtable]$Resolved)
  $windowElement = $Resolved.element
  $windows = @($Resolved.windows)
  $items = if ($null -ne $windowElement) { Collect-Elements $windowElement } else { @() }
  $selectedProcess = $Resolved.process
  $title = if ($null -ne $selectedProcess) { Get-SafeString $selectedProcess.MainWindowTitle 300 } else { "Windows browser UIA helper" }
  $textLines = @()
  if ($windows.Count -gt 0) {
    $textLines += ($windows | ForEach-Object { "$($_.processName) $($_.id): $($_.title)" })
  }
  $textLines += ($items | ForEach-Object { $_.json.label } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 80)

  return @{
    url = ""
    title = $title
    text = [string]::Join("`n", $textLines)
    windows = $windows
    elements = @($items | ForEach-Object { $_.json })
  }
}

function Find-ElementByTarget {
  param(
    [hashtable]$Resolved,
    [object]$Action,
    [object]$Target
  )
  $windowElement = $Resolved.element
  if ($null -eq $windowElement) {
    return $null
  }

  $selector = ""
  $id = ""
  $targetText = ""
  if ($null -ne $Target) {
    $selector = Get-SafeString $Target.selector 160
    $id = Get-SafeString $Target.id 160
    $targetText = Get-SafeString $Target.label 160
    if ([string]::IsNullOrWhiteSpace($targetText)) {
      $targetText = Get-SafeString $Target.text 160
    }
  }
  if ($null -ne $Action.target) {
    if ($Action.target.kind -eq "selector") {
      $selector = Get-SafeString $Action.target.selector 160
    } elseif ($Action.target.kind -eq "element_id") {
      $id = Get-SafeString $Action.target.id 160
    } elseif ($Action.target.kind -eq "text") {
      $targetText = Get-SafeString $Action.target.text 160
    } elseif ($Action.target.kind -eq "focused") {
      try {
        return [System.Windows.Automation.AutomationElement]::FocusedElement
      } catch {
        return $null
      }
    }
  }

  $items = Collect-Elements $windowElement
  foreach ($item in $items) {
    $json = $item.json
    if ($selector -and $json.selector -eq $selector) {
      return $item.element
    }
    if ($id -and ($json.id -eq $id -or $json.selector -eq $id)) {
      return $item.element
    }
  }
  if ($targetText) {
    $needle = $targetText.ToLowerInvariant()
    foreach ($item in $items) {
      $label = (Get-SafeString $item.json.label 180).ToLowerInvariant()
      $text = (Get-SafeString $item.json.text 180).ToLowerInvariant()
      if ($label -eq $needle -or $text -eq $needle -or ($label.Length -gt 0 -and $label.Contains($needle))) {
        return $item.element
      }
    }
  }
  return $null
}

function Escape-SendKeysText {
  param([string]$Text)
  $builder = New-Object System.Text.StringBuilder
  foreach ($char in $Text.ToCharArray()) {
    $s = [string]$char
    if ("+^%~(){}[]".IndexOf($s) -ge 0) {
      [void]$builder.Append("{").Append($s).Append("}")
    } elseif ($s -eq "`r" -or $s -eq "`n") {
      [void]$builder.Append(" ")
    } else {
      [void]$builder.Append($s)
    }
  }
  return $builder.ToString()
}

function Invoke-ElementDefault {
  param([System.Windows.Automation.AutomationElement]$Element)
  if ($null -eq $Element) {
    return "missing_target"
  }
  try {
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
      return "invoke_pattern"
    }
  } catch {
  }
  try {
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
      $pattern.Select()
      return "selection_item_pattern"
    }
  } catch {
  }
  try {
    $Element.SetFocus()
    Start-Sleep -Milliseconds 50
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    return "focus_enter"
  } catch {
    return "failed_default_action"
  }
}

function Set-ElementText {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$Text,
    [bool]$ClearFirst,
    [bool]$Submit
  )
  if ($null -eq $Element) {
    return "missing_target"
  }
  if (Test-PasswordElement $Element -or (Test-SensitiveText $Text)) {
    return "blocked_sensitive_text"
  }
  try {
    $Element.SetFocus()
    Start-Sleep -Milliseconds 50
    if ($ClearFirst) {
      [System.Windows.Forms.SendKeys]::SendWait("^a")
      Start-Sleep -Milliseconds 20
    }
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $Text))
    if ($Submit) {
      Start-Sleep -Milliseconds 40
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    return "send_keys"
  } catch {
    return "failed_type"
  }
}

function Invoke-TabCommand {
  param(
    [System.Windows.Automation.AutomationElement]$WindowElement,
    [string]$ActionType,
    [object]$Action
  )
  if ($null -eq $WindowElement) {
    return "missing_browser_window"
  }
  try {
    $WindowElement.SetFocus()
    Start-Sleep -Milliseconds 50
  } catch {
  }
  switch ($ActionType) {
    "back" {
      [System.Windows.Forms.SendKeys]::SendWait("%{LEFT}")
      return "alt_left"
    }
    "forward" {
      [System.Windows.Forms.SendKeys]::SendWait("%{RIGHT}")
      return "alt_right"
    }
    "reload" {
      [System.Windows.Forms.SendKeys]::SendWait("{F5}")
      return "f5"
    }
    "navigate" {
      $url = Get-SafeString $Action.url 2048
      if ([string]::IsNullOrWhiteSpace($url) -or (Test-SensitiveText $url)) {
        return "blocked_invalid_or_sensitive_url"
      }
      [System.Windows.Forms.SendKeys]::SendWait("^l")
      Start-Sleep -Milliseconds 40
      [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $url))
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
      return "ctrl_l_url_enter"
    }
  }
  return "unsupported_tab_command"
}

function Execute-Action {
  param([object]$Request)
  $action = $Request.action
  if ($null -eq $action -or [string]::IsNullOrWhiteSpace($action.type)) {
    Write-ErrorResponse "Native desktop helper execute request is missing action.type."
  }
  if ($action.type -eq "evaluate") {
    Write-ErrorResponse "Native desktop helper does not support evaluate. Use explicit full_control_dev adapter policy outside UIA helper."
  }
  if ($action.text -and (Test-SensitiveText $action.text)) {
    Write-ErrorResponse "Native desktop helper blocked sensitive text input."
  }

  $resolved = Resolve-BrowserWindow $Request.session
  if ($action.type -eq "read") {
    return @{
      ok = $true
      after = Build-Observation $resolved
      metadata = @{
        helper = "browser-native-desktop-helper"
        helperVersion = $HelperVersion
        command = "execute"
        action = "read"
      }
    }
  }

  $method = "unsupported"
  if (@("back", "forward", "reload", "navigate") -contains $action.type) {
    $method = Invoke-TabCommand $resolved.element $action.type $action
  } elseif ($action.type -eq "click") {
    $element = Find-ElementByTarget $resolved $action $Request.target
    $method = Invoke-ElementDefault $element
  } elseif ($action.type -eq "type") {
    $element = Find-ElementByTarget $resolved $action $Request.target
    $method = Set-ElementText $element (Get-SafeString $action.text 4096) ([bool]$action.clearFirst) ([bool]$action.submit)
  } elseif ($action.type -eq "check") {
    $element = Find-ElementByTarget $resolved $action $Request.target
    try {
      $pattern = $null
      if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        $desired = if ([bool]$action.checked) { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off }
        if ($pattern.Current.ToggleState -ne $desired) {
          $pattern.Toggle()
        }
        $method = "toggle_pattern"
      } else {
        $method = Invoke-ElementDefault $element
      }
    } catch {
      $method = "failed_check"
    }
  } elseif ($action.type -eq "select") {
    $element = Find-ElementByTarget $resolved $action $Request.target
    try {
      $pattern = $null
      if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        $method = "selection_item_pattern"
      } else {
        $method = Invoke-ElementDefault $element
      }
    } catch {
      $method = "failed_select"
    }
  } elseif ($action.type -eq "scroll") {
    try {
      $resolved.element.SetFocus()
    } catch {
    }
    $key = if ($action.direction -eq "up" -or $action.direction -eq "left") { "{PGUP}" } else { "{PGDN}" }
    [System.Windows.Forms.SendKeys]::SendWait($key)
    $method = "page_key"
  }

  if ($method -match "^(missing_|blocked_|failed_|unsupported)") {
    return @{
      ok = $false
      error = "Native desktop helper could not execute $($action.type): $method"
      metadata = @{
        helper = "browser-native-desktop-helper"
        helperVersion = $HelperVersion
        command = "execute"
        action = $action.type
        method = $method
      }
    }
  }

  Start-Sleep -Milliseconds 180
  $afterResolved = Resolve-BrowserWindow $Request.session
  return @{
    ok = $true
    after = Build-Observation $afterResolved
    metadata = @{
      helper = "browser-native-desktop-helper"
      helperVersion = $HelperVersion
      command = "execute"
      action = $action.type
      method = $method
    }
  }
}

try {
  switch ($Request.command) {
    "status" {
      $resolved = Resolve-BrowserWindow $Request.session
      Write-JsonResponse @{
        ok = $true
        observation = @{
          title = "Windows browser UIA helper status"
          text = "Bounded browser-window UI Automation helper is available."
          windows = @($resolved.windows)
          elements = @()
        }
        metadata = @{
          helper = "browser-native-desktop-helper"
          helperVersion = $HelperVersion
          schemaVersion = $SchemaVersion
          command = "status"
          scope = "browser_windows_only"
          windows = @($resolved.windows).Count
          capabilities = @("read", "click", "type", "select", "check", "scroll", "navigate", "back", "forward", "reload")
        }
      }
    }
    "observe" {
      $resolved = Resolve-BrowserWindow $Request.session
      Write-JsonResponse @{
        ok = $true
        observation = Build-Observation $resolved
        metadata = @{
          helper = "browser-native-desktop-helper"
          helperVersion = $HelperVersion
          schemaVersion = $SchemaVersion
          command = "observe"
          scope = "browser_windows_only"
        }
      }
    }
    "execute" {
      Write-JsonResponse (Execute-Action $Request)
    }
    default {
      Write-ErrorResponse "Unsupported native desktop helper command: $($Request.command)"
    }
  }
} catch {
  Write-ErrorResponse "Native desktop helper failed: $($_.Exception.Message)" @{
    command = Get-SafeString $Request.command 80
    exceptionType = $_.Exception.GetType().FullName
    scriptStack = Get-SafeString $_.ScriptStackTrace 600
  }
}
