# Albion Trade Intelligence - Windows'ta Setup.exe uretir (GitHub gerekmez).
# Kullanim: proje klasorundeki "build-windows.cmd" dosyasina cift tikla.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) {
  Write-Host ""
  Write-Host "HATA: $text" -ForegroundColor Red
  Read-Host "Kapatmak için Enter'a bas" | Out-Null
  exit 1
}

Step "Node.js kontrol ediliyor"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Start-Process "https://nodejs.org/"
  Fail "Node.js kurulu değil. Açılan sayfadan 'LTS' sürümünü indirip kur, sonra bu dosyaya tekrar çift tıkla."
}
$major = [int]((node -v).TrimStart("v").Split(".")[0])
if ($major -lt 22) { Fail "Node.js $((node -v)) çok eski. nodejs.org'dan LTS sürümünü (22 veya üstü) kur." }
Write-Host "Node.js $((node -v)) bulundu."

Step "Bağımlılıklar kuruluyor (ilk seferde birkaç dakika sürer)"
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm ci başarısız oldu." }

Step "Yakalayıcı derleniyor (Windows'un kendi C# derleyicisi)"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { Fail "C# derleyicisi bulunamadı: $csc" }
New-Item -ItemType Directory -Force "build\capture" | Out-Null
& $csc /nologo /target:winexe /out:build\capture\AlbionCapture.exe tools\albion-capture\AlbionCapture.cs
if ($LASTEXITCODE -ne 0) { Fail "Yakalayıcı derlenemedi." }

Step "Uygulama sunucusu derleniyor"
npm run build:desktop
if ($LASTEXITCODE -ne 0) { Fail "Uygulama derlenemedi." }

Step "Kurulum dosyası paketleniyor"
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { Fail "Paketleme başarısız oldu." }

$setup = Get-ChildItem "dist-electron\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Fail "Setup.exe bulunamadı." }
Write-Host ""
Write-Host "Hazır: $($setup.FullName)" -ForegroundColor Green
Write-Host "Bu dosyayı kurabilir ya da arkadaşlarına gönderebilirsin."
Start-Process explorer.exe "/select,`"$($setup.FullName)`""
Read-Host "Kapatmak için Enter'a bas" | Out-Null
