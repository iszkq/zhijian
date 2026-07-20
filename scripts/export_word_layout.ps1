param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($InputPath, $false, $true)
  $mainText = $doc.Content.Text
  $shapes = @()
  for ($i = 1; $i -le $doc.Shapes.Count; $i++) {
    $shape = $doc.Shapes.Item($i)
    $text = ''
    try { if ($shape.TextFrame.HasText) { $text = ($shape.TextFrame.TextRange.Text -replace '[\r\a]', "`n").Trim() } } catch {}
    if ($text) {
      $shapes += [ordered]@{
        index = $i; anchor = [int]$shape.Anchor.Start; left = [double]$shape.Left; top = [double]$shape.Top; text = $text
      }
    }
  }
  $payload = [ordered]@{ mainText = $mainText; shapes = $shapes }
  $payload | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $OutputPath
  Write-Output ("characters={0} shapes={1}" -f $mainText.Length, $shapes.Count)
  $doc.Close([ref]$false)
} finally {
  try { $word.Quit() } catch {}
}
