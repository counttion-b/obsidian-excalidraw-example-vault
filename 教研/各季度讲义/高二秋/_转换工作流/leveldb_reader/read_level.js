const { Level } = require('level');
const path = 'D:/obrepo/papers/教研/各季度讲义/高二秋/_转换工作流/obsidian-indexeddb-copy-20260904-restore';
(async () => {
  const db = new Level(path, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  let count=0, hits=0;
  for await (const [key, value] of db.iterator()) {
    count++;
    const bufs=[key,value];
    const joined=Buffer.concat(bufs);
    const utf8=joined.toString('utf8');
    const u16=joined.toString('utf16le');
    if (utf8.includes('静电场力学模型') || utf8.includes('电场中能的性质') || u16.includes('静电场力学模型') || u16.includes('电场中能的性质')) {
      hits++;
      console.log('HIT', hits, 'keylen', key.length, 'vallen', value.length);
      console.log('key hex', key.subarray(0,80).toString('hex'));
      console.log('utf8', utf8.slice(0,500).replace(/\u0000/g,''));
      console.log('u16', u16.slice(0,500).replace(/\u0000/g,''));
      console.log('---');
    }
  }
  console.error('count', count, 'hits', hits);
  await db.close();
})().catch(e=>{ console.error(e); process.exit(1); });
