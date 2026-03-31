# -*- coding: utf-8 -*-
"""从培优 HTML 讲义中提取：前半部分知识点 + 后半部分分级练习题。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

SKIP_TITLE_EXACT = frozenset({"本讲考情分析", "笔记整理", "方法解析", "锦囊总结"})


def title_to_mode(title: str) -> str:
    t = title.strip()
    if t in SKIP_TITLE_EXACT:
        return "skip"
    if t == "经典练习":
        return "exercise"
    if t == "挑战进阶":
        return "challenge"
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
    raw = span.get_text(strip=True)
    if not raw:
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
    return raw, level


def image_to_md(node: Tag) -> str:
    src = (node.get("src") or node.get("data-src") or "").strip()
    if not src:
        return ""
    return f"![[{src.lstrip('./')}|300]]"


def node_text(elem: Tag) -> str:
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
        if node.name in (
            "p",
            "div",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "td",
            "th",
            "tr",
            "table",
            "figure",
            "ul",
            "ol",
        ):
            if text.strip():
                return [text.rstrip() + "\n"]
            return ["\n"] if node.name == "tr" else []

        return [text]

    return "".join(walk(elem))


def normalize_ws(s: str) -> str:
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def clean_question_text(s: str) -> str:
    s = normalize_ws(s)
    s = re.sub(r"^[（(]\s*\d+\s*分\s*[)）]\s*", "", s)
    s = re.sub(r"[（(]\s*\d+\s*分\s*[)）]\s*$", "", s)
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


def select_source(raw_source: str) -> str:
    raw = normalize_ws(raw_source)
    if not raw:
        return "例题"

    raw = re.sub(r"共\d+个", " ", raw)
    raw = normalize_ws(raw)

    starts = [m.start() for m in re.finditer(r"(?:19|20)\d{2}", raw)]
    candidates: list[str] = []
    if len(starts) <= 1:
        candidates = [raw]
    else:
        for i, st in enumerate(starts):
            ed = starts[i + 1] if i + 1 < len(starts) else len(raw)
            seg = normalize_ws(raw[st:ed])
            if seg:
                candidates.append(seg)

    if not candidates:
        candidates = [raw]

    uniq: list[str] = []
    for c in candidates:
        if c and c not in uniq:
            uniq.append(c)
    candidates = uniq or [raw]

    def year_key(s: str) -> int:
        years = [int(x) for x in re.findall(r"(?:19|20)\d{2}", s)]
        return max(years) if years else -1

    gaokao = [c for c in candidates if "高考" in c]
    if gaokao:
        return max(gaokao, key=year_key)

    beijing = [c for c in candidates if "北京" in c]
    if beijing:
        return max(beijing, key=year_key)

    return max(candidates, key=year_key)


def extract_question(block: Tag, q_index: int) -> list[str]:
    q = block.select_one("div.question-cont")
    if not q:
        return []

    source = ""
    for node in q.select("div.source-cont, span.source-tap"):
        txt = normalize_ws(node.get_text(" ", strip=True))
        if txt:
            source = txt
            break
    source = select_source(source)

    stem = q.select_one("div.stem-cont")
    stem_text = clean_question_text(node_text(stem)) if stem else ""

    lines: list[str] = [f"> [!ti] *{source}*"]
    if stem_text:
        for ln in stem_text.split("\n"):
            ln = ln.strip()
            if ln:
                lines.append(f"> {ln}")

    options: list[tuple[str, str]] = []
    for ul in q.select("div.option-cont > ul"):
        num = ul.select_one("span.opt-num")
        cont = ul.select_one("div.opt-cont")
        if not num or not cont:
            continue
        label = normalize_ws(num.get_text(" ", strip=True))
        text = clean_question_text(node_text(cont))
        if text:
            options.append((label, text.replace("\n", " ")))

    if options:
        lines.append(f"> > [!opts{q_index}]")
        for label, text in options:
            lines.append(f"> > - {label} {text}")

    lines.append("")
    return lines


def extract_to_md(src: Path) -> Path:
    html = src.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    doc_title = (soup.title.string or src.stem).strip() if soup.title else src.stem

    knowledge_lines: list[str] = [f"# {doc_title} #h0", "# 知识讲解", ""]
    questions_by_level: list[tuple[str, list[list[str]]]] = []

    mode = "knowledge"
    last_knowledge_title: tuple[str, int, str] | None = None
    heading_emitted = False
    chapter_h2: str | None = None
    chapter_h2_emitted = False
    current_level = "未分级"

    for block in soup.select("div.tool-edit"):
        title_raw, hlevel = extract_title_from_tool_edit(block)
        if title_raw:
            title = strip_heading_serial(title_raw) or title_raw
            mode = title_to_mode(title_raw)

            if is_level_syllabus_title(title_raw):
                current_level = title_raw.strip()
                if not any(lv == current_level for lv, _ in questions_by_level):
                    questions_by_level.append((current_level, []))
                last_knowledge_title = None
                heading_emitted = False
                continue

            if mode == "skip":
                last_knowledge_title = None
                heading_emitted = False
                continue

            if hlevel == 2 and mode == "knowledge":
                chapter_h2 = title
                chapter_h2_emitted = False

            if mode == "knowledge":
                last_knowledge_title = (title, hlevel, mode)
                heading_emitted = False
            else:
                last_knowledge_title = None
                heading_emitted = False
            continue

        qcont = block.select_one("div.question-cont")
        if qcont and mode in {"exercise", "challenge"}:
            if not any(lv == current_level for lv, _ in questions_by_level):
                questions_by_level.append((current_level, []))
            for lv, arr in questions_by_level:
                if lv == current_level:
                    arr.append([])
                    q_lines = extract_question(block, len(arr))
                    arr[-1] = q_lines
                    break
            continue

        if not last_knowledge_title:
            continue

        t, hlevel, _ = last_knowledge_title
        desc = block.select_one("div.desc-content")
        if not desc:
            continue
        if desc_is_exercise_stem(desc):
            continue

        text = normalize_ws(node_text(desc))
        if is_exam_scope_only(text):
            continue

        if not heading_emitted:
            if hlevel >= 3 and chapter_h2 and not chapter_h2_emitted:
                knowledge_lines.append(f"## {chapter_h2}")
                knowledge_lines.append("")
                chapter_h2_emitted = True
            hashes = "#" * hlevel
            knowledge_lines.append(f"{hashes} {t}")
            knowledge_lines.append("")
            if hlevel == 2:
                chapter_h2_emitted = True
            heading_emitted = True

        knowledge_lines.append(text)
        knowledge_lines.append("")

    lines = knowledge_lines[:]

    has_questions = any(items for _, items in questions_by_level)
    if has_questions:
        lines.append("# 题目练习")
        lines.append("")
        for level, items in questions_by_level:
            if not items:
                continue
            lines.append(f"## {level}")
            lines.append("")
            for qlines in items:
                lines.extend(qlines)

    while lines and not lines[-1].strip():
        lines.pop()
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
        paths = sorted(base.glob("第*讲*.html"))

    for src in paths:
        if not src.exists():
            print(f"Skip (not found): {src}")
            continue
        extract_to_md(src)


if __name__ == "__main__":
    main()
