# 薪时 XINSHI · R3 审计附录 D：Android 原生壳 / 构建 / 发布 / 仓库卫生

> 审计日期：2026-11-20（Asia/Shanghai）
> 审计基线：`git HEAD d0d8f83`（v1.2.5 / versionCode 1205 / SW v32），工作树干净
> 审计方式：**只读**。未修改任何源码 / 配置 / 产物；未执行 `pnpm build`、gradle 构建或任何写产物的命令；未读取 `android/keystore/*`、`signing.properties`、`password.txt` 的内容（仅核存在性与 git 跟踪状态）。
> 环境：Windows MSYS bash；node v24.19.0；pnpm 11.21.0；JDK 17.0.12；Android SDK 位于 `D:/Android/Sdk`（`ANDROID_HOME` / `ANDROID_SDK_ROOT` 未设置，`android/local.properties:1` 有 `sdk.dir=D:/Android/Sdk`）
> 上轮基线：`docs/AUDIT-v1.2.4-R2.md`（AND-01…AND-21、DEP-01/02/03）+ `docs/AUDIT-v1.2.4-R2-fixes.md`

## 0. 结论摘要

| 严重度 | 数量 | 说明 |
| --- | --- | --- |
| P0 | 0 | 无数据丢失 / 无发布阻断级缺陷 |
| P1 | 0 | 上轮 4 个 P1（AND-01/02/03/04）经代码与**真实 APK 产物**复核均已落地；未发现新增 P1 |
| P2 | 6 | 发布守卫与门禁的「可绕过/静默降级」面、产物版本与 assets 漂移无断言、上架材料过期、`.env` 政策 URL 陷阱 |
| P3 | 11 | 脚本硬编码残留、CSP 门禁弱、无 CI、SW 导航缓存语义、release 目录卫生、生成文件入库等 |
| **合计** | **17** | 另：DEP-01/02/03 仍开放（dev 链 29 条公告，运行时 0 条） |

**关键正面结论**（均以真实产物复核，非静态推断）：

- 合并清单（release APK 实测）**无 INTERNET / 无相机 / 无定位 / 无存储权限**；仅 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK` + AndroidX 私有签名权限。
- `dataExtractionRules` 已编进 APK（`res/4j.xml`），`cloud-backup` 与 `device-transfer` 均排除 9 个域；`allowBackup=false`、`fullBackupContent=false` 同存。
- 正式 APK **无 `application-debuggable`**；v1 + v2 签名验证通过，证书 SHA-256 `a5b8514a…d606` 与发布说明逐字一致；AAB `jarsigner -verify` 退出码 0。
- 版本链完全一致：`package.json 1.2.5` == gradle `1205/1.2.5` == APK badging == `SW xinshi-v32`；`dist`、`android/app/src/main/assets/public`、APK 内 `assets/public` 三方逐文件 sha256 **零差异**（仅多 Capacitor 生成的 `cordova.js` / `cordova_plugins.js`）。
- CSP 已注入且在 APK 内生效：`script-src 'self' 'sha256-…'`（无 `unsafe-inline`），meta 位于内联脚本之前，hash 与内联脚本实测一致。
- 运行时依赖 `pnpm audit --prod`：**0 漏洞**；29 条公告全部 `dev=true`。

## 1. 审计方法与可复现命令

| # | 命令 | 实测结果 |
| --- | --- | --- |
| 1 | `node scripts/check-release-config.mjs` | 16 PASS / 0 FAIL；aapt2 项为 NOTE |
| 2 | `ANDROID_HOME=D:/Android/Sdk node scripts/check-release-config.mjs` | **19 PASS / 0 FAIL**（多出 3 个 APK 的 `application-debuggable` 断言） |
| 3 | `node scripts/check-offline-csp.mjs` | 16 项全 PASS（预缓存 42 项、CSP hash 一致、SW v32） |
| 4 | `for f in scripts/*.mjs; do node --check "$f"; done` | 66 个文件，0 语法错误 |
| 5 | `pnpm audit --json` | 29 条：critical 4 / high 9 / moderate 15 / low 1，**全部 dev=true** |
| 6 | `pnpm audit --prod --json` | 0 条 |
| 7 | `aapt2 dump badging release/xinshi-v1.2.5.apk` | versionCode 1205 / versionName 1.2.5 / minSdk 22 / targetSdk 36；无 `application-debuggable` |
| 8 | `aapt2 dump permissions release/xinshi-v1.2.5.apk` | 仅 3 个普通权限 + 1 个 AndroidX 私有权限（见 §5） |
| 9 | `aapt2 dump xmltree --file AndroidManifest.xml …apk` | 无 cleartext / networkSecurityConfig / debuggable / taskAffinity |
| 10 | `aapt2 dump xmltree --file res/4j.xml …apk` / `res/8K.xml` | 数据提取规则 18 条 exclude；FileProvider 仅 `cache-path exports/` |
| 11 | `apksigner verify --print-certs -v release/xinshi-v1.2.5.apk` | v1/v2 true；证书 CN=Xinshi、SHA-256 `a5b8514a…d606` |
| 12 | `jarsigner -verify release/xinshi-v1.2.5.aab` | exit 0（签名与完整性通过） |
| 13 | `sha256sum release/xinshi-v1.2.5.{apk,aab}` | `bee4a4cc…7582` / `388993af…d330`，与 fixes §11 逐字一致 |
| 14 | python `zipfile` 对比 `dist` / assets / APK 内 `assets/public` | 47 vs 49 vs 49 文件；内容差异 0；only-in = cordova 两文件 |
| 15 | `git ls-files` / `git check-ignore -v` / `git log --diff-filter=A` | 533 个跟踪文件；密钥类 0 跟踪、0 历史添加；logcat/test-results 未跟踪且被忽略 |

## 2. 发现总览

| # | 严重度 | 一句话 | 位置 |
| --- | --- | --- | --- |
| D01 | **P2** | `-Pxinshi.diag` 未被 release 守卫拦截：正式签名包仍会在每次启动/崩溃写公共 `Download/Xinshi/xinshi-diag.txt`，绕过 AND-01 修复 | app/build.gradle:18-21,35,89-98；XinshiApp.java:67-69,124,137-139 |
| D02 | **P2** | `check:release` 找 aapt2 只看 `ANDROID_HOME`/`ANDROID_SDK_ROOT`：本机 SDK 明明存在（local.properties 有 sdk.dir）仍降级 NOTE，产物级守卫失效 | check-release-config.mjs:120-139,417-423 |
| D03 | **P2** | 发布门禁不校验产物版本与签名：`-Pxinshi.versionCode/versionName` 可覆盖，APK 只查 debuggable；错版本 APK 仍 19 PASS | app/build.gradle:11-16,33-34；check-release-config.mjs:144-176,425-435 |
| D04 | **P2** | `android/app/src/main/assets/public` 与 `dist` 的漂移没有 FAIL 级断言（AND-05 声称的「assets 哈希比对」未实现），旧 assets 可被打进 APK 且检查全绿 | android/.gitignore:95-96；check-offline-csp.mjs:13；check-release 全文 |
| D05 | **P2** | `STORE-LISTING.md` 仍写 v1.0.0 / versionCode 1000，SHA 表无 1.2.5：按它填商店会写错版本，发布 SOP 无 1.2.5 hash 可核 | docs/STORE-LISTING.md:4,17,166,242-245 |
| D06 | **P2** | `.env.example` 的 `VITE_PRIVACY_URL=https://example.com/…` 会被 Vite 自动加载并覆盖安全默认值，且 `check:release` 对任何 https 一律 PASS | .env.example:6；compliance.ts:17；check-release-config.mjs:226-241 |
| D07 | P3 | 28 个截图/审计脚本仍硬编码 `127.0.0.1:4173` + Edge x86 路径（且已 import 共享配置却不用其 BASE/BROWSER）；无 preview 自动启动 | responsive-audit.mjs:3,5-6 等 28 文件；package.json:19-25 |
| D08 | P3 | `check:release` 的 CSP 断言只查「meta 存在」；指令/hash/位置正确性只在未接线的 `check-offline-csp.mjs` | check-release-config.mjs:446-469 |
| D09 | P3 | 无 CI、无 audit 门禁：typecheck/test/build/check:offline/check:release/audit 全靠人工；DEP-01/02/03 无法被自动发现 | 仓库根无 .github；package.json:11-29 |
| D10 | P3 | SW 把**任意** navigation 响应写成 `/index.html`，离线导航一律回退 index.html：打开政策页会污染 app 壳缓存、离线打开政策页显示 app 壳 | public/sw.js:59-77（:69、:76） |
| D11 | P3 | `release/` 36 个产物（20 个 APK + 10 个 AAB）无校验索引；只有 v1.2.4 的 mapping，v1.2.5 无 mapping 可反混淆 | release/（目录） |
| D12 | P3 | 生成的 `capacitor.settings.gradle` 被 git 跟踪，内含 `.pnpm` 精确路径；依赖一变即失效/产生提交噪声 | android/capacitor.settings.gradle:3,6,9 |
| D13 | P3 | `version.ts` 回退值硬编码 `1.2.5`，只改 package.json 时非构建路径版本会漂移 | src/lib/version.ts:5-7 |
| D14 | P3 | Gradle wrapper 发行包无 `distributionSha256Sum`（供应链加固缺口） | android/gradle/wrapper/gradle-wrapper.properties:3 |
| D15 | P3 | R2 修复记录与实际不符：写「15 项 PASS」「SW v31」，实测 16/19 PASS、SW v32 | docs/AUDIT-v1.2.4-R2-fixes.md:17,54-55 |
| D16 | P3（存疑） | LMK 回收分支只 `recreate()`，不计数、无上限、无出口；反复回收时可能无限重建 | MainActivity.java:82-91,96-99 |
| D17 | P3 | Android 5–9 分享前清空整个 `cache/exports`：上一次分享面板仍打开时其文件被删，接收方读取失败 | SaveFilePlugin.java:136-138,165-176 |

## 3. 逐条详情

### D01 [P2] `-Pxinshi.diag` 未被 release 守卫拦截（AND-01 的可绕过面）

- **位置**：`android/app/build.gradle:18-21,35,89-98`；`android/app/src/main/java/com/xinshi/app/XinshiApp.java:67-69,124,137-139`；`MainActivity.java:67-69,126-128`
- **证据**：
  - `xinshiDiag = project.hasProperty('xinshi.diag')`（build.gradle:21），`buildConfigField "boolean","XINSHI_DIAG"` 与 buildType 无关（:35）。
  - `export()` 的守卫是 `if (!BuildConfig.XINSHI_DIAG && !BuildConfig.DEBUG) return;`（XinshiApp.java:137-139）；`crash()` 末尾无条件调用 `export()`（:124）；`onCreate`/`onPageLoaded`/`onResume` 在 `XINSHI_DIAG` 时导出（XinshiApp.java:67-69；MainActivity.java:67-69,126-128）。
  - taskGraph 守卫只拒绝 `-Pxinshi.debuggable` / `-Pxinshi.webviewDebug`（build.gradle:89-98），**完全不看 `xinshi.diag`**；check 脚本的守卫检查也只断言这两个键（check-release-config.mjs:384-396）。
- **影响**：带 `-Pxinshi.diag` 的**已签名 release** 每次启动/回前台/页面加载/崩溃都会把设备厂商型号、Android 版本、WebView 版本、启动节点与堆栈写入公共 `Download/Xinshi/xinshi-diag.txt`（Android 5–9 写入 `Android/data/<包名>/files/Xinshi/`）。这正是 AND-01 要消除的「崩溃诊断写公共目录」，只是从「无条件」收窄成「构建参数触发」。
- **触发条件**：`./gradlew assembleRelease -Pxinshi.diag`（守卫通过）→ 安装启动 → `Download/Xinshi/xinshi-diag.txt`。
- **解决方案**：把 `xinshiDiag` 纳入守卫拒绝列表（或仅在 `debug` buildType 才置 `XINSHI_DIAG=true`，release 永远 false）；`check:release` 增加静态断言——release 配置不得引用 `xinshi.diag`；如需发布版诊断，改为用户显式「导出诊断」按钮触发。
- **置信度**：高（代码路径确定；未实跑构建，因审计禁止写产物）

### D02 [P2] `check:release` 的 aapt2 发现只看环境变量，SDK 存在也静默降级 NOTE

- **位置**：`scripts/check-release-config.mjs:120-139`（`findAapt2()`）、`:417-423`（NOTE 分支）
- **证据**：
  - `findAapt2()` 只读 `process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT`（:122），不读 `android/local.properties` 的 `sdk.dir`，也不探测常见安装路径。
  - 本机 `ANDROID_HOME` 未设置，但 `android/local.properties:1` 为 `sdk.dir=D:/Android/Sdk`，`D:/Android/Sdk/build-tools/36.0.0/aapt2.exe` 真实存在。
  - 实测：`node scripts/check-release-config.mjs` → `NOTE 未找到 aapt2…无法自动校验 3 个 release APK 的 application-debuggable`；`ANDROID_HOME=D:/Android/Sdk node scripts/check-release-config.mjs` → 3 个 APK 全部 `PASS release APK 不可调试`（总数 19 PASS）。
- **影响**：发布门禁在最常见的 Android Studio 工作流（SDK 只写在 `local.properties`）下自动降级为 NOTE，AND-03 的产物级防线名存实亡；CI 未导出环境变量时同样如此。
- **触发条件**：`node scripts/check-release-config.mjs`（本机已复现）。
- **解决方案**：`findAapt2()` 按 `ANDROID_HOME` → `ANDROID_SDK_ROOT` → `android/local.properties` 的 `sdk.dir` → `%LOCALAPPDATA%\Android\Sdk` 顺序探测；探测到 SDK 却找不到 aapt2 时应 FAIL 而非 NOTE。
- **置信度**：高（实测）

### D03 [P2] 发布门禁不校验产物版本/签名，且构建期版本可被覆盖

- **位置**：`android/app/build.gradle:11-16,33-34`；`scripts/check-release-config.mjs:144-176`（只比对 build.gradle 默认值）、`:425-435`（只查 application-debuggable）
- **证据**：
  - `-Pxinshi.versionCode` / `-Pxinshi.versionName` 可任意覆盖 `versionCode`/`versionName`（build.gradle:11-16），守卫不过问。
  - `check:release` 解析的是 `build.gradle` 里的**默认值**（:149-150），不是产物 `badging`；产物断言仅匹配 `application-debuggable`（:431），不比对 versionCode/versionName，也不调用 `apksigner verify`。
  - 反向实测：当前 `release/xinshi-v1.2.5.apk` 的 badging 恰为 1205/1.2.5、证书与文档一致——**当前产物没问题，缺的是门禁**。
- **影响**：`./gradlew assembleRelease -Pxinshi.versionCode=1200` 产出的签名 APK 命名为 `xinshi-v1.2.5.apk` 也能 19 PASS；直发会因 versionCode 回退无法覆盖安装，或商店版本号与实际不符。用错误 keystore 签的包同样能过检查（会导致后续升级签名冲突）。
- **触发条件**：上述命令 + `node scripts/check-release-config.mjs`。
- **解决方案**：对最新 APK 断言 `versionCode == package.json 派生值`、`versionName == package.json`（FAIL 级）；`apksigner verify --print-certs` 断言证书 SHA-256 与 `RELEASE-NOTES` 登记值一致；对 AAB 用 `jarsigner -verify` 或 bundletool 做存在性/签名断言。
- **置信度**：高

### D04 [P2] `assets/public` 与 `dist` 漂移无门禁（AND-05 声称的 assets 断言未实现）

- **位置**：`android/.gitignore:95-96`（`app/src/main/assets/public` 被忽略）；`scripts/check-offline-csp.mjs:13`（只读 `dist/`）；`scripts/check-release-config.mjs` 全文无 assets 比对
- **证据**：
  - 两个检查脚本都不读 `android/app/src/main/assets/public`，也不读 APK 内 `assets/public`。
  - 实测当前**没有漂移**：dist 47 文件 / assets 49 / APK 49，逐文件 sha256 内容差异为 0，仅多 `cordova.js`、`cordova_plugins.js`；`index.html`、`precache-manifest.json`、`sw.js`、`privacy-policy.html` 哈希三方一致。
  - 但 `pnpm build` 与 `cap sync` 是两步（README:469、android/README:40），漏掉第二步不会导致任何检查失败。
- **影响**：修改源码后只 `pnpm build` 不 `cap sync`，再用旧 assets 打包，APK 会带旧 JS（可能是已修漏洞的版本），而 `check:release` + `check:offline` 全绿。
- **触发条件**：改 `src/` → `pnpm build`（不 cap sync）→ `./gradlew assembleRelease` → `node scripts/check-release-config.mjs` 仍 PASS。
- **解决方案**：`check:release` 增 FAIL 级断言：`dist` 与 `android/app/src/main/assets/public` 逐文件 sha256 一致（白名单 `cordova.js`、`cordova_plugins.js`）；或读取最新 APK 的 `assets/public/index.html` 与 `dist/index.html` 比对（脚本已有 aapt2 定位逻辑，可复用 python/zip 或 `unzip -p`）。
- **置信度**：高

### D05 [P2] `STORE-LISTING.md` 版本/哈希仍停在 v1.0.0

- **位置**：`docs/STORE-LISTING.md:4`（版本 1.0.0 / versionCode 1000 / 更新 2026-11-06）、`:17`、`:166`（「上传签名 AAB；versionCode 1000」）、`:242-245`（APK/AAB/证书 SHA-256 表只有 1.0.0 与 0.9.0）
- **证据**：当前 `package.json` 1.2.5、APK badging 1205；`docs/RELEASE-NOTES-v1.2.5.md:79-80` 才是 1205 与新哈希。`STORE-LISTING` 的校验值段没有 1.2.5 的 `bee4a4cc…` / `388993af…`。
- **影响**：按该文档提交商店会填错 versionCode；发布 SOP「只从 release/ 取带 hash 登记的成品」对 1.2.5 无 hash 可核；外部复核/渠道分发无法据此验签。上架前必须更新，属**上架材料阻断项**（改文档即可，故记 P2 不记 P0）。
- **触发条件**：直接按 `STORE-LISTING.md` 填写商店表单/执行第 149-150 行命令（命令仍写 `release/xinshi-v1.0.0.apk`）。
- **解决方案**：头部与 §1、§上架清单改为 1.2.5 / 1205；补 1.2.5 的 APK/AAB/证书 SHA-256；或改为「版本与校验值以 `docs/RELEASE-NOTES-v<version>.md` 为准」的单源引用，避免双份漂移。
- **置信度**：高

### D06 [P2] `.env.example` 的 `example.com` 政策 URL 会被自动加载并通过检查

- **位置**：`.env.example:6`（`VITE_PRIVACY_URL=https://example.com/privacy-policy.html`）；`src/lib/compliance.ts:17`（`env.VITE_PRIVACY_URL || 'privacy-policy.html'`）；`scripts/check-release-config.mjs:226-241`
- **证据**：
  - Vite 默认自动加载项目根 `.env`；README:674 把 `.env.example` 作为覆盖方式的入口。
  - `check:release` 只解析 `compliance.ts` 的默认值：任何 `https://` 均 `PASS PRIVACY_URL 默认值不是已失效地址`（:233-235），不读 `.env`、不扫构建产物里的 URL，占位名单只有邮箱（:27）。
  - 当前仓库无 `.env`，`dist` 内嵌的是 `privacy-policy.html` 与真实邮箱——**HEAD 未触发**；一旦 `cp .env.example .env` 即触发。
- **影响**：构建会把 `https://example.com/privacy-policy.html` 编进 App，应用内「完整政策页」显示该地址（`src/components/PrivacyPolicy.tsx:125`），商店填写的政策 URL 也会是 example.com；Android 侧无 INTERNET，打开必失败，商店审核会判「隐私政策链接不可用」。
- **触发条件**：`cp .env.example .env && pnpm build && node scripts/check-release-config.mjs` → PASS，而 dist 已含 example.com。
- **解决方案**：`.env.example` 中 `VITE_PRIVACY_URL=` 留空或注释；`check:release` 把 `example.com` / `your.site` / `localhost` 纳入占位 URL 并在 STRICT 下 FAIL；增加「构建产物内不得出现占位域名」扫描。
- **置信度**：高（链路静态确定）

### D07 [P3] 28 个截图/审计脚本仍硬编码 4173 + Edge x86，且无 preview 自动启动

- **位置**：代表 `scripts/responsive-audit.mjs:3,5-6`；同类共 28 个：`audit-v080-a11y/dark/perf`、`qa-v070`、`responsive-audit/probe/subpages`、`shoot-v02…v100-final`；`package.json:19-25`
- **证据**：
  - `grep -l 4173 scripts/*.mjs | xargs grep -l msedge | wc -l` = **28**。
  - 这 28 个文件都已 `import { seedPrivacyConsent } from './lib/e2e-config.mjs'`（如 `shoot-v02-final.mjs:2`），却仍写死 `const BASE='http://127.0.0.1:4173'`、`const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`（:5-6）。
  - 仅 functional 家族 28 个改用 `E2E_BASE_URL` / `E2E_BROWSER_PATH`（`functional.mjs:4-7`）。
  - 所有脚本都假定已有 preview 在 4173 监听，`test:e2e`/`shots` 不会自动启动；首次 `page.goto` 直接 `ECONNREFUSED`。
- **影响**：换机/CI（Edge 64 位装在 `Program Files`、或 Linux/macOS）时 28 个脚本启动即失败；「截图/审计可复现」依赖本机特定路径，AND-06 只修了一半。
- **触发条件**：`node scripts/responsive-audit.mjs`（未启 preview 或本机无 Edge x86）。
- **解决方案**：这 28 个脚本改用 `E2E_BASE_URL` / `E2E_BROWSER_PATH`；`test:e2e` / `shots` 前置 `vite preview --port 0`（Node 内 spawn，读回实际端口注入环境变量），或至少做端口可达性 preflight 并给出明确提示。
- **置信度**：高

### D08 [P3] `check:release` 的 CSP 断言只要「meta 存在」，hash/指令正确性未接线

- **位置**：`scripts/check-release-config.mjs:446-469`
- **证据**：只做 `/http-equiv=["']Content-Security-Policy["']/i.test(html)`；不解析指令、不算 hash、不校验 meta 与内联脚本的先后。指令完整性、hash 匹配、位置检查只在 `scripts/check-offline-csp.mjs:103-135`，而该脚本**没有** npm script，也未被 `check:release` 调用（package.json:11-29）。
- **影响**：若构建链仍注入 meta 但 hash 与内联脚本不匹配（改了 `index.html` 主题脚本忘记重算），`check:release` PASS，WebView 会拦截内联脚本（首屏主题闪白/异常）；若有人把 `script-src` 放宽成 `unsafe-inline`，同样 PASS。
- **触发条件**：手工改 `dist/index.html` 的 CSP 或内联脚本后运行 `node scripts/check-release-config.mjs`（不发 FAIL）。
- **解决方案**：`check:release` 直接调用 `check-offline-csp.mjs`（或内联其 5 条 CSP 断言）；`package.json` 增加 `"check:offline": "node scripts/check-offline-csp.mjs"` 并在 CI/发布流程串联。
- **置信度**：高

### D09 [P3] 无 CI、无依赖审计门禁

- **位置**：仓库根（无 `.github/`、无 `.gitlab-ci.yml`）；`package.json:11-29`
- **证据**：`ls -d .github` 不存在；scripts 中无 audit 封装；`pnpm audit` 仍报 29 条 dev 漏洞（4 critical）。上轮 AND-05 建议「CI 加 audit 门禁」未落地。
- **影响**：所有发布前检查（typecheck/test/build/check:offline/check:release/audit）依赖人工记忆；DEP-01/02/03 不会被自动发现；D01-D04 这类守卫缺口也无人复核。
- **解决方案**：最小 CI：`pnpm typecheck && pnpm test && pnpm build && node scripts/check-offline-csp.mjs && node scripts/check-release-config.mjs`；`pnpm audit --audit-level high` 单列（dev 链已知漏洞用白名单/独立 job，避免长期红灯）。
- **置信度**：高

### D10 [P3] SW 把任意 navigation 缓存为 `/index.html`，离线导航一律回退 app 壳

- **位置**：`public/sw.js:59-77`（关键 `:64-70` 的 `cache.put('/index.html', …)` 与 `:76` 的 `caches.match('/index.html')`）
- **证据**：navigation 分支不判断 `url.pathname`，只要响应 ok 就写 `/index.html`；离线 catch 只查 `/index.html`。而 `privacy-policy.html` 是 `.html`，会被 `vite.config.ts:14` 收进预缓存清单。
- **影响**：PWA 场景：在线打开 `/privacy-policy.html` 会把 app 壳缓存覆盖成政策页；之后离线打开 `/` 会看到政策页。离线直接打开 `/privacy-policy.html` 则返回 app 壳（尽管政策页已在缓存）。Android WebView 内由本地服务响应，`fetch` 恒成功，实际影响小；当前 UI 也没有政策页链接（`PrivacyPolicy.tsx:125` 只把 URL 当文本展示），故触发面小。
- **触发条件**：PWA 中访问 `/privacy-policy.html` 后断网再打开应用（浏览器实测未做）。
- **解决方案**：仅在 `pathname === '/' || pathname === '/index.html'` 时写 `index.html` 缓存；offline fallback 改为 `caches.match(request).then(c => c || caches.match('/index.html'))`。
- **置信度**：中高（代码语义确定，未做浏览器实测）

### D11 [P3] `release/` 产物卫生：无校验索引，v1.2.5 无 mapping

- **位置**：`release/`（36 个文件：20 个 APK + 10 个 AAB + 5 个 `.idsig` + `xinshi-v1.2.4-mapping.txt`）
- **证据**：目录内含 v0.5.9 … v1.2.5 的全部历史包；只有 `xinshi-v1.2.4-mapping.txt`（6,506,416 字节），v1.2.5 无 mapping；无 `SHA256SUMS` / 索引文件；`release/` 被 `.gitignore:13` 忽略（未入库，这点正确）。
- **影响**：直发时人工挑选存在取错版本风险；v1.2.5 的 R8 崩溃无法反混淆（mapping 缺失），而这正是 AND-10 诊断链路的上游能力；mapping 含源码类名/行号，放在分发目录易被误传。
- **触发条件**：`ls release/`；发布时人工拷贝。
- **解决方案**：`release/` 只保留当前版本 + `SHA256SUMS`（APK/AAB/mapping 三行）；历史归档到 `release/archive/` 或外部存储；mapping 与可分发产物分目录，并在 RELEASE-NOTES 记录路径。
- **置信度**：高

### D12 [P3] 生成的 Gradle 文件被跟踪，内含 `.pnpm` 精确路径

- **位置**：`android/capacitor.settings.gradle:3,6,9`、`android/app/capacitor.build.gradle:1`（文件头 `DO NOT EDIT`）
- **证据**：`git ls-files android` 包含 `capacitor.settings.gradle`；内容为 `../node_modules/.pnpm/@capacitor+android@6.2.3_@capacitor+core@6.2.3/node_modules/...` 的精确目录名。`android/README.md:44` 自己写明「升级依赖后必须重新 cap sync，否则 `.pnpm` 精确路径会失效」。
- **影响**：pnpm 依赖解析（peer 后缀/hash）变化后 gradle 配置失败；每次 `cap sync` 都改 tracked 文件，制造提交噪声与误合并。
- **解决方案**：将两个 `capacitor.*.gradle` 从 git 移除并加入 `android/.gitignore`（与 `assets/public` 同策略），fresh clone 流程统一走 `cap sync`。
- **置信度**：高

### D13 [P3] `version.ts` 回退值硬编码 1.2.5

- **位置**：`src/lib/version.ts:5-7`
- **证据**：`typeof __APP_VERSION__ === 'string' … : '1.2.5'`。构建期由 `vite.config.ts:105` 注入 package.json 版本，但 vitest / 其他无 define 的运行时走回退值。
- **影响**：下次发版只改 package.json 时，测试/非 Vite 路径的「关于页/导出包/搬家包」版本号仍显示 1.2.5；`AND-20` 早已提示「version.ts 回退值易漂移」。
- **解决方案**：回退值改为 `'0.0.0-dev'` 或在 vitest setup 注入 `__APP_VERSION__`；`check:release` 断言回退字符串与 package.json 一致（或禁止出现具体版本）。
- **置信度**：高

### D14 [P3] Gradle wrapper 无发行包校验和

- **位置**：`android/gradle/wrapper/gradle-wrapper.properties:3`
- **证据**：`distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.3-all.zip`，无 `distributionSha256Sum`；`gradle-wrapper.jar` 入库（63,375 字节，正常）。
- **影响**：首次下载 Gradle 发行包时不做哈希校验（HTTPS + 官方域名，实际风险低），供应链加固缺口。
- **解决方案**：补官方 `distributionSha256Sum`。
- **置信度**：高

### D15 [P3] R2 修复记录数字与实测不符（15 PASS / SW v31）

- **位置**：`docs/AUDIT-v1.2.4-R2-fixes.md:17`（「check-release 由 8 项扩展到 15 项」）、`:54-55`（「15 PASS / 0 FAIL」「SW v31」）
- **证据**：实测 `check:release` 为 **16 PASS / 0 FAIL**（无 SDK）/ **19 PASS / 0 FAIL**（有 SDK）；SW 为 **v32**（`public/sw.js:1`、`dist/sw.js`、APK 内 `assets/public/sw.js` 一致），同文件 §一/§六 又写 v32。
- **影响**：复核者按文档会以为少一项检查、SW 版本旧；修复记录可信度下降。
- **解决方案**：更新为 16/19 与 v32；或去掉易漂移的计数，改为「以命令输出为准」。
- **置信度**：高

### D16 [P3 · 存疑] LMK 回收分支只 recreate，无循环上限/出口

- **位置**：`MainActivity.java:82-91`（`didCrash == false` 分支）、`:96-99`
- **证据**：LMK 分支 `recreate()` 后直接 return，不计数、不导出、不展示崩溃页；真崩溃计数 `rendererCrashCount > 1` 才进崩溃页。`rendererCrashCount` 是 static，30s 无页面加载才清零（:32-35）。
- **影响**：低内存设备上若 WebView 被反复回收，可能无限「重建→再被回收」闪烁（无退出按钮，用户只能回桌面）。是否真会形成循环取决于重建后内存是否释放，**无真机验证**，标存疑。
- **触发条件**：低内存 + 大账本 + 反复 `onRenderProcessGone(didCrash=false)`。
- **解决方案**：对 LMK 单独计数（如 30s 内 ≥3 次 → 展示崩溃页/只读降级页并给退出按钮），或失败后延迟重试并记录次数。
- **置信度**：低（需真机）

### D17 [P3] Android 5–9 分享前清空整个缓存目录的竞态

- **位置**：`SaveFilePlugin.java:136-138`（`cleanupLegacyCache(dir)` 在写新文件前）、`:165-176`（删除 `exports/` 下所有文件）
- **证据**：`shareViaLegacy` 先 `cleanupLegacyCache(dir)` 再 `new FileOutputStream(new File(dir, filename))`；上一次 `ACTION_SEND` 若仍打开，其 URI 指向的文件已被删除，接收方读取时失败。
- **影响**：低版本设备连续导出两份文件（如先工资条再备份）时，前一个分享可能失败；源数据不丢（账本仍在），属导出体验缺陷。
- **触发条件**：Android <10 设备，第一次分享面板未关闭时触发第二次导出。
- **解决方案**：只清「非本次保留 + 超过 N 分钟」的旧文件，或每次写入唯一子目录并在下次启动清理。
- **置信度**：中

## 4. 上轮 AND / DEP 修复回归抽查

> 抽查方式：先读代码路径，再用**真实 APK/AAB**（aapt2/apksigner/jarsigner/zipfile）核对「声称已修复」是否真的进了产物。

| 编号 | 上轮结论 | 本轮复核 | 证据 |
| --- | --- | --- | --- |
| **AND-01** | 已修复：正式包只写私有目录 | **✅ 修复属实**（但有 D01 绕过面） | `export()` 守卫 `!XINSHI_DIAG && !DEBUG`（XinshiApp.java:137-139）；`crash()` 只写 filesDir（:98-125）；启动清理历史公共文件（:65-66,157-176）；政策第 3 节披露（privacy-policy.html:181-183）。`-Pxinshi.diag` 可重新打开公共写入，见 D01 |
| **AND-02** | 已修复：dataExtractionRules | **✅ 修复属实（产物级）** | Manifest:7；`res/xml/data_extraction_rules.xml:5-28`；APK 内 `res/4j.xml` 编译后含 18 条 exclude（cloud-backup+device-transfer 各 9 域）；`allowBackup=false`/`fullBackupContent=false` 同存 |
| **AND-03** | 已修复（静态）：守卫 + badging 断言 | **⚠️ 部分**：守卫与产物断言真实存在，但漏 `-Pxinshi.diag`、漏版本校验 | 守卫 build.gradle:80-106；有 SDK 时 `PASS release APK 不可调试 ×3`；无 SDK 时仅 NOTE（D02）；见 D01/D03 |
| **AND-04** | 已修复（托管待办） | **✅ 代码侧完成；公网托管仍待业务** | 政策页仅 1 个内部链接、无 404 链接（check PASS）；真实邮箱 `2359648846@qq.com` 出现在 compliance.ts:20、两份 HTML、APK 内 policy；`PRIVACY_VERSION 2026-11-17` 与两份 HTML 同步。**未见公开 HTTPS 地址**（fixes §六-2 仍列为待办）。文档/`.env` 残留见 D05/D06 |
| **AND-05** | 已修复：15 项 FAIL 级断言 | **⚠️ 部分**：白名单/占位邮箱/政策链接/CSP 存在/SW 递增已落地；aapt2 发现、产物版本、assets 漂移、CSP 细节未做 | 19 项实测见 §1；缺口见 D02/D03/D04/D08 |
| **AND-06** | 已修复：28 脚本去硬编码 | **⚠️ 部分**：functional 28 个已迁移；另外 28 个截图/审计脚本仍硬编码；无 preview 自动启动 | functional.mjs:4-7；responsive-audit.mjs:5-6；28 文件统计见 D07 |
| **AND-07** | 已修复：构建期 CSP | **✅ 修复属实** | `vite.config.ts:64-99` 动态 sha256；dist/APK 均含 CSP；`script-src 'self' 'sha256-+rZEG…'`，无 `unsafe-inline`；hash 与内联脚本实测一致；meta 在脚本前。门禁弱见 D08 |
| **AND-08** | 已修复：LMK 不按崩溃计数/导出 | **✅ 代码属实**（边界存疑） | MainActivity.java:82-91：`!didCrash` 不 export、不计数，仅 recreate。反复回收无上限，见 D16 |
| **AND-09** | 已修复：崩溃页重启/退出 + 返回兜底 | **✅ 属实**（小瑕疵） | 崩溃页按钮 :232-253；`OnBackPressedCallback` 兜底 :186-191；`finishAffinity` :262-268。每次 `showCrashScreen` 都追加一个回调（:186），崩溃循环下回调累积，影响很小 |
| **AND-10** | 已修复：日志上限/截断/尾部读 | **✅ 属实** | 64KB 上限（XinshiApp.java:41,83-85,114-115）、保留尾部半量（:313-322）、读尾部 24KB（:44,272-287）、堆栈 200 帧/8 层（:42-43,324-347）；崩溃页堆栈再截 24KB（MainActivity.java:203-208）。`readTail` 按字节跳可能切断 UTF-8 多字节字符（P3 观察，未单列） |
| **AND-11** | 已修复：清理 aligned.apk | **✅ 属实** | `android/` 下无 `.apk`；`android/.gitignore:4` 忽略 `*.apk`；APK 只在 `release/` |
| **AND-13** | 计划内延后：shots 34MB 入库 | **❌ 仍在** | `git ls-files shots` 179 文件 / 32.7MB；跟踪总量 38.0MB（shots 占 86%） |
| **AND-14** | 已修复：.gitignore 兜底 | **✅ 属实** | `.gitignore:16-28`（jks/keystore/pem/p12/p8/key/google-services.json/signing.properties/password.txt/.env/.env.*/!.env.example）+ `android/keystore/` + `.audit-work/`；check 脚本 14 条规则校验 PASS；历史零密钥添加 |
| **AND-15** | 计划内延后：WebView 放宽项 | **❌ 仍在**（无新增触发面） | Capacitor 6.2.3 默认 `setGeolocationEnabled(true)`、`setDatabaseEnabled(true)`、`setMediaPlaybackRequiresUserGesture(false)`（Bridge.java:571-573）；本 App 无定位/WebSQL/媒体调用，且无对应权限 |
| **AND-16** | 已修复：<Q 分支口径/注释 | **✅ 属实**（受 D01 影响） | `writeToAppExternal` 注释与实现一致（XinshiApp.java:255-270）；仅诊断构建调用（export 守卫 :137-139） |
| **AND-17** | 已修复：分享缓存/ClipData/LIKE 转义 | **✅ 属实**（残留 D17） | cleanupLegacyCache（:136-137,165-176）、ClipData（:149）、ESCAPE 转义（:243,288-290）、displayName 回退（:182-193） |
| **AND-18** | 计划内延后：singleTask + exported | **❌ 仍在** | 合并清单 activity `exported=true`、`launchMode=singleTask`（=2）、无 `taskAffinity`（aapt2 xmltree 实测）；无 deep link |
| **AND-19** | 计划内延后：Android 16 预测式返回 | **❌ 仍在 / 未验证** | 合并清单无 `enableOnBackInvokedCallback`；androidx.activity 1.8.0（variables.gradle:5）；需真机回归 |
| **AND-20** | 部分修复 | **⚠️ 部分** | google-services classpath/插件已删（android/build.gradle:11-12；app/build.gradle:128-129）；packageManager/engines 已钉（package.json:5-8）；`config.xml` 仍由 cap sync 生成（含 `<access origin="*"/>`，被 gitignore，不生效）；version.ts 回退仍在（D13）；gradle jvmargs 仍 2048m |
| **AND-21** | 已修复：'shared' 文案 | **✅ 属实** | MoveSheet.tsx:61,132-147,297-300；DataSafety.tsx:108；EntryDetail.tsx:165；`native.ts:4-12` 语义注释 |
| **DEP-01** | 未升级 | **❌ 仍在** | `@capacitor/cli 6.2.3 → tar 6.2.1`：pnpm audit 报 12 条（含 9+ high，任意文件写入/符号链接穿越） |
| **DEP-02** | 未升级 | **❌ 仍在** | `vitest 2.1.9` + 嵌套 `vite 5.4.21`（8 条）+ `tinypool 1.1.1`（2 条）+ `@vitest/mocker`（2 条）+ `esbuild 0.21.5`（1 条），共 4 critical / 9 high 中大部分 |
| **DEP-03** | 未升级 | **❌ 仍在** | `glob 9.3.5` / `minimatch 8.0.7` 各 1 条 moderate（ReDoS） |
| 运行时依赖 | 上轮清洁 | **✅ 复核仍清洁** | `pnpm audit --prod --json` → 0 条 |

## 5. 已排除疑点（防误报记录）

1. **明文流量**：合并清单无 `usesCleartextTraffic`、无 `networkSecurityConfig`（aapt2 xmltree 实测）；`capacitor.config.json` 为 `androidScheme: https` + `allowMixedContent: false`。Capacitor 仅在 `allowMixedContent=true` 时设置 `MIXED_CONTENT_ALWAYS_ALLOW`（Bridge.java:576），本 App 未设置。
2. **WebView 远程调试**：`CapConfig` 默认 `webContentsDebuggingEnabled = (ApplicationInfo.FLAG_DEBUGGABLE != 0)`（CapConfig.java:275,587）；正式 APK 无 `application-debuggable`（badging 实测）→ CDP 关闭。
3. **SaveFilePlugin 阻塞主线程**：Capacitor 6 插件方法在专用 `CapacitorPlugins` HandlerThread 执行（`Bridge.java:133,212,840`），base64 解码与文件写入不在 UI 线程；JS 侧另有 32MB 上限与 45s 超时（`src/lib/saveFile.ts:26-27,67-78`）。
4. **FileProvider 路径越界**：APK 内 `res/8K.xml` 仅 `cache-path name="exports" path="exports/"`；`filename` 正则拒绝 `/`、`\`、控制字符且 ≤120（SaveFilePlugin.java:43），`subdir` 白名单 `\p{L}\p{N}_-` 且 ≤32（:298-303）。
5. **备份 / 换机迁移**：`allowBackup=false` + `fullBackupContent=false` + dataExtractionRules 全域排除（产物级核实）。Android 12+ `data-extraction-rules` 的 `device_root/device_file/...` 域是官方合法取值（Android 开发者文档 Auto Backup 的 include/exclude domain 列表）。
6. **版本链**：package.json 1.2.5 == gradle 1205/1.2.5 == APK badging == `xinshi-v32` == APK 内 assets == dist；`PRIVACY_VERSION 2026-11-17` 与两份政策 HTML 同步（check 脚本 PASS）。
7. **签名与哈希**：APK v1+v2 验证通过、证书 SHA-256 `a5b8514a165a7849a4073bd00a94759fcb957aa02f83970012eb72f25185d606` 与 fixes §11/RELEASE-NOTES 逐字一致；APK/AAB SHA-256 与文档一致；AAB `jarsigner -verify` exit 0（自签证书链警告属预期）。
8. **权限面**：APK 仅 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK` + `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`；无 INTERNET/CAMERA/存储/定位；与 STORE-LISTING §权限表、隐私政策第 3 节一致。
9. **导出组件**：MainActivity `exported=true` 为 LAUNCHER 必需；FileProvider `exported=false`；`ProfileInstallReceiver` exported=true 但受 `android.permission.DUMP`（系统签名）保护；其余 receiver 无 intent-filter 或 exported=false。无 service。
10. **密钥卫生**：`android/keystore/{signing.properties,password.txt,xinshi-release.jks}` 均未被跟踪且被 `.gitignore:14` 忽略；`git log --diff-filter=A` 全历史无 `.jks/.keystore/signing.properties/password.txt/.env` 添加；`local.properties` 被 `android/.gitignore:27` 忽略。
11. **大文件 / 日志入库**：无 APK/AAB 入库；`test-results-phone-logcat.txt`（724KB）与 `test-results-*` 均未跟踪且被 `.gitignore:9-10` 忽略；`release/` 被 `.gitignore:13` 忽略。
12. **`res/xml/config.xml` 的 `<access origin="*"/>`**：该文件由 `cap sync` 生成、被 `android/.gitignore:101` 忽略，Capacitor 不读取 Cordova 的这份配置（仅 `cordova.js` 兼容层），**不构成网络放行**；但建议在 AND-20 清理项里删除模板以减噪。
13. **`cordova.js` / `cordova_plugins.js` 进 APK**：Capacitor 兼容层固定生成，`capacitor.plugins.json` 只有 app + local-notifications，无 Cordova 插件；不新增原生桥面。
14. **minSdk 22 的 backup 行为**：`dataExtractionRules` 属性在 API <31 被忽略，但 `fullBackupContent="false"` + `allowBackup="false"` 覆盖旧版本；adb backup 已阻断。
15. **运行时依赖漏洞**：`pnpm audit --prod` 0 条；公告全部落在 dev 链（vitest/capacitor cli 传递）。
16. **字体许可**：`public/fonts/xinshi-sans.ttf` 为 Noto Sans SC 子集，附 `LICENSE.txt`（SIL OFL 1.1，含版权与来源）与 `README.md` 再生成命令；合规。
17. **崩溃日志 UTF-8 尾部截断**：`readTail` 按字节定位可能落在多字节字符中间，`new String(...)` 会产生替换字符；只影响诊断页首行显示，不影响功能（P3 观察，未计入发现）。

## 6. 局限与未验证项

- 未执行 gradle 构建 / `pnpm build`（任务禁止写产物），D01/D03 的绕过路径为**静态**确证 + 现有产物反证，未实跑带参数构建。
- 无真机 / 模拟器：LMK 循环（D16）、Android 16 预测式返回（AND-19）、Android 5–9 连续导出竞态（D17）、dataExtractionRules 的 OEM D2D 行为均标「存疑/未验证」。
- 未联网实测隐私政策公开托管地址（业务尚未提供；fixes §六-2 仍为待办）。
- 未读密钥文件内容（按要求），仅核存在性/跟踪状态。
