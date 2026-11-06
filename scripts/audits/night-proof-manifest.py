from pathlib import Path
import datetime, hashlib, json, shutil, subprocess
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/features/screenshots'
manifest=BASE/'manifest.json'
data=json.loads(manifest.read_text(encoding='utf8'))
commit=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=ROOT,text=True).strip()
entries=[
 ('artifacts/system-night/invite-auth-large.png','night-signin-before-2026-11-05.png','אנדרואיד','החפיפה במסך ההתחברות בגופן 150 אחוזים לפני התיקון.'),
 ('artifacts/system-night/invite-auth-final.png','night-signin-after-2026-11-05.png','אנדרואיד','המסך לאחר התיקון במעטפת עם המדידה הפעילה.'),
 ('artifacts/system-night/email-keyboard-final.png','night-keyboard-after-2026-11-05.png','אנדרואיד','הקלדת שם עם מקלדת מערכת בטופס ההדגמה.'),
 ('docs/audits/2026-11-04-system-night/pulse-actions-after-390-1-account-ready.png','pulse-accounts-night-2026-11-05.png','דפדפן','חשבון אחד ושלושה ביצועים בנתוני הדגמה של רכיב המקור.'),
]
for src,name,platform,note in entries:
 source=ROOT/src
 target=BASE/name
 shutil.copyfile(source,target)
 row={'file':name,'source':src,'platform':platform,
      'environment':'אמולטור מבודד עם רשת כבויה ונתוני הדגמה' if platform=='אנדרואיד' else 'רכיב מקור עם מתאם דפדפן ונתונים מקומיים',
      'sourceCommit':commit+' עם השינויים המקומיים',
      'captured':datetime.datetime.fromtimestamp(source.stat().st_mtime,datetime.timezone.utc).isoformat(),
      'notes':[note,'הראיה תחומה למצב המצולם. אין התחברות ספק אמיתי או קליטת מדידה בייצור.'],
      'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
 data=[old for old in data if old['file']!=name]+[row]
manifest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'proofs':len(entries)}))
