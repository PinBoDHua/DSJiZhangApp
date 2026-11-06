# 薪时 Android（Capacitor）

这是薪时的 Android 原生壳，Web 资源全部打进 APK，不依赖电脑上的 `pnpm preview`。

- 包名：`com.xinshi.app`
- 应用名：`薪时`
- versionCode / versionName：`900` / `0.9.0`（可用 `-Pxinshi.versionCode=901 -Pxinshi.versionName=0.9.1` 覆盖）
- minSdk 22 / compileSdk 36 / targetSdk 36；文件导出使用 MediaStore，建议 Android 10+（API 29+）。
- release 开启 R8 + `shrinkResources`，APK 约 **3.3MB**；混淆 mapping 在 `app/build/outputs/mapping/release/mapping.txt`，发布时归档。
- 上架合规：
  - **不申请 INTERNET 权限**，应用内没有上传接口；
  - `allowBackup=false`，关闭系统云备份，备份由应用内完成；
  - 只保留 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK` 三个用户可见权限（另有 AndroidX 自动生成的应用私有签名权限）；
  - 首次启动隐私政策弹窗，未同意不进入；隐私政策页在「我的 → 数据与安全」。
- 原生能力：
  - 状态栏深绿 + 浅色图标；
  - Android 12 启动屏纸色背景 + 品牌图标；
  - 返回键优先关闭弹层 / 子页面，首页再按收起到后台；
  - 导出备份 / 自动备份 / PDF / 工资条图片 / Excel 写入公共目录 **Download/Xinshi/**（自定义 `SaveFilePlugin`，不依赖分享面板）；
  - `SaveFilePlugin` 支持同名覆盖与按前缀保留最新 N 份，用于自动备份轮转；
  - 原生壳内不注册 Service Worker，避免 APK 更新后缓存旧页面。

## 构建

前置：JDK 17、Android SDK（platform 36、build-tools 36）、Gradle 8.14.3、AGP 8.13.2。

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

## 正式签名与商店构建

仓库**不包含**签名密钥。正式分发前在本机生成并妥善保管 keystore；丢失后无法覆盖升级。

签名配置从 gitignore 的 `android/keystore/signing.properties` 读取：

```properties
storeFile=keystore/xinshi-release.jks
storePassword=...
keyAlias=xinshi
keyPassword=...
```

```bash
cd android
# 国内商店 / 侧载
gradlew.bat assembleRelease
# Google Play（推荐上传 AAB）
gradlew.bat bundleRelease
```

本地排查时可以让 **release 签名包**带 WebView 调试（仅测试，不要发布）：

```bash
gradlew.bat assembleRelease "-Pxinshi.debuggable=true"
```

它会关闭 R8、打开 `debuggable`，但沿用 release keystore，因此可以直接覆盖旧版正式包并保留账本数据；
随后用 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 配合 `scripts/android-v080-check.mjs` 驱动。
测试完再构建不带该参数的正式包覆盖安装即可。

- APK：`app/build/outputs/apk/release/app-release.apk`
- AAB：`app/build/outputs/bundle/release/app-release.aab`
- 复制到 `release/xinshi-v0.9.0.apk` / `release/xinshi-v0.9.0.aab`。
- 校验：

```bash
apksigner verify --print-certs release/xinshi-v0.9.0.apk
jarsigner -verify -verbose -certs release/xinshi-v0.9.0.aab
aapt dump badging release/xinshi-v0.9.0.apk
aapt dump permissions release/xinshi-v0.9.0.apk
```

- keystore 必须离线备份两份；商店资料见根目录 [docs/STORE-LISTING.md](../docs/STORE-LISTING.md)。

## 已验证环境

- 雷电模拟器 LDPlayer 14，Android 14，x86_64，720×1280。
- 启动、隐私同意 / 不同意退出、示例数据、数据与安全、本机快照生成与恢复、自动备份开关与文件写入、同名覆盖、按前缀保留最新 2 份测试、账本体检孤儿解锁、Excel 导出、返回键。
- v0.7.0：R8 release 启动正常；用 R8 压缩的 debug 包验证 `SaveFilePlugin` 写入 / 覆盖 / 轮转与 WebView 页面无崩溃；新图标 / 启动屏、悬浮底部导航、首页月进度、时长快选、热力图通过截图检查。
- v0.7.1 真机：Redmi Note 13 Pro 5G（HyperOS 3 / Android 16，arm64）——v0.7.0 R8 包一开就闪退；`adb shell dumpsys dropbox --print` 取到 `Plugin.getPermissionStates` NPE 堆栈，补 `@CapacitorPlugin` / `@Permission` 的 `-keep` 与 `-keepattributes` 后，在 LDPlayer 14 上用 R8 包 + 示例数据复现 → 修复 → 回归通过。
- v0.7.2 真机：同机 1220×2712 @480dpi（407×904 CSS），状态栏安全区 122px / 手势条 48px；安装后首页正常、内容不被状态栏压住、悬浮底栏距底 25pt；`--gutter` 统一后页面无 1–3px 横向溢出。
- v0.8.0 真机：同机用 `-Pxinshi.debuggable=true` 的 release 签名包覆盖 0.7.2（4 笔账本完整保留），通过 CDP 验证记录搜索、年度统计、关于页 0.8.0、导出备份到 `Download/Xinshi`、深色模式；软键盘展开后底部抽屉跟随可视视口收缩，保存按钮在键盘上方。正式包安装后冷启动正常，权限仍只有通知 / 开机提醒 / WakeLock，无 INTERNET。
- v0.9.0 构建：签名 APK / AAB 构建通过；`aapt` 校验 `versionCode 900` / `versionName 0.9.0`，权限不变、无 INTERNET；本版未重跑真机，原生壳与 v0.8.0 一致。
- v0.5 回归：固定月薪、随机休息、月结页补标 / 取消休息、月度考勤总表 / 半天休 / 格子补记工、结算二维码显示与保存 / 校验码、工资条模板 / 文字版 PDF、考勤 CSV、超休扣款、收款状态、CSV 导出、工作回收站、批量排休、固定周排班、未来计划、多岗位切换、计划日补记、批量补记、排班岗位记忆、系统本地每日提醒 / 通知权限 / 测试通知 / 30 天续排、发薪通知调度、计件、PDF/PNG/加密备份保存、加密导入。
- 导出文件实际路径：`/sdcard/Download/Xinshi/`；自动备份目录：`/sdcard/Download/Xinshi/自动备份/`，保留最新 14 份。
- Debug 构建通过 CDP 驱动 WebView 验证：自动备份开关后写入 `薪时自动备份-20261105.json`，`SaveFile.prune` 保留最新文件，`overwrite` 只留一份。

手动复验（debug 包 + WebView devtools）：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.xinshi.app)
node scripts/android-v060-check.mjs
node scripts/android-plugin-check.mjs
```

## 注意

- 先装 debug 再装 release 会因签名不同失败，需先卸载 debug（会清本地数据）。
- APK 内导出会直接写 `Download/Xinshi`，不会弹系统分享面板；导入仍使用系统文件选择器。
- 自动备份默认关闭；开启后是明文 JSON，能读手机文件的应用可能看到内容。
- 网页版和 APK 使用同一套 `localStorage` 数据格式；换端用加密搬家包，不要直接拷 `localStorage`。
- 云同步暂停，原因见根目录 `docs/CLOUD-SYNC.md`；无服务器方案见 `docs/PLAN-v0.6.md`，轻小美发布见 `docs/PLAN-v0.7.md`。
- targetSdk 36 在 Android 15/16 上会启用 edge-to-edge；发布前需要在 Android 15/16 真机复核状态栏与安全区。
