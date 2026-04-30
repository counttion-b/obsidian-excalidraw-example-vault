# Obsidian 个人题库

这是一个轻量级个人题库项目，适合积累几百道高质量题目。题库本身就是 Markdown 文件，可以直接作为 Obsidian vault 打开。

## 目录

- `questions/`：每道题一个 Markdown 文件。
- `attachments/`：题目图片等附件。
- `exports/`：筛选后生成的学生版、答案版、详解版。
- `templates/question_template.md`：手动录题模板。
- `bank_tool.py`：题库工具。

## 题目格式

每道题都用统一 front matter，方便筛选：

```markdown
---
title: "2025~2026学年北京东城区北京市第五十五中学高一上学期期中第3题"
subject: "物理"
question_type: "选择题"
tags:
  - "物理"
  - "选择题"
  - "动量"
  - "动量定理"
  - "图像"
  - "2025-2026学年"
  - "北京"
  - "东城区"
  - "北京市第五十五中学"
  - "高一"
  - "上学期"
  - "期中"
sources:
  - name: "2025~2026学年北京东城区北京市第五十五中学高一上学期期中第3题"
    provider: "手动录入"
    school_year: "2025~2026"
    province: "北京"
    city: "北京"
    area: "东城区"
    school: "北京市第五十五中学"
    grade: "高一"
    semester: "上学期"
    exam_type: "期中"
    question_index: "3"
---

# 题目标题

## 题目来源

## 标签

## 题目

## 答案

## 详解
```

## 新建题目

```bat
E:\anaconda\python.exe bank_tool.py new --title "一道新题"
```

它会在 `questions/` 里生成一个题目模板。

## 从 OCR 项目导入

把 `ocr_qbank_finder/output` 里的题目导入到本题库：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" import --from "F:\BaiduSyncdisk\projects\ocr_qbank_finder\output"
```

工具会导入匹配成功的 `result.md`，并把图片复制到 `attachments/`。

运行 `start_jiaoyanyun.bat` 时可以输入本次试卷出处，例如 `2025~2026学年北京第五十五中高一下期中`。这个出处会作为每道题的第一来源，教研云搜到的其他来源会排在后面；同时会自动生成学年、地区、学校、年级、考试类型等标签。

如果 `input/` 中放的是整页试卷图片，启动时选择自动切题即可。程序会按横向空白区域把整页图片切成若干小题后逐题 OCR。这个功能适合竖向排版清楚、题与题之间有明显空白的试卷；如果版面很复杂，仍建议先手动截图成单题。

如果题目里有远程图片链接，例如选择题的 A/B/C/D 选项本身都是图片，导入时也会自动下载到 `attachments/`。已经导入过的旧题可以单独修复图片：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" fix-images
```

复合实验题、填空和选择混合的小题会保留在同一道 md 中，子题按 `(1)`、`(2)` 这样的编号写入题干、选项、答案和详解。

## 筛选

多个条件会同时生效。比如筛选“高一、上学期、期中、五十五中、动量”：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" list --tag 高一 --tag 上学期 --tag 期中 --tag 动量 --source 五十五中
```

也可以按结构化来源字段筛选：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" list --grade 高一 --semester 上学期 --exam 期中 --school 五十五中
```

## Obsidian 筛选界面

题库附带一个本地 Obsidian 插件：`个人题库筛选`。

在 Obsidian 里打开命令面板，运行：

```text
打开题库筛选
```

界面会读取 `questions/` 中的所有题目：

- 点选多个标签后，只展示同时符合这些标签的题。
- 题目默认展开，答案和详解默认折叠。
- 每道题只在标题下显示一个最优来源，全部来源折叠在卡片底部。
- 来源优先级为：高考真题 > 近年北京名校题 > 近年北京题 > 久远北京题 > 外地题。
- 可以用顶部搜索框搜索题干、标题和来源。
- 题目卡片右上角的加号按钮可以把题目链接插入到当前 md。

在任意 md 中放入题目链接后，可以用命令面板导出：

```text
导出当前选题为学生版
导出当前选题为答案版
导出当前选题为详解版
```

例如当前 md 写着：

```markdown
[[题库/questions/2024~2025学年北京西城区西城外国语学校高一下学期期中第8题.md|圆盘茶杯题]]
[[题库/questions/2023~2024学年北京海淀区中国人民大学附属中学高一上学期期末第2题3分.md|风带小球题]]
```

导出时会按链接出现的顺序生成文件到 `题库/exports/`。

## 生成讲义

学生版，只有题目：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" export --mode student --tag 高一 --tag 期中 --out exports\高一期中学生版.md
```

答案版，只有答案：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" export --mode answer --tag 高一 --tag 期中 --out exports\高一期中答案版.md
```

详解版，有题目、答案和详解：

```bat
E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" export --mode detail --tag 高一 --tag 期中 --out exports\高一期中详解版.md
```

## 筛选规则

- `--tag`：要求题目包含这个标签，可重复使用。
- `--any-tag`：只要命中其中一个标签即可，可重复使用。
- `--source`：在所有来源名称里搜索文字，例如 `五十五中`。
- `--school`：按来源里的学校筛选。
- `--year`：按学年筛选，例如 `2025~2026`。
- `--grade`：按年级筛选，例如 `高一`。
- `--semester`：按学期筛选，例如 `上学期`。
- `--exam`：按考试类型筛选，例如 `期中`。
- `--knowledge`：按知识标签筛选，例如 `动量定理`。
- `--contains`：在题干、答案、详解里全文搜索。

几个筛选条件同时写时，默认是“都要满足”。

## Obsidian 标签注意

Obsidian 标签不要使用 `~`。例如标签请写成：

```yaml
tags:
  - "2025-2026学年"
```

来源字段里可以保留原始写法：

```yaml
school_year: "2025~2026"
```

题目正文中的 LaTeX 统一使用行内公式 `$...$`，例如 `$\\mu mg = m\\omega^2r$`。
