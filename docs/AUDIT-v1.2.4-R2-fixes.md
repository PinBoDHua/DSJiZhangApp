# 薪时 XINSHI · v1.2.4 第二轮审计修复记录（R2-fixes）

> 修复日期：2026-11-17（Asia/Shanghai）
> 依据：docs/AUDIT-v1.2.4-R2.md（第二轮审计，119 条：P0×0 / P1×9 / P2×29 / P3×81）
> 代码基线：git HEAD 6c0f682（v1.2.4）；修复版本：v1.2.5 / versionCode 1205 / SW v32
> 验证：typecheck 0 错误、43 个测试文件 / 384 用例全绿、vite build 通过、check:release 16 PASS / 0 FAIL、离线+CSP 构建校验 16 PASS；签名 APK/AAB 已构建，并在雷电模拟器覆盖安装 + 启动 + 首屏冒烟通过（见第十一节）

## 一、总览

| 严重度 | 数量 | 已修复 | 部分修复 / 待业务输入 | 未修复（按计划延后） |
| --- | --- | --- | --- | --- |
| P1 | 9 | 8 | 1（AND-04：真实支持邮箱与公开政策托管地址需业务提供） | 0 |
| P2 | 29 | 25 | 4（AND-05 子项、AND-06 自动 preview、UI-08 页面级 memo、UI-09 长列表虚拟化） | 0 |
| P3 | 81 | 约 70 | 若干（见第九节） | 11（依赖升级 / 真机验证 / 性能改造 / Git LFS 等） |
| 依赖漏洞 | 29（dev 链） | 0 | — | 3 条（DEP-01/02/03，需联网升级 + 回归，未在本轮擅自升级） |

本轮新增测试 102 个（282 → 384），新增测试文件 5 个；新增构建校验脚本 scripts/check-offline-csp.mjs；check-release 由 8 项扩展到 16 项。

## 二、P1（9 条）

| 编号 | 结论 | 修复要点 |
| --- | --- | --- |
| D01 结算单绕过持久化守卫 | 已修复 | settleJob 改走 commit()，置 pendingPersist；结算单不再被跨标签页 storage 事件静默吞掉 |
| D02 跨标签页整包丢失更新 | 已修复（短期方案） | 乐观 CAS + 更新函数重放：落盘前比对远端原文，冲突时重读远端并重放本窗口 updater（src/lib/stateMerge.ts）；抽取纯函数测试 |
| D03 MoveSheet 分享面板假成功 | 已修复 | saveTextFile 返回 shared 时不 markBackedUp、文案改「请确认保存」，结果屏区分已保存 / 待确认 |
| PAY-01 月薪×非月结周期封顶过松 | 已修复 | 封顶按「周期落在当月天数 / 当月天数」折算（periodShareCap）：月薪 3500/22、2026-11 全勤，周结合计由 4772.74 降为 3500.02（分币舍入），月结 3500 |
| PAY-02 超休额度比例折算重复扣 | 已修复（口径决策） | 非整月周期不再自动扣超休、只展示折算额度并提示；月休 5 天分三周休的误扣 264.10 → 0；整月周期口径不变 |
| AND-01 崩溃诊断写公共 Download | 已修复 | 正式包只写应用私有 filesDir；仅调试构建 / 主动诊断导出才进公共目录，并清理历史残留；政策补充披露 |
| AND-02 缺 dataExtractionRules | 已修复 | 新增 res/xml/data_extraction_rules.xml，cloud-backup 与 device-transfer 排除全部数据域，manifest 挂载 |
| AND-03 可调试 release 无守卫 | 已修复（静态） | Gradle 守卫拦截 release 产物 + debuggable 旗标；check:release 增加守卫存在性与 APK badging 断言（本机无 SDK 时为明确 NOTE） |
| AND-04 政策死链 + 占位邮箱 | 已修复（托管待办） | 两份政策 HTML 删除 404「在线版本」链接、版本升至 2026-11-17、应用内政策页同步；支持邮箱已替换为真实地址 2359648846@qq.com（compliance.ts / 两份 HTML / .env.example / STORE-LISTING 同步），check:release 占位邮箱检测通过。公开 HTTPS 政策页托管仍需另行办理 |

## 三、P2（29 条）

数据层：D04（导入 20MB 上限）、D05（导入钳制对齐 UI）、D06（otHours≤hours）、D08（prunePhotos 不再误删启动后新照片）、D09（resetAll 广播 epoch，防远端复活旧账）、D10（原生桥 45s 超时）、D11（拒收「已结算周期内未锁定工记」+ 体检规则）。
计薪/导出：PAY-04（CSV 数字统一 round2）、PAY-05（记录页/日历/统计统一封顶分摊口径）、PAY-06（Excel 预估行逐期汇总）、PAY-07（net≤0 可标记无需收款/已结清，toast 与落库同源）。
Android/发布：AND-05（check-release 补强为 15 项 FAIL 级断言）、AND-06（28 个 functional 脚本去除同意版本/端口/浏览器路径硬编码）、AND-07（构建期注入 CSP，脚本 sha256 动态计算）、AND-08（LMK 不按崩溃计数/导出）、AND-09（崩溃页加重启/退出、返回键兜底）、AND-10（诊断日志截断 + 环形滚动 + 只读尾部）。
前端：UI-02（撤销结算取消守卫）、UI-03（ledgerSeq 变化重置自动补记）、UI-04（岗位卡已结算待收纳入徽章）、UI-05（首页/计时单价随隐藏金额打码）、UI-06（导出面明文提示）、UI-08（store value useMemo + EntryRow memo，页面级 memo 部分）、UI-09（搜索分页保护，长列表虚拟化未做）、UI-10（录入与导入上限一致）、UI-11（构建期预缓存清单，PWA 离线可用）、UI-12（复制到今天用岗位当前规则）、UI-13（--muted-2 对比度达 AA）。

## 四、P3 已修复列表（约 70 条）

D 组：D07、D12、D13、D14、D15、D16、D17、D18（并入 PAY-15）、D19（PBKDF2 600k）、D21、D22、D23、D24、D25、D26、D27、D28、D29（部分）、D31、D32、D33、D34、D35、D36。
PAY 组：PAY-09 至 PAY-29（PAY-12/16/22/25 部分或延后，见第九节）。
AND 组：AND-11、AND-14、AND-16、AND-17、AND-20（部分）、AND-21（=UI-22）。
UI 组：UI-14 至 UI-42（UI-28 / UI-40 maskable 图标等少数子项延后，见第九节）。

## 五、验证结果

| 命令 | 结果 |
| --- | --- |
| npx tsc --noEmit | 0 错误 |
| npx vitest run --no-file-parallelism | 43 文件 / 384 用例全部通过（基线 38 / 282） |
| npx vite build（含 tsc 由 pnpm build 执行） | 通过，约 2.8s；dist 已重建 |
| node scripts/check-release-config.mjs | 16 PASS / 0 FAIL（NOTE：占位邮箱、无 SDK 无法 aapt2 badging） |
| node scripts/check-offline-csp.mjs | 16 项全 PASS（预缓存 42 项、CSP hash 匹配、manifest id、SW v32） |
| node --check scripts/*.mjs | 全部通过（含 28 个 functional + 28 个截图/审计脚本） |
| git diff --check | 无空白错误；无 CRLF 整文件噪声 |

## 六、发布前人工事项（必须）

1. 支持邮箱已配置为 2359648846@qq.com（src/lib/compliance.ts、两份政策 HTML、.env.example、STORE-LISTING 已同步）；如需更换用 VITE_SUPPORT_EMAIL 注入。可设 XINSHI_RELEASE_STRICT=1 让 check:release 对占位邮箱 FAIL。
2. 托管公开 HTTPS 隐私政策页并实测 200，再用 VITE_PRIVACY_URL 注入；两份政策 HTML 仍随构建分发（离线兜底）。
3. PRIVACY_VERSION 已升至 2026-11-17：老用户会重新看到隐私同意弹窗（预期）。
4. Android 打包前必须执行 pnpm build 与 npx cap sync android，重新生成 android/app/src/main/assets/public（当前本地 assets 仍是旧构建，未纳入 git）。
5. 已完成：版本升至 v1.2.5 / versionCode 1205，SW 缓存版本 v32；已构建签名 APK 与 AAB，校验值见第十一节。
6. 需要 Android SDK 的环境执行：aapt2 dump badging 确认正式 APK 无 application-debuggable；gradle 守卫已静态保证可调试 release 构建会失败。
7. 真机验证清单（审计标注「存疑」项）：Android 5–9 分享面板取消语义、Android 12+ OEM 换机迁移（dataExtractionRules）、Android 16 返回层级、崩溃页按钮与返回键、PWA 首装断网。

## 七、验证方法（供后续复核）

- 多标签页竞态 D01/D02/D09：双标签页打开同一账本，在提交与落盘之间注入 storage 事件；修复后两窗口记录应合并而非互相覆盖，清空后其他窗口不应复活旧账。
- 金额口径：直接跑 src/lib/pay.test.ts（PAY-01：周结 3500.02 / 月结 3500；PAY-02：周结三期超休扣款 [0,0,0]，月结整月仍 159.09）。
- PWA 离线：pnpm build 后 node scripts/check-offline-csp.mjs；真机断网首装访问未访问过的路由。
- CSP：构建产物 dist/index.html 的 sha256 与内联脚本独立计算一致（校验脚本已覆盖）。

## 八、设计取舍与已知风险

1. D02 为短期兜底（乐观 CAS + updater 重放），长期仍建议 BroadcastChannel 单写者或按记录 ID 增量合并；极端同时提交窗口仍可能以整包 updater（settleJob/导入）覆盖远端。
2. PAY-01 各期独立结算到分，整月多期合计可能有 ±0.02 元舍入漂移（无法在单期独立结算下消除）。
3. PAY-02 采用「非整月周期只提示不自动扣」，未实现跨结算单累计已扣天数的完整方案。
4. PAY-12 借支-only 岗位仍无法结算（lib 拒绝空工记结算，属产品/UI 流程）。
5. AND-03/AND-05 的 APK badging 断言需要 Android SDK，本机以 NOTE 说明，不静默 PASS。
6. 旧版 App 无法验证新版搬家包（checksumVersion=2 单向兼容）；旧→新兼容已保证。
7. iOS / 真机竞态类项未在本轮验证。

## 九、明确延后项

| 编号 | 原因 |
| --- | --- |
| DEP-01/02/03（tar/vitest/glob 依赖链漏洞） | 需联网升级 vitest 4 / capacitor cli，有 282+ 用例与 cap sync 回归成本，本轮未擅自升级；漏洞全在 dev 依赖链，不进运行时产物 |
| AND-13 shots/ 截图档案 34MB 入库 | 需 Git LFS 或外部存档 + 历史重写，属仓库治理 |
| AND-15/AND-18/AND-19（WebView 收紧 / StrandHogg / Android 16 返回） | 需真机回归与加固评估 |
| UI-08 页面派生 useMemo / UI-09 长列表虚拟化 | 中大型性能改造，需独立排期 |
| AND-06 自动启动 preview / 其余 scripts 运行时验证 | 需真实浏览器环境；同意版本/端口/路径时间炸弹已消除 |
| PAY-22 holiday 保存、UI-28 照片水印重打、UI-40 maskable 图标 | 交互/资源工作量小但需产品确认或新图片 |
| D29 store 持久化测试 | store 测试需要 jsdom / CDC 注入能力，当前 vitest 仅 node 环境且未引入新依赖 |
| PAY-16 发薪通知续排 | 依赖启动调度设计，非本轮范围 |

## 十一、v1.2.5 发布构建与真机冒烟记录（2026-11-17）

| 项 | 结果 |
| --- | --- |
| 构建 | pnpm build + npx cap sync android + ./gradlew assembleRelease + bundleRelease 全部成功 |
| APK | release/xinshi-v1.2.5.apk，3,369,731 字节 |
| APK SHA-256 | bee4a4cc0e3ef5fac3405f54b0ceacdfc94ab6b19c379eef6d10973050427582 |
| AAB | release/xinshi-v1.2.5.aab，3,848,997 字节 |
| AAB SHA-256 | 388993aff4e5ceff41e7cf48cf6074cc2a42a1f97dff66e9ed61504d6632d330 |
| aapt2 badging | versionCode=1205、versionName=1.2.5、minSdk 22、targetSdk 36；无 application-debuggable |
| 签名 | v1/v2 签名验证通过；证书 CN=Xinshi，SHA-256 a5b8514a165a7849a4073bd00a94759fcb957aa02f83970012eb72f25185d606 |
| 包内资源 | assets/public/sw.js = xinshi-v32；政策 HTML 含 2359648846@qq.com |
| 模拟器冒烟 | LDPlayer（emulator-5554）覆盖安装成功；启动后隐私同意弹窗（2026-11-17 版本）→ 同意 → 首页/我的页正常渲染；logcat 无 FATAL / AndroidRuntime 异常 |
| 结论 | AND-03/AND-04/发布链检查在真实产物上复核通过 |

## 十、主要改动文件（按层次）

- 数据层：src/store.tsx、src/lib/storage.ts、src/lib/health.ts、src/lib/snapshots.ts、src/lib/trash.ts、src/lib/movePackage.ts、src/lib/saveFile.ts、src/lib/autoBackup.ts、src/lib/photos.ts、src/lib/stateMerge.ts（新）、src/lib/crypto.ts、src/lib/compliance.ts
- 计薪/导出：src/lib/settlement.ts、money.ts、checksum.ts、csv.ts、excel.ts、xlsx.ts、budget.ts、recurring.ts、reminder.ts、nativeReminders.ts、payslip*.ts、batchTemplates.ts、search.ts、rest.ts、guards.ts、paydayNotifications.ts、src/types.ts
- UI：src/App.tsx、src/main.tsx、src/store.tsx、src/pages/*（Home/Records/Stats/SettlementPage/EntryEditor/JobEditor/Recurring/Jobs/Search/Profile/Attendance/DataSafety/Health/Snapshots/Settlements）、src/components/*、src/styles.css、src/lib/pagePay.ts（新）、src/lib/fileFeedback.ts（新）
- 构建/PWA：vite.config.ts、index.html、public/sw.js（v31）、public/manifest.webmanifest、src/hooks/useTheme.ts、src/components/ErrorBoundary.tsx
- Android/发布：android/app/build.gradle、AndroidManifest.xml、MainActivity/XinshiApp/SaveFilePlugin.java、res/xml/data_extraction_rules.xml（新）、android/build.gradle、android/gradle.properties、scripts/check-release-config.mjs、scripts/check-offline-csp.mjs（新）、scripts/lib/e2e-config.mjs（新）、28 个 functional 与 28 个截图/审计脚本、package.json、.gitignore
- 文档：public/privacy-policy.html、docs/privacy-policy.html、docs/STORE-LISTING.md、android/README.md、docs/RELEASE-NOTES-v1.2.5.md、本文件
- 发布产物（未跟踪）：release/xinshi-v1.2.5.apk、release/xinshi-v1.2.5.aab
