const {
  Plugin,
  ItemView,
  Notice,
  MarkdownRenderer,
  Component,
  MarkdownView,
  TFile
} = require("obsidian");

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const electron = require("electron");

const VIEW_TYPE = "better-export-live-preview-view";
const PLUGIN_ID = "better-export-live-preview";
const BETTER_EXPORT_ID = "better-export-pdf";

const DEFAULT_BETTER_SETTINGS = {
  showTitle: true,
  maxLevel: "6",
  displayHeader: true,
  displayFooter: true,
  headerTemplate:
    '<div style="width: 100vw;font-size:10px;text-align:center;"><span class="title"></span></div>',
  footerTemplate:
    '<div style="width: 100vw;font-size:10px;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  printBackground: false,
  generateTaggedPDF: false,
  displayMetadata: false,
  debug: false,
  isTimestamp: false,
  enabledCss: false,
  concurrency: "5"
};

const DEFAULT_EXPORT_CONFIG = {
  pageSize: "A4",
  marginType: "1",
  showTitle: true,
  open: false,
  scale: 100,
  landscape: false,
  marginTop: "10",
  marginBottom: "10",
  marginLeft: "10",
  marginRight: "10",
  displayHeader: true,
  displayFooter: true,
  cssSnippet: "0"
};

const CSS_PATCH = `
body {
  overflow: auto !important;
}
@media print {
  .print .markdown-preview-view {
    height: auto !important;
  }
  .md-print-anchor, .blockid {
    white-space: pre !important;
    border-left: none !important;
    border-right: none !important;
    border-top: none !important;
    border-bottom: none !important;
    display: inline-block !important;
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    right: 0 !important;
    outline: 0 !important;
    background: 0 0 !important;
    text-decoration: initial !important;
    text-shadow: initial !important;
  }
}
@media print {
  table {
    break-inside: auto;
  }
  tr {
    break-inside: avoid;
    break-after: auto;
  }
}
img.__canvas__ {
  width: 100% !important;
  height: 100% !important;
}
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

async function timed(timings, name, fn) {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = performance.now() - startedAt;
  }
}

function safeParseFloat(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("Failed to read JSON:", filePath, error);
    return fallback;
  }
}

function collectStyleRules(onlyPrint = false) {
  const cssTexts = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    const owner = sheet.ownerNode;
    const id = owner == null ? void 0 : owner.id;
    const href = owner == null ? void 0 : owner.href;

    if (id && id.startsWith("svelte-")) return;
    if (id && id.startsWith(PLUGIN_ID)) return;

    try {
      Array.from(sheet.cssRules || []).forEach((rule) => {
        if (onlyPrint) {
          if (rule.constructor.name === "CSSMediaRule" && rule.conditionText === "print") {
            cssTexts.push(rule.cssText.replace(/@media print\s*\{(.+)\}/gms, "$1"));
          }
          return;
        }
        cssTexts.push(rule.cssText);
      });
    } catch (error) {
      console.warn("Cannot read stylesheet:", id || href || "inline", error);
    }
  });
  return cssTexts;
}

function getAllStyles() {
  return collectStyleRules(false);
}

function getPatchStyles() {
  return [CSS_PATCH, ...collectStyleRules(true)];
}

async function insertCssBundle(webview, cssTexts) {
  const keys = [];
  for (const css of cssTexts) {
    if (!css || !css.trim()) continue;
    const key = await webview.insertCSS(css);
    keys.push(key);
  }
  return keys;
}

async function removeInsertedCss(webview, keys) {
  if (!webview || typeof webview.removeInsertedCSS !== "function") return;
  for (const key of keys || []) {
    try {
      await webview.removeInsertedCSS(key);
    } catch (error) {
      console.warn("Could not remove inserted CSS:", error);
    }
  }
}

function getRemote() {
  return electron.remote || (electron.default && electron.default.remote);
}

function toFileUrl(filePath, cacheBust = true) {
  const url = pathToFileURL(filePath).href;
  return cacheBust ? `${url}?t=${Date.now()}` : url;
}

function toPreviewPdfUrl(filePath, state) {
  const page = Number(state && state.page);
  const url = toFileUrl(filePath, true);
  return Number.isFinite(page) && page > 0 ? `${url}#page=${Math.round(page)}` : url;
}

function cssClassesFromFrontmatter(frontmatter) {
  const cssclasses = [];
  for (const [key, val] of Object.entries(frontmatter || {})) {
    if (key.toLowerCase() === "cssclass" || key.toLowerCase() === "cssclasses") {
      if (Array.isArray(val)) cssclasses.push(...val);
      else if (val) cssclasses.push(String(val));
    }
  }
  return cssclasses;
}

function copyAttributes(target, attrs) {
  for (const attr of Array.from(attrs || [])) {
    target.setAttribute(attr.name, attr.value);
  }
}

function fixCanvasToImage(el) {
  for (const canvas of Array.from(el.querySelectorAll("canvas"))) {
    try {
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      copyAttributes(img, canvas.attributes);
      img.className = `${canvas.className || ""} __canvas__`.trim();
      canvas.replaceWith(img);
    } catch (error) {
      console.warn("Could not convert canvas to image:", error);
    }
  }
}

function removeInternalHrefs(viewEl, file) {
  viewEl.findAll("a.internal-link").forEach((el) => {
    const href = el.dataset ? el.dataset.href : "";
    const parts = href ? href.split("#") : [];
    const title = parts[0];
    const anchor = parts[1];
    if ((!title || title.length === 0 || title === file.basename) && anchor && anchor.startsWith("^")) {
      return;
    }
    el.removeAttribute("href");
  });
}

function makeWebviewJs(doc) {
  const bodyHtml = JSON.stringify(encodeURIComponent(doc.body.innerHTML));
  const headHtml = JSON.stringify(encodeURIComponent(document.head.innerHTML));
  const bodyClass = JSON.stringify(document.body.getAttribute("class") || "");
  const bodyStyle = JSON.stringify(document.body.getAttribute("style") || "");
  const title = JSON.stringify(doc.title || "PDF Preview");

  return `
    document.body.innerHTML = decodeURIComponent(${bodyHtml});
    document.head.innerHTML = decodeURIComponent(${headHtml});
    document.body.setAttribute("class", ${bodyClass});
    document.body.setAttribute("style", ${bodyStyle});
    document.body.classList.add("theme-light");
    document.body.classList.remove("theme-dark");
    document.title = ${title};

    function decodeAndReplaceEmbed(element) {
      try {
        element.innerHTML = decodeURIComponent(element.innerHTML);
        element.querySelectorAll("span.markdown-embed").forEach(decodeAndReplaceEmbed);
      } catch (error) {}
    }
    document.querySelectorAll("span.markdown-embed").forEach(decodeAndReplaceEmbed);
  `;
}

function makeSettleJs(waitMs, imageTimeoutMs) {
  return `
    new Promise((resolve) => {
      const images = Array.from(document.images || []);
      const imagePromises = images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((done) => {
          const finish = () => done();
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", finish, { once: true });
          setTimeout(finish, ${imageTimeoutMs});
        });
      });
      Promise.all(imagePromises).then(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setTimeout(resolve, ${waitMs});
        }));
      });
    });
  `;
}

function makePdfViewerStateJs() {
  return `
    (() => {
      function collect(root, out, seen) {
        if (!root || seen.has(root)) return out;
        seen.add(root);
        const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
        for (const node of nodes) {
          out.push(node);
          if (node.shadowRoot) collect(node.shadowRoot, out, seen);
        }
        return out;
      }

      function pageFromHash() {
        const match = String(location.hash || "").match(/(?:^|[&#])page=(\\d+)/i);
        return match ? Number(match[1]) : 0;
      }

      const elements = collect(document, [], new Set());
      const inputs = elements.filter((el) => el.tagName === "INPUT");
      const pageInput = inputs.find((el) => {
        const text = [
          el.id,
          el.className,
          el.name,
          el.getAttribute("aria-label"),
          el.getAttribute("title")
        ].join(" ").toLowerCase();
        return /page|页/.test(text) && /^\\d+$/.test(String(el.value || "").trim());
      }) || inputs.find((el) => /^\\d+$/.test(String(el.value || "").trim()));
      const page = pageInput ? Number(pageInput.value) : pageFromHash();
      const scroller = elements.find((el) => {
        const text = [el.id, el.className].join(" ").toLowerCase();
        return text.includes("scroller") || text.includes("viewer-container");
      });
      const scrollMax = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;

      return {
        page: Number.isFinite(page) && page > 0 ? page : 0,
        scrollRatio: scrollMax > 0 ? scroller.scrollTop / scrollMax : 0
      };
    })();
  `;
}

function makePdfViewerRestoreJs(state) {
  const stateJson = JSON.stringify({
    page: Number(state && state.page) || 0,
    scrollRatio: Number(state && state.scrollRatio) || 0
  });

  return `
    (() => {
      const state = ${stateJson};
      function collect(root, out, seen) {
        if (!root || seen.has(root)) return out;
        seen.add(root);
        const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
        for (const node of nodes) {
          out.push(node);
          if (node.shadowRoot) collect(node.shadowRoot, out, seen);
        }
        return out;
      }

      function restoreOnce() {
        const elements = collect(document, [], new Set());
        if (state.page > 0) {
          location.hash = "page=" + Math.round(state.page);
          const inputs = elements.filter((el) => el.tagName === "INPUT");
          const pageInput = inputs.find((el) => {
            const text = [
              el.id,
              el.className,
              el.name,
              el.getAttribute("aria-label"),
              el.getAttribute("title")
            ].join(" ").toLowerCase();
            return /page|页/.test(text);
          });
          if (pageInput) {
            pageInput.value = String(Math.round(state.page));
            pageInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            pageInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            pageInput.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              composed: true
            }));
          }
        } else if (state.scrollRatio > 0) {
          const scroller = elements.find((el) => {
            const text = [el.id, el.className].join(" ").toLowerCase();
            return text.includes("scroller") || text.includes("viewer-container");
          });
          if (scroller) {
            const scrollMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTop = Math.round(scrollMax * state.scrollRatio);
          }
        }
      }

      restoreOnce();
      [150, 500, 1000, 1800].forEach((ms) => setTimeout(restoreOnce, ms));
    })();
  `;
}

class BetterExportLivePreviewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFile = null;
    this.latestPdfPath = null;
    this.lastPreviewState = null;
    this.rendering = false;
    this.pendingRender = false;
    this.debouncedRefresh = debounce(() => this.refresh(false), this.plugin.settings.debounceMs);
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Better Export Live Preview";
  }

  getIcon() {
    return "file-text";
  }

  async onOpen() {
    this.buildUi();
    this.currentFile = this.plugin.getActiveMarkdownFile();
    if (this.currentFile) {
      this.setStatus(`当前文件：${this.currentFile.basename}，点击刷新生成预览`);
    }
    this.warmupRenderEngine();
  }

  async onClose() {
    this.debouncedRefresh.cancel();
    await this.plugin.releaseRenderWebview();
  }

  buildUi() {
    this.contentEl.empty();
    this.contentEl.addClass("better-export-live-preview");

    const toolbar = this.contentEl.createDiv({ cls: "belp-toolbar" });
    this.statusEl = toolbar.createDiv({ cls: "belp-status", text: "Ready" });

    const buttons = toolbar.createDiv({ cls: "belp-buttons" });
    this.refreshButton = buttons.createEl("button", { text: "刷新" });
    this.saveButton = buttons.createEl("button", { text: "保存 PDF" });
    this.openButton = buttons.createEl("button", { text: "打开文件" });

    this.refreshButton.addEventListener("click", () => this.refresh(true));
    this.saveButton.addEventListener("click", () => this.saveCurrentPdf());
    this.openButton.addEventListener("click", () => this.openCurrentPdf());

    this.previewWrap = this.contentEl.createDiv({ cls: "belp-preview-wrap" });
    this.placeholder = this.previewWrap.createDiv({
      cls: "belp-placeholder",
      text: "打开一个 Markdown 文件后会在这里生成 PDF 预览。"
    });

    this.previewWebview = document.createElement("webview");
    this.previewWebview.className = "belp-pdf-webview";
    this.previewWebview.setAttribute("allowpopups", "");
    this.previewWrap.appendChild(this.previewWebview);

    this.hiddenHost = this.contentEl.createDiv({ cls: "belp-hidden-host" });
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.setText(text);
  }

  setFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const latestText = this.plugin.readOpenEditorText(file);
    if (typeof latestText === "string") {
      this.plugin.liveTextByPath.set(file.path, latestText);
    }
    if (this.currentFile === file) return;
    this.currentFile = file;
    this.latestPdfPath = null;
    this.setStatus(`当前文件：${file.basename}，点击刷新生成预览`);
  }

  async warmupRenderEngine() {
    if (this.rendering || !this.hiddenHost) return;
    try {
      const { config } = this.plugin.getBetterExportSettings();
      const fileText = this.currentFile ? `当前文件：${this.currentFile.basename}，` : "";
      this.setStatus(`${fileText}正在预热 PDF 引擎...`);
      const startedAt = performance.now();
      await this.plugin.getRenderWebview(this.hiddenHost, config);
      if (!this.rendering) this.setStatus(`${fileText}预热完成，点击刷新生成预览`);
      console.info(`Better Export Live Preview warmup: ${formatSeconds(performance.now() - startedAt)}`);
    } catch (error) {
      console.warn("Better Export Live Preview warmup failed:", error);
      if (this.currentFile) {
        this.setStatus(`当前文件：${this.currentFile.basename}，点击刷新生成预览`);
      }
    }
  }

  scheduleRefresh() {
    this.debouncedRefresh();
  }

  async refresh(manual) {
    if (this.rendering) {
      this.pendingRender = true;
      return;
    }

    const file = this.currentFile || this.plugin.getActiveMarkdownFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      this.setStatus("请先打开一个 Markdown 文件。");
      return;
    }
    this.currentFile = file;

    this.rendering = true;
    this.pendingRender = false;
    this.refreshButton.disabled = true;
    this.saveButton.disabled = true;
    this.setStatus("正在生成 PDF...");
    const startedAt = performance.now();

    try {
      const previewState = await this.capturePreviewState();
      const result = await this.plugin.generatePreviewPdf(file, this.hiddenHost, (text) => this.setStatus(text));
      const pdfPath = result.pdfPath;
      this.latestPdfPath = pdfPath;
      this.loadPreviewPdf(pdfPath, previewState);
      this.placeholder.hide();
      const totalMs = performance.now() - startedAt;
      const parts = result.timings || {};
      this.setStatus(
        `已刷新：${formatSeconds(totalMs)}（渲染 ${formatSeconds(parts.markdown || 0)} / 生成 ${formatSeconds(parts.pdf || 0)}）`
      );
    } catch (error) {
      console.error(error);
      this.setStatus(`生成失败：${error.message || error}`);
      if (manual) new Notice(`PDF 预览生成失败：${error.message || error}`);
    } finally {
      this.rendering = false;
      this.refreshButton.disabled = false;
      this.saveButton.disabled = !this.latestPdfPath;
      if (this.pendingRender) this.scheduleRefresh();
    }
  }

  async capturePreviewState() {
    if (!this.previewWebview || !this.latestPdfPath) return this.lastPreviewState || {};
    try {
      const state = await this.previewWebview.executeJavaScript(makePdfViewerStateJs());
      if (state && (state.page > 0 || state.scrollRatio > 0)) {
        this.lastPreviewState = state;
      }
    } catch (error) {
      console.warn("Could not read PDF preview state:", error);
    }
    return this.lastPreviewState || {};
  }

  loadPreviewPdf(pdfPath, state) {
    this.restorePreviewState(state);
    this.previewWebview.src = toPreviewPdfUrl(pdfPath, state);
  }

  restorePreviewState(state) {
    if (!state || (!state.page && !state.scrollRatio)) return;
    this.lastPreviewState = state;

    const run = async () => {
      try {
        await this.previewWebview.executeJavaScript(makePdfViewerRestoreJs(state));
      } catch (error) {
        console.warn("Could not restore PDF preview state:", error);
      }
    };

    const onReady = () => {
      window.setTimeout(run, 80);
    };
    this.previewWebview.addEventListener("dom-ready", onReady, { once: true });
    window.setTimeout(run, 800);
  }

  async saveCurrentPdf() {
    if (!this.latestPdfPath || !fs.existsSync(this.latestPdfPath)) {
      new Notice("还没有可保存的 PDF，请先刷新预览。");
      return;
    }

    const remote = getRemote();
    if (!remote || !remote.dialog) {
      new Notice("当前环境无法打开保存窗口。");
      return;
    }

    const filename = this.currentFile ? `${this.currentFile.basename}.pdf` : "preview.pdf";
    const result = await remote.dialog.showSaveDialog({
      title: "保存当前预览 PDF",
      defaultPath: filename,
      filters: [
        { name: "PDF", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["showOverwriteConfirmation", "createDirectory"]
    });

    if (result.canceled || !result.filePath) return;
    await fs.promises.copyFile(this.latestPdfPath, result.filePath);
    new Notice("已保存当前预览 PDF。");
  }

  async openCurrentPdf() {
    if (!this.latestPdfPath || !fs.existsSync(this.latestPdfPath)) {
      new Notice("还没有可打开的 PDF，请先刷新预览。");
      return;
    }
    const remote = getRemote();
    const shell = remote && remote.shell ? remote.shell : electron.shell;
    if (shell && shell.openPath) await shell.openPath(this.latestPdfPath);
  }
}

module.exports = class BetterExportLivePreviewPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.basePath = this.app.vault.adapter.basePath;
    this.pluginDir = path.join(this.basePath, ".obsidian", "plugins", PLUGIN_ID);
    this.cacheDir = path.join(this.pluginDir, "cache");
    this.liveTextByPath = new Map();
    this.renderWebview = null;
    this.renderWebviewReady = null;
    this.insertedCssKeys = [];
    this.cssSignature = "";
    this.cssBundleCache = null;
    this.cssBundleSignature = "";
    await fs.promises.mkdir(this.cacheDir, { recursive: true });

    this.registerView(VIEW_TYPE, (leaf) => new BetterExportLivePreviewView(leaf, this));

    this.addCommand({
      id: "open-better-export-live-preview",
      name: "Open Better Export Live Preview",
      callback: () => this.activateView(true)
    });

    this.addRibbonIcon("file-text", "Better Export Live Preview", () => this.activateView(true));

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        const view = this.getView();
        if (view && file instanceof TFile && file.extension === "md") view.setFile(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const view = this.getView();
        const file = this.getActiveMarkdownFile();
        if (view && file) view.setFile(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, markdownView) => {
        const view = this.getView();
        const file = markdownView && markdownView.file;
        if (file instanceof TFile && file.extension === "md") {
          const editorValue = editor && typeof editor.getValue === "function"
            ? editor.getValue()
            : null;
          if (typeof editorValue === "string") {
            this.liveTextByPath.set(file.path, editorValue);
          }
        }
      })
    );
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign(
      {
        debounceMs: 500,
        renderSettleMs: 80,
        embeddedRenderSettleMs: 700,
        webviewSettleMs: 80,
        imageLoadTimeoutMs: 350
      },
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getView() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf ? leaf.view : null;
  }

  async activateView(active) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE, active });
    }
    if (leaf && active) this.app.workspace.revealLeaf(leaf);
  }

  getActiveMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file instanceof TFile && view.file.extension === "md") return view.file;

    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile && file.extension === "md") return file;

    return null;
  }

  getActiveMarkdownText(file) {
    const cachedText = this.liveTextByPath && this.liveTextByPath.get(file.path);
    if (typeof cachedText === "string") return cachedText;

    const openText = this.readOpenEditorText(file);
    if (typeof openText === "string") {
      this.liveTextByPath.set(file.path, openText);
      return openText;
    }

    return null;
  }

  readOpenEditorText(file) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file && view.file.path === file.path) {
      const editorValue = view.editor && typeof view.editor.getValue === "function"
        ? view.editor.getValue()
        : null;
      if (typeof editorValue === "string") return editorValue;
      if (typeof view.data === "string") return view.data;
    }

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const markdownView = leaf.view;
      if (markdownView && markdownView.file && markdownView.file.path === file.path) {
        const editorValue = markdownView.editor && typeof markdownView.editor.getValue === "function"
          ? markdownView.editor.getValue()
          : null;
        if (typeof editorValue === "string") return editorValue;
        if (typeof markdownView.data === "string") {
        return markdownView.data;
        }
      }
    }

    return null;
  }

  getBetterExportSettings() {
    const settingsPath = path.join(
      this.basePath,
      ".obsidian",
      "plugins",
      BETTER_EXPORT_ID,
      "data.json"
    );
    const settings = Object.assign({}, DEFAULT_BETTER_SETTINGS, readJsonIfExists(settingsPath, {}));
    const prevConfig = settings.prevConfig || {};
    const config = Object.assign({}, DEFAULT_EXPORT_CONFIG, {
      showTitle: settings.showTitle,
      displayHeader: settings.displayHeader,
      displayFooter: settings.displayFooter
    }, prevConfig);
    return { settings, config };
  }

  async renderMarkdownDoc(file, config) {
    const data = this.getActiveMarkdownText(file) || await this.app.vault.cachedRead(file);
    const frontMatter =
      (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const cssclasses = cssClassesFromFrontmatter(frontMatter);
    const comp = new Component();
    comp.load();

    const printEl = document.body.createDiv("print");
    printEl.addClass("better-export-live-render-root");

    const viewEl = printEl.createDiv({
      cls: `markdown-preview-view markdown-rendered ${cssclasses.join(" ")}`
    });
    viewEl.toggleClass("rtl", this.app.vault.getConfig("rightToLeft"));
    viewEl.toggleClass("show-properties", this.app.vault.getConfig("propertiesInDocument") !== "hidden");

    const title = (frontMatter && frontMatter.title) || file.basename;
    const titleEl = viewEl.createEl("h1", { text: title });
    titleEl.addClass("__title__");
    titleEl.style.display = config.showTitle ? "block" : "none";

    await MarkdownRenderer.render(this.app, data, viewEl, file.path, comp);
    await sleep(
      data.includes("```dataview") || data.includes("![[")
        ? this.settings.embeddedRenderSettleMs
        : this.settings.renderSettleMs
    );

    removeInternalHrefs(viewEl, file);
    fixCanvasToImage(viewEl);

    const doc = document.implementation.createHTMLDocument("document");
    doc.body.appendChild(printEl.cloneNode(true));
    doc.title = title;

    printEl.detach();
    printEl.remove();
    comp.unload();

    return { doc, frontMatter, file };
  }

  async generatePreviewPdf(file, hiddenHost, onStatus) {
    const timings = {};
    const { settings, config } = this.getBetterExportSettings();
    if (onStatus) onStatus("正在渲染 Markdown...");
    const docData = await timed(timings, "markdown", () => this.renderMarkdownDoc(file, config));
    const outputPath = path.join(this.cacheDir, `preview-${Date.now()}.pdf`);
    if (onStatus) onStatus("正在准备 PDF 引擎...");
    const webview = await timed(timings, "engine", () => this.getRenderWebview(hiddenHost, config));
    const printOptions = this.makePrintOptions(Object.assign({}, settings, config), docData.frontMatter);

    try {
      if (onStatus) onStatus("正在排版并生成 PDF...");
      const data = await timed(timings, "pdf", async () => {
        await this.loadDocIntoRenderWebview(webview, docData.doc);
        return await webview.printToPDF(printOptions);
      });
      if (onStatus) onStatus("正在写入预览文件...");
      await timed(timings, "write", () => fs.promises.writeFile(outputPath, data));
      this.cleanupOldPreviewPdfs(outputPath);
      return { pdfPath: outputPath, timings };
    } finally {}
  }

  cleanupOldPreviewPdfs(keepPath) {
    try {
      const files = fs.readdirSync(this.cacheDir)
        .filter((name) => /^preview-\d+\.pdf$/.test(name))
        .map((name) => path.join(this.cacheDir, name))
        .filter((filePath) => filePath !== keepPath)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      files.slice(3).forEach((filePath) => {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.warn("Could not remove old preview PDF:", filePath, error);
        }
      });
    } catch (error) {
      console.warn("Could not clean preview PDF cache:", error);
    }
  }

  async getRenderWebview(hiddenHost, config) {
    const existing = this.renderWebview;
    if (existing && existing.parentElement === hiddenHost) {
      if (this.renderWebviewReady) await this.renderWebviewReady;
      await this.ensureCssBundle(existing, config);
      return existing;
    }

    await this.releaseRenderWebview();

    const webview = document.createElement("webview");
    webview.className = "belp-render-webview";
    webview.setAttribute("allowpopups", "");
    webview.nodeintegration = true;
    hiddenHost.appendChild(webview);
    this.renderWebview = webview;

    this.renderWebviewReady = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("渲染页面加载超时")), 10000);
      webview.addEventListener("dom-ready", async () => {
        window.clearTimeout(timeout);
        try {
          await this.ensureCssBundle(webview, config);
          resolve(webview);
        } catch (error) {
          reject(error);
        }
      });
    });

    webview.src = "app://obsidian.md/help.html";
    await this.renderWebviewReady;
    return webview;
  }

  async releaseRenderWebview() {
    if (this.renderWebview) {
      await removeInsertedCss(this.renderWebview, this.insertedCssKeys);
      this.renderWebview.remove();
    }
    this.renderWebview = null;
    this.renderWebviewReady = null;
    this.insertedCssKeys = [];
    this.cssSignature = "";
  }

  async loadDocIntoRenderWebview(webview, doc) {
    await webview.executeJavaScript(makeWebviewJs(doc));
    await webview.executeJavaScript(
      makeSettleJs(this.settings.webviewSettleMs, this.settings.imageLoadTimeoutMs)
    );
  }

  async ensureCssBundle(webview, config) {
    const { signature, cssTexts } = await this.getCssBundle(config);
    if (signature === this.cssSignature && this.insertedCssKeys.length > 0) return;

    await removeInsertedCss(webview, this.insertedCssKeys);
    this.insertedCssKeys = await insertCssBundle(webview, cssTexts);
    this.cssSignature = signature;
  }

  async getCssBundle(config) {
    const snippetPath = config.cssSnippet && config.cssSnippet !== "0" ? config.cssSnippet : "";
    const snippetMtime = snippetPath && fs.existsSync(snippetPath)
      ? fs.statSync(snippetPath).mtimeMs
      : 0;
    const signature = JSON.stringify({
      snippetPath,
      snippetMtime,
      styleCount: document.styleSheets.length
    });

    if (this.cssBundleCache && signature === this.cssBundleSignature) {
      return { signature, cssTexts: this.cssBundleCache };
    }

    const cssTexts = [...getAllStyles()];
    if (snippetPath) {
      try {
        const cssSnippet = await fs.promises.readFile(snippetPath, "utf8");
        const printCss = cssSnippet.replaceAll(/@media print\s*{([^}]+)}/g, "$1");
        cssTexts.push(printCss, cssSnippet);
      } catch (error) {
        console.warn("Could not load selected CSS snippet:", error);
      }
    }
    cssTexts.push(...getPatchStyles());

    this.cssBundleCache = cssTexts;
    this.cssBundleSignature = signature;
    return { signature, cssTexts };
  }

  makePrintOptions(config, frontMatter) {
    let pageSize = config.pageSize;
    if (config.pageSize === "Custom" && config.pageWidth && config.pageHeight) {
      pageSize = {
        width: safeParseFloat(config.pageWidth, 210) / 25.4,
        height: safeParseFloat(config.pageHeight, 297) / 25.4
      };
    }

    let scale = config.scale || 100;
    if (scale > 200 || scale < 10) scale = 100;

    const printOptions = {
      landscape: config.landscape,
      printBackground: config.printBackground,
      generateTaggedPDF: config.generateTaggedPDF,
      pageSize,
      scale: scale / 100,
      margins: {
        marginType: "default"
      },
      displayHeaderFooter: config.displayHeader || config.displayFooter,
      headerTemplate: config.displayHeader
        ? (frontMatter && frontMatter.headerTemplate) || config.headerTemplate
        : "<span></span>",
      footerTemplate: config.displayFooter
        ? (frontMatter && frontMatter.footerTemplate) || config.footerTemplate
        : "<span></span>"
    };

    if (config.marginType === "0") {
      printOptions.margins = { marginType: "custom", top: 0, bottom: 0, left: 0, right: 0 };
    } else if (config.marginType === "1") {
      printOptions.margins = { marginType: "default" };
    } else if (config.marginType === "2") {
      printOptions.margins = { marginType: "custom", top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 };
    } else if (config.marginType === "3") {
      printOptions.margins = {
        marginType: "custom",
        top: safeParseFloat(config.marginTop, 0) / 25.4,
        bottom: safeParseFloat(config.marginBottom, 0) / 25.4,
        left: safeParseFloat(config.marginLeft, 0) / 25.4,
        right: safeParseFloat(config.marginRight, 0) / 25.4
      };
    }

    return printOptions;
  }
};
