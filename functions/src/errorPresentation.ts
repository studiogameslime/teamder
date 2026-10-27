/** Owner-facing copy only. The stored operation, code and stack stay intact. */
export function errorPresentation(operation: string, code = '', message = ''): {title:string;reason:string} {
  const names: Array<[RegExp,string]> = [
    [/receivedInvitations|ReceivedInvitations/, 'טעינת ההזמנות לא הושלמה'],
    [/onboardingActivity|OnboardingActivity/, 'שמירת פעולות ההצטרפות לא הושלמה'],
    [/EmailAuth|signInEmail/, 'ההתחברות בדואר אלקטרוני לא הושלמה'],
    [/updateService|StoreUpdate/, 'בדיקת העדכון לא הושלמה'],
    [/geocode|Geocode/, 'לא ניתן היה לזהות את שם המקום'],
    [/weather|Forecast/, 'תחזית מזג האוויר לא נטענה'],
    [/remoteConfig|homeConfig/, 'ההגדרות העדכניות לא נטענו'],
    [/socialPlayers|SocialPlayer/, 'טעינת פרטי השחקן לא הושלמה'],
    [/ChatInbox|friendsService/, 'רשימת החברים לא נטענה'],
    [/MatchDetails.*e2979a5915|openWaze/, 'פתיחת הניווט לא הושלמה'],
    [/commitRoundStats/, 'שמירת תוצאת המשחק לא הושלמה'],
    [/createNotificationOnce/, 'יצירת ההתראה לא הושלמה'],
  ];
  const title = names.find(([pattern])=>pattern.test(operation))?.[1] ?? 'פעולה באפליקציה לא הושלמה';
  let reason = 'הפרטים הטכניים נשמרו לבדיקה.';
  if (/deadline-exceeded|timeout/i.test(code+' '+message)) reason='השרת לא השיב בזמן.';
  else if (/network|offline|unavailable/i.test(code+' '+message)) reason='החיבור לרשת או לשירות אינו זמין כרגע.';
  else if (/unauthenticated|Full account required|sign in required/i.test(code+' '+message)) reason='הפעולה דורשת התחברות לחשבון מלא.';
  else if (/permission-denied/i.test(code)) reason='הבקשה נדחתה בגלל הרשאת גישה.';
  else if (/http\/50[0234]/i.test(code)) reason='השירות החיצוני לא השיב כראוי.';
  else if (/ERROR_INSTALL_NOT_ALLOWED|Install Error\(-6\)/.test(message)) reason='המכשיר אינו מאפשר כרגע התקנת עדכון.';
  return {title,reason};
}
