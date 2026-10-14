"use strict";

// The smart workflow is deliberately separate from legacy image-only exports.
// A cache entry contains exactly one accepted question, never a mixture of hits.
const SCHEMA = 1;
const PENDING = "[待补充，请核对]";
const IMAGE_RE = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|svg|webp|bmp|avif)(?:[?#]|$)/i;

function unquote(text) { return String(text || "").replace(/^(?:\s*>\s?)+/gm, ""); }
function missing(text) {
  const value = String(text || "").replace(/[\s*#。.!！:：]/g, "");
  return !value || /^(?:暂无(?:答案|解析|详解)?|无|没有|略|待补充|待完善|待核对|待补充请核对|\[待补充，请核对\])$/.test(value);
}
function incomplete(text) { return missing(text) || /待补充|待核对|未附.{0,6}解析|没有.{0,6}解析/.test(text); }
function imageRefs(text) {
  return [...String(text || "").matchAll(new RegExp(IMAGE_RE.source, "g"))].map(m => ({
    token: m[0], url: (m[1] ? m[1].split("|")[0] : m[3].replace(/^<|>$/g, "")).trim(),
    wiki: Boolean(m[1]), alt: m[2] || "|200"
  }));
}
function noImages(text) { return String(text || "").replace(new RegExp(IMAGE_RE.source, "g"), ""); }
function cleanBody(text) {
  return unquote(text).replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\[!(?:ti|opts\d*)\].*$/gm, "")
    .replace(/<div\b[^>]*class=["'][^"']*page-break[^"']*["'][^>]*>\s*<\/div>/gi, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function solutionMarker(line) {
  let value = unquote(line).trim();
  value = value.replace(/^#{1,6}\s*/, "").replace(/^\d+(?:\.\d+)*[.．、]?\s*/, "")
    .replace(/^\*\*/, "").replace(/^\[!(?:answer|solution|analysis)\][+-]?\s*/i, m => /answer/i.test(m) ? "答案：" : "解析：");
  const match = value.match(/^(?:【|\[)?(正确答案|参考答案|标准答案|答案|详细解析|解析|详解|解答|思路分析|分析|解|答)(?:(?:】|\])\s*[:：]?\s*|(?:\*\*)?\s*[:：]\s*(?:\*\*)?|(?:\*\*)?\s*$)/);
  if (!match) return null;
  return { mode: /答案|^答$/.test(match[1]) ? "answer" : "analysis", text: value.slice(match[0].length).replace(/\*\*$/, "").trim() };
}

function splitFields(raw) {
  const parts = { problem: [], answer: [], analysis: [] };
  let mode = "problem";
  for (const line of String(raw || "").split(/\r?\n/)) {
    const mark = solutionMarker(line);
    if (mark) { mode = mark.mode; if (mark.text) parts[mode].push(mark.text); }
    else parts[mode].push(line);
  }
  return Object.fromEntries(Object.entries(parts).map(([key, lines]) => {
    const value = cleanBody(lines.join("\n"));
    return [key, key !== "problem" && missing(value) ? "" : value];
  }));
}

function parse(content, deps) {
  const text = String(content || "").replace(/^---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "");
  // A separately numbered answer appendix is not another set of questions.
  const appendixHeaders = [...text.matchAll(/^#{1,2}\s+(参考答案|答案汇总|答案解析|答案与解析|答案及解析|解析汇总|答案|解析)\s*$/gm)];
  const appendixStart = appendixHeaders.find(m => /汇总|答案解析|答案与解析|答案及解析/.test(m[1]) || /^\s*(?:#{1,6}\s*)?(?:第\s*\d+\s*题|\d+(?:[.．、]|\s*$))/m.test(text.slice(m.index + m[0].length).trimStart().split("\n", 1)[0]))?.index ?? -1;
  const body = appendixStart >= 0 ? text.slice(0, appendixStart) : text;
  const appendix = appendixStart >= 0 ? text.slice(appendixStart) : "";
  let blocks = deps.parsePaperBlocks(body);
  if (!blocks.length) {
    const starts = [...body.matchAll(/^(?:#{1,5}\s*)?(?:第\s*(\d{1,3})\s*题|([0-9]{1,3})[.．、]\s*)(.*)$/gm)];
    blocks = starts.map((match, i) => ({
      raw: body.slice(match.index + match[0].length, starts[i + 1]?.index ?? body.length),
      title: "", questionNo: match[1] || match[2], initial: match[3]
    }));
  }
  const rows = blocks.map((block, i) => {
    let raw = block.raw.replace(/^#{6}\s*[^\n]*\n?/, "").replace(/^>\s*\[!ti\].*$/m, "");
    if (block.initial) raw = `${block.initial}\n${raw}`;
    // Section headings belong to the paper structure, not the preceding question.
    raw = raw.replace(/^#{1,3}\s+(?!答案|解析|详解|解答|分析|参考答案|正确答案)[^\n]*(?:\n[ \t]*)?$/gm, "");
    const fields = splitFields(raw);
    const concerns = [];
    if (/(?:^|\n)[^\n]*(?:【(?:答案|解析|详解)】|\[!(?:answer|solution|analysis)\])/i.test(fields.problem)) {
      concerns.push("存在未识别的解答标记；已隔离该段，防止学生版泄露答案");
      fields.problem = fields.problem.replace(/(?:^|\n)[^\n]*(?:【(?:答案|解析|详解)】|\[!(?:answer|solution|analysis)\])[\s\S]*/i, "\n[此段待核对]");
    }
    return { index: i + 1, originalNo: String(block.questionNo || i + 1), source: /^\d+$/.test(block.title || "") ? "例题" : block.title || "例题", ...fields,
      imageHint: /图位|待补图|缺图|图片缺失/.test(raw), issues: concerns };
  }).filter(row => noImages(row.problem).replace(/[\s#*]/g, "").length > 1);
  rows.forEach((row, i) => { row.index = i + 1; });
  let appendixUsed = false;
  if (appendix) {
    const nums = new Map();
    for (const row of rows) nums.set(row.originalNo, (nums.get(row.originalNo) || 0) + 1);
    const entries = [...appendix.matchAll(/^(?:#{1,6}\s*)?(?:第\s*(\d{1,3})\s*题|([0-9]{1,3})(?:[.．、]\s*|\s*$))(.*)$/gm)];
    for (let i = 0; i < entries.length; i++) {
      const m = entries[i], no = m[1] || m[2];
      const row = rows.find(r => r.originalNo === no);
      if (!row || nums.get(no) !== 1) continue;
      const chunk = `${m[3]}\n${appendix.slice(m.index + m[0].length, entries[i + 1]?.index ?? appendix.length)}`
        .replace(/^#{1,2}\s+(?:参考答案|答案汇总|答案解析|答案与解析|答案及解析|解析汇总|答案|解析)\s*$/gm, "");
      const fields = splitFields(chunk);
      const preceding = appendix.slice(0, m.index);
      const headings = [...preceding.matchAll(/^#{1,2}\s+(.+)$/gm)];
      const analysisOnly = /解析|详解/.test(headings.at(-1)?.[1] || "") && !/答案/.test(headings.at(-1)?.[1] || "");
      const answer = fields.answer || (!analysisOnly ? fields.problem : "");
      const analysis = fields.analysis || (analysisOnly ? fields.problem : "");
      if (!row.answer && !missing(answer)) row.answer = answer;
      if (!row.analysis && !missing(analysis)) row.analysis = analysis;
      appendixUsed = true;
    }
    for (const row of rows) row.issues.push(appendixUsed ? "识别到独立答案附录，请核对按原题号关联的内容" : "独立答案附录未能可靠关联，已另存原文，须人工核对");
  }
  if (!rows.length) throw new Error("未识别到题干。支持现有 [!ti] 题块、六级题号标题或行首 1. / 第1题；答案文件不能单独作为题集输入");
  return { rows, appendix };
}

// Conservative equality: punctuation/layout and equivalent TeX spellings are
// normalized, but numbers, choice order, inequalities and negation are retained.
function canonical(text) {
  const greek = { varphi: "φ", phi: "φ", alpha: "α", beta: "β", theta: "θ", mu: "μ", pi: "π", omega: "ω", Delta: "Δ", rho: "ρ", epsilon: "ε" };
  return noImages(cleanBody(text)).normalize("NFKC")
    .replace(/\$|\\(?:left|right|displaystyle|textstyle)\b/g, "")
    .replace(/\\(?:mathrm|mathbf|mathit|text|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:dfrac|tfrac|frac)\s*(?:\{([^{}]*)\}|([^\s{}]))\s*(?:\{([^{}]*)\}|([^\s{}]))/g, (_, a, b, c, d) => `(${a ?? b})/(${c ?? d})`)
    .replace(/\\(varphi|phi|alpha|beta|theta|mu|pi|omega|Delta|rho|epsilon)(?![A-Za-z])/g, (_, name) => greek[name])
    .replace(/\\(?:leq|le)\b/g, "≤").replace(/\\(?:geq|ge)\b/g, "≥").replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·").replace(/\\(?:,|;|!|quad\b|qquad\b| )/g, "")
    .replace(/<sub[^>]*>(.*?)<\/sub>/gi, "$1").replace(/<sup[^>]*>(.*?)<\/sup>/gi, "^$1")
    .replace(/^\s*[-*]\s+(?=[A-H][.、．])/gm, "")
    .replace(/^\s*([A-H])[.、．]\s*/gm, "$1")
    .replace(/\(\s*\)|（\s*）/g, "")
    .replace(/[\s_{}*`，。；、！？“”‘’【】$#]/g, "")
    .replace(/[,?;!]/g, "").replace(/−|–/g, "-").replace(/ϕ/g, "φ");
}
function similarity(a, b) {
  a = canonical(a); b = canonical(b);
  if (a === b && a.length >= 8) return 1;
  const grams = value => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  const aa = grams(a), bb = grams(b);
  return aa.size + bb.size ? 2 * [...aa].filter(s => bb.has(s)).length / (aa.size + bb.size) : 0;
}

function attributes(tag) {
  const result = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  return result;
}
function htmlMarkdown(html, deps) {
  const saved = [];
  const hold = value => { saved.push(value); return `QBSAVEDTOKEN${saved.length - 1}END`; };
  let text = String(html || "").replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "");
  text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, svg => {
    const latex = svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return latex ? hold(`$${deps.htmlEntities(latex)}$`) : hold("[内嵌示意图待核对]");
  });
  text = text.replace(/<img\b[^>]*>/gi, tag => {
    const attr = attributes(tag);
    const latex = attr["data-latex"] || attr["data-tex"];
    if (latex) return hold(`$${deps.htmlEntities(latex)}$`);
    const src = deps.absoluteImageUrl(deps.htmlEntities(attr["data-original"] || attr["data-src"] || attr.src || ""));
    return /^https?:\/\//i.test(src) ? hold(`![|200](<${src}>)`) : hold("[图片地址无效，待核对]");
  });
  text = text.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, table) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cell[1].replace(/\|/g, "\\|")));
    if (!rows.length) return table;
    const width = Math.max(...rows.map(r => r.length));
    const render = cells => `| ${Array.from({ length: width }, (_, i) => cells[i] || "").join(" | ")} |`;
    return `\n\n${render(rows[0])}\n${render(Array(width).fill("---"))}\n${rows.slice(1).map(render).join("\n")}\n\n`;
  });
  text = text.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, (_, v) => hold(`<sub>${deps.htmlEntities(v.replace(/<[^>]+>/g, ""))}</sub>`))
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_, v) => hold(`<sup>${deps.htmlEntities(v.replace(/<[^>]+>/g, ""))}</sup>`))
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, "\n").replace(/<li\b[^>]*>/gi, "- ").replace(/<[^>]+>/g, "");
  return deps.htmlEntities(text).replace(/QBSAVEDTOKEN(\d+)END/g, (_, n) => saved[Number(n)])
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function apiValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(apiValue).filter(v => !missing(v)).join("；");
  for (const key of ["content", "answer", "analysis", "value", "text"]) if (value[key] !== undefined) return apiValue(value[key]);
  return ""; // Metadata is never a substitute for a missing answer.
}
function fromApi(item, deps) {
  const convert = value => htmlMarkdown(apiValue(value), deps);
  const first = keys => keys.map(key => convert(item[key])).find(value => !missing(value)) || "";
  const problem = [first(["questionContent", "content", "stem", "body", "quesContent", "question"])];
  let options = (item.answerOptionList || []).flat();
  if (!options.length) options = item.optionList || item.options || item.choiceList || item.choices || [];
  options.forEach((option, i) => {
    const label = String(option.aoVal || option.label || String.fromCharCode(65 + i)).replace(/[.．、]$/, "");
    const value = convert(typeof option === "object" ? option.content || option.value || option.text : option);
    problem.push(`${label}. ${value || PENDING}`);
  });
  const result = {
    id: String(item.queId || item.questionId || item.id || ""), problem: "",
    answer: first(["answer", "answers", "referenceAnswer", "correctAnswer", "blankAnswer"]),
    analysis: first(["analysis", "analyze", "answerAnalysis", "explain"]),
    doubtful: item.answerDoubtful === true || String(item.answerDoubtful) === "1", issues: []
  };
  for (const [i, child] of (item.childList || []).entries()) {
    const q = fromApi(child, deps);
    problem.push(`（${i + 1}）${q.problem}`);
    for (const key of ["answer", "analysis"]) result[key] += `\n\n（${i + 1}）${q[key] || PENDING}`;
    result.doubtful ||= q.doubtful;
  }
  result.problem = problem.filter(Boolean).join("\n\n");
  for (const key of ["problem", "answer", "analysis"]) result[key] = result[key].trim();
  if (/rowspan|colspan/i.test(String(item.content || "") + String(item.analysis || ""))) result.issues.push("题库含合并单元格，导出的表格布局需核对");
  return result;
}

async function chooseMatch(plugin, row, deps, cached) {
  let chosen = cached;
  if (!chosen) {
    const query = deps.buildSearchQueries(noImages(row.problem), 1, 100)[0];
    if (!query) return { reason: "题干太短，无法可靠检索" };
    const items = await plugin.searchJiaoyanyun(query, 20);
    const seen = new Set();
    const candidates = [];
    for (const item of items) {
      const q = deps.questionFromJiaoyanyunItem(item, plugin.settings.subjectId || "4", plugin.settings.gradeGroupId || "3", plugin.settings);
      if (!q.smart.id || seen.has(q.smart.id)) continue;
      seen.add(q.smart.id);
      candidates.push({ q, item, score: similarity(row.problem, q.smart.problem) });
    }
    candidates.sort((a, b) => b.score - a.score || Number(!incomplete(b.q.smart.answer) && !incomplete(b.q.smart.analysis)) - Number(!incomplete(a.q.smart.answer) && !incomplete(a.q.smart.analysis)));
    const exact = candidates.filter(c => c.score === 1 && !c.q.smart.doubtful);
    if (!exact.length) return { reason: candidates.length ? `仅找到近似题（文本相似度 ${Math.round(candidates[0].score * 100)}%），未套用配图或解答` : "未找到题库匹配", candidateUrl: candidates[0]?.q.url };
    const answers = new Set(exact.map(c => canonical(c.q.smart.answer)).filter(Boolean));
    if (answers.size > 1) return { reason: "相同题干候选的答案存在冲突，须人工选择", candidateUrl: exact[0].q.url };
    const best = exact[0];
    chosen = { question: best.q, fallback: best.item };
  }
  let question = chosen.question;
  if (incomplete(question.smart.answer) || incomplete(question.smart.analysis)) {
    question = await plugin.fetchJiaoyanyunDetail(question.smart.id, chosen.fallback || {
      queId: question.smart.id, content: question.smart.problem, answer: question.smart.answer, analysis: question.smart.analysis
    }, true);
    if (question.smart.id !== chosen.question.smart.id || similarity(row.problem, question.smart.problem) !== 1) {
      return { reason: "详情题号或题干与检索结果不一致，未套用" };
    }
  }
  if (question.smart.doubtful) return { reason: "题库将本题答案标为存疑，须人工核对", candidateUrl: question.url };
  return { question };
}

function joinPath(...values) {
  const parts = [];
  for (const part of values.join("/").replace(/\\/g, "/").split("/")) {
    if (part === "..") { if (!parts.length) return ""; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
function relative(from, to) {
  const a = from.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => ".."), ...b].join("/");
}
function pictureSlots(text) {
  return text.split(/(?=^\s*(?:[-*]\s*)?[A-H][.．、]\s|^\s*[（(]\d+[)）])/m)
    .map(part => new Set(imageRefs(part).map(ref => ref.url)).size);
}
async function localAsset(plugin, file, ref) {
  if (/^https?:\/\//i.test(ref.url)) return null;
  let link;
  try { link = decodeURIComponent(ref.url.split("#")[0]); } catch { link = ref.url.split("#")[0]; }
  if (!IMAGE_EXT.test(link)) return null;
  const resolved = plugin.app.metadataCache?.getFirstLinkpathDest(link, file.path)?.path;
  const parent = file.path.split("/").slice(0, -1).join("/");
  for (const path of [...new Set([resolved, joinPath(parent, link), joinPath(link)].filter(Boolean))]) {
    if (await plugin.app.vault.adapter.exists(path)) return path;
  }
  return null;
}

async function localize(plugin, text, file, assetsDir, outputDir, deps, issues, label) {
  const refs = imageRefs(text);
  const remote = refs.filter(ref => /^https?:\/\//i.test(ref.url)).map(ref => ref.url);
  const map = await plugin.downloadQuestionImages([...new Set(remote)], assetsDir);
  for (const ref of refs) {
    const path = /^https?:\/\//i.test(ref.url) ? map.get(ref.url) : await localAsset(plugin, file, ref);
    if (!path) {
      issues.push(`${label}图片或嵌入内容不可用：${ref.url}`);
      text = text.replace(ref.token, "[此处图片待补充]");
    } else text = text.replace(ref.token, `![${ref.alt}](<${relative(outputDir, path)}>)`);
  }
  // Deduplicate repeated pictures within a stem/solution, but never merge A/B
  // options or separate subquestions merely because they share an image file.
  return text.split(/(?=^\s*(?:[-*]\s*)?[A-H][.．、]\s|^\s*[（(]\d+[)）])/m).map(part => {
    const seen = new Set();
    return part.replace(new RegExp(IMAGE_RE.source, "g"), (token, wiki, alt, url) => {
      const key = wiki || url;
      if (seen.has(key)) return "";
      seen.add(key);
      return token;
    });
  }).join("");
}
async function prepareRow(plugin, row, matched, file, assetsDir, outputDir, deps) {
  const result = { ...row, issues: [...row.issues], matchedId: "", link: "", added: [] };
  const bank = matched.question?.smart;
  if (bank) {
    result.matchedId = bank.id;
    result.link = matched.question.url;
    result.issues.push(...bank.issues);
    result.source = row.source || "例题";
    const answerConflict = !missing(row.answer) && !missing(bank.answer) && canonical(row.answer) !== canonical(bank.answer);
    for (const field of ["answer", "analysis"]) {
      if (field === "analysis" && answerConflict && missing(row.analysis)) {
        result.issues.push("原稿答案与题库答案冲突，未套用题库解析");
        continue;
      }
      if (missing(result[field]) && !missing(bank[field])) { result[field] = bank[field]; result.added.push(field === "answer" ? "答案" : "解析"); }
      else if (!missing(bank[field]) && canonical(result[field]) === canonical(bank[field])) {
        // Also repair missing illustrations in an otherwise present solution.
        const originalImages = imageRefs(result[field]), remoteImages = imageRefs(bank[field]);
        let surviving = 0;
        for (const ref of originalImages) if (/^https?:\/\//i.test(ref.url) || await localAsset(plugin, file, ref)) surviving++;
        if (remoteImages.length && surviving === 0) {
          result[field] = bank[field];
          result.added.push(field === "answer" ? "答案配图" : "解析配图");
        } else if (remoteImages.length > surviving || originalImages.length > surviving) result.issues.push(`${field === "answer" ? "答案" : "解析"}可能缺少部分图片，保留已有内容，须核对`);
      }
      else if (!missing(result[field]) && !missing(bank[field]) && canonical(result[field]) !== canonical(bank[field])) {
        result.issues.push(`${field === "answer" ? "答案" : "解析"}保留原稿；与题库表述不同，请核对`);
      }
    }
    const originalRefs = imageRefs(row.problem), bankRefs = imageRefs(bank.problem);
    const localValid = [];
    for (const ref of originalRefs) if (/^https?:\/\//i.test(ref.url) || await localAsset(plugin, file, ref)) localValid.push(ref);
    const ownSlots = pictureSlots(row.problem), bankSlots = pictureSlots(bank.problem);
    const needImages = row.imageHint || bankSlots.some((n, i) => n > (ownSlots[i] || 0)) || localValid.length < originalRefs.length;
    const needsSolutions = missing(row.answer) || missing(row.analysis);
    let graphicsCompatible = true;
    if ((needImages || needsSolutions) && (bankRefs.length || localValid.length)) {
      // Keep bank figures in their actual stem/option/subquestion positions.
      // Existing pictures must be verified before replacing a partially illustrated problem.
      let compatible = localValid.length === 0;
      if (localValid.length) {
        const map = await plugin.downloadQuestionImages(bankRefs.map(ref => ref.url), assetsDir);
        const digests = new Set();
        if (plugin.app.vault.adapter.readBinary) {
          for (const path of new Set(map.values())) digests.add(await deps.imageDigest(await plugin.app.vault.adapter.readBinary(path)));
          compatible = true;
          for (const ref of localValid) {
            if (bankRefs.some(b => b.url === ref.url)) continue;
            const path = await localAsset(plugin, file, ref);
            if (!path || !digests.has(await deps.imageDigest(await plugin.app.vault.adapter.readBinary(path)))) { compatible = false; break; }
          }
        }
      }
      graphicsCompatible = compatible;
      if (compatible && needImages && bankRefs.length) { result.problem = bank.problem; result.added.push("配套题图（含选项/小问）"); }
      else if (!compatible) result.issues.push("原有图片与题库图片不能确认一致，保留原图，未套用题库解答，须人工核对");
    } else if (row.imageHint && !bankRefs.length) result.issues.push("原稿标有缺图位置，但该匹配题没有可提取的图片");
    if (!graphicsCompatible) {
      result.answer = row.answer;
      result.analysis = row.analysis;
      result.source = row.source;
      result.added = [];
    }
  } else result.issues.push(matched.reason || "尚未检索");
  if (matched.candidateUrl) result.candidateUrl = matched.candidateUrl;
  for (const [field, label] of [["problem", "题目"], ["answer", "答案"], ["analysis", "解析"]]) {
    result[field] = await localize(plugin, result[field], file, assetsDir, outputDir, deps, result.issues, label);
    if (field !== "problem" && incomplete(result[field])) result.issues.push(`${label}尚不完整`);
    if (missing(result[field])) result[field] = PENDING;
    if (/待核对|待补充/.test(result[field]) && field === "problem") result.issues.push("题目内容含待核对项");
  }
  if (!bank && (row.imageHint || /如图|图甲|图乙|下图/.test(row.problem)) && !imageRefs(result.problem).length) result.issues.push("题干涉及图示，尚未找到可靠配图");
  result.issues = [...new Set(result.issues)];
  return result;
}

function render(title, rows, mode) {
  const lines = [`# ${title}${{ student: "学生版", teacher: "教师版", answer: "答案版" }[mode]}`, ""];
  if (mode === "answer") {
    lines.push("## 答案汇总", "");
    for (const row of rows) lines.push(`### 第${row.index}题`, "", row.answer || PENDING, "");
    lines.push("## 配套解析", "");
    for (const row of rows) lines.push(`### 第${row.index}题解析`, "", row.analysis || PENDING, "");
  } else for (const row of rows) {
    const source = String(row.source || "例题").replace(/[\r\n]/g, " ");
    lines.push(`###### ${row.index}`, "", `> [!ti] *${source}*`, ...row.problem.split("\n").map(line => `> ${line}`), "");
    if (mode === "teacher") lines.push("### 答案", "", row.answer || PENDING, "", "### 解析", "", row.analysis || PENDING, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function run(plugin, file, deps) {
  const original = await plugin.app.vault.read(file);
  const parsed = parse(original, deps);
  const adapter = plugin.app.vault.adapter;
  const digest = text => deps.imageDigest(new TextEncoder().encode(text));
  const base = deps.safeFilename(deps.stripPaperVariantSuffix(file.basename)) || "题集";
  const parent = file.path.split("/").slice(0, -1).join("/");
  const folder = joinPath(parent, `${base}_智能整理_${(await digest(file.path)).slice(0, 6)}`);
  const assetsDir = `${folder}/attachments`, cachePath = `${folder}/.smart-cache.json`;
  await deps.ensureFolder(plugin.app, assetsDir);
  let cache = { schema: SCHEMA, entries: {} };
  if (await adapter.exists(cachePath)) {
    try { const saved = JSON.parse(await adapter.read(cachePath)); if (saved.schema === SCHEMA && saved.entries) cache = saved; } catch { /* rebuild */ }
  }
  let revision = 1;
  while (await adapter.exists(`${folder}/导出-${String(revision).padStart(3, "0")}`)) revision++;
  const outputDir = `${folder}/导出-${String(revision).padStart(3, "0")}`;
  await deps.ensureFolder(plugin.app, outputDir);
  deps.notify(`智能整理开始：${parsed.rows.length} 道题；逐题校验，图片与解答只取同一匹配题`);
  const rows = [];
  let stopped = "";
  for (const row of parsed.rows) {
    if (plugin.smartPaperCancelled) stopped ||= "用户停止";
    const key = await digest(JSON.stringify([SCHEMA, row.problem, row.source, plugin.settings.subjectId, plugin.settings.gradeGroupId, plugin.settings.beijingSchoolPriority]));
    let matched = { reason: stopped ? `未继续处理：${stopped}` : "" };
    if (!stopped) {
      try {
        if (!plugin.settings.jiaoyanyunToken) matched = { reason: "未设置 schoolToken；仅整理原稿已有内容，未联网补全" };
        else {
          matched = await chooseMatch(plugin, row, deps, cache.entries[key]);
          if (matched.question) {
            cache.entries[key] = { question: matched.question };
            await adapter.write(cachePath, JSON.stringify(cache, null, 2));
          }
        }
        if (plugin.smartPaperCancelled) throw new Error("用户停止");
        const result = await prepareRow(plugin, row, matched, file, assetsDir, outputDir, deps);
        rows.push(result);
      } catch (error) {
        const message = String(error?.message || error);
        if (deps.isJiaoyanyunStopError(error) || plugin.smartPaperCancelled) stopped = message;
        const result = await prepareOffline(plugin, row, `本题未完成：${message}`, file, outputDir);
        rows.push(result);
      }
    } else {
      rows.push(await prepareOffline(plugin, row, matched.reason, file, outputDir));
    }
    deps.notify(`智能整理 ${row.index}/${parsed.rows.length}：${rows.at(-1).issues.length ? "已输出，含待核对项" : "已补全"}`);
  }
  const paths = {};
  for (const [mode, label] of [["student", "学生版"], ["teacher", "教师版"], ["answer", "答案版"]]) {
    paths[mode] = `${outputDir}/${base}${label}.md`;
    await adapter.write(paths[mode], render(base, rows, mode));
  }
  if (parsed.appendix) await adapter.write(`${outputDir}/原文答案附录待核对.md`, parsed.appendix);
  const reviewCount = rows.filter(row => row.issues.length).length;
  const reportPath = `${outputDir}/补全核对清单.md`;
  const report = ["# 智能补全核对清单", "", `原文件：[[${file.path}]]（未修改）`, "", `共 ${rows.length} 道；${reviewCount} 道需核对。${stopped ? `本轮停止原因：${stopped}。` : ""}`, "",
    ...Object.values(paths).map(path => `- [[${path}]]`), "", "三版均为 Markdown。答案版顺序为全部答案、全部解析。配图不设一张上限，只取所选同一题的必要图片，三个版本共用附件。", "",
    "自动套用要求题干、数值和选项顺序经规范化后一致；近似题不自动填入。既有答案/解析优先保留。图片不进行视觉语义识别，已有图、整页截图及图文含答案的情况请人工复核。缺项不会编造。", "",
    "再次对原题集运行可复用匹配与图片缓存，并产生新的导出目录，不覆盖以前的导出或手工编辑。", ""];
  for (const row of rows) {
    report.push(`## 第${row.index}题（原编号 ${row.originalNo}）`, "", `补充：${row.added?.join("、") || "无"}。`, "");
    if (row.link) report.push(`[题库原题](${row.link}) · 题号 ${row.matchedId}`, "");
    if (row.candidateUrl) report.push(`[待人工确认的候选](${row.candidateUrl})`, "");
    report.push(...(row.issues.length ? row.issues.map(issue => `- ${issue}`) : ["- 已匹配并整理，无自动检测出的缺项。"]), "");
  }
  await adapter.write(reportPath, report.join("\n"));
  return { total: rows.length, reviewCount, reportPath, paths, rows, stopped: Boolean(stopped) };
}

// On throttle/auth/cancellation, never attempt more network calls for fallback output.
async function prepareOffline(plugin, row, reason, file, outputDir) {
  const result = { ...row, issues: [...row.issues, reason], added: [] };
  for (const field of ["problem", "answer", "analysis"]) {
    for (const ref of imageRefs(result[field])) {
      const path = await localAsset(plugin, file, ref);
      result[field] = result[field].replace(ref.token, path ? `![${ref.alt}](<${relative(outputDir, path)}>)` : "[此处图片待补充]");
      if (!path) result.issues.push(`${field === "problem" ? "题目" : field === "answer" ? "答案" : "解析"}图片未处理`);
    }
    if (missing(result[field])) result[field] = PENDING;
  }
  return result;
}

module.exports = { run, parse, splitFields, solutionMarker, fromApi, htmlMarkdown, canonical, similarity, imageRefs, render, chooseMatch, prepareRow, prepareOffline, relative, missing };
