from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/features'
OUT = ROOT / 'artifacts/detail-performance-2026-11-04'
REPORT = '[מדידות, בדיקות ומגבלות](../../changes/2026-11-04-detail-performance.md).'

def prepend(file, heading, body):
    text = file.read_text(encoding='utf-8-sig')
    if heading in text:
        return
    first, _, rest = text.partition('\n')
    file.write_text(first + '\n\n' + heading + '\n\n' + body + '\n\n' + REPORT + '\n\n' + rest.lstrip(), encoding='utf-8')

prepend(BASE / 'profile/achievements.simple.md', '## פחות טעינות חוזרות בארון ההישגים, 4.11.2026',
        'עדכון שם, תמונה או רשימת מועדונים עם אותו תוכן אינו מתחיל שוב את איסוף ההישגים. שינוי אמיתי בסגל, בניהול, במייסד או במונים עדיין מרענן. נתונים מחשבון קודם אינם מופיעים בחשבון החדש. השינוי מקומי וטרם הופץ.')
prepend(BASE / 'profile/achievements.md', '## צמצום קריאות בארון ההישגים, 4.11.2026',
        '`src/screens/profile/AchievementsScreen.tsx` בונה `groupsScope` ממזהי המועדונים, המייסד האפקטיבי וקבוצות המנהלים והשחקנים, וממיין מזהים שאינם תלויי סדר. המנהל הראשון נשמר בנפרד כמשמעותי כאשר חסר `creatorId`. `deriveScope` כולל זהות, מצב אורח, חברות ומוני המקור שנצרכים לחישוב. הוא פוסל תגובה ישנה לפני ניקוי אפקטים, ובודק גם את החשבון הנוכחי לפני פרסום, שמירה וחגיגה. `countersOwner` מונע הצגת תוצאה בחשבון אחר. העסקה `persistDerivedUnlocks`, נוסחאות ההישגים והמכנים לא שונו.\n\n'
        '`tests/logic/achievementScreenPerformance.test.ts` מפעיל את רכיב המקור עם מתאמי קריאה ותגובות מעוכבות. עשר בדיקות עברו, ושתי בדיקות נכשלו מול מקור הלפני. בפתיחה וחמש החלפות אובייקטים שקולים נרשמה הפעלת גזירה אחת במקום שש. נבדקו גם שינוי אמיתי בשחקנים, מנהלים ומייסד, גיבוי מנהל ראשון, מונים, החלפת חשבון לפני ניקוי, ביטול וכשל עם ניסיון חוזר. אין מדידת מכשיר או שינוי תצוגה רגילה מכוון.')

features = {'clubs/manager-dashboard': 'manager-club', 'profile/player-card': 'card-early', 'statistics/season-summary': 'season-early'}
for feature, scene in features.items():
    prepend(BASE / (feature + '.simple.md'), '## ראיות לשיפור טעינת מסכי הפירוט, 4.11.2026',
            f'נבדקו אזורי מקור בדפדפן לפני ואחרי, עם נתוני הדגמה. אין אימות טלפון או רשת ייצור חדש. השינוי מקומי וטרם הופץ.\n\n![אזור מקור אחרי השינוי](../screenshots/detail-performance-{scene}-after-2026-11-04.png)')
    prepend(BASE / (feature + '.md'), '## ראיות לשיפור טעינת מסכי הפירוט, 4.11.2026',
            'נבדקו חמישה זוגות של אזורי מקור בשלושים פריסות בדפדפן, ברוחבים 320, 390 ו-430, ונבדקה כיווניות בצילומים. נתוני ההתקדמות מוזנים למתאם ומגובה להם בדיקת תזמון נפרדת. רכיבי ניווט, סמלים, תמונות שחקנים וחלונות מערכת מוחלפים בחלקם במתאמים; משטחי שיתוף מוסתרים אינם נכללים בבדיקת רוחב. אין בכך אימות מסך מלא במכשיר או מדידת זמן רשת. טבלת ההשוואות והבדיקות בדוח השינוי.')

manifest_file = BASE / 'screenshots/manifest.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8-sig'))
commit = subprocess.run(['git', 'rev-parse', '--short=8', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
sources = {'manager-club': 'src/screens/communities/ManagerDashboardScreen.tsx', 'manager-ratings': 'src/screens/communities/ManagerDashboardScreen.tsx',
           'manager-player': 'src/components/manager/ManagerWorkspace.tsx', 'card-early': 'src/components/profile/OwnPlayerCard.tsx', 'season-early': 'src/screens/profile/SeasonSummaryScreen.tsx'}
for scene, source in sources.items():
    for phase in ('before', 'after'):
        image = OUT / f'{scene}-{phase}.png'
        filename = f'detail-performance-{scene}-{phase}-2026-11-04.png'
        (BASE / 'screenshots' / filename).write_bytes(image.read_bytes())
        record = {'file': filename, 'source': image.relative_to(ROOT).as_posix(), 'platform': 'דפדפן',
                  'environment': 'רכיבי מקור עם נתוני הדגמה ומתאמי דפדפן', 'sourceCommit': commit, 'captured': '2026-11-04',
                  'notes': ['כולל שינויים מקומיים שלא נשמרו למאגר.', 'מקור: ' + source + '.',
                            'מצבי ההשלמה מוזנים למתאם ונבדקים בנפרד עם עיכובים מבוקרים. אין כאן מדידת ציור בטלפון.',
                            'נבדקו רוחבים 320, 390 ו-430 ונבדקה כיווניות. גופן הדפדפן חלופי; סמלים ותמונות שחקנים הם מצייני מקום.',
                            'רכיבי ניווט, חלונות מערכת ואזור פעילות השוואות מוחלפים או מושמטים. תנועה מנוטרלת ומשטחי שיתוף שמחוץ למסך אינם חלק מהתוכן הגלוי.',
                            'אין אימות מכשיר, גופן מוגדל, נגישות במכשיר או שירות חי.'],
                  'sha256': hashlib.sha256(image.read_bytes()).hexdigest()}
        manifest = [row for row in manifest if row['file'] != filename] + [record]
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Reuse the canonical feature capture/render batch workflow from the prior
# stage, with this task's snapshots and report. No fingerprints are invented.
refresh = (ROOT / 'scripts/audits/refresh-screen-performance-docs.py').read_text(encoding='utf-8')
refresh = refresh.replace("artifacts/performance-2026-11-04", "artifacts/detail-performance-2026-11-04").replace('2026-11-04-screen-performance.md', '2026-11-04-detail-performance.md')
exec(compile(refresh, str(ROOT / 'scripts/audits/refresh-screen-performance-docs.py'), 'exec'), {'__file__': str(ROOT / 'scripts/audits/refresh-screen-performance-docs.py'), '__name__': '__main__'})
print(json.dumps({'screenshotsAdded': 10, 'directPairsUpdated': 4}, ensure_ascii=False))
