# 文字版 PDF 字体

`xinshi-sans.ttf` 是 Noto Sans SC 的子集，只用于「文字版工资条 PDF」。

- 字重 400；
- 覆盖 ASCII、GB2312 汉字与常用中文标点；
- 约 2.4 MB，按需 `fetch`，不进入 JS 主包。

重新生成（需要 Python + fonttools）：

```bash
python -m fontTools.varLib.instancer NotoSansSC-VF.ttf wght=400 --static -o NotoSansSC-400.ttf
python -m fontTools.subset NotoSansSC-400.ttf --text-file=chars.txt \
  --output-file=public/fonts/xinshi-sans.ttf --layout-features='*' --no-hinting --desubroutinize
```

`chars.txt` 由 ASCII + GB2312 全部字符 + 常用中文标点组成。字体使用 SIL OFL 1.1，详见 [LICENSE](LICENSE.txt)。
