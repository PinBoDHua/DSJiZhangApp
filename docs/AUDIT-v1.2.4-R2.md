# 薪时 XINSHI · 前后端代码审计报告（第二轮 · v1.2.4）

> 审计日期：2026-11-17（Asia/Shanghai）
> 审计对象：`D:\DSJiZhangApp` @ git HEAD `6c0f682`（v1.2.4，versionCode 1204，SW v30，工作树干净）
> 审计性质：**只读审计——找出问题并给出解决方案，未修改任何源码/配置**
> 上一轮审计：[AUDIT-v1.2.4.md](AUDIT-v1.2.4.md)（2026-11-12，修复已随 v1.2.4 提交）
> 完整工作底稿（逐条代码证据）：[docs/audit-r2/](audit-r2/) 四份附录

## 执行摘要

**总体判断：项目工程质量良好，无 P0 级问题，但存在 9 条 P1 与 29 条 P2，集中在五个主题。**

- **基线健康**（主代理实测）：typecheck 0 错误；38 文件 / 282 用例全绿；build 通过；check:release 9 PASS / 0 FAIL。密钥全历史从未入库；合并清单确无 INTERNET 权限；正式 v1.2.4 APK/AAB 签名齐全、SHA-256 与发布说明逐字一致；XSS 面为零；CSV 公式注入防护有效；运行时依赖零公告。
- **上轮修复可信**：AUDIT-v1.2.4.md 声称的 41 项修复，**32 项完整落地、9 项部分落地、0 项虚报**。残留缺口呈同一模式——「同类路径未扫全」（A5 漏 MoveSheet、A11 漏 job 分支、D1 漏导出面、C4 漏岗位卡、A3 漏规则层）。
- **本轮发现**：4 路并行审计原始 128 条，经主代理逐条复核 P1 与关键 P2、跨路去重后为 **119 条独立问题：P0×0 / P1×9 / P2×29 / P3×81**。

**9 条 P1（五个主题）**：
1. **多标签页持久化竞态**（D01/D02）：settleJob 绕过守卫可致刚提交的结算单被静默吞掉；并发编辑整包丢失更新（last-writer-wins，无 CAS/合并）。触发面=PWA/桌面多标签页，Android 单窗口主场景不受影响。
2. **旧系统分享面板语义**（D03）：Android 5–9 搬家包导出取消后仍显示「已保存」并重置 14 天备份提醒——期间手机丢失/清缓存即全账丢失且无提醒。
3. **月薪×非月结周期口径**（PAY-01/02）：同月多期合计可超整月月薪最高 41%（4772.74 vs 3500）；超休额度比例折算致重复扣（应扣 0 实扣 264.10）。触发人群=导入/手改/遗留数据（当前 UI 已强制月薪月结）。
4. **Android 隐私/加固**（AND-01/02/03）：崩溃诊断无条件写公共 Download 且政策未披露（release 同样写）；缺 dataExtractionRules，部分 Android 12+ OEM 换机迁移可拷走整个账本；-Pxinshi.debuggable 可产出「已签名可调试 release」无自动守卫（run-as 整包提取账本）。
5. **发布侧死链**（AND-04）：政策页内「在线版本」实测 404、支持邮箱仍占位、STORE-LISTING 仍教人填死链——上架审核将被拒。

**其他要点**：dev 依赖链 29 个漏洞（4 critical，均不进运行时产物，DEP-01/02/03）；**两颗时间炸弹**——storage.test.ts 固定日期将于 2026-12-04/05 后假红（D28，距今约 2.5 周）、e2e 链同意版本写死（AND-06）；PWA 首装离线访问未缓存路由直接整应用错误屏（UI-11）；隐藏金额不覆盖首页单价/QR/工资条预览等导出面（UI-05/06）；上轮 8 项「未修复项」全部仍在（§8.4）。

**最具性价比的修复**（均 S 级）：D01（一行级）、D03（同口径守卫）、PAY-04（CSV round2）、D28（测试日期相对化）。若计划发布，批次 0（AND-04/03/01/02）先行。完整路线图见第九节。

**阅读指南**：第二/三节=基线与依赖；第四–七节=四域发现（每条含位置/影响/解决方案）；第八节=合并裁定、上轮 41 项核实与未修复项现状；第九节=修复路线图；[附录 A–D](audit-r2/)=四路完整工作底稿（代码摘录、算术验证、排除疑点记录）。


---

## 一、审计范围与方法

| 项 | 说明 |
| --- | --- |
| 应用形态 | 纯本地离线 App：React 19.3.1 + TypeScript 5.7.3 + Vite 6.4.5 + Capacitor 6.2.3 Android WebView 壳；账本 `localStorage`（schema v7），照片/快照 `IndexedDB`，自定义 `SaveFile` 原生插件，可选 PWA Service Worker（v30） |
| 「后端」口径 | 本项目**无服务端**（v0.6.0 起云同步暂停，Android 已移除网络权限，合并清单核实无 INTERNET）。「后端」= 本地数据层（storage/snapshots/trash/backup/crypto/movePackage）、计薪结算引擎（settlement/pay/recurring 等）、Android 原生壳与构建/发布链 |
| 代码规模 | 跟踪源文件 150 个（src/，约 3.7 万行），测试 38 文件 / 282 用例；原生 Java 3 文件；构建/审计脚本 67 个 |
| 审计方式 | 4 路并行只读审计（A 数据层 / B 计薪业务 / C 前端 UI / D Android 与发布）+ 主代理基线验证与 P1 逐条代码复核 |
| 对照基线 | 上一轮 AUDIT-v1.2.4.md 的 A1–A11 / B1–B9 / C1–C11 / D1–D5 / E1–E5 修复声称逐条用当前代码核实；8 项「未修复项」逐一复核现状 |
| 严重度 | **P0**=数据丢失/损坏、安全漏洞、发布阻断；**P1**=重大功能错误（含算钱错误）、隐私泄露、上架风险；**P2**=一般缺陷/边界/体验；**P3**=代码质量/卫生/测试债务 |
| 置信度 | 「已确认」=代码级证据充分；「存疑」=路径成立但触发概率/平台行为需真机或运行时验证（各条已标注验证方法） |

**审计限制（明示）**：
1. `.env.example`、`android/keystore/*`、`signing.properties`、`password.txt` 内容受凭据围栏保护**未读取**（只核实了其存在性与 git 跟踪状态）。
2. 未做真机运行验证；竞态类（D01/D02/D08/D09）、低端机 OOM 阈值、Android 16 返回行为、旧 ROM URI 授权等标注「存疑」的子项需真机复核。
3. 依赖漏洞以本机 `pnpm audit`（registry 实时公告）为准；外部 CVE 交叉查证仅作补充。

---

## 二、基线验证结果（主代理实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | ✅ 0 错误 |
| `pnpm test` | ✅ 38 文件 / **282 用例全部通过**（8.83s，与上轮审计声称一致） |
| `pnpm build` | ✅ 通过（3.20s，1942 模块） |
| `pnpm audit` | ⚠️ **29 个漏洞：4 critical / 9 high / 15 moderate / 1 low，全部位于 dev 依赖链**（详见第三节） |
| `pnpm check:release` | ✅ 9 PASS / 0 FAIL（主代理实测；脚本现存 9 个结果项。注意：PASS 含金量受 AND-05 漏检影响，调试旗标/隐私 URL 仍仅 NOTE 级人工确认） |
| git 全历史敏感对象扫描 | ✅ `git rev-list --all --objects` 无 keystore/jks/口令/signing.properties/.env 对象（E1「从未入库」复核通过） |

构建产物体积（dist，gzip）：主 chunk `index-DZDhxcK5.js` **469.5KB（147.2KB）**、CSS 164.5KB（28.8KB）、SettlementPage 76.5KB（25.1KB）、jspdf 390.8KB（128.8KB，懒加载）、purify.es 30.5KB（11.7KB，随 jspdf 打包但无调用路径）。Android 本地资产加载不受网络影响；PWA 首屏在移动网络下主 chunk 偏大（见 C 路性能发现）。

---

## 三、依赖与供应链安全（DEP）

> 所有漏洞均在 **devDependencies 链**，不进入 APK/dist 运行时产物；风险面是开发机与 CI（恶意 tar 解包、vitest 服务暴露等）。运行时依赖经 `pnpm audit` 核实**零公告**。

### DEP-01 [P2] tar@6.2.1（@capacitor/cli 传递）：11 个公告，含 1 critical + 7 high
- 位置：`pnpm-lock.yaml:1255`（tar@6.2.1，链 `.>@capacitor/cli>tar`）
- 问题：critical「Decompression/parse DoS via unlimited input」（[GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)，修复版 ≥7.5.19）；7 个 high 为硬链接/符号链接路径穿越致任意文件创建/覆盖/读取（GHSA-34x7-hfp2-rc4v、GHSA-8qq5-rm4j-mr97、GHSA-83g3-92jg-28cx、GHSA-qffp-2rhf-9h96 等，修复版 7.5.3–7.5.21）；3 个 moderate 为 PAX 头处理崩溃/尺寸覆盖。
- 影响/触发：`cap sync`/`cap update` 在开发机解包模板/更新时，恶意构造的 tar 可穿越写文件或 DoS。需攻击者控制模板源或中间人，概率低但属供应链高危面。
- 建议方案：升级 @capacitor/cli 至携带 tar≥7.5.21 的版本线（Capacitor 7/8，需回归 android 工程）；或 `pnpm.overrides` 强制 tar≥7.5.21——**注意 tar 7 为 ESM-only，@capacitor/cli 6 为 CJS，override 后必须实测 `cap sync` 全链路**。CI 加 `pnpm audit` 门禁（dev 链 critical 阻断）。

### DEP-02 [P2] vitest@2.1.9 测试链：3 critical + 多个 moderate/high（嵌套 vite@5.4.21 / esbuild@0.21.5 / tinypool@1.1.1）
- 位置：`pnpm-lock.yaml:1399`（vitest@2.1.9）、`:1276`（tinypool@1.1.1）、嵌套 vite@5.4.21、esbuild@0.21.5
- 问题：
  - critical：vitest「UI server 监听时任意文件读取与执行」（[GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)，修复 ≥3.2.6）；tinypool 原型污染 gadget 致 RCE ×2（GHSA-5gmw-xhrv-c9v3 ≥2.1.1、GHSA-85c8-ppgw-ccpr ≥2.1.2）。
  - moderate：vitest/@vitest/mocker 路径穿越任意文件读（修复 ≥4.1.11）、mocker 未认证代码注入（修复 ≥4.1.12）；嵌套 vite 5.4.21 的 dev-server 系列（fs.deny Windows ADS 绕过、fs.allow 外文件服务、launch-editor NTLMv2 泄露/参数注入等）；esbuild ≤0.24.2 任意网站向 dev server 发请求。
  - high/low：launch-editor existsSync 竞争（vite ≤6.4.3）、跨源脚本执行（low）。
- 影响/触发：仅开发/测试时暴露。本项目 `vitest run` 不开 UI server，critical 触发面小；但若开发者运行 `vitest --ui` 且监听非回环地址，同网段攻击者可读任意文件/RCE。
- 建议方案：升级 vitest 至 ≥4.1.12（一并消除 tinypool/mocker/嵌套 vite 链，注意 2→4 的 API/配置迁移与 282 用例回归）；短期可 `pnpm.overrides` tinypool≥2.1.2；纪律：vitest UI/API 永不绑定非回环地址。

### DEP-03 [P3] glob/minimatch（@capacitor/cli>rimraf）：2 个 moderate
- 问题：glob 9–14.0.1 AbortSignal 取消绕过（修复 ≥14.0.2）、minimatch 7–11.0.0 ReDoS（修复 ≥11.0.1）。
- 建议方案：随 DEP-01 升级 cli 一并消除，或 override。

### 运行时依赖清洁核实（正面结论）

| 包 | 解析版本 | 状态 |
| --- | --- | --- |
| react / react-dom | 19.3.1 | 无公告；RSC 相关 CVE 不适用（lock 无 react-server-dom-*） |
| jspdf | 4.2.1 | 无公告（相关 CVE 修复版）；仅用 `output('blob')`，`html()` 未使用且 html2canvas 已 alias 为空模块 |
| dompurify（jspdf 传递） | 3.4.17 | 无公告（相关 CVE 修复版）；打包但无调用路径 |
| @capacitor/core/android/app/local-notifications | 6.2.3 / 6.0.3 / 6.1.3 | 无公告 |
| vite（直接） | 6.4.5 | 已 patched（≥6.4.4）；dev server 仅绑 127.0.0.1 |
| lucide-react / qrcode-generator / playwright-core | 0.468.0 / 2.0.4 / 1.64.1 | 未见公告 |

交叉参考：D 路对 react/jspdf/dompurify/vite 的公开 CVE 做了补充查证（来源见 [附录 D](audit-r2/appendix-D-android.md) 第六节），与本机 audit 结论一致。

---

## 四、数据层与持久化（A 路 · 36 条：P1×3 / P2×8 / P3×25）

> 完整证据与代码摘录见 [附录 A](audit-r2/appendix-A-data.md)。范围内 23 个源码文件 + 13 个测试文件全文读完。**P1×3 及 D07/D09/D30 已由主代理逐行复核属实。**

### 4.1 发现总览

| # | 严重度 | 问题 | 位置 | 解决方向 |
| --- | --- | --- | --- | --- |
| D01 | **P1** | settleJob 是唯一不走 commit() 的写路径，未置 pendingPersist，跨标签页事件可吞掉刚提交的结算单 | store.tsx:947-962 | 改走 commit()（或 setState 前置守卫） |
| D02 | **P1** | 跨标签页并发编辑仍整包丢失更新：守卫丢弃的事件不补读、saveState 无 CAS，last-writer-wins | store.tsx:264-280,303-308; storage.ts:122-130 | 落盘前重读比对（乐观 CAS）/脏标记补读；长期按 ID 增量合并或单写者选举 |
| D03 | **P1** | MoveSheet 搬家包导出对 'shared' 无守卫：Android 5–9 分享面板取消仍 markBackedUp，14 天备份提醒被误重置 | MoveSheet.tsx:109-116 | 与 DataSafety.quickBackup 同口径守卫 'shared' |
| D04 | P2 | 备份/搬家包导入无文件大小上限，file.text()+JSON.parse 全量读入可致低端 WebView OOM | MoveSheet.tsx:145; Profile.tsx:238 | 读取前 file.size>20MB 拒绝 |
| D05 | P2 | 导入钳制只覆盖工记字段：rule.rate/expectedDays/OT 倍率、借支、结算金额、周期规则 bonus/deduction 无上限（可写 1e12 时薪） | storage.ts:264-286,405,529-545,595-596 | 与录入口径对齐钳制（rate≤1e6、expectedDays≤31、OT≤10 等） |
| D06 | P2 | 导入不校验 otHours≤hours（C7 只修在 UI 层），统计与计薪口径分叉 | storage.ts:379-381 | normalizeEntry 取 min(otHours,hours) 或拒绝 |
| D07 | P2 | 过期回收站「工作」仍可恢复：job 分支提前 return 绕过 trashRestoreBlockReason（A11 遗漏） | store.tsx:794-807 | job 分支同走过期拦截 |
| D08 | P2 | 启动 prunePhotos 的 keep 集在 mount 瞬间计算，冷启动后立即拍照保存的新照片可能被清理游标删除（照片不可再生） | store.tsx:290-300; photos.ts:118-140 | 跳过 createdAt>prune 启动时刻的记录/删前重读引用 |
| D09 | P2 | resetAll 清空可被另一标签页未落盘改动「复活」：对方忽略清空事件后整包写回旧账 | store.tsx:1063-1069,269 | 广播清空意图/写带时间戳空账而非仅删键 |
| D10 | P2 | SaveFile.save/prune 原生桥无超时，挂起时 autoBackup 的 running 单例永久占用，自动备份静默停摆 | saveFile.ts:51-56; autoBackup.ts:78/93/138 | 包 30–60s 超时并记录 lastError |
| D11 | P2 | 未修复项#5 仍在：导入放行「结算周期内未锁定工记」，且上轮声称的「体检会提示」不准确——health 无对应规则，该工记永远无法结算 | storage.ts:755-758; health.ts:91-104 | 导入拒绝/提示 + health 增规则 |
| D12 | P3 | 高版本拒绝可绕过：字符串 version:"8" 与裸 state 的 data.version 不检查 | storage.ts:627-630,846-847 | Number.isInteger 统一校验 + 裸 state 检查 |
| D13 | P3 | health 误报：同一结算单 entryIds 内重复 ID 被判「多张结算单重复结算」critical | health.ts:71-77,126-133; storage.ts:546 | entryIds 去重 + Set 统计 |
| D14 | P3 | health 漏报：entry.settlementId→S 但 S.entryIds 不含该 entry 的单向引用不检查 | health.ts:63-317 | 增单向引用规则 |
| D15 | P3 | 快照完整性校验偏弱：fnv1a 回退实为 32 位可伪造、bytes 未校验、抹 hash 即跳过、A9 零测试 | snapshots.ts:374-381,129-133 | 新快照仅 sha256 + bytes 校验 + 篡改回归 |
| D16 | P3 | 快照解压无输出尺寸上限（本地篡改可致 gzip 炸弹） | snapshots.ts:154-164 | 流式累计超 64MB 中止 |
| D17 | P3 | saveSnapshot put/prune 分两事务：prune 失败把已写成功的快照误报失败，导入被不必要取消 | snapshots.ts:338-361 | prune 失败降级 warning |
| D18 | P3 | settlementChecksum 不含收款字段：改「已收金额」校验码不变 | checksum.ts:9-17 | canonical 纳入 paidAmount/paymentStatus；升级 sha256 短码 |
| D19 | P3 | PBKDF2 250k 迭代低于现行 OWASP 建议（600k，SHA-256）；算法/盐/IV 本身正确 | crypto.ts:6 | 新导出包 600k（iterations 在包内，旧包兼容） |
| D20 | P3 | autoBackup 失败无退避：原生持续失败时每记一笔都重试整包导出（5MB 账本≈7MB base64/次） | autoBackup.ts:133-136; App.tsx:237-240 | 失败退避（同日 N 次后停到次日） |
| D21 | P3 | storageError 首次 toast 固定「存储空间不足」，不区分隐私模式/策略禁用 | store.tsx:255-258 | 按 error.name 区分文案 |
| D22 | P3 | 「清空所有数据」后最多 30 份历史快照（含完整金额/备注）全留且确认框未披露；clearSnapshots 为死代码 | snapshots.ts:408-420; store.tsx:1063-1069 | 提供「同时删除所有快照」选项 + 文案披露 |
| D23 | P3 | 回收站恢复 24h 校验用 round2 后的 hours，与精确值口径差 <0.01h | trash.ts:253-256,123 | 恢复时用原记录精确值复核 |
| D24 | P3 | 导入不校验 createdAt/updatedAt 格式，畸形值可扭曲同日多段日薪「最新快照」选取 | storage.ts:368/391/349/549 | Date.parse 校验，非法回退 now |
| D25 | P3 | 导入不查 photoId 共享：手改备份两条工记共享照片，删一损二（照片不可再生） | storage.ts:386; EntryEditor.tsx:520-527 | 重复拒绝/删前查引用 |
| D26 | P3 | 导入允许 active↔trash 跨集合重复 ID（A10 只修集合内；trashedJobs 有交叉检查而 entries/rests/advances 无） | storage.ts:800-829 | 与 trashedJobs 同口径 |
| D27 | P3 | StorageRecovery 损坏路径无「从备份导入」自救出口，非技术用户卡死在恢复页 | StorageRecovery.tsx:62-96 | 恢复页增导入入口（先强制导出 raw） |
| D28 | P3 | storage.test.ts 至少 4 处固定 deletedAt 时间炸弹：2026-12-04/05 后用例假失败（上轮声称已消除，实际只修了 trash.test.ts） | storage.test.ts:172,399,417,478-479 | 改用相对 daysAgo()（文件内已有 helper） |
| D29 | P3 | 测试缺口：A9 hash 校验、A2 unavailable 分支、store 持久化/跨标签页守卫均无单测；恒真断言（PHOTO_MAX_EDGE）；crypto/photos/saveFile/native/backupStatus/store 无测试文件 | snapshots.test.ts:3-11; storageRecovery.test.ts:15-43 等 | 优先补 A9 篡改/unavailable/持久化失败回归 |
| D30 | P3 | net≤0 的结算单永远无法登记收款（paid 恒 0 → 恒 'unpaid'），C6 残留边界 | store.tsx:980-982 | net≤0 允许直接标记「无需收款/已结清」 |
| D31 | P3 | 导入字符串字段（name/note/employer）无长度上限，数 MB 字符串撑爆 localStorage（A4 兜底不丢旧账但文案误导） | storage.ts:323,385,517,849 | 与 UI 输入上限对齐 |
| D32 | P3 | v6→v7 迁移回写无 CAS：双窗口同时冷启动迁移存在极窄覆盖窗口（几乎不可触发，A1 残留备查） | storage.ts:96-104 | 写前查 STORAGE_KEY 非空则放弃 |
| D33 | P3 | backupDueText「今天已备份」实为 24 小时口径，与 autoBackup 自然日口径不一致 | backupStatus.ts:27,41-44 | 文案改「24 小时内」或按自然日 |
| D34 | P3 | Web 下载路径无法感知取消/拦截，'web' 一律按成功 markBackedUp（平台限制） | native.ts:37-45 | 文案「已触发下载，请确认保存」 |
| D35 | P3 | useAutoSnapshot 每日快照定时器卸载不清理；auto-idle 失败完全静默（IDB 配额满时自动保护长期停摆无感知） | useAutoSnapshot.ts:59-66,94 | 定时器入 ref+cleanup；连续失败 surface 提示 |
| D36 | P3 | 搬家包校验码依赖 JSON 键序：第三方工具重序列化（sort_keys）内容相同却判「已损坏」 | movePackage.ts:74-80,198-215 | 文档说明或校验前按固定键序重建 |

> **主代理复核裁定**：D07 降为 P3（TrashSheet.tsx:199/237 已在 UI 禁用过期 job 恢复按钮，残留仅极窄 stale-render 窗口，详见 §8.3）；D30 并入 PAY-07（P2）；D01/D03 与 UI/PAY 路重复发现合并；D18 并入 PAY-15。本表保留 A 路原始定级以便对照，合并后权威口径见第八节。

### 4.2 P1 详情（主代理已逐行复核）

**D01 settleJob 绕过持久化守卫** —— `commit()`（store.tsx:303-308）先置 `pendingPersist.current = true` 再 setState，全部写操作都走它；唯独 `settleJob`（947-962）直接 `stateRef.current = committed.state; setState(committed.state)`。storage 监听以 `if (pendingPersist.current) return;`（269）为唯一守卫。结算提交后、持久化 effect（245-260）运行前，另一标签页的写入事件到达 → 守卫为 false → 读回远端旧账（不含本笔结算）→ 内存与磁盘同时回退，**结算单连同工记锁定状态静默消失且无报错**。触发面：PWA/桌面多标签页；Android WebView 单窗口不受影响。方案：settleJob 改走 commit()；根治见 D02。

**D02 跨标签页丢失更新（A1 修复的设计性残留）** —— A1 消除了「读取即回写」，但整本账仍是 last-writer-wins：①两窗口同持 S0 各自提交，后写者整包覆盖先写者（saveState 无版本比对，storage.ts:122-130）；②`pendingPersist=true` 期间收到的远端事件被**直接丢弃且不补读**（269 行 return 后无排队/重读），本地落盘后永不再拉取远端；③先写窗口随后收到后写事件 → 同步成对方状态，自己刚记的笔从内存和磁盘同时消失，只有一句 info toast。丢失粒度=整本账差异。方案：短期落盘前 getItem 比对（乐观 CAS）或「远端已变脏」标记落盘后补读合并；长期按记录 ID 增量合并或 BroadcastChannel 单写者选举。

**D03 MoveSheet 'shared' 未守卫（A5 遗漏点）** —— `const saved = await saveTextFile(...); markBackedUp(); toast('搬家包已导出','success')`（MoveSheet.tsx:109-116），无 `saved === 'shared'` 分支；结果屏还显示「搬家包已保存」。A5 已守卫 autoBackup/DataSafety/Profile 三处，独漏此处。Android 5–9 分享面板取消 → 无文件落盘 → `xinshi.lastBackup` 被重置 → 备份提醒与体检 backup-stale 静默 14 天，期间手机丢失/清缓存即全账丢失且无提醒。方案：与 DataSafety.quickBackup 同口径，'shared' 时提示「已打开系统分享面板，请确认文件已保存」并不 markBackedUp。

### 4.3 上轮 A 组修复核实（A1–A11）

| # | 原严重度 | 结论 | 残留 |
| --- | --- | --- | --- |
| A1 | P0 | **部分落地**（读不回写已修+回归钉住） | D01/D02/D32 |
| A2 | P1 | 已落地（unavailable/invalid 分流+「仍然进入」出口） | unavailable 分支无测试（D29）；invalid 无自助导入（D27） |
| A3 | P1 | **部分落地**（工记钳制+回归） | D05/D06 |
| A4 | P1 | 已落地（replaceState 先落盘，4 调用方均处理失败） | — |
| A5 | P1 | **部分落地**（三处守卫） | **D03 MoveSheet 遗漏** |
| A6 | P2 | 已落地（storageError 常驻横幅） | D21 文案 |
| A7 | P2 | 已落地（先 persistNow 再删照片） | D25 共享 photoId |
| A8 | P2 | 已落地（安全快照只与手动组去重+4 回归） | — |
| A9 | P2 | 已落地但偏弱 | D15（32 位回退/bytes 未校验/零测试） |
| A10 | P2 | 已落地（restDayIds 重复拒绝+回归） | D26 跨集合 |
| A11 | P2 | **部分落地**（过期拦截+边界回归） | **D07 job 分支绕过** |

---

## 五、Android 原生壳 / 构建 / 发布 / 仓库卫生（D 路 · 21 条：P1×4 / P2×7 / P3×10）

> 完整证据见 [附录 D](audit-r2/appendix-D-android.md)。P1×4 已由主代理逐行复核属实（Manifest/gradle/Java/政策页原文）。

### 5.1 发现总览

| # | 严重度 | 问题 | 位置 | 解决方向 |
| --- | --- | --- | --- | --- |
| AND-01 | **P1** | 崩溃诊断无条件写公共 Download（release 同样写），含设备型号+堆栈，隐私政策未披露（未修复#3 仍在） | XinshiApp.java:112,137-184; MainActivity.java:72 | 默认写 app 私有目录，用户主动导出才进公共目录；或政策披露+递增 PRIVACY_VERSION |
| AND-02 | **P1** | allowBackup=false 但缺 dataExtractionRules：部分 Android 12+ OEM 换机迁移（D2D）仍可拷走整个账本 | AndroidManifest.xml:6-7 | 增 res/xml/data_extraction_rules.xml，cloud-backup 与 device-transfer 均排除全部域 |
| AND-03 | **P1** | -Pxinshi.debuggable/webviewDebug 可产出「已签名可调试 release」：run-as 整包提取账本+WebView CDP 自动开启，守卫只查签名不查 debuggable | app/build.gradle:18-21,58-62,80-91; check-release-config.mjs:238-245 | taskGraph 守卫追加 debuggable 拦截；check:release 对产物做 badging 断言 |
| AND-04 | **P1** | 政策页自身仍挂 404「在线版本」链接+占位邮箱；STORE-LISTING 仍教人填死链（未修复#1 仍在，404 实测） | privacy-policy.html:220,224-225; compliance.ts:20; STORE-LISTING.md:23-24 | 上架前托管真实 HTTPS 政策页+注入 VITE_PRIVACY_URL/VITE_SUPPORT_EMAIL+替换两份 HTML 内链接+递增 PRIVACY_VERSION |
| AND-05 | P2 | check-release-config.mjs 多处漏检/弱检：不查 SUPPORT_EMAIL/政策内死链/assets 过期；FileProvider 只拒 external-path（root-path 可溜过）；SW 同版本仅 NOTE；versionCode 公式 minor≥10 碰撞（1.10.0==2.0.0→2000） | check-release-config.mjs:72-73,104-127,136-163,210-213,228 | 逐条补强为 FAIL 级断言（白名单式 FileProvider、占位邮箱、产物 debuggable、assets 哈希） |
| AND-06 | P2 | e2e 链 28 脚本整体漂移：全部止于 2026-11-07，无 v1.2.2–v1.2.4 修复覆盖；硬编码 4173/Edge x86 路径/同意版本'2026-11-05'（时间炸弹）；无一启动 preview（未修复#7 仍在） | package.json:13; functional.mjs:5-6,20-21 | 自动起 preview（随机端口）、浏览器路径可配置、同意版本从 compliance.ts 读；补 v1.2.1+ 回归或迁 vitest+jsdom |
| AND-07 | P2 | CSP 仍未加（未修复#2）：内联主题脚本+无 CSP；风险面核实为小（src 150 文件 0 innerHTML/eval/dangerouslySetInnerHTML，jspdf 仅 blob 输出） | index.html:7-24 | 构建期对内联脚本算 sha256 注入 meta CSP；纳入 check:release |
| AND-08 | P2 | onRenderProcessGone 不区分 didCrash=false（LMK 低内存回收）：与真崩溃同权计数，30 秒内两次即进死端崩溃页，且每次写公共诊断 | MainActivity.java:70-92 | didCrash=false 只 recreate 不计数不 export；真崩溃才计数 |
| AND-09 | P2 | 原生崩溃页无退出/重试控件；WebView 已 destroy 后返回键事件发进死 WebView（Capacitor AppPlugin 回调仍活），用户被困 9sp 诊断页 | MainActivity.java:166-192; AppPlugin.java:47-62 | 崩溃页加「重启/退出」按钮；进入时禁用 JS 返回回调或注册原生兜底 |
| AND-10 | P2 | 诊断日志无上限追加（crash() 不查尺寸）+全量读入内存/TextView；mark() 超 64KB 整删丢历史；深堆栈/崩溃循环时低端机 OOM/ANR 风险 | XinshiApp.java:75-78,104-107,214-224; MainActivity.java:174,182 | 堆栈截断（前 200 帧）+环形滚动日志+readLog 只取尾部 N KB |
| AND-11 | P3 | android/aligned.apk 为陈旧未签名 zipalign 中间产物（内嵌 SW v19、无 v1/v2 签名、不可安装），文件名易与正式包混淆 | android/aligned.apk（未跟踪） | 删除或移入 build/；发布 SOP 只从 release/ 取带 hash 登记的成品 |
| AND-12 | P2 | dev 依赖链 29 漏洞（4 critical），引用主代理 pnpm audit；运行时产物不受影响 | pnpm-lock.yaml | 见本报告第三节 DEP-01/02/03 |
| AND-13 | P3 | shots/ 截图档案 179 文件 34MB 入库（占跟踪文件 35%），git 历史永久携带 | shots/ | 迁 Git LFS/外部存档，仓库留缩略图索引 |
| AND-14 | P3 | .gitignore 残余缺口：无 *.pem/*.p12/*.p8/*.key/google-services.json 兜底；.audit-work/ 未忽略 | .gitignore:1-30 | 补密钥格式兜底，与 check 脚本 isSensitivePath 同步 |
| AND-15 | P3 | WebView 无关放宽项（Capacitor 默认）：geolocation/WebSQL/media gesture/window.open 自动开启；本 App 均无需求，当前无触发面 | Bridge.java:569-577 | MainActivity 拿 bridge.getWebView() 后显式收紧 |
| AND-16 | P3 | Android 5–9 诊断实际写 getExternalFilesDir（非注释声称的 Download），旧系统可被持 READ_EXTERNAL_STORAGE 应用读取 | XinshiApp.java:29-30,127-131,186-195 | 与 AND-01 一并整改；修正注释；政策写清两种路径 |
| AND-17 | P3 | SaveFilePlugin 卫生项：legacy 分享缓存从不删除；ACTION_SEND 未设 ClipData（个别旧 ROM URI 授权存疑）；prune LIKE 前缀未转义（调用方固定，不可滥用）；displayName 查询失败回退仅展示层 | SaveFilePlugin.java:128-157,140-148,220-224,160-171 | 分享后清理缓存；补 ClipData；LIKE 转义 |
| AND-18 | P3 | singleTask+exported=true+默认 taskAffinity：StrandHogg 类任务劫持加固项（无 deep link，需本地恶意应用，可利用性存疑） | AndroidManifest.xml:19,21 | 评估 taskAffinity="" 或 singleTop（需回归返回/最近任务） |
| AND-19 | P3 | Android 16 预测式返回：targetSdk 36 默认走 OnBackInvokedDispatcher，androidx activity 1.8.0 桥接预计功能保留但无预测动画；D5 返回层级需真机回归 | variables.gradle:4-5; AppPlugin.java:47-62 | Android 16 真机验证各子页返回；如需动画迁移动态 enable 回调 |
| AND-20 | P3 | 构建/模板卫生合集：模板测试包名残留、google-services 死配置、Cordova config.xml 误导（不生效）、fresh clone 需先 cap sync、packageManager/engines 未钉死、version.ts 回退值易漂移、gradle jvmargs 偏小 | 多处（见附录） | 逐项清理；README 明示 fresh clone 流程；钉 packageManager |
| AND-21 | P3 | Android 5–9 其余导出仍把「分享面板已打开」当成功提示（未修复#6，'shared' 语义已正确传播，仅文案未改） | native.ts:4,33-35 | saveBlobFile 调用层统一 'shared' 提示 |

### 5.2 P1 详情（主代理已逐行复核）

**AND-01 崩溃诊断无条件写公共目录** —— `XinshiApp.crash()` 末尾无条件 `export()`（XinshiApp.java:112），`MainActivity.onRenderProcessGone` 同样无条件 `export()`（:72）；`BuildConfig.XINSHI_DIAG` 只 gate 住 onCreate/onPageLoaded 的例行导出（:59-61、:64-66）。**release 正式包任何 Java 崩溃/渲染进程消失都会写 `Download/Xinshi/xinshi-diag.txt`**（设备型号/Android 版本/WebView 版本/启动节点/完整堆栈）。政策全文无「崩溃/诊断/设备型号/堆栈」披露（grep 证实），第 1 节却宣称「不收集、不上传你的个人信息」。其他应用/文件管理器可读、卸载后残留 → 与政策声明不符的合规风险。方案：默认写 filesDir/cacheDir，仅用户主动「导出诊断」经 SaveFile 进公共目录；或政策第 2/3 节披露内容/位置/保留/删除方式并递增 PRIVACY_VERSION。

**AND-02 缺 dataExtractionRules** —— Manifest 仅 `allowBackup="false"` + `fullBackupContent="false"`（:6-7），无 `android:dataExtractionRules`（合并后 release 清单同样缺失）。adb backup 确已阻断；但 Android 12+ **部分 OEM 的 D2D 换机迁移忽略 allowBackup=false**，默认规则会拷走应用数据域（含 WebView localStorage/IndexedDB 即整个账本）。外部佐证：Mozilla Fenix/Focus Bugzilla 2073967（修复方式正是补 dataExtractionRules 排除全部域）。触发面为「部分设备」，未在本项目真机复现（已标注）。方案：增 `res/xml/data_extraction_rules.xml`，`<cloud-backup>` 与 `<device-transfer>` 均排除全部域，manifest 挂载；保留 allowBackup=false 兼容旧版。

**AND-03 可调试 release 无守卫** —— `-Pxinshi.debuggable`/`-Pxinshi.webviewDebug` 使 release `debuggable true`（build.gradle:60-62）且顺带关闭 R8/资源压缩（:58-59），签名照常挂（:55-57）→ 产物可安装可分发。debuggable 意味着 ①`run-as com.xinshi.app` 直接读整本账 ②CapConfig 默认取 FLAG_DEBUGGABLE → WebView CDP 自动开启（chrome://inspect 可检视/篡改存储）。E3 守卫（:80-91）只查 signing.properties 存在性；check:release 仅 NOTE。项目有直接分发 APK 渠道，不经 Play 的 debuggable 拦截。方案：taskGraph 守卫追加「release 产物任务 + debuggable 旗标 → GradleException」；check:release 对最近产物做 `aapt2 dump badging` 的 application-debuggable 断言。

**AND-04 政策页死链+占位邮箱** —— `public/privacy-policy.html:224-225`「在线版本」仍指 `https://pinbodhua.github.io/DSJiZhangApp/privacy-policy.html`（D 路 2026-11-17 实测 HTTP 404）；`:220` mailto 与 compliance.ts:20 默认值均为占位 `support@xinshi.app`；STORE-LISTING.md:23-24 仍把死链/占位邮箱列为商店填写值。E4 的代码侧缓解（默认相对路径+离线页随构建分发）已落地，但**政策 HTML 内部链接与邮箱未同步**，check 脚本也不查这两项。上架审核打开政策内链接→404、联系邮箱退信→被拒/整改。若仅直接分发 APK 不上架，降为 P2 文档缺陷。方案见总览表。

### 5.3 上轮 E 组修复核实与关键正面结论

| # | 结论 |
| --- | --- |
| E1 密钥卫生 | ✅ 落地：7 类忽略规则齐全；全历史对象扫描零密钥；check-ignore 实测命中（local.properties 由 android/.gitignore:27 覆盖）。残余格式缺口见 AND-14 |
| E2 FileProvider | ✅ 落地：file_paths.xml 仅 `<cache-path path="exports/"/>`，与 legacy 写入位置一致。检查脚本断言偏弱见 AND-05 |
| E3 签名守卫 | ✅ 落地（有缺口）：覆盖 5 个 release 产物任务；不拦 debuggable release（AND-03）、只查存在性 |
| E4 隐私 URL | ⚠️ 半落地：代码侧缓解真实（两份政策 diff 逐字节一致、离线页进 dist/APK）；上架侧未完成（AND-04） |
| E5 发布检查 | ✅ 存在可运行（弱）：8 结果可产出，但漏检使 PASS 含金量不足（AND-05） |

**正面核实精选（15 项，全文见附录 D 第二节）**：合并清单（release+debug）**确无 INTERNET**、无精确闹钟权限；targetSdk 36 满足 Play 2026-08-31 起 API 36 要求；版本全链一致（package.json 1.2.4 == gradle 1204/1.2.4 == 合并清单 == SW v30，public/sw.js == assets 副本，assets/public == 当日新构建 dist）；capacitor 配置零漂移；R8 keep 规则完整（v0.7.1 闪退修复在位）；SaveFile 文件名正则字节级核实有效（防穿越）、同名覆盖顺序（临时名→发布→删旧→改名回）与 'shared'/'saved' 语义落地；安全区脚本每页异常兜底在位；**正式 release/xinshi-v1.2.4.apk 内容最新、v1+v2 签名齐全、SHA-256 与发布说明登记逐字一致**（apk `e0388ac4…`、aab `beb71814…`）；构建产物 0 入库。

---

## 六、计薪 / 结算 / 统计 / 导出（B 路）

> 完整证据与 node 算术验证见 [附录 B](audit-r2/appendix-B-pay.md)。范围内 33 个 lib 文件 + 对应测试全文/关键段通读。**P1×2 已由主代理逐行复核属实（settlement.ts:188-193/352-354/388-402 原文核对）。**
> 路内原始统计：29 条 = P1×2 / P2×6 / P3×21。其中 PAY-03 与 D01 同源（并入 D01，P1）、PAY-07 吸收 D30（P2）、PAY-08 与 UI-06 同源（并入 UI-06）、PAY-15 吸收 D18；合并口径见第八节。

### 6.1 发现总览

| # | 严重度 | 问题 | 位置 | 解决方向 |
| --- | --- | --- | --- | --- |
| PAY-01 | **P1** | 固定月薪+周结/日结：周期级封顶=整月月薪/每期，周结一期触不到 cap，同月多期合计可超整月月薪最高 41%（30 天全记工：周结 4772.74 vs 月结 3500）；出勤 20 天时反向少发 318.18 | settlement.ts:188-195,352-354 | 非月结周期封顶改「rate×周期天数/当月天数」或按岗位×自然月跨周期累计封顶；至少修正首页文案并明确产品口径 |
| PAY-02 | **P1** | 未修复项#4 量化坐实：超休额度按周期占月比例折算，同月多周期重复扣——月休 5 天分三周休（2/2/1）：月结扣 0，周结扣 264.10；UI 显示整月额度掩盖折算 | settlement.ts:388-402; SettlementPage.tsx:640-641 | 跨结算单累计当月已扣超休天数，或非整月周期只提示不自动扣；UI 显示折算后周期额度 |
| PAY-03 | P2→并入 D01 | settleJob 绕过 pendingPersist（与 D01/UI-07 同一问题） | store.tsx:959-961 | 见 D01 |
| PAY-04 | P2 | 结算 CSV 奖金/扣款列未 round2：0.1+0.2 导出为 0.30000000000000004（Excel/复制文案均已舍入，唯 CSV 漏） | csv.ts:170-171,9-13 | cell() 对 number 统一 round2 或求和外包 round2 |
| PAY-05 | P2 | 固定月薪封顶口径三处分叉：26 天出勤时记录页月合计 3500、同页日历格合计 4136.34、统计页图表 134.62/天合计 3500（B4/B5 残留） | Records.tsx:111,133; MonthCalendar.tsx:78; settlement.ts:659-701 | 日历/选中日合计改用 dailySeries 分摊值或标注「逐日折算参考」，与统计页同源 |
| PAY-06 | P2 | Excel「未结（预估）」行按整月估且借支/超休恒 0（App 待结 218.18 vs Excel 预估 3500/借支 0）；明细表同日多段重复计基础工资且无「参考」标注（CSV 有） | excel.ts:127-161,71-96 | 预估行复用 summarizeUnsettledJob 逐期汇总；明细表头加折算参考标注 |
| PAY-07 | P2 | 净额≤0 结算单永远无法「已发」：net=0 登记 0 元 toast「全部收清」但落库 unpaid；net<0 连 0 都被「不能超过应发金额」误拦（C6 残留，吸收 D30） | PaymentSheet.tsx:47-49,65; store.tsx:980-982 | net≤0 禁用收款入口并说明「无需收款/倒欠」，或特殊状态使 toast 与落库同源 |
| PAY-08 | P2→并入 UI-06 | 隐藏金额不覆盖 QR 载荷/复制摘要（与 UI-06 同一问题） | ShareQrSheet.tsx:20,43,56 | 见 UI-06 |
| PAY-09 | P3 | 超休天数先 round2 再乘日薪放大扣款（0.0667→0.07 天，扣 11.14 而非 10.61，方向恒多扣）；跨月周额度按 period.start 所在月折算 | settlement.ts:394-402,390-393 | 先乘后舍入；跨月周期按休息日所属月分段计额度 |
| PAY-10 | P3 | dailyBaseEntryIds 用 >= 比较 createdAt：批量生成/导入同时间戳同日多段仍依赖入参顺序，B4「顺序无关」在并列时不成立 | settlement.ts:54-62; recurring.ts:116 | 并列时以 id 字典序兜底保证全序 |
| PAY-11 | P3 | 周期规则边界：日薪/月薪 hours=0 生成全额工记；rate≤0 跳过后游标仍前进致永久漏补；startDate 提前不回补无提示 | recurring.ts:71-74,162-175 | hours=0 警告/按休息处理；rate≤0 跳过不推进游标 |
| PAY-12 | P3 | 孤儿工记按整月口径计未结（与 B1 逐期折算不一致）；借支-only 岗位永远无法结算抵扣（draft.entries 空被拒） | settlement.ts:243-246,602,484-491 | 孤儿按岗位周期折算；允许借支-only「抵扣结算单」或引导删除 |
| PAY-13 | P3 | round2 负值向 +∞ 舍入（有意设计但镜像场景差 1 分）；formatMoney 用 toFixed 而非 round2（当前调用点均已舍入，潜在分叉） | money.ts:2-10,12-26 | formatMoney 内部先 round2；文档明示负值策略 |
| PAY-14 | P3 | hoursBetween 起止相同返回 0（时薪已被编辑器拦截）；日薪/月薪 0 工时工记可保存并计全日薪/出勤日 | date.ts:199-208; EntryEditor.tsx:396-419 | 0 工时保存提示「将按 1 个出勤日计薪」 |
| PAY-15 | P3 | 结算校验码仅覆盖 id/岗位/周期/net/createdAt：改分项不改 net 校验码不变；32 位 FNV 可重算（吸收 D18，注释已声明非签名） | checksum.ts:8-25 | canonical 纳入全部分项+收款字段；文案明示「仅核对单号与净额」；升级 sha256 短码 |
| PAY-16 | P3 | 发薪通知 baseId 哈希 mod 1e6 可碰撞互覆（10 岗位约 0.005%）；仅排 3 次无续排；nextPayday 日期边界零测试 | paydayNotifications.ts:7-15,38-47 | 更大模数/登记簿映射；补日期边界测试 |
| PAY-17 | P3 | ICS 未按 75 octet 折行（严格 RFC5545 不合规）；预算 toast 单键在存储不可用时可能刷屏；nativeReminders schedule→cancel 非原子 | reminder.ts:93-115; budget.ts:76-90; nativeReminders.ts:150-187 | ICS 折行；预算键按档位集合+节流；同步加锁 |
| PAY-18 | P3 | Excel 旧结算单休息 fallback 把半天计整天；CSV「奖金」含额外奖金而 Excel 不含（跨格式对账易错）；结算 CSV 缺单号/校验码列 | excel.ts:180-185,230,234; csv.ts:170,134-157 | fallback 按休息记录求和；统一列语义；CSV 增单号列 |
| PAY-19 | P3 | findSettlementOverlap 注释「首尾相接算不重叠」与实现（<= 判重叠）矛盾；标准周期无影响，仅导入任意区间单可能被误拦 | guards.ts:33-45 | 改 < 或修正注释 |
| PAY-20 | P3 | SettlementPage.monthlyTermsVary 未按日去重、以数组首条为基准：同日多段调价时「整月/折算」标签与实际金额口径分叉（仅标签错） | SettlementPage.tsx:95-121 | 复用 lib 的 sameTerms 判定 |
| PAY-21 | P3 | 「固定月薪按整月发放/封顶」文案对周结/日结岗位失真（PAY-01 的文案面） | Home.tsx:693; Stats.tsx:373 | 文案按岗位 cycle 分支 |
| PAY-22 | P3 | holiday 标记仅在加班开启时保存（关闭加班岗位节假日搜索漏检）；手动工时模式保留旧起止钟点但 breakMinutes 清零 | EntryEditor.tsx:247,239-241 | holiday 无条件保存；手动模式清空钟点或保留 breakMinutes |
| PAY-23 | P3 | xlsx xmlEscape 未剥离 \uFFFE/\uFFFF 非法字符（异常导入备注可产出打不开的 xlsx）；\r 规范化换行形态改变 | xlsx.ts:52-60 | 剥离非字符位；\r 统一转 \n |
| PAY-24 | P3 | 工资条隐藏分项后可见行加总≠净额且无「其他」行；字体加载失败只报通用错误；明细找不到工记静默少行 | payslip.ts:107-146; payslipOptions.ts:39-58; PayslipSheet.tsx:179-180; payslipDetail.ts:22-33 | 补「其他（含借支/超休）」汇总行；透出字体错误原因 |
| PAY-25 | P3 | 批量模板超 8 个静默丢弃最旧（测试钉为预期，属设计选择）；导入不校验 app:'xinshi' 字段 | batchTemplates.ts:88-94,142-157,114-140 | 满额提示替换/拒绝；校验 app 字段 |
| PAY-26 | P3 | 测试债务：timer.test 未断言 C8 的 hours 字段；budget.test 未钉 B8 整月口径；#4 折算仅弱断言 toBeGreaterThan(0)（PAY-02 因此漏网）；csv.test 缺 Tab/前导引号用例、表头列数弱断言；payday 日期边界零覆盖；recurring 性能断言易 flaky。**未发现日历时间炸弹**（与 D28 的 storage.test 不同） | timer.test.ts:17-25; pay.test.ts:738-739; csv.test.ts:101 等 | 补钉住用例；弱断言改精确值 |
| PAY-27 | P3 | search 用 settlementId 判「已结算」与 Excel 用 entryIds 判孤儿不一致；restDayAmount(days=0)→1 天；totalRestDays 注释 0.5 步进实为 0.1 | search.ts:84; excel.ts:39-42; rest.ts:4-12 | 统一 entryIds 集合判定；days≤0 返回 0/拒绝 |
| PAY-28 | P3 | 撤销结算静默丢弃收款登记（有快照可恢复但确认框未警告）；budget 函数自身不做月界过滤（当前调用方均正确，契约脆弱） | store.tsx:1003-1017; SettlementPage.tsx:1236-1238; budget.ts:24-33 | 确认框列出将丢失的收款登记；budget 内部按月过滤 |
| PAY-29 | P3 | 统计周档「按岗位/按类型」明细不封顶：expectedDays≤6 时明细之和>头部合计（3500/expectedDays=4、7 天工记：头部 3500 vs 明细 6125） | Stats.tsx:101,109 vs :79 | 周档明细同参 sumEntriesCapped(group, period) |

### 6.2 P1 详情（主代理已逐行复核）

**PAY-01 月薪×非月结周期封顶过松** —— `sumEntriesCapped` 中 `cap = sameTerms ? rate : max(各段 rate)`、`paidBase = fullFixedMonth ? rate : Math.min(rawBase, cap)`（settlement.ts:188-193），而 `fullFixedMonth` 需要 `wholeCalendarMonth`，仅 `job.cycle === 'monthly'` 时传入（:352-354）。周结一期最多 7 天，rawBase = 7×rate/22 ≈ 0.32×rate **永远触不到 cap=整月月薪**，同一自然月拆成 4–6 期后封顶完全失效。node 验证数字：月薪 3500/expectedDays 22、2026-11（30 天）每天记工——周结逐期 2×159.09 + 4×1113.64 = **4772.74**，月结同批工记 = **3500**（+36.4%，理论上限 31/22≈1.409 倍）；出勤 20 天时周结 3181.82 vs 月结 3500（−318.18）。首页「固定月薪实际按整月发放」（Home.tsx:693）对该人群为假。
**触发人群（已核实）**：当前 UI 自 v0.2 起强制月薪岗位月结（JobEditor.tsx:233-240,331、Onboarding.tsx:30、seed.ts:107），但 `storage.ts:342` 导入 normalizeJob **保留任意 cycle**（默认 weekly），settlement.ts:388 注释亦明示「导入的固定月薪工作可能出现」非整月周期。缺陷数据人群 = 导入备份/手改 localStorage/旧版遗留的「月薪×周结/日结」岗位；上轮 B1 按 P1 修复同一人群，本轮维持 P1。现有回归只钉了「2 天=318.18」折算方向，未覆盖多期合计超整月。

**PAY-02 超休额度比例折算致同月重复扣（未修复项#4）** —— `restQuota = restDaysPerMonth × periodDayCount / daysInMonth(period.start)`（settlement.ts:390-393），每个短周期各拿一份折算额度独立判超休（:394-397）。node 验证：月薪 3500/22、周结、月休额度 5、overRestDeduct 开，2026-11 休息 5 天分三周（2/2/1）——月结口径超休 0 扣 **0**；周结每周额度 5×7/30=1.1667，前两周各超休 round2(0.8333)=0.83 天、各扣 round2(0.83×159.0909)=**132.05**，合计 **264.10**（≈1.66 天工资）。UI 显示「本月休息 2 天 · 额度 5 天 · 超休 0.83 天」（SettlementPage.tsx:640-641）——2<5 却超休，用户无法理解。跨月周额度按 period.start 所在月折算，休息日却横跨两月。pay.test.ts:709-740 以弱断言把折算钉成预期，未量化重复扣。代码注释（:388-389）表明折算是为避免「每短周期重置整月额度系统性少扣」的有意设计——**属口径决策项，本轮量化坐实其反向危害**，需产品决策（跨周期累计已扣天数 / 非整月周期只提示不自动扣）。

### 6.3 关键 P2 补充（主代理已复核）

- **PAY-04**：csv.ts:170-171 直接传 `settlement.bonus + settlement.extraBonus`，cell() 对 number 仅 String()（:9-13）——两个已舍入数相加的二进制尾数（0.1+0.2=0.30000000000000004）原样进 CSV。公式注入主路径防护经核查**有效**（= + - @、Tab/CR 前导、引号/逗号/换行；「前导双引号绕过」推演排除）。
- **PAY-07**：PaymentSheet.tsx:47 `paidValue > settlement.net` 在 net<0 时对 0 也恒真 → 永远误拦；:65 toast 按原始 net 判「收清」而 store.tsx:980-982 钳成 unpaid → 提示与落库矛盾。与 D30 合并为一条 P2。
- **PAY-05/06**：月薪「封顶/折算」在记录页头部（整月封顶）、记录页日历（逐日不封顶）、统计页（封顶后分摊）三处口径分叉；Excel 预估行与 App 结算口径脱节。数字示例见总览表，均经算术验证。

### 6.4 上轮 B 组修复核实（9/9 已落地）

| # | 结论 | 残留 |
| --- | --- | --- |
| B1 逐期折算 | ✅ 落地（summarizeUnsettledJob + monthlyFullMonth + 回归钉住 318.18） | PAY-01/05/06 口径分叉 |
| B2 预览含超休 | ✅ 落地（预览 draft 传 restDays+overRestDeduct，测试钉住 477.27） | — |
| B3 预览=提交 | ✅ 落地（全量 entries+advances 重建 draft，测试钉住含借支/超休） | — |
| B4 同日去重同源 | ✅ 落地（dailyBaseEntryIds 四处复用，双顺序测试钉住 320） | PAY-05（封顶口径）/PAY-10（时间戳并列） |
| B5 图表和==合计 | ✅ 落地（Stats 周/月统一 sumEntriesCapped，精确回归） | PAY-29（周档明细 expectedDays≤6） |
| B6 明细免责声明 | ✅ 落地（payslipText.ts:206-212） | — |
| B7 超休 placeholder | ✅ 落地（直接取 draft.overRestDeduction） | — |
| B8 预算文案 | ✅ 落地（仅文案，符合原声明；计算口径未改且无测试钉住） | PAY-26/UI-34 |
| B9 单遍+缓存 | ✅ 落地（analyzeUnsettled WeakMap，Home 统一 overview.outstanding） | UI-08（其余派生计算仍裸算） |

**正面核实精选**：daysUntilPayday 31→2 月回落/跨年正确；addMonths 月末钳制正确；commitSettlement 原子性+重叠守卫+重复提交拒绝有测试；undoSettlement 正确清双向引用；C5 按 periodEnd 归属月三处一致；CSV 公式注入防护有效；XLSX inlineStr 无公式注入面、CRC/压缩回退有测试；yearStats/categoryStats 图表和==合计成立；热力图金额未暴露。


---

## 七、前端 UI / 状态 / PWA（C 路）

> 完整证据见 [附录 C](audit-r2/appendix-C-ui.md)。17 页 + 32 组件 + 5 hooks 全文通读，styles.css（12291 行）定向抽查。**UI-02/UI-03/UI-11 已由主代理复核属实；UI-01 与 D03 同源（P1）。**
> 路内原始统计：42 条 = P1×1 / P2×12 / P3×29。其中 UI-01=D03、UI-07=D01（P1）、UI-06 吸收 PAY-08、UI-18=D35、UI-22=AND-21（未修复#6）、UI-32=D07（复核后降 P3，见 §8.3）；合并口径见第八节。

### 7.1 发现总览

| # | 严重度 | 问题 | 位置 | 解决方向 |
| --- | --- | --- | --- | --- |
| UI-01 | **P1**（=D03） | MoveSheet 搬家包导出 'shared' 假成功 + markBackedUp 误重置备份提醒 | MoveSheet.tsx:109-116 | 见 D03 |
| UI-02 | P2 | 撤销结算等待快照期间无取消守卫：返回离开后撤销照样执行，卸载后 onBack() 劫持导航把用户拽回结算 Tab | SettlementPage.tsx:932-961; App.tsx:433-436 | mountedRef/AbortController；undoBusy 期间禁用 SubPage onBack 与原生返回回调 |
| UI-03 | P2 | 导入/恢复快照后自动周期补记当天不重跑：autoRecurringDay 守卫使 ledgerSeq 依赖形同虚设，注释与实现矛盾 | App.tsx:191-201 | ledgerSeq 变化时重置 ref，或守卫改 `${ledgerSeq}:${today}` 组合键 |
| UI-04 | P2 | C4 残留：首页岗位卡/工作管理「已结清」徽章未纳入已结算待收，与 hero 同屏矛盾 | Home.tsx:738-750; Jobs.tsx:55-61 | 按 job 汇总 remainingAmountOf 并入判定，与 hero 同口径 |
| UI-05 | P2 | D1 残留：首页岗位卡单价 rateLabel 明文（月薪即整月工资），违反开关「首页不显示具体数字」承诺；计时弹层同；详情页却已打码 | Home.tsx:734-737; TimerSheet.tsx:32 vs EntryDetail.tsx:350 | 单价改 Money/整行打码；明确「单价是否属隐藏范围」产品口径并同步文案 |
| UI-06 | P2 | D1 残留：工资条预览图/分享文案、QR 载荷与复制摘要均含明文金额，不随隐藏金额（吸收 PAY-08）——旁人扫码即绕过 | PayslipSheet.tsx:144-146,204; shareQr.ts:15-19; ShareQrSheet.tsx:20,43,56; SettlementPage.tsx:927-930 | 隐藏模式下弹层顶部醒目提示「导出内容仍含明文」或预览打码/临时显示开关；复制/分享与开关一致 |
| UI-07 | P2→并入 D01 | settleJob 绕过 commit()（与 D01/PAY-03 同一问题） | store.tsx:937-965 | 见 D01 |
| UI-08 | P2 | store value 无 memo/无 selector：每次 toast 全应用重渲染（每操作至少 2 轮）；Home/Records/Profile 派生计算裸算 | store.tsx:1092-1131; Home.tsx:96-241; Records.tsx:82-144; Profile.tsx:118 | value useMemo；拆 state/toast 双 context 或 useSyncExternalStore+selector；页面派生 useMemo；EntryRow memo |
| UI-09 | P2 | 千条级列表无虚拟化/分页：记录页整月全量渲染、搜索命中全量渲染，叠加 UI-08 成本成倍 | Records.tsx:463-506; Search.tsx:185-219; EntryRow.tsx:32-33 | 长列表虚拟化或分段折叠+分页；搜索上限+查看更多 |
| UI-10 | P2 | 录入奖金/扣款无上限 vs 导入钳制 1e6：导出→导入往返静默改数（2,000,000→1,000,000 无提示）；JobEditor/Recurring/额外奖扣同类口径差 | EntryEditor.tsx:451-452,1019-1043 vs storage.ts:379-383 | 录入与导入同一上限（提交校验），或钳制时明确差异提示 |
| UI-11 | P2 | SW 预缓存仅 HTML/图标、无 JS/CSS chunk：新装 PWA 离线访问未走过的懒加载路由 → vite:preloadError 刷新无效 → 根错误屏（离线是核心卖点） | sw.js:4-11; App.tsx:25-66; main.tsx:21-40 | 构建期生成预缓存清单（workbox injectManifest）纳入全部路由 chunk；或离线 import 失败页内降级 |
| UI-12 | P2 | 「复制到今天」沿用旧单价快照：调价后复制按旧价计薪且无提示（新工记正常路径取当前 rule） | EntryDetail.tsx:126-140 vs EntryEditor.tsx:204-205 | 复制改用岗位当前 rule，或明示「按记录时单价 ¥X 复制」 |
| UI-13 | P2 | --muted-2 功能小字对比度明/暗双主题均低于 WCAG AA（浅色≈2.4:1、暗色≈3.7:1，要求 4.5:1），用于上班/下班标签、已结算标记、回收站剩余天数等 30 处 | styles.css:14,7848 及使用点 | 调深（浅≈#77817a、暗≈#8a968c 起步）或功能标签改 --muted/--ink-soft |
| UI-14 | P3 | 导入/清空等待快照期间第二次确认静默 no-op、无进度指示（MoveSheet 处理更好可参照） | Profile.tsx:277-278,302-303 | busy 提示/禁用态文案 |
| UI-15 | P3 | 周期规则编辑器拒绝归档岗位规则保存，与 store allowArchivedJob 口径冲突；归档岗位无法经编辑器关 auto | Recurring.tsx:231,257 vs store.tsx:700-703 | 编辑器对「规则原岗位且已归档」放行 |
| UI-16 | P3 | Toast 动作连点串触发：第一条关闭后下一条立即上屏，~150ms 内第二次点击误触发下一条动作 | Toast.tsx:26-41; store.tsx:215-226 | 动作点击后局部 disable/一次性 ref；队列推进延迟一帧 |
| UI-17 | P3 | ConfirmDialog 滚动锁 effect 依赖 onCancel（内联函数）：父级每次渲染解锁/重锁 churn | ConfirmDialog.tsx:39-53 | onCancel 存 ref，deps 改 [open] |
| UI-18 | P3（=D35） | useAutoSnapshot 每日快照 1600ms setTimeout 未跟踪/清理 | useAutoSnapshot.ts:59-66 | timer 入 ref + cleanup |
| UI-19 | P3 | ErrorBoundary 仅根级：任何子页渲染异常/懒加载失败整应用落错误屏 | main.tsx:8-14; App.tsx:448,459,463 | renderPage/renderTab 外包页级 ErrorBoundary（fallback 带返回） |
| UI-20 | P3 | 快照页「最多保留 N 个」把当前数量当上限展示（12 张时显示「最多保留 12 个」，实际 30） | Snapshots.tsx:169-170 | 固定展示真实上限 |
| UI-21 | P3 | 体检「一键解锁」快照失败被静默吞掉，注释声称 Toast 会说明但实际没有 | Health.tsx:56-72 | 失败 toast 追加「未留快照」警示或中止修复 |
| UI-22 | P3（=AND-21） | 未修复#6 逐处清单：考勤 CSV/完整工记 CSV/结算 CSV/Excel/工资流水/QR/工资条图/PDF×2/照片/模板共 9+ 处仍把分享面板当成功 | Attendance.tsx:150-154; DataSafety.tsx:149-150,166-171,182-187; Settlements.tsx:72; ShareQrSheet.tsx:30-34; PayslipSheet.tsx:126-130,159,174-178; EntryDetail.tsx:157-159; BatchPlanSheet.tsx:284-288 | 统一封装 result→文案映射，'shared' 一律「请确认保存」 |
| UI-23 | P3 | 多处选择态按钮缺 aria-pressed（工时模式/岗位选择/休息 chips/收款方式/筛选等 9 组） | EntryEditor.tsx:689-704 等 | 统一补 aria-pressed 或 role=tablist |
| UI-24 | P3 | visually-hidden 文件输入仍在 Tab 顺序（键盘用户 Enter 意外弹文件选择器） | styles.css:657-665; Profile.tsx:852-858; MoveSheet.tsx:538-544; BatchPlanSheet.tsx:511-517 | 加 tabIndex={-1} |
| UI-25 | P3 | 隐私政策子视图打开后焦点丢失到 body | PrivacyGate.tsx:34-66 | 打开后 focus 返回按钮/h1 |
| UI-26 | P3 | D5 残留：结算单页 Android 返回（留首页）与页内返回（切结算 Tab）不一致 | App.tsx:155 vs 433-436 | backRef 对 settlementRecord 复用 onBack 逻辑 |
| UI-27 | P3 | 计时≥24h 提示重复弹两次（Home 与 EntryEditor 文案相同各一次） | Home.tsx:284-294; EntryEditor.tsx:197-201 | 只保留编辑器侧 |
| UI-28 | P3 | 考勤照片水印选图时固化，之后改工时/日期/岗位不更新（削弱考勤证据可信度） | EntryEditor.tsx:283-290 | 保存时按最终值重打水印或提示重选 |
| UI-29 | P3 | JobEditor 数字字段 max 属性不拦截提交：可存 standardHours=30、OT 倍率=100、expectedDays=100、rate=1e9 | JobEditor.tsx:272-306 vs 905,930,978-1008 | save() 按 UI 同口径钳制/报错 |
| UI-30 | P3 | DataSafety 每次 state 变化（含 toast）重跑全账本体检+IDB 快照列表；listSnapshots 无序号守卫可旧覆盖新 | DataSafety.tsx:67-80 | deps 收窄/手动刷新；加 seq |
| UI-31 | P3 | Stats heatmap/budget 未 memo（同页其它均已 memo） | Stats.tsx:121-127 | 补 useMemo |
| UI-32 | P3（=D07） | restoreTrashItem job 分支绕过过期拦截（UI 已挡，纵深防御缺口；复核裁定见 §8.3） | store.tsx:794-807; TrashSheet.tsx:199,237 | job 分支同走 trashRestoreBlockReason |
| UI-33 | P3 | 当日 24h 合计校验裸浮点比较无容差（8.1+15.9 可能误拒；同文件 OT 校验已用 1e-9）【存疑：需构造组合单测验证】 | EntryEditor.tsx:390; EntryDetail.tsx:120; Home.tsx:213 | 统一 1e-9 容差或先 round2 |
| UI-34 | P3 | 预算弹层文案缺「固定月薪按整月估算」（B8 残留，Home/Stats 已补） | Profile.tsx:876 | 同步补一句 |
| UI-35 | P3 | 考勤页初始岗位被彻底删除时显示「还没有工作」误导空态（C10 只覆盖归档） | Attendance.tsx:66-69,167-182 | 区分「岗位已删除」空态 |
| UI-36 | P3 | 非月薪周期空草稿页无补记入口，只有一句「先补记一笔再结算」 | SettlementPage.tsx:367-373,846-860 | 页脚加「补记一笔」按钮 |
| UI-37 | P3 | vite:preloadError 兜底：sessionStorage 不可用时每次错误都整页刷新，无节流 | main.tsx:30-40 | 内存变量兜底节流 |
| UI-38 | P3 | SW activate 删除同源下所有非 xinshi-* 缓存（共享 origin 如 GitHub Pages 项目页会误清他应用缓存） | sw.js:27-31 | 删除范围限定 xinshi-v* 且不在 keep 的键 |
| UI-39 | P3 | 主题不跨标签页同步；内联脚本存储不可用时回退浅色（即使系统暗色，首屏闪烁） | useTheme.ts:20-33; index.html:7-24 | 监听 THEME_KEY storage 事件；catch 分支 matchMedia 回退 |
| UI-40 | P3 | manifest 缺 id 字段（未来改 start_url 被当新应用）；maskable 复用 any 图标未验证安全区 | manifest.webmanifest:1-38 | 加 "id":"/"；maskable 专版带内边距 |
| UI-41 | P3 | 多处触控目标 <44px：回收站恢复/彻底删除 30×30 且相邻（危险操作）、toast-close 40、hero-eye 40、考勤格 42 | styles.css:428-433,11633-11636,10471-10473,3199-3202 | --small ≥36+间距，关键操作 44 |
| UI-42 | P3 | TrashSheet/常挂弹层关闭态仍随 state 重算派生数据（buildTrashRows 等） | TrashSheet.tsx:45-62; Home.tsx:786-814 | open=false 短路或条件挂载 |

### 7.2 关键 P2 详情（主代理已复核）

**UI-02 撤销结算取消竞态** —— `handleUndo`（SettlementPage.tsx:932-961）的 `undoingRef` 只防连点；`await saveSnapshot`（大账本压缩+IDB 写入可达数百毫秒以上）期间 SubPage 返回与 Android 返回键均未被 undoBusy 禁用。组件卸载后 await 恢复 → `undoSettlement` 仍执行 → `onBack()`（App.tsx:433-436 `setPage(null); setTab('settlements')`）把已打开另一张结算单/别的子页的用户强行拽回结算 Tab。上轮「快照失败即中止、连点守卫」已落地，「等待期间取消」窗口仍在。

**UI-03 自动补记守卫失效** —— App.tsx:191-201 effect deps 含 ledgerSeq，注释声称「导入/恢复快照/清空…必须像首次打开一样重跑」，但 `if (autoRecurringDay.current === today) return;` 的 ref 没有任何地方在 ledgerSeq 变化时重置 → 当天已跑过自动补记后导入带 auto 规则的备份，当天不再为新规则补记，要等第二天。

**UI-11 PWA 离线断裂** —— sw.js CORE 仅 '/'、'/index.html'、manifest、favicon、icons（主代理已核原文），14 个懒加载路由 chunk 全靠运行时访问缓存。新装 PWA 立即断网 → 切「统计/我的」→ import 失败 → preloadError 刷新一次仍离线 → 根级 ErrorBoundary 整应用错误屏。与 UI-19（无页级边界）叠加。

### 7.3 上轮 C/D 组修复核实

- **C 组（C1–C11）：10 项已落地，1 项部分落地**。C1 提前结算警示（含「尚未开始」分支）/C2 周期变更阻断/C3 归档补记空态/C5 跨月归属/C6 净额≤0 二次确认/C7 加班校验/C8 计时 24h/C9 切计薪清单价/C10 考勤归档空态/C11 复制休息提示均有代码证据；**C4 部分**——Settlements 与首页 hero 已修，岗位卡徽章残留（UI-04）。
- **D 组（D1–D5）：3 项已落地（D2 焦点陷阱/D3 Toast 队列/D4 可访问名），2 项部分落地**。**D1**：BarChart/MonthCalendar/MoveSheet 预览/Snapshots 合计/预算已接入隐私，残留首页单价（UI-05）、计时弹层、QR 载荷/复制、工资条预览（UI-06）；**D5**：子页层级与隐私政策返回已修，结算单页两路返回不一致（UI-26）。

### 7.4 已排除的疑点（14 条，防误报记录）

sw.js:28 与 shareQr.ts:24 的「双反斜杠」经**十六进制复核为查看工具显示转义**，代码正确（主代理独立 hex 复核结论一致）；文件名注入被 SaveFilePlugin.java:42 净化拦截（路径穿越不成立）；toast pointer-events 可点；嵌套 Esc 只关最上层（capture+stopImmediatePropagation）；key=index 仅静态星期表头；无 IntersectionObserver/ResizeObserver 使用；2.4MB 字体为文字 PDF 按需 fetch 非死资产；scrollLock 引用计数对称；z-index 层级与焦点/返回一致；prefers-reduced-motion 全局降级；**XSS 面为零**（无 dangerouslySetInnerHTML/innerHTML/javascript: URL，img 均 dataUrl/blobUrl）；定时器/监听器泄漏 sweep 仅 UI-18 一处例外；types.ts 无 any/危险断言、可空字段消费侧均有守卫。


---

## 八、上轮审计修复核实汇总与未修复项现状

### 8.1 合并统计与跨路去重

四路原始发现共 **128 条**（A 36 / B 29 / C 42 / D 21）。三路独立审计在交叉地带重复命中同一问题（这本身是证据强度的佐证），主代理复核后合并为 **119 条独立问题**：

| 严重度 | 数量 | 说明 |
| --- | --- | --- |
| **P0** | **0** | 未发现「立即数据丢失/安全漏洞/发布阻断」级问题 |
| **P1** | **9** | D01、D02、D03、PAY-01、PAY-02、AND-01、AND-02、AND-03、AND-04 |
| **P2** | **29** | 含合并后的 PAY-07（吸收 D30）、UI-06（吸收 PAY-08） |
| **P3** | **81** | 含复核降级的 D07（原 P2，见 §8.3） |

去重映射（8 组，共消除 9 条重复）：

| 独立问题 | 保留编号（定级） | 被合并编号 | 备注 |
| --- | --- | --- | --- |
| settleJob 绕过持久化守卫 | **D01（P1）** | UI-07（P2）、PAY-03（P2） | 三路独立命中；定级从 P1（丢失对象=结算单，静默无报错），触发面限多标签页 |
| MoveSheet 'shared' 假成功 | **D03（P1）** | UI-01（P1） | 同位置同证据 |
| net≤0 无法登记收款 | **PAY-07（P2）** | D30（P3） | PAY-07 更完整（误拦 + toast 与落库矛盾） |
| 隐藏金额导出面明文 | **UI-06（P2）** | PAY-08（P2） | UI-06 覆盖更广（工资条预览/分享文案/QR/复制） |
| 快照定时器未清理 | **D35（P3）** | UI-18（P3） | D35 另含 auto-idle 失败静默 |
| 分享面板成功文案（未修复#6） | **UI-22（P3）** | AND-21（P3） | UI-22 给出 9+ 处逐处清单 |
| 结算校验码覆盖面 | **PAY-15（P3）** | D18（P3） | PAY-15 覆盖全部分项 |
| 过期 job 恢复绕过 | **D07（P3，降级）** | UI-32（P3） | 主代理裁定，见 §8.3 |

### 8.2 上轮审计（AUDIT-v1.2.4.md）41 项修复声称核实总表

| 组 | 声称 | 完整落地 | 部分落地 | 未落地 |
| --- | --- | --- | --- | --- |
| A 数据安全（A1–A11） | 11 | 6（A2/A4/A6/A7/A8/A10） | 5（A1→D01/D02/D32；A3→D05/D06；A5→D03；A9→D15；A11→D07） | 0 |
| B 计薪口径（B1–B9） | 9 | 9（B1–B9 全部有代码+回归证据） | 0（但残留新分叉 PAY-01/05/06/10/29 另计） | 0 |
| C 页面业务流（C1–C11） | 11 | 10 | 1（C4→UI-04 岗位卡徽章） | 0 |
| D 隐私可访问性（D1–D5） | 5 | 3（D2/D3/D4） | 2（D1→UI-05/06；D5→UI-26） | 0 |
| E 平台发布（E1–E5） | 5 | 4（E1/E2/E3/E5，E3/E5 有缺口另计 AND-03/05） | 1（E4 代码侧落地、上架侧未完成→AND-04） | 0 |
| **合计** | **41** | **32** | **9** | **0** |

**结论**：上轮修复可信度高（无一项虚报），但残留缺口呈同一模式——**「同类路径未扫全」**：A5 守卫漏了 MoveSheet、A11 拦截漏了 job 分支、D1 打码漏了导出面、C4 待收口径漏了岗位卡、A3 钳制漏了规则层。建议后续修复按「调用点全量清单」验收而非按单点修复。

### 8.3 主代理复核裁定记录

1. **D07 降级 P2→P3**：audit-data 原称「TrashSheet.tsx:101-108 无 UI 兜底」。主代理核读 TrashSheet.tsx:199（每行渲染时计算 `trashRestoreBlockReason(row, state)`，job 行同样经过过期检查）与 :237（恢复按钮 `disabled={Boolean(blockReason)}`）——**UI 在正常路径已拦截过期 job**，audit-ui 的 UI-32 判断正确。残留缺口=弹层常开跨过 30 天过期时刻且期间无任何重渲染（任何 toast/state 变化都会重渲染并禁用按钮）时，store job 分支（store.tsx:794-807）无二次拦截。触发窗口极窄，定 P3 纵深防御缺口；store 侧修复建议不变。
2. **D01 定级保留 P1**：UI/PAY 路定 P2、数据路定 P1。保留 P1 理由：丢失对象为结算单（金额记录+工记锁定引用），静默无报错且随后「已同步」toast 掩盖；但明确触发面限 PWA/桌面多标签页，Android WebView 单窗口主场景不受影响。
3. **PAY-01/02 触发人群限定**：当前 UI 自 v0.2 起强制月薪岗位月结（JobEditor.tsx:233-240,331、Onboarding.tsx:30、seed.ts:107，git log -S 核实），缺陷数据人群=导入备份/手改 localStorage/旧版遗留的「月薪×周结/日结」岗位（storage.ts:342 导入不归一 cycle）。lib 与测试均按支持该形态处理，上轮 B1 亦按 P1 修复同一人群，故维持 P1 并标注人群范围。**产品决策点**：若决定不支持该形态，可在导入侧归一/拒绝+体检提示，改造量从 L 降为 M。
4. **「双反斜杠」疑点排除**：sw.js:28 正则与 shareQr.ts:24 换行符在文本查看工具中显示为双反斜杠，主代理与 audit-ui **各自独立用十六进制视图复核原始字节为单反斜杠**，代码正确，不构成发现（工具显示转义现象，后续审计者注意）。
5. **PAY-02 属上轮明示未修复的口径决策项**：代码注释（settlement.ts:388-389）表明比例折算是为避免「短周期重置整月额度系统性少扣」的有意设计；本轮量化坐实其反向危害（休息分散时重复扣，应扣 0 实扣 264.10），维持 P1 待产品决策，非回归。

### 8.4 上轮 8 项「未修复项」现状（全部仍在）

| # | 项 | 本轮现状与证据 |
| --- | --- | --- |
| 1 | 隐私政策公开地址与支持邮箱 | **仍未解决**（AND-04）：政策 HTML 内「在线版本」2026-11-17 实测 404；support@xinshi.app 仍占位；STORE-LISTING.md 仍指死链；check 脚本不查邮箱/政策内链接。代码侧离线缓解已落地 |
| 2 | CSP 未加 | **仍未解决**（AND-07）：内联主题脚本依旧；风险面核实为小（src 150 文件 0 innerHTML/eval/dangerouslySetInnerHTML）；建议构建期 sha256 hash 注入 meta CSP |
| 3 | 崩溃诊断写公共 Download | **仍未解决**（AND-01/16）：crash()/onRenderProcessGone 无条件 export，release 同样写；政策未披露；<Q 分支实际写 getExternalFilesDir（口径差异已查明） |
| 4 | 非整月周期超休重复扣 | **仍未解决且量化坐实**（PAY-02）：月休 5 天分三周休 → 周结扣 264.10 vs 月结扣 0；pay.test.ts:709-740 弱断言把折算钉成预期；UI 显示整月额度掩盖折算 |
| 5 | 导入允许结算周期内未锁定工记 | **仍未解决，且修正上轮描述**（D11）：health 并无对应规则，「账本体检会提示」不准确；该工记计入未结但永远无法结算；另 search/excel 判定口径不一（PAY-27） |
| 6 | Android 5–9 其余导出提示 | **仍未解决**（UI-22/AND-21）：9+ 处逐处清单已列；其中 MoveSheet 一处因重置备份提醒升级为 P1（D03） |
| 7 | e2e 脚本漂移 | **仍未解决且量化**（AND-06）：28 脚本全部止于 2026-11-07（git log），无 v1.2.2–v1.2.4 修复覆盖；硬编码 4173/Edge x86 路径/同意版本'2026-11-05'（时间炸弹）；无一启动 preview |
| 8 | 测试债务 | **仍未解决且扩大**：D28 storage.test.ts 4 处固定 deletedAt 将于 **2026-12-04/05 后爆红**（上轮声称已消除时间炸弹，实际只修了 trash.test.ts）；D29 A9/A2-unavailable/store 持久化无单测；PAY-26 C8/B8/#4 未钉住+弱断言；store/pages 仍仅 e2e 覆盖 |


---

## 九、修复路线图与优先级建议

> 原则：先发布阻断与数据安全，再金额口径（需产品决策），再隐私/体验，最后债务。工作量 S=半天内 / M=1–3 天 / L=3 天以上（含回归）。**本报告不实施任何修复**，以下为建议路线。

### 批次 0 · 发布合规（若计划上架/分发，最先做）
| 项 | 工作量 | 要点 |
| --- | --- | --- |
| AND-04 政策死链+占位邮箱 | S | 托管真实 HTTPS 政策页并实测 200；VITE_PRIVACY_URL/VITE_SUPPORT_EMAIL 注入；替换两份政策 HTML 内链接与 mailto；递增 PRIVACY_VERSION；同步 STORE-LISTING |
| AND-03 debuggable release 守卫 | S | taskGraph.whenReady 追加「release 产物任务 + xinshiDebuggable/xinshiWebViewDebug → GradleException」；check:release 对产物做 aapt2 badging 断言 |
| AND-01/16 崩溃诊断隐私 | S–M | 默认写 filesDir/cacheDir，用户主动导出才经 SaveFile 进公共目录；或政策披露+递增 PRIVACY_VERSION；修正 <Q 分支注释 |
| AND-02 dataExtractionRules | S | 新增 res/xml/data_extraction_rules.xml（cloud-backup 与 device-transfer 均排除全部域）+ manifest 挂载；Android 12+ 真机回归换机迁移 |
| AND-11 清理 aligned.apk | S | 删除陈旧未签名中间产物；发布 SOP 只从 release/ 取带 hash 登记成品 |

### 批次 1 · 数据安全（P1 为主，小修复大收益）
| 项 | 工作量 | 要点 |
| --- | --- | --- |
| D01 settleJob 走 commit() | **S（一行级）** | 消除结算单被跨标签页事件吞掉的窗口；补回归 |
| D03 MoveSheet 'shared' 守卫 | S | 与 DataSafety.quickBackup 同口径；结果屏文案区分「已保存/待确认」 |
| D02 跨标签页丢失更新 | M（长期 L） | 短期：落盘前 getItem 比对（乐观 CAS）或「远端已变脏」标记落盘后补读；长期：按记录 ID 增量合并或 BroadcastChannel 单写者 |
| D08 prunePhotos 误删新照片 | S | 跳过 createdAt>prune 启动时刻的记录/删前重读引用 |
| D09 resetAll 被复活 | M | 广播清空意图，其他窗口丢弃 pending 改动；或写带时间戳空账 |
| D10 原生桥超时 | S | save/prune 包 30–60s 超时+lastError；running 守卫超时兜底 |
| D04 导入大小上限 | S | file.size>20MB 拒绝（账本 localStorage 上限约 5MB） |

### 批次 2 · 金额口径（P1/P2，先做产品决策）
| 项 | 工作量 | 要点 |
| --- | --- | --- |
| PAY-01/02 月薪×非整月周期 | **决策先行** | 决策 A：支持该形态 → 封顶改「rate×周期天数/当月天数」+超休跨结算单累计已扣天数（L，同类改造）；决策 B：不支持 → 导入归一/拒绝+体检提示+文案（M）。无论 A/B：UI 显示折算后周期额度、修正首页「整月发放」文案（PAY-21） |
| PAY-05/06/29 封顶口径统一 | M | 日历/选中日/周档明细与统计页同源（dailySeries 或同参 sumEntriesCapped）；Excel 预估行复用 summarizeUnsettledJob；明细表加「折算参考」标注 |
| PAY-04 CSV round2 | S | cell() 对 number 统一 round2 |
| PAY-07 net≤0 收款 | S | 禁用收款入口+「无需收款/倒欠」说明，或特殊状态使 toast 与落库同源 |
| D05/D06/UI-10/UI-29 钳制对齐 | M | 录入↔导入↔UI max 三口径同一上限表（rate/expectedDays/OT/奖扣/借支/字符串长度）；otHours≤hours；往返一致性回归 |
| PAY-09 超休先乘后舍入 | S | round2(rawDays×dailyRate)，展示天数另行舍入 |

### 批次 3 · 隐私与体验（P2）
| 项 | 工作量 | 要点 |
| --- | --- | --- |
| UI-04/05/06 隐藏金额+已结清口径 | M | 产品决策「单价/导出面是否属隐藏范围」；岗位卡待收徽章；QR/复制/工资条预览打码或醒目提示 |
| UI-02/03 竞态守卫 | S–M | mountedRef/AbortController；undoBusy 禁用返回；ledgerSeq 变化重置 autoRecurringDay |
| UI-11+UI-19 PWA 离线 | M+S | workbox injectManifest 预缓存全部路由 chunk；页级 ErrorBoundary |
| AND-08/09/10 崩溃链路 | M | didCrash=false 不计数不 export；崩溃页加「重启/退出」；日志截断+环形滚动 |
| UI-08/09 性能 | M–L | value useMemo/拆 context；页面派生 memo；长列表虚拟化 |
| UI-12/13、D11、D17、D20、D21 | S each | 复制用当前 rule；--muted-2 对比度；health 增「周期内未锁定」规则；prune 失败降级；备份退避；错误文案分类 |

### 批次 4 · 债务与卫生（P3，两项时间敏感者提前）
| 项 | 工作量 | 要点 |
| --- | --- | --- |
| ⚠️ **D28 storage.test 时间炸弹** | S | **2026-12-04/05 后 282 用例将假红（距今约 2.5 周），建议立即修**：固定 deletedAt 改相对 daysAgo()（文件内已有 helper） |
| ⚠️ AND-06 e2e 链 | M | 同意版本'2026-11-05'是第二颗时间炸弹（PRIVACY_VERSION 一 bump 全链卡隐私弹窗）；自动起 preview/浏览器路径可配置/同意版本从 compliance.ts 读；补 v1.2.1–v1.2.4 回归 |
| DEP-01/02/03 依赖升级 | M | vitest≥4.1.12（连带 tinypool/mocker/嵌套 vite）；@capacitor/cli 升级或 override tar≥7.5.21（**tar7 ESM-only，必须实测 cap sync**）；CI 加 audit 门禁 |
| AND-05 check-release 补强 | M | 占位邮箱 FAIL/政策内链接扫描/assets 哈希比对/FileProvider 白名单断言/debuggable 产物断言/versionCode 公式防碰撞 |
| D29/PAY-26 测试钉住 | M（持续） | A9 篡改/unavailable/settleJob 守卫/PAY-01 多期合计/PAY-02 跨周期超休/CSV 尾数/C8 hours/B8 口径；弱断言改精确值 |
| D22/D27 数据抹除与自救 | M | 「同时删除所有快照」选项+确认框披露；恢复页「从备份导入」出口 |
| 其余卫生项 | S each | AND-13/14/20（shots LFS、gitignore 兜底、模板清理、packageManager 钉死）、UI-14/16/17/20/21/23–42、PAY-10–29 余量、D12–D36 余量 |

### 回归与验收建议
- 每批次完成后：`pnpm typecheck && pnpm test && pnpm build` + 补强后的 `pnpm check:release`；金额口径改动必须附「数字示例回归」（本报告 PAY-01/02/05/06/29 的示例可直接转为测试用例）。
- **真机验证清单**（本报告标注「存疑」子项）：Android 5–9 分享面板取消语义（D03/UI-22）；Android 12+ OEM 换机迁移（AND-02）；Android 16 返回层级（AND-19/UI-26）；低端机 LMK 回收频率（AND-08）；崩溃页返回键（AND-09）；旧 ROM URI 授权（AND-17）；PWA 首装离线（UI-11）。
- **多标签页竞态验证方法**（D01/D02/D09）：双标签页打开同一账本，在 setState 与持久化 effect 之间注入 storage 事件（DevTools 断点或 CDP），观察结算单/清空是否被吞。


---

## 十、附录

- [附录 A · 数据层完整底稿](audit-r2/appendix-A-data.md)（36 条逐条证据 + A 组核实 + 覆盖率）
- [附录 B · 计薪业务完整底稿](audit-r2/appendix-B-pay.md)
- [附录 C · 前端 UI 完整底稿](audit-r2/appendix-C-ui.md)
- [附录 D · Android/发布完整底稿](audit-r2/appendix-D-android.md)（含 APK 签名/哈希比对补记、依赖版本表、跟踪文件统计）
- 基线验证（typecheck/test/build/check:release）与完整 `pnpm audit` 输出（29 漏洞逐条 GHSA 编号）已并入本报告第二/三节；临时工作目录 `.audit-work/` 已在交付时清理，四路底稿即上述附录 A–D。
- 本轮审计新增文件仅本报告与附录 A–D（docs/ 下），未改动任何源码/配置/构建产物。
