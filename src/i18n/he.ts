// All Hebrew strings used in the app, centralized so future i18n is trivial.
// Keep keys in English (camelCase); values in Hebrew.

export const he = {
  // Common
  back: 'חזור',
  cancel: 'בטל',
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
  matchesCreateFab: 'יצירת משחק חדש',
  gameFiltersActive: (n: number) =>
    n === 1 ? 'פילטר אחד פעיל' : `${n} פילטרים פעילים`,
  communityFiltersTitle: 'סינון קבוצות',
  communityFiltersOnlyOpen: 'רק קבוצות עם הצטרפות פתוחה',
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
  toastGroupFull: 'הקהילה מלאה. לא ניתן לשלוח בקשה כרגע.',
  toastApproveFailed: 'אישור החבר נכשל. נסה שוב.',
  toastApproveGroupFull:
    'הקהילה כבר מלאה. לא ניתן לאשר חברים נוספים מעבר לקיבולת.',
  groupMaxBelowCurrentTitle: 'לא ניתן להוריד את הקיבולת',
  groupMaxBelowCurrentBody: (current: number) =>
    `יש כבר ${current} חברים פעילים בקהילה. כדי להקטין את הקיבולת, יש קודם להסיר חברים.`,
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
  jerseys: 'גופיות',
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
  sessionActionRecreateTeams: 'צור כוחות מחדש',
  sessionWaitingHelper: (min: number) =>
    `תצטרכו לפחות ${min} שחקנים כדי ליצור כוחות ולהתחיל`,
  sessionActionInvitePlayers: 'הזמן שחקנים',
  sessionActionShareLink: 'שיתוף קישור',
  sessionActionCreateTeams: 'צור כוחות',
  sessionActionStart: 'התחל ערב משחקים',
  sessionActionGoLive: 'עבור ללייב',
  sessionTeamsHeading: 'כוחות',
  sessionTeamsPlaceholder:
    'אין עדיין כוחות — יווצרו אוטומטית כשיהיו מספיק שחקנים',
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
  liveStateOrganizing: 'מתארגנים',
  liveStateLive: 'משחק חי',
  liveStateFinished: 'הסתיים',
  liveTeamA: 'קבוצה עליונה',
  liveTeamB: 'קבוצה תחתונה',
  liveBench: 'ספסל',
  liveGkSlot: 'שוער',
  liveCreateTeams: 'צור קבוצות',
  liveCreateRandom: 'אקראי',
  liveCreateBalanced: 'מאוזן (בקרוב)',
  liveStartMatch: 'התחל משחק',
  liveFinishMatch: 'סיים משחק',
  liveTimerStart: 'הפעל שעון',
  liveTimerPause: 'השהה',
  liveTimerResume: 'המשך',
  liveTimerReset: 'אפס',
  liveBackToDetails: 'חזור לפרטי משחק',
  liveCurrentMatchTitle: 'המשחק הנוכחי',
  liveCurrentMatchEmpty: 'אין שחקנים על המגרש כרגע',
  liveSwapHint: 'לחיצה על שחקן בוחרת אותו, לחיצה על שחקן בקבוצה השנייה תחליף ביניהם',
  liveTeamWinsLabel: (n: number) => (n === 1 ? 'ניצחון אחד' : `${n} ניצחונות`),
  liveQueueTitle: 'התור למשחק',
  liveTeamsOverview: 'צפייה בקבוצות',
  liveShuffleTeams: 'ערבב קבוצות',
  liveTeamLabel: (i: number) => `קבוצה ${i + 1}`,
  liveRoundLabel: (n: number) => `משחקון ${n}`,
  liveStartRound: 'הפעל משחקון',
  liveStartNextRound: 'התחל משחקון הבא',
  liveEndRound: 'סיים משחקון',
  liveEndRoundTitle: 'סיום משחקון',
  liveEndRoundQuestion: 'מי ניצח?',
  liveEndRoundConfirm: 'סיים וקבע סבב הבא',
  liveDrawLabel: 'תיקו',
  // Session state banners (top of Live screen)
  liveStatusScheduled: 'הערב עדיין לא התחיל',
  liveStatusReady: (n: number) => `משחקון ${n} מוכן להתחלה`,
  liveStatusActive: (n: number) => `משחקון ${n} פעיל`,
  liveStatusPaused: (n: number) => `משחקון ${n} מושהה`,
  liveStatusFinished: (n: number) => `משחקון ${n} הסתיים`,
  // Goal logging
  liveLogGoal: 'תעד גול',
  liveLogGoalTitle: 'מי הבקיע?',
  liveLogGoalOwn: 'גול עצמי',
  liveLogGoalOwnHint: 'בחירת שחקן תזכה את הקבוצה היריבה',
  liveGoalRecorded: 'גול נרשם',
  // Score correction (admin-only, hidden as a tertiary action)
  liveEditScore: 'עריכת תוצאה',
  liveEditScoreTitle: 'עריכת תוצאה ידנית',
  // Round-finished summary
  liveRoundFinishedWinner: (label: string) => `מנצחת: ${label}`,
  liveRoundFinishedDraw: 'הסבב הסתיים בתיקו',
  liveTeamScoreLabel: (i: number) => `קבוצה ${i + 1}`,
  liveTeamWaiting: 'ממתינה',
  liveAvgRating: 'דירוג ממוצע',
  liveAvgRatingNone: '— ',
  liveTeamsModalTitle: 'הקבוצות',
  liveTeamsModalClose: 'סגור',
  liveTeamRosterEmpty: 'אין שחקנים',
  liveSlotEmpty: 'פנוי',
  liveSwapMatchup: 'החלף מתחרים',
  liveOnFieldTeamA: 'מתחרה עליון',
  liveOnFieldTeamB: 'מתחרה תחתון',
  liveScoreboardTitle: 'תוצאה',
  liveScore: 'תוצאה',
  liveDragHint: 'גרור שחקן בין הקבוצות לשינוי',
  liveTeamFull: 'מלאה',
  liveEmptyGk: 'ריק',
  liveResetTeams: 'איפוס קבוצות',
  liveUndo: 'בטל פעולה',
  liveViewerOnly: 'רק מנהל המשחק יכול לבצע שינויים',
  liveManageGame: 'ניהול משחק',
  liveCancelGame: 'בטל משחק',
  liveFindAvailable: 'חפש שחקנים פנויים',
  availablePlayersTitle: 'שחקנים פנויים',
  availablePlayersEmpty: 'לא נמצאו שחקנים פנויים שמתאימים למשחק הזה',
  liveCancelConfirmTitle: 'לבטל את המשחק?',
  liveCancelConfirmBody:
    'כל השחקנים בסגל ובספסל יקבלו התראה. לא ניתן לבטל את הפעולה.',

  // Live match — legacy
  liveField: 'דשא חי',
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
  gameCardPlayersOf: (cur: number, max: number) => `${cur}/${max} שחקנים`,
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
  gameStatusWaitlist: 'בספסל',
  gameStatusPending: 'ממתין לאישור',
  gameFormat5: '5 × 5',
  gameFormat6: '6 × 6',
  gameFormat7: '7 × 7',

  // Create game form
  createGameTitle: 'יצירת משחק חדש',
  createGameRecurringTitle: 'יצירת משחק קבוע',
  createGameOverlapTitle: 'יש כבר משחק בקהילה באותו זמן',
  createGameOverlapUnknownTitle: 'משחק קיים',
  createGameOverlapBody: (title: string, when: string) =>
    `כבר קיים בקהילה משחק "${title}" ב-${when}. לא ניתן ליצור שני משחקים באותו חלון זמן.`,
  wizardRegOpensLabel: 'פתיחת הרשמה',
  wizardRegOpensHint:
    'במועד שתבחר המשחק יופיע בפיד וההרשמה תיפתח. עד אז הוא נסתר מכולם וחברי הקהילה יקבלו התראה כשהוא נפתח.',
  wizardRegOpensHintPast:
    'מועד שבחרת כבר עבר — חברי הקהילה יקבלו התראה והמשחק יופיע בפיד מיד עם השמירה.',
  wizardRegOpensRequired: 'יש לבחור מועד פתיחת הרשמה',
  wizardRegOpensMustBeBeforeKickoff:
    'מועד פתיחת ההרשמה חייב להיות לפני שעת המשחק',
  wizardRegOpensWarnTitle: 'לוודא שזה מה שרצית?',
  wizardRegOpensWarnPastBody:
    'מועד פתיחת ההרשמה שבחרת כבר עבר. ברגע השמירה תישלח התראה והמשחק יופיע בפיד.',
  wizardRegOpensWarnShortBody:
    'מועד פתיחת ההרשמה קרוב מאוד לתחילת המשחק (פחות מ-4 שעות). מומלץ לתת לחברי הקהילה זמן להירשם.',
  wizardRegOpensWarnContinue: 'המשך בכל זאת',
  wizardRegOpensWarnEdit: 'ערוך',
  createGameCommunity: 'קבוצה',
  createGameCommunityHint: 'בחר קבוצה שאתה משחק בה',
  createGameDateTime: 'תאריך ושעה',
  createGameField: 'שם המגרש',
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
  matchDetailsDeletedTitle: 'המשחק כבר לא קיים',
  matchDetailsDeletedBody:
    'המשחק נמחק או הוסר. אפשר לחזור לרשימת המשחקים ולמצוא משחק אחר.',
  communityDetailsDeletedTitle: 'הקהילה כבר לא קיימת',
  communityDetailsDeletedBody:
    'הקהילה נמחקה על ידי המנהל. אפשר לחזור לרשימת הקהילות ולחפש קהילה אחרת.',
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
  wizardVisibilityCommunity: 'רק לקהילה שלי',
  wizardVisibilityPublic: 'פתוח לכולם',
  wizardSectionAdvanced: 'הגדרות מתקדמות',
  wizardCancelDeadline: 'עד כמה שעות לפני אפשר לבטל הרשמה',
  wizardCancelDeadlineHint:
    'מעבר לזמן הזה, ביטול ייחשב כאי־הגעה. השאר ריק לחוסר הגבלה.',
  wizardSummaryTitle: 'תקציר המשחק',
  wizardSummaryDate: 'מתי',
  wizardSummaryWhere: 'איפה',
  wizardSummaryFormat: 'פורמט',
  wizardSummaryVisibility: 'נראות',
  createGameNoCommunities: 'לפני שתוכל ליצור משחק, צריך להצטרף לקבוצה',

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
  communitiesEmpty: 'אין תוצאות לחיפוש זה',
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
  createGroupContactPhone: 'טלפון איש קשר (חובה)',
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
  guestNameLabel: 'שם האורח',
  guestNamePlaceholder: 'שם פרטי או כינוי',
  guestRatingLabel: 'דירוג משוער (לא חובה)',
  guestRatingHint: 'משמש לחלוקה לקבוצות. אם לא תזין דירוג, נחשב כממוצע.',
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
  communityEditRecurringEnabled: 'הפעל משחק קבוע',
  communityEditRecurringHint: 'יוצר משחק חדש אוטומטית לפי הימים והשעה למעלה',
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
  communityInviteShareBody: (link: string) =>
    `הוזמנת להצטרף לקבוצה ב־Teamder ⚽\nהצטרף כאן:\n${link}`,
  communityMembersCount: (n: number) => `${n} שחקנים`,
  // Community details — redesign strings
  communityNextGameTitle: 'משחק קרוב',
  communityNextGameNone: 'לא נקבע משחק קרוב',
  communityNextGameCta: 'לצפייה בפרטי המשחק',
  communityNextGameLocked: 'ההרשמה תיפתח בקרוב',
  communityNextGameLockedBody: (when: string) =>
    `המשחק יופיע בפיד וההרשמה תיפתח ב-${when}.`,
  communityPlayersTitle: 'שחקנים',
  communityPlayersSeeAll: 'לצפייה בכל השחקנים',
  communityPlayersEmpty: 'אין עדיין שחקנים בקהילה',
  communityPlayersScreenTitle: 'שחקני הקהילה',
  communityPlayerGames: (n: number) =>
    n === 1 ? 'משחק אחד' : `${n} משחקים`,
  communityPlayerWins: (n: number) =>
    n === 1 ? 'ניצחון אחד' : `${n} ניצחונות`,
  communitySummaryPlayers: 'שחקנים',
  communitySummaryDays: 'ימי משחק',
  communitySummaryHour: 'שעת משחק',
  communitySummaryField: 'מגרש',
  communityNotifyRow: 'עדכן אותי על משחקים חדשים בקבוצה',
  // Community redesign — stadium-style premium UI
  communityHeroLabel: 'קהילה',
  communityHeroDetailsTitle: 'פרטי קהילה',
  communityStatsCreatedAt: 'תאריך הקמה',
  communityStatsMembers: 'חברים בקהילה',
  communityStatsField: 'מגרש קבוע',
  communityStatsMatchesHeld: 'מפגשים שנערכו',
  communityNotifyDesignTitle: 'עדכנו אותי על משחקים חדשים בקהילה',
  communityNextGameDetailsCta: 'לפרטי משחק',
  communityPlayersActiveTitle: 'שחקנים פעילים',
  // Hamburger menu sections for community
  communityMenuSectionCommunity: 'קהילה',
  communityMenuSectionPlayers: 'שחקנים',
  communityMenuSectionActions: 'פעולות',
  communityMenuApprovals: 'בקשות ממתינות לאישור',
  communityMenuRecurringGame: 'צור משחק חוזר',
  communityMenuContactAdmin: 'צור קשר עם המנהל',
  communityMenuShareInvite: 'שתף הזמנה לקהילה',

  // Settings
  settingsReportBug: 'דיווח על תקלה',
  settingsSuggestFeature: 'הצעת שיפור',
  settingsRateApp: 'דרג אותנו בחנות',
  settingsBugSubject: 'דיווח על תקלה באפליקציה',
  settingsSuggestSubject: 'הצעה לשיפור האפליקציה',
  settingsRateUnavailable: 'הדירוג עדיין לא זמין במצב פיתוח',
  settingsEmailUnavailable: 'אין אפליקציית מייל זמינה',

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
  onb1Title: 'מצא משחק כדורגל בקלות',
  onb1Body: 'הצטרף למשחקים קרובים או צור אחד משלך',
  onb2Title: 'צור משחק תוך שניות',
  onb2Body: 'בחר מגרש, קבע שעה והזמן שחקנים',
  onb3Title: 'נהל משחק בזמן אמת',
  onb3Body: 'קבע כוחות, עקוב אחרי התוצאה ושמור על סדר',
  // 4th = final CTA screen — see onbStart / onbCtaSignIn above
  // (kept onb4* as legacy strings in case any UI still references them)
  onb4Title: 'בוא נתחיל',
  onb4Body: 'התחבר ותתחיל לארגן משחקים',

  // Auth
  signInTitle: 'בואו נתחיל',
  signInSubtitle: 'התחבר כדי להירשם, להצטרף לקבוצה ולעקוב אחרי הסטטיסטיקות שלך.',
  signInGoogle: 'המשך עם Google',
  signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש',

  // Profile setup
  profileTitle: 'בוא נכיר',
  profileName: 'שם',
  profileNamePlaceholder: 'איך לקרוא לך?',
  profileSave: 'שמור והמשך',
  profileEdit: 'ערוך פרופיל',

  // Player card
  playerCardTotalGames: 'משחקים',
  playerCardAttendance: 'אחוז הגעה',
  playerCardCancelRate: 'אחוז ביטולים',
  // Successful-referral stat — counts users whose invitedBy points
  // at this profile. Helper text clarifies the source so the value
  // isn't confused with "joined my game" / "joined my community".
  playerCardReferrals: 'צירף לאפליקציה',
  playerCardReferralsHelper: 'משתמשים שנרשמו דרך קישור שלך',
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

  // Achievements (תארים)
  achievementsTitle: 'תארים אישיים',
  achievementsSeeAll: 'הצג הכל',
  achievementsEmpty: 'עוד לא נפתחו תארים. תתחיל לשחק!',
  achievementsLockedHint: 'נפתח אחרי שתעבור את היעד',
  achievementCategoryGames: 'משחקים',
  achievementCategoryTeams: 'קבוצות',
  achievementCategoryInvites: 'הזמנות',
  achievementCategoryCoaching: 'ניהול',
  achievementUnlockedAt: (d: string) => `נפתח ב-${d}`,

  // Jersey picker
  jerseyTitle: 'הגופייה שלי',
  jerseyIntro: 'איך הגופייה שלך תיראה במשחקים, בכרטיסי שחקן וברשימות.',
  jerseySectionColor: 'צבע',
  jerseySectionPattern: 'גזרה',
  jerseySectionNumber: 'מספר',
  jerseyNumberHint: 'מ-1 עד 99',
  jerseySectionDisplayName: 'כינוי על הגב',
  jerseyDisplayNameHint: 'עד 10 תווים. אפשר להשאיר ריק וייקח את השם הפרטי.',
  jerseyDisplayNamePlaceholder: 'הכינוי שלך',
  jerseyPreview: 'תצוגה מקדימה',
  jerseySave: 'שמור גופייה',
  jerseySaved: 'נשמר',
  jerseyOpenPicker: 'ערוך גופייה',
  jerseyPatternSolid: 'חלק',
  jerseyPatternStripes: 'פסים',
  jerseyPatternSplit: 'חצוי',
  jerseyPatternDots: 'נקודות',

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
  availabilityInvitable: 'זמין להזמנות לקבוצות אחרות',
  availabilityInvitableHint: 'כשמכובה — שום שחקן לא יוכל לראות אותך כמועמד הזמנה',
  availabilitySave: 'שמור זמינות',

  // Post sign-in onboarding — single profile-customisation step.
  // The welcome + "how it works" intermediate screens were removed
  // (the user already saw the value pitch in the pre-sign-in flow);
  // psoWelcomeBody is still used as the hero subtitle on the new
  // single-screen layout.
  psoWelcomeBody:
    'מארגנים כדורגל שכונתי בלי בלגן — הרשמה, ספסל, קבוצות, שוערים וטיימר.',
  psoProfileTitle: 'בוא נכיר',
  psoProfileSave: 'המשך',
  psoProfileNickname: 'כינוי על החולצה (אופציונלי)',
  psoProfileNicknamePlaceholder: 'עד 10 תווים',
  psoProfileNumber: 'מספר',
  psoProfileColor: 'צבע',
  psoProfilePattern: 'דוגמה',

  // Empty state — first-time main screen
  emptyHomeTitle: 'אין לך עדיין משחקים',
  emptyHomeBody: 'צור משחק חדש או הצטרף למשחק קיים',
  emptyHomePrimary: 'צור משחק',
  emptyHomeSecondary: 'מצא משחקים',
  // Shown instead of "מצא משחקים" when there's nothing to find — both
  // tabs are empty, so the button would dead-end. Encourages the user
  // to be the one who starts a game in their community.
  emptyHomeNoGamesAnywhere: 'אין משחקים פתוחים כרגע — היה הראשון לפתוח משחק לקהילה שלך',

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
  tabProfile: 'פרופיל',
  tabStats: 'סטטיסטיקה',
  tabHistory: 'היסטוריה',

  // Profile tab
  profileMyGroup: 'הקבוצה שלי',
  profileMyGroups: 'הקבוצות שלי',
  profileInviteCode: 'קוד הזמנה',
  profileSignOut: 'התנתק',
  profileDeleteAccount: 'מחיקת חשבון',
  profileDeleteAccountTitle: 'למחוק את החשבון?',
  profileDeleteAccountMessage:
    'הפעולה תמחק לצמיתות את הפרופיל שלך, ההיסטוריה וההגדרות. לא ניתן לשחזר.',
  profileDeleteAccountConfirm: 'מחק לצמיתות',
  profileDeleteAccountCancel: 'ביטול',
  profileDeleteAccountSuccess: 'החשבון נמחק',
  profileDeleteAccountFailed: 'מחיקת החשבון נכשלה. נסה שוב.',
  profileChangePhoto: 'שנה תמונה',
  profileChangeAvatar: 'הקש לשינוי התמונה',
  profilePickAvatar: 'בחר תמונת פרופיל',
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
  profileMenuSectionProfile: 'פרופיל',
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
  matchCardPlayersOf: (n: number, max: number) => `${n}/${max} שחקנים`,
  matchStatusOpen: 'פתוח',
  matchStatusFull: 'מלא',
  matchStatusJoined: 'נרשמת',
  matchStatusWaitlist: 'בהמתנה',
  matchStatusPending: 'ממתין לאישור',

  // Matches tab header / segmented tabs
  matchesTabMine: 'שלי',
  matchesTabOpen: 'פתוחים',
  // Matches screen redesign — hero / sections / empty card
  matchesHeroSubtitle: 'הצטרף למשחקים או צור משחק חדש',
  matchesSectionOpen: 'משחקים פתוחים',
  matchesSectionMine: 'המשחקים שלי',
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
  matchDetailsAlreadyStarted: 'המשחק כבר התחיל',
  matchDetailsAlreadyLive: 'המשחק כבר במצב לייב',
  matchDetailsAlreadyFinished: 'המשחק הסתיים',
  matchDetailsAlreadyCancelled: 'המשחק בוטל',
  matchDetailsTerminalSub: 'לא ניתן לבצע פעולות על המשחק הזה',
  matchDetailsNotFound: 'המשחק לא קיים יותר',
  // Stage 2 lifecycle CTAs / banners
  lifecycleCtaJoin: 'הירשם למשחק',
  lifecycleCtaCancelRegistration: 'בטל הרשמה',
  lifecycleCtaStartEvening: 'התחל ערב',
  lifecycleCtaGoLive: 'עבור ללייב',
  lifecycleCtaStartRound: 'התחל משחקון',
  lifecycleCtaRecordGoal: 'תעד גול',
  lifecycleCtaEndRound: 'סיים משחקון',
  lifecycleCtaEndEvening: 'סיים ערב',
  lifecycleCannotJoin: 'אין אפשרות להצטרף למשחק הזה',
  liveMatchNotActiveYet: 'המשחק עדיין לא פעיל',
  // Top in-app banners (event signals, distinct from system toasts).
  // These fire from the realtime game-doc listener, so they describe
  // events that may be triggered by other users on other devices.
  bannerPlayerJoined: 'שחקן הצטרף למשחק',
  bannerPlayerLeft: 'שחקן יצא מהמשחק',
  bannerGuestAdded: 'אורח נוסף למשחק',
  bannerTeamsReady: 'הכוחות מוכנים',
  bannerGoalRecorded: 'גול נרשם',
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
  communityDetailsPendingTitle: 'ממתינים לאישור',
  // Per-game visibility — admin-only switch in MatchDetails. ON = the
  // game appears in the global "Open Games" feed; OFF = only members
  // of the parent community can see it.
  matchVisibilityToggle: 'הצג לכל האפליקציה',
  matchVisibilityHelper:
    'כשהאפשרות כבויה, רק חברי הקהילה יראו את המשחק',
  matchVisibilityErrorPublic: 'לא הצלחנו לפרסם את המשחק',
  matchVisibilityErrorCommunity: 'לא הצלחנו להגביל את המשחק לקהילה',
  // Blocked-state screen rendered when a non-member tries to open a
  // community-only game (deep link / invite / push / stale nav). Must
  // not leak any private game info — title, time, venue, players.
  communityOnlyGameTitle: 'משחק לחברי קהילה בלבד',
  communityOnlyGameSubtitle: 'המשחק הזה פתוח רק לחברי הקהילה',
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
  matchHeroCommunityPrefix: 'קהילה',
  matchStatsPlayers: 'שחקנים',
  matchStatsDuration: 'משך משחק',
  matchStatsCommunity: 'קהילה',
  matchStatsWeather: 'מזג אוויר',
  matchStatsMinutesShort: 'דק׳',
  matchParticipantsTitle: 'רשימת משתתפים',
  matchParticipantStatusComing: 'מגיע',
  matchParticipantStatusArrived: 'הגיע',
  matchParticipantRoleOrganizer: 'ארגון',
  matchDetailsCardTitle: 'פרטי המשחק',
  matchDetailsLabelField: 'מגרש',
  matchDetailsLabelAddress: 'כתובת',
  matchDetailsLabelFieldType: 'סוג מגרש',
  matchDetailsLabelNotes: 'הערות',
  matchDetailsLabelOrganizer: 'יוצר המשחק',
  matchDetailsLabelCreatedAt: 'נוצר בתאריך',
  matchDetailsLabelMeetingTime: 'שעה התכנסות',
  matchDetailsLabelCommunity: 'קהילה',
  matchDetailsLabelFormat: 'הרכב',
  matchHeroPlayers: (now: number, max: number) => `${now}/${max} שחקנים`,
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
  // Hamburger sections + items for match
  matchMenuSectionMatch: 'משחק',
  matchMenuSectionPlayers: 'שחקנים',
  matchMenuSectionDanger: 'מסוכן',
  matchMenuEdit: 'ערוך משחק',
  matchMenuPlayers: 'ניהול שחקנים',
  matchMenuShare: 'שתף משחק',
  // Visibility-toggle labels — flip dynamically with current state.
  matchMenuMakePublic: 'הפוך למשחק פתוח',
  matchMenuMakeCommunity: 'הפוך למשחק לקהילה בלבד',
  matchMenuManage: 'ניהול משחק',
  matchManageScreenTitle: 'ניהול משחק',
  matchManageSectionAccess: 'גישה למשחק',
  matchManageSectionDanger: 'פעולות מסוכנות',
  matchManageVisibilityLocked: 'אפשר לעדכן רק כשהמשחק במצב פתוח להרשמה',
  matchManageAdminOnly: 'רק מנהל יכול לנהל את המשחק',
  // Manage section toggle title
  matchManageToggle: 'ניהול משחק',
  // Compact status helpers — used by MatchStatusCard
  matchStatusWaitingTitle: 'מחכים לשחקנים',
  matchStatusWaitingHelper: (n: number) => `חסרים עוד ${n} שחקנים`,
  matchStatusReadyToCreate: 'אפשר להרכיב קבוצות',
  matchStatusTeamsReady: 'הקבוצות מוכנות — אפשר להתחיל',
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
  statusReadyTitle: 'מוכנים להתחלה',
  statusReadySub: 'אפשר ליצור כוחות ולהתחיל',
  statusTeamsInvalidTitle: 'הכוחות לא מסונכרנים',
  statusTeamsInvalidSub: 'צריך לבנות מחדש לפני שמתחילים',
  // Empty-state inside the players card.
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
  notifJoinRequest: 'בקשות הצטרפות לקבוצה',
  notifJoinRequestSub: 'כשמישהו מבקש להצטרף לקבוצה שאתה מנהל',
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
  notifPlayerCancelled: 'שחקן ביטל השתתפות',
  notifPlayerCancelledSub: 'שחקן רשום הסיר את עצמו מהמשחק שאני מארגן',
  notifGroupDeleted: 'קהילה נסגרה',
  notifGroupDeletedSub: 'כשמנהל מוחק קהילה שאני חבר בה',
  notifSave: 'שמור',
  notifSaved: 'נשמר',

  // Per-community subscription
  communityNotifyNewGames: 'הודיעו לי על משחקים חדשים בקבוצה',

  // Stats tab
  statsGames: 'משחקים',
  statsWins: 'ניצחונות',
  statsLosses: 'הפסדים',
  statsTies: 'תיקו',
  statsWinPct: 'אחוז ניצחונות',
  statsAttendance: 'אחוז הגעה',
  statsCancelRate: 'אחוז ביטולים',

  // History tab
  historyTitle: 'משחקים קודמים',
  historyEmpty: 'אין עדיין משחקים קודמים',
  historyMatches: (n: number) => `${n} משחקונים`,
  historyWin: 'ניצחון',
  historyLoss: 'הפסד',
} as const;
