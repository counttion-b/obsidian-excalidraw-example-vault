from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import re
import shutil
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
QUESTIONS_DIR = ROOT / "questions"
ATTACHMENTS_DIR = ROOT / "attachments"
EXPORTS_DIR = ROOT / "exports"
TEMPLATE_PATH = ROOT / "templates" / "question_template.md"


def set_root(root: Path) -> None:
    global ROOT, QUESTIONS_DIR, ATTACHMENTS_DIR, EXPORTS_DIR, TEMPLATE_PATH
    ROOT = root.resolve()
    QUESTIONS_DIR = ROOT / "questions"
    ATTACHMENTS_DIR = ROOT / "attachments"
    EXPORTS_DIR = ROOT / "exports"
    TEMPLATE_PATH = ROOT / "templates" / "question_template.md"


@dataclass
class QuestionNote:
    path: Path
    meta: dict[str, Any]
    body: str

    @property
    def title(self) -> str:
        return str(self.meta.get("title") or self.path.stem)

    @property
    def tags(self) -> list[str]:
        return [str(tag) for tag in self.meta.get("tags", [])]

    @property
    def sources(self) -> list[dict[str, str]]:
        sources = self.meta.get("sources", [])
        return [source for source in sources if isinstance(source, dict)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Obsidian 个人题库工具")
    parser.add_argument("--vault", type=Path, default=None, help="题库根目录，例如 D:\\obrepo\\papers\\题库")
    subparsers = parser.add_subparsers(dest="command", required=True)

    new_parser = subparsers.add_parser("new", help="新建一道题目模板")
    new_parser.add_argument("--title", required=True, help="题目标题")
    new_parser.add_argument("--subject", default="物理")
    new_parser.add_argument("--type", default="选择题", dest="question_type")
    new_parser.add_argument("--tag", action="append", default=[], help="标签，可重复")

    import_parser = subparsers.add_parser("import", help="从 OCR 输出或其他文件夹导入题目")
    import_parser.add_argument("--from", dest="source", required=True, type=Path, help="包含 result.md 的文件夹或单个 md 文件")

    fix_images_parser = subparsers.add_parser("fix-images", help="下载题目中的远程图片到 attachments")
    fix_images_parser.add_argument("--timeout", type=int, default=20, help="单张图片下载超时时间，单位秒")

    relabel_parser = subparsers.add_parser("relabel-paper", help="把已有题目批量标为同一试卷来源")
    relabel_parser.add_argument("--source", required=True, help="试卷出处，例如 2025~2026学年北京第五十五中高一下期中")
    relabel_parser.add_argument("--file", action="append", default=[], help="要整理的题目文件名或路径，可重复；不填则整理全部题目")

    sync_title_parser = subparsers.add_parser("sync-title", help="同步文件名、title、一级标题和题目 callout 标题")
    sync_title_parser.add_argument("--file", action="append", default=[], help="要整理的题目文件名或路径，可重复；不填则整理全部题目")
    sync_title_parser.add_argument("--title", default="", help="指定统一标题；不填则使用每道题 front matter 的 title")

    subparsers.add_parser("format", help="统一题目图片宽度和选项排版")

    list_parser = subparsers.add_parser("list", help="按条件筛选并列出题目")
    add_filter_args(list_parser)

    export_parser = subparsers.add_parser("export", help="按条件生成学生版、答案版或详解版")
    add_filter_args(export_parser)
    export_parser.add_argument("--mode", choices=["student", "answer", "detail"], required=True)
    export_parser.add_argument("--out", type=Path, default=None, help="输出文件路径")
    export_parser.add_argument("--title", default="", help="导出文档标题")

    args = parser.parse_args()
    if args.vault:
        set_root(args.vault)
    ensure_dirs()

    if args.command == "new":
        path = create_question(args.title, args.subject, args.question_type, args.tag)
        print(f"已创建: {path}")
    elif args.command == "import":
        count = import_questions(args.source)
        print(f"已导入: {count} 道题")
    elif args.command == "fix-images":
        count = fix_remote_images(timeout=args.timeout)
        print(f"已修复图片链接: {count} 个")
    elif args.command == "relabel-paper":
        count = relabel_paper(args.source, args.file)
        print(f"已整理来源: {count} 道题")
    elif args.command == "sync-title":
        count = sync_titles(args.file, args.title)
        print(f"已同步标题: {count} 道题")
    elif args.command == "format":
        count = format_question_notes()
        print(f"已整理: {count} 个文件")
    elif args.command == "list":
        notes = filter_notes(load_notes(), args)
        for index, note in enumerate(notes, start=1):
            print(f"{index}. {note.title}  [{', '.join(note.tags)}]")
        print(f"共 {len(notes)} 道题")
    elif args.command == "export":
        notes = filter_notes(load_notes(), args)
        output_path = export_notes(notes, args.mode, args.out, args.title)
        print(f"已生成: {output_path}")


def add_filter_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--tag", action="append", default=[], help="必须包含的标签，可重复")
    parser.add_argument("--any-tag", action="append", default=[], help="命中任意一个即可的标签，可重复")
    parser.add_argument("--source", action="append", default=[], help="来源名称包含的文字，可重复")
    parser.add_argument("--school", action="append", default=[], help="学校包含的文字，可重复")
    parser.add_argument("--year", action="append", default=[], help="学年包含的文字，可重复")
    parser.add_argument("--grade", action="append", default=[], help="年级，例如 高一")
    parser.add_argument("--semester", action="append", default=[], help="学期，例如 上学期")
    parser.add_argument("--exam", action="append", default=[], help="考试类型，例如 期中")
    parser.add_argument("--knowledge", action="append", default=[], help="知识点标签，例如 动量定理")
    parser.add_argument("--contains", action="append", default=[], help="题目/答案/详解全文包含的文字")


def ensure_dirs() -> None:
    for path in (QUESTIONS_DIR, ATTACHMENTS_DIR, EXPORTS_DIR, TEMPLATE_PATH.parent):
        path.mkdir(parents=True, exist_ok=True)


def create_question(title: str, subject: str, question_type: str, tags: list[str]) -> Path:
    slug = safe_filename(title)
    path = QUESTIONS_DIR / f"{slug}.md"
    if path.exists():
        path = QUESTIONS_DIR / f"{slug}-{dt.datetime.now():%Y%m%d%H%M%S}.md"
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    tag_lines = "\n".join(f'  - "{tag}"' for tag in unique([subject, question_type, *tags]))
    content = (
        template.replace("{{title}}", title)
        .replace("{{subject}}", subject)
        .replace("{{question_type}}", question_type)
        .replace("{{tags}}", tag_lines)
        .replace("{{created}}", dt.date.today().isoformat())
    )
    path.write_text(content, encoding="utf-8")
    return path


def import_questions(source: Path) -> int:
    source = source.resolve()
    candidates = [source] if source.is_file() else sorted(source.rglob("result.md"))
    count = 0
    for md_path in candidates:
        text = md_path.read_text(encoding="utf-8")
        if not text.startswith("---"):
            continue
        note = parse_note(md_path)
        slug = safe_filename(note.title)
        target = unique_note_path(QUESTIONS_DIR / f"{slug}.md")
        attachment_dir = ATTACHMENTS_DIR / target.stem
        rewritten = rewrite_and_copy_images(text, md_path.parent, attachment_dir, target.parent)
        target.write_text(rewritten, encoding="utf-8")
        count += 1
    return count


def unique_note_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def rewrite_and_copy_images(text: str, source_dir: Path, attachment_dir: Path, note_dir: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        image_ref = match.group(1).strip()
        if re.match(r"https?://", image_ref):
            downloaded = download_remote_image(image_ref, attachment_dir)
            if not downloaded:
                return match.group(0)
            rel = Path(relative_path(downloaded, note_dir)).as_posix()
            return image_markdown(rel)
        source_image = (source_dir / image_ref).resolve()
        if not source_image.exists():
            return match.group(0)
        attachment_dir.mkdir(parents=True, exist_ok=True)
        target_image = attachment_dir / source_image.name
        shutil.copy2(source_image, target_image)
        rel = Path(relative_path(target_image, note_dir)).as_posix()
        return image_markdown(rel)

    return normalize_note_format(re.sub(IMAGE_PATTERN, replace, text))


def fix_remote_images(timeout: int = 20) -> int:
    count = 0
    for note_path in sorted(QUESTIONS_DIR.glob("*.md")):
        text = note_path.read_text(encoding="utf-8")
        attachment_dir = ATTACHMENTS_DIR / note_path.stem

        def replace(match: re.Match[str]) -> str:
            nonlocal count
            image_ref = match.group(1).strip()
            if not re.match(r"https?://", image_ref):
                return match.group(0)
            downloaded = download_remote_image(image_ref, attachment_dir, timeout=timeout)
            if not downloaded:
                return match.group(0)
            count += 1
            rel = Path(relative_path(downloaded, note_path.parent)).as_posix()
            return image_markdown(rel)

        rewritten = normalize_note_format(re.sub(IMAGE_PATTERN, replace, text))
        if rewritten != text:
            note_path.write_text(rewritten, encoding="utf-8")
    return count


def format_question_notes() -> int:
    count = 0
    for folder in (QUESTIONS_DIR, EXPORTS_DIR):
        for note_path in sorted(folder.glob("*.md")):
            text = note_path.read_text(encoding="utf-8")
            rewritten = normalize_note_format(text)
            if rewritten != text:
                note_path.write_text(rewritten, encoding="utf-8")
                count += 1
    return count


def relabel_paper(source: str, files: list[str]) -> int:
    selected = selected_question_paths(files)
    count = 0
    for index, path in enumerate(selected, start=1):
        text = path.read_text(encoding="utf-8")
        question_no = frontmatter_question_index(text) or str(index)
        rewritten = relabel_note_text(text, source, question_no)
        new_title = f"{source}第{question_no}题"
        rewritten = replace_frontmatter_scalar(rewritten, "title", new_title)
        new_path = unique_note_path(QUESTIONS_DIR / f"{safe_filename(new_title)}.md")
        path.write_text(normalize_note_format(rewritten), encoding="utf-8")
        if new_path != path:
            path.rename(new_path)
        count += 1
    return count


def sync_titles(files: list[str], title: str = "") -> int:
    selected = selected_question_paths(files)
    count = 0
    for path in selected:
        note = parse_note(path)
        new_title = title.strip() or str(note.meta.get("title") or path.stem).strip()
        if not new_title:
            continue
        text = path.read_text(encoding="utf-8")
        rewritten = replace_frontmatter_scalar(text, "title", new_title)
        rewritten = replace_display_title(rewritten, new_title)
        path.write_text(normalize_note_format(rewritten), encoding="utf-8")
        new_path = QUESTIONS_DIR / f"{safe_filename(new_title)}.md"
        if new_path != path:
            new_path = unique_note_path(new_path)
            path.rename(new_path)
        count += 1
    return count


def selected_question_paths(files: list[str]) -> list[Path]:
    if not files:
        return sorted(QUESTIONS_DIR.glob("*.md"))
    result: list[Path] = []
    for item in files:
        path = Path(item)
        candidates = []
        if path.is_absolute():
            candidates.append(path)
        else:
            candidates.append(QUESTIONS_DIR / path)
            candidates.append(QUESTIONS_DIR / f"{item}.md")
        for candidate in candidates:
            if candidate.exists():
                result.append(candidate)
                break
    return result


def relabel_note_text(text: str, source: str, question_no: str) -> str:
    source_block = manual_source_block(source, question_no)
    text = remove_existing_manual_source(text, source)
    text = insert_first_source(text, source_block)
    return replace_display_title(text, f"{source}第{question_no}题")


def manual_source_block(source: str, question_no: str) -> str:
    fields = parse_source_fields(source)
    lines = [
        f"  - name: {source}",
        '    url: ""',
        "    provider: 手动指定",
    ]
    for key in ("school_year", "province", "city", "area", "school", "grade", "semester", "exam_type"):
        if fields.get(key):
            lines.append(f"    {key}: {fields[key]}")
    lines.append(f"    question_index: \"{question_no}\"")
    return "\n".join(lines)


def parse_source_fields(source: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    match = re.search(r"(20\d{2})\s*[~～至-]\s*(20\d{2})学年", source)
    if match:
        fields["school_year"] = f"{match.group(1)}~{match.group(2)}"
    text = re.sub(r"20\d{2}\s*[~～至-]\s*20\d{2}学年", "", source)
    for province in ("北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆"):
        if province in source:
            fields["province"] = province
            break
    district = re.search(r"([\u4e00-\u9fff]{2,8}(?:区|县|市))", text)
    if district:
        fields["area"] = district.group(1)
    school_text = text.split(fields.get("area", ""), 1)[-1] if fields.get("area") else text
    stop = re.search(r"(高一|高二|高三|初一|初二|初三)", school_text)
    school_area = school_text[: stop.start()] if stop else school_text
    school = re.search(r"([\u4e00-\u9fff]{2,30}(?:中学|学校|附中|一中|二中|三中|四中|五中|六中|七中|八中|九中|十中|第五十五中))", school_area)
    if school:
        fields["school"] = school.group(1)
    for grade in ("高一", "高二", "高三", "初一", "初二", "初三"):
        if grade in source:
            fields["grade"] = grade
            break
    for semester in ("上学期", "下学期", "上期", "下期"):
        if semester in source:
            fields["semester"] = semester
            break
    for exam_type in ("期中", "期末", "月考", "联考", "模拟", "开学考", "竞赛", "高考", "单元测试"):
        if exam_type in source:
            fields["exam_type"] = exam_type
            break
    return fields


def remove_existing_manual_source(text: str, source: str) -> str:
    pattern = re.compile(rf"  - name: {re.escape(source)}(?:第\d+题)?\n(?:    .+\n)*", re.MULTILINE)
    return pattern.sub("", text)


def insert_first_source(text: str, source_block: str) -> str:
    return re.sub(r"^sources:\n", f"sources:\n{source_block}\n", text, count=1, flags=re.MULTILINE)


def replace_display_title(text: str, title: str) -> str:
    text = re.sub(r"^# .+$", f"# {title}", text, count=1, flags=re.MULTILINE)
    text = re.sub(r"^> \[!ti\] \*.*\*$", f"> [!ti] *{title}*", text, count=1, flags=re.MULTILINE)
    return text


def replace_frontmatter_scalar(text: str, key: str, value: str) -> str:
    return re.sub(rf"^{re.escape(key)}:\s*.*$", f'{key}: "{value}"', text, count=1, flags=re.MULTILINE)


def frontmatter_question_index(text: str) -> str:
    match = re.search(r"^\s+question_index:\s*[\"']?(\d+)[\"']?\s*$", text, flags=re.MULTILINE)
    return match.group(1) if match else ""


IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


def image_markdown(path: str, width: int = 200) -> str:
    return f"![|{width}]({path})"


def normalize_note_format(text: str, width: int = 200) -> str:
    text = IMAGE_PATTERN.sub(lambda match: image_markdown(match.group(1).strip(), width), text)
    text = text.replace("[!opts]", "[!opts2]")
    text = re.sub(r"(\n> !\[\|200\]\([^)]+\))\n+\n(> > \[!opts2\])", r"\1\n\2", text)
    return text


def download_remote_image(url: str, attachment_dir: Path, timeout: int = 20) -> Path | None:
    attachment_dir.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlparse(url)
    suffix = Path(parsed.path).suffix
    if not suffix or len(suffix) > 8:
        suffix = ".png"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    name = safe_filename(Path(parsed.path).stem or "image")
    target = attachment_dir / f"{name}-{digest}{suffix}"
    if target.exists():
        return target
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            target.write_bytes(response.read())
    except Exception:
        return None
    return target


def load_notes() -> list[QuestionNote]:
    return [parse_note(path) for path in sorted(QUESTIONS_DIR.glob("*.md"))]


def parse_note(path: Path) -> QuestionNote:
    text = path.read_text(encoding="utf-8")
    meta: dict[str, Any] = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            raw_meta = text[3:end].strip("\n")
            body = text[end + 4 :].lstrip("\n")
            meta = parse_front_matter(raw_meta)
    return QuestionNote(path=path, meta=meta, body=body)


def parse_front_matter(raw: str) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    lines = raw.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if not line.startswith(" ") and ":" in line:
            key, value = line.split(":", 1)
            key = key.strip()
            value = strip_quote(value.strip())
            if value:
                meta[key] = value
                i += 1
                continue
            if key == "tags":
                items, i = parse_scalar_list(lines, i + 1)
                meta[key] = items
                continue
            if key == "sources":
                items, i = parse_dict_list(lines, i + 1)
                meta[key] = items
                continue
            meta[key] = ""
        i += 1
    return meta


def parse_scalar_list(lines: list[str], start: int) -> tuple[list[str], int]:
    items: list[str] = []
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.startswith("  - "):
            break
        items.append(strip_quote(line[4:].strip()))
        i += 1
    return items, i


def parse_dict_list(lines: list[str], start: int) -> tuple[list[dict[str, str]], int]:
    items: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.startswith("  "):
            break
        if line.startswith("  - "):
            if current:
                items.append(current)
            current = {}
            rest = line[4:].strip()
            if ":" in rest:
                key, value = rest.split(":", 1)
                current[key.strip()] = strip_quote(value.strip())
        elif current is not None and line.startswith("    ") and ":" in line:
            key, value = line.strip().split(":", 1)
            current[key.strip()] = strip_quote(value.strip())
        i += 1
    if current:
        items.append(current)
    return items, i


def strip_quote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def filter_notes(notes: list[QuestionNote], args: argparse.Namespace) -> list[QuestionNote]:
    result = []
    for note in notes:
        if not all_tag_match(note, args.tag + args.knowledge):
            continue
        if args.any_tag and not any_tag_match(note, args.any_tag):
            continue
        if not source_match(note, args.source):
            continue
        if not source_field_match(note, "school", args.school):
            continue
        if not source_field_match(note, "school_year", args.year):
            continue
        if not source_field_match(note, "grade", args.grade):
            continue
        if not source_field_match(note, "semester", args.semester):
            continue
        if not source_field_match(note, "exam_type", args.exam):
            continue
        haystack = normalized_search_text(note.body)
        if any(normalize(term) not in haystack for term in args.contains):
            continue
        result.append(note)
    return result


def all_tag_match(note: QuestionNote, required: list[str]) -> bool:
    tags = [normalize(tag) for tag in note.tags]
    return all(any(normalize(item) in tag for tag in tags) for item in required)


def any_tag_match(note: QuestionNote, required: list[str]) -> bool:
    tags = [normalize(tag) for tag in note.tags]
    return any(any(normalize(item) in tag for tag in tags) for item in required)


def source_match(note: QuestionNote, required: list[str]) -> bool:
    text = normalize(" ".join(str(source.get("name", "")) for source in note.sources))
    return all(normalize(item) in text for item in required)


def source_field_match(note: QuestionNote, field: str, required: list[str]) -> bool:
    if not required:
        return True
    values = [normalize(str(source.get(field, ""))) for source in note.sources]
    return all(any(normalize(item) in value for value in values) for item in required)


def normalized_search_text(text: str) -> str:
    return normalize(re.sub(r"\s+", " ", text))


def export_notes(notes: list[QuestionNote], mode: str, out: Path | None, title: str) -> Path:
    if out is None:
        EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        out = EXPORTS_DIR / f"{dt.datetime.now():%Y%m%d_%H%M%S}_{mode}.md"
    elif not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)

    title = title or {"student": "学生版", "answer": "答案版", "detail": "详解版"}[mode]
    lines = [f"# {title}", ""]
    for index, note in enumerate(notes, start=1):
        if mode == "student":
            lines.extend(render_student(note, index))
        elif mode == "answer":
            lines.extend(render_answer(note, index))
        else:
            lines.extend(render_detail(note, index))
        lines.append("")
    out.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return out


def render_student(note: QuestionNote, index: int) -> list[str]:
    return [clean_export_question(section(note.body, "题目"))]


def render_answer(note: QuestionNote, index: int) -> list[str]:
    answer = section(note.body, "答案") or "暂无"
    return [f"{index}. {answer}"]


def render_detail(note: QuestionNote, index: int) -> list[str]:
    return [
        clean_export_question(section(note.body, "题目")),
        "",
        "### 答案",
        "",
        section(note.body, "答案") or "暂无",
        "",
        "### 详解",
        "",
        section(note.body, "详解") or "暂无",
    ]


def section(body: str, heading: str) -> str:
    pattern = re.compile(rf"^##\s+{re.escape(heading)}\s*$", re.MULTILINE)
    match = pattern.search(body)
    if not match:
        return ""
    start = match.end()
    next_heading = re.search(r"^##\s+", body[start:], flags=re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(body)
    return body[start:end].strip()


def clean_export_question(markdown: str) -> str:
    text = str(markdown or "").replace("{{title}}", "")
    return text.strip()


def safe_filename(name: str, max_length: int = 80) -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "-", name)
    name = re.sub(r"\s+", "-", name).strip("-.")
    return (name or "untitled")[:max_length].rstrip("-.")


def relative_path(path: Path, start: Path) -> str:
    try:
        return str(path.resolve().relative_to(start.resolve()))
    except ValueError:
        import os

        return os.path.relpath(path.resolve(), start.resolve())


def unique(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def normalize(text: str) -> str:
    return str(text).replace("~", "-").replace("～", "-").replace("至", "-").replace(" ", "").lower()


if __name__ == "__main__":
    main()
