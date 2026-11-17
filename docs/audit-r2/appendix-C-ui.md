# 薪时 XINSHI v1.2.4 · 前端 UI/状态审计发现（审计 C / task-3）

> 审计日期：2026-11-17 · 审计员：audit-ui（只读审计，未修改任何源码）
> 基线：git HEAD 6c0f682（工作树干净，由主代理提供）；上轮报告 docs/AUDIT-v1.2.4.md（2026-11-12）
> 范围：src/App.tsx、main.tsx、types.ts、pages/*（17）、components/*（33）、hooks/*（5）、styles.css、index.html、public/sw.js、public/manifest.webmanifest；store.tsx 仅消费侧（selector/dispatch/竞态）。
> 方法：ops_inspect_local_file 全文分页阅读 + ops_grep 横切搜索；两处疑似反斜杠问题用十六进制视图复核原始字节（见文末「已排除的疑点」）。
> 严重度：P0=数据丢失/安全/发布阻断；P1=重大功能错误、隐私泄露；P2=一般缺陷/边界/体验；P3=质量/债务。

---

## 一、新发现（P1 / P2）

### UI-01 [P1] 搬家包导出在 Android 5–9 分享面板路径下「假成功」：未落盘也 markBackedUp 并显示已保存（A5 修复漏掉 MoveSheet）
- 位置：src/components/MoveSheet.tsx:109-116
  ```ts
  const saved = await saveTextFile(filename, text);
  markBackedUp();
  setResult({ checksum: ..., filename, path: saved === 'native' ? `下载/Xinshi/${filename}` : filename });
  toast('搬家包已导出', 'success');
  ```
  对照已修复路径：src/pages/Profile.tsx:182-185、src/pages/DataSafety.tsx:90-93 均先判 `result === 'shared'` 再决定是否 markBackedUp。
- 问题与证据：saveTextFile 在 Android 9 及以下返回 'shared'（src/lib/native.ts:33-35、src/lib/saveFile.ts:6-7 注释、SaveFilePlugin.shareViaLegacy）。MoveSheet.doExport 不识别 'shared'：用户在系统分享面板点取消、文件根本没保存，仍然①重置 14 天备份提醒（markBackedUp）②结果页显示「搬家包已保存」③toast 成功。上轮 A5（P1）只修了 autoBackup/DataSafety/Profile 三处，MoveSheet 这条最主要的换机导出路径被漏掉。
- 影响/触发条件：Android 5–9 真机 → 数据与安全 → 搬家 → 导出搬家包 → 分享面板弹出后取消/返回 → 界面宣称已保存、备份提醒被重置；用户换机或清缓存后账本丢失且无任何提醒。
- 建议方案（不实施）：与 Profile/DataSafety 同口径：`saved === 'shared'` 时不调用 markBackedUp，结果页/toast 改为「已打开系统分享面板，请确认文件已保存」，并提供「我已保存」手动确认后再 markBackedUp。
- 置信度：已确认（代码级证据 + 'shared' 路径存在性由 saveFile.ts/SaveFilePlugin.java:62,128 佐证；未真机复现）。

### UI-02 [P2] 撤销结算：等待快照期间返回/离开页面没有任何取消守卫，撤销照样执行且 onBack() 劫持后续导航
- 位置：src/pages/SettlementPage.tsx:932-961（handleUndo）
  ```ts
  if (undoingRef.current) return;
  undoingRef.current = true;
  setConfirmOpen(false); setUndoBusy(true);
  try {
    try { await saveSnapshot(state, 'before-undo-settlement'); } catch ...
    const ok = undoSettlement(settlement.id);
    if (ok) { toast('已撤销结算…'); onBack(); }
  ```
  onBack 来自 App.tsx:433-436：`setPage(null); setTab('settlements')`。
- 问题与证据：undoingRef 只防连点（933 行注释），不防卸载/取消。await saveSnapshot 期间（大账本压缩+IndexedDB 写入可达数百毫秒以上）：①SubPage 返回按钮与 Android 返回键（App.backRef，App.tsx:155）都未被 undoBusy 禁用，用户可离开页面；②组件卸载后 await 恢复，undoSettlement 仍执行；③随后 onBack() 在已卸载组件上调用 App 的 setPage/setTab——若用户此时已打开另一张结算单或别的子页，会被强行拽回结算 Tab。上轮修复（快照失败即中止、连点守卫）落地，但「等待期间取消」窗口仍在，与任务提示一致。
- 影响/触发条件：结算单 → 撤销 → 确认 → 快照写入期间按返回 → 打开另一张结算单 → 第一笔撤销完成时页面被切走；用户主观上「已取消」的操作实际生效。
- 建议方案：加 mountedRef/AbortController：卸载即放弃后续 undoSettlement 与 onBack；或 undoBusy 期间禁用 SubPage onBack 与 pushNativeBack 回调（参考 MoveSheet.tsx:373 `onClose={busy ? () => undefined : onClose}` 的做法）；onBack 前检查组件是否仍挂载。
- 置信度：已确认（代码路径完整；竞态时序未真机测量，快照耗时随账本增大）。

### UI-03 [P2] 导入/恢复快照后自动周期补记不会重跑：autoRecurringDay 守卫使 ledgerSeq 依赖形同虚设（注释与实现矛盾）
- 位置：src/App.tsx:191-201
  ```ts
  // 导入 / 恢复快照 / 清空会换掉整本账本（ledgerSeq 变化），必须像首次打开一样重跑。
  if (autoRecurringDay.current === today) return;
  autoRecurringDay.current = today;
  const result = generateRecurring({ automaticOnly: true, today });
  ```
  deps 含 ledgerSeq（201 行），但 autoRecurringDay 只在 142/195/196 行出现，没有任何地方在 ledgerSeq 变化时重置它。
- 问题与证据：同一天内导入含 auto 规则的备份/恢复快照后，effect 因 ledgerSeq 变化重跑，但 ref 守卫 `=== today` 直接 return，新账本的自动补记当天不再执行，要等到第二天。注释声称的行为未实现。
- 影响/触发条件：当天已打开过 App（自动补记已跑）→ 导入搬家包/恢复快照（带启用+auto 的规则）→ 当天不会为新规则补记；用户以为导入即生效。
- 建议方案：用 ref 记录上次 ledgerSeq，变化时重置 autoRecurringDay.current=''；或把守卫改为 `${ledgerSeq}:${today}` 组合键。
- 置信度：已确认。

### UI-04 [P2] C4 残留：首页岗位卡与工作管理「已结清」徽章仍未纳入「已结算待收」，与 hero/结算页口径互相矛盾
- 位置：src/pages/Home.tsx:738-750
  ```tsx
  {pending && pending.outstanding !== 0 ? (…待结/借支待抵…) : (
    <div className="job-card-clear"><Check size={13} />已结清</div>
  )}
  ```
  src/pages/Jobs.tsx:55-61 同构（pending===0 → 「已结清」）。pendingByJob 来自 overview.jobs[].outstanding（仅未结工记，Home.tsx:242、Jobs.tsx:24）。
- 问题与证据：C4 修复了 Settlements.tsx:56-57（clear 纳入 settledRemaining）与 Home hero（399-415 区分待结/已结算待收），但岗位级卡片仍只看未结 outstanding。某岗位结算后一分钱没登记收款时：hero 显示「已结算待收 ¥N」，同一屏的岗位卡却显示「已结清」。
- 影响/触发条件：结算一期 → 不登记收款 → 回首页/工作管理 → 岗位卡「已结清」误导用户以为钱已两清。
- 建议方案：按 job 汇总 remainingAmountOf(settlements) 并入岗位卡判定（>0 显示「待收」），与 hero 同口径。
- 置信度：已确认。

### UI-05 [P2] D1 残留：首页岗位卡单价明文渲染（rateLabel 绕过 Money/usePrivacy），违反「隐藏金额」开关对首页的承诺
- 位置：src/pages/Home.tsx:734-737
  ```tsx
  <p className="job-card-rate">
    {rateLabel(job.rule.payType, job.rule.rate, job.rule.unitLabel)} · {cycleLabel(job.cycle)}
  </p>
  ```
  rateLabel 返回纯文本金额（src/lib/meta.ts:57-63）。同类：src/components/TimerSheet.tsx:32（从首页计时入口打开）。开关承诺文案：src/pages/Profile.tsx:546「首页、记录、结算和详情不显示具体数字」。
- 问题与证据：hideAmounts=true 时首页 hero/最近明细/图表全部打码，但「我的工作」卡片仍显示「¥25/时 · 周结」「¥3500/月」等单价；计时选工作弹层同样明文。对照：详情页对单价已用 Money 打码（src/components/EntryDetail.tsx:172,179,186,192,350），口径不一致。工作管理/工作编辑页（Jobs.tsx:49、JobEditor.tsx:454,483）也明文，但不在开关承诺的四个页面内，属范围决策问题（见 UI-06 建议）。
- 影响/触发条件：开启隐藏金额 → 首页给旁人看 → 岗位卡直接暴露时薪/月薪单价（月薪即整月工资）。
- 建议方案：岗位卡/计时弹层的单价改用 `<Money value={rate} symbol={false}/> + 单位后缀`，或 hideAmounts 时整行打码；同时明确「单价是否属于隐藏范围」的产品口径并同步开关文案。
- 置信度：已确认。

### UI-06 [P2] D1 残留：导出预览面（工资条图片/分享文案、二维码内容与复制摘要）完全不跟随隐藏金额
- 位置：
  - src/components/PayslipSheet.tsx:204（`<img src={url}>` 预览图含全部明文金额）、144-146（navigator.share text 含 `应发净额 ${formatMoney(settlement.net)}`）；
  - src/components/ShareQrSheet.tsx:20,43,56（QR 由 createSettlementQrFor(settlement) 生成，内容含应发/已收/待收明文，src/lib/shareQr.ts:15-19；copy(qr.text) 明文进剪贴板）；屏上净额虽用 Money 打码（64 行），但二维码本身可被旁人直接扫出金额。
  - src/pages/SettlementPage.tsx:927-930（handleCopy：settlementCopyText 明文复制，不判 hideAmounts）。
- 问题与证据：上轮 D1 修复清单含「分享二维码」，实际只打码了屏上数字，QR 载荷/复制文本/工资条预览图未处理；任务检查单明确列出「二维码、导出预览」为 D1 覆盖面。这些是用户主动分享面，但与「隐藏金额」的防偷窥语义冲突：隐藏模式下打开工资条/二维码弹层，屏幕上就是完整明文金额图。
- 影响/触发条件：hideAmounts=true → 结算单 → 工资条/二维码 → 预览图/扫码/剪贴板全部明文；肩窥场景下隐私开关失效。
- 建议方案：产品决策二选一：①隐藏模式下这些弹层顶部加醒目提示「当前为隐藏金额模式，导出内容仍含明文金额」，或提供「本次临时显示」开关；②预览图默认打码、导出时才还原。至少保证复制/分享文案与开关状态一致或明确告知。
- 置信度：已确认（行为确定；严重度按「主动导出面」定为 P2，若产品认为导出即授权可降级）。

### UI-07 [P2] settleJob 绕过 commit()：不置 pendingPersist，跨标签页 storage 事件可在落盘前覆盖刚创建的结算单（A1 守卫的残留窗口）
- 位置：src/store.tsx:937-965
  ```ts
  const committed = commitSettlement(stateRef.current, {...});
  if (!committed) return null;
  // 同步推进 ref，避免同一渲染周期内第二次调用仍读取到旧状态。
  stateRef.current = committed.state;
  setState(committed.state);
  ```
  对照 commit()（303-308 行）：`pendingPersist.current = true` 后再 setState；storage 监听（264-280 行）以 pendingPersist 守卫回灌。
- 问题与证据：settleJob 是唯一直接 setState 而不置 pendingPersist 的写路径（replaceState 先落盘、resetAll/loadDemo 走 commit）。setState→渲染→持久化 effect 之间若收到另一标签页的 storage 事件，onStorage 见 pendingPersist=false → 读入远端旧账本 setState → 本窗口刚结的算被覆盖，且随后持久化 effect 把远端状态写回，静默丢失结算单。
- 影响/触发条件：PWA 双开（或浏览器多标签）→ A 窗口确认结算的同一瞬间 B 窗口写入账本 → A 的结算单消失、工记解锁状态回滚，无报错。窗口窄但真实存在，与 A1 修复目标直接相关。
- 建议方案：settleJob 改走 commit(() => committed.state)（保留 ref 同步语义），或在 setState 前手动 pendingPersist.current = true。
- 置信度：已确认（代码路径；竞态未真机复现，需双标签精确时序）。

### UI-08 [P2] 全局状态无 selector/value 无 memo：每次 toast 都触发全应用重渲染，Home/Records/Profile 大量派生计算无 useMemo
- 位置：
  - src/store.tsx:1092-1131（value 对象每次渲染新建，无 useMemo；toastState 变化也重渲染 StoreStateProvider）；
  - src/pages/Home.tsx:96-241（monthEntries filter、sumEntriesCapped、getSettlementOverview、lastUsedJobId/repeatEntry/recent 三次全量 sort、dailySeries、planStatusForJob×7 等全部裸算）；
  - src/pages/Records.tsx:82-144（latestDate 双重 reduce、monthEntries filter、groups Map、sumEntriesCapped、plannedWorkDates、逐日 sumEntries 在渲染内 468 行）；
  - src/pages/Profile.tsx:118（sumEntriesCapped(state.entries) 每次渲染）。
- 问题与证据：useStore() 返回整包 value，任何 state/toastState/ledgerSeq/storageError 变化 → 所有消费组件重渲染。toast 在每次记工/删除/结算/同步时都会出现并 2.8–5.2s 后消失，即每个操作至少触发 2 轮全量重渲染。B9 只给 analyzeUnsettled 加了 WeakMap 缓存（state 身份不变时命中），但上述 filter/sort/sum 无缓存。1584 条工记基准（B9 描述）下每轮数十毫秒级，低端 WebView 更甚。
- 影响/触发条件：千条级账本 → 任意操作弹 toast → 首页/记录页整页重算重渲染 → 输入卡顿、掉帧。
- 建议方案：value 用 useMemo 稳定化；拆分 state 与 toast 两个 context（或 useSyncExternalStore+selector）；页面级派生数据 useMemo（依赖 state.entries 等具体引用）；EntryRow 加 React.memo（EntryRow.tsx:32 每行每次 payForEntry）。
- 置信度：已确认（未跑 profiler，量级引用上轮 B9 的 25ms 基准）。

### UI-09 [P2] 千条级列表无虚拟化/分页：记录页整月全量渲染、搜索命中全量渲染
- 位置：src/pages/Records.tsx:463-506（dates.map → 每日全部 EntryRow）；src/pages/Search.tsx:185-219（groups.map → 全部命中行）；src/components/EntryRow.tsx:32-33（无 memo，每次渲染 payForEntry）。
- 问题与证据：记录页按月渲染全部工记（多岗位×多段班次的大月可达数百上千行），搜索如「加班」可命中全账本；无 windowing、无「加载更多」、无 memo。叠加 UI-08 的 toast 重渲染，成本成倍。
- 影响/触发条件：导入多年账本（数千条）→ 记录页/宽泛搜索 → 首帧与每次交互明显卡顿，低端机可能 ANR 级延迟。
- 建议方案：长列表虚拟化（react-window 类）或分段折叠+分页；EntryRow memo 化；搜索结果上限+「查看更多」。
- 置信度：已确认（结构证据；未实测帧率）。

### UI-10 [P2] 录入侧奖金/扣款无上限，导入侧钳制 1e6：导出→导入往返会静默改数（A3 口径不一致）
- 位置：src/pages/EntryEditor.tsx:451-452（`bonus: round2(Math.max(0, toAmount(bonus)))`，deduction 同；输入框 1019-1043 无 max）；src/store.tsx:414-420（addEntry 只校验有限且 ≥0）；对照 src/lib/storage.ts:379-383（normalizeEntry：hours/otHours≤24、quantity/bonus/deduction≤1_000_000）。
- 问题与证据：手工录入奖金 2,000,000 可保存（计薪层正常计算）；导出备份后在新机导入，同一笔被钳到 1,000,000，金额静默减半且无提示。JobEditor 单价、Recurring 规则奖扣（store 校验 ≤1e6，Recurring.tsx 编辑器无上限提示）与 SettlementPage 额外奖扣也存在类似「录入宽、导入紧」的口径差。
- 影响/触发条件：大额奖金/扣款（>1e6）录入 → 换机导入 → 金额被钳制，账实不符。
- 建议方案：录入侧与导入侧同一上限（提交校验 >1e6 报错），或导入钳制时给出明确差异提示；至少保证往返一致。
- 置信度：已确认（两端代码对照；未实际跑导入）。

### UI-11 [P2] SW 预缓存清单不含任何 JS/CSS（更不含懒加载 chunk）：新装 PWA 首次离线访问未走过的路由直接落到根错误边界
- 位置：public/sw.js:4-11（CORE 仅 '/'、'/index.html'、manifest、favicon、两个 icon）；src/App.tsx:25-66（14 个 lazy 路由）；src/main.tsx:21-27（PROD && !nativeShell 注册）。
- 问题与证据：构建产物是哈希命名的 JS/CSS chunk，全部依赖运行时缓存（sw.js:66-86 访问过才缓存）。安装后未在线访问过的懒加载页（统计/我的/各子页）离线时 import 失败：vite:preloadError → main.tsx:30-40 刷新一次 → 仍离线 → React lazy 抛错 → 只有根级 ErrorBoundary（main.tsx:10-12）→ 整应用变成「页面出错了」错误屏，而不是该页骨架屏。离线是核心卖点，首装离线体验断裂。
- 影响/触发条件：用户安装 PWA 后立刻断网（或首次在线只看了首页）→ 切到「统计/我的」→ 错误屏；刷新无效。
- 建议方案：构建期生成预缓存清单（vite-plugin-pwa/workbox injectManifest）把入口与全部路由 chunk 纳入 CORE；或至少离线 import 失败时展示「该页尚未缓存」的页内降级而非整应用错误边界。
- 置信度：已确认（清单与路由结构证据；离线行为未真机复现）。

### UI-12 [P2] 「复制到今天」沿用历史工记的计薪快照（旧单价），调价后复制会按旧价计薪且无提示
- 位置：src/components/EntryDetail.tsx:126-140
  ```ts
  const created = addEntry({ jobId: entry.jobId, date: today, …, rule: entry.rule, … });
  ```
- 问题与证据：新建工记正常路径取岗位当前 rule（EntryEditor.tsx:204-205），而复制到今天直接复用旧 entry.rule 快照。岗位上周调价后，复制上月工记到今天仍按旧单价计算；toast 只说「已复制到今天，可去记录里调整」，不提示单价差异。bonus/deduction 归零、holiday 归 false 是有意的（复制班次不复制钱），但 rule 沿用旧快照与「新工记用当前价」的全局口径（JobEditor.tsx:1091-1093 脚注）不一致。
- 影响/触发条件：调价 → 打开旧工记 → 复制到今天 → 新工记按旧价计薪，用户不易察觉。
- 建议方案：复制时改用岗位当前 rule（与编辑器一致），或在 toast/详情中明示「按记录时单价 ¥X 复制」；若属有意设计请补文案。
- 置信度：已确认（行为确定；是否属有意设计存疑，建议产品确认）。

---

### UI-13 [P2] --muted-2 文本色在明/暗两主题下均低于 WCAG AA 对比度，且用于功能性小字（上班/下班标签、已结算/折算标签、回收站剩余天数等）
- 位置：src/styles.css:14（浅色 --muted-2:#98a198）、7848（暗色 --muted-2:#6d7b72）；使用点：104（placeholder）、1700（.entry-row-amount small「月薪折算/计件/已结算」）、3421（结算明细同类标签）、9741（.time-box span「上班/下班」）、10644（.trash-meta 删除日期/剩余天数）、8343（.privacy-gate-note）、9537（.eyebrow）、6763（.onboarding-fineprint）等 30 处。
- 问题与证据：按 WCAG 相对亮度公式计算：浅色 #98a198 对 #F4F6F5 ≈ 2.4:1；暗色 #6d7b72 对 #17211c ≈ 3.7:1。均低于正文 4.5:1（AA）。这些不是纯装饰文字，而是表单标签与状态标签。
- 影响/触发条件：户外强光/低亮度屏幕下，记工表单「上班/下班」、列表「已结算」标记、回收站「还剩 N 天」难以辨认；读屏不受影响但低视力用户受损。
- 建议方案：--muted-2 调深（浅色≈#77817a、暗色≈#8a968c 起步）或把功能性标签改用 --muted/--ink-soft；装饰性 eyebrow 可保留。
- 置信度：已确认（色值计算；未用对比度仪实测渲染合成色，暗色 hero 渐变上的半透明文字另需实测）。

## 二、P3 发现（质量/边界/体验/债务）

### UI-14 [P3] 导入/清空等待快照期间：第二次确认静默 no-op、无进度指示
- 位置：src/pages/Profile.tsx:277-278（`if (!pendingImport || importBusy) return;`）、302-303（clearWithSnapshot 同）。
- 问题与证据：confirmImport 先关确认框再 await saveSnapshot；期间用户再选一份文件并点「覆盖并导入」，因 importBusy=true 直接 return，无任何提示；快照等待期也没有 busy UI。MoveSheet 用 `onClose={busy ? noop : onClose}` + 按钮文案「正在留快照…」处理得更好（MoveSheet.tsx:373,525）。
- 影响/触发条件：大账本导入快照耗时数秒 → 用户以为没点上/卡死，反复操作。
- 建议方案：busy 时给出 toast/禁用态文案；或复用 MoveSheet 的阻塞式关闭。
- 置信度：已确认。

### UI-15 [P3] 周期规则编辑器拒绝保存归档岗位的规则，与 store「归档后仍可改规则」口径冲突
- 位置：src/pages/Recurring.tsx:231（jobs 含规则自身的归档岗位）、257（`if (!job || job.archived) return setError('请选择一份进行中的工作')`）；对照 src/store.tsx:700-703（updateRecurringRule allowArchivedJob）。
- 问题与证据：列表上的启用开关可直接改归档岗位规则（152-155 行），但打开编辑弹层改 auto/工时/日期后保存必报错；auto 开关只在编辑器里，归档岗位无法经编辑器关闭 auto（只能整条停用）。
- 影响/触发条件：归档岗位 → 周期记工 → 编辑规则 → 保存失败。
- 建议方案：编辑器对「规则原岗位且已归档」放行（与 store 同口径），或明示「归档岗位仅能启停」。
- 置信度：已确认。

### UI-16 [P3] Toast 动作按钮连点会触发下一条排队提示的动作
- 位置：src/components/Toast.tsx:26-41（onClick 执行 action 后 onClose）；src/store.tsx:215-226（dismissToast 立即 shift 队列并渲染下一条）。
- 问题与证据：第一次点击后队列下一条立刻上屏（key=toast.id 重建 DOM），~150ms 内的第二次点击落在新 toast 的同位置按钮上；若下一条也带动作（如连续删除后的两个撤销），会误触发第二个动作。
- 影响/触发条件：快速双击「撤销」→ 撤销两次不同删除（或误关下一条）。
- 建议方案：动作点击后局部 disable/加一次性 ref；或队列推进延迟一帧。
- 置信度：已确认（时序推理；未真机复现双击）。

### UI-17 [P3] ConfirmDialog 滚动锁 effect 依赖 onCancel：父级每次渲染都解锁/重锁并重挂监听
- 位置：src/components/ConfirmDialog.tsx:39-53（deps `[open, onCancel]`，onCancel 多为内联箭头函数）。
- 问题与证据：确认框打开期间父组件任何重渲染（toast、计时 tick 引起的 store 更新）都会 releaseScroll()+lockBodyScroll()  churn；引用计数下结果正确但无谓开销，且与 Sheet 的 `[open]` 依赖不一致。
- 影响/触发条件：确认框叠加在频繁更新的页面上时持续 churn。
- 建议方案：onCancel 存 ref（已有 cancelRef），deps 改 `[open]`。
- 置信度：已确认。

### UI-18 [P3] useAutoSnapshot 每日快照的 1600ms setTimeout 未跟踪/未清理
- 位置：src/hooks/useAutoSnapshot.ts:59-66。
- 问题与证据：tryDaily 内 setTimeout 无句柄；卸载或 enabled 变 false 后仍会执行 saveSnapshot（读 stateRef）。StrictMode 下因 scheduledDay ref 守卫不会重复，但卸载路径无取消。
- 影响/触发条件：打开后 1.6s 内退出/切换（罕见）→ 后台多拍一张快照；无数据风险。
- 建议方案：timer 存 ref，effect cleanup 清理。
- 置信度：已确认。

### UI-19 [P3] ErrorBoundary 仅根级：任何子页渲染异常/懒加载失败都整应用落错误屏
- 位置：src/main.tsx:8-14；src/App.tsx:448,459,463（Suspense 无页级边界）。
- 问题与证据：14 个 lazy 路由共享根边界；单页数据触发的渲染错误会吞掉整个导航。vite:preloadError 刷新（main.tsx:30-40）只缓解 chunk 404，不缓解渲染错误。
- 影响/触发条件：某页边界数据渲染抛错 → 全应用错误屏，只能刷新。
- 建议方案：renderPage/renderTab 外包页级 ErrorBoundary（fallback 提供返回按钮）。
- 置信度：已确认。

### UI-20 [P3] 快照页「最多保留 N 个」把当前数量当上限展示
- 位置：src/pages/Snapshots.tsx:169-170（`最多保留 {metas.length > 0 ? `${metas.length} 个` : '30 个'}`）。
- 问题与证据：有 12 张快照时文案为「最多保留 12 个」，实际上限是 30（SNAPSHOT_MAX_BYTES/张数上限由 lib 决定）。
- 影响/触发条件：用户误以为快照已满不会再留底。
- 建议方案：固定展示真实上限。
- 置信度：已确认。

### UI-21 [P3] 体检「一键解锁」快照失败被静默吞掉，注释声称 Toast 会说明但实际没有
- 位置：src/pages/Health.tsx:56-72（catch 空注释「快照失败仍允许修复，Toast 里说明」；成功 toast 仅「已解锁 N 条记录」）。
- 问题与证据：saveSnapshot 失败后继续 applySafeFixes+replaceState，用户不知道没有留底。
- 影响/触发条件：IndexedDB 不可用/满时修复孤儿锁 → 无快照可回退。
- 建议方案：失败时 toast 追加「未留快照」警示，或中止修复。
- 置信度：已确认。

### UI-22 [P3] 已知未修复项 #6 核实：Android 5–9 分享面板仍被当成功提示（逐处清单）
- 位置与证据（result==='shared' 或忽略 result 时报成功）：
  - src/pages/Attendance.tsx:150-154（考勤 CSV「已导出」）
  - src/pages/DataSafety.tsx:166-171（完整工记 CSV）、182-187（结算流水 CSV，完全忽略 result）、149-150（Excel，忽略 saveBlobFile result）
  - src/pages/Settlements.tsx:72（工资流水 CSV「已下载」）
  - src/components/ShareQrSheet.tsx:30-34（二维码「已保存」）
  - src/components/PayslipSheet.tsx:126-130（工资条图）、159（PDF）、174-178（文字版 PDF）
  - src/components/EntryDetail.tsx:157-159（考勤照片「已保存」）
  - src/components/BatchPlanSheet.tsx:284-288（模板「已生成」，措辞稍弱）
  对照已修：Profile.tsx:182-185、DataSafety.tsx:90-93、ErrorBoundary.tsx:60-65、StorageRecovery.tsx:27-31。
- 影响/触发条件：旧系统导出 → 分享面板取消 → 成功提示；仅文案问题（备份提醒重置只在 MoveSheet 发生，见 UI-01）。
- 建议方案：统一封装 saveTextFile/saveBlobFile 的结果→文案映射，'shared' 一律「已打开分享面板，请确认保存」。
- 置信度：已确认（与上轮报告「未修复项 #6」一致，仍未修）。

### UI-23 [P3] 多处选择态按钮缺 aria-pressed，读屏无法感知当前选中
- 位置：src/pages/EntryEditor.tsx:689-704（工时模式 tabs）、636-647（job-choice）、748-760（休息 chips）；src/components/PaymentSheet.tsx:138-147（收款方式）；src/components/RestSheet.tsx:115-125、RestPlanSheet.tsx:159-172（job-choice）；src/pages/Home.tsx:619-628（排班 tabs）；src/pages/Records.tsx:336-353、Search.tsx:99-118（筛选 chips）。
- 问题与证据：仅靠 class is-active 表达选中；对照 Segmented.tsx:37、TrashSheet.tsx:149、JobEditor 颜色/周排班均有 aria-pressed。
- 影响/触发条件：读屏用户无法知道当前计薪模式/筛选/收款方式。
- 建议方案：统一补 aria-pressed（或 role=tablist/tab+aria-selected）。
- 置信度：已确认。

### UI-24 [P3] visually-hidden 的文件输入仍在 Tab 顺序中（隐形可聚焦）
- 位置：src/styles.css:657-665（clip 方案，未移出 tab 序）；src/pages/Profile.tsx:852-858、src/components/MoveSheet.tsx:538-544、BatchPlanSheet.tsx:511-517（type=file + visually-hidden，均由 ref.click() 触发）。
- 问题与证据：键盘用户 Tab 会停在不可见的文件输入上，Enter 意外弹出文件选择器。
- 建议方案：这些 input 加 tabIndex={-1}（它们只被程序化点击）。
- 置信度：已确认。

### UI-25 [P3] 隐私政策子视图打开后焦点丢失到 body
- 位置：src/components/PrivacyGate.tsx:34-66（showPolicy 整屏替换，无焦点管理）。
- 问题与证据：触发按钮「查看完整隐私政策」随视图卸载，焦点落 body；键盘/读屏用户需从头 Tab。返回键已注册（18-21 行 ✓）。
- 建议方案：打开后 focus 返回按钮或 h1（tabIndex=-1）。
- 置信度：已确认。

### UI-26 [P3] D5 残留：结算单页 Android 返回与页内返回行为不一致
- 位置：src/App.tsx:155（backRef 兜底 `setPage(null)`）vs 433-436（SettlementRecordPage onBack 还 `setTab('settlements')`）。
- 问题与证据：从首页 hero 进入结算单：页内返回→结算 Tab；Android 返回→留在首页。其余子页（snapshots/health/privacy/jobs 等）两路一致。
- 建议方案：backRef 对 settlementRecord 复用与 onBack 相同的逻辑。
- 置信度：已确认。

### UI-27 [P3] 计时≥24h 提示重复弹两次（Home 与 EntryEditor 各一次）
- 位置：src/pages/Home.tsx:284-294（finishTimer toast）+ src/pages/EntryEditor.tsx:197-201（overlong effect toast），文案完全相同。
- 问题与证据：两条相同提示先后排队展示（store 队列机制）。
- 建议方案：只保留编辑器侧一次。
- 置信度：已确认。

### UI-28 [P3] 考勤照片水印在选图时固化，之后修改工时/日期/岗位不更新
- 位置：src/pages/EntryEditor.tsx:283-290（createWatermarkedPhoto 用调用时的 jobName/date/hours）。
- 问题与证据：先选图后改工时 → 照片水印与工记不一致；水印是「考勤证据」语义，不一致削弱可信度。
- 建议方案：保存时按最终值重打水印，或修改关键字段后提示重选照片。
- 置信度：已确认。

### UI-29 [P3] JobEditor 多个数字字段 max 属性不拦截提交，校验宽于 UI 约束
- 位置：src/pages/JobEditor.tsx:272-306（standardHours 仅 >0、expectedDays 仅 ≥1、OT 倍率仅 ≥1、rate 无上限）；对照输入属性 905（max16）、930（max31）、978/993/1008（max5）。
- 问题与证据：键盘输入可绕过 max 属性（type=number 的 max 不阻止输入），保存校验不复查 → 可存 standardHours=30、倍率=100、expectedDays=100、rate=1e9。
- 影响/触发条件：误输大数 → 计薪异常（如月薪÷100 天）。
- 建议方案：save() 内按 UI 同口径钳制/报错；rate 设合理上限。
- 置信度：已确认。

### UI-30 [P3] DataSafety 每次 state 变化都重跑 checkLedger + listSnapshots（含 toast 触发的重渲染）
- 位置：src/pages/DataSafety.tsx:67-80（refresh useCallback[state] + effect[refresh]）。
- 问题与证据：体检是全账本扫描（health.ts），快照列表走 IndexedDB；页面开着时每次记账/弹 toast 都全量重算，且异步 listSnapshots 无序号守卫，乱序返回可能旧覆盖新。
- 建议方案：deps 收窄到 state.entries/jobs/settlements 等实际引用或手动刷新；listSnapshots 加 seq。
- 置信度：已确认。

### UI-31 [P3] Stats 页 heatmap/budget 未 memo，与同页其它 useMemo 口径不一致
- 位置：src/pages/Stats.tsx:121-127（buildHeatmap(state.entries) 每次渲染全量扫；monthlyBudgetStatus 同）。
- 问题与证据：同页 entries/totals/series/breakdown 均已 memo（56-111 行），唯独热力图裸算。
- 建议方案：补 useMemo。
- 置信度：已确认。

### UI-32 [P3] store.restoreTrashItem 的 job 分支绕过 trashRestoreBlockReason（UI 已挡，纵深防御缺口）
- 位置：src/store.tsx:794-807（job 分支直接 commit，未调用 block reason）；对照 809-812（entry/rest/advance 先查 reason）；src/lib/trash.ts:228-229（过期检查对 job 同样生效）；src/components/TrashSheet.tsx:199,237（UI 用 blockReason 禁用按钮）。
- 问题与证据：当前唯一调用方 TrashSheet 已在 UI 拦截过期 job；但长开弹层跨过过期时刻后按钮状态不刷新，点击仍可恢复过期 job（entry 类则被 store 二次拦截）。
- 建议方案：job 分支同样先查 trashRestoreBlockReason。
- 置信度：已确认（触发条件极窄）。

### UI-33 [P3] 当日 24h 合计校验用裸浮点比较，无容差
- 位置：src/pages/EntryEditor.tsx:390（`otherDayHours + hours > 24`）；src/components/EntryDetail.tsx:120；src/pages/Home.tsx:213。
- 问题与证据：8.1+15.9 类组合可能产生 24.000000000000004 被误拒；同文件 OT 校验已用 1e-9 容差（EntryEditor.tsx:434），口径不一致。store 侧 wouldExceedDayLimit 是否容差未知（lib 归 B 路）。
- 建议方案：统一加 1e-9 容差或先 round2 再比较。
- 置信度：存疑（浮点边界取决于 hoursBetween/round2 的返回精度，未逐路径验证；验证方法：构造 7.9+16.1 等组合单测）。

### UI-34 [P3] 预算弹层提示文案缺「固定月薪按整月估算」，与 Home/Stats 口径说明不一致（B8 残留）
- 位置：src/pages/Profile.tsx:876（「只统计当前月且日期不超过今天的工记；未来计划不计入」）；对照 Home.tsx:360、Stats.tsx:262 均补了固定月薪说明。
- 问题与证据：固定月薪岗位月中预算进度按整月估算，Profile 弹层文案让用户以为只算到今天。
- 建议方案：同步补一句。
- 置信度：已确认。

### UI-35 [P3] 考勤页初始岗位被彻底删除时显示「还没有工作」误导空态
- 位置：src/pages/Attendance.tsx:66-69（initialJob 找不到→jobs=[]）、167-182。
- 问题与证据：C10 覆盖了归档，但删除场景仍落通用空态；从记录页筛选进入时用户以为岗位没了记录。
- 建议方案：区分「岗位已删除」空态。
- 置信度：已确认。

### UI-36 [P3] 非月薪周期空草稿页没有补记入口，只有一句「先补记一笔再结算」
- 位置：src/pages/SettlementPage.tsx:367-373（页脚文案）；onAddEntry 仅传给 AttendanceDaySheet（846-860，月薪日历专用）。
- 问题与证据：周结/日结本期无工记时，确认结算禁用，页面无任何补记按钮，需返回记录页操作。
- 建议方案：空草稿页脚加「补记一笔」按钮（onAddEntry(job.id, period.start)）。
- 置信度：已确认。

### UI-37 [P3] vite:preloadError 兜底：sessionStorage 不可用时每次错误都刷新，无 30s 节流
- 位置：src/main.tsx:30-40（catch 注释「仍刷新一次」，但无节流手段）。
- 问题与证据：隐私模式 sessionStorage 抛错时，若 chunk 持续失败（离线+未缓存），用户每次触发导航都整页刷新。
- 建议方案：内存变量兜底节流。
- 置信度：已确认（路径推理）。

### UI-38 [P3] SW activate 会删除同源下所有非 xinshi-* 缓存
- 位置：public/sw.js:27-31（`keys.filter((key) => !keep.has(key))`，keep 只含 xinshi-v*）。
- 问题与证据：同源若部署过其它应用/缓存（如 GitHub Pages 项目页），会被本 SW 清掉。独立域名下无影响。
- 建议方案：删除范围限定 `/^xinshi-v\d+$/` 且不在 keep 的键。
- 置信度：已确认。

### UI-39 [P3] 主题不跨标签页同步；index.html 内联脚本与 useTheme 逻辑重复且存储不可用时回退浅色
- 位置：src/hooks/useTheme.ts:20-33（无 storage 事件监听 THEME_KEY）；index.html:7-24（内联脚本；localStorage 抛错时保持浅色，即使系统暗色）。
- 问题与证据：A 标签切暗色，B 标签不变；隐私模式首屏浅色→挂载后才可能变暗（闪烁）。内联脚本行为本身正确（dataset.theme/colorScheme/theme-color 三件套与 useTheme 一致）。
- 建议方案：监听 storage 事件同步主题；内联脚本 catch 分支尝试 matchMedia 回退。
- 置信度：已确认。

### UI-40 [P3] manifest 缺 id 字段；maskable 复用 any 图标未验证安全区
- 位置：public/manifest.webmanifest:1-38（无 "id"；icon-512 同时作 any 与 maskable）。
- 问题与证据：缺 id 时浏览器以 start_url 推导身份，未来改 start_url 会被当成新应用；maskable 若图标贴边会被 launcher 裁切。icons 文件均存在（public/icons/* ✓）。
- 建议方案：加 "id": "/"；maskable 用带安全区内边距的专版。
- 置信度：已确认（裁切效果需真机验证）。

### UI-41 [P3] 多处触控目标 <44px
- 位置：src/styles.css:428-433（.icon-button--small 30×30，用于回收站恢复/彻底删除、借支删除）、11633-11636（.toast-close 最终 40×40）、10471-10473（.hero-eye 40×40）、5636-5639（.plan-day min-height 40）、3199-3202（.attendance-cell min-height 42，多岗位时宽度更窄）。
- 问题与证据：主 .icon-button 已被 10461-10464 提到 44px，但 --small 双类选择器优先级更高仍 30px；回收站两个危险操作按钮仅 30px 且相邻。
- 建议方案：--small 至少 36px+间距，关键操作 44px；toast-close/hero-eye 扩到 44。
- 置信度：已确认（CSS 层叠推算；未真机量测）。

### UI-42 [P3] TrashSheet/常挂弹层在关闭态仍随 state 重算派生数据
- 位置：src/components/TrashSheet.tsx:45-62（useMemo[state]，Profile.tsx:1060 / Jobs.tsx:147 常挂 open=false）；RestSheet/RestPlanSheet/BatchPlanSheet 同为常挂（Home.tsx:786-814）。
- 问题与证据：关闭时 buildTrashRows/排休候选等仍随每次 state 变化重算（memo 依赖 state 整包）。
- 建议方案：open=false 时短路（`open ? buildTrashRows(state) : []`）或条件挂载。
- 置信度：已确认。

## 附：已排除的疑点（验证过、不构成发现）

1. **sw.js:28 正则「双反斜杠」**：文本视图显示 `/^xinshi-v\\d+$/` 疑似匹配不到版本号导致 activate 清空全部缓存。十六进制复核（offset 592 行）原始字节为 `5c 64`（单反斜杠+d），正则正确，KEEP_VERSIONS=2 逻辑成立。系查看工具转义显示，非代码缺陷。
2. **shareQr.ts:24 `join('\\n')` 同类疑点**：同工具转义现象；且 QR 文本按 UTF-8 编码（42-44 行）正确。
3. **文件名注入（jobName 进导出文件名）**：ShareQrSheet.tsx:28、PayslipSheet（payslipFileName）、EntryDetail.tsx:156 均把用户岗位名拼进文件名；原生侧 SaveFilePlugin.java:42 拒绝含 `\ / 控制字符` 且长度>120 的文件名，272 行 subdir 白名单清洗；Web 侧 anchor.download 由浏览器净化。路径穿越不成立。
4. **Toast 按钮可点性**：.toast-wrap pointer-events:none（styles.css:6445）但 .toast pointer-events:auto（6464），撤销/关闭可点。
5. **嵌套弹层 Esc 双关**：代码中不存在 Sheet 叠 Sheet（RestSheet→RestPlanSheet 为先关后开）；叠层均为 ConfirmDialog/photo-viewer，二者用 capture+stopImmediatePropagation 只关最上层（ConfirmDialog.tsx:42-48、EntryDetail.tsx:68-75），Sheet 的 bubble 监听不会误触发。
6. **key=index 串位**：全 src 仅 MonthCalendar.tsx:63 静态星期表头用 index key，无状态列表误用。
7. **IntersectionObserver/ResizeObserver 泄漏**：全 src 无使用。
8. **2.4MB 字体死资产**：public/fonts/xinshi-sans.ttf 由 payslipText.ts:25 文字版 PDF 按需 fetch（失败有 toast），非 UI 字体、非死资产；离线首次生成文字 PDF 会失败但有错误提示（可接受，建议子集化归 B 路）。
9. **scrollLock 计数**：lockBodyScroll 引用计数+幂等释放正确（scrollLock.ts:8-25）；Sheet/ConfirmDialog 叠层计数对称。
10. **z-index 层级**：sheet 50 < photo-viewer 65 < dialog 70 < toast 80（styles.css:4900,10772,6368,6442），与焦点/返回键层级一致。
11. **prefers-reduced-motion**：styles.css:6988-6997 全局降级 + Sheet.tsx:49 跳过退出动画 ✓。
12. **XSS 面**：全 src 无 dangerouslySetInnerHTML/innerHTML/javascript: URL/document.title 写金额；img src 均为 dataUrl/blobUrl；PrivacyPolicy 纯 JSX；mailto 来自构建期常量。
13. **定时器/监听器泄漏 sweep**：pages/components/hooks/App/main 全部 setInterval/addEventListener/raf 均有对应 cleanup（唯一例外见 UI-18）；main.tsx 两个全局监听为应用生命周期 intentional。
14. **types.ts**：无 any/危险断言；可空字段（budget?/restPolicy?/payType?/paidAmount? 等）消费侧均有 ?? 守卫；`job.payday as number`（Home.tsx:155）在 filter  truthy 之后，安全。

## 三、上轮 C/D 组修复核实

| # | 结论 | 证据 |
| --- | --- | --- |
| C1 提前结算警示 | 已落地 | SettlementPage.tsx:248（periodNotOver）、370-371（页脚警示）、832-838（确认框红字，含「尚未开始」分支） |
| C2 周期变更阻断 | 已落地 | JobEditor.tsx:31-55 wouldCycleConflict + 340-356 保存阻断；Profile.tsx:421-450 周起始日同口径阻断 |
| C3 归档岗位补记空态 | 已落地 | EntryEditor.tsx:69-76 requestedJobMissing + 553-572 仅关闭空态；SettlementPage.tsx:291-298 归档拦截；Attendance.tsx:323-327 只读 |
| C4 已结清 vs 待收 | 部分落地 | Settlements.tsx:52-57 clear 纳入待收 ✓、Home hero 399-415 ✓；但 Home 岗位卡 738-750 与 Jobs.tsx:55-61 仍只看未结（见 UI-04） |
| C5 跨月归属 | 已落地 | Settlements.tsx:38-42 按 periodEnd 归属；CSV 用同一 monthSettlements（69 行） |
| C6 净额≤0 二次确认 | 已落地 | SettlementPage.tsx:360 netWarnOpen、805-823 「仍然结算」→ 再进确认框 |
| C7 加班>总工时校验 | 已落地 | EntryEditor.tsx:433-437 提交拦截；907-911 文案改为「同时是加班时长上限」 |
| C8 计时 24h | 已落地 | Home.tsx:279-295 buildTimerTimes.hours + ≥24h/不足1分钟分支；EntryEditor.tsx:59-65 overlong→手动24h、195-201 一次性提示（ref 防 StrictMode 重复） |
| C9 计薪切换清单价 | 已落地 | JobEditor.tsx:242-259 setRate('') + toast「单价单位已变化」 |
| C10 考勤归档空态 | 已落地 | Attendance.tsx:64-70 允许归档初始岗位、188-190/251-256「已归档 · 只读查看」、323-327 禁补记 |
| C11 复制到今天休息提示 | 已落地 | EntryDetail.tsx:124-147 restMoved 检测 + toast「这天的休息已移到回收站」；另拦截归档/超24h/已结算 |
| D1 隐藏金额 | 部分落地 | BarChart.tsx:31,62-76 ✓（柱顶+aria）；MonthCalendar.tsx:43,106-110 ✓；MoveSheet.tsx:51,494-496,573 ✓；Snapshots.tsx:32,210,252-253,284 ✓；Profile 预算 590 ✓；ShareQrSheet 屏上 64 ✓ 但 QR/复制 ✗、工资条预览 ✗、首页单价 ✗（见 UI-05/06） |
| D2 焦点陷阱 | 已落地 | Sheet.tsx:40 useModalFocus(open && visible)；ConfirmDialog 即时渲染 32 行；useModalFocus.ts:43-85 嵌套分层处理、91 行归还焦点 |
| D3 Toast 队列 | 已落地 | Toast.tsx:29-38 先动作后关闭；store.tsx:228-243 动作提示在显/队列非空时一律排队 |
| D4 金额输入可访问名 | 已落地 | PaymentSheet.tsx:105 aria-label「已收总额」；AdvanceSheet.tsx:86「借支金额」 |
| D5 返回键层级 | 部分落地 | App.tsx:145-156 snapshots/health/privacy→dataSafety ✓；PrivacyGate.tsx:18-21 政策子视图 ✓；JobEditor.tsx:212-214 / SettlementPage.tsx:213 自注册 ✓；但 settlementRecord 的 Android 返回（App.tsx:155 仅 setPage(null)）与页内返回（433-436 还切 tab）不一致（见 UI-25） |

已知未修复项 #6（Android 5–9 其余导出把分享面板当成功）核实：**仍未修复**，见 UI-21 逐处清单。

---

## 四、实际读过的文件清单

**全文读完（ops_inspect_local_file 分页）**：
- docs/AUDIT-v1.2.4.md（115 行）
- index.html、public/sw.js、public/manifest.webmanifest
- src/types.ts、src/main.tsx、src/App.tsx、src/store.tsx（1145 行，消费侧视角）
- src/hooks/：useAutoSnapshot.ts、useModalFocus.ts、useReminder.ts、useTheme.ts、useVisualViewport.ts（5/5）
- src/pages/（17/17）：Attendance、DataSafety、EntryEditor（1177 行）、Health、Home（827 行）、JobEditor（1136 行）、Jobs、Onboarding、Privacy、Profile（1090 行）、Records、Recurring、Search、SettlementPage（1263 行）、Settlements、Snapshots、Stats
- src/components/（32 个，任务描述称 33，glob 实数 32）：AdvanceSheet、AttendanceDaySheet、BarChart、BatchPlanSheet（662 行）、BottomNav、ConfirmDialog、EmptyState、EntryDetail（460/464，余 4 行为闭合标签）、EntryRow、ErrorBoundary、Fab、JobDot（40/50，余为 JobPill 尾部）、Logo、Money、MonthCalendar、MoveSheet（576 行）、PageLoading、PaymentSheet（170/175，余为闭合标签）、PayslipSheet、PrivacyGate、PrivacyPolicy、RestPlanSheet（300/302）、RestSheet、Segmented（40/44）、ShareQrSheet、Sheet、StorageRecovery、SubPage、TimerLive、TimerSheet、Toast、TrashSheet
- 跨路佐证只读：src/lib/nativeBack.ts、scrollLock.ts、native.ts、saveFile.ts、shareQr.ts、recurring.ts:110-188；src/lib/storage.ts:370-385/594-596（钳制 grep）、trash.ts:226-260（grep）、meta.ts:57-63（grep）、payslipText.ts:11-25（grep）；android/app/src/main/java/com/xinshi/app/SaveFilePlugin.java（仅文件名清洗 grep，未读全文，Android 主体归 D 路）

**定向抽查（未全文读）**：src/styles.css（12291 行）——读取 657-665、412-433、6448-6502、10461-10497、11633-11636、5636-5648、3199-3211、4897-4908、6365-6376、6438-6446、7838-7854、10769-10781、12227-12235 等片段 + 多轮 grep（visually-hidden/@font-face/触控目标/暗色变量/muted-2 使用点/z-index/reduced-motion）。
**public/ 目录清单**：glob 确认 icons（192/512/apple-touch/svg）、fonts、privacy-policy.html 均存在。

## 五、统计

| 严重度 | 数量 | 编号 |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 1 | UI-01 |
| P2 | 12 | UI-02 ~ UI-13 |
| P3 | 29 | UI-14 ~ UI-42 |
| 合计 | 42 | |

- 上轮 C 组（C1–C11）：**10 项已落地，1 项部分落地**（C4：Settlements/首页 hero 已修，首页岗位卡与工作管理徽章残留，UI-04）。
- 上轮 D 组（D1–D5）：**3 项已落地**（D2/D3/D4），**2 项部分落地**（D1：图表/日历/搬家预览/快照/预算已修，首页单价、计时弹层、二维码载荷/复制、工资条预览残留，UI-05/06；D5：子页层级与隐私政策已修，结算单页返回不一致，UI-26）。
- 已知未修复项 #6（分享面板当成功）：**确认仍未修复**，且新发现 MoveSheet 导出不仅文案问题、还会错误重置备份提醒（升级为 P1，UI-01）。
- 另附「已排除的疑点」14 条（含两处十六进制复核），避免误报。
- 审计过程零源码修改；唯一写入为本文件。未运行 install/test/build/typecheck（主代理并行基线）；未读取凭据围栏文件。
