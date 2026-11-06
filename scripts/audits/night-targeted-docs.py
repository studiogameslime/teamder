from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/features'
notes={
 'home/dashboard':(
  'רענון שהתחיל לפני בחירה במועדון אחר שומר כעת את הבחירה האחרונה במסך ובאחסון. כשל בקריאת האחסון אינו מחליף בחירה תקפה.',
  'ב-groupStore, הכרעת hydrate ושמירת setCurrentGroup עוברות באותו תור. ההכרעה קוראת את הבחירה העדכנית אחרי ההמתנה. אם בחירה כבר אינה בסגל המוסמך, נבחר מועדון תקף או ריק. guardJoinAccount מגן גם על הצטרפות בקוד ועל ניסיון הרענון החוזר לאחר מעבר חשבון. ארבע הרגרסיות נוספו ל-tests/logic/groupHydrate.test.ts; 53 בדיקות משולבות עברו עם חבילת ההזמנות.'),
 'clubs/discovery':(
  'בחירת מועדון במהלך רענון נשמרת גם אם התשובה הישנה מגיעה אחריה. תשובת הצטרפות ישנה אינה מחזירה מועדון לחשבון אחר.',
  'תור הבחירה ב-src/store/groupStore.ts מכריע מול המצב הנוכחי. בדיקת זהות נעשית לפני ואחרי בקשת הצטרפות, ואחרי השהיית ניסיון חוזר. כשל שומר רשימות מוכרות. הוכחת התור והחלפת החשבון נמצאת ב-tests/logic/groupHydrate.test.ts.'),
 'entry/personal-invite':(
  'קישור שנפתח במפורש מקבל קדימות על הזמנה ישנה שחוזרת מהאחסון בזמן ההתקנה.',
  'resolveIncomingInvite ב-src/services/incomingInvite.ts בודק מחדש את מונה הגרסה אחרי getPendingInvite, ולא רק לפני קריאת האחסון. בכך קישור ישיר שנפתח במהלך ההמתנה אינו מוחלף בקישור ההתקנה. רגרסיה ב-tests/logic/inviteAttributionExpanded.test.ts מעכבת את הקריאה ומאמתת את היעד שנשמר.'),
 'statistics/player-compare':(
  'לצורכי מדידה, הצגת השוואה מוצלחת נרשמת פעם אחת לביקור במסך. מעבר בין לשוניות אינו מוסיף השוואה.',
  'PlayerComparisonViewed נשלח אחרי קבלת מודל בהקשר החשבון, המועדון ושחקן היעד. PlayerCompareTabChanged נפרד מהאירוע הישן PlayerCompareOpened. המאגר comparisonVisits שומר ניסיון לכל צמד ומועדון לאורך ההרכבה. שתי זהויות המשוות לאותו יעד נבדקו כמבצעים נפרדים בחבילות comparisonActivityVisit ו-comparisonActivityServer.'),
 'rounds/live-advanced':(
  'מדידת הזנת שער חדש מתבצעת אחרי שמירה מוצלחת. ביטול האשף, מחיקה, כשל או שליחה חוזרת של אותו שער אינם שער חדש במדידה.',
  'gameService.recordGoal מחזיר ערך בוליאני. אמת מציינת שער שנוסף בפועל, לרבות יצירת המצב החי הראשון, ושקר מציינת חזרה או אי שינוי. LiveScoreboardCard שולח LiveGoalRecorded רק עבור אמת. TeamScoreChanged נשאר לאירוע שינוי תוצאה. בדיקות המטפלים liveGoalMeasurementHandlers מפעילות את פונקציות המקור ובודקות ביטול, כשל, ניסיון חוזר ומחיקה.'),
 'shared/usage-activity':(
  'נוספה הכנה למדידת חשבונות ייחודיים לכל פעולה, גם כאשר אותו חשבון משתמש בכמה מכשירים. הדוח נטען לפי בחירת מפעיל הפולס ואינו מציג רשימת מבצעים. האיסוף החדש כבוי.',
  'נוסף product_action עם productKey מקטלוג סגור. אין בו פרטי מסך, מועדון או שחקן יעד. השרת קובע את בעל האירוע מטוקן הבקשה, דוחה אנונימיים ומונע מסירה כפולה. הקורא משתמש בתצלום מסד קבוע, מחשב קבוצות חשבונות לכל פעולה ומסמן גבולות כיסוי. הגדרות ההפעלה, מסלול הנתונים, המדדים, השימור והבדיקות מפורטים בדוח המדידה המקושר.'),
}
for key,(simple,technical) in notes.items():
 for suffix,text in [('.simple.md',simple),('.md',technical)]:
  file=BASE/(key+suffix);body=file.read_text(encoding='utf8')
  heading='## תיקוני לילה ובדיקת הפעולות, 5.11.2026'
  if heading in body:continue
  first,rest=body.split('\n',1)
  file.write_text(first+'\n\n'+heading+'\n\n'+text+
    ' השינוי מקומי. [ראיות ומגבלות](../../audits/2026-11-04-system-night/product-measurement.md).\n'+rest,encoding='utf8')
print(len(notes))
