# 薪时 v0.9.0 · 上架材料与合规清单

> 用途：提交 Google Play 与国内 Android 商店时直接取用。
> 版本：0.9.0（versionCode 900）｜ 包名：`com.xinshi.app`｜ 更新：2026-11-06
>
> 所有文案都按「不收集、不上传、无账号、无广告、无统计」的真实行为编写；
> 改代码后若行为变化，必须同步改本文和隐私政策。

---

## 1. 应用基本信息

| 项 | 内容 |
| --- | --- |
| 应用名 | 薪时 |
| 包名 | `com.xinshi.app` |
| 版本 | 0.9.0（versionCode 900） |
| 分类 | 工具 / 效率（Google Play：Tools） |
| 价格 | 免费，无广告，无内购 |
| 登录 | 不需要，全部功能免登录 |
| 网络 | **不申请网络权限**；无服务器 |
| 数据 | 只存本机；导出文件由用户保管 |
| 支持邮箱 | `support@xinshi.app`（上线前必须换成真实可收信邮箱） |
| 隐私政策 | `https://pinbodhua.github.io/DSJiZhangApp/privacy-policy.html`（需开启 GitHub Pages，源选 `/docs`）；若 Pages 源选根目录，URL 改为 `https://pinbodhua.github.io/DSJiZhangApp/docs/privacy-policy.html` |

### 短描述（≤80 字）

> 记工时、算工资、等发薪。小时工 / 日结 / 周结 / 月结的离线工资账本，数据只存本机。

### 完整描述

> 薪时是给灵活就业者用的「工时 + 薪资」记账本，约 3MB，不登录、不联网、无广告。
>
> 记一笔工时，自动算基础工资、加班费、奖金、扣款和借支抵扣；按日、周、月生成结算单，
> 支持工资条图片、文字版 PDF、二维码和 Excel 对账表。
>
> 适合小时工、日结工、周结工、长期月结工，也适合同时打几份工的人。
>
> 特点：
> - **约 3MB，轻小美**：不登录、不联网也能用，数据只存在本机；
> - 3 步记一笔：默认岗位 / 班次 / 今天，常用时长一键；
> - 三种计薪方式 + 计件；周末 / 节假日加班倍率可改；
> - 固定月薪、随机休息、月休额度、超休扣款；
> - 记录搜索：按岗位 / 备注 / 日期 / 金额找回任意一笔；
> - 周 / 月 / 年统计：年度 12 个月图表和岗位分布；
> - 结算锁定与撤销，历史金额不随调价变化；
> - 本机时光机、加密搬家包、自动备份、账本体检，换手机不丢账；
> - 工资条 PNG / 文字版 PDF / 二维码 / Excel，方便和老板对账。
>
> 薪时不提供招聘、支付、社保代缴或法律意见；计算结果仅供参考，实际工资以约定为准。

### 关键词

工时记录、记工、工资计算、日结、周结、月结、兼职记账、考勤、工资条、对账、临时工

---

## 2. 商店截图建议

截图目录：`shots/v0.8/`（v0.8 搜索 / 年度）与 `shots/v0.7/`、`shots/v0.6/`（既有）。

| 顺序 | 页面 | 文件 | 建议标题文案 |
| --- | --- | --- | --- |
| 1 | 首页（有数据） | `shots/v0.8/02-home.png` | 约 3MB，轻小美 |
| 2 | 记录搜索 | `shots/v0.8/05-search-result.png` | 一笔工记都能找回来 |
| 3 | 年度统计 | `shots/v0.8/07-stats-year.png` | 这一年干了多少，一目了然 |
| 4 | 记一笔 | `shots/v0.8/06-entry.png` | 3 步记下今天工时 |
| 5 | 12 周热力图 | `shots/v0.7/05-stats.png` | 辛苦看得见 |
| 6 | 数据与安全 | `shots/v0.6/02-data-safety.png` | 换手机不丢账 |
| 7 | 本机时光机 | `shots/v0.6/03-snapshots.png` | 删错了也能找回 |
| 8 | 隐私政策 | `shots/v0.6/09-privacy-policy.png` | 不上传，数据只在本机 |

- 手机截图 1080×1920 或 1242×2688；Google Play 至少 2 张、最多 8 张。
- 图标 512×512 PNG；Feature graphic 1024×500。
- 截图不要放真实姓名、手机号、身份证、具体工地地址。

---

## 3. Google Play Data safety 填写口径

| 问题 | 答案 |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not applicable（无传输） |
| Do you provide a way for users to request that their data is deleted? | Yes — 应用内「清空所有数据」；卸载 App；导出文件由用户删除 |
| Does your app use advertising or analytics? | No |
| Does your app require an account? | No |
| Target audience | 18+（工具类，非儿童向） |
| News app | No |
| COVID-19 app | No |
| Government app | No |
| Financial features | 不提供贷款、支付、投资、保险或金融服务；只做个人工时与工资记录 |

### 权限说明（商店「权限清单」）

| 权限 | 类型 | 用途 | 用户可否拒绝 |
| --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | 运行时 | 每日记工 / 发薪提醒 | 可以，拒绝不影响记工 |
| `RECEIVE_BOOT_COMPLETED` | 普通 | 重启后恢复本地提醒 | 随通知开关 |
| `WAKE_LOCK` | 普通 | 本地通知按时触发 | 不单独申请 |
| `INTERNET` | **未申请** | 应用没有网络请求 | — |
| 存储 / 相机 / 定位 / 通讯录 / 电话 / 短信 | **未申请** | — | — |
| `com.xinshi.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | 应用私有签名权限（AndroidX 自动生成） | 保护应用内部广播，不涉及用户数据 | — |

> 构建后必须用 `aapt dump permissions` 复核，确保 release 包没有 INTERNET。

---

## 4. 内容分级与受众

- Google Play 内容分级问卷：工具类，无暴力、性、赌博、毒品、恐怖、用户生成内容、位置共享。
- 目标受众：18 岁及以上劳动者；不加入 Families 计划。
- 中国商店：选「工具 / 效率」，内容分级按各商店问卷；未成年人保护说明写「不面向未成年人」。

---

## 5. 构建与签名

```bash
pnpm install
pnpm test
pnpm build
pnpm exec cap sync android

cd android
# 国内商店 / 侧载 APK
gradlew.bat assembleRelease
# Google Play AAB
gradlew.bat bundleRelease
```

- 签名配置读取 `android/keystore/signing.properties`（已 gitignore，不入库）。
- 产物：
  - `android/app/build/outputs/apk/release/app-release.apk`
  - `android/app/build/outputs/bundle/release/app-release.aab`
- 复制并重命名到 `release/xinshi-v0.9.0.apk` / `release/xinshi-v0.9.0.aab`。
- 校验：

```bash
apksigner verify --print-certs release/xinshi-v0.9.0.apk
jarsigner -verify -verbose -certs release/xinshi-v0.9.0.aab
aapt dump badging release/xinshi-v0.9.0.apk | findstr "package versionCode targetSdkVersion"
aapt dump permissions release/xinshi-v0.9.0.apk
```

- keystore 必须离线备份两份；丢失后无法覆盖升级。
- 首次上传 Google Play 建议启用 Play App Signing；上传 AAB，不上传 APK。

---

## 6. Google Play 提交检查清单

- [ ] 开发者账号完成实名 / 付款资料。
- [ ] 应用名称、短描述、完整描述、图标、Feature graphic、至少 2 张截图。
- [ ] 隐私政策 URL 可公开访问（HTTPS，非 PDF，非登录后可见）。
- [ ] Data safety 按第 3 节填写。
- [ ] 内容分级问卷完成。
- [ ] 目标受众与广告声明：无广告、非儿童向。
- [ ] 上传签名 AAB；versionCode 900；targetSdk 36。
- [ ] 应用访问权限：无需登录，审核员可直接进入。
- [ ] 提供审核说明：离线应用，无服务器，无账号；可用「先看看示例数据」体验。
- [ ] 测试轨道先内测，确认安装、离线、导出、恢复。
- [ ] 商店联系邮箱可收信。

---

## 7. 国内 Android 商店检查清单

| 项目 | 说明 | 状态 |
| --- | --- | --- |
| 开发者实名 | 华为 / 小米 / OPPO / vivo / 应用宝等分别注册 | 外部办理 |
| 软件著作权 / 电子版权 | 多数商店要求；个人可申请软著 | 外部办理 |
| 工信部 APP 备案 | 需主体资料、包名、签名 MD5、隐私政策 URL | 外部办理 |
| 隐私政策 URL | `docs/privacy-policy.html` 托管后的地址；Pages 源 `/docs` 时为 `.../privacy-policy.html` | 需开启 Pages |
| 隐私政策首启弹窗 | v0.7.0 已实现，未同意不进入 | 已完成 |
| 权限清单 | 见第 3 节；无敏感权限 | 已完成 |
| 个人信息收集清单 | 无收集；本地存储 | 已完成 |
| 第三方 SDK 清单 | 无广告 / 统计 / 推送 SDK | 已完成 |
| 数据删除方式 | 应用内清空 + 卸载 | 已完成 |
| 未成年人说明 | 不面向未成年人 | 已完成 |
| 应用截图 / 图标 / 简介 | 见第 2 节；v0.8 截图已生成 | 已完成 |
| 64 位 | Capacitor WebView 壳，无自编译 32 位 so | 构建后复核 |
| 签名一致 | 同一 keystore 覆盖升级 | 需备份 |

> 国内商店对「线上隐私政策 URL」和「APP 备案」是硬门槛，代码无法代办；
> 仓库里已准备好隐私政策 HTML 和全部填写文案。

---

## 8. 审核可能追问的问题

**Q：应用完全不联网，为什么还需要通知权限？**
A：只用于本地记工 / 发薪提醒；用户可拒绝，拒绝后所有记账功能正常。权限在用户主动开启提醒时才申请。

**Q：为什么写「自动备份」却不需要存储权限？**
A：Android 10+ 通过 MediaStore 写入应用自己的 `Download/Xinshi/` 目录，不读取其他文件，所以不需要存储权限；Android 10 以下只提供手动分享。

**Q：数据删除在哪里？**
A：「我的 → 数据与安全 → 清空所有数据」，同时删除本机快照可选；卸载 App 删除本地数据；导出文件由用户在文件管理器删除。

**Q：有没有第三方 SDK 收集数据？**
A：没有。二维码、PDF、图表、图标库都在本地打包运行；没有广告、统计、推送、云同步 SDK。

**Q：为什么没有账号注销？**
A：应用没有账号体系，不收集账号信息；删除本地数据即完成全部删除。

---

## 9. 上线前必须替换的占位符

| 位置 | 当前值 | 替换为 |
| --- | --- | --- |
| `src/lib/compliance.ts` / `docs/privacy-policy.html` | `support@xinshi.app` | 真实可收信邮箱 |
| `src/lib/compliance.ts` / 本文 | `https://pinbodhua.github.io/DSJiZhangApp/privacy-policy.html` | 实际可访问的隐私政策 URL |
| `docs/privacy-policy.html` | 同上 | 同上 |

可用构建环境变量覆盖，不必改代码：

```bash
VITE_SUPPORT_EMAIL=you@example.com
VITE_PRIVACY_URL=https://your.site/privacy-policy.html
```

---

## 10. 发布记录（2026-11-06）

### v0.9.0（当前）

| 项 | 内容 |
| --- | --- |
| 版本 | 0.9.0（900） |
| 构建时间 | 2026-11-06 19:26（Asia/Shanghai） |
| APK | `release/xinshi-v0.9.0.apk`（3,318,507 B / 约 3.17MiB） |
| AAB | `release/xinshi-v0.9.0.aab`（3,794,343 B / 约 3.62MiB） |
| APK SHA-256 | `A10AF798895880F10378B7CFB0C578B884C06270E05CD3C5460FF86DF149AC0C` |
| AAB SHA-256 | `198F0274D50986847E66BFE130CA9FEB56B8384257A83F66DEB329C8319A1ACB` |
| 签名证书 SHA-256 | `A5:B8:51:4A:16:5A:78:49:A4:07:3B:D0:0A:94:75:9F:CB:95:7A:A0:2F:83:97:00:12:EB:72:F2:51:85:D6:06` |
| 权限 | `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`；无 INTERNET；另有 AndroidX 自动生成的应用私有签名权限 |
| 验证 | `aapt` 校验 versionCode / versionName；`apksigner` 证书一致；浏览器 110 场景、15 分辨率 × 9 页面 + 子页面 16 组合全绿 |
| 发布说明 | [RELEASE-NOTES-v0.9.0](RELEASE-NOTES-v0.9.0.md) |
| 已知限制 | 见 README「已知限制」 |

### v0.8.0（历史）

| 项 | 内容 |
| --- | --- |
| 版本 | 0.8.0（800） |
| 构建时间 | 2026-11-06 08:48（Asia/Shanghai） |
| APK | `release/xinshi-v0.8.0.apk`（3,313,997 B / 约 3.16MiB） |
| AAB | `release/xinshi-v0.8.0.aab`（3,789,833 B / 约 3.61MiB） |
| APK SHA-256 | `F7E19DEEB40D25A577D07360A208D34F1365E1604E6C35C70BBC6F2A0F55C45F` |
| AAB SHA-256 | `E83268589BFFEF9F9BDBA7F8499BBEDF115FB97448539222937BEB32F68F5D89` |
| 签名证书 SHA-256 | `A5:B8:51:4A:16:5A:78:49:A4:07:3B:D0:0A:94:75:9F:CB:95:7A:A0:2F:83:97:00:12:EB:72:F2:51:85:D6:06` |
| 权限 | `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`；无 INTERNET；另有 AndroidX 自动生成的应用私有签名权限 |
| 测试设备 | Redmi Note 13 Pro 5G / Android 16 真机（407×904 CSS）；LDPlayer 14 / Android 14 |
| 冷启动 | 稳定后 5 次 555–629ms，中位 583ms；安装后首次 1093ms |
| 已知限制 | 见 README「已知限制」 |

### v0.7.0（历史）

| 项 | 内容 |
| --- | --- |
| 版本 | 0.7.0（700） |
| 构建时间 | 2026-11-05 21:58（Asia/Shanghai） |
| APK | `release/xinshi-v0.7.0.apk`（3,303,728 B / 约 3.30MB） |
| AAB | `release/xinshi-v0.7.0.aab`（3,776,494 B / 约 3.78MB） |
| APK SHA-256 | `EA5E2B0A2A6DB1F3B224CAD29D7F421A5310E829F67ACF2263B986CACDF74F59` |
| AAB SHA-256 | `E840D5A641B091B5E1F3F4D3723480B75335D7485CEAA7381C05FFD14EF04356` |
| 签名证书 SHA-256 | `A5:B8:51:4A:16:5A:78:49:A4:07:3B:D0:0A:94:75:9F:CB:95:7A:A0:2F:83:97:00:12:EB:72:F2:51:85:D6:06` |
| 权限 | `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`；无 INTERNET；另有 AndroidX 自动生成的应用私有签名权限 |
| 测试设备 | LDPlayer 14 / Android 14；需补 Android 15/16 真机 |
| 已知限制 | 见 README「已知限制」 |
