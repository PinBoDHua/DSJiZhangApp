# 附录 C · 前端 UI / 状态 / PWA（第三轮审计 R3）

> 审计对象：薪时 XINSHI v1.2.5，HEAD `d0d8f83`，工作树干净。
> 审计域：`src/App.tsx`、`src/main.tsx`、`src/store.tsx`、`src/types.ts`、`src/styles.css`、`src/pages/*`（17 个入口，16 个页面文件）、`src/components/*`（33）、`src/hooks/*`（5）、`index.html`、`public/sw.js`、`public/manifest.webmanifest`、`vite.config.ts`（PWA/CSP 段）、`capacitor.config.ts`。
> 只读约束：未修改任何源码；未执行 `pnpm build`、未安装依赖、未提交。仅读取、grep 与 Node 只读脚本（计算哈希、比对产物清单）。
> 路内统计：**18 条 = P0×0 / P1×0 / P2×4 / P3×14**。上轮 C/UI 42 条中约 70%（UI-14…UI-42 全量 + P2 中的 UI-02/03/04/05/10/11/12/13）已落地，本轮 P2 集中在「同类路径未扫全」的残余（与上轮 §8.2 的结论模式一致）。

---

## 一、方法与只读验证手段

| 手段 | 用途 | 结论要点 |
| --- | --- | --- |
| 全文通读 | 5 个核心文件 + 全部页面/组件/hooks（约 2.2 万行） | 状态、守卫、a11y、隐私出口逐点核对 |
| `grep` 定点扫描 | `formatMoney`/`rateLabel`/`usePrivacy`/`Money` 全量出口；`setTimeout`/`setInterval`/`addEventListener` 成对性；`<button>` 是否带 `type`；`dangerouslySetInnerHTML`/`innerHTML` | 金额出口、定时器、按钮语义三类清单化 |
| Node 脚本（只读） | ①`dist/precache-manifest.json` 与 `dist` 实际产物比对；②`dist/index.html` 内联脚本 sha256 与 CSP 比对；③`dist` 与 `android/app/src/main/assets/public` 哈希比对；④`public/sw.js` 正则原始字节（十六进制）复核 | 见「已排除疑点」与 C02/C09 |
| 数值校验 | `--muted-2` 明/暗对比度按 WCAG 相对亮度公式手算 | 浅≈4.73:1、暗≈6.5:1 → UI-13 达标 |
| 不做的 | Playwright 截图脚本（会写文件）、构建、e2e | 卡顿/动画类结论标注「未实测」 |

未复现项一律标「存疑」，并给出可执行的复现步骤。

---

## 二、发现总览

| # | 严重度 | 一句话 | 位置 |
| --- | --- | --- | --- |
| C01 | **P2** | 「工作管理」岗位卡单价明文，隐藏金额对同一数字在首页打码、在此页不打码（UI-05 同类未扫全） | Jobs.tsx:61-65 |
| C02 | **P2** | 预缓存清单不含 `fonts/xinshi-sans.ttf`：PWA 首装断网后「文字版工资条 PDF」必失败（UI-11 残留） | vite.config.ts:13-15；payslipText.ts:23-35 |
| C03 | **P2** | 存储写入失败常驻红条 `position:fixed;z-index:60` 盖住子页返回键与首页头像，无布局补偿 | App.tsx:286-290；styles.css:12285-12301 |
| C04 | **P2** | PWA/浏览器场景无 history 集成：Android 返回键直接退出 App，不关闭弹层/子页，未保存表单丢失 | nativeBack.ts:20-33；main.tsx:54 |
| C05 | P3 | 子页打开/返回无焦点管理，焦点落 body，键盘与读屏用户失去位置 | App.tsx:476-489；SubPage.tsx:13-38 |
| C06 | P3 | 打开子页会卸载当前 Tab 页，返回后筛选/月份/视图状态全部丢失 | App.tsx:479-497；Records.tsx:68-76 |
| C07 | P3 | 撤销结算等待快照期间，返回键被静默吞掉（按钮外观可用但无响应、无进度态） | SettlementPage.tsx:911-915,1003 |
| C08 | P3 | 隐藏金额仍残留 3 处明文：撤销结算弹窗的收款额、超休扣款输入框 placeholder、屏幕上可直接被扫的结算二维码 | pagePay.ts:85→SettlementPage.tsx:1280；SettlementPage.tsx:683-687；ShareQrSheet.tsx:55-70 |
| C09 | P3（存疑） | 版本更新窗口内断网刷新可能白屏：network-first 缓存的新 `index.html` 指向的 chunk 尚未被新 SW 预缓存 | sw.js:17-33,59-79 |
| C10 | P3 | iOS PWA：输入框字号 14/15px < 16px，聚焦自动放大且不回弹 | styles.css:97-100,10229-10236 |
| C11 | P3 | 清空/导入等破坏性操作只用 state 判断 busy，无 ref 守卫，双击会执行两次（幂等放大） | DataSafety.tsx:218-221；Profile.tsx:327-332 |
| C12 | P3 | 「记休息」初始岗位回退链可命中已归档岗位 → 弹层无选中项、保存键灰禁用且无提示 | Records.tsx:187-201；RestSheet.tsx:44-49,245-252 |
| C13 | P3 | UI-24 残留：MoveSheet 的隐藏 file input 未加 `tabIndex={-1}`，仍在 Tab 序列 | MoveSheet.tsx:584-590 |
| C14 | P3 | `document.title` 永不随页面变化，PWA 多窗口/最近任务全部同名 | index.html:40；App.tsx 全文无赋值 |
| C15 | P3 | 页面级派生计算未 memo、千条级列表无虚拟化（UI-08/09 已声明的延后项，此处量化触发面） | Home.tsx:100-260；Records.tsx:103-141；MonthCalendar.tsx:60-65 |
| C16 | P3 | `EntryRow` 的 `memo` 因内联 `onClick` 每次换新引用而失效，UI-08 的收益被抵消 | EntryRow.tsx:78；Home.tsx:604-611；Search.tsx:229-237 |
| C17 | P3 | 引导页单价无上限（JobEditor 1e6、导入钳制 1e6）：引导页建的超大单价导出→导入后被静默改数（UI-10 同类残留） | Onboarding.tsx:38-42 vs JobEditor.tsx:272-275、storage.ts:204-206,306 |
| C18 | P3 | 选择态语义残留：RestSheet 岗位选择、Search 筛选行缺 `aria-pressed`/`role="group"`（其余页面已补） | RestSheet.tsx:114-125；Search.tsx:113-136 |

---

## 三、逐条详情

### C01 [P2] 隐藏金额下「工作管理」仍显示明文单价

**位置**：`src/pages/Jobs.tsx:61-65`（`rateLabel(job.rule.payType, job.rule.rate, job.rule.unitLabel)`）。
**对照（已修）**：`src/pages/Home.tsx:766-773`（`hideAmounts ? <Money value={job.rule.rate}/> : rateLabel(...)`）、`src/components/TimerSheet.tsx:34-41`。
**证据**：`rateLabel()`（`src/lib/meta.ts:57-67`）输出形如 `¥3500/月`、`¥25/时` 的纯文本，不经过 `Money`/`usePrivacy`，因此 `profile.hideAmounts=true` 时该页仍显示具体数字。同一份数据在首页岗位卡已改为 `Money` 打码，两页口径不一致。
**影响**：隐藏金额的产品意图是「旁人看到屏幕时不暴露收入」。工作管理是二级主页面（我的 → 工作管理 / 首页「管理」），停留时间长、单价与岗位名并列，比首页更容易被旁人看清。月薪岗位泄露的是整月工资。
**触发路径**：我的 → 隐藏金额（开）→ 我的 → 工作管理 → 每张岗位卡第二行显示 `¥3500/月 · 月结 · 加班 1.5× 起`。
**解决方案**：抽 `RateLabel` 组件，统一 `hideAmounts ? <Money value={rate}/> : rateLabel(...)`（必要时把 `/单位` 也纳入打码）；`JobEditor.tsx:471,500` 的预览属同一出口，但编辑器内用户正在改价，可保留明文并在文案上区分。
**置信度**：高（代码直读，无运行时分支可绕过）。

### C02 [P2] 预缓存清单漏字体：PWA 首装断网后文字版 PDF 必失败

**位置**：`vite.config.ts:13-15`（`PRECACHE_EXTENSIONS = new Set(['.js','.css','.html','.webmanifest','.svg','.png'])`，注释明示「字体 2.4MB 不进清单」）；`src/lib/payslipText.ts:23-35`（`fetch(BASE_URL + 'fonts/xinshi-sans.ttf')`，失败即 `throw`）。
**证据**：`dist/precache-manifest.json` 42 项与 `dist` 实际可预缓存文件 43 项比对，唯一缺口是 `fonts/xinshi-sans.ttf`（脚本实测：`IN DIST NOT MANIFEST: ['fonts/xinshi-sans.ttf']`）。SW 只对「非导航 GET」在**首次成功联网请求后**做运行时缓存（`public/sw.js:82-95`），因此该字体在首装后从未被请求过时不在任何缓存里。
**影响**：离线是产品核心卖点，而「工资条 → 文字版 PDF」是结算后的高频动作。首装 PWA 后直接断网 → 结算 → 工资条 → 点「文字版 PDF（可选中 · 含工记明细）」→ 抛「中文字体加载失败：无法读取 …/fonts/xinshi-sans.ttf」。有明确错误提示、不会假成功（PAY-24 已修），但功能在离线态不可用；联网成功导出一次后才进缓存。
**触发路径**：Chrome 安装 PWA → 断网（飞行模式）→ 结算 → 打开任一结算单 → 下载/Xinshi → 工资条 → 「文字版 PDF」。
**解决方案**（三选一，建议 2）：①把 `.ttf` 纳入 `PRECACHE_EXTENSIONS`（首装下载量 +2.4MB，与当前注释的取舍冲突，需产品决策）；②改为「首次进入结算/工资条页时后台预热 fetch」并在预热失败时把入口置灰 + 文案「离线暂不可用」；③把字体裁剪为常用字子集（体积可降一个量级后进预缓存）。
**置信度**：高（产物清单差异实测；字体仅在 `downloadPayslipTextPdf` 中被 fetch）。

### C03 [P2] 存储失败红条遮挡子页返回键与首页头像

**位置**：`src/App.tsx:286-290`（`<div className="app-storage-banner" role="alert">` 常驻，位于 `.app-shell` 内、页面之前）；`src/styles.css:12285-12301`（`.app-storage-banner{position:fixed;left:0;right:0;top:0;z-index:60;padding:calc(env(safe-area-inset-top,0px)+10px) 16px 10px;…}`，文案为两行长中文）；`src/styles.css:2510-2542`（`.subpage{position:fixed;inset:0;z-index:30}`、`.subpage-head{padding:16px 18px 10px;grid-template-columns:42px …}`，返回键是 head 左上第一格）。
**证据**：`.app-storage-banner` 与 `.subpage` 都是 `position:fixed` 覆盖层，banner `z-index:60` > subpage `30`；banner 高度 = safe-top + 10 + ~2 行×≈19px + 10 ≈ 58px，正好覆盖 `.subpage-head` 的 16px 顶内边距 + 42px 返回按钮。全仓无任何 `.app-shell`/`.subpage` 的 `padding-top` 补偿（grep `app-storage-banner` 仅一处定义）。
**影响**：`storageError` 出现时（配额不足 / 隐私模式 / 站点数据被禁，`store.tsx:288-322` 专门分类文案），页面顶部交互被红色不透明条永久盖住：子页左上返回键点不到、首页右上「我的」头像点不到。PWA 场景又没有系统返回键（见 C04），用户会陷入「退不出去」的死角；即使能靠手势退出，观感也像坏掉。
**触发路径**：制造保存失败（隐私模式打开站点 / 塞满 localStorage）→ 记一笔触发写入失败 → banner 出现 → 进入「记录 → 月度考勤」→ 左上返回箭头被红条覆盖，点击无效。
**解决方案**：让 banner 参与布局而非覆盖——`.app-shell{padding-top:var(--banner-h)}` 并用 `ResizeObserver`/固定 `--banner-h` 注入；或 banner 改 `sticky` 放在 `.app-main`/`.subpage-inner` 内首个位置；最低成本：`.subpage{z-index:70}` 并把 banner 降到 `z-index:20`（但首页头部仍需补偿）。
**置信度**：高（CSS 层叠与定位直读，高度可算；未在真机跑截图，但两条规则不依赖运行时状态）。

### C04 [P2] PWA/浏览器没有返回栈：Android 返回键直接退出

**位置**：`src/lib/nativeBack.ts:20-33`（`installNativeBack()` 首行 `if (!isNativeApp() || installed) return;`，返回键只在 Capacitor 壳里接管）；`src/main.tsx:54-56`；`src/App.tsx:259-262`（子页返回靠 `pushNativeBack`）；`src/components/Sheet.tsx:61-64`、`ConfirmDialog.tsx:34-37`（弹层同样只走原生栈）。
**证据**：全仓无 `history.pushState`/`popstate`/`beforeunload` 相关代码（grep 为空）；`isNativeApp()` 判定 `window.Capacitor?.isNativePlatform?.()`，PWA 安装时该对象不存在。
**影响**：PWA 是明示安装路径（`manifest.webmanifest` + `sw.js` + 安装提示）。在 Android Chrome 的 PWA 里，系统返回手势/返回键 = 浏览器后退 = **直接退出应用**：① 在「搜索/月度考勤/结算单」等子页退出而非返回上一级；② 在「记一笔」表单填了一半（`dirtyRef` 只在关闭回调里生效）直接退出，草稿无 any 保留；③ 结算单页撤销快照期间、导入覆盖期间也没有拦截。
**触发路径**：Android Chrome → 菜单「安装应用」→ 打开 PWA → 记录 → 搜索 → 输入「顺丰」→ 按系统返回键 → App 直接回到桌面（而不是回到记录页）。
**解决方案**：在 `AppContent` 里为每个 `page`/`editor`/`detailId`/打开的 Sheet 维护 `history.pushState` 栈并在 `popstate` 里调用 `backRef.current()`；`beforeunload` 对 `dirtyRef` 为真的表单加提示（WebView 内可跳过）。与 UI-26 的「两路返回一致」目标一致，是它的 Web 侧补完。
**置信度**：高（代码事实 + 浏览器标准行为；未真机复现）。

### C05 [P3] 子页无焦点管理

**位置**：`src/App.tsx:476-497`（`page ? <PageErrorBoundary><Suspense>{renderPage()}</Suspense></PageErrorBoundary> : <>tab</>`，整棵替换）；`src/components/SubPage.tsx:13-38`（只有 `scrollRef.current?.scrollTo({top:0})`，无 `focus()`）。
**证据**：全仓页面级 focus 只出现在 `PrivacyGate`（`PrivacyGate.tsx:25-28`）与弹层 `useModalFocus`；没有路由焦点、没有 `document.title` 同步（C14）。触发按钮随 Tab 树卸载，`document.activeElement` 落到 `body`。
**影响**：键盘用户 Tab 到「搜索」→ Enter → 焦点回 body，下一次 Tab 从最顶部开始；读屏用户没有「已进入搜索页」的提示。返回时 Records 整棵重挂载，焦点同样丢失。
**触发路径**：任一 Tab 页用键盘 Tab 到子页入口 → Enter；或打开「结算单」后用 Tab 观察焦点。
**解决方案**：`SubPage` mount 时 `h1.focus({preventScroll:true})`（加 `tabIndex={-1}`），并把 `document.title` 设为 `${title} · 薪时`；返回时把焦点还给记录在 ref 里的触发元素。
**置信度**：高（代码直读）。

### C06 [P3] 打开子页卸载当前 Tab，返回后状态全丢

**位置**：`src/App.tsx:479-497`（`page` 非空时不渲染 `renderTab()`）；本地状态例：`src/pages/Records.tsx:68-76`（`anchor/jobFilter/view/selectedDate` 均为组件内 `useState`）、`src/pages/Stats.tsx:37-38`、`Search.tsx:30-32`。
**影响**：记录页切到 8 月、选「顺丰」筛选、切到日历视图 → 打开「月度考勤」看一天 → 返回 → 回到「本月 / 全部 / 列表」。同理：统计页翻到上月 → 进「工作管理」→ 回来回到本周；搜索页输入框内容也随卸载清空（结果页返回）。
**触发路径**：见上。
**解决方案**：Tab 页常驻（`display:none` 容器）或把 `anchor/jobFilter/view` 提升到 App 层 / sessionStorage；至少对 Records 的月份与筛选做持久化。
**置信度**：高。

### C07 [P3] 撤销结算等待快照期间返回键静默失效

**位置**：`src/pages/SettlementPage.tsx:911-915`（`if (!undoBusy) return; return pushNativeBack(() => undefined);`）、`:1003`（`onBack={undoBusy ? () => undefined : onBack}`）。
**证据**：UI-02 的修复用「吞掉返回」来避免导航劫持，但没有给 SubPage 传入禁用态；`SubPage.tsx:24` 的返回按钮始终可点、外观不变，点击后无任何反馈；Android 返回键同样被 no-op 吞掉。快照耗时与大账本正相关（`saveSnapshot` 压缩 + IndexedDB 写入）。
**影响**：大账本用户点「撤销」→ 确认 → 1–3 秒内点返回键（或误触）→ 界面毫无反应，容易判断为「卡死」，进而重复点撤销（`undoingRef` 会挡住，但也无提示）。
**触发路径**：结算 → 打开结算单 → 撤销 → 确认 → 在土黄 toast 出现前连续点左上返回。
**解决方案**：`SubPage` 增加 `backDisabled` 属性（`disabled` + `aria-disabled` + 视觉降级），或在该状态下显示「正在留撤销前快照…」的进度覆盖层（与 UI-14 修复同风格）。
**置信度**：高（代码直读）。

### C08 [P3] 隐藏金额的三处残余明文

**位置与证据**：
1. `src/lib/pagePay.ts:85` → 渲染于 `src/pages/SettlementPage.tsx:1280`（撤销确认框 `description` 里 `<span className="form-error">{lostPayment}</span>`），文案为「这张结算单已登记收款 ¥1234.56（2026-11-20 · 微信）…」。该弹窗**没有**接入 `Money`/`usePrivacy`。
2. `src/pages/SettlementPage.tsx:683-687`：超休扣款输入框 `placeholder={draft.overRestDeduction > 0 ? draft.overRestDeduction.toFixed(2) : '自动'}` —— 输入框为空时直接把计算出的扣款金额明文显示在 placeholder。
3. `src/components/ShareQrSheet.tsx:55-70`：提示文案是「当前已隐藏金额，导出 / 分享内容仍包含明文金额」，但二维码**就渲染在屏幕上**（`<img src={qr.dataUrl}>`），旁人拿手机扫屏幕即可读出 `qr.text` 里的应发/已收/待收明文。
**影响**：与 UI-05/UI-06 同属「金额出口未扫全」。前两处是 App 内普通界面（非导出面）的明文，最容易被忽略；第 3 处是提示语覆盖范围与实际泄露面不一致。
**触发路径**：我的 → 隐藏金额（开）→ 结算 → 打开有部分收款的结算单 → 撤销（弹窗明文）；或结算草稿页打开「本期扣超休」开关（placeholder 明文）；或结算单 → 二维码（屏幕可扫）。
**解决方案**：①`undoLostPaymentNotice` 改为返回结构化数据或在调用处 `hiddenAmounts ? '…（金额已隐藏）' : notice`；②placeholder 改为 `hiddenAmounts ? '自动' : toFixed(2)`；③二维码提示改为「屏幕上的二维码本身即含明文金额，注意遮挡」。
**置信度**：高（1/2 为代码直读）；3 为产品口径判断。

### C09 [P3，存疑] 版本更新窗口内断网刷新可能白屏

**位置**：`public/sw.js:17-33`（install 时先拉 `/precache-manifest.json` 再 `cache.addAll`，完成后才 `skipWaiting`）、`:59-79`（导航请求 network-first，成功即把响应写入 `/index.html`，`!response.redirected && response.ok` 才写）。
**推理链**：新版本部署 → 用户打开 App（浏览器导航成功，新 `index.html` 被写入**当前**版本缓存）→ 新 SW 还在 install（下载 42 个文件，客户端网络慢时可达数秒）→ 此时断网并刷新 → 命中已缓存的新 `index.html`，但其引用的新 hash chunk 既不在旧缓存也不在新缓存（新 SW 未激活）→ 入口 `<script type="module">` 请求失败。`vite:preloadError` 只覆盖**动态** import（`main.tsx:48-52`），入口脚本失败不会触发 React ErrorBoundary，页面为白屏。
**影响**：窗口窄（一般 <5 秒，弱网更长），但后果是白屏且无任何自救入口；离线优先的产品里应避免。
**触发路径**：模拟限速部署新版本 → 打开 → 立即断网 → 刷新。
**解决方案**：①index.html 也纳入「新 SW 安装完成后才切换」的原子更新（当前是网络优先直写缓存）；②在 `index.html` 给入口 script 加 `onerror` 兜底，显示「需要联网完成一次更新」；③把 manifest 版本号写进缓存键，安装期间不回写 `/index.html`。
**置信度**：中（时序推理成立，未真机复现；标存疑）。

### C10 [P3] iOS PWA 输入框字号 < 16px 触发自动放大

**位置**：`src/styles.css:97-100`（`input, textarea { font-size: 14px }`）、`:10229-10236`（`.search-input{font-size:15px}`）；`index.html:5`（viewport 未限制 `maximum-scale`，这是正确的可访问性选择）。
**影响**：iOS Safari 对 `font-size < 16px` 的输入框聚焦时自动 zoom，且键盘收起后不回弹；在固定定位的 `Sheet`（`.sheet` 高度用 `dvh`/`--vvh`）里会同时造成布局错位、底部保存键被挤走。Android WebView（主场景）不受影响。
**触发路径**：iOS Safari → 添加到主屏幕 → 首页「记一笔」→ 聚焦「总工时」或备注 → 页面被放大。
**解决方案**：移动端媒体查询下把 `input/textarea/select` 提到 `16px`（或仅对 `@supports (-webkit-touch-callout)` 生效）。
**置信度**：高（平台既定行为）。

### C11 [P3] 破坏性操作缺 ref 重入守卫（双击执行两次）

**位置**：`src/pages/DataSafety.tsx:218-221`（`if (busy) return; … setBusy(true)`）、`src/pages/Profile.tsx:327-332`（`if (importBusy) return; … setImportBusy(true)`）；同一仓库里 `src/pages/Snapshots.tsx:46-47,105-107` 已用 `actingRef` 正确示范。
**证据**：`busy/importBusy` 都是 React state，同一次点击循环里第二次 click 读到的是旧闭包值 false。确认框在第一次点击后 `setClearOpen(false)`，但 DOM 要到下一次渲染才移除，快速双击（或双指同时点）能产生两次 click。
**影响**：`clearAll` 会多拍一张 `before-clear` 快照并重复 toast；`replaceState`/`resetAll` 幂等，因此不会造成二次数据破坏，但会出现「清空前留了两张一模一样快照」与重复文案。导入路径同理（两张 `before-import`）。
**触发路径**：数据与安全 → 清空所有数据 → 确认 → 快速双击「全部清空」。
**解决方案**：照 `Snapshots.tsx` 的 `actingRef` 模式加同步守卫；顺手给确认按钮加 `disabled={busy}`。
**置信度**：中高（React 批处理语义推断；真机双击可复现）。

### C12 [P3] 「记休息」初始岗位可能是归档岗位 → 保存键灰禁用且无提示

**位置**：`src/pages/Records.tsx:187-201`（`openRest` 的回退链：`jobId ?? effectiveFilter ?? selectedRestDays[0]?.jobId ?? fixedMonthlyJob?.id ?? filterJobs[0]?.id ?? state.jobs[0]?.id`；其中 `filterJobs` 来自 `Records.tsx:100` 的 `state.jobs.filter(job => jobIdsInMonth.includes(job.id))`，**不过滤归档**，末位 `state.jobs[0]` 也可能是归档岗位）；`src/components/RestSheet.tsx:44-49`（`selectedJob = jobs.find(...)`，而 `jobs` 传的是 `state.jobs.filter(j => !j.archived)`）、`:245-252`（`disabled={!selectedJob || blocked}`）。
**影响**：弹层打开后岗位选择区没有任何高亮项，底部「标为休息」按键为灰、点击无效，且无文字解释；用户只能自己意识到要另选一份工作。
**触发路径**：记录页某月只有一份已归档岗位的工记 → 工具条「记休息」→ 观察弹层。
**解决方案**：回退链只使用 `!archived` 的岗位；`!selectedJob` 时在 body 顶部显示「请选择一份工作」并让按钮有可读禁用原因（`title`/`aria-describedby`）。
**置信度**：中高（代码路径确定，需构造归档数据）。

### C13 [P3] UI-24 残留：MoveSheet 隐藏 file input 仍在 Tab 序列

**位置**：`src/components/MoveSheet.tsx:584-590`（`<input ref type="file" accept="application/json,.json" className="visually-hidden" onChange=… />`，缺 `tabIndex={-1}`）。
**对照**：`Profile.tsx:914`、`BatchPlanSheet.tsx:518`、`StorageRecovery.tsx:225` 均已加；`.visually-hidden`（`styles.css:659-669`）只做视觉隐藏，元素仍可聚焦。
**影响**：键盘/读屏用户 Tab 到不可见的文件选择器，回车触发系统文件选择器（非预期操作）；读屏会播报一个没有标签的文件控件。
**触发路径**：数据与安全 → 搬家 → Tab 若干次 → 焦点落到隐藏控件。
**解决方案**：补 `tabIndex={-1}`（与其余三处一致），或 `aria-hidden` + 用可见按钮触发。
**置信度**：高。

### C14 [P3] `document.title` 永不随页面变化

**位置**：`index.html:40`（`<title>薪时 · 工时薪资记录</title>`）；`App.tsx`/`SubPage.tsx` 全文无 `document.title` 赋值（grep 为空）。
**影响**：PWA 多窗口/平板最近任务里所有页面同一个标题，无法区分；浏览器标签页与读屏（切换上下文时播报标题）也失去定位信息。与 C05 的焦点/路由播报问题同源。
**触发路径**：PWA 里同时打开「结算单」和「统计」两个窗口 → 最近任务里两张卡片同名。
**解决方案**：`SubPage`/Tab 变化时 `document.title = title + ' · 薪时'`。
**置信度**：高。

### C15 [P3] 页面级派生未 memo / 无虚拟化（UI-08、UI-09 的已声明延后项）

**位置与证据**：
- `src/pages/Home.tsx:100-260`：每次渲染重算 `monthEntries`（filter）、`sumEntriesCapped`、`getSettlementOverview(state)`、两处 `state.entries` 全量 sort（`:113-125,250-252`）、`dailySeries`（`:254-259`）、`planJobs` 逐日 `planStatusForJob`（`:181-203`）。
- `src/pages/Records.tsx:103-141`：`sumEntriesCapped` + `dailySeries` + 第二个 `groups` 扫描；`MonthCalendar.tsx:60-65` 对 42 个格子又算一次 `dailySeries`。
- `src/pages/Attendance.tsx:95-100`：每张结算单 `eachDay(periodStart, periodEnd)` 展开成日键集合；`RestPlanSheet.tsx:68-73` 同型。
- 列表：`Records.tsx:509-521`、`Search.tsx:228-241` 整段渲染，无窗口化（Search 只做了 100 条分页 `Search.tsx:26`）。
**影响**：1000 笔账本下任意一次 `commit`（记一笔、切筛选）都会触发上述全量重算 + 全量 DOM 更新；低端机可出现输入/切页卡顿。上轮 UI-08「页面级 useMemo」与 UI-09「长列表虚拟化」在 fixes 文档第九节明确延后，本条为其现状与触发面记录，不是回归。
**触发路径**：导入 1000+ 笔账本 → 首页连续点「隐藏金额」眼睛图标 → 观察每帧耗时（未实测具体毫秒）。
**解决方案**：Home/Records 的关键派生 `useMemo`（deps 收窄到 entries 引用）；长列表按 `dates` 分组做 `content-visibility:auto` 或窗口化。
**置信度**：高（结构直读）；卡顿量级未实测。

### C16 [P3] `EntryRow` 的 `memo` 因内联 `onClick` 失效

**位置**：`src/components/EntryRow.tsx:78`（`export const EntryRow = memo(EntryRowBase)`，无自定义比较函数）；调用点均为内联箭头：
`Home.tsx:604-611`（`onClick={() => onOpenEntry(entry.id)}`）、`Records.tsx:513-519`、`Search.tsx:229-237`。
**证据**：`memo` 默认浅比较，`onClick` 每次父渲染都是新函数 → props 永远不等 → 每次都重渲染；`job={state.jobs.find(...)}` 虽是稳定引用，也不足以救回。
**影响**：UI-08 声称「EntryRow memo 能省掉无关行的 render」的收益在真实调用点被抵消；配合 C15，记录页/搜索页每键入一个字符都会重渲染最多 100 行（Search 每次 `query` 变化）。
**触发路径**：搜索页输入任意关键词，逐字观察（需 Profiler）；或记录页切换筛选。
**解决方案**：调用点传入稳定回调（`useCallback` + `entry.id` 参数化，或让 `EntryRow` 接收 `onOpen(entryId)`），或在 `memo` 里用自定义比较忽略 `onClick`（不推荐，易引入陈旧闭包）。
**置信度**：高。

### C17 [P3] 引导页单价无上限，与编辑器/导入口径不一致

**位置**：`src/pages/Onboarding.tsx:38-42`（只校验 `Number.isFinite && > 0`）；对照 `src/pages/JobEditor.tsx:272-275`（`> 1_000_000` 报错）与 `src/lib/storage.ts:204-206,306`（导入把 `rate` 钳到 `1_000_000`）。
**影响**：引导页可创建 `rate = 5,000,000` 的岗位（`toAmount('5000000')`），随后任何一次导出→导入都会把它静默改成 1,000,000（金额直接差 5 倍，且无提示）。与 UI-10 已修的「奖金/扣款录入 vs 导入」是同一缺陷模式，只是这次落在 `rate` 与引导页。
**触发路径**：首次安装 → 引导页工资卡「时薪」填 `5000000` → 完成 → 导出备份 → 我的 → 导入备份 → 观察单价变成 1000000（toast 无提示）。
**解决方案**：引导页复用 `clampMoneyInput`/上限校验（`lib/pagePay.ts:20-22`），或把三处上限收敛到一个常量。
**置信度**：高（代码直读）。

### C18 [P3] 选择态语义残留（aria-pressed / role）

**位置**：`src/components/RestSheet.tsx:114-125`（岗位选择按钮有 `is-active` 类，无 `aria-pressed`）；`src/pages/Search.tsx:113-136`（`.filter-row` 无 `role="group"` 与 `aria-label`，Records 在 `Records.tsx:351` 是有的）。
**对照（已补）**：`EntryEditor.tsx:647,701,727,764`、`MonthCalendar.tsx:108`、`TrashSheet.tsx:158`、`Segmented.tsx:37`、`Home.tsx:645` 均已加。
**影响**：读屏用户在「记休息」里听不出当前选中的是哪份工作；搜索页的筛选按钮组没有分组语义。
**触发路径**：读屏或键盘用户打开「记休息」逐项 Tab。
**解决方案**：照 EntryEditor 的岗位选择补 `aria-pressed={job.id === jobId}`；Search 的 filter-row 补 `role="group" aria-label="按工作筛选"`。
**置信度**：高。

---

## 四、上轮 UI 修复回归抽查（10 条，含指定 UI-02/05/11/13）

| 上轮编号 | 声称 | 本轮核实 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| **UI-02** 撤销结算取消守卫 | 已修复 | **已落地**：`mountedRef`（`SettlementPage.tsx:903-910`）卸载后不再执行 `undoSettlement`/`onBack`；`undoBusy` 期间 `pushNativeBack(()=>undefined)`（`:911-915`）与 `SubPage onBack` 置空（`:1003`）；`undoingRef` 防连点（`:965-968`） | 代码直读 | **通过**，但以「静默吞返回」实现 → 新增 C07（可用性副作用） |
| **UI-05** 首页/计时弹层单价打码 | 已修复 | **两处已落地**：`Home.tsx:766-773`、`TimerSheet.tsx:34-41` 均为 `hideAmounts ? <Money value={rate}/> : rateLabel(...)` | 代码直读 | **部分**：工作管理岗位卡仍明文 → C01 |
| **UI-11** PWA 预缓存清单 | 已修复 | **已落地**：`vite.config.ts:21-58` 构建期生成 `precache-manifest.json`；`sw.js:17-28` `cache.addAll`；实测清单 42 项 = 33 个 JS chunk + 1 个 CSS + 其余静态资源，与 `dist` 产物一一对应（无缺失、无幽灵项），12 个懒加载页面文件的 chunk 全在清单内 | `dist` 文件比对脚本 | **通过**，但字体未纳入 → C02；更新期窗口 → C09（存疑） |
| **UI-13** --muted-2 对比度 AA | 已修复 | **已落地**：`styles.css:14` `#616e67`（浅底 `#f4f1e8` 实测 **4.73:1**）、`styles.css:7850` `#8f9b92`（暗底实测 ≈6.5:1），均 ≥ 4.5:1 | WCAG 相对亮度公式手算 | **通过** |
| UI-24 隐藏 file input 可 Tab | 已修复 | **3/4 已落地**：Profile:914、BatchPlanSheet:518、StorageRecovery:225 均有 `tabIndex={-1}` | grep | **部分**：MoveSheet.tsx:584-590 漏 → C13 |
| UI-08 store value memo + EntryRow memo | 已修复（页面级 memo 部分） | **store 侧已落地**：`store.tsx:1216-1297` `useMemo` 依赖完整；Toast 状态不再带动全树重渲染。**EntryRow memo 未达效**（内联 onClick） | 代码直读 | **部分** → C16 + C15 |
| UI-09 搜索分页保护 | 已修复（虚拟化未做） | **已落地**：`Search.tsx:26,202-206,243-251` 100 条一页 + 「查看更多」；记录页整月全量渲染仍在 | 代码直读 | **部分** → C15 |
| UI-22 分享面板假成功文案 | 已修复 | **已落地**：新增 `lib/fileFeedback.ts` 统一 `'shared'` → 「请确认文件已保存」+`backedUp:false`；12 个调用点接入（Attendance、DataSafety×4、PayslipSheet×3、ShareQrSheet、EntryDetail、BatchPlanSheet、Settlements）；MoveSheet/Profile/DataSafety.quickBackup 为手写同口径判断（`saved === 'shared'` 时不 `markBackedUp` 且结果屏区分「已打开系统分享面板」） | grep + 逐点阅读 | **通过** |
| UI-38 SW 缓存清理范围 | 已修复 | **已落地**：`sw.js:41-47` 仅匹配 `/^xinshi-v\d+$/` 并保留最新 2 版；**正则原始字节为 `5c 64`（单反斜杠 + d）**，十六进制复核确认代码正确（查看工具显示为双反斜杠） | Node 读文件 hex | **通过** |
| UI-06 导出面明文提示 | 已修复 | **已落地**：`SettlementPage.tsx:1040-1044`、`PayslipSheet.tsx:189-193`、`ShareQrSheet.tsx:55-59` 三处 `export-plaintext-hint` 提示 | 代码直读 | **通过**，但 App 内另有 3 处残余 → C08 |

其余本轮顺带复核的修复（抽检 8 项，均通过）：UI-03（`App.tsx:204-207` ledgerSeq 重置 + `autoRecurringDay`）、UI-04（Home/Jobs 均纳入 `receivableByJob`）、UI-15（`Recurring.tsx:260-262` 放行原归档岗位）、UI-17（`ConfirmDialog.tsx:54` deps 只留 `open`）、UI-18（`useAutoSnapshot.ts:84-108` 定时器入 ref + 卸载清理）、UI-19（`App.tsx:462,480,486` 三处 `PageErrorBoundary`）、UI-21（`Health.tsx:56-78` 快照失败透出）、UI-32（`store.tsx:889-899` job 分支补走 `trashRestoreBlockReason`）。

---

## 五、已排除疑点（防误报，含正面结论）

1. **「双反斜杠」显示问题**：`public/sw.js:42` 与 `src/lib/shareQr.ts` 同类字符串经 Node 读原始字节复核为 `5c 64`（单反斜杠），代码正确。查看工具的转义显示，不构成发现（与上轮结论一致）。
2. **双击「确认结算」重复落库**：`SettlementPage.tsx:298-320` 的 `handleConfirm` 无独立守卫，但 `settleJob` 内部 `commitSettlement` 基于 `stateRef.current`，而 `commit()` 会**同步推进 `stateRef`**（`store.tsx:386-393,1029-1058`），第二次调用必然命中 `findSettlementOverlap` 返回 null。反向确认：这不是缺陷，反而是 UI 层能省略守卫的前提。
3. **Esc 嵌套只关最上层**：`ConfirmDialog.tsx:42-48` 用 capture + `stopImmediatePropagation`，`Sheet.tsx:69-72` 用冒泡；capture 先于冒泡执行 → 只关确认框。不构成缺陷。
4. **XSS 面为零**：`grep dangerouslySetInnerHTML|innerHTML|eval(` 在 `src/` 命中 0；`img src` 全部是 `data:`/`blob:`/同源；用户文本（备注/岗位名/称呼）只经 React 文本节点渲染。CSV/XML 导出是文件，不经 DOM。
5. **定时器/监听器成对性**：`setTimeout/setInterval/addEventListener` 全量清点（`EntryEditor:160-174`、`PayslipSheet:68-71`、`Sheet:42-77`、`TimerLive:17-20`、`TrashSheet:47-51`、`useAutoSnapshot`、`useReminder`、`useTheme`、`useVisualViewport`、`useModalFocus`）均返回清理函数；无新增泄漏。
6. **日期格式化不崩溃**：`lib/date.ts` 的 `parseISODate` 对非法输入产生 `Invalid Date`，下游输出 `NaN月NaN日` 而非抛异常；导入侧 `isValidDate` 已拦截非法日期。
7. **金额渲染出口全量扫描**：除 C01/C08 外，所有可见金额均经 `Money`/`formatMoney`（含 BarChart 的 `aria-label`、MonthCalendar 的日历格读屏文案、MoveSheet/Snapshots 的预览合计）；CSV/Excel/PDF/二维码/复制摘要属**有意明文**并已有 UI-06 提示。通知文案（`paydayNotifications.ts:93-94`、`nativeReminders.ts:184-186,225-226`、`reminder.ts`）与预算提醒（`budget.ts:44-62`）均不含金额，只有日期/岗位名/百分比。
8. **触控目标**：`icon-button` 44×44（`styles.css:10463-10466`）、`.hero-eye` 44、`.trash-row .icon-button--small` 44（`styles.css:10549-10557`）、`.toast-close` 40、`.attendance-cell` min-height 44。剩余 `filter-chip` 34px、`segmented--sm` 36px 满足 WCAG 2.5.8（AA，24px 下限），不再计入。
9. **CSP 与产物一致性（正面结论）**：`dist/index.html` 的内联主题脚本 sha256 与注入的 `script-src 'sha256-…'` 实测一致；CSP meta 位于内联脚本之前（`dist/index.html:5` 早于 `:9`），无「策略晚于脚本」失效问题。
10. **发布产物一致性（正面结论，供 D 路交叉核对）**：`dist/index.html` 与 `android/app/src/main/assets/public/index.html` 哈希相同（`9343feae…`），`dist/sw.js` 与 assets `sw.js` 哈希相同（`fd85e0da…`，`CACHE_NAME='xinshi-v32'`）；APK 内资源与源码构建产物不漂移。
11. **移动端布局**：`.subpage`/`.sheet-layer`/`.bottom-nav`/`.app-shell` 均使用 `--safe-*`（`styles.css:39-42` 及 20+ 使用点），`--keyboard-inset` 已把抽屉抬到软键盘之上（`styles.css:10563-10580`）；`.attendance-table-wrap`/`.job-scroller`/`.filter-row` 有横向滚动容器，无已知横向溢出点。
12. **`role="dialog"` + `aria-modal="true"` 未给背景加 `inert`**：主流读屏对 `aria-modal` 有支持，`useModalFocus` 已做 Tab 循环；作为已知取舍不计入发现。

---

## 六、与主报告衔接

- 本路 P2 全部集中在「已修项只修到示例点」这一模式（上轮 §8.2 已作为结论提出）：C01 对应 UI-05、C02 对应 UI-11、C08 对应 UI-06、C17 对应 UI-10、C13 对应 UI-24。建议后续修复的验收方式改为**「出口清单 + 全量 grep 断言」**（例如：所有 `rateLabel(` 调用点必须与 `usePrivacy()` 同文件；所有 `fetch(` 的资源必须在预缓存清单内），并把这些断言写进 `scripts/check-offline-csp.mjs` / 新增 `check-ui-invariants.mjs`。
- C03/C04/C07 是「降级状态与返回语义」主题，建议合并为一个修复批次（banner 布局 + history 栈 + 禁用态返回），改动集中在 `App.tsx`、`SubPage.tsx`、`styles.css`、新增 `lib/historyBack.ts`。
- P0/P1 判定：本轮 UI 域**无数据丢失级缺陷**。所有破坏性操作（删除工记/休息/借支/工作、清空回收站、清空账本、导入覆盖、恢复快照、撤销结算）均有二次确认与（多数）撤销或清空前快照兜底；未发现可绕过的确认路径。C11 只是幂等放大，不构成数据损坏。
- 未覆盖/未验证：真机（iOS PWA、Android 5–9 分享面板、Android 16 返回层级）与性能实测；`vitest` 2 例失败位于数据层（health.test.ts），不属本路。
