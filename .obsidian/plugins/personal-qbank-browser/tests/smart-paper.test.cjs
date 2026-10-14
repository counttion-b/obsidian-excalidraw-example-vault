const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, imageResponse, smart } = require('./smart-harness.cjs');
const stem = '如图所示为静电场中的一簇电场线，比较A、B两位置的电场强度和电势关系。';
const pic = 'https://example.com/stem.png', other = 'https://example.com/other.png', solution = 'https://example.com/solution.png';
const opts = [{ aoVal: 'A', content: '场强相同' }, { aoVal: 'B', content: '场强不同' }];
const item = (extra = {}) => ({ queId: 'same-question', content: `<p>${stem}</p><img src="${pic}">`, answerOptionList: opts, answer: [['B']], analysis: '电场线疏密表示场强大小，因此B正确。', ...extra });
const block = (n = 1, body = stem) => `###### ${n}\n\n> [!ti] *原学校第${n}题*\n> ${body}\n> > [!opts2]\n> > - A. 场强相同\n> > - B. 场强不同\n`;
const request = (data = item()) => async o => o.method === 'GET' ? imageResponse(o.url === solution ? [1,2,3] : o.url === other ? [4,5,6] : [7,8,9]) : { status: 200, json: { code: 200, data: [data] } };

test('recognizes common solution markers without interpreting question prose as answers', () => {
  for (const text of ['【答案】B', '答案：B', '**正确答案：B**', '> [!answer] B', '### 答案\nB']) {
    assert.equal(smart.splitFields(`${stem}\n${text}\n【解析】电场线疏密。`).answer, 'B', text);
    assert.ok(!smart.splitFields(`${stem}\n${text}\n【解析】电场线疏密。`).problem.includes('电场线疏密。'));
  }
  assert.equal(smart.solutionMarker('答案可能有多个，请判断。'), null);
  assert.equal(smart.solutionMarker('解析下列现象所用的规律。'), null);
});

test('mixed local fields, three outputs, source untouched, all answers precede all analyses', async () => {
  const e = setup(request());
  const original = '# 练习\n' + block() + '\n> **正确答案：B**\n' + block(2) + '\n### 解析\n原稿解析保留\n';
  e.files.set(e.file.path, original);
  const result = await e.run();
  assert.equal(result.total, 2);
  const student = e.files.get(result.paths.student), teacher = e.files.get(result.paths.teacher), answer = e.files.get(result.paths.answer);
  assert.ok(!student.includes('答案')); assert.ok(!student.includes('原稿解析')); assert.ok(!student.includes('因此B正确'));
  assert.equal((teacher.match(/### 答案/g) || []).length, 2);
  assert.ok(teacher.includes('原稿解析保留'));
  assert.ok(answer.indexOf('### 第2题') < answer.indexOf('## 配套解析'));
  assert.ok(answer.indexOf('## 配套解析') < answer.indexOf('### 第1题解析'));
  assert.equal(e.files.get(e.file.path), original);
  assert.equal(e.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(e.calls.filter(c => c.method === 'GET').length, 1);
  for (const row of result.rows) assert.equal(row.matchedId, 'same-question');
  const callsBefore = e.calls.length;
  const next = await e.run();
  assert.equal(e.calls.length, callsBefore);
  assert.notEqual(next.paths.student, result.paths.student);
  assert.ok(e.files.has(result.paths.student));
});

test('smart completion preserves the input source even with a preferred bank source', async () => {
  const e = setup(request());
  e.files.set(e.file.path, block());
  const originalConverter = e.deps.questionFromJiaoyanyunItem;
  e.deps.questionFromJiaoyanyunItem = (...args) => ({ ...originalConverter(...args), preferredSource: { name: '另一学校第8题' } });
  const result = await e.run();
  assert.equal(result.rows[0].source, '原学校第1题');
  assert.match(e.files.get(result.paths.student), /\*原学校第1题\*/);
});

test('missing either solution field fetches detail once using the same ID', async () => {
  const e = setup(async o => {
    if (o.method === 'GET') return imageResponse();
    if (o.url.endsWith('/page')) return { status: 200, json: { code: 200, data: [item({ analysis: '' })] } };
    assert.deepEqual(JSON.parse(o.body).idList, ['same-question']);
    return { status: 200, json: { code: 200, data: [item()] } };
  });
  e.files.set(e.file.path, block());
  const r = await e.run();
  assert.equal(e.calls.filter(c => c.method === 'POST').length, 2);
  assert.ok(r.rows[0].analysis.includes('B正确'));
  assert.equal(r.reviewCount, 0);
});

test('strict equality retains changed numbers, choice order, inequalities, negation, decimals and grouping', () => {
  for (const [a,b] of [['速度为1.5m/s','速度为15m/s'], ['质量为2kg','质量为3kg'], ['A. 大\nB. 小','A. 小\nB. 大'], ['场强A>B','场强A<B'], ['正确的是','不正确的是'], ['a/(b+c)','a/b+c']]) assert.notEqual(smart.canonical(a), smart.canonical(b));
  assert.equal(smart.canonical('$\\varphi_A>\\varphi_B$'), smart.canonical('φ<sub>A</sub>＞φ<sub>B</sub>'));
  assert.equal(smart.canonical('$\\dfrac14$'), smart.canonical('$\\frac{1}{4}$'));
});

test('near match or conflict never receives a solution or diagram', async () => {
  for (const rows of [[item({ content: `<p>${stem.replace('静电场', '匀强电场')}</p>` })], [item(), item({queId: 'conflict', answer: [['A']]})]]) {
    const e = setup(async () => ({status:200,json:{code:200,data:rows}}));
    e.files.set(e.file.path, block());
    const r = await e.run();
    assert.match(r.rows[0].answer, /待补充/);
    assert.equal(e.calls.filter(c => c.method === 'GET').length, 0);
    assert.ok(r.reviewCount > 0);
  }
});

test('all necessary stem, option and analysis images survive, repeated stem images deduplicate', async () => {
  const record = item({ content: `${stem}<img src="${pic}"><img src="${pic}"><img src="${other}">`, answerOptionList: [{aoVal:'A',content:`场强相同<img src="${pic}">`},opts[1]], analysis: `解题过程<img src="${solution}">` });
  const e = setup(request(record)); e.files.set(e.file.path, block());
  const r = await e.run(), student = e.files.get(r.paths.student), teacher = e.files.get(r.paths.teacher);
  assert.equal(smart.imageRefs(student).length, 3); // 2 stem + intentional A option image
  assert.equal(smart.imageRefs(teacher).length, 4);
  assert.equal(e.calls.filter(c => c.method === 'GET').length, 3);
  assert.ok(student.indexOf('A.') < student.lastIndexOf('image_'));
});

test('nested questions keep their options, nested empty fields stay visibly pending', () => {
  const e = setup(request());
  const q = e.deps.questionFromJiaoyanyunItem(item({ answer: [], blankAnswer: 'blank', childList: [{content:'子题',answerOptionList:opts,answer:[],analysis:''}]}), '4','3').smart;
  assert.match(q.problem, /（1）子题[\s\S]*A\. 场强相同/);
  assert.match(q.answer, /^blank[\s\S]*（1）\[待补充/);
});

test('API HTML preserves math SVG titles with attributes, superscripts, tables and lazy images', () => {
  const e = setup(request());
  const q = e.deps.questionFromJiaoyanyunItem(item({analysis:'<svg><title id="x">E_A &lt; E_B</title><path/></svg><p>x<sub>1</sub><sup>2</sup></p><table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table><img src="data:x" data-original="https://example.com/lazy.png">'}),'4','3').smart;
  assert.ok(q.analysis.includes('$E_A < E_B$'));
  assert.match(q.analysis, /<sub>1<\/sub><sup>2<\/sup>/);
  assert.match(q.analysis, /\| --- \| --- \|/);
  assert.equal(smart.imageRefs(q.analysis).at(-1).url, 'https://example.com/lazy.png');
});

test('existing local attachments remain reachable from the export folder and do not force network downloads', async () => {
  const e = setup(request()); e.plugin.settings.jiaoyanyunToken = '';
  e.files.set('试卷/assets/已有 图.png', new Uint8Array([1,2]).buffer);
  e.files.set(e.file.path, block(1, stem+'\n> ![[assets/已有 图.png|200]]')+'\n【答案】B\n【解析】本地解析');
  const r = await e.run();
  const image = smart.imageRefs(e.files.get(r.paths.student))[0];
  assert.equal(image.url, '../../assets/已有 图.png');
  assert.equal(e.calls.length, 0);
});

test('image failure marks output as incomplete; retry uses matched cache and fills the missing attachment', async () => {
  let fail = true;
  const e = setup(async o => o.method === 'GET' && fail ? { status: 500 } : request()(o));
  e.files.set(e.file.path, block());
  const first = await e.run(); assert.match(e.files.get(first.paths.student), /此处图片待补充/);
  assert.equal(first.reviewCount, 1);
  fail = false;
  const second = await e.run(); assert.equal(second.reviewCount, 0);
  assert.equal(e.calls.filter(c => c.method === 'POST').length, 1);
});

test('auth stop makes no further requests, exports pending questions, then resumes without lost source', async () => {
  let stop = true;
  const e = setup(async o => o.method === 'GET' && stop ? { status:403 } : request()(o));
  e.files.set(e.file.path, block()+block(2));
  const r = await e.run(); assert.equal(r.stopped, true); assert.equal(r.total, 2);
  assert.equal(e.calls.length, 2);
  stop = false; const r2 = await e.run();
  assert.equal(r2.stopped, false); assert.ok(r2.rows.every(q=>q.answer==='B'));
  assert.equal(e.calls.filter(c => c.method === 'POST').length, 1);
});

test('separate numbered appendix is associated by number and never exported as student questions', () => {
  const e = setup(request());
  const parsed = smart.parse(block()+block(2)+'\n## 答案汇总\n\n### 第1题\nB\n### 第2题\nA\n\n## 解析汇总\n### 第1题\n解析一\n### 第2题\n解析二',e.deps);
  assert.equal(parsed.rows.length,2); assert.equal(parsed.rows[0].answer,'B'); assert.equal(parsed.rows[0].analysis,'解析一');
  assert.ok(!parsed.rows[1].problem.includes('答案汇总'));
});

test('plain numbered papers parse and local per-question level-two answer headings are not global appendices', () => {
  const e = setup(request());
  const rows = smart.parse('1. 第一个题干足够完整\n## 答案\nA\n## 解析\n本地解析一\n2. 第二个题干足够完整\n【答案】B\n【解析】本地解析二',e.deps).rows;
  assert.equal(rows.length, 2); assert.equal(rows[0].answer,'A'); assert.equal(rows[1].analysis,'本地解析二');
});

test('partial original illustration cannot be silently replaced if it differs from the selected record', async () => {
  const e = setup(request(item({content:`${stem}<img src="${pic}"><img src="${other}">`})));
  e.files.set('试卷/original.png',Uint8Array.from([123]).buffer);
  e.files.set(e.file.path,block(1,`${stem}\n> ![](original.png)`));
  const r = await e.run(); assert.match(r.rows[0].problem,/original.png/); assert.ok(r.rows[0].issues.some(v=>v.includes('不能确认一致')));
  assert.match(r.rows[0].answer,/待补充/);
});

test('changed question text invalidates prior matching cache and does not reuse old answers', async () => {
  const e = setup(request()); e.files.set(e.file.path,block()); await e.run();
  e.files.set(e.file.path,block(1,stem.replace('电场强度','加速度')));
  const r=await e.run(); assert.match(r.rows[0].answer,/待补充/); assert.equal(e.calls.filter(c=>c.method==='POST').length,2);
});

test('missing images in otherwise matching existing analyses are restored', async () => {
  const e = setup(request(item({analysis:`电场线疏密表示场强大小。<img src="${solution}">`})));
  e.files.set(e.file.path,block()+'\n【答案】B\n【解析】电场线疏密表示场强大小。\n![](lost.png)');
  const r=await e.run(); assert.ok(smart.imageRefs(r.rows[0].analysis).length===1); assert.ok(r.rows[0].added.includes('解析配图'));
});

test('different detail IDs cannot contaminate an accepted match', async () => {
  const e=setup(async o=>({status:200,json:{code:200,data:[item(o.url.endsWith('/page')?{analysis:''}:{queId:'different-id'})]}}));
  e.files.set(e.file.path,block()); const r=await e.run(); assert.match(r.rows[0].answer,/待补充/); assert.equal(r.reviewCount,1);
});

test('cancellation after search produces pending versions and makes no image request', async () => {
  let env;
  env=setup(async()=>{env.plugin.smartPaperCancelled=true;return {status:200,json:{code:200,data:[item()]}}});
  env.files.set(env.file.path,block()+block(2)); const r=await env.run(); assert.equal(r.stopped,true); assert.equal(env.calls.length,1); assert.equal(r.total,2);
});

test('exact original picture content allows repairing partial figures and borrowing same-record solutions', async () => {
  const e=setup(request(item({content:`${stem}<img src="${pic}"><img src="${other}">`})));
  e.files.set('试卷/original.png',Uint8Array.from([7,8,9]).buffer);
  e.files.set(e.file.path,block(1,`${stem}\n> ![](original.png)`));
  const r=await e.run(); assert.equal(smart.imageRefs(r.rows[0].problem).length,2); assert.equal(r.rows[0].answer,'B');
});

test('conflicting existing answer is preserved and does not receive the opposite bank analysis', async () => {
  const e=setup(request()); e.files.set(e.file.path,block()+'\n【答案】A');
  const r=await e.run(); assert.equal(r.rows[0].answer,'A'); assert.match(r.rows[0].analysis,/待补充/);
  assert.ok(r.rows[0].issues.some(v=>v.includes('答案冲突')));
});

test('installed bundled command runs, opens the report and rejects overlapping smart work', async () => {
  const e=setup(request()); e.files.set(e.file.path,block());
  await e.plugin.completeCurrentPaper();
  assert.ok(e.files.get(e.plugin.opened).includes('智能补全核对清单'));
  assert.equal(e.plugin.smartPaperRunning,false);
  const count=e.calls.length; e.plugin.smartPaperRunning=true;
  await e.plugin.completeCurrentPaper(); assert.equal(e.calls.length,count);
});
