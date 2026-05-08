param(
    [string]$SdkRoot = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($SdkRoot)) {
    if ($env:ANDROID_HOME) {
        $SdkRoot = $env:ANDROID_HOME
    } elseif ($env:ANDROID_SDK_ROOT) {
        $SdkRoot = $env:ANDROID_SDK_ROOT
    } else {
        throw "Please pass -SdkRoot or set ANDROID_HOME / ANDROID_SDK_ROOT."
    }
}

$SdkRoot = [System.IO.Path]::GetFullPath($SdkRoot)
$PlatformsDir = Join-Path $SdkRoot "platforms"
$BuildToolsDir = Join-Path $SdkRoot "build-tools"

if (-not (Test-Path -LiteralPath $PlatformsDir)) {
    throw "Missing Android platforms: $PlatformsDir"
}

if (-not (Test-Path -LiteralPath $BuildToolsDir)) {
    throw "Missing Android build-tools: $BuildToolsDir"
}

$Platform = Get-ChildItem -LiteralPath $PlatformsDir -Directory | Sort-Object Name -Descending | Select-Object -First 1
$BuildTools = Get-ChildItem -LiteralPath $BuildToolsDir -Directory | Sort-Object Name -Descending | Select-Object -First 1

if (-not $Platform) {
    throw "No Android platform found, for example platforms\android-35."
}

if (-not $BuildTools) {
    throw "No Android build-tools found, for example build-tools\35.0.0."
}

$AndroidJar = Join-Path $Platform.FullName "android.jar"
$Aapt2 = Join-Path $BuildTools.FullName "aapt2.exe"
$D8 = Join-Path $BuildTools.FullName "d8.bat"
$Zipalign = Join-Path $BuildTools.FullName "zipalign.exe"
$ApkSigner = Join-Path $BuildTools.FullName "apksigner.bat"
$JavaC = (Get-Command javac -ErrorAction Stop).Source
$Jar = (Get-Command jar -ErrorAction Stop).Source
$Keytool = (Get-Command keytool -ErrorAction Stop).Source

foreach ($tool in @($AndroidJar, $Aapt2, $D8, $Zipalign, $ApkSigner, $JavaC, $Jar, $Keytool)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Missing tool: $tool"
    }
}

$BuildDir = Join-Path $ProjectRoot "build"
$ClassesDir = Join-Path $BuildDir "classes"
$DexDir = Join-Path $BuildDir "dex"
$ResDir = Join-Path $ProjectRoot "res"
$CompiledRes = Join-Path $BuildDir "resources.zip"
$UnsignedApk = Join-Path $BuildDir "FamilyLocation-unsigned.apk"
$AlignedApk = Join-Path $BuildDir "FamilyLocation-aligned.apk"
$FinalApk = Join-Path $BuildDir "FamilyLocation-debug.apk"
$Keystore = Join-Path $ProjectRoot "debug.keystore"

if (Test-Path -LiteralPath $BuildDir) {
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $BuildDir, $ClassesDir, $DexDir | Out-Null

$LinkArgs = @(
    "link",
    "-I", $AndroidJar,
    "--manifest", (Join-Path $ProjectRoot "AndroidManifest.xml"),
    "-A", (Join-Path $ProjectRoot "assets"),
    "--min-sdk-version", "23",
    "--target-sdk-version", "35",
    "--version-code", "21",
    "--version-name", "1.1.6",
    "-o", $UnsignedApk,
    "--auto-add-overlay"
)

if (Test-Path -LiteralPath $ResDir) {
    & $Aapt2 compile --dir $ResDir -o $CompiledRes
    $LinkArgs += @("-R", $CompiledRes)
}

& $Aapt2 @LinkArgs

$Sources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "src") -Recurse -Filter *.java | Select-Object -ExpandProperty FullName
if (-not $Sources) {
    throw "No Java source files found."
}

& $JavaC `
    -encoding UTF-8 `
    -source 17 `
    -target 17 `
    -classpath $AndroidJar `
    -d $ClassesDir `
    $Sources

$ClassFiles = Get-ChildItem -LiteralPath $ClassesDir -Recurse -Filter *.class | Select-Object -ExpandProperty FullName
& $D8 --lib $AndroidJar --output $DexDir $ClassFiles
& $Jar uf $UnsignedApk -C $DexDir classes.dex

if (-not (Test-Path -LiteralPath $Keystore)) {
    & $Keytool -genkeypair `
        -keystore $Keystore `
        -storepass android `
        -keypass android `
        -alias androiddebugkey `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=Android Debug,O=Android,C=US"
}

& $Zipalign -f -p 4 $UnsignedApk $AlignedApk
& $ApkSigner sign `
    --ks $Keystore `
    --ks-pass pass:android `
    --key-pass pass:android `
    --out $FinalApk `
    $AlignedApk

Write-Host "APK generated: $FinalApk"
