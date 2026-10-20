"""Small, local documentation index. Fingerprints measure drift, not correctness."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/features'
STATUS = BASE / 'status'
REGISTRY = STATUS / 'state.json'
DOMAINS = {'entry':'כניסה', 'home':'בית', 'profile':'פרופיל', 'clubs':'מועדונים',
           'rounds':'מחזורים', 'statistics':'סטטיסטיקות', 'chat':'צ׳אט', 'shared':'משותף ופולס'}

def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()

def text(path):
    return path.read_text(encoding='utf-8-sig')

def clean(value):
    value = re.sub(r'!\[[^]]*\]\([^)]+\)', '', value)
    value = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', value)
    return re.sub(r'\s+', ' ', value.replace('**','').replace('`','')).strip()

def excerpt(value, limit=340):
    value = clean(value)
    return value if len(value) <= limit else value[:limit].rsplit(' ',1)[0] + '…'

def link(label, target, origin):
    return '['+label.replace('|','／')+']('+Path(os.path.relpath(target, origin)).as_posix()+')'

def pairs():
    return json.loads(text(BASE / 'document-pairs.json'))

def screens():
    return sorted(p.relative_to(ROOT).as_posix() for folder in ('src/screens','pulse/src/screens')
                  for p in (ROOT/folder).rglob('*.tsx'))

@lru_cache(maxsize=1)
def source_names():
    names={}
    for folder in ('src','functions/src','pulse/src','tests','public','plugins','modules','targets'):
        for p in (ROOT/folder).rglob('*'):
            if p.is_file() and p.suffix in ('.ts','.tsx','.js','.cjs','.mjs','.json','.html','.css','.kt','.swift'):
                names.setdefault(p.name,[]).append(p.relative_to(ROOT).as_posix())
    return names

def screen_owners(ps):
    result = {s:[] for s in screens()}
    coverage = text(BASE/'coverage.md')
    for pair in ps:
        key = pair['technical'][:-3]
        body = text(BASE/pair['technical'])+'\n'+text(BASE/pair['simple'])
        for s in result:
            # Full paths in feature documents, or an explicit coverage-table assignment.
            rows = [line for line in coverage.splitlines() if s in line]
            if s in body or any(pair['technical'] in line for line in rows):
                result[s].append(key)
    return result

def capture(pair, owners):
    technical, simple = BASE/pair['technical'], BASE/pair['simple']
    body, plain = text(technical), text(simple)
    paras = [p.strip() for p in re.split(r'\n\s*\n',plain)
             if p.strip() and not p.lstrip().startswith(('#','!','|','[','- ','```'))
             and '../status/' not in p]
    headings = re.findall(r'^#{1,3}\s+(.+)$',body,re.M)
    dated = []
    for h in headings:
        for d,m,y in re.findall(r'\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b',h):
            try: dated.append((datetime.date(int(y),int(m),int(d)).isoformat(),h))
            except ValueError: pass
    latest = max((d for d,h in dated),default=None)
    changes = [clean(h) for d,h in dated if d==latest][:3]
    refs = set(re.findall(r'(?<![\w/])(?:src|functions/src|pulse/src|tests|public|plugins|modules|targets)/[A-Za-z0-9_./-]+\.(?:json|tsx?|[cm]?js|html|css|kt|swift)(?![\w.])',body+'\n'+plain))
    # Older documents name some modules without a path. Resolve only unique names.
    for mention in re.findall(r'`([^`]+)`',body+'\n'+plain):
        if '/' not in mention and mention in source_names() and len(source_names()[mention])==1:
            refs.add(source_names()[mention][0])
    key = pair['technical'][:-3]
    owned = sorted(s for s, ids in owners.items() if key in ids)
    refs.update(owned)
    # Coverage is a map, not evidence that a route is registered or was opened.
    existing = sorted(s for s in refs if (ROOT/s).is_file())
    missing = sorted(s for s in refs if not (ROOT/s).is_file())
    evidence = []
    for raw in re.split(r'\n\s*\n',body):
        p=raw.strip()
        if p.startswith(('#','|','!','```')): continue
        if re.search(r'טרם|לא הור[ץצ]|לא נבדק|נבדק|מגבלות|עברו|לא אומת',p):
            evidence.append(excerpt(p,260))
    return {'id':key,'title':pair['title'],'domain':pair['domain'],
            'technical':pair['technical'],'simple':pair['simple'],
            'capturedOn':datetime.date.today().isoformat(),
            'basis':'existing-documentation-only',
            'summary':excerpt(paras[0]) if paras else 'יש לעיין במסמך המקור.',
            'latestDatedSection':latest,'recentSections':changes,
            'evidenceExcerpts':evidence[:3], 'screens':owned,
            'documents':{pair['technical']:digest(technical),pair['simple']:digest(simple)},
            'sources':{s:digest(ROOT/s) for s in existing},'missingDocumentedPaths':missing}

def drift(item):
    problems=[]
    for rel,expected in item['documents'].items():
        p=BASE/rel
        if not p.is_file() or digest(p)!=expected: problems.append('תיעוד השתנה: '+rel)
    for rel,expected in item['sources'].items():
        p=ROOT/rel
        if not p.is_file() or digest(p)!=expected: problems.append('מקור השתנה: '+rel)
    return problems

def load():
    return json.loads(text(REGISTRY))

def render(reg):
    STATUS.mkdir(parents=True,exist_ok=True)
    items=reg['features'];byid={i['id']:i for i in items}
    out=['# מצב פיצ׳רים ומסכים — כניסה קצרה לעבודה','',
         'נאסף מהתיעוד הקיים ב־'+reg['initializedOn']+'. זהו מפתח מצב מתועד; לא נערכה כאן הרצה חדשה או בדיקת פריסה.','',
         f"במפתח {len(items)} פיצ׳רים ו־{len(reg['screens'])} קובצי מסך באפליקציה ובפולס. כמה מסכים שייכים לפיצ׳ר אחד ולהפך.",'',
         'לפני שינוי: מצא את הפיצ׳ר בתחום המתאים, הצג את הכרטיס עם בדיקת השינויים, ואז קרא רק את סעיף המקור והקוד הנוגעים למשימה.','',
         '```','python scripts/feature_status.py show rounds/live-advanced','```','',
         'הפקודה פועלת משורש המאגר, קוראת חותמות מקומיות ומציגה תמצית. אין שליחה לשרת ואין קריאת כל יומני השיחות.','',
         '| תחום | פיצ׳רים |','|---|---:|']
    for domain,title in DOMAINS.items():
        out.append(f"| [{title}]({domain}.md) | {sum(i['domain']==domain for i in items)} |")
    out += ['', '[כל קובצי המסך](screens.md) · [מפת המוצר](../README.md) · [תחזוקה](../maintenance.md)','',
            '## משמעות המצב','',
            '- **תיעוד קיים:** תמצית מתוך ההסבר הפשוט, עדכונים מתוארכים וקטעי ראיות מהמסמך הטכני. זו אינה הכרזה שהפיצ׳ר הושלם או הופץ.',
            '- **ללא שינוי במקורות שנרשמו:** חותמות המסמכים והקבצים המוזכרים עדיין זהות. אין בכך הוכחת נכונות, כיסוי כל התלויות או בדיקת מסך.',
            '- **דורש רענון:** מסמך או מקור שנרשם השתנה. קרא את ההבדל ועדכן תיעוד לפני שימוש בתמצית כמצב עדכני.',
            '- **חסר שיוך או נתיב:** פער תיעוד גלוי, ולא ראיה שהמסך חסר במוצר. גם קובץ מסך קיים אינו מוכיח שהוא נגיש בניווט.',
            '- **בדיקות והפצה:** יש לעיין בראיה המקושרת ובתאריך שלה. קטעי הראיות עשויים לתאר בדיקה תחומה או מצב היסטורי; אין להסיק מהם אישור כולל.','',
            'חותמות נוצרו בעת קליטת התיעוד, לא בעת אימות התנהגות הקוד. קובץ שאינו מוזכר במסמך ותלות עקיפה אינם מכוסים אוטומטית.','',
            'אחרי שינוי ועדכון זוג המסמכים:','', '```',
            'python scripts/feature_status.py refresh rounds/live-advanced',
            'python scripts/feature_status.py check','```','',
            'רענון אינו מסמן בדיקה או פריסה. הוא מקליט את התיעוד והמקורות אחרי בדיקת השינוי. מידע חדש על התנהגות, בדיקות או חסם נכתב בזוג המסמכים, ומשם מופק המפתח.','']
    (STATUS/'README.md').write_text('\n'.join(out),encoding='utf-8')
    for domain,title in DOMAINS.items():
        lines=['# מצב מתועד — '+title,'','[מפתח המצב](README.md) · [קובצי המסך](screens.md)','',
               'הכרטיסים הם תמצית מהמסמכים, לא אימות חדש. להרצה, להפצה ולחסמים יש לקרוא את הראיה במקורה. מצב החותמות נבדק בפקודת ההצגה.','']
        for item in items:
            if item['domain']!=domain: continue
            lines += ['<a id="'+item['id'].replace('/','-')+'"></a>','',
                      '## '+item['title'],'',f"מזהה: `{item['id']}` · קליטת תיעוד: {item['capturedOn']} · אימות חדש במשימת המפתח: לא בוצע.",'',
                      '**תמצית פתיחת ההסבר הפשוט:** '+item['summary'],'',
                      '**סעיפים מתוארכים אחרונים:** '+(' · '.join(item['recentSections']) or 'אין כותרת מתוארכת; אין להסיק תאריך עדכון.'),'',
                      '**מקור:** '+link('הסבר פשוט',BASE/item['simple'],STATUS)+' · '+link('התנהגות, נתונים, ניווט, בדיקות ומגבלות',BASE/item['technical'],STATUS),'']
            if item['screens']:
                lines += ['**קובצי מסך משויכים:** '+', '.join('`'+s+'`' for s in item['screens']), '']
            else:lines += ['**קובצי מסך:** אין שיוך ישיר במפתח; ייתכן רכיב משותף או שירות.','']
            if item['evidenceExcerpts']:
                lines += ['**קטעי ראיות ומגבלות מהתיעוד — לקרוא בהקשר המקור:**','']
                lines += ['- '+v for v in item['evidenceExcerpts']]
                lines += ['']
            if item['missingDocumentedPaths']:
                lines += ['**פערי נתיבים בתיעוד:** '+', '.join('`'+s+'`' for s in item['missingDocumentedPaths']), '']
        (STATUS/(domain+'.md')).write_text('\n'.join(lines),encoding='utf-8')
    lines=['# מצב ושיוך קובצי המסך','', '[מפתח המצב](README.md)','',
           'מיפוי כל קובצי המסך בשתי האפליקציות. השיוך נשען על אזכור מלא במסמך או על מפת הכיסוי. לא נבדקה כאן הרשמת נתיב או נגישות בהרצה.','',
           '| קובץ מסך | מסמכי מצב | בסיס |','|---|---|---|']
    for s,ids in reg['screens'].items():
        refs=' · '.join('['+byid[k]['title']+']('+byid[k]['domain']+'.md#'+k.replace('/','-')+')' for k in ids)
        lines.append('| '+link(s,ROOT/s,STATUS)+' | '+(refs or 'חסר שיוך — דרוש עדכון תיעוד')+' | '+('מתועד; לא הורץ מחדש' if ids else 'קובץ קיים בלבד')+' |')
    (STATUS/'screens.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

def check_status():
    if not REGISTRY.is_file():return ['חסר מפתח מצב פיצ׳רים']
    reg=load();ps=pairs();problems=[]
    expected={p['technical'][:-3] for p in ps}
    if {i['id'] for i in reg['features']}!=expected:problems.append('מפתח המצב אינו מכסה את זוגות המסמכים הנוכחיים')
    if reg['screens']!=screen_owners(ps):problems.append('רשימת המסכים או השיוכים השתנתה; רענן את הפיצ׳רים שנוגעים לשינוי')
    for item in reg['features']:
        for why in drift(item):problems.append(item['id']+': '+why)
    return problems

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('init','refresh','check','show'))
    parser.add_argument('feature',nargs='?')
    args=parser.parse_args()
    if args.action=='check':
        problems=check_status();print(json.dumps({'failures':problems},ensure_ascii=False,indent=2));return bool(problems)
    if args.action=='show':
        reg=load();item=next((i for i in reg['features'] if i['id']==args.feature),None)
        if not item:parser.error('נדרש מזהה פיצ׳ר קיים')
        data={k:v for k,v in item.items() if k not in ('documents','sources')}
        data['drift']=drift(item)
        data['fingerprintStatus']='דורש רענון' if data['drift'] else 'ללא שינוי במקורות שנרשמו; לא הוכחת תקינות'
        print(json.dumps(data,ensure_ascii=False,indent=2));return 0
    ps=pairs();owners=screen_owners(ps)
    if args.action=='init':
        if REGISTRY.exists():parser.error('המפתח כבר קיים; רענן פיצ׳ר ממוקד')
        reg={'schemaVersion':1,'initializedOn':datetime.date.today().isoformat(),
             'features':[capture(p,owners) for p in ps],'screens':owners}
    else:
        reg=load();pair=next((p for p in ps if p['technical'][:-3]==args.feature),None)
        if not pair:parser.error('נדרש מזהה פיצ׳ר קיים')
        new=capture(pair,owners);old=next((i for i in reg['features'] if i['id']==args.feature),None)
        if old and old['sources']!=new['sources'] and old['documents']==new['documents']:
            parser.error('המקור השתנה ללא עדכון זוג המסמכים; בדוק את ההבדל ועדכן אותם לפני רענון החותמות')
        reg['features']=[new if i['id']==args.feature else i for i in reg['features']]
        if old is None:reg['features'].append(new)
        reg['features']=[i for i in reg['features'] if i['id'] in {p['technical'][:-3] for p in ps}]
        reg['screens']=owners
    STATUS.mkdir(parents=True,exist_ok=True)
    REGISTRY.write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    render(reg)
    missing=[s for s,ids in owners.items() if not ids]
    print(json.dumps({'features':len(reg['features']),'screens':len(owners),'unmappedScreens':missing},ensure_ascii=False,indent=2))
    return 0

if __name__=='__main__':
    sys.exit(main())
