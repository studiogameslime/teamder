"""Record the scoped implementation and refresh its existing documentation owners."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/features'; OUT=ROOT/'artifacts/live-round-edit-2026-11-12'
drift=json.loads((OUT/'status-before.json').read_text(encoding='utf-8-sig'))['failures']
affected={line.split(':',1)[0] for line in drift}
pairs=json.loads((BASE/'document-pairs.json').read_text(encoding='utf-8'))
primary={
 'rounds/game-edit':'עריכת המחזור הפעיל נפתחת במסלול מצומצם. משתתפים, קבוצות, מתכונת, משך וכללי מלל ניתנים לעריכה. השינוי חל רק על המשחק הנוכחי; זמן או נתונים מחייבים הסכמה מפורשת לאיפוס שלו.',
 'rounds/draft-setup':'במחזור עם רוטציה פעילה, הכניסה לחלוקת כוחות מופנית לעריכת המחזור. כל שיטות החלוקה עובדות על המשתתפים שנבחרו ונשארות בטיוטה עד האישור.',
 'rounds/draft-board':'עריכה של לוח חלוקה במחזור חי מופנית לעריכת המחזור. תצוגה לקריאה בלבד נשארת זמינה. שמירה ישנה אינה יכולה לעקוף את אישור האיפוס.',
 'rounds/live-advanced':'נוספה עריכת מחזור חי עם חלוקה מחדש והשלמות. שנים עשר משתתפים יכולים להתחלק לשלוש רביעיות ולהמשיך בחמישה מול חמישה. מתאפס רק המשחק הנוכחי ובאישור מפורש אם נצברו בו זמן או נתונים.',
 'rounds/match-details':'עריכה וניהול הכוחות במחזור שהתחיל מובילים לעריכה החיה. נוסף פירוט החלוקות לפני ואחרי העריכה, עם מספר המשחק שממנו הוחלו.',
 'rounds/fillers':'החלוקה מחדש שומרת את מדיניות המשלים הקיימת. בחירת משלימים מסתיימת לפני השמירה, ושני צדי המגרש חייבים להיות מלאים ושונים בשחקניהם.',
 'rounds/live-timer':'עריכת מחזור עם זמן או נתונים דורשת אישור לאיפוס המשחק הנוכחי. השעון חוזר לאפס ונשאר עצור, באותה שמירה עם החלוקה החדשה. מספר המשחק המוצג נשמר.',
 'rounds/match-stats':'חישוב הסטטיסטיקה נשאר במסלול הקיים. עריכת המחזור אינה יוצרת משחק או צבירה, ואינה משנה משחקים שמורים. נבדקה זהות הסטטיסטיקה לפני העריכה ואחריה, ובהמשך שמירת המשחק וסיכום המחזור.'}
affected.update(primary)
link='[מימוש, בדיקות ומגבלות](../../changes/2026-11-12-live-round-editing.md)'
for pair in pairs:
    feature=pair['technical'][:-3]
    if feature not in affected:continue
    for kind in ('technical','simple'):
        file=BASE/pair[kind];body=file.read_text(encoding='utf-8-sig')
        # The initial planning section was authored in this same task and is superseded.
        body=re.sub(r'\n## אפיון[^\n]*12\.11\.2026\n.*?(?=\n## |\Z)','\n',body,count=1,flags=re.S)
        if feature in primary:
            note=primary[feature]+' המשחקים הקודמים ומדיניות ההשלמה נשמרים. המימוש מקומי וטרם הופץ. '+link+'.'
            if kind=='technical':
                note+='\n\nמקורות המימוש: `src/utils/liveRoundEdit.ts`, `src/components/match/LiveRoundEditModal.tsx`, `src/components/match/LiveRoundEditsCard.tsx`, `src/services/gameService.ts`, `src/firebase/firestore.ts` ו-`src/types/index.ts`. קבלת פעולה ב-`liveRoundEdits` נשמרת יחד עם איפוס הניסיון הנוכחי, ונקראת דרך הממיר. אין שינוי בחישובי שמירת תוצאה, במכנים או במשקלים. בדיקות המקור והמסכים ומגבלת התאימות ללקוחות ישנים מפורטות במסירה.'
        else:
            note='המקורות המשותפים עודכנו לעריכת מחזור חי ושמירת תיעוד החלוקה. נבדק השינוי התחום בשירות המחזור, בממיר, בטיפוסים ובפרמטר הניווט; אין בו שינוי בחישובי הפיצר הזה או במסלוליו האחרים. אין בכך בדיקת מסך חדשה של הפיצר. מקומי וטרם הופץ. '+link+'.'
        heading='## עריכת המחזור הנוכחי, 12.11.2026'
        if heading in body:body=re.sub(r'\n'+re.escape(heading)+r'\n.*?(?=\n## |\Z)','\n',body,count=1,flags=re.S)
        first,rest=body.split('\n',1)
        file.write_text(first+'\n\n'+heading+'\n\n'+note+'\n'+rest.lstrip('\n'),encoding='utf-8')
knowledge=ROOT/'docs/knowledge/README.md';body=knowledge.read_text(encoding='utf-8')
body=re.sub(r'\n## אפיון עריכת מחזור פעיל, 12\.11\.2026\n.*?(?=\n## )','\n',body,count=1,flags=re.S)
first,rest=body.split('\n',1)
knowledge.write_text(first+'\n\n## עריכת מחזור חי, 12.11.2026\n\nמומשה מקומית עריכה של משתתפים, קבוצות, מתכונת, משך וכללים. כל שיטות החלוקה זמינות, כולל שלוש רביעיות במתכונת חמישה מול חמישה. השינוי חל רק על המשחק הנוכחי, עם אישור איפוס אם נצברו זמן או נתונים. המשחקים השמורים וחישוב הסטטיסטיקה נשמרים. [מסירה, בדיקות ומגבלות תאימות](../changes/2026-11-12-live-round-editing.md). ללא בנייה או הפצה.\n'+rest.lstrip('\n'),encoding='utf-8')
coverage=BASE/'coverage.md';body=coverage.read_text(encoding='utf-8');first,rest=body.split('\n',1)
coverage.write_text(first+'\n\n## עריכת מחזור חי, 12.11.2026\n\n`LiveRoundEditModal` נוסף בתוך `src/screens/AdvancedLiveMatchScreen.tsx`, ללא מסך מחסנית חדש. כניסות ממסך הפרטים וממסכי החלוקה הקיימים מפנות לפרמטר עריכה במסך הניהול. `LiveRoundEditsCard` נוסף במסך הפרטים. [מקורות, בדיקות ומגבלות](../changes/2026-11-12-live-round-editing.md).\n'+rest.lstrip('\n'),encoding='utf-8')
manifest=BASE/'screenshots/manifest.json';rows=json.loads(manifest.read_text(encoding='utf-8'));commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
for state in ['before','settings','reset']:
    source=OUT/f'{state}-390-1-light.png';name=f'live-round-edit-{state}-2026-11-12.png';target=BASE/'screenshots'/name;shutil.copyfile(source,target)
    row={'file':name,'source':source.relative_to(ROOT).as_posix(),'environment':'רכיבי מקור מרונדרים בדפדפן עם מתאמים ונתוני הדגמה','platform':'Web','sourceCommit':commit,'captured':'2026-11-12','notes':['מקור מקומי לא מחויב. רוחב 390. נבדקה כיווניות. אין אימות מכשיר או שרת חי.', 'הצילום הקודם הוא חלון סדר המשחק הקיים; לעריכת המחזור החדשה לא היה חלון קודם.' if state=='before' else 'צילום רכיב המימוש, ולא סקיצת התכנון.'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    rows=[r for r in rows if r['file']!=name];rows.insert(0,row)
manifest.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'documentation-owners.json').write_text(json.dumps(sorted(affected),indent=2)+'\n',encoding='utf-8')
print(json.dumps({'updatedPairs':len(affected),'proofs':3}))
