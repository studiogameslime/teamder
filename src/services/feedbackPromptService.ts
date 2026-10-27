import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureFeedbackDiagnostics, submitFeedback, type FeedbackDiagnostics } from './feedbackService';
import { useUserStore } from '@/store/userStore';

export const FEEDBACK_PROMPT_ID = 'football-feedback-v1';
export const FEEDBACK_PROMPT_MAX_LENGTH = 300;
const handled = new Set<string>();
const key = (uid: string) => `feedbackPrompt:${FEEDBACK_PROMPT_ID}:${uid}`;

/** Per account and installation. A failed storage read must not mean unseen. */
export async function shouldShowFeedbackPrompt(uid: string): Promise<boolean> {
  if (handled.has(uid)) return false;
  const seen = await AsyncStorage.getItem(key(uid));
  return !seen && !handled.has(uid);
}

export async function markFeedbackPromptHandled(uid: string): Promise<void> {
  handled.add(uid);
  await AsyncStorage.setItem(key(uid), 'handled');
}

export function feedbackPromptContext(uid: string): FeedbackDiagnostics {
  return { ...captureFeedbackDiagnostics('FeedbackPrompt'), owner: uid };
}

/** Reuse the existing permitted feedback collection, already read by Pulse. */
export async function submitFeedbackPrompt(uid: string, message: string, context: FeedbackDiagnostics): Promise<void> {
  const user = useUserStore.getState().currentUser;
  if (!user || user.id !== uid || user.isGuest || context.owner !== uid) throw new Error('feedbackPrompt: session changed');
  const text = message.trim();
  if (!text || text.length > FEEDBACK_PROMPT_MAX_LENGTH) throw new Error('feedbackPrompt: invalid message');
  await submitFeedback('suggestion', text, 'FeedbackPrompt', undefined, 'feature', context);
}
