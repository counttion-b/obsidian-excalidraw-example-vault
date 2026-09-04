from pathlib import Path
import re
root=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\obsidian-indexeddb-copy-20260904-restore')
outdir=Path(r'D:\obrepo\papers\教研\各季度讲义\高二秋\_转换工作流\recovered_candidates_bytes')
outdir.mkdir(exist_ok=True)
markers = {'l01': '# 第1讲静电场力学模型 #h0', 'l02': '# 第2讲电场中能的性质 #h0'}
# UTF-16 chars that indicate binary metadata after the string. Avoid common markdown chars.
bad_re = re.compile(r'[\u0000-\u0008\u000b\u000c\u000e-\u001f]|[\ue000-\uf8ff]|[\ufffd]')
for p in root.glob('*'):
    if p.suffix.lower() not in {'.log','.ldb'}:
        continue
    b=p.read_bytes()
    for key, marker in markers.items():
        needle=marker.encode('utf-16le')
        pos=0
        while True:
            i=b.find(needle,pos)
            if i<0: break
            raw=b[i:i+220000]
            text=raw.decode('utf-16le','ignore')
            # trim at first strong binary-ish run after the document begins
            end=len(text)
            for m in bad_re.finditer(text[1000:]):
                end=min(end, 1000+m.start())
                break
            # Also cut before obvious internal record markers if present far enough in.
            for pat in ['慰桴䑣', '楬歮挀', '牯杩湩污', 'displayText', '潰䅳', '笆']:
                j=text.find(pat, 1000)
                if j!=-1:
                    end=min(end,j)
            cand=text[:end].replace('\r\n','\n').replace('\r','\n')
            cand=re.sub(r'\n{4,}', '\n\n\n', cand).strip()+"\n"
            if len(cand)>1000:
                out=outdir / f'{key}_{p.stem}_byte{i}.md'
                out.write_text(cand, encoding='utf-8')
            pos=i+2
print('byte candidates:')
for f in sorted(outdir.glob('*.md')):
    text=f.read_text(encoding='utf-8', errors='ignore')
    print(f.name, len(text), 'kaodian=', '考点' in text, 'h4=', '####' in text, 'opts=', text.count('[!opts'), 'imgs=', text.count('![['), 'lines=', text.count('\n'))
