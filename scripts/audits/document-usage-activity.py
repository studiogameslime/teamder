"""Document the reviewed shared-source impact without claiming device or release QA."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/features'
OUT = ROOT / 'artifacts/usage-activity-2026-11-04'
heading = '## ציר פעילות פרטי בפולס, 4.11.2026'
pairs = json.loads((BASE / 'document-pairs.json').read_text(encoding='utf-8'))
new = {'title': 'ביקורים ופעילות משתמשים בפולס', 'domain': 'shared', 'simple': 'shared/usage-activity.simple.md', 'technical': 'shared/usage-activity.md'}
if new not in pairs:
    pairs.append(new)
    (BASE / 'document-pairs.json').write_text(json.dumps(pairs, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for filename, simple_link, technical_link in [
    ('shared/README.md', 'usage-activity.simple.md', 'usage-activity.md'),
    ('document-pairs.md', 'shared/usage-activity.simple.md', 'shared/usage-activity.md'),
]:
    path = BASE / filename
    text = path.read_text(encoding='utf-8')
    if simple_link not in text:
        path.write_text(text + f'\n| ביקורים ופעילות משתמשים בפולס | [הסבר פשוט]({simple_link}) | [מסמך טכני]({technical_link}) |\n', encoding='utf-8')

failures = json.loads((OUT / 'feature-status-before.json').read_text(encoding='utf-8-sig'))['failures']
affected = sorted({failure.split(': ')[0] for failure in failures if 'מקור השתנה:' in failure})
specific = {
    'rounds/registration': 'החיבור נמצא ב-`requestJoinGame`: ניסיון נוצר לפני הפעולה, ולתוצאה שמור מספר סידורי באותו ביקור ובאותה זהות. אישור השמה נלקח מקבלת השרת, כולל המתנה ואישור מנהל נדרש, בלי לספור תשובת לקוח כהצלחה מאומתת ובלי לשנות את מסלול ההרשמה העסקי.',
    'profile/account-lifecycle': 'נוסף ניקוי אוספי השימוש אחרי סימון החשבון כמחוק ולפני מחיקת זהות האימות. כשל ניקוי מחייב ניסיון חוזר, ועסקאות הקליטה בודקות את סימון המחיקה. יציאה מוצלחת מאפסת גם את ביקור השימוש, בנפרד ממסלול ההצטרפות.',
    'clubs/details': 'הלשונית הפעילה מדווחת דרך קרס ממוקד בלבד. ההקשר כולל את מזהה המועדון; שינוי שם או ציור חוזר אינם כניסה חדשה, ונתיב שנשאר עם מזהה יעד חדש אינו יורש את לשונית היעד הקודם.',
    'clubs/manager-dashboard': 'הלשונית הפעילה בלוח מדווחת כשהמסך ממוקד, עם מזהה המועדון. חישובי הלוח, הרשאותיו ופעולות הניהול שלו אינם משתנים בגלל התיעוד.',
    'rounds/match-details': 'הלשונית הפעילה במחזור מדווחת כשהמסך ממוקד, עם מזהה המחזור. מעבר בין מחזורים באותו שם מסך הוא כניסה חדשה; ציור חוזר או הגעת נתונים אינם צפייה נוספת.',
    'shared/pulse-management': 'בכרטיס המשתמש נוסף אזור ביקורים לפני ההיסטוריה הקיימת. טעינת הפעילות עצמאית, עם עשרים ביקורים וחמישים אירועים בדף, רענון באזור פתוח, חיווי מידע חדש והגנה מתשובות של משתמש קודם. הניווט ליעד בודק את קיום המסמך בהרשאה הנוכחית.',
    'shared/onboarding-activity': 'זרם השימוש החדש מופרד מההצטרפות באוספים, במזהי ביקור, במכסה ובשליחה. הצפיות החדשות אינן משנות את קטלוג ההצטרפות או את התראות אבני הדרך שלה.',
}
default = 'נבדקו התוספות במקורות המשותפים לצורך ציר פעילות פרטי בפולס: דיווח ניווט והקשר, תיעוד ניסיון הרשמה ותוצאתו וגבולות זהות ומחיקת חשבון. התוספת היא תיעוד ברקע במקומות הנתמכים; אין מכך אימות חדש של כל מצבי הפיצר הזה או שינוי בחישוביו.'
for feature in affected:
    pair = next(p for p in pairs if p['technical'][:-3] == feature)
    for kind in ['technical', 'simple']:
        path = BASE / pair[kind]
        text = path.read_text(encoding='utf-8')
        if heading in text:
            continue
        link = '../shared/usage-activity.md' if pair['domain'] != 'shared' else 'usage-activity.md'
        body = specific.get(feature, default) if kind == 'technical' else 'נוסף תיעוד פרטי של ביקורים ופעילות במערכת הניהול. התוספת מקומית והאיסוף החדש כבוי כברירת מחדל; אין בדיקת מכשיר חדשה של מסך זה.'
        note = f'{heading}\n\n{body} מקומי וטרם הופץ או נפרס. [היקף, מקורות, בדיקות ומגבלות]({link}).\n\n'
        first, rest = text.split('\n', 1)
        path.write_text(first + '\n\n' + note + rest.lstrip('\n'), encoding='utf-8')

coverage = BASE / 'coverage.md'
text = coverage.read_text(encoding='utf-8')
line = '4.11.2026: `pulse/src/components/UserUsageTimeline.tsx` נוסף בתוך `pulse/src/screens/UserDetailScreen.tsx`, במסלול אנשים, משתמש, היסטוריה. משויך ל-[ציר הפעילות](shared/usage-activity.md) ולניהול הפולס. קרס לשוניות פנימי פועל במחזור, במועדון ובלוח המנהל. אין מסך או נתיב חדש; תצוגת המקור נבדקה במתאם דפדפן בלבד, והאיסוף כבוי כברירת מחדל.'
if line not in text:
    coverage.write_text(text + '\n' + line + '\n', encoding='utf-8')

manifest_path = BASE / 'screenshots/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
for scene in ['before', 'after', 'read-failure', 'empty', 'disabled', 'new-updates']:
    source = OUT / f'history-{scene}.png'
    name = f'usage-history-{scene}-2026-11-04.png'
    target = BASE / 'screenshots' / name
    target.write_bytes(source.read_bytes())
    entry = {'file': name, 'source': source.relative_to(ROOT).as_posix(), 'platform': 'Web', 'environment': 'רכיבי מקור במתאם דפדפן עם נתוני הדגמה', 'sourceCommit': commit, 'captured': '2026-11-04', 'notes': ['עץ מקורות מקומי עם שינויים שלא נשמרו בקומיט.', 'אין אימות מכשיר, מסד הדגמה, משתמש אמיתי או איסוף חי.'], 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
    manifest = [e for e in manifest if e['file'] != name] + [entry]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(OUT / 'documentation-impact.json').write_text(json.dumps({'affected': affected, 'newFeature': 'shared/usage-activity', 'screenshots': 6}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'updatedPairs': len(affected), 'newPair': 1, 'screenshots': 6}))
