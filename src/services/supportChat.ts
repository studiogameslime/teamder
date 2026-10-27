import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { httpsCallable } from '@/services/diagnosticCallable';
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { navigationRef } from '@/navigation/navigationRef';
import { dmConvId } from '@/services/chatService';
import { TEAMDER_UID } from '@/utils/officialAccount';

export type SupportContext = { screen: string; screenLabel: string; step?: number; groupId?: string; gameId?: string; appVersion: string; platform: string };
const labels: Record<string, string> = { CommunitiesCreate: 'הקמת מועדון', CreateGroup: 'הקמת מועדון', CommunityDetails: 'פרטי מועדון', CommunityDetailsPublic: 'פרטי מועדון', GameCreate: 'יצירת מחזור', MatchDetails: 'פרטי מחזור', Profile: 'בית', GuestHome: 'בית', Intent: 'בחירת דרך ההתחלה', ChatsList: 'צ׳אטים', ProfileSetup: 'השלמת פרופיל', EmailAuth: 'התחברות במייל' };
Object.assign(labels, {Statistics:'הסטטיסטיקות שלי',CommunitiesFeed:'מועדונים',CommunityEdit:'עריכת מועדון',CommunityPlayers:'שחקני המועדון',ManagerDashboard:'ניהול מועדון',CommunityStats:'נתוני המועדון',CommunityHistory:'היסטוריית המועדון',GameEdit:'עריכת מחזור',GamesList:'מחזורים',GamesMap:'מפת המחזורים',MatchPlayers:'הרכב המחזור',MatchRounds:'משחקי המחזור',MatchStats:'נתוני המחזור',AvailablePlayers:'חיפוש שחקנים למחזור',AddMembers:'הוספת שחקנים',DraftSetup:'חלוקת קבוצות',DraftBoard:'בחירת קבוצות',AdvancedLiveMatch:'מחזור חי',LiveMatch:'מחזור חי',MatchSummary:'סיכום מחזור',PenaltyShootout:'פנדלים',Friends:'חברים והזמנות',PlayerCard:'כרטיס שחקן',AvailabilityEdit:'עריכת זמינות',Settings:'הגדרות',ProfileEdit:'עריכת פרופיל',AuthWelcome:'התחברות',Intro:'היכרות',Landing:'מסך פתיחה',About:'על האפליקציה',Privacy:'פרטיות',SocialPrivacy:'פרטיות שחקנים',Notifications:'התראות',AdminApproval:'אישור בקשות',Achievements:'הישגים',SeasonTitles:'אליפויות',SeasonSummary:'סיכום עונה',CommunityChat:'שיחת מועדון',GameChat:'שיחת מחזור',DirectChat:'שיחה אישית'});
let stepContext: { screen: string; step: number } | undefined;
export function setSupportStep(screen: string, step?: number) {
  if (step !== undefined) stepContext = { screen, step };
  else if (stepContext?.screen === screen) stepContext = undefined;
}
export function captureSupportContext(): SupportContext {
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  const screen = route?.name ?? 'Unknown';
  const params = (route?.params ?? {}) as Record<string, unknown>;
  return { screen, screenLabel: labels[screen] ?? 'מסך באפליקציה', appVersion: Constants.expoConfig?.version ?? 'unknown', platform: Platform.OS,
    ...(stepContext?.screen === screen ? { step: stepContext.step } : {}),
    ...(typeof params.groupId === 'string' ? { groupId: params.groupId } : {}), ...(typeof params.gameId === 'string' ? { gameId: params.gameId } : {}) };
}
export type SupportDraft = { text: string; image?: string; context: SupportContext; attemptId?: string };
type SupportState = { visible: boolean; dismissed: boolean; owner: string | null; drafts: Record<string, SupportDraft>; open: (uid: string) => void; close: () => void; dismiss: () => void; patch: (uid: string, patch: Partial<SupportDraft>) => void; resetOwner: (uid: string | null) => void };
export const useSupportChat = create<SupportState>((set, get) => ({
  visible: false, dismissed: false, owner: null, drafts: {},
  open: uid => set(state => ({ visible: true, owner: uid, drafts: { ...(state.owner === uid ? state.drafts : {}), [uid]: state.owner === uid && (state.drafts[uid]?.text || state.drafts[uid]?.image) ? state.drafts[uid] : { text: '', context: captureSupportContext() } } })),
  close: () => set({ visible: false }), dismiss: () => set({ dismissed: true }),
  patch: (uid, patch) => set(state => state.owner===uid&&state.drafts[uid]?({ drafts: { ...state.drafts, [uid]: { ...state.drafts[uid], ...patch } } }):state),
  resetOwner: uid => { if (get().owner !== uid) set({ owner: uid, visible: false, dismissed: false, drafts: {} }); },
}));
export function supportConversationId(uid: string) { return dmConvId(uid, TEAMDER_UID); }
export function supportAttemptId() { return `support-${randomUUID()}`; }
export async function sendSupportDraft(uid: string, draft: SupportDraft): Promise<void> {
  if (USE_MOCK_DATA) throw new Error('מצב המחשה אינו שולח הודעות');
  if (getFirebase().auth.currentUser?.uid !== uid) throw new Error('זהות ההתחברות השתנתה');
  await httpsCallable(getFirebase().functions, 'sendSupportMessage')({ expectedUid: uid, id: draft.attemptId, text: draft.text, ...(draft.image !== undefined ? { image: draft.image } : {}), context: draft.context });
}
