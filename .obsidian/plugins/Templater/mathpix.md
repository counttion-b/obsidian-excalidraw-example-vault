<%*
const raw = await tp.system.clipboard();  // 读取剪贴板
const t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

// 识别 A-D 选项（兼容 A. / A． / A、 / A)）
const optRe = /^\s*([A-D])\s*[\.．、\)]\s*(.+?)\s*$/gm;
let m, options = [];
while ((m = optRe.exec(t)) !== null) {
  options.push([m[1], m[2].replace(/\s+/g, " ").trim()]);
}

// 题干 = 选项前面的部分
let stem = t;
if (options.length) {
  const first = t.search(optRe);
  stem = t.slice(0, first).trim();
}

// 题干每行前加 "> "
const stemBlock = stem
  .split("\n")
  .map(l => l.trim() ? `> ${l}` : `>`)
  .join("\n");

// 选项块
let optsBlock = "";
if (options.length) {
  optsBlock = [
    ">",
    "> > [!opts2]",
    ...options.map(([L, c]) => `> > - ${L}. ${c}`)
  ].join("\n");
}

tR = (stemBlock + (optsBlock ? "\n" + optsBlock : "")).trim();
%>
