# 截图目录

- `v0.3/`：当前版本（计件、PDF、加密备份、备份提醒）。
- `v0.2/`：计时、日历、工资条、深色模式版本。
- `v0.1/`：首个 MVP 版本留存，仅作历史对照。

重新生成 v0.3 截图：

```bash
pnpm build
pnpm preview   # 另开终端，默认 http://127.0.0.1:4173
pnpm shots
```

截图脚本使用本机 Edge；换环境请修改 `scripts/shoot-v03-final.mjs` 里的 `EDGE` 路径。
