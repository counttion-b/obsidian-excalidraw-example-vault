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
            f"# 第{self.lesson_no}讲 {self.lesson_title} #h0",
            "# 知识讲解",
        ]
        self.question_counters: dict[str, int] = {}
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
                self.parts.append("#" * level + " " + normalize_title(title))
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
        mode = "opts"
        for cls in opt.get("class", []):
            if cls.startswith("option-mode"):
                mode = "opts" + cls.replace("option-mode", "")
        lines = [f"[!{mode}]"]
        for li in opt.select("li"):
            label = clean_text(li.select_one(".opt-num").get_text(" ", strip=True) if li.select_one(".opt-num") else "")
            cont = li.select_one(".opt-cont")
            text = self.convert_inline_block(cont) if cont else clean_text(li.get_text(" ", strip=True))
            text = text.replace(label, "", 1).strip() if label else text
            lines.append(f"- {label} {text}".strip())
        return "\n".join(lines)

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
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        out = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
        for row in rows[1:]:
            out.append("| " + " | ".join(row) + " |")
        return "\n".join(out)

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
