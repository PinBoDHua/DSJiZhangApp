# 薪时 XINSHI · v1.2.5 第三轮审计修复记录

> 修复日期：2026-11-20（Asia/Shanghai）
> 依据：[docs/AUDIT-v1.2.5.md](AUDIT-v1.2.5.md)（第三轮审计：63 条，P0×0 / P1×2 / P2×15 / P3×46）
> 代码基线：git HEAD `d0d8f83`（v1.2.5 / versionCode 1205 / SW v32）；本轮改动**尚未提交**（27 个文件）
> 范围：批次 0–4，即全部 P1 + P2 共 **18 项**（P1×2、P2×16；A04 由 P3 提级为 P2 后一并修复）
> 验证：`tsc --noEmit` 0 错误；**43 文件 / 390 用例全绿**；`vite build` 通过；`check:release` **25 PASS / 0 FAIL**；`check-offline-csp` 16 项全 PASS（预缓存 43 项）

---

## 一、总览

| 批次 | 编号 | 级别 | 结论 | 关键文件 |
| --- | --- | --- | --- | --- |
| 0 | **A04** 时间炸弹 | P2 | 已修 | `health.ts`、`health.test.ts` |
| 0 | **B01** 月薪×日结封顶回归 | P1 | 已修（累计封顶） | `settlement.ts`、`pay.test.ts`、`excel.ts` |
| 0 | D15 修复记录不一致 | P3 | 已修（文档） | `AUDIT-v1.2.4-R2-fixes.md` |
| 1 | **A01** 整包 updater 覆盖远端 | P1 | 已修 | `store.tsx`、`settlement.ts` |
| 1 | A02 保存失败丢内存改动 | P2 | 已修 | `store.tsx` |
| 1 | A03 自动备份 `shared` 假成功 | P2 | 已修 | `autoBackup.ts`、`App.tsx`、测试 |
| 1 | A06 清空不彻底 | P3 | 已修 | `storage.ts`、`storage.test.ts` |
| 1 | A10 清空缺快照选项 | P3 | 已修 | `DataSafety.tsx` |
| 2 | B02 超休额度取当前设置 | P2 | 已修（快照化） | `settlement.ts`、`pay.test.ts` |
| 2 | B03 负净额借支不递延 | P2 | 已修（自动结转） | `settlement.ts`、`pay.test.ts` |
| 2 | B04 校验码含收款字段 | P2 | 已修（结算码/收款码分离） | `checksum.ts`、测试 |
| 3 | C01 工作管理明文单价 | P2 | 已修 | `Jobs.tsx` |
| 3 | C02 字体未预缓存 | P2 | 已修 | `vite.config.ts` |
| 3 | C03 红条遮挡返回键 | P2 | 已修 | `App.tsx`、`styles.css` |
| 3 | C04 网页返回键直接退出 | P2 | 已修 | `nativeBack.ts`、`main.tsx` |
| 3 | C08 隐藏金额残留 3 处 | P3 | 已修 | `pagePay.ts`、`SettlementPage.tsx`、`ShareQrSheet.tsx` |
| 4 | **D01** `-Pxinshi.diag` 未被拦截 | P2 | 已修 | `android/app/build.gradle` |
| 4 | D02 aapt2 发现降级 NOTE | P2 | 已修 | `scripts/check-release-config.mjs` |
| 4 | D03 门禁不校验版本/签名 | P2 | 已修 | 同上 |
| 4 | D04 assets 漂移无断言 | P2 | 已修 | 同上 |
| 4 | D05 STORE-LISTING 过期 | P2 | 已修 | `docs/STORE-LISTING.md` |
| 4 | D06 `.env.example` 占位域名 | P2 | 已修 | `.env.example`、检查脚本 |

**测试增量**：384 → **390**（health 时间炸弹守卫、checksum 结算码/收款码、B02 超休快照、B03 结转、B01 未结合计不虚高；A03/A06 由数据线补充）。

---

## 二、批次 0 · 提交前必须

### A04 时间炸弹（`health.ts:339-346`）

`backup-stale` 规则改用注入的 `today`：

```ts
const staleBackup =
  !lastBackup || Number.isNaN(lastBackup.getTime()) ||
  daysBetween(toISODate(lastBackup), today) > 14;
```

新增守卫用例：同一份固定 `lastBackupAt`，`today=2026-11-05` 不报、`today=2026-11-20` 必报 —— 任何真实日期跑都稳定。

### B01 累计封顶（按方案 A）

**旧口径的问题**：`periodShare = 周期日历天 / 当月天数`，日结一期只有 1 天 → 封顶被压到 `3500/30=116.67`，而应计 `3500/22=159.09`，21 个工作日只发 2450.07。

**新口径**：同一岗位同一自然月内「已结算周期占用的基础工资 + 本期」不超过月薪。

```ts
// sumEntriesCapped：cumulativeCap 时
cap = Math.max(0, capBase - (settledBaseByMonth[`${jobId}|${monthKey}`] ?? 0));
```

- `buildSettlementDraft` 从 `entries`（含已结算）算出 `settledBaseByMonth`，并接受 `simulatedSettledBase` 供预览侧模拟。
- `summarizeUnsettledJob` / Excel 预估逐期试算时累计消耗同月额度，**未结合计不再高估**（新增用例：30 天周结未结合计 = 3500 ± 分币）。
- 统计窗口（周档展示）仍走 `periodShareCap`，与「实际结算」分离；`pay.test.ts` 已把两者差异写成显式断言。

**效果**：日结 21 天 = 3340.89（恢复 v1.2.4 行为）；30 天全勤多期合计 = 3500；11-16 起 11 天 = 1750。

### D15 文档更正

`AUDIT-v1.2.4-R2-fixes.md` 的 `15 PASS → 16 PASS`、`SW v31 → SW v32`、`扩展到 15 项 → 16 项` 已按当时实测更正。

---

## 三、批次 1 · 数据安全

- **A01**：`settleJob` 改为 `commit(prev => applySettlementToState(prev, settlement))`；`generateRecurring` 只把新增工记与规则水位叠加到 `prev`。跨标签页 CAS 重放不再整包覆盖远端。`applySettlementToState` 幂等（重复应用不重复锁定）。
- **A02**：落盘失败分支不再清空 `pendingUpdaters` / `remoteDirty`，保留到下次提交走 CAS 合并，避免「存储恢复后改动被静默丢弃」。
- **A03**：`autoBackup` 在 `shared`（分享面板可能取消）时提前返回——不写 `lastRunAt`/`lastFile`、不清 `lastError`、不清失败退避、跳过旧备份清理；`App.tsx` 把 `warning` 接到 toast。
- **A06**：`clearStoredState` 覆盖全部 `xinshi.*` 附属键（批量模板、自动备份、预算提醒、工资条选项、隐私同意、计划岗位等），保留 `LEDGER_EPOCH_KEY` 供清空后广播。
- **A10**：DataSafety 清空弹窗新增「同时删除全部历史快照」勾选项（默认不勾），复用 `clearSnapshots()`，失败单独 toast。

---

## 四、批次 2 · 金额口径

- **B02**：超休额度 / 休息规则改取 `latestEntry.rule`（工记快照），只有纯借支周期才回退到岗位当前设置。结算前改「月休额度」不再追溯多扣。
- **B03**：负净额不再一笔勾销。`applySettlementToState` 在 `net < 0` 时生成一张未锁定的结转借支（`carry-<settlementId>`，日期=周期末），下一期结算自动抵扣；用 id 去重，重复应用不会重复结转。
- **B04**：`settlementChecksum` 的 canonical 去掉 `paidAmount/paymentStatus`，登记收款前后结算码不变；新增 `paymentChecksum` 覆盖收款字段；`verifySettlementChecksum` 同时兼容旧「含收款字段」的 sha256 码与 FNV 旧码。

---

## 五、批次 3 · 隐私与离线

- **C01**：`Jobs.tsx` 岗位卡单价改为 `hideAmounts ? <Money/> : rateLabel(...)`。
- **C02**：`PRECACHE_EXTENSIONS` 加入 `.ttf`，`precache-manifest` 42 → **43 项**，PWA 首装断网后文字版 PDF 可用（首装 +2.4MB，已知取舍）。
- **C03**：告警条改 `sticky` 占位（z 60 → 25），App 测量 `--storage-banner-h`，`.subpage` / `.subpage-inner` 整体下移，返回键不再被盖。
- **C04**：新增 `installWebBack()`：网页 / PWA 用单条 history 哨兵 + `popstate` 关闭子页/弹层；原生壳仍走 Capacitor `backButton`，两者不并存。
- **C08**：撤销结算弹窗金额、超休扣款 placeholder、结算二维码三处接入 `hideAmounts`；二维码在隐藏金额时**不生成**，改为提示先关闭隐藏。

---

## 六、批次 4 · 发布链

- **D01**：Gradle 守卫新增 `xinshiDiag` 中止（错误信息说明会写公共 Download）；`check:release` 增断言「守卫拦截诊断构建」。
- **D02**：aapt2 依次从 `ANDROID_HOME` → `ANDROID_SDK_ROOT` → `android/local.properties` → 常见路径查找；找不到默认 FAIL，需显式 `SKIP_APK_CHECK=1`。
- **D03**：新增 release APK `versionCode/versionName` 与 `package.json` 一致性断言（3 个 APK）、`apksigner` 证书 SHA-256 与登记值一致性断言。
- **D04**：`dist` ↔ `assets/public` 逐文件 sha256 比对（白名单仅 `cordova.js` / `cordova_plugins.js`），不一致 FAIL 并列出差异。
- **D05**：`STORE-LISTING.md` 更新到 1.2.5 / 1205，补 APK/AAB 的 SHA-256。
- **D06**：`.env.example` 移除 `example.com` 默认值（注释说明）；`check:release` 对 `example.com/.org/.net`、占位邮箱一律 FAIL。

---

## 七、验证结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx vitest run --no-file-parallelism` | ✅ 43 文件 / **390 用例全绿**（基线 384，新增 6） |
| `npx vite build` | ✅ 通过（主 chunk 492.68KB / gzip 155.55KB） |
| `npx cap sync android` | ✅ 完成，assets 与 dist 同步 |
| `node scripts/check-release-config.mjs` | ✅ **25 PASS / 0 FAIL**（含 3 个 APK 的 debuggable / 版本 / 证书断言、assets 同源断言） |
| `node scripts/check-offline-csp.mjs` | ✅ 16 项全 PASS（预缓存 **43** 项、CSP hash 一致、SW v32） |
| `node --check scripts/*.mjs` | ✅ 全部通过 |

---

## 八、行为变化与兼容性（发布前必读）

1. **结算校验码格式变化**：新结算码不再包含收款字段。旧码仍可验证（`verifySettlementChecksum` 兼容 v1 含收款字段的 sha256 与 FNV 旧码）；但**同一张单升级前后生成的码不同**，对账时请以新码为准。
2. **负净额会新增一条「结转借支」记录**：如「借 1000、应发 240」，结算后账本会多一条 `amount=760`、备注「上期应发不足，自动结转」的未结借支，下一期自动抵扣。这是有意的可见账，不是重复计费。
3. **「清空所有数据」现在会清隐私同意状态**：清空后隐私弹窗会重新出现（属预期，因为本地同意记录也被清除）。
4. **`check:release` 变严格**：无 Android SDK 时必须 `SKIP_APK_CHECK=1`；改前端后必须先 `vite build && cap sync android`，否则 assets 同源断言会 FAIL（这是设计目的）。
5. **B01 只影响新结算**：历史结算单金额不变；同一自然月内已结算的部分会占用月度封顶额度。

---

## 九、本轮未做（按约定留待后续）

- 批次 5 的 46 条 P3（依赖升级 DEP-01/02/03、CI、SW 导航缓存、长列表虚拟化、脚本硬编码、release 索引、gradle sha256 等）。
- 需真机验证的项：C04 网页返回手势、C03 安全区、D01 诊断包行为、D10 SW 更新窗口。
- 需业务办理的项：隐私政策公开 HTTPS 托管（AND-04）。

## 十、发布前人工事项

1. 用真实 `VITE_PRIVACY_URL` / `VITE_SUPPORT_EMAIL` 构建，并在无登录窗口打开确认可访问。
2. 跑 `pnpm build && npx cap sync android` 后再 `node scripts/check-release-config.mjs`（应为 25 PASS）。
3. 真机回归：子页返回键、弹层返回、PWA 首装断网文字版 PDF、清空后重新同意隐私、结算负数净额的结转。
4. 重新签名打包，更新 `RELEASE-NOTES` 与 `STORE-LISTING` 的 SHA。
