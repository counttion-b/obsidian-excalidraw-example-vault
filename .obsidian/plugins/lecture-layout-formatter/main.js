const { Notice, Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const DEFAULT_SETTINGS = {
  // 选项宽度按“汉字约 2 个单位、英文/数字约 1 个单位”估算。
  fourColumnMaxUnits: 18,
  twoColumnMaxUnits: 34,
  // 图片宽度使用 px；以 Obsidian 的 A4 竖版打印为目标。
  normalImageWidth: 200,
  portraitImageWidth: 180,
  wideImageWidth: 560,
  wideRatio: 1.8
};

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function visualUnits(text) {
  const cleaned = String(text)
    .replace(/!\[\[[^\]]+\]\]/g, "图")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "图")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}^_]/g, "")
    .replace(/[$`*~]/g, "");

  let units = 0;
  for (const character of cleaned) {
    if (/\s/.test(character)) continue;
    const code = character.codePointAt(0);
    const isWide =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef);
    units += isWide ? 2 : 1;
  }
  return units;
}

function quoteDepth(line) {
  return (String(line).match(/(^|\s)>\s*/g) || []).length;
}

function collectOptionItems(lines, headerIndex) {
  const header = lines[headerIndex];
  const headerDepth = quoteDepth(header);
  const items = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*$/.test(line)) break;
    if (quoteDepth(line) < headerDepth) break;

    const match = line.match(/^\s*(?:>\s*)+[-*]\s*([A-H])\.\s*(.*)$/i);
    if (match) {
      items.push({ letter: match[1].toUpperCase(), text: match[2] });
    }
  }

  return items;
}

function chooseOptionColumns(items, settings) {
  if (items.length <= 1) return 1;
  if (items.length === 2) return 2;

  const longest = Math.max(...items.map((item) => visualUnits(item.text)));
  if (longest <= settings.fourColumnMaxUnits) return 4;
  if (longest <= settings.twoColumnMaxUnits) return 2;
  return 1;
}

function formatOptionCallouts(lines, settings) {
  let changed = 0;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const callout = line.match(/\[!opts\d+\]/i);
    if (!callout) continue;

    const items = collectOptionItems(lines, index);
    if (items.length < 2) continue;

    const columns = chooseOptionColumns(items, settings);
    const nextLine = line.replace(/\[!opts\d+\]/i, `[!opts${columns}]`);
    if (nextLine !== line) {
      lines[index] = nextLine;
      changed += 1;
    }
  }

  return changed;
}

function splitWikiEmbed(inner) {
  const parts = inner.split("|");
  const path = (parts.shift() || "").trim();
  const dimensionPattern = /^\s*\d+(?:\s*x\s*\d+)?\s*$/i;
  const dimensionIndex = parts.findIndex((part) => dimensionPattern.test(part));
  return { path, parts, dimensionIndex, dimensionPattern };
}

function withImageWidth(inner, width) {
  const parsed = splitWikiEmbed(inner);
  if (!parsed.path) return inner;

  if (parsed.dimensionIndex >= 0) {
    parsed.parts[parsed.dimensionIndex] = String(width);
  } else {
    parsed.parts.push(String(width));
  }

  return [parsed.path, ...parsed.parts].join("|");
}

function imageWidthForSize(width, height, settings) {
  if (!width || !height) return settings.normalImageWidth;
  const ratio = width / height;
  if (ratio >= settings.wideRatio) return settings.wideImageWidth;
  if (ratio < 1) return settings.portraitImageWidth;
  return settings.normalImageWidth;
}

class LectureLayoutFormatterPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.imageSizeCache = new Map();

    this.addCommand({
      id: "format-current-note",
      name: "一键排版：当前笔记",
      callback: () => this.formatActiveNote()
    });

    this.addRibbonIcon("layout-dashboard", "一键排版当前笔记", () => {
      this.formatActiveNote();
    });

    this.addSettingTab(new LectureLayoutSettingTab(this.app, this));
  }

  async formatActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      new Notice("请先打开一个 Markdown 笔记。");
      return;
    }

    const original = await this.app.vault.read(file);
    const result = await this.formatMarkdown(original, file.path);

    if (result.text === original) {
      new Notice("当前笔记已经符合排版规则，没有需要修改的地方。");
      return;
    }

    await this.app.vault.modify(file, result.text);
    const unresolved = result.unresolvedImages > 0
      ? `；${result.unresolvedImages} 张图片未找到，已保持原样`
      : "";
    new Notice(
      `排版完成：${result.optionGroups} 个选项组，${result.resizedImages} 张图片${unresolved}`
    );
  }

  async formatMarkdown(content, sourcePath) {
    const lines = content.split(/\r?\n/);
    const optionGroups = formatOptionCallouts(lines, this.settings);
    const imageResult = await this.resizeWikiImages(lines, sourcePath);

    return {
      text: lines.join(content.includes("\r\n") ? "\r\n" : "\n"),
      optionGroups,
      resizedImages: imageResult.resizedImages,
      unresolvedImages: imageResult.unresolvedImages
    };
  }

  async resizeWikiImages(lines, sourcePath) {
    let resizedImages = 0;
    let unresolvedImages = 0;
    let inFence = false;
    this.imageSizeCache.clear();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !line.includes("![[")) continue;

      const pattern = /!\[\[([^\]\n]+)\]\]/g;
      let match;
      let cursor = 0;
      let changedLine = "";
      let lineChanged = false;

      while ((match = pattern.exec(line)) !== null) {
        changedLine += line.slice(cursor, match.index);
        cursor = pattern.lastIndex;

        const parsed = splitWikiEmbed(match[1]);
        const file = this.resolveImageFile(parsed.path, sourcePath);
        if (!file) {
          changedLine += match[0];
          unresolvedImages += 1;
          continue;
        }

        const size = await this.readImageSize(file);
        if (!size) {
          changedLine += match[0];
          unresolvedImages += 1;
          continue;
        }

        const targetWidth = imageWidthForSize(size.width, size.height, this.settings);
        const replacement = `![[${withImageWidth(match[1], targetWidth)}]]`;
        changedLine += replacement;
        if (replacement !== match[0]) {
          resizedImages += 1;
          lineChanged = true;
        }
      }

      if (!lineChanged) continue;
      changedLine += line.slice(cursor);
      lines[lineIndex] = changedLine;
    }

    return { resizedImages, unresolvedImages };
  }

  resolveImageFile(linkpath, sourcePath) {
    const cleanPath = linkpath.split("#")[0].split("?")[0].trim();
    if (!cleanPath || /^(https?:|data:|app:)/i.test(cleanPath)) return null;

    const fromMetadata = this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath);
    if (fromMetadata instanceof TFile) return fromMetadata;

    const normalized = cleanPath.replace(/^\/+/, "").replace(/\\/g, "/");
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    return direct instanceof TFile ? direct : null;
  }

  async readImageSize(file) {
    if (this.imageSizeCache.has(file.path)) {
      return this.imageSizeCache.get(file.path);
    }

    const result = await new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 3000);
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish(null);
      image.src = this.app.vault.getResourcePath(file);
    });

    this.imageSizeCache.set(file.path, result);
    return result;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class LectureLayoutSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "讲义一键排版" });

    containerEl.createEl("p", {
      text: "在当前 Markdown 笔记中运行“一键排版：当前笔记”。选项和图片只会在笔记源文件中调整，不会改动图片原文件。"
    });

    this.addNumberSetting(
      containerEl,
      "四列阈值",
      "选项最长不超过这个显示宽度时使用 opts4（四列一行）。默认 18。",
      "fourColumnMaxUnits",
      DEFAULT_SETTINGS.fourColumnMaxUnits
    );
    this.addNumberSetting(
      containerEl,
      "两列阈值",
      "超过四列阈值但不超过这个宽度时使用 opts2（两列两行）。默认 34。",
      "twoColumnMaxUnits",
      DEFAULT_SETTINGS.twoColumnMaxUnits
    );

    containerEl.createEl("h3", { text: "图片宽度（px）" });
    this.addNumberSetting(
      containerEl,
      "普通图片宽度",
      "方形、横向不明显的图片使用。默认 200。",
      "normalImageWidth",
      DEFAULT_SETTINGS.normalImageWidth
    );
    this.addNumberSetting(
      containerEl,
      "竖向图片宽度",
      "高度大于宽度的图片使用。默认 180。",
      "portraitImageWidth",
      DEFAULT_SETTINGS.portraitImageWidth
    );
    this.addNumberSetting(
      containerEl,
      "宽幅图片宽度",
      "宽高比达到阈值的横向图片使用。默认 560。",
      "wideImageWidth",
      DEFAULT_SETTINGS.wideImageWidth
    );
    this.addDecimalSetting(
      containerEl,
      "宽幅判定比例",
      "图片宽度 ÷ 高度达到这个值，就按宽幅图片处理。默认 1.8。",
      "wideRatio",
      DEFAULT_SETTINGS.wideRatio
    );
  }

  addNumberSetting(containerEl, name, description, key, fallback) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.settings[key] ?? fallback));
        text.onChange(async (value) => {
          this.plugin.settings[key] = positiveInt(value, fallback);
          await this.plugin.saveSettings();
        });
      });
  }

  addDecimalSetting(containerEl, name, description, key, fallback) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.step = "0.1";
        text.setValue(String(this.plugin.settings[key] ?? fallback));
        text.onChange(async (value) => {
          this.plugin.settings[key] = positiveNumber(value, fallback);
          await this.plugin.saveSettings();
        });
      });
  }
}

module.exports = LectureLayoutFormatterPlugin;
