param(
  [string]$OutDir = "src-tauri/icons"
)

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Brush {
  param([string]$Hex)
  return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($Hex))
}

function Draw-AppIcon {
  param(
    [int]$Size,
    [string]$Path
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 1024.0
  function S([float]$v) { return [single]($v * $script:scale) }
  $script:scale = $scale

  $card = New-RoundedRectanglePath (S 92) (S 72) (S 840) (S 840) (S 178)
  $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 15, 23, 42))
  for ($i = 9; $i -ge 1; $i--) {
    $offset = S (10 + $i * 1.6)
    $blurPath = New-RoundedRectanglePath ((S 92) - (S $i)) ((S 72) + $offset) ((S 840) + (S ($i * 2))) ((S 840) + (S ($i * 2))) ((S 178) + (S $i))
    $g.FillPath($shadowBrush, $blurPath)
    $blurPath.Dispose()
  }

  $cardBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new((S 190), (S 140)),
    [System.Drawing.PointF]::new((S 830), (S 880)),
    [System.Drawing.ColorTranslator]::FromHtml("#ffffff"),
    [System.Drawing.ColorTranslator]::FromHtml("#f8fafc")
  )
  $g.FillPath($cardBrush, $card)

  $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(188, 209, 213, 219)), (S 8)
  $gridPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
  $gridPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
  foreach ($x in @(340, 660)) {
    $g.DrawLine($gridPen, (S $x), (S 102), (S $x), (S 902))
  }
  foreach ($y in @(270, 520, 740)) {
    $g.DrawLine($gridPen, (S 102), (S $y), (S 922), (S $y))
  }

  $pins = @(
    @{ X = 340; Y = 270; Color = "#06b6d4" },
    @{ X = 672; Y = 386; Color = "#f43f5e" },
    @{ X = 450; Y = 568; Color = "#65d80d" },
    @{ X = 665; Y = 742; Color = "#f59e0b" }
  )

  foreach ($pin in $pins) {
    $x = S $pin.X
    $y = S $pin.Y
    $shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 15, 23, 42))
    $g.FillEllipse($shadow, $x - (S 58), $y - (S 42), (S 132), (S 132))
    $white = New-Brush "#ffffff"
    $g.FillEllipse($white, $x - (S 64), $y - (S 64), (S 128), (S 128))
    $color = New-Brush $pin.Color
    $g.FillEllipse($color, $x - (S 52), $y - (S 52), (S 104), (S 104))
    $shadow.Dispose()
    $white.Dispose()
    $color.Dispose()
  }

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $gridPen.Dispose()
  $cardBrush.Dispose()
  $shadowBrush.Dispose()
  $card.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

function Get-PngBytes {
  param([int]$Size)
  $tmp = [System.IO.Path]::GetTempFileName()
  Draw-AppIcon -Size $Size -Path $tmp
  $bytes = [System.IO.File]::ReadAllBytes($tmp)
  Remove-Item -LiteralPath $tmp -Force
  return $bytes
}

function Write-Ico {
  param([string]$Path)
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $images = @()
  foreach ($size in $sizes) {
    $images += ,@{
      Size = $size
      Bytes = Get-PngBytes -Size $size
    }
  }

  $fs = [System.IO.File]::Create($Path)
  $writer = New-Object System.IO.BinaryWriter($fs)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  foreach ($image in $images) {
    $sizeByte = if ($image.Size -eq 256) { 0 } else { $image.Size }
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$image.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Bytes.Length
  }

  foreach ($image in $images) {
    $writer.Write([byte[]]$image.Bytes)
  }

  $writer.Close()
  $fs.Close()
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pngTargets = @(
  @{ Name = "32x32.png"; Size = 32 },
  @{ Name = "128x128.png"; Size = 128 },
  @{ Name = "128x128@2x.png"; Size = 256 },
  @{ Name = "icon.png"; Size = 512 },
  @{ Name = "Square30x30Logo.png"; Size = 30 },
  @{ Name = "Square44x44Logo.png"; Size = 44 },
  @{ Name = "Square71x71Logo.png"; Size = 71 },
  @{ Name = "Square89x89Logo.png"; Size = 89 },
  @{ Name = "Square107x107Logo.png"; Size = 107 },
  @{ Name = "Square142x142Logo.png"; Size = 142 },
  @{ Name = "Square150x150Logo.png"; Size = 150 },
  @{ Name = "Square284x284Logo.png"; Size = 284 },
  @{ Name = "Square310x310Logo.png"; Size = 310 },
  @{ Name = "StoreLogo.png"; Size = 50 }
)

foreach ($target in $pngTargets) {
  Draw-AppIcon -Size $target.Size -Path (Join-Path $OutDir $target.Name)
}

Write-Ico -Path (Join-Path $OutDir "icon.ico")

Write-Host "Generated app icons in $OutDir"
