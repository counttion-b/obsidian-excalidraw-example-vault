from __future__ import annotations

import re
import shutil
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag


ROOT = Path(r"D:\obrepo\papers\教研\各季度讲义\高二秋")


class Converter:
    def __init__(self, html_path: Path) -> None:
        self.html_path = html_path
        self.lesson_no, self.lesson_title = lesson_from_html_path(html_path)
        self.html_assets = ROOT / f"{html_path.stem}_files"
        self.out_assets = ROOT / "assets" / html_path.stem
        self.out_md = ROOT / f"第{self.lesson_no}讲 {self.lesson_title}_知识点_v2.md"
        self.soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="ignore"), "html.parser")
        self.image_index = 0
        self.parts: list[str] = [
            f"# 第{self.lesson_no}讲{self.lesson_title} #h0",
            "# 知识讲解",
        ]
        self.question_counters: dict[str, int] = {}
        self.in_notes = False
        self.note_heading_index = 1
        self.current_level = 0
        self.current_level_sub_index = 0
        self.out_assets.mkdir(parents=True, exist_ok=True)

    def convert(self) -> None:
        current_section = ""
        for block in self.soup.select("div.tool-edit"):
            if self.is_title(block):
                title, level = self.convert_title(block)
                if not title:
                    continue
                current_section = title
                if title.startswith("1级：") and "# 题目练习" not in self.parts:
                    self.parts.append("# 题目练习")
                formatted = self.format_title(title, level)
                if formatted:
                    self.parts.append(formatted)
                continue

            desc = block.select_one("div.desc-content")
            if desc:
                md = self.convert_desc(desc)
                if md:
                    self.parts.append(md)
                continue

            qmain = block.select_one("div.question-main")
            if qmain:
                md = self.convert_question(qmain, current_section)
                if md:
                    self.parts.append(md)

        self.out_md.write_text("\n\n".join(p.strip() for p in self.parts if p.strip()) + "\n", encoding="utf-8")

    def format_title(self, title: str, level: int) -> str:
        title = normalize_title(title)

        if title == "本讲考情分析":
            return "### 0.1. 本讲考情分析"

        if title == "笔记整理":
            self.in_notes = True
            self.note_heading_index = 1
            return '### 1. 笔记整理\n\n<div class="page-break" style="page-break-before: always;"></div>'

        level_match = re.match(r"^(\d+)级：(.+)$", title)
        if level_match:
            self.in_notes = False
            self.current_level = int(level_match.group(1))
            self.current_level_sub_index = 0
            return f"## {self.current_level}. {title}"

        if title.startswith("考点 "):
            self.current_level_sub_index = 1
            return f"### {self.current_level}.{self.current_level_sub_index}. {title}"

        if title == "经典练习":
            self.current_level_sub_index = 2
            return f"### {self.current_level}.{self.current_level_sub_index}. 典中典"

        if title == "方法解析":
            self.current_level_sub_index = 3
            return f"### {self.current_level}.{self.current_level_sub_index}. 思路分析"

        if title == "锦囊总结":
            self.current_level_sub_index = 4
            return f"### {self.current_level}.{self.current_level_sub_index}. 规律总结"

        if title.startswith("真题练习"):
            self.current_level_sub_index += 1
            return f"### {self.current_level}.{self.current_level_sub_index}. {title}"

        if title == "挑战进阶" and self.current_level:
            self.current_level_sub_index += 1
            return f"### {self.current_level}.{self.current_level_sub_index}. 挑战进阶"

        if self.in_notes and level == 2:
            self.note_heading_index += 1
            return f"## {self.note_heading_index}. {title}"

        return "#" * level + " " + title

    def is_title(self, block: Tag) -> bool:
        return block.select_one("section.title-common") is not None

    def convert_title(self, block: Tag) -> tuple[str, int]:
        sec = block.select_one("section.title-common")
        if not sec:
            return "", 2
        span = sec.select_one(".text-title-cont span") or sec.select_one(".caption-text span")
        title = clean_text(span.get_text(" ", strip=True) if span else sec.get_text(" ", strip=True))
        title = title.replace("插入空白", "").replace("插入分页", "").strip()

        classes = sec.get("class", [])
        if "title-h1" in classes:
            level = 2
        elif "title-h2" in classes:
            level = 2
        elif "title-h3" in classes:
            level = 3
        elif "title-h4" in classes:
            level = 3
        else:
            level = 3
        return title, level

    def convert_desc(self, desc: Tag) -> str:
        desc = clone_without_noise(desc)
        if desc.find("table"):
            items: list[str] = []
            for child in desc.children:
                if isinstance(child, Tag) and child.name == "table":
                    items.append(self.table_to_md(child))
                else:
                    txt = self.block_to_md(child)
                    if txt:
                        items.append(txt)
            return "\n\n".join(items)

        lines: list[str] = []
        for child in desc.children:
            md = self.block_to_md(child)
            if md:
                lines.append(md)
        return "\n\n".join(lines)

    def convert_question(self, qmain: Tag, current_section: str) -> str:
        qconts = qmain.find_all("div", class_=lambda c: c and "question-cont" in c.split())
        if not qconts:
            return ""

        number = self.get_display_question_number(current_section, self.get_order_num(qconts[0]))
        source = self.get_source(qconts[0])
        chunks: list[str] = []
        if current_section.startswith("真题练习") or current_section == "挑战进阶":
            chunks.append(f"###### {number}")
        elif current_section == "经典练习":
            pass
        elif number:
            chunks.append(f"###### {number}")

        chunks.append(f"> [!ti] *{source or '例题'}*")

        for idx, qcont in enumerate(qconts):
            order = self.get_order_num(qcont)
            stem_wrap = direct_child_with_class(qcont, "stem-cont")
            stem = stem_wrap.select_one("div[id^='queContent_']") if stem_wrap else None
            if stem:
                stem_md = self.convert_inline_block(stem)
                if stem_md:
                    if idx > 0 and order:
                        chunks.append(">")
                        stem_md = f"（{order}）{stem_md}"
                    chunks.extend(prefix_quote(stem_md).splitlines())

            opts = self.convert_options(qcont)
            if opts:
                chunks.extend(prefix_quote(opts, nested=True).splitlines())

        return "\n".join(chunks)

    def get_display_question_number(self, section: str, fallback: str) -> str:
        if section.startswith("真题练习") or section == "挑战进阶":
            self.question_counters[section] = self.question_counters.get(section, 0) + 1
            return str(self.question_counters[section])
        return fallback

    def get_order_num(self, qcont: Tag) -> str:
        node = qcont.select_one(".order-num")
        text = clean_text(node.get_text(" ", strip=True) if node else "")
        return text.strip("()") if text else ""

    def get_source(self, qcont: Tag) -> str:
        links = [clean_text(a.get_text(" ", strip=True)) for a in qcont.select(".dropdown-menu a")]
        links = [x for x in links if x and "共" not in x]
        if links:
            # Keep Beijing source when it is one of the known aliases; this matches the PDF pages better.
            for item in links:
                if "北京" in item:
                    return item
            return links[0]
        btn = qcont.select_one(".dropdown-toggle")
        if btn:
            return clean_text(btn.get_text(" ", strip=True)).replace("共", "").strip()
        return ""

    def convert_options(self, qcont: Tag) -> str:
        opt = direct_child_with_class(qcont, "option-cont")
        if not opt:
            return ""
        option_rows: list[tuple[str, str]] = []
        has_image = False
        for li in opt.select("li"):
            label = clean_text(li.select_one(".opt-num").get_text(" ", strip=True) if li.select_one(".opt-num") else "")
            cont = li.select_one(".opt-cont")
            text = self.convert_inline_block(cont) if cont else clean_text(li.get_text(" ", strip=True))
            text = text.replace(label, "", 1).strip() if label else text
            has_image = has_image or "![[assets/" in text
            option_rows.append((label, text))
        mode = self.option_mode(option_rows, has_image)
        lines = [f"[!opts{mode}]"]
        for label, text in option_rows:
            lines.append(f"- {label} {text}".strip())
        return "\n".join(lines)

    def option_mode(self, option_rows: list[tuple[str, str]], has_image: bool) -> int:
        if has_image:
            return 1
        if not option_rows:
            return 1

        lengths = [option_visual_length(text) for _, text in option_rows]
        max_len = max(lengths)
        avg_len = sum(lengths) / len(lengths)
        formula_count = sum(text.count("$") // 2 for _, text in option_rows)

        if max_len <= 10 and avg_len <= 8 and formula_count <= len(option_rows):
            return 4
        if max_len <= 24 and avg_len <= 18:
            return 2
        return 1

    def block_to_md(self, node) -> str:
        if isinstance(node, NavigableString):
            return clean_text(str(node))
        if not isinstance(node, Tag):
            return ""
        if node.name in {"style", "script"}:
            return ""
        if node.name == "p":
            return self.convert_inline_block(node)
        if node.name == "table":
            return self.table_to_md(node)
        if node.name == "img":
            return self.copy_image(node)
        if node.name in {"div", "span"}:
            if "mindmap-content" in node.get("class", []):
                img = node.find("img")
                return self.copy_image(img) if img else ""
            return self.convert_inline_block(node)
        return self.convert_inline_block(node)

    def convert_inline_block(self, node: Tag | None) -> str:
        if node is None:
            return ""
        pieces: list[str] = []
        for child in node.children:
            pieces.append(self.inline_to_md(child))
        return clean_markdown_line("".join(pieces))

    def inline_to_md(self, node) -> str:
        if isinstance(node, NavigableString):
            return str(node)
        if not isinstance(node, Tag):
            return ""

        classes = node.get("class", [])
        if "MathJax_Preview" in classes or "MathJax_SVG" in classes or "MathJax_SVG_Display" in classes:
            return ""
        if node.name == "script" and (node.get("type") or "").startswith("math/tex"):
            tex = node.get_text(strip=True)
            return f"${tex}$"
        if node.name == "img":
            return "\n" + self.copy_image(node) + "\n"
        if node.name in {"sub", "sup"}:
            text = self.convert_inline_block(node)
            return f"_{{{text}}}" if node.name == "sub" else f"^{{{text}}}"
        if node.name in {"em", "i"}:
            text = self.convert_inline_block(node)
            return f"${text}$" if re.fullmatch(r"[A-Za-zα-ωΑ-Ω]+", text) else text
        if node.name in {"strong", "b"}:
            return f"**{self.convert_inline_block(node)}**"
        if node.name == "br":
            return "\n"
        return "".join(self.inline_to_md(c) for c in node.children)

    def table_to_md(self, table: Tag) -> str:
        rows: list[list[str]] = []
        for tr in table.select("tr"):
            cells = tr.find_all(["th", "td"], recursive=False)
            if not cells:
                continue
            rows.append([clean_markdown_line(self.convert_inline_block(c)).replace("\n", "<br>") for c in cells])
        if not rows:
            return ""
        if len(rows[0]) >= 4 and "级别" in rows[0][0] and "题型" in rows[0][2]:
            rows[0][2] = rows[0][2].replace("题型", "难度")
            for row in rows[1:]:
                if len(row) >= 3:
                    row[2] = str(self.difficulty_for_level(row[0]))
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        out = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
        for row in rows[1:]:
            out.append("| " + " | ".join(row) + " |")
        return "\n".join(out)

    def difficulty_for_level(self, level_text: str) -> int:
        level_match = re.search(r"(\d+)级", level_text)
        level = int(level_match.group(1)) if level_match else 1
        if self.lesson_no == 1:
            return {1: 2, 2: 2, 3: 3, 4: 2, 5: 4}.get(level, level)
        return level

    def copy_image(self, img: Tag | None) -> str:
        if img is None:
            return ""
        src = img.get("src") or ""
        if not src or src.startswith("data:"):
            return ""
        filename = Path(src).name
        source = self.html_assets / filename
        if not source.exists():
            return ""
        self.image_index += 1
        suffix = source.suffix or ".png"
        dest_name = f"l{self.lesson_no:02d}-img-{self.image_index:03d}{suffix}"
        dest = self.out_assets / dest_name
        shutil.copy2(source, dest)
        width = img.get("width") or img.get("data-mindmap-width") or ""
        width = re.sub(r"px$", "", str(width)).strip()
        width = width if width and width != "None" else "300"
        return f"![[assets/{self.html_path.stem}/{dest_name}|{width}]]"


def clone_without_noise(tag: Tag) -> Tag:
    html = str(tag)
    soup = BeautifulSoup(html, "html.parser")
    for noisy in soup.select(".operate-bar, .operate-cont-next, .MathJax_SVG, .MathJax_Preview"):
        noisy.decompose()
    return soup.find()


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_markdown_line(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +([，。；：、）])", r"\1", text)
    text = re.sub(r"([（]) +", r"\1", text)
    text = re.sub(r"\$([A-Za-zΑ-Ωα-ω])\$_\{([^}]+)\}", r"$\1_{\2}$", text)
    text = re.sub(r"\$\{\{([A-Za-z])\}_\{([^}]+)\}\}\$", r"$\1_{\2}$", text)
    text = re.sub(r"\$\{\{\\alpha \}_\{([^}]+)\}\}\$", r"$\\alpha_{\1}$", text)
    text = re.sub(r"\$\{\{\\beta \}_\{([^}]+)\}\}\$", r"$\\beta_{\1}$", text)
    return text.strip()


def option_visual_length(text: str) -> int:
    compact = re.sub(r"!\[\[[^\]]+\]\]", "图", text)
    compact = re.sub(r"\$([^$]+)\$", lambda m: formula_visual_text(m.group(1)), compact)
    compact = re.sub(r"\s+", "", compact)
    return len(compact)


def formula_visual_text(tex: str) -> str:
    tex = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2", tex)
    tex = re.sub(r"\{\{([^{}]+)\}\}", r"\1", tex)
    tex = re.sub(r"\\(?:text|mathrm)\{([^{}]+)\}", r"\1", tex)
    tex = re.sub(r"\\[a-zA-Z]+", "x", tex)
    tex = re.sub(r"[{}\\]", "", tex)
    return tex


def normalize_title(title: str) -> str:
    title = clean_text(title)
    title = re.sub(r"考点(\d+)", r"考点 \1", title)
    title = re.sub(r"真题练习(\d+)", r"真题练习 \1", title)
    return title


def direct_child_with_class(tag: Tag, class_name: str) -> Tag | None:
    for child in tag.find_all("div", recursive=False):
        classes = child.get("class", [])
        if class_name in classes:
            return child
    return None


def lesson_from_html_path(path: Path) -> tuple[int, str]:
    match = re.match(r"^(\d+)-(.+)$", path.stem)
    if not match:
        raise ValueError(f"Cannot parse lesson number/title from {path.name}")
    return int(match.group(1)), match.group(2)


def prefix_quote(md: str, nested: bool = False) -> str:
    prefix = "> > " if nested else "> "
    return "\n".join(prefix + line if line else ">" for line in md.splitlines())


def main() -> None:
    outputs: list[Path] = []
    for html_path in sorted(ROOT.glob("*.html")):
        converter = Converter(html_path)
        converter.convert()
        outputs.append(converter.out_md)
        print(f"{html_path.name} -> {converter.out_md.name}")
    print(f"converted {len(outputs)} lessons")


if __name__ == "__main__":
    main()
