# v0.7.2 · 全分辨率适配（含 v0.7.1 闪退修复）

> 目标：一台手机上的显示问题不再依赖「这台机子刚好」，而是 320–1440px 全宽度、横竖屏、刘海 / 手势条 / 平板 / 桌面都能站得住。
>
> 验收：分辨率矩阵 **105 / 105 组合无横向溢出、无安全区遮挡**；真机 Redmi Note 13 Pro 5G（HyperOS 3 / Android 16，1220×2712 @480dpi → 407×904 CSS）安装验证。

## 1. v0.7.1 先修闪退（否则没法谈适配）

### 现象

红米 Note 13 Pro 5G（Android 16）上 v0.7.0 **一打开就闪退**，v0.6.0 正常；雷电模拟器（Android 14）上 v0.7.0 正常。

### 定位

真机连 `adb` 后从系统崩溃记录里取到原始堆栈（`adb shell dumpsys dropbox --print`）：

```
FATAL EXCEPTION: CapacitorPlugins
java.lang.RuntimeException: java.lang.reflect.InvocationTargetException
Caused by: java.lang.NullPointerException
    at com.getcapacitor.Plugin.getPermissionStates(...)
    at com.getcapacitor.Plugin.checkPermissions(...)
    at com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin.checkPermissions(...)
```

对应 Capacitor 上游 issue [#8399](https://github.com/ionic-team/capacitor/issues/8399) / PR [#8400](https://github.com/ionic-team/capacitor/pull/8400)：**release 开 R8 后，`@CapacitorPlugin` 内嵌的 `@Permission` 注解元数据被裁掉**，`Bridge.getPermissionStates()` 读到 null 直接 NPE。异常抛在原生桥线程，JS 的 try/catch 拦不住，系统直接杀进程。

- v0.6.0 不闪退：`minifyEnabled false`，没有触发；
- v0.7.0 闪退：为了把 APK 从 5.31MB 压到 3.30MB 开了 R8；
- 只在「有工作记录」时崩：首页 `schedulePaydayNotifications` → `LocalNotifications.checkPermissions()`，没有工记不会走到这一行。

### 修复

`android/app/proguard-rules.pro`：

```proguard
-keepattributes *Annotation*
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations, AnnotationDefault
-keep @interface com.getcapacitor.annotation.CapacitorPlugin { *; }
-keep @interface com.getcapacitor.annotation.Permission { *; }
-keep @interface com.getcapacitor.annotation.PermissionCallback { *; }
-keep @interface com.getcapacitor.annotation.ActivityCallback { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
```

### 验证

在雷电模拟器（Android 14）上用 **R8 包**载入示例数据，复现出与真机**完全一致**的堆栈；补规则后同一操作不再崩，并回归首页 / 记录 / 结算 / 统计 / 我的 / 记一笔 / 导出备份（`SaveFilePlugin`）。

顺带补的诊断能力（正式包默认关闭）：

| 能力 | 说明 |
| --- | --- |
| 启动节点日志 | Application / Activity / WebView 关键节点写内部日志，崩溃时导出到 `Download/Xinshi/xinshi-diag.txt` |
| 原生崩溃页 | 启动阶段抛异常时直接把堆栈显示在屏幕上，不用连电脑 |
| 渲染进程兜底 | `onRenderProcessGone` 不再连带杀掉整个 App，先重载、连续崩溃才展示诊断页 |
| 构建开关 | `-Pxinshi.versionCode` / `-Pxinshi.versionName` / `-Pxinshi.noMinify` / `-Pxinshi.diag` |

## 2. v0.7.2 全分辨率适配

### 关键量测（真机）

| 项 | 数值 |
| --- | --- |
| 物理分辨率 / 密度 | 1220×2712 @480dpi |
| CSS 视口 | 407×904 pt |
| 顶部安全区（状态栏 / 挖孔） | 122px = **40.7pt** |
| 底部安全区（手势条） | 48px = **16pt** |
| 系统 | HyperOS 3 / Android 16，targetSdk 36 → 强制 edge-to-edge |

### 发现的问题

1. **每页都有 1–3px 横向溢出**：`.app-main` 左右内边距在 v0.7 改成 16px（≤380px 时 13px、≥720px 时 24px），但 `.job-scroller` / `.filter-row` 仍按固定的 `-18px` 负边距出血，宽度对不上 → 页面可以左右拖动几像素，真机上表现为「卡片边缘抖动 / 能横向滑一点」。
2. 左右安全区完全没有处理：横屏挖孔、平板圆角会被内容压到。
3. `100dvh` 没有 `100vh` 回退：旧 WebView（Android 7–9 机）不认 `dvh`，`max-height` 直接失效，抽屉可能顶出屏幕。
4. 悬浮底栏 / FAB / 抽屉只处理了上下安全区，横屏时 `max-width` 与安全区不联动。
5. 横屏（≤520px 高）时底部导航与 FAB 占掉太多高度，正文只剩一条。

### 改法

- 新增 `--gutter` 变量：16px（默认）/ 13px（≤380px）/ 24px（≥720px）/ 20px（横屏矮屏）。`.app-main` 内边距与出血横滑区的负边距**全部引用同一个变量**，从根上消除对不齐。
- 新增 `--safe-top / --safe-right / --safe-bottom / --safe-left` 变量，取值 `env(safe-area-inset-*)`，全站 23 处安全区改用它；浏览器里可用变量模拟刘海做回归。
- `.app-shell` 补齐四向安全区内边距；`.sheet-layer` / `.dialog-layer` / `.privacy-gate` 补左右安全区。
- 悬浮底栏宽度改为 `min(520px, 100% - 24px - 左右安全区)`，并按左右安全区差值居中；FAB 的 `right` / `bottom` 同时叠加 `--safe-right` / `--safe-bottom`。
- 所有 `dvh` 前补 `vh` 回退（10 组）。
- 新增 `@media (max-height: 520px) and (orientation: landscape)`：紧凑导航（42px）、缩小 FAB、压低上下留白，抽屉放宽到 96dvh。
- 平板 ≥720px 的 FAB 偏移补回 `--safe-bottom`。

### 验收

新增可重复执行的矩阵审计 `scripts/responsive-audit.mjs`：

- 15 个分辨率 × 7 个页面 = **105 组合**：320×568、360×640、360×780、375×667、390×844、**407×904（真机）**、412×915、430×932、540×720、600×960、768×1024、1024×768、1280×800、904×407、667×375；
- 每个组合检查：`scrollWidth - clientWidth` 横向溢出、越界元素（排除横向滚动容器与 `overflow:hidden` 裁剪）、底栏是否在视口内；
- `--insets` 模式额外把 `--safe-top: 41px` / `--safe-bottom: 16px` 注入页面，校验主区顶部不被状态栏压住、底栏距底不小于手势条高度。

结果：

| 轮次 | 问题组合 |
| --- | --- |
| 改前基线 | **35 / 90**（1–3px 横向溢出、底栏 / 抽屉越界） |
| 改后 | **0 / 105** |
| 改后 + 模拟刘海 / 手势条 | **0 / 105** |

真机回归：407×904 下主区顶部 = 41pt、底栏距底 = 25pt（手势条 16pt），与浏览器模拟值一致。

子页面（数据与安全 / 工作管理 / 月度考勤）另跑 4 分辨率 × 3 页面 = 12 组合，含刘海模拟同样 **0 / 12**，子页头部 top 全部 = 41pt。

## 3. 交付

- `release/xinshi-v0.7.1.apk`：闪退修复（versionCode 703）
- `release/xinshi-v0.7.2.apk`：闪退修复 + 全分辨率适配（versionCode 705，3.15MB，R8 仍开启）
- 审计脚本：`node scripts/responsive-audit.mjs [--insets]` 与 `node scripts/responsive-subpages.mjs [--insets]`（需先 `pnpm preview`），截图与 `report.json` 输出到 `test-results-responsive*/`

## 4. 已知限制

- 桌面端仍是「手机单栏居中」，不做独立工作台；≥720px 只调整留白与字号。
- 后端运行时状态栏图标的明暗由系统 / ROM 决定（应用只声明主题色）；HyperOS 3 实测浅色主题下为深色图标。
- 横屏仍未做双栏布局，只是压缩底部悬浮导航。
