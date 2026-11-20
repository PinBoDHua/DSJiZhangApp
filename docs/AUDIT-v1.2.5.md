# 薪时 XINSHI · 前后端代码审计报告（第三轮 · v1.2.5）

> 审计日期：2026-11-20（Asia/Shanghai）
> 审计对象：`D:\DSJiZhangApp` @ git HEAD `d0d8f83`（v1.2.5，versionCode 1205，SW v32，工作树干净）
> 审计性质：**只读审计——只找出问题并给出解决方案，未修改任何源码 / 配置 / 构建产物**
> 上一轮：[AUDIT-v1.2.4-R2.md](AUDIT-v1.2.4-R2.md)（119 条：P0×0 / P1×9 / P2×29 / P3×81）与修复记录 [AUDIT-v1.2.4-R2-fixes.md](AUDIT-v1.2.4-R2-fixes.md)
> 完整工作底稿（逐条代码证据）：[docs/audit-r3/](audit-r3/) 四份附录 A–D
> 修复记录（2026-11-20）：[AUDIT-v1.2.5-fixes.md](AUDIT-v1.2.5-fixes.md) —— 批次 0–4 共 18 项已修复（tsc 0 / 390 用例 / 25 PASS）

---

## 执行摘要

**总体判断：工程质量仍处于高位，无 P0；上轮 9 条 P1 全部落地或部分落地、无一条虚报。本轮 63 条独立问题中只有 2 条 P1，且两条都是「上轮修复的残留或反向回归」，不是新出现的老问题。**

- **基线（主代理实测）**：`tsc --noEmit` 0 错误；`vite build` 通过（3.82s，主 chunk 488.23KB / gzip 154.26KB）；`check:release` 16 PASS / 0 FAIL（设 `ANDROID_HOME` 后 19 PASS）；`check-offline-csp` 16 项全 PASS；git 全历史无密钥 / 大文件；**v1.2.5 APK/AAB 的 SHA-256 与发布说明逐字一致**；`dist`、`android/.../assets/public`、APK 内 `assets/public` 三方逐文件 sha256 零差异。
- **但测试基线已经破了**：`pnpm test` 实测 43 文件 / **384 用例中 2 条失败**（`health.test.ts`）。原因不是新功能坏了，而是 `health.ts:343` 的 `backup-stale` 规则用 `Date.now()` 而非注入的 `today`，测试把 `lastBackupAt` 固定为 2026-11-05 —— 今天正好第 15 天，越过 14 天阈值。**v1.2.5 发布记录里的「384 用例全绿」自 2026-11-19 起已不成立。**
- **上轮修复可信**：四路合计抽查 41 条声称修复项（A 10 / B 12 / C 10 / D 9），**无虚报**；27 条完整落地、14 条部分落地（其中 2 条升格为本轮 P1）。部分落地的模式仍是上轮总结的**「同类路径未扫全」**：打码扫了首页没扫岗位卡、时间炸弹修了 `storage.test.ts` 没扫 `health.test.ts`、发布守卫拦了 `debuggable` 没拦 `diag`。
- **本轮发现**：4 路并行只读审计原始 64 条，经主代理逐条复核 P1 / 关键 P2、跨路去重（A05≡B06）后为 **63 条独立问题：P0×0 / P1×2 / P2×15 / P3×46**。

**2 条 P1（两条都是「修出来的」）**：

1. **B01 月薪 × 日结封顶回归**（`settlement.ts:208-222`）：上轮 PAY-01 为修「同月多期合计超发 41%」，把封顶按「周期日历天数 / 当月天数」折算。方向对，但系数用错了参照物 —— 日结周期只有 1 个日历日，每天封顶被压到 `3500/30=116.67`，而单日应计是 `3500/22=159.09`。**21 个工作日的月薪岗位逐日结算只发 2450.07，比站内月视图的 3500 少 1049.93（−30%）**；v1.2.4 是 3340.89。触发人群 = 导入 / 手改 / 遗留的「月薪 + 日结或周结」岗位（当前 UI 已强制月薪月结）。
2. **A01 整包式 updater 在跨标签页 CAS 合并时覆盖远端**（`store.tsx:1054`、`:833`）：`commit(() => committed.state)` 忽略 `prev`，一旦落盘前检测到远端变脏，重放会把另一标签页刚写入的工记整包覆盖掉（内存与磁盘同时消失）。这是上轮 D02「乐观 CAS」修复时已披露的残留（fixes §8.1），窗口比 D02 窄得多，但后果仍是**本地账本永久丢数据**。

**最值得记住的三件事**：

- **测试可信度问题比测试失败本身更严重**：一条用真实时钟的规则让「全绿」结论在 13 天后自动失效，而没有任何门禁在盯它。同类扫描（全库 `Date.now()` 使用点）显示其余规则都支持注入时钟，**只有这一个漏了**，属于可一次性收口的债务。
- **算钱口径的修复必须先写「三个数」**：整月应发、单期应发、逐期合计。PAY-01 的修复只验了「30 天全勤合计 = 3500」和「4 周合计 = 3500.02」，没验「21 个工作日合计」，于是把日结压到了 1/30。修复建议见 §5.2。
- **发布链的可绕过面在收窄但仍存在**：守卫拦 `debuggable` / `webViewDebug`，但 `-Pxinshi.diag` 仍能让正式包写公共 Download；`check:release` 不校验产物 versionCode / 签名，也不校验 assets 与 dist 是否同源（本轮实测三者一致，但只是运气，没有断言）。

**阅读指南**：§1 范围与方法 → §2 基线（含 2 红测试与时间炸弹）→ §3 依赖 → §4–§7 四域发现（P1 详述、P2 表格 + 关键展开、P3 一览）→ §8 合并裁定与去重 → §9 上轮 119 条核实 → §10 修复路线图 → [附录 A–D](audit-r3/)（完整代码摘录、算术复现、排除疑点记录）。

---

## 一、审计范围与方法

| 项 | 说明 |
| --- | --- |
| 应用形态 | 纯本地离线 App：React 19 + TypeScript 5.7 + Vite 6 + Capacitor 6 Android WebView 壳；账本 `localStorage`（schema v7），照片 IndexedDB，自定义 `SaveFile` 原生插件，可选 PWA Service Worker（v32） |
| 「后端」口径 | 本项目**无服务端**（v0.6.0 起云同步暂停，Android 已移除网络权限，APK 实测无 INTERNET）。「后端」= 本地数据层（storage / snapshots / trash / backup / crypto / checksum / movePackage / stateMerge / health）、计薪结算引擎（settlement / pay / recurring / PagePay）、Android 原生壳与构建发布链 |
| 代码规模 | `src/` 158 个文件（约 3.7 万行，105 ts + 52 tsx + 1 css）；测试 43 文件 / 384 用例；原生 Java 3 文件；`scripts/` 66 个 .mjs |
| 审计方式 | 4 路并行只读审计（A 数据层 / B 计薪业务 / C 前端 UI / D Android 与发布）+ 主代理基线实测、P1 与关键 P2 逐条复核、跨路去重 |
| 对照基线 | 上轮 `docs/AUDIT-v1.2.4-R2.md` 的 D01–D36 / PAY-01–29 / UI-01–42 / AND-01–21 逐组抽查；§8.4 的 8 项「未修复项」逐一复核现状 |
| 严重度 | **P0**=数据丢失/损坏、安全漏洞、发布阻断；**P1**=重大功能错误（含算钱错误）、隐私泄露、上架风险；**P2**=一般缺陷/边界/体验；**P3**=代码质量/卫生/测试债务 |
| 置信度 | 「已确认」=代码级证据充分；「存疑」=路径成立但触发概率 / 平台行为需真机或运行时验证（各条已标注验证方法） |

**审计限制（明示）**：

1. `android/keystore/*`、`signing.properties`、`password.txt`、`.env` 内容受凭据围栏保护**未读取**，只核实存在性与 git 跟踪状态（D 路用真实 APK/AAB 的签名验证替代）。
2. **未做真机运行验证**；多标签页竞态（A01/A02）、低端机 OOM 阈值、Android 16 返回行为、Android 5–9 URI 授权等标注「存疑」的子项需真机复核。
3. 依赖漏洞以本机 `pnpm audit`（registry 实时公告）为准，未做外部 CVE 交叉查证。
4. 未执行 `pnpm build` 之外的任何写产物命令；`dist/` 已由主代理重建（.gitignore 覆盖），未产生跟踪文件变更。

---

## 二、基线验证结果（主代理实测，2026-11-20）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | ✅ **0 错误** |
| `npx vitest run --no-file-parallelism` | ❌ **43 文件 / 384 用例：382 通过、2 失败**（`src/lib/health.test.ts`：`正常账本没有严重或提醒项`、`徽标文案按严重程度显示`） |
| `npx vite build` | ✅ 通过，3.82s，1942 模块；主 chunk `index-CJmbNJ8q.js` **488.23KB（gzip 154.26KB）**、CSS 164.5KB、`jspdf` 390.78KB 懒加载 |
| `npx pnpm audit` | ⚠️ **29 个漏洞：4 critical / 9 high / 15 moderate / 1 low，全部在 dev 依赖链**（与上轮完全一致，未升级） |
| `npx pnpm audit --prod`（D 路执行） | ✅ **0 条**（运行时依赖干净） |
| `node scripts/check-release-config.mjs` | ✅ 16 PASS / 0 FAIL；带 `ANDROID_HOME=D:/Android/Sdk` 时 **19 PASS**（多出 3 个 APK `application-debuggable` 断言） |
| `node scripts/check-offline-csp.mjs` | ✅ 16 项全 PASS（预缓存 42 项、CSP hash 匹配、manifest id、SW v32） |
| `node --check scripts/*.mjs` | ✅ 66 个脚本 0 语法错误 |
| git 全历史敏感对象扫描 | ✅ 无 keystore / jks / pem / signing.properties / password.txt / .env 对象；无 >2MB 大文件 |
| v1.2.5 产物校验 | ✅ APK SHA-256 `bee4a4cc…7582`、AAB `388993af…d330`，与 `RELEASE-NOTES-v1.2.5.md` 逐字一致；APK 无 `application-debuggable`、v1+v2 签名证书 `a5b8514a…d606` |
| 三方产物一致性 | ✅ `dist` ↔ `android/app/src/main/assets/public` ↔ APK 内 `assets/public` 逐文件 sha256 零差异（仅多 Capacitor 生成的空 `cordova.js` / `cordova_plugins.js`） |

### 2.1 两条红测试与「时间炸弹」（A04，本报告提级为 P2）

```
src/lib/health.test.ts:14   const today = '2026-11-05';
src/lib/health.test.ts:15   const lastBackupAt = '2026-11-05T08:00:00.000Z';
src/lib/health.ts:343       Date.now() - lastBackup.getTime() > 14 * 86_400_000
```

`checkLedger(state, { today, lastBackupAt })` 接受注入了的 `today`，但 `backup-stale` 规则**只用了 `lastBackupAt`，比较对象是 `Date.now()`**。测试固定备份时间 2026-11-05：

- 2026-11-17（上轮验证当天）= 12 天 → 绿，所以「384 全绿」当时是真的；
- 2026-11-19 起 = ≥14 天 → `backup-stale` 恒报，两条断言必红；
- 2026-12-04/05 还会再叠加 `storage.test.ts` 的旧风险（上轮 D28 已用相对日期 `daysAgo()` 修掉，本轮复核**已消除**）。

**主代理全库扫描**：`src/` 中 `Date.now()` / `new Date()` 共 40 处，**其余全部提供 `now` / `today` 注入参数**（`autoBackup`、`trash`、`timer`、`reminder`、`paydayNotifications`、`excel`、`movePackage`、`storage.backupFileName` 等），只有 `health.ts:343` 这一处硬编码真实时钟。也就是说：**这是一次性可收口的单点债务，但已经让本轮的基线验证结论失真**。

**影响**：CI / 发布前门禁 `pnpm test` 从 11-19 起必红；任何人照着 fixes 文档复核都会得到与文档矛盾的结果；坏红还会掩盖真正的回归（狼来了）。

**解决方案**（S，半天内）：

```ts
// health.ts:338-343
const staleBackup =
  !lastBackup ||
  Number.isNaN(lastBackup.getTime()) ||
  daysBetween(toISODate(lastBackup), today) > 14;   // 用注入的 today
```

同时把 `HealthOptions` 的注释补上「所有时间判定必须走 `today`，禁止 `Date.now()`」，并在 `health.test.ts` 增加一条「把 today 后移 30 天，backup-stale 必须仍不报」的守卫用例。**修复后请把本报告 §2 的基线结论同步进发布记录**（上架材料里的「384 全绿」需改为「384 中 2 条因真实时钟失效，已于修复」）。

---

## 三、依赖与供应链安全（DEP）

> 全部 29 条公告都在 **devDependencies 链**，`pnpm audit --prod` 为 0，不进 APK / dist 运行时产物。风险面是开发机与 CI（恶意 tar 解包、vitest 服务暴露等）。运行时依赖零公告（正面结论）。

| # | 严重度 | 包 | 公告 / 风险 | 状态 |
| --- | --- | --- | --- | --- |
| DEP-01 | P2 | `tar@6.2.1`（`@capacitor/cli` 传递） | 11 个公告，含 1 critical（GHSA-23hp-3jrh-7fpw，解包 DoS）+ 7 high（路径穿越写文件）；修复版 ≥7.5.21 | **仍未修**（与上轮一致） |
| DEP-02 | P2 | `vitest@2.1.9` 测试链（嵌套 vite 5.4.21 / esbuild 0.21.5 / tinypool 1.1.1） | 3 critical（GHSA-5xrq-8626-4rwp 任意文件读取执行；tinypool 原型污染 RCE ×2）+ 多个 high | **仍未修** |
| DEP-03 | P3 | `glob@10` / `minimatch`（`@capacitor/cli>rimraf`） | 2 个 moderate（ReDoS / globparts 放大） | **仍未修** |
| DEP-04 | P3 | 无 CI、无 `pnpm audit` 门禁 | 上述三条无法被自动发现，靠人工记得跑 | 见 D09 |

**建议**：`pnpm.overrides` 强制 `tar ≥7.5.21`、`vitest ≥3.2.6`（或迁到 4.x）并实测 `cap sync` 全链路；CI 加 `pnpm audit --prod`（0 容忍）与 dev 链 critical（阻断）。**注意** `tar@7` 为 ESM-only 而 `@capacitor/cli@6` 是 CJS，override 后必须真机跑一次 `cap sync android`，否则会把「审计问题」换成「构建问题」。

---

## 四、数据层与持久化（A 路 · 13 条：P1×1 / P2×2 / P3×10）

完整底稿：[appendix-A-data.md](audit-r3/appendix-A-data.md)

### 4.1 发现总览

| # | 严重度 | 一句话 | 位置 |
| --- | --- | --- | --- |
| **A01** | **P1** | 整包替换型 updater（settleJob / generateRecurring）在跨标签页 CAS 合并时覆盖远端账本，D02 原始症状仍存在 | `store.tsx:1054,833`；`stateMerge.ts:12-13` |
| A02 | P2 | 落盘失败时清空 `pendingUpdaters` 且不回滚内存：后续一旦触发 CAS 合并，这批「只在内存里」的改动被静默丢弃 | `store.tsx:312-322,295-303` |
| A03 | P2 | 自动备份在 `'shared'`（分享面板取消）时仍写 `lastRunAt`、清 `lastError`，且 `App.tsx:252` 丢弃返回的 `warning` → 当天静默无备份、无重试、无提示 | `autoBackup.ts:161,174-189`；`App.tsx:252` |
| A04 | **P2**（原 P3，提级） | `backup-stale` 用 `Date.now()` 而非注入的 `today`，规则不可注入；已致 2 用例假红 | `health.ts:339-343` |
| A05 | P3 | `payment-over-net` 对 `net<0` 且已标记「无需收款」的结算单误报（=B06，去重后保留 A05） | `health.ts:274-283` vs `store.tsx:1075-1092` |
| A06 | P3 | 「清空所有数据」不彻底：13 个附属 localStorage 键中 10 个残留（含 `xinshi.batchTemplates` 的金额/备注） | `storage.ts:136-142`；`store.tsx:1186-1191` |
| A07 | P3 | 导入信任包内 `paymentStatus`，与 `paidAmount` 矛盾时不校正，体检也无对应规则 | `storage.ts:574-580`；`payment.ts:10-24` |
| A08 | P3 | 导入静默丢弃超过 120 条的回收站记录（无提示、无计数） | `storage.ts:1028-1030`；`trash.ts:74-81` |
| A09 | P3 | 快照 / 备份不含照片：恢复旧快照后 `entry.photoId` 悬空，无检测、无提示 | `snapshots.ts:357`；`store.tsx:1190` |
| A10 | P3 | `DataSafety` 的「清空所有数据」没有「同时删除全部历史快照」选项（D22 只落在 Profile） | `DataSafety.tsx:218-240,528-530` vs `Profile.tsx:327-352` |
| A11 | P3 | store 写入层缺奖金 / 扣款上限（录入 UI 与导入都钳制，store 只查 ≥0），三口径未齐 | `store.tsx:502-508,557-563` |
| A12 | P3 | `SnapshotMeta.integrity` 永不填充（`toMeta` 丢弃），类型声明与实际返回不一致 | `snapshots.ts:317-328,49` |
| A13 | P3（存疑） | 导入时工记 `rule` 缺字段回退到**岗位当前规则**，历史金额随当前设置漂移 | `storage.ts:451,301-366` |

### 4.2 A01 详述（主代理已独立复核）

**位置**：`src/store.tsx:1054`（`settleJob`）、`:833`（`generateRecurring`）；`src/lib/stateMerge.ts:12-13`（注释已自认）。

**证据链**：

```ts
// store.tsx:386-393  commit 把 updater 压入重放队列
const commit = useCallback((updater: StateUpdater) => {
  const next = updater(stateRef.current);
  pendingPersist.current = true;
  pendingUpdaters.current.push(updater);   // ← 落盘冲突时按序重放
  setState(next);
}, []);

// store.tsx:1039-1054  settleJob 的 updater 忽略 prev，返回「本窗口算出的整本」
const committed = commitSettlement(stateRef.current, {...});
commit(() => committed.state);              // ← 重放语义被破坏

// stateMerge.ts:16-20
let merged = remote;
for (const updater of updaters) merged = updater(merged);  // → 最后一条恒返回旧整本
```

**触发路径（可复现）**：标签页 A 有一次未落盘的 `commit`（`pendingPersist=true`）→ 此时标签页 B 写入新工记，A 收到 `storage` 事件并只置 `remoteDirty=true`（`store.tsx:346-349`）→ A 执行「结算」→ A 落盘时 `isRemoteDirty` 为真，用远端为底重放 `[() => committed.state]` → 结果仍是 A 的整本 → **B 的新工记从内存与磁盘同时消失，无任何报错**。`generateRecurring`（`:833`）同构。

**影响**：本地账本永久丢数据，无服务端可恢复；`undo` / 快照可能救回，但用户不会知道要救。

**为什么定 P1 而不是 P2**：定级看后果不看概率——丢失对象是账本记录且静默。但必须注明：触发窗口 = `pendingPersist` 为真的一个渲染周期（通常 <16ms），Android 单窗口主场景**不受影响**，仅 PWA / 桌面多标签页；且上轮 fixes §8.1 已明示这是 D02 短期方案的已知残留，**不是本轮新回归**。

**解决方案**（三选一，按成本升序）：

1. **S（推荐先做）**：`settleJob` / `generateRecurring` 不用「返回整本」，改为返回**语义 updater**：`prev => ({ ...prev, settlements: [...], entries: prev.entries.map(...) })`，把「基于 stateRef 算出的 diff」应用到 `prev`。`commitSettlement` 已经产出 `settlement` + 锁定的 `entryIds/advanceIds`，很容易重写为 `applySettlement(prev, settlement)`。
2. **M**：整包替换类写入（导入 / 重置 / 快照恢复）统一走 `broadcastLedgerEpoch()` 并**在重放队列里丢弃 `prev` 型 updater**（`stateMerge` 增加 `isWholeState` 标记，遇到即直接采用，不再重放后续）。
3. **L**：`BroadcastChannel` 单写者 / 按记录 ID 增量合并，彻底解决多标签页。

### 4.3 其余 P2

| # | 位置 | 问题 | 影响 | 方案 |
| --- | --- | --- | --- | --- |
| A02 | `store.tsx:312-322` | 保存失败分支清空 `pendingUpdaters` + `pendingPersist=false`，但不回滚 `state`；此后若发生一次 CAS 合并，内存里未落盘的改动被当成「已保存」丢掉 | 存储偶发失败（配额 / 隐私模式）时叠加另一窗口改动 → 静默丢改动 | 失败分支保留 `pendingUpdaters`（或把 `state` 回滚到最后成功落盘的 `lastPersistedRaw`），并把 `storageError` 升级为阻塞式恢复页 |
| A03 | `autoBackup.ts:161-189` + `App.tsx:252` | `shared`（旧系统分享面板）时仍 `lastRunAt=now`、`lastError=undefined`、`writeAutoBackupFailure(null)`；`warning` 被 `void runAutoBackup()` 丢弃 | 用户取消分享 → 当天不再自动备份、不重试、无提示；「14 天备份」提醒被静默重置 | `shared` 时**不写 `lastRunAt`**、保留 `lastError`、把 `warning` 接到 toast（与 MoveSheet D03 同口径） |
| A04 | `health.ts:343` | 见 §2.1 | 已致 2 测试红 | 改用注入的 `today` + 守卫用例 |

### 4.4 P3 一览

A05 负净额体检误报（与 B06 合并）｜A06 清空残留 10/13 键｜A07 导入信任 `paymentStatus`｜A08 回收站静默截断｜A09 快照照片悬空｜A10 清空缺快照选项｜A11 store 层缺奖扣上限｜A12 `SnapshotMeta.integrity` 死字段｜A13（存疑）导入 rule 回退当前规则。

### 4.5 上轮 A 组修复回归抽查（10 条，无虚报）

| 上轮 | 结论 | 证据 |
| --- | --- | --- |
| D01 settleJob 走 commit | ✅ 真落地 | `store.tsx:1054` 已改 `commit()` |
| D02 跨标签页 CAS | ⚠️ 部分（→ A01） | `stateMerge.ts` 生效，但整包 updater 例外 |
| D04 导入 20MB 上限 | ✅ | `DataSafety.tsx` / `StorageRecovery.tsx` 均有 size 守卫 |
| D08 prunePhotos 误删 | ✅ | `photos.ts` `skipCreatedAfter` 与 `pruneStartedAt` 口径一致 |
| D09 resetAll 广播 epoch | ✅ | `store.tsx:1185` + `broadcastLedgerEpoch` 分支 `:329-341` |
| D10 原生桥 45s 超时 | ✅ | `saveFile.ts:28-44` |
| D11 拒收周期内未锁定工记 | ✅（导入侧） | `storage.ts:928-942`；体检仍未加规则（A05 相关） |
| D19 PBKDF2 600k | ✅ | `backup.ts` 600_000 迭代 + 上下界校验 |
| D22 清空同时删快照 | ⚠️ 部分（→ A10） | 只在 Profile 落地，DataSafety 仍有入口 |
| D28 storage.test 时间炸弹 | ✅ 真落地 | 已改 `daysAgo()` 相对日期（但同类漏了 health，→ A04） |

---

## 五、计薪 / 结算 / 统计 / 导出（B 路 · 16 条：P1×1 / P2×3 / P3×12）

完整底稿：[appendix-B-pay.md](audit-r3/appendix-B-pay.md)。**方法**：B 路把所有金额结论用仓库自带的 `tsc` 把真实模块编译到临时目录、再用 node 直接调用**线上同一份代码**复现，避免手抄公式；20 个计薪测试文件 168 用例全绿，说明缺陷藏在「被测试钉成预期」的口径里。

### 5.1 发现总览

| # | 严重度 | 一句话 | 位置 | 涉及金额 |
| --- | --- | --- | --- | --- |
| **B01** | **P1** | 【PAY-01 修复回归】月薪 × 日结（及部分周结）按「日历天占比」折算封顶，日结永远发不满月薪 | `settlement.ts:208-222`；`pay.test.ts:866-868` 把 116.67 钉为预期 | 3500 → **2450.07**（Δ−1049.93，−30%） |
| B02 | P2 | 超休额度 / 休息规则取「当前岗位设置」而非工记快照：结算后再改额度，旧周期被追溯多扣 | `settlement.ts:428,436-448` vs `:449-452`；`store.tsx:422-427` | 3500 → 3181.82（−318.18） |
| B03 | P2 | 借支 > 本期应发时产生负净额，PAY-07 后可一键「标记已结清」，超出部分**不递延** | `settlement.ts:471-473,504-505`；`store.tsx:1075-1092` | 借 1000 / 挣 240 → 净 −760，下期仍发 240 |
| B04 | P2 | 结算校验码把「已收金额 / 收款状态」纳入 canonical：登记收款后同一张单出现两个码，旧导出单据失效 | `checksum.ts:145-146,154-156` | 同单一码变两码 |
| B05 | P3 | Excel 月度汇总看不到孤儿数据：悬挂 `settlementId` 的工记算进未结、孤儿岗位整行缺失 | `excel.ts:59-61,145-147,164` vs `settlement.ts:259,272-288` | App 240 vs Excel 480 |
| B06 | P3 | 负净额结算单必触发体检「已收金额超过应发」误报 | `health.ts:274-283` | **与 A05 同一问题，已合并** |
| B07 | P3 | 只有借支没有工记的岗位永远无法结算（`draft.entries.length===0` 直接拒绝） | `settlement.ts:656`；`Settlements.tsx:217-218` | −300 永久挂账 |
| B08 | P3 | 三种导出对同一张结算单的列语义不一致（复制合并奖扣 / CSV 拆列带单号 / Excel 无单号） | `settlement.ts:843-862`、`csv.ts:139-165`、`excel.ts:300-318` | 对账口径 |
| B09 | P3 | `hoursBetween` 对缺分量时间串返回 NaN（`Number.isNaN(undefined)===false`），最终被 `round2` 归零 | `date.ts:199-208` | 工时为 0 |
| B10 | P3 | Excel 未结行「金额按 `periodEnd` 归月、休息天数按 `rest.date` 归月」，跨月周期一行内两种口径 | `excel.ts:185,238-244` | 跨月周结行 |
| B11 | P3 | `eachDay` 370 天硬上限参与 `periodShareCap` 分母：>370 天导入区间份额被少算 | `date.ts:67-77` → `settlement.ts:211-213` | 超长自定义周期 |
| B12 | P3 | 月中调价后固定月薪既不按整月也不按新价：21 天@3500 + 1 天@4000 = 3522.73 | `settlement.ts:191-204,220-222`；`pagePay.ts:39-57` | 3522.73 |
| B13 | P3 | 工资条图片在「7 行分项 + 休息日 + 备注」时备注基线 1304 超出卡片 1300（算术推定，未渲染） | `payslip.ts:285-297,347-369,373` | 版式 |
| B14 | P3 | `toAmount` 先删非 `[0-9.-]` 再 `parseFloat`：`1e3` 变 13、`12.3.4` 变 12.3，输入错误被静默改数 | `money.ts:55-59` | 金额录入 |
| B15 | P3（存疑） | 加班倍率只按自然周末判定，不读 `workWeekdays`：周末上班者平时加班记 2 倍 | `pay.ts:5-9`；`date.ts:79-82` | 倍数口径 |
| B16 | P3 | 测试债务：CSV 表头只断言 `>30`（实际 38）、日结 116.67 被钉为「正确」、PAY-09 的 4.9333 只有手改数据可达 | `csv.test.ts:102`、`pay.test.ts:866-868` | — |

### 5.2 B01 详述（主代理已独立复算）

**位置**：`src/lib/settlement.ts:208-222`；`src/lib/settlement.ts:394-398`（结算一律传 `periodShareCap: true`）；`src/lib/pay.test.ts:862-868`（把 116.67 钉成预期）。

**代码**：

```ts
// 非整月周期：cap 按「周期落在当月的日历天数 / 当月天数」折算（PAY-01）
let periodShare = 1;
if (options.periodShareCap && period) {
  const daysInPeriodMonth = eachDay(period.start, period.end)
    .filter((day) => monthKey(day) === groupMonth).length;
  periodShare = Math.min(1, daysInPeriodMonth / daysInMonth(`${groupMonth}-01`));
}
const cap = capBase * periodShare;
const paidBase = fullFixedMonth ? rate : Math.min(rawBase, cap);
```

**复现（月薪 3500 / 计薪天数 22 / 2026-11，30 天、21 个工作日）**：

| 场景 | 站内月视图 | v1.2.5 逐日结算 | v1.2.4 逐日结算 |
| --- | --- | --- | --- |
| 21 个工作日 | 3500 | 21 × round2(3500/30) = **2450.07** | 21 × 159.09 = 3340.89 |
| 30 天全勤 | 3500 | 30 × 116.67 = 3500.10 | 4772.74（上轮修掉的超发） |
| 11-16 起 11 个工作日 | 3500 | 11 × 116.67 = **1283.37** | 1750.00 |
| 22 个工作日（12 月 31 天） | 3500 | 22 × round2(3500/31) = **2483.80** | 3500.00 |

**问题本质**：`periodShare` 用「日历天」做分母（30），而 `rawBase` 用「计薪天数」做分母（22）。两个分母不一致，短周期必然被 `min()` 压到日历份额。上轮修的是「4 周 × 816.67 = 3266.67 < 3500」这种**同向少发**吗？不——上轮修的是 30 天全勤超发（4772.74）。修复把「周期天数 ≥ 实际应出勤天数」的假设当成了恒真，日结（1 天）下这个假设彻底失效。

**产品决策点（必须先定，否则改不对）**：

- **决策 A：支持「月薪 × 日结 / 周结」**（导入 / 手改数据合法）。
  - 正确口径应是**累计封顶**：同一岗位同一自然月内，「已结算周期的基础工资合计 + 本期」不超过月薪；或按「本期出勤天数 × (月薪 / 当月计薪天数)」封顶。
  - 最小改动：`periodShare` 的分子用**本期应出勤天数**（由 `workWeekdays` / 排班算出）、分母用**当月应出勤天数**；日结 1 天 → 21/21 = 1，不再压。
- **决策 B：不支持该形态**（与 UI 强制月结一致）。
  - 在导入侧归一（月薪 → 月结）或拒绝并给出明确错误；体检增一条规则；文案说明。
  - 成本从 L 降到 M，但要处理已存在的遗留数据（给用户一个「转换」入口比静默改口径更安全）。

**无论 A/B，都要补三个断言**（这是本轮最值得沉淀的测试范式）：整月应发、单期应发、逐期合计。现有 `pay.test.ts:866` 只断言了 `116.67`，把错误口径固化了 —— **修 B01 时必须同时改这条断言，否则测试会「保护」bug**。

### 5.3 其余 P2

| # | 位置 | 问题 | 方案 |
| --- | --- | --- | --- |
| B02 | `settlement.ts:428,436-448` | 超休额度读 `job.rest` 当前值，而工记 `rule` 是快照。用户结算前把月休额度 5→3，已过去周期的超休天数按新额度重算，多扣 318.18 | 超休额度 / 休息规则改为**随工记快照**（`entry.rule` 已有 `rest` 相关字段则直接用；否则在结算时把当时的 `job.rest` 快照进 settlement）；`updateJob` 对已锁定周期的岗位给警告 |
| B03 | `settlement.ts:471-473,504-505` + `store.tsx:1075-1092` | 借支 1000、应发 240 → 净 −760。PAY-07 让负净额可「标记已结清」，但超出的 760 不递延，下期照发 240 —— 现金流与账本脱节 | 负净额不吞掉：把 `min(advance, due)` 计入本期、余额 `advance.remaining` 递延到下期（或在结算单上明确「欠款 −760，下期抵扣」）；`PaymentSheet` 对负净额显示「本期倒欠 / 结转」而非「已结清」 |
| B04 | `checksum.ts:145-156` | canonical 含 `paidAmount/paymentStatus/paidAt`，登记收款后校验码变化，旧 CSV/PDF 的码无法再核验 | 拆两个码：**结算码**（只算金额分项 + 锁定的工记 id，收款前后不变）与**收款码**（含收款字段）；或 canonical 排除收款字段并在导出时标注「校验码不含收款信息」 |

### 5.4 P3 一览

B05 Excel 孤儿数据｜B07 借支-only 不可结算｜B08 三格式列语义｜B09 `hoursBetween` NaN｜B10 Excel 跨月归月｜B11 `eachDay` 370 天上限｜B12 月中调价 3522.73｜B13 工资条溢出（存疑）｜B14 `toAmount` 改数｜B15 加班倍率不读排班（存疑）｜B16 测试弱断言。

### 5.5 上轮 PAY 组回归抽查（12 条）

PAY-01 ⚠️ **部分 + 回归（→B01）**｜PAY-02 ✅（残留 B02）｜PAY-04 ✅ `0.1+0.2` 导出 `0.3`｜PAY-05 ✅ `sum(dailyBaseSeries) === sumEntriesCapped.base` 精确相等｜PAY-06 ✅ Excel `net 2840.91` = App｜PAY-07 ✅ 主路径（新患 B03/B04）｜PAY-09 ✅ 先乘后舍入｜PAY-10 ✅ 三处复用 `compareLatestEntry`｜PAY-12 ✅ 孤儿按自然月各自封顶（10+11 月 = 7000）｜PAY-15 ⚠️ 覆盖完整但含可变收款字段（→B04）｜PAY-18 ✅｜PAY-29 ✅ 两周岗位 `totals = breakdown = dailySeries = 1113.63`。

**复核通过的关键不变量**（B 路明确排除）：结算原子性、已结算周期补记六处拦截、重复结算守卫、CSV 公式注入、XLSX 转义、闰年 / 跨年、时区换日、周期记工幂等。

---

## 六、前端 UI / 状态 / PWA（C 路 · 18 条：P2×4 / P3×14）

完整底稿：[appendix-C-ui.md](audit-r3/appendix-C-ui.md)。C 路通读约 2.2 万行，并做了四类只读产物核验（precache 清单 vs 实际产物、CSP hash、dist↔assets 哈希、sw.js 正则原始字节）。

### 6.1 发现总览（P2 四条）

| # | 位置 | 问题 | 影响 | 方案 |
| --- | --- | --- | --- | --- |
| **C01** | `Jobs.tsx:61-65` | 「工作管理」岗位卡用 `rateLabel()` 明文输出单价；同一数字在首页已用 `<Money>` 打码（`Home.tsx:766-773`） | 隐藏金额下月薪 / 时薪直接暴露在二级主页，停留时间长、与岗位名并列 | 抽 `RateLabel` 组件，统一 `hideAmounts ? <Money value={rate}/> : rateLabel(...)`；`JobEditor` 编辑态可保留明文 |
| **C02** | `vite.config.ts:13-15`；`payslipText.ts:23-35` | `PRECACHE_EXTENSIONS` 不含 `.ttf`，`fonts/xinshi-sans.ttf` 不在 42 项预缓存清单（实测 dist 43 项，唯一缺口）；`downloadPayslipTextPdf` 直接 `fetch` 字体失败即 throw | PWA 首装断网 → 结算 → 「文字版 PDF」必失败；有提示但功能离线不可用 | 三选一：①`.ttf` 进预缓存（+2.4MB，需产品决策）②进结算/工资条页时后台预热 + 失败置灰「离线暂不可用」③字体子集化后进预缓存（推荐） |
| **C03** | `App.tsx:286-290`；`styles.css:12285-12301` | 存储失败红条 `position:fixed; top:0; z-index:60`，无布局补偿 | 存储写失败时盖住子页返回键与首页头像，返回入口不可点（恰是最需要去「数据与安全」导出备份的时候） | 红条改为 `sticky` 占位，或顶部加 `padding-top: var(--banner-h)`；z-index 降到 header 之下 |
| **C04** | `nativeBack.ts:20-33`；`main.tsx:54` | PWA / 浏览器场景没有 history 集成：Android 返回键（Capacitor backButton）直接退出 App，不关弹层 / 子页，未保存表单丢失 | 误触返回 = 丢当前录入 | 子页 / 弹层打开时 `history.pushState` 压栈，`popstate` 优先关闭；`backRef` 已有栈，接上 `pushState` 即可 |

### 6.2 P3 一览

C05 子页无焦点管理｜C06 打开子页卸载当前 Tab，返回丢筛选/月份｜C07 撤销结算等待快照期间返回键被静默吞掉｜C08 隐藏金额仍 3 处明文（撤销结算弹窗收款额、超休 placeholder、屏幕二维码）｜C09（存疑）更新窗口断网白屏｜C10 iOS 输入框 14/15px 聚焦放大｜C11 清空/导入双击执行两次｜C12 记休息初始岗位可命中已归档岗位｜C13 MoveSheet 隐藏 file input 仍在 Tab 序列｜C14 `document.title` 永不变化｜C15 未 memo + 无虚拟化（千条账本）｜C16 `EntryRow` 的 `memo` 因内联 `onClick` 失效｜C17 引导页单价无 1e6 上限｜C18 RestSheet/Search 缺 `aria-pressed`。

> 说明：C15（UI-08/09）与 C16 是上轮 fixes 文档第九节**明确延后**的项，本轮量化了触发面（1000 笔账本下任意 commit 全量重算 + 全量 DOM），不是回归。

### 6.3 上轮 UI 组修复回归抽查（10 条）

UI-02 ✅（`mountedRef` + `undoBusy` + `undoingRef`；副作用 →C07）｜UI-05 ⚠️ 两处已打码、岗位卡漏（→C01）｜UI-11 ⚠️ 预缓存已建但漏字体（→C02）｜UI-13 ✅ 对比度浅 4.73:1 / 暗 ≈6.5:1｜UI-22 ✅｜UI-38 ✅｜UI-24 ⚠️ file input 仍可 Tab（→C13）｜UI-08 ⚠️ 部分（→C15/C16）｜UI-09 ⚠️ 未做虚拟化｜UI-06 ⚠️ 导出面明文提示已加、仍有 3 处漏（→C08）。

---

## 七、Android 原生壳 / 构建 / 发布 / 仓库卫生（D 路 · 17 条：P2×6 / P3×11）

完整底稿：[appendix-D-android.md](audit-r3/appendix-D-android.md)。D 路**用真实 APK/AAB 产物**复核，不只读代码：`aapt2 dump badging/permissions/xmltree`、`apksigner verify`、`jarsigner -verify`、`zipfile` 解包比对。

### 7.1 发现总览（P2 六条）

| # | 位置 | 问题 | 影响 | 方案 |
| --- | --- | --- | --- | --- |
| **D01** | `app/build.gradle:18-21,35,89-98`；`XinshiApp.java:67-69,124,137-139` | `-Pxinshi.diag` 未被 release 守卫拦截：正式签名包仍每次启动/崩溃写公共 `Download/Xinshi/xinshi-diag.txt` | 绕过 AND-01 的隐私修复；诊断文件含崩溃栈 / 设备信息落在公共目录 | 守卫加入 `xinshiDiag`（与 debuggable / webViewDebug 同等中止）；或 release 构建强制 `XINSHI_DIAG=false` 并在 `check:release` 断言 |
| **D02** | `check-release-config.mjs:120-139,417-423` | 找 aapt2 只看 `ANDROID_HOME` / `ANDROID_SDK_ROOT`；本机 SDK 存在（`local.properties: sdk.dir=D:/Android/Sdk`）仍降级 NOTE | 产物级守卫（debuggable / badging）在本机静默失效，天然容易漏 | 依次回退 `local.properties` → `ANDROID_HOME` → 常见路径；找不到时 **FAIL 而非 NOTE**（或要求显式 `SKIP_APK_CHECK=1`） |
| **D03** | `app/build.gradle:11-16,33-34`；`check-release-config.mjs:144-176,425-435` | 发布门禁不校验产物版本与签名：`-Pxinshi.versionCode/versionName` 可覆盖，APK 只查 debuggable | 错版本 / 错签名的 APK 仍能 19 PASS | `check:release` 增加：APK badging 的 `versionCode/versionName` 必须等于 package.json / gradle 期望值；`apksigner verify --print-certs` 证书指纹必须等于发布登记值 |
| **D04** | `android/.gitignore:95-96`；`check-offline-csp.mjs:13` | `assets/public` 与 `dist` 的漂移**没有 FAIL 级断言**（AND-05 声称的「assets 哈希比对」未实现） | 旧 assets 可被打进 APK 且检查全绿（本轮实测三者一致，但只是运气） | `check:release` 加 `dist` ↔ `assets/public` 逐文件 sha256 比对（白名单 `cordova*.js`），不一致 FAIL |
| **D05** | `docs/STORE-LISTING.md:4,17,166,242-245` | 上架材料仍写 v1.0.0 / versionCode 1000，SHA 表无 1.2.5 | 按它填商店会写错版本，发布 SOP 无 1.2.5 hash 可核 | 更新到 1.2.5 / 1205 / APK `bee4a4cc…` / AAB `388993af…`；把「版本号 / SHA」做成发布时自动生成的片段 |
| **D06** | `.env.example:6`；`compliance.ts:17` | `VITE_PRIVACY_URL=https://example.com/…` 会被 Vite 自动加载并覆盖安全默认值，且 `check:release` 对任何 https 一律 PASS | 开发者本地跑一次就被 example.com 污染；检查无法发现占位域名 | `.env.example` 改注释或留空；`check:release` 对 `example.com` / `example.org` / 空值 FAIL |

### 7.2 P3 一览

D07 28 个截图/审计脚本仍硬编码 `127.0.0.1:4173` + Edge x86 路径｜D08 `check:release` 的 CSP 断言只查 meta 存在（细节在未接线的 `check-offline-csp.mjs`）｜D09 无 CI、无 audit 门禁｜D10 SW 把任意 navigation 写成 `/index.html`（政策页污染 app 壳缓存）｜D11 `release/` 36 个产物无校验索引、v1.2.5 无 mapping｜D12 `capacitor.settings.gradle` 入库含 `.pnpm` 路径｜D13 `version.ts` 硬编码 1.2.5（非构建路径会漂移）｜D14 Gradle wrapper 无 `distributionSha256Sum`｜D15 **R2 修复记录自相矛盾且与实测不符**：同一文档第 5 行写「SW v32」、第 55 行验证表写「SW v31」；「check:release 15 PASS」实测为 16 PASS（无 SDK）/ 19 PASS（有 SDK）｜D16（存疑）LMK 回收无限重建｜D17 Android 5–9 分享前清空整个 `cache/exports`。

### 7.3 上轮 AND / DEP 组修复回归抽查（9 条，产物级）

AND-01 ✅ 修复属实（`export()` 守卫 `!XINSHI_DIAG && !DEBUG`；但有 D01 绕过面）｜AND-02 ✅ 产物级（APK 内 `res/4j.xml` 含 18 条 exclude，`allowBackup=false` 同存）｜AND-03 ⚠️ 部分（守卫与产物断言存在，漏 `diag` 与版本校验 →D01/D03）｜AND-04 ✅ 代码侧完成（真实邮箱、政策页无死链、`PRIVACY_VERSION` 同步）；**公网 HTTPS 托管仍待业务办理**｜AND-05 ⚠️ 部分（19 项实测；缺 aapt2 发现 / 版本 / assets / CSP 细节 →D02/D03/D04/D08）｜AND-06 ⚠️ 部分（functional 28 个已迁移，截图/审计 28 个仍硬编码 →D07）｜AND-07 ✅ CSP 注入属实（hash 与内联脚本一致、无 `unsafe-inline`）｜AND-08 ✅（边界 →D16）｜AND-09 ✅（每次 `showCrashScreen` 追加回调，影响小）。

**关键正面结论（产物级，非静态推断）**：

- 合并清单**无 INTERNET / 无相机 / 无定位 / 无存储权限**；仅 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK` + AndroidX 私有签名权限。
- `dataExtractionRules` 已编进 APK（`res/4j.xml`），`cloud-backup` 与 `device-transfer` 各排除 9 个域。
- 正式 APK **无 `application-debuggable`**；v1 + v2 签名验证通过，证书 SHA-256 `a5b8514a…d606` 与发布说明逐字一致；AAB `jarsigner -verify` 退出码 0。
- 版本链完全一致：`package.json 1.2.5` == gradle `1205/1.2.5` == APK badging == `SW xinshi-v32`。

---

## 八、合并裁定与去重

### 8.1 合并统计

| 组 | 附录条数 | 去重后 | P1 | P2 | P3 |
| --- | --- | --- | --- | --- | --- |
| A 数据层 | 13 | 13 | 1 | 2 | 10 |
| B 计薪 | 16 | 15 | 1 | 3 | 11 |
| C 前端 | 18 | 18 | 0 | 4 | 14 |
| D Android/发布 | 17 | 17 | 0 | 6 | 11 |
| **合计** | **64** | **63** | **2** | **15** | **46** |

**去重记录**：`A05`（health `payment-over-net` 误报）与 `B06` 为同一问题（`health.ts:274-283`），保留 A05 编号、删除 B06。

### 8.2 主代理裁定

1. **A04 由 P3 提级为 P2**：附录按「规则不可注入」定 P3；主代理认为它已导致 384 用例基线在 11-19 起必红，直接使发布验证结论失真，且坏红会掩盖真回归，故提为 P2。修复仍是 S 级。
2. **A01 维持 P1**：附录与主代理独立复核一致。定级依据是后果（账本记录静默永久丢失）而非概率；但明确标注触发窗口为一个渲染周期、Android 单窗口不受影响、且属于上轮 fixes §8.1 已披露的已知残留（**非新回归**）。若不接受「多标签页可能丢数据」，应按 P1 排期，不建议降级。
3. **B01 维持 P1**：算钱错误且偏差达 −30%，有真实模块复现与 v1.2.4 对比。触发人群限「月薪 + 非月结周期」（当前 UI 强制月结，来源为导入 / 手改 / 遗留），与上轮 PAY-01 同一人群，故同级。
4. **A06 维持 P3**：「清空所有数据」残留批量模板等 10 个键，属本地残留、非外泄；但建议随 A10 一起修（同为「清空不彻底」）。
5. **B15 / A13 / C09 / D16 标「存疑」**：均为设计选择或需真机/渲染验证，不计入修复工作量估算。

### 8.3 「同类路径未扫全」模式（本轮仍然成立）

上轮 §8.2 的结论是「残留缺口呈同一模式——同类路径未扫全」。本轮**再次复现**：

| 上轮修的类 | 修了 | 漏了 |
| --- | --- | --- |
| 时间炸弹（D28） | `storage.test.ts` / `trash.test.ts` → `daysAgo()` | `health.test.ts` 的 `lastToday`（→A04） |
| 隐藏金额（UI-05） | 首页 / 计时弹层 | 工作管理岗位卡、撤销结算弹窗、超休 placeholder、二维码（→C01/C08） |
| 预缓存离线（UI-11） | 全部路由 chunk | 字体 `xinshi-sans.ttf`（→C02） |
| 发布守卫（AND-03） | `debuggable` / `webViewDebug` | `-Pxinshi.diag`（→D01） |
| 发布门禁（AND-05） | 白名单 / 邮箱 / 政策链接 / SW 递增 | aapt2 发现、产物版本、assets 漂移（→D02/D03/D04） |
| 跨标签页合并（D02） | 纯函数 updater | 整包 updater（→A01） |

**建议**：后续修复按「调用点全量清单」验收，而不是按单点验收 —— 例如修「隐藏金额」时用 `grep -rn 'rateLabel\|formatMoney\|amount'` 列出全部出口逐个勾；修「时间判定」时用 `grep -rn 'Date.now()\|new Date()' src/lib` 逐个核。本报告 §2.1 与 §8.3 已提供两份可直接使用的清单。

---

## 九、上轮 119 条修复核实汇总

| 组 | 上轮声称 | 本轮抽查 | 完整落地 | 部分落地 | 虚报 |
| --- | --- | --- | --- | --- | --- |
| A 数据（D01–D36） | 36 | 10 | 8 | 2（D02→A01、D22→A10） | 0 |
| B 计薪（PAY-01–29） | 29 | 12 | 9 | 3（PAY-01→B01、PAY-07→B03、PAY-15→B04） | 0 |
| C 前端（UI-01–42） | 42 | 10 | 4 | 6（UI-05/11/24/08/09/06） | 0 |
| D Android（AND-01–21） | 21 | 9 | 6 | 3（AND-03/05/06） | 0 |
| **合计** | **119** | **41** | **27** | **14** | **0** |

**结论**：v1.2.5 的修复**无一条虚报**（这项记录本身很值得保持），但**部分落地率 34%**，且部分落地的 14 条里有 2 条升格为本轮 P1（B01 回归、A01 残留）。修复记录 §五 的「43 文件 / 384 用例全绿」「15 PASS」「SW v31」三处与当前实测不符（384 中 2 红 / 16–19 PASS / v32），建议随本轮一起更正（D15）。

**上轮 8 项「未修复项」现状**：

| # | 项 | 现状 |
| --- | --- | --- |
| 1 | 隐私政策公网地址 / 邮箱 | 邮箱已换真实地址、政策页无死链、版本同步；**公开 HTTPS 托管仍未办理**（业务待办） |
| 2 | CSP | ✅ 已加（构建期 sha256 注入，产物级验证） |
| 3 | 崩溃诊断写公共 Download | ✅ release 已改私有目录；**但 `-Pxinshi.diag` 仍可绕过（→D01）** |
| 4 | 非整月周期超休重复扣 | ✅ 已改「只提示不自动扣」；新患：额度取当前设置（→B02） |
| 5 | 导入允许周期内未锁定工记 | ✅ 导入侧已拒收；体检仍未加对应规则 |
| 6 | Android 5–9 导出提示 | ✅ MoveSheet / DataSafety 已区分 `shared`；**自动备份仍静默（→A03）**、Android 5–9 清 cache 目录（→D17） |
| 7 | e2e 脚本漂移 | ⚠️ functional 28 个已迁移；截图/审计 28 个仍硬编码（→D07） |
| 8 | 测试债务 | ⚠️ 改善但仍在：新增 102 个用例，`storage.test.ts` 时间炸弹已修；`health.test.ts` 新爆（→A04） |

---

## 十、修复路线图（建议，本报告不实施）

> 工作量 S=半天内 / M=1–3 天 / L=3 天以上（含回归）。

### 批次 0 · 提交/发布前必须（S+S+M）

| 项 | 工作量 | 要点 |
| --- | --- | --- |
| **A04** 时间炸弹 | S | `health.ts` 改用注入 `today` + 守卫用例；同时把「384 全绿」置为「2 条已修」 |
| **B01** 封顶口径 | **先决策** | 决策 A（支持月薪×非月结）→ 累计封顶 / 应出勤天数口径（L）；决策 B（不支持）→ 导入归一 + 体检 + 文案（M）。无论哪种，先写「整月 / 单期 / 逐期合计」三断言 |
| **D15** 修复记录更正 | S | 384 用例 / PASS 数 / SW 版本与实测对齐，避免下一位审计者被文档误导 |

### 批次 1 · 数据安全（P1/P2，S–M）

| 项 | 工作量 | 要点 |
| --- | --- | --- |
| **A01** 整包 updater | S（方案 1） | `settleJob` / `generateRecurring` 改成语义 updater；或 `stateMerge` 标记整包写入 |
| **A03** 自动备份 `shared` | S | 不写 `lastRunAt`、保留 `lastError`、`warning` 接 toast；与 D03 同口径 |
| **A02** 保存失败回滚 | S–M | 保留 `pendingUpdaters` 或回滚到最后 `lastPersistedRaw`；失败升级为阻塞恢复 |
| **A06/A10** 清空彻底 | S | `clearStoredState` 覆盖全部 `xinshi.*` 键；DataSafety 增加「同时删除快照」 |

### 批次 2 · 金额口径（P2，M）

| 项 | 要点 |
| --- | --- |
| **B02** 超休额度快照化 | 结算时把 `job.rest` 快照进 settlement；`updateJob` 对已锁定周期给警告 |
| **B03** 负净额递延 | 借支余额 `remaining` 递延下期；PaymentSheet 区分「倒欠 / 结转」 |
| **B04** 校验码拆分 | 结算码（不含收款）+ 收款码；或 canonical 排除收款字段 |

### 批次 3 · 隐私与离线（P2，S–M）

| 项 | 要点 |
| --- | --- |
| **C01/C08** 隐藏金额扫全 | `RateLabel` 组件 + 撤销弹窗 / placeholder / 二维码逐个打码 |
| **C02** 字体离线 | 字体子集化进预缓存（推荐）或进入页面预热 + 置灰 |
| **C03** 红条遮挡 | 改 `sticky` 占位或顶部 padding；z-index 降到 header 下 |
| **C04** 返回键 | 子页 / 弹层 `pushState`，`popstate` 优先关闭 |
| **A04** 见批次 0 | — |

### 批次 4 · 发布链（P2，S–M）

| 项 | 要点 |
| --- | --- |
| **D01** diag 守卫 | 守卫加 `xinshiDiag`；release 强制 `XINSHI_DIAG=false` |
| **D02** aapt2 发现 | `local.properties` → env → 常见路径；找不到 FAIL |
| **D03** 产物版本/签名断言 | badging versionCode/versionName + `apksigner --print-certs` 指纹 |
| **D04** assets 漂移断言 | dist ↔ assets sha256 比对（白名单 cordova） |
| **D05** 上架材料 | 更新 1.2.5 / 1205 / 双 SHA；发布时自动生成片段 |
| **D06** `.env.example` | 去掉 example.com 或注释；检查对占位域名 FAIL |

### 批次 5 · 债务与卫生（P3，按需）

DEP-01/02/03 依赖升级（需回归 `cap sync`）｜D07 脚本硬编码｜D09 CI + audit 门禁｜D10 SW 导航缓存｜D11 release 索引 + mapping｜D14 gradle sha256｜B16/C15/C16 测试与性能｜其余 P3 见附录。

**回归建议**：每批修完跑 `pnpm typecheck && pnpm test && pnpm build && node scripts/check-release-config.mjs && node scripts/check-offline-csp.mjs`，并把「384 用例」的期望值写进 CI（而不是文档）；对 B01/A01/A04 三条必须补**反向用例**（错口径必须失败），否则测试只会保护 bug。

---

## 十一、附录与复现

| 附录 | 内容 | 规模 |
| --- | --- | --- |
| [A · 数据层](audit-r3/appendix-A-data.md) | storage / store / snapshots / trash / backup / crypto / health / autoBackup 逐文件；D01–D28 回归抽查；排除疑点 | 511 行 |
| [B · 计薪](audit-r3/appendix-B-pay.md) | 22 lib + 6 页面 + 5 组件；真实模块编译复现脚本；PAY 回归 12 条；排除疑点 14 条 | 426 行 |
| [C · 前端](audit-r3/appendix-C-ui.md) | 全部页面/组件/hooks；四类产物核验；1024 对比度手算；UI 回归 10 条 | — |
| [D · Android/发布](audit-r3/appendix-D-android.md) | APK/AAB 产物级验证（aapt2/apksigner/jarsigner/zipfile）；AND 回归 9 条；仓库卫生 | 295 行 |

**复现环境**：Windows MSYS bash；node v24.19.0；pnpm 11.21.0；JDK 17.0.12；Android SDK `D:/Android/Sdk`（`ANDROID_HOME` 未设，`local.properties` 有 `sdk.dir`）。

**本报告不构成对任何发现的修复授权**；所有改动请在单独分支按批次进行并在真机回归后合入。
