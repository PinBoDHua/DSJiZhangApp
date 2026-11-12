# 薪时 XINSHI · 前后端审计报告（v1.2.3 → 修复批次）

> 审计日期：2026-11-12
> 审计对象：`D:\DSJiZhangApp`（React 19 + TypeScript + Vite + Capacitor 6 / Android；无服务端，数据全部本地）
> 结论：修复 **P0 × 1、P1 × 9、P2 × 20+**；`typecheck` 0 错误、`test` 38 文件 / 282 用例全绿、`build` 通过、发布配置检查 8 PASS。

## 一、范围与方法

| 项 | 说明 |
| --- | --- |
| 应用形态 | 纯本地离线 App：账本 `localStorage`（schema v7）、照片与快照 `IndexedDB`、Android WebView 壳 + 自定义 `SaveFile` 原生插件、可选 PWA Service Worker |
| 「后端」口径 | 本项目无服务端；数据层（`src/lib/storage|snapshots|trash|backup|autoBackup|crypto`）、原生壳（`android/**`）与导出/备份链路按后端标准审计 |
| 基线 | `pnpm typecheck` 0 错误；`pnpm test` 37 文件 / 266 用例通过；`pnpm build` 成功 |
| 审计方式 | 6 路并行只读审计（数据层 / 计薪统计 / React 状态与组件 / 页面业务流 / 平台安全 / 测试质量），主代理逐条复核并用脚本验证，再分批修复 + 回归 |
| 约束 | 审计阶段零写操作；修复阶段按文件范围分工，最后统一 `typecheck`/`test`/`build` 验收 |

## 二、修复清单

### A. 数据安全与账本一致性

| # | 严重度 | 问题 | 位置 | 修复 |
| --- | --- | --- | --- | --- |
| A1 | **P0** | 跨标签页「读-改-写」整包覆盖：`loadStateDetailed` 每次读取都会回写 localStorage，storage 事件又复用它，导致另一窗口刚保存的账本可能被旧状态覆盖且无报错 | `storage.ts` `loadStateDetailed`；`store.tsx` storage 监听 | 只在「旧 key → v7 迁移」时回写；storage 监听增加 `pendingPersist` 守卫，本地有未落盘改动时先不回灌 |
| A2 | P1 | 隐私模式/策略禁用 `localStorage` 时被误判为「账本损坏」，用户被锁死在恢复页且无法自救 | `storage.ts`、`StorageRecovery.tsx`、`store.tsx` | `LoadStateFailure` 增加 `kind: 'unavailable' | 'invalid'`；不可访问时提示原因并提供「仍然进入（本次记录可能不保存）」出口，账本损坏仍强制人工恢复 |
| A3 | P1 | 导入不校验单笔上限：手改/第三方备份可写入 1000 小时、1e9 计件、1e12 奖金 | `storage.ts` `normalizeEntry` | 与录入/周期规则同一口径钳制：`hours/otHours ≤ 24`、`quantity/bonus/deduction ≤ 1e6`、`breakMinutes ≤ 1440` |
| A4 | P1 | 导入/恢复快照「提示成功但重启回滚」：`replaceState` 只改内存，落盘失败只弹一次 toast | `store.tsx`、`Profile/Snapshots/Health/MoveSheet` | `replaceState` 改为**先同步落盘成功再切状态**并返回 `boolean`；各页面失败时明确报错、不提示成功 |
| A5 | P1 | Android 5–9 走系统分享面板时，用户可能取消保存，但前端已按「已备份/已导出」处理（重置 14 天备份提醒、自动备份记成功） | `autoBackup.ts`、`DataSafety.tsx`、`Profile.tsx` | 识别 `'shared'` 结果：不调用 `markBackedUp`，提示「已打开系统分享面板，请确认文件已保存」；自动备份给出确认警告 |
| A6 | P2 | 持久化失败只在第一次提示，之后整段失败期静默，用户会继续录入只存在内存的数据 | `store.tsx`、`App.tsx` | 新增全局 `storageError`，App 顶部常驻告警条（直到保存成功），引导先导出备份 |
| A7 | P2 | 删除工记照片时先删 IndexedDB、后异步落盘账本，落盘失败会「记录还在照片没了」 | `EntryEditor.tsx` | 先 `persistNow()` 成功再 `deletePhoto`，失败保留照片并提示 |
| A8 | P2 | 导入前/清空前等「安全快照」可能因与最新自动快照同 hash 被静默跳过，页面仍说「已留快照」 | `snapshots.ts` `saveSnapshot` | 手动/安全类快照只与**手动组**同 hash 比较；自动/每日快照维持与最新一份比较 |
| A9 | P2 | 读取快照完全不校验已存 `hash/bytes`，被清理工具改过的快照会被当成正常账本静默恢复 | `snapshots.ts` `readSnapshotState` | 解压后用 sha256（旧数据回退 fnv1a）比对 `hash`，不一致报「快照已损坏」 |
| A10 | P2 | 休息日导入不查重复 ID，取消一天休息会连带删掉另一天 | `storage.ts` | 增加 `restDayIds` 唯一性校验，重复即拒绝导入 |
| A11 | P2 | 回收站 30 天保留期只在启动/导入时清理，长驻会话里过期记录仍可恢复 | `trash.ts` | `trashRestoreBlockReason` 增加过期拦截（「已超过 30 天保留期」） |

### B. 计薪 / 结算 / 统计口径

| # | 严重度 | 问题 | 位置 | 修复 |
| --- | --- | --- | --- | --- |
| B1 | **P1** | 固定月薪 + 周结/日结时，「未结合计/首页待结/工作管理待结」按整自然月发整月工资（2 天工记显示待结 ¥3500，实际本期应结 ¥318.18，最高高估 7.3 倍） | `settlement.ts` `computeOutstanding`/`getSettlementOverview` | 新增 `summarizeUnsettledJob`：按「岗位 × 结算周期」逐期 `buildSettlementDraft` 汇总；`sumEntriesCapped` 增加 `monthlyFullMonth` 选项，非月结周期一律按周期折算（含 28 天 2 月恰好等于整周的极端情况） |
| B2 | **P1** | 结算列表「本期应结」未传休息天数，固定月薪超休扣款只在核对页出现，列表/首页/工作管理金额比真实结算高 | `settlement.ts` `getSettlementOverview` | 预览 draft 传入 `state.restDays` 与 `overRestDeduct`，与提交同一口径 |
| B3 | P1（修复过程中引入后自查） | 列表预览复用不含借支的中间 draft，导致「本期应结」不扣借支、卡片「借支 −」行消失 | `settlement.ts` | 预览始终用 `buildSettlementDraft(state.entries, state.advances, …)`；新增回归测试钉住「预览 net == 提交 net」 |
| B4 | **P1** | 同日多段日薪的「唯一日薪基数」结算侧取最早快照、统计侧取最新快照，调价当天两边差一笔钱 | `settlement.ts`、`insights.ts` | 新增 `dailyBaseEntryIds`：统一按 `createdAt` 最新快照去重，且不依赖入参顺序；统计/结算/图表/日历全部同源 |
| B5 | P2 | 统计「本周」合计与柱状图之和差 1 分（逐条先 round vs 汇总后 round） | `Stats.tsx` | 周/月档统一 `sumEntriesCapped(entries, period)`，与 `dailySeries` 同源 |
| B6 | P2 | 工资条文字版明细逐笔金额之和与结算单基础工资可能差 1–2 分（月薪逐日舍入、同日多段） | `payslipText.ts` | 明细页注明「明细金额为逐笔折算参考，合计以应发净额为准」 |
| B7 | P2 | 超休扣款输入框的「自动金额」用当前岗位费率，实际扣款用历史工记快照费率 | `SettlementPage.tsx` | placeholder 直接取 `draft.overRestDeduction`，与真实扣款一致 |
| B8 | P2 | 预算「不含未来工记」与固定月薪按整月计入口径矛盾 | `Home.tsx`、`Stats.tsx`、`budget.ts` | 文案补充「固定月薪按整月估算」，不改计算口径 |
| B9 | 性能 | 首页每次渲染把未结分析算 3 遍（1584 条工记时桌面 25ms、低端 WebView 更慢） | `settlement.ts`、`Home.tsx` | `analyzeUnsettled` 单遍分析 + 按 `state` 对象身份 `WeakMap` 缓存；首页删除重复的 `computeOutstanding` 调用，统一用 `overview.outstanding` |

### C. 页面业务流与交互

| # | 严重度 | 问题 | 位置 | 修复 |
| --- | --- | --- | --- | --- |
| C1 | **P1** | 提前结算「当前未结束周期」会把整段周期锁死，之后无法再记工且无提示 | `SettlementPage.tsx` | 周期未结束/未开始时在页脚与确认框明确警示「确认后该周期剩余日期将无法再记工，需先撤销结算」 |
| C2 | **P1** | 改「一周从哪天开始」或岗位结算周期后，旧结算与新区间重叠，剩余工记永远无法结算 | `Profile.tsx`、`JobEditor.tsx` | 保存前保守阻断（仅当已有结算单 + 存在未结工记 + 新周期与旧结算重叠），提示先撤销相关结算 |
| C3 | **P1** | 从已归档岗位的结算页/考勤页点「补记工」，编辑器会静默换成另一份工作，可能记错岗位 | `EntryEditor.tsx`、`SettlementPage.tsx`、`Attendance.tsx` | 指定岗位不可选时显示独立空态「已归档或已删除，不能补记工」且仅允许关闭；结算页/考勤页对归档岗位改为只读并阻止补记入口 |
| C4 | P2 | 「已结清」只判断未结工记，已结算但一分钱没收到时仍显示「工钱已结清」 | `Settlements.tsx`、`Home.tsx` | 新增「已结算待收」合计，`clear` 纳入待收；首页 hero 与结算页 receipt 区分「待结 / 已结算待收」 |
| C5 | P2 | 跨月结算单在两个月份重复计入应发/已收/待收与 CSV | `Settlements.tsx` | 按 `periodEnd` 归属月份，CSV 同口径 |
| C6 | P2 | 结算净额为 0/负数仍可直接落库，之后连「登记收款」都无法保存 | `SettlementPage.tsx` | 净额 ≤ 0 时增加「仍然结算」二次确认并提示核对额外扣款/借支 |
| C7 | P2 | 日薪/月薪加班时长超过总工时时被计薪层静默裁剪，提示却写「只影响统计」 | `EntryEditor.tsx` | 提交校验 `加班时长不能大于总工时`；提示文案改为「用于统计，同时是加班时长上限」 |
| C8 | P2 | 计时 25 小时带出 1 小时、正好 24 小时提示「不足 1 分钟」 | `timer.ts`、`Home.tsx`、`EntryEditor.tsx` | `TimerTimes` 增加真实 `hours`；≥24h 转手动模式按上限 24 带出并提示拆分核对 |
| C9 | P2 | 切换计薪方式后单价残留，可建出「月薪 25 元/月」 | `JobEditor.tsx` | 切换时清空单价并提示「单价单位已变化，请重新填写」 |
| C10 | P2 | 归档岗位从记录页进「月度考勤」显示「还没有工作」误导空态 | `Attendance.tsx` | 允许初始岗位为归档岗位，标注「已归档 · 只读查看」并禁用补记 |
| C11 | P2 | 工记详情「复制到今天」会静默把当天休息移入回收站 | `EntryDetail.tsx` | 复制前检测同日休息并提示「这天的休息已移到回收站」 |

### D. 隐私与可访问性

| # | 严重度 | 问题 | 位置 | 修复 |
| --- | --- | --- | --- | --- |
| D1 | **P1** | 「隐藏金额」只覆盖 `Money` 组件：柱状图当天柱顶现金额、读屏 aria-label、分享二维码、搬家包预览、快照合计、预算目标仍显示明文金额 | `BarChart`、`MonthCalendar`、`ShareQrSheet`、`MoveSheet`、`Snapshots`、`Profile` | 全部接入 `usePrivacy()`/`<Money>`，隐藏时打码或不朗读金额 |
| D2 | **P1** | 受控打开的 `Sheet`（回收站、预算等）焦点陷阱失效：焦点留在背景、Tab 可跑到被遮挡内容、关闭不归还焦点 | `Sheet.tsx` | `useModalFocus(open && visible, …)`，等弹层真正渲染后再挂焦点陷阱 |
| D3 | P2 | 点「撤销」时先关闭再执行动作，会吞掉排队中的后续提示、队列顺序错乱 | `Toast.tsx`、`store.tsx` | 先执行动作再关闭；队列非空时新提示一律排队 |
| D4 | P2 | 收款/借支金额输入框无可访问名称，读屏只报「spin button」 | `PaymentSheet.tsx`、`AdvanceSheet.tsx` | 增加 `aria-label`（已收总额 / 借支金额） |
| D5 | P2 | Android 返回键层级与页面内「返回」不一致：数据与安全子页直接退到底部 Tab；隐私政策子视图直接最小化 App | `App.tsx`、`PrivacyGate.tsx` | 返回键按页面父级回退；隐私政策子视图注册返回键关闭 |

### E. 平台 / 发布 / 安全

| # | 严重度 | 问题 | 位置 | 修复 |
| --- | --- | --- | --- | --- |
| E1 | P1（密钥卫生） | release 私钥与明文口令同目录落盘，`.gitignore` 只忽略目录、未覆盖 `*.jks/*.keystore/*.properties/.env` 文件类型 | `.gitignore` | 增补 7 类忽略规则（保留 `.env.example`）。已核实：keystore/口令**从未入库**，git 全历史无对应对象 |
| E2 | P2 | `FileProvider` 暴露整个外部存储根与 cache 根，实际只需 `cacheDir/exports` | `res/xml/file_paths.xml` | 收窄为 `<cache-path path="exports/">`；已确认当前无 `capture` 拍照输入 |
| E3 | P2 | 缺少 `signing.properties` 时静默产出不可上架的 unsigned release 包 | `android/app/build.gradle` | 增加 `taskGraph.whenReady` 守卫：真正产出 release 包且缺签名配置时抛 `GradleException`（debug/同步不受影响） |
| E4 | P0（发布侧） | 默认隐私政策 URL（`pinbodhua.github.io/...`）实测 404，支持邮箱为占位符 | `compliance.ts` | 代码侧缓解：`docs/privacy-policy.html` 复制进 `public/`（构建产物可离线访问），默认 URL 改为相对路径 `privacy-policy.html`；**上架前仍需用 `VITE_PRIVACY_URL`/`VITE_SUPPORT_EMAIL` 注入真实公开地址并人工确认** |
| E5 | P2 | 版本号 / SW 缓存版本 / 签名配置靠人工多处维护，易漂移 | `scripts/check-release-config.mjs`（新增） | 新增只读发布前检查：versionName/versionCode、SW 缓存版本、隐私 URL、敏感文件是否被跟踪、gitignore/FileProvider/签名守卫；`pnpm check:release`，当前 8 PASS |

### F. 测试

- 新增回归测试 **16 条**（`266 → 282`），覆盖本次修复的关键行为：
  - `settlementOverview.test.ts`（新增 6 条）：固定月薪月结/周结待结口径、超休扣款进入列表预览、借支进入预览、预览 = 提交金额、同日多段日薪按最新快照且顺序无关。
  - `storage.test.ts`（+4）：读取 v7 不回写、v6 迁移回写并删除旧键、导入字段钳制、休息日重复 ID 拒绝。
  - `snapshots.test.ts`（+4）：自动/手动/安全/每日快照去重语义。
  - `trash.test.ts`（+1）：30 天保留期边界与过期不可恢复（顺带消除既有用例的时间炸弹）。
  - `autoBackup.test.ts`（+1）：旧系统分享面板未落盘时不得记为已备份。

## 三、未修复项（需决策或发布侧处理）

1. **隐私政策公开地址与支持邮箱**：代码已内置离线政策页，但商店上架仍需真实可访问的 HTTPS 地址与可收信邮箱（见 E4）。
2. **CSP 未加**：`index.html` 有内联主题脚本且无 `Content-Security-Policy`。当前无 `innerHTML`/外部输入渲染，风险低；建议后续用构建哈希注入 CSP。
3. **崩溃诊断写公共下载目录**：`XinshiApp.export()` 在崩溃时写 `Download/Xinshi/xinshi-diag.txt`（设备型号/堆栈），隐私政策未披露。建议改为 app 私有目录或补充披露。
4. **非整月周期的超休自动扣款**：固定月薪 + 周结时按「周期占当月比例」折算额度，同一自然月被拆成多个周期时可能重复扣（如月内 5 天休息分三周记，扣 1.67 天而非 0）。属于口径决策，本次未改（改需跨结算单累计已扣天数，风险较大）；若产品认为不常见，可考虑非整月周期只提示、不自动扣。
5. **导入允许「结算周期内未锁定工记」**：仅对手改/第三方备份成立（App 自身写入路径已守卫），出于旧备份兼容未强制拒绝；账本体检会提示「结算单混入周期外工记」类问题。
6. **Android 5–9 其余导出提示**：CSV/Excel/工资条/照片等导出仍把「分享面板已打开」当成功提示（仅文案问题，无数据风险）。
7. **e2e 脚本漂移**：`scripts/functional*.mjs` 最后更新早于 v1.2.2/v1.2.3 的计薪修复，且 `pnpm test:e2e` 不启动 preview（硬编码 4173）。建议发布前补跑/更新。
8. **测试债务**（来自测试审计）：少量恒真/弱断言（如 `toBeGreaterThan(0)`）、store/pages 无单测（仅 e2e）、无 jsdom/coverage；数据层已补关键回归，其余建议后续迭代处理。

## 四、验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | ✅ 0 错误 |
| `pnpm test` | ✅ 38 文件 / **282** 用例通过（基线 266，+16 回归用例） |
| `pnpm build` | ✅ 通过（`dist/` 含 `privacy-policy.html` 8826 B；JS/CSS 正常分包） |
| `pnpm check:release` | ✅ 8 PASS / 0 FAIL（含 NOTE：正式包勿带 `-Pxinshi.debuggable`；上架前注入真实隐私 URL） |
| `git diff --stat` | 39 个已跟踪文件修改（+1088/−179），另新增 `public/privacy-policy.html`、`scripts/check-release-config.mjs`、`src/lib/settlementOverview.test.ts` |

**建议真机/预览重点关注**：① 固定月薪+周结的首页/结算页金额是否与实际结算一致；② 提前结算未结束周期的提示；③ 归档岗位从结算页/记录页进入的行为；④ 「隐藏金额」下首页柱状图、日历读屏、分享二维码；⑤ 导入备份/恢复快照时若存储写入失败是否能明确报错；⑥ Android 返回键在「数据与安全 → 子页」的层级。