// Rebuild Pulse's planning catalogue from the maintained product map.
const fs = require('fs');
const pairs = JSON.parse(fs.readFileSync('docs/features/document-pairs.json', 'utf8'));
const categories = { entry: 'כניסה והזמנות', home: 'בית וגילוי', profile: 'פרופיל וחברים', clubs: 'מועדונים וניהול', rounds: 'מחזורים ומשחקים', statistics: 'סטטיסטיקות והישגים', chat: 'שיחות והתראות', shared: 'כלים ושילובים' };
const descriptions = {
  authentication: 'התחברות והרשמה מתוך הפעולה שרוצים לבצע.',
  'boot-and-intent': 'פתיחת האפליקציה ובחירה בין הצטרפות לארגון כדורגל.',
  'pending-actions': 'שמירת טיוטה והמשך פעולה לאחר הרשמה.',
  'personal-invite': 'הזמנת חברים עם מידע על המועדונים של המזמין.',
  'profile-onboarding': 'השלמת פרטים והיכרות ראשונית.',
  'availability-preview': 'איתור פנויים בסביבה מתוך הבית.',
  dashboard: 'תמונת מצב אישית ופעולות מהירות בבית.',
  'guest-home': 'גילוי מועדונים ומחזורים לפני השלמת הרשמה.',
  'home-menu': 'גישה לפרופיל, הגדרות וכלים אישיים.',
  'round-cards': 'המחזור הקרוב וסיכום המחזור האחרון.',
  'tips-carousel': 'טיפים והסברים מתחלפים בבית.',
  'account-lifecycle': 'יציאה מהחשבון, מעבר לאורח ומחיקת חשבון.',
  achievements: 'ארון הישגים ותארים אישיים.',
  'availability-edit': 'בחירת זמני משחק, אזור ורדיוס.',
  'availability-week': 'צפייה בזמינות לאורך השבוע.',
  'blocked-users': 'ניהול רשימת המשתמשים החסומים.',
  feedback: 'שליחת דיווח תקלה או הצעת שיפור.',
  friends: 'רשימת חברים, שליחת בקשות ואישורן.',
  'notification-settings': 'בחירת ההתראות שרוצים לקבל.',
  'personal-history': 'צפייה במחזורים שבהם השתתף השחקן.',
  'player-card': 'פרטי שחקן, נתונים וקישורים לפעילות.',
  'profile-edit': 'עריכת פרטים אישיים ותמונת פרופיל.',
  referrals: 'רשימת החברים שהצטרפו דרך ההזמנה האישית.',
  requests: 'ריכוז בקשות ואישורים במקום אחד.',
  'season-titles': 'תארי השחקן מעונות שהסתיימו.',
  'covers-and-invitations': 'בחירת רקע ושיתוף הזמנה למועדון.',
  'create-and-edit': 'יצירת מועדון ועדכון ההגדרות שלו.',
  details: 'דף המועדון עם מחזורים, סגל ונתונים.',
  discovery: 'חיפוש מועדונים וסינון לפי התאמה.',
  history: 'ארכיון המחזורים שהתקיימו במועדון.',
  'members-and-administration': 'ניהול סגל ותפקידי מנהלים.',
  'player-management': 'ניהול כרטיסים, ציוד, דירוג ואירועים לשחקן.',
  'public-preview-and-join': 'היכרות עם מועדון ושליחת בקשת הצטרפות.',
  'requests-and-approvals': 'טיפול בבקשות להצטרפות למועדון.',
  seasons: 'פתיחה וסגירה של עונות ושמירת ארכיון.',
  'add-members': 'רישום חברי מועדון ושריון מקום במחזור.',
  'available-players': 'מציאת שחקנים פנויים ושליחת הזמנה למחזור.',
  'draft-board': 'בחירת קבוצות, החלפות ופרסום החלוקה.',
  'draft-setup': 'קביעת שיטת חלוקה ואיזון כוחות.',
  equipment: 'תיעוד מי לקח את הכדור והחולצות בסיום.',
  fillers: 'שילוב ממלאים והשאלת שחקנים בין קבוצות.',
  'game-create': 'יצירת מחזור והגדרת זמן, מקום והרשמה.',
  'game-edit': 'עדכון מחזור והגדרות מחזורים חוזרים.',
  'games-list': 'עיון במחזורים זמינים וחיפוש מחזור.',
  'games-map': 'מציאת מחזורים ומועדונים על המפה.',
  'live-advanced': 'ניהול משחקים, רוטציה וחילופים בזמן אמת.',
  'live-timer': 'שעון משותף וניהול משחק חי רגיל.',
  'match-details': 'פרטי המחזור, שחקנים, תוצאות ונתונים.',
  'match-players': 'ניהול רשימת שחקנים ואורחים במחזור.',
  'match-rounds': 'רישום וצפייה בתוצאות המשחקים בתוך המחזור.',
  'match-stats': 'סיכום אישי ונתוני הביצועים במחזור.',
  penalties: 'ניהול בעיטות הכרעה וסיום תיקו.',
  'promote-orphan': 'יצירת מועדון מתוך מחזור חד פעמי.',
  registration: 'הרשמה למחזור, רשימת המתנה ואישור מקום.',
  'chemistry-and-records': 'כימיה בין שחקנים, שיאים ונתונים מעניינים.',
  'club-leaders-and-table': 'טבלת מועדון, מובילים ומאבק האליפות.',
  'personal-statistics': 'נתוני ביצועים אישיים לאורך הזמן.',
  'player-compare': 'השוואה בין שחקנים ושיתוף ההשוואה.',
  'scopes-and-data': 'בחירת מועדון ועונה לנתונים שמוצגים.',
  'season-summary': 'סיכום העונה, מצטיינים ותארים.',
  'chats-list': 'שיחות, חיפוש, נעיצה, השתקה וארכיון.',
  'conversation-scopes': 'שיחות אישיות, שיחות מועדון ושיחות מחזור.',
  'message-actions': 'פעולות על הודעות, חסימה ודיווח.',
  'message-interface': 'שליחת הודעות ומעקב אחר מצב הקריאה.',
  'notification-delivery': 'קבלת התראות על הודעות חדשות.',
  'ads-and-store-review': 'הצגת פרסומות ובקשה לדירוג בחנות.',
  'notification-offer': 'הצעה להפעלת התראות אחרי פעולה מתאימה.',
  'player-discovery': 'חיפוש שחקנים ובחירת חשיפת הפרופיל.',
  'my-activity': 'מדידת פעילות אישית ושילובה בסיכום מחזור. זמינות תלויה בחיבור ובהפעלה.',
  'landing-and-links': 'דף היכרות וקישורי הזמנה לשיתוף.',
  'support-chat': 'פתיחת שיחה עם צוות התמיכה מתוך האפליקציה.',
};
const excluded = new Set(['legacy-and-hidden','data-and-state-contracts','global-gates','menus-and-motion','native-integrations','navigation-dock','diagnostic-journal','pulse-links','onboarding-activity','pulse-secure-access','pulse-team-chat','pulse-work-inbox','pulse-management','legal-pages','manager-dashboard']);
const features = pairs.flatMap(p => {
  const key = p.technical.split('/').pop().replace(/\.md$/, '');
  if (excluded.has(key) || /pulse|joryio/.test(key)) return [];
  if (!descriptions[key]) throw Error('Describe or explicitly exclude feature: ' + p.technical);
  return [{ id: p.technical.replace(/\.md$/, ''), category: categories[p.domain], title: p.title.replace(/[—–־]/g,' ').replace(/\s+/g,' ').trim(), description: descriptions[key], source: 'docs/features/' + p.technical }];
});
const extras = [
  ['manager-overview','תמונת מצב למנהל','מוכנות המחזור, משימות ומדדים מרכזיים.'],
  ['manager-attendance','ניתוח נוכחות והרשמה','הרגלי הרשמה והגעה של הסגל.'],
  ['manager-retention','שימור שחקנים','זיהוי שינויי פעילות וחזרה למשחק.'],
  ['manager-newcomers','השתלבות חברים חדשים','מעקב אחר צעדי ההשתלבות במועדון.'],
  ['manager-demand','ביקוש ומוכנות למחזור','צפייה בביקוש ובמוכנות לקראת המחזור.'],
  ['manager-ratings','דירוגי מנהל ומגמות','ציונים, המלצות ומגמות לאורך זמן.'],
  ['manager-equipment','מעקב ציוד למנהל','הצגת מחזיקי ציוד והיסטוריית המסירה.'],
  ['manager-cards','מעקב כרטיסים למנהל','כרטיסים פעילים והקשר משמעתי.'],
  ['manager-history','ניתוח היסטוריית המועדון','פעילות, עונות ונתונים לאורך מחזורי המועדון.'],
];
for (const [id,title,description] of extras) features.push({id:'clubs/'+id,category:categories.clubs,title,description,source:'docs/features/clubs/manager-dashboard.md'});
for (const [id,title,description] of [
  ['watch','שעון חכם','צפייה וניהול מהשעון, לפי יכולות הפלטפורמה.'],
  ['widgets','רכיבי מסך הבית','מידע על המחזור מחוץ לאפליקציה.'],
  ['weather','מזג אוויר למחזור','תחזית למקום ולזמן המשחק.'],
  ['health','חיבור למקורות בריאות','נתוני פעילות ממקורות נתמכים. זמינות תלויה בחיבור ובהפעלה.'],
]) features.push({id:'shared/'+id,category:categories.shared,title,description,source:'docs/features/shared/native-integrations.md'});
fs.mkdirSync('pulse/src/data',{recursive:true});
fs.writeFileSync('pulse/src/data/proPlanningFeatures.ts', '// Generated by scripts/generate-pro-planning.cjs. Stable IDs preserve planning choices.\nimport type { PlanningFeature } from \'../services/proPlanning\';\nexport const PLANNING_FEATURES: readonly PlanningFeature[] = ' + JSON.stringify(features,null,2) + ';\n');
console.log(features.length + ' planning features');

