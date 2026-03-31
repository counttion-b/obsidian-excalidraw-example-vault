# -*- coding: utf-8 -*-
"""从培优 HTML 讲义中提取知识点，生成 Markdown（排除大纲、习题、锦囊总结等）。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

SKIP_MODES = frozenset({"skip_misc", "exercise", "solution", "challenge", "tips"})
SKIP_TITLE_EXACT = frozenset({"本讲考情分析", "笔记整理"})


def title_to_mode(title: str) -> str:
    t = title.strip()
    if t in SKIP_TITLE_EXACT:
        return "skip_misc"
    if t == "经典练习":
        return "exercise"
    if t == "方法解析":
        return "solution"
    if t == "挑战进阶":
        return "challenge"
    if t == "锦囊总结":
        return "tips"
    return "knowledge"


def is_level_syllabus_title(title: str) -> bool:
    return bool(re.match(r"^\d+级：", title.strip()))


def strip_heading_serial(title: str) -> str:
    t = title.strip()
    patterns = [
        r"^第[一二三四五六七八九十百千\d]+[章节讲部分节]\s*",
        r"^\d+(?:\.\d+)*[\.、\s]+",
        r"^[（(][一二三四五六七八九十百千\d]+[)）][、\s]*",
        r"^[一二三四五六七八九十百千]+[、.．\s]+",
    ]
    for p in patterns:
        t = re.sub(p, "", t)
    return t.strip()


def extract_title_from_tool_edit(block: Tag) -> tuple[str | None, int]:
    sec = block.select_one("section.title-common")
    if not sec:
        return None, 0
    span = sec.select_one(".text-title-cont span")
    if not span:
        return None, 0
    t = strip_heading_serial(span.get_text(strip=True)) or span.get_text(strip=True)
    if not t:
        return None, 0
    classes = sec.get("class", [])
    if "title-h4" in classes:
        level = 4
    elif "title-h3" in classes:
        level = 3
    elif "title-h2" in classes:
        level = 2
    else:
        level = 2
    return t, level


def image_to_md(node: Tag) -> str:
    src = (node.get("src") or node.get("data-src") or "").strip()
    if not src:
        return ""
    alt = (node.get("alt") or "").strip()
    return f"![{alt}]({src}|300)"


def block_text(elem: Tag) -> str:
    def walk(node: Tag | NavigableString) -> list[str]:
        if isinstance(node, NavigableString):
            s = str(node)
            return [s] if s else []

        if not isinstance(node, Tag):
            return []

        if node.name == "script" and node.get("type", "").startswith("math/tex"):
            tex = (node.string or node.get_text() or "").strip()
            return [f"${tex}$"] if tex else []

        if node.name in ("svg", "style", "script"):
            return []

        if node.name == "img":
            img_md = image_to_md(node)
            return [f"\n{img_md}\n"] if img_md else []

        if node.name == "br":
            return ["\n"]

        parts: list[str] = []
        for child in node.children:
            parts.extend(walk(child))

        text = "".join(parts)

        if node.name in ("p", "div", "li", "h1", "h2", "h3", "h4", "td", "th", "tr", "table", "figure"):
            if text.strip():
                return [text.rstrip() + "\n"]
            return ["\n"] if node.name == "tr" else []

        return [text]

    raw = "".join(walk(elem))
    return raw


def normalize_ws(s: str) -> str:
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def desc_is_exercise_stem(div: Tag) -> bool:
    html = str(div)
    if "ckeCustomFillContext" in html or 'data-widget="qchoice"' in html:
        return True
    text = div.get_text("\n", strip=True)
    if len(text) >= 2 and text[0] in "ABCDＡＢＣＤ" and text[1] in ".．、":
        return True
    if "下列说法正确" in text or "下列说法错误" in text:
        return True
    return False


def is_exam_scope_only(text: str) -> bool:
    t = text.strip()
    if not t:
        return True
    if t.startswith("考察") and len(t) < 400:
        return True
    return False


def extract_knowledge_to_md(src: Path) -> Path | None:
    """读取 HTML，在同目录生成 `{stem}_知识点.md`。无有效内容时仍写出文件。"""
    html = src.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    doc_title = (soup.title.string or src.stem).strip() if soup.title else src.stem

    mode = "knowledge"
    lines: list[str] = [f"# {doc_title}", ""]
    last_title: tuple[str, int, str] | None = None
    heading_emitted = False
    chapter_h2: str | None = None
    chapter_h2_emitted = False

    for block in soup.select("div.tool-edit"):
        title, hlevel = extract_title_from_tool_edit(block)
        if title:
            mode = title_to_mode(title)
            if title in SKIP_TITLE_EXACT:
                mode = "skip_misc"
            elif title == "经典练习":
                mode = "exercise"
            elif title == "方法解析":
                mode = "solution"
            elif title == "挑战进阶":
                mode = "challenge"
            elif title == "锦囊总结":
                mode = "tips"

            if mode in SKIP_MODES or mode == "skip_misc":
                last_title = None
                heading_emitted = False
                continue

            if is_level_syllabus_title(title):
                last_title = None
                heading_emitted = False
                continue

            if hlevel == 2:
                chapter_h2 = title
                chapter_h2_emitted = False

            last_title = (title, hlevel, mode)
            heading_emitted = False
            continue

        if not last_title:
            continue
        t, hlevel, m = last_title
        if m in SKIP_MODES or m == "skip_misc":
            continue

        desc = block.select_one("div.desc-content")
        if not desc:
            continue
        if desc_is_exercise_stem(desc):
            continue

        text = block_text(desc)
        text = normalize_ws(text)
        if is_exam_scope_only(text):
            continue

        if not heading_emitted:
            if hlevel >= 3 and chapter_h2 and not chapter_h2_emitted:
                lines.append(f"## {chapter_h2}")
                lines.append("")
                chapter_h2_emitted = True
            hashes = "#" * hlevel
            lines.append(f"{hashes} {t}")
            lines.append("")
            if hlevel == 2:
                chapter_h2_emitted = True
            heading_emitted = True

        lines.append(text)
        lines.append("")

    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)

    final = "\n".join(lines)
    final = re.sub(r"\n{3,}", "\n\n", final).strip() + "\n"
    out = src.with_name(f"{src.stem}_知识点.md")
    out.write_text(final, encoding="utf-8")
    print(f"Wrote {out.name} ({len(final)} chars)")
    return out


def main() -> None:
    base = Path(__file__).resolve().parent
    if len(sys.argv) > 1:
        paths = [Path(p) if Path(p).is_absolute() else base / p for p in sys.argv[1:]]
    else:
        paths = sorted(p for p in base.glob("*.html") if p.name != "saved_resource.html")

    for src in paths:
        if not src.exists():
            print(f"Skip (not found): {src}")
            continue
        extract_knowledge_to_md(src)


if __name__ == "__main__":
    main()
