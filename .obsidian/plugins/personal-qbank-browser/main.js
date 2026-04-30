const { ItemView, MarkdownRenderer, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl, setIcon } = require("obsidian");

const VIEW_TYPE = "personal-qbank-browser-view";
const QUESTION_DIRS = ["questions/", "题库/questions/"];
const EXPORT_DIRS = ["exports", "题库/exports"];
const DEFAULT_JIAOYANYUN_API = "https://app-pub.jiaoyanyun.com/xbresource-pub";
const DEFAULT_JIAOYANYUN_WEB = "https://xbresource.jiaoyanyun.com";
const DEFAULT_SETTINGS = {
  jiaoyanyunToken: "",
  paperSource: "",
  subjectId: "4",
  gradeGroupId: "3",
  minMatchScore: 35
};

const PRESTIGE_SCHOOLS = [
  "人大附中",
  "中国人民大学附属中学",
  "北京四中",
  "北京市第四中学",
  "十一学校",
  "北京市十一学校",
  "清华附中",
  "清华大学附属中学",
  "北大附中",
  "北京大学附属中学",
  "北京八中",
  "北京市第八中学",
  "一零一中学",
  "北京一零一中学",
  "首师大附中",
  "首都师范大学附属中学",
  "五十五中",
  "北京市第五十五中学",
  "西城外国语学校"
];

module.exports = class PersonalQbankBrowserPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new QbankSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, leaf => new QbankBrowserView(leaf, this));
    this.addRibbonIcon("library-big", "打开题库筛选", () => this.activateView());
    this.addCommand({
      id: "open-personal-qbank-browser",
      name: "打开题库筛选",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "export-current-note-student",
      name: "导出当前选题为学生版",
      callback: () => this.exportCurrentNote("student")
    });
    this.addCommand({
      id: "export-current-note-answer",
      name: "导出当前选题为答案版",
      callback: () => this.exportCurrentNote("answer")
    });
    this.addCommand({
      id: "export-current-note-detail",
      name: "导出当前选题为详解版",
      callback: () => this.exportCurrentNote("detail")
    });
    this.addCommand({
      id: "sync-current-question-title",
      name: "同步当前题标题",
      callback: () => this.syncCurrentQuestionTitle()
    });
    this.addCommand({
      id: "sync-all-question-titles",
      name: "同步全部题标题",
      callback: () => this.syncAllQuestionTitles()
    });
    this.addCommand({
      id: "fill-current-paper-images",
      name: "当前纯文字试卷：一键填充图片",
      callback: () => this.fillCurrentPaperImages()
    });
    this.addCommand({
      id: "make-current-paper-answer",
      name: "当前试卷：一键制作答案版",
      callback: () => this.exportCurrentPaperVariant("answer")
    });
    this.addCommand({
      id: "make-current-paper-detail",
      name: "当前试卷：一键制作解析版",
      callback: () => this.exportCurrentPaperVariant("detail")
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async exportCurrentNote(mode) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开一个包含题目链接的 md 文件");
      return;
    }
    const activeContent = await this.app.vault.read(activeFile);
    const questions = await loadAllQuestions(this.app);
    const selected = questionsFromLinks(this.app, activeFile, activeContent, questions);
    if (!selected.length) {
      new Notice("当前文件里没有找到题目链接");
      return;
    }
    const exportPath = await writeExport(this.app, activeFile, selected, mode);
    new Notice(`已导出 ${selected.length} 道题`);
    this.app.workspace.openLinkText(exportPath, "", false);
  }

  async syncCurrentQuestionTitle() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !isQuestionFile(activeFile)) {
      new Notice("请先打开一道题目文件");
      return;
    }
    const newPath = await syncQuestionTitle(this.app, activeFile);
    new Notice("当前题标题已同步");
    if (newPath && newPath !== activeFile.path) {
      this.app.workspace.openLinkText(newPath, "", false);
    }
  }

  async syncAllQuestionTitles() {
    const files = this.app.vault.getMarkdownFiles().filter(file => isQuestionFile(file));
    let count = 0;
    for (const file of files) {
      await syncQuestionTitle(this.app, file);
      count += 1;
    }
    new Notice(`已同步 ${count} 道题标题`);
  }

  async fillCurrentPaperImages() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开一份纯文字试卷 md");
      return;
    }
    if (!this.settings.jiaoyanyunToken) {
      new Notice("请先在插件设置里填写教研云 schoolToken");
      return;
    }
    const content = await this.app.vault.read(activeFile);
    const source = paperSourceFromContent(content) || this.settings.paperSource || activeFile.basename.replace(/(学生版|答案版|解析版|详解版|带图版|带图)$/g, "");
    const blocks = parsePaperBlocks(content);
    if (!blocks.length) {
      new Notice("当前文件没有找到 > [!ti] 题目块");
      return;
    }

    new Notice(`开始补图：共 ${blocks.length} 道题`);
    const attachmentsDir = `${activeFile.parent?.path && activeFile.parent.path !== "/" ? `${activeFile.parent.path}/` : ""}attachments/${safeFilename(activeFile.basename)}`;
    await ensureFolder(this.app, attachmentsDir);

    const summaries = [];
    let rewritten = content;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      const questionNo = block.questionNo || String(index + 1);
      try {
        const match = await this.findJiaoyanyunMatch(block.searchText);
        if (!match || match.score < Number(this.settings.minMatchScore || 0)) {
          summaries.unshift({ questionNo, matched: false, score: match?.score || 0, answer: "", analysis: "" });
          rewritten = replaceRange(rewritten, block.start, block.end, retitlePaperBlock(block.raw, source, questionNo));
          continue;
        }

        const detail = match.question;
        const questionDir = `${attachmentsDir}/第${questionNo}题`;
        await ensureFolder(this.app, questionDir);
        const imageMap = await this.downloadQuestionImages(detail.imageUrls, questionDir);
        const replacement = renderMatchedPaperBlock(block.raw, source, questionNo, relativeImageMap(imageMap, activeFile));
        rewritten = replaceRange(rewritten, block.start, block.end, replacement);
        summaries.unshift({
          questionNo,
          matched: true,
          score: match.score,
          url: detail.url,
          answer: detail.answer || "",
          analysis: detail.analysis || "",
          imageCount: imageMap.size
        });
      } catch (error) {
        console.error(error);
        summaries.unshift({ questionNo, matched: false, score: 0, answer: "", analysis: "", error: String(error?.message || error) });
        rewritten = replaceRange(rewritten, block.start, block.end, retitlePaperBlock(block.raw, source, questionNo));
      }
    }

    rewritten = rewritePaperTitle(rewritten, source);
    const outputPath = await uniqueVaultPath(this.app, siblingPath(activeFile, `${activeFile.basename}带图版.md`), activeFile.path);
    await this.app.vault.adapter.write(outputPath, rewritten);
    await writePaperCache(this.app, outputPath, summaries);
    new Notice(`已生成带图版：${summaries.filter(item => item.matched).length}/${blocks.length} 道匹配成功`);
    this.app.workspace.openLinkText(outputPath, "", false);
  }

  async findJiaoyanyunMatch(text) {
    const queries = buildSearchQueries(text, 7, 120);
    const seen = new Set();
    const candidates = [];
    for (const query of queries) {
      const results = await this.searchJiaoyanyun(query, 20);
      for (const item of results) {
        const id = String(item.queId || item.questionId || item.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const question = await this.fetchJiaoyanyunDetail(id, item);
        const score = scoreText(text, `${question.stem} ${question.options.join(" ")} ${question.source}`);
        candidates.push({ score, question });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  async searchJiaoyanyun(query, limit) {
    const response = await requestUrl({
      url: `${DEFAULT_JIAOYANYUN_API}/v1/question/page`,
      method: "POST",
      headers: this.jiaoyanyunHeaders(),
      contentType: "application/json",
      body: JSON.stringify({
        subjectId: this.settings.subjectId || "4",
        gradeGroupId: this.settings.gradeGroupId || "3",
        pageNo: 1,
        pageSize: limit,
        searchContent: query,
        isSearchImg: 0
      })
    });
    return findQuestionItems(response.json).slice(0, limit);
  }

  async fetchJiaoyanyunDetail(questionId, fallback) {
    let item = fallback || {};
    try {
      const response = await requestUrl({
        url: `${DEFAULT_JIAOYANYUN_API}/v1/question/detailByIds`,
        method: "POST",
        headers: this.jiaoyanyunHeaders(),
        contentType: "application/json",
        body: JSON.stringify({
          idList: [String(questionId)],
          subjectId: this.settings.subjectId || "4",
          gradeGroupId: this.settings.gradeGroupId || "3"
        })
      });
      if (Array.isArray(response.json?.data) && response.json.data[0]) {
        item = Object.assign({}, item, response.json.data[0]);
      }
    } catch (error) {
      console.warn("detailByIds failed", error);
    }
    return questionFromJiaoyanyunItem(item, this.settings.subjectId || "4", this.settings.gradeGroupId || "3");
  }

  jiaoyanyunHeaders() {
    return {
      "Referer": `${DEFAULT_JIAOYANYUN_WEB}/`,
      "Origin": DEFAULT_JIAOYANYUN_WEB,
      "authorization": this.settings.jiaoyanyunToken || ""
    };
  }

  async downloadQuestionImages(imageUrls, folderPath) {
    const imageMap = new Map();
    let index = 1;
    for (const url of imageUrls) {
      try {
        const response = await requestUrl({ url, method: "GET", headers: this.jiaoyanyunHeaders() });
        const suffix = imageSuffix(response.headers?.["content-type"], url);
        const path = `${folderPath}/image_${String(index).padStart(2, "0")}${suffix}`;
        await this.app.vault.adapter.writeBinary(path, response.arrayBuffer);
        imageMap.set(url, path);
        index += 1;
      } catch (error) {
        console.warn("download image failed", url, error);
      }
    }
    return imageMap;
  }

  async exportCurrentPaperVariant(mode) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开一份试卷 md");
      return;
    }
    const content = await this.app.vault.read(activeFile);
    const blocks = parsePaperBlocks(content);
    if (!blocks.length) {
      new Notice("当前文件没有找到题目块");
      return;
    }
    let cache = await readPaperCache(this.app, activeFile.path);
    if (!cache.length && this.settings.jiaoyanyunToken) {
      new Notice("没有找到补图缓存，正在按题干检索答案解析");
      cache = [];
      for (const block of blocks) {
        const match = await this.findJiaoyanyunMatch(block.searchText);
        cache.push({
          questionNo: block.questionNo,
          matched: Boolean(match),
          score: match?.score || 0,
          url: match?.question?.url || "",
          answer: match?.question?.answer || "",
          analysis: match?.question?.analysis || ""
        });
      }
      await writePaperCache(this.app, activeFile.path, cache);
    }
    const cacheByNo = new Map(cache.map(item => [String(item.questionNo || ""), item]));
    const source = paperSourceFromContent(content) || this.settings.paperSource || activeFile.basename.replace(/(学生版|答案版|解析版|详解版|带图版|带图)$/g, "");
    const title = `${source}${mode === "answer" ? "答案版" : "解析版"}`;
    const markdown = renderPaperVariant(title, blocks, cacheByNo, mode);
    const exportDir = exportDirForActiveFile(activeFile);
    await ensureFolder(this.app, exportDir);
    const outputPath = await uniqueVaultPath(this.app, `${exportDir}/${safeFilename(title)}.md`, activeFile.path);
    await this.app.vault.adapter.write(outputPath, markdown);
    new Notice(`已生成${mode === "answer" ? "答案版" : "解析版"}`);
    this.app.workspace.openLinkText(outputPath, "", false);
  }
};

class QbankBrowserView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.questions = [];
    this.selectedTags = new Set();
    this.query = "";
    this.sortMode = "best";
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "题库筛选";
  }

  getIcon() {
    return "library-big";
  }

  async onOpen() {
    this.containerEl.addClass("qbank-browser");
    await this.loadQuestions();
    this.render();
  }

  async loadQuestions() {
    this.questions = await loadAllQuestions(this.app);
  }

  render() {
    const root = this.contentEl;
    root.empty();

    const shell = root.createDiv({ cls: "qbank-shell" });
    this.renderToolbar(shell);

    const content = shell.createDiv({ cls: "qbank-content" });
    this.renderTags(content.createDiv({ cls: "qbank-tags-panel" }));
    this.renderResults(content.createDiv({ cls: "qbank-results-panel" }));
  }

  renderToolbar(parent) {
    const toolbar = parent.createDiv({ cls: "qbank-toolbar" });
    const left = toolbar.createDiv({ cls: "qbank-toolbar-title" });
    left.createEl("h2", { text: "题库筛选" });
    left.createEl("div", { cls: "qbank-muted", text: `${this.questions.length} 道题` });

    const controls = toolbar.createDiv({ cls: "qbank-controls" });
    const inputWrap = controls.createDiv({ cls: "qbank-search-wrap" });
    setIcon(inputWrap.createSpan({ cls: "qbank-search-icon" }), "search");
    const search = inputWrap.createEl("input", {
      type: "search",
      value: this.query,
      placeholder: "搜索题干、标题、来源"
    });
    search.addEventListener("input", event => {
      this.query = event.target.value;
      this.render();
    });

    const sort = controls.createEl("select");
    [
      ["best", "按来源优先"],
      ["newest", "按年份最新"],
      ["title", "按标题"]
    ].forEach(([value, label]) => {
      const option = sort.createEl("option", { text: label, value });
      option.selected = value === this.sortMode;
    });
    sort.addEventListener("change", event => {
      this.sortMode = event.target.value;
      this.render();
    });

    const refresh = controls.createEl("button", { cls: "clickable-icon qbank-icon-button", attr: { "aria-label": "刷新题库" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", async () => {
      await this.loadQuestions();
      new Notice("题库已刷新");
      this.render();
    });
  }

  renderTags(parent) {
    parent.createEl("div", { cls: "qbank-panel-title", text: "标签" });
    if (this.selectedTags.size) {
      const selected = parent.createDiv({ cls: "qbank-selected-tags" });
      for (const tag of [...this.selectedTags].sort(tagSort)) {
        selected.appendChild(this.tagButton(tag, true));
      }
      const clear = parent.createEl("button", { cls: "qbank-clear", text: "清空选择" });
      clear.addEventListener("click", () => {
        this.selectedTags.clear();
        this.render();
      });
    }

    const groups = groupTags(this.questions);
    for (const group of groups) {
      const details = parent.createEl("details", { cls: "qbank-tag-group" });
      details.open = group.open;
      details.createEl("summary", { text: group.name });
      const chips = details.createDiv({ cls: "qbank-tag-list" });
      for (const item of group.tags) {
        chips.appendChild(this.tagButton(item.tag, this.selectedTags.has(item.tag), item.count));
      }
    }
  }

  tagButton(tag, active, count) {
    const button = document.createElement("button");
    button.className = active ? "qbank-tag active" : "qbank-tag";
    button.type = "button";
    button.textContent = count ? `${tag} ${count}` : tag;
    button.addEventListener("click", () => {
      if (this.selectedTags.has(tag)) {
        this.selectedTags.delete(tag);
      } else {
        this.selectedTags.add(tag);
      }
      this.render();
    });
    return button;
  }

  renderResults(parent) {
    const results = this.filteredQuestions();
    const header = parent.createDiv({ cls: "qbank-results-header" });
    header.createEl("div", { cls: "qbank-panel-title", text: `结果 ${results.length}` });
    if (this.selectedTags.size) {
      header.createEl("div", { cls: "qbank-muted", text: [...this.selectedTags].join(" + ") });
    }

    if (!results.length) {
      const empty = parent.createDiv({ cls: "qbank-empty" });
      empty.createEl("p", { text: "没有匹配的题目。" });
      return;
    }

    const list = parent.createDiv({ cls: "qbank-result-list" });
    for (const question of results) {
      this.renderCard(list, question);
    }
  }

  filteredQuestions() {
    const selected = [...this.selectedTags];
    const query = normalize(this.query);
    let results = this.questions.filter(question => {
      if (selected.length && !selected.every(tag => question.tags.includes(tag))) {
        return false;
      }
      if (query && !normalize(`${question.title} ${question.body} ${question.sources.map(source => source.name).join(" ")}`).includes(query)) {
        return false;
      }
      return true;
    });

    results = results.sort((a, b) => {
      if (this.sortMode === "newest") return b.bestSource.year - a.bestSource.year || a.title.localeCompare(b.title, "zh-Hans-CN");
      if (this.sortMode === "title") return a.title.localeCompare(b.title, "zh-Hans-CN");
      return b.bestSource.score - a.bestSource.score || b.bestSource.year - a.bestSource.year || a.title.localeCompare(b.title, "zh-Hans-CN");
    });
    return results;
  }

  renderCard(parent, question) {
    const card = parent.createDiv({ cls: "qbank-card" });
    const head = card.createDiv({ cls: "qbank-card-head" });
    const titleWrap = head.createDiv({ cls: "qbank-card-title-wrap" });
    titleWrap.createEl("h3", { text: question.title });
    titleWrap.createEl("div", { cls: "qbank-best-source", text: sourceLabel(question.bestSource) });
    const open = head.createEl("button", { cls: "clickable-icon qbank-icon-button", attr: { "aria-label": "打开原题文件" } });
    setIcon(open, "file-text");
    open.addEventListener("click", () => this.app.workspace.openLinkText(question.file.path, "", false));
    const insert = head.createEl("button", { cls: "clickable-icon qbank-icon-button", attr: { "aria-label": "插入到当前 md" } });
    setIcon(insert, "list-plus");
    insert.addEventListener("click", () => this.insertQuestionLink(question));

    const tagLine = card.createDiv({ cls: "qbank-card-tags" });
    for (const tag of question.tags.slice(0, 12)) {
      const tagEl = tagLine.createEl("button", { cls: "qbank-mini-tag", text: tag });
      tagEl.addEventListener("click", () => {
        this.selectedTags.add(tag);
        this.render();
      });
    }

    const questionBox = card.createDiv({ cls: "qbank-question-box markdown-rendered" });
    MarkdownRenderer.render(this.app, question.questionMd || "暂无题目", questionBox, question.file.path, this.plugin);

    this.renderDetails(card, "答案", question.answerMd || "暂无", question.file.path);
    this.renderDetails(card, "详解", question.analysisMd || "暂无", question.file.path);
    this.renderSources(card, question.sources);
  }

  insertQuestionLink(question) {
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.app.workspace.iterateAllLeaves(leaf => {
        if (!view && leaf.view instanceof MarkdownView && leaf.view.editor) {
          view = leaf.view;
        }
      });
    }
    const link = `[[${question.file.path}|${question.title}]]`;
    if (!view || !view.editor) {
      navigator.clipboard?.writeText(link);
      new Notice("没有正在编辑的 md，题目链接已复制");
      return;
    }
    view.editor.replaceSelection(`${link}\n`);
    new Notice("已插入题目链接");
  }

  renderDetails(parent, title, markdown, sourcePath) {
    const details = parent.createEl("details", { cls: "qbank-fold" });
    details.createEl("summary", { text: title });
    const body = details.createDiv({ cls: "markdown-rendered qbank-fold-body" });
    MarkdownRenderer.render(this.app, markdown, body, sourcePath, this.plugin);
  }

  renderSources(parent, sources) {
    const details = parent.createEl("details", { cls: "qbank-fold qbank-sources" });
    details.createEl("summary", { text: `全部来源 ${sources.length}` });
    const list = details.createEl("ol");
    for (const source of [...sources].sort((a, b) => b.score - a.score || b.year - a.year)) {
      const item = list.createEl("li");
      const linkText = source.url ? item.createEl("a", { text: source.name || "未命名来源", href: source.url }) : item.createSpan({ text: source.name || "未命名来源" });
      if (source.url) linkText.setAttr("target", "_blank");
      const meta = sourceMeta(source);
      if (meta) item.createEl("div", { cls: "qbank-source-meta", text: meta });
    }
  }
}

class QbankSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "个人题库筛选" });

    new Setting(containerEl)
      .setName("教研云 schoolToken")
      .setDesc("用于在 Obsidian 内搜索题库、下载题图、读取答案解析。只保存在本地插件数据中。")
      .addText(text => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("粘贴 schoolToken")
          .setValue(this.plugin.settings.jiaoyanyunToken || "")
          .onChange(async value => {
            this.plugin.settings.jiaoyanyunToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("当前试卷来源")
      .setDesc("仅作为兜底。补图和导出会优先读取当前 md 的一级标题，例如：# 26春北京市第一六六中学高二下期中 #h0。")
      .addText(text => text
        .setPlaceholder("26春北京市第一七一中学高一下期中")
        .setValue(this.plugin.settings.paperSource || "")
        .onChange(async value => {
          this.plugin.settings.paperSource = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("最低匹配分")
      .setDesc("低于该分数的题不会自动替换。一般 35-50 比较合适。")
      .addText(text => text
        .setPlaceholder("35")
        .setValue(String(this.plugin.settings.minMatchScore ?? 35))
        .onChange(async value => {
          this.plugin.settings.minMatchScore = Number(value) || 35;
          await this.plugin.saveSettings();
        }));
  }
}

function parsePaperBlocks(content) {
  const matches = [...content.matchAll(/^>\s*\[!ti\].*$/gm)];
  const blocks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const end = index + 1 < matches.length ? matches[index + 1].index : content.length;
    const raw = content.slice(start, end).trimEnd();
    const title = paperBlockTitle(raw);
    const questionNo = paperQuestionNo(title) || paperQuestionNo(raw) || String(index + 1);
    blocks.push({
      start,
      end,
      raw,
      title,
      questionNo,
      searchText: paperSearchText(raw)
    });
  }
  return blocks;
}

function paperSourceFromContent(content) {
  const text = String(content || "");
  const h0 = text.match(/^#\s+(.+?)\s*#h0\s*$/m);
  const heading = h0 || text.match(/^#\s+(.+?)\s*$/m);
  if (!heading) return "";
  return normalizeWhitespace(heading[1].replace(/#.*$/g, "").replace(/(学生版|答案版|解析版|详解版|带图版|带图)$/g, ""));
}

function paperBlockTitle(raw) {
  const first = String(raw || "").split(/\r?\n/, 1)[0] || "";
  const match = first.match(/\*([^*]+)\*/);
  return normalizeWhitespace(match ? match[1] : first.replace(/^>\s*\[!ti\]\s*/, ""));
}

function paperQuestionNo(text) {
  const match = String(text || "").match(/第\s*(\d{1,3})\s*题/);
  return match ? String(Number(match[1])) : "";
}

function paperSearchText(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  if (lines[0] && /^\s*>\s*\[!ti\]/.test(lines[0])) {
    lines.shift();
  }
  return normalizeWhitespace(
    lines.join("\n")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[\[[^\]]+\]\]/g, " ")
      .replace(/^>+\s?/gm, "")
      .replace(/\[![^\]]+\]/g, " ")
      .replace(/[*_`#>-]+/g, " ")
  );
}

function retitlePaperBlock(raw, source, questionNo) {
  const title = `${source}第${questionNo}题`;
  if (/^>\s*\[!ti\].*$/m.test(raw)) {
    return raw.replace(/^>\s*\[!ti\].*$/m, `> [!ti] *${title}*`);
  }
  return `> [!ti] *${title}*\n${raw}`;
}

function rewritePaperTitle(content, source) {
  if (/^# .+#h0\s*$/m.test(content)) {
    return content.replace(/^# .+#h0\s*$/m, `# ${source} #h0`);
  }
  return content;
}

function replaceRange(text, start, end, replacement) {
  return `${text.slice(0, start)}${replacement.trimEnd()}\n\n${text.slice(end).replace(/^\s+/, "")}`;
}

function renderMatchedPaperBlock(originalRaw, source, questionNo, imageMap) {
  const title = `${source}第${questionNo}题`;
  let raw = retitlePaperBlock(originalRaw, source, questionNo);
  if (!imageMap.size) return raw;
  if (/!\[[^\]]*\]\([^)]+\)/.test(raw)) return raw;

  const imageLines = [...imageMap.values()].map(path => `> ![|200](${path})`);
  const lines = raw.split(/\r?\n/);
  let insertAt = lines.findIndex(line => /^\s*>(?:\s*>\s*)?\[!opts/.test(line));
  if (insertAt === -1) {
    insertAt = lines.findIndex(line => /^\s*#\s+/.test(line));
  }
  if (insertAt === -1) insertAt = lines.length;

  while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, ...imageLines);
  return lines.join("\n");
}

function relativeImageMap(imageMap, activeFile) {
  const base = activeFile.parent?.path && activeFile.parent.path !== "/" ? activeFile.parent.path : "";
  const result = new Map();
  for (const [url, path] of imageMap.entries()) {
    result.set(url, relativeVaultPath(path, base));
  }
  return result;
}

function relativeVaultPath(path, base) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const prefix = base ? `${base.replace(/\/+$/, "")}/` : "";
  return prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function localizePlatformImages(markdown, imageMap) {
  let text = String(markdown || "");
  for (const [url, path] of imageMap.entries()) {
    text = text.split(url).join(path);
  }
  return text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "![|200]($1)");
}

function buildSearchQueries(text, count, maxChars) {
  const cleaned = cleanSearchText(text);
  const option = cleaned.search(/\s[A-G]\s*[\.\．、]\s*/);
  const head = option > 0 ? cleanSearchText(cleaned.slice(0, option)) : cleaned;
  const noFormula = cleanSearchText(cleaned.replace(/\$[^$]*\$/g, " "));
  const headNoFigure = cleanSearchText(head.replace(/如图所示|如下图所示|右图所示|图甲.*?所示|图乙.*?所示/g, " "));
  const sentences = splitSearchSentences(head);
  const parts = [
    head,
    head.slice(0, 80),
    head.slice(0, 50),
    headNoFigure,
    longestSentence(cleaned),
    longestSentence(noFormula),
    ...sentences
  ];
  const result = [];
  const seen = new Set();
  for (const part of parts) {
    const query = normalizeWhitespace(part).slice(0, maxChars).trim();
    if (query.length < 4 || seen.has(query)) continue;
    seen.add(query);
    result.push(query);
    if (result.length >= count) break;
  }
  return result;
}

function cleanSearchText(text) {
  return normalizeWhitespace(String(text || "")
    .replace(/^\s*\d+\s*[.、，]\s*/, "")
    .replace(/\b[A-G]\s*[\.\．、]\s*/g, " ")
    .replace(/\(　　\)|（　　）|\(\s*\)|（\s*）/g, " ")
    .replace(/[，。！？；：()（）【】\[\]{}<>《》]/g, " "));
}

function longestSentence(text) {
  const parts = String(text || "").split(/[。！？；?]/).map(part => part.trim()).filter(Boolean);
  return parts.length ? parts.sort((a, b) => b.length - a.length)[0] : text;
}

function splitSearchSentences(text) {
  return String(text || "")
    .split(/[。！？；?]/)
    .map(part => cleanSearchText(part))
    .filter(part => part.length >= 12)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
}

function scoreText(source, candidate) {
  const a = normalize(source);
  const b = normalize(candidate);
  if (!a || !b) return 0;
  let common = 0;
  const chars = new Set(a);
  for (const char of chars) {
    if (b.includes(char)) common += 1;
  }
  const coverage = common / Math.max(chars.size, 1) * 100;
  const direct = b.includes(a.slice(0, Math.min(30, a.length))) ? 100 : 0;
  return Math.round((coverage * 0.75 + direct * 0.25) * 100) / 100;
}

function findQuestionItems(data) {
  if (Array.isArray(data)) return data.flatMap(findQuestionItems);
  if (!data || typeof data !== "object") return [];
  if (data.queId || data.questionId || data.questionContent || data.quesContent) return [data];
  for (const key of ["list", "records", "rows", "items", "data"]) {
    if (data[key]) {
      const found = findQuestionItems(data[key]);
      if (found.length) return found;
    }
  }
  return Object.values(data).flatMap(findQuestionItems);
}

function questionFromJiaoyanyunItem(item, subjectId, gradeGroupId) {
  const questionId = String(item.queId || item.questionId || item.id || "");
  const stemHtml = contentFromApiItem(item);
  const answerHtml = fieldFromApiItem(item, ["answer", "answers", "referenceAnswer", "correctAnswer", "blankAnswer"]);
  const analysisHtml = fieldFromApiItem(item, ["analysis", "analyze", "answerAnalysis", "explain"]);
  const optionHtmls = optionHtmlValues(item);
  const options = optionsFromApiItem(item);
  const source = sourceFromApiItem(item);
  const url = `${DEFAULT_JIAOYANYUN_WEB}/#/boutique/search?sid=${subjectId}&gid=${gradeGroupId}&queId=${questionId}`;
  const allHtml = [stemHtml, answerHtml, analysisHtml, ...optionHtmls].join("\n");
  return {
    url,
    title: source || questionId || "教研云试题",
    stem: htmlToMarkdownText(stemHtml || JSON.stringify(item)),
    options,
    answer: htmlToMarkdownText(answerHtml || ""),
    analysis: htmlToMarkdownText(analysisHtml || ""),
    source,
    imageUrls: collectImageUrls(allHtml)
  };
}

function firstValue(data, keys) {
  for (const key of keys) {
    if (data?.[key]) return data[key];
  }
  for (const value of Object.values(data || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstValue(value, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function contentFromApiItem(item) {
  const parts = [];
  const content = firstValue(item, ["questionContent", "content", "stem", "body", "quesContent", "question"]);
  if (content) parts.push(String(content));
  (item.childList || []).forEach((child, index) => {
    if (child && typeof child === "object") {
      const childContent = contentFromApiItem(child);
      if (childContent) parts.push(`<p>(${index + 1})</p>${childContent}`);
    }
  });
  return parts.join("\n");
}

function fieldFromApiItem(item, keys) {
  const parts = [];
  for (const key of keys) {
    if (item?.[key]) {
      parts.push(...stringifyApiValue(item[key]));
      break;
    }
  }
  (item.childList || []).forEach((child, index) => {
    if (child && typeof child === "object") {
      const childValue = fieldFromApiItem(child, keys);
      if (childValue) parts.push(`(${index + 1}) ${childValue}`);
    }
  });
  return parts.filter(Boolean).join("\n");
}

function stringifyApiValue(value) {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringifyApiValue);
  if (value && typeof value === "object") {
    for (const key of ["content", "answer", "analysis", "value", "text"]) {
      if (value[key]) return stringifyApiValue(value[key]);
    }
    return [JSON.stringify(value)];
  }
  return [];
}

function optionHtmlValues(item) {
  const values = [];
  for (let group of item.answerOptionList || []) {
    if (!Array.isArray(group)) group = [group];
    for (const option of group) {
      if (option && typeof option === "object") {
        const content = option.content || option.value || option.text;
        if (content) values.push(String(content));
      }
    }
  }
  for (const key of ["optionList", "options", "choiceList", "choices"]) {
    const value = item[key];
    if (Array.isArray(value)) {
      for (const option of value) {
        const content = typeof option === "object" ? option.content || option.value || option.text : option;
        if (content) values.push(String(content));
      }
    }
  }
  (item.childList || []).forEach(child => values.push(...optionHtmlValues(child)));
  return values;
}

function optionsFromApiItem(item) {
  const options = [];
  for (let group of item.answerOptionList || []) {
    if (!Array.isArray(group)) group = [group];
    for (const option of group) {
      if (!option || typeof option !== "object") continue;
      const label = normalizeWhitespace(option.aoVal || option.label || "");
      const content = htmlToMarkdownText(option.content || option.value || "");
      if (content) options.push(label ? `${label}. ${content}` : content);
    }
  }
  if (options.length) return [...new Set(options)];
  for (const key of ["optionList", "options", "choiceList", "choices"]) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    value.forEach((option, index) => {
      const fallback = String.fromCharCode("A".charCodeAt(0) + index);
      const label = typeof option === "object" ? normalizeWhitespace(option.aoVal || option.label || fallback) : fallback;
      const content = htmlToMarkdownText(typeof option === "object" ? option.content || option.value || option.text || "" : option);
      if (content) options.push(`${label}. ${content}`);
    });
  }
  return [...new Set(options)];
}

function sourceFromApiItem(item) {
  const queSource = item.queSource;
  if (Array.isArray(queSource) && queSource.length) return normalizeWhitespace(queSource[0]);
  if (typeof queSource === "string") return normalizeWhitespace(queSource);
  const list = item.questionSourceList;
  if (Array.isArray(list) && list[0]) {
    return normalizeWhitespace([
      namedValue(list[0].schoolYear) ? `${namedValue(list[0].schoolYear)}学年` : "",
      namedValue(list[0].province),
      namedValue(list[0].area),
      namedValue(list[0].school),
      namedValue(list[0].grade),
      namedValue(list[0].semester),
      namedValue(list[0].examType),
      list[0].startQueIndex ? `第${list[0].startQueIndex}题` : ""
    ].join(""));
  }
  return normalizeWhitespace(firstValue(item, ["sourceString", "source", "paperName", "examPaperName"]));
}

function namedValue(value) {
  return normalizeWhitespace(value && typeof value === "object" ? value.name || "" : value || "");
}

function collectImageUrls(html) {
  const urls = [];
  const img = /<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = img.exec(String(html || ""))) !== null) {
    urls.push(absoluteImageUrl(match[1]));
  }
  const markdown = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  while ((match = markdown.exec(String(html || ""))) !== null) {
    urls.push(match[1]);
  }
  return [...new Set(urls.filter(Boolean))];
}

function htmlToMarkdownText(html) {
  let text = String(html || "");
  text = text.replace(/<span[^>]*(?:class=["'][^"']*(?:math|mathjax_content)[^"']*["'])[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/span>/gi, (_, latex) => ` $${htmlEntities(latex)}$ `);
  text = text.replace(/<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi, (_, src) => `\n![|200](${absoluteImageUrl(src)})\n`);
  text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  return htmlEntities(text).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function absoluteImageUrl(src) {
  if (!src || src.startsWith("data:")) return "";
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${DEFAULT_JIAOYANYUN_WEB}${src}`;
  return src;
}

function htmlEntities(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(text || "");
  return textarea.value;
}

function imageSuffix(contentType, url) {
  const type = String(contentType || "").split(";")[0].toLowerCase();
  const byType = { "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" };
  if (byType[type]) return byType[type];
  const match = String(url || "").split("?", 1)[0].match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

async function writePaperCache(app, paperPath, summaries) {
  const cachePath = paperCachePath(paperPath);
  await ensureFolder(app, cachePath.split("/").slice(0, -1).join("/"));
  await app.vault.adapter.write(cachePath, JSON.stringify(summaries, null, 2));
}

async function readPaperCache(app, paperPath) {
  const cachePath = paperCachePath(paperPath);
  if (!(await app.vault.adapter.exists(cachePath))) return [];
  try {
    return JSON.parse(await app.vault.adapter.read(cachePath));
  } catch {
    return [];
  }
}

function paperCachePath(paperPath) {
  const slash = paperPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : paperPath.slice(0, slash + 1);
  const base = slash === -1 ? paperPath : paperPath.slice(slash + 1);
  return `${dir}.paper-image-cache/${base.replace(/\.md$/i, "")}.json`;
}

function renderPaperVariant(title, blocks, cacheByNo, mode) {
  const lines = [`# ${title}`, ""];
  for (const block of blocks) {
    const info = cacheByNo.get(String(block.questionNo || "")) || {};
    if (mode === "answer") {
      lines.push(`${block.questionNo}. ${info.answer || "暂无"}`, "");
    } else {
      lines.push(retitlePaperBlock(block.raw, title.replace(/解析版$/, ""), block.questionNo), "", "### 答案", "", info.answer || "暂无", "", "### 详解", "", info.analysis || "暂无", "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function siblingPath(file, name) {
  return `${file.parent?.path && file.parent.path !== "/" ? `${file.parent.path}/` : ""}${safeFilename(name)}`;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function buildQuestion(file, content, body, meta) {
  const sources = normalizeSources(meta.sources || []);
  const rankedSources = sources.map(source => ({ ...source, ...rankSource(source) }));
  const bestSource = rankedSources.sort((a, b) => b.score - a.score || b.year - a.year)[0] || { name: "", score: 0, year: 0, tier: "来源待补充" };
  return {
    file,
    content,
    body,
    meta,
    title: meta.title || file.basename,
    tags: normalizeTags(meta.tags || []),
    sources: rankedSources,
    bestSource,
    questionMd: section(body, "题目"),
    answerMd: section(body, "答案"),
    analysisMd: section(body, "详解")
  };
}

async function loadAllQuestions(app) {
  const files = app.vault
    .getMarkdownFiles()
    .filter(file => isQuestionFile(file));
  const questions = [];
  for (const file of files) {
    const content = await app.vault.read(file);
    const cache = app.metadataCache.getFileCache(file) || {};
    const meta = cache.frontmatter || parseFrontmatter(content);
    const body = stripFrontmatter(content);
    questions.push(buildQuestion(file, content, body, meta));
  }
  return questions;
}

async function syncQuestionTitle(app, file) {
  const content = await app.vault.read(file);
  const cache = app.metadataCache.getFileCache(file) || {};
  const meta = cache.frontmatter || parseFrontmatter(content);
  const title = String(meta.title || file.basename).trim();
  if (!title) return file.path;

  const updated = syncQuestionTitleInContent(content, title);
  if (updated !== content) {
    await app.vault.modify(file, updated);
  }

  const desiredPath = `${file.parent?.path && file.parent.path !== "/" ? `${file.parent.path}/` : ""}${safeFilename(title)}.md`;
  if (desiredPath !== file.path) {
    const finalPath = await uniqueVaultPath(app, desiredPath, file.path);
    await app.fileManager.renameFile(file, finalPath);
    return finalPath;
  }
  return file.path;
}

function syncQuestionTitleInContent(content, title) {
  let text = replaceFrontmatterTitle(content, title);
  if (/^# .+$/m.test(text)) {
    text = text.replace(/^# .+$/m, `# ${title}`);
  } else {
    const end = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
    if (end !== -1) {
      text = `${text.slice(0, end + 4).trimEnd()}\n\n# ${title}\n\n${text.slice(end + 4).trimStart()}`;
    } else {
      text = `# ${title}\n\n${text}`;
    }
  }
  if (/^> \[!ti\].*$/m.test(text)) {
    text = text.replace(/^> \[!ti\].*$/m, `> [!ti] *${title}*`);
  }
  return text;
}

function replaceFrontmatterTitle(content, title) {
  if (/^title:\s*.*$/m.test(content)) {
    return content.replace(/^title:\s*.*$/m, `title: "${title}"`);
  }
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      return `${content.slice(0, end)}\ntitle: "${title}"${content.slice(end)}`;
    }
  }
  return `---\ntitle: "${title}"\n---\n\n${content}`;
}

async function uniqueVaultPath(app, desiredPath, currentPath) {
  if (desiredPath === currentPath || !(await app.vault.adapter.exists(desiredPath))) {
    return desiredPath;
  }
  const dot = desiredPath.lastIndexOf(".");
  const base = dot === -1 ? desiredPath : desiredPath.slice(0, dot);
  const ext = dot === -1 ? "" : desiredPath.slice(dot);
  let index = 2;
  while (true) {
    const candidate = `${base}-${index}${ext}`;
    if (candidate === currentPath || !(await app.vault.adapter.exists(candidate))) {
      return candidate;
    }
    index += 1;
  }
}

function isQuestionFile(file) {
  return QUESTION_DIRS.some(dir => file.path.startsWith(dir));
}

function questionsFromLinks(app, activeFile, content, questions) {
  const byPath = new Map(questions.map(question => [question.file.path, question]));
  const selected = [];
  const seen = new Set();
  for (const link of extractLinks(content)) {
    const dest = app.metadataCache.getFirstLinkpathDest(link, activeFile.path);
    const path = dest?.path || normalizeLinkPath(link);
    const question = byPath.get(path);
    if (!question || seen.has(question.file.path)) continue;
    seen.add(question.file.path);
    selected.push(question);
  }
  if (!selected.length && isQuestionFile(activeFile)) {
    const self = byPath.get(activeFile.path);
    if (self) selected.push(self);
  }
  return selected;
}

function extractLinks(content) {
  const links = [];
  const wiki = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = wiki.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  const markdown = /\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]*)?\)/g;
  while ((match = markdown.exec(content)) !== null) {
    links.push(decodeURIComponent(match[1].trim()));
  }
  return links;
}

function normalizeLinkPath(link) {
  return String(link || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, ".md");
}

async function writeExport(app, activeFile, questions, mode) {
  const exportDir = exportDirForActiveFile(activeFile);
  await ensureFolder(app, exportDir);
  const labels = { student: "学生版", answer: "答案版", detail: "详解版" };
  const title = `${activeFile.basename}${labels[mode]}`;
  const path = `${exportDir}/${safeFilename(title)}.md`;
  const markdown = renderExport(title, questions, mode);
  await app.vault.adapter.write(path, markdown);
  return path;
}

function exportDirForActiveFile(activeFile) {
  return activeFile.path.startsWith("题库/") ? EXPORT_DIRS[1] : EXPORT_DIRS[0];
}

async function ensureFolder(app, folderPath) {
  if (await app.vault.adapter.exists(folderPath)) return;
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

function renderExport(title, questions, mode) {
  const lines = [`# ${title}`, ""];
  questions.forEach((question, index) => {
    if (mode === "student") {
      lines.push(cleanExportQuestion(question.questionMd || "暂无题目"), "");
    } else if (mode === "answer") {
      lines.push(`${index + 1}. ${question.answerMd || "暂无"}`, "");
    } else {
      lines.push(
        cleanExportQuestion(question.questionMd || "暂无题目"),
        "",
        "### 答案",
        "",
        question.answerMd || "暂无",
        "",
        "### 详解",
        "",
        question.analysisMd || "暂无",
        ""
      );
    }
  });
  return `${lines.join("\n").trim()}\n`;
}

function cleanExportQuestion(markdown) {
  return String(markdown || "")
    .replace(/\{\{title\}\}/g, "")
    .trim();
}

function safeFilename(name) {
  return String(name || "未命名")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeTags(tags) {
  if (typeof tags === "string") {
    return tags.split(/[,\s]+/).map(cleanTag).filter(Boolean);
  }
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(cleanTag).filter(Boolean))];
}

function cleanTag(tag) {
  return String(tag || "").replace(/^#/, "").trim();
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter(source => source && typeof source === "object")
    .map(source => ({
      name: String(source.name || ""),
      url: String(source.url || ""),
      provider: String(source.provider || ""),
      school_year: String(source.school_year || ""),
      province: String(source.province || ""),
      city: String(source.city || ""),
      area: String(source.area || ""),
      school: String(source.school || ""),
      grade: String(source.grade || ""),
      semester: String(source.semester || ""),
      exam_type: String(source.exam_type || ""),
      paper_tag: String(source.paper_tag || ""),
      question_index: String(source.question_index || ""),
      score_value: String(source.score || "")
    }));
}

function rankSource(source) {
  const text = `${source.name} ${source.province} ${source.city} ${source.area} ${source.school} ${source.exam_type} ${source.paper_tag}`;
  const year = sourceYear(source);
  const recency = Math.max(0, year - 2010);
  const isGaokao = /高考|全国卷|新高考|真题/.test(text);
  const isBeijing = /北京/.test(text);
  const isPrestige = PRESTIGE_SCHOOLS.some(school => text.includes(school));
  if (isGaokao) return { score: 10000 + recency, year, tier: "高考真题" };
  if (isBeijing && isPrestige && year >= 2020) return { score: 8000 + recency, year, tier: "近年北京名校题" };
  if (isBeijing && year >= 2020) return { score: 7000 + recency, year, tier: "近年北京题" };
  if (isBeijing) return { score: 5000 + recency, year, tier: "久远北京题" };
  return { score: 1000 + recency, year, tier: "外地题" };
}

function sourceYear(source) {
  const text = `${source.school_year} ${source.name}`;
  const years = [...text.matchAll(/20\d{2}/g)].map(match => Number(match[0]));
  return years.length ? Math.max(...years) : 0;
}

function sourceLabel(source) {
  if (!source || !source.name) return "来源待补充";
  return `${source.tier || "来源"}：${source.name}`;
}

function sourceMeta(source) {
  return [
    source.tier,
    source.school_year ? `${source.school_year}学年` : "",
    source.province,
    source.area,
    source.school,
    source.grade,
    source.semester,
    source.exam_type
  ].filter(Boolean).join(" · ");
}

function section(body, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "m");
  const match = body.match(pattern);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const raw = content.slice(3, end).trim();
  const meta = {};
  let currentKey = "";
  let currentSource = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!line.startsWith(" ") && line.includes(":")) {
      const [key, ...rest] = line.split(":");
      currentKey = key.trim();
      const value = rest.join(":").trim();
      if (value) meta[currentKey] = stripQuotes(value);
      else meta[currentKey] = currentKey === "tags" || currentKey === "sources" ? [] : "";
      continue;
    }
    if (currentKey === "tags" && line.startsWith("  - ")) {
      meta.tags.push(stripQuotes(line.slice(4).trim()));
    }
    if (currentKey === "sources") {
      if (line.startsWith("  - ")) {
        currentSource = {};
        meta.sources.push(currentSource);
        const rest = line.slice(4).trim();
        if (rest.includes(":")) {
          const [key, ...value] = rest.split(":");
          currentSource[key.trim()] = stripQuotes(value.join(":").trim());
        }
      } else if (currentSource && line.startsWith("    ") && line.includes(":")) {
        const [key, ...value] = line.trim().split(":");
        currentSource[key.trim()] = stripQuotes(value.join(":").trim());
      }
    }
  }
  return meta;
}

function stripFrontmatter(content) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? content : content.slice(end + 4).trimStart();
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function groupTags(questions) {
  const counts = new Map();
  for (const question of questions) {
    for (const tag of question.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const items = [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || tagSort(a.tag, b.tag));
  const pick = predicate => items.filter(item => predicate(item.tag));
  return [
    { name: "年级 / 学期 / 考试", open: true, tags: pick(tag => /高一|高二|高三|初一|初二|初三|上学期|下学期|期中|期末|月考|联考|模拟|高考|单元测试/.test(tag)) },
    { name: "地区 / 学校", open: true, tags: pick(tag => /北京|上海|天津|重庆|区|县|市|学校|中学|附中|外国语|五十五/.test(tag)) },
    { name: "年份", open: false, tags: pick(tag => /20\d{2}[-~～至]20\d{2}|20\d{2}学年/.test(tag)) },
    { name: "知识点 / 类型", open: true, tags: pick(tag => !/高一|高二|高三|初一|初二|初三|上学期|下学期|期中|期末|月考|联考|模拟|高考|单元测试|北京|上海|天津|重庆|区|县|市|学校|中学|附中|外国语|五十五|20\d{2}/.test(tag)) }
  ].filter(group => group.tags.length);
}

function tagSort(a, b) {
  return String(a).localeCompare(String(b), "zh-Hans-CN");
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
