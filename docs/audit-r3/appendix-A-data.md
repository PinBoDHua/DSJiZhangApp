# 附录 A · 数据层与持久化（A 路 · 第三轮审计）

> 审计日期：2026-11-20（Asia/Shanghai）
> 审计对象：`D:\DSJiZhangApp` @ git HEAD `d0d8f83`（v1.2.5 / versionCode 1205 / SW v32，工作树干净）
> 审计性质：**只读审计**——未修改任何源码/配置/构建产物，仅新增本文件
> 严重度：P0=数据丢失/损坏、安全漏洞、发布阻断；P1=重大功能错误（含算钱错误）、隐私泄露、上架风险；P2=一般缺陷/边界/体验；P3=代码质量/卫生/测试债务
> 上轮对照：[AUDIT-v1.2.4-R2.md](../AUDIT-v1.2.4-R2.md) 第四节（D01–D36）与 §8.4；修复记录 [AUDIT-v1.2.4-R2-fixes.md](../AUDIT-v1.2.4-R2-fixes.md)

---

## 一、域内覆盖清单

| # | 文件 / 页面 | 行数 | 本次读法 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `src/lib/storage.ts` | 1040 | 全文 | 读/写/迁移/导入校验：迁移幂等、上限钳制、双向引用校验均到位；新发现 3 处（A07/A11/A13）|
| 2 | `src/store.tsx` | 1311 | 全文（重点 200–420、860–1200）| 落盘/合并/整包替换：D01/D09 修复成立，A01/A02 残留 |
| 3 | `src/lib/stateMerge.ts` | 30 | 全文 | CAS + updater 重放的纯函数层，注释已自认整包 updater 不适用 |
| 4 | `src/lib/snapshots.ts` | 508 | 全文 | 完整性校验/解压上限/prune 三处修复成立；A12 元数据缺字段 |
| 5 | `src/lib/trash.ts` | 276 | 全文 | 30 天保留/精确工时复核/跨集合去重均正确；A08 导入静默截断 |
| 6 | `src/lib/photos.ts` | 173 | 全文 | D08 修复成立（`skipCreatedAfter` 时间戳字符串比较口径一致）|
| 7 | `src/lib/backup.ts` | 111 | 全文 | AES-GCM/PBKDF2 600k/IV 随机/迭代次数包内 + 上下界校验成立；加密导入的 D11 复检由调用方补齐 |
| 8 | `src/lib/crypto.ts` | 86 | 全文 | 参数正确；`sha256Hex` 无 subtle 时返回 null 的降级被快照侧拒绝（正确）|
| 9 | `src/lib/checksum.ts` | 169 | 全文 | 自实现 SHA-256 + canonical 覆盖分项与收款字段；有 golden 值测试 |
| 10 | `src/lib/movePackage.ts` | 399 | 全文 | 校验码 v2 键序无关、加密参数校验、清单一致性成立 |
| 11 | `src/lib/storageRecovery.tsx`→`src/components/StorageRecovery.tsx` | 231 | 全文 | A2 分流 + 强制先导出 raw + 20MB 上限成立 |
| 12 | `src/lib/health.ts` | 390 | 全文逐条 | 14 条规则逐条核对：仅 backup-stale 未用注入时钟（A04）；A05 误报 |
| 13 | `src/lib/autoBackup.ts` | 201 | 全文 | 失败退避/45s 超时/prune 降级成立；A03 'shared' 口径漏洞 |
| 14 | `src/lib/backupStatus.ts` | 46 | 全文 | D33 文案修复成立 |
| 15 | `src/lib/date.ts` | 220 | 全文 | 全本地时区，无 `toISOString().slice(0,10)` 类 UTC 陷阱（见 §五）|
| 16 | `src/lib/meta.ts` / `version.ts` / `seed.ts` / `guards.ts` / `id.ts` | 70/7/231/48/7 | 全文 | 无域内缺陷（seed 仅 Onboarding 调用）|
| 17 | `src/hooks/useAutoSnapshot.ts` | 147 | 全文 | D35 定时器清理 + 失败落盘记录成立 |
| 18 | `src/pages/DataSafety.tsx` | 537 | 全文 | A10 清空入口缺快照删除；D04/D17 修复成立 |
| 19 | `src/pages/Snapshots.tsx` | 304 | 全文 | 恢复前快照 + replaceState 失败提示成立；`integrity` 取自读取结果（非 meta），非缺陷 |
| 20 | `src/pages/Health.tsx` | 198 | 全文 | UI-21 修复成立（快照失败在 toast 说明）|
| 21 | `src/components/TrashSheet.tsx` | 318 | 定向（恢复入口）| 恢复统一走 `restoreTrashItem` → 精确工时复核生效 |
| 22 | `src/types.ts` | 314 | 数据结构段 | 结算/工记双向引用、可选字段可空性消费侧均有守卫 |

**基线复核（本机实测，只读命令）**

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/lib/{storage,v120Storage,stateMerge,checksum,movePackage,snapshots,autoBackup,trash}.test.ts` | ✅ 8 文件 / **121 用例全通过**（1.14s）|
| `npx vitest run src/lib/health.test.ts` | ❌ **2 失败 / 19 通过**：`正常账本没有严重或提醒项`、`徽标文案按严重程度显示`——均为 A04（`Date.now()` 未走注入时钟）|

---

## 二、发现总览

| 编号 | 严重度 | 一句话 | 位置 |
| --- | --- | --- | --- |
| A01 | **P1** | 整包替换型 updater（settleJob / generateRecurring）在跨标签页 CAS 合并时覆盖远端账本，D02 原始症状仍在 | store.tsx:1054,833；stateMerge.ts:12-13 |
| A02 | P2 | 落盘失败时清空 `pendingUpdaters` 且不回滚内存：后续一旦触发 CAS 合并，这批「只在内存里」的改动被静默丢弃 | store.tsx:312-322,295-303 |
| A03 | P2 | 自动备份在 `'shared'`（分享面板取消）时仍写 `lastRunAt`、清空 `lastError`，且 App 丢弃 `warning` → 当天静默无备份、无重试 | autoBackup.ts:161,174-189；App.tsx:252 |
| A04 | P3 | `backup-stale` 规则用 `Date.now()` 而非注入的 `today`，规则不可注入（当前 2 用例假红）| health.ts:339-343 |
| A05 | P3 | `payment-over-net` 对 net<0 且「已标记无需收款」的结算单误报 | health.ts:274-283 vs store.tsx:1075-1092 |
| A06 | P3 | 「清空所有数据」不彻底：13 个附属 localStorage 键中 10 个残留（含批量模板的金额/备注）| storage.ts:136-142；store.tsx:1186-1191 |
| A07 | P3 | 导入信任包内 `paymentStatus`，与 `paidAmount` 矛盾时不校正，体检也无对应规则 | storage.ts:574-580；payment.ts:10-24 |
| A08 | P3 | 导入静默丢弃超过 120 条的回收站记录（无提示、无计数）| storage.ts:1028-1030；trash.ts:74-81 |
| A09 | P3 | 快照/备份不含照片：恢复旧快照或清空后 `entry.photoId` 悬空，无检测、无提示 | snapshots.ts:357；store.tsx:1190 |
| A10 | P3 | `DataSafety` 的「清空所有数据」没有「同时删除全部历史快照」选项（D22 只落在 Profile）| DataSafety.tsx:218-240,528-530 vs Profile.tsx:327-352 |
| A11 | P3 | store 写入层缺奖金/扣款上限（录入 UI 钳制、导入钳制，store 只查 ≥0），三口径未齐 | store.tsx:502-508,557-563 |
| A12 | P3 | `SnapshotMeta.integrity` 永不填充（`toMeta` 丢弃），类型声明与实际返回不一致 | snapshots.ts:317-328,49 |
| A13 | P3（存疑）| 导入时工记 `rule` 缺字段回退到**岗位当前规则**，历史金额随当前设置漂移 | storage.ts:451,301-366 |

**计数：P0×0 / P1×1 / P2×2 / P3×10 = 13 条。** 其中 A01 属「上轮 D02 部分落地」的残留（fix 文档 §8.1 已自认该类风险），A03/A04/A05 属「同类路径未扫全」的延续，A06/A08/A10/A12/A13 为新增面。

---

## 三、逐条详情

### A01 [P1] 整包替换型 updater 在跨标签页合并时覆盖远端账本

**位置**：`src/store.tsx:1049-1058`（settleJob）、`src/store.tsx:830-837`（generateRecurring）、`src/lib/stateMerge.ts:12-13,15-22`

**证据摘录**
```ts
// store.tsx:1049-1058
const committed = commitSettlement(stateRef.current, {...});
if (!committed) return null;
// 必须走 commit()：否则 pendingPersist 不置位 …
commit(() => committed.state);          // ← 忽略 prev 的整包 updater
```
```ts
// store.tsx:832-833
const result = materializeRecurring(stateRef.current, options);
if (result.state !== stateRef.current) commit(() => result.state);
```
```ts
// stateMerge.ts:12-13（模块自己写明）
// 注意：整包替换意图的更新（如 settleJob 直接返回整本新状态）重放时会覆盖远端，
// 这类写入依赖 D09 的 epoch 广播兜底，不在本函数裁决范围内。
```
落盘侧：
```ts
// store.tsx:295-303
if (isRemoteDirty(remoteRaw, lastPersistedRaw.current)) {
  const loaded = loadStateDetailed();
  if (!loaded.failure) {
    next = replayUpdaters(loaded.state ?? createEmptyState(), pendingUpdaters.current);
    stateRef.current = next; setState(next);
  }
}
```
**影响**：`replayUpdaters(remote, [...])` 的契约是「远端记录不丢 + 本地改动叠加」，但 `() => committed.state` 完全不读 `remote`，重放结果 = 本窗口提交时刻的整本账 → **远端标签页刚写入的工记/借支在磁盘与内存同时消失**，且无任何提示（随后只可能有一条「账本已在其他窗口更新」的 info toast，甚至没有）。这与上轮 D02 的症状（整包丢失更新）完全同型，D02 的修复只对纯函数 updater 生效。

**触发条件**（多标签页/多窗口，Android 单窗口主场景不受影响）：
1. 窗口 A 提交结算（`settleJob`）或自动补记（`generateRecurring`），`pendingPersist=true`，同一渲染批内的持久化 effect 尚未执行；
2. 窗口 B 在该窗口期内完成一次落盘（任意写操作）→ `localStorage[xinshi.state.v7]` 变成 B 的原文；
3. A 的 effect 读到 `remoteRaw !== lastPersistedRaw` → 走重放分支 → 用 A 的整本旧账覆盖 B 的改动。

`generateRecurring` 属同类但**未在 stateMerge 注释与 fix 文档中披露**（只写了 settleJob），风险被低估。

**解决方案**（按成本递增）：
- 最小改：`settleJob` 改为纯 updater——用 `commitSettlement(prev, {...})` 在 updater 内部基于 `prev` 重算（`settlementId`/`createdAt` 预生成，保证重放幂等），同理 `generateRecurring` 改为 `materializeRecurring(prev, options).state`；
- 或给 `commit` 加 `intent: 'merge' | 'replace'`：`replace` 型在 CAS 冲突时**放弃重放并整包写入**，同时把冲突事实 toast 出来（明示「另一窗口的改动已被覆盖」）并可先 `saveSnapshot`；
- 长期仍是 fix 文档建议的单写者选举（BroadcastChannel）或按 ID 增量合并。

**置信度**：高（代码路径确定，无外部依赖）。fix 文档 §8.1 已自认「极端同时提交窗口仍可能以整包 updater（settleJob/导入）覆盖远端」，因此本条按「已自认残留」定级，未按回归计。

---

### A02 [P2] 落盘失败清空 `pendingUpdaters`：后续 CAS 合并会静默丢弃未落盘改动

**位置**：`src/store.tsx:304-322`（持久化 effect 的失败分支）

**证据摘录**
```ts
// store.tsx:304-322
try {
  saveState(next);
  lastPersistedRaw.current = JSON.stringify(next);
  pendingUpdaters.current = [];
  ...
} catch (error) {
  pendingUpdaters.current = [];      // ← 重放日志被丢弃
  remoteDirty.current = false;
  pendingPersist.current = false;    // ← 不再重试，内存态与磁盘态分叉
  setStorageError(true);
  ...
}
```
**影响**：写失败后，内存里的新数据没有任何「尚未落盘」的凭据（`pendingPersist=false`、`pendingUpdaters=[]`、`lastPersistedRaw` 仍是旧原文）。单标签页场景无害——下一次 `commit` 的 effect 走 `next = stateRef.current` 把整包（含失败那批）写回。但一旦期间**另一标签页写入过**：
1. 窗口 A 保存失败（配额不足/隐私模式），内存保留改动 S_fail，磁盘仍 S_old；
2. 窗口 B 写入 S_other；
3. 窗口 A 再提交一次 → effect 判定 `remoteRaw(S_other) !== lastPersistedRaw(S_old)` → `next = replayUpdaters(S_other, [新 updater])` → **S_fail 那批改动从内存和磁盘同时消失，无提示**。

`storageError` 常驻横幅在，但用户看到的是「空间不足」，不会知道随后静默丢的是先前那笔。

**触发条件**：写失败（QuotaExceeded / SecurityError）+ 另一窗口写入 + 本窗口再操作一次。Android 单窗口无此路径。

**解决方案**：失败分支保留 `pendingUpdaters`（只清 `remoteDirty`），让下一次重放把「失败那批 + 新一批」都叠到远端之上；或失败时把内存回滚到 `lastPersistedRaw` 对应状态并明确 toast「本次改动未保存，已回滚」。前者更贴合当前设计。

**置信度**：高（路径确定）；触发概率低，故 P2。

---

### A03 [P2] 自动备份在 `'shared'` 时仍记为「今天已跑」，且 warning 被丢弃

**位置**：`src/lib/autoBackup.ts:161,174-189`；`src/App.tsx:249-253`

**证据摘录**
```ts
// autoBackup.ts:157-189
const result = await saveTextFile(filename, buildExportPayload(state), undefined, {subdirectory: AUTO_BACKUP_SUBDIR});
const shared = result === 'shared';
...
writeAutoBackupSettings({
  lastRunAt: now.toISOString(),          // ← shared 也写（当天不再重试）
  lastFile: ...,
  lastError: undefined,                   // ← shared 也清失败记录
});
writeAutoBackupFailure(null);
if (!shared) markBackedUp(now);           // ← 只有这处按 shared 分流
const warning = shared ? '旧系统已打开系统分享面板，请确认本次备份已保存；旧备份需要手动清理' : pruneError;
return { ran: true, path: filename, pruned, warning };
```
```ts
// App.tsx:249-253
useEffect(() => {
  if (!privacyOk || !state.onboardingDone) return;
  void runAutoBackup(state);              // ← Promise 结果（含 warning）整体丢弃
}, [privacyOk, state]);
```
**影响**：Android 5–9（SharePlugin 走 `ACTION_SEND` 分享面板）上，用户取消保存后：`lastRunAt` 已写 → `shouldRunAutoBackup` 的 `localDateKey(last) !== localDateKey(now)` 为 false → **当天剩余时间不再尝试自动备份**；`lastError` 被清空 → 「我的页/数据与安全」看不到失败；`warning` 文本无人消费 → 用户零感知。当天手机丢失/清缓存即丢账（D03 修好了「14 天提醒被误重置」这一半，这半边没修——D03 的修复清单只列了 `markBackedUp`）。

**触发条件**：Android 5–9 + 自动备份开启 + 用户在分享面板点取消/返回。

**解决方案**：`shared` 时只写 `lastFile`/`lastError` 而不写 `lastRunAt`（或写 `lastAttemptAt` 供退避用），并让 `App.tsx` 消费 `warning` 用 `toast(..., 'info')` 提示；`shouldRunAutoBackup` 增加「上次是 shared 且当天已过 N 分钟则允许重试一次」的退避口径。

**置信度**：高（`'shared'` 语义由 `native.ts:9-13` 明确定义，DataSafety/Profile/MoveSheet 均已按该语义分流，唯 autoBackup 的 `lastRunAt` 漏分流）。

---

### A04 [P3] `backup-stale` 规则混用真实时钟，`today` 注入对它无效

**位置**：`src/lib/health.ts:338-353`（`Date.now()` 在 :343）

**证据摘录**
```ts
// health.ts:338-343
if (state.entries.length > 0) {
  const lastBackup = options.lastBackupAt ? new Date(options.lastBackupAt) : null;
  const staleBackup =
    !lastBackup || Number.isNaN(lastBackup.getTime()) ||
    Date.now() - lastBackup.getTime() > 14 * 86_400_000;   // ← 注入的 today 未被使用
```
```ts
// health.test.ts:31-35
const report = checkLedger(healthyState(), { today, lastBackupAt });
expect(report.issues).toHaveLength(0);
```
**影响**：①本机实测 2 个用例红（`backup-stale` 混入 info → `toHaveLength(0)` 失败、`healthBadgeText` 由「账本正常」变「1 项提示」）；②规则不可注入意味着「14 天阈值边界」无法被确定性回归覆盖（今日 2026-11-20，测试固定 `lastBackupAt=2026-11-05` 已 15 天 > 14）；③与同函数内其它 13 条规则口径不一致（其余全部用 `today`）。生产口径本身正确（真实时钟判真实过期），所以不是功能错误，但它是**唯一的基线红**且会随时间永久红下去。

**逐条核对结论**：14 条规则中 13 条只读 `today`（:303 future-entry、:313 stale-unsettled 等），仅 `backup-stale` 用真实时钟；`checkedAt`（:358）用 `new Date().toISOString()` 属预期（仅展示）。**未发现其它规则混用真实时钟**。

**解决方案**：把 `today`（`YYYY-MM-DD`）转成本地零点 `new Date(\`${today}T00:00:00\`)` 再与 `lastBackup` 比较；或给 `checkLedger` 增加 `now?: number` 参数，默认 `Date.now()`，测试注入。

**置信度**：高（实测用例红）。

---

### A05 [P3] `payment-over-net` 对 net<0 的「无需收款」结算单误报

**位置**：`src/lib/health.ts:273-283`；对照 `src/store.tsx:1075-1092`、`src/components/PaymentSheet.tsx:38-41,118-123`

**证据摘录**
```ts
// health.ts:274-276
const overpaid = state.settlements.filter(
  (item) => (item.paidAmount ?? 0) > item.net + 0.011,
);
```
```ts
// store.tsx:1075-1092（PAY-07 的修复：net≤0 允许直接标记已结清）
if (settlement.net <= 0) {
  commit((prev) => ({ ...prev, settlements: prev.settlements.map((item) =>
    item.id === settlementId ? { ...item, paymentStatus: 'paid', paidAmount: 0, paidAt, ... } : item) }));
```
**影响**：`net = -50` 的结算单被用户按新交互标记「无需收款/已结清」后落库 `paidAmount=0, paymentStatus='paid'`；health 判 `0 > -50 + 0.011` 为真 → 体检页出现「已收金额超过应发 · 1 张结算单的已收大于应发，收款状态可能不对」（warning 级），并可点进结算页。用户刚按提示标记完，立刻被告知状态可能不对。`net > 0` 时该规则正确，故只影响倒欠单。

**触发条件**：存在 `net<0` 的结算单（借支/扣款超过应发，PAY-07 明确支持该形态）→ 点「标记已结清」→ 打开账本体检。

**解决方案**：`const paid = item.paidAmount ?? 0; if (item.net > 0 && paid > item.net + 0.011)`；或对 `net <= 0` 单独判「应状态为 paid 且 paidAmount===0」。

**置信度**：高（代码确定；`PaymentSheet.tsx:118-123` 文案「本期为倒欠 ¥X，无需收款」证实该形态落地）。

---

### A06 [P3] 「清空所有数据」不彻底：10 个 localStorage 键残留

**位置**：`src/lib/storage.ts:136-142`（`clearStoredState`）↔ `src/store.tsx:1182-1192`（`resetAll`）

**证据摘录**
```ts
// storage.ts:136-142
export function clearStoredState(): void {
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem('xinshi.lastBackup');
  localStorage.removeItem('xinshi.budgetAlert');
}
```
全仓 localStorage 键清单（`grep -rhn "_KEY = 'xinshi"`）：账本 7 个（`xinshi.state.v7` + `v6…v1`）+ 附属键 13 个：`theme`、`lastBackup`、`budgetAlert`、**`autoBackup`**、**`autoBackupFailures`**、**`snapshotDailyAt`**、**`snapshotLastError`**、**`ledgerEpoch`**、**`planJobId`**、**`batchTemplates`**、**`privacyConsent`**、**`payslipOptions`**、**`reminder.last`**。`clearStoredState` 只删账本 7 个 + `theme`/`lastBackup`/`budgetAlert` 3 个 → **13 个附属键里 10 个残留**。

**影响**：
- `xinshi.batchTemplates` 存的是 `{name, hours, bonus, deduction, note, jobName}`（batchTemplates.ts:5-14）——**含金额与备注的用户数据**；用户执行「清空所有数据」（卖机/交接前的抹除动作）后仍留在 `localStorage`，`文件管理器/WebView 数据导出` 可读。
- `xinshi.autoBackupFailures` / `xinshi.snapshotDailyAt` 残留会让清空后的新账本沿用旧状态：当天已「失败 3 次」→ 新账本当天不再自动备份；当天已拍每日快照 → 不再拍。
- `xinshi.privacyConsent` 故意保留（合规），`payslipOptions`/`planJobId`/`reminder.last` 属偏好，可解释；但至少 `batchTemplates`（用户数据）与两个自动保护状态键应一并清除。
- 与 D22 同类：「清空」的语义在 snapshot/photos 上被认真处理（含勾选项与披露），在 localStorage 侧却没有统一清单。

**解决方案**：把键清单收敛到 `storage.ts` 的 `AUX_KEYS` 常量并让 `clearStoredState()` 遍历（保留 `privacyConsent`）；或给 `resetAll` 传 `{keepConsent:true, keepTheme:true}` 选项，逐键显式说明取舍。

**置信度**：高（键清单与引用点均已核实）。

---

### A07 [P3] 导入信任包内 `paymentStatus`，与 `paidAmount` 矛盾时不校正；体检无对应规则

**位置**：`src/lib/storage.ts:574-580`；`src/lib/payment.ts:10-24`

**证据摘录**
```ts
// storage.ts:574-580
const paymentStatus = raw.paymentStatus
  ? pick(raw.paymentStatus, ['unpaid','partial','paid'] as const, 'unpaid')
  : paidAmount <= 0 ? 'unpaid' : paidAmount >= net ? 'paid' : 'partial';
```
```ts
// payment.ts:10-16
export function paymentStatusOf(s: Settlement): PaymentStatus {
  if (s.paymentStatus) return s.paymentStatus;      // ← 有值时完全信任
  ...
}
export function remainingAmountOf(s) { return Math.max(0, round2(s.net - paidAmountOf(s))); }
```
**影响**：手改/第三方工具生成的备份里写 `paymentStatus:"paid", paidAmount:0` 时，导入后结算单徽标显示「已发」、`paidAt` 可能为空，而 `remainingAmountOf` 仍算出 `net` → 列表「待收」汇总与徽标自相矛盾；health 的 `payment-over-net` 只查「收多」，不查「状态=paid 但未收满」，两处都发现不了。属导入不变量缺口（与 A10/D26 同类的跨字段一致性）。

**触发条件**：手改备份/第三方生成备份；App 自身导出永远自洽。

**解决方案**：`normalizeSettlement` 以 `paidAmount` 为准重算状态（`raw.paymentStatus` 仅在 `paid >= net` 时可为 paid……），或矛盾时抛错拒绝导入；health 增规则「paymentStatus 与 paidAmount 不一致」。

**置信度**：高（代码确定）。

---

### A08 [P3] 导入静默丢弃超限回收站记录

**位置**：`src/lib/storage.ts:788,1028-1030`；`src/lib/trash.ts:74-81`

**证据摘录**
```ts
// storage.ts:1027-1030
trashedJobs: activeTrash,
trashedEntries: limitTrash(purgeExpiredTrash(trashedEntries)),
trashedRests: limitTrash(purgeExpiredTrash(trashedRests)),
trashedAdvances: limitTrash(purgeExpiredTrash(trashedAdvances)),
```
```ts
// trash.ts:74-81
export function limitTrash<T ...>(items: T[], cap = TRASH_CAP_PER_KIND): T[] {
  const limit = Math.max(0, cap);
  const sorted = [...items].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return sorted.slice(0, limit);        // ← 超出 120 的最旧记录直接丢，无提示
}
```
**影响**：导入一份含 200 条回收站工记的备份 → 最旧 80 条被静默丢弃，`onWarning` 未触发、导入成功提示不体现差异。回收站数据本身可再生成性低（是「已删除但 30 天内可恢复」的证据，含照片引用与金额）。同时 `purgeExpiredTrash` 丢弃 >30 天记录也是静默的（属设计，但同一路径上没有任何「本次导入丢弃了 N 条回收站记录」的汇总提示）。

**解决方案**：`limitTrash` 返回 `{items, dropped}` 或在 `validateImport` 里比对条数，通过 `options.onWarning` 汇总提示；回收站截断口径也可按「保留最新 N 条 + 提示」写入导入结果页。

**置信度**：高（代码确定）；影响面限于回收站，故 P3。

---

### A09 [P3] 快照/备份不含照片，恢复后 `photoId` 悬空且无检测

**位置**：`src/lib/snapshots.ts:357`（快照只存 JSON）；`src/store.tsx:382,1190`（`prunePhotos` / `clearPhotos`）；`src/lib/storage.ts:449`（导入只保留 `photoId` 字符串）

**证据摘录**
```ts
// snapshots.ts:357
const payload = await compressPayload(JSON.stringify(state));   // 只有账本 JSON
```
```ts
// storage.ts:449
photoId: asString(raw.photoId).trim() || undefined,   // 不校验照片是否还在 IDB
```
**影响**：合法路径即可产生悬空引用——删工记（照片随回收站保留）→ 彻底删除回收站条目（`deletePhotos`，照片不可再生）→ 恢复一份更早的快照 → 该工记的 `photoId` 指向已删照片，记录详情/导出显示无照片；`health.ts` 无对应规则，界面也无提示。清空数据（`clearPhotos`）后恢复「清空前快照」同理。这不影响金额，但考勤证据的可用性被静默削弱，且与 D22「清空后快照含完整金额」的告知口径不成体系。

**触发条件**：①删除工记 → 彻底删除（照片被删）→ 恢复更早快照；②「清空所有数据」→ 恢复清空前快照。

**解决方案**：`health` 增异步规则「photoId 指向不存在的照片」（DataSafety 页本就异步读 IDB）；或恢复确认框明示「快照不含照片本体，恢复后部分工记将没有照片」；`validateImport` 无法查 IDB，改在 `replaceState` 后做一次异步校对并把结果落到提示。

**置信度**：中（代码路径确定；UI 表现未真机验证）。

---

### A10 [P3] `DataSafety` 的「清空所有数据」缺「同时删除历史快照」（D22 只落在 Profile）

**位置**：`src/pages/DataSafety.tsx:218-240,528-530`；`src/pages/Profile.tsx:76,327-352,1140-1152`

**证据摘录**
```tsx
// DataSafety.tsx:528-530
title="清空所有数据？"
description="工作、工记、休息、借支和结算会全部删除，考勤照片也会一起清理。清空前会自动存一张本机快照；快照不含照片。"
confirmLabel="全部清空"
```
```tsx
// Profile.tsx:1145-1152（同一动作的另一入口，带彻底抹除选项）
<input type="checkbox" checked={clearSnapshotsToo} ... />
<span>同时删除全部历史快照（彻底抹除账本痕迹）</span>
```
**影响**：「数据与安全」页是隐私控制的自然入口，但在此清空后最多 30 份**含完整金额与备注**的快照仍留在 IDB，页面也没告诉用户去哪删（只链到「查看本机快照」）。D22 的修复只补了 Profile 这条路；`clearSnapshots` 在 DataSafety 里完全未被引用。

**解决方案**：两处共用一个 `useClearLedger`（含 `clearSnapshotsToo` 勾选与文案），或 DataSafety 直接复用 Profile 的实现；最少也要在 DataSafety 的确认框里加同一勾选项。

**置信度**：高。

---

### A11 [P3] store 写入层缺奖金/扣款上限（UI/导入有，store 没有）

**位置**：`src/store.tsx:498-508,547-563`；对照 `src/pages/EntryEditor.tsx:389,457`、`src/lib/storage.ts:445-446`

**证据摘录**
```ts
// store.tsx:502-508
if (![input.hours, input.quantity, input.otHours, input.bonus, input.deduction].every(
  (value) => Number.isFinite(value) && value >= 0,
)) return null;                         // ← 只有下界，无 1e6 上限
```
```ts
// storage.ts:445-446（导入侧有上限）
bonus: clampValue(asNumber(raw.bonus), 0, IMPORT_LIMITS.money),
deduction: clampValue(asNumber(raw.deduction), 0, IMPORT_LIMITS.money),
```
**影响**：当前唯一调用方 EntryEditor 已用 `clampMoneyInput` / `moneyInputTooLarge` 拦截，因此**没有可触发的默认路径**；但 `addEntry/updateEntry` 是 store 公共 API（未来加「粘贴/批量导入/周期规则套用」即成为真缺陷），且与 R2 记录的「同类路径未扫全」模式一致（`addRestDay` 也未校验 `days` 只能 0.5/1，`addAdvance` 有金额上限）。属纵深防御缺口。

**解决方案**：把 `IMPORT_LIMITS` 提到导出常量，在 `addEntry/updateEntry/addAdvance/addRestDay` 复用同一组钳制/拒绝，并补一条 store 层单测。

**置信度**：高（代码确定）；危害当前为 0，故 P3。

---

### A12 [P3] `SnapshotMeta.integrity` 永不填充

**位置**：`src/lib/snapshots.ts:49`（类型）、`:317-328`（`toMeta`）

**证据摘录**
```ts
// snapshots.ts:317-328
function toMeta(record: SnapshotRecord): SnapshotMeta {
  return { id, at, reason, schema, hash, bytes, compressed, manifest: record.manifest };
}                                        // ← 丢了 record.integrity
```
**影响**：`listSnapshots()` 返回的 `SnapshotMeta.integrity` 恒为 `undefined`，类型声明的可选值（`'sha256'`）在列表路径上永不出现。当前 UI 未踩坑（`Snapshots.tsx:96` 用的是 `readSnapshotStateDetailed()` 的返回值，不是 meta），但任何后续「在列表上标出 legacy 快照」的实现都会静默失效；`snapshots.test.ts` 也未断言该字段。

**解决方案**：`toMeta` 补 `...(record.integrity ? { integrity: record.integrity } : {})`；或删掉 `SnapshotMeta.integrity` 以免误导（读取路径用的是 `SnapshotRecord`，不依赖 meta）。

**置信度**：高。

---

### A13 [P3 · 存疑] 导入时工记 `rule` 缺字段回退到「岗位当前规则」

**位置**：`src/lib/storage.ts:451`、`:301-366`

**证据摘录**
```ts
// storage.ts:451
rule: normalizeRule(raw.rule, job.rule),        // ← 缺字段以「岗位当前规则」为 base
```
```ts
// storage.ts:306-347（每个字段都走 base?.xxx 兜底）
const rate = clampValue(asNumber(raw.rate, base?.rate ?? 0), 0, IMPORT_LIMITS.rate);
const weekdayOT = clampValue(asNumber(raw.weekdayOT, base?.weekdayOT ?? 1.5), 1, IMPORT_LIMITS.otMultiplier);
```
**影响（若成立）**：一份 `entry.rule` 缺省 `weekdayOT/weekendOT/expectedDays/monthlyMode` 的外部备份（v1 期导出、或第三方精简过的 JSON）导入后，这些字段取**当前岗位设置**——用户后来把加班倍率从 1.5 调到 2，历史工记的加班费在导入后会被按 2 重算，即「导入导致历史金额平移」。App 自身导出永远写全字段，所以触发面仅限外部/手改数据；但它与「导入不得改变金额」的直觉冲突，且 `assertLinkedRecord` 只校验引用、不校验金额不变。

**验证方法**：构造 `entry.rule = {payType:'hourly', rate:30}`（缺 `weekdayOT`）的备份，`job.rule.weekdayOT=2`，比较导入前后 `payForEntry(entry).total`；若不同即成立。同时可用 `git log -S weekdayOT` 确认 v1–v3 是否存在缺该字段的导出（本轮受只读/时间限制未做历史核对）。

**解决方案**：缺字段时按「该字段的 schema 默认值」兜底（与 `normalizeRule` 的常量默认一致），而不是取岗位当前值；或导入时对 `rule` 不完整的工记通过 `onWarning` 提示「N 笔工记的计薪规则不完整，已按缺省值补齐」。

**置信度**：中（代码路径确定，外部触发面未取证）。

---

## 四、上轮修复回归抽查（10 条）

> 抽查原则：逐条读当前代码 + 跑对应测试；「声称已修复」按 fixes 文档原文比对。

| 上轮编号 | fixes 声称 | 本轮核实（当前代码/测试） | 裁定 |
| --- | --- | --- | --- |
| **D01** settleJob 绕过持久化守卫 | 「settleJob 改走 commit()，置 pendingPersist」 | `store.tsx:1051-1054` 确有 `commit(() => committed.state)` 与注释；`commit`（:386-393）置 `pendingPersist=true` 并入 `pendingUpdaters`。storage 事件守卫 `:346` 生效 | ✅ **真落地**（但引入 A01 的整包 updater 问题）|
| **D02** 跨标签页整包丢失更新 | 「乐观 CAS + 更新函数重放（stateMerge.ts）」 | `stateMerge.ts` 存在且被 `store.tsx:295-303` 调用；`isRemoteDirty`/`replayUpdaters` 有 6 条单测（`stateMerge.test.ts` 通过）。**但契约只对纯函数 updater 成立** | ⚠️ **部分落地**：纯 updater 保留双边改动；整包 updater（settleJob/generateRecurring）仍覆盖远端 → **A01** |
| **D04** 导入无大小上限 | 「导入 20MB 上限」 | `Profile.tsx:240`（`file.size > 20*1024*1024` 拒绝）、`MoveSheet.tsx:177` 同口径、`StorageRecovery.tsx:12,89-93`（`MAX_IMPORT_BYTES`）三处齐 | ✅ 真落地（三入口全覆盖）|
| **D08** prunePhotos 误删启动后新照片 | 「跳过 createdAt > 启动时刻」 | `store.tsx:253` `pruneStartedAt=nowISO()`；`:382` `prunePhotos(keep, pruneStartedAt.current)`；`photos.ts:138-142` 用 `record.createdAt > skipCreatedAfter`（两侧同为 `toISOString()` UTC，字符串比较口径一致）| ✅ 真落地 |
| **D09** resetAll 被其他标签页复活 | 「广播 epoch，其他窗口丢弃未落盘改动」 | `store.tsx:73-79` 写 `xinshi.ledgerEpoch`；`:329-342` 收到 epoch 事件即清空 `pendingUpdaters/pendingPersist/remoteDirty` 并以远端为准；`resetAll`（:1182-1192）先 `commit(空账)` 再 `clearStoredState()` 再 `broadcastLedgerEpoch()` | ✅ 真落地（残留极窄：epoch 写入被 catch 吞掉时无二次保障）|
| **D10** 原生桥无超时 | 「45s 超时」 | `saveFile.ts:27-33` `NATIVE_BRIDGE_TIMEOUT_MS=45_000` + `withTimeout`；`autoBackup.ts:196` `running=null` 在 finally 释放 | ✅ 真落地 |
| **D11** 导入放行「周期内未锁定工记」+ 体检无规则 | 「导入拒绝 + 体检规则」 | `storage.ts:928-942`（`rejectUnsettledInPeriod`）；`health.ts:159-175` 新增 `unsettled-in-settled-period`；调用点：`Profile.tsx:258-259,287-288`、`MoveSheet.tsx:79-80`、`StorageRecovery.tsx:70-71` 全部传入；加密路径由 `Profile.tsx:275-291`/`MoveSheet.revalidateImport` 二次复核 | ✅ 真落地（覆盖 4 个入口 + 加密二次校验）|
| **D19** PBKDF2 250k | 「600k」 | `crypto.ts:8` `PBKDF2_ITERATIONS=600_000`；`backup.ts:45,55` 与 `movePackage.ts` 均写入包内；解密接受 100k–1M 区间（`backup.ts:88-94`、`movePackage.ts:191-193`）| ✅ 真落地 |
| **D22** 清空后快照全留 | 「提供『同时删除所有快照』选项 + 文案披露」 | `Profile.tsx:1140-1152` 勾选 + 披露 + `clearSnapshots()`（:339）；**但 `DataSafety.clearAll` 没有该选项** | ⚠️ 部分落地 → **A10** |
| **D28** storage.test 固定时间炸弹 | 「改相对 daysAgo()」 | `storage.test.ts:14` 定义 `daysAgo`，:176/196/360-362/403/421/482/908 全部改用相对值；本轮实测该文件 41 用例全通过（今日为 2026-11-20）| ✅ 真落地 |

**附加抽查（D 组其余）**：D13（`health.ts:73` `new Set(entryIds)` 去重）✅、D14（`health.ts:138-157` 单向引用规则）✅、D15（`snapshots.ts:426-437` 仅接受 sha256 + `bytes` 校验；`stateHash` 无 sha 直接抛错）✅、D16（`decompressPayload` 流式 64MB 上限）✅、D17（`snapshots.ts:394-397` prune 失败降级 warning + 调用方 toast）✅、D21（`store.tsx:82-92` 按 error.name 分类文案）✅、D24（`asTimestamp` Date.parse 校验）✅、D26（`storage.ts:967,981-983,997` 跨集合重复 ID 跳过）✅、D33（`backupStatus.ts:43-45` 文案改「24 小时内」）✅、D35（`useAutoSnapshot.ts:102-108` 每日定时器 cleanup + `recordSnapshotError`）✅、D36（`movePackage.ts:83-98,100-110` canonicalJson 键序无关 + 双口径兼容）✅。

**「声称已修复但未落地/回归」结论**：**未发现虚报**。D02（部分）与 D22（部分）是仅有的两处未扫全，且都由新的入口/新的写入类型造成，模式与 R2 §8.2 总结的「同类路径未扫全」一致：D02 漏了整包 updater，D22 漏了 DataSafety 入口。

---

## 五、已排除疑点（防误报记录，12 条）

| # | 疑点 | 排除依据 |
| --- | --- | --- |
| 1 | `storage.ts:243/262/287` 正则里出现 `\\d`（双反斜杠）| 查看工具的转义现象（R2 §8.3.4 已用十六进制独立复核过同类现象）；`isValidDate`/`asTime` 均有单测覆盖并通过 |
| 2 | `Snapshots.tsx:96` 用 `snapshot.integrity`（meta 里恒 undefined）| 该处 `snapshot` 是 `readSnapshotStateDetailed(meta.id)` 的返回值（`snapshots.ts:450-470`），`integrity` 由 `verifySnapshotIntegrity` 真实返回；仅 A12 属类型声明层面的瑕疵 |
| 3 | 快照恢复后「金额被校验改动」| `readSnapshotStateDetailed` 先 `verifySnapshotIntegrity`（尺寸 + sha256）再 `validateImport`；篡改会抛错（`snapshots.test.ts` 有篡改用例，通过）|
| 4 | `movePackage` 校验码仍依赖键序 | `MOVE_CHECKSUM_VERSION=2` + `canonicalJson` 递归排序键（`movePackage.ts:83-98`），旧包双口径兼容（:196-215）|
| 5 | 加密备份 IV 复用 | `encryptBackup`/`buildMovePackage` 每次 `randomBytes(IV_BYTES)` 生成新 IV（`backup.ts:43-44`、`movePackage.ts:285-286`），同一 salt/iv 不会跨包复用 |
| 6 | 迁移 v1→v7 半途失败留下坏包 | `loadStateDetailed:96-108`：先 `getItem(STORAGE_KEY)===null` 二次确认再 `saveState`，成功后才 `removeItem(legacy)`；失败仅 `console.warn` 并返回已校验的 state → 下次冷启动重做，**幂等** |
| 7 | 降级安装（新→旧 App）读不到账本 | schema 自 v1.0 冻结在 v7 且新增字段只允许可选（`storage.ts:31-32` 注释 + `SCHEMA_VERSION=7`）；`assertSchemaVersion` 对 `>7` 拒绝而非静默丢弃（:731-737）|
| 8 | `toISOString().slice(0,10)` 类隐式 UTC 陷阱 | `date.ts` 全部走 `parseISODate`/`toISODate` 本地时区（`toISODate` 用 getFullYear/getMonth/getDate，:9-11）；`nowISO()` 仅用于时间戳；`prunePhotos` 的字符串比较两侧同为 UTC ISO，口径一致。**未发现隐式 UTC 换日** |
| 9 | 闰日/月末钳制错误 | `addMonths` 先 setDate(1) 再 setMonth 再 `min(day, last)`（:28-36）；`daysInMonth` 用 `new Date(y, m+1, 0)`；`isValidDate` 显式闰年表（:249-251）|
| 10 | health 其它规则混用真实时钟 | 逐条核对 14 条规则，仅 `backup-stale` 用 `Date.now()`（A04）；`checkedAt` 属展示字段 |
| 11 | 回收站 30 天清理会误删未过期记录 | `purgeExpiredTrash` 用 `now - deleted < 30*DAY_MS` 保留；`deletedAt` 非法值在导入时被 `asString(..., now)` 兜底；`trash.test.ts` 16 用例通过 |
| 12 | 删除照片前未落盘（A7）| `purgeTrashItem`/`emptyTrash` 均先 `commit` 再 `persistNow()`，只有返回 true 才 `deletePhotos`（`store.tsx:999-1001,1023-1025`）|
| 13 | `loadDemo` 覆盖用户真实账本 | 唯一调用点是 `Onboarding.tsx:225`（首次引导、账本尚空），不在设置页暴露 |
| 14 | 快照解压 gzip 炸弹 / 快照无字节上限 | `decompressPayload` 流式累计 64MB 上限（:179-188）；`SNAPSHOT_MAX_BYTES=30MB` 参与 prune |

---

## 六、无法确证 / 需真机或运行时验证

| 项 | 说明 | 验证方法 |
| --- | --- | --- |
| A01 的实际丢失率 | 需要真实双窗口竞态 | DevTools 双标签页：A 点「结算」，在 `commit` 与 effect 间打断点，B 窗口保存一笔；观察 A 落盘后 B 的工记是否消失 |
| A02 的触发概率 | 需制造写失败 | 隐私模式/人为写满配额（`xinshi.state.v7` 塞大字符串）→ 触发一次保存失败 → 另一窗口写入 → 再操作 |
| A03 的 `'shared'` 真机行为 | Android 5–9 分享面板取消语义只在真机成立 | LDPlayer/真机 Android 9：开启自动备份，取消分享面板，检查 `xinshi.autoBackup` 的 `lastRunAt` 与当天是否重试 |
| A09 的 UI 表现 | 断链照片在详情/导出中的实际渲染未验证 | 造「删工记→彻底删除→恢复旧快照」序列，打开该工记详情 |
| A13 的历史数据面 | 需核对 v1–v3 导出是否缺 `weekdayOT` 等字段 | `git log -S weekdayOT -- src/lib/storage.ts src/types.ts`；再按 A13 的构造用例验证金额变化 |
| 多标签页整体口径 | 本审计未做真机/浏览器双窗口实测 | 按 R2 §9「多标签页竞态验证方法」执行 |

---

## 七、方法说明与限制

1. 本轮**未修改任何源码**；仅新增本文件。未执行 `pnpm build`、未安装依赖、未 `git commit`。
2. 只读命令：`grep`/全文读取/`npx vitest run <单个文件>`（`storage/v120Storage/stateMerge/checksum/movePackage/snapshots/autoBackup/trash/health`）。
3. 未启动 dev server、未做真机验证；A01/A02/A03/A09 的「是否真的丢数据」属推理 + 代码路径，已在上表标注验证方法。
4. `A13` 标注「存疑」：代码路径确定，但「现实中存在缺字段的外部备份」未取证。
