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
    'כשחסרים שחקנים, האפליקציה מציעה את המחזור לשחקנים מתאימים מחוץ למועדון שלך, באזור שלך. שים לב: בזמן החוסר המחזור נחשף לאותם שחקנים מהאזור — הם יוכלו לראות את פרטיו ולהגיש מועמדות. אתה תמיד מאשר ידנית מי מצטרף — אף אחד לא נכנס בלי אישורך. ככה ממלאים שבוע חוסר בלי לרדוף אחרי אנשים.',
  tipTrustTitle: 'מד אמינות',
  tipTrustText:
    'ציון שמשקף עד כמה אפשר לסמוך עליך שתגיע — נבנה מנוכחות במחזורים וביטולים בזמן. ככל שתגיע יותר ותבטל פחות, הציון עולה, ומארגנים נוטים יותר לאשר אותך למחזורים.',
  tipRatingTitle: 'דירוג שחקנים',
  tipRatingText:
    'שחקנים מדרגים זה את זה 1–5 כוכבים. הדירוג כללי (לא פר־מועדון), אנונימי, ומסייע למארגנים להרכיב קבוצות מאוזנות. רואים רק את הממוצע ואת מספר המדרגים, לא מי נתן מה.',
  // Map
  mapGamesTitle: 'מפת המחזורים',
  mapCommunitiesTitle: 'מפת המועדונים',
  mapEmpty: 'אין מה להציג על המפה כרגע',
  mapOpenDetails: 'לפרטים',
  mapClusterGamesTitle: 'מחזורים באזור הזה',
  mapClusterCommunitiesTitle: 'מועדונים באזור הזה',
  mapButtonLabel: 'תצוגת מפה',
  mapLoadError: 'לא הצלחנו לטעון את המפה. נסה שוב.',
  mapSubtitle: 'מצא מחזורים ומועדונים בכל מקום',
  mapSearchGames: 'חיפוש לפי עיר או מגרש',
  mapSearchCommunities: 'חיפוש לפי עיר או שם מועדון',
  mapChipAllGames: 'כל המחזורים',
  mapChipToday: 'היום',
  mapChipTomorrow: 'מחר',
  mapChipCustom: 'מותאם',
  mapChipWeekend: 'סוף שבוע',
  mapChipAllCommunities: 'כל המועדונים',
  mapLegendMember: 'חבר במועדון',
  mapLegendNonMember: 'לא חבר',
  mapLegendToday: 'היום',
  mapLegendTomorrow: 'מחר',
  mapLegendWeekend: 'סוף שבוע',
  mapLegendOther: 'אחר',
  mapShowCommunities: 'הצג מועדונים',
  mapShowGames: 'הצג מחזורים',
  mapLocateMe: 'התמקד במיקום שלי',
  yes: 'כן',
  no: 'לא',

  // Filters (games + communities)
  gameFiltersTitle: 'סינון מחזורים',
  gameFiltersAny: 'הכל',
  gameFiltersApply: 'החל',
  gameFiltersReset: 'איפוס',
  gameFiltersVisibility: 'נראות',
  gameFiltersOnlyAvailable: 'רק מחזורים עם מקומות פנויים',
  gameFiltersButton: 'סינון',
  // New time-window filter — surfaced at the top of the sheet so the
  // most common "what's happening soon" question is one tap away.
  gameFiltersWhen: 'מתי',
  gameFiltersWhenAny: 'הכל',
  gameFiltersWhenToday: 'היום',
  gameFiltersWhenThisWeek: 'השבוע',
  gameFiltersWhenWeekend: 'בסופ״ש',
  gameFiltersWhenTomorrow: 'מחר',
  gameFiltersWhenPickDay: 'בחר יום',
  // Redesigned "סינון מחזורים" sheet (2026-06).
  gameFiltersNearbyTitle: 'קרוב אליי',
  gameFiltersNearbyNeedPermission: 'נדרש אישור מיקום',
  gameFiltersNearbyPermissionHint: 'כדי להציג מחזורים בקרבתך',
  gameFiltersNearbyAllow: 'אפשר גישה למיקום',
  // Shown when location permission is ALREADY granted — no need to ask
  // again, just an enable control.
  gameFiltersNearbyEnableTitle: 'מחזורים בקרבת מקום',
  gameFiltersNearbyEnableHint: 'סנן לפי המרחק ממך',
  gameFiltersNearbyEnable: 'הצג מחזורים קרובים',
  gameFiltersNearbyActive: 'מציג מחזורים בקרבתך',
  gameFiltersNearbyOff: 'כבה',
  gameFiltersKm: (km: number) => `${km} ק"מ`,
  gameFiltersQuickTitle: 'סינונים מהירים',
  gameFiltersOpenToAll: 'פתוח לכולם',
  gameFiltersHasSpots: 'יש מקומות פנויים',
  gameFiltersShowN: (n: number) => `הצג ${n} מחזורים`,
  gameFiltersFormatTitle: 'פורמט מחזור',
  gameFiltersMyHome: 'הבית שלי',
  // Cost — most games are free; surfacing this avoids the surprise.
  gameFiltersCost: 'תשלום',
  gameFiltersCostFree: 'חינם',
  gameFiltersCostPaid: 'בתשלום',
  // Group the rare rule flags under one collapsible header so the
  // primary filters above stay scannable.
  gameFiltersAdvanced: 'מסננים מתקדמים',
  matchesCreateFab: 'יצירת מחזור חדש',
  gameFiltersActive: (n: number) =>
    n === 1 ? 'פילטר אחד פעיל' : `${n} פילטרים פעילים`,
  communityFiltersTitle: 'סינון מועדונים',
  communityFiltersOnlyOpen: 'רק מועדונים עם הצטרפות פתוחה',
  communityFiltersHasRoom: 'רק מועדונים עם מקום לחברים חדשים',
  communityFiltersFreeOnly: 'רק מועדונים חינמיים',
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
  deleteGameTitle: 'מחיקת המחזור',
  deleteGameBody: 'המחזור יוסר לצמיתות מהמועדון ומהיסטוריית השחקנים. רישומים, רשימת המתנה והקבוצות שנבנו ימחקו.',
  deleteGameSuccess: 'המחזור נמחק',
  // Recurring (מחזור שבועי) game — delete needs a choice so cancelling one
  // week doesn't kill the whole series.
  deleteRecurringTitle: 'משחק מחזור שבועי',
  deleteRecurringBody:
    'זהו משחק מחזור שבועי. אפשר למחוק רק את המשחק השבוע — והמחזור ימשיך בשבוע הבא — או להפסיק את כל המחזור.',
  deleteRecurringThisWeek: 'מחק רק את השבוע הזה',
  deleteRecurringStop: 'הפסק את כל המחזור',
  skipRecurringWeekSuccess: 'המשחק השבוע נמחק — המחזור ממשיך בשבוע הבא',
  editRecurringTitle: 'משחק מחזור שבועי',
  editRecurringBody:
    'זהו משחק מחזור שבועי. אפשר לערוך רק את המשחק השבוע — והמחזור ימשיך בשבוע הבא ללא שינוי — או לערוך את כל המחזור (גם השבועות הבאים).',
  editRecurringThisWeek: 'ערוך רק את השבוע הזה',
  editRecurringSeries: 'ערוך את כל המחזור',
  deleteGroupTitle: 'מחיקת המועדון',
  deleteGroupBody: 'המועדון ומידע השייך אליו יימחקו לצמיתות. כל החברים יתנתקו ולא ניתן יהיה לשחזר.',
  deleteGroupSuccess: 'המועדון נמחק',
  done: 'בוצע',
  loading: 'טוען...',
  error: 'שגיאה',
  profileSaveError: 'לא הצלחנו לשמור את הפרטים. בדוק את החיבור ונסה שוב.',
  liveMatchNotFound: 'המחזור לא נמצא או הוסר.',

  // Global error boundary — fallback UI when a React tree crashes.
  errorBoundaryTitle: 'משהו השתבש',
  errorBoundaryBody:
    'נתקלנו בתקלה לא צפויה. אנחנו מצטערים על אי הנוחות. נסה שוב, או הפעל מחדש את האפליקציה.',
  errorBoundaryReload: 'נסה שוב',
  errorBoundaryReportHint: 'אם זה ממשיך להופיע, עדכן אותנו דרך "דווח על באג" בכרטיס השחקן.',

  // Community ratings
  ratingTitle: 'דרג את {name}',
  ratingNoSelf: 'אי אפשר לדרג את עצמך',
  ratingNone: 'עדיין אין דירוגים',
  ratingDragHint: 'גררו על הסרגל כדי לדרג (0.0–5.0)',
  // Team colour picker (DraftBoard) — names the team by colour in plural.
  teamColorTitle: 'בחרו צבע לקבוצה',
  teamColorClear: 'ללא צבע (ברירת מחדל)',
  ratingInThisGroup: 'דירוג כללי',
  ratingGlobalTitle: 'דירוג כללי',
  ratingSaved: 'הדירוג נשמר',
  ratingCleared: 'הדירוג הוסר',
  ratingButtonRate: 'דרג שחקן',
  ratingButtonReRate: 'עדכן דירוג',
  ratingCount: (n: number) =>
    n === 1 ? 'דירוג אחד' : `${n} דירוגים`,
  ratingCountBased: (n: number) =>
    n === 1 ? 'מבוסס על דירוג אחד' : `מבוסס על ${n} דירוגים`,
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
  toastJoinedGroup: 'ברוך הבא למועדון',
  toastJoinSuccess: 'הצטרפת למועדון',
  toastGameJoined: 'הצטרפת למחזור',
  lastSpotTaken: 'תפסת את המקום האחרון',
  promotedToRoster: 'נכנסת להרכב! ⚽',
  toastGameJoinedWaitlist: 'נוספת לרשימת המתנה',
  toastGameJoinedPending: 'בקשת ההצטרפות נשלחה',
  toastGameLeft: 'יצאת מהמחזור',
  toastRequestFailed: 'שליחת הבקשה נכשלה. נסה שוב.',
  toastMemberApproved: 'השחקן אושר',
  toastMemberRejected: 'הבקשה נדחתה',
  toastSaved: 'נשמר',
  toastGroupFull: 'המועדון מלא. לא ניתן לשלוח בקשה כרגע.',
  toastJoinRejected: 'בקשתך למועדון זה נדחתה ולא ניתן לשלוח שוב.',
  toastApproveFailed: 'אישור החבר נכשל. נסה שוב.',
  toastApproveGroupFull:
    'המועדון כבר מלא. לא ניתן לאשר חברים נוספים מעבר לקיבולת.',
  groupMaxBelowCurrentTitle: 'לא ניתן להוריד את הקיבולת',
  groupMaxBelowCurrentBody: (current: number) =>
    `יש כבר ${current} חברים פעילים במועדון. כדי להקטין את הקיבולת, יש קודם להסיר חברים.`,
  cancelPastDeadline: (hours: number) =>
    `מועד הביטול חלף — ניתן להתבטל רק עד ${hours} שעות לפני המחזור.`,
  lateCancelTitle: 'ביטול קרוב מאוד למחזור',
  lateCancelBody: (hours: number) =>
    `נשארו פחות מ-${hours} שעות עד תחילת המחזור. ביטול בשלב הזה ייספר כביטול מאוחר וישפיע על דירוג המשמעת שלך. בטוח שאתה רוצה לבטל?`,
  lateCancelConfirm: 'אישור ביטול',

  // Date/time field strings
  dtfPickTime: 'בחר שעה',
  dtfPickDate: 'בחר תאריך',
  dtfTime: 'שעה',
  dtfConfirm: 'אישור',
  dtfClear: 'נקה',

  // Game registration screen
  eveningList: 'רשימת מחזור',
  eveningDetails: 'פרטי מחזור',
  registered: 'בהרכב',
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
  weatherForecastFor: 'תחזית למועד המחזור',
  // Session state pills (Match Details)
  sessionStatusWaitingPlayers: (cur: number, max: number) =>
    `⏳ מחכים לשחקנים (${cur}/${max})`,
  sessionStatusEnoughPlayers: 'יש מספיק שחקנים 🎉',
  sessionStatusTeamsReady: 'כוחות מוכנים',
  sessionStatusActive: 'מחזור פעיל',
  sessionStatusTeamsInvalid: 'צריך ליצור כוחות מחדש',
  sessionInvalidHelper: 'הכוחות מתייחסים לשחקנים שכבר לא רשומים. צרו אותם מחדש.',
  sessionWaitingHelper: (min: number) =>
    `תצטרכו לפחות ${min} שחקנים כדי ליצור כוחות ולהתחיל`,
  sessionActionInvitePlayers: 'הזמן שחקנים',
  sessionActionShareLink: 'שיתוף קישור',
  sessionActionStart: 'התחל מחזור',
  sessionActionGoLive: 'עבור ללייב',
  sessionInviteShareBody: (link: string) =>
    `הוזמנת למחזור ב־Teamder ⚽\nהצטרף כאן:\n${link}`,
  sessionShareWhatsapp: 'שתף בוואטסאפ',
  // Rich, scannable WhatsApp recruitment message: what / when / where /
  // how many still missing, then the join link. Lines are only added when
  // their data exists so the message never shows an empty field.
  sessionShareWhatsappBody: (args: {
    title: string;
    when: string;
    field?: string;
    missing?: number;
    link: string;
  }) => {
    const lines: string[] = [`⚽ ${args.title} — מחפשים שחקנים!`, '', `🗓️ ${args.when}`];
    if (args.field && args.field.trim()) lines.push(`📍 ${args.field.trim()}`);
    if (typeof args.missing === 'number' && args.missing > 0) {
      lines.push(`👥 חסרים עוד ${args.missing} שחקנים`);
    }
    lines.push('', 'הצטרפו כאן 👇', args.link);
    return lines.join('\n');
  },
  numWaiting: 'ספסל',
  numRegistered: 'בהרכב',

  // Team setup
  teamOrder: 'סדר קבוצות',
  team1: 'קבוצה 1',
  team2: 'קבוצה 2',
  team3: 'קבוצה 3',
  teamWaitingLabel: '(ממתינה)',
  shuffleTeams: 'ערבב קבוצות',
  startEvening: 'התחל מחזור',
  goalkeeperOrder: 'סדר שוערים',

  // Goalkeeper screen
  goalkeeperOrderTeam: (n: number) => `סדר שוערים - קבוצה ${n}`,
  current: 'נוכחי',
  next: 'הבא',
  dragToReorder: 'גרור לשינוי סדר',

  // Live match — v2 portrait layout
  liveStartMatch: 'התחל מחזור',
  liveResumeMatch: 'המשך מחזור',
  liveTimerOfTotal: (total: number) => `מתוך ${total} דקות`,
  /** Label above the "+MM:SS" added-time counter shown once the configured
   *  duration is exceeded (the main clock freezes at the duration). */
  liveTimerOvertime: 'תוספת זמן',
  liveTimerPause: 'השהה',
  liveTimerResume: 'המשך',
  liveTimerStart: 'התחל',
  liveTimerReset: 'אפס',
  liveTimerResetConfirmTitle: 'לאפס את המחזור ולהתחיל מחדש?',
  liveTimerResetConfirmBody:
    'כל הגולים יימחקו, הטיימר יתאפס, והמחזור יתחיל מהתחלה. אי אפשר לבטל.',
  // Stoppages log — synced history of every start / pause / resume so
  // players can settle "the clock kept running!" arguments.
  liveStoppagesTitle: 'יומן עצירות',
  liveStoppagesSummary: (count: number, total: string) =>
    count === 0 ? 'יומן זמנים' : `${count} עצירות · עצור ${total}`,
  liveStoppagesTotal: (total: string) => `סה״כ זמן עצור: ${total}`,
  liveStoppagesCount: (n: number) => `${n} עצירות`,
  liveStoppagesEmpty: 'עוד לא היו עצירות',
  liveStoppageStarted: 'המחזור התחיל',
  liveStoppagePaused: 'הופסק',
  liveStoppageResumed: 'חודש',
  liveStoppageRanFor: (dur: string) => `שוחק ${dur}`,
  liveStoppageStoppedFor: (dur: string) => `היה עצור ${dur}`,
  liveStoppageStoppedNow: (dur: string) => `עצור כעת · ${dur}`,
  // Live "winner stays" rotation
  rotationTeamWord: 'קבוצה',
  rotationTitle: 'רוטציה חיה',
  rotationStartHint: 'מנצחת נשארת, מפסידה יוצאת, הממתינה נכנסת. קבוצה חסרה מושלמת אוטומטית.',
  rotationStartCta: 'התחל רוטציה',
  rotationNotEnough: 'אין מספיק שחקנים לשתי קבוצות מלאות',
  rotationPlayingNow: 'מחזורים עכשיו',
  rotationWonCta: 'ניצחה',
  rotationReset: 'אפס',
  rotationResetMenu: 'אפס רוטציה',
  rotationResetConfirm: 'לאפס את הרוטציה? הקבוצות יחזרו למצב ההתחלתי.',
  rotationWaiting: 'ממתינות',
  // Scoreboard redesign
  // Per-team WIN TALLY over the evening (cumulative, not a literal streak — both
  // teams can have wins, so "ברצף" would be wrong here).
  rotationStreak: (n: number) => (n === 1 ? 'ניצחון אחד' : `${n} ניצחונות`),
  rotationWinsLabel: 'ניצחונות',
  rotationActiveBadge: 'מחזור פעיל עכשיו',
  rotationPlayingTeams: 'קבוצות במחזור',
  rotationWaitingTeams: 'קבוצות ממתינות',
  rotationNextUp: 'הבאה בתור',
  rotationAfter: 'אחריה',
  rotationPlayersCount: (n: number) => `${n} שחקנים`,
  rotationWinsShort: (n: number) => `${n} נצחונות`,
  rotationFillerStar: (teamName: string) => `שחקן משלים מ${teamName}`,
  rotationFillerStarMulti: (teamNames: string) => `שחקנים משלימים מ${teamNames}`,
  /** Names the specific filler player + their home team. */
  rotationFillerNamed: (playerName: string, teamName: string) =>
    `${playerName} משלים מ${teamName}`,
  rotationStoppagesInline: (count: number, time: string) =>
    `${count} עצירות · ${time}`,
  rotationStartRound: 'התחל משחק',
  rotationEndRound: 'סיים משחק',
  rotationEndRoundConfirmTitle: (winner: string) => `${winner} ניצחה! 🏆`,
  rotationEndRoundConfirmBody: (next: string) =>
    `הבאה שעולה למגרש: ${next}. לסיים את המשחק?`,
  rotationEndRoundConfirmBodyNoNext: 'לסיים את המשחק?',
  rotationEndRoundConfirmOk: 'סיים משחק',
  fillPickerTitle: (team: string) => `השלמת שחקנים ל${team}`,
  fillPickerSelectCount: (chosen: number, required: number) =>
    `בחר ${required} שחקנים להשלמה — נבחרו ${chosen}/${required}`,
  fillPickerConfirm: 'אישור',
  fillPickerEmptyPool: 'אין שחקנים זמינים להשלמה — סגרו וסדרו את הקבוצות ידנית',
  rotationPreviewLabel: 'מי נגד מי · הקבוצות יושלמו בלחיצת ״התחל משחק״',
  rotationStartingTeams: 'קבוצות פותחות (אקראי)',
  rotationShuffle: 'ערבב',
  rotationTapToSwap: 'הקש על קבוצה ממתינה כדי להחליף אותה בפותחת',
  rotationPickStartingTeams: 'בחרו 2 קבוצות פותחות',
  rotationPickStartingHint: 'אלו 2 הקבוצות שיפתחו · השאר ממתינות בתור',
  rotationPickStartingNeedTwo: 'סמנו בדיוק 2 קבוצות כדי להתחיל',
  rotationFillNoDonor: 'אין שחקן פנוי להשלמה — הקבוצה תשחק בחוסר',
  // ── End-of-evening equipment handoff (who took the ball / jerseys) ──
  equipmentHandoffTitle: 'מי לקח הביתה?',
  equipmentHandoffHint: 'סמנו מי לקח את הכדור ואת הגופיות (אפשר כמה). יופיע על חברי המועדון עד הפעם הבאה.',
  equipmentBall: 'כדור',
  equipmentJerseys: 'גופיות',
  equipmentSkip: 'דלג',
  equipmentSave: 'שמור',
  equipmentGuestsNote: 'אפשר לבחור רק חברי מועדון',
  equipmentHolderBallA11y: 'מחזיק/ה את הכדור',
  equipmentHolderJerseysA11y: 'מחזיק/ה את הגופיות',
  equipmentHeldByBall: (names: string) => `⚽ הכדור אצל ${names}`,
  equipmentHeldByJerseys: (names: string) => `👕 הגופיות אצל ${names}`,
  // ── Player tap menu + "went home" section ──
  playerMenuCard: 'כרטיס שחקן',
  playerMenuSwap: 'החלפה',
  swapPickTarget: 'בחרו שחקן להחלפה',
  swapCancel: 'ביטול',
  playerMenuWentHome: 'הלך הביתה',
  playerMenuWentHomeHint: 'זמין רק במהלך מחזור פעיל',
  playerMenuRestore: 'החזר למחזור',
  // ── Community player menu + timeline + cards ──
  playerMenuTimeline: 'ציר זמן',
  playerMenuRate: 'דרג שחקן',
  playerMenuRemove: 'הסר מהמחזור',
  // Equipment (club ball / jerseys) — admin marks who currently holds them.
  playerMenuManageEquipment: 'נהל ציוד',
  manageEquipmentTitle: (name: string) => `ציוד אצל ${name}`,
  manageEquipmentSubtitle: 'סמן איזה ציוד של המועדון מוחזק אצל השחקן הזה.',
  equipmentUpdatedToast: 'סימוני הציוד עודכנו',
  equipmentUpdateFailed: 'לא הצלחנו לעדכן את הציוד. נסה שוב.',
  ratingNotRated: 'לא דורג',
  cardYellow: 'כרטיס צהוב',
  cardRed: 'כרטיס אדום',
  cardRedConfirmTitle: 'להנפיק כרטיס אדום?',
  cardRedConfirmBody: (name: string) =>
    `כרטיס אדום פעיל יחסום את ${name} מהרשמה למחזורים חדשים במועדון — עד שיפוג או שתבטל אותו.`,
  cardIssueFailed: 'לא הצלחנו לרשום את הכרטיס. נסה שוב.',
  issueCardTitle: (name: string, cardLabel: string) => `${cardLabel} ל${name}`,
  cardDetailLabel: 'פירוט (אופציונלי)',
  cardDetailPlaceholder: 'למשל: איחר 20 דק׳ / התנהגות',
  cardIssuedToast: 'הכרטיס נרשם',
  cardRevoke: 'בטל כרטיס',
  cardRevokeConfirmTitle: 'לבטל את הכרטיס?',
  cardRevokeConfirmBody: 'הכרטיס יישאר בציר הזמן מסומן "בוטל" ויפסיק לחסום/להיספר.',
  cardRevokedToast: 'הכרטיס בוטל',
  cardStateActive: 'פעיל',
  cardStateExpired: 'פג תוקף',
  cardStateRevoked: 'בוטל',
  // Card validity line on the timeline — shown only when the card has an expiry
  // (the club set a validity in days). Computed from the card's date + validity.
  cardValidUntil: (date: string) => `בתוקף עד ${date}`,
  cardDaysLeft: (n: number) =>
    n <= 0 ? 'מסתיים היום' : n === 1 ? 'עוד יום' : `עוד ${n} ימים`,
  cardExpiredOn: (date: string) => `פג תוקף ב-${date}`,
  timelineTitle: (name: string) => `ציר זמן · ${name}`,
  timelineEmpty: 'אין עדיין אירועים לשחקן הזה במועדון.',
  timelineEventYellow: 'כרטיס צהוב',
  timelineEventRed: 'כרטיס אדום',
  timelineEventBall: 'לקח כדור הביתה',
  timelineEventJerseys: 'לקח גופיות הביתה',
  // Membership milestones synthesized from group.joinedAt / group.adminSince.
  timelineJoinedCommunity: 'הצטרף למועדון',
  timelineApprovedBy: (name: string) => `אושר ע״י ${name}`,
  timelineBecameAdmin: 'מונה למנהל',
  // Manual "נהל ציוד" mark removal — the admin cleared the holder mark.
  timelineEventBallReturned: 'החזיר את הכדור',
  timelineEventJerseysReturned: 'החזיר את הגופיות',
  equipmentLastTook: (d: string) => `לקח לאחרונה ${d}`,
  equipmentNeverTook: 'עוד לא לקח',
  redCardValidityLabel: 'תוקף כרטיס אדום (בימים)',
  yellowCardValidityLabel: 'תוקף כרטיס צהוב (בימים)',
  cardValidityNoExpiry: 'ללא תוקף',
  cardValidityDays: 'מספר ימים',
  cardValidityDaysSuffix: 'ימים',
  cardValidityDaysHint: 'מספר הימים שהכרטיס נשאר פעיל מרגע שניתן. השאירו ריק כדי שלא יפוג אף פעם.',
  // Advanced form section + cards toggle
  groupFormTabDetails: 'פרטים',
  groupFormTabAdvanced: 'מתקדם',
  cardsToggleLabel: 'כרטיסים (צהוב/אדום)',
  cardsToggleHint:
    'מאפשר למנהלים לתת כרטיסים לשחקנים. כרטיס צהוב הוא אזהרה/מעקב בלבד. כרטיס אדום פעיל חוסם את השחקן מהרשמה למחזורי המועדון — עד שהתוקף יפוג או שהמנהל יבטל אותו.',
  redCardBlockJoin: (until: string) => `יש לך כרטיס אדום פעיל ${until} — לא ניתן להירשם`,
  redCardBlockUntilRevoke: 'עד ביטול',
  redCardBlockUntilDate: (d: string) => `עד ${d}`,
  redCardBlockToast: 'יש לך כרטיס אדום פעיל במועדון — לא ניתן להירשם',
  cardCountYellowA11y: (n: number) => `${n} כרטיסים צהובים פעילים`,
  cardCountRedA11y: (n: number) => `${n} כרטיסים אדומים פעילים`,
  wentHomeSectionTitle: 'הלכו הביתה',
  wentHomeTapHint: 'הקש על שחקן כדי להחזיר אותו',
  wentHomeConfirmTitle: (name: string) => `${name} הלך הביתה?`,
  wentHomeConfirmBody:
    'השחקן יוצא מהמחזור. אם קבוצתו במגרש ותישאר חסרה — תוצע החלפה, והשעון ימשיך לרוץ. אפשר להחזיר אותו בכל רגע.',
  wentHomeConfirmOk: 'הלך הביתה',
  restoreConfirmTitle: (name: string) => `להחזיר את ${name}?`,
  restoreConfirmBody: 'השחקן יחזור לקבוצתו. אם נכנס לו מחליף — המחליף יפנה את מקומו.',
  restoreConfirmOk: 'החזר',
  winnerPickTitle: 'מי ניצחה במשחק?',
  winnerPickSubtitle: 'בחר את הקבוצה שניצחה כדי לסיים את המשחק',
  winnerPickTieSubtitle: 'תיקו בתוצאה — בחרו ביניכם מי ניצחה (פנדלים / פרט-זוג / וכו׳) וסמנו כאן',
  // ── Live goal entry (advanced mode) ──
  goalSectionTitle: 'תוצאת המשחק',
  goalAdd: 'שער',
  goalAddTo: (team: string) => `שער · ${team}`,
  goalAddGoal: 'הוסף גול',
  goalScorersLog: (n: number) => `מבקיעים · ${n}`,
  goalLogEmpty: 'עדיין אין שערים במשחק',
  goalScorerPickTitle: (team: string) => `מי הבקיע? · ${team}`,
  goalUnknownScorer: 'לא ידוע',
  goalOwnGoal: 'שער עצמי',
  goalAssistPickTitle: (team: string) => `מי בישל? · ${team}`,
  goalAssistNone: 'אף אחד',
  // Goal wizard step labels + back button.
  goalStepScorer: 'כובש',
  goalStepAssist: 'מבשל',
  goalBack: '‹ חזרה',
  goalOwnGoalShort: 'שער עצמי',
  goalScorerWithAssist: (scorer: string, assister: string) =>
    `${scorer} (בישול: ${assister})`,
  goalSaveFailed: 'לא הצלחנו לשמור את הגול, נסו שוב',
  roundFinalizeFailed: 'לא הצלחנו לסיים את המשחק, נסו שוב (הגולים נשמרו)',
  // ── Retro goals (admin, post-match) ──
  retroEntryCta: 'השלם גול שהוחמץ',
  retroTitle: 'השלמת גולים',
  retroNote: 'מזכה את השחקן בגול — לא משנה מי ניצח את המשחקים.',
  retroEmpty: 'עדיין לא הושלמו גולים',
  retroAddCta: 'הוסף גול שהוחמץ',
  retroPickScorer: 'מי הבקיע?',
  retroPickAssist: 'מי בישל? (אופציונלי)',
  retroNoAssist: 'בלי בישול',
  retroRemoveCta: 'בטל גול',
  retroAddDone: 'הגול הושלם',
  retroRemoveDone: 'הגול בוטל',
  retroActionFailed: 'הפעולה נכשלה, נסו שוב',
  retroScorerWithAssist: (scorer: string, assist: string) => `${scorer} · בישול: ${assist}`,
  goalPickerEmptyRoster: 'אין שחקנים זמינים בקבוצה הזו',
  goalAssistEmptyRoster: 'אין שחקנים אחרים לבישול',
  winnerPickCancel: 'ביטול',
  winnerPickConfirm: 'אישור',
  // ── Penalty shootout (drawn-round tiebreaker) ──
  shDecideTitle: 'איך מכריעים את התיקו?',
  shDecideSubtitle: 'המשחק נגמר בתיקו — בחרו איך לקבוע מנצחת',
  shDecideManual: 'בחירה ידנית',
  shDecideManualHint: 'בוחרים קבוצה מנצחת בלי פנדלים',
  shDecidePenalties: 'שובר שוויון בפנדלים',
  shDecidePenaltiesHint: 'סבב בעיטות פנדל עד להכרעה',
  shTag: '🥅 שובר שוויון בפנדלים',
  shFirstTitle: 'מי בועטים ראשונים?',
  shRandom: 'אקראי',
  shBack: '‹ חזור',
  shTurn: (team: string, n: number) => `התור: ${team} · בעיטה ${n}`,
  shKicksCount: (n: number) => `${n} בעיטות`,
  shLogTitle: 'היסטוריית בעיטות',
  shLogEmpty: 'עדיין לא נבעטו פנדלים',
  shScored: (keeper: string) => `⚽ נכנס · מול ${keeper}`,
  shMissed: (keeper: string) => `❌ החמיץ · מול ${keeper}`,
  shAddKick: 'בעיטת פנדל',
  shFinish: 'סיים שובר שוויון',
  shKickTitle: 'בעיטת פנדל',
  shKicking: (team: string) => `${team} בועטים`,
  shVsKeeper: (team: string) => `מול שוער ${team}:`,
  shPickKeeper: 'בחר שוער',
  shReplaceKeeper: 'החלף',
  shKeeperCanKick: 'גם שוער יכול להיבחר כבועט',
  shWhoKicks: 'מי בועט?',
  shKickedN: (n: number) => `בעט ${n}`,
  shContinue: 'המשך',
  shContinueHint: 'לא ניתן להמשיך עד שנבחרו בועט ושוער',
  shPickKeeperTitle: 'מי בשער?',
  shResultKickBy: (name: string) => `בעיטה של ${name}`,
  shResultVsKeeper: (name: string) => `מול השוער ${name}`,
  shResultQ: 'נכנס?',
  shResultIn: 'נכנס',
  shResultMiss: 'הוחמץ',
  // Winner confirmation on "finish shootout"
  shConfirmWinTitle: (team: string) => `${team} ניצחה?`,
  shConfirmWinBody: (team: string, w: number, l: number) =>
    `${team} מובילה ${w}-${l} בפנדלים. לקבוע אותה כמנצחת המשחק?`,
  shConfirmWinCta: 'אישור',
  liveEndEvening: 'סיים מחזור',
  liveEndEveningTitle: 'לסיים את המחזור?',
  liveEndEveningBody:
    'המחזור יסומן כהסתיים, התוצאות יישמרו והמחזור יעבור להיסטוריה. לא ניתן לחזור אחורה.',
  liveEndEveningConfirm: 'כן, סיים את המחזור',
  // "מה חדש" modal (post-update highlights)
  whatsNewTitle: 'מה חדש באפליקציה ⚽',
  whatsNewBadge: (v: string) => `✦ גרסה ${v}`,
  whatsNewCta: 'יאללה, הבנתי 🎉',

  // Mini-games history ("היסטוריית המשחקים") — finished-game breakdown
  matchRoundsTitle: 'היסטוריית המשחקים',
  matchDetailsRoundsCta: 'היסטוריית המשחקים',
  matchDetailsRoundsSub: 'מי נגד מי · גולים · בישולים · פנדלים',
  matchRoundsCount: (n: number) =>
    n === 1 ? 'משחק אחד' : `${n} משחקים`,
  matchRoundsRoundN: (n: number) => `משחק ${n}`,
  matchRoundsTeamA: 'קבוצה א׳',
  matchRoundsTeamB: 'קבוצה ב׳',
  matchRoundsWon: (team: string) => `${team} ניצחה`,
  matchRoundsWonPens: (team: string) => `${team} בפנדלים`,
  matchRoundsTie: 'תיקו',
  matchRoundsNoGoals: 'לא נרשמו גולים במשחק',
  matchRoundsAssist: (name: string) => `בישול: ${name}`,
  matchRoundsOwnGoal: 'שער עצמי',
  matchRoundsShootout: 'שובר-שוויון בפנדלים',
  matchRoundsVsKeeper: (name: string) => `מול ${name}`,
  matchRoundsWhoPlayed: 'הרכבים',
  matchRoundsUnknownPlayer: 'שחקן',
  matchRoundsGuest: 'אורח',
  matchRoundsEmptyTitle: 'אין היסטוריית משחקים',
  matchRoundsEmptySub: 'למחזור הזה לא נשמרו פרטי משחקים.',

  // Evening summary card + sharing
  summaryTitle: 'סיכום המחזור',
  summaryCta: 'סיכום המחזור שלי',
  summaryShareCta: 'שתף את סיכום המחזור ⚡',
  summaryShareTitle: 'שיתוף סיכום המחזור',
  summaryShareUnavailable: 'שיתוף לא זמין במכשיר הזה',
  summaryShareFailed: 'השיתוף נכשל, נסו שוב',
  summaryUnavailable: 'אין עדיין סיכום למחזור הזה',
  summaryNoPlay: 'לא שיחקת משחקים במחזור הזה, אז אין סיכום להציג 🙂',
  summaryConnectWatch: 'חבר שעון לנתונים פיזיים 🏃',
  // ── Player comparison (head-to-head) ──
  compareTitle: 'השוואה',
  compareCta: 'השווה אליי',
  compareShareCta: 'שתף השוואה ⚡',
  compareShareTitle: 'שיתוף השוואת שחקנים',
  compareUnavailable: 'אין מספיק נתונים להשוואה עדיין',
  // Pitch calibration (heatmap)
  pitchTitle: 'כיול מגרש',
  pitchFinish: 'סיים כיול',
  pitchGpsFailed: 'לא הצלחנו לקרוא מיקום GPS, נסו שוב',
  pitchSaved: 'המגרש כויל ונשמר ✓',
  pitchSaveFailed: 'שמירת הכיול נכשלה, נסו שוב',
  availablePlayersTitle: 'שחקנים פנויים',
  availablePlayersEmpty: 'לא נמצאו שחקנים פנויים שמתאימים למחזור הזה',
  // "Send to everyone available, in pulses" (manual filler-pulse trigger).
  sendPulseTitle: 'שלח לכל הפנויים באזור',
  sendPulseCta: 'שלח לכולם בפעימות',
  sendPulseSending: 'שולח…',
  sendPulseExplain:
    'נשלח הזמנה לשחקנים פנויים באזור המחזור, בהדרגה, עד שהמחזור יתמלא. כל שחקן מקבל הזמנה אחת בלבד.',
  sendPulseConfirm: 'להתחיל לשלוח?',
  sendPulseStarted: 'התחלנו לשלוח! נזמין שחקנים פנויים עד שהמחזור יתמלא.',
  sendPulseSentBtn: 'השליחה החלה ✓',
  sendPulseAlready: 'כבר יש שליחה פעילה למחזור הזה.',
  sendPulseTooLate: 'קרוב מדי לתחילת המחזור (פחות מחצי שעה) — אי אפשר לשלוח.',
  sendPulseTooEarly: 'עוד מוקדם מדי — אפשר לשלוח מ-12 שעות לפני המחזור.',
  sendPulseFull: 'המחזור כבר מלא — אין למי לשלוח.',
  sendPulseNoCity: 'למחזור אין עיר מוגדרת, אז אי אפשר למצוא שחקנים באזור.',
  sendPulseNotOpen: 'המחזור לא פתוח להרשמה.',
  sendPulseError: 'לא הצלחנו להתחיל את השליחה. נסה שוב.',
  vs: 'VS',
  startTimer: 'התחל טיימר',
  pauseTimer: 'השהה',
  resetTimer: 'אפס',
  matchNumber: (n: number) => `משחק ${n}`,
  matchOf: (n: number, total: number) => `משחק ${n} מתוך ${total}`,

  // Match end
  matchEnd: 'סיום משחק',
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
  gameLoading: 'טוען את המחזור...',
  liveTimerViewerHint: 'הטיימר מנוהל על ידי מנהל המחזור',
  gameNoActiveAdmin: 'אין מחזור פעיל. צור מחזור חדש כדי להתחיל.',
  gameNoActivePlayer: 'ממתין למנהל ליצור את המחזור',
  gamePermissionDenied: 'אין לך הרשאה לצפות במחזור הזה',
  gameLoadError: 'לא הצלחנו לטעון את המחזור. נסה שוב.',
  gameCreate: 'צור מחזור חדש',
  gameRetry: 'נסה שוב',

  // Games list (Games tab — sectioned)
  gamesListTitle: 'מחזורים',
  gamesSectionMy: 'המחזורים שלי',
  gamesSectionFromCommunities: 'מהמועדונים שלי',
  gamesSectionOpen: 'מחזורים פתוחים',
  gamesEmptyMy: 'עוד לא נכנסת להרכב של אף מחזור',
  gamesEmptyFromCommunities: 'אין כרגע מחזורים במועדונים שלך',
  gamesEmptyOpen: 'אין כרגע מחזורים פתוחים באזור',
  gamesEmptyAllTitle: 'אין כרגע מחזורים פעילים',
  gamesEmptyAllSub: 'תהיה הראשון לפתוח מחזור עם המועדון שלך',
  gamesCreate: 'צור מחזור חדש',

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
  gameCardFull: 'המחזור מלא — ניתן להצטרף לספסל',
  gameCardCancelDeadline: (h: number) =>
    h === 1 ? 'דדליין לביטול: שעה לפני' : `דדליין לביטול: ${h} שעות לפני`,
  gameCardPublic: 'מחזור פתוח',
  gameCardPrivate: 'מועדון',
  gameCardPlayersMore: (n: number) => `+${n}`,
  gameStatusJoined: 'בהרכב',
  gameStatusWaitlist: 'הצטרף לרשימת המתנה',
  gameStatusPending: 'ממתין לאישור',
  gameFormat4: '4 × 4',
  gameFormat5: '5 × 5',
  gameFormat6: '6 × 6',
  gameFormat7: '7 × 7',

  // Create game form
  createGameTitle: 'יצירת מחזור חדש',
  createGameRecurringTitle: 'תזמן מחזור שבועי',
  createGameOverlapTitle: 'יש כבר מחזור באותו זמן',
  createGameOverlapUnknownTitle: 'מחזור קיים',
  createGameOverlapBody: (title: string, when: string) =>
    `כבר קיים מחזור "${title}" ב-${when}. לא ניתן ליצור שני מחזורים באותו חלון זמן.`,
  // Scheduled registration-open (separate from the recurring toggle)
  wizardScheduledRegToggle: 'תזמון פתיחת הרשמה',
  wizardScheduledRegHint:
    'במקום שההרשמה תיפתח מיד — בחר מתי המשחק יופיע בפיד וההרשמה תיפתח. עד אז המשחק נסתר. מתאים גם למשחק חד-פעמי וגם למחזור שבועי.',
  wizardRegOpensLabel: 'פתיחת הרשמה',
  wizardRegOpensHint:
    'במועד שתבחר המחזור יופיע בפיד וההרשמה תיפתח. עד אז הוא נסתר מכולם וחברי המועדון יקבלו התראה כשהוא נפתח.',
  wizardRegOpensHintPast:
    'מועד שבחרת כבר עבר — חברי המועדון יקבלו התראה והמחזור יופיע בפיד מיד עם השמירה.',
  wizardRegOpensRequired: 'יש לבחור מועד פתיחת הרשמה',
  wizardRegOpensMustBeBeforeKickoff:
    'מועד פתיחת ההרשמה חייב להיות לפני שעת המחזור',
  wizardRegOpensWarnTitle: 'לוודא שזה מה שרצית?',
  wizardRegOpensWarnPastBody:
    'מועד פתיחת ההרשמה שבחרת כבר עבר. ברגע השמירה תישלח התראה והמחזור יופיע בפיד.',
  wizardRegOpensWarnShortBody:
    'מועד פתיחת ההרשמה קרוב מאוד לתחילת המחזור (פחות מ-4 שעות). מומלץ לתת לחברי המועדון זמן להירשם.',
  wizardRegOpensWarnContinue: 'המשך בכל זאת',
  wizardRegOpensWarnEdit: 'ערוך',
  createGameCommunity: 'מועדון',
  createGameCommunityHint: 'בחר מועדון שאתה משחק בו',
  createGameDateTime: 'תאריך ושעה',
  gameWizardMissingFields: (fields: string) => `יש למלא: ${fields}`,
  createGamePastDateTitle: 'התאריך כבר עבר',
  createGamePastDateBody: 'מועד המחזור שבחרת כבר חלף. ליצור את המחזור בכל זאת?',
  createGamePastDateConfirm: 'צור בכל זאת',
  createGameHolidayTitle: 'המחזור נופל על חג',
  createGameHolidayBody: (name: string) =>
    `המחזור מתוזמן ל${name}, ליצור בכל זאת?`,
  createGameHolidayConfirm: 'צור בכל זאת',
  editGameNotifyTitle: 'השינוי יישלח להרכב',
  editGameNotifyBody: (n: number) =>
    `השינוי יישלח כהתראה ל-${n} שחקנים בהרכב. להמשיך?`,
  editGameNotifyConfirm: 'שמור ושלח',
  gameWizardSubmitFailed: 'יצירת המחזור נכשלה. נסה שוב.',
  createGameField: 'מיקום המגרש',
  createGameFieldPlaceholder: 'חפש מגרש, בית ספר, פארק או כתובת (כולל עיר)',
  createGameLocationFreeTextHint:
    'אפשר גם להקליד מיקום חופשי. בחירה מהרשימה תעזור לנו למקם את המחזור במדויק.',
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
  createGameMinPlayersHint: 'מתחת למספר הזה המחזור עלול להתבטל',
  createGameNumberOfTeams: 'מספר קבוצות',
  // Advanced game mode toggle + sub-options.
  createGameAdvancedMode: 'מצב מחזור מתקדם',
  createGameAdvancedModeHint:
    'כבוי: טיימר בלבד · דלוק: קבוצות, רוטציה וסטטיסטיקה',
  createGameAdvancedModeInfo:
    'הבחירה קובעת איך ייראה מסך הלייב במהלך המחזור:\n\n' +
    '🔘 כבוי — טיימר מחזור בלבד, מסונכרן בזמן אמת בין כל המכשירים, כולל שעונים חכמים. פשוט ונקי.\n\n' +
    '🟢 דלוק — בנוסף לטיימר, מסך הלייב מנהל את כל המחזור: חלוקה לקבוצות, רוטציה והחלפת שחקנים אוטומטית בין המשחקים, ותיעוד ניצחונות וסטטיסטיקה לכל שחקן.',
  createGameAdvancedFill: 'שלוש קבוצות — שחקן משלים',
  createGameAdvancedFillTemporary: 'זמני',
  createGameAdvancedFillPermanent: 'קבוע',
  createGameAdvancedFillHint:
    'כשקבוצה עולה עם שחקן מושאל (הקבוצות לא מלאות)',
  createGameAdvancedFillInfo:
    'כשמשחקים בשלוש קבוצות והן לא מלאות, הקבוצה שמנצחת ועולה משלימה את עצמה בשחקן מהקבוצה שיצאה:\n\n' +
    '• קבוע — השחקן המושאל נשאר בקבוצה החדשה עד סוף המחזור.\n' +
    '• זמני — השחקן חוזר לקבוצתו ברגע שהיא חוזרת למגרש (מסומן בכוכב כל עוד הוא מושאל).',
  createGameAdvancedTie: 'בתיקו — הקבוצה הותיקה יוצאת',
  createGameAdvancedTieHint: 'מי יוצא כשמשחק נגמר בתיקו',
  createGameAdvancedTieInfo:
    'מה קורה כשמשחק מסתיים בתיקו, כשמשחקים בארבע קבוצות:\n\n' +
    '🔘 כבוי — שתי הקבוצות שעל המגרש יוצאות, ושתי הקבוצות הממתינות נכנסות במקומן.\n\n' +
    '🟢 דלוק — רק הקבוצה הותיקה (זו ששיחקה יותר זמן ברצף) יוצאת, והשנייה נשארת למשחק נוסף.',
  createGameTotalPlayers: (n: number) => `סה״כ שחקנים: ${n}`,
  createGameFieldType: 'משטח המגרש',
  createGameMatchDuration: 'אורך המחזור (דקות)',
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
  createGameCancelDeadline: 'דדליין לביטול (שעות לפני המחזור)',
  createGameCancelDeadlineHint:
    'אחרי הזמן הזה ביטול ייספר כאי-הגעה',
  createGameFormat: 'פורמט',
  createGameIsPublic: 'מחזור פתוח לכולם',
  createGameIsPublicHint:
    'כשמופעל — המחזור פתוח ומוצג בלשונית המחזורים גם למי שאינם במועדון, וגם נשלחת פנייה לשחקנים פנויים בקרבת מקום כשחסרים משתתפים. כבוי — המחזור סגור לחברי המועדון בלבד.',
  createGameRequiresApproval: 'הצטרפות דורשת אישור',
  createGameRequiresApprovalHint: 'כשמופעל — תאשר ידנית כל בקשה להצטרף',
  createGameWaitlistApproval: 'קידום מרשימת המתנה דורש אישור השחקן',
  createGameWaitlistApprovalHint:
    'כשמופעל — כשמתפנה מקום, הראשון בהמתנה מקבל התראה וצריך לאשר שהוא מגיע תוך פרק הזמן שתקבע; אם לא אישר, ההצעה עוברת להבא בתור. כשמכובה (ברירת מחדל) — הראשון בהמתנה נכנס אוטומטית בלי לאשר.',
  createGameWaitlistTimeout: 'זמן לאישור (דקות)',
  createGameWaitlistTimeoutHint:
    'כמה דקות יש לשחקן שקיבל את המקום לאשר, לפני שההצעה עוברת להבא בתור.',
  createGameNotes: 'הערות (לא חובה)',
  // Section headers that split the create-game wizard + create-community form
  // into labeled groups (bold title + hairline rule).
  wizardSectionDetails: 'פרטי המחזור',
  wizardSectionFormat: 'פורמט המחזור',
  wizardSectionDurationRules: 'משך וחוקים',
  wizardSectionCharacteristics: 'מאפייני מחזור',
  wizardSectionAvailability: 'זמינות מחזור',
  groupSectionIdentity: 'פרטי המועדון',
  groupSectionLocation: 'מיקום ויצירת קשר',
  groupSectionAccess: 'הצטרפות והרשאות',
  groupSectionRating: 'דירוג וכרטיסים',
  createGameBringBall: 'מישהו צריך להביא כדור',
  createGameBringShirts: 'מישהו צריך להביא גופיות',
  createGameSubmit: 'יצירת מחזור',
  createGameAdvanced: 'הגדרות מתקדמות',
  createGameTotalShort: (n: number) => `סך ${n} שחקנים`,
  editGameTitle: 'עריכת מחזור',
  editGameSubmit: 'שמירת שינויים',
  editGameRegAfterKickoffTitle: 'תזמון לא תקין',
  editGameRegAfterKickoffBody:
    'מועד פתיחת ההרשמה חייב להיות לפני זמן תחילת המחזור.',
  editGameAlreadyStartedTitle: 'המחזור כבר התחיל',
  editGameAlreadyStartedBody:
    'לא ניתן לערוך פרטי מחזור לאחר שזמן ההתחלה הגיע.',
  editGameCapacityTooLowTitle: 'יותר מדי שחקנים בהרכב',
  editGameCapacityTooLowBody: (registered: number, max: number) =>
    `כרגע ${registered} שחקנים בהרכב. לא ניתן להוריד את הקיבולת ל-${max}. הסר/י קודם שחקנים מהמחזור.`,
  matchDetailsDeletedTitle: 'המחזור כבר לא קיים',
  matchDetailsDeletedBody:
    'המחזור נמחק או הוסר. אפשר לחזור לרשימת המחזורים ולמצוא מחזור אחר.',
  matchDetailsLoadErrorTitle: 'לא הצלחנו לטעון את המחזור',
  matchDetailsLoadErrorBody: 'בדוק את החיבור לאינטרנט ונסה שוב.',
  communityDetailsDeletedTitle: 'המועדון כבר לא קיים',
  communityDetailsDeletedBody:
    'המועדון נמחק על ידי המנהל. אפשר לחזור לרשימת המועדונים ולחפש מועדון אחר.',
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
  wizardGameTitle: 'שם המחזור',
  wizardGameTitlePlaceholder: 'לדוגמה: חמישי כדורגל',
  wizardCity: 'עיר',
  wizardCityPlaceholder: 'לדוגמה: תל אביב',
  wizardAddress: 'כתובת מלאה',
  wizardAddressPlaceholder: 'רחוב הספורט 12',
  wizardLocation: 'מיקום',
  wizardLocationPlaceholder: 'עיר, רחוב ומספר',
  wizardTitleOptional: 'שם המחזור (אופציונלי)',
  wizardCancelOptionNone: 'ללא הגבלה',
  wizardCancelOption: (h: number) => `${h} שעות`,
  wizardSectionRules: 'חוקי המחזור',
  wizardHasReferee: 'שופט',
  wizardHasRefereeHint: 'שופט במגרש לאכיפת חוקים ופתיחת משחקים',
  wizardHasPenalties: 'פנדלים',
  wizardHasPenaltiesHint: 'סבב פנדלים בתיקו',
  wizardHasHalfTime: 'חוצים',
  wizardHasHalfTimeHint: 'מחזורים עם חוצים',
  wizardSectionVisibility: 'נראות',
  wizardVisibilityHint:
    'פתוח לכולם — כל שחקן באפליקציה יכול לראות את המחזור ולהצטרף.\n\nרק למועדון — רק חברי המועדון רואים את המחזור.',
  wizardVisibilityCommunity: 'רק למועדון שלי',
  wizardVisibilityPublic: 'פתוח לכולם',
  // Quick-game name + community target label (details step)
  createGameNameLabel: 'שם המחזור',
  createGameNamePlaceholder: 'לדוגמה: כדורגל שישי בבוקר',
  createGameNameHint: 'השם שיוצג בפיד ובכרטיס המחזור.',
  createGameForCommunity: (name: string) => `המחזור ייפתח למועדון: ${name}`,
  createGameChooseCommunityLocked:
    'מחזור למועדון קבוע שלך — אבל עדיין אין לך מועדון. הקם מועדון ראשון כדי לפתוח לו מחזורים.',
  createGameCreateCommunityCta: 'הקמת מועדון ראשון',
  // Scheduled public-open + guests-open pickers (community games)
  wizardPublicOpenToggle: 'פתיחה לכלל האפליקציה בזמן מתוזמן',
  wizardPublicOpenHint:
    'בחר מתי המחזור יהפוך מ"רק למועדון" ל"פתוח לכולם". עד אז רק חברי המועדון רואים אותו; מהמועד שתבחר כל שחקן באפליקציה יוכל לראות ולהצטרף.',
  wizardPublicOpenLabel: 'מועד פתיחה לכולם',
  wizardGuestsOpenToggle: 'הגבלת הוספת אורחים עד זמן מסוים',
  wizardGuestsOpenHint:
    'עד המועד שתבחר רק מנהל המחזור יוכל להוסיף אורחים. שאר השחקנים יוכלו להוסיף אורחים רק מהמועד הזה ואילך. למנהל אין הגבלה.',
  wizardGuestsOpenLabel: 'פתיחת הוספת אורחים לשחקנים',
  wizardAutoTeamsToggle: 'תזמון יצירת כוחות אוטומטיים',
  wizardAutoTeamsHint:
    'במועד שתבחר, המערכת תחלק את הנרשמים לקבוצות מאוזנות (לפי הדירוג הפנימי או באקראי — לבחירתך), וכל שחקן יקבל פוש עם הקבוצה שלו. אפשר לערוך אחר כך. שחקן ללא דירוג פנימי ייחשב בדירוג ממוצע.\n\nשים לב: אם כבר קבעת כוחות ידנית (בכל שיטה — ידני, דירוג או אקראי) — התזמון לא ירוץ ולא ישנה אותם.',
  wizardAutoTeamsLabel: 'מועד יצירת הכוחות',
  wizardAutoTeamsMethodLabel: 'שיטת החלוקה',
  wizardAutoTeamsBeforeKickoff: 'מועד יצירת הכוחות חייב להיות לפני תחילת המחזור',
  wizardAutoTeamsInPast: 'מועד יצירת הכוחות חייב להיות בעתיד',
  wizardSectionAdvanced: 'הגדרות מתקדמות',
  wizardCancelDeadline: 'עד כמה שעות לפני אפשר לבטל הרשמה',
  wizardCancelDeadlineHint:
    'מעבר לזמן הזה, ביטול ייחשב כאי־הגעה. השאר ריק לחוסר הגבלה.',
  // Cancel-deadline as a date (toggle + picker) instead of hour pills
  wizardCancelDeadlineToggle: 'מועד אחרון לביטול הרשמה',
  wizardCancelDeadlineToggleHint:
    'כשמופעל — אחרי המועד שתבחר לא ניתן לבטל הרשמה (ביטול ייחשב כאי־הגעה). כבוי = אפשר לבטל בכל עת.',
  wizardCancelDeadlineLabel: 'מועד אחרון לביטול',
  wizardSummaryTitle: 'תקציר המחזור',
  wizardSummaryConfirm: 'אישור ויצירה',
  wizardSummaryBackToEdit: 'חזרה לעריכה',
  wizardSummaryDate: 'מתי',
  wizardSummaryWhere: 'מיקום',
  wizardSummaryFormat: 'פורמט',
  wizardSummaryVisibility: 'נראות',
  createGameNoCommunities: 'לפני שתוכל ליצור מחזור, צריך להצטרף למועדון',
  createGameNoAdmin:
    'רק מנהלי מועדון יכולים ליצור מחזורים. בקש מהמנהל של המועדון ליצור עבורך מחזור.',
  // Orphan / "no community" flow — fast path for creating a one-off
  // game without setting up a community first. The game lives in a
  // hidden personal group; after it ends, the user gets a push
  // offering to promote that group to a real community.
  matchDetailsCommunityOrphan: 'מחזור חד־פעמי',
  // Game rules — free-text chip input. Replaces the old
  // hasReferee/hasPenalties/hasHalfTime toggles.
  ruleTagsLabel: 'חוקי המחזור',
  ruleTagsHint: 'הקלידו והוסיפו תגית עם Enter, פסיק או הכפתור +.',
  ruleTagsPlaceholder: 'שופט, מחזורים עם חוצים…',
  ruleTagsAdd: 'הוסף חוק',
  ruleTagsRemove: (tag: string) => `הסר את "${tag}"`,
  ruleTagsAtCap: (n: number) => `הגעת למקסימום ${n} חוקים. הסר אחד כדי להוסיף עוד.`,
  // Per-player "אני מביא כדור" toggle on MatchDetails (visible only
  // to registered users). Self-toggle, no push fired.
  matchBringBallToggle: 'אני מביא כדור',
  matchBringBallTagOn: 'מביא כדור',
  // Promote-orphan-to-community screen
  promoteOrphanTitle: 'צור מועדון מהמחזור',
  promoteOrphanBanner:
    'תן שם, סמן את מי להזמין — ובלחיצה כל החברים מהמחזור יקבלו הזמנה.',
  promoteOrphanNameLabel: 'שם המועדון',
  promoteOrphanNamePlaceholder: 'הכדורגלנים של חמישי',
  promoteOrphanCityLabel: 'עיר (אופציונלי)',
  promoteOrphanCityPlaceholder: 'תל אביב',
  promoteOrphanInviteHeader: (selected: number, total: number) =>
    `מי להזמין? (${selected}/${total} מסומנים)`,
  promoteOrphanNoOthers: 'לא היו עוד שחקנים במחזור להזמין.',
  promoteOrphanSubmit: (n: number) =>
    n === 0 ? 'צור מועדון' : `צור והזמן ${n} שחקנים`,
  promoteOrphanNameTooShortTitle: 'שם קצר מדי',
  promoteOrphanNameTooShortBody: 'תנו למועדון שם של 2 תווים לפחות.',
  promoteOrphanSuccessTitle: '🎉 המועדון נוצר',
  promoteOrphanSuccessBody: (n: number) =>
    n === 0
      ? 'המועדון מוכן. תוכל להזמין שחקנים מהמסך של המועדון.'
      : `המועדון מוכן. ${n} שחקנים קיבלו הזמנה.`,
  promoteOrphanGoToCommunity: 'פתח את המועדון',
  promoteOrphanErrorTitle: 'תקלה ביצירת המועדון',
  promoteOrphanErrorBody: 'נסה שוב בעוד רגע.',
  createGameOrphanCta: 'צור מחזור חד־פעמי',
  createGameOrphanCtaSub: 'בלי מועדון — מהיר, רק עבור המחזור',
  createGameOrphanBanner: 'מחזור חד־פעמי — תוכל לקבע מועדון אחרי שתשחקו',
  createGameQuickLoading: 'מכינים מחזור מהיר…',
  createGameOrphanErrorTitle: 'תקלה ביצירה',
  createGameOrphanErrorBody: 'לא הצלחנו להכין את הסביבה. נסה שוב בעוד רגע.',

  // Admin gating
  startEveningAdminOnly: 'רק מנהל יכול להתחיל את המחזור',
  createGameAdminOnly: 'רק מנהל יכול ליצור מחזור חדש',

  // Group search
  groupsSearchTitle: 'חפש מועדון',
  groupsSearchPlaceholder: 'שם המועדון',
  groupsSearchEmpty: 'אין תוצאות. נסה חיפוש אחר.',
  groupsSearchPrompt: 'הקלד שם מועדון כדי לחפש',
  groupsSearchByCode: 'או הצטרף בעזרת קוד הזמנה',
  groupsSearchMembers: (n: number) => `${n} בסגל`,
  groupsActionRequest: 'בקש להצטרף',
  groupsActionPending: 'הבקשה נשלחה',
  groupsActionMember: 'אתה כבר במועדון',

  // Sign-in errors
  signInCancelled: 'ההתחברות בוטלה',
  signInConfigMissing: 'הגדרות Google עדיין לא מוגדרות',
  signInFailed: 'ההתחברות נכשלה. נסה שוב.',
  signInNetworkError: 'אין חיבור לאינטרנט',

  // Communities (public groups feed)
  tabCommunities: 'מועדונים',
  communitiesTitle: 'מועדונים',
  communitiesSubtitle: 'גלה מועדוני כדורגל באזור שלך',
  communitiesCreateGroup: 'צור מועדון חדש',
  communitiesEmpty: 'לא מצאנו מועדון בשם זה. נסה לחפש לפי עיר או שם אחר.',
  communitiesEmptyAll: 'אין עדיין מועדונים',
  communitiesEmptyAllSub: 'תהיה הראשון להקים מועדון כדורגל באזור שלך',
  communitiesCreateFirst: 'צור מועדון ראשון',
  communitiesClosed: 'המועדון סגור לבקשות חדשות',
  communitiesSearchPlaceholder: 'שם המועדון או עיר',

  // Empty states (real mode)
  statsEmpty: 'אין עדיין נתונים',
  statsEmptySub: 'הסטטיסטיקות יתעדכנו אחרי המחזורים הראשונים שלך',
  historyEmptyReal: 'אין עדיין היסטוריית מחזורים',
  historyLoadError: 'שגיאה בטעינת ההיסטוריה',
  retry: 'נסה שוב',
  historyEmptyHint: 'ברגע שתסיים מחזורים, הם יופיעו כאן',

  // Mock mode banner
  mockBanner: 'מצב נתוני דמו — לא קיים חיבור ל-Firebase',

  // Create group (extended)
  createGroupTitle: 'יצירת מועדון חדש',
  createGroupCity: 'עיר',
  createGroupCityPlaceholder: 'התחל להקליד שם עיר',
  createGroupStreet: 'רחוב',
  createGroupStreetPlaceholder: 'התחל להקליד שם רחוב',
  createGroupStreetDisabledHint: 'בחר עיר תחילה',
  createGroupAddressNote: 'הערה למיקום (לא חובה)',
  createGroupAddressNotePlaceholder: 'לדוגמה: שער צפוני, ליד בית הספר',
  createGroupDescription: 'תיאור המועדון (לא חובה)',
  createGroupMaxPlayers: 'מקסימום שחקנים במחזור',
  createGroupMaxMembers: 'מקסימום שחקנים במועדון',
  createGroupIsOpen: 'מועדון פתוח',
  createGroupIsOpenHint: 'כשמופעל — שחקנים חדשים מצטרפים אוטומטית. כבוי = דורש אישור מנהל.',
  createGroupInternalRating: 'דירוג פנימי',
  createGroupInternalRatingHint:
    'כשמופעל — המנהלים קובעים בעצמם את דירוג השחקנים, והדירוג הזה הוא שיוצג בפרטי המחזור ובמועדון במקום דירוג השחקנים. כבוי = הדירוג נקבע מהצבעות השחקנים.',
  createGroupHideInternalRating: 'להסתיר דירוג פנימי',
  createGroupHideInternalRatingHint:
    'כשמופעל — השחקנים לא יוכלו לראות את הדירוגים כלל (לא של עצמם ולא של אחרים). הדירוג ישמש כנתון פנימי של המנהלים בלבד.',
  communityAdminRatingTitle: (name: string) => `דירוג ${name}`,
  communityAdminRatingHint: 'דרג את השחקן (0.0–5.0). דירוג פנימי — נראה למנהלים בלבד.',
  communityAdminRatingClear: 'נקה דירוג',
  communityAdminRatingSet: 'דרג',
  // ── Community statistics screen ──
  communityMenuStats: 'סטטיסטיקה',
  communityStatsScreenTitle: 'סטטיסטיקת המועדון',
  communityStatsLoading: 'טוען נתונים…',
  communityStatsEmptyTitle: 'עדיין אין נתונים',
  communityStatsEmptyBody: 'אחרי שתשחקו כמה מחזורים, כאן תופיע כל הסטטיסטיקה של המועדון.',
  communityStatsSectionNumbers: 'המועדון במספרים',
  communityStatsSectionLeaders: 'מובילי המועדון',
  communityStatsSectionScorers: 'טבלת המבקיעים',
  communityStatsSectionFun: 'נתונים מעניינים',
  // ── Club achievements & level ──
  communityStatsSectionAchievements: 'הישגי המועדון',
  communityStatsEntryTitle: 'סטטיסטיקות המועדון',
  clubLevelLabel: 'רמה',
  clubLevelNextHint: (pts: number) => `עוד ${pts} נקודות לרמה הבאה`,
  clubLevelMaxHint: 'רמת השיא הושגה 🏆',
  // LTR isolate (LRI…PDI) so "3 / 10" keeps its order in the RTL layout instead
  // of flipping to "10 / 3" (the slash is a neutral that the RTL run reorders).
  clubAchievementProgress: (value: number, target: number) =>
    `⁦${value} / ${target}⁩`,
  clubAchievementGold: 'הושלם ✓',
  // hero tiles
  communityStatsGoals: 'גולים',
  communityStatsAssists: 'בישולים',
  communityStatsMiniGames: 'משחקים',
  communityStatsEvenings: 'מחזורים',
  communityStatsGoalsPerMini: 'גולים למשחק',
  // leaders
  communityStatsTopScorer: 'מלך השערים',
  communityStatsMvp: 'המצטיין',
  communityStatsMvpShare: (pct: number) => `${pct}% מכל השערים במועדון`,
  communityStatsTopAssister: 'מלך הבישולים',
  communityStatsTopWinner: 'מלך הניצחונות',
  communityStatsMostLoyal: 'הכי מתמיד',
  communityStatsPenaltyKing: 'מלך הפנדלים',
  communityStatsPenaltyKeeperKing: 'מלך שוערי הפנדלים',
  communityStatsGoalsUnit: (n: number) => `${n} גולים`,
  communityStatsAssistsUnit: (n: number) => `${n} בישולים`,
  communityStatsWinsUnit: (n: number) => `${n} ניצחונות`,
  communityStatsEveningsUnit: (n: number) => `${n} מחזורים`,
  communityStatsPenScoredUnit: (n: number) => `${n} פנדלים`,
  communityStatsPenSavedUnit: (n: number) => `${n} עצירות`,
  // fun facts
  communityStatsDeadliest: 'היחס הקטלני',
  communityStatsDeadliestValue: (r: string) => `${r} גולים למשחק`,
  communityStatsAvgAttendanceValue: (n: string) => `${n} שחקנים`,
  communityStatsTotalWins: 'סך הניצחונות שנרשמו',
  createGroupContactPhone: 'טלפון איש קשר',
  createGroupContactPhonePlaceholder: '050-1234567',
  createGroupContactPhoneHint: 'יוצג כפתור "פתח ב־WhatsApp" במועדון',
  createGroupContactPhoneInvalid: 'מספר לא תקין. פורמט: 05XXXXXXXX או +9725XXXXXXXX',
  createGroupPreferredDays: 'ימי מחזור קבועים',
  createGroupPreferredHour: 'שעת מחזור (לא חובה)',
  createGroupPreferredHourPlaceholder: '20:00',
  createGroupCostPerGame: 'עלות למחזור (₪)',
  createGroupCostPerGamePlaceholder: '0 = חינם',
  createGroupNotes: 'הערות לסגל (לא חובה)',
  createGroupNotesPlaceholder: 'מים אישיים, להגיע 10 דקות מראש וכו׳',
  createGroupSubmit: 'צור והיכנס',

  // Communities tab — sectioned feed
  communitiesSectionAdmin: 'מועדונים שאני מנהל',
  communitiesSectionMember: 'המועדונים שלי',
  communitiesSectionPending: 'ממתינים לאישור',
  communitiesSectionOpen: 'מועדונים פתוחים',
  communitiesHeroSubtitle: 'כל המועדונים במקום אחד',
  communitiesCardMemberBadge: 'אתה בסגל',
  // Inline CTA on the community card — surfaced only when the viewer
  // is NOT a member / admin / pending. Maps to the same requestJoin
  // call the details screen uses.
  communitiesCardJoin: 'הצטרף למועדון',
  communitiesCardSearchPlaceholder: 'חיפוש מועדון או עיר',
  communitiesEmptyAdmin: 'אינך מנהל אף מועדון',
  communitiesEmptyMember: 'עדיין לא הצטרפת לאף מועדון',
  communitiesEmptyMemberSub:
    'הצטרף למועדון מהרשימה למטה כדי לראות מחזורים, או פתח מועדון משלך.',
  communitiesEmptyOpenSection: 'אין מועדונים פתוחים נוספים',
  // Discovery is windowed — the biggest/most-active communities show first and
  // the long tail of tiny ones is revealed on demand (n = how many remain).
  communitiesShowMore: (n: number) => `הצג עוד מועדונים (${n})`,
  // Legacy keys kept until any old caller is removed:
  communitiesSectionMine: 'המועדונים שלי',
  communitiesSectionNearby: 'קרוב אליי',
  communitiesEmptyMine: 'עוד לא הצטרפת למועדון',
  communitiesEmptyNearby: 'אין מועדונים באזור שלך',

  // Filters
  filtersTitle: 'סינון',
  filterOpenOnly: 'פתוחים בלבד',
  filterHasRoom: 'מקום פנוי',
  filterNearby: 'קרוב אליי',
  // Radius selector shown under the "near me" toggle (games + communities)
  filterRadiusLabel: (km: number) => `טווח: עד ${km} ק"מ`,
  filterRadiusKm: (km: number) => `${km}`,
  // Shown when the user enables "near me" without granting location access
  locationPermTitle: 'צריך גישה למיקום',
  locationPermBody:
    'כדי לחפש מחזורים ומועדונים קרובים אליך, יש לאשר גישה למיקום.',
  locationPermOpenSettings: 'פתיחת הגדרות',

  // Card actions
  communityEnter: 'כניסה למועדון',
  communityJoinAuto: 'הצטרף למועדון',
  communityRequestToJoin: 'בקש להצטרף',
  communityCancelJoinRequest: 'בטל בקשת הצטרפות',
  toastJoinRequestCancelled: 'בקשת ההצטרפות בוטלה',
  communityWhatsApp: 'WhatsApp',

  // Community details screen
  communityDetailsAbout: 'תיאור המועדון',
  communityDetailsField: 'מגרש',
  communityDetailsCity: 'עיר',
  communityDetailsPreferredDays: 'ימי מחזור',
  communityDetailsPreferredHour: 'שעת מחזור',
  communityDetailsCost: 'עלות למחזור',
  communityDetailsCostFmt: (n: number) => (n > 0 ? `₪${n}` : 'חינם'),
  communityDetailsNotes: 'הערות',
  communityDetailsCreated: 'נוסד ב',
  communityDetailsRules: 'חוקי המועדון',
  communityDetailsRecurring: 'מחזור שבועי',
  communityDetailsCreateRecurringGame: 'פתח את המחזור הבא',
  communityDetailsRecurringConfirm: 'צור מחזור',
  communityDetailsRecurringNoConfig: 'אין הגדרת מחזור שבועי למועדון',
  communityDetailsRecurringFailed: 'יצירת המחזור נכשלה. נסה שוב.',
  communityDetailsAdmins: 'מנהלים',
  communityDetailsMembers: 'שחקנים',
  communityDetailsUpcoming: 'מחזורים קרובים',
  communityDetailsNextGame: 'מחזור קרוב',
  communityDetailsNoUpcoming: 'אין מחזורים קרובים',

  // Guests (per-game guest players, not real users)
  guestLabel: 'אורח',
  guestAddButton: 'הוסף אורח',
  guestAddTitle: 'הוסף אורח למחזור',
  guestEditTitle: 'ערוך אורח',
  guestRowActionTitle: (name: string) => `הסרת ${name} מהמחזור?`,
  guestRowActionRemove: 'הסר אורח',
  guestRowRemoveSuccess: 'האורח הוסר מהמחזור',
  guestRowRemoveError: 'הסרת האורח נכשלה',
  createGroupGenericError: 'יצירת המועדון נכשלה. נסה שוב.',
  createGroupAuthError:
    'יצירת המועדון נחסמה כרגע מטעמי אבטחה. ודא שהאפליקציה מעודכנת לגרסה האחרונה ונסה שוב. אם הבעיה חוזרת, נסה לצאת ולהיכנס מחדש לחשבון.',
  createGroupRateLimitError:
    'יצירת מועדונים מוגבלת לחמש ביום. נסה שוב מחר.',
  communityDescriptionTitle: 'תיאור המועדון',
  communityRulesTitle: 'חוקי המועדון',
  communityReadMore: 'קרא עוד',
  communityReadLess: 'הצג פחות',
  matchDetailsWaitlistTitle: 'רשימת המתנה',
  matchDetailsAvgRatingLabel: (count: number) =>
    `מבוסס על ${count} דירוגים`,
  guestNameLabel: 'שם האורח',
  guestNamePlaceholder: 'שם פרטי או כינוי',
  guestRatingLabel: 'דירוג משוער (לא חובה)',
  guestRatingHint: 'אופציונלי — עוזר לאזן את הכוחות. רק אתה (שצירפת) והמנהל רואים אותו.',
  guestRatingNone: 'ללא דירוג',
  guestRatingAdderOnly: 'רק מי שצירף את האורח יכול לערוך את הדירוג שלו.',
  guestBadge: 'אורח',
  guestRemove: 'הסר אורח',
  guestRemoveConfirmTitle: 'להסיר את האורח?',
  guestAdded: 'האורח נוסף',
  guestSaved: 'נשמר',
  guestRemoved: 'האורח הוסר',
  guestErrorGameFull: 'המחזור מלא — הסר שחקן או אורח קיים',
  guestErrorGameNotOpen: 'המחזור אינו פתוח להרשמה — אי אפשר להוסיף אורחים',
  guestErrorPermission: 'רק מנהל יכול לערוך אורחים',
  guestErrorGeneric: 'הפעולה נכשלה',
  guestRemoveConfirmBody: (name: string) =>
    `${name} יוסר מהמחזור (כולל מרשימת ההמתנה). אפשר להוסיף שוב בכל עת.`,
  guestRemovedToast: 'האורח הוסר מהמחזור',
  guestAddedByLine: (name: string, when: string) => `צורף ע״י ${name} · ${when}`,
  communityDetailsAdminBadge: 'מנהל',
  communityEditTitle: 'עריכת מועדון',
  communityEditNoPermission: 'רק מנהל יכול לערוך את המועדון',
  communityEditRecurringEnabled: 'מחזור שבועי',
  communityEditRecurringHint:
    'מחזור שחוזר כל שבוע. כ-3 שעות אחרי שהמחזור מסתיים נפתח אוטומטית מחזור זהה לשבוע הבא (אותו יום ושעה), כך שלא צריך לפתוח ידנית כל שבוע. אם הגדרת גם תזמון פתיחת הרשמה — הוא יוזז שבוע קדימה יחד עם המחזור.',
  communityEditSectionBasics: 'פרטים בסיסיים',
  communityEditSectionSchedule: 'מתי מחזורים',
  communityEditSectionSettings: 'הגדרות מועדון',
  communityEditSectionExtra: 'פרטים נוספים',
  communityEditIsOpenHint: 'כשמופעל, שחקנים מצטרפים ללא אישור מנהל',
  communityEditTimeUnset: 'לא הוגדר',
  communityEditTimePick: 'בחר שעה',
  communityEditPreferredDaysLabel: 'ימי מחזור קבועים',
  communityEditPreferredHourLabel: 'שעה קבועה',
  communityEditOptional: 'לא חובה',
  /** Schedule preview shown under section B when enough data exists.
   *  Strips a leading "ה" off the field name so the "ב" prefix doesn't
   *  produce "בה_field_" (e.g. "המגרש של אלירן" → "במגרש של אלירן"). */
  communityEditSchedulePreview: (day: string, hour: string, field: string) => {
    const trimmed = field.trim();
    if (!day || !hour || !trimmed) return '';
    const fieldStem = trimmed.startsWith('ה') ? trimmed.slice(1) : trimmed;
    return `מחזור שבועי בימי ${day} בשעה ${hour} ב${fieldStem}`;
  },
  communityDetailsCreatorBadge: 'מייסד',
  communityDetailsPromoteCoach: 'הפוך למנהל',
  communityDetailsDemoteCoach: 'הסר מנהל',
  communityDetailsDemoteConfirmTitle: 'להוריד את המנהל?',
  communityDetailsDemoteConfirm: 'הסר',
  communityDetailsContactAdmin: 'צור קשר עם המנהל',
  communityViewStatsTable: 'טבלת המועדון והסטטיסטיקות',
  communityLastCycleTitle: 'מהמחזור האחרון',
  communityBroughtBall: 'הביא כדור',
  communityBroughtJerseys: 'הביא גופיות',
  communityDetailsChatAdmin: "שלח הודעה בצ'אט",
  communityDetailsInvite: 'הזמן שחקנים',
  communityDetailsLeave: 'עזוב מועדון',
  communityDetailsLeaveConfirmTitle: 'לעזוב את המועדון?',
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
    const lines: string[] = [`הוזמנת להצטרף למועדון ${args.name} ב־Teamder ⚽`];
    const desc = args.description?.trim();
    if (desc) lines.push('', desc);
    lines.push('', args.link);
    return lines.join('\n');
  },
  communityMembersCount: (n: number) =>
    n === 1 ? 'שחקן אחד' : `${n} שחקנים`,
  // Community details — redesign strings
  communityNextGameTitle: 'מחזור קרוב',
  communityNextGameNone: 'לא נקבע מחזור קרוב',
  communityNextGameCta: 'לצפייה בפרטי המחזור',
  communityNextGameLocked: 'ההרשמה תיפתח בקרוב',
  communityNextGameLockedBody: (when: string) =>
    `המחזור יופיע בפיד וההרשמה תיפתח ב-${when}.`,
  communityNextGameCreateRecurring: 'תזמן מחזור שבועי למועדון',
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
  communityPlayersEmpty: 'אין עדיין שחקנים בסגל',
  communityPlayersScreenTitle: 'הסגל',
  // Scoped to the community we're looking at — without the context
  // word "כאן" the count read as "1 מחזור (everywhere?)" and
  // confused users on the community players screen.
  communityPlayerGames: (n: number) =>
    n === 1 ? 'מחזור אחד כאן' : `${n} מחזורים כאן`,
  communitySummaryPlayers: 'שחקנים',
  communitySummaryDays: 'ימי מחזור',
  communitySummaryHour: 'שעת מחזור',
  communitySummaryField: 'מגרש',
  communityNotifyRow: 'עדכן אותי על מחזורים חדשים במועדון',
  // Community redesign — stadium-style premium UI
  communityHeroLabel: 'מועדון',
  communityHeroDetailsTitle: 'פרטי מועדון',
  communityCoverChange: 'החלף תמונת רקע',
  communityCoverUploading: 'מעלה…',
  communityCoverUploadFailed: 'העלאת תמונת הרקע נכשלה. נסה שוב.',
  communityCoverUpdated: 'תמונת הרקע עודכנה',
  // Cover image picker (gallery + device upload)
  coverPickerTitle: 'תמונת נושא למועדון',
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
  communityRemoveMember: 'הסר מהמועדון',
  // Creator-only member management (promote/demote admins).
  communityManageMember: 'נהל חבר',
  communityManageMemberBody: 'בחר פעולה',
  communityPromoteAdmin: 'מנה למנהל',
  communityDemoteAdmin: 'הסר ממנהלים',
  communityPromoteAdminDone: 'המשתמש מונה למנהל',
  communityDemoteAdminDone: 'המנהל הוסר מהניהול',
  communityRemoveMemberConfirmTitle: 'להסיר שחקן מהמועדון?',
  communityRemoveMemberConfirmBody: (name: string) =>
    `${name} לא יוכל לראות יותר תוכן פנימי של המועדון. ניתן להזמין מחדש בכל עת.`,
  communityRemoveMemberDone: 'החבר הוסר מהמועדון',
  communityRemoveMemberCreatorBlocked: 'לא ניתן להסיר את מייסד המועדון',
  friendsActionFailed: 'הפעולה נכשלה. נסה שוב.',
  friendsMineTitle: (n: number) => `החברים שלי (${n})`,
  friendsEmpty: 'עדיין אין לך חברים. שלח בקשת חברות לשחקנים שפגשת במחזורים.',
  friendsEmptyCtaTitle: 'בנה לעצמך רשימת חברים',
  friendsEmptyCtaBody: 'הזמן חברים מרשימת אנשי הקשר שלך — תוכל להזמין אותם ישירות למחזורים בלחיצה אחת.',
  friendsEmptyCtaButton: 'הזמן חברים לאפליקציה',
  friendsAccept: 'אשר',
  friendsDecline: 'דחה',
  // Unified "Requests" inbox (header bell)
  requestsTitle: 'בקשות',
  requestsEmpty: 'אין בקשות ממתינות',
  requestsEmptyHint: 'בקשות חברות, הצטרפות למועדונים ולמחזורים יופיעו כאן.',
  requestsFriends: 'בקשות חברות',
  requestsCommunitySection: (name: string) => `הצטרפות ל${name}`,
  requestsGameSection: (name: string) => `הצטרפות ל${name}`,
  requestsApproveAll: 'אשר הכל',
  requestsApproveAllConfirmTitle: 'אישור מרובה',
  requestsApproveAllConfirmBody: (n: number) => `לאשר את כל ${n} הבקשות?`,
  requestsApprovedToast: (n: number) => (n === 1 ? 'בקשה אחת אושרה' : `${n} בקשות אושרו`),
  requestsPartial: (ok: number, fail: number) => `${ok} אושרו, ${fail} נכשלו`,
  requestsActionFailed: 'הפעולה נכשלה, נסה שוב',
  requestsApprovedToWaitlist: 'המחזור מלא — השחקן אושר ונכנס לרשימת ההמתנה',
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
  friendsRejected: 'הבקשה נדחתה',
  friendsRequestSent: 'בקשת חברות נשלחה',
  // ── Quick-game wizard ────────────────────────────────────────────
  wizardVisibilityPrivate: 'פרטי (בהזמנה בלבד)',
  wizardVisibilityPublicOpen: 'פתוח לכולם',
  wizardInviteFriends: 'הזמן חברים',
  wizardInviteFriendsEmpty:
    'אין לך עדיין חברים להזמין. אפשר לשתף קישור למחזור אחרי היצירה, ולהוסיף חברים מכרטיס השחקן.',
  // Quick-vs-community chooser on the "+" button
  createGameChooseTitle: 'איזה מחזור ליצור?',
  createGameChooseQuickTitle: 'מחזור מהיר',
  createGameChooseQuickBody: 'מחזור חד־פעמי בלי לפתוח מועדון. אתה מזמין ידנית את מי שתרצה לשחק.',
  createGameChooseCommunityTitle: 'מחזור למועדון',
  createGameChooseCommunityBody: 'מחזור למועדון קיים שלך. כל החברים יראו אותו אוטומטית.',
  createGameChooseQuick: 'מחזור מהיר',
  createGameChooseCommunity: 'מחזור למועדון',
  // Invite friends to an existing community
  communityMenuInviteFriends: 'הזמן חברים למועדון',
  communityInviteFriendsSend: (n: number) =>
    n > 1 ? `שלח ${n} הזמנות` : n === 1 ? 'שלח הזמנה' : 'בחר חברים להזמנה',
  communityInviteFriendsFailed: 'שליחת ההזמנות נכשלה. נסה שוב.',
  groupWizardSubmitFailed: 'יצירת המועדון נכשלה. נסה שוב.',
  communityInviteFriendsSent: (n: number) =>
    n > 1 ? `נשלחו ${n} הזמנות` : n === 1 ? 'נשלחה הזמנה' : 'אין חברים חדשים להזמין',
  communityStatsCreatedAt: 'תאריך הקמה',
  communityStatsMembers: 'סגל',
  communityStatsField: 'מגרש קבוע',
  communityStatsMatchesHeld: 'מפגשים שנערכו',
  communityNotifyDesignTitle: 'עדכנו אותי על מחזורים חדשים במועדון',
  communityNextGameDetailsCta: 'לפרטי מחזור',
  communityPlayersActiveTitle: 'שחקנים פעילים',
  // Hamburger menu sections for community
  communityMenuSectionCommunity: 'מועדון',
  communityMenuSectionPlayers: 'שחקנים',
  communityMenuSectionActions: 'פעולות',
  communityMenuApprovals: 'בקשות ממתינות לאישור',
  communityMenuRecurringGame: 'צור מחזור חוזר',
  communityMenuContactAdmin: 'צור קשר עם המנהל',
  communityMenuShareInvite: 'שתף הזמנה למועדון',

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
  // Screenshot-triggered bug report
  screenshotReportTitle: 'צילמת מסך — לדווח על באג?',
  screenshotReportSubtitle: 'צירפנו את הצילום אוטומטית. ספר/י בקצרה מה לא תקין.',
  screenshotReportAttached: 'הצילום צורף',
  screenshotReportPlaceholder: 'מה הבאג? (לא חובה)',
  screenshotReportSend: 'שליחת דיווח',
  screenshotReportSent: 'הדיווח נשלח עם הצילום, תודה! 🙏',
  screenshotReportDefaultMsg: 'דיווח על באג מצילום מסך',
  screenshotAnnotateCta: 'סמן על הצילום',
  screenshotAnnotateTitle: 'סימון על הצילום',
  screenshotAnnotateHint: 'צייר/י עם האצבע לסמן מה לא תקין',
  screenshotAnnotateUndo: 'בטל',
  screenshotAnnotateClear: 'נקה',
  screenshotAnnotateDone: 'שמירה',

  // Invite
  inviteShareTitle: 'הזמן שחקנים',
  inviteShareSubject: 'הצטרף למועדון הכדורגל שלנו ⚽',
  inviteShareBody: (groupName: string, link: string) =>
    `הצטרף למועדון הכדורגל שלנו באפליקציה ⚽\nשם המועדון: ${groupName}\nלחץ כאן כדי לבקש להצטרף: ${link}`,

  // Onboarding
  onbSkip: 'דלג',
  onbNext: 'הבא',
  onbStart: 'בוא נתחיל',
  onbCtaSignIn: 'התחבר עם Google',
  onbCtaSignInApple: 'התחבר עם Apple',
  onbCtaStart: 'המשך',
  onb1Title: 'שחקו עם אנשים בקרבת מקום',
  onb1Body: 'גלו מחזורי כדורגל פתוחים באזור שלכם והצטרפו בלחיצה — או פגשו שחקנים חדשים לידכם',
  onb2Title: 'מועדון קבוע, מחזור אוטומטי',
  onb2Body: 'בנו את הסגל הקבוע שלכם — והמחזור השבועי נפתח לבד עם הזמנה לכולם',
  onb3Title: 'הכל זורם מעצמו',
  onb3Body: 'מישהו ביטל? המקום מתמלא אוטומטית מחזורנים מתאימים. ותזכורות חכמות דואגות שכולם יגיעו',
  // 4th = final CTA screen — see onbStart / onbCtaSignIn above
  // (kept onb4* as legacy strings in case any UI still references them)
  onb4Title: 'בוא נתחיל',
  onb4Body: 'התחבר ותתחיל לארגן מחזורים',

  // Auth
  signInTitle: 'בואו נתחיל',
  signInSubtitle: 'התחבר כדי להירשם, להצטרף למועדון ולעקוב אחרי הסטטיסטיקות שלך.',
  signInGoogle: 'המשך עם Google',
  signInApple: 'המשך עם Apple',
  signInEmail: 'המשך עם מייל',
  signInGuest: 'המשך כאורח',
  signInPrivacy: 'באמצעות התחברות אתה מסכים לתנאי השימוש',
  // Guest → register prompt (shown when a guest taps an account action)
  guestRegisterTitle: 'נדרשת הרשמה',
  guestRegisterBody: 'כדי להשתמש בתכונה הזו צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterJoinGame: 'כדי להירשם למחזור צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterJoinCommunity: 'כדי להצטרף למועדון צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterChatAdmin: 'כדי לשלוח הודעה למנהל צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterCreate: 'כדי ליצור צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterChat: 'כדי להשתמש בצ׳אט צריך חשבון. רוצה להירשם עכשיו?',
  guestRegisterCta: 'הרשמה',
  guestProfileTitle: 'הפרופיל שלך מחכה',
  guestProfileBody:
    'אתה גולש כאורח. הירשם כדי לשמור מחזורים, להצטרף למועדונים ולבנות פרופיל שחקן.',
  // Email + password screen
  emailAuthSignInTitle: 'התחברות עם מייל',
  emailAuthSignUpTitle: 'הרשמה עם מייל',
  emailAuthEmailLabel: 'כתובת מייל',
  emailAuthEmailPlaceholder: 'name@example.com',
  emailAuthPasswordLabel: 'סיסמה',
  emailAuthPasswordPlaceholder: 'לפחות 6 תווים',
  emailAuthConfirmPasswordLabel: 'אימות סיסמה',
  emailAuthConfirmPasswordPlaceholder: 'הקלד שוב את הסיסמה',
  emailAuthPasswordMismatch: 'הסיסמאות לא תואמות',
  emailAuthSignInCta: 'התחבר',
  emailAuthSignUpCta: 'הרשמה',
  emailAuthToggleToSignUp: 'אין לך חשבון? הרשמה',
  emailAuthToggleToSignIn: 'כבר יש לך חשבון? התחבר',
  emailAuthForgot: 'שכחת סיסמה?',
  emailAuthInvalidEmail: 'כתובת מייל לא תקינה',
  emailAuthWeakPassword: 'הסיסמה חייבת להכיל לפחות 6 תווים',
  emailAuthWrongCredentials: 'מייל או סיסמה שגויים',
  emailAuthTooManyAttempts: 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.',
  emailAuthGenericError: 'משהו השתבש, נסה שוב',
  emailAuthAlreadyInUse:
    'המייל הזה כבר רשום. אם נרשמת עם מייל וסיסמה — עבור להתחברות. אם נרשמת עם Google/Apple — חזור והשתמש בכפתור המתאים.',
  emailAuthSwitchToSignIn: 'עבור להתחברות',
  emailAuthRegisteredWithGoogle: 'הכתובת הזו כבר רשומה דרך Google. התחבר עם Google.',
  emailAuthRegisteredWithApple: 'הכתובת הזו כבר רשומה דרך Apple. התחבר עם Apple.',
  emailAuthResetSentTitle: 'נשלח מייל איפוס',
  emailAuthResetSentBody: (email: string) =>
    `שלחנו קישור לאיפוס סיסמה אל ${email}. בדוק את תיבת הדואר (וגם ספאם).`,
  emailAuthResetNeedEmail: 'הקלד קודם את כתובת המייל שלך',
  // Password re-prompt for deleting an email/password account
  deleteAccountPasswordPrompt: 'לאישור המחיקה, הקלד את הסיסמה שלך',
  deleteAccountPasswordPlaceholder: 'הסיסמה שלך',

  // Profile setup
  profileTitle: 'בוא נכיר',
  profileName: 'שם',
  profileNamePlaceholder: 'איך לקרוא לך?',
  profileNameRequired: 'שם הוא שדה חובה',
  profileSave: 'שמור והמשך',
  profileEdit: 'ערוך כרטיס שחקן',

  // Player card
  playerCardTotalGames: 'מחזורים',
  playerCardAttendance: 'אחוז הגעה',
  playerCardCancelRate: 'אחוז ביטולים',
  // Successful-referral stat — counts users whose invitedBy points
  // at this profile. Helper text clarifies the source so the value
  // isn't confused with "joined my game" / "joined my community".
  playerCardReferrals: 'צירף לאפליקציה',
  playerCardReferralsHelper: 'משתמשים שנרשמו דרך קישור שלך',
  playerCardReferralsHelperOther: 'משתמשים שהוא צירף לאפליקציה',
  playerCardInvite: 'הזמן למחזור',
  playerCardNotAvailable: 'לא זמין להזמנות',
  playerCardNotFound: 'לא הצלחנו לטעון את השחקן',
  playerCardEmail: 'אימייל',
  playerCardNoGameToInvite: 'אין לך מחזור פעיל להזמנה. צור מחזור קודם.',
  playerCardInviteSent: 'הזמנה נשלחה',
  playerCardSelf: 'זה אתה',
  playerCardAlreadyJoined: 'כבר רשום למחזור שלך',
  playerCardAlreadyWaitlist: 'בספסל למחזור שלך',
  playerCardAlreadyPending: 'ממתין לאישור למחזור שלך',
  playerCardInviteSentToast: 'הזמנה נשלחה ל{name}',
  playerCardLoadingGame: 'טוען את המחזור הקרוב…',
  playerCardInviteFailed: 'שליחת ההזמנה נכשלה. נסה שוב.',

  // Discipline (yellow / red cards)
  disciplineTitle: 'כרטיסים',
  disciplineNoCards: 'אין כרטיסים — שמרת על שם נקי',
  disciplineRecent: 'אירועים אחרונים',
  disciplineYellow: 'כרטיס צהוב',
  disciplineRed: 'כרטיס אדום',
  disciplineReasonLate: 'איחור למחזור',
  disciplineReasonNoShow: 'אי-הגעה למחזור',
  disciplineReasonManual: 'הוצא ידנית',
  disciplineCoachActions: 'ניהול כרטיסים',
  disciplineGiveYellow: 'תן כרטיס צהוב',
  disciplineGiveRed: 'תן כרטיס אדום',
  disciplineRevoke: 'הסר',
  disciplineConfirmRevoke: 'להסיר את הכרטיס?',
  disciplineWarningRecentRed: 'התקבל כרטיס אדום לאחרונה',
  // Snapshot caption — shown under the yellow/red display so the
  // user understands the window. We surface "10 המחזורים האחרונים"
  // when the user has at least 10 terminal games on file, and the
  // truncated "X מחזורים אחרונים" otherwise.
  disciplineSnapshotTitle: 'משמעת (10 מחזורים אחרונים)',
  disciplineSnapshotCaptionFull: 'מתוך 10 המחזורים האחרונים',
  disciplineSnapshotCaptionPartial: (n: number) =>
    `מתוך ${n} מחזורים אחרונים`,
  disciplineSnapshotEmpty: 'אין עדיין היסטוריית מחזורים להצגה',
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
  trustMeterCaption: (n: number) => `על בסיס ${n} מחזורים אחרונים`,
  trustMeterCaptionEmpty: 'תקבל מד אמינות אחרי 3 מחזורים שתסיים',
  trustMeterUnavailable: 'אין נתונים זמינים',
  trustTierExcellent: 'מצוין',
  trustTierGood: 'טוב',
  trustTierBasic: 'בסיסי',
  trustTierLow: 'נמוך',
  trustTierNew: 'חדש',
  trustBreakdownAttended: (att: number, reg: number) =>
    `הופיע ב־${att} מתוך ${reg} מחזורים`,
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
    'שחקנים מחוץ למועדון שמעוניינים למלא את החסר. אישור יכניס אותם לרוסטר.',
  fillerApprove: 'אישור',
  fillerDecline: 'דחייה',
  fillerApproveSuccess: 'השחקן נוסף למחזור',
  fillerApproveStale:
    'המקום כבר התמלא או שהמחזור נסגר',
  fillerDeclineConfirmTitle: 'דחיית מועמדות',
  fillerDeclineConfirmBody: (name: string) =>
    `לדחות את ${name}? לא תוכל לבחור בו שוב למילוי המחזור הזה.`,
  fillerDeclineConfirm: 'דחה',
  fillerDefaultName: 'שחקן',

  // Achievements (תארים)
  achievementsTitle: 'תארים אישיים',
  achievementsCount: (unlocked: number, total: number) =>
    `${unlocked} מתוך ${total}`,
  achievementsSeeAll: 'הצג הכל',
  achievementsEmpty: 'עוד לא נפתחו תארים. תתחיל לשחק!',
  achievementsLockedHint: 'נפתח אחרי שתעבור את היעד',
  // Tiered badges — progress + tier copy.
  achievementTierReached: (tierHe: string) => `דרגת ${tierHe}`,
  achievementTierGoal: (threshold: number, noun: string) => `${threshold} ${noun}`,
  achievementProgressToNext: (current: number, target: number, tierHe: string) =>
    `${current}/${target} ל${tierHe}`,
  achievementMaxed: 'הגעת לדרגה הגבוהה ביותר! 🏆',
  // The player's actual accomplishment for this badge, e.g. "כבר 10 שערים".
  achievementYourTally: (value: number, noun: string) => `כבר ${value} ${noun}`,
  // "How do I earn this?" — action phrase + the tier targets.
  achievementHowTitle: 'איך משיגים?',
  achievementTiersLine: (bronze: number, silver: number, gold: number) =>
    `יעדים: ${bronze} (ברונזה) · ${silver} (כסף) · ${gold} (זהב)`,
  // Celebration overlay copy.
  achievementCelebrateKicker: 'כל הכבוד!',
  achievementCelebrateTier: (tierHe: string) => `פתחת דרגת ${tierHe}!`,
  achievementCelebrateOneOff: 'תואר חדש נפתח!',
  achievementCelebrateCta: 'אדיר!',
  // What earned this tier — the milestone you reached (e.g. "5 חברים").
  achievementCelebrateEarned: (threshold: number, nounHe: string) =>
    `הגעת ל-${threshold} ${nounHe}`,
  // What the NEXT tier needs. `remaining` is how many more to go.
  achievementCelebrateNext: (
    tierHe: string,
    remaining: number,
    nounHe: string,
  ) => `לדרגת ${tierHe}: עוד ${remaining} ${nounHe}`,
  // Shown instead of the "next tier" line once gold (top tier) is reached.
  achievementCelebrateMaxed: 'הדרגה הגבוהה ביותר — כל הכבוד!',

  // ── Home screen (the player-card-turned-dashboard) ──────────────────
  homeChecklistTitle: 'בוא נתחיל',
  homeChecklistSubtitle: 'כמה צעדים קטנים כדי להפיק את המקסימום',
  homeStepPhoto: 'הוספת תמונת פרופיל',
  homeStepAvailability: 'סמן מתי אתה פנוי',
  homeStepCommunity: 'הצטרף או פתח מועדון',
  homeStepGame: 'הצטרף או צור מחזור ראשון',
  homeStepInvite: 'הבא חבר למגרש',
  homeStepPosition: 'בחר עמדה מועדפת',
  // Preferred-position picker (ProfileEdit) + labels.
  positionLabel: 'עמדה מועדפת',
  positionGk: 'שוער',
  positionDef: 'הגנה',
  positionMid: 'קישור',
  positionAtt: 'התקפה',
  homeDidYouKnowTitle: 'ידעת ש...',
  homeTipAutoTeams: 'אפשר ליצור כוחות מאוזנים אוטומטית לפי דירוג השחקנים',
  homeTipInternalRating: 'דירוג פנימי של שחקנים עוזר לאזן קבוצות הוגנות',
  homeTipAvailability: 'סמן מתי אתה פנוי — ומנהלים יזמינו אותך למחזורים',
  homeTipScheduled: 'אפשר לתזמן מראש מתי נפתחת ההרשמה למחזור',
  homeTipCommunity: 'פתח מועדון כדי לנהל קבוצה קבועה עם דירוגים וכוחות',
  homePendingRequests: (n: number) =>
    `${n} ${n === 1 ? 'בקשת הצטרפות ממתינה' : 'בקשות הצטרפות ממתינות'} לאישור`,
  // Generic (mixes friend / community-join / game-join requests) for the
  // top-of-home inbox banner.
  homePendingInbox: (n: number) =>
    `${n} ${n === 1 ? 'בקשה ממתינה' : 'בקשות ממתינות'} לך`,
  homeCreateGame: 'צור מחזור',
  homeMarkAvailability: 'סמן זמינות',
  // ── Home dashboard (redesign) ──
  homeBrandName: 'Teamder',
  homeNextGameTitle: 'המחזור הקרוב שלך',
  homeGameTypeRegular: 'מחזור רגיל',
  homeGameDetailsCta: 'לפרטי המחזור',
  homeRosterFull: 'ההרכב מלא',
  homeSpotsLeft: (n: number) =>
    n === 0 ? '0 מקומות פנויים' : n === 1 ? 'מקום פנוי אחד' : `${n} מקומות פנויים`,
  homeNoGameTitle: 'אין לך מחזור קרוב',
  homeNoGameBody: 'מצא מחזור פתוח או פתח מחזור חדש',
  homeNoGameCta: 'מצא מחזור',
  // "Coming soon" teaser — a community game whose registration hasn't opened yet.
  homeUpcomingSectionTitle: 'בקרוב במועדונים שלך',
  homeUpcomingBadge: 'מחזור בדרך',
  homeUpcomingRegistration: (label: string) => `ההרשמה ${label}`,
  homeUpcomingOpensAt: (dayDate: string, time: string) =>
    `תיפתח ${dayDate} ב-${time}`,
  homeUpcomingOpensInMinutes: (mmss: string) => `תיפתח בעוד ${mmss} דק׳`,
  homeUpcomingOpeningNow: 'נפתחת עכשיו',
  // Recommended day to open a game (most available players nearby).
  homeRecommendedTitle: 'היום המומלץ לפתיחת מחזור',
  homeRecommendedLine: (day: string, n: number) => `יום ${day}׳ • ${n} פנויים`,
  // Three action tiles.
  homeActionOpenTitle: 'פתח מחזור',
  homeActionOpenSub: 'ארגן מחזור משלך',
  homeActionAvailTitle: 'סמן זמינות',
  homeActionAvailSub: 'עדכן את הנוכחות שלך',
  homeActionJoinTitle: 'הצטרף למחזור',
  homeActionJoinSub: 'מצא מחזורים פתוחים',
  // "Available by (evening) window" — per-day evening counts.
  homeWindowsTitle: 'פנויים לידך',
  homeWindowsPlayersUnit: 'שחקנים',
  homeWindowsShowWeek: 'הצג שבוע מלא',
  homeAvailCount: (n: number) => `${n} פנויים`,
  homeDayLabel: (letter: string) => `יום ${letter}׳`,
  // Smart contextual banner — ALWAYS a time-of-day greeting + name, then one
  // contextual suffix chosen by the player's current state. `homeGreetingLine`
  // builds the prefix; the rest are the suffixes.
  homeGreetingLine: (greeting: string, name: string) =>
    name ? `${greeting} ${name}, ` : `${greeting}, `,
  homeBannerGameToday: (t: string) => `המחזור שלך היום ב-${t} — מוכן? ⚽`,
  homeBannerGameTomorrow: (t: string) => `המחזור שלך מחר ב-${t} 📅`,
  homeBannerRequests: (n: number) =>
    `יש ${n === 1 ? 'בקשה אחת שממתינה' : `${n} בקשות שממתינות`} לך 👋`,
  homeBannerSetAvailability: 'סמנו זמינות ונמצא לכם מחזורים לידכם 👋',
  homeBannerJoinCommunity: 'כדאי להצטרף למועדון כדי לשחק בקביעות ⚽',
  homeBannerPlayedThisWeek: (n: number) =>
    `השבוע כבר שיחקת ${n === 1 ? 'פעם אחת' : `${n} פעמים`}! 👏`,
  homeBannerNoGameThisWeek: 'השבוע עוד לא קבעת מחזור — יאללה, נקבע אחד? ⚽',
  homeBannerDaysSincePlayed: (d: number) =>
    `לא שיחקת כבר ${d} ימים — בוא נחזיר אותך למגרש 🔥`,
  homeBannerWelcome: 'טוב לראות אותך! מוכן למחזור הבא? ⚽',
  // ── Statistics screen ──
  statsScreenTitle: 'סטטיסטיקה',
  statsSectionNumbers: 'המספרים שלך',
  statsSectionPeople: 'החבר׳ה שלך',
  statsSectionPenalties: 'פנדלים',
  statsSectionPenaltiesKicker: 'פנדלים — כבועט',
  statsSectionPenaltiesKeeper: 'פנדלים — כשוער',
  statPenScored: 'פנדלים שהוכנסו',
  statPenRate: 'אחוז הבקעה',
  statPenSaves: 'פנדלים שנעצרו',
  statPenSaveRate: 'אחוז עצירה',
  statsMenuLabel: 'סטטיסטיקה',
  statGames: 'מחזורים',
  statAttendance: 'אחוז הגעה',
  statGoals: 'שערים',
  statAssists: 'בישולים',
  statGoalsPerEvening: 'גולים למחזור',
  statDistinctPlayers: 'שחקנים שונים',
  statMostPlayedWith: 'השותף הקבוע',
  statMostPlayedWithSub: (n: number) => `${n} מחזורים יחד`,
  statMostWinsWith: 'הצמד המנצח',
  statMostWinsWithSub: (n: number) => (n === 1 ? 'ניצחון אחד יחד' : `${n} נצחונות יחד`),
  statBiggestVictim: 'היריב שלך',
  statBiggestVictimSub: (n: number) => (n === 1 ? 'ניצחת אותו פעם אחת' : `ניצחת אותו ${n} פעמים`),
  statNemesis: 'היריב הקשה',
  statNemesisSub: (n: number) => (n === 1 ? 'ניצח אותך פעם אחת' : `ניצח אותך ${n} פעמים`),
  statMostAssistedTo: 'הכי בישלת לו',
  statMostAssistedToSub: (n: number) =>
    n === 1 ? 'בישלת לו פעם אחת' : `בישלת לו ${n} פעמים`,
  statMostAssistedBy: 'הכי בישל לך',
  statMostAssistedBySub: (n: number) =>
    n === 1 ? 'בישל לך פעם אחת' : `בישל לך ${n} פעמים`,
  statsScreenEmpty: 'עוד אין מספיק נתונים — תתחיל לשחק והמספרים יתחילו להצטבר!',
  statsPersonEmpty: 'עדיין אין מספיק מחזורים',
  achievementCategoryGames: 'מחזורים',
  achievementCategoryWins: 'ניצחונות',
  achievementCategoryTeams: 'מועדונים',
  achievementCategoryInvites: 'הזמנות',
  achievementCategoryCoaching: 'ניהול',
  achievementUnlockedAt: (d: string) => `נפתח ב-${d}`,

  // (Jersey picker strings retired — replaced by profile photo /
  // avatar picker in profilePhoto* / profileAvatar* keys above.)

  // Availability editor
  availabilityTitle: 'זמינות שלי',
  availabilityIntro: 'איך אנחנו יודעים מתי להציע לך מחזורים',
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
  availabilityCityHint: 'נשמש לאיתור מועדונים וזימוני מחזורים קרובים',
  availabilityCities: 'ערים שאני מוכן לשחק בהן',
  availabilityCitiesPlaceholder: 'הוסף עיר',
  availabilityCitiesHint: 'בחר עיר מהרשימה והקש כדי להוסיף. ניתן להוסיף כמה.',
  availabilityCityRemove: 'הסר',
  availabilityHomeCity: 'עיר המגורים',
  availabilityHomeCityPlaceholder: 'בחר עיר מהרשימה',
  availabilityHomeCityHint:
    'נשתמש בה יחד עם הרדיוס למצוא מחזורים קרובים אליך.',
  availabilityHomeCityMustPick:
    'חובה לבחור את העיר מהרשימה (לא טקסט חופשי).',
  availabilityRadius: (km: number) => `רדיוס למחזורים: עד ${km} ק"מ`,
  availabilityRadiusHint:
    'הרחק מעיר המגורים, נציע לך מחזורים במועדונים אחרים.',
  availabilityInvitable: 'זמין להזמנות למועדונים אחרים',
  availabilityInvitableHint: 'כשמכובה — שום שחקן לא יוכל לראות אותך כמועמד הזמנה',
  availabilityFillerPush: 'קבל הזמנות מילוי למועדונים אחרים',
  availabilityFillerPushHint:
    'תישלח לך התראה כשמועדון באזורך זקוק לשחקנים. תוכל לבחור אם להגיש מועמדות.',
  availabilitySave: 'שמור זמינות',

  // ── Redesigned availability screen ("מצא לי מחזורים") ──────────────
  availabilityHeaderTitle: 'מצא לי מחזורים ⚽',
  availabilityCardTitle: 'אנחנו נמצא לך מחזורים מתאימים!',
  availabilityCardBody:
    'בחר את הימים, הזמן והאזור שבו תרצה לשחק. נמצא לך מחזורים פתוחים עם שחקנים חסרים בסביבה שלך, ונזמין אותך כשמישהו פותח מחזור בחלון שסימנת. שחקנים אחרים באזור יראו כמה אנשים פנויים בכל חלון (רק המספר — לא מי) כדי לעודד פתיחת מחזורים.',
  // Home "פנויים לשחק לידך" calendar
  availFeedTitle: '⚽ פנויים לשחק לידך',
  availFeedSub: 'כמה שחקנים פנויים בכל חלון — ולא רשומים למחזור',
  availFeedRadius: (km: number) => `רדיוס ${km} ק״מ`,
  availFeedHottest: 'הכי חם:',
  availFeedCreateCta: 'פתח מחזור ⚡',
  availFeedTapHint: 'לחצו על חלון כדי לפתוח מחזור ולהזמין את הפנויים',
  availFeedPromptTitle: 'רוצה לראות מי פנוי לשחק לידך?',
  availFeedPromptBody:
    'הגדר את האזור והזמנים שנוח לך — ונראה לך כמה שחקנים פנויים בכל חלון, כדי לפתוח מחזור בקלות.',
  availFeedPromptCta: 'הגדר זמינות',
  availabilityDaysTitle: 'בחר ימי פעילות',
  /** Single-letter day badges, same index as weekdayLong (Sun→Sat). */
  availabilityDayLetter: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
  availabilityTimesTitle: 'שעת פעילות מועדפת',
  availabilityTimeMorning: 'בוקר',
  availabilityTimeNoon: 'צהריים',
  availabilityTimeEvening: 'ערב',
  availabilityTimeNight: 'לילה',
  /** Per-day availability grid (day × time-of-day). */
  availabilityGridTitle: 'מתי אני פנוי',
  /** Full weekday names, same index as availabilityDayLetter (Sun→Sat). */
  availabilityDayName: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  availabilityTimeRangeMorning: '6–12',
  availabilityTimeRangeNoon: '12–17',
  availabilityTimeRangeEvening: '17–23',
  availabilityQuickFill: 'מילוי מהיר',
  availabilityPresetEvenings: 'כל הערבים',
  availabilityPresetWeekend: 'סופ״ש',
  availabilityPresetClear: 'נקה הכל',
  availabilityLegendFree: 'פנוי',
  availabilityLegendBusy: 'לא פנוי',
  availabilityAreaTitle: 'אזור הבית הקבוע שלך',
  availabilityAreaHint:
    'סמן על המפה או חפש עיר. זה אזור קבוע — נשאר גם אם תיסע לחופשה, ולא נלקח מהמיקום הנוכחי.',
  availabilitySearchCity: 'חפש עיר / אזור',
  availabilityUseCurrent: 'השתמש במיקום הנוכחי שלי',
  availabilityHomeAreaLabel: (city: string) => `אזור הבית: ${city}`,
  availabilityRangeTitle: 'טווח חיפוש',
  availabilityRangeValue: (km: number) => `${km} ק"מ`,
  availabilityNotifTitle: 'קבל התראות',
  availabilityNotifHint: 'שלח לי התראה כשיש מחזורים עם חסרים באזור שלי',
  availabilitySavePrefs: 'שמור העדפות',
  // Home-area gate — the feature is anchored to a FIXED home area the user
  // sets (on a map / by city), NOT their live GPS. Off until they enable it.
  availabilityLocationToggle: 'הגדרת אזור הבית שלי',
  availabilityLocationToggleHint:
    'קבע אזור קבוע (לא המיקום הנוכחי) — נמצא לך מחזורים פתוחים לידו.',
  availabilityLocationLockedTitle: 'הפעל כדי להגדיר אזור',
  availabilityLocationLockedHint:
    'הפעל את המתג למעלה כדי לסמן על המפה (או לחפש עיר) את אזור הבית הקבוע שלך, ולהגדיר ימים, שעות וטווח חיפוש.',
  // Kept for compatibility with the existing granted/not-granted branches;
  // both now say the same (the feature no longer depends on GPS permission).
  availabilityLocationLockedTitleGranted: 'הפעל כדי להגדיר אזור',
  availabilityLocationLockedHintGranted:
    'הפעל את המתג למעלה כדי לסמן על המפה (או לחפש עיר) את אזור הבית הקבוע שלך, ולהגדיר ימים, שעות וטווח חיפוש.',
  availabilityLocationToggleHintGranted:
    'קבע אזור קבוע (לא המיקום הנוכחי) — נמצא לך מחזורים פתוחים לידו.',

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
  profileSaveFailed: 'שמירת הפרופיל נכשלה. נסה שוב.',
  profilePhotoUnavailable:
    'בחירת תמונה לא זמינה כרגע. בחר אווטאר מוכן בינתיים.',
  profileEditUnsavedTitle: 'יש לך שינויים שלא נשמרו',
  profileEditUnsavedBody:
    'בחרת תמונה / אווטאר חדשים אבל לא לחצת על שמור. לשמור עכשיו?',
  profileEditUnsavedSave: 'שמור',
  profileEditUnsavedDiscard: 'התעלם וצא',
  gameEditUnsavedTitle: 'יש שינויים שלא נשמרו',
  gameEditUnsavedBody: 'שינית פרטים במחזור ולא שמרת. לשמור עכשיו?',
  groupEditUnsavedTitle: 'יש שינויים שלא נשמרו',
  groupEditUnsavedBody: 'שינית פרטים במועדון ולא שמרת. לשמור עכשיו?',
  validateRequired: 'יש להזין {field}',
  validateTooLong: '{field} ארוך מדי (עד {max} תווים)',
  validateOutOfRange: '{field} חייב להיות בין {min} ל-{max}',
  validationErrorTitle: 'לא ניתן לשמור את המחזור',
  gameOpenAfterKickoff: 'זמן פתיחת ההרשמה הציבורית / לאורחים חייב להיות לפני תחילת המחזור.',
  gamePublicBeforeReg: 'הפתיחה לכולם חייבת להיות אחרי פתיחת ההרשמה לחברי המועדון.',
  inviteRateLimited: 'שלחת יותר מדי הזמנות. נסה שוב מאוחר יותר.',
  inviteAlreadyJoined: 'השחקן כבר רשום למחזור.',
  inviteNotAllowed: 'אין לך הרשאה להזמין למחזור הזה.',
  inviteSelfNotAllowed: 'אי אפשר להזמין את עצמך.',
  psoProfileTitle: 'בוא נכיר',
  psoProfileSave: 'המשך',

  // Empty state — first-time main screen
  emptyHomeTitle: 'אין לך עדיין מחזורים',
  emptyHomeBody: 'צור מחזור חדש או הצטרף למחזור קיים',
  emptyHomePrimary: 'צור מחזור',
  emptyHomeSecondary: 'מצא מחזורים',
  // Shown instead of "מצא מחזורים" when there's nothing to find — both
  // tabs are empty, so the button would dead-end. Encourages the user
  // to be the one who starts a game in their community.
  emptyHomeNoGamesAnywhere: 'אין מחזורים פתוחים כרגע — היה הראשון לפתוח מחזור למועדון שלך',
  // Shown when a filter is active and nothing matches — there ARE games,
  // they're just filtered out, so we point at the filter, not "create".
  emptyHomeFilteredBody: 'אין מחזורים שתואמים לסינון',
  emptyHomeClearFilters: 'נקה סינון',

  // First-run hint (tooltip)
  hintCreateGame: 'כאן יוצרים מחזור חדש',
  hintGotIt: 'הבנתי',

  // Groups
  groupsChooseTitle: 'הצטרף למועדון',
  groupsChooseSub: 'אפשר להצטרף למועדון קיים או לפתוח חדש',
  groupsCreate: 'צור מועדון חדש',
  groupsJoin: 'הצטרף למועדון קיים',
  groupCreateTitle: 'יצירת מועדון',
  groupCreateName: 'שם המועדון',
  groupCreateField: 'שם המגרש',
  groupCreateAddress: 'כתובת המגרש',
  groupCreateSave: 'צור מועדון',
  groupJoinTitle: 'הצטרפות למועדון',
  groupJoinCodeLabel: 'קוד הזמנה',
  groupJoinCodePlaceholder: 'הקלד את הקוד שקיבלת',
  groupJoinSubmit: 'שלח בקשה',
  groupJoinSuccess: 'הבקשה נשלחה!',
  groupPendingTitle: 'הבקשה ממתינה לאישור',
  groupPendingBody: 'מנהל המועדון יקבל הודעה ויאשר אותך בקרוב.',
  groupNotFound: 'הקוד לא נמצא',
  groupAlreadyMember: 'אתה כבר במועדון הזה',
  groupAdminApprovalTitle: 'בקשות לסגל',
  groupAdminEmpty: 'אין בקשות חדשות',
  approve: 'אשר',
  reject: 'דחה',

  // Tabs
  tabGame: 'מחזורים',
  tabProfile: 'כרטיס שחקן',
  tabHome: 'בית',
  tabStats: 'סטטיסטיקה',
  tabHistory: 'היסטוריה',

  // Profile tab
  profileMyGroup: 'המועדון שלי',
  profileMyGroups: 'המועדונים שלי',
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
  // Typed-confirmation guard so the irreversible delete can't be tapped
  // by accident — the button stays disabled until the user types בטוח.
  profileDeleteAccountConfirmWord: 'בטוח',
  profileDeleteAccountTypePrompt: 'כדי לאשר, הקלידו בטוח',
  profileDeleteAccountInputPlaceholder: 'הקלידו כאן בטוח',
  profileDeleteAccountSuccess: 'החשבון נמחק',
  profileDeleteAccountFailed: 'מחיקת החשבון נכשלה. נסה שוב.',
  profileChangePhoto: 'שנה תמונה',
  profileChangeAvatar: 'הקש לשינוי התמונה',
  profilePickAvatar: 'בחר תמונת השחקן',
  profileUploading: 'מעלה תמונה...',
  profileUploadFailed: 'העלאת התמונה נכשלה',
  profilePermissionPhotos: 'נדרשת הרשאה לתמונות',
  profileGroupActive: 'פעיל',
  profileGroupSwitch: 'החלף',
  profileSectionStats: 'סטטיסטיקה',
  profileSectionHistory: 'היסטוריית מחזורים',
  profileSectionApprovals: 'בקשות לסגל',
  profileSectionAvailability: 'הזמינות שלי',
  profileSectionPlayerCard: 'הכרטיס שלי',
  // Hamburger label for the achievements view. Distinct word from the
  // existing "תארים" (which is the in-screen section title) — the user
  // asked specifically for "הישגים" in the menu.
  profileSectionMyAchievements: 'ההישגים שלי',
  profileSectionNotifications: 'התראות',
  profileSectionBlocked: 'משתמשים חסומים',
  blockedTitle: 'משתמשים חסומים',
  blockedIntro: 'משתמשים שחסמת לא רואים אותך בצ׳אט ואתה לא רואה אותם. אפשר לבטל חסימה בכל רגע.',
  blockedEmptyTitle: 'אין משתמשים חסומים',
  blockedEmptyHint: 'כשתחסום מישהו בצ׳אט הוא יופיע כאן.',
  blockedUnblockCta: 'בטל חסימה',
  blockedUnblockTitle: 'לבטל חסימה?',
  blockedUnblockBody: (name: string) =>
    `${name} יוכל שוב לראות את ההודעות שלך, ואתה את שלו.`,
  blockedUnblockDone: 'החסימה בוטלה',
  // New section labels for the redesigned profile
  profileSectionAccount: 'החשבון שלי',
  profileSectionMatches: 'מחזורים ולוח זמנים',
  profileSectionPreferences: 'התראות והעדפות',
  profileSectionSupport: 'עזרה ומשוב',
  profileBadgeAdmin: 'מנהל',
  profileBadgePlayer: 'שחקן',
  // Hamburger menu — section titles + meta strings.
  profileMenuOpen: 'פתח תפריט',
  profileMenuClose: 'סגור תפריט',
  profileMenuSectionProfile: 'כרטיס שחקן',
  profileMenuSectionGames: 'מחזורים',
  profileMenuSectionSystem: 'הגדרות',
  profileMenuSectionSupport: 'עזרה ומשוב',
  profileMenuSectionAccount: 'חשבון',
  profileStatTotalGames: 'מחזורים',
  profileStatAttendance: 'הגעה',
  profileStatWinRate: 'אחוז ניצחון',
  profileStatAttended: 'הופעות',
  profileStatClubs: 'מועדונים',
  profileStatWins: 'ניצחונות',
  profileMetaCommunities: (n: number) => `${n} מועדונים`,
  profileStatFriends: 'חברים',
  profileStatCancelRate: 'ביטולים',
  profileStatGoals: 'גולים',
  profileSubtitlePlayer: 'שחקן',
  profileStatInvited: 'שחקנים שהצטרפו דרכי',
  // Next-game card on the player's own profile (replaces the
  // achievements rail) — shows the soonest game the user is in.
  profileNextGameTitle: 'המחזור הקרוב שלך',
  profileNextGameEmptyTitle: 'אין לך מחזור קרוב',
  profileNextGameEmptyBody: 'עוד לא נרשמת למחזור. בוא נמצא לך אחד.',
  profileNextGameEmptyCta: 'חפש מחזור',
  // Hero meta row (under the name) — location · trust · communities.
  profileHeroCommunities: (n: number) =>
    n === 1 ? 'מועדון אחד' : `${n} מועדונים`,
  profileHeroTrust: (pct: number) => `${pct}% אמין`,
  // Availability summary card on the profile.
  profileAvailabilityTitle: 'זמינות למחזורים',
  profileAvailabilityDaysLabel: 'ימים זמינים',
  profileAvailabilityRadiusLabel: 'מרחק מועדף',
  profileAvailabilityRadiusValue: (km: number) => `עד ${km} ק"מ`,
  profileAvailabilityNoDays: 'לא נבחרו ימים',
  profileAvailabilityEmptyBody: 'הגדר מתי ואיפה נוח לך לשחק — ונמצא לך מחזורים מתאימים.',
  profileAvailabilityEmptyCta: 'הגדר זמינות',
  // Recent-activity feed on the profile — merged from achievements
  // unlocked + players who joined through the user.
  profileActivityTitle: 'פעילות אחרונה',
  profileActivityEmpty: 'אין עדיין פעילות להצגה',
  profileActivityAchievement: (title: string) => `פתחת תואר: ${title}`,
  profileActivityReferral: (name: string) => `${name} הצטרף דרך ההזמנה שלך`,
  profileActivityReferralAnon: 'שחקן חדש הצטרף דרך ההזמנה שלך',
  profileActivityCreatedGame: (title: string) => `יצרת מחזור · ${title}`,
  profileActivityRegisteredGame: (title: string) => `נרשמת למחזור · ${title}`,
  profileActivityOpenedCommunity: (name: string) => `פתחת מועדון · ${name}`,
  profileActivityJoinedCommunity: (name: string) => `הצטרפת למועדון · ${name}`,
  profileActivityToday: 'היום',
  profileActivityYesterday: 'אתמול',
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
  referralsScreenViaCommunity: 'דרך מועדון',
  referralsScreenViaGame: 'דרך מחזור',
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
  matchCardJoin: 'אני מגיע',
  matchCardWaitlist: 'המתנה',
  matchCardWaitlistCta: 'הצטרף לרשימת המתנה',
  matchCardLeave: 'בטל הרשמה',
  // Redesigned two-column card extras.
  matchCardManagedBy: (name: string) => `מנוהל ע״י ${name}`,
  matchCardJoinShort: 'הצטרף',
  matchCardInWaitlist: 'ברשימת המתנה',
  // Smart when-line: today/tomorrow collapse to "<day> ב-HH:MM"; further out
  // shows the date + time.
  matchCardWhenToday: (t: string) => `היום ב-${t}`,
  matchCardWhenTomorrow: (t: string) => `מחר ב-${t}`,
  matchCardWhenDate: (date: string, t: string) => `${date} · ${t}`,
  matchCardMore: (n: number) => `+${n}`,
  matchCardOccupancy: (n: number, max: number) => `${n}/${max}`,
  matchCardWeatherClear: 'בהיר',
  matchCardWeatherPartly: 'מעונן חלקית',
  matchCardWeatherRain: (p: number) => `גשם ${p}%`,
  matchCardPlayersOf: (n: number, max: number) => `‎${n}/${max}‎ שחקנים`,
  matchStatusOpen: 'פתוח להרשמה',
  matchStatusFull: 'מלא',
  matchStatusJoined: 'בהרכב',
  matchStatusWaitlist: 'בהמתנה',
  matchStatusPending: 'ממתין לאישור',
  // Visibility tag on the games list card
  matchTagOpenToAll: 'פתוח לכולם',
  matchTagCommunityOnly: 'סגור למועדון',
  matchTagQuickClosed: 'מחזור מהיר',
  // Registration is no longer open (locked by an admin, or the late-join
  // window passed) while the game itself is still upcoming — flags that you
  // can't sign up right now (user report).
  matchTagRegistrationClosed: 'הרשמה סגורה',
  // Urgency chip — surfaced when the game is full or nearly full so users
  // see scarcity at a glance, independent of their own registration state.
  matchStatusLastSpots: (n: number) =>
    n === 1 ? 'מקום אחרון' : `${n} מקומות אחרונים`,

  // Matches tab header / segmented tabs
  matchesTabMine: 'המחזורים שלי',
  matchesTabOpen: 'גלה מחזורים',
  // Section header inside "המחזורים שלי" tab — earlier it duplicated
  // "מחזורים פתוחים" from the other tab, which was confusing.
  matchesSectionMineRegistered: 'מחזורים שאתה רשום אליהם',
  // Matches screen redesign — hero / sections / empty card
  matchesHeroSubtitle: 'הצטרף למחזורים או צור מחזור חדש',
  // Personalised time-of-day greeting on the Matches hero.
  greetingMorning: 'בוקר טוב',
  greetingNoon: 'צהריים טובים',
  greetingEvening: 'ערב טוב',
  greetingNight: 'לילה טוב',
  greetingWithName: (g: string, name: string) => `${g}, ${name}`,
  // Availability nudge popup (shown to users who haven't marked their days).
  availNudgeTitle: 'מתי בא לך לשחק?',
  availNudgeBody:
    'סמן את הימים שאתה פנוי לשחק — ונציע לך אוטומטית מחזורים שמתאימים בדיוק לזמן שלך.',
  availNudgePerk1: 'הצעות מחזור לפי הימים שלך',
  availNudgePerk2: 'מנהלים יראו שאתה פנוי ויזמינו אותך',
  availNudgePerk3: 'פחות לפספס — יותר לשחק',
  availNudgeCta: 'סמן את הימים שלי',
  availNudgeLater: 'אחר כך',
  matchesSectionOpen: 'מחזורים פתוחים',
  matchesSectionMine: 'המחזורים שלי',
  matchesEmptyCardTitle: 'לא מצאת מחזור מתאים?',
  matchesEmptyCardSub: 'צור מחזור חדש ותן לאחרים להצטרף',
  matchCardJoinFull: 'הצטרף למחזור',
  matchesEmptyMine: 'עוד לא נכנסת להרכב של מחזור',
  matchesEmptyOpen: 'אין מחזורים פתוחים בקרבתך',

  // Match details screen
  matchDetailsTitle: 'פרטי המחזור',
  matchDetailsLoading: 'טוען את המחזור…',
  matchDetailsDate: 'תאריך ושעה',
  matchDetailsLocation: 'מיקום',
  matchDetailsField: 'סוג מגרש',
  matchDetailsFormat: 'פורמט',
  matchDetailsPlayers: 'ההרכב',
  matchDetailsManage: 'ניהול מחזור',
  matchDetailsCancel: 'בטל הרשמה',
  matchDetailsJoin: 'הצטרף למחזור',
  matchDetailsAcceptOffer: 'נפתח לך מקום — אשר הגעה',
  matchDetailsClosedForRegistration: 'ההרשמה נסגרה',
  matchDetailsRegistrationOpensAt: (when: string) =>
    `ההרשמה עדיין לא נפתחה — היא תיפתח ב-${when}`,
  matchDetailsAlreadyStarted: 'המחזור כבר התחיל',
  matchDetailsAlreadyLive: 'המחזור כבר במצב לייב',
  matchDetailsJoinRejected: 'בקשתך למחזור זה נדחתה ולא ניתן להירשם שוב.',
  matchDetailsAlreadyFinished: 'המחזור הסתיים',
  matchDetailsAlreadyCancelled: 'המחזור בוטל',
  matchDetailsTerminalSub: 'לא ניתן לבצע פעולות על המחזור הזה',
  matchDetailsNotFound: 'המחזור לא קיים יותר',
  // Stage 2 lifecycle CTAs / banners
  lifecycleCannotJoin: 'אין אפשרות להצטרף למחזור הזה',
  liveMatchNotActiveYet: 'המחזור עדיין לא פעיל',
  // Top in-app banners (event signals, distinct from system toasts).
  // These fire from the realtime game-doc listener, so they describe
  // events that may be triggered by other users on other devices.
  bannerPlayerJoined: 'שחקן הצטרף למחזור',
  bannerPlayerJoinedNamed: (firstName: string) => `${firstName} נכנס להרכב`,
  bannerPlayersJoinedCount: (n: number) => `${n} שחקנים נכנסו להרכב`,
  bannerPlayerLeft: 'שחקן יצא מהמחזור',
  bannerPlayerLeftNamed: (firstName: string) => `${firstName} יצא מהמחזור`,
  bannerPlayersLeftCount: (n: number) => `${n} שחקנים יצאו מהמחזור`,
  bannerGuestAdded: 'אורח נוסף למחזור',
  bannerEveningEnded: 'המחזור הסתיים',
  bannerGameCancelled: 'המחזור בוטל',
  // Inline soft prompt at the top of MatchDetails for finished games
  // the user played in. Complements the post-game push so a player who
  // muted notifications still gets a clear nudge to rate teammates.
  rateBannerTitle: 'דרג את חבריך מהמחזור',
  rateBannerSub: 'תן דירוג מהיר לכל מי ששיחק איתך.',
  rateBannerCta: 'התחל לדרג',
  rateBannerDismiss: 'סגור',
  // RatePlayersScreen — the full list reached from the banner CTA.
  ratePlayersTitle: 'דירוג שחקנים',
  ratePlayersIntro: 'תן דירוג לשחקנים ששיחקו איתך במחזור.',
  ratePlayersHint: 'אפשר לשנות דירוג בכל רגע. הדירוג שלך אנונימי.',
  ratePlayersEmpty: 'אין שחקנים רשומים לדירוג במחזור הזה.',
  ratePlayersSaveFailed: 'שמירת הדירוג נכשלה, נסה שוב',
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
    'כשהאפשרות כבויה, רק חברי המועדון יראו את המחזור',
  matchVisibilityErrorPublic: 'לא הצלחנו לפרסם את המחזור',
  matchVisibilityErrorCommunity: 'לא הצלחנו להגביל את המחזור למועדון',
  // Blocked-state screen rendered when a non-member tries to open a
  // community-only game (deep link / invite / push / stale nav). Must
  // not leak any private game info — title, time, venue, players.
  communityOnlyGameTitle: 'מחזור לסגל בלבד',
  communityOnlyGameSubtitle: 'המחזור הזה פתוח רק לחברי המועדון',
  communityOnlyGameBack: 'חזור',
  matchDetailsDuration: 'משך',
  matchDetailsRoleAdmin: 'מנהל',
  matchDetailsAddGuest: 'הוסף אורח',
  matchDetailsNavigateWaze: 'נווט עם Waze',
  matchDetailsNoLocation: 'אין מיקום למחזור',
  matchDetailsCannotOpenNavigation: 'לא ניתן לפתוח ניווט',
  // ── Match details redesign ───────────────────────────────────────────
  matchHeroNoLocation: 'אין מיקום',
  matchHeroTitle: 'פרטי מחזור',
  matchHeroCommunityPrefix: 'מועדון',
  matchStatsPlayers: 'שחקנים',
  matchStatsDuration: 'משך מחזור',
  matchStatsCommunity: 'מועדון',
  matchStatsWeather: 'מזג אוויר',
  matchStatsMinutesShort: 'דק׳',
  matchParticipantsTitle: 'ההרכב',
  matchParticipantStatusComing: 'מגיע',
  matchParticipantStatusArrived: 'הגיע',
  matchParticipantRoleOrganizer: 'מנהל',
  matchDetailsCardTitle: 'פרטי המחזור',
  matchDetailsLabelField: 'מגרש',
  matchDetailsLabelCity: 'עיר',
  matchDetailsLabelAddress: 'כתובת',
  matchDetailsLabelLocation: 'מיקום',
  matchDetailsNavigateButton: 'נווט למגרש ב-Waze',
  matchDetailsLabelFieldType: 'סוג מגרש',
  matchDetailsLabelNotes: 'הערות',
  matchDetailsLabelOrganizer: 'יוצר המחזור',
  matchDetailsLabelCreatedAt: 'נוצר בתאריך',
  matchDetailsLabelMeetingTime: 'שעת התכנסות',
  matchDetailsLabelCommunity: 'מועדון',
  matchDetailsLabelFormat: 'פורמט',
  matchHeroPlayers: (now: number, max: number) => `‎${now}/${max}‎ שחקנים`,
  matchPlayersTitle: 'שחקנים',
  matchPlayersSeeAll: 'לצפייה ברשימה המלאה',
  matchPlayersEmpty: 'עדיין אין שחקנים בהרכב',
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
  matchStatusCardYouRegistered: 'אתה רשום למחזור',
  matchStatusCardReadyTeams: 'מוכנים להרכיב קבוצות',
  matchStatusCardTeamsReady: 'הקבוצות מוכנות — אפשר להתחיל',
  matchStatusCardTeamsInvalid: 'יש לעדכן את הקבוצות',
  matchStatusCardLive: 'המחזור בעיצומו',
  matchStatusCardFinished: 'המחזור נגמר',
  matchStatusCardCancelled: 'המחזור בוטל',
  matchPlayersScreenTitle: 'שחקני המחזור',
  matchPlayersSectionRegistered: 'ההרכב',
  matchPlayersSectionWaitlist: 'רשימת המתנה',
  matchPlayersSectionPending: 'ממתינים לאישור',
  matchPlayersSectionGuests: 'אורחים',
  matchPlayersAdminTag: 'מנהל',
  matchPlayersWaitlistTag: 'המתנה',
  matchPlayersJoinedAt: 'נרשם',
  matchPlayersPendingTag: 'ממתין',
  matchPlayersGuestTag: 'אורח',
  matchPlayersLateTag: 'באיחור',
  matchPlayersNoShowTag: 'לא הופיע',
  matchPlayersOfferPendingTag: 'ממתין לאישור',
  matchPlayersOfferAdvanceCta: 'העבר להבא בתור',
  matchPlayersOfferAdvanceConfirm: 'להעביר את ההצעה לשחקן הבא ברשימת ההמתנה?',
  matchPlayersOfferConfirmCta: 'אישור הגעה',
  matchPlayersOfferPassCta: 'ויתור',
  // Admin roster management (move / reorder).
  playerMenuMoveToWaitlist: 'העבר להמתנה',
  matchPlayersMoveToRoster: 'להרכב',
  matchPlayersMoveUp: 'העלה בתור',
  matchPlayersMoveDown: 'הורד בתור',
  matchPlayersRosterFull: 'ההרכב מלא — פנה מקום קודם',
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
  // Players an admin removed via "הסר שחקן" (distinct from a self-cancel —
  // these never count against the player's discipline record).
  matchPlayersSectionRemoved: 'הוסרו ע״י מנהל',
  matchPlayersRemovedTag: 'הוסר',
  matchPlayersSelfRemovedTag: 'עזב',
  matchPlayersRemovedAgo: (text: string) => `הוסר ${text}`,
  // With the remover's name ("הוסר ע״י יוסי לפני שעה").
  matchPlayersRemovedByAgo: (name: string, text: string) =>
    `הוסר ע״י ${name} ${text}`,
  // Admin removed themselves ("הסיר את עצמו לפני שעה").
  matchPlayersSelfRemovedAgo: (text: string) => `הסיר את עצמו ${text}`,
  // Wrap the name in a bidi isolate (FSI…PDI) so a Latin name ("Eliran Tzabari")
  // can't reorder the Hebrew around it — otherwise "אתה ו" + a LTR name jumbles.
  pairStatsTitle: (name: string) => `אתה ו⁨${name}⁩`,
  // Order matters — registration happens before attendance, so the
  // labels read more naturally in Hebrew when "נרשמתם" is the first
  // tile shown. The pair card uses this same order.
  pairStatsRegistered: 'נרשמתם יחד',
  pairStatsAttended: 'הגעתם יחד',
  // Share of the games you BOTH signed up for that you BOTH actually showed to
  // — derived from registered/attended-together, an at-a-glance reliability read.
  pairStatsAttendRate: 'הגעתם יחד מתוך ההרשמות',
  pairAssistedThem: 'בישלת לו',
  pairAssistedYou: 'הוא בישל לך',
  pairStatsSameTeam: 'באותה קבוצה',
  pairStatsWinsTogether: 'ניצחתם יחד',
  pairStatsLossesTogether: 'הפסדתם יחד',
  pairStatsSameTeamGames: 'מחזורים באותה קבוצה',
  pairStatsSameTeamRounds: 'משחקים באותה קבוצה',
  pairStatsEmpty: 'עדיין לא שיחקתם יחד',
  // ── Head-to-head (from live rotation) ──
  pairStatsH2HTitle: 'ראש בראש במשחקים',
  pairStatsAgainst: 'אחד נגד השני',
  pairStatsTogetherWL: (w: number, l: number) => `ניצחתם ${w} · הפסדתם ${l}`,
  pairStatsAgainstWL: (w: number, l: number) => `ניצחת ${w} · הפסדת ${l}`,
  pairStatsRoundsUnit: (n: number) => (n === 1 ? 'משחק 1' : `${n} משחקים`),
  pairStatsRoundsCount: (n: number) => (n === 1 ? 'משחק אחד' : `${n} משחקים`),
  // Ties aren't wins or losses, so rounds can exceed wins+losses. Surface the
  // tie count so "23 משחקים · 11 ניצחת · 11 הפסדת" no longer looks off-by-one.
  pairStatsRoundsWithTies: (n: number, ties: number) =>
    `${n === 1 ? 'משחק אחד' : `${n} משחקים`}${ties > 0 ? ` · ${ties} תיקו` : ''}`,
  // Separate W/L labels for the donut rows (big number + small label).
  pairWonTogether: 'ניצחתם',
  pairLostTogether: 'הפסדתם',
  pairWonYou: 'ניצחת',
  pairLostYou: 'הפסדת',
  communityStatsTitle: 'נתוני מועדון',
  communityStatsTotalFinished: 'מחזורים שיצאו לפועל',
  communityStatsThisMonth: 'מחזורים החודש',
  communityStatsOrgRate: 'אחוז הצלחה בארגון',
  communityStatsAvgAttendance: 'ממוצע הגעות למחזור',
  communityStatsTopPlayers: 'המגיעים הקבועים',
  communityStatsActiveMonth: 'פעילים החודש',
  communityStatsActiveYear: 'פעילים השנה',
  communityStatsVitalityTitle: 'מד חיים של המועדון',
  // Fun-facts (נתונים מעניינים) — refreshed set.
  communityStatsKingShare: 'נתח מלך השערים',
  // Values kept short (number/percent only) so the value column stays a tidy,
  // aligned strip and the label never gets squeezed/truncated — the label
  // already carries the unit meaning (user report: "not organized").
  communityStatsKingShareValue: (pct: number) => `${pct}%`,
  communityStatsDuo: 'הצמד הקטלני',
  communityStatsDuoValue: (n: number) => `${n} בישולים`,
  communityStatsDrawRate: 'אחוז התיקו במשחקים',
  communityStatsStreak: 'רצף ההגעות הארוך ביותר',
  communityStatsStreakValue: (n: number) => `${n} מחזורים`,
  // Community goals championship (community-scoped goals only).
  communityChampTitle: 'אלופי המועדון',
  communityChampNote: 'סיכום מצטבר של כל החברות במועדון · ממוין לפי ניצחונות, אז גולים, אז בישולים',
  // Tapping the (i) next to the title explains the scoring + tie-breaks.
  communityChampInfoTitle: 'איך מחושב הדירוג?',
  communityChampInfoBody:
    'הטבלה ממוינת לפי מספר הניצחונות. אם מספר הניצחונות שווה, השוויון נשבר לפי מספר הגולים; ואם גם הגולים שווים — לפי מספר הבישולים.',
  communityChampTotalGoals: 'סך הגולים',
  communityChampTotalRounds: 'משחקים',
  // Per-game championship (shown once the game is finished).
  gameChampTitle: 'אלופי המחזור',
  gameChampNote: 'ניקוד = (גול×2 + בישול) חלקי מספר המשחקים',
  // Championship table column headers.
  champColPlayer: 'שחקן',
  champColGoals: 'גולים',
  champColAssists: 'בישולים',
  champColGames: 'מחזורים',
  champColMiniGames: 'משחקים',
  champColAppearances: 'הופעות',
  champColWins: 'ניצחונות',
  champColLosses: 'הפסדים',
  champColScore: 'ניקוד',
  pairStatsSharedCommunities: 'מועדונים משותפים',
  pairStatsSharedCommunitiesPlural: (n: number) =>
    n === 1 ? 'מועדון אחד משותף' : `${n} מועדונים משותפים`,
  pairStatsFirstShared: 'מחזור ראשון יחד',
  pairStatsLastShared: 'מחזור אחרון יחד',
  // Used when first === last (single shared game). The two-row
  // version would have duplicated the same date label so we collapse
  // to one neutral label.
  pairStatsOnlyShared: 'מחזור משותף',
  pairStatsNoSharedHistory:
    'עדיין לא שיחקתם יחד — הזמן אותו למחזור כדי להתחיל היסטוריה',
  // Hamburger sections + items for match
  matchMenuSectionMatch: 'מחזור',
  matchMenuSectionPlayers: 'שחקנים',
  matchMenuSectionDanger: 'מסוכן',
  matchMenuEdit: 'ערוך מחזור',
  matchEditBlockedTitle: 'המחזור כבר התחיל',
  matchEditBlockedBody:
    'לא ניתן לערוך את פרטי המחזור אחרי שלחצתם על "התחל מחזור". כדי לערוך, סיימו או בטלו את המחזור.',
  matchMenuPlayers: 'ניהול שחקנים',
  matchMenuShare: 'שתף מחזור',
  // Explicit entry to the full players screen — players, waitlist,
  // pending approvals. Mirrors the inline "הצג הכל" link, but
  // surfaces it as a discoverable admin action in the menu.
  matchMenuManagePlayers: 'ניהול שחקנים והממתינים',
  // Visibility-toggle labels — describe the CURRENT state, not the
  // action. The toggle next to the label flips public ↔ community.
  matchMenuMakePublic: 'מחזור פתוח לכולם',
  matchMenuMakeCommunity: 'מחזור למועדון בלבד',
  matchMenuManage: 'ניהול מחזור',
  matchMenuWatchLive: 'צפייה במחזור חי',
  matchManageScreenTitle: 'ניהול מחזור',
  matchManageSectionAccess: 'גישה למחזור',
  matchManageSectionDanger: 'פעולות מסוכנות',
  matchManageVisibilityLocked: 'אפשר לעדכן רק כשהמחזור במצב פתוח להרשמה',
  matchManageAdminOnly: 'רק מנהל יכול לנהל את המחזור',
  // Manage section toggle title
  matchManageToggle: 'ניהול מחזור',
  matchInviteAvailable: 'הזמן שחקנים פנויים',
  matchInviteAvailableHelper: 'שחקנים שזמינים ביום ובשעה של המחזור, באזור',
  // Admin "register members from the community" flow (MatchDetails menu →
  // AddMembersScreen).
  matchMenuAddMembers: 'צרף חברים מהמועדון',
  addMembersTitle: 'הוספת שחקנים מהמועדון',
  addMembersHint: 'בחרו חברי מועדון לרשום ישירות למחזור. הם יקבלו על כך התראה.',
  addMembersHintSpots: (n: number) =>
    n === 1
      ? 'נשאר מקום אחד בהרכב — מעבר לזה השחקנים יתווספו לרשימת ההמתנה. הם יקבלו התראה.'
      : n === 0
        ? 'ההרכב מלא — השחקנים שתבחרו יתווספו לרשימת ההמתנה. הם יקבלו התראה.'
        : `נשארו ${n} מקומות בהרכב — מעבר לזה השחקנים יתווספו לרשימת ההמתנה. הם יקבלו התראה.`,
  addMembersEmpty: 'כל חברי המועדון כבר רשומים למחזור',
  addMembersSubmit: (n: number) => (n === 1 ? 'רשום שחקן' : `רשום ${n} שחקנים`),
  addMembersSubmitEmpty: 'בחרו שחקנים לרישום',
  addMembersDone: (n: number) =>
    n === 1 ? 'שחקן נרשם למחזור' : `${n} שחקנים נרשמו למחזור`,
  addMembersDoneWaitlist: (players: number, waitlist: number) =>
    `${players} נרשמו להרכב, ${waitlist} לרשימת ההמתנה`,
  addMembersNoneAdded: 'אף שחקן לא נוסף (כבר רשומים)',
  addMembersError: 'לא הצלחנו לרשום, נסו שוב',
  // Reserve-spots flavor (same picker, on a scheduled game before registration
  // opens) — the admin pre-secures spots for chosen regulars.
  matchMenuReserveSpots: 'שריין מקומות',
  reserveSpotsTitle: 'שריון מקומות מראש',
  reserveSpotsHint: 'ההרשמה עוד לא נפתחה. בחרו שחקנים שיישָׁמר להם מקום בהרכב — הם ייכנסו אוטומטית ויקבלו התראה.',
  reserveSpotsSubmit: (n: number) => (n === 1 ? 'שריין מקום' : `שריין ${n} מקומות`),
  reserveSpotsDone: (n: number) =>
    n === 1 ? 'שוריין מקום לשחקן' : `שוריין מקום ל-${n} שחקנים`,
  reserveSpotsCapReached: (n: number) =>
    n === 1 ? 'נשאר מקום אחד לשריון' : `אפשר לשריין עד ${n} מקומות`,
  reserveSpotsHintCount: (n: number) =>
    n === 1
      ? 'ההרשמה עוד לא נפתחה. נשאר מקום אחד לשריון — בחרו למי לשמור אותו.'
      : `ההרשמה עוד לא נפתחה. אפשר לשריין עד ${n} מקומות — בחרו למי לשמור אותם. הם ייכנסו אוטומטית ויקבלו התראה.`,
  // Filler candidate (non-member) apply CTA on MatchDetails.
  fillerApplyTitle: 'המחזור מחפש שחקנים להשלמה',
  fillerApplySub: 'הגש מועמדות — מנהל המחזור יאשר אותך ידנית.',
  fillerApplyCta: 'הגש מועמדות',
  fillerApplySent: 'הבקשה נשלחה — ממתין לאישור המנהל',
  fillerApplySentSub: 'הבקשה נשלחה. מנהל המחזור יחליט אם לאשר.',
  fillerApplySentChip: 'נשלח',
  fillerApplyError: 'לא הצלחנו לשלוח, נסו שוב',
  // Compact status helpers — used by MatchStatusCard
  matchStatusWaitingTitle: 'מחכים לשחקנים',
  matchStatusWaitingHelper: (n: number) => `חסרים עוד ${n} שחקנים`,
  matchStatusReadyToCreate: 'אפשר להרכיב קבוצות',
  matchStatusTeamsInvalid: 'יש לעדכן את הקבוצות לפני התחלה',
  // Conflict CTA copy
  matchPrimaryConflict: 'יש לך מחזור אחר בזמן הזה',
  // Compact status chip shown in the hero strip — three tiers based
  // on capacity ratio. "חסרים N" is the default green state; we
  // switch to yellow at 80% full and red when fully booked.
  matchStatusNearFull: 'כמעט מלא',
  matchStatusMissing: (n: number) =>
    n === 1 ? 'חסר שחקן אחד' : `חסרים ${n} שחקנים`,
  // Notes / rules row + bottom sheet
  matchNotesRowTitle: 'חוקים והערות',
  matchNotesSheetTitle: 'חוקים והערות',
  matchNotesEmpty: 'לא הוזנו הערות למחזור',
  // Cancel-registration as a subtle outlined link (not a destructive
  // primary). Same Hebrew copy as before.
  matchCancelRegistrationLink: 'בטל הרשמה',
  // History menu entry — navigates the user to their general match
  // history surface (no per-game history screen yet).
  matchMenuHistory: 'היסטוריית מחזורים',
  matchMenuLeave: 'יציאה מהמחזור',
  leaveGameConfirmTitle: 'לבטל את ההרשמה?',
  leaveGameConfirmBody: 'ההרשמה שלך למחזור תבוטל. תמיד אפשר להירשם שוב כל עוד יש מקום.',
  // Registration conflict — surfaced in the modal that blocks a join
  // when the user is already registered to a game within ±4h of the
  // target. The helper variant is for the inline disabled-CTA hint.
  gameManagerBadge: 'מנהל',
  communityHistoryTitle: 'היסטוריית מחזורים',
  communityHistoryShowLess: 'הצג פחות',
  communityHistorySeeAll: (n: number) => `הצג את כל ההיסטוריה (${n})`,
  communityMenuHistory: 'היסטוריית מחזורים',
  communityHistoryEmptyTitle: 'עדיין אין מחזורים',
  communityHistoryEmptyBody: 'אחרי שתשחקו מחזור ראשון, כל המחזורים שהסתיימו יופיעו כאן.',
  gameJoinRejectedToast: 'הבקשה שלך למחזור נדחתה על ידי המנהל',
  gameNotJoinableToast: 'המחזור כבר לא פתוח להרשמה',
  registrationConflictTitle: 'אתה כבר רשום למחזור בזמן חופף',
  // Variant shown when the conflicting game lives in a DIFFERENT
  // community than the target. Same body copy works for both — only
  // the title needs to clarify the cross-group case.
  registrationConflictTitleOtherGroup: 'אתה כבר רשום למחזור קרוב במועדון אחר',
  registrationConflictMessage:
    'כדי להירשם למחזור הזה, בטל קודם את ההרשמה למחזור השני.',
  registrationConflictHelper: 'כבר בהרכב של מחזור קרוב',
  registrationConflictViewGame: 'צפה במחזור',
  // Fallback group label used in the modal when we can't resolve
  // the conflicting game's group name from the local store
  // (typically because the user isn't a member of that community).
  registrationConflictUnknownGroup: 'מועדון אחר',
  // Time-difference helper. Shown inside the modal so the user can
  // see exactly how close the two games are. Hidden when either side
  // lacks a startsAt (e.g. an active game with no scheduled time).
  registrationConflictTimeDiffMinutes: (min: number) =>
    `המחזורים בהפרש של ${min} דקות`,
  registrationConflictTimeDiffHoursMinutes: (h: number, min: number) =>
    min === 0
      ? `המחזורים בהפרש של ${h === 1 ? 'שעה' : `${h} שעות`}`
      : `המחזורים בהפרש של ${h === 1 ? 'שעה' : `${h} שעות`} ו־${min} דקות`,
  // Direct-cancel action lets the user resolve the conflict without
  // navigating away. After success we re-run the pre-check; the
  // user still has to tap "הצטרף" again — we never auto-join.
  registrationConflictCancelOther: 'ביטול ההרשמה מהמחזור האחר',
  registrationConflictCancelSuccess: 'ההרשמה למחזור האחר בוטלה',
  registrationConflictCancelFailed: 'לא ניתן לבטל את ההרשמה כרגע',
  registrationConflictViewOther: 'צפה במחזור האחר',
  registrationConflictClose: 'סגור',
  registrationConflictResolved: 'בוטלה ההרשמה הקודמת ונרשמת למחזור החדש',
  sessionActionInviteCommunityOnly:
    'זמין רק למחזורים פתוחים לכלל האפליקציה',
  matchDetailsJoinAsPlayer: 'הצטרף כשחקן',
  // Refactored status card — single block replacing the old pill +
  // helper + teams placeholder trio.
  statusWaitingTitle: 'מחכים לשחקנים',
  statusWaitingSub: (n: number) =>
    n === 1 ? 'חסר עוד שחקן אחד כדי להתחיל' : `חסרים עוד ${n} שחקנים כדי להתחיל`,
  playersEmptyMissing: (n: number) =>
    n === 1 ? 'חסר עוד שחקן אחד' : `חסרים עוד ${n} שחקנים`,
  // Admin "manage game" section at the bottom.
  manageSectionTitle: 'ניהול מחזור',
  deleteGameAction: 'מחיקת מחזור',
  matchDetailsGoLive: 'עבור למצב לייב',

  // Notifications settings
  notificationsTitle: 'הגדרות התראות',
  notificationsIntro:
    'בחר אילו התראות לקבל. אפשר לכבות סוגים בודדים בכל רגע.',
  notifJoinRequest: 'בקשות הצטרפות (מועדון ומחזור)',
  notifJoinRequestSub: 'כשמישהו מבקש להצטרף למועדון או למחזור שאתה מנהל',
  notifApprovedRejected: 'אישור / דחייה של הבקשות שלי',
  notifApprovedRejectedSub: 'כשבקשת ההצטרפות שלך מטופלת',
  notifNewGameInCommunity: 'מחזור חדש במועדון',
  notifNewGameInCommunitySub: 'תוכל להפעיל את זה בכל מועדון בנפרד',
  notifGameReminder: 'תזכורת לפני מחזור',
  notifGameReminderSub: 'שעות לפני מחזור שאתה רשום אליו',
  notifGameCanceledOrUpdated: 'ביטול / שינוי מחזור',
  notifGameCanceledOrUpdatedSub: 'אם מחזור שלך מבוטל או הוזז',
  notifSpotOpened: 'פתחו מקום במחזור שאני בספסל',
  notifSpotOpenedSub: 'כששחקן ביטל ואתה הראשון בספסל',
  notifGrowthMilestone: 'אבני דרך במועדון',
  notifGrowthMilestoneSub: '10/20/30/50 שחקנים — אופציונלי',
  notifInviteToGame: 'הזמנות אישיות למחזורים',
  notifInviteToGameSub: 'כששחקן אחר מזמין אותך למחזור',
  notifRateReminder: 'תזכורת לדרג חברים',
  notifRateReminderSub: 'אחרי מחזור שסיימת — שעה אחרי הסיום',
  notifGameFillingUp: 'מקום אחרון במחזור קרוב',
  notifGameFillingUpSub: 'מחזורים במועדון שלך שכמעט מלאים',
  notifGameRsvpNudge: 'תזכורת להירשם למחזור',
  notifGameRsvpNudgeSub: 'נשלחת 5 שעות לפני המחזור אם עדיין לא ענית',
  notifGamePlayersJoined: 'שחקן נרשם למחזור',
  notifGamePlayersJoinedSub:
    'מישהו נרשם למשחק שאני מארגן (כולל מחזור שבועי ומשחק מהיר)',
  notifPlayerCancelled: 'שחקן ביטל השתתפות',
  notifPlayerCancelledSub: 'שחקן רשום הסיר את עצמו מהמחזור שאני מארגן',
  notifGameShortageWarning: 'מחסור בשחקנים',
  notifGameShortageWarningSub:
    'התראה למארגן כשמתקרבים לקיק־אוף ויש פחות שחקנים מהמינימום',
  notifGroupDeleted: 'מועדון נסגר',
  notifGroupDeletedSub: 'כשמנהל מוחק מועדון שאני חבר בו',
  notifSave: 'שמור הגדרות',
  notifSaved: 'נשמר',

  // ── Redesigned notifications screen ──
  // Hero card explaining the screen, then the toggles grouped by category.
  notifHeroTitle: 'נהל את הקצב שלך',
  notifHeroBody:
    'בחר בדיוק אילו עדכונים לקבל כדי להישאר בעניינים בלי הסחות דעת.',
  notifCategoryGames: 'ניהול מחזורים',
  notifCategoryCommunity: 'קהילה וחברה',
  notifCategoryReminders: 'תזכורות',
  // OS-permission gate — shown when notifications are turned off for the
  // app on the device, BEFORE the per-type toggles (which do nothing
  // until the OS lets pushes through).
  notifPermTitle: 'ההתראות כבויות במכשיר',
  notifPermBody:
    'כדי לקבל עדכונים על מחזורים, בקשות ותזכורות — צריך לאשר התראות לאפליקציה. אחרי שתאשר, תוכל לבחור כאן בדיוק מה לקבל.',
  notifPermEnable: 'אפשר התראות',
  notifPermOpenSettings: 'פתיחת הגדרות',
  notifPermDeniedTitle: 'ההתראות חסומות',
  notifPermDeniedBody:
    'חסמת התראות לאפליקציה. פתח את הגדרות המכשיר ואפשר התראות כדי לקבל עדכונים.',

  // Per-community subscription
  communityNotifyNewGames: 'הודיעו לי על מחזורים חדשים במועדון',

  // Stats tab
  statsTitle: 'סטטיסטיקה',
  statsGames: 'מחזורים',
  statsWins: 'ניצחונות',
  statsLosses: 'הפסדים',
  statsTies: 'תיקו',
  statsWinPct: 'אחוז ניצחונות',
  statsAttendance: 'אחוז הגעה',
  statsCancelRate: 'אחוז ביטולים',

  // History tab
  historyTitle: 'היסטוריית מחזורים',
  historyEmpty: 'אין עדיין מחזורים קודמים',
  historyMatches: (n: number) => `${n} משחקים`,
  historyWin: 'ניצחון',
  historyLoss: 'הפסד',

  // ── Draft Teams (חלוקת כוחות) ──────────────────────────────────────
  draftTitle: 'חלוקת כוחות',
  draftAdminOnly: 'רק מנהל המחזור יכול לקבוע כוחות',
  draftStepLabel: (n: number, total: number) => `שלב ${n} מתוך ${total}`,
  draftSetupSubtitle: 'בחר קפטנים',
  draftCaptainBadge: 'קפטן',
  draftOrderTitle: 'סדר בחירת שחקנים',
  draftOrderSubtitle: 'בחר את סדר החלוקה של השחקנים בין הקפטנים',
  // Fill mode — how a borrowed player behaves when completing a short team
  // in the live rotation.
  draftFillModeTitle: 'השלמת קבוצה חסרה',
  draftFillModeSubtitle:
    'כשקבוצה לא מלאה עולה, האפליקציה משלימה אותה אוטומטית מחזורן של הקבוצה שיצאה. מה קורה איתו אחרי?',
  draftFillTemporaryTitle: 'השלמה זמנית',
  draftFillTemporaryDesc: 'המשלים חוזר לקבוצה שלו כשהיא עולה שוב',
  draftFillPermanentTitle: 'השלמה קבועה',
  draftFillPermanentDesc: 'המשלים נשאר עם הקבוצה החדשה',
  draftSnakeLabel: 'סדר נחש (Snake Draft)',
  draftRegularLabel: 'סדר רגיל',
  draftRecommended: 'מומלץ',
  draftTeamsToCreate: (n: number) => `${n} קבוצות ייווצרו`,
  draftContinue: 'המשך',
  draftNeedCaptains: 'בחרו 2–4 קפטנים כדי להמשיך',
  draftChooseOrder: 'בחרו סדר הגרלה כדי להמשיך',
  draftTooManyCaptains: 'אפשר עד 4 קבוצות — הסירו קפטן',
  draftPickExactCaptains: (n: number) =>
    `בחרו בדיוק ${n} קפטנים (כמספר הקבוצות במחזור)`,
  draftNotEnoughPlayers: 'אין מספיק שחקנים רשומים לחלוקה',
  draftBoardTurn: (letter: string) => `תורו של קפטן ${letter} לבחור`,
  draftAvailableTitle: 'שחקנים זמינים',
  draftPick: 'בחר',
  draftCaptainLabel: 'קפטן',
  draftSummaryTitle: 'הכוחות חולקו!',
  draftSummarySubtitle: 'אלו הקבוצות שנוצרו',
  draftFinish: 'סיים חלוקת כוחות',
  draftSaved: 'הכוחות חולקו ונשמרו בהצלחה',
  draftViewMenu: 'הצג חלוקת כוחות',
  draftEditMenu: 'ערוך חלוקת כוחות',
  draftTeamsSectionTitle: 'הכוחות שחולקו',
  draftExportWhatsapp: 'ייצא כוחות לווטצאפ',
  draftTeamsStaleHint: 'מישהו הצטרף אחרי שחולקו הכוחות — כדאי לאזן מחדש',
  // Draft/publish mode for team splitting
  draftTeamsDraftBadge: 'טיוטה',
  draftTeamsDraftHint:
    'רק אתה רואה את הכוחות. אפשר לערוך, וכשמוכן — לחץ "פרסם כוחות" כדי שכל השחקנים יראו ויקבלו התראה.',
  draftPublishCta: 'פרסם כוחות',
  draftPublishConfirmTitle: 'לפרסם את הכוחות?',
  draftPublishConfirmBody:
    'הכוחות יופיעו לכל השחקנים ותישלח להם התראה. אפשר יהיה לערוך גם אחרי הפרסום.',
  draftPublishConfirmCta: 'פרסם',
  draftPublishedToast: 'הכוחות פורסמו ונשלחה התראה לשחקנים',
  matchCreateTeamsBannerTitle: 'הגיע הזמן לחלק כוחות',
  matchCreateTeamsBannerSub: 'המחזור מתקרב — חלקו את השחקנים לקבוצות',
  matchAutoTeamsScheduled: (when: string) =>
    `הכוחות ייווצרו אוטומטית ב-${when}`,
  matchManageTeamsBannerTitle: 'נהל כוחות',
  matchManageTeamsBannerSub: 'ערוך, אזן מחדש או חלק מחדש',
  // Drag-and-drop teams editor
  teamsEditTitle: 'עריכת הכוחות',
  teamsEditHint: 'לחצו על שחקן — השחקנים בקבוצה השנייה יהבהבו. לחצו על אחד מהם כדי להחליף ביניהם.',
  teamsEditPickTarget: 'בחרו את השחקן שיחליף מקום — או לחצו כאן לביטול',
  teamsEditTeamName: (letter: string) => `קבוצה ${letter}`,
  teamsEditFinish: 'סיים',
  // Entry on the manage screen when teams already exist
  draftEditExistingTitle: 'ערוך את הכוחות הקיימים',
  draftEditExistingSub: 'לחצו על שחקן והחליפו אותו בין הקבוצות',
  draftRedoMenu: 'חלק כוחות מחדש',
  draftUndo: 'בטל בחירה אחרונה',
  draftBackToEdit: 'חזרה לתיקון',
  draftSaveError: 'שמירת החלוקה נכשלה, נסו שוב',

  // ── Auto-balanced teams (by internal rating) ──────────────────────
  // Split-method picker (first step of חלוקת כוחות).
  draftMethodTitle: 'איך לחלק כוחות?',
  draftMethodAuto: 'אוטומטי לפי דירוג',
  draftMethodAutoSub: 'איזון לפי הדירוג הפנימי. שחקן ללא דירוג ייחשב ממוצע.',
  draftMethodManual: 'ידני לפי קפטנים',
  draftMethodManualSub: 'בחרו קפטנים והגרילו תור-תור',
  draftMethodRandom: 'אקראי',
  draftMethodRandomSub: 'חלוקה אקראית ומאוזנת בגודל, ללא דירוג',
  draftMethodBack: 'חזרה לבחירת שיטה',
  draftGenerateCta: 'צור כוחות',
  autoBalanceChooseTeams: 'בכמה קבוצות לחלק?',
  autoBalanceTeamsOption: (n: number) => `${n} קבוצות`,
  autoBalanceUnrated: (n: number) =>
    n === 1
      ? 'שחקן אחד ללא דירוג פנימי שובץ לפי דירוג ממוצע'
      : `${n} שחקנים ללא דירוג פנימי שובצו לפי דירוג ממוצע`,
  autoBalanceError: 'יצירת הכוחות האוטומטיים נכשלה, נסו שוב',
  autoBalanceReady: 'הכוחות אוזנו לפי הדירוג הפנימי — אפשר לערוך לפני שמירה',
  autoBalanceNotifyPlayers: 'שלח התראה לשחקנים',
  autoBalanceNotifySent: 'נשלחה התראה לכל השחקנים',
  teamFeedbackPrompt: 'הכוחות נראים מאוזנים?',
  teamFeedbackAggregate: (likes: number, dislikes: number) =>
    `${likes} 👍 · ${dislikes} 👎`,

  // ── Chat ──────────────────────────────────────────────────────────
  delete: 'מחק',
  tabChat: "צ'אטים",
  chatsListTitle: "צ'אטים",
  chatsListEmpty: 'אין עדיין שיחות',
  chatsListEmptyHint: 'שיחות של מחזורים ומועדונים שאתה חבר בהם יופיעו כאן',
  chatOpenGame: "צ'אט המחזור",
  chatOpenCommunity: "צ'אט המועדון",
  chatNoAccess: 'אין לך גישה לצ׳אט הזה',
  chatEmpty: 'המגרש פנוי — שלחו את ההודעה הראשונה ⚽',
  chatLoadingTitle: 'טוען צ׳אט…',
  chatGameUnavailable: 'הצ׳אט לא זמין — ייתכן שהמחזור נמחק או שאין לך גישה',
  chatInputPlaceholder: 'כתבו הודעה…',
  chatSendA11y: 'שליחת הודעה',
  chatSendFailedTitle: 'ההודעה לא נשלחה',
  chatSendFailedBody: 'בדקו את החיבור ונסו שוב.',
  chatDeleteConfirmTitle: 'למחוק את ההודעה?',
  chatDeleteConfirmBodyOwn: 'ההודעה תימחק לכל המשתתפים.',
  chatDeleteConfirmBodyMod: 'מחיקה כמנהל — ההודעה תימחק לכל המשתתפים.',
  chatDeleteFailedTitle: 'המחיקה נכשלה',
  chatDeleteFailedBody: 'נסו שוב.',
  chatGameSubtitle: 'משתתפי המחזור',
  chatCommunitySubtitle: 'חברי המועדון',
  // Direct (1-on-1) messages.
  dmTitle: 'הודעה ישירה',
  dmSubtitle: 'הודעה פרטית',
  chatListMinePrefix: 'אני: ',
  dmSendMessage: 'שלח הודעה',
  genericUserName: 'משתמש',
  dmRestricted: 'המשתמש מקבל הודעות מחברים בלבד.',
  dmLoadError: 'לא הצלחנו לפתוח את הצ׳אט. בדוק את החיבור ונסה שוב.',
  dmFriendsOnlyToggle: 'קבל הודעות רק מחברים',
  chatToday: 'היום',
  chatYesterday: 'אתמול',
  chatWhoRead: 'מי קרא',
  chatReadByNobody: 'עדיין לא נקרא',
  chatReadByYou: 'אתה',
  chatTypingOne: (name: string) => `${name} מקליד…`,
  chatTypingMany: 'כמה משתתפים מקלידים…',
  chatMute: 'השתק התראות',
  chatUnmute: 'בטל השתקה',
  chatMembersTitle: 'חברי השיחה',
  chatMembersAdminTag: 'מנהל',
  chatMembersCount: (n: number) => `${n} חברים`,
  chatMembersEmpty: 'אין חברים להצגה',
  chatProfanityBlocked: 'ההודעה מכילה תוכן פוגעני ולא נשלחה',
  chatReport: 'דווח',
  chatReportConfirmTitle: 'לדווח על ההודעה?',
  chatReportConfirmBody: 'הדיווח יישלח לבדיקה. תודה שאתה עוזר לשמור על שיח נקי.',
  chatReportThanks: 'הדיווח התקבל, תודה',
  chatBlock: 'חסום',
  chatBlockConfirmTitle: 'לחסום את המשתמש?',
  chatBlockConfirmBody: (name: string) => `לא תראה יותר את ההודעות של ${name}.`,
  chatBlockDone: 'המשתמש נחסם',
  chatBlockedHidden: (name: string) => `הודעה מוסתרת — חסמת את ${name}`,
} as const;
