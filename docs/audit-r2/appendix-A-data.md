# 薪时 XINSHI v1.2.4 数据层审计发现（audit-data / task-1）

> 审计日期：2026-11-17（Asia/Shanghai）
> 基线：git HEAD 6c0f682（工作树干净，仅 .audit-work/ 未跟踪）
> 范围：src/lib 数据层（storage/snapshots/trash/backup/autoBackup/backupStatus/crypto/checksum/movePackage/saveFile/native/photos/photoStamp/health/guards/id/seed/meta/version/emptyModule/testFixtures）+ src/store.tsx 持久化路径 + StorageRecovery.tsx + 对应测试。
> 方式：只读静态审计（ops_inspect_local_file 全文分页阅读 + ops_grep 交叉核对），未运行任何构建/测试。
> 对照：docs/AUDIT-v1.2.4.md（2026-11-12）A 组修复 A1–A11。
> 严重度：P0=数据丢失/损坏、安全漏洞、发布阻断；P1=重大功能错误、隐私泄露；P2=一般缺陷/边界；P3=代码质量/测试债务。
> 本轮未发现 P0。P1×3、P2×8、P3×25（详见文末统计）。

---

## 一、发现清单

### D01 [P1] settleJob 绕过 pendingPersist 守卫：跨标签页事件可吞掉刚提交的结算（A1 守卫漏洞）
- 位置：src/store.tsx:947-962（对照 commit() src/store.tsx:303-308、storage 监听 src/store.tsx:264-280）
- 问题与证据：所有写操作都经 `commit()`（先置 `pendingPersist.current = true` 再 setState），唯独 settleJob 直接改 ref/state：
  ```ts
  const committed = commitSettlement(stateRef.current, {...});
  if (!committed) return null;
  stateRef.current = committed.state;   // 960
  setState(committed.state);            // 961 —— 没有 pendingPersist.current = true
  ```
  storage 监听以 `if (pendingPersist.current) return;`（269）作为唯一守卫。settleJob 提交后、持久化 effect（245-260）运行前，若另一标签页的 storage 事件到达，守卫为 false → `loadStateDetailed()` 读回远端（不含本笔结算）→ `stateRef.current = next; setState(next)`（274-275）→ 持久化 effect 把远端旧账写回 localStorage。
- 影响/触发条件：双标签页（PWA/桌面浏览器）场景，A 窗口点「确认结算」的同一时刻 B 窗口有任何落盘写入（记工/改设置/自动保存），A 的结算单连同被锁定的工记引用一起静默消失，且 A 随后收到 B 的同步事件还会再弹「已同步最新数据」。结算=金额记录，丢失后工记解锁状态与金额全部回退，无报错。Android WebView 单窗口不受影响。
- 建议方案：settleJob 改走 commit()（或在 setState 前置 pendingPersist=true）；更彻底的做法见 D02。
- 置信度：已确认（代码路径完整；竞态窗口=setState 到 effect 执行之间，React 并发渲染/长任务下可达数十 ms 以上）。

### D02 [P1] 跨标签页并发编辑仍会整包丢失更新（A1 修复不完整，设计性残留）
- 位置：src/store.tsx:264-280（storage 监听）、303-308（commit）、245-260（持久化 effect）；src/lib/storage.ts:122-130（saveState 无 CAS）
- 问题与证据：A1 修复消除了「读取即回写」，但整本账仍是 last-writer-wins：
  1. 两窗口同持 S0。A 记工 → 保存 SA。B 在收到 A 的 storage 事件之前（事件是异步任务，后台标签页会被节流延迟）也记工 → `commit` 基于旧 `stateRef.current`（S0）生成 SB → effect `saveState(SB)` 整包覆盖 SA。
  2. `pendingPersist=true` 时收到的远端事件被**直接丢弃且不补读**（269 行 return 后无排队/重读逻辑），本地落盘后永远不会再主动拉取远端。
  3. A 收到 B 的写入事件 → 同步为 SB → A 刚记的那笔从内存和磁盘同时消失，只有一句「账本已在其他窗口更新」的 info toast。
- 影响/触发条件：两个窗口在事件传播延迟窗口内（前台通常 ms 级，后台/低端机可达秒级）各自提交写操作 → 后写窗口之外的所有改动丢失。丢失粒度=整本账本差异（可能多笔工记/结算）。无合并、无版本号、无冲突提示。
- 建议方案：短期——落盘前重读 localStorage 比对（乐观 CAS：写入前 getItem 与上次已知值比较，不一致则先合并/提示）；或 storage 事件被守卫丢弃时置「远端已变脏」标记，本地落盘后立即重读合并。长期——按记录 ID 的增量合并或单写者选举（BroadcastChannel leader）。
- 置信度：已确认（代码证据充分；实际触发频率需多窗口运行时验证，但路径无任何拦截）。

### D03 [P1] MoveSheet 搬家包导出未守卫 'shared'：markBackedUp 误重置 14 天备份提醒（A5 遗漏点）
- 位置：src/components/MoveSheet.tsx:109-116（对照已守卫的 src/pages/DataSafety.tsx:90-94、src/pages/Profile.tsx:182-186/214-218、src/lib/autoBackup.ts:106/128）
- 问题与证据：
  ```ts
  const saved = await saveTextFile(filename, text);
  markBackedUp();                        // 110 —— 无 if (saved === 'shared') 守卫
  setResult({...});
  toast('搬家包已导出', 'success');       // 116
  ```
  结果屏还显示「搬家包已保存」（255）。A5 修复覆盖了 autoBackup/DataSafety/Profile 三处，唯独 MoveSheet 漏掉。Android 5–9 走系统分享面板（saveFile.ts:6-7 注释、native.ts:35），用户取消时没有任何文件落盘。
- 影响/触发条件：Android 5–9 用户导出搬家包 → 分享面板取消 → `xinshi.lastBackup` 被重置为当前时间 → 首页备份提醒（backupIsDue，backupStatus.ts:30-38）与体检 backup-stale（health.ts:296-311）静默 14 天。期间用户以为已有离机备份，手机丢失/清缓存即全账丢失且无提醒。与 A5 原始定级（P1）同一危害路径。
- 建议方案：与 DataSafety.quickBackup 同口径：`if (saved === 'shared') { toast('已打开系统分享面板，请确认文件已保存','info'); return; }`，结果屏文案区分「已保存/待确认」。
- 置信度：已确认。

### D04 [P2] 备份/搬家包导入无文件大小上限：超大文件可致 WebView OOM 崩溃
- 位置：src/components/MoveSheet.tsx:145（`const text = await file.text()`）、src/pages/Profile.tsx:238（同）；src/lib/movePackage.ts:188-196（parseMovePackage 直接 JSON.parse 全文）、src/lib/storage.ts:617-622
- 问题与证据：照片输入有 25MB 上限（photoStamp.ts:6/182）、原生保存有 32MB 上限（saveFile.ts:25/47），但导入路径对 file.size 无任何检查；`file.text()` 全量读入内存后再 JSON.parse（峰值≈2–3 倍文件大小）。搬家包 payload 为 base64 密文/明文 JSON，无压缩，也没有解压炸弹问题，但尺寸完全不设防。
- 影响/触发条件：用户误选几百 MB 的「备份」（或恶意构造的大文件）→ 低端 Android WebView（目标用户机型）内存耗尽崩溃；崩溃发生在读取阶段，账本本身无损，但体验为「一点导入就闪退」。
- 建议方案：读取前检查 `file.size > 20MB`（账本 localStorage 上限约 5MB，正常备份远小于此）直接拒绝并提示；parseMovePackage 前同样设限。
- 置信度：已确认（无上限为代码事实；崩溃阈值依设备内存，需真机验证具体尺寸）。

### D05 [P2] 导入钳制不完整：计薪规则/借支/结算/周期规则金额无上限（A3 残留）
- 位置：src/lib/storage.ts:264-286（normalizeRule）、405（normalizeAdvance.amount）、529-545（normalizeSettlement 各金额）、595-596（normalizeRecurringRule.bonus/deduction）
- 问题与证据：A3 只钳制了工记字段（378-383：hours/otHours≤24、quantity/bonus/deduction≤1e6、breakMinutes≤1440），但：
  ```ts
  const rate = Math.max(0, asNumber(raw.rate, ...));          // 264 无上限
  const expectedDays = Math.max(1, asNumber(...));            // 266 无上限
  const weekdayOT = Math.max(1, asNumber(...));               // 284-286 无上限
  amount: Math.max(0, asNumber(raw.amount)),                  // 405 借支无上限
  bonus: Math.max(0, asNumber(raw.bonus)),                    // 595 周期规则无上限
  ```
  对照 App 自身口径：addAdvance 限 amount≤1e6（store.tsx:657）、validRecurringInput 限 bonus/deduction≤1e6（store.tsx:85-87）。结算 net/base/otPay 等也仅 asNumber（可负、可 1e15）。
- 影响/触发条件：手改/第三方备份写入 rate=1e12 的时薪岗位 → 导入成功 → 每笔工记金额 2.4e13 级别，统计/结算/预算全部失真；expectedDays=1e9 使月薪折算≈0；weekdayOT=1e6 放大加班费。与 A3 原始问题（1000 小时/1e9 计件）同类，只是换到规则层。
- 建议方案：与录入口径对齐——rate/overRestDailyRate≤1e6、standardHours≤24、expectedDays≤31、OT 倍率≤10、advance.amount≤1e6、recurring bonus/deduction≤1e6；结算金额至少做 Number.isFinite + 合理上限（如 1e9）与 net≥-1e9 钳制。
- 置信度：已确认。

### D06 [P2] 导入不校验 otHours ≤ hours（C7 只修在 UI 层，导入路径回归原问题）
- 位置：src/lib/storage.ts:379-381（hours 与 otHours 各自独立钳制到 24）
- 问题与证据：`hours: clamp(raw.hours, 24), otHours: clamp(raw.otHours, 24)` 两者无交叉校验。C7 修复在 EntryEditor 提交校验「加班时长不能大于总工时」，但 validateImport 不检查。
- 影响/触发条件：手改备份 hours=1、otHours=24 → 导入成功；计薪层按 C7 描述会静默裁剪加班时长，统计口径（otHours 原样累计）与计薪口径不一致，结算单加班费与统计页加班时长对不上。
- 建议方案：normalizeEntry 中 `otHours = Math.min(otHours, hours)`（与计薪层裁剪同口径）或超出即拒绝导入。
- 置信度：已确认（导入侧无校验为代码事实；计薪层裁剪行为属 B 组范围，引用 AUDIT C7 描述）。

### D07 [P2] 过期回收站「工作」仍可恢复（A11 遗漏：job 分支绕过过期拦截）
- 位置：src/store.tsx:794-807（restoreTrashItem 的 job 分支提前 return）、375-392（restoreJob 同样无过期检查）；对照 src/lib/trash.ts:228-229、src/components/TrashSheet.tsx:101-108
- 问题与证据：A11 在 `trashRestoreBlockReason` 加了过期拦截（trash.ts:228），且该函数本身支持 job 行（229 行 `if (row.kind === 'job') return null` 在过期检查**之后**）。但 store 的 job 分支在调用 trashRestoreBlockReason（811）**之前**就 return {ok:true}：
  ```ts
  if (kind === 'job') { ...commit(...); return { ok: true }; }   // 794-807
  const row = buildTrashRows(current).find(...);                  // 809
  const reason = trashRestoreBlockReason(row, current);           // 811 —— job 永远走不到
  ```
  TrashSheet.handleRestore 直接调 restoreTrashItem，UI 也无 remainingDays 拦截。
- 影响/触发条件：长驻会话（App 挂后台数天不重启）里，删除超过 30 天的工作仍在回收站列表且可一键恢复；工记/休息/借支则被正确拦截——同一界面两类行为不一致。恢复过期工作本身不丢数据，但违背「30 天保留期」承诺，且过期工作恢复后其关联过期工记仍不可恢复，形成半残状态。
- 建议方案：job 分支也走 trashRestoreBlockReason（或先查 trashRemainingDays<=0）；restoreJob 同步加拦截。
- 置信度：已确认。

### D08 [P2] 启动 prunePhotos 竞态：可删除刚保存的新照片（孤儿清理误伤）
- 位置：src/store.tsx:290-300（mount 时计算 keep 集）、src/lib/photos.ts:118-140（prunePhotos 游标删除）
- 问题与证据：keep 集在 mount 瞬间用 `stateRef.current` 的 entries/trashedEntries 计算；prunePhotos 随后开 readwrite 事务游标遍历，`if (!keepIds.has(record.id)) cursor.delete()`。照片 ID 为 `photo_<uuid>`（id.ts），新照片在事务迭代期间 put 进来仍可能被游标访问到，且必然不在启动时的 keep 集里。
- 影响/触发条件：冷启动后立刻记工并拍照（目标用户常见动作），低端机照片库大、prune 事务耗时数秒 → 新照片被删 → 工记 photoId 悬空，详情页照片永久丢失（照片无备份，快照不含照片）。另一变体：双标签页时 B 窗口有未落盘的新照片，A 窗口重启 prune 按 A 的账本清理 → 删掉 B 的照片。
- 建议方案：prune 时跳过 `createdAt > prune启动时刻` 的记录；或删除前重读最新账本引用；跨标签页场景用 BroadcastChannel 协调。
- 置信度：已确认（竞态路径代码级成立；实际命中概率需运行时验证，依赖启动后操作速度与照片库规模）。

### D09 [P2] resetAll「清空所有数据」可被另一标签页的未落盘改动复活
- 位置：src/store.tsx:1063-1069（resetAll）、264-280（storage 监听 pendingPersist 守卫）
- 问题与证据：resetAll 先 `clearStoredState()`（逐键 removeItem）再 commit 空账。另一标签页若恰有 `pendingPersist=true` 的未落盘改动，会忽略清空事件（269），随后其持久化 effect 把**完整旧账**写回 localStorage；发起清空的窗口收到该写入事件后又同步回旧账。
- 影响/触发条件：双窗口场景，B 窗口刚记了一笔还没落盘（或落盘失败重试中），A 窗口执行「清空所有数据」→ 清空被静默撤销，全部旧数据复活。用户以为隐私数据已清除（换机/借机场景），实际仍在。
- 建议方案：清空走 replaceState 语义并广播「清空意图」（BroadcastChannel），其他窗口收到后丢弃本地 pending 改动；或 clearStoredState 后写入一个带时间戳的空账而非仅删除键。
- 置信度：已确认（路径成立；触发需多窗口+pending 改动同时存在）。

### D10 [P2] 原生 SaveFile 桥无超时：挂起时自动备份永久停摆、导出按钮卡死
- 位置：src/lib/saveFile.ts:51-56（SaveFile.save）、66（SaveFile.prune）；src/lib/autoBackup.ts:78/93/138（running 单例守卫）
- 问题与证据：Capacitor 插件调用无默认超时，TS 侧也未包 Promise.race。`runAutoBackup` 用模块级 `running` 防重入：`if (running) return running;`，finally 才置 null。若原生侧 ANR/插件异常导致 Promise 永不 settle，running 永久占用 → 本会话自动备份全部返回同一个挂起 Promise；UI 导出 busy 状态同样无法复位。
- 影响/触发条件：原生插件崩溃/系统分享面板异常（Android 5–9 老系统概率更高）→ 自动备份静默停摆且无 lastError 记录（catch 都进不去），用户无从感知。
- 建议方案：save/prune 包 30–60s 超时（超时 reject 并记录 lastError）；running 守卫加超时兜底。
- 置信度：已确认（无超时为代码事实；原生挂起概率需真机验证，Java 侧属 D 组范围）。

### D11 [P2] 已知未修复项 #5 现状核实：导入仍允许「结算周期内未锁定工记」，且体检并未覆盖该情形
- 位置：src/lib/storage.ts:755-758（只校验带 settlementId 的工记）、src/lib/health.ts:91-104（规则 2 只查「已锁定但周期外」）
- 问题与证据：`for (const entry of entries) { const settlement = entry.settlementId ? settlementMap.get(...) : undefined; if (settlement) assertLinkedRecord(...); }` —— 未锁定（settlementId 为空）但日期落在已有结算周期内的工记直接放行。AUDIT 未修复项 #5 声称「账本体检会提示『结算单混入周期外工记』类问题」，但 health 规则 2 检查的是 entryIds 里日期越界的已锁定工记，**没有任何规则检查「未锁定工记落在已结算周期内」**。
- 影响/触发条件：手改/第三方备份导入后，该工记计入「未结合计」，但 addEntry/settleJob 的周期重叠守卫（store.tsx:421-427、guards.ts:34-45）使其永远无法再结算——金额显示与可结算性矛盾，用户困惑；不会重复发薪（重叠守卫兜底）。
- 建议方案：导入时拒绝或自动解锁提示；health 增加「未锁定工记落在已结算周期内」规则（warning），与 #5 决策联动。
- 置信度：已确认（维持上轮「未修复」结论，并修正其「体检会提示」的不准确描述）。

### D12 [P3] 高版本拒绝可被绕过：字符串 version 与裸 state 的 data.version 不检查
- 位置：src/lib/storage.ts:627-630、846-847
- 问题与证据：`if (wrapper && typeof wrapper.version === 'number' && wrapper.version > 7)` —— version:"8"（字符串）不触发拒绝；无 wrapper 的裸 state（`raw = parsed`）其 `raw.version` 从不检查，version:99 的裸账本被接受并强制盖章 version:7，未知字段被 normalize 静默丢弃。对照 movePackage.ts:126-132 用 Number.isInteger 严格校验（更严）。
- 影响/触发条件：当前 schema 冻结 v7、新增字段只允许可选，实际损失有限；未来 v8 若出现裸 state 导出或手改字符串版本，会发生静默降级丢字段。
- 建议方案：version 统一 Number.isInteger 校验；裸 state 也检查 raw.version>7 拒绝。
- 置信度：已确认。

### D13 [P3] health 误报：同一结算单 entryIds 内重复 ID 被判「多张结算单重复结算」
- 位置：src/lib/health.ts:71-77（settlementByEntry 按出现次数 push）、126-133；src/lib/storage.ts:546（entryIds 仅 map(String) 不去重）
- 问题与证据：`for (const entryId of settlement.entryIds) { list.push(settlement.id) }` 不去重；同一结算单列出某工记两次 → ids=[S,S] → length>1 → critical「同一笔工记出现在多张结算单里，可能重复发薪」。导入侧 assertLinkedRecord 用 includes（749）对重复 ID 放行。
- 影响/触发条件：手改备份 entryIds 含重复项 → 导入成功 → 体检误报 critical，用户以为重复发薪。
- 建议方案：normalizeSettlement 对 entryIds/advanceIds 去重；health 用 Set 统计 settlement.id。
- 置信度：已确认。

### D14 [P3] health 漏报：本地漂移的单向引用不检查
- 位置：src/lib/health.ts:63-317（全部规则）；对照 src/lib/storage.ts:765-782（导入侧双向校验）
- 问题与证据：导入时严格检查「entry.settlementId 与 settlement.entryIds 互相引用」，但 health 只查孤儿锁定（规则 3）、多结算（规则 4）、缺失工记（规则 7），不查「entry.settlementId=S 但 S.entryIds 不含该 entry」的单向引用。本地 localStorage 被手改/旧版本 bug 留下单向引用时体检全绿，而该工记既不能编辑（settlementId 锁）也不在结算明细里。
- 建议方案：health 增加单向引用规则（critical，可并入 orphan 修复或单独列出）。
- 置信度：已确认。

### D15 [P3] 快照完整性校验偏弱：fnv1a 回退 32 位可伪造、bytes 未校验、A9 无测试
- 位置：src/lib/snapshots.ts:374-381（readSnapshotState 校验）、129-133（stateHash）、src/lib/crypto.ts:70-77（fnv1aHex）
- 问题与证据：
  1. candidates 同时接受 fnv1a 与 sha256 前 16 位——但 fnv1aHex 是 32 位哈希，`fnv1aHex(text,16)` 实际只返回 8 个 hex 字符（padStart(8).slice(0,16)）。任何快照（含新快照）都可用构造 fnv1a 碰撞的篡改内容通过校验（FNV 非密码学哈希，32 位碰撞可构造）。
  2. 注释称「用 hash/bytes 验完整性」，实际只比 hash，record.bytes 从不校验。
  3. `if (record.hash)` —— hash 字段被抹掉即完全跳过校验。
  4. snapshots.test.ts 未导入 readSnapshotState，A9 修复零测试覆盖。
- 影响/触发条件：威胁模型是本地清理工具/脚本篡改 IDB（A9 原始场景），非远程攻击者； accidental 损坏仍能检出，刻意伪造可绕过。弱环境（无 SubtleCrypto）下 stateHash 本身也只有 32 位。
- 建议方案：新快照只接受 sha256 前缀（fnv1a 仅用于旧数据且标记弱校验）；补 bytes 校验；补 A9 回归测试（篡改 data/抹 hash 两例）。
- 置信度：已确认。

### D16 [P3] 快照解压无输出尺寸上限（本地篡改可致 gzip 炸弹）
- 位置：src/lib/snapshots.ts:154-164（decompressPayload）
- 问题与证据：`new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'))` 后直接 `.text()`，无解压后尺寸上限。IDB 记录被篡改为高压缩比 gzip 时，解压可膨胀至 GB 级耗尽内存。
- 影响/触发条件：需本地 IDB 写权限（清理工具/同源脚本），正常写入路径快照尺寸受 30MB 压缩前账本约束。风险低但存在。
- 建议方案：解压流式累计字节数，超过如 64MB 即中止报错。
- 置信度：已确认。

### D17 [P3] saveSnapshot put/prune 分两事务：清理失败把已写成功的快照误报为失败
- 位置：src/lib/snapshots.ts:338-361
- 问题与证据：put 事务 complete 后，prune 另开事务；prune 失败（配额/占用）reject 整个 saveSnapshot，但快照记录已持久化。调用方（MoveSheet.tsx:226-231、Profile.tsx:290-296）catch 后提示「导入前快照失败，已取消覆盖」——实际快照存在，导入被不必要地取消。
- 影响/触发条件：IDB 配额紧张时导入/清空流程被误阻断；重试会再写一份（去重可能跳过）语义混乱。方向安全（不会丢数据），但失败语义失真。
- 建议方案：prune 失败降级为 warning 返回（参照 autoBackup.ts:107-118 的成熟处理），不影响快照成功语义。
- 置信度：已确认。

### D18 [P3] settlementChecksum 不含收款字段；32 位 FNV 可伪造（已声明非签名）
- 位置：src/lib/checksum.ts:9-17
- 问题与证据：canonical 只含 id/jobId/jobName/periodStart/periodEnd/net.toFixed(2)/createdAt。paidAmount/paymentStatus/paidAt/entryIds 变化不改变校验码——「核对同一张结算单关键字段是否被改动」的口径下，已收金额被改无法通过校验码发现。注释已声明不是数字签名、不能防伪造截图，32 位 FNV 碰撞可构造属已知限制。
- 影响/触发条件：老板/工友用校验码核对结算单时，改「已收」字段不会被察觉。低频但属校验口径缺口。
- 建议方案：canonical 纳入 paidAmount.toFixed(2)/paymentStatus；升级 sha256 短码（digestText 已有）。
- 置信度：已确认。

### D19 [P3] PBKDF2 250k 迭代低于现行 OWASP 建议（600k，SHA-256）
- 位置：src/lib/crypto.ts:6（PBKDF2_ITERATIONS = 250_000）
- 问题与证据：AES-256-GCM + PBKDF2-SHA256 + 16B 随机盐 + 12B 随机 IV（每次导出新生成，无复用）整体正确；250k 在 2023 年前的 OWASP 建议内，现行建议 600k。低端 WebView 上 600k 约 1–2s，可接受。
- 影响/触发条件：离线暴力破解成本略低于现行最佳实践；备份文件泄露场景下弱密码更易被破。
- 建议方案：新导出包提升到 600k（iterations 已写入包内，旧包仍按包内值解密，兼容无碍）。
- 置信度：已确认。

### D20 [P3] autoBackup 失败无退避：原生持续失败时每次状态变更都重试整包导出
- 位置：src/lib/autoBackup.ts:133-136（失败不推进 lastRunAt）、src/App.tsx:237-240（每个 state 变更触发 runAutoBackup）
- 问题与证据：失败路径只写 lastError，lastRunAt 不变 → shouldRunAutoBackup 持续为 true → 用户每记一笔都触发一次「整本账 JSON→Blob→base64→原生桥」全流程。5MB 账本≈7MB base64/次。
- 影响/触发条件：原生插件持续异常时，低端机每次编辑伴随数十 MB 级内存分配与桥调用，卡顿/耗电；无用户可见报错（App 侧 void 忽略结果）。
- 建议方案：失败后记录 lastAttemptAt，同日失败 N 次后退避到次日；或失败也推进 lastRunAt 并保留 lastError 供界面展示。
- 置信度：已确认。

### D21 [P3] storageError 首次 toast 文案固定「存储空间不足」，不区分隐私模式/策略禁用
- 位置：src/store.tsx:255-258
- 问题与证据：`toast('本地存储空间不足，请先导出备份', 'error')` 对 QuotaExceededError 与 SecurityError 一视同仁。A2 已区分 unavailable/invalid，但运行期写入失败的提示未区分。常驻横幅（App.tsx:273-277）文案倒是中性的。
- 影响/触发条件：隐私模式下用户被误导去「清理存储空间」，实际应退出隐私模式。
- 建议方案：按 error.name 区分文案（SecurityError→存储被禁用；QuotaExceededError→空间不足）。
- 置信度：已确认。

### D22 [P3] clearSnapshots 为死代码：无批量抹除快照入口，「清空所有数据」后历史快照全留
- 位置：src/lib/snapshots.ts:408-420（clearSnapshots 全 src 无调用者，grep 证实）；src/store.tsx:1063-1069（resetAll 只清 localStorage+照片）；src/pages/DataSafety.tsx:200-202/489
- 问题与证据：清空流程刻意保留「清空前快照」并明确告知（toast/确认框），属设计决策；但**此前累积的最多 30 份历史快照（含完整金额/备注）也全部保留**，确认框文案只说「清空前会自动存一张本机快照」，未披露历史快照仍在。想彻底抹除数据（转卖手机前）只能逐条删除快照。
- 影响/触发条件：隐私透明度缺口；非越权泄露（数据仍在本机本人账户下）。
- 建议方案：提供「同时删除所有本机快照」选项（调用现成的 clearSnapshots）；确认框文案补充历史快照说明。
- 置信度：已确认。

### D23 [P3] 回收站恢复 24h 校验用 round2 后的 hours，与精确值口径不一致
- 位置：src/lib/trash.ts:253-256（row.hours 来自 buildTrashRows 的 round2，123 行）；对照 src/store.tsx:546（restoreEntry 用精确 entry.hours）
- 问题与证据：`sameDay + (row.hours ?? 0) > 24` 中 row.hours 已舍入到 2 位。构造 sameDay=15.67、entry.hours=8.3349（row.hours=8.33）→ 24.00 放行，实际合计 24.0049 超上限。restoreTrashItem 不再复核精确值（store.tsx:814-828）。
- 影响/触发条件：需小数工时（计时器产生）+ 特定组合，超出量 <0.01h，实际影响极小，属口径一致性债务。
- 建议方案：TrashRow 保留精确 hours 或恢复时用原记录复核 wouldExceedDayLimit。
- 置信度：已确认。

### D24 [P3] 导入不校验 createdAt/updatedAt 格式：可影响同日多段日薪「最新快照」选取
- 位置：src/lib/storage.ts:368/391（entry）、349（job）、549（settlement）等 asString 直收
- 问题与证据：createdAt 接受任意字符串（""、"abc"）。B4 修复后 dailyBaseEntryIds 按 createdAt 最新选取唯一日薪基数（settlement.ts:50-56），畸形 createdAt 会扭曲排序结果。
- 影响/触发条件：手改备份把某段 createdAt 设为极大字符串 → 该段永远成为「最新快照」，调价日基数被其锁定。App 自身写入均为 nowISO()，仅异常文件可触发。
- 建议方案：createdAt/updatedAt 用 Date.parse 校验，非法回退 now（与 deletedAt 处理同口径）。
- 置信度：已确认。

### D25 [P3] 导入不查 photoId 共享/引用：删除共享照片会连带删掉其他工记的照片
- 位置：src/lib/storage.ts:386（photoId 仅 trim）；src/pages/EntryEditor.tsx:520-527（persistNow 后 deletePhoto）；src/store.tsx:869-909（purgeTrashItem 按 trash 收集 photoIds 删除）
- 问题与证据：validateImport 不检查 photoId 唯一性/存在性。手改备份让两条工记共享同一 photoId 后，删除其中一条的照片（或彻底删除回收站条目）会物理删除共享照片，另一条工记照片悬空。App 自身路径不产生共享（copyToToday 不复制 photoId，EntryDetail.tsx:126-140 证实；putPhoto 每次新 ID）。
- 影响/触发条件：仅手改/第三方备份可构造；照片不可再生（快照不含照片）。
- 建议方案：导入时 photoId 重复即拒绝或重新分配；deletePhotos 前检查是否仍被其他工记引用。
- 置信度：已确认。

### D26 [P3] 导入允许 active 与 trash 跨集合重复 ID（A10 只修了集合内）
- 位置：src/lib/storage.ts:800-829（trashed* 仅集合内去重，不与 active entryIds/restDayIds/advanceIds 交叉检查）；对照 656（trashedJobs 有交叉检查）
- 问题与证据：trashedJobs 会跳过与 active jobs 重复的 ID（656），但 trashedEntries/trashedRests/trashedAdvances 不做同样交叉检查。恢复路径有幂等守卫（store.tsx:822-824/835-837/850-852）不会真的产生重复 active 记录，但 purgeTrashItem 会按 trash 条目删照片（与 D25 叠加），health 也不检查此类重复。
- 影响/触发条件：手改备份；主要危害经 D25 放大。
- 建议方案：与 trashedJobs 同口径，跨集合重复 ID 跳过或拒绝。
- 置信度：已确认。

### D27 [P3] StorageRecovery 损坏路径无「从备份导入」自救出口
- 位置：src/components/StorageRecovery.tsx:62-96；src/store.tsx:168-178
- 问题与证据：invalid 时整个应用被恢复页替代（children 不渲染），用户只能导出原始账本+重新检测+联系开发者；持有有效备份文件也无法自助导入恢复（导入 UI 在应用内，进不去）。A2 刻意「账本损坏强制人工恢复」，但对离线 App 的非技术用户，「联系开发者」实际不可达。
- 影响/触发条件：localStorage 账本损坏（清理工具/写入中断）且用户有备份 → 卡死在恢复页，唯一出路是违反页面告诫去清站点数据。
- 建议方案：恢复页增加「从备份文件恢复」入口（先强制导出 raw，再 validateImport+saveState 重建），保留原始数据兜底。
- 置信度：已确认（设计决策可讨论，非代码错误）。

### D28 [P3] storage.test.ts 遗留时间炸弹：固定 deletedAt 将在 2026-12-04/05 后使用例失败
- 位置：src/lib/storage.test.ts:172（'2026-11-04T12:00:00.000Z'）、399/417（'2026-11-05T12:00:00.000Z'）、478-479（同）
- 问题与证据：这些回收站用例的 deletedAt 写死日期，而 validateImport 内 purgeExpiredTrash 用真实 Date.now()（trash.ts:48-57）。当前（2026-11-17）距今 12–13 天仍通过；2026-12-04/05 起超过 30 天保留期被清理 → toHaveLength(1)/toEqual(['trash-good']) 失败。AUDIT F 节声称「顺带消除既有用例的时间炸弹」，实际只修了 trash.test.ts（固定 NOW），storage.test.ts 至少 4 处未修。
- 影响/触发条件：约 3 周后 CI/本地测试红，与代码质量无关的假失败。
- 建议方案：改用相对 Date.now() 的 daysAgo()（storage.test.ts:185-186 已有现成 helper）。
- 置信度：已确认（按当前日期推算，未运行测试）。

### D29 [P3] 测试覆盖缺口与弱断言（A9/A2-unavailable/store 持久化路径无单测等）
- 位置：src/lib/snapshots.test.ts:3-11（未导入 readSnapshotState/deleteSnapshots）；src/lib/storageRecovery.test.ts:15-43（只测 invalid，无 getItem 抛错的 unavailable 用例）；src/lib/photoStamp.test.ts:42-44（`expect(PHOTO_MAX_EDGE).toBe(1280)` 恒真钉常量）；src/lib/storage.test.ts:240（标题「导出的备份使用 v6」与断言 version 7 不符）；store.tsx/StorageRecovery.tsx 无任何单测（AUDIT 未修复项 #8 已承认）
- 问题与证据：A9（hash 校验）、A2 的 unavailable 分支（A2 的核心修复）、pendingPersist 守卫/replaceState 先落盘（A1/A4 核心）均无自动化回归；photoStamp 压缩/解码失败路径、photos.ts 全部 IDB 操作、saveFile/native 桥、backupStatus 14 天边界也无测试。
- 影响/触发条件：上述 D01/D02/D07/D15 类回归无法被现有 282 用例捕获。
- 建议方案：优先补 A9 篡改用例、unavailable 用例、store 持久化失败/跨标签页事件用例（jsdom+fake localStorage）；删除恒真断言。
- 置信度：已确认。

### D30 [P3] net≤0 的结算单永远无法登记收款（C6 残留边界）
- 位置：src/store.tsx:980-982
- 问题与证据：`const net = Math.max(0, settlement.net); const paid = Math.min(net, ...)` → net≤0 时 paid 恒 0 → paymentStatus 恒 'unpaid'（982 行 paid<=0 分支）。C6 允许净额≤0「仍然结算」落库，但收款路径仍被钳死——结算单永远显示「未收」，无法标记结清。
- 影响/触发条件：额外扣款/借支超过应发的结算单（C6 场景）；状态展示失真，无金额损失。
- 建议方案：net≤0 时允许 paid=0 直接标记 'paid'（或提供「无需收款」状态）。
- 置信度：已确认。

### D31 [P3] 导入字符串字段无长度上限：超大 name/note 可撑爆 localStorage
- 位置：src/lib/storage.ts:323（job.name）、385（entry.note）、517（jobName）、849（profile.name）等 asString 直收
- 问题与证据：normalize 系列对字符串仅 trim/部分 slice（unitLabel 8 字符、recurring note 80 字符），name/note/employer 等无上限。手改备份塞入数 MB 字符串 → 导入校验通过 → replaceState 落盘 QuotaExceeded → 导入失败（A4 兜底生效，不丢旧账），但错误文案为「存储写入失败」而非「字段超长」。
- 影响/触发条件：仅异常文件；有 storageError 横幅兜底。
- 建议方案：name≤100、note≤2000 等与 UI 输入上限对齐，超长拒绝并指明字段。
- 置信度：已确认。

### D32 [P3] 旧键迁移回写无 CAS：双窗口同时迁移 v6 存在极窄覆盖窗口
- 位置：src/lib/storage.ts:96-104
- 问题与证据：A1 保留的唯一回写路径（legacy→v7）。两窗口同时冷启动读到同一 v6：B 读 v6 后、saveState(v7) 前，若 A 已完成迁移且用户极速记工落盘，B 的迁移写入会覆盖 A 的新账。窗口极窄（需人在毫秒级完成操作），且迁移只发生一次。
- 影响/触发条件：理论竞态，实际几乎不可触发；记录为 A1 残留备查。
- 建议方案：迁移写入前 getItem(STORAGE_KEY) 非空则放弃回写（以先到者为准）。
- 置信度：已确认（路径成立，触发概率极低）。

### D33 [P3] backupDueText「今天已备份」实为 24 小时口径
- 位置：src/lib/backupStatus.ts:27/41-44
- 问题与证据：daysSinceBackup 用 floor((now-time)/86400000)，昨天 23 小时前备份 → days=0 → 文案「今天已备份」。与 autoBackup 的 localDateKey 自然日口径（autoBackup.ts:25-28）不一致。
- 影响/触发条件：纯文案误导，无功能影响。
- 建议方案：文案改「24 小时内已备份」或按自然日计算。
- 置信度：已确认。

### D34 [P3] Web 下载路径无法感知取消/拦截，'web' 一律按成功 markBackedUp
- 位置：src/lib/native.ts:37-45（anchor.click 后立即 return 'web'）；调用方 Profile.tsx:186/DataSafety.tsx:94
- 问题与证据：浏览器下载被设置拦截、iOS Safari blob 下载异常、用户在保存对话框取消等场景，前端无从得知，仍重置 14 天提醒。与已知未修复项 #6（Android 5–9 其余导出文案）同类，但此处影响提醒而非仅文案。Web 平台浏览器行为不可控，属已知限制。
- 建议方案：web 路径文案统一「已触发下载，请确认文件保存成功」，markBackedUp 延迟到用户确认（或保留现状但在提醒文案中说明）。
- 置信度：已确认（平台限制，非代码错误）。

### D35 [P3] useAutoSnapshot：每日快照定时器卸载不清理；auto-idle 失败静默无重试
- 位置：src/hooks/useAutoSnapshot.ts:59-66（setTimeout 未跟踪/清理）、94（catch(()=>undefined)）
- 问题与证据：daily-open 的 1600ms setTimeout 不在 effect cleanup 中清理（组件卸载后仍会执行 saveSnapshot+markDailyAt，模块级函数无副作用危害，但属泄漏模式）；auto-idle 失败完全静默，IDB 配额满时自动快照长期停摆无感知（手动快照才报错）。
- 影响/触发条件：IDB 配额紧张时自动保护静默失效；与 D17 叠加。
- 建议方案：定时器入 ref 并 cleanup；auto-idle 连续失败时 surface 一次提示。
- 置信度：已确认。

### D36 [P3] 搬家包校验码依赖 JSON 键序：第三方重序列化会被误判损坏
- 位置：src/lib/movePackage.ts:74-80（checksumInput=JSON.stringify 固定键序）、198-215（verifyChecksum）
- 问题与证据：checksum 覆盖 payload 的 JSON 序列化原文（含键序）。用 Python json.dumps(sort_keys=True) 等工具重排键序后，内容完全相同但校验失败「文件可能已损坏或被修改」。属严格规范化设计，但用户用网盘/工具转存后可能遇到。
- 影响/触发条件：低频；报错方向安全（拒绝而非接受）。
- 建议方案：文档说明「请勿用第三方工具重新序列化」；或校验前按固定键序重建 payload 再比对。
- 置信度：已确认。

---

## 二、上轮 A 组修复（A1–A11）逐条核实结论

| # | 原严重度 | 结论 | 证据位置 | 残留问题 |
| --- | --- | --- | --- | --- |
| A1 | P0 | **部分落地** | storage.ts:94-104 仅迁移回写（storage.test.ts:677-692 钉住「读 v7 不回写」）；store.tsx:269 pendingPersist 守卫存在 | D01 settleJob 绕过守卫；D02 并发编辑整包丢失更新仍在；D32 迁移回写无 CAS |
| A2 | P1 | **已落地** | storage.ts:58-64 kind 字段、78-89 访问抛错→unavailable；store.tsx:168-178 「仍然进入」出口；StorageRecovery.tsx:50-96 双文案 | unavailable 分支无测试（D29）；invalid 无自助导入出口（D27，设计决策） |
| A3 | P1 | **部分落地** | storage.ts:378-383 工记字段钳制 + storage.test.ts:717-745 回归 | D05 规则/借支/结算/周期规则金额无上限；D06 otHours>hours 不校验 |
| A4 | P1 | **已落地** | store.tsx:1039-1061 先 saveState 成功再切状态、返回 boolean；调用方 MoveSheet.tsx:218-223、Profile.tsx:285-288、Snapshots.tsx:101-111、Health.tsx:64-68 均处理失败不提示成功 | 无 |
| A5 | P1 | **部分落地** | autoBackup.ts:106/128（+autoBackup.test.ts:100-114）；DataSafety.tsx:90-94；Profile.tsx:182-186/214-218 均守卫 'shared' | **D03 MoveSheet.tsx:110 markBackedUp 无守卫（遗漏点）** |
| A6 | P2 | **已落地** | store.tsx:202/245-260 storageError 状态；App.tsx:273-277/444/457 常驻告警条（保存成功才消失） | D21 首次 toast 文案不区分失败原因 |
| A7 | P2 | **已落地** | EntryEditor.tsx:520-527 先 persistNow() 成功再 deletePhoto，失败保留照片并提示；store.tsx:907-909/931-933 purge/empty 同口径 | D25 共享 photoId（仅手改备份可构造）未防护 |
| A8 | P2 | **已落地** | snapshots.ts:319-323 手动/安全类只与手动组比 hash；snapshots.test.ts:292-353 四条语义回归 | 无 |
| A9 | P2 | **已落地（偏弱）** | snapshots.ts:374-381 解压后 sha256/fnv1a 比对 hash，不一致报「快照已损坏」 | D15 fnv1a 回退 32 位可伪造、bytes 未校验、零测试覆盖 |
| A10 | P2 | **已落地** | storage.ts:676-688 restDayIds 重复即拒绝 + storage.test.ts:748-766 回归 | D26 active↔trash 跨集合重复 ID 未查（恢复有幂等守卫兜底） |
| A11 | P2 | **部分落地** | trash.ts:228 过期拦截 + trash.test.ts:205-230 边界回归（30/31 天） | **D07 store.tsx:794-807 job 分支绕过拦截，过期工作仍可恢复** |

已知未修复项 #5（导入允许结算周期内未锁定工记）：**维持未修复**，且 AUDIT 中「账本体检会提示」的描述不准确——health 无对应规则（详见 D11）。

## 三、实际读过的文件清单（覆盖率）

**范围内源码（23 个，全部全文读完）**：
storage.ts(867行)、snapshots.ts(424)、trash.ts(270)、backup.ts(111)、autoBackup.ts(143)、backupStatus.ts(45)、crypto.ts(84)、checksum.ts(25)、movePackage.ts(351)、saveFile.ts(68)、native.ts(59)、photos.ts(161)、photoStamp.ts(197)、health.ts(348)、guards.ts(45)、id.ts(7)、seed.ts(231)、meta.ts(70)、version.ts(7)、emptyModule.ts(7)、testFixtures.ts(117)、store.tsx(1145)、components/StorageRecovery.tsx(107)。

**范围内测试（13 个，全部全文读完）**：
storage.test.ts(767)、snapshots.test.ts(354)、trash.test.ts(231)、autoBackup.test.ts(115)、backup.test.ts(55)、movePackage.test.ts(188)、checksum.test.ts(40)、guards.test.ts(80)、health.test.ts(175)、photoStamp.test.ts(45)、storageRecovery.test.ts(43)、v120Storage.test.ts(48)、version.test.ts(14)。

**交叉核对选读（仅为核实调用点/口径，非本组审计对象）**：
MoveSheet.tsx:60-309、Profile.tsx:165-324、DataSafety.tsx:75-259、Snapshots.tsx:60-139、Health.tsx:45-89、SettlementPage.tsx:925-969、EntryEditor.tsx:490-544、EntryDetail.tsx:100-154、TrashSheet.tsx:80-139、useAutoSnapshot.ts:1-100、App.tsx:215-304、settlement.ts:360-484/525-579（net 公式与 health 规则 1 一致性核对：settlement.ts:207/419-421 与 health.ts:29-42 口径一致，无误报）、types.ts:89-111/224-236、docs/AUDIT-v1.2.4.md 全文。

**确认无对应测试文件的模块**（git ls-files 证实）：crypto.ts、photos.ts、saveFile.ts、native.ts、backupStatus.ts、seed.ts、meta.ts、id.ts、emptyModule.ts、store.tsx、StorageRecovery.tsx。

## 四、未覆盖清单（明示）

1. Android Java 原生侧（SaveFilePlugin 的 shared 判定/超时/取消行为、prune 实现）——属 task-4（D 组）；本组仅审计 TS 桥接口径（D10）。
2. pay.ts/settlement.ts/recurring.ts 计薪与周期规则细节——属 task-2（B 组）；本组仅交叉核对 net 公式、dailyBaseEntryIds 选取口径与导入侧校验。
3. 页面/组件 UI 细节（焦点/隐私遮罩/文案等）——属 task-3（C 组）；本组仅选读数据流调用点。
4. 未运行任何测试/构建/typecheck（任务纪律禁止，主代理并行跑基线）；D28 时间炸弹为按当前日期（2026-11-17）的静态推算，D01/D02/D08/D09 竞态的实际命中概率需运行时验证。
5. public/sw.js 与 PWA 缓存——属 C 组。

## 五、按严重度统计

| 严重度 | 数量 | 编号 |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 3 | D01（settleJob 守卫绕过）、D02（跨标签页丢失更新）、D03（MoveSheet 'shared' 未守卫） |
| P2 | 8 | D04–D11 |
| P3 | 25 | D12–D36 |
| 合计 | 36 | |

**Top 风险摘要**：三条 P1 全部与「多窗口/旧系统分享面板」相关——Android 单窗口主场景不受 D01/D02 影响，但 PWA/桌面多标签页用户有静默丢账路径；D03 影响 Android 5–9 存量用户的备份提醒可靠性。A 组 11 项修复中 6 项完整落地（A2/A4/A6/A7/A8/A10）、5 项部分落地（A1/A3/A5/A9/A11），无一项完全未落地。
