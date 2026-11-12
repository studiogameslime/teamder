"""Document the reviewed shared-source delta and refresh through the official capture functions."""
from pathlib import Path
import hashlib, importlib.util, json, subprocess
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/rating-review-2026-11-11'
BASE=ROOT/'docs/features'
def prepend(path,body):
    text=path.read_text(encoding='utf-8-sig')
    if '## המלצות דירוג משולבות, 11.11.2026' not in text:
        first,rest=text.split('\n',1)
        path.write_text(first+'\n\n## המלצות דירוג משולבות, 11.11.2026\n\n'+body.strip()+'\n'+rest,encoding='utf-8')
registry=json.loads((BASE/'status/state.json').read_text(encoding='utf-8'))
changed={'functions/src/index.ts','functions/src/seasonManager.ts','functions/src/clubAdminRatings.ts','src/screens/communities/ManagerDashboardScreen.tsx'}
affected=[]
for feature in registry['features']:
    drift=[p for p,digest in feature['sources'].items() if p in changed and hashlib.sha256((ROOT/p).read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=digest]
    if feature['id']=='clubs/manager-dashboard' or drift:
        affected.append(feature['id'])
        if feature['id']=='clubs/manager-dashboard':
            simple='''מומש מקומית מנגנון שמציע שינוי קטן בדירוג רק כשגם תוצאות הקבוצות ביחס לציפייה וגם ציוני השחקן מול בעלי תפקיד ודירוג דומים תומכים בכך לאורך זמן. נשמרים ציוני העבר, ונתון חסר מוצג כחסר. אפשר לקבל את ההצעה, לערוך דירוג או לציין שהוא מתאים; אין שינוי אוטומטי.

השירותים החדשים טרם נפרסו. ההמלצות יתבססו על דירוגים שיישמרו בתחילת מחזורים חדשים, ולא על דירוגי עבר מומצאים. לאחר החלטה נדרשות שש הופעות חדשות תקפות. נבדקו רכיבי מקור בדפדפן עם נתוני הדגמה, ללא אימות מכשיר או מסירה חיה. [התנהגות, חישובים, בדיקות ומגבלות](../../changes/2026-11-11-rating-review.md).'''
            technical='''לשונית הדירוגים משתמשת ב-`src/components/manager/ManagerRatingReview.tsx`, דרך `src/services/ratingReviewService.ts`. `src/utils/ratingReview.ts` ועותקו הזהה `functions/src/ratingReviewCore.ts` מחשבים את ההמלצה. שירותי הקריאה וההחלטה ב-`functions/src/ratingReview.ts`; התמונה הפרטית, גרסאות והיסטוריית ההחלטות ב-`functions/src/ratingReviewStore.ts`. `functions/src/seasonManager.ts` מחבר שמירה אטומית לתחילת מחזור, ו-`functions/src/clubAdminRatings.ts` מתעד עריכה ידנית. אין שינוי כללי הרשאות או מילוי נתוני עבר.

החלון הוא עד עשר הופעות ב-120 ימים, מינימום שש, עם כיסוי של לפחות 80 אחוז מההופעות ושל משחקי כל הופעה. כל מחזור במשקל שווה. פערי הסף הם 0.10 בניקוד התוצאות ו-0.75 בציון מול שלושה אחרים באותו תפקיד ודירוג קרוב. נבדקים גם הסרת מחזור יחיד, רגישות לחוזק, גיוון שותפים ותמיכה משותפת בלפחות 60 אחוז מהמחזורים. לאחר החלטה אין שימוש חוזר בראיות. ההמלצה היא צעד 0.1 בלבד; התוצאה הקבוצתית אינה הוכחה סיבתית, והפרדת תפקידים אינה מכסה כל תרומה הגנתית.

בדיקות החישוב, העסקאות ובידוד חשבון נמצאות ב-`tests/logic/ratingReview.test.ts`, `tests/logic/ratingReviewServer.test.ts` ו-`tests/logic/ratingReviewUi.test.tsx`. תוצאות מלאות, פירוט הנתונים, המצבים, הקריאות, השמירה, הניווט, גבולות הכיול והפצה עתידית ב[מסירת המימוש](../../changes/2026-11-11-rating-review.md). מקומי וטרם הופץ. צילומי המקור בדפדפן: [לפני](../screenshots/rating-review-before-2026-11-11.png), [המלצה](../screenshots/rating-review-after-2026-11-11.png), [מידע חסר](../screenshots/rating-review-missing-2026-11-11.png). אין אימות מכשיר או שרת ייצור חדש.'''
        else:
            scope=', '.join(drift)
            simple='''במקור המשותף נוספה הכנה לשמירת דירוגים בתחילת מחזור ולהמלצות בלוח המנהל. זו תוספת מקומית; אין מכאן אימות חדש של כל מצבי המסך המתועד כאן. לא שונו הרשאות ולא בוצעה פריסה. [היקף השינוי והבדיקות](../../changes/2026-11-11-rating-review.md).'''
            technical=f'''נבדק ההפרש התחום במקורות המשותפים: `{scope}`. נוספו חיבור שמירת תמונת דירוג פרטית לעסקת תחילת מחזור וייצוא שירותי סקירת דירוג, בלי שינוי בחישובי המשחק, סגירת העונה או פעולות המסך האחרות. בשירות הדירוג הידני, כאשר הוא תלות של המסלול, שינוי מתועד גם בבסיס הראיות. אין בכך בדיקה חוזרת של כל הפיצר. המימוש מקומי, ללא פריסה או שינוי הרשאות. [התנהגות, מקור, בדיקות ומגבלות](../../changes/2026-11-11-rating-review.md).'''
        prepend(BASE/feature['simple'],simple);prepend(BASE/feature['technical'],technical)
# Mark the former five-score description as historical, without erasing its evidence.
p=BASE/'clubs/manager-dashboard.md';body=p.read_text(encoding='utf-8').replace('## ציונים והמלצות\n','## ציונים והמלצות בשיטה הקודמת\n\nהסעיף מתעד את המנגנון שהוחלף מקומית ב-11.11.2026. ההמלצות החדשות מתוארות בראש המסמך; אין שימוש בפונקציה הישנה כגיבוי.\n');p.write_text(body,encoding='utf-8')
p=BASE/'clubs/manager-dashboard.simple.md';body=p.read_text(encoding='utf-8').replace('המלצות נבחנות מחמישה ציונים ובנפרד מהצגת הנתונים.','במימוש החדש המלצות דורשות לפחות שש הופעות עם מידע תקף ותמיכה של שני המדדים; חמשת הציונים בגרף הם תצוגת עבר בלבד.');p.write_text(body,encoding='utf-8')
prepend(ROOT/'docs/specs/2026-11-11-rating-advice.md','''הבעלים אישר להשלים החלטות ולממש. [המימוש המקומי](../changes/2026-11-11-rating-review.md) מחליף את מצב האפיון בלבד שתועד קודם בהמשך מסמך זה. הוחלט על תמונת דירוג בתחילת המחזור, הפרדת תפקידים בהשוואה, כיסוי של 80 אחוז מההופעות ובדיקות רגישות. אין פריסה או הסבת נתונים; הספים עדיין אינם כיול אמפירי.''')
prepend(ROOT/'docs/knowledge/README.md','''מומש מקומית מנגנון המלצות משולב לדירוג מנהל: שמירת דירוגים פרטית בתחילת מחזור, השוואת תוצאות וציון מול שחקנים דומים, טיפול בהחלטה ובבקשה חוזרת. השירותים טרם נפרסו ונתוני עבר אינם מושלמים בדיעבד. [התנהגות, בדיקות, צילומי מקור ומגבלות](../changes/2026-11-11-rating-review.md).''')
# Copy separate proof files; never replace the user's report image.
manifest_path=BASE/'screenshots/manifest.json';manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
for source,target in [('ratings-before.png','rating-review-before-2026-11-11.png'),('card-up.png','rating-review-after-2026-11-11.png'),('card-missing.png','rating-review-missing-2026-11-11.png')]:
    raw=(OUT/source).read_bytes();(BASE/'screenshots'/target).write_bytes(raw)
    manifest=[m for m in manifest if m['file']!=target]
    manifest.insert(0,{'file':target,'source':f'artifacts/rating-review-2026-11-11/{source}','environment':'רכיב מקור במתאם דפדפן עם נתוני הדגמה','platform':'Web','sourceCommit':commit,'captured':'2026-11-11','notes':['כולל שינויים מקומיים. אין אימות מכשיר או נתוני ייצור.','לפני: מסך קודם. אחרי: כרטיס מקור חדש. סמלים ומעטפת מותאמים לדפדפן.'],'sha256':hashlib.sha256(raw).hexdigest()})
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Use the same capture/render implementation as feature_status.py refresh, once per affected pair.
spec=importlib.util.spec_from_file_location('feature_status',ROOT/'scripts/feature_status.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
pairs=mod.pairs();owners=mod.screen_owners(pairs);lookup={p['technical'][:-3]:p for p in pairs}
registry['features']=[mod.capture(lookup[f['id']],owners) if f['id'] in affected else f for f in registry['features']];registry['screens']=owners
(BASE/'status/state.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');mod.render(registry)
(OUT/'documented-features.json').write_text(json.dumps(affected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'documentedFeatures':len(affected),'screenshots':3}))
