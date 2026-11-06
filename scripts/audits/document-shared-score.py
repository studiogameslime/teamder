"""Record the scoped local scoring implementation; never a deployment claim."""
from pathlib import Path
import hashlib, importlib.util, json, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/features'
OUT=ROOT/'artifacts/shared-score-implementation-2026-11-06'
link='../../changes/2026-11-06-shared-evening-score.md'
technical=(BASE/'rounds/match-stats.md').read_text(encoding='utf-8')
assert '## ציון מחזור משותף למחזורי העתיד, 6.11.2026' in technical

for phase,label in [('before','לפני'),('after','אחרי')]:
    source=OUT/f'info-{phase}.png'
    destination=BASE/f'screenshots/shared-evening-score-{phase}-2026-11-06.png'
    destination.write_bytes(source.read_bytes())
manifest_path=BASE/'screenshots/manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
commit=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.strip()
for phase in ['before','after']:
    filename=f'shared-evening-score-{phase}-2026-11-06.png'
    record={'file':filename,'source':f'artifacts/shared-score-implementation-2026-11-06/info-{phase}.png',
        'platform':'Web','environment':'רכיב חלונית ההסבר המקורי במתאם דפדפן, עם גרסת מחזור לדוגמה בלבד',
        'sourceCommit':commit,'captured':'2026-11-06','notes':[
          'שינויים מקומיים מעבר למקור הרשום. רוחב 390 וגופן רגיל. הצילום נפתח ונבחן.',
          'נבדקו מעבר בין גרסאות, גלילה וסגירה בשלושה רוחבים ובשני גדלי גופן. אין אימות מכשיר חדש.',
          'המעטפת והסמלים מותאמים לדפדפן. אין נתוני ייצור, שינוי ציונים ישנים או פריסה.'],
        'sha256':hashlib.sha256((BASE/'screenshots'/filename).read_bytes()).hexdigest()}
    manifest=[r for r in manifest if r.get('file')!=filename]+[record]
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

spec_path=ROOT/'docs/specs/2026-11-06-shared-evening-score.md'
spec=spec_path.read_text(encoding='utf-8')
notice='מימוש מקומי מיום 6.11.2026: [מסלול הנתונים, שמירת העבר והבדיקות](../changes/2026-11-06-shared-evening-score.md). טרם הופץ או הופעל בשרת. סעיפי ההדמיה והבדיקות של שמירת האפיון להלן נשמרים כראיות היסטוריות, ואינם מתארים פריסה.\n\n'
if notice not in spec:
    head,rest=spec.split('\n',1);spec_path.write_text(head+'\n\n'+notice+rest.lstrip(),encoding='utf-8')
simple_path=ROOT/'docs/specs/2026-11-06-shared-evening-score.simple.md'
simple=simple_path.read_text(encoding='utf-8')
old='זהו האפיון הנוכחי שסוכם ביום 6.11.2026. קוד האפליקציה והציונים השמורים עדיין לא שונו.'
simple=simple.replace(old,'זהו האפיון הנוכחי שסוכם ביום 6.11.2026. מומש מקומית למחזורי העתיד, וטרם הופץ או הופעל בשרת. הציונים השמורים של מחזורי העבר לא שונו.')
simple_path.write_text(simple,encoding='utf-8')

# Shared typed readers are documented by many features. Record only the
# reviewed scoring dependency, without claiming their independent flows ran.
spec_module=importlib.util.spec_from_file_location('score_feature_status',ROOT/'scripts/feature_status.py')
feature=importlib.util.module_from_spec(spec_module);spec_module.loader.exec_module(feature)
reg=feature.load();pairs=feature.pairs();by_id={p['technical'][:-3]:p for p in pairs}
changed={'src/firebase/firestore.ts','src/types/index.ts','src/services/eveningSummaryService.ts',
 'src/screens/games/EveningSummaryScreen.tsx','functions/src/seasonManager.ts','functions/src/retroScorePlan.ts',
 'functions/src/retroScores.ts','functions/src/index.ts','tests/logic/dataLiveAuditServerCommit.test.ts'}
updated=['rounds/match-stats']
for item in reg['features']:
    if item['id']=='rounds/match-stats':continue
    drift=feature.drift(item)
    relevant=[reason for reason in drift if any(path in reason for path in changed)]
    if not relevant:continue
    pair=by_id[item['id']]
    for kind in ['simple','technical']:
        path=BASE/pair[kind];body=path.read_text(encoding='utf-8')
        heading='## תלות משותפת בציון המחזור החדש, 6.11.2026'
        if heading not in body:
            detail=' המקורות המשותפים שנבדקו בהפרש התחום: '+', '.join(sorted(path for path in changed if any(path in r for r in relevant)))+'.' if kind=='technical' else ''
            body+='\n\n'+heading+'\n\nנוספה תמיכה מקומית בגרסת ציון למחזורי העתיד ובקריאת הרף הקפוא, תוך שמירת המודל של מחזורים קודמים. השינוי כאן תחום לתלות במקורות המשותפים, ואינו אימות חדש של כל המסלול העצמאי.'+detail+' אין פריסה, הסבת נתונים או שינוי ציוני עבר. [התנהגות, בדיקות ומגבלות]('+link+').\n'
            path.write_text(body,encoding='utf-8')
    updated.append(item['id'])
owners=feature.screen_owners(pairs)
captured={item['id']:feature.capture(by_id[item['id']],owners) for item in reg['features'] if item['id'] in updated}
# Preserve other documentation work that finished while fingerprints were read.
reg=feature.load()
reg['features']=[captured.get(item['id'],item) for item in reg['features']]
reg['screens']=owners
feature.REGISTRY.write_text(json.dumps(reg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');feature.render(reg)
(OUT/'documentation-refresh.json').write_text(json.dumps({'features':updated,'deployed':False},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'scopedFeaturesRefreshed':len(updated),'screenshots':2,'deployed':False}))
