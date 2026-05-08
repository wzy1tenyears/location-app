# Android 客户端

这是不用 Android Studio 的原生 Android WebView 客户端。它会打开你的服务器用户端页面，也就是网站根目录 `/`。

## 目录

- `AndroidManifest.xml`：Android 权限和入口 Activity
- `src/com/familylocation/client/MainActivity.java`：客户端代码
- `build.ps1`：不用 Gradle 的命令行 APK 构建脚本

## 构建方式

先安装 JDK 和 Android SDK，并设置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`；也可以直接传入 `-SdkRoot`。

在 `android-client` 目录运行，例如：

```powershell
.\build.ps1 -SdkRoot D:\Android\Sdk
```

输出 APK：

```text
android-client\build\FamilyLocation-debug.apk
```
