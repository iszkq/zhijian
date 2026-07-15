param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$items = [System.Collections.Generic.List[object]]::new()

function Add-ShapeText {
  param($Shape, [int]$Page, [double]$ParentLeft, [double]$ParentTop)

  try {
    if ($Shape.TextFrame.HasText -ne 0) {
      $text = $Shape.TextFrame.TextRange.Text -replace "[\r\a]+", "`n"
      $text = $text.Trim()
      if ($text) {
        $items.Add([PSCustomObject]@{
          page = $Page
          left = [Math]::Round($ParentLeft + [double]$Shape.Left, 2)
          top = [Math]::Round($ParentTop + [double]$Shape.Top, 2)
          text = $text
        })
      }
    }
  } catch {}

  try {
    if ($Shape.Type -eq 6) {
      for ($index = 1; $index -le $Shape.GroupItems.Count; $index++) {
        Add-ShapeText -Shape $Shape.GroupItems.Item($index) -Page $Page -ParentLeft ($ParentLeft + [double]$Shape.Left) -ParentTop ($ParentTop + [double]$Shape.Top)
      }
    }
  } catch {}
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $document = $word.Documents.Open($resolvedInput, $false, $true)
  for ($index = 1; $index -le $document.Shapes.Count; $index++) {
    $shape = $document.Shapes.Item($index)
    $page = [int]$shape.Anchor.Information(3)
    Add-ShapeText -Shape $shape -Page $page -ParentLeft 0 -ParentTop 0
  }
  $document.Close($false)
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}

$items |
  Sort-Object page, top, left |
  ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath $OutputPath -Encoding utf8

Write-Output "Exported $($items.Count) text shapes to $OutputPath"
