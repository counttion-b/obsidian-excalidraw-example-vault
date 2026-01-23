<%*
let raw = tp.system.clipboard();
if (raw && typeof raw.then === "function") raw = await raw;

const t0 = (raw || "")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n")
  .trim();

const lines = t0.split("\n");

// 取第一条非空行
let firstLine = "";
let restLines = lines;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim()) {
    firstLine = lines[i].trim();
    restLines = lines.slice(i + 1);
    break;
  }
}

// ---------- 智能判断：第一行是否像“来源” ----------
const defaultSource = "*例题*";

function looksLikeSource(s) {
  if (!s) return false;
  const t = s.trim();

  // 关键词：学年/期中/期末/月考/联考/模拟/真题/试题/试卷/卷/校/区/市/省 等
  const kw = /(学年|期中|期末|月考|联考|模拟|真题|试题|试卷|卷|校|学校|中学|区|市|省|统考|会考|高考|中考|学探诊)/;

  // 常见年份/范围：2022、2022-2023、2022～2023
  const year = /(19|20)\d{2}(\s*[-～~—]\s*(19|20)\d{2})?/;

  // “第x题/第x问/第x章”这类标记
  const idx = /第\s*\d+\s*(题|问|章|节)/;

  // 如果第一行很短但像“来源标签”
  // 例如：学探诊p41 / 课本p12 / 例题3 等
  const shortTag = /(p\s*\d+|P\s*\d+|例题\s*\d+|练习\s*\d+)/;

  // 判断：满足任一类即可
  return kw.test(t) || year.test(t) || idx.test(t) || shortTag.test(t);
}

// 如果第一行像来源，就用它；否则用默认例题，并把第一行并回题干
let source = defaultSource;
let bodyTextRaw = "";

if (looksLikeSource(firstLine)) {
  source = firstLine;
  bodyTextRaw = restLines.join("\n").trim();
} else {
  source = defaultSource;
  bodyTextRaw = [firstLine, ...restLines].join("\n").trim();
}

// ---------- 选项解析 ----------
const optRe = /^\s*([A-D])\s*[\.．、\)]\s*(.+?)\s*$/gm;

let options = [];
let m;
while ((m = optRe.exec(bodyTextRaw)) !== null) {
  options.push([m[1], m[2].replace(/\s+/g, " ").trim()]);
}

// 题干 = 第一个选项之前
let stem = bodyTextRaw;
if (options.length > 0) {
  const firstIndex = bodyTextRaw.search(optRe);
  stem = bodyTextRaw.slice(0, firstIndex).trim();
}

// ---------- 输出 ----------

// 自动加六级标题（不留空行，必须紧贴 ti）
const h6 = "######\n";

// callout header：来源
const header = `> [!ti] ${source}\n`;

const stemBlock = (stem || "")
  .split("\n")
  .map(l => l.trim() ? `> ${l}` : `>`)
  .join("\n");

// 选项块
let optsBlock = "";
if (options.length > 0) {
  const optLines = options.map(([L, c]) => `> > - ${L}. ${c}`);
  optsBlock = [">", "> > [!opts2]", ...optLines].join("\n");
}

tR = (h6 + header + stemBlock + (optsBlock ? "\n" + optsBlock : "")).trim();
%>
