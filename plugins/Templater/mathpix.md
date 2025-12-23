<%*
let raw = tp.system.clipboard();
if (raw && typeof raw.then === "function") raw = await raw;

const t0 = (raw || "")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n")
  .trim();

const lines = t0.split("\n");

// 取第一条“非空行”作为标题/来源
let title = "";
let bodyLines = lines;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim()) {
    title = lines[i].trim();
    bodyLines = lines.slice(i + 1);
    break;
  }
}

// body 是剩余所有行
const bodyText = bodyLines.join("\n").trim();

// 匹配 A-D 选项（兼容 A. / A． / A、 / A)）
const optRe = /^\s*([A-D])\s*[\.．、\)]\s*(.+?)\s*$/gm;

let options = [];
let m;
while ((m = optRe.exec(bodyText)) !== null) {
  options.push([m[1], m[2].replace(/\s+/g, " ").trim()]);
}

// 题干 = 第一个选项之前
let stem = bodyText;
if (options.length > 0) {
  const firstIndex = bodyText.search(optRe);
  stem = bodyText.slice(0, firstIndex).trim();
}

// 整体输出（外层 callout）
const header = title ? `> [!ti] ${title}\n` : `> [!ti]\n`;

const stemBlock = stem
  .split("\n")
  .map(l => l.trim() ? `> ${l}` : `>`)
  .join("\n");

// 选项块
let optsBlock = "";
if (options.length > 0) {
  const optLines = options.map(([L, c]) => `> > - ${L}. ${c}`);
  optsBlock = [">", "> > [!opts2]", ...optLines].join("\n");
}

tR = (header + stemBlock + (optsBlock ? "\n" + optsBlock : "")).trim();
%>
