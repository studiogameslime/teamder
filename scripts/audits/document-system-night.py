"""Add scoped measurement notes to the existing feature pairs and keep evidence explicit."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/features'
registry=json.loads((BASE/'status/state.json').read_text(encoding='utf8'))
controls=json.loads((ROOT/'docs/audits/2026-11-04-system-night/controls.json').read_text(encoding='utf8'))
changed={'src/services/gameService.ts','src/services/incomingInvite.ts','src/store/groupStore.ts',
         'src/services/userService.ts','src/store/userStore.ts','src/services/usageActivity.ts',
         'functions/src/socialPlayers.ts','functions/src/index.ts','functions/src/roundSummary.ts'}
heading='## מדידת פעולות ואמינות נתונים, 5.11.2026'
updated=[]
for feature in registry['features']:
    refs=set(feature['sources'])
    sites=[row for row in controls if row['filename'] in refs]
    if not sites and not refs.intersection(changed):
        continue
    for kind in ('technical','simple'):
        file=BASE/feature[kind]
        body=file.read_text(encoding='utf8')
        if heading in body:
            continue
        target='../../audits/2026-11-04-system-night/product-measurement.md'
        if kind=='simple':
            note=('נוספה הכנה למדידת הפעולות ברכיבים המתועדים כאן. בפולס אפשר לראות ביצועים וחשבונות ייחודיים לפי פעולה ותקופה, '
                  'כאשר קיים כיסוי מדידה. איסוף החשבונות החדש עדיין כבוי והמימוש מקומי. '
                  f'[פירוט והיקף הבדיקות]({target}).')
        else:
            exact=len({row['id'] for row in sites})
            note=(f'במיפוי מקור הרכיבים המוזכרים במסמך נמצאו {len(sites)} נקודות מטפל ו-{exact} מזהי פעולה. '
                  'הספירה מתארת קוד וכוללת רכיבים משותפים; אין לחבר אותה לספירות של מסמכים אחרים ואין לראות בה הרצת כל המסך. '
                  if sites else
                  'נבדקו התלויות במקורות השירות המשותפים של מסמך זה במסגרת תיקוני הלילה. ')
            note+=('המדידה מפורטת לפי גבול פקד מקורי, פעולה עסקית ומצב חשבון. תשובה מאוחרת נבדקת מול בעל הפעולה, '
                   'ומצב קיים או בקשה חוזרת אינם תמיד הצלחה חדשה. רשימת המקרים שהורצו ומגבלות המסד, המכשיר והכיסוי נשמרות '
                   f'[בדוח המדידה]({target}) ובדוחות המקושרים אליו. המימוש מקומי; לא בוצעה בדיקה חדשה של כל מצבי הפיצר.')
        first,rest=body.split('\n',1)
        file.write_text(first+'\n\n'+heading+'\n\n'+note+'\n'+rest,encoding='utf8')
    updated.append(feature['id'])
(ROOT/'artifacts/system-night/documented-features.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'updatedFeaturePairs':len(updated)}))
