# 薪时 Android（Capacitor）

这是薪时的 Android 原生壳，Web 资源全部打进 APK，不依赖电脑上的 `pnpm preview`。

- 包名：`com.xinshi.app`
- 应用名：`薪时`
- versionCode / versionName：`509` / `0.5.9`
- minSdk 22 / targetSdk 34；文件导出使用 MediaStore，建议 Android 10+（API 29+）。
- 原生能力：
  - 状态栏深绿 + 浅色图标；
  - Android 12 启动屏纸色背景 + 品牌图标；
  - 返回键优先关闭弹层 / 子页面，首页再按收起到后台；
  - 导出备份 / PDF / 工资条图片写入公共目录 **Download/Xinshi/**（自定义 `SaveFilePlugin`，不依赖分享面板）；
  - 原生壳内不注册 Service Worker，避免 APK 更新后缓存旧页面。

## 构建

前置：JDK 17、Android SDK（platform 34、build-tools 34）、Gradle 8.2.1。

```bash
pnpm install
pnpm build
pnpm exec cap sync android

cd android
# Windows
gradlew.bat assembleDebug
# macOS / Linux
./gradlew assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

如果 Gradle 下载慢，可在 Android Studio 中打开 `android/` 构建，或使用本机已缓存的 Gradle 发行版。

`android/local.properties` 由本机生成，不要提交：

```properties
sdk.dir=D:/Android/Sdk
```

## 安装到雷电 / 真机

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.xinshi.app/.MainActivity
```

调试构建可通过 `chrome://inspect` / adb WebView devtools 连接；正式包关闭 WebView 调试。

## 正式签名

仓库**不包含**签名密钥。正式分发前在本机生成并妥善保管 keystore；丢失后无法覆盖升级。

```bash
keytool -genkeypair -v -keystore android/keystore/xinshi-release.jks \
  -alias xinshi -keyalg RSA -keysize 2048 -validity 10000

cd android
gradlew.bat assembleRelease

# 对齐 + 签名（build-tools 版本按本机调整）
zipalign -f 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
apksigner sign --ks keystore/xinshi-release.jks --ks-key-alias xinshi \
  --out ../release/xinshi-v0.5.9.apk aligned.apk
apksigner verify ../release/xinshi-v0.5.9.apk
```

当前测试包：`release/xinshi-v0.5.9.apk`（本机签名，未提交 Git）。

## 已验证环境

- 雷电模拟器 LDPlayer 14，Android 14，x86_64，720×1280。
- 启动、引导、示例数据、固定月薪、随机休息、超休扣款、收款状态、CSV 导出、工作回收站、批量排休、固定周排班、未来计划、多岗位切换、计划日补记、批量补记（自定义范围 / 跨范围勾选 / 工时 / 奖金 / 扣款 / 逐天微调 / 逐天备注 / 岗位模板 / 模板导入导出 / 备注）、排班岗位记忆、发薪通知调度、计件、PDF/PNG/加密备份保存、加密导入、返回键均通过。
- 导出文件实际路径：`/sdcard/Download/Xinshi/`。

## 注意

- 先装 debug 再装 release 会因签名不同失败，需先卸载 debug（会清本地数据）。
- APK 内导出会直接写 `Download/Xinshi`，不会弹系统分享面板；导入仍使用系统文件选择器。
- 网页版和 APK 使用同一套 `localStorage` 数据格式；换端仍靠导出 / 导入备份。
- 云同步尚未实现，原因见根目录 `docs/CLOUD-SYNC.md`。
