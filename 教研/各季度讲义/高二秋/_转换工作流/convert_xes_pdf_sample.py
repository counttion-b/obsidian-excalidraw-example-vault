from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PDF = Path(r"C:\Users\ava\AppData\Local\Temp\codex-file-preview-f6R5YH\高二物理秋季培优S.pdf")
REFERENCE_MD = Path(r"C:\Users\ava\AppData\Local\Temp\codex-file-preview-CTrYpu\第1讲 库仑定律_知识点.md")

OUT = ROOT / "outputs" / "xes-physics-obsidian-workflow"
ASSETS = OUT / "assets"
WORK_RENDER = ROOT / "work" / "sample_rendered_pages"
WORK_TEXT = ROOT / "work" / "pdftotext_l01_p005_p012.txt"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def render_pages() -> None:
    WORK_RENDER.mkdir(parents=True, exist_ok=True)
    run(
        [
            "pdftoppm",
            "-f",
            "5",
            "-l",
            "12",
            "-r",
            "160",
            "-png",
            str(PDF),
            str(WORK_RENDER / "page"),
        ]
    )


def extract_text() -> str:
    result = subprocess.run(
        [
            "pdftotext",
            "-f",
            "5",
            "-l",
            "12",
            "-layout",
            str(PDF),
            "-",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    text = result.stdout.decode("utf-8", errors="replace")
    WORK_TEXT.write_text(text, encoding="utf-8")
    return text


def crop_sample_figures() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    # PDF page 8 is lecture page 4. The coordinates are in the rendered
    # 160-dpi PNG and preserve the original diagrams without redrawing.
    page = Image.open(WORK_RENDER / "page-008.png")
    page.save(ASSETS / "xes-s-l01-p004-page.png")
    crops = {
        "xes-s-l01-p004-fig01.png": (350, 615, 870, 820),
        "xes-s-l01-p004-fig02.png": (480, 1415, 800, 1760),
    }
    for name, box in crops.items():
        img = page.crop(box)
        img.save(ASSETS / name)


def write_readme() -> None:
    readme = """# 学而思 PDF 到 Obsidian Markdown 工作流

## 目标

把《高二物理秋季培优S.pdf》按讲次转换为本地 Obsidian Markdown，尽量忠实保留：

- 讲次标题、考点、知识点、经典练习、方法解析、锦囊总结、真题练习
- 题目来源、题干、选项、公式、空格
- 页面图片和题图
- 可回到 PDF 原页校对的页码线索

## 参考 Markdown 格式规范

参考文件《第1讲 库仑定律_知识点.md》的核心规范如下：

- `# 第X讲 标题 #h0` 作为讲次根标题。
- `# 知识讲解` 和 `# 题目练习` 分成两大部分。
- `##` 表示一级知识模块或题目等级，`###` 表示更细的知识点。
- 知识点中的提示、补充、问题使用 Obsidian callout，例如 `> [!question]`、`> [!info]`、`> [!tip]`。
- 题目使用 `> [!ti] *来源*`，题干每一行继续以 `>` 开头。
- 选项使用嵌套 callout：`> > [!opts1]`、`> > [!opts4]`，选项行写成 `> > - A. ...`。
- 图片使用 Obsidian 内链：`![[assets/图片名.png|400]]`。
- PDF 换页可保留为 `<div class=\"page-break\" style=\"page-break-before: always;\"></div>`，方便后续打印或校对。

## 推荐目录结构

```text
XES-高二物理秋季培优S/
  第01讲 静电场力学模型.md
  第02讲 电场中能的性质.md
  ...
  assets/
    xes-s-l01-p004-fig01.png
    xes-s-l01-p004-page.png
    xes-s-l02-p023-fig01.png
  raw/
    l01-p005-p026.txt
    l01-page-map.json
```

## 图片命名方式

建议使用稳定、可排序、可回溯的命名：

```text
xes-s-l{讲次两位数}-p{讲义页三位数}-fig{图序两位数}.png
xes-s-l01-p004-fig01.png
```

说明：

- `l01` 表示第 1 讲。
- `p004` 表示讲义内页码第 4 页，不是 PDF 绝对页码。
- `fig01` 表示该页第 1 张题图。
- 若自动裁剪不可靠，保留整页图：`xes-s-l01-p004-page.png`。

## 可落地转换步骤

1. 建立目录：每讲一个 Markdown 文件，所有图片放进统一 `assets/`。
2. 用 `pdftotext -layout` 按讲次页码抽取文本，保留大致换行和题目顺序。
3. 用 `pdftoppm` 把对应页渲染成高清 PNG，作为视觉校对底稿。
4. 对题图优先做区域裁剪；无法自动判断边界时，先保留整页图或半页图。
5. 用规则把标题、考点、经典练习、方法解析、真题练习识别成 Markdown 层级。
6. 用规则识别题目来源：`【试卷】...`、年份地区学校题号等，放进 `> [!ti] *...*`。
7. 用规则识别 `A. B. C. D.` 选项，转为 `> > [!optsX]`。
8. 对公式缺失、乱码或空白处加 `{公式待校对}` 或 `{原文待校对}` 标记。
9. 在 Obsidian 中人工校对公式与选项，再批量转换下一讲。

## 自动化边界

这份 PDF 的中文正文可以抽取，但公式、角标、希腊字母、部分变量会在文本层丢失。忠实转换时不要只相信文本层，应同时保留题图/页图。最稳妥的策略是“文本结构自动化 + 图片忠实保底 + 公式人工校对”。
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")


def write_sample_md() -> None:
    sample = """# 第1讲 静电场力学模型 #h0
# 知识讲解

## 1. 本讲考情分析

| 级别 | 考点和演练 | 题型 | 考查内容 |
|---|---|---|---|
| 1级 | 库伦摆和静电摆 | 选择题/解答题 | 受力分析解决库伦摆和静电摆问题 |
| 2级 | 静电场中的平衡 | 选择题 | 平衡思想解决静电场中的力学问题 |
| 3级 | 常见电场的分布 | 选择题 | 常见电场的分布以及不同位置的场强大小 |
| 4级 | 叠加原理求电场 | 选择题 | 多个电荷作用下场强的求解 |
| 5级 | 对称微元求场强 | 选择题 | 微元法求解场强问题 |

## 2. 笔记整理

### 2.1. 静电场中的平衡问题

库仑力作用下平衡问题的分析思路

1. 分析库仑力作用下点电荷的平衡问题时，方法与力学中物体的平衡的分析方法一样，具体步骤如下。
2. 确定研究对象。如果有几个物体相互作用时，要依据题意，适当选取“整体法”或“隔离法”。
3. 对研究对象进行受力分析，此时多了库仑力（{公式待校对}）。
4. 建立坐标系。
5. 根据平衡条件列方程，若采用正交分解，则有 `{公式待校对}`。
6. 求解方程。

要使三个自由点电荷组成的系统都处于平衡状态，三个点电荷需满足：

1. “三点共线”——三个点电荷必须在同一条直线上。
2. “两同夹异”——带同种电荷的点电荷不能相邻。
3. “两大夹小”——“中间”点电荷的电荷量最小。
4. “近小远大”——两边点电荷靠“中间”点电荷近的电荷量较小，远的电荷量较大。

在三个共线点电荷的平衡问题中，若仅让其中一个电荷平衡，则只需要确定其位置即可，对其电性和所带电荷量没有要求，位置应满足“两同夹中间，两异在两边”。

<div class=\"page-break\" style=\"page-break-before: always;\"></div>

# 题目练习

## 1. 1级：库伦摆和静电摆

### 考点 1

受力分析解决库伦摆和静电摆问题。

### 经典练习

> [!ti] *【试卷】2024~2025学年北京延庆区高二上学期期中*
> 某物理兴趣小组利用图装置来探究影响电荷间静电力的因素，做了如下实验，A 是一个电荷量为 $Q$ 的带正电物体，把系在绝缘丝线上的带正电的小球先后挂在 $P_1$、$P_2$、$P_3$ 等位置，小球所带电荷量为 $q$。
>
> ![[assets/xes-s-l01-p004-fig01.png|330]]
>
> （1）为了比较小球在不同位置所受带电体的作用力的大小，下列方法最好的是 ______。
>
> > [!opts4]
> > - A. 比较小球抬起的高度
> > - B. 比较小球往右偏移的距离
> > - C. 比较丝线偏离竖直方向的角度
> > - D. 比较丝线的长度
>
> （2）使小球系于同一位置，增大或减小小球所带的电荷量，比较小球所受作用力的大小。上述操作所采用的物理方法是 ______。（填正确选项前的字母）
>
> > [!opts4]
> > - A. 等效替代法
> > - B. 控制变量法
> > - C. 理想模型法
> > - D. 微小量放大法
>
> （3）接着该组同学又进行了如下实验，如图所示，悬挂在 $P$ 点的不可伸长的绝缘细线下端有一个带电量不变的小球 $B$，在两次实验中，均缓慢移动另一带同种电荷的小球 $A$，当 $A$ 球到达悬点 $P$ 的正下方并与 $B$ 在同一水平线上，$B$ 处于受力平衡时，悬线偏离竖直方向角度为 $\\theta$，若两次实验中 $A$ 的电量分别为 $Q_1$ 和 $Q_2$，$\\theta$ 分别为 $30^\\circ$ 和 $60^\\circ$，则 $\\dfrac{Q_1}{Q_2}$ 为 ______。
>
> ![[assets/xes-s-l01-p004-fig02.png|245]]

### 方法解析

1. 带电小球平衡时，根据平衡条件可知，小球所受带电体的作用力大小为 `{公式待校对}`，所以，为了比较带电小球所受作用力的大小，最好的办法是比较丝线偏离竖直方向的角度。
2. 使小球系于同一位置，增大或减小小球所带的电荷量，比较小球所受作用力的大小，所以用的是控制变量法。
3. 对小球 B 受力分析，根据库仑定律结合平衡条件有 `{公式待校对}`，可得两次实验中 A 的电量之比为 `{公式待校对}`。

### 锦囊总结

解决库伦摆和静电摆的问题核心是运用力学中物体平衡的分析方法。

### 真题练习 1

###### 1
> [!ti] *【试卷】2022~2023学年北京大兴区大兴区第一中学高二上学期期中*
> 两个大小相同的小球带有同种电荷（可看作点电荷），质量分别为 `{公式待校对}` 和 `{公式待校对}`，带电量分别为 `{公式待校对}` 和 `{公式待校对}`，用绝缘线悬挂后，因静电力而使线张开，分别与竖直方向成夹角 `{公式待校对}` 和 `{公式待校对}`，且两球同处一水平线上，如图所示，若 `{公式待校对}`，则下述结论正确的是（ ）
>
> > [!opts4]
> > - A. 必须同时满足 `{公式待校对}`
> > - B. 一定满足 `{公式待校对}`
> > - C. `{公式待校对}` 一定等于 `{公式待校对}`
> > - D. `{公式待校对}` 一定等于 `{公式待校对}`

> [!info] 校对说明
> 本示例优先展示可落地结构。PDF 文本层对公式和变量支持较差，所有 `{公式待校对}` 均应对照原 PDF 页面或保留的页面截图修正。
"""
    (OUT / "第1讲 静电场力学模型.md").write_text(sample, encoding="utf-8")


def write_raw_reference_copy() -> None:
    raw_dir = OUT / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    if REFERENCE_MD.exists():
        (raw_dir / "参考格式-第1讲 库仑定律_知识点.md").write_text(
            REFERENCE_MD.read_text(encoding="utf-8"), encoding="utf-8"
        )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render_pages()
    extract_text()
    crop_sample_figures()
    write_readme()
    write_sample_md()
    write_raw_reference_copy()
    print(OUT)


if __name__ == "__main__":
    main()
