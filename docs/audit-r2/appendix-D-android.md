# 薪时 XINSHI v1.2.4 · Android 壳/构建/发布/依赖/仓库卫生审计发现

> 审计员：audit-android（task-4）· 日期：2026-11-17 · HEAD `6c0f682`（工作树除 `.audit-work/` 外干净）
> 方式：只读静态审计（ops_inspect_local_file / ops_grep / ops_glob / 只读 git / 限时 web 查证）。未运行 build/test/audit/gradle；未读取 keystore/signing.properties/password.txt/.env* 内容（`.env.example` 也被凭据围栏拒绝，未能核对其内容）。
> 严重度：P0=数据丢失/安全漏洞/发布阻断；P1=重大缺陷/隐私泄露/上架风险；P2=一般缺陷/边界；P3=质量/卫生/债务。
> 主代理 pnpm audit 结果（直接引用）：29 漏洞 = 4 critical / 9 high / 15 moderate / 1 low，全部在 dev 链。

---

## 一、发现清单

### AND-01 [P1] 崩溃诊断无条件写公共 Download 目录，隐私政策未披露（未修复项#3 仍在）
- 位置：`android/app/src/main/java/com/xinshi/app/XinshiApp.java:112`（`crash()` 末尾无条件 `export()`）、`XinshiApp.java:137-184`（`writeToDownloads` 写 `Download/Xinshi/xinshi-diag.txt`，含设备型号/Android 版本/WebView 版本/启动节点/完整崩溃堆栈，见 `XinshiApp.java:55-58`）；`MainActivity.java:72`（`onRenderProcessGone` 也无条件 `export()`）。
- 问题与证据：`BuildConfig.XINSHI_DIAG` 默认 false（`android/app/build.gradle:21,35`），只 gate 住 onCreate/onResume/onPageLoaded 的例行导出（`XinshiApp.java:59-61`、`MainActivity.java:64-66,111-113`）；但 **任何 Java 未捕获异常（UEH，XinshiApp.java:48-54）与任何 WebView 渲染进程消失都会触发 export()，与构建类型无关**。release 正式包同样写。`public/privacy-policy.html`（与 docs 副本逐字节一致）第 2 节「数据存在哪里」只列 localStorage/IndexedDB/主动导出/自动备份，全文无「崩溃/诊断/diag/设备型号/堆栈」字样（grep 证实），第 1 节却宣称「不收集、不上传你的个人信息」。
- 影响/触发条件：任何一次崩溃即在公共下载目录留下含设备指纹与堆栈的明文文件；其他应用/文件管理器可读；卸载后残留（政策第 5 节只承诺清理「已导出文件」需用户自删，但未披露此文件存在）。与政策声明不符 → 商店审核/合规风险。Android 5–9 走 `writeToAppExternal`（XinshiApp.java:186-195）写 `getExternalFilesDir(null)/Xinshi/`，在 API 21–28 上可被持 READ_EXTERNAL_STORAGE 的应用读取（见 AND-16）。
- 建议方案（不实施）：崩溃诊断默认写 app 私有目录（filesDir/cacheDir），仅在用户主动「导出诊断」时经 SaveFile 写公共目录；或在隐私政策第 2/3 节明确披露该文件的内容、位置、保留与删除方式，并递增 PRIVACY_VERSION。
- 置信度：已确认（代码路径 + 政策全文 grep + 两份副本 diff 一致）。

### AND-02 [P1] allowBackup=false 但缺 dataExtractionRules：部分 Android 12+ 设备换机迁移仍可拷走账本
- 位置：`android/app/src/main/AndroidManifest.xml:6-7`（`android:allowBackup="false"`、`android:fullBackupContent="false"`），全文件无 `android:dataExtractionRules`；合并后 release 清单同样缺失（`android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml:22-25`）。
- 问题与证据：`allowBackup=false` 可阻断云备份与 `adb backup`（账本不可被 adb backup 提取——这点成立）；但 Android 12+ 的 **device-to-device（D2D）换机迁移在部分 OEM 设备上忽略 allowBackup=false**，默认规则会把应用数据域（含 WebView 的 `app_webview/` localStorage/IndexedDB，即整个账本）拷到新设备。外部佐证：Mozilla Fenix/Focus 同类问题 Bugzilla 2073967（2026-09，修复方式正是补 dataExtractionRules 排除 root/file/database/sharedpref/external 域）；tmail-flutter ADR-0073（2026-11）同一结论。
- 影响/触发条件：用户用部分品牌 Android 12+ 手机的「换机助手/迁移」功能时，薪资账本（敏感财务数据）被整体复制到新设备，绕过「数据只留在本机」承诺；旧设备转卖前若仅卸载不擦除，迁移副本已离开。
- 建议方案：增加 `res/xml/data_extraction_rules.xml`，`<cloud-backup>` 与 `<device-transfer>` 均排除全部域（或空块），manifest 挂 `android:dataExtractionRules`；保留 allowBackup=false 兼容旧版本。
- 置信度：已确认（manifest 事实）；OEM 触发面为「部分设备」，依据外部公开案例（上述链接），未在本项目真机复现。

### AND-03 [P1] -Pxinshi.debuggable / -Pxinshi.webviewDebug 可产出「已签名的可调试 release」，无自动守卫
- 位置：`android/app/build.gradle:18-21`（旗标定义）、`:58-62`（`minifyEnabled xinshiMinify && !xinshiDebuggable`；`if (xinshiDebuggable || xinshiWebViewDebug) { debuggable true }`）；`CapConfig.java:586-587`（node_modules @capacitor/android 6.2.3：`webContentsDebuggingEnabled` 未配置时默认取 `FLAG_DEBUGGABLE`）；`scripts/check-release-config.mjs:238-245`（仅 NOTE 提醒，不做 FAIL）；E3 签名守卫（build.gradle:80-91）只查 signing.properties 存在性，不查 debuggable。
- 问题与证据：带旗标的 release 仍会正常签名（signingConfig 照常挂），产物可安装可分发；debuggable=true 意味着 ① `adb shell run-as com.xinshi.app` 可直接读取 WebView localStorage/IndexedDB（整个账本明文）② WebView CDP 调试自动开启（chrome://inspect 可检视/篡改页面与存储）③ debuggable 旗标还顺带关闭 R8/资源压缩。本项目存在直接分发 APK 的渠道（磁盘上有 `android/aligned.apk`），不经过 Play 的 debuggable 拦截。
- 影响/触发条件：发布者一次误操作（排查真机问题后忘摘旗标）即把「可被任何连 USB 的人整包提取账本」的包发给用户；check:release 8 PASS 不会拦。
- 建议方案：在 taskGraph.whenReady 守卫中追加「release 产物任务 + (xinshiDebuggable||xinshiWebViewDebug) → 抛 GradleException」；或要求显式 `-Pxinshi.iKnowThisIsDebuggable` 二次确认；check-release-config 增加对最近构建产物 `aapt2 dump badging` 的 application-debuggable 检查（脚本目前只打印 NOTE）。
- 置信度：已确认（gradle + CapConfig 源码 + 检查脚本 NOTE 原文）。

### AND-04 [P1] 隐私政策页自身仍挂 404「在线版本」链接与占位邮箱；商店清单文档仍指向死链（未修复项#1 仍在）
- 位置：`public/privacy-policy.html:220`（`mailto:support@xinshi.app`）、`:224-225`（「在线版本」`https://pinbodhua.github.io/DSJiZhangApp/privacy-policy.html`）；`docs/privacy-policy.html:220,224-225` 同；`docs/STORE-LISTING.md:23-24,219-220`（仍把该 URL/邮箱列为商店填写值，注明「上线前必须换」）；`src/lib/compliance.ts:20`（`SUPPORT_EMAIL = env.VITE_SUPPORT_EMAIL || 'support@xinshi.app'`）。
- 问题与证据：E4 的代码侧缓解已落地（compliance.ts:17 默认相对路径 `privacy-policy.html`，离线页随构建分发，已核实），但 **政策 HTML 内部的「在线版本」链接仍指向 E4 判定死亡的 GitHub Pages 地址**。本次审计实测（2026-11-17 web_fetch）：HTTP 404「There isn't a GitHub Pages site here」。`support@xinshi.app` 域名无证据表明已注册/可收信，仍是占位符。check-release-config.mjs 只解析 compliance.ts 的 PRIVACY_URL 默认值（:136），**不扫描政策 HTML 内的链接，也完全不检查 SUPPORT_EMAIL**（漏检，见 AND-05）。
- 影响/触发条件：走 Play/国内商店上架时，审核员打开政策页内「在线版本」→ 404；联系邮箱退信 → 上架被拒或整改。若以当前 STORE-LISTING.md 照抄填表，直接提交死链。
- 建议方案：上架前 ① 开启 GitHub Pages（或任意 HTTPS 托管）并实测 200 ② 用 VITE_PRIVACY_URL/VITE_SUPPORT_EMAIL 注入真实值 ③ 同步替换两份政策 HTML 内的在线链接与 mailto ④ 递增 PRIVACY_VERSION ⑤ 给 check-release-config 补「政策 HTML 内 URL 可达性/占位符」与「SUPPORT_EMAIL 非占位」检查。
- 置信度：已确认（404 实测 + 文件行号 + 检查脚本静态审查）。若仅直接分发 APK 不上架，则降为 P2 文档缺陷。

### AND-05 [P2] check-release-config.mjs 自身存在多处漏检/弱检，「8 PASS」高估发布安全性
- 位置与证据（`scripts/check-release-config.mjs`）：
  1. `:72-73` versionCode 公式 `major*1000+minor*100+patch`：minor≥10 时碰撞（1.10.0→2000 与 2.0.0→2000 相同），patch≥100 同理；当前 1.2.4→1204 正确，属未来地雷。
  2. `:104-127` SW 版本只与 `HEAD~1` 比较；同版本仅 NOTE 不 FAIL——「Web 资源变了但忘 bump SW」可以 8 PASS 通过；也不检查 `android/app/src/main/assets/public/sw.js` 与 `public/sw.js` 是否同步（cap sync 漂移）。
  3. `:136-163` 只查 compliance.ts 的 PRIVACY_URL 默认值；不查 SUPPORT_EMAIL（AND-04）、不查政策 HTML 内死链；docs/public 两份政策不一致仅 NOTE（:159-161）。
  4. `:210-213` FileProvider 检查只拒绝 `<external-path>` 且要求存在 `cache-path path="exports/"`；**若有人加 `<root-path path="."/>` 或 `<files-path path="."/>` 照样 PASS**——与「仅暴露 cacheDir/exports」的声称不符。
  5. `:228` 签名守卫检查只是字符串存在性（`gradle.taskGraph.whenReady` && `GradleException`），不验证守卫覆盖的任务集合，也不拦 debuggable release（AND-03）。
  6. 全脚本不检查：assets/public 相对 dist/源码是否过期、capacitor.config.ts 与 assets/capacitor.config.json 是否漂移、合并清单是否混入 INTERNET、targetSdk 是否满足当年 Play 要求、`-Pxinshi.versionCode/versionName` 覆盖值。
- 影响：发布前检查给出虚假安全感；上述任一漂移都可带着 8 PASS 出厂。
- 建议方案：按上列逐条补强（占位邮箱 FAIL、政策内链接扫描、assets 哈希比对、FileProvider 白名单式断言「只允许一个 cache-path exports/」、debuggable 产物断言）。
- 置信度：已确认（脚本全文静态审查；未运行脚本，遵守工具纪律）。

### AND-06 [P2] test:e2e 链 28 脚本整体漂移：停在 v1.2.0 时代，硬编码环境，不启动 preview（未修复项#7 仍在）
- 位置：`package.json:13`（28 个 `node scripts/functional*.mjs` 用 `&&` 串行，最后一个是 functional-v120.mjs，无 v121–v124）；`scripts/functional.mjs:5-6`（`BASE='http://127.0.0.1:4173'`、`EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`）、`:20-21`（clock 固定 2026-11-06、`addInitScript` 写死同意版本 `'2026-11-05'`）；`scripts/functional-v120.mjs:7-9,19` 同样硬编码。
- 问题与证据：git log 显示全部 functional*.mjs 最后更新 **2026-11-07**（v1.2.0/v1.2.1 时期），而 v1.2.2（11-11）、v1.2.3/v1.2.4（11-12，含 A1 跨标签页 P0 修复、B1–B4 计薪 P1 修复、E4）之后零更新；仓库中不存在 functional-v121+ 脚本。grep 证实没有任何 functional 脚本 spawn/启动 preview（早先「preview」命中均为 `.entry-preview-money` 等选择器误匹配）——跑 test:e2e 前必须人工 `pnpm build && pnpm preview`，否则 28 个脚本全部连接失败。Edge 路径写死 x86 Program Files，换机器/CI 即挂；同意版本写死，PRIVACY_VERSION 一 bump 全链卡在隐私弹窗（时间炸弹）。
- 影响：v1.2.2–v1.2.4 的关键修复（计薪口径、跨页同步、导出回退）无 e2e 回归；「发布前补跑」实际跑的是旧版本行为快照，可能给出假绿/假红。
- 建议方案：e2e 链改为自动起 preview（随机端口+等待就绪）、浏览器路径可配置/自动探测、同意版本从 compliance.ts 读取；为 v1.2.1–v1.2.4 修复补脚本或迁移到 vitest+jsdom；串行 && 改为单进程多 suite 以便失败续跑。
- 置信度：已确认（git log 日期 + 脚本源码 + 链定义）。

### AND-07 [P2] CSP 仍未加（未修复项#2）：内联主题脚本 + 无 Content-Security-Policy；当前风险面小但缺纵深防御
- 位置：`index.html:7-24`（内联主题脚本，读 localStorage 设 dataset.theme/colorScheme/theme-color），全文件无 CSP meta；构建产物 `android/app/src/main/assets/public/index.html` 同样无 CSP（与 dist 逐字节一致）。
- 问题与证据（风险面核实）：`src/` 150 个文件 grep `innerHTML|dangerouslySetInnerHTML|document.write|eval(|new Function|insertAdjacentHTML` **0 命中**；React 19 默认转义渲染；jspdf 仅用 `output('blob')`（payslip.ts:429、payslipText.ts:225）走原生保存/下载，不在浏览器上下文渲染 HTML；jspdf 的 `html()` 未使用且 html2canvas 被 alias 成空模块（vite.config.ts:17-21）；dompurify 3.4.17 虽随 jspdf 打包（purify.es chunk 30KB）但无调用路径；无外部输入渲染、无网络权限、WebView 只加载 https://localhost 本地资产。结论：当前无已知可注入点，与上轮「风险低」判断一致。
- 影响/触发条件：未来任何依赖升级/新代码引入 XSS 时无 CSP 兜底；PWA 场景下若托管环境被劫持（如未来上线在线版），无 script-src 约束。属防御纵深缺失而非现行漏洞。
- 建议方案：构建期用 vite transformIndexHtml 对内联脚本算 sha256 注入 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">`（WebView 的 shouldInterceptRequest 响应不便加头，meta 方式最稳）；把 CSP 存在性纳入 check-release-config。
- 置信度：已确认（现状与风险面证据）；「低风险」判断基于当前代码，非对未来保证。

### AND-08 [P2] onRenderProcessGone 不区分 didCrash=false（系统低内存回收）：30 秒内两次即进死端崩溃页，且每次都写公共诊断
- 位置：`MainActivity.java:70-92`：`detail.didCrash()` 只被写进日志（:71），随后无条件 `XinshiApp.export()`（:72）、`rendererCrashCount++`（:73）、`destroyWebView`+`recreate()`（:76-89），`rendererCrashCount > 1` → `showCrashScreen`（:81-83）。计数为 static，30 秒稳定后才清零（:24,:62-63）。
- 问题与证据：Android 系统 LMK 回收渲染进程时 `didCrash()==false`，属正常内存压力事件而非崩溃；代码把它与真崩溃同权计数。minSdk 22 的低端机（1–2GB RAM）上，WebView 渲染进程被回收并不罕见；两次回收落在 30 秒窗口内就把用户锁进原生诊断页。每次事件还触发 AND-01 的公共目录写入。
- 影响/触发条件：低端设备内存紧张时 App 反复「崩溃」假象 + 诊断页死端（见 AND-09）+ 公共目录诊断文件反复删插。
- 建议方案：`didCrash()==false` 时只 recreate 不计数（或单独阈值更宽）、不 export；真崩溃才计数与导出；崩溃页提供「重试/退出」按钮。
- 置信度：已确认（代码逻辑）；低端机触发频率未真机测量（存疑部分：实际发生概率）。

### AND-09 [P2] 原生崩溃页无退出/重试控件，返回键可能失效形成死端
- 位置：`MainActivity.java:166-192`（showCrashScreen 只 setContentView 一个 ScrollView+TextView，无任何按钮）；返回链：Capacitor 6.2.3 `BridgeActivity` 全文（212 行）**不覆写 onBackPressed**，返回由 `AppPlugin.java:47-62` 注册的 androidx OnBackPressedCallback 接管：有 JS backButton 监听 → 向 WebView 发事件；无监听 → 仅 `webView.canGoBack()` 时 goBack，否则什么都不做。
- 问题与证据：从 `onRenderProcessGone` 进入崩溃页时 WebView 已 destroy（MainActivity.java:76,148-155），但 bridge/AppPlugin 回调仍活着且 JS 侧监听计数仍在 → 返回键把事件发进已销毁的 WebView（行为未定义：可能静默无效，可能抛异常再次触发 crash→export）；用户被困在 9sp 小字诊断页，只能 Home/最近任务离开。从 super.onCreate 失败进入时 bridge 可能为 null，返回键走系统默认（finish），行为不一致。
- 影响/触发条件：任何走到 showCrashScreen 的场景；诊断页本意「方便截图反馈」，但没有出口与重试，普通用户无法自救。
- 建议方案：崩溃页加「重新启动 App」（recreate）与「退出」（finish）按钮；进入崩溃页时移除/禁用 AppPlugin 返回回调或注册原生兜底回调；对 destroyed WebView 的事件分发加守卫。
- 置信度：UI 无控件=已确认；返回键具体表现=存疑（依赖 destroy 后 evaluateJavascript 的 ROM 行为，需真机验证；验证方法：adb 触发渲染崩溃后按返回）。

### AND-10 [P2] 诊断日志无上限追加 + 全量读入内存/TextView：崩溃循环或超深堆栈时低端机风险
- 位置：`XinshiApp.java:75-78`（mark() 发现日志 >64KB 直接 `file.delete()` 整文件，历史全丢，非滚动截断）；`:104-107`（crash() 追加堆栈**不做任何尺寸检查**）；`:214-224`（readAll 以 `(int)file.length()` 预分配 ByteArrayOutputStream 全量读）；`:198-212`（readLog 全量转 String）；`MainActivity.java:174,182`（全量日志+堆栈塞进单个 TextView）。
- 问题与证据：StackOverflowError 的堆栈可达数千帧/数 MB，一次 crash() 即可让日志远超 64KB 上限（上限只在 mark() 检查）；随后 export()/readLog() 把数 MB 文本整体读入内存并渲染。崩溃循环（每次启动都崩）时每次启动都 append+export，日志单调膨胀直到某次 mark() 触发整删。minSdk 22 低端机内存紧张。
- 影响/触发条件：深堆栈崩溃/崩溃循环 → 诊断页卡顿甚至 OOM/ANR；整删策略丢失最关键的早期启动节点。
- 建议方案：crash() 追加前截断堆栈深度（如前 200 帧）与总尺寸；日志改环形/两段滚动（保留头尾）；readLog 只取尾部 N KB；export 尺寸上限。
- 置信度：已确认（代码路径）；实际 OOM 阈值未真机测量。

### AND-11 [P3] android/aligned.apk 是陈旧且未签名的 zipalign 中间产物，易与正式包混淆
- 位置：`android/aligned.apk`（5,233,335 字节，mtime 2026-11-05 18:48，未跟踪，被 `*.apk` 忽略）。
- 问题与证据（Python zipfile 只读实测，见附录补记）：APK 内 `assets/public/sw.js` 为 **`xinshi-v19`**（当前 v30，约 v0.9/v1.0 时代）；`assets/public/index.html` 与当前资产不一致；assets 仅 23 个（当前 48 个）；**无 META-INF v1 签名条目、无 APK Signing Block（v2/v3）→ 完全未签名**，不可安装。它是旧版本构建遗留的 zipalign 中间产物，文件名却像可分发成品。
- 影响/触发条件：人工分发时误拿该文件（无法安装/极旧代码）；真正的分发产物 `release/xinshi-v1.2.4.apk` 已核实为最新且签名齐全（见第二节正面核实），故无现行用户影响。
- 建议方案：删除或移入 build/ 中间目录；发布 SOP 规定只从 release/ 取带版本号+hash 登记的成品；zipalign 输出不要落在 android/ 根。
- 置信度：已确认（zipfile 内容比对 + 签名块扫描实测）。

### AND-12 [P2] dev 依赖链 29 个已知漏洞（引用主代理 pnpm audit），含 4 critical；运行时产物不受影响
- 位置：`pnpm-lock.yaml`（tar@6.2.1 :1255，经 @capacitor/cli 6.2.3；vitest@2.1.9 :1399 + tinypool@1.1.1 :1276 + 嵌套 vite@5.4.21 :1328 / esbuild@0.21.5 :900；glob/minimatch 经 rimraf，均 dev 链）。
- 问题与证据：主代理 pnpm audit：29 漏洞 = 4 critical / 9 high / 15 moderate / 1 low，全部 dev 链。vitest 2.x 已落后两个大版本（当前 4.x），其嵌套 vite 5.4.21/esbuild 0.21.5 属旧维护线；@capacitor/cli 6.2.3 携带 tar 6.2.1（2026 年仍有新公告波及 6.x 线）。这些包不进 APK/dist 运行时产物（cli 只在开发机执行 cap sync；vitest 只在测试时运行）。
- 影响/触发条件：开发机/CI 供应链风险（恶意 tar 解包路径穿越、vitest browser 模式类 RCE 等）；对最终用户无直接暴露。
- 建议方案：升级 @capacitor/cli（或 pnpm override tar≥修复版）、vitest≥3/4（连带 vite 6/7 链统一）；在 CI 加 audit 门禁（dev 链 critical 阻断）。
- 置信度：已确认（引用主代理 audit 结果 + lock 文件版本核对）；具体 CVE 编号以主代理 audit 输出为准，本路未重复跑 audit。

### AND-13 [P3] shots/ 截图档案 179 个文件 34MB 入库，仓库膨胀
- 位置：`shots/`（git 跟踪 179 文件，磁盘 34MB；最大单文件 shots/android-v080/12-final-release-home.png 991KB）；`shots/README.md` 说明是按版本留档的截图集；根 `.gitignore` 无 shots 规则（有意入库）。
- 问题与证据：517 个跟踪文件中 35% 是截图；全仓库 207 个 png 中 179 个在 shots/。git 历史会永久携带这些二进制（每次换图都增一层对象）。
- 影响：clone/checkout 变慢、仓库体积单调增长；与代码审计无关但属卫生债务。
- 建议方案：迁 Git LFS 或外部图床/Release 附件，仓库只留缩略图与索引；或至少冻结旧版本目录不再更新。
- 置信度：已确认（git ls-files + du + stat）。

### AND-14 [P3] .gitignore 残余缺口（E1 之后）
- 位置：根 `.gitignore:1-30`、`android/.gitignore:1-101`、`android/app/.gitignore:1-2`。
- 问题与证据：已覆盖良好——`*.jks/*.keystore/signing.properties/password.txt/.env/.env.*/!.env.example/android/keystore/`（根:17-23,14）、`local.properties`（android:27）、`assets/public`（android:96）、`*.apk`（根:12+android:4）、`build/`、`.gradle/`、`test-results*`、`release/`。实测 `git check-ignore` 全部命中；`git rev-list --all --objects` 全历史扫描无 keystore/jks/password/signing.properties/.env 对象（E1「从未入库」声称成立）。残余缺口：① 无 `*.pem/*.p12/*.p8/*.key/google-services.json` 规则（换密钥格式即失守）② `.audit-work/` 未忽略（本次审计产物已出现在 git status）③ `shots/` 未忽略（见 AND-13，属有意但应显式决策）④ `.env.example` 内容因凭据围栏无法核对是否纯占位（限制声明）。
- 建议方案：补密钥格式兜底规则与 `.audit-work/`；把「敏感文件模式清单」与 check-release-config 的 isSensitivePath（:48-55）保持同步。
- 置信度：已确认（check-ignore 实测 + 全历史扫描）。

### AND-15 [P3] WebView 设置存在与本 App 无关的放宽项（Capacitor 默认）
- 位置：`node_modules/.pnpm/@capacitor+android@6.2.3_.../Bridge.java:569-577`：`setGeolocationEnabled(true)`、`setDatabaseEnabled(true)`（WebSQL）、`setMediaPlaybackRequiresUserGesture(false)`、`setJavaScriptCanOpenWindowsAutomatically(true)`；混合内容仅在 allowMixedContent 时 ALWAYS_ALLOW（本项目 false，capacitor.config.ts:11，默认 NEVER_ALLOW ✓）；`Bridge.java:605` WebContents 调试=FLAG_DEBUGGABLE（release 默认关 ✓，但见 AND-03）。file access：targetSdk 36 下平台默认 allowFileAccess=false ✓；allowContentAccess 默认 true。
- 问题与证据：本 App 无定位（且无定位权限）、无 WebSQL、无媒体、无 window.open 需求；这些放宽项当前无可达滥用路径（无外部内容加载），但违背最小化原则。
- 建议方案：Capacitor 暂无逐项开关，可在 MainActivity.onCreate 拿到 bridge.getWebView() 后显式收紧（geolocation/database/media gesture/window open）；或升级 Capacitor 7+ 评估默认值变化。
- 置信度：已确认（源码行号）；风险评级低（无触发面）。

### AND-16 [P3] Android 5–9 诊断导出位置与注释/审计口径不符，且旧系统上可被读存储权限应用读取
- 位置：`XinshiApp.java:29-30`（类注释声称写 Download/Xinshi）、`:127-131`（Q+ 走 MediaStore Downloads，<Q 走 writeToAppExternal）、`:186-195`（实际写 `getExternalFilesDir(null)/Xinshi/xinshi-diag.txt`）。
- 问题与证据：API 21–28 上 `Android/data/com.xinshi.app/files/` 可被任何持 READ_EXTERNAL_STORAGE 的应用遍历读取（分区存储前无隔离）；诊断含设备型号+堆栈。上轮审计与代码注释都只说「Download/Xinshi」，未区分 <Q 分支。
- 建议方案：与 AND-01 一并整改（私有目录优先）；修正注释；政策披露时写清两种路径。
- 置信度：已确认（代码）；旧系统读取面为平台公开行为。

### AND-17 [P3] SaveFilePlugin 边界与卫生项（无现行漏洞）
- 位置与证据：
  1. `SaveFilePlugin.java:128-157` legacy 分支写 `cacheDir/exports/<filename>` 后**从不删除**， repeated 导出累积占缓存（系统清缓存才释放）；同名覆盖靠 FileOutputStream 截断 ✓。
  2. `:140-148` ACTION_SEND 只设 EXTRA_STREAM+FLAG_GRANT_READ_URI_PERMISSION，未设 ClipData；个别 Android 5–9 ROM 的 URI 授权可能失效（存疑，需真机；现代 AOSP 对 EXTRA_STREAM 有专门授权处理）。建议补 `intent.setClipData(ClipData.newRawUri(null, uri))`。
  3. `:220-224` prune 的 LIKE 前缀未转义 `%/_`；调用方传固定前缀（无外部输入），当前不可滥用，属健壮性。
  4. `:160-171` displayNameOf 查询失败回退「请求名」，若系统实际改名 "(1)" 且查询恰好失败，resolveSaved 报告的路径与磁盘不符（仅展示层）。
  5. `:42` 文件名验证正则经字节级核实为 `.*[\\/\p{Cntrl}].*`（拒绝反斜杠/斜杠/控制字符，长度≤120）✓ 路径穿越已防；`..`/`.` 可通过正则但 legacy 分支因目标是目录被 FileOutputStream 拒绝、MediaStore 分支由系统处理（存疑边界，无穿越后果）。`:270-275` safeSubdir 白名单清洗 ✓。
  6. 同名覆盖顺序（v1.2.1 修复）已核实落地：临时名+IS_PENDING=1 写入（:69-90）→ 发布最终名（:93-99）→ 删本包同名旧文件（:102,:173-197，OWNER_PACKAGE_NAME 过滤 ✓）→ 改名回原名（:103-110）；发布失败只删临时文件、旧备份不受影响 ✓；清理失败最多多留一份 ✓。
  7. `'shared'` vs `'saved'` 语义：legacy resolve `{shared:true}`（:149-153），Q+ resolve 无 shared 字段；`src/lib/saveFile.ts:57` 与 `src/lib/native.ts:33-35` 正确传播为 'shared'/'native' ✓（发布侧口径无问题；运行时提示文案归另一路）。
- 建议方案：①legacy 分享完成后（或下次导出时）清理 cacheDir/exports 旧文件；②ACTION_SEND 补 `intent.setClipData(ClipData.newRawUri(null, uri))` 保障旧 ROM URI 授权；③prune 的 LIKE 前缀转义 `%/_`；④displayNameOf 查询失败时对展示路径标注「可能与实际文件名不符」；⑤文件名正则与 safeSubdir 白名单已核实有效，保持现状。
- 置信度：已确认（源码）；第 2/5 点标注存疑的子项需真机。

### AND-18 [P3] singleTask + exported=true + 默认 taskAffinity：任务劫持类加固项
- 位置：`AndroidManifest.xml:19,21`（launchMode=singleTask、exported=true），无 taskAffinity 声明（默认=包名）；intent-filter 仅 MAIN/LAUNCHER（无自定义 scheme/deep link，攻击面小）。
- 问题与证据：StrandHogg 类任务亲和性劫持：同设备恶意应用声明 taskAffinity="com.xinshi.app" 可借 singleTask 的任务复用机制把自身 Activity 混入本 App 任务栈实施钓鱼。Android 各版本缓解程度不一；无 deep link 使远程触发不可能，需本地恶意应用。
- 建议方案：评估 `android:taskAffinity=""`（空亲和）或改 singleTop（Capacitor 模板默认 singleTask，改动需回归返回/最近任务行为）；至少在安全说明中记录该决策。
- 置信度：manifest 事实已确认；实际可利用性存疑（依 Android 版本/OEM，未复现）。

### AND-19 [P3] Android 16 预测式返回：功能可保但无预测动画，需真机回归返回层级
- 位置：`android/variables.gradle:4`（targetSdk 36）、`:5`（androidxActivityVersion 1.8.0）；`AndroidManifest.xml` 无 enableOnBackInvokedCallback；Capacitor `AppPlugin.java:47-62` 用 androidx OnBackPressedCallback；`BridgeActivity.java` 不覆写 onBackPressed。
- 问题与证据：Android 16 对 targetSdk 36 应用默认 enableOnBackInvokedCallback=true，系统不再调用 onBackPressed/分发 KEYCODE_BACK（官方 16 变更摘要）。官方迁移路径明确：androidx Activity 1.6.0+ 的 OnBackPressedCallback 与平台 OnBackInvokedDispatcher 自动桥接——本项目 activity 1.8.0 + Capacitor 回调满足该路径，**返回功能预计保留**；但回调恒 enabled=true → 系统无法预测返回是否被消费 → 无 back-to-home 预测动画。D5 修复的返回层级（JS 侧）应在 Android 16 真机回归。
- 建议方案：Android 16 真机验证各子页返回；如需预测动画，迁移到「按页面状态动态 enable 回调」或平台 OnBackInvokedCallback；短期可显式 `android:enableOnBackInvokedCallback="false"`  opting out（保留旧动画，代价是放弃预测式返回）。
- 置信度：机制已确认（官方文档 + 依赖源码）；真机表现待验证（存疑子项）。

### AND-20 [P3] 构建/模板/配置卫生项合集
- 位置与证据：
  1. `android/app/src/androidTest/.../com/getcapacitor/myapp/ExampleInstrumentedTest.java`、`src/test/.../ExampleUnitTest.java`：模板包名 com.getcapacitor.myapp 残留（与 namespace com.xinshi.app 不符，纯模板示例）。
  2. `android/build.gradle:11` google-services classpath 4.4.0 + `app/build.gradle:113-120` try/catch 探测 google-services.json：本项目无 Firebase，死配置。
  3. `android/app/src/main/res/xml/config.xml:2-3`：Cordova `<widget version="1.0.0">` 与 `<access origin="*"/>` 在 Capacitor 6 中**不生效**（Capacitor 不走 Cordova 白名单），但易误导审计者以为全开放；version 也与 1.2.4 漂移。该文件被 android/.gitignore:101 忽略（生成物，未跟踪 ✓）。
  4. `android/.gitignore:93` 忽略 capacitor-cordova-android-plugins，但 `settings.gradle:2-3` 无条件 include 该目录：fresh clone 直接 gradle sync 会失败，必须先 `pnpm android:sync`（package.json:22 已有脚本，属 Capacitor 标准流程，建议 README 明示）。
  5. `package.json` 无 `packageManager`/`engines` 字段：pnpm/Node 版本不钉死，lockfileVersion 9.0 需 pnpm≥9，CI/新机器可能用错包管理器。
  6. `src/lib/version.ts:4-7`：`__APP_VERSION__` 注入失败时回退硬编码 '1.2.4'，未来 bump 易漂移（vite.config.ts:13-16 正常注入时无问题）。
  7. `android/gradle.properties:12`：org.gradle.jvmargs=-Xmx1536m 偏小（R8 fullMode 大项目易 GC 抖动），非错误。
  8. `capacitor.settings.gradle:3,6,9` 写死 .pnpm 精确版本路径（生成文件，cap update 会重写）：升级依赖后必须 cap sync，否则 gradle 找不到工程——与 4 同类流程约束。
- 建议方案：逐项清理——①删除或重命名模板示例测试（com.getcapacitor.myapp 包名残留）；②移除 google-services classpath 与探测逻辑（无 Firebase）；③config.xml 注明「Cordova 壳生成物，Capacitor 6 不生效」或删除；④README 明示 fresh clone 需先 `pnpm install && pnpm android:sync` 再 gradle sync；⑤package.json 补 packageManager（pnpm）与 engines（node）钉死工具链；⑥version.ts 回退值改开发标识（如 '0.0.0-dev'）或构建期断言注入成功，防 bump 漂移；⑦org.gradle.jvmargs 视 R8 表现酌情上调（如 -Xmx2g）；⑧升级依赖后必须 cap sync 重写 capacitor.settings.gradle（写入发布 SOP）。
- 置信度：已确认（各文件行号）。

### AND-21 [P3] Android 5–9 其余导出仍把「分享面板已打开」当成功提示（未修复项#6，发布侧口径记录）
- 位置：`src/lib/native.ts:4,33-35`（'shared' 结果类型已正确区分）；上轮审计 A5 已给 autoBackup/DataSafety/Profile 加守卫；CSV/Excel/工资条/照片等其余导出路径的提示文案未改（运行时细节归另一路审计，此处仅记录发布侧现状）。
- 影响：旧系统用户可能误以为已落盘（仅文案，无数据风险——文件确实进了分享面板，保存与否由用户决定）。
- 建议方案：统一在 saveBlobFile 调用层对 'shared' 结果出「请确认文件已保存」提示。
- 置信度：已确认（native.ts 语义 + 上轮审计记录）；具体页面文案归另一路核实。

---

## 二、正面核实（无发现项）

| 核实点 | 结论 | 证据 |
| --- | --- | --- |
| 无 INTERNET 权限 | ✅ release 与 debug 合并清单均只有 RECEIVE_BOOT_COMPLETED/WAKE_LOCK/POST_NOTIFICATIONS + signature 级自定义权限 | merged_manifest/release:10-18、debug:10-18 |
| 无精确闹钟权限 | ✅ 合并清单无 SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM，与政策「不申请精确闹钟」一致 | merged_manifest 全文 + privacy-policy.html:179 |
| cleartext/混合内容 | ✅ 无 usesCleartextTraffic（targetSdk≥28 默认 false）+ allowMixedContent:false + 无网络权限 | Manifest 全文、capacitor.config.ts:11、Bridge.java:575-577 |
| adb backup 提取账本 | ✅ allowBackup=false 阻断（D2D 缺口另见 AND-02） | Manifest:6-7 |
| FileProvider 收窄（E2） | ✅ 仅 `<cache-path name="exports" path="exports/"/>`，与 shareViaLegacy 写入位置一致 | file_paths.xml:5、SaveFilePlugin.java:130 |
| 签名守卫（E3） | ✅ taskGraph.whenReady 对 assembleRelease/bundleRelease/installRelease/packageRelease/packageReleaseBundle 缺 signing.properties 抛 GradleException（debuggable 缺口见 AND-03） | app/build.gradle:70-91 |
| R8 keep 完整性（v0.7.1 闪退修复） | ✅ keep com.xinshi.app.**、四类 Capacitor 注解 @interface、@CapacitorPlugin 类、所有 Plugin 子类及 @PluginMethod/@PermissionCallback/@ActivityCallback 方法；capacitor-android 自带 consumerProguardFiles | proguard-rules.pro:24-45、capacitor/build.gradle:51 |
| SDK 版本 vs Play 2026 | ✅ targetSdk 36 满足 2026-08-31 起「新应用/更新必须 target API 36」（延期上限 2026-11-01 已过，本项目无需延期）；minSdk 22、compileSdk 36、AGP 8.13.2 + Gradle 8.14.3 + Java 17 配套兼容 | variables.gradle:2-4、build.gradle:10、gradle-wrapper.properties:3、[Play 官方要求](https://developer.android.google.cn/google/play/requirements/target-sdk) |
| 版本一致性 | ✅ package.json 1.2.4 == build.gradle 默认 1204/1.2.4 == release 合并清单 == version.ts 回退值；SW v30：public/sw.js == assets/public/sw.js（diff 一致）；assets/public/index.html == dist/index.html（今日新构建 diff 一致，资产未过期） | package.json:4、app/build.gradle:13,16、merged_manifest:4-5、sw.js:1、diff 实测 |
| capacitor 配置漂移 | ✅ assets/capacitor.config.json 与 capacitor.config.ts 字段完全一致（appId/appName/webDir/androidScheme/allowMixedContent）；capacitor.plugins.json 与 capacitor.build.gradle 插件集一致 | 两文件全文比对 |
| 隐私政策两份副本 | ✅ docs/privacy-policy.html == public/privacy-policy.html（diff 逐字节一致，8826B）；PRIVACY_VERSION '2026-11-05' == 政策页版本 | diff 实测、compliance.ts:7、privacy-policy.html:128 |
| 安全区每页抛异常修复 | ✅ 注入脚本自带 `if(!d||!d.style){return;}` 兜底；Capacitor 6.2.3 Bridge 无竞争 insets 监听（grep 0 命中） | MainActivity.java:132、Bridge.java grep |
| 运行时依赖公告 | ✅ react/react-dom 19.3.1（CVE-2026-126187/GHSA-xqc2-xf4c-x3h3 仅影响 react-server-dom-*，lock 中无该包，且 19.3.1 为修复版）；jspdf 4.2.1（CVE-2026-31938 修复版，且仅用 output('blob')）；dompurify 3.4.17（CVE-2026-116802/116803 修复版）；vite 6.4.5（GHSA-8g5g-mxqh-grgj/CVE-2026-118662 修复版，dev server 仅绑 127.0.0.1） | lock:23-62,2324-2333；[React](https://brandefense.io/knowledge-hub/vulnerabilities/cve-2026-126187/)、[jsPDF](https://vuldb.com/cve/CVE-2026-31938)、[DOMPurify](https://security-tracker.debian.org/tracker/CVE-2026-116803)、[Vite](https://docs.devguard.org/vulnerability-database/GHSA-8g5g-mxqh-grgj/) |
| 密钥 never-in-git | ✅ git rev-list --all --objects 全历史无 keystore/jks/password.txt/signing.properties/.env 对象（.env.example 除外）；磁盘 android/keystore/ 含 password.txt/signing.properties/xinshi-release.jks 三件，均被忽略未跟踪（只确认存在，未读内容） | 历史扫描实测、git check-ignore、ls |
| 正式分发产物完整性 | ✅ release/xinshi-v1.2.4.apk（11-12 19:12）：SW v30、index.html 与当前 assets 逐字节一致、v1(META-INF)+v2 签名块齐全（v1 保证 Android 5–9 可装）；SHA-256 与字节数同 docs/RELEASE-NOTES-v1.2.4.md:88-89 登记完全一致（apk E0388AC4…、aab BEB71814…）；app-release.apk 内容相同；release/ 另存 v1.2.4.aab + R8 mapping.txt（6.5MB，崩溃反混淆用）与历史各版 APK/AAB/idsig | Python zipfile 实测 + sha256sum 实测 |

---

## 三、上轮 E 组修复逐条核实

| # | 上轮声称 | 本次核实 | 结论 |
| --- | --- | --- | --- |
| E1 | .gitignore 增补 7 类密钥规则；keystore/口令从未入库 | 根 .gitignore:17-23 规则齐全（*.jks/*.keystore/signing.properties/password.txt/.env/.env.*/!.env.example）+ android/keystore/（:14）；全历史对象扫描干净；check-ignore 实测命中 | ✅ 真实落地（残余格式缺口见 AND-14） |
| E2 | FileProvider 收窄为 cache-path exports/ | file_paths.xml:5 仅一条 cache-path；无 external-path/root-path；与 SaveFilePlugin.java:130 写入位置一致 | ✅ 真实落地（检查脚本断言偏弱见 AND-05.4） |
| E3 | 缺 signing.properties 时 release 构建抛 GradleException | app/build.gradle:80-91 taskGraph.whenReady 守卫存在，覆盖 5 个 release 产物任务；debug/同步不受影响 | ✅ 真实落地（不拦 debuggable release 见 AND-03；只查存在性不查内容有效性） |
| E4 | 默认隐私 URL 改相对路径 + 离线政策页进 public/；上架前仍需注入真实值 | compliance.ts:17 默认 'privacy-policy.html'；public/privacy-policy.html 存在且与 docs 一致、随构建进 dist 与 APK assets；VITE_PRIVACY_URL/VITE_SUPPORT_EMAIL 注入机制存在（import.meta.env） | ✅ 代码侧缓解落地；❌ 上架侧未完成：政策页内仍挂 404 在线链接、邮箱仍占位、STORE-LISTING 仍指死链（AND-04，实测 404） |
| E5 | 新增 check-release-config.mjs，8 PASS | 脚本存在（257 行），7 组检查产出 8 个结果；pnpm check:release 已挂（package.json:24） | ✅ 存在且可运行（静态审查）；但多处漏检/弱检使「8 PASS」高估安全性（AND-05） |

## 四、未修复项现状（本路相关）

| # | 项 | 现状 |
| --- | --- | --- |
| #1 | 隐私政策公开地址与支持邮箱 | **仍未解决**：默认 URL 已离线化（E4），但政策 HTML 内「在线版本」仍 404（实测）、support@xinshi.app 仍占位、check 脚本不查邮箱（AND-04/05） |
| #2 | CSP 未加 | **仍未解决**：index.html 内联脚本依旧、无 CSP；风险面核实为小（0 innerHTML/eval，纯本地渲染），建议构建期 hash 注入（AND-07） |
| #3 | 崩溃诊断写公共 Download | **仍未解决**：crash()/onRenderProcessGone 无条件 export，release 同样写；政策未披露；<Q 分支实际写 app 外部私有目录（口径差异）（AND-01/16） |
| #6 | Android 5–9 其余导出提示 | **仍未解决**（发布侧口径）：'shared' 语义已正确传播，autoBackup 已守卫，其余导出文案未改（AND-21，运行时细节归另一路） |
| #7 | e2e 脚本漂移 | **仍未解决且可量化**：28 脚本全部止于 2026-11-07，无 v1.2.2–v1.2.4 覆盖；硬编码 4173/Edge 路径/同意版本；不启动 preview（AND-06） |

## 五、跟踪文件构成统计（git ls-files，共 517）

| 顶层目录 | 文件数 | 说明 |
| --- | --- | --- |
| shots/ | 179 | 版本截图档案，磁盘 34MB（AND-13） |
| src/ | 150 | 应用源码（ts 100 + tsx 52 的主体） |
| scripts/ | 67 | e2e/审计/截图/图标脚本（mjs 65 + py 2） |
| android/ | 58 | 原生壳与 gradle（java 5：3 主代码 + 2 模板测试；xml 12；gradle 6；含 gradlew/gradlew.bat/wrapper.jar） |
| docs/ | 41 | 计划/发布说明/商店清单/政策（最大 40KB，无大文件） |
| public/ | 11 | 静态资源（含 2.4MB 字体 xinshi-sans.ttf、sw.js、privacy-policy.html） |
| 根 | 11 | package.json/lock/workspace/tsconfig/vite/vitest/capacitor/index.html/README/.gitignore/.env.example |

扩展名分布：png 207、ts 100、mjs 65、tsx 52、md 44、xml 12、gradle 6、java 5、html 3、gitignore 3、yaml/svg/py/properties/json 各 2、webmanifest/txt/ttf/pro/js/jar/example/css/bat 各 1、无扩展名 1（gradlew）。
未跟踪磁盘产物（均被忽略，核实存在）：android/aligned.apk（5.2MB，11-05）、android/keystore/{password.txt,signing.properties,xinshi-release.jks}、android/local.properties、android/app/build/**、assets/public/**（48 文件，11-12，与 dist 一致）、dist/**。
构建产物入库核实：assets/public **0 个跟踪文件**（android/.gitignore:96 生效）；test-results*/release/*.apk 跟踪数 0。

## 六、依赖版本表（pnpm-lock.yaml 实际解析）

| 包 | specifier | 解析版本 | 链 | 安全状态（本次查证/引用） |
| --- | --- | --- | --- | --- |
| react / react-dom | ^19.0.0 | 19.3.1 | 运行时 | 无已知公告；RSC RCE CVE-2026-126187 不适用（无 react-server-dom-*）且 19.3.1 为修复版 |
| @capacitor/core / android / cli | 6.2.3 | 6.2.3 | 运行时/开发 | 无公告；Capacitor 6 维护线（7 已发布，升级另议） |
| @capacitor/app | 6.0.3 | 6.0.3 | 运行时 | 无公告 |
| @capacitor/local-notifications | 6.1.3 | 6.1.3 | 运行时 | 无公告；合并清单无精确闹钟权限 |
| jspdf | ^4.2.1 | 4.2.1 | 运行时 | CVE-2026-31938（<4.2.1）修复版；仅 output('blob') |
| dompurify（jspdf 传递） | — | 3.4.17 | 运行时（打包未调用） | CVE-2026-116802/116803（<3.4.17）修复版 |
| html2canvas（jspdf 可选） | — | 1.4.1 | 构建期 alias 为空模块 | 不进产物（vite.config.ts:20） |
| canvg / core-js / fflate / fast-png / @babel/runtime | — | 3.0.11 / 3.51.0 / 0.8.3 / 6.4.0 / 7.29.10 | jspdf 依赖 | 未见公告（未逐一深查） |
| lucide-react | ^0.468.0 | 0.468.0 | 运行时 | 未见公告 |
| qrcode-generator | ^2.0.4 | 2.0.4 | 运行时 | 未见公告 |
| vite | ^6.0.0 | 6.4.5 | dev | GHSA-8g5g-mxqh-grgj/CVE-2026-118662（6.4.4）修复版；dev server 仅 127.0.0.1 |
| vitest | ^2.1.8 | 2.1.9 | dev | 主代理 audit  flagged（含 tinypool 1.1.1）；落后 2 个大版本 |
| vite（vitest 嵌套） | — | 5.4.21 | dev | 主代理 audit flagged；5.4.x 维护线 |
| esbuild | — | 0.21.5（vite5 链）/ 0.25.12（vite6 链） | dev | 0.21.5 属旧线（audit flagged） |
| tar（@capacitor/cli 传递） | — | 6.2.1 | dev | 主代理 audit flagged |
| playwright-core | ^1.64.1 | 1.64.1 | dev | 未见公告 |
| typescript | ~5.7.2 | 5.7.3 | dev | — |
| @vitejs/plugin-react | ^4.3.4 | 4.7.0 | dev | — |
| @types/react / @types/react-dom | ^19.0.0 | 19.3.0 | dev | — |
| rollup / postcss / nanoid | — | 4.67.4 / 8.5.32 / 3.3.20 | dev | 均为修复后版本（nanoid≥3.3.8、postcss≥8.4.31） |

主代理 pnpm audit 汇总（引用）：29 漏洞 = 4 critical / 9 high / 15 moderate / 1 low，全部 dev 链（tar@6.2.1、vitest@2.1.9+tinypool@1.1.1+嵌套 vite@5.4.21/esbuild、glob/minimatch via rimraf）；运行时依赖无公告。详见 AND-12。

## 七、实际读过的文件清单

**全文/主体**：docs/AUDIT-v1.2.4.md；android/app/src/main/java/com/xinshi/app/{MainActivity,SaveFilePlugin,XinshiApp}.java；android/app/src/main/AndroidManifest.xml；android/app/src/main/res/xml/{file_paths,config}.xml；android/app/src/main/res/values/styles.xml；android/app/src/main/res/values-v31/styles.xml；android/app/src/main/assets/{capacitor.config.json,capacitor.plugins.json}；android/{build.gradle,variables.gradle,gradle.properties,settings.gradle,capacitor.settings.gradle}；android/app/{build.gradle,capacitor.build.gradle,proguard-rules.pro,.gitignore}；android/.gitignore；android/gradle/wrapper/gradle-wrapper.properties；capacitor.config.ts；vite.config.ts；tsconfig.json；vitest.config.ts；package.json；pnpm-workspace.yaml；pnpm-lock.yaml（importers 段 + jspdf/vite 依赖段 + 定向 grep）；.gitignore；index.html；scripts/check-release-config.mjs（全文）；scripts/functional.mjs（1-70）；scripts/functional-v120.mjs（1-60）；src/lib/{compliance,saveFile,native,version}.ts；public/privacy-policy.html（全文）；public/sw.js（全文）；public/manifest.webmanifest；shots/README.md（头 15 行）。
**只读比对/统计**：docs/privacy-policy.html（diff）；dist/index.html（diff）；android/app/src/main/assets/public/{index.html,sw.js}（diff）；android/app/build/intermediates/merged_manifest/{release,debug}/process*MainManifest/AndroidManifest.xml（全文/grep）；git ls-files/log/rev-list/check-ignore/status 系列。
**依赖源码（node_modules，只读）**：@capacitor/android 6.2.3 BridgeActivity.java（全文）、Bridge.java（initWebView/onDestroy/常量段）、CapConfig.java（默认值段）；@capacitor/app 6.0.3 AppPlugin.java（返回/退出段）；capacitor-android build.gradle（proguard 段）。
**外部查证**：Play target SDK 要求、Android 16 预测式返回、D2D 迁移案例（Mozilla Bugzilla 2073967 / tmail ADR-0073）、vite/dompurify/jspdf/react 公告（链接见正文）；pinbodhua.github.io 隐私 URL 实测 404。
**未读（围栏/纪律）**：android/keystore/* 内容、signing.properties、password.txt、.env*（含 .env.example，凭据围栏拒绝）；未运行任何 build/test/audit/gradle/服务器。aligned.apk 与 release/*.apk 仅以 Python zipfile 只读比对 assets/签名块/哈希，未反编译 dex。

## 八、统计

- 发现总数：21 条 —— P0×0，P1×4（AND-01~04），P2×7（AND-05~10、AND-12），P3×10（AND-11、AND-13~21）。
- 上轮 E 组：E1/E2/E3/E5 落地 ✅，E4 代码侧落地、上架侧未完成 ⚠️。
- 未修复项 #1/#2/#3/#6/#7 全部仍在（量化证据见第四节）。
- 正面核实 15 项（第二节）；跟踪文件 517（shots 占 179/34MB）；构建产物 0 入库；密钥全历史 0 入库；正式 v1.2.4 APK/AAB 内容最新、签名齐全、hash 与发布说明一致。
- 限制：.env.example 内容未能核对（凭据围栏）；Android 16 返回/崩溃页行为/旧 ROM URI 授权需真机验证（各条已标注）；aligned.apk 断代基于 SW v19（未解析二进制 manifest 版本号）。

## 附录补记（增量验证）

### aligned.apk 与正式产物内容比对（Python zipfile，只读，2026-11-17）

| 产物 | mtime | 内嵌 SW | index.html==当前资产 | v1 签名 | v2 签名块 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| android/aligned.apk | 11-05 18:48 | **v19** | ❌（assets 仅 23 个） | ❌ | ❌ | 陈旧未签名中间产物（AND-11） |
| release/xinshi-v1.2.2.apk | 11-11 22:50 | v28 | ❌（对当前） | ✅ | ✅ | 历史版本，正常 |
| release/xinshi-v1.2.3.apk | 11-12 08:49 | v29 | ❌（对当前） | ✅ | ✅ | 历史版本，正常 |
| release/xinshi-v1.2.4.apk | 11-12 19:12 | **v30** | ✅ | ✅ | ✅ | 最新正式包 |
| android/app/build/outputs/apk/release/app-release.apk | 11-12 19:12 | v30 | ✅ | ✅ | ✅ | 与正式包一致 |

- aligned.apk 二进制 manifest 字符串池未检出 1.2.4/1.2.3/1.2.2/1.2.1/1.2.0/1.1.0/1.0.0/0.9.0 的 UTF-16 编码（版本更老或 UTF-8 池，未深究；SW v19 已足以断代）。
- release/xinshi-v1.2.4.apk SHA-256 `e0388ac41a0a076901deb321439c8009fad6d56c211fb47dfb275dab5f7734fc`、aab `beb718146887f2b11caed91d0e320b3731bc5232e1355c32e79e9d0c0adbf05e`，与 RELEASE-NOTES-v1.2.4.md:88-89 登记逐字一致；字节数 3,355,283 / 3,833,795 亦一致。
- 环境无 unzip，改用捆绑 Python zipfile 完成比对；全程只读，未修改任何产物。
