// All Hebrew strings used in the app, centralized so future i18n is trivial.
// Keep keys in English (camelCase); values in Hebrew.

export const he = {
  // Common
  back: 'חזור',
  cancel: 'בטל',
  close: 'סגור',
  // InfoTip — reusable inline explanations (ⓘ)
  infoTipA11y: 'הסבר',
  infoTipGotIt: 'הבנתי',
  tipFillerTitle: 'פתיחה לזרים — מילוי חוסר',
  tipFillerText:
    'כשחסרים שחקנים, האפליקציה מציעה את המשחק לשחקנים מתאימים מחוץ לקבוצה שלך, באזור שלך. אתה תמיד מאשר ידנית מי מצטרף — אף אחד לא נכנס בלי אישורך. ככה ממלאים שבוע חוסר בלי לרדוף אחרי אנשים.',
  tipTrustTitle: 'מד אמינות',
  tipTrustText:
    'ציון שמשקף עד כמה אפשר לסמוך עליך שתגיע — נבנה מנוכחות במשחקים וביטולים בזמן. ככל שתגיע יותר ותבטל פחות, הציון עולה, ומארגנים נוטים יותר לאשר אותך למשחקים.',
  tipRatingTitle: 'דירוג שחקנים',
  tipRatingText:
    'חברי קבוצה מדרגים זה את זה 1–5 כוכבים. הדירוג אנונימי ומסייע למארגנים להרכיב קבוצות מאוזנות. רואים רק את הממוצע, לא מי נתן מה.',
  // Map
  mapGamesTitle: 'מפת המשחקים',
  mapCommunitiesTitle: 'מפת הקבוצות',
  mapEmpty: 'אין מה להציג על המפה כרגע',
  mapOpenDetails: 'לפרטים',
  mapButtonLabel: 'תצוגת מפה',
  mapSubtitle: 'מצא משחקים וקבוצות בכל מקום',
  mapSearchGames: 'חיפוש לפי עיר או מגרש',
  mapSearchCommunities: 'חיפוש לפי עיר או שם קבוצה',
  mapChipAllGames: 'כל המשחקים',
  mapChipToday: 'היום',
  mapChipWeekend: 'סוף שבוע',
  mapChipAllCommunities: 'כל הקבוצות',
  mapLegendToday: 'היום',
  mapLegendTomorrow: 'מחר',
  mapLegendWeekend: 'סוף שבוע',
  mapLegendOther: 'אחר',
  mapShowCommunities: 'הצג קבוצות',
  mapShowGames: 'הצג משחקים',
  mapLocateMe: 'התמקד במיקום שלי',
  yes: 'כן',
  no: 'לא',

  // Filters (games + communities)
  gameFiltersTitle: 'סינון משחקים',
  gameFiltersAny: 'הכל',
  gameFiltersApply: 'החל',
  gameFiltersReset: 'איפוס',
  gameFiltersVisibility: 'נראות',
  gameFiltersOnlyAvailable: 'רק משחקים עם מקומות פנויים',
  gameFiltersButton: 'סינון',
  // New time-window filter — surfaced at the top of the sheet so the
  // most common "what's happening soon" question is one tap away.
  gameFiltersWhen: 'מתי',
  gameFiltersWhenAny: 'הכל',
  gameFiltersWhenToday: 'היום',
  gameFiltersWhenThisWeek: 'השבוע',
  gameFiltersWhenWeekend: 'בסופ״ש',
  // Cost — most games are free; surfacing this avoids the surprise.
  gameFiltersCost: 'תשלום',
  gameFiltersCostFree: 'חינם',
  gameFiltersCostPaid: 'בתשלום',
  // Group the rare rule flags under one collapsible header so the
  // primary filters above stay scannable.
  gameFiltersAdvanced: 'מסננים מתקדמים',
  matchesCreateFab: 'יצירת משחק חדש',
  gameFiltersActive: (n: number) =>
    n === 1 ? 'פילטר אחד פעיל' : `${n} פילטרים פעילים`,
  communityFiltersTitle: 'סינון קבוצות',
  communityFiltersOnlyOpen: 'רק קבוצות עם הצטרפות פתוחה',
  communityFiltersHasRoom: 'רק קבוצות עם מקום לחברים חדשים',
  communityFiltersFreeOnly: 'רק קבוצות חינמיות',
  communityFiltersCity: 'עיר',
  communitiesNearbyResolving: 'מאתר את העיר שלך…',
  communitiesNearbyUnknown: 'לא הצלחנו לאתר עיר',
  save: 'שמור',
  // App-update prompts
  updateForceTitle: 'נדרש עדכון',
  updateForceBody: 'יש גרסה חדשה לאפליקציה. חובה לעדכן כדי להמשיך להשתמש.',
  updateOptionalTitle: 'גרסה חדשה זמינה',
  updateOptionalBody: 'יש גרסה חדשה זמינה לאפליקציה.',
  updateNow: 'עדכן עכשיו',
  updateLater: 'אולי אחר כך',

  // Destructive confirmation (irreversible delete dialog)
  confirmDeleteAck: 'אני מבין שהפעולה בלתי הפיכה',
  confirmDeleteSubmit: 'אישור מחיקה',
  // Game / group destructive flows
  deleteGameTitle: 'מחיקת המשחק',
  deleteGameBody: 'המשחק יוסר לצמיתות מהקבוצה ומהיסטוריית השחקנים. רישומים, רשימת המתנה והקבוצות שנבנו ימחקו.',
  deleteGameSuccess: 'המשחק נמחק',
  deleteGroupTitle: 'מחיקת הקבוצה',
  deleteGroupBody: 'הקבוצה ומידע השייך אליה יימחקו לצמיתות. כל החברים יתנתקו ולא ניתן יהיה לשחזר.',
  deleteGroupSuccess: 'הקבוצה נמחקה',
  done: 'בוצע',
  loading: 'טוען...',
  error: 'שגיאה',
  profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.',
  liveMatchNotFound: 'המשחק לא נמצא או הוסר.',

  // Global error boundary — fallback UI when a React tree crashes.
  errorBoundaryTitle: 'משהו השתבש',
  errorBoundaryBody:
    'נתקלנו בתקלה לא צפויה. אנחנו מצטערים על אי הנוחות. נסה שוב, או הפעל מחדש את האפליקציה.',
  errorBoundaryReload: 'נסה שוב',
  errorBoundaryReportHint: 'אם זה ממשיך להופיע, עדכן אותנו דרך "דווח על באג" בכרטיס השחקן.',

  // Community ratings
  ratingTitle: 'דרג את {name} בקבוצה הזו',
  ratingNoSelf: 'אי אפשר לדרג את עצמך',
  ratingNone: 'עדיין אין דירוגים',
  ratingInThisGroup: 'דירוג בקבוצה הזו',
  ratingSaved: 'הדירוג נשמר',
  ratingCleared: 'הדירוג הוסר',
  ratingButtonRate: 'דרג שחקן',
  ratingButtonReRate: 'עדכן דירוג',
  ratingCount: (n: number) =>
    n === 1 ? 'דירוג אחד' : `${n} דירוגים`,
  ratingHowWasTheir: 'איך היית מדרג את ההופעה?',
  ratingCommentPlaceholder: 'כתוב הערה (אופציונלי)…',
  ratingSend: 'שלח דירוג',
  ratingClear: 'נקה דירוג קיים',
  ratingLabel1: 'חלש',
  ratingLabel2: 'בסדר',
  ratingLabel3: 'טוב',
  ratingLabel4: 'טוב מאוד!',
  ratingLabel5: 'מצוין!',

  // Toasts (top-of-screen confirmations for "send/save/approve" actions)
  toastJoinRequestSent: 'הבקשה נשלחה',
  toastJoinedGroup: 'ברוך הבא לקבוצה',
  toastJoinSuccess: 'הצטרפת לקבוצה',
  toastGameJoined: 'הצטרפת למשחק',
  toastGameJoinedWaitlist: 'נוספת לרשימת המתנה',
  toastGameJoinedPending: 'בקשת ההצטרפות נשלחה',
  toastGameLeft: 'יצאת מהמשחק',
  toastRequestFailed: 'שליחת הבקשה נכשלה. נסה שוב.',
  toastMemberApproved: 'השחקן אושר',
  toastMemberRejected: 'הבקשה נדחתה',
  toastSaved: 'נשמר',
  toastGroupFull: 'הקבוצה מלאה. לא ניתן לשלוח בקשה כרגע.',
  toastApproveFailed: 'אישור החבר נכשל. נסה שוב.',
  toastApproveGroupFull:
    'הקבוצה כבר מלאה. לא ניתן לאשר חברים נוספים מעבר לקיבולת.',
  groupMaxBelowCurrentTitle: 'לא ניתן להוריד את הקיבולת',
  groupMaxBelowCurrentBody: (current: number) =>
    `יש כבר ${current} חברים פעילים בקבוצה. כדי להקטין את הקיבולת, יש קודם להסיר חברים.`,
  cancelPastDeadline: (hours: number) =>
    `מועד הביטול חלף — ניתן להתבטל רק עד ${hours} שעות לפני המשחק.`,
  lateCancelTitle: 'ביטול קרוב מאוד למשחק',
  lateCancelBody: (hours: number) =>
    `נשארו פחות מ-${hours} שעות עד תחילת המשחק. ביטול בשלב הזה ייספר כביטול מאוחר וישפיע על דירוג המשמעת שלך. בטוח שאתה רוצה לבטל?`,
  lateCancelConfirm: 'אישור ביטול',

  // Date/time field strings
  dtfPickTime: 'בחר שעה',
  dtfPickDate: 'בחר תאריך',
  dtfTime: 'שעה',
  dtfConfirm: 'אישור',
  dtfClear: 'נקה',

  // Game registration screen
  eveningList: 'רשימת משחק',
  eveningDetails: 'פרטי משחק',
  registered: 'נרשמים',
  waiting: 'ספסל',
  imIn: 'אני מגיע',
  imOut: 'אני מבטל',
  ball: 'כדור',
  brings: 'מביא',
  noBall: 'לא נקבע',

  // Game details
  navigateToField: 'ניווט למגרש',
  expectedAttendance: 'אחוז הגעה צפוי',
  shareInvite: 'שתף הזמנה',
  rainProb: 'סיכוי לגשם',
  weatherTemp: 'טמפרטורה',
  weatherRain: 'גשם',
  weatherForecastFor: 'תחזית למועד המשחק',
  // Session state pills (Match Details)
  sessionStatusWaitingPlayers: (cur: number, max: number) =>
    `⏳ מחכים לשחקנים (${cur}/${max})`,
  sessionStatusEnoughPlayers: 'יש מספיק שחקנים 🎉',
  sessionStatusTeamsReady: 'כוחות מוכנים',
  sessionStatusActive: 'משחק פעיל',
  sessionStatusTeamsInvalid: 'צריך ליצור כוחות מחדש',
  sessionInvalidHelper: 'הכוחות מתייחסים לשחקנים שכבר לא רשומים. צרו אותם מחדש.',
  sessionWaitingHelper: (min: number) =>
    `תצטרכו לפחות ${min} שחקנים כדי ליצור כוחות ולהתחיל`,
  sessionActionInvitePlayers: 'הזמן שחקנים',
  sessionActionShareLink: 'שיתוף קישור',
  sessionActionStart: 'התחל ערב משחקים',
  sessionActionGoLive: 'עבור ללייב',
  sessionInviteShareBody: (link: string) =>
    `הוזמנת למשחק ב־Teamder ⚽\nהצטרף כאן:\n${link}`,
  numWaiting: 'ספסל',
  numRegistered: 'נרשמים',

  // Team setup
  teamOrder: 'סדר קבוצות',
  team1: 'קבוצה 1',
  team2: 'קבוצה 2',
  team3: 'קבוצה 3',
  teamWaitingLabel: '(ממתינה)',
  shuffleTeams: 'ערבב קבוצות',
  startEvening: 'התחל משחק',
  goalkeeperOrder: 'סדר שוערים',

  // Goalkeeper screen
  goalkeeperOrderTeam: (n: number) => `סדר שוערים - קבוצה ${n}`,
  current: 'נוכחי',
  next: 'הבא',
  dragToReorder: 'גרור לשינוי סדר',

  // Live match — v2 portrait layout
  liveStartMatch: 'התחל משחק',
  liveTimerPause: 'השהה',
  liveTimerResume: 'המשך',
  liveTimerReset: 'אפס',
  liveTimerResetConfirmTitle: 'לאפס את הטיימר?',
  liveTimerResetConfirmBody: 'השעון יחזור לאפס. אי אפשר לבטל.',
  liveEndEvening: 'סיים ערב',
  liveEndEveningTitle: 'לסיים את הערב?',
  liveEndEveningBody:
    'הערב יסומן כהסתיים, התוצאות יישמרו והמשחק יעבור להיסטוריה. לא ניתן לחזור אחורה.',
  liveEndEveningConfirm: 'כן, סיים את הערב',
  availablePlayersTitle: 'שחקנים פנויים',
  availablePlayersEmpty: 'לא נמצאו שחקנים פנויים שמתאימים למשחק הזה',
  vs: 'VS',
  startTimer: 'התחל טיימר',
  pauseTimer: 'השהה',
  resetTimer: 'אפס',
  matchNumber: (n: number) => `משחקון ${n}`,
  matchOf: (n: number, total: number) => `משחקון ${n} מתוך ${total}`,

  // Match end
  matchEnd: 'סיום משחקון',
  whoWon: 'מי ניצחה?',
  team1Won: 'קבוצה 1',
  team2Won: 'קבוצה 2',
  tie: 'תיקו',

  // Players count
  playersCount: (cur: number, max: number) => `${cur}/${max}`,
  playersTotal: (n: number) => `${n} שחקנים`,

  // Misc
  thursdayFootball: 'חמישי כדורגל',
  regularField: 'המגרש הקבוע',

  // Game tab states
  gameLoading: 'טוען את המשחק...',
  liveTimerViewerHint: 'הטיימר מנוהל על ידי מנהל המשחק',
  gameNoActiveAdmin: 'אין משחק פעיל. צור משחק חדש כדי להתחיל.',
  gameNoActivePlayer: 'ממתין למנהל ליצור את המשחק',
  gamePermissionDenied: 'אין לך הרשאה לצפות במשחק הזה',
  gameLoadError: 'לא הצלחנו לטעון את המשחק. נסה שוב.',
  gameCreate: 'צור משחק חדש',
  gameRetry: 'נסה שוב',

  // Games list (Games tab — sectioned)
  gamesListTitle: 'משחקים',
  gamesSectionMy: 'המשחקים שלי',
  gamesSectionFromCommunities: 'מהקבוצות שלי',
  gamesSectionOpen: 'משחקים פתוחים',
  gamesEmptyMy: 'עוד לא נרשמת לאף משחק',
  gamesEmptyFromCommunities: 'אין כרגע משחקים בקבוצות שלך',
  gamesEmptyOpen: 'אין כרגע משחקים פתוחים באזור',
  gamesEmptyAllTitle: 'אין כרגע משחקים פעילים',
  gamesEmptyAllSub: 'תהיה הראשון לפתוח משחק עם הקבוצה שלך',
  gamesCreate: 'צור משחק חדש',

  // Game card
  gameCardPlayersOf: (cur: number, max: number) => `‎${cur}/${max}‎ שחקנים`,
  gameCardWaitlist: (n: number) => `+${n} בספסל`,
  gameCardJoin: 'אני מגיע',
  gameCardRequestJoin: 'בקש להצטרף',
  gameCardJoinWaitlist: 'הצטרף לספסל',
  gameCardCancel: 'בטל הרשמה',
  gameCardLeaveWaitlist: 'יציאה מהספסל',
  gameCardMissing: (n: number) =>
    n === 1 ? 'חסר עוד שחקן אחד' : `חסרים עוד ${n} שחקנים`,
  gameCardFull: 'המשחק מלא — ניתן להצטרף לספסל',
  gameCardCancelDeadline: (h: number) =>
    h === 1 ? 'דדליין לביטול: שעה לפני' : `דדליין לביטול: ${h} שעות לפני`,
  gameCardPublic: 'משחק פתוח',
  gameCardPrivate: 'קבוצה',
  gameCardPlayersMore: (n: number) => `+${n}`,
  gameStatusJoined: 'נרשמת',
  gameStatusWaitlist: 'הצטרף לרשימת המתנה',
  gameStatusPending: 'ממתין לאישור',
  gameFormat5: '5 × 5',
  gameFormat6: '6 × 6',
  gameFormat7: '7 × 7',

  // Create game form
  createGameTitle: 'יצירת משחק חדש',
  createGameRecurringTitle: 'תזמן משחק שבועי',
  createGameOverlapTitle: 'יש כבר משחק באותו זמן',
  createGameOverlapUnknownTitle: 'משחק קיים',
  createGameOverlapBody: (title: string, when: string) =>
    `כבר קיים משחק "${title}" ב-${when}. לא ניתן ליצור שני משחקים באותו חלון זמן.`,
  wizardRegOpensLabel: 'פתיחת הרשמה',
  wizardRegOpensHint:
    'במועד שתבחר המשחק יופיע בפיד וההרשמה תיפתח. עד אז הוא נסתר מכולם וחברי הקבוצה יקבלו התראה כשהוא נפתח.',
  wizardRegOpensHintPast:
    'מועד שבחרת כבר עבר — חברי הקבוצה יקבלו התראה והמשחק יופיע בפיד מיד עם השמירה.',
  wizardRegOpensRequired: 'יש לבחור מועד פתיחת הרשמה',
  wizardRegOpensMustBeBeforeKickoff:
    'מועד פתיחת ההרשמה חייב להיות לפני שעת המשחק',
  wizardRegOpensWarnTitle: 'לוודא שזה מה שרצית?',
  wizardRegOpensWarnPastBody:
    'מועד פתיחת ההרשמה שבחרת כבר עבר. ברגע השמירה תישלח התראה והמשחק יופיע בפיד.',
  wizardRegOpensWarnShortBody:
    'מועד פתיחת ההרשמה קרוב מאוד לתחילת המשחק (פחות מ-4 שעות). מומלץ לתת לחברי הקבוצה זמן להירשם.',
  wizardRegOpensWarnContinue: 'המשך בכל זאת',
  wizardRegOpensWarnEdit: 'ערוך',
  createGameCommunity: 'קבוצה',
  createGameCommunityHint: 'בחר קבוצה שאתה משחק בה',
  createGameDateTime: 'תאריך ושעה',
  gameWizardMissingFields: (fields: string) => `יש למלא: ${fields}`,
  createGamePastDateTitle: 'התאריך כבר עבר',
  createGamePastDateBody: 'מועד המשחק שבחרת כבר חלף. ליצור את המשחק בכל זאת?',
  createGamePastDateConfirm: 'צור בכל זאת',
  editGameNotifyTitle: 'השינוי יישלח לרשומים',
  editGameNotifyBody: (n: number) =>
    `השינוי יישלח כהתראה ל-${n} שחקנים רשומים. להמשיך?`,
  editGameNotifyConfirm: 'שמור ושלח',
  gameWizardSubmitFailed: 'יצירת המשחק נכשלה. נסה שוב.',
  createGameField: 'מיקום המגרש',
  createGameFieldPlaceholder: 'חפש מגרש, בית ספר, פארק או כתובת (כולל עיר)',
  createGameLocationFreeTextHint:
    'אפשר גם להקליד מיקום חופשי. בחירה מהרשימה תעזור לנו למקם את המשחק במדויק.',
  // Location search sheet
  locationSearchTitle: 'חיפוש מיקום',
  locationConfirm: 'אישור המיקום',
  locationSearchAgain: 'חיפוש אחר',
  locationNoResults: 'לא נמצאו תוצאות. אפשר להקיש על המפה לבחירת המיקום.',
  locationUseTyped: (q: string) => `השתמש ב: "${q}"`,
  // Always-on map picker
  locationTapHint: 'חפש כתובת, או הקש על המפה כדי לסמן את המיקום המדויק',
  locationResolving: 'מאתר מיקום…',
  locationOnMap: 'מיקום על המפה',
  createGameCity: 'עיר',
  createGameCityPlaceholder: 'בחר עיר מהרשימה',
  createGameCityMustPick: 'חובה לבחור עיר מהרשימה (לא טקסט חופשי)',
  createGameAddress: 'כתובת מדויקת (אופציונלי)',
  createGameAddressRequired: 'כתובת מדויקת',
  createGameAddressPlaceholder: 'רחוב, מספר, נקודת ציון',
  createGameMaxPlayers: 'מקסימום שחקנים',
  createGameMinPlayers: 'מינימום שחקנים (לא חובה)',
  createGameMinPlayersHint: 'מתחת למספר הזה המשחק עלול להתבטל',
  createGameNumberOfTeams: 'מספר קבוצות',
  createGameTotalPlayers: (n: number) => `סה״כ שחקנים: ${n}`,
  createGameFieldType: 'משטח המגרש',
  createGameMatchDuration: 'אורך המשחק (דקות)',
  createGameMatchDurationHint: 'ברירת המחדל לטיימר במגרש',
  createGameExtraTime: 'תוספת זמן (דקות)',
  createGameAutoBalanceTiming: 'מתי לסדר כוחות אוטומטית?',
  createGameAutoBalance30: '30 דקות לפני',
  createGameAutoBalance60: 'שעה לפני',
  createGameAutoBalance120: 'שעתיים לפני',
  fieldTypeAsphalt: 'אספלט',
  fieldTypeSynthetic: 'סינטטי',
  fieldTypeGrass: 'דשא',
  minutesShort: 'דק׳',
  createGameCancelDeadline: 'דדליין לביטול (שעות לפני המשחק)',
  createGameCancelDeadlineHint:
    'אחרי הזמן הזה ביטול ייספר כאי-הגעה',
  createGameFormat: 'פורמט',
  createGameIsPublic: 'משחק פתוח (גלוי לכולם)',
  createGameIsPublicHint: 'כשמופעל — המשחק יוצג בלשונית המשחקים גם למי שאינם בקבוצה',
  createGameRequiresApproval: 'דורש אישור',
  createGameRequiresApprovalHint: 'כשמופעל — תאשר ידנית כל בקשה להצטרף',
  createGameNotes: 'הערות (לא חובה)',
  createGameBringBall: 'מישהו צריך להביא כדור',
  createGameBringShirts: 'מישהו צריך להביא גופיות',
  createGameSubmit: 'יצירת משחק',
  createGameAdvanced: 'הגדרות מתקדמות',
  createGameTotalShort: (n: number) => `סך ${n} שחקנים`,
  editGameTitle: 'עריכת משחק',
  editGameSubmit: 'שמירת שינויים',
  editGameRegAfterKickoffTitle: 'תזמון לא תקין',
  editGameRegAfterKickoffBody:
    'מועד פתיחת ההרשמה חייב להיות לפני זמן תחילת המשחק.',
  editGameAlreadyStartedTitle: 'המשחק כבר התחיל',
  editGameAlreadyStartedBody:
    'לא ניתן לערוך פרטי משחק לאחר שזמן ההתחלה הגיע.',
  editGameCapacityTooLowTitle: 'יותר מדי שחקנים רשומים',
  editGameCapacityTooLowBody: (registered: number, max: number) =>
    `כרגע רשומים ${registered} שחקנים. לא ניתן להוריד את הקיבולת ל-${max}. הסר/י קודם שחקנים מהמשחק.`,
  matchDetailsDeletedTitle: 'המשחק כבר לא קיים',
  matchDetailsDeletedBody:
    'המשחק נמחק או הוסר. אפשר לחזור לרשימת המשחקים ולמצוא משחק אחר.',
  communityDetailsDeletedTitle: 'הקבוצה כבר לא קיימת',
  communityDetailsDeletedBody:
    'הקבוצה נמחקה על ידי המנהל. אפשר לחזור לרשימת הקבוצות ולחפש קבוצה אחרת.',
  deletedTargetBackToMain: 'חזרה לדף הראשי',
  matchDetailsEdit: 'עריכה',
  // Wizard
  wizardStep1: 'פרטים',
  wizardStep2: 'חוקים',
  wizardStep3: 'מתקדם',
  // Group-specific step 2 label (the group wizard only has 2 steps and
  // step 2 is the catch-all for optional + advanced settings).
  groupWizardStep2: 'מתקדם',
  wizardStepBack: 'חזרה',
  wizardStepNext: 'המשך',
  wizardStepSkip: 'דלג',
  wizardGameTitle: 'שם המשחק',
  wizardGameTitlePlaceholder: 'לדוגמה: חמישי כדורגל',
  wizardCity: 'עיר',
  wizardCityPlaceholder: 'לדוגמה: תל אביב',
  wizardAddress: 'כתובת מלאה',
  wizardAddressPlaceholder: 'רחוב הספורט 12',
  wizardLocation: 'מיקום',
  wizardLocationPlaceholder: 'עיר, רחוב ומספר',
  wizardTitleOptional: 'שם המשחק (אופציונלי)',
  wizardCancelOptionNone: 'ללא הגבלה',
  wizardCancelOption: (h: number) => `${h} שעות`,
  wizardSectionRules: 'חוקי המשחק',
  wizardHasReferee: 'שופט',
  wizardHasRefereeHint: 'שופט במגרש לאכיפת חוקים ופתיחת משחקונים',
  wizardHasPenalties: 'פנדלים',
  wizardHasPenaltiesHint: 'סבב פנדלים בתיקו',
  wizardHasHalfTime: 'חוצים',
  wizardHasHalfTimeHint: 'משחקים עם חוצים',
  wizardSectionVisibility: 'נראות',
  wizardVisibilityHint:
    'פתוח לכולם — כל שחקן באפליקציה יכול לראות את המשחק ולהצטרף.\n\nרק לקבוצה — רק חברי הקבוצה רואים את המשחק.',
  wizardVisibilityCommunity: 'רק לקבוצה שלי',
  wizardVisibilityPublic: 'פתוח לכולם',
  // Quick-game name + community target label (details step)
  createGameNameLabel: 'שם המשחק',
  createGameNamePlaceholder: 'לדוגמה: כדורגל שישי בבוקר',
  createGameNameHint: 'השם שיוצג בפיד ובכרטיס המשחק.',
  createGameForCommunity: (name: string) => `המשחק ייפתח לקבוצה: ${name}`,
  createGameChooseCommunityLocked:
    'משחק לקבוצה קבועה שלך — אבל עדיין אין לך קבוצה. הקם קבוצה ראשונה כדי לפתוח לה משחקים.',
  createGameCreateCommunityCta: 'הקמת קבוצה ראשונה',
  // Scheduled public-open + guests-open pickers (community games)
  wizardPublicOpenToggle: 'פתיחה לכלל האפליקציה בזמן מתוזמן',
  wizardPublicOpenHint:
    'בחר מתי המשחק יהפוך מ"רק לקבוצה" ל"פתוח לכולם". עד אז רק חברי הקבוצה רואים אותו; מהמועד שתבחר כל שחקן באפליקציה יוכל לראות ולהצטרף.',
  wizardPublicOpenLabel: 'מועד פתיחה לכולם',
  wizardGuestsOpenToggle: 'הגבלת הוספת אורחים עד זמן מסוים',
  wizardGuestsOpenHint:
    'עד המועד שתבחר רק מנהל המשחק יוכל להוסיף אורחים. שאר השחקנים יוכלו להוסיף אורחים רק מהמועד הזה ואילך. למנהל אין הגבלה.',
  wizardGuestsOpenLabel: 'פתיחת הוספת אורחים לשחקנים',
  wizardSectionAdvanced: 'הגדרות מתקדמות',
  wizardCancelDeadline: 'עד כמה שעות לפני אפשר לבטל הרשמה',
  wizardCancelDeadlineHint:
    'מעבר לזמן הזה, ביטול ייחשב כאי־הגעה. השאר ריק לחוסר הגבלה.',
  // Cancel-deadline as a date (toggle + picker) instead of hour pills
  wizardCancelDeadlineToggle: 'מועד אחרון לביטול הרשמה',
  wizardCancelDeadlineToggleHint:
    'כשמופעל — אחרי המועד שתבחר לא ניתן לבטל הרשמה (ביטול ייחשב כאי־הגעה). כבוי = אפשר לבטל בכל עת.',
  wizardCancelDeadlineLabel: 'מועד אחרון לביטול',
  wizardSummaryTitle: 'תקציר המשחק',
  wizardSummaryConfirm: 'אישור ויצירה',
  wizardSummaryBackToEdit: 'חזרה לעריכה',
  wizardSummaryDate: 'מתי',
  wizardSummaryWhere: 'מיקום',
  wizardSummaryFormat: 'פורמט',
  wizardSummaryVisibility: 'נראות',
  createGameNoCommunities: 'לפני שתוכל ליצור משחק, צריך להצטרף לקבוצה',
  createGameNoAdmin:
    'רק מנהלי קבוצה יכולים ליצור משחקים. בקש מהמנהל של הקבוצה ליצור עבורך משחק.',
  // Orphan / "no community" flow — fast path for creating a one-off
  // game without setting up a community first. The game lives in a
  // hidden personal group; after it ends, the user gets a push
  // offering to promote that group to a real community.
  matchDetailsCommunityOrphan: 'משחק חד־פעמי',
  // Game rules — free-text chip input. Replaces the old
  // hasReferee/hasPenalties/hasHalfTime toggles.
  ruleTagsLabel: 'חוקי המשחק',
  ruleTagsHint: 'הקלידו והוסיפו תגית עם Enter, פסיק או הכפתור +.',
  ruleTagsPlaceholder: 'שופט, משחקים עם חוצים…',
  ruleTagsAdd: 'הוסף חוק',
  ruleTagsRemove: (tag: string) => `הסר את "${tag}"`,
  ruleTagsAtCap: (n: number) => `הגעת למקסימום ${n} חוקים. הסר אחד כדי להוסיף עוד.`,
  // Per-player "אני מביא כדור" toggle on MatchDetails (visible only
  // to registered users). Self-toggle, no push fired.
  matchBringBallToggle: 'אני מביא כדור',
  matchBringBallTagOn: 'מביא כדור',
  // Promote-orphan-to-community screen
  promoteOrphanTitle: 'צור קבוצה מהמשחק',
  promoteOrphanBanner:
    'תני שם, סמן את מי להזמין — ובלחיצה כל החברים מהמשחק יקבלו הזמנה.',
  promoteOrphanNameLabel: 'שם הקבוצה',
  promoteOrphanNamePlaceholder: 'הכדורגלנים של חמישי',
  promoteOrphanCityLabel: 'עיר (אופציונלי)',
  promoteOrphanCityPlaceholder: 'תל אביב',
  promoteOrphanInviteHeader: (selected: number, total: number) =>
    `מי להזמין? (${selected}/${total} מסומנים)`,
  promoteOrphanNoOthers: 'לא היו עוד שחקנים במשחק להזמין.',
  promoteOrphanSubmit: (n: number) =>
    n === 0 ? 'צור קבוצה' : `צור והזמן ${n} שחקנים`,
  promoteOrphanNameTooShortTitle: 'שם קצר מדי',
  promoteOrphanNameTooShortBody: 'תנו לקבוצה שם של 2 תווים לפחות.',
  promoteOrphanSuccessTitle: '🎉 הקבוצה נוצרה',
  promoteOrphanSuccessBody: (n: number) =>
    n === 0
      ? 'הקבוצה מוכנה. תוכל להזמין שחקנים מהמסך של הקבוצה.'
      : `הקבוצה מוכנה. ${n} שחקנים קיבלו הזמנה.`,
  promoteOrphanGoToCommunity: 'פתח את הקבוצה',
  promoteOrphanErrorTitle: 'תקלה ביצירת הקבוצה',
  promoteOrphanErrorBody: 'נסה שוב בעוד רגע.',
  createGameOrphanCta: 'צור משחק חד־פעמי',
  createGameOrphanCtaSub: 'בלי קבוצה — מהיר, רק עבור הערב',
  createGameOrphanBanner: 'משחק חד־פעמי — תוכל לקבע קבוצה אחרי שתשחקו',
  createGameQuickLoading: 'מכינים משחק מהיר…',
  createGameOrphanErrorTitle: 'תקלה ביצירה',
  createGameOrphanErrorBody: 'לא הצלחנו להכין את הסביבה. נסה שוב בעוד רגע.',

  // Admin gating
  startEveningAdminOnly: 'רק מנהל יכול להתחיל את המשחק',
  createGameAdminOnly: 'רק מנהל יכול ליצור משחק חדש',

  // Group search
  groupsSearchTitle: 'חפש קבוצה',
  groupsSearchPlaceholder: 'שם הקבוצה',
  groupsSearchEmpty: 'אין תוצאות. נסה חיפוש אחר.',
  groupsSearchPrompt: 'הקלד שם קבוצה כדי לחפש',
  groupsSearchByCode: 'או הצטרף בעזרת קוד הזמנה',
  groupsSearchMembers: (n: number) => `${n} שחקנים`,
  groupsActionRequest: 'בקש להצטרף',
  groupsActionPending: 'הבקשה נשלחה',
  groupsActionMember: 'אתה כבר בקבוצה',

  // Sign-in errors
  signInCancelled: 'ההתחברות בוטלה',
  signInConfigMissing: 'הגדרות Google עדיין לא מוגדרות',
  signInFailed: 'ההתחברות נכשלה. נסה שוב.',
  signInNetworkError: 'אין חיבור לאינטרנט',

  // Communities (public groups feed)
  tabCommunities: 'קבוצות',
  communitiesTitle: 'קבוצות',
  communitiesSubtitle: 'גלה קבוצות כדורגל באזור שלך',
  communitiesCreateGroup: 'צור קבוצה חדשה',
  communitiesEmpty: 'לא מצאנו קבוצה בשם זה. נסה לחפש לפי עיר או שם אחר.',
  communitiesEmptyAll: 'אין עדיין קבוצות',
  communitiesEmptyAllSub: 'תהיה הראשון להקים קבוצת כדורגל באזור שלך',
  communitiesCreateFirst: 'צור קבוצה ראשונה',
  communitiesClosed: 'הקבוצה סגורה לבקשות חדשות',
  communitiesSearchPlaceholder: 'שם הקבוצה או עיר',

  // Empty states (real mode)
  statsEmpty: 'אין עדיין נתונים',
  statsEmptySub: 'הסטטיסטיקות יתעדכנו אחרי המשחקים הראשונים שלך',
  historyEmptyReal: 'אין עדיין היסטוריית משחקים',
  historyEmptyHint: 'ברגע שתסיים משחקים, הם יופיעו כאן',

  // Mock mode banner
  mockBanner: 'מצב נתוני דמו — לא קיים חיבור ל-Firebase',

  // Create group (extended)
  createGroupTitle: 'יצירת קבוצה חדשה',
  createGroupCity: 'עיר',
  createGroupCityPlaceholder: 'התחל להקליד שם עיר',
  createGroupStreet: 'רחוב',
  createGroupStreetPlaceholder: 'התחל להקליד שם רחוב',
  createGroupStreetDisabledHint: 'בחר עיר תחילה',
  createGroupAddressNote: 'הערה למיקום (לא חובה)',
  createGroupAddressNotePlaceholder: 'לדוגמה: שער צפוני, ליד בית הספר',
  createGroupDescription: 'תיאור הקבוצה (לא חובה)',
  createGroupMaxPlayers: 'מקסימום שחקנים במשחק',
  createGroupMaxMembers: 'מקסימום שחקנים בקבוצה',
  createGroupIsOpen: 'קבוצה פתוחה',
  createGroupIsOpenHint: 'כשמופעל — שחקנים חדשים מצטרפים אוטומטית. כבוי = דורש אישור מנהל.',
  createGroupContactPhone: 'טלפון איש קשר (לא חובה)',
  createGroupContactPhonePlaceholder: '050-1234567',
  createGroupContactPhoneHint: 'יוצג כפתור "פתח ב־WhatsApp" בקבוצה',
  createGroupContactPhoneInvalid: 'מספר לא תקין. פורמט: 05XXXXXXXX או +9725XXXXXXXX',
  createGroupPreferredDays: 'ימי משחק קבועים',
  createGroupPreferredHour: 'שעת משחק (לא חובה)',
  createGroupPreferredHourPlaceholder: '20:00',
  createGroupCostPerGame: 'עלות למשחק (₪)',
  createGroupCostPerGamePlaceholder: '0 = חינם',
  createGroupNotes: 'הערות לשחקני הקבוצה (לא חובה)',
  createGroupNotesPlaceholder: 'מים אישיים, להגיע 10 דקות מראש וכו׳',
  createGroupSubmit: 'צור והיכנס',

  // Communities tab — sectioned feed
  communitiesSectionAdmin: 'קבוצות שאני מנהל',
  communitiesSectionMember: 'הקבוצות שלי',
  communitiesSectionPending: 'ממתינות לאישור',
  communitiesSectionOpen: 'קבוצות פתוחות',
  communitiesHeroSubtitle: 'כל הקבוצות במקום אחד',
  communitiesCardMemberBadge: 'אתה חבר',
  // Inline CTA on the community card — surfaced only when the viewer
  // is NOT a member / admin / pending. Maps to the same requestJoin
  // call the details screen uses.
  communitiesCardJoin: 'הצטרף לקבוצה',
  communitiesCardSearchPlaceholder: 'חיפוש קבוצה או עיר',
  communitiesEmptyAdmin: 'אינך מנהל אף קבוצה',
  communitiesEmptyMember: 'עדיין לא הצטרפת לאף קבוצה',
  communitiesEmptyOpenSection: 'אין קבוצות פתוחות נוספות',
  // Legacy keys kept until any old caller is removed:
  communitiesSectionMine: 'הקבוצות שלי',
  communitiesSectionNearby: 'קרוב אליי',
  communitiesEmptyMine: 'עוד לא הצטרפת לקבוצה',
  communitiesEmptyNearby: 'אין קבוצות באזור שלך',

  // Filters
  filtersTitle: 'סינון',
  filterOpenOnly: 'פתוחות בלבד',
  filterHasRoom: 'מקום פנוי',
  filterNearby: 'קרוב אליי',
  // Radius selector shown under the "near me" toggle (games + communities)
  filterRadiusLabel: (km: number) => `טווח: עד ${km} ק"מ`,
  filterRadiusKm: (km: number) => `${km}`,
  // Shown when the user enables "near me" without granting location access
  locationPermTitle: 'צריך גישה למיקום',
  locationPermBody:
    'כדי לחפש משחקים וקבוצות קרובים אליך, יש לאשר גישה למיקום.',
  locationPermOpenSettings: 'פתיחת הגדרות',

  // Card actions
  communityEnter: 'כניסה לקבוצה',
  communityJoinAuto: 'הצטרף לקבוצה',
  communityRequestToJoin: 'בקש להצטרף',
  communityWhatsApp: 'WhatsApp',

  // Community details screen
  communityDetailsAbout: 'על הקבוצה',
  communityDetailsField: 'מגרש',
  communityDetailsCity: 'עיר',
  communityDetailsPreferredDays: 'ימי משחק',
  communityDetailsPreferredHour: 'שעת משחק',
  communityDetailsCost: 'עלות למשחק',
  communityDetailsCostFmt: (n: number) => (n > 0 ? `₪${n}` : 'חינם'),
  communityDetailsNotes: 'הערות',
  communityDetailsCreated: 'נוסדה ב',
  communityDetailsRules: 'חוקי הקבוצה',
  communityDetailsRecurring: 'משחק קבוע',
  communityDetailsCreateRecurringGame: 'צור את המשחק הקבוע הבא',
  communityDetailsRecurringConfirm: 'צור משחק',
  communityDetailsRecurringNoConfig: 'אין הגדרת משחק קבוע לקבוצה',
  communityDetailsRecurringFailed: 'יצירת המשחק נכשלה. נסה שוב.',
  communityDetailsAdmins: 'מנהלים',
  communityDetailsMembers: 'שחקנים',
  communityDetailsUpcoming: 'משחקים קרובים',
  communityDetailsNextGame: 'משחק קרוב',
  communityDetailsNoUpcoming: 'אין משחקים קרובים',

  // Guests (per-game guest players, not real users)
  guestAddButton: 'הוסף אורח',
  guestAddTitle: 'הוסף אורח למשחק',
  guestEditTitle: 'ערוך אורח',
  guestRowActionTitle: (name: string) => `הסרת ${name} מהמשחק?`,
  guestRowActionRemove: 'הסר אורח',
  guestRowRemoveSuccess: 'האורח הוסר מהמשחק',
  guestRowRemoveError: 'הסרת האורח נכשלה',
  createGroupGenericError: 'יצירת הקבוצה נכשלה. נסה שוב.',
  createGroupAuthError:
    'יצירת הקבוצה נחסמה כרגע מטעמי אבטחה. ודא שהאפליקציה מעודכנת לגרסה האחרונה ונסה שוב. אם הבעיה חוזרת, נסה לצאת ולהיכנס מחדש לחשבון.',
  createGroupRateLimitError:
    'יצירת קבוצות מוגבלת לחמש ביום. נסה שוב מחר.',
  communityDescriptionTitle: 'על הקבוצה',
  communityRulesTitle: 'חוקי הקבוצה',
  matchDetailsWaitlistTitle: 'רשימת המתנה',
  matchDetailsAvgRatingLabel: (count: number) =>
    `מבוסס על ${count} דירוגים`,
  guestNameLabel: 'שם האורח',
  guestNamePlaceholder: 'שם פרטי או כינוי',
  guestRatingLabel: 'דירוג משוער (לא חובה)',
  guestRatingHint: 'אופציונלי — סימון רמת השחקן לעצמך, לא נחשף לאחרים.',
  guestBadge: 'אורח',
  guestRemove: 'הסר אורח',
  guestRemoveConfirmTitle: 'להסיר את האורח?',
  guestAdded: 'האורח נוסף',
  guestSaved: 'נשמר',
  guestRemoved: 'האורח הוסר',
  guestErrorGameFull: 'המשחק מלא — הסר שחקן או אורח קיים',
  guestErrorPermission: 'רק מנהל יכול לערוך אורחים',
  guestErrorGeneric: 'הפעולה נכשלה',
  communityDetailsAdminBadge: 'מנהל',
  communityEditTitle: 'עריכת קבוצה',
  communityEditNoPermission: 'רק מנהל יכול לערוך את הקבוצה',
  communityEditRecurringEnabled: 'משחק קבוע (שבועי)',
  communityEditRecurringHint:
    'משחק שחוזר כל שבוע. כ-3 שעות אחרי שהמשחק מסתיים, נפתח אוטומטית משחק זהה לשבוע הבא (אותו יום ושעה), ופתיחת ההרשמה תתוזמן שוב באותו הפרש זמן. לא צריך לפתוח ידנית כל שבוע.',
  communityEditSectionBasics: 'פרטים בסיסיים',
  communityEditSectionSchedule: 'מתי משחקים',
  communityEditSectionSettings: 'הגדרות קבוצה',
  communityEditSectionExtra: 'פרטים נוספים',
  communityEditIsOpenHint: 'כשמופעל, שחקנים מצטרפים ללא אישור מנהל',
  communityEditTimeUnset: 'לא הוגדר',
  communityEditTimePick: 'בחר שעה',
  communityEditPreferredDaysLabel: 'ימי משחק קבועים',
  communityEditPreferredHourLabel: 'שעה קבועה',
  communityEditOptional: 'לא חובה',
  /** Schedule preview shown under section B when enough data exists.
   *  Strips a leading "ה" off the field name so the "ב" prefix doesn't
   *  produce "בה_field_" (e.g. "המגרש של אלירן" → "במגרש של אלירן"). */
  communityEditSchedulePreview: (day: string, hour: string, field: string) => {
    const trimmed = field.trim();
    if (!day || !hour || !trimmed) return '';
    const fieldStem = trimmed.startsWith('ה') ? trimmed.slice(1) : trimmed;
    return `משחק קבוע בימי ${day} בשעה ${hour} ב${fieldStem}`;
  },
  communityDetailsCreatorBadge: 'מייסד',
  communityDetailsPromoteCoach: 'הפוך למנהל',
  communityDetailsDemoteCoach: 'הסר מנהל',
  communityDetailsDemoteConfirmTitle: 'להוריד את המנהל?',
  communityDetailsDemoteConfirm: 'הסר',
  communityDetailsContactAdmin: 'צור קשר עם המנהל',
  communityDetailsInvite: 'הזמן שחקנים',
  communityDetailsLeave: 'עזוב קבוצה',
  communityDetailsLeaveConfirmTitle: 'לעזוב את הקבוצה?',
  communityDetailsLeaveConfirmBody: 'תמיד תוכל לבקש להצטרף שוב מאוחר יותר.',
  communityDetailsLeaveLastAdmin:
    'אתה המנהל היחיד. הוסף מנהל נוסף לפני שתעזוב.',
  // The image is delivered via the WhatsApp link-preview card (served
  // by the SSR `/team/{id}` route → og:image = group cover). The
  // preview card also carries the community name + description — so
  // the message body itself is intentionally minimal: a one-line
  // header, the description (when present, so recipients see what
  // the group's about even before opening the link), and the URL on
  // its own line so it reads as the call-to-action.
  communityInviteShareBody: (args: {
    link: string;
    name: string;
    description?: string;
  }) => {
    const lines: string[] = [`הוזמנת להצטרף לקבוצת ${args.name} ב־Teamder ⚽`];
    const desc = args.description?.trim();
    if (desc) lines.push('', desc);
    lines.push('', args.link);
    return lines.join('\n');
  },
  communityMembersCount: (n: number) =>
    n === 1 ? 'שחקן אחד' : `${n} שחקנים`,
  // Community details — redesign strings
  communityNextGameTitle: 'משחק קרוב',
  communityNextGameNone: 'לא נקבע משחק קרוב',
  communityNextGameCta: 'לצפייה בפרטי המשחק',
  communityNextGameLocked: 'ההרשמה תיפתח בקרוב',
  communityNextGameLockedBody: (when: string) =>
    `המשחק יופיע בפיד וההרשמה תיפתח ב-${when}.`,
  communityNextGameCreateRecurring: 'תזמן משחק שבועי לקבוצה',
  // Secondary "more upcoming" row shown under the primary NextGameCard
  // when the community has additional scheduled games queued up.
  communityUpcomingMoreLabel: 'גם בקרוב',
  communityUpcomingMoreOverflow: (n: number) =>
    n === 1 ? '+ עוד 1' : `+ עוד ${n}`,
  // Pinned admin message on game details — broadcast-style note from
  // the admin (e.g. "המגרש החליף לדשא 2", "תביאו חולצות שחורות").
  // Visible to everyone when set; admin sees a + tile to add when not.
  pinnedMessageEmptyAdminCta: 'הוסף הודעה לשחקנים',
  pinnedMessageEmptyAdminHint: 'רק אתה רואה את הריבוע הזה',
  pinnedMessageHeader: 'הודעת מנהל',
  pinnedMessageEditTitle: 'הודעת מנהל',
  pinnedMessageEditPlaceholder:
    'לדוגמה: "תזכרו להביא חולצה שחורה" או "המגרש סגור היום, נשחק במקום אחר" (עד 280 תווים)',
  pinnedMessageEditSave: 'שמור',
  pinnedMessageEditClear: 'מחק הודעה',
  pinnedMessageEditCancel: 'ביטול',
  communityPlayersTitle: 'שחקנים',
  communityPlayersSeeAll: 'לצפייה בכל השחקנים',
  communityPlayersEmpty: 'אין עדיין שחקנים בקבוצה',
  communityPlayersScreenTitle: 'שחקני הקבוצה',
  // Scoped to the community we're looking at — without the context
  // word "כאן" the count read as "1 משחק (everywhere?)" and
  // confused users on the community players screen.
  communityPlayerGames: (n: number) =>
    n === 1 ? 'משחק אחד כאן' : `${n} משחקים כאן`,
  communitySummaryPlayers: 'שחקנים',
  communitySummaryDays: 'ימי משחק',
  communitySummaryHour: 'שעת משחק',
  communitySummaryField: 'מגרש',
  communityNotifyRow: 'עדכן אותי על משחקים חדשים בקבוצה',
  // Community redesign — stadium-style premium UI
  communityHeroLabel: 'קבוצה',
  communityHeroDetailsTitle: 'פרטי קבוצה',
  communityCoverChange: 'החלף תמונת רקע',
  communityCoverUploading: 'מעלה…',
  communityCoverUploadFailed: 'העלאת תמונת הרקע נכשלה. נסה שוב.',
  communityCoverUpdated: 'תמונת הרקע עודכנה',
  // Cover image picker (gallery + device upload)
  coverPickerTitle: 'תמונת נושא לקבוצה',
  coverPickerGalleryLabel: 'בחר מהגלריה שלנו',
  coverPickerUpload: 'העלאה מהמכשיר',
  // ── Friends ──────────────────────────────────────────────────────
  friendsTitle: 'חברים',
  friendsRequestsTitle: 'בקשות חברות',
  friendsSentTitle: 'בקשות שנשלחו',
  friendsCancelRequest: 'בטל בקשה',
  friendsCancelRequestConfirm: 'לבטל את בקשת החברות?',
  friendsCancelRequestConfirmBody: (name: string) =>
    `אם תבטל, ${name} לא יראה את הבקשה שלך יותר.`,
  friendsRequestCancelled: 'הבקשה בוטלה',
  // ── Admin remove member (TU-22)
  communityRemoveMember: 'הסר מהקבוצה',
  communityRemoveMemberConfirmTitle: 'להסיר חבר מהקבוצה?',
  communityRemoveMemberConfirmBody: (name: string) =>
    `${name} לא יוכל לראות יותר תוכן פנימי של הקבוצה. ניתן להזמין מחדש בכל עת.`,
  communityRemoveMemberDone: 'החבר הוסר מהקבוצה',
  communityRemoveMemberCreatorBlocked: 'לא ניתן להסיר את יוצר הקבוצה',
  friendsActionFailed: 'הפעולה נכשלה. נסה שוב.',
  friendsMineTitle: (n: number) => `החברים שלי (${n})`,
  friendsEmpty: 'עדיין אין לך חברים. שלח בקשת חברות לשחקנים שפגשת במשחקים.',
  friendsEmptyCtaTitle: 'בנה לעצמך רשימת חברים',
  friendsEmptyCtaBody: 'הזמן חברים מרשימת אנשי הקשר שלך — תוכל להזמין אותם ישירות למשחקים בלחיצה אחת.',
  friendsEmptyCtaButton: 'הזמן חברים לאפליקציה',
  friendsAccept: 'אשר',
  friendsDecline: 'דחה',
  friendsAccepted: 'נוספתם כחברים',
  friendsRemove: 'הסר חבר',
  friendsRemoveTitle: 'להסיר חבר?',
  friendsRemoveBody: (name: string) => `להסיר את ${name} מרשימת החברים שלך?`,
  friendsUnknownUser: 'שחקן',
  // Player-card friend actions
  friendsAdd: 'הוסף לחברים',
  friendsPendingOutgoing: 'בקשת חברות נשלחה',
  friendsRespondIncoming: 'אשר בקשת חברות',
  friendsAlready: 'אתם חברים',
  friendsRequestSent: 'בקשת חברות נשלחה',
  // ── Quick-game wizard ────────────────────────────────────────────
  wizardVisibilityPrivate: 'פרטי (בהזמנה בלבד)',
  wizardVisibilityPublicOpen: 'פתוח לכולם',
  wizardInviteFriends: 'הזמן חברים',
  wizardInviteFriendsEmpty:
    'אין לך עדיין חברים להזמין. אפשר לשתף קישור למשחק אחרי היצירה, ולהוסיף חברים מכרטיס השחקן.',
  // Quick-vs-community chooser on the "+" button
  createGameChooseTitle: 'איזה משחק ליצור?',
  createGameChooseQuickTitle: 'משחק מהיר',
  createGameChooseQuickBody: 'משחק חד־פעמי בלי לפתוח קבוצה. אתה מזמין ידנית את מי שתרצה לשחק.',
  createGameChooseCommunityTitle: 'משחק לקבוצה',
  createGameChooseCommunityBody: 'משחק לקבוצה קיימת שלך. כל החברים יראו אותו אוטומטית.',
  createGameChooseQuick: 'משחק מהיר',
  createGameChooseCommunity: 'משחק לקבוצה',
  // Invite friends to an existing community
  communityMenuInviteFriends: 'הזמן חברים לקבוצה',
  communityInviteFriendsSend: (n: number) =>
    n > 0 ? `שלח ${n} הזמנות` : 'בחר חברים להזמנה',
  communityInviteFriendsFailed: 'שליחת ההזמנות נכשלה. נסה שוב.',
  groupWizardSubmitFailed: 'יצירת הקבוצה נכשלה. נסה שוב.',
  communityInviteFriendsSent: (n: number) =>
    n > 0 ? `נשלחו ${n} הזמנות` : 'אין חברים חדשים להזמין',
  communityStatsCreatedAt: 'תאריך הקמה',
  communityStatsMembers: 'חברים בקבוצה',
  communityStatsField: 'מגרש קבוע',
  communityStatsMatchesHeld: 'מפגשים שנערכו',
  communityNotifyDesignTitle: 'עדכנו אותי על משחקים חדשים בקבוצה',
  communityNextGameDetailsCta: 'לפרטי משחק',
  communityPlayersActiveTitle: 'שחקנים פעילים',
  // Hamburger menu sections for community
  communityMenuSectionCommunity: 'קבוצה',
  communityMenuSectionPlayers: 'שחקנים',
  communityMenuSectionActions: 'פעולות',
  communityMenuApprovals: 'בקשות ממתינות לאישור',
  communityMenuRecurringGame: 'צור משחק חוזר',
  communityMenuContactAdmin: 'צור קשר עם המנהל',
  communityMenuShareInvite: 'שתף הזמנה לקבוצה',

  // Settings
  settingsReportBug: 'דיווח על תקלה',
  settingsSuggestFeature: 'הצעת שיפור',
  settingsRateApp: 'דרג אותנו בחנות',
  settingsBugSubject: 'דיווח על תקלה באפליקציה',
  settingsSuggestSubject: 'הצעה לשיפור האפליקציה',
  settingsRateUnavailable: 'הדירוג עדיין לא זמין במצב פיתוח',
  settingsEmailUnavailable: 'לא נמצאה אפליקציית מייל',
  settingsEmailUnavailableHint: 'אפשר לכתוב לנו ישירות לכתובת:',

  // Feedback (in-app report a problem / suggest a feature)
  feedbackMenuItem: 'דיווח על תקלה / הצעה 💬',
  feedbackTitle: 'דיווח ומשוב',
  feedbackTypeBug: '🐛 דיווח על תקלה',
  feedbackTypeSuggestion: '💡 הצעה לשיפור',
  feedbackPlaceholder: 'ספרו לנו מה קרה, או איזה פיצר הייתם רוצים לראות…',
  feedbackSubmit: 'שליחה',
  feedbackSuccess: 'תודה! הדיווח התקבל 🙏',
  feedbackError: 'שליחת הדיווח נכשלה, נסו שוב',

  // Invite
  inviteShareTitle: 'הזמן שחקנים',
  inviteShareSubject: 'הצטרף לקבוצת הכדורגל שלנו ⚽',
  inviteShareBody: (groupName: string, link: string) =>
    `הצטרף לקבוצת הכדורגל שלנו באפליקציה ⚽\nשם הקבוצה: ${groupName}\nלחץ כאן כדי לבקש להצטרף: ${link}`,

  // Onboarding
  onbSkip: 'דלג',
  onbNext: 'הבא',
  onbStart: 'בוא נתחיל',
  onbCtaSignIn: 'התחבר עם Google',
  onbCtaSignInApple: 'התחבר עם Apple',
  onbCtaStart: 'המשך',
  onb1Title: 'שחקו עם אנשים בקרבת מקום',
  onb1Body: 'גלו משחקי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם',
  onb2Title: 'קבוצה קבועה, משחק אוטומטי',
  onb2Body: 'בנו את קבוצת השחקנים הקבועה שלכם — והמשחק השבועי נפתח לבד עם הזמנה לכולם',
  onb3Title: 'הכל זורם מעצמו',
  onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית משחקנים מתאימים. ותזכורות חכמות דואגות שכולם יגיעו',
  // 4th = final CTA screen — see onbStart / onbCtaSignIn above
  // (kept onb4* as legacy strings in case any UI still references them)
  onb4Title: 'בוא נתחיל',
  onb4Body: 'התחבר ותתחיל לארגן משחקים',

  // Auth
  signInTitle: 'בואו נתחיל',
  signInSubtitle: 'התחבר כדי להירשם, להצטרף לקבוצה ולעקוב אחרי הסטטיסטיקות שלך.',
  signInGoogle: 'המשך עם Google',
  signInApple: 'המשך עם Apple',
  signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש',

  // Profile setup
  profileTitle: 'בוא נכיר',
  profileName: 'שם',
  profileNamePlaceholder: 'איך לקרוא לך?',
  profileNameRequired: 'שם הוא שדה חובה',
  profileSave: 'שמור והמשך',
  profileEdit: 'ערוך כרטיס שחקן',

  // Player card
  playerCardTotalGames: 'משחקים',
  playerCardAttendance: 'אחוז הגעה',
  playerCardCancelRate: 'אחוז ביטולים',
  // Successful-referral stat — counts users whose invitedBy points
  // at this profile. Helper text clarifies the source so the value
  // isn't confused with "joined my game" / "joined my community".
  playerCardReferrals: 'צירף לאפליקציה',
  playerCardReferralsHelper: 'משתמשים שנרשמו דרך קישור שלך',
  playerCardReferralsHelperOther: 'משתמשים שהוא צירף לאפליקציה',
  playerCardInvite: 'הזמן למשחק',
  playerCardNotAvailable: 'לא זמין להזמנות',
  playerCardNotFound: 'לא הצלחנו לטעון את השחקן',
  playerCardEmail: 'אימייל',
  playerCardNoGameToInvite: 'אין לך משחק פעיל להזמנה. צור משחק קודם.',
  playerCardInviteSent: 'הזמנה נשלחה',
  playerCardSelf: 'זה אתה',
  playerCardAlreadyJoined: 'כבר רשום למשחק שלך',
  playerCardAlreadyWaitlist: 'בספסל למשחק שלך',
  playerCardAlreadyPending: 'ממתין לאישור למשחק שלך',
  playerCardInviteSentToast: 'הזמנה נשלחה ל{name}',
  playerCardLoadingGame: 'טוען את המשחק הקרוב…',
  playerCardInviteFailed: 'שליחת ההזמנה נכשלה. נסה שוב.',

  // Discipline (yellow / red cards)
  disciplineTitle: 'כרטיסים',
  disciplineNoCards: 'אין כרטיסים — שמרת על שם נקי',
  disciplineRecent: 'אירועים אחרונים',
  disciplineYellow: 'כרטיס צהוב',
  disciplineRed: 'כרטיס אדום',
  disciplineReasonLate: 'איחור למשחק',
  disciplineReasonNoShow: 'אי-הגעה למשחק',
  disciplineReasonManual: 'הוצא ידנית',
  disciplineCoachActions: 'ניהול כרטיסים',
  disciplineGiveYellow: 'תן כרטיס צהוב',
  disciplineGiveRed: 'תן כרטיס אדום',
  disciplineRevoke: 'הסר',
  disciplineConfirmRevoke: 'להסיר את הכרטיס?',
  disciplineWarningRecentRed: 'התקבל כרטיס אדום לאחרונה',
  // Snapshot caption — shown under the yellow/red display so the
  // user understands the window. We surface "10 המשחקים האחרונים"
  // when the user has at least 10 terminal games on file, and the
  // truncated "X משחקים אחרונים" otherwise.
  disciplineSnapshotTitle: 'משמעת (10 משחקים אחרונים)',
  disciplineSnapshotCaptionFull: 'מתוך 10 המשחקים האחרונים',
  disciplineSnapshotCaptionPartial: (n: number) =>
    `מתוך ${n} משחקים אחרונים`,
  disciplineSnapshotEmpty: 'אין עדיין היסטוריית משחקים להצגה',
  // Shown when the snapshot fetch fails — distinct from "0 cards".
  // A clean player and an unknown player must look different.
  disciplineSnapshotUnavailable: 'אין נתונים זמינים',
  disciplineLateAuto: (mins: number, type: 'yellow' | 'red') =>
    type === 'red'
      ? `איחור של ${mins} דק׳ — נרשם כרטיס אדום`
      : `איחור של ${mins} דק׳ — נרשם כרטיס צהוב`,

  // Trust meter (replaces the old yellow/red discipline UI). Shown
  // on the Player Card + Profile + filler-approval screens. Five
  // tiers map a 0-100 score (or `null` for new users) to a label.
  trustMeterTitle: 'מד אמינות',
  trustMeterCaption: (n: number) => `על בסיס ${n} משחקים אחרונים`,
  trustMeterCaptionEmpty: 'תקבל מד אמינות אחרי 3 משחקים שתסיים',
  trustMeterUnavailable: 'אין נתונים זמינים',
  trustTierExcellent: 'מצוין',
  trustTierGood: 'טוב',
  trustTierBasic: 'בסיסי',
  trustTierLow: 'נמוך',
  trustTierNew: 'חדש',
  trustBreakdownAttended: (att: number, reg: number) =>
    `הופיע ב־${att} מתוך ${reg} משחקים`,
  trustBreakdownSoftCancels: (n: number) =>
    n === 1 ? 'ביטול אחד לפני המועד האחרון' : `${n} ביטולים לפני המועד האחרון`,
  trustBreakdownHardCancels: (n: number) =>
    n === 1 ? 'ביטול אחד אחרי המועד האחרון' : `${n} ביטולים אחרי המועד האחרון`,

  // Game wizard step 3 — cross-community filler matching.
  gameFillerAcceptToggle: 'פתוח לזרים אם חסרים שחקנים',
  gameFillerAcceptToggleHint:
    'אם חסרים שחקנים, יישלחו התראות למשתמשי האפליקציה באזור שמעוניינים למלא. אתה תאשר ידנית מי מצטרף.',
  gameFillerMinTrust: 'מינימום מד אמינות',
  gameFillerMinTrustOption: (n: number) => `${n}+`,
  gameFillerMinTrustOptionAll: 'כולם',
  gameFillerMinTrustHint:
    'משתמשים חדשים בלי היסטוריה לא נכנסים לפול בכל מקרה.',

  // Admin filler approval section (MatchDetailsScreen).
  fillerSectionTitle: 'מועמדים למילוי',
  fillerSectionSubtitle:
    'שחקנים מחוץ לקבוצה שמעוניינים למלא את החסר. אישור יכניס אותם לרוסטר.',
  fillerApprove: 'אישור',
  fillerDecline: 'דחייה',
  fillerApproveSuccess: 'השחקן נוסף למשחק',
  fillerApproveStale:
    'המקום כבר התמלא או שהמשחק נסגר',
  fillerDeclineConfirmTitle: 'דחיית מועמדות',
  fillerDeclineConfirmBody: (name: string) =>
    `לדחות את ${name}? לא תוכל לבחור בו שוב למילוי המשחק הזה.`,
  fillerDeclineConfirm: 'דחה',
  fillerDefaultName: 'שחקן',

  // Achievements (תארים)
  achievementsTitle: 'תארים אישיים',
  achievementsCount: (unlocked: number, total: number) =>
    `${unlocked} מתוך ${total}`,
  achievementsSeeAll: 'הצג הכל',
  achievementsEmpty: 'עוד לא נפתחו תארים. תתחיל לשחק!',
  achievementsLockedHint: 'נפתח אחרי שתעבור את היעד',
  achievementCategoryGames: 'משחקים',
  achievementCategoryTeams: 'קבוצות',
  achievementCategoryInvites: 'הזמנות',
  achievementCategoryCoaching: 'ניהול',
  achievementUnlockedAt: (d: string) => `נפתח ב-${d}`,

  // (Jersey picker strings retired — replaced by profile photo /
  // avatar picker in profilePhoto* / profileAvatar* keys above.)

  // Availability editor
  availabilityTitle: 'זמינות שלי',
  availabilityIntro: 'איך אנחנו יודעים מתי להציע לך משחקים',
  availabilityDays: 'ימים מועדפים',
  availabilityDayShort: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  /** Full Hebrew names of weekdays — same index as availabilityDayShort.
   *  Used by long-form copy like the schedule preview where "ימי ב'"
   *  reads worse than "ימי שני". */
  weekdayLong: [
    'ראשון',
    'שני',
    'שלישי',
    'רביעי',
    'חמישי',
    'שישי',
    'שבת',
  ],
  availabilityTimeFrom: 'משעה',
  availabilityTimeTo: 'עד שעה',
  availabilityCity: 'אזור / עיר מועדפים',
  availabilityCityHint: 'נשמש לאיתור קבוצות וזימוני משחקים קרובים',
  availabilityCities: 'ערים שאני מוכן לשחק בהן',
  availabilityCitiesPlaceholder: 'הוסף עיר',
  availabilityCitiesHint: 'בחר עיר מהרשימה והקש כדי להוסיף. ניתן להוסיף כמה.',
  availabilityCityRemove: 'הסר',
  availabilityHomeCity: 'עיר המגורים',
  availabilityHomeCityPlaceholder: 'בחר עיר מהרשימה',
  availabilityHomeCityHint:
    'נשתמש בה יחד עם הרדיוס למצוא משחקים קרובים אליך.',
  availabilityHomeCityMustPick:
    'חובה לבחור את העיר מהרשימה (לא טקסט חופשי).',
  availabilityRadius: (km: number) => `רדיוס למשחקים: עד ${km} ק"מ`,
  availabilityRadiusHint:
    'הרחק מעיר המגורים, נציע לך משחקים בקבוצות אחרות.',
  availabilityInvitable: 'זמין להזמנות לקבוצות אחרות',
  availabilityInvitableHint: 'כשמכובה — שום שחקן לא יוכל לראות אותך כמועמד הזמנה',
  availabilityFillerPush: 'קבל הזמנות מילוי לקבוצות אחרות',
  availabilityFillerPushHint:
    'תישלח לך התראה כשקבוצה באזורך זקוקה לשחקנים. תוכל לבחור אם להגיש מועמדות.',
  availabilitySave: 'שמור זמינות',

  // Post sign-in onboarding — single profile-customisation step.
  // The welcome + "how it works" intermediate screens were removed
  // (the user already saw the value pitch in the pre-sign-in flow);
  // psoWelcomeBody is still used as the hero subtitle on the new
  // single-screen layout.
  psoWelcomeBody:
    'מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.',
  profilePhotoLabel: 'תמונת השחקן',
  profilePhotoUpload: 'העלאה מהגלריה',
  profilePhotoChange: 'החלף תמונה',
  profileAvatarLabel: 'או בחר אווטאר',
  profilePhotoPermissionDenied:
    'אין הרשאה לגישה לגלריה. אפשר לאשר בהגדרות הטלפון.',
  profilePhotoUploadFailed: 'העלאת התמונה נכשלה. נסה שוב.',
  profilePhotoUnavailable:
    'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.',
  profileEditUnsavedTitle: 'יש לך שינויים שלא נשמרו',
  profileEditUnsavedBody:
    'בחרת תמונה / אווטאר חדשים אבל לא לחצת על שמור. לשמור עכשיו?',
  profileEditUnsavedSave: 'שמור',
  profileEditUnsavedDiscard: 'התעלם וצא',
  validateRequired: 'יש להזין {field}',
  validateTooLong: '{field} ארוך מדי (עד {max} תווים)',
  validateOutOfRange: '{field} חייב להיות בין {min} ל-{max}',
  inviteRateLimited: 'שלחת יותר מדי הזמנות. נסה שוב מאוחר יותר.',
  inviteAlreadyJoined: 'השחקן כבר רשום למשחק.',
  inviteNotAllowed: 'אין לך הרשאה להזמין למשחק הזה.',
  psoProfileTitle: 'בוא נכיר',
  psoProfileSave: 'המשך',

  // Empty state — first-time main screen
  emptyHomeTitle: 'אין לך עדיין משחקים',
  emptyHomeBody: 'צור משחק חדש או הצטרף למשחק קיים',
  emptyHomePrimary: 'צור משחק',
  emptyHomeSecondary: 'מצא משחקים',
  // Shown instead of "מצא משחקים" when there's nothing to find — both
  // tabs are empty, so the button would dead-end. Encourages the user
  // to be the one who starts a game in their community.
  emptyHomeNoGamesAnywhere: 'אין משחקים פתוחים כרגע — היה הראשון לפתוח משחק לקבוצה שלך',
  // Shown when a filter is active and nothing matches — there ARE games,
  // they're just filtered out, so we point at the filter, not "create".
  emptyHomeFilteredBody: 'אין משחקים שתואמים לסינון',
  emptyHomeClearFilters: 'נקה סינון',

  // First-run hint (tooltip)
  hintCreateGame: 'כאן יוצרים משחק חדש',
  hintGotIt: 'הבנתי',

  // Groups
  groupsChooseTitle: 'הצטרף לקבוצה',
  groupsChooseSub: 'אפשר להצטרף לקבוצה קיימת או לפתוח חדשה',
  groupsCreate: 'צור קבוצה חדשה',
  groupsJoin: 'הצטרף לקבוצה קיימת',
  groupCreateTitle: 'יצירת קבוצה',
  groupCreateName: 'שם הקבוצה',
  groupCreateField: 'שם המגרש',
  groupCreateAddress: 'כתובת המגרש',
  groupCreateSave: 'צור קבוצה',
  groupJoinTitle: 'הצטרפות לקבוצה',
  groupJoinCodeLabel: 'קוד הזמנה',
  groupJoinCodePlaceholder: 'הקלד את הקוד שקיבלת',
  groupJoinSubmit: 'שלח בקשה',
  groupJoinSuccess: 'הבקשה נשלחה!',
  groupPendingTitle: 'הבקשה ממתינה לאישור',
  groupPendingBody: 'מנהל הקבוצה יקבל הודעה ויאשר אותך בקרוב.',
  groupNotFound: 'הקוד לא נמצא',
  groupAlreadyMember: 'אתה כבר בקבוצה הזו',
  groupAdminApprovalTitle: 'בקשות לסגל',
  groupAdminEmpty: 'אין בקשות חדשות',
  approve: 'אשר',
  reject: 'דחה',

  // Tabs
  tabGame: 'משחקים',
  tabProfile: 'כרטיס שחקן',
  tabStats: 'סטטיסטיקה',
  tabHistory: 'היסטוריה',

  // Profile tab
  profileMyGroup: 'הקבוצה שלי',
  profileMyGroups: 'הקבוצות שלי',
  profileInviteCode: 'קוד הזמנה',
  profileSignOut: 'התנתק',
  profileSignOutConfirmTitle: 'להתנתק?',
  profileSignOutConfirmBody: 'תצטרך להתחבר מחדש בכניסה הבאה.',
  profileDeleteAccount: 'מחיקת חשבון',
  profileDeleteAccountTitle: 'למחוק את החשבון?',
  profileDeleteAccountMessage:
    'הפעולה תמחק לצמיתות את כרטיס השחקן שלך, ההיסטוריה וההגדרות. לא ניתן לשחזר.',
  profileDeleteAccountConfirm: 'מחק לצמיתות',
  profileDeleteAccountCancel: 'ביטול',
  profileDeleteAccountSuccess: 'החשבון נמחק',
  profileDeleteAccountFailed: 'מחיקת החשבון נכשלה. נסה שוב.',
  profileChangePhoto: 'שנה תמונה',
  profileChangeAvatar: 'הקש לשינוי התמונה',
  profilePickAvatar: 'בחר תמונת השחקן',
  profileUploading: 'מעלה תמונה...',
  profileUploadFailed: 'העלאת התמונה נכשלה',
  profilePermissionPhotos: 'נדרשת הרשאה לתמונות',
  profileGroupActive: 'פעילה',
  profileGroupSwitch: 'החלף',
  profileSectionStats: 'סטטיסטיקה',
  profileSectionHistory: 'היסטוריית משחקים',
  profileSectionApprovals: 'בקשות לסגל',
  profileSectionAvailability: 'הזמינות שלי',
  profileSectionPlayerCard: 'הכרטיס שלי',
  // Hamburger label for the achievements view. Distinct word from the
  // existing "תארים" (which is the in-screen section title) — the user
  // asked specifically for "הישגים" in the menu.
  profileSectionMyAchievements: 'ההישגים שלי',
  profileSectionNotifications: 'התראות',
  // New section labels for the redesigned profile
  profileSectionAccount: 'החשבון שלי',
  profileSectionMatches: 'משחקים ולוח זמנים',
  profileSectionPreferences: 'התראות והעדפות',
  profileSectionSupport: 'עזרה ומשוב',
  profileBadgeAdmin: 'מנהל',
  profileBadgePlayer: 'שחקן',
  // Hamburger menu — section titles + meta strings.
  profileMenuOpen: 'פתח תפריט',
  profileMenuClose: 'סגור תפריט',
  profileMenuSectionProfile: 'כרטיס שחקן',
  profileMenuSectionGames: 'משחקים',
  profileMenuSectionSystem: 'הגדרות',
  profileMenuSectionSupport: 'עזרה ומשוב',
  profileMenuSectionAccount: 'חשבון',
  profileStatTotalGames: 'משחקים',
  profileStatAttendance: 'הגעה',
  profileStatWinRate: 'אחוז ניצחון',
  profileStatAttended: 'הופעות',
  profileStatCancelRate: 'ביטולים',
  profileStatGoals: 'שערים',
  profileSubtitlePlayer: 'שחקן',
  profileStatInvited: 'שחקנים שהצטרפו דרכי',
  // Referrals list screen — opens when the user taps the referrals tile
  // on the Profile screen.
  referralsScreenTitle: 'שחקנים שהצטרפו דרכי',
  referralsScreenSummary: (n: number) =>
    n === 1 ? 'שחקן אחד הצטרף דרכך' : `${n} שחקנים הצטרפו דרכך`,
  referralsScreenAnonymous: 'משתמש ללא שם',
  referralsScreenJustNow: 'הצטרף ממש עכשיו',
  referralsScreenAnHourAgo: 'הצטרף לפני שעה',
  referralsScreenHoursAgo: (h: number) => `הצטרף לפני ${h} שעות`,
  referralsScreenYesterday: 'הצטרף אתמול',
  referralsScreenDaysAgo: (d: number) => `הצטרף לפני ${d} ימים`,
  referralsScreenJoinedAt: (when: string) => when,
  referralsScreenJoinedUnknownTime: 'הצטרף',
  referralsScreenViaLink: 'דרך הזמנה',
  referralsScreenViaCommunity: 'דרך קבוצה',
  referralsScreenViaGame: 'דרך משחק',
  referralsScreenEmptyTitle: 'עוד לא הזמנת אף אחד',
  referralsScreenEmptyBody:
    'שלח לחבר קישור הזמנה מכרטיס השחקן שלך — וכשהוא יתחבר תראה אותו פה.',
  // Always-visible nudge under the invited-count tile. Even when the
  // count is 0 we want the user to see the metric AND have a one-tap
  // path to grow it — hiding both the number and the CTA together is
  // a missed engagement opportunity.
  profileInviteFriendsCta: 'הזמן חברים לאפליקציה',
  profileInviteShareBody: (link: string) =>
    `אני משחק כדורגל בעזרת אפליקציית Teamder ⚽\nתוריד גם אתה ובוא לשחק:\n${link}`,
  profileApprovalsCount: (n: number) =>
    n === 1 ? 'בקשה אחת ממתינה' : `${n} בקשות ממתינות`,

  // Compact match card on the Matches list
  matchCardJoin: 'הצטרף',
  matchCardWaitlist: 'המתנה',
  matchCardLeave: 'בטל הרשמה',
  matchCardPlayersOf: (n: number, max: number) => `‎${n}/${max}‎ שחקנים`,
  matchStatusOpen: 'פתוח',
  matchStatusFull: 'מלא',
  matchStatusJoined: 'נרשמת',
  matchStatusWaitlist: 'בהמתנה',
  matchStatusPending: 'ממתין לאישור',
  // Visibility tag on the games list card
  matchTagOpenToAll: 'פתוח לכולם',
  matchTagCommunityOnly: 'סגור לקבוצה',
  matchTagQuickClosed: 'משחק מהיר',
  // Urgency chip — surfaced when the game is full or nearly full so users
  // see scarcity at a glance, independent of their own registration state.
  matchStatusLastSpots: (n: number) =>
    n === 1 ? 'מקום אחרון' : `${n} מקומות אחרונים`,

  // Matches tab header / segmented tabs
  matchesTabMine: 'המשחקים שלי',
  matchesTabOpen: 'גלה משחקים',
  // Section header inside "המשחקים שלי" tab — earlier it duplicated
  // "משחקים פתוחים" from the other tab, which was confusing.
  matchesSectionMineRegistered: 'משחקים שאתה רשום אליהם',
  // Matches screen redesign — hero / sections / empty card
  matchesHeroSubtitle: 'הצטרף למשחקים או צור משחק חדש',
  matchesSectionOpen: 'משחקים פתוחים',
  matchesSectionMine: 'המשחקים הרשומים שלי',
  matchesEmptyCardTitle: 'לא מצאת משחק שמתאים?',
  matchesEmptyCardSub: 'צור משחק חדש ותן לאחרים להצטרף',
  matchCardJoinFull: 'הצטרף למשחק',
  matchesEmptyMine: 'לא נרשמת עדיין למשחקים',
  matchesEmptyOpen: 'אין משחקים פתוחים בקרבתך',

  // Match details screen
  matchDetailsTitle: 'פרטי המשחק',
  matchDetailsDate: 'תאריך ושעה',
  matchDetailsLocation: 'מיקום',
  matchDetailsField: 'סוג מגרש',
  matchDetailsFormat: 'פורמט',
  matchDetailsPlayers: 'שחקנים רשומים',
  matchDetailsManage: 'ניהול משחק',
  matchDetailsCancel: 'בטל הרשמה',
  matchDetailsJoin: 'הצטרף למשחק',
  matchDetailsClosedForRegistration: 'ההרשמה נסגרה',
  matchDetailsRegistrationOpensAt: (when: string) =>
    `ההרשמה עדיין לא נפתחה — היא תיפתח ב-${when}`,
  matchDetailsAlreadyStarted: 'המשחק כבר התחיל',
  matchDetailsAlreadyLive: 'המשחק כבר במצב לייב',
  matchDetailsAlreadyFinished: 'המשחק הסתיים',
  matchDetailsAlreadyCancelled: 'המשחק בוטל',
  matchDetailsTerminalSub: 'לא ניתן לבצע פעולות על המשחק הזה',
  matchDetailsNotFound: 'המשחק לא קיים יותר',
  // Stage 2 lifecycle CTAs / banners
  lifecycleCannotJoin: 'אין אפשרות להצטרף למשחק הזה',
  liveMatchNotActiveYet: 'המשחק עדיין לא פעיל',
  // Top in-app banners (event signals, distinct from system toasts).
  // These fire from the realtime game-doc listener, so they describe
  // events that may be triggered by other users on other devices.
  bannerPlayerJoined: 'שחקן הצטרף למשחק',
  bannerPlayerJoinedNamed: (firstName: string) => `${firstName} נרשם למשחק`,
  bannerPlayersJoinedCount: (n: number) => `${n} שחקנים נרשמו למשחק`,
  bannerPlayerLeft: 'שחקן יצא מהמשחק',
  bannerPlayerLeftNamed: (firstName: string) => `${firstName} יצא מהמשחק`,
  bannerPlayersLeftCount: (n: number) => `${n} שחקנים יצאו מהמשחק`,
  bannerGuestAdded: 'אורח נוסף למשחק',
  bannerEveningEnded: 'הערב הסתיים',
  bannerGameCancelled: 'המשחק בוטל',
  // Inline soft prompt at the top of MatchDetails for finished games
  // the user played in. Complements the post-game push so a player who
  // muted notifications still gets a clear nudge to rate teammates.
  rateBannerTitle: 'דרג את חבריך מהמשחק',
  rateBannerSub: 'תן דירוג מהיר לכל מי ששיחק איתך — חמש כוכבים, סוגר תוך דקה.',
  rateBannerCta: 'התחל לדרג',
  rateBannerDismiss: 'סגור',
  // Pending join-request approvals — used both for community and game.
  pendingApprove: 'אשר',
  pendingReject: 'דחה',
  pendingApprovalsBadge: (n: number) =>
    n === 1 ? 'בקשה ממתינה' : `${n} בקשות ממתינות`,
  matchDetailsPendingTitle: 'ממתינים לאישור',
  matchParticipantsPendingBadge: (n: number) => `ממתינים לאישור (${n}) — להצגה`,
  communityDetailsPendingTitle: 'ממתינים לאישור',
  // Per-game visibility — admin-only switch in MatchDetails. ON = the
  // game appears in the global "Open Games" feed; OFF = only members
  // of the parent community can see it.
  matchVisibilityToggle: 'הצג לכל האפליקציה',
  matchVisibilityHelper:
    'כשהאפשרות כבויה, רק חברי הקבוצה יראו את המשחק',
  matchVisibilityErrorPublic: 'לא הצלחנו לפרסם את המשחק',
  matchVisibilityErrorCommunity: 'לא הצלחנו להגביל את המשחק לקבוצה',
  // Blocked-state screen rendered when a non-member tries to open a
  // community-only game (deep link / invite / push / stale nav). Must
  // not leak any private game info — title, time, venue, players.
  communityOnlyGameTitle: 'משחק לחברי קבוצה בלבד',
  communityOnlyGameSubtitle: 'המשחק הזה פתוח רק לחברי הקבוצה',
  communityOnlyGameBack: 'חזור',
  matchDetailsDuration: 'משך',
  matchDetailsRoleAdmin: 'מנהל',
  matchDetailsAddGuest: 'הוסף אורח',
  matchDetailsNavigateWaze: 'נווט עם Waze',
  matchDetailsNoLocation: 'אין מיקום למשחק',
  matchDetailsCannotOpenNavigation: 'לא ניתן לפתוח ניווט',
  // ── Match details redesign ───────────────────────────────────────────
  matchHeroNoLocation: 'אין מיקום',
  matchHeroTitle: 'פרטי משחק',
  matchHeroCommunityPrefix: 'קבוצה',
  matchStatsPlayers: 'שחקנים',
  matchStatsDuration: 'משך משחק',
  matchStatsCommunity: 'קבוצה',
  matchStatsWeather: 'מזג אוויר',
  matchStatsMinutesShort: 'דק׳',
  matchParticipantsTitle: 'רשימת שחקנים',
  matchParticipantStatusComing: 'מגיע',
  matchParticipantStatusArrived: 'הגיע',
  matchParticipantRoleOrganizer: 'מנהל',
  matchDetailsCardTitle: 'פרטי המשחק',
  matchDetailsLabelField: 'מגרש',
  matchDetailsLabelCity: 'עיר',
  matchDetailsLabelAddress: 'כתובת',
  matchDetailsLabelLocation: 'מיקום',
  matchDetailsNavigateButton: 'נווט למגרש ב-Waze',
  matchDetailsLabelFieldType: 'סוג מגרש',
  matchDetailsLabelNotes: 'הערות',
  matchDetailsLabelOrganizer: 'יוצר המשחק',
  matchDetailsLabelCreatedAt: 'נוצר בתאריך',
  matchDetailsLabelMeetingTime: 'שעת התכנסות',
  matchDetailsLabelCommunity: 'קבוצה',
  matchDetailsLabelFormat: 'הרכב',
  matchHeroPlayers: (now: number, max: number) => `‎${now}/${max}‎ שחקנים`,
  matchPlayersTitle: 'שחקנים',
  matchPlayersSeeAll: 'לצפייה ברשימה המלאה',
  matchPlayersEmpty: 'אין עדיין שחקנים רשומים',
  matchPlayersOpenSlot: 'מקום פנוי',
  // Compact preview chips + names line.
  matchPlayersOpenChip: (n: number) => `+${n} פנויים`,
  matchPlayersMoreChip: (n: number) => `+${n} נוספים`,
  matchPlayersAndMore: (n: number) => `ועוד ${n}`,
  matchPlayersNobodyYet: 'אף אחד עוד לא נרשם — אתה הראשון!',
  // Status + CTA card titles
  matchStatusCardWaiting: 'מחכים לשחקנים',
  matchStatusCardWaitingHelper: (n: number) =>
    `חסרים עוד ${n} שחקנים כדי להתחיל`,
  matchStatusCardYouRegistered: 'אתה רשום למשחק',
  matchStatusCardReadyTeams: 'מוכנים להרכיב קבוצות',
  matchStatusCardTeamsReady: 'הקבוצות מוכנות — אפשר להתחיל',
  matchStatusCardTeamsInvalid: 'יש לעדכן את הקבוצות',
  matchStatusCardLive: 'המשחק בעיצומו',
  matchStatusCardFinished: 'המשחק נגמר',
  matchStatusCardCancelled: 'המשחק בוטל',
  matchPlayersScreenTitle: 'שחקני המשחק',
  matchPlayersSectionRegistered: 'שחקנים רשומים',
  matchPlayersSectionWaitlist: 'רשימת המתנה',
  matchPlayersSectionPending: 'ממתינים לאישור',
  matchPlayersSectionGuests: 'אורחים',
  matchPlayersAdminTag: 'מנהל',
  matchPlayersWaitlistTag: 'המתנה',
  matchPlayersPendingTag: 'ממתין',
  matchPlayersGuestTag: 'אורח',
  matchPlayersLateTag: 'באיחור',
  matchPlayersNoShowTag: 'לא הופיע',
  matchPlayersOfferPendingTag: 'ממתין לאישור',
  matchPlayersOfferAdvanceCta: 'העבר לבא בתור',
  matchPlayersOfferAdvanceConfirm: 'להעביר את ההצעה לשחקן הבא ברשימת ההמתנה?',
  matchPlayersOfferConfirmCta: 'אישור הגעה',
  matchPlayersOfferPassCta: 'ויתור',
  matchPlayersApproveCta: 'אשר',
  matchPlayersRejectCta: 'דחה',
  matchPlayersApproveDone: 'הבקשה אושרה',
  matchPlayersRejectTitle: 'דחיית בקשה',
  matchPlayersRejectBody: (name: string) => `לדחות את בקשת ההצטרפות של ${name}?`,
  matchPlayersOfferOfferedAgo: (mins: number) =>
    mins < 1 ? 'הוצע לפני רגע' : `הוצע לפני ${mins} דק׳`,
  matchPlayersSectionCancelled: 'ביטלו השתתפות',
  matchPlayersCancelledTag: 'ביטל',
  matchPlayersCancelledLateTag: 'ביטול מאוחר',
  matchPlayersCancelledAgo: (text: string) => `ביטל ${text}`,
  pairStatsTitle: (name: string) => `אתה ו${name}`,
  // Order matters — registration happens before attendance, so the
  // labels read more naturally in Hebrew when "נרשמתם" is the first
  // tile shown. The pair card uses this same order.
  pairStatsRegistered: 'נרשמתם יחד',
  pairStatsAttended: 'הגעתם יחד',
  pairStatsSameTeamGames: 'משחקים באותה קבוצה',
  pairStatsSameTeamRounds: 'משחקונים באותה קבוצה',
  pairStatsEmpty: 'עדיין לא שיחקתם יחד',
  communityStatsTitle: 'נתוני קבוצה',
  communityStatsTotalFinished: 'משחקים שיצאו לפועל',
  communityStatsThisMonth: 'משחקים החודש',
  communityStatsOrgRate: 'אחוז הצלחה בארגון',
  communityStatsAvgAttendance: 'ממוצע הגעות למשחק',
  communityStatsTopPlayers: 'המגיעים הקבועים',
  communityStatsActiveMonth: 'פעילים החודש',
  communityStatsActiveYear: 'פעילים השנה',
  communityStatsVitalityTitle: 'מד חיים של הקבוצה',
  pairStatsSharedCommunities: 'קבוצות משותפות',
  pairStatsSharedCommunitiesPlural: (n: number) =>
    n === 1 ? 'קבוצה אחת משותפת' : `${n} קבוצות משותפות`,
  pairStatsFirstShared: 'משחק ראשון יחד',
  pairStatsLastShared: 'משחק אחרון יחד',
  // Used when first === last (single shared game). The two-row
  // version would have duplicated the same date label so we collapse
  // to one neutral label.
  pairStatsOnlyShared: 'משחק משותף',
  pairStatsNoSharedHistory:
    'עדיין לא שיחקתם יחד — הזמן אותו למשחק כדי להתחיל היסטוריה',
  // Hamburger sections + items for match
  matchMenuSectionMatch: 'משחק',
  matchMenuSectionPlayers: 'שחקנים',
  matchMenuSectionDanger: 'מסוכן',
  matchMenuEdit: 'ערוך משחק',
  matchMenuPlayers: 'ניהול שחקנים',
  matchMenuShare: 'שתף משחק',
  // Explicit entry to the full players screen — players, waitlist,
  // pending approvals. Mirrors the inline "הצג הכל" link, but
  // surfaces it as a discoverable admin action in the menu.
  matchMenuManagePlayers: 'ניהול שחקנים והממתינים',
  // Visibility-toggle labels — describe the CURRENT state, not the
  // action. The toggle next to the label flips public ↔ community.
  matchMenuMakePublic: 'משחק פתוח לכולם',
  matchMenuMakeCommunity: 'משחק לקבוצה בלבד',
  matchMenuManage: 'ניהול משחק',
  matchMenuWatchLive: 'צפייה במשחק חי',
  matchManageScreenTitle: 'ניהול משחק',
  matchManageSectionAccess: 'גישה למשחק',
  matchManageSectionDanger: 'פעולות מסוכנות',
  matchManageVisibilityLocked: 'אפשר לעדכן רק כשהמשחק במצב פתוח להרשמה',
  matchManageAdminOnly: 'רק מנהל יכול לנהל את המשחק',
  // Manage section toggle title
  matchManageToggle: 'ניהול משחק',
  matchInviteAvailable: 'הזמן שחקנים פנויים',
  matchInviteAvailableHelper: 'שחקנים שזמינים ביום ובשעה של המשחק, באזור',
  // Compact status helpers — used by MatchStatusCard
  matchStatusWaitingTitle: 'מחכים לשחקנים',
  matchStatusWaitingHelper: (n: number) => `חסרים עוד ${n} שחקנים`,
  matchStatusReadyToCreate: 'אפשר להרכיב קבוצות',
  matchStatusTeamsInvalid: 'יש לעדכן את הקבוצות לפני התחלה',
  // Conflict CTA copy
  matchPrimaryConflict: 'יש לך משחק אחר בזמן הזה',
  // Compact status chip shown in the hero strip — three tiers based
  // on capacity ratio. "חסרים N" is the default green state; we
  // switch to yellow at 80% full and red when fully booked.
  matchStatusNearFull: 'כמעט מלא',
  matchStatusMissing: (n: number) =>
    n === 1 ? 'חסר שחקן אחד' : `חסרים ${n} שחקנים`,
  // Notes / rules row + bottom sheet
  matchNotesRowTitle: 'חוקים והערות',
  matchNotesSheetTitle: 'חוקים והערות',
  matchNotesEmpty: 'לא הוזנו הערות למשחק',
  // Cancel-registration as a subtle outlined link (not a destructive
  // primary). Same Hebrew copy as before.
  matchCancelRegistrationLink: 'בטל הרשמה',
  // History menu entry — navigates the user to their general match
  // history surface (no per-game history screen yet).
  matchMenuHistory: 'היסטוריית משחקים',
  matchMenuLeave: 'יציאה מהמשחק',
  // Registration conflict — surfaced in the modal that blocks a join
  // when the user is already registered to a game within ±4h of the
  // target. The helper variant is for the inline disabled-CTA hint.
  registrationConflictTitle: 'אתה כבר רשום למשחק בזמן חופף',
  // Variant shown when the conflicting game lives in a DIFFERENT
  // community than the target. Same body copy works for both — only
  // the title needs to clarify the cross-group case.
  registrationConflictTitleOtherGroup: 'אתה כבר רשום למשחק קרוב בקבוצה אחרת',
  registrationConflictMessage:
    'כדי להירשם למשחק הזה, בטל קודם את ההרשמה למשחק השני.',
  registrationConflictHelper: 'כבר נרשמת למשחק קרוב',
  registrationConflictViewGame: 'צפה במשחק',
  // Fallback group label used in the modal when we can't resolve
  // the conflicting game's group name from the local store
  // (typically because the user isn't a member of that community).
  registrationConflictUnknownGroup: 'קבוצה אחרת',
  // Time-difference helper. Shown inside the modal so the user can
  // see exactly how close the two games are. Hidden when either side
  // lacks a startsAt (e.g. an active game with no scheduled time).
  registrationConflictTimeDiffMinutes: (min: number) =>
    `המשחקים בהפרש של ${min} דקות`,
  registrationConflictTimeDiffHoursMinutes: (h: number, min: number) =>
    min === 0
      ? `המשחקים בהפרש של ${h === 1 ? 'שעה' : `${h} שעות`}`
      : `המשחקים בהפרש של ${h === 1 ? 'שעה' : `${h} שעות`} ו־${min} דקות`,
  // Direct-cancel action lets the user resolve the conflict without
  // navigating away. After success we re-run the pre-check; the
  // user still has to tap "הצטרף" again — we never auto-join.
  registrationConflictCancelOther: 'ביטול ההרשמה מהמשחק האחר',
  registrationConflictCancelSuccess: 'ההרשמה למשחק האחר בוטלה',
  registrationConflictCancelFailed: 'לא ניתן לבטל את ההרשמה כרגע',
  registrationConflictViewOther: 'צפה במשחק האחר',
  registrationConflictClose: 'סגור',
  sessionActionInviteCommunityOnly:
    'זמין רק למשחקים פתוחים לכלל האפליקציה',
  matchDetailsJoinAsPlayer: 'הצטרף כשחקן',
  // Refactored status card — single block replacing the old pill +
  // helper + teams placeholder trio.
  statusWaitingTitle: 'מחכים לשחקנים',
  statusWaitingSub: (n: number) =>
    n === 1 ? 'חסר עוד שחקן אחד כדי להתחיל' : `חסרים עוד ${n} שחקנים כדי להתחיל`,
  playersEmptyMissing: (n: number) =>
    n === 1 ? 'חסר עוד שחקן אחד' : `חסרים עוד ${n} שחקנים`,
  // Admin "manage game" section at the bottom.
  manageSectionTitle: 'ניהול משחק',
  deleteGameAction: 'מחיקת משחק',
  matchDetailsGoLive: 'עבור למצב לייב',

  // Notifications settings
  notificationsTitle: 'הגדרות התראות',
  notificationsIntro:
    'בחר אילו התראות לקבל. אפשר לכבות סוגים בודדים בכל רגע.',
  notifJoinRequest: 'בקשות הצטרפות (קבוצה ומשחק)',
  notifJoinRequestSub: 'כשמישהו מבקש להצטרף לקבוצה או למשחק שאתה מנהל',
  notifApprovedRejected: 'אישור / דחייה של הבקשות שלי',
  notifApprovedRejectedSub: 'כשבקשת ההצטרפות שלך מטופלת',
  notifNewGameInCommunity: 'משחק חדש בקבוצה',
  notifNewGameInCommunitySub: 'תוכל להפעיל את זה בכל קבוצה בנפרד',
  notifGameReminder: 'תזכורת לפני משחק',
  notifGameReminderSub: 'שעות לפני משחק שאתה רשום אליו',
  notifGameCanceledOrUpdated: 'ביטול / שינוי משחק',
  notifGameCanceledOrUpdatedSub: 'אם משחק שלך מבוטל או הוזז',
  notifSpotOpened: 'פתחו מקום במשחק שאני בספסל',
  notifSpotOpenedSub: 'כששחקן ביטל ואתה הראשון בספסל',
  notifGrowthMilestone: 'אבני דרך בקבוצה',
  notifGrowthMilestoneSub: '10/20/30/50 שחקנים — אופציונלי',
  notifInviteToGame: 'הזמנות אישיות למשחקים',
  notifInviteToGameSub: 'כששחקן אחר מזמין אותך למשחק',
  notifRateReminder: 'תזכורת לדרג חברים',
  notifRateReminderSub: 'אחרי משחק שסיימת — שעה אחרי הסיום',
  notifGameFillingUp: 'מקום אחרון במשחק קרוב',
  notifGameFillingUpSub: 'משחקים בקבוצה שלך שכמעט מלאים',
  notifGameRsvpNudge: 'תזכורת להירשם למשחק',
  notifGameRsvpNudgeSub: 'נשלחת 5 שעות לפני המשחק אם עדיין לא ענית',
  notifGamePlayersJoined: 'שחקן נרשם למשחק',
  notifGamePlayersJoinedSub:
    'מישהו נרשם למשחק שאני מארגן (כולל משחק קבוע ומשחק מהיר)',
  notifPlayerCancelled: 'שחקן ביטל השתתפות',
  notifPlayerCancelledSub: 'שחקן רשום הסיר את עצמו מהמשחק שאני מארגן',
  notifGameShortageWarning: 'מחסור בשחקנים',
  notifGameShortageWarningSub:
    'התראה למארגן כשמתקרבים לקיק־אוף ויש פחות שחקנים מהמינימום',
  notifGroupDeleted: 'קבוצה נסגרה',
  notifGroupDeletedSub: 'כשמנהל מוחק קבוצה שאני חבר בה',
  notifSave: 'שמור',
  notifSaved: 'נשמר',

  // Per-community subscription
  communityNotifyNewGames: 'הודיעו לי על משחקים חדשים בקבוצה',

  // Stats tab
  statsTitle: 'סטטיסטיקה',
  statsGames: 'משחקים',
  statsWins: 'ניצחונות',
  statsLosses: 'הפסדים',
  statsTies: 'תיקו',
  statsWinPct: 'אחוז ניצחונות',
  statsAttendance: 'אחוז הגעה',
  statsCancelRate: 'אחוז ביטולים',

  // History tab
  historyTitle: 'היסטוריית משחקים',
  historyEmpty: 'אין עדיין משחקים קודמים',
  historyMatches: (n: number) => `${n} משחקונים`,
  historyWin: 'ניצחון',
  historyLoss: 'הפסד',
} as const;
