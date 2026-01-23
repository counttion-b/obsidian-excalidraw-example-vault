/**
 * QuickAdd User Script
 * Renumber ALL H6 headings globally as EXACT lines: "###### 1", "###### 2", ...
 * This will NEVER produce "###### 1 4" because it rewrites the whole line.
 * Skips fenced code blocks (``` / ~~~).
 */

module.exports = async ({ app }) => {
    const file = app.workspace.getActiveFile();
    if (!file) {
      new Notice("没有找到当前打开的文件");
      return;
    }
  
    const original = await app.vault.read(file);
    const lines = original.split(/\r?\n/);
  
    let inFence = false;
    let n = 0;
  
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
  
      // Toggle fenced code blocks
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
  
      // Match H6 headings robustly:
      // - allows leading spaces
      // - requires exactly 6 #'s
      // - allows anything after (including existing numbers/text)
      if (/^\s*######(\s+.*)?$/.test(line)) {
        n += 1;
        // Rewrite ENTIRE line to avoid "###### 1 4"
        lines[i] = `###### ${n}`;
      }
    }
  
    const updated = lines.join("\n");
  
    if (updated === original) {
      new Notice("未发生变化（可能没有 H6 或已是最新）");
      return;
    }
  
    await app.vault.modify(file, updated);
    new Notice(`完成：H6 全局重编号 ${n} 个`);
  };
  