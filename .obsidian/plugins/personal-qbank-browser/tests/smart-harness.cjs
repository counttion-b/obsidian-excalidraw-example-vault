const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const smart = require('../smart-paper');

function setup(request, options = {}) {
  const files = new Map(), calls = [], notices = [];
  let clock = 100000;
  const context = {
    module: { exports: {} }, console, URL, TextEncoder, crypto: webcrypto,
    Date: options.realTime ? Date : class extends Date { static now() { return clock; } },
    setTimeout: options.realTime ? setTimeout : (fn, delay) => { clock += delay; fn(); },
    document: { createElement: () => ({ set innerHTML(v) {
      this.value = String(v).replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    }, value: '' }) },
    require: name => name === 'obsidian' ? {
      ItemView: class {}, MarkdownRenderer: {}, MarkdownView: class {}, Notice: class { constructor(v) { notices.push(v); } },
      Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, setIcon() {},
      requestUrl: async opts => { calls.push({ url: opts.url, method: opts.method, at: options.realTime ? Date.now() : clock }); return request(opts); }
    } : name === './smart-paper' ? smart : require(name)
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(code + '\nmodule.exports.hooks = {DEFAULT_SETTINGS,parsePaperBlocks,ensureFolder,safeFilename,stripPaperVariantSuffix,buildSearchQueries,questionFromJiaoyanyunItem,imageDigest,isJiaoyanyunStopError};', context);
  const Plugin = context.module.exports, plugin = new Plugin();
  plugin.settings = { ...Plugin.hooks.DEFAULT_SETTINGS, jiaoyanyunToken: 'unit-test-only' };
  const file = { path: '试卷/混合题集.md', basename: '混合题集', extension: 'md', parent: { path: '试卷' } };
  const adapter = {
    exists: async p => files.has(p), read: async p => files.get(p), readBinary: async p => files.get(p),
    write: async (p, value) => files.set(p, value), writeBinary: async (p, value) => files.set(p, value)
  };
  plugin.app = { vault: { read: async f => files.get(f.path), adapter, createFolder: async p => files.set(p, null) },
    workspace: { getActiveFile: () => file, openLinkText: async p => { plugin.opened = p; } } };
  const deps = { ...Plugin.hooks, notify: v => notices.push(v) };
  return { plugin, deps, file, files, calls, notices, run: () => smart.run(plugin, file, deps) };
}
function imageResponse(bytes = [137,80,78,71,0]) { return { status: 200, headers: { 'content-type': 'image/png' }, arrayBuffer: Uint8Array.from(bytes).buffer }; }
module.exports = { setup, imageResponse, smart };
