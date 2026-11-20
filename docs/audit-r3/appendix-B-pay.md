# 附录 B · 计薪 / 结算 / 统计 / 导出（B 路 · R3 只读审计）

> 审计对象：薪时 XINSHI v1.2.5（git HEAD `d0d8f83`，工作树干净）
> 基线：`docs/AUDIT-v1.2.4-R2.md` 第六章（PAY-01…PAY-29）与 §8.4，`docs/AUDIT-v1.2.4-R2-fixes.md`
> 审计方式：只读。未修改任何源码、未执行 `pnpm build`、未提交、未安装依赖。
> 结论：**P0×0 / P1×1 / P2×3 / P3×12**。其中 P1 与 3 条 P3 是 v1.2.5 修复引入的**回归/新缺口**，单独标注。

---

## 一、文件与方法

### 1.1 通读范围（B 路 22 个 lib + 6 个页面 + 5 个组件 + 3 个测试）

| 类别 | 文件 | 行数 |
| --- | --- | --- |
| 计薪核心 | `src/lib/pay.ts`、`pagePay.ts`、`settlement.ts`、`money.ts`、`date.ts`、`rest.ts`、`guards.ts`、`checksum.ts`、`payment.ts` | 80/116/867/63/220/19/48/169/34 |
| 结算/统计 | `recurring.ts`、`budget.ts`、`insights.ts`、`categoryStats.ts`、`yearStats.ts`、`plan.ts`、`planEntries.ts`、`search.ts` | 213/123/107/55/132/83/52/136 |
| 导出 | `excel.ts`、`xlsx.ts`、`csv.ts`、`payslip.ts`、`payslipText.ts`、`payslipDetail.ts`、`payslipOptions.ts`、`photoStamp.ts`、`native.ts`/`saveFile.ts`（导出回退链） | 396/326/197/444/239/56/125/…/90 |
| 跨层调用口径 | `src/pages/{SettlementPage,Settlements,Stats,Records,Home,Attendance}.tsx`、`src/components/{PayslipSheet,PaymentSheet,AdvanceSheet,EntryDetail,MonthCalendar,BarChart}.tsx`、`src/store.tsx`（结算/借支/工记写入路径）、`src/lib/storage.ts`（导入钳制）、`src/lib/health.ts`（账本体检规则） | — |
| 测试 | `pay.test.ts`（46 例）、`excel.test.ts`、`csv.test.ts`、`yearStats.test.ts`、`statsRegression.test.ts`、`settlementOverview.test.ts`、`pagePay.test.ts`、`checksum.test.ts` 等 | — |

### 1.2 算术复现方法（所有金额结论可重跑）

不信任纸面推导：把真实模块用仓库自带的 `typescript@5.7.3` 编译成 CJS 到系统临时目录，再用 node 直接调用**线上同一份代码**，避免手抄公式。

```bash
# 1) 只读编译（输出到 %TEMP%，不落仓库）
node node_modules/typescript/bin/tsc \
  --outDir "$TMP/xinshi-audit/out" --target ES2022 --module commonjs \
  --moduleResolution node --strict false --skipLibCheck --esModuleInterop \
  --lib ES2022,DOM src/lib/settlement.ts src/lib/excel.ts src/lib/csv.ts \
  src/lib/yearStats.ts src/lib/categoryStats.ts src/lib/health.ts src/lib/payslip.ts
# 2) 在 %TEMP%/xinshi-audit/*.cjs 里构造 state/job/entry 调 buildSettlementDraft / commitSettlement /
#    dailySeries / buildLedgerSheets / buildSettlementCsv / materializeRecurring / checkLedger
node probeN.cjs
```

- 统一口径样例：月薪 3500 / 月计薪天数 22 / `monthlyMode: 'fixed'` / 2026-11（30 天，21 个工作日，11-02…11-30）/ 无加班、无奖金。
- 站点自身跑测试（只读）：`npx vitest run src/lib/{pay,excel,csv,yearStats,pagePay,settlementOverview,payslipRows,payslipDetail,payslipText,insights,categoryStats,budget,recurring,xlsx,statsRegression,plan,planEntries,rest,money,checksum}.test.ts` → **20 文件 / 168 用例全绿**（1.14s）。B 路测试本身没有失败，问题出在“被钉成预期”的口径上（见 B01）。

---

## 二、发现总览

| # | 严重度 | 一句话 | 位置 | 涉及金额 |
| --- | --- | --- | --- | --- |
| **B01** | **P1** | 【PAY-01 修复回归】月薪×日结（及部分周结）把封顶按“日历天数占比”折算，导致同一份工记的结算额远低于站内月视图；日结逐日结算永远拿不到整月月薪，21 个工作日只发 2450.07 而非 3500（−30.0%），v1.2.4 为 3340.89 | `settlement.ts:208-222`；测试把 116.67 钉为预期 `pay.test.ts:866-868` | 3500 → **2450.07**（Δ−1049.93）；11-16 起 11 天 1283.37 vs 3500 |
| **B02** | **P2** | 超休额度 / 休息规则取「当前岗位设置」而不是工记快照：结算后再改“月休额度”，旧周期被追溯多扣（额度 5→3，扣 318.18） | `settlement.ts:428,436-448` vs `:449-452`；`store.tsx:422-427`、`JobEditor.tsx:81-82,293-297` | 3500 → **3181.82**（Δ−318.18） |
| **B03** | **P2** | 借支大于本期应发时产生负净额，PAY-07 修复后可直接“标记已结清”，超出的借支**不递延**到下一期：借 1000、挣 240 → 净额 −760 被一笔勾销，下期全额重发 | `settlement.ts:471-473,504-505`；`store.tsx:1075-1092` | 净额 **−760**，下期 240 不再抵扣 |
| **B04** | **P2** | 结算校验码把「已收金额 / 收款状态」纳入 canonical，登记收款后校验码变化；同一张单在收款前后导出的 CSV/PDF 校验码不一致，旧单据无法再核对 | `checksum.ts:145-146,154-156`；`checksum.test.ts:48-49` 钉为预期 | 同单一码变两码 |
| **B05** | P3 | Excel「月度汇总」看不到孤儿数据：孤儿岗位工记整行缺失、悬挂 settlementId 的工记被算进未结，与 App 待结金额分叉 | `excel.ts:59-61,145-147,164` vs `settlement.ts:259,272-288,330` | App 240 vs Excel 480；孤儿岗位 App 6500 vs Excel 3000 |
| **B06** | P3 | 负净额结算单必然触发体检「已收金额超过应发」误报（0 > net+0.011 恒真） | `health.ts:274-283` | 每张 net<0 的单 1 条 warning |
| **B07** | P3 | 只有借支没有工记的岗位永远无法结算（`draft.entries.length===0` 直接拒绝），列表显示“未结合计 −300”却无出路 | `settlement.ts:656`；`Settlements.tsx:217-218` | −300 永久挂账 |
| **B08** | P3 | 三种导出对同一张结算单的列语义不一致：复制文案合并奖扣、CSV 拆列并带单号/校验码、Excel 结算单页无单号/校验码 | `settlement.ts:843-862`、`csv.ts:139-165`、`excel.ts:300-318` | 对账口径 |
| **B09** | P3 | `hoursBetween` 对缺少分量的时间串返回 NaN（`Number.isNaN(undefined)===false` 绕过守卫），NaN 最终被 `round2` 静默归零 | `date.ts:199-208` | 工时为 0 |
| **B10** | P3 | Excel 未结行“金额按 periodEnd 归月、休息天数按 rest.date 归月”，跨月周期同一行内两种归月口径 | `excel.ts:185,238-244` | 跨月周结行 |
| **B11** | P3 | `eachDay` 370 天硬上限参与 `periodShareCap` 的分母计算：>370 天的导入区间份额被少算 | `date.ts:67-77` → `settlement.ts:211-213` | 超长自定义周期 |
| **B12** | P3 | 月中调价后固定月薪既不按整月也不按新价：21 天@3500 + 1 天@4000 = 3522.73，且文案改说“按出勤折算” | `settlement.ts:191-204,220-222`；`pagePay.ts:39-57` | 3522.73（≠3500/4000） |
| **B13** | P3 | 工资条图片在“7 行分项 + 休息日 + 备注”时备注基线 1304 超出卡片下边 1300（算术推定，未渲染验证） | `payslip.ts:285-297,347-369,373` | 版式 |
| **B14** | P3 | `toAmount` 先删非 `[0-9.-]` 再 parseFloat：`1e3` 变 13、`12.3.4` 变 12.3，输入错误被静默改数 | `money.ts:55-59` | 金额录入 |
| **B15** | P3 | 加班倍率只按自然周末（六/日）判定，不读岗位 `workWeekdays`：固定周末上班者平时加班被记 2 倍、真正的休息日加班只记 1.5 倍（设计选择，存疑） | `pay.ts:5-9`；`date.ts:79-82` | 倍数口径 |
| **B16** | P3 | 测试债务仍在：CSV 表头列数只断言 `>30`（实际 38）；日结 116.67 被钉为“正确”；PAY-09 的 4.9333 额度经导入/编辑器会被取整，实际只有手改数据可达 | `csv.test.ts:102`、`pay.test.ts:866-868`、`storage.ts:318-321` | — |

---

## 三、逐条详情

### B01 [P1] 月薪 × 非月结周期：封顶按“日历天占比”折算，日结永远发不满月薪（PAY-01 修复回归）

**位置**

- `src/lib/settlement.ts:208-222`（`periodShareCap` 计算与 `paidBase`）
- `src/lib/settlement.ts:394-398`（结算一律传 `periodShareCap: true`，`monthlyFullMonth` 仅 `job.cycle === 'monthly'`）
- `src/lib/settlement.ts:136-140`（函数自身文档：「月薪工作按 (月薪 / 计薪天数 × 当月出勤天数) 计算基础工资，超过整月月薪时封顶」）
- `src/lib/pay.test.ts:862-868`（把日结 116.67 钉成预期）

**证据（真实模块 + node 复现）**

`periodShare = 周期落在该月的天数 / 当月天数`（`settlement.ts:211-217`），`cap = capBase × periodShare`（:219），`paidBase = min(rawBase, cap)`（:222）。

日结周期 = 1 天 ⇒ `periodShare = 1/30`，日封顶 = `3500 × 1/30 = 116.67`，而单日应计 = `3500/22 = 159.09`，于是**每天都被封顶**：

| 场景（月薪 3500、计薪天数 22、2026-11） | 站内月视图（Records/Stats/Home） | 逐日结算（v1.2.5） | v1.2.4 逐日结算 |
| --- | --- | --- | --- |
| 21 个工作日 | 3500 | 21 × 116.67 = **2450.07** | 21 × 159.09 = **3340.89** |
| 30 天全勤 | 3500 | 30 × 116.67 = 3500.10 | 4772.74（上轮被修的过量发放） |
| 11-16 起 11 个工作日 | 3500 | 11 × 116.67 = **1283.37** | 1750.00 |
| 22 个工作日（12 月 31 天） | 3500 | 22 × (3500/31)= 22 × 112.90 = **2483.80** | 3500.00 |

周结同样受影响但幅度小：同一批 21 个工作日逐周结算 = 4 × 795.45 + 116.67 = **3298.47**，比月视图 3500 少 **201.53**（最后一个跨月周只按 1/30 折算）。全勤 30 天时周结合计 3500.02（与上轮修复声明一致）。

**可复现算式（21 个工作日）**

```
日结第 i 天：rawBase = 3500 / 22 = 159.0909
             cap     = 3500 × (1 / 30) = 116.6667
             paid    = min(159.0909, 116.6667) = 116.67   ← 每天都触发封顶
合计 = 21 × 116.67 = 2450.07        （月视图 = 3500，差 −1049.93，−30.0%）
对照 v1.2.4：每期 cap = 3500（不折算）⇒ 21 × 159.09 = 3340.89（差 −890.82）
```

**影响**

1. **少发工资**：日结岗位每个工作日只拿到 `月薪/当月天数`，永远拿不到 `月薪/计薪天数`；一个完整出勤月只能拿到月薪的 `出勤日/当月天数`（21/30 = 70%）。工资条、结算单、CSV 都会把这个少数额写成“应发”。
2. **站内自相矛盾**：同一份工记，记录页/统计页/首页显示 3500（`fullFixedMonth` → 整月），结算页显示 2450.07；`EntryDetail` 与 `payForEntry` 显示日折算 159.09，结算只给 116.67。
3. **违反自身文档**：`settlement.ts:138` 明写“月薪/计薪天数×出勤天数、超过整月封顶”，等价于“封顶只应作为月度总额上限，不应压到单日折算之下”。
4. **升级后静默变钱**：已有数据的用户在 v1.2.5 打开核对结算页，金额比 v1.2.4 少 26.7%，release notes 只声明“周结 30 天全勤 4772.74 → 3500.02”，未提日结/部分出勤方向。

**触发条件（已核实）**

- 数据形态：`payType: 'monthly'` + `cycle: 'daily'`（或 `'weekly'` 且单周出勤 ≥5 天、或某期跨月）。
- 入口：当前 `JobEditor` 对月薪强制月结（`JobEditor.tsx:233-240,348`），**故只能来自导入备份 / 手改 localStorage / 旧版遗留**；`storage.ts:405` 导入 `cycle: pick(raw.cycle, CYCLES, 'weekly')` 不归一化，`settlement.ts:388` 注释亦承认该形态存在。与上轮 PAY-01 是**同一人群**，上轮定 P1。
- UI 路径：工作列表 → 待结算（日结每次一个 1 天周期）→ 核对结算；页面顶部显示“本期应结 ¥116.67”，用户只能逐日结算。

**解决方案（建议，二选一，需产品决策）**

- 方案 A（推荐，改动小）：封顶改为“月度累计封顶”，不按周期占比折算——对每份工作按 natural month 累计各期 `rawBase`，只把当月累计超过 `rate` 的部分扣回；单期 paidBase 至少等于 `rate/expectedDays × 出勤天数`。
- 方案 B（口径归一）：既然 UI 已强制月薪月结，就在导入侧把 `monthly + 非 monthly cycle` 归一为 `monthly`（或拒绝导入 + 体检 critical 提示），并把 `settlement.ts:394-398` 的 `periodShareCap` 限定为 `job.cycle === 'monthly'` 的“非整月导入区间”场景。同时补体检规则 `monthly-cycle-mismatch`。
- 无论哪种，`pay.test.ts:862-868` 的 116.67 断言都要改成“每期 ≥ rate/expectedDays”，并补“日结 21 个工作日合计 = 3500”的回归。

**置信度**：高（真实模块复现 + 测试自身佐证 + 文档自相矛盾）。

---

### B02 [P2] 超休额度 / 休息规则取「当前岗位设置」而非工记快照，改设置会追溯多扣

**位置**

- `src/lib/settlement.ts:428`（`const policy = job.rule;`）→ `:436-438`（`restQuota = policy.restDaysPerMonth × 周期占比`）、`:430-431`（`restPolicy` 也取 `job.rule`）
- 对照 `settlement.ts:429,449-452`：同一函数里“超休日扣款”却取 `historicalPolicy = latestEntry?.rule`，两种快照口径混用
- 可写入路径：`store.tsx:422-427`（`updateJob` 无任何守卫，直接替换整份 job）；`JobEditor.tsx:81-82,293-297`（月休额度可随时改，只取整到 1–31）

**证据**

```
月薪 3500/22、fixed、2026-11、5 个工记日、5 个休息日（工记快照 restDaysPerMonth = 5）
（a）岗位额度仍为 5  → overRestDays 0   → 扣 0      → net 3500
（b）用户事后把额度改成 3 → overRestDays 2 → 扣 318.18 → net 3181.82     ← 追溯多扣
（c）用户事后改成「随机休息」→ overRestDays 0 → 扣 0    → net 3500       ← 追溯免扣
（d）（b）+ 借支 1000 → net 2181.82，借支仍全额抵扣
```

**影响**：一次普通设置修改（“我这个月月休改成 3 天”）会立刻改变**历史未结周期**的结算金额，差额 = 多扣天数 × 日薪（示例 318.18）。结算单落库后不可回溯（净额固定），用户与雇主对账时会出现“合同当时是 5 天”的争议。设置改动没有任何“影响未结周期金额”的提示。

**触发条件**：任何 `monthly + fixed + quota` 岗位，先记工记/休息，再在「工作管理 → 编辑工作」里修改“月休额度”或休息规则，然后去结算这些旧工记。

**解决方案**：`restQuota`/`restPolicy` 改取 `historicalPolicy`（工记快照里已有 `restDaysPerMonth`/`restPolicy` 字段），或至少以“结算周期内最新工记快照”为准；`overRestDeduct` 可保留为结算时的用户开关（页面已有开关）。补回归：改额度后旧周期金额不变。

**置信度**：高（真实模块复现）。

---

### B03 [P2] 借支 > 应发时负净额被“已结清”吞掉，超额借支不递延

**位置**

- `src/lib/settlement.ts:385-399`（借支按 `date <= period.end` 全额计入）、`:471-473`（`net` 允许为负）、`:504-505`（`advanceIds` 全部锁定 → 借支被本期消耗完）
- `src/store.tsx:1075-1092`（PAY-07 修复：`net <= 0` 直接落 `paymentStatus:'paid'`、`paidAmount:0`）
- `src/components/PaymentSheet.tsx:38-46,116-125`（“倒欠 X，无需收款；确认后标记为已结清”）

**证据**

```
时薪 30 × 8h = 240；借支 1000（前一天）
commitSettlement → base 240、advanceTotal 1000、net = -760
store 标记已结清后：paidAmount 0、remaining 0、status paid、借支 settlementId 已绑定
下一期（11-16 起）buildSettlementDraft：base 240、advanceTotal 0、net 240   ← 760 不再抵扣
体检：payment-over-net 误报 1 条（见 B06）
```

**影响**：现实中“先借 1000、这个月只挣 240”的工人仍欠雇主 760，应从下月工资扣；账本却把 1000 全部抵掉、把 −760 记为一张“已结清”的单据，下一期全额重发。**净额口径与现金流从此不一致**：月结算流水“应发 −760 / 已收 0 / 待收 0”，三个数字互相对不上，也没有任何“待扣回”入口。上轮 PAY-07 修的是“net≤0 永远无法已发”，修复方式把不可结算变成了“静默关闭”，方向正确但缺了递延。

**触发条件**：任何 `借支总额 > 本期应发` 的结算（常见于预支工资、月底借款）。逐笔：借支录入（`AdvanceSheet`）→ 结算 → PaymentSheet 点“标记已结清”。

**解决方案**（择一，产品决策）：
1. 负净额拆成“待扣回额度”单独记账，下一期结算自动抵扣（新增 `carryover` 字段或保留未抵扣借支余额）；
2. 结算时只抵扣 `min(借支, 本期应发)`，剩余借支留在 `advances`（不绑定 settlementId），UI 明示“本期最多抵扣 X，剩余 Y 转入下期”；
3. 至少把负净额结算单在列表/导出里标注“倒欠待收回”，不要计入“已结清”。

**置信度**：高（真实模块端到端复现：commit → 标记 → 下期 draft）。

---

### B04 [P2] 校验码包含可变收款字段：登记收款后同一张单的校验码变了

**位置**：`src/lib/checksum.ts:122-151`（canonical 含 `paidAmount`/`paymentStatus`，:145-146）、`:154-156`；`checksum.test.ts:48-49` 把“改 paidAmount/paymentStatus 校验码必须变”钉为预期；输出面 `csv.ts:192`、`payslipText.ts:176`。

**证据**

```
结算时：sha256:988beb036a2f31ce
登记收款（paid 0/状态 paid）后：sha256:6cccf32212b56f12
用旧码 verifySettlementChecksum(已收款单, 旧码) === false
```

**影响**：校验码的用途是“同一张结算单是否被改动”。但收款登记是**正常业务动作**，不是篡改。此后：用户存在手机里的 PDF/CSV、发给雇主的截图，与 App 里重新导出/复制文案的校验码不一致；任何“核对校验码”的人工流程都会得出“单据被改过”的错误结论。上轮 PAY-15 要求“canonical 纳入全部分项 + 收款字段”，实现按字面做了，但没考虑字段可变性。

**触发条件**：任何结算单 → 登记收款（部分/全部）→ 重新导出 CSV/PDF/复制文案。

**解决方案**：canonical 只覆盖**结算时刻不可变**的字段（id/岗位/周期/各分项/net/createdAt/工时/天数/休息日），收款字段另设“收款流水签名”或干脆不纳入；如确需覆盖，则把校验码快照落库（`settlement.checksum`）而不是每次重算，导出时用快照值 + 单独说明“收款状态可能已更新”。同步改 `checksum.test.ts:48-49`。

**置信度**：高（代码 + 复现 + 测试佐证）。

---

### B05 [P3] Excel 月度汇总与 App 待结在“孤儿数据”上分叉

**位置**：`excel.ts:59-61,145-147`（以结算单 `entryIds` 判定未结，并把悬挂 `settlementId` 抹掉）、`:164`（`for (const job of state.jobs)`，孤儿岗位整行不产出）vs `settlement.ts:259,330`（App 以 `entry.settlementId` 判定未结，孤儿岗位工记另算 `:272-288`）。

**证据**

```
(a) 悬挂 settlementId（指向不存在的结算单）：
    App computeOutstanding = 240（该笔被 settlementId 排除）
    Excel 月度汇总 = 480（该笔按 entryIds 口径算未结）        Δ 240
(b) 孤儿岗位（jobId 不在 jobs 里）：
    App = 7000（含孤儿按月 3500，扣借支 500 → 6500）
    Excel 月度汇总 = 3000（孤儿整行缺失）                     Δ 3500
```

**影响**：导出文件与 App 的“待结”对不上，用户以为丢钱。缓解：`health.ts:115-127` 对悬挂 settlementId 报 **critical**「工记/借支被不存在的结算单锁住」；孤儿岗位有 `orphan-job` 规则（`health.ts:201`）；导入侧 `storage.ts:947-955` 会清理悬挂引用、`:430-433` 拒绝引用不存在工作的工记。故仅手改/异常合并可达。

**触发条件**：手工编辑 localStorage、异常合并、或历史版本遗留数据；打开「数据安全 → 账本体检」可见 critical。

**解决方案**：App 侧 `analyzeUnsettled` 与 `summarizeUnsettledJob` 统一改用 `settledEntryIds(settlements)` 集合判定（与 Excel/search 一致），并对“有 settlementId 但结算单不存在”的工记按未结处理；Excel 月度汇总补一段“孤儿工记”行（按 `monthKey` 分组，与 `analyzeUnsettled` 同法）。

**置信度**：高（真实模块复现）。

---

### B06 [P3] 负净额结算单必触体检误报「已收金额超过应发」

**位置**：`src/lib/health.ts:274-283`：`overpaid = settlements.filter(item => (item.paidAmount ?? 0) > item.net + 0.011)`。

**证据**：`net = -760、paidAmount = 0` ⇒ `0 > -759.989` 为真 ⇒ `payment-over-net`（warning）。用真实模块跑 `checkLedger` 得 `["payment-over-net:S1", "backup-stale:backup"]`。

**影响**：B03 的每张负净额单一律进体检 warning，误导用户去“修正已收金额”（无法修正）。属 PAY-07 修复的伴生回归。

**解决方案**：`overpaid` 增加 `item.net > 0 &&` 前置条件，或改为 `paidAmount > max(net, 0) + 0.011`。补一条 net<0 不报错的用例。

**置信度**：高。

---

### B07 [P3] 借支-only 岗位永远无法结算（PAY-12 残留）

**位置**：`settlement.ts:656`（`if (draft.entries.length === 0) return null;`）；`settlement.ts:538`（有借支无工记的岗位仍进列表）；`Settlements.tsx:216-229`（显示“借支待抵扣”+“暂无工记”）。

**证据**：借支 300、无工记 → `getSettlementOverview().jobs.length = 1`、`draft.advanceTotal = 300`、`outstanding = -300`、`commitSettlement(...) === null`。

**影响**：未结合计显示 −300，用户点进去只能看到“本期没有工记，先补记一笔再结算”，没有“核销借支/删除借支”的快捷路径（删除借支需在页面内找到该笔）。列表与首页会长期挂一个 −300。

**解决方案**：允许生成“借支抵扣单”（entries 为空但 advanceIds 非空，净额 = −advanceTotal），或在卡片上直接给“删除借支/标记已还”入口；`makeSettlement` 已能承载空 entryIds。

**置信度**：高（代码 + 复现）。

---

### B08 [P3] 三处导出的列语义与可核对性不一致

**位置**：复制文案 `settlement.ts:843-862`（奖金 = `bonus + extraBonus` 合并、扣款 = `deduction + extraDeduction` 合并、无单号、有校验码）；CSV `csv.ts:139-165,168-193`（奖金/额外奖金/扣款/额外扣款拆列 + 单号 + 校验码）；XLSX 结算单页 `excel.ts:300-318`（拆列但**无单号、无校验码**）。

**影响**：同一张单在聊天里复制的是合并口径、导出 Excel 是拆分口径、导出 CSV 又是第三种；用户拿 Excel 对账时找不到 CSV/PDF 上的校验码与单号。净额一致，但分项与可追溯性不一致。

**解决方案**：三处统一为“工记奖金/扣款 + 额外奖/额外扣”四个分项；XLSX 结算单页补“单号/校验码”两列（列宽已够）；复制文案在额外奖扣非 0 时单独成行。

**置信度**：高（读码 + 实跑 CSV/Excel 表头）。

---

### B09 [P3] `hoursBetween` 对残缺时间串返回 NaN，NaN 被静默归零

**位置**：`date.ts:199-208`。守卫写的是 `[sh,sm,eh,em].some(Number.isNaN)`，但 `'9'.split(':')` 得 `['9']`，`em === undefined`，`Number.isNaN(undefined) === false` 拦不住；随后 `minutes = NaN`，`minutes === 0` 为假，`Math.max(0, NaN - break) = NaN`，`Math.round(NaN*100)/100 = NaN`。

**证据（真实模块）**：`hoursBetween('', '') = NaN`、`hoursBetween('09', '18') = NaN`；`hoursBetween('25:00','30:00') = 5`（越界钟点被当作合法）。NaN 进入 `entry.hours` 后：`entry.hours || 0` 得 0、`round2(NaN)` 得 0 ⇒ 工时/收入静默为 0。

**触发条件**：正常录入（`<input type="time">`）与导入（`asTime` 校验）均不可达；手改 localStorage、旧版本遗留、或第三方生成的备份可触发（`recurring.ts:82-86` 也用同一函数算班次工时）。

**解决方案**：改为 `if (!Number.isFinite(sh) || !Number.isFinite(sm) || ...) return 0;`，并对跨日/越界钟点（>23:59）显式返回 0 或抛错；`date.ts` 补单测。

**置信度**：高（复现），可达性低。

---

### B10 [P3] Excel 未结行跨月周期内“金额归月”与“休息天数归月”不一致

**位置**：`excel.ts:185`（`month = monthKey(period.end)` 决定行的月份与金额）、`:238-244`（`restDays` 按 `monthKey(rest.date) === row.month` 过滤、`monthEntries` 同样按工记月份过滤、`:260` 的状态判定也用它）。

**影响**：一个跨月周（如 11-30 ~ 12-06）金额计入 12 月行，但 11-30 的休息日/工记不计入该行的休息天数/状态统计；同一行里 `base` 含 11-30、`休息天数` 不含 11 月，人工比对月度汇总与明细会差一天。

**解决方案**：行内统一改为“按 period 归属”（休息天数与状态都用 `entryIds`/`period` 过滤），或在行上标注“含跨月周期”。

**置信度**：中高（代码路径清晰，未构造完整跨月数据表）。

---

### B11 [P3] `eachDay` 370 天上限影响 `periodShareCap` 份额

**位置**：`date.ts:67-77`（`while (cursor <= end && guard < 370)`），被 `settlement.ts:211-213` 用于 `daysInPeriodMonth`。

**影响**：导入的任意长区间（>370 天）在计算“周期落在当月天数”时被截断，`periodShare` 偏小 → 月薪封顶偏低（少发）。同时 `plan.ts:40`、`csv.ts:41` 也受同一上限影响（考勤 CSV 少行）。

**触发条件**：`storage.ts` 允许导入任意 `periodStart/periodEnd` 的结算单与工记；>370 天的周期极罕见。

**解决方案**：`eachDay` 显式扩容或改成算术计数（`daysBetween + 1`），不要用日期数组求长度。

**置信度**：高（代码），可达性极低。

---

### B12 [P3] 月中调价后固定月薪既不整月也不按新价

**位置**：`settlement.ts:191-204`（`sameTerms` 为假时 `capBase = max(rates)`）、`:220-222`（`fullFixedMonth` 因 `sameTerms` 为假而失效 → 改按 `min(rawBase, capBase)`）；页面 `SettlementPage.tsx:98-111`、`pagePay.ts:39-57` 同步改文案。

**证据**：21 天 @3500 + 1 天 @4000（2026-11）→ `rawBase = 21×159.09 + 181.82 = 3522.73`、`cap = 4000` ⇒ 3500 → **3522.73**。既不是旧月薪也不是新月薪。

**影响**：调薪当月的“固定月薪”变成按天累加，可能高于任一月薪；对“固定月薪”用户不可预期。

**解决方案**：月中调价时按 `周期内以最新 rate 的整月口径` 或“按天分段但封顶=当期 rate”取一个明确规则，并在 UI 明示；补回归钉住调薪月金额。

**置信度**：高（复现）。

---

### B13 [P3] 工资条图片在极端行数下文字溢出卡片（算术推定）

**位置**：`payslip.ts:285-297`（行起点 660、行距 58）、`:299`（`totalY = max(rowY+8, 850)`）、`:310`（`statsY = max(totalY+42, 940)`）、`:347-369`（`infoY = statsY+162`，休息日各 +26）、`:373`（结算章中心 y=1235、半径 56 ⇒ 1179–1291）、卡片下边 `250+1050=1300`。

**算式**：7 行分项（基础/加班/奖金/扣款/超休/借支/其他）⇒ `rowY = 660+7×58 = 1066` ⇒ `totalY = 1074` ⇒ `statsY = 1116` ⇒ `infoY = 1278`；有休息日时该行基线 1278（落在结算章纵向区间 1179–1291 内，但 6 个日期的文本宽约 510px、止于 x≈614 < 792，横向通常不撞），再 +26 ⇒ 备注基线 **1304 > 1300（卡片下边，确定溢出）**。未在真机/浏览器渲染验证，故标 P3/存疑。

**解决方案**：行数 ≥6 时压缩行距或把统计面板/结算章改为流式布局；补一条“8 行分项”截图回归。

**置信度**：中（几何推算确定，视觉重叠需渲染确认）。

---

### B14 [P3] `toAmount` 先把字符删干净再解析，输入错误被静默改数

**位置**：`money.ts:55-59`：`Number.parseFloat(value.replace(/[^\d.-]/g, ''))`。

**证据**：`'1e3' → '13' → 13`；`'12.3.4' → parseFloat('12.3.4') = 12.3`；`'-' → NaN → fallback 0`。HTML `type=number` 允许输入 `e`，粘贴带千分位以外字符也会被“修好”而不是报错。

**影响**：额外奖金/扣款/借支/收款金额可能被静默改数（如想填 1000 填成 `1e3` 变成 13）。金额方向、数量小但属“算钱入口”。

**解决方案**：金额解析改为严格正则 `^-?\d+(\.\d{0,2})?$`，不匹配就报错；或对 `e`/多小数点显式拒绝。

**置信度**：高（复现）。严重度按“用户输入错误”定 P3。

---

### B15 [P3] 加班倍率只认自然周末（六/日），不读岗位固定上班日

**位置**：`pay.ts:5-9`（`otMultiplierFor` → `isWeekend(date)`）、`date.ts:79-82`（`day===0||6`）；`Job.workWeekdays` 在计薪层完全未被使用（仅 `plan.ts` 使用）。

**影响**：对“周三休息、周末上班”的劳动者，周六上班按 2 倍计（可能偏高）、真正的休息日（周三）加班只按平日 1.5 倍（偏低）；工资条与结算单不会提示倍率依据。属产品口径问题，上轮未列。

**解决方案**：若采纳“按岗位固定上班日判休息日”，`otMultiplierFor` 增加 `workWeekdays` 入参，并在工资条标注“按岗位排班判定”；否则在帮助文案里明确“周末=周六日”。

**置信度**：高（代码），是否算缺陷取决于产品口径 → 存疑。

---

### B16 [P3] 测试债务（B 路）

- `csv.test.ts:102`：`expect(header.split(',').length).toBeGreaterThan(30)`——实际 38 列，列错位不会失败（本轮用独立 CSV 解析器验证了 38/24 对齐）。
- `pay.test.ts:866-868`：把日结 116.67 钉成“正确”，使 B01 的少发被测试保护（见 B01）。
- `pay.test.ts:1072-1101`（PAY-09 用例）用 `restDaysPerMonth: 4.9333`，但 `storage.ts:318-321` 与 `JobEditor.tsx:293-297` 都会取整 ⇒ 该用例的数据形态实际只有手改可达，无法防止真实回归。
- 缺少的关键用例：月薪×日结整月合计、月中调价月、结算后再改月休额度、负净额借支递延、net<0 的体检结果、跨月周 Excel 行。

**解决方案**：补上述 6 类用例，并把弱断言改精确值。

**置信度**：高。

---

## 四、上轮 PAY 修复回归抽查（12/29 条，含 PAY-01/02/04/07）

> 方法：代码逐行核对 + 真实模块复现 + 现有测试；✅=已落地且行为正确；⚠️=落地但有回归/残留。

| 上轮编号 | 声明 | 本轮结论 | 证据 |
| --- | --- | --- | --- |
| **PAY-01** | 非月结周期封顶按「周期落在当月天数/当月天数」折算 | **⚠️ 部分修复 + 回归（B01/P1）**：全勤周结 3500.02 ✅（与声明一致）；但日结每期只有 1/30 份额、部分出勤月少发 26.7%，v1.2.4→v1.2.5 由 3340.89 变 2450.07 | `settlement.ts:208-222`；实测 3500.02 / 3500.10 / 2450.07 / 3298.47 |
| **PAY-02** | 非整月周期只提示不自动扣超休，整月口径不变 | ✅ **命中**：5 天休息分三周（2/2/1）各期 `overRestDays=[0,0,0]`、`overRestDeduction=[0,0,0]`、`overRestAutoDeduction=false`；整月周期 6 休/额度 5 仍扣 159.09。残留：额度取当前设置（B02） | `settlement.ts:432-447`；实测与 `pay.test.ts:1010-1070` |
| **PAY-04** | CSV 数字统一 round2 | ✅：`0.1+0.2` 导出 `0.3`（不再是 `0.30000000000000004`） | `csv.ts:10-16`；实测单元格 `0.3` |
| **PAY-05** | 记录页/日历/统计统一封顶分摊口径 | ✅：`sum(dailyBaseSeries) === sumEntriesCapped.base` 精确相等（3500=3500）；`sum(dailySeries) === totals.total`；Records/Records 日历/Stats 同传 `{periodShareCap:true}`。残留：不同分析窗口（周档 vs 月档）的“每日金额”天然不同，属口径说明问题 | `settlement.ts:701-763`、`Records.tsx:112-118,378-387`、`Stats.tsx:28,78,90,113`、`MonthCalendar.tsx:61-64` |
| **PAY-06** | Excel 未结行按「岗位 × 结算周期」逐期汇总 | ✅：Excel 月度汇总行 `net=2840.91` 与 App `computeOutstanding().net` **完全相等**（base 3500 − 超休 159.09 − 借支 500）；残留：孤儿数据（B05） | `excel.ts:142-223`；实测 |
| **PAY-07** | net≤0 可标记无需收款，toast 与落库同源 | ✅ 主路径：`net<=0` 分支直接落 `paid`（`store.tsx:1075-1092`）+ PaymentSheet 无收款输入；**新患**：负净额借支不递延（B03）、体检误报（B06）、校验码变化（B04） | 实测：net −760 → paid/0/0 |
| **PAY-09** | 先用未舍入超休天数乘日薪再舍入 | ✅：`rawOverRestDays` 未舍入即乘（`settlement.ts:444-453`），0.0667 天扣 10.61；注意该数据形态导入/编辑器会被取整（B16） | `settlement.ts:442-453`、`pay.test.ts:1072-1101` |
| **PAY-10** | createdAt 并列按 id 字典序取最新快照 | ✅：`compareLatestEntry`（`settlement.ts:49-53`）在 `dailyBaseEntryIds`、月薪分组、`dailyBaseSeries` 三处复用；双顺序实测同为 320 | `settlement.ts:56-70,186-188,738-741` |
| **PAY-12** | 孤儿工记按自然月各自封顶 | ✅：`settlement.ts:272-288` 按 `monthKey` 分组并传 `monthlyFullMonth:true`，跨月不共享额度（10+11 月 = 7000）。残留：借支-only 不可结算（B07）、Excel 不展示（B05） | 实测 7000 |
| **PAY-15** | 校验码升级 sha256 且覆盖全部分项 | ✅ 覆盖完整（含超休/借支/工时/天数/休息日）；⚠️ 含可变收款字段导致同单两码（B04） | `checksum.ts:122-156` |
| **PAY-18** | Excel 旧结算休息按记录求和；CSV 奖金列拆开并带单号/校验码 | ✅：`excel.ts:32-45`（半天不再算整天）、`csv.ts:139-165`（单号+校验码+额外奖扣拆列） | 读码 + 实测表头 |
| **PAY-29** | 周档明细与头部同参汇总 | ✅：`Stats.tsx:104-123` 同传 `PERIOD_CAP_OPTIONS`；两周岗位窗口实测 `totals=1113.63 = breakdown=1113.63 = dailySeries=1113.63` | 实测 |

其他抽查（PAY-17 ICS 折行 `reminder.ts:66-101`、PAY-19 overlap 注释 `guards.ts:33-47`、PAY-20 `pagePay.ts:39-57`、PAY-21 文案 `Home.tsx:149-153,707-711`、PAY-24 其他行/字体错误/缺失行、PAY-27 search entryIds `Search.tsx:38-47`、PAY-28 undo 提示 `pagePay.ts:80-86`）**均已落地**，无回归。

---

## 五、已排除的疑点（防误报记录）

1. **「双反斜杠」显示假象**：`settlement.ts:866`（`join('\n')`）、`reminder.ts:100`（`join('\r\n')`）、`csv.ts:14`（`/^\s*[=+\-@]/`）、`payslip.ts:413` 的文件名清洗、`xlsx.ts:56` 控制符正则——用 `JSON.stringify` + 逐字符 `charCodeAt` 复核原始字节均为**单反斜杠**，代码正确（延续上轮 §8.3 第 4 条的结论；后续审计者注意文本查看工具会二次转义）。
2. **结算原子性**：`commitSettlement` 返回整包新 state（结算单 + 工记锁定 + 借支绑定一次 commit），无中间态；`store.settleJob` 走 `commit()`→`pendingPersist`（D01 已落地）；`undoSettlement` 正确清双向引用。实测重复提交返回 null、重叠周期被 `findSettlementOverlap` 拒绝。
3. **已结算周期补记拦截**：`addEntry`(`store.tsx:509-515`)、`updateEntry`(:551 已锁判定 / :566-574 目标周期判定)、`deleteEntry`(:601)、`restoreEntry`(:624)、`addRestDay`(:647-653)、`addAdvance`(:748-754) 六处全部拦截，D11 已落地；批量排班/补记也走 `addEntry`（`Home.tsx:220-238`），无旁路。
4. **重复结算防护**：周期重叠守卫（`guards.ts:37-47`，日结同一天也能检出）+ 页面预检（`SettlementPage.tsx:299-303`）+ `commitSettlement` 二次校验（`settlement.ts:644`）。
5. **CSV 公式注入**：`= + - @`、Tab/CR 前导、引号/逗号/换行均处理；数字不加 `'` 前缀不构成注入面（Excel 对 `-760.00` 按数值解析）；用独立 CSV 解析器验证工记表 38 列、结算表 24 列与表头严格对齐；BOM 存在。
6. **XLSX 无公式注入面**：一律 `inlineStr`；`xmlEscape` 剥离 `\u0000-\u001F`、`\uFFFE\uFFFF`、`\uFDD0-\uFDEF`、孤立代理项；实测 `\uFFFE` 不进产物、ZIP 签名正常；非有限数字单元格直接跳过而不是写 `NaN`。
7. **闰年/跨年/月末**：`yearStats` 闰年 2 月、`addMonths` 月末钳制（1-31 → 2-28）、`daysUntilPayday` 31 号→2 月回落、`periodOf` 跨年周标签均正确（读码 + 现有测试）。
8. **时区换日**：日期全程是 `YYYY-MM-DD` 本地字符串（`parseISODate`/`toISODate` 均本地），无 UTC 往返；`nowISO()` 仅用于时间戳排序。无换日错账面。
9. **周期记工幂等**：同参数二次运行 `added=0`；月度 31 日规则在小月落到月末（2026-11-30）；`rate<=0` 跳过且**不推进游标**（PAY-11 已落地）；已结算周期内不生成、同日已有工记不重复生成；首次补记 120 天上限生效（2026-07-23 起）。
10. **导出失败回退**：`saveBlobFile` 返回 `'web'|'native'|'shared'`，32MB 上限 + 45s 桥超时（`saveFile.ts:25-27,67-69`），页面用 `saveFeedback` 区分“已保存/待确认”；纯 Web 端明确只提示“已触发下载”。
11. **数值边界**：`round2` 对 NaN/±Infinity 归 0、对 `|v|≥1e15` 原样返回；导入把 rate≤1e6、工时≤24、otHours≤工时、奖金扣款≤1e6、结算分项≤1e9 全部钳制（`storage.ts:204-217,435-444`）；`entry.hours||0` 使 NaN 工时降级为 0 而不是污染合计。
12. **`round2` 负值半分向 +∞**（`-1.005 → -1.00`、`-8.165 → -8.16`）：上轮 PAY-13 已认定为既定口径并在 `money.ts:19` 注释，本轮不重复计为发现（但对负净额会少算 1 分，B03 场景下方向为“少扣”）。
13. **`settlementCopyText` 的 `借支抵扣 ¥0.00` / `-¥190.50` 符号**：属文案卫生（ASCII `-` 与 `−` 混用），不构成金额错误，未单列。
14. **借支/休息的非法值**：负数、NaN、超上限在 `addAdvance`(`store.tsx:745`) / `addRestDay` / 导入 normalize 中均被拒绝或钳制，未发现可写入的负借支。

---

## 六、修复优先级建议（B 路）

| 批次 | 内容 | 工作量 |
| --- | --- | --- |
| **0 · 立即（发布阻断）** | B01：改封顶口径 + 补“月薪×日结整月合计=3500”“部分出勤月”回归；或导入侧归一 `monthly+非月结`。二者择一，否则同一人群的工资差额持续存在 | S–M |
| **1 · 金额正确性** | B02（超休额度改快照）、B03（负净额借支递延/只抵本期应发） | M |
| **2 · 一致性** | B04（校验码剔除可变字段或落快照）、B05（统一 `settledEntryIds` 判定 + Excel 孤儿行）、B08（三格式列语义统一） | M |
| **3 · 卫生** | B06 体检前置条件、B07 借支抵扣单、B09 `hoursBetween` 守卫、B10 跨月归月、B11 `eachDay` 计数化、B12 调薪月规则、B13 工资条版式、B14 严格金额解析、B16 测试补齐 | S–M |
| **4 · 产品决策** | B15 加班倍率是否按岗位排班 | — |
