#!/usr/bin/env python
"""Convert a downloaded lecture HTML page into the local Obsidian question format.

Usage:
    python tools/convert_lecture_html_to_md.py "01-常见力和计算.html"
    python tools/convert_lecture_html_to_md.py input.html -o output.md --title "标题"

The converter keeps knowledge-point fill blanks as numbered blanks, writes the
blank answers before the questions, preserves local images, extracts question
sources into [!ti], and keeps option column counts as [!opts1]/[!opts2]/...
"""

from __future__ import annotations

import argparse
import copy
import re
from pathlib import Path
from urllib.parse import unquote

from lxml import etree, html


SKIP_CLASSES = (
    "MathJax_Preview",
    "MathJax_SVG",
    "operate-bar",
    "operate-cont-next",
    "analyze-cont",
)


class LectureConverter:
    def __init__(self, html_path: Path, output_path: Path | None, title: str | None):
        self.html_path = html_path.resolve()
        self.base_dir = self.html_path.parent
        self.title = title or self.html_path.stem
        self.output_path = output_path or self.html_path.with_suffix(".md")
        self.image_folder = f"{self.html_path.stem}_files"
        self.blank_answers: list[str] = []

        root = html.fromstring(self.html_path.read_text(encoding="utf-8", errors="replace"))
        mains = root.xpath('//div[contains(@class,"cart-main")]')
        if not mains:
            raise RuntimeError("Could not find lecture body: div.cart-main")
        self.main = mains[0]

    @staticmethod
    def cls(el) -> str:
        return el.get("class") or ""

    @staticmethod
    def clean_ws(text: str) -> str:
        text = text.replace("\xa0", " ")
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r" *\n *", "\n", text)
        return text.strip()

    @staticmethod
    def normalize_image_widths(text: str) -> str:
        return re.sub(r"\|(\d+)px", r"|\1", text)

    def should_skip(self, el) -> bool:
        if any(name in self.cls(el) for name in SKIP_CLASSES):
            return True
        return el.tag in {"style", "noscript"}

    def image_markdown(self, el) -> str:
        src = unquote((el.get("src") or "").replace("\\", "/"))
        filename = src.split("/")[-1]
        width = el.get("width") or ""
        if not width:
            style = el.get("style") or ""
            match = re.search(r"width\s*:\s*(\d+)px", style)
            if match:
                width = match.group(1)
        alt = f"|{width}" if width else ""
        return f"![{alt}]({self.image_folder}/{filename})"

    def answer_text(self, fill_node) -> str:
        clone = copy.deepcopy(fill_node)
        for node in list(clone.iter()):
            if isinstance(node, etree._Comment) or not isinstance(node.tag, str):
                continue
            tag = node.tag.lower()
            if tag == "script":
                if "math/tex" in (node.get("type") or ""):
                    tex = self.clean_ws(node.text or "")
                    node.text = f"${tex}$" if tex else ""
                else:
                    node.text = ""
                continue
            if self.should_skip(node):
                parent = node.getparent()
                if parent is not None:
                    tail = node.tail or ""
                    previous = node.getprevious()
                    if previous is not None:
                        previous.tail = (previous.tail or "") + tail
                    else:
                        parent.text = (parent.text or "") + tail
                    parent.remove(node)
        return self.clean_ws(clone.text_content()) or "（空）"

    def blank_marker(self, fill_node, collect_answer: bool) -> str:
        if not collect_answer:
            return r"$\_\_\_\_$"
        self.blank_answers.append(self.answer_text(fill_node))
        return rf"$\_\_\_\_$（{len(self.blank_answers)}）"

    def inline_text(self, node, collect_answers: bool = False) -> str:
        if isinstance(node, etree._Comment) or not isinstance(node.tag, str):
            return ""
        if "ckeCustomFillContext" in self.cls(node):
            return self.blank_marker(node, collect_answers)
        if self.should_skip(node):
            return ""
        tag = node.tag.lower()
        if tag == "script":
            if "math/tex" in (node.get("type") or ""):
                tex = self.clean_ws(node.text or "")
                return f"${tex}$" if tex else ""
            return ""
        if tag == "img":
            return self.image_markdown(node)

        parts = []
        if node.text:
            parts.append(node.text)
        for child in node:
            parts.append(self.inline_text(child, collect_answers))
            if child.tail:
                parts.append(child.tail)

        text = "".join(parts)
        if tag in {"strong", "b"}:
            text = self.clean_ws(text)
            return f"**{text}**" if text else ""
        return text

    def linear_lines(self, element, collect_answers: bool = False) -> list[str]:
        clone = copy.deepcopy(element)
        for node in list(clone.iter()):
            if isinstance(node, etree._Comment) or not isinstance(node.tag, str):
                continue
            tag = node.tag.lower()
            class_name = self.cls(node)
            if "ckeCustomFillContext" in class_name:
                marker = self.blank_marker(node, collect_answers)
                node.tag = "span"
                node.attrib.clear()
                for child in list(node):
                    node.remove(child)
                node.text = marker
                continue
            if tag == "script":
                if "math/tex" in (node.get("type") or ""):
                    tex = self.clean_ws(node.text or "")
                    node.text = f"${tex}$" if tex else ""
                else:
                    node.text = ""
                continue
            if tag == "img":
                markdown = self.image_markdown(node)
                node.tag = "span"
                node.attrib.clear()
                node.text = " " + markdown + " "
                continue
            if self.should_skip(node):
                parent = node.getparent()
                if parent is not None:
                    tail = node.tail or ""
                    previous = node.getprevious()
                    if previous is not None:
                        previous.tail = (previous.tail or "") + tail
                    else:
                        parent.text = (parent.text or "") + tail
                    parent.remove(node)
                continue
            if tag in {"p", "div", "tr", "table", "ul", "ol", "li"}:
                node.tail = "\n" + (node.tail or "")
            elif tag == "br":
                node.tail = "\n" + (node.tail or "")
        text = self.normalize_image_widths(clone.text_content())
        lines = [self.clean_ws(line) for line in text.splitlines()]
        return [line for line in lines if line and line not in {"插入空白", "插入分页", "插入空白 插入分页"}]

    def block_lines(self, el, collect_answers: bool = False) -> list[str]:
        if isinstance(el, etree._Comment) or not isinstance(el.tag, str) or self.should_skip(el):
            return []
        tag = el.tag.lower()
        if tag == "script":
            text = self.inline_text(el, collect_answers)
            return [text] if text else []
        if tag == "img":
            return [self.image_markdown(el)]
        if tag == "table":
            rows = []
            for tr in el.xpath(".//tr"):
                cells = [self.clean_ws(self.inline_text(td, collect_answers)) for td in tr.xpath("./th|./td")]
                if cells:
                    rows.append(cells)
            if not rows:
                return []
            width = max(len(row) for row in rows)
            rows = [row + [""] * (width - len(row)) for row in rows]
            output = [
                "| " + " | ".join(rows[0]) + " |",
                "| " + " | ".join(["---"] * width) + " |",
            ]
            output.extend("| " + " | ".join(row) + " |" for row in rows[1:])
            return output
        if tag in {"ul", "ol"}:
            output = []
            for li in el.xpath("./li"):
                text = self.clean_ws(self.inline_text(li, collect_answers))
                if text:
                    output.append(f"- {text}")
            return output
        if tag == "p":
            text = self.clean_ws(self.inline_text(el, collect_answers))
            return [text] if text else []
        if tag == "div":
            child_blocks = []
            has_block_child = False
            for child in el:
                if isinstance(child.tag, str) and child.tag.lower() in {"p", "table", "ul", "ol", "div"} and not self.should_skip(child):
                    has_block_child = True
                    child_blocks.extend(self.block_lines(child, collect_answers))
            direct = self.clean_ws(self.inline_text(el, collect_answers))
            if has_block_child and child_blocks:
                return child_blocks
            return [direct] if direct else []
        text = self.clean_ws(self.inline_text(el, collect_answers))
        return [text] if text else []

    def desc_to_lines(self, desc, collect_answers: bool = False) -> list[str]:
        if not desc.xpath(".//table"):
            return self.linear_lines(desc, collect_answers)

        lines = []
        for child in desc:
            lines.extend(self.block_lines(child, collect_answers))
        cleaned = []
        for line in lines:
            line = self.clean_ws(line)
            if not line or line in {"插入空白", "插入分页", "插入空白 插入分页"}:
                continue
            line = line.replace("插入空白 插入分页", "").strip()
            if line:
                cleaned.append(line)
        return cleaned

    def source_for_question(self, qwrap) -> str:
        source_text = " ".join(qwrap.xpath('.//div[contains(@class,"source-container")]//text()'))
        source_text = self.clean_ws(source_text)
        if not source_text:
            return "例题"
        source_text = re.sub(r"^\d+\s*", "", source_text)
        source_text = re.sub(r"共\d+个.*$", "", source_text).strip()
        match = re.search(
            r"((?:20\d{2}(?:~20\d{2})?学年|20\d{2}年).*?(?:北京|北京市).*?(?:第\d+题|第[一二三四五六七八九十]+题))",
            source_text,
        )
        if match:
            return match.group(1).strip()
        match = re.search(r"((?:20\d{2}(?:~20\d{2})?学年|20\d{2}年).*?(?:第\d+题|第[一二三四五六七八九十]+题))", source_text)
        if match and "北京" in match.group(1):
            return match.group(1).strip()
        return "例题"

    def option_columns(self, qwrap) -> str:
        nodes = qwrap.xpath('.//div[contains(@class,"option-cont")]')
        if not nodes:
            return ""
        match = re.search(r"option-mode(\d+)", self.cls(nodes[0]))
        return match.group(1) if match else ""

    def question_to_lines(self, qwrap) -> list[str]:
        source = self.source_for_question(qwrap)
        stem_nodes = qwrap.xpath('.//div[starts-with(@id,"queContent_")]')
        stem_lines = self.desc_to_lines(stem_nodes[0], collect_answers=False) if stem_nodes else []
        output = [f"> [!ti] *{source}*"]
        output.extend(f"> {line}" for line in stem_lines)

        options = []
        for li in qwrap.xpath('.//div[contains(@class,"option-cont")]//li'):
            opt = self.clean_ws("".join(li.xpath('.//span[contains(@class,"opt-num")]/text()'))).rstrip(".")
            conts = li.xpath('.//div[contains(@class,"opt-cont")]')
            body_lines = self.desc_to_lines(conts[0], collect_answers=False) if conts else []
            body = " ".join(body_lines).strip()
            if opt and body:
                options.append((opt, body))
        if options:
            columns = self.option_columns(qwrap)
            output.append(f"> > [!opts{columns}]")
            output.extend(f"> > - {opt}. {body}" for opt, body in options)
        return output

    def append_structured_desc(self, target: list[str], desc_lines: list[str], in_questions: bool) -> bool:
        one_line = " ".join(desc_lines)
        if re.fullmatch(r"[一二三四五六七八九十]+、\s*.*", one_line):
            heading = re.sub(r"^[一二三四五六七八九十]+、\s*", "", one_line)
            if heading == "分类考点":
                return True
            target.extend(["", "# " + heading])
        elif re.fullmatch(r"\d+\.\s+.*", one_line):
            target.extend(["", "## " + re.sub(r"^\d+\.\s+", "", one_line)])
        elif re.fullmatch(r"(典型例题|自主练习)\d+", one_line):
            target.extend(["", "### " + one_line])
        elif len(desc_lines) == 1 and len(one_line) <= 30 and not re.search(r"[。；;，,：:]|\(|（", one_line):
            target.extend(["", "### " + one_line])
        else:
            target.append("")
            target.extend(desc_lines)
        return in_questions

    def compact_answer_line(self) -> str:
        return " ".join(f"{index}. {answer}；" for index, answer in enumerate(self.blank_answers, 1)).rstrip("；")

    @staticmethod
    def collapse_output(lines: list[str]) -> list[str]:
        output = []
        previous_blank = False
        previous_heading = ""
        for line in lines:
            if not line.strip():
                if not previous_blank:
                    output.append("")
                previous_blank = True
            else:
                current = line.rstrip()
                if current.startswith("## ") and current == previous_heading:
                    continue
                output.append(current)
                if current.startswith("#"):
                    previous_heading = current
                previous_blank = False
        return output

    def convert(self) -> tuple[int, int]:
        knowledge_lines = [f"# {self.title} #h0"]
        question_lines = []
        in_questions = False

        for child in self.main:
            if not isinstance(child.tag, str):
                continue
            class_name = self.cls(child)
            if "subject-head" in class_name or "water-mark" in class_name or "group-name" in class_name:
                continue
            if "tool-edit" not in class_name:
                continue

            question_nodes = child.xpath('.//div[contains(@class,"question-main")]')
            if question_nodes:
                question_lines.append("")
                question_lines.extend(self.question_to_lines(question_nodes[0]))
                continue

            desc_nodes = child.xpath('.//div[contains(@class,"desc-content")]')
            collect = not in_questions
            desc_lines = self.desc_to_lines(desc_nodes[0], collect_answers=collect) if desc_nodes else self.linear_lines(child, collect_answers=False)
            if not desc_lines:
                continue
            target = question_lines if in_questions else knowledge_lines
            in_questions = self.append_structured_desc(target, desc_lines, in_questions)

        answer_lines = ["", "# 知识点填空答案", self.compact_answer_line()]
        lines = knowledge_lines + answer_lines + ["", "# 题目"] + question_lines
        output = self.collapse_output(lines)
        self.output_path.write_text("\n".join(output).strip() + "\n", encoding="utf-8")
        return sum(1 for line in output if line.startswith("> [!ti]")), len(self.blank_answers)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a downloaded lecture HTML into Markdown.")
    parser.add_argument("html", type=Path, help="Downloaded HTML file")
    parser.add_argument("-o", "--output", type=Path, help="Output Markdown path")
    parser.add_argument("--title", help="Markdown title; defaults to the HTML file stem")
    args = parser.parse_args()

    converter = LectureConverter(args.html, args.output, args.title)
    question_count, answer_count = converter.convert()
    print(converter.output_path)
    print(f"questions {question_count}")
    print(f"blank_answers {answer_count}")


if __name__ == "__main__":
    main()
