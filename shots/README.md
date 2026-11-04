# 截图目录

- `v0.5.3/`：未来 7 天、日历计划标记、冲突逐日清单。
- `v0.5.2/`：固定周排班、排休冲突 / 超额、回收站 30 天。
- `v0.5.1/`：工作回收站、批量排休。
- `v0.5/`：发薪日、超休扣款、收款、本月流水 CSV。
- `v0.4/`：固定月薪、随机休息、班次模板、撤销与模板。
- `v0.3/`：计件、PDF、加密备份、备份提醒版本。
- `apk/`：Capacitor Android 测试包截图（含系统状态栏）。
- `v0.2/`：计时、日历、工资条、深色模式版本。
- `v0.1/`：首个 MVP 版本留存，仅作历史对照。

重新生成 v0.4 / v0.5 / v0.5.1 / v0.5.2 / v0.5.3 截图：

```bash
pnpm build
pnpm preview   # 另开终端，默认 http://127.0.0.1:4173
pnpm shots
```

截图脚本使用本机 Edge；换环境请修改 `scripts/shoot-v04-final.mjs` / `scripts/shoot-v05-final.mjs` / `scripts/shoot-v051-final.mjs` 里的 `EDGE` 路径。
