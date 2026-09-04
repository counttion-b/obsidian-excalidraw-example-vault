from pathlib import Path
root=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\obsidian-indexeddb-copy-20260904-restore')
out=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\cache_hits.txt')
rows=[]
for p in root.glob('*'):
    if p.suffix.lower() not in {'.log','.ldb'}:
        continue
    b=p.read_bytes()
    s=b.decode('utf-16le','ignore')
    for needle in ['第1讲静电场力学模型', '第2讲电场中能的性质', '静电场力学模型_知识点_v2.md', '电场中能的性质_知识点_v2.md']:
        start=0
        while True:
            i=s.find(needle,start)
            if i<0: break
            rows.append(f'FOUND {p.name} {needle} {i}\n{s[max(0,i-300):i+800].replace(chr(0), "")}\n---\n')
            start=i+1
out.write_text('\n'.join(rows), encoding='utf-8')
print(f'wrote {out}, hits={len(rows)}')
