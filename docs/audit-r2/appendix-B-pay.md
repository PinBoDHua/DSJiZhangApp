# 薪时 XINSHI v1.2.4 · 计薪/结算/统计/导出审计发现（audit-pay / task-2）

> 审计日期：2026-11-17（只读审计，未修改任何源码）
> 基线：git HEAD 6c0f682，工作树干净；上轮报告 docs/AUDIT-v1.2.4.md（2026-11-12）
> 范围：src/lib 计薪/结算/统计/导出/提醒链路 + 页面内联算钱逻辑；不含 storage/snapshots/crypto/backup、页面组件内部状态、Android Java
> 方法：ops_inspect_local_file 全文分页阅读 + ops_grep 交叉定位 + node 纯算术验证数字示例（未运行任何 pnpm 命令）
> 说明：工具显示层会把反斜杠翻倍（已用 grep 原始模式核实），本文摘录均为源码真实内容。

---

## 一、发现清单

### PAY-01 [P1] 固定月薪 + 周结/日结：周期级封顶过松，同月多期合计可超整月月薪最高 41%；出勤不足时又比月结少发
- 位置：src/lib/settlement.ts:188-195（`cap = sameTerms ? rate : max(...)`，`paidBase = fullFixedMonth ? rate : Math.min(rawBase, cap)`）；src/lib/settlement.ts:352-354（`monthlyFullMonth: job.cycle === 'monthly'`）
- 问题与证据：B1 修复后，非月结周期固定月薪按「出勤天数 × rate/expectedDays」折算，但封顶上限是**整月月薪 rate/每期**。周结一期最多 7 天，7×rate/22 ≈ 0.32×rate 永远触不到 cap，于是同一自然月拆成 4–6 个周期后，封顶完全失效；而月结周期整月只发 rate。同一份工作、同样的工记，仅结算周期不同，应发金额不同。
- 影响/触发条件（数字已用 node 验证）：月薪 3500、expectedDays=22、fixed、周结（周一开始）。2026 年 11 月（30 天，11/1 为周日）每天都记工（30 条工记，保安/保洁类灵活就业常见）：
  - 周结逐期：1 天期 ×2（11/1、11/30）各 159.09 + 7 天期 ×4 各 1113.64 = **4772.74**；
  - 月结同一批工记：fullFixedMonth → **3500**；
  - 差额 **+1272.74（+36.4%）**，理论上限 31/22 ≈ 1.409 倍。
  - 反向：出勤 20 天时周结 20×159.09=3181.82，月结仍发整月 3500，差 −318.18。出勤 26 天：周结 4136.36 vs 月结 3500（+636.36）。
  - 首页文案「固定月薪实际按整月发放」（Home.tsx:693）对周结岗位为假。
- 建议方案（不实施）：非月结周期的月薪封顶改为「rate × 周期天数/当月天数」或按「岗位×自然月」跨周期累计已结基础工资后封顶（需结算单累计口径，与未修复项#4 同类改造）；至少在产品上明确周结固定月薪=按出勤折算、不保证整月恒定，并修正首页文案。
- 触发人群补充核实：当前 UI 已强制月薪岗位月结——JobEditor.tsx:233-240（月薪时 cycleOptions 仅「月结」）、:331（保存时 normalizedCycle 强制 monthly）、Onboarding.tsx:30（effectiveCycle 强制）、seed.ts:107（示例月薪岗月结）；git log -S 显示该强制自 v0.2（9aac966）即存在。但 storage.ts:342 导入 normalizeJob 保留任意 cycle（默认 weekly），settlement.ts:388 注释亦明示「导入的固定月薪工作可能出现」非整月周期。因此缺陷数据人群 = 导入备份 / 手改 localStorage / 旧版遗留的「月薪×周结/日结」岗位；lib 与测试均按支持该形态处理（settlementOverview.test.ts:81-127），上轮 B1 亦按 P1 修复同一人群，本轮维持 P1。
- 置信度：已确认（代码级 + 算术验证；settlementOverview.test.ts 只钉了 2 天=318.18 的折算方向，未覆盖多期合计超整月场景）。

### PAY-02 [P1] 已知未修复项#4 核实仍存在：非整月周期超休额度按周期占月比例折算，同月多周期重复扣款（量化：应扣 0 实扣 264.10）
- 位置：src/lib/settlement.ts:388-402（`restQuota = restDaysPerMonth × periodDayCount / daysInMonth(period.start)`；`overRestDays = round2(max(0, restCount - restQuota))`）；src/pages/SettlementPage.tsx:640-641（UI 显示「本月休息 X 天 · 额度 {job.rule.restDaysPerMonth} 天」，隐藏了折算后的真实额度）
- 问题与证据：额度是「每月」口径，但每个短周期各自拿一份按比例折算的额度独立判超休，休息日分散在多个周期时会被重复扣。pay.test.ts:709-740 用弱断言（toBeGreaterThan(0)）钉住了折算行为本身，未量化跨周期重复扣。
- 影响/触发条件（node 验证）：月薪 3500、expectedDays=22、fixed、周结、restDaysPerMonth=5、overRestDeduct=true。2026-11 休息 5 天：11/3、11/4（11/2–8 周）、11/10、11/11（11/9–15 周）、11/17（11/16–22 周），每周均有工记：
  - 月结口径：5−5=0 天超休，扣 **0**；
  - 周结口径：每周额度 5×7/30=1.1667；前两周各超休 round2(2−1.1667)=0.83 天，各扣 round2(0.83×159.0909)=**132.05**；第三周 1<1.1667 不扣；合计 **264.10**（≈1.66 天工资）。
  - UI 还显示「本月休息 2 天 · 额度 5 天 · 超休 0.83 天」——2<5 却超休，用户无法理解；跨月周（如 3/30–4/5）额度用 daysInMonth(period.start)=31 折算，休息日却横跨两个月。
- 建议方案（不实施）：与上轮报告一致——跨结算单累计当月已扣超休天数，或非整月周期只提示不自动扣；同时 UI 显示折算后的周期额度而非整月额度。
- 触发人群：与 PAY-01 相同（导入/手改/遗留的月薪×周结岗位；当前 UI 强制月薪月结，见 PAY-01 补充核实）。
- 置信度：已确认（代码级 + 算术验证；属上轮明示未修复项，本轮核实未改动）。

### PAY-03 [P2] settleJob 绕过 pendingPersist 守卫：跨标签页竞态可吞掉刚提交的结算（A1 修复的残留缺口）
- 位置：src/store.tsx:959-961（`stateRef.current = committed.state; setState(committed.state);` 未设 `pendingPersist.current = true`）；对照 src/store.tsx:303-308（commit 统一设置守卫）、src/store.tsx:264-277（storage 监听依赖该守卫）
- 问题与证据：A1 修复用 pendingPersist 防止「本地有未落盘改动时回灌远端旧状态」。所有写操作走 commit() 都会置位，唯独 settleJob 直接 setState。结算提交后、持久化 useEffect 执行前，若另一标签页触发 storage 事件，onStorage 见 pendingPersist=false → 用旧账本覆盖 stateRef，新结算单（及其锁定的工记/借支引用）丢失。
- 影响/触发条件：双标签页打开同一账本，A 页提交结算的瞬间 B 页恰好写入任意数据。概率低但后果是结算单静默消失（工记回到未结，可重结；若已登记收款则收款记录一并丢失）。
- 建议方案（不实施）：settleJob 改走 commit() 或在 setState 前置 pendingPersist.current = true。
- 置信度：已确认（代码级；竞态窗口未实机复现，验证方法：双标签页 + 在 setState 与 effect 之间注入 storage 事件）。

### PAY-04 [P2] 结算 CSV 奖金/扣款列未 round2：浮点尾数直接进导出文件（0.30000000000000004）
- 位置：src/lib/csv.ts:170-171（`settlement.bonus + settlement.extraBonus`、`settlement.deduction + settlement.extraDeduction` 直接作为 number 传入）；src/lib/csv.ts:9-13（cell 对 number 仅 String(value)，不舍入）
- 问题与证据：两个已舍入到分的数相加仍可能产生二进制尾数（node 验证：0.1+0.2=0.30000000000000004）。Excel 导出走 money()→round2（excel.ts:10-12）无此问题；复制文案走 formatMoney→toFixed 也无此问题——唯独 CSV 把 17 位尾数写进「奖金」「扣款」列。
- 影响/触发条件：工记奖金 0.10 + 额外奖金 0.20 的结算单，CSV 奖金列显示 0.30000000000000004；老板用 Excel 打开看到长尾数，质疑账目精度。任何 bonus/extraBonus 组合只要二进制和带尾数即触发（常见）。
- 建议方案（不实施）：cell() 对 number 统一 round2，或两处求和外包 round2。
- 置信度：已确认（node 验证 String(0.1+0.2)）。
- 附注（公式注入核查结论）：cell() 的 `/^\s*[=+\-@]/` 前缀防护经核查对 = + - @、Tab/CR 前导、引号/逗号/换行均有效；曾怀疑「前导双引号绕过」，推演后排除（`"=1+1` 会被转义为 `"""=1+1"""`，Excel 解析值以 `"` 开头按文本处理）。数字单元格不加撇号正确。测试缺 Tab 前导与前导引号用例（见 PAY-26）。

### PAY-05 [P2] 固定月薪「封顶/折算」口径三处分叉：记录页月合计 vs 记录页日历 vs 统计页图表（B4/B5 残留）
- 位置：src/pages/Records.tsx:111（`totals = sumEntriesCapped(filtered)` 不传 period → 整月口径）；src/components/MonthCalendar.tsx:78（每日格 `sumEntries(dayEntries)` 无封顶）；src/pages/Records.tsx:133（选中日合计 sumEntries）；对照 src/lib/settlement.ts:659-701（dailySeries 按 targetBase 分摊、最后一天吃余数）与 src/pages/Stats.tsx:79（sumEntriesCapped(entries, period)）
- 问题与证据：B4 统一了「同日多段取最新快照」的去重规则（dailyBaseEntryIds 四处同源 ✓），但**月薪封顶/分摊口径**未统一：记录页头部按整月封顶，日历逐日按 rate/expectedDays 不封顶，统计页图表按封顶后总额分摊到出勤日。
- 影响/触发条件：固定月薪 3500/22，2026-11 出勤 26 天：
  - 记录页月合计 = **3500**（整月封顶）；
  - 记录页日历 26 个格子各 159.09，合计 **4136.34**，与同页头部差 636.34；
  - 统计页月档柱状图每日 round2(3500/26)=134.62（末日 134.50 吃余数），合计 3500；
  - 同一天（如 11/3）在记录页选中面板显示 159.09，在统计页柱状图显示 134.62。
  - 出勤恰好 22 天时三处一致；≠22 天即分叉。热力图 earnings 不封顶但 Stats 只展示 totalHours（Stats.tsx:305-340），金额未暴露 ✓。
- 建议方案（不实施）：日历/选中日合计改用 dailySeries 的分摊值（或明确标注「逐日折算参考」），与统计页同源；记录页头部保持封顶口径并加注释文案。
- 置信度：已确认（代码级 + 算术验证）。

### PAY-06 [P2] Excel 月度汇总「未结（预估）」行与 App 结算口径脱节：固定月薪按整月估、借支/超休恒 0；明细表无「参考」标注且同日多段重复计基础工资
- 位置：src/lib/excel.ts:127-161（未结行 `sumEntriesCapped(entries)` 不传 period；超休/借支/额外奖扣三列硬编码 money(0)）；src/lib/excel.ts:71-96（明细行 base/total 用 payForEntry 逐笔值，表头仅「基础工资/合计」）
- 问题与证据：B1 之后 App 内未结金额按「岗位×周期」折算并扣借支/超休，Excel 预估行却按整自然月封顶估算且不扣任何借支/超休。CSV 工记导出表头明确写「单笔折算参考」（csv.ts:103），Excel 明细表头没有等价标注。
- 影响/触发条件：周结固定月薪 3500/22，本月 2 天工记 + 未结借支 100：
  - 结算页/首页待结 = 318.18 − 100 = **218.18**；
  - Excel 月度汇总未结行：应发 **3500**、借支抵扣 **0**、超休 **0**（状态列虽写「未结（预估）」，但口径与 App 自身预估完全不同）。
  - 日薪同日两段各 300：Excel 明细两行各 300，用户 SUM 得 600，结算单基础工资实为 300（去重），明细表无任何提示。
- 建议方案（不实施）：预估行改按「岗位×结算周期」逐期汇总（复用 summarizeUnsettledJob）或至少扣未结借支；明细表头加「单笔折算参考，同日多段基础工资只计一次」标注。
- 置信度：已确认（代码级）。

### PAY-07 [P2] 净额 ≤ 0 的结算单永远无法标记「已发」：net=0 登记 0 元提示「全部收清」但状态仍待发；net<0 任何输入（含 0）被误报拦截（C6 残留）
- 位置：src/components/PaymentSheet.tsx:47-49（`paidValue > settlement.net` → net<0 时 0>负数 恒真 → 「已收金额不能超过应发金额」）、:65（`paidValue >= settlement.net` → net=0 时 0≥0 → toast「已标记为全部收清」）；src/store.tsx:980-982（`net = Math.max(0, settlement.net); paid = Math.min(net, ...)` → net≤0 时 paid 恒 0、status 恒 unpaid）
- 问题与证据：C6 允许净额≤0 二次确认后落库，但收款链路没有对应处理：① net=−50：输入 0 也被 47 行拦截（0>−50），报错文案「不能超过应发金额」令人困惑，永远无法登记；② net=0：输入 0 通过校验，store 钳成 unpaid，toast 却按原始 net 判「收清」——提示与落库状态矛盾，结算历史仍显示「待发」。预览状态（:39 paidValue<=0→待发）与 toast 也自相矛盾。
- 影响/触发条件：额外扣款/借支把净额压到 −50 并确认结算 → 收款入口永远报错；净额恰好 0 → 登记后 toast「已标记为全部收清」，列表仍「待发」，待收 0，无法清掉。
- 建议方案（不实施）：net≤0 的结算单在 PaymentSheet 直接禁用收款入口并说明「本期无需收款/倒欠」；或 store 对 net≤0 返回特殊状态，toast 与状态判定同源。
- 置信度：已确认（代码级，逐行核读 PaymentSheet.tsx:41-67）。

### PAY-08 [P2] 隐私模式（隐藏金额）不覆盖分享二维码载荷与「复制摘要」：扫码/粘贴仍得明文金额（D1 部分落地）
- 位置：src/components/ShareQrSheet.tsx:20（`createSettlementQrFor(settlement)` 无条件编码真实金额）、:43（copyText(qr.text) 明文）、:56（QR 图直接渲染）；仅 :64 的展示金额走 <Money> 打码
- 问题与证据：D1 声称分享二维码接入隐私模式。实际只有屏幕上的 <Money> 数字打码；二维码图像本身编码了应发/已收/待收明文（shareQr.ts:8-25），保存的 PNG、复制的摘要文本都不受 hideAmounts 影响。旁边有人扫码即绕过隐私模式。
- 影响/触发条件：开启「隐藏金额」→ 打开分享二维码 → 屏幕数字打码，但用另一台手机扫码得到「应发：¥3,022.73」全文；「复制摘要」粘贴到微信同样是明文。
- 建议方案（不实施）：hideAmounts 时禁用/打码二维码生成与复制（或生成不含金额的摘要版本），与 BarChart/MonthCalendar 的 D1 处理对齐。
- 置信度：已确认（代码级；QR 内容隐私属本路范围，展示层打码归隐私路复核）。

### PAY-09 [P3] 超休天数先 round2 再乘日薪：舍入放大扣款；跨月周额度按 period.start 所在月折算
- 位置：src/lib/settlement.ts:394-402（`overRestDays = round2(max(0, restCount - restQuota))` 后 `round2(overRestDays × dailyRate)`）；:390-393（daysInMonth(period.start)）
- 问题与证据：0.0667 天超休先入成 0.07 天再乘 159.09 → 11.14，精确值 10.61，单期多扣 0.53（node 验证）。日薪越大放大越多（overRestDailyRate 自定义时同样）。跨月周（3/30–4/5）用 3 月 31 天折算额度，4 月休息日也按 3 月额度判。
- 影响/触发条件：月休额度 4、周结、某周休 1 天 → 额度 4×7/30=0.9333 → 超休 0.0667→0.07 天 → 扣 11.14 而非 10.61。金额小但方向恒为多扣。
- 建议方案（不实施）：先乘后舍入（round2(overRestDaysRaw × dailyRate)），展示天数另行舍入；跨月周期额度按休息日所属月分段计算。
- 置信度：已确认（node 验证）。

### PAY-10 [P3] dailyBaseEntryIds 的 createdAt 并列（>=）仍依赖入参顺序：批量生成/导入同时间戳工记时 B4 的「顺序无关」不成立
- 位置：src/lib/settlement.ts:54-62（`if (!current || entry.createdAt >= current.createdAt)`）；src/lib/recurring.ts:116,164（同一次 materialize 所有工记共用一个 timestamp）
- 问题与证据：B4 声称「不依赖入参顺序」，但 >= 意味着 createdAt 完全相同时后遍历者胜出。周期记工批量生成、批量补记（同毫秒 nowISO()）、导入备份都可能产生同 job 同日同 createdAt 的多段工记；此时结算前排序（date+createdAt）与统计直接用 state 顺序会取到不同快照。
- 影响/触发条件：同日两段日薪工记 createdAt 相同、单价不同（导入改价场景）→ 结算取数组后者、统计取 state 顺序后者，两边可能差一笔基础工资。正常手工录入 createdAt 不同，不触发。
- 建议方案（不实施）：并列时再用 id 字典序兜底，保证全序。
- 置信度：已确认（代码级；触发依赖同时间戳数据，标注存疑于实际发生频率）。

### PAY-11 [P3] 周期记工边界：日薪/月薪规则允许 0 工时生成全额工记；rate≤0 跳过后游标仍前进导致永久漏补；规则开始日期提前不回补
- 位置：src/lib/recurring.ts:71-74（`if (job.rule.rate <= 0) return null`；hours>0 仅对 hourly 强制）、:162-175（skip 也推进 lastProcessedDate）；src/pages/Recurring.tsx:261-262（校验同时薪）
- 问题与证据：① 日薪规则 hours=0 合法 → 生成 0 工时工记仍拿全日薪（pay.ts:45-46 base=rate 与工时无关），月薪 0 工时计出勤日；用户可能用 0 表达「休息」却生成计薪工记。② 岗位单价临时为 0 期间，匹配日全部 skipped 但游标前进，之后改回单价也不会回补这些天。③ 规则 startDate 改早后，游标之后的日期永不生成（设计如此但无提示）。
- 影响/触发条件：日薪 300 的规则设 hours=0 → 每天自动入账 ¥300 的 0 工时工记；工地停工一周把单价改 0 → 复工后那 7 天永远不补。
- 建议方案（不实施）：日薪/月薪规则 hours=0 时警告或按休息处理；rate≤0 的跳过不推进游标（或单独标记待回补）。
- 置信度：已确认（代码级）。

### PAY-12 [P3] 孤儿工记按整月口径计入未结；只有借支没有工记的岗位永远无法结算抵扣
- 位置：src/lib/settlement.ts:243-246（orphans 用 `sumEntriesCapped(orphans)` 不传 period → 固定月薪整月口径，与 B1 逐期折算不一致）；:602（`if (draft.entries.length === 0) return null`）；:484-491（借支-only 岗位 anchor=today）
- 问题与证据：导入异常产生的孤儿工记（jobId 不存在）金额按整月封顶估算，与正常岗位的逐期口径不同；只有借支的岗位 outstanding 为负（首页显示「借支待抵」✓），但 commitSettlement 拒绝空工记结算，借支只能靠删除记录清掉，无法走结算锁定。
- 影响/触发条件：预支 500 后还没开工 → 结算页卡片「借支待抵扣 500」点进去无法结算（draft.entries 空）；孤儿固定月薪周结工记 2 天被算成整月 3500 而非 318.18。
- 建议方案（不实施）：孤儿也按岗位周期（缺省 monthly）逐期折算；允许借支-only 周期生成「抵扣结算单」或引导删除借支。
- 置信度：已确认（代码级；孤儿场景依赖导入异常，频率存疑）。

### PAY-13 [P3] round2 负值半分向 +∞ 舍入（与正值不对称）；formatMoney 用 toFixed 而非 round2（潜在显示差 1 分）
- 位置：src/lib/money.ts:2-10（Math.round(-816.5)=-816 → round2(-8.165)=-8.16，round2(8.165)=8.17）；:12-26（formatMoney 用 safe.toFixed(decimals)）
- 问题与证据：money.test.ts:12-16 明确钉住负值口径为「向正无穷」，属有意设计；但净额为负的结算单与正值镜像场景差 1 分。formatMoney(8.165)="8.16" 而 round2(8.165)=8.17——当前所有调用点输入均已 round2（核查 pay/settlement/excel/payslip 链路），未激活为实际错误，属潜在分叉。
- 影响/触发条件：未来若有调用方把未舍入值直接交给 formatMoney（如新增统计），显示与账目差 1 分。
- 建议方案（不实施）：formatMoney 内部先 round2 再 toFixed；负值舍入策略在文档中明示。
- 置信度：已确认（node 验证 r2(-8.165)=-8.16）。

### PAY-14 [P3] hoursBetween 起止相同返回 0（24 小时班按 08:00–08:00 录入变 0）；日薪/月薪允许保存 0 工时工记
- 位置：src/lib/date.ts:199-208（minutes===0 → return 0）；src/pages/EntryEditor.tsx:396-419（时薪 range 模式拦截 start==end ✓；日薪/月薪仅查 >24，0 工时可保存）
- 问题与证据：时薪路径已被编辑器拦截；日薪/月薪 0 工时工记仍计全日薪/出勤日（与 PAY-11 同源）。跨午夜班次 hoursBetween 负值 +1440 处理正确 ✓；>24h 的钟点输入（25:00）无校验但 range 模式 netHours>24 拦截 ✓。
- 影响/触发条件：月薪工记 0 工时 → 计 1 出勤日拿 rate/22；用户误录无提示。
- 建议方案（不实施）：日薪/月薪 0 工时保存时提示「将按 1 个出勤日计薪」。
- 置信度：已确认（代码级）。

### PAY-15 [P3] 结算校验码覆盖面窄且为 32 位 FNV-1a：改分项不改 net 校验码不变；算法公开可重算
- 位置：src/lib/checksum.ts:8-25（canonical 仅 id|jobId|jobName|periodStart|periodEnd|net.toFixed(2)|createdAt）
- 问题与证据：注释已声明「不是数字签名，不能防伪造截图」✓；但 base/otPay/bonus/deduction/advanceTotal/paidAmount 均不在覆盖内——把基础工资改小、奖金改大、net 不变，校验码完全相同，「扫码核对」给出虚假安全感。32 位空间对蓄意碰撞也偏小。
- 影响/触发条件：手改 localStorage/导入备份调整分项金额，QR 校验码不变。
- 建议方案（不实施）：canonical 纳入全部分项与收款字段；文案明示「校验码仅核对单号与净额」。
- 置信度：已确认（代码级）。

### PAY-16 [P3] 发薪通知：baseId 哈希 mod 1e6 可碰撞互覆；仅排 3 次无续排；日期边界逻辑零测试
- 位置：src/lib/paydayNotifications.ts:7-15（`100_000 + (hash>>>0) % 1_000_000 * 3`）、:38-47（nextOccurrences count=3）、:17-36（nextPayday 月末回落/跨年正确 ✓）
- 问题与证据：两个 jobId 哈希 mod 1e6 相同 → base 相同 → 通知互相覆盖（生日悖论，10 岗位约 0.005%）。3 次排完后长期不开 App 即无提醒（与每日提醒 30 天续排同类，依赖启动同步）。nextPayday 的 31→2 月回落、12 月跨年、payday 当天 09:00 前后分支均无测试（paydayNotifications.test.ts 只测 ID 确定性）。
- 影响/触发条件：碰撞时岗位 B 的发薪提醒被岗位 A 覆盖；用户 3 个月不开 App 后收不到发薪提醒。
- 建议方案（不实施）：baseId 用更大模数或 jobId 直接映射登记簿；补 nextPayday 日期边界测试。
- 置信度：已确认（代码级；碰撞概率为估算）。

### PAY-17 [P3] 提醒链路杂项：ICS 未按 75 octet 折行；预算 toast 单键可能反复弹；原生同步并发竞态
- 位置：src/lib/reminder.ts:93-115（DESCRIPTION 中文 >75 字节未折行，严格 RFC5545 不合规，多数日历容忍）；src/lib/budget.ts:76-90（单键存储，localStorage 不可用时每次返回 true → 可能每次渲染都弹；档位降级时键变化再弹）；src/lib/nativeReminders.ts:150-187（schedule→cancel 非原子，并发 sync 可能互删）
- 问题与证据：buildDailyReminderPlan 30 天/ID 段/今天跳过逻辑正确且有测试 ✓；权限拒绝路径不弹框 ✓；测试通知 ID 8199 不在清理段 ✓。ICS DTSTART 浮动本地时间对本地日历正确 ✓。
- 影响/触发条件：隐私模式禁用 localStorage 时预算提醒可能刷屏；个别日历导入 ICS 失败。
- 建议方案（不实施）：ICS 折行；预算 toast 键按档位集合存储并在存储不可用时节流。
- 置信度：已确认（代码级；ICS 兼容性为规范推断，标注存疑于具体日历 App）。

### PAY-18 [P3] 导出口径杂项：Excel 旧结算单休息日 fallback 把半天计整天；CSV 与 Excel「奖金」列语义不同；结算 CSV 缺单号/校验码列
- 位置：src/lib/excel.ts:180-185（`item.restDays ?? item.restDates?.length ?? 0`）；src/lib/csv.ts:170（奖金=bonus+extraBonus）vs src/lib/excel.ts:230,234（奖金=bonus，额外奖/扣单列）；src/lib/csv.ts:134-157（无结算 ID/校验码）
- 问题与证据：旧结算单（无 restDays 字段）含半天休息时，restDates.length 按日期数计 → 0.5 天变 1 天。同一份数据 CSV 的「奖金」含额外奖金、Excel 的「奖金」不含，跨格式对账易错。结算 CSV 无法与工记 CSV 的「结算ID」列直接关联（只能靠岗位+周期匹配）。
- 影响/触发条件：v1.2 前旧结算单含半天休息 → Excel 休息天数虚高；财务同时用 CSV 和 Excel 对账 → 奖金列对不上。
- 建议方案（不实施）：fallback 用 restDates 对应休息记录求和（或标注估算）；统一两格式列语义；结算 CSV 增加单号/校验码列。
- 置信度：已确认（代码级）。

### PAY-19 [P3] findSettlementOverlap 注释与实现矛盾：「首尾相接算不重叠」实际 <= 判重叠
- 位置：src/lib/guards.ts:33-45（`settlement.periodStart <= period.end && period.start <= settlement.periodEnd`）
- 问题与证据：共享边界日（前单 end == 新单 start）会被判重叠。标准日/周/月周期不共享日期，实际无影响；仅导入的任意区间结算单可能被误拦。
- 影响/触发条件：第三方备份含 3/1–3/7 与 3/7–3/13 两张单 → 后者所在岗位再结算 3/7 开始周期被拒。
- 建议方案（不实施）：改 < 或修正注释。
- 置信度：已确认（代码级）。

### PAY-20 [P3] SettlementPage.monthlyTermsVary 未按日去重、以数组首条为基准：同日多段调价时「整月/折算」标签与实际金额口径分叉
- 位置：src/pages/SettlementPage.tsx:95-121（比较全部 monthly 工记、first=monthly[0]）；对照 src/lib/settlement.ts:168-193（byDate 取每日最新快照后比较）
- 问题与证据：某日两段工记旧价 3500/新价 4000、其余日均 4000：lib 去重后 sameTerms=true → 整月发 4000；页面 monthlyTermsVary 看到 3500 段 → true → 标签显示「按出勤折算」，金额却是整月 4000。仅标签错，金额正确。
- 影响/触发条件：同日调价补段 + 月结固定月薪 → 核对页文案与金额矛盾。
- 建议方案（不实施）：页面复用 lib 的 sameTerms 判定（导出该逻辑）。
- 置信度：已确认（代码级）。

### PAY-21 [P3] 「固定月薪按整月发放/封顶」文案对周结/日结岗位失真
- 位置：src/pages/Home.tsx:693（「固定月薪实际按整月发放，图表仅按日折算展示」无条件显示）；src/pages/Stats.tsx:373（「月薪工作已按整月封顶」周档同样显示）
- 问题与证据：B1 之后周结/日结固定月薪按周期折算（PAY-01），文案仍宣称整月发放；周档统计实际按周折算而非整月封顶。hasFixedMonthly 判定不区分 cycle。
- 影响/触发条件：周结固定月薪用户看首页说明 → 以为月底拿整月，实际逐周折算。
- 建议方案（不实施）：文案按岗位 cycle 分支。
- 置信度：已确认（代码级）。

### PAY-22 [P3] EntryEditor：holiday 标记仅在加班开启时保存；手动工时模式保留旧起止钟点但 breakMinutes 清零
- 位置：src/pages/EntryEditor.tsx:247（`holiday: overtimeEnabled && holiday`）、:239-241（非 range 模式 startTime/endTime 取 existing 旧值、breakMinutes=0）
- 问题与证据：关闭加班的岗位节假日工记 holiday=false → 搜索「法定节假日」漏检、节假日统计失真（payForEntry 不受影响，multiplier=1）。编辑时薪工记切手动工时后，保存的起止钟点与 hours 不一致（hoursBetween 重算 ≠ hours），下游若用钟点反推会分叉。
- 影响/触发条件：计件/关闭加班岗位节假日记工 → 搜索不到；手动改工时后详情页钟点与工时矛盾。
- 建议方案（不实施）：holiday 无条件保存；手动模式清空起止钟点或保留 breakMinutes。
- 置信度：已确认（代码级）。

### PAY-23 [P3] xlsx xmlEscape 未处理 \r 规范化与 \uFFFE/\uFFFF 非法字符
- 位置：src/lib/xlsx.ts:52-60（剥离 \u0000-\u0008/\u000b/\u000c/\u000e-\u001f，保留 \t\n\r）
- 问题与证据：XML 解析器把 \r\n/\r 规范化为 \n → 备注含 CR 时导出后换行形态改变（轻微）；\uFFFE/\uFFFF 是 XML 1.0 非法字符，未剥离 → 导入的恶意备注可产出打不开的 xlsx。inlineStr 不执行公式 ✓（XLSX 无公式注入面）。
- 影响/触发条件：第三方备份备注含 \uFFFF → 导出的 Excel 文件损坏。
- 建议方案（不实施）：剥离 \uFFFE/\uFFFF 及非字符位；\r 统一转 \n。
- 置信度：已确认（代码级；触发依赖异常导入数据）。

### PAY-24 [P3] 工资条：隐藏分项后可见行加总 ≠ 应发净额且无「其他」行；字体加载失败只报通用错误；明细笔数静默缺失
- 位置：src/lib/payslip.ts:107-146（buildPayslipRows 按 options 过滤 + value>0 过滤）；src/lib/payslipOptions.ts:39-58（simple/amount 模板隐藏超休/借支）；src/components/PayslipSheet.tsx:179-180（catch 吞掉「中文字体加载失败」具体原因）；src/lib/payslipDetail.ts:22-33（entryIds 找不到工记时静默少行）
- 问题与证据：简洁版工资条显示 基础+加班+奖金−扣款，但净额还扣了超休/借支 → 老板按可见行加总对不上净额，无「其他扣款」行解释。字体文件 public/fonts/xinshi-sans.ttf 存在 ✓、加载失败不缓存 ✓、多页分页/QR 固定位与正文 contentLimit=232 不重叠 ✓、B6 免责声明已落地 ✓（payslipText.ts:206-212）。
- 影响/触发条件：用简洁版发工资条 → 对账争议；字体 fetch 失败（离线包损坏）→ 用户只看到「请稍后再试」，重试无效。
- 建议方案（不实施）：隐藏分项时补「其他（含借支/超休）」汇总行；字体错误透出具体原因。
- 置信度：已确认（代码级）。

### PAY-25 [P3] 批量模板：超过 8 个静默丢弃最旧；导入不校验 app 字段
- 位置：src/lib/batchTemplates.ts:88-94（upsert slice(0,8)）、:142-157（merge slice(0,8)）、:114-140（parse 只查 kind/version，不查 app:'xinshi'）
- 问题与证据：第 9 个模板保存时最旧一个被静默挤掉，无提示（batchTemplates.test.ts:65-75 把该行为钉为预期，属设计选择而非回归）；任意含 templates 数组的 JSON 都被接受。
- 影响/触发条件：模板满 8 后保存新模板 → 旧模板消失。
- 建议方案（不实施）：满额时提示替换/拒绝；校验 app 字段。
- 置信度：已确认（代码级）。

### PAY-26 [P3] 测试债务：C8/B8/#4 等关键行为缺钉住用例；弱断言与性能断言
- 位置与证据：
  - src/lib/timer.test.ts:17-25：buildTimerTimes 用例**未断言 times.hours**（C8 核心修复字段），跨天/≥24h 真实时长无覆盖；
  - src/lib/budget.test.ts：无固定月薪整月估算口径用例（B8 行为未钉住）；
  - src/lib/pay.test.ts:738-739：#4 折算行为仅 toBeGreaterThan(0)，未量化跨周期重复扣（PAY-02 因此漏网）；:224,:880 capAdjustment 仅 >0；
  - src/lib/csv.test.ts:101：表头列数 toBeGreaterThan(30)（应为 38，entryCsv.test.ts:11 已钉 38 ✓）；无 Tab 前导/前导引号/CR 前导公式用例；
  - src/lib/paydayNotifications.test.ts：仅 ID 确定性，nextPayday 月末/跨年/当天分支零覆盖；
  - src/lib/recurring.test.ts:100：`Date.now()-started < 2000` 性能断言在慢 CI 上易 flaky；无两规则同日冲突、归档岗位跳过、rate=0 游标行为用例；
  - src/lib/planEntries.test.ts:96：时薪自动加班仅 toBeGreaterThan(0)（应钉精确值 1h）；
  - src/lib/settlementOverview.test.ts / statsRegression.test.ts / yearStats.test.ts / categoryStats.test.ts / payslipDetail.test.ts / payslipRows.test.ts / search.test.ts / scrollLock.test.ts：固定日期、精确断言，质量好 ✓；未发现依赖当前日历日期的时间炸弹（grep todayISO()/new Date() 仅相对时间用法）✓。
- 建议方案（不实施）：补上述钉住用例；弱断言改精确值。
- 置信度：已确认（逐文件核查）。

### PAY-27 [P3] 口径杂项：search 用 settlementId 判「已结算」与 Excel 用 entryIds 判孤儿不一致；restDayAmount(days=0)→1；totalRestDays 注释 0.5 步进实为 0.1
- 位置：src/lib/search.ts:84（`entry.settlementId ? '已结算' : '未结算'`）vs src/lib/excel.ts:39-42（孤儿 settlementId 算未结）；src/lib/rest.ts:4-6,9-12
- 问题与证据：撤销结算会清 settlementId（store.tsx:1009-1014 ✓），孤儿只来自导入异常——此时搜索说「已结算」、Excel 说「未结算」。days=0 的休息记录（异常导入）按整天计。totalRestDays 注释「按 0.5 步进」实际 Math.round(total*10)/10（0.5 步进和必为 0.5 倍数，行为无害但注释误导）。
- 影响/触发条件：导入异常数据时跨功能状态矛盾；days=0 休息虚增超休扣款基数。
- 建议方案（不实施）：统一用 entryIds 集合判定；restDayAmount 对 days<=0 返回 0 或拒绝。
- 置信度：已确认（代码级）。

### PAY-28 [P3] 撤销结算丢弃收款登记且确认框未提示；budget 函数自身不做月界过滤（依赖调用方）
- 位置：src/store.tsx:1003-1017（undoSettlement 删除结算单连同 paidAmount/paidAt/paymentMethod；确认框文案 SettlementPage.tsx:1236-1238 只说工记/借支解锁）；src/lib/budget.ts:24-33（monthlyBudgetStatus 只滤 date<=today，月首界靠调用方传入月内工记）
- 问题与证据：已登记收款的结算单被撤销 → 收款记录随之消失（有 before-undo-settlement 快照可恢复 ✓），但确认框未警告。budget 当前调用方（Home.tsx:98-100、Stats.tsx:121-122）均传月内工记 ✓，函数契约脆弱。
- 影响/触发条件：撤销一张已收款的单 → 「已收」历史无声消失。
- 建议方案（不实施）：确认框列出将丢失的收款登记；budget 内部按 today 所在月过滤。
- 置信度：已确认（代码级）。

### PAY-29 [P3] 统计页周档「按岗位/按类型」明细不封顶，与头部合计在 expectedDays≤6 时分叉
- 位置：src/pages/Stats.tsx:101（周档 `jobBreakdown(entries, false)` → sumEntries 无封顶）、:109（周档 `payTypeBreakdown(entries, false)`）；对照 :79 头部 `sumEntriesCapped(entries, period)` 按岗位×月封顶 min(rawBase, rate)
- 问题与证据：周窗口 7 天，月薪 rawBase = 7×rate/expectedDays；expectedDays≥7 时 rawBase≤rate 不触封顶，两口径一致；expectedDays≤6（JobEditor.tsx:277 只下限 1 无上限，可配 1–6）时 rawBase>rate，头部封顶为 rate，岗位/类型明细仍按 7×rate/expectedDays 展示，明细之和 > 头部合计。
- 影响/触发条件：月薪 3500、expectedDays=4 的兼职岗位，一周 7 天工记：头部周收入 3500，「按岗位」明细显示 6125，差 2625。
- 建议方案（不实施）：周档明细也走 sumEntriesCapped(group, period)（与头部同参）。
- 置信度：已确认（代码级 + 算术推演；expectedDays≤6 属非常规配置，触发面窄）。

---

## 二、上轮 B 组修复逐条核实（代码级证据）

| # | 结论 | 证据 |
| --- | --- | --- |
| B1 | **已落地**（但有残留分叉 PAY-01/05/06） | settlement.ts:282-323 summarizeUnsettledJob 按岗位×周期逐期 buildSettlementDraft；:108-121 monthlyFullMonth 选项 + isWholeCalendarMonth；:352-354 仅 monthly cycle 传 true；settlementOverview.test.ts:81-127 钉住 2 天=318.18、多期汇总 |
| B2 | **已落地** | settlement.ts:494-503 预览 draft 传 state.restDays 与 job.rule.overRestDeduct；settlementOverview.test.ts:43-79 钉住列表含超休 477.27 |
| B3 | **已落地** | settlement.ts:492-503 预览始终用全量 entries+advances 重建 draft（不复用 summary.firstDraft）；settlementOverview.test.ts:129-183 钉住预览 net==提交 net（含借支/超休两例）；SettlementPage.tsx:217-244 与 :306-313 同参 |
| B4 | **已落地**（去重规则同源；封顶口径残留 PAY-05；并列时间戳残留 PAY-10） | settlement.ts:50-63 dailyBaseEntryIds 按 createdAt 最新、与顺序无关（createdAt 不同时）；insights.ts:52、settlement.ts:642、:150 均复用；settlementOverview.test.ts:185-223 双顺序钉住 320 |
| B5 | **已落地** | Stats.tsx:77-79 周/月档统一 sumEntriesCapped(entries, period)，与 dailySeries 同源；statsRegression.test.ts:128-158 钉住图表和==合计（含 10000 高薪逐日舍入） |
| B6 | **已落地** | payslipText.ts:206-212 明细首页注明「明细金额为逐笔折算参考，合计以应发净额为准」；payslipDetail.ts:31 逐笔 total 口径未变（设计如此） |
| B7 | **已落地** | SettlementPage.tsx:668-669 placeholder 直接取 draft.overRestDeduction.toFixed(2)，与提交同口径 |
| B8 | **已落地**（仅文案，计算口径未改，符合原修复声明） | Home.tsx:360 与 Stats.tsx:262 「固定月薪按整月估算」文案；budget.ts:33 date<=today 滤未来 ✓；budget.test.ts:30-34 钉住排除未来；整月估算行为本身无测试（PAY-26） |
| B9 | **已落地** | settlement.ts:224-256 analyzeUnsettled 单遍 + WeakMap 按 state 身份缓存；Home.tsx:101-103 注释明示不再重复 computeOutstanding，统一 overview.outstanding |

## 三、未修复项#4/#5 现状

- **#4（非整月周期超休重复扣）**：**仍存在**，settlement.ts:388-402 原样保留比例折算；本轮量化示例见 PAY-02（月休 5 天分三周休 → 周结扣 264.10，月结扣 0）。pay.test.ts:709-740 反而把折算行为钉成了预期（弱断言）。UI 显示整月额度掩盖折算（SettlementPage.tsx:640-641）。
- **#5（导入允许结算周期内未锁定工记）**：本路未深入 storage 导入校验（归数据路）；从计薪侧核实：commitSettlement/buildSettlementDraft 仍只按 `!entry.settlementId` 过滤（settlement.ts:336-340），不校验工记日期是否落在已结算周期外；guards.findSettlementOverlap 只拦周期重叠。excel.ts:39-42 已用 entryIds 集合兜底孤儿引用（与汇总口径一致），search.ts:84 仍用 settlementId（PAY-27）。结论：计薪侧守卫现状与上轮描述一致，未新增拒绝逻辑。

## 四、正面核实（抽查无误的关键路径）

- payment.daysUntilPayday：31→2 月回落、跨月、当天=0 均正确（payment.ts:27-34，含 addMonths 月末钳制）。
- date.addMonths/startOfWeek/endOfMonth/闰年：Date 原生进位正确；shiftPeriod 月档 anchor 恒为 1 日，无连锁漂移。
- commitSettlement 原子性：纯函数、重叠守卫、双向引用一致、重复提交拒绝（pay.test.ts:925-957 钉住）；undoSettlement 正确清 entry/advance.settlementId（store.tsx:1009-1014）。
- C5 跨月归属：Settlements.tsx:38-41 按 periodEnd 归属月，CSV 同口径 ✓；excel.ts:164-170 同 ✓。
- C7/C8/C9：EntryEditor.tsx:433-435 加班≤总工时拦截 ✓；:60-63 ≥24h 转手动按 24 带出 ✓；JobEditor.tsx:245-248 切计薪方式清单价 ✓。
- C2 周期/周起始日变更阻断：Profile.tsx:421-450 与 JobEditor.tsx:31-55,340-356 均按「已有结算单 + 未结工记新周期与旧结算重叠」保守阻断 ✓（借支不受周期锁定，随下一期抵扣，无遗漏）。
- 月薪×月结强制：JobEditor cycleOptions/normalizedCycle、Onboarding effectiveCycle、seed 示例三处一致 ✓（缺陷人群见 PAY-01 补充）。
- RestPlanSheet：canPick 拦截过去日期/已有工记/已有休息/已结算日期 ✓，超额度提示 ✓，与月度额度口径一致 ✓。
- CSV 公式注入主路径（= + - @、Tab/CR 前导、引号/逗号/换行）防护有效（PAY-04 附注推演）。
- XLSX 结构：inlineStr 不执行公式、CRC32 标准值、deflate-raw→store 回退、冻结首行/自动筛选均有测试 ✓。
- yearStats/categoryStats：按岗位×月封顶后累加，12 月柱状图和==年度合计、breakdown 和==合计（代码推演 + yearStats.test.ts）。
- 热力图 earnings 虽不封顶，但 Stats 仅展示 totalHours，金额未暴露 ✓。

## 五、实际读过的文件清单

全文/分页通读：docs/AUDIT-v1.2.4.md；src/types.ts；src/lib/{money,date,pay,payment,settlement,rest,guards,checksum,recurring,plan,planEntries,timer,timePreset,batchTemplates,budget,insights,categoryStats,yearStats,csv,excel,xlsx,payslip,payslipText,payslipDetail,payslipOptions,shareQr,search,clipboard,reminder,nativeReminders,paydayNotifications,compliance,scrollLock}.ts；src/lib/{money,settlementOverview,csv,excel,xlsx,entryCsv,statsRegression,pay(关键段+用例索引),recurring,timer,budget,insights,rest,timePreset,reminder,paydayNotifications,yearStats,categoryStats,plan,planEntries,payslipDetail,payslipRows,batchTemplates(grep 断言核查),scrollLock(grep 断言核查),search(grep 断言核查),testFixtures}.test.ts；src/store.tsx（commit/persistNow/addEntry/settleJob/setSettlementPayment/undoSettlement/replaceState/storage 监听段 + setState 全量定位）；src/pages/{SettlementPage(关键段),Settlements,Home(关键段+hero),Stats(关键段),Records(关键段),EntryEditor(关键段),JobEditor(关键段),Recurring(grep 定位段),Attendance(grep 定位段),Profile(C2 段),Onboarding(grep 定位段)}.tsx；src/components/{ShareQrSheet,MonthCalendar(关键段),BatchPlanSheet(关键段),RestPlanSheet(关键段),PaymentSheet(grep 定位段),PayslipSheet(grep 定位段)}.tsx；src/lib/seed.ts（岗位模板段）。
grep 交叉核查：src 全量（撤销/sumEntries/jobBreakdown/eachDay/todayISO 时间炸弹/弱断言模式/setState 写路径）；git log -S 只读查询月薪强制月结引入历史。
未读（归其他路）：storage/snapshots/trash/backup/autoBackup/crypto/health/movePackage/photos/photoStamp/saveFile/native/nativeBack/id/meta/version/emptyModule 及其测试（storage.ts 仅 grep cycle 归一化）、android/**、scripts/**。

## 六、统计

- P0 × 0；P1 × 2（PAY-01/02）；P2 × 6（PAY-03/04/05/06/07/08）；P3 × 21（PAY-09～29）。
- B 组核实：9/9 已落地（B4/B5 有残留口径分叉另计新发现；B8 为文案修复符合声明）。
- 未修复项#4 仍存在（已量化：应扣 0 实扣 264.10）；#5 计薪侧现状与上轮一致。
- 数字示例均经 node 纯算术验证；未运行 pnpm 任何命令；未修改任何源码（唯一写入为本文件）。
