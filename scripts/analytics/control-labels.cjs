// Build-time labels. Unknown source words never become runtime analytics data.
// Feature titles come from the product map when a screen is documented there.
const nouns = {
  achievement:'הישג', achievements:'הישגים', celebration:'חגיגת הישג', rating:'דירוג', ratings:'דירוגים', admin:'ניהול',
  input:'קלט', campaign:'קמפיין', collapsible:'הרחבה', community:'מועדון', communities:'מועדונים', club:'מועדון',
  filter:'סינון', filters:'מסננים', confirm:'אישור', destructive:'פעולה רגישה', dialog:'חלונית', modal:'חלונית',
  date:'תאריך', time:'זמן', empty:'מצב ריק', feed:'רשימה', game:'מחזור', games:'מחזורים', guest:'אורח',
  info:'מידע', notice:'הודעה', player:'שחקן', players:'שחקנים', identity:'זהות', radius:'מרחק', range:'טווח',
  header:'כותרת', screenshot:'צילום מסך', report:'דיווח', update:'עדכון', terms:'תנאים', chat:'שיחה',
  inbox:'דואר נכנס', search:'חיפוש', requests:'בקשות', chemistry:'כימיה', pair:'צמד', records:'שיאים',
  championship:'אליפות', stats:'סטטיסטיקה', statistics:'סטטיסטיקה', cover:'תמונת מועדון', equipment:'ציוד',
  season:'עונה', seasons:'עונות', draft:'חלוקת כוחות', team:'קבוצה', manual:'ידני', feedback:'משוב',
  auth:'התחברות', compare:'השוואה', comparison:'השוואה', match:'משחק', live:'משחק חי', score:'תוצאה',
  scoreboard:'לוח תוצאה', goal:'שער', goals:'שערים', penalty:'פנדל', shootout:'דו קרב פנדלים', keeper:'שוער',
  timer:'שעון', rotation:'חילוף', round:'משחקון', rounds:'משחקונים', summary:'סיכום', personal:'אישי',
  profile:'פרופיל', availability:'זמינות', registration:'הרשמה', filler:'השלמה', invitation:'הזמנה', invite:'הזמנה',
  home:'בית', onboarding:'הצטרפות', share:'שיתוף', privacy:'פרטיות', settings:'הגדרות', notifications:'התראות',
  login:'כניסה', sign:'כניסה', email:'דואר אלקטרוני', league:'ליגה', history:'היסטוריה', source:'מקור',
  friends:'חברים', friend:'חבר', map:'מפה', action:'פעולה', picker:'בחירה', table:'טבלה', detail:'פרטים',
  details:'פרטים', location:'מיקום', color:'צבע', distance:'מרחק', photo:'תמונה', phone:'טלפון', rules:'חוקים',
  member:'חבר מועדון', members:'חברי מועדון', waiting:'המתנה', substitution:'חילוף', counter:'מונה', tabs:'לשוניות',
  back:'חזרה', close:'סגירה', button:'כפתור', card:'כרטיס', activity:'פעילות', navigation:'ניווט',
};
const verbs = {close:'סגירה',cancel:'ביטול',back:'חזרה',confirm:'אישור',accept:'קבלה',decline:'דחייה',select:'בחירה',pick:'בחירה',
  open:'פתיחה',next:'הבא',prev:'הקודם',save:'שמירה',remove:'הסרה',delete:'מחיקה',edit:'עריכה',create:'יצירה',share:'שיתוף',
  change:'שינוי',toggle:'החלפה',expand:'הרחבה',expanded:'הרחבה',collapse:'צמצום',filter:'סינון',search:'חיפוש',reorder:'סידור',
  advance:'המשך',stop:'עצירה',start:'התחלה',finish:'סיום',undo:'ביטול פעולה',upload:'העלאה',refresh:'רענון',sort:'מיון',
  apply:'החלה',choose:'בחירה',move:'העברה',record:'תיעוד',swap:'החלפה',join:'הצטרפות',leave:'עזיבה',submit:'שליחה'};
const tokenize = s => s.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
function context(filename, features, titles) {
  const labels = features[filename]?.map(id=>titles[id]).filter(Boolean);
  if(labels?.length) return labels[0];
  const words = tokenize(filename.split('/').pop().replace(/\.tsx?$/,''));
  return [...new Set(words.map(w=>nouns[w]).filter(Boolean))].slice(0,3).join(' ');
}
function labelFor(site, features, titles) {
  const name = context(site.filename, features, titles);
  const fallback = site.label.includes(' במסך ') || site.label === 'בחירה בחלונית' || !/[א-ת]/.test(site.label);
  const pieces = tokenize(site.handler);
  const inferred = pieces.map(w=>verbs[w]).find(Boolean);
  const verb = fallback ? (inferred || site.label.split(' במסך ')[0]) : site.label;
  return name && name !== verb ? verb + ' (' + name + ')' : verb;
}
module.exports = { labelFor };
