"""Document this local performance task without inventing native verification."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/features'
OUT = ROOT / 'artifacts/performance-2026-11-04'
HEADING = '## שיפור זמני טעינה, 4.11.2026'
REPORT = '[היקף השינוי, המדידות והמגבלות](../../changes/2026-11-04-screen-performance.md).'

def prepend(file, body):
    text = file.read_text(encoding='utf-8-sig')
    if HEADING in text:
        return
    first, _, rest = text.partition('\n')
    file.write_text(first + '\n\n' + HEADING + '\n\n' + body + '\n\n' + REPORT + '\n\n' + rest.lstrip(), encoding='utf-8')

updates = {
    'home/dashboard': (
        'המספרים בבית יכולים להופיע לפני סיום העשרת ההיסטוריה. קריאות עצמאיות מתחילות יחד, והסיכום משתמש בסכומי שערים ובישולים עדכניים. שם ותמונת השותף מופיעים רק כשהם מתאימים לשותף שבסיכום. השינוי מקומי וטרם הופץ.',
        '`src/components/home/HomePersonalStats.tsx` מתחיל `getUserById` ו-`playerStatsService.compute` יחד באמצעות `ctx.totals`. `onBase` מפרסם את הבסיס ומתחיל קריאת שם לשותף; `onHighlights` משלים את ההיסטוריה בלי לדרוס שותף שכבר התקבל. שותף נשמר רק כאשר המזהה שלו מתאים ל-`mostPlayedWith.uid`, ותשובה מאוחרת נבדקת שוב. יציאה ממיקוד או החלפת חשבון פוסלת פרסום. הקריאות מחכות לסכומים הטריים לפני פרסום בסיס; מכני הנוכחות והמונים נשמרו. `tests/logic/screenPerformanceScheduling.test.ts` בודק התחלה מקבילה, בסיס לפני היסטוריה, כשל משתמש טרי, החלפת שותף וביטול.',
        'home'),
    'statistics/personal-statistics': (
        'הסטטיסטיקה מתחילה לאסוף נתונים בזמן שמתרעננים פרטי המשתמש, במקום להמתין לקריאה הראשונה ורק אז להתחיל. הסיכום מוצג עם הנתונים המעודכנים, בלי להחליף מידע חסר באפס. השינוי מקומי וטרם הופץ.',
        '`src/screens/profile/StatisticsScreen.tsx` מעביר ל-`playerStatsService.compute` הבטחת `totals` מהמשתמש הטרי, לצד ערכי גיבוי קיימים. שאילתות הנוכחות והצמדים מתחילות במקביל לקריאת המשתמש, והבסיס ממתין לכולם. נתוני הפנדלים מתעדכנים רק כשאפקט הביקור עדיין פעיל; כשל משתמש טרי נשאר כשל. מסלול שחקן אחר ממשיך להשתמש ב-`socialPlayersService.profile` ובבדיקת הפרטיות שלו. אין שינוי במכנים, בטווח או בניווט. `tests/logic/screenPerformanceScheduling.test.ts` בודק תזמון, סכומים טריים וביטול; מתאם `tests/logic/clientAuditRecovery.test.ts` עודכן לחוזה המקבילי.',
        None),
    'clubs/members-and-administration': (
        'אפשר לראות את שחקני המועדון מיד אחרי קבלת השמות, גם אם נתונים נלווים עדיין נטענים. החיווי נשאר עד סיום הקריאה, וכשל אינו מוחק מידע שכבר התקבל. השינוי מקומי וטרם הופץ.',
        '`src/hooks/useCommunityRoster.ts` מפרסם תמונת מצב של מועדון ושמות אחרי `hydrateUsers`, ומפרסם מדדים וכרטיסים באופן עצמאי. אם פרטי העזר הגיעו קודם הם נכללים בפרסום הסגל; כשל שומר ערכים מאושרים מאותו הקשר בלבד. `loading` נשאר פעיל עד שכל הקריאות הסתיימו, בעוד `initialLoading` מסתיים עם הסגל ומאפשר ל-`CommunityPlayersScreen` להציג רשימה וחיווי קומפקטי. בדיקות הדור, החשבון והמועדון נשארו בכל פרסום. בתרחיש מקור עם עיכובים מבוקרים הופעת הסגל ירדה מ-1300 ל-300 אלפיות שנייה; השלמת פרטי העזר נשארה 1300. `tests/logic/communityRosterLoading.test.ts` בודק גם הגעת פרטים בסדרים שונים ופסילת כרטיסי מנהל מאוחרים.',
        'roster'),
    'rounds/available-players': (
        'המחזור ורשימת המועמדים מתחילים להיטען יחד. השחקנים יוצגו רק לאחר שאושר שהמחזור קיים, וההזמנות ממשיכות להיבדק מול השרת. השינוי מקומי וטרם הופץ.',
        '`src/screens/games/AvailablePlayersScreen.tsx` מתחיל `getGameById` ו-`findAvailablePlayersPage(gameId)` ב-`Promise.all`. שתי הקריאות מקבלות מזהה קיים מהנתיב ואוכפות גישה בעצמן. אין פרסום מועמדים לפני קבלת שתי התשובות; מחזור חסר אינו מפרסם דף מועמדים. מיקום, זמינות, חברות ופרטיות נשארים באחריות השירות והשרת. דפדוף, מצב שליחה ובדיקת תפוסה חיה נשמרו. `tests/logic/availablePlayersPulseCapacity.test.tsx` כולל בדיקות התחלה משותפת, דף שמגיע לפני המחזור ומחזור חסר.',
        None),
    'rounds/draft-setup': (
        'בעת פתיחת הגדרת הכוחות מופיע שלד של אפשרויות החלוקה. עדכון שם או תמונת פרופיל ושינוי שם מועדון אינם טוענים מחדש את המחזור, בעוד החלפת חשבון או שינוי הרשאת ניהול נבדקים מחדש. השינוי מקומי וטרם הופץ.',
        '`src/screens/games/DraftSetupScreen.tsx` משתמש במזהה החשבון, מצב האורח ומפתח מזהי מועדוני הניהול במקום באובייקטי משתמש ומועדונים שלמים. קבוצת המנהלים ממוינת למפתח יציב; אובדן ניהול ממשיך לרענן ולחסום את המסך. מסלול כניסה לחלוקה שמורה שומר קדימות. `src/components/loading/DraftSetupSkeleton.tsx` מציג ארבע שורות אפשרות ופרטי כותרת, בלי בחירה פעילה ובלי השהיית מעבר לתוכן. הוא משתמש ב-`SkeletonRegion` שמכבד צמצום תנועה ונגישות. כשל נשאר בענף נפרד עם ניסיון חוזר. `tests/logic/screenPerformanceScheduling.test.ts` בודק מניעת קריאה בעדכון מטא נתונים ובדיקה חוזרת בניהול וחשבון; `tests/logic/draftSetupLoading.test.ts` שומר בדיקות גרסה, תוצאה חסרה וביטול.',
        'draft'),
    'rounds/live-timer': (
        'כשעוברים ממסך הלייב, עדכוני השעון לתצוגה נעצרים כדי לפנות עבודה למסך הפעיל. כשחוזרים, הזמן מחושב מחדש מהמידע המשותף. המשחק והשעון שלו ממשיכים כרגיל. השינוי מקומי וטרם הופץ.',
        '`src/services/useSyncedTimer.ts` מקבל פרמטר `active` אופציונלי, שברירת המחדל שלו אמת. כשאינו פעיל הוא אינו מקצה פעימת תצוגה בת 250 אלפיות שנייה או סנכרון מחזורי בן שתי דקות. `src/screens/LiveMatchScreen.tsx` ו-`src/screens/AdvancedLiveMatchScreen.tsx` מעבירים מיקוד ועוצרים גם את פעימת העצירות בת השנייה. בחזרה למיקוד התצוגה מחושבת שוב מ-`timerLastStartedAt`, `timerAccumulatedMs` ו-`serverNow`, בלי שינוי בכתיבת שעון המשחק. `tests/logic/hiddenLiveTimerPerformance.test.ts` בודק אפס פעימות מוסתרות, פינוי מרווחים וחזרה לעוגן הזמן; בדקת הסתרה מבוקרת מספר עדכוני טיימר התצוגה ירד מ-240 לאפס.',
        None),
    'rounds/live-advanced': (
        'עדכוני תצוגת הזמן והעצירות מפסיקים בזמן שמסך אחר פתוח. בחזרה ללייב הזמן מחושב מהנתונים המשותפים, בלי לעצור את המשחק ובלי לשנות תוצאה. השינוי מקומי וטרם הופץ.',
        '`src/screens/AdvancedLiveMatchScreen.tsx` מעביר את `timerFocused` ל-`src/services/useSyncedTimer.ts`, ומקצה את פעימת העצירות רק במיקוד. מנגנון השעון אינו מקצה פעימות תצוגה או סנכרון מחזורי למסך מוסתר, ומחשב מחדש מהעוגן המשותף עם החזרה. אין שינוי ברוטציה, בפנדלים, בתוצאות, במכנים או בכתיבות. התרחישים מופעלים ב-`tests/logic/hiddenLiveTimerPerformance.test.ts`, כולל ניקוי מרווחים, שעון עצור וחזרה אחרי דקות של הסתרה.',
        None),
}
for feature, (simple, technical, shot) in updates.items():
    if shot:
        simple += f'\n\n![אזור מקור מקומי בדפדפן](../screenshots/performance-{shot}-after-2026-11-04.png)'
        technical += f'\n\nצילום לפני ואחרי ברשימת הראיות שבדוח השינוי. אזור מקור בדפדפן עם נתוני הדגמה, ללא אימות מכשיר או שירות חי חדש.'
    prepend(BASE / (feature + '.simple.md'), simple)
    prepend(BASE / (feature + '.md'), technical)

manifest_file = BASE / 'screenshots/manifest.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8-sig'))
commit = subprocess.run(['git', 'rev-parse', '--short=8', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
sources = {'draft': 'src/screens/games/DraftSetupScreen.tsx', 'home': 'src/components/home/HomeProfileOverview.tsx', 'roster': 'src/screens/communities/CommunityPlayersScreen.tsx', 'splash': 'src/screens/SplashScreen.tsx'}
for scene, source in sources.items():
    for phase in ('before', 'after'):
        source_file = OUT / f'{scene}-{phase}.png'
        filename = f'performance-{scene}-{phase}-2026-11-04.png'
        (BASE / 'screenshots' / filename).write_bytes(source_file.read_bytes())
        record = {'file': filename, 'source': source_file.relative_to(ROOT).as_posix(), 'platform': 'דפדפן',
                  'environment': 'רכיבי מקור עם מתאמי דפדפן ונתוני הדגמה', 'sourceCommit': commit, 'captured': '2026-11-04',
                  'notes': ['כולל שינויים מקומיים שלא נשמרו למאגר.', 'מקור האזור: ' + source + '.',
                            'נבדקו רוחבים 320, 390 ו-430 ונבדקה כיווניות. גופן הדפדפן הוא חלופי; סמלים ותמונות שחקנים הם מצייני מקום.',
                            'בספלאש נשמרת תמונת המקור. בסגל ובבית נקודת התקדמות הקריאות מוזנת למתאם, והתזמון נבדק בנפרד.',
                            'אזור מקור ללא מסך מלא. אין אימות מכשיר, גופן מוגדל או שירות חי.'],
                  'sha256': hashlib.sha256(source_file.read_bytes()).hexdigest()}
        manifest = [item for item in manifest if item['file'] != filename] + [record]
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'updatedFeaturePairs': list(updates), 'screenshots': 8}, ensure_ascii=False))
