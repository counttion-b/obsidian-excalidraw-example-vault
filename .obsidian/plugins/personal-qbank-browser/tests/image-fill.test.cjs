const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const hooks = `\nmodule.exports.testHooks = { DEFAULT_SETTINGS, questionFromJiaoyanyunItem,
  collectStemDiagramUrls, parsePaperBlocks, paperSearchText, imageIdentity, renderMatchedPaperBlock };`;
const diagram = 'https://tiku-pro-cdn.speiyou.com/imgFile/diagram.png';
const secondDiagram = 'https://tiku-pro-cdn.speiyou.com/imgFile/diagram2.png';
const questionText = '如图所示为静电场中的一簇电场线，比较其中两位置的电势高低和电场强度的大小。';

function imageResponse(bytes = [137, 80, 78, 71, 13, 10, 26, 10]) {
  return {
    status: 200, headers: { 'content-type': 'image/png' },
    arrayBuffer: Uint8Array.from(bytes).buffer,
    get json() { throw new Error('Binary images must not be parsed as JSON'); }
  };
}

function setup(request = async () => imageResponse()) {
  const files = new Map();
  const writes = [];
  const notices = [];
  let time = 100000;
  const waits = [];
  const context = {
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, URL, crypto: webcrypto,
    Date: class extends Date { static now() { return time; } },
    setTimeout: (fn, delay) => { time += delay; waits.push(delay); fn(); },
    document: { createElement: () => ({
      set innerHTML(value) { this.value = String(value).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }, value: ''
    }) },
    require: name => name === 'obsidian' ? {
      ItemView: class {}, MarkdownRenderer: {}, MarkdownView: class {},
      Notice: class { constructor(message) { notices.push(message); } },
      Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, setIcon() {},
      requestUrl: options => request(options, time)
    } : require(name === './smart-paper' ? '../smart-paper' : name)
  };
  vm.runInNewContext(code + hooks, context);
  const Plugin = context.module.exports;
  const plugin = new Plugin();
  plugin.settings = { ...Plugin.testHooks.DEFAULT_SETTINGS, jiaoyanyunToken: 'local-test-token' };
  const file = { path: 'lesson.md', basename: 'lesson', parent: { path: '/' } };
  plugin.app = {
    vault: {
      read: async f => files.get(f.path), createFolder: async p => files.set(p, null),
      adapter: {
        exists: async p => files.has(p), read: async p => files.get(p),
        write: async (p, value) => { writes.push(p); files.set(p, value); },
        writeBinary: async (p, value) => { writes.push(p); files.set(p, value); }
      }
    },
    workspace: { getActiveFile: () => file, openLinkText() {} }
  };
  return { plugin, hooks: Plugin.testHooks, files, writes, notices, waits, now: () => time };
}

function stemItem() {
  return {
    queId: 'test-question',
    content: `<p>${questionText}</p><img src="https://latexlib-cdn.jiaoyanyun.com/latex/library/x.svg"><img src="${diagram}"><img src="${diagram}?x-oss-process=image/resize,w_300"><img src="${secondDiagram}">`,
    answer: '<img src="https://example.com/answer.png">',
    analysis: '<img src="https://example.com/solution.png">',
    answerOptionList: [[{ aoVal: 'A', content: '<img src="https://example.com/option.png">' }]]
  };
}

test('only stem diagrams survive; lazy images, formulas, solutions and resize duplicates are handled before downloading', () => {
  const { hooks } = setup();
  const item = stemItem();
  item.content += `<span class="mathjax_content"><img src="https://example.com/equation.png"></span><img src="data:image/gif;base64,eA==" data-original="${diagram}">`;
  const q = hooks.questionFromJiaoyanyunItem(item, '4', '3');
  assert.deepEqual([...q.imageUrls], [diagram, secondDiagram]);
  assert.match(q.answer, /answer\.png/);
  assert.match(q.analysis, /solution\.png/);
  assert.equal(hooks.collectStemDiagramUrls('<img data-tex="x" src="https://example.com/x.png">').length, 0);
  assert.notEqual(hooks.imageIdentity('https://example.com/img?id=1'), hooks.imageIdentity('https://example.com/img?id=2'));
});

test('one question with a numbered heading and a callout produces one search block and keeps local numbering', () => {
  const { hooks } = setup();
  const text = `# 讲义\n\n###### 1\n\n> [!ti] *原卷第13题*\n> ${questionText}\n> %% 图位：第1页 %%\n\n###### 2\n\n> [!ti] *例题*\n> 第二题题干\n`;
  const blocks = hooks.parsePaperBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].questionNo, '1');
  assert.equal(blocks[1].questionNo, '2');
  assert.equal(blocks[0].searchText, questionText);
  assert.ok(!blocks[0].raw.includes('###### 2'));
  const rendered = hooks.renderMatchedPaperBlock(blocks[0].raw, new Map([['a', 'one.png'], ['b', 'one.png']]));
  assert.match(rendered, /\*原卷第13题\*/);
  assert.match(rendered, /^###### 1/);
  assert.equal((rendered.match(/!\[\|200\]/g) || []).length, 1);
});

test('full fill performs one search and one image GET, keeps the original and skips completed blocks on rerun', async () => {
  const calls = [];
  const env = setup(async (options, at) => {
    calls.push({ options, at });
    return options.method === 'POST' ? { status: 200, json: { code: 200, data: { list: [stemItem()] } } } : imageResponse();
  });
  const original = `# 讲义 #h0\n\n###### 1\n\n> [!ti] *原卷第13题*\n> ${questionText}\n`;
  env.files.set('lesson.md', original);
  await env.plugin.fillCurrentPaperImages();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.url, diagram);
  assert.ok(calls[1].at - calls[0].at >= 1500);
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.equal((env.files.get('lesson带图版.md').match(/!\[\|200\]/g) || []).length, 1);
  assert.equal(env.files.get('lesson.md'), original);
  assert.match(env.files.get('lesson带图版.md'), /\*原卷第13题\*/);
  assert.match(env.files.get('lesson带图版.md'), /^# 讲义 #h0/);
  await env.plugin.fillCurrentPaperImages();
  assert.equal(calls.length, 2);
});

test('an unsuccessful image search preserves the source and document title', async () => {
  const env = setup(async () => ({ status: 200, json: { code: 200, data: [] } }));
  const original = `# 原试卷 #h0\n\n###### 1\n\n> [!ti] *2026年10月北京市第一七一中学高二上学期月考物理第1题*\n> ${questionText}`;
  env.files.set('lesson.md', original);
  await env.plugin.fillCurrentPaperImages();
  assert.equal(env.files.get('lesson带图版.md'), original);
});

test('raising the cap keeps distinct diagrams and never downloads solution assets', async () => {
  const gets = [];
  const env = setup(async options => {
    if (options.method === 'POST') return { status: 200, json: { code: 200, data: [stemItem()] } };
    gets.push(options.url);
    return imageResponse([137, 80, 78, 71, gets.length]);
  });
  env.plugin.settings.maxImagesPerQuestion = 2;
  env.files.set('lesson.md', `> [!ti] *例题*\n> ${questionText}`);
  await env.plugin.fillCurrentPaperImages();
  assert.deepEqual(gets, [diagram, secondDiagram]);
  assert.equal((env.files.get('lesson带图版.md').match(/!\[\|200\]/g) || []).length, 2);
});

test('formula-only and solution-only questions make no image requests', async () => {
  let gets = 0;
  const env = setup(async options => {
    if (options.method !== 'POST') { gets++; return imageResponse(); }
    return { status: 200, json: { code: 200, data: [{ ...stemItem(), content: `${questionText}<img src="https://latexlib-cdn.jiaoyanyun.com/latex/library/x.svg">` }] } };
  });
  env.files.set('lesson.md', `> [!ti] *例题*\n> ${questionText}`);
  await env.plugin.fillCurrentPaperImages();
  assert.equal(gets, 0);
  assert.ok(!env.files.get('lesson带图版.md').includes('![|200]'));
});

test('successful searches are shared, failed searches can retry, and changed login invalidates the cache', async () => {
  let count = 0;
  let fail = true;
  const env = setup(async () => { count++; if (fail) throw new Error('offline'); return { json: { code: 200, data: [stemItem()] } }; });
  await assert.rejects(env.plugin.searchJiaoyanyun('query', 20), /offline/);
  fail = false;
  await Promise.all([env.plugin.searchJiaoyanyun('query', 20), env.plugin.searchJiaoyanyun('query', 20)]);
  assert.equal(count, 2);
  env.plugin.settings.jiaoyanyunToken = 'changed-local-token';
  await env.plugin.searchJiaoyanyun('query', 20);
  assert.equal(count, 3);
});

test('local image index survives a new plugin instance; identical bytes have one file and one embed', async () => {
  let requests = 0;
  const env = setup(async () => { requests++; return imageResponse(); });
  const result = await env.plugin.downloadQuestionImages([diagram, diagram + '?x-oss-process=resize', secondDiagram], 'assets');
  assert.equal(requests, 2);
  assert.equal(new Set(result.values()).size, 1);
  const second = setup(async () => { throw new Error('must reuse local file'); });
  second.plugin.app = env.plugin.app;
  await second.plugin.downloadQuestionImages([diagram, secondDiagram], 'assets');
  assert.equal(requests, 2);
  assert.equal(env.writes.filter(p => p.endsWith('.png')).length, 1);
});

test('concurrent API and image requests are serialized and spaced', async () => {
  const times = [];
  let active = 0;
  const env = setup(async (options, at) => {
    assert.equal(active++, 0);
    times.push(at);
    await Promise.resolve();
    active--;
    return options.method === 'GET' ? imageResponse() : { json: { code: 200 } };
  });
  await Promise.all([
    env.plugin.requestJiaoyanyun({ method: 'POST' }),
    env.plugin.requestJiaoyanyun({ method: 'GET' }, true),
    env.plugin.requestJiaoyanyun({ method: 'POST' })
  ]);
  assert.deepEqual(times, [100000, 101500, 103000]);
});

test('429 respects Retry-After and exponential delays, then stops; cooldown remains for the next request', async () => {
  let requests = 0;
  const times = [];
  const env = setup(async (_options, at) => {
    times.push(at); requests++;
    if (requests <= 3) return { status: 429, headers: { 'Retry-After': '20' } };
    return { status: 200, json: { code: 200 } };
  });
  await assert.rejects(env.plugin.requestJiaoyanyun({}), /429/);
  assert.equal(requests, 3);
  await env.plugin.requestJiaoyanyun({});
  assert.deepEqual(times, [100000, 120000, 150000, 210000]);
});

test('verification and exhausted rate limits are propagated out of image downloads', async () => {
  for (const response of [
    { status: 200, headers: { 'content-type': 'application/json' }, json: { code: 50302, msg: '进行验证' } },
    { status: 200, headers: { 'content-type': 'text/html' } },
    { status: 429 },
    { status: 403 }
  ]) {
    let count = 0;
    const env = setup(async () => { count++; return response; });
    await assert.rejects(env.plugin.downloadQuestionImages([diagram, secondDiagram], 'assets'));
    assert.equal(count, response.status === 429 ? 3 : 1);
    assert.equal(env.writes.length, 0);
  }
});

test('interrupted fill saves the completed question; rerun resumes and does not re-download it', async () => {
  const env = setup();
  const content = `# 讲义\n\n> [!ti] *第1题*\n> 第一题\n\n> [!ti] *第2题*\n> 第二题`;
  env.files.set('lesson.md', content);
  let matches = 0;
  const matched = { score: 100, question: { imageUrls: [diagram], answer: '', analysis: '' } };
  env.plugin.findJiaoyanyunMatch = async () => { matches++; if (matches === 2) throw new Error('教研云需要浏览器验证'); return matched; };
  await env.plugin.fillCurrentPaperImages();
  assert.equal(matches, 2);
  assert.equal((env.files.get('lesson带图版.md').match(/!\[\|200\]/g) || []).length, 1);
  env.plugin.findJiaoyanyunMatch = async () => { matches++; return matched; };
  await env.plugin.fillCurrentPaperImages();
  assert.equal(matches, 3);
  assert.equal((env.files.get('lesson带图版.md').match(/!\[\|200\]/g) || []).length, 2);
  assert.equal(env.files.get('lesson.md'), content);
});

test('repeated clicks do not start overlapping fills', async () => {
  const env = setup();
  let release;
  let runs = 0;
  env.plugin.fillCurrentPaperImagesForActiveFile = () => { runs++; return new Promise(resolve => { release = resolve; }); };
  const first = env.plugin.fillCurrentPaperImages();
  await env.plugin.fillCurrentPaperImages();
  assert.equal(runs, 1);
  release();
  await first;
  assert.equal(env.plugin.imageFillRunning, false);
});
