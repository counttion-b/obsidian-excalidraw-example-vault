from pathlib import Path
import re
root=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\obsidian-indexeddb-copy-20260904-restore')
outdir=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\recovered_candidates')
outdir.mkdir(exist_ok=True)
starts = {
    'l01': '# 第1讲静电场力学模型 #h0',
    'l02': '# 第2讲电场中能的性质 #h0',
}
# Characters that often appear when the UTF-16 string falls back into binary metadata.
bad_chars = set('\ufffd')
for p in root.glob('*'):
    if p.suffix.lower() not in {'.log','.ldb'}:
        continue
    s=p.read_bytes().decode('utf-16le','ignore')
    for key, marker in starts.items():
        pos=0
        idx=0
        while True:
            i=s.find(marker,pos)
            if i < 0:
                break
            # Take a generous window, then trim before obvious LevelDB/metadata noise.
            window=s[i:i+90000]
            end=len(window)
            patterns=[
                '\x00', '慰桴䑣', 'pathc', '楬歮挀', '牯杩湩污', 'displayText', '潰䅳', '笆',
            ]
            # Ignore metadata markers before the markdown actually gets going by starting after 500 chars.
            for pat in patterns:
                j=window.find(pat, 800)
                if j != -1:
                    end=min(end,j)
            cand=window[:end]
            cand=cand.replace('\r\n','\n').replace('\r','\n')
            # Clean repeated blank lines only lightly; preserve user's content.
            cand=re.sub(r'\n{4,}', '\n\n\n', cand).strip()+"\n"
            if len(cand) > 1000:
                idx += 1
                out=(outdir / f'{key}_{p.stem}_{i}.md')
                out.write_text(cand, encoding='utf-8')
            pos=i+1
print('candidates:')
for f in sorted(outdir.glob('*.md')):
    text=f.read_text(encoding='utf-8', errors='ignore')
    print(f.name, len(text), '考点' in text, '1.2.1' in text, '####' in text, text.count('\n'))
