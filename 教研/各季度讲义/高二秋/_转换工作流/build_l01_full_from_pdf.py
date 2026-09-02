from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(r"D:\obrepo\papers\教研\各季度讲义\高二秋")
PDF = Path(r"C:\Users\ava\AppData\Local\Temp\codex-file-preview-f6R5YH\高二物理秋季培优S.pdf")
ASSET_DIR = ROOT / "assets" / "01-静电场力学模型_pdf"
WORK_DIR = ROOT / "_转换工作流"
OUT_MD = ROOT / "第1讲 静电场力学模型_完整.md"
RAW_TEXT = WORK_DIR / "l01-pdftext.txt"


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def render_pdf_pages() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    prefix = str(ASSET_DIR / "page")
    run(["pdftoppm", "-f", "5", "-l", "26", "-r", "160", "-png", str(PDF), prefix])

    # pdftoppm names from absolute PDF page numbers. Rename to lecture-local page numbers.
    for pdf_page in range(5, 27):
        src = ASSET_DIR / f"page-{pdf_page:03d}.png"
        dst = ASSET_DIR / f"l01-p{pdf_page - 4:03d}.png"
        if src.exists():
            if dst.exists():
                dst.unlink()
            src.rename(dst)


def extract_pdf_text() -> list[str]:
    result = run(["pdftotext", "-f", "5", "-l", "26", "-layout", str(PDF), "-"])
    text = result.stdout.decode("utf-8", errors="replace")
    RAW_TEXT.write_text(text, encoding="utf-8")
    pages = text.split("\f")
    pages = pages[:22]
    return [cleanup_page(p, i + 1) for i, p in enumerate(pages)]


def cleanup_page(text: str, lecture_page: int) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    cleaned: list[str] = []
    for line in lines:
        if not line:
            continue
        if line in {"第 1 讲", "笔记整理"}:
            continue
        if re.fullmatch(r"第\d+页", line):
            continue
        if re.fullmatch(r"\d+级", line):
            cleaned.append(f"## {line}")
            continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()


def md_for_page(text: str, lecture_page: int) -> str:
    image = f"![[assets/01-静电场力学模型_pdf/l01-p{lecture_page:03d}.png|720]]"
    page_title = f"## PDF 原页 {lecture_page}"

    if lecture_page == 1:
        body = """# 知识讲解

## 本讲考情分析

| 级别 | 考点和演练 | 题型 | 考查内容 |
|---|---|---|---|
| 1级 | 库伦摆和静电摆 | 选择题/解答题 | 受力分析解决库伦摆和静电摆问题 |
| 2级 | 静电场中的平衡 | 选择题 | 平衡思想解决静电场中的力学问题 |
| 3级 | 常见电场的分布 | 选择题 | 常见电场的分布以及不同位置的场强大小 |
| 4级 | 叠加原理求电场 | 选择题 | 多个电荷作用下场强的求解 |
| 5级 | 对称微元求场强 | 选择题 | 微元法求解场强问题 |
"""
    elif lecture_page == 3:
        body = """## 笔记整理

### 静电场中的平衡问题

库仑力作用下平衡问题的分析思路

1. 分析库仑力作用下点电荷的平衡问题时，方法与力学中物体的平衡的分析方法一样，具体步骤如下。
2. 确定研究对象。如果有几个物体相互作用时，要依据题意，适当选取“整体法”或“隔离法”。
3. 对研究对象进行受力分析，此时多了库仑力（$F=\\frac{kq_1q_2}{r^2}$）。
4. 建立坐标系。
5. 根据 $F_合=0$ 列方程，若采用正交分解，则有 $F_x=0$，$F_y=0$。
6. 求解方程。

要使三个自由点电荷组成的系统都处于平衡状态，三个点电荷需满足：

1. “三点共线”——三个点电荷必须在同一条直线上。
2. “两同夹异”——带同种电荷的点电荷不能相邻。
3. “两大夹小”——“中间”点电荷的电荷量最小。
4. “近小远大”——两边点电荷靠“中间”点电荷近的电荷量较小，远的电荷量较大。

在三个共线点电荷的平衡问题中，若仅让其中一个电荷平衡，则只需要确定其位置即可，对其电性和所带电荷量没有要求，位置应满足“两同夹中间，两异在两边”。
"""
    else:
        body = text_to_editable_markdown(text, lecture_page)

    return f"""{page_title}

{image}

{body}
"""


def text_to_editable_markdown(text: str, lecture_page: int) -> str:
    if not text:
        return "> [!note] 本页主要为空白/笔记页，以上方 PDF 原页图为准。"

    replacements = {
        "1级：库伦摆和静电摆": "# 题目练习\n\n## 1. 1级：库伦摆和静电摆",
        "2级：静电场中的平衡": "## 2. 2级：静电场中的平衡",
        "3级：常见电场的分布": "## 3. 3级：常见电场的分布",
        "4级：叠加原理求电场": "## 4. 4级：叠加原理求电场",
        "5级：对称微元求场强": "## 5. 5级：对称微元求场强",
        "考点 1": "### 考点 1",
        "考点 2": "### 考点 2",
        "考点 3": "### 考点 3",
        "考点 4": "### 考点 4",
        "考点 5": "### 考点 5",
        "经典练习": "### 经典练习",
        "方法解析": "### 方法解析",
        "锦囊总结": "### 锦囊总结",
        "真题练习 1": "### 真题练习 1",
        "真题练习 2": "### 真题练习 2",
        "真题练习 3": "### 真题练习 3",
        "真题练习 4": "### 真题练习 4",
        "真题练习 5": "### 真题练习 5",
    }

    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = replacements.get(line, line)
        if re.match(r"^\d+ \. ", line):
            line = "###### " + line.split(" . ", 1)[0] + "\n" + line
        if line.startswith("【试卷】") or re.match(r"^20\d{2}.*第\d+题", line):
            line = f"> [!ti] *{line}*"
        elif " A. " in line and " B. " in line:
            line = split_options(line)
        elif re.match(r"^[A-D]\. ", line):
            line = "> > [!opts]\n> > - " + line
        lines.append(line)

    note = (
        "\n\n> [!info] 转换说明\n"
        "> 本页已嵌入原 PDF 页图。可编辑文本来自 PDF 文本层，公式/变量若有缺失，以上方页图为准。"
    )
    return "\n\n".join(lines) + note


def split_options(line: str) -> str:
    parts = re.split(r"\s+([A-D]\.)\s+", " " + line)
    opts: list[str] = []
    prefix = parts[0].strip()
    for i in range(1, len(parts), 2):
        label = parts[i]
        text = parts[i + 1].strip() if i + 1 < len(parts) else ""
        opts.append(f"> > - {label} {text}")
    if prefix:
        return prefix + "\n\n> > [!opts4]\n" + "\n".join(opts)
    return "> > [!opts4]\n" + "\n".join(opts)


def write_markdown(pages: list[str]) -> None:
    parts = [
        "# 第1讲 静电场力学模型 #h0",
        "> [!info] 转换状态\n> 本文件为第一讲完整 PDF 保真转换版：每页均嵌入从原 PDF 渲染出的高清页图，图下提供可编辑文本。公式和题图以 PDF 页图为最终校对依据。",
    ]
    for i, text in enumerate(pages, start=1):
        parts.append(md_for_page(text, i))
        if i != len(pages):
            parts.append('<div class="page-break" style="page-break-before: always;"></div>')
    OUT_MD.write_text("\n\n".join(parts) + "\n", encoding="utf-8")


def main() -> None:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    render_pdf_pages()
    pages = extract_pdf_text()
    write_markdown(pages)
    print(OUT_MD)


if __name__ == "__main__":
    main()
