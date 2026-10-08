// Mock work list — so every state of the משימות screen can be SEEN without
// production data behind it.
//
// This exists because of a real gap. The services had drifted to
// `if (!has.firebase()) return []`, with comments still promising mock data
// that no longer existed — so without credentials the home screen was simply
// blank, and even WITH credentials some states could not be reached at all.
// The "בוצע ע״י קלוד" state was the sharp case: it cannot be photographed or
// reviewed until Claude has actually finished something, which is a chicken
// and egg problem the first time you build the feature.
//
// So the fixture covers every combination that matters:
//   • all five streams (משימות · דיווחים · שגיאות · פיצ׳רים · רעיונות)
//   • all three states (open · handed over by Claude · accepted)
//   • an item WITH a handover note and a proof screenshot
//   • a report carrying a user screenshot
//   • an error with a high occurrence count
//   • a parked idea, which Claude must NOT act on
//
// Turn it on with `MOCK_WORK` in ../config — it also serves automatically
// whenever Firebase credentials are absent.

import type { WorkItem } from './workItems';

/** A real (downscaled) Pulse screenshot, so the proof block renders truthfully
 *  rather than against a grey placeholder. */
const SHOT =
  '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';

const HOUR = 3_600_000;

export function mockWork(now: number): WorkItem[] {
  const ago = (h: number) => now - h * HOUR;
  return [
    // ── handed over by Claude: the review queue, with note + proof ────────
    {
      key: 'task:mock-1',
      stream: 'task',
      kind: 'bug',
      id: 'mock-1',
      docPath: 'tasks/mock-1',
      title: 'מונה השערים בלייב הראה מספר שגוי אחרי איפוס',
      body: 'אחרי איפוס משחקון המונה ליד השחקן המשיך לספור שערים שנזרקו.',
      images: [],
      state: 'claude',
      claude: {
        note:
          'איפוס משחקון גורע עכשיו מהמונה בדיוק את השערים שנזרקו, ואיפוס סבב מנקה את שני המקורות יחד. ' +
          'בנוסף הקורא שומר מפה ריקה מפורשת, כך שאפשר להבחין בין "אין מונה" (משחק ישן) לבין "המונה אופס בכוונה". ' +
          'קבצים: src/utils/goalTally.ts, src/services/gameService.ts, src/firebase/firestore.ts. 16 בדיקות.',
        images: [SHOT],
        at: ago(2),
      },
      createdAt: ago(30),
      priority: 'high',
      screen: 'לייב',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: true,
      hint: '',
    },
    {
      key: 'report:mock-2',
      stream: 'report',
      kind: 'report',
      id: 'mock-2',
      docPath: 'feedback/mock-2',
      title: 'הכפתור של סיום מחזור נחתך לי במסך',
      body: 'כשאני מסיים מחזור הכפתור התחתון נחתך ואי אפשר ללחוץ עליו עד הסוף.',
      images: [SHOT],
      state: 'claude',
      claude: {
        note: 'הוספתי ריפוד לפי ה-safe area האמיתי, כך שהשורה האחרונה לא יושבת מתחת לפס הניווט.',
        images: [SHOT],
        at: ago(5),
      },
      createdAt: ago(52),
      priority: 'normal',
      screen: 'פרטי מחזור',
      reporterId: 'mock-user',
      reporterName: 'אלירן צברי',
      count: 1,
      claudeMayAct: true,
      hint: '',
    },

    // ── plain open ────────────────────────────────────────────────────────
    {
      key: 'task:mock-3',
      stream: 'task',
      kind: 'ui',
      id: 'mock-3',
      docPath: 'tasks/mock-3',
      title: 'לשנות את המיקום של כפתור סיום המשחק בלייב',
      body: '',
      images: [],
      state: 'open',
      claude: null,
      createdAt: ago(8),
      priority: 'normal',
      screen: '',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: true,
      hint: '',
    },
    {
      key: 'error:mock-4',
      stream: 'error',
      kind: 'error',
      id: 'mock-4',
      docPath: 'errors/mock-4',
      title: 'commitRoundStats נכשל',
      body: 'DEADLINE_EXCEEDED בסגירת מחזור',
      images: [],
      state: 'open',
      claude: null,
      createdAt: ago(3),
      priority: 'high',
      screen: 'לייב',
      reporterId: '',
      reporterName: '',
      count: 14,
      claudeMayAct: true,
      hint: '',
    },
    {
      key: 'feature:mock-5',
      stream: 'feature',
      kind: 'feature',
      id: 'mock-5',
      docPath: 'pulseFeatures/mock-5',
      title: 'טבלת מועדון לפי אחוזי ניצחון',
      body: 'להוסיף עמודת אחוזים לטבלת המועדון.',
      images: [],
      state: 'open',
      claude: null,
      createdAt: ago(70),
      priority: 'normal',
      screen: '',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: true,
      hint: '',
    },

    // ── a PARKED idea — Claude must not touch it ─────────────────────────
    {
      key: 'idea:mock-6',
      stream: 'idea',
      kind: 'idea',
      id: 'mock-6',
      docPath: 'pulseIdeas/mock-6',
      title: 'עונות במועדון',
      body: 'לחלק את השנה לעונות עם טבלה שמתאפסת.',
      images: [],
      state: 'open',
      claude: null,
      createdAt: ago(100),
      priority: 'low',
      screen: '',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: false,
      hint: 'רעיון — לאפיון מצידכם לפני שנוגעים',
    },
    // ── an idea the owner released for speccing ──────────────────────────
    {
      key: 'idea:mock-7',
      stream: 'idea',
      kind: 'idea',
      id: 'mock-7',
      docPath: 'pulseIdeas/mock-7',
      title: 'סטטיסטיקת חילופים',
      body: 'לזכות שחקן במשחקון אחרי חילוף רציף.',
      images: [],
      state: 'open',
      claude: null,
      createdAt: ago(120),
      priority: 'high',
      screen: '',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: true,
      hint: 'לביצוע — אפיון אושר',
    },

    // ── accepted ─────────────────────────────────────────────────────────
    {
      key: 'task:mock-8',
      stream: 'task',
      kind: 'bug',
      id: 'mock-8',
      docPath: 'tasks/mock-8',
      title: 'בידוד נתונים בין מועדונים',
      body: '',
      images: [],
      state: 'done',
      claude: {
        note: 'הוסר כלל הרשאות כפול שאיפשר קריאה לכל משתמש מחובר. 30 בדיקות emulator.',
        images: [],
        at: ago(140),
      },
      createdAt: ago(200),
      priority: 'high',
      screen: '',
      reporterId: '',
      reporterName: '',
      count: 1,
      claudeMayAct: true,
      hint: '',
    },
  ];
}
