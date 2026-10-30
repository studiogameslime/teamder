from pathlib import Path
import hashlib,json,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1]
shots=ROOT/'docs/features/screenshots'
manifest=shots/'manifest.json'
items=json.loads(manifest.read_text(encoding='utf-8'))
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
for source,dest in [('all-features.png','pulse-pro-all-2026-10-30.png'),('pro-only.png','pulse-pro-only-2026-10-30.png')]:
    path=ROOT/'artifacts/pro-planning-2026-10-30'/source
    shutil.copyfile(path,shots/dest)
    assert not any(item['file']==dest for item in items)
    items.append({'file':dest,'source':path.relative_to(ROOT).as_posix(),'platform':'Android',
        'environment':'תצוגה מבודדת של קוד המסך באימולטור, ללא חשבון או מסד',
        'sourceCommit':commit,'captured':'2026-10-30',
        'notes':['שינויים מקומיים מעל הקומיט; קוד המסך של הפולס עם סביבת הריצה הראשית של המאגר.',
            'מסך חדש; צולמו ברירת המחדל וסינון לאחר סימון, אין צילום מסך קודם.',
            'לא נבדקה התקנה חדשה או כניסה מתפריט הפולס המותקן.'],
        'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
manifest.write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Two screenshots and source limitations registered')
