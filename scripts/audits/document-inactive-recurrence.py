"""Update reviewed feature pairs and retain unrelated pre-existing drift."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import feature_status as status

OUT = ROOT / 'artifacts'
BASE = ROOT / 'docs/features'
sources = {'functions/src/index.ts', 'functions/src/clubDeletion.ts', 'firestore.indexes.json', 'tests/logic/clubDeletion.test.ts'}
registry = status.load()
original_path = OUT / 'recurrence-documentation-baseline.json'
if not original_path.exists():
    original_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
original = json.loads(original_path.read_text(encoding='utf-8'))
affected = [item['id'] for item in original['features'] if sources.intersection(item['sources'])]
heading = '## עצירת מחזור קבוע ללא פעילות, 6.11.2026'
link = '[ההתנהגות, מסלול הנתונים, הבדיקות ומגבלות ההפעלה](../../changes/2026-11-06-inactive-recurring-rounds.md).'

for item in registry['features']:
    if item['id'] not in affected:
        continue
    core = item['id'] in {'rounds/game-create', 'rounds/game-edit'}
    if core:
        simple = 'מחזור קבוע נעצר אוטומטית אחרי שלושה מחזורים רצופים שלא התקיימו או שנותרו בלי הרשמה. מחזור שהתקיים קוטע את הרצף, והיסטוריית המועדון נשמרת. מחזור עם נרשמים שאין הכרעה אם התקיים אינו נחשב אוטומטית למחזור שלא התקיים. המימוש מקומי וטרם הופעל בשרת. ' + link
        technical = '''הסדרה נשמרת עם `active: false` לפני יצירת מחזור רביעי, לאחר שלושה מועדים רצופים של חוסר פעילות. הבדיקה נעשית שלוש שעות אחרי ההתחלה ומשלבת מחזורים קיימים עם שלוש החלטות שמורות ב-`recurrenceActivity`. שבוע שדולג או הרצת תזמון נוספת אינם מחזור נוסף. מחזור שהתקיים לפי `functions/src/eveningPlayed.ts` או שיש בו ראיית משחק מגן מפני עצירה. ביטול או אישור מפורש שלא התקיים נחשבים לחוסר פעילות; אחרת רק היעדר שחקנים, אורחים, המתנה ובקשות ממתינות נחשב לריק. מחזור עם הרשמה שנותר לא מוכרע קוטע את הרצף.

`functions/src/recurrenceActivity.ts` מרכזת את `isInactiveOccurrence`, `recurrenceActivity`, `readSeriesActivity` ו-`deleteEmptyGameWithRecurrence`. `createSeriesOccurrence` ב-`functions/src/clubDeletion.ts` בודקת ושומרת את ההכרעה באותה עסקה כמו היצירה. ניקוי מחזור ריק ב-`functions/src/index.ts` שומר את זיכרון ההחלטה לפני המחיקה באותה עסקה. עדכון הרשמה או סיום מנהלי במקביל גורם לקריאה חוזרת. במנגנון ההעתקה הישן הזיכרון עובר למחזור הבא ונעצרת פתיחה אחרי שלושה מחזורים ריקים, במקום אחד; עצירות מפורשות ישנות נשמרות.

| מצב | תוצאה |
|---|---|
| פחות משלושה מחזורים רצופים חסרי פעילות | יצירת המחזור הבא ממשיכה |
| שלושת המחזורים האחרונים חסרי פעילות | עצירת הסדרה, ללא מחזור רביעי |
| מחזור התקיים או שיש בו הרשמה ללא הכרעה שלילית | קטיעת רצף חוסר הפעילות |
| מחזור עתידי, זמן חסד או שבוע שלא נוצר | אינו כישלון נוסף |
| כשל קריאה | העסקה נכשלת והנתונים נשארים לניסיון חוזר |

המפתח החדש ב-`firestore.indexes.json` הוא `seriesId ASC, startsAt DESC`. זהו מצב תפעולי של השרת; אין שדה לקוח חדש או שינוי בממיר, במסך, בניווט, במכני הסטטיסטיקה או בהרשאות. פריסה עתידית של המפתח ושל `cronEvery5Min` ו-`cronEvery60Min` נדרשת להפעלה. המימוש מקומי בלבד. בדיקות `tests/logic/recurrenceActivity.test.ts` ו-`tests/logic/clubDeletion.test.ts` מפעילות את מקור השרת עם עסקאות במאגר זיכרון. אין אימות מסד שרת אמיתי או מסך חדש. ''' + link
    else:
        simple = 'נוספה במנגנון השרת עצירה של מחזור קבוע לאחר שלושה מחזורים רצופים ללא פעילות. ההשפעה כאן תחומה לתלות המשותפת בפתיחת מחזורים וניקוי מחזורים ריקים; אין אימות חדש של כל פעולות המסך. המימוש מקומי וטרם הופעל בשרת. ' + link
        task_sources = ', '.join('`' + file + '`' for file in sorted(sources.intersection(item['sources'])))
        technical = 'נבדק השינוי התחום ב-' + task_sources + ': בדיקת חוסר פעילות לפני יצירת מחזור קבוע ושמירת שלוש החלטות בזמן ניקוי מחזורים ריקים. ההכרעה משתמשת במקור הקיים לקיום מחזור ומגינה על מחזור עם הרשמה שנותר לא מוכרע. עסקאות היצירה והניקוי נשארות מוגנות מפני שינוי מקביל ומועדון חסר. אין שינוי מכוון בחישובים, במכנים, בהרשאות, בניווט או בפעולות העצמאיות האחרות של הפיצר הזה. בדיקות מקור השרת הורצו במאגר זיכרון; אין בכך הרצה מחודשת של המסך או בדיקת שרת ייצור. המימוש מקומי וטרם נפרס. ' + link
    for key, body in [('technical', technical), ('simple', simple)]:
        path = BASE / item[key]
        text = path.read_text(encoding='utf-8-sig')
        if heading not in text:
            first, _, rest = text.partition('\n')
            path.write_text(first + '\n\n' + heading + '\n\n' + body + '\n\n' + rest.lstrip(), encoding='utf-8')

# Capture with the canonical generator, but leave every unreviewed source's
# previous fingerprint intact. This deliberately preserves its existing warning.
owners = status.screen_owners(status.pairs())
pair_by_id = {p['technical'][:-3]: p for p in status.pairs()}
original_by_id = {item['id']: item for item in original['features']}
notes = []
for index, item in enumerate(registry['features']):
    if item['id'] not in affected:
        continue
    old = original_by_id[item['id']]
    new = status.capture(pair_by_id[item['id']], owners)
    retained = []
    for filename, fingerprint in old['sources'].items():
        if filename not in sources and filename in new['sources'] and new['sources'][filename] != fingerprint:
            new['sources'][filename] = fingerprint
            retained.append(filename)
    registry['features'][index] = new
    notes.append({'feature': item['id'], 'unreviewedSourceWarningsRetained': retained})
registry['screens'] = owners
status.REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
status.render(registry)
(OUT / 'recurrence-docs-refresh-receipt.json').write_text(json.dumps({'affected': affected, 'notes': notes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'refreshedPairs': len(affected), 'unrelatedSourceWarningsRetained': sum(len(n['unreviewedSourceWarningsRetained']) for n in notes)}))
