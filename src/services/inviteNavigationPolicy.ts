import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { useEntryStore } from '@/store/entryStore';
import { decideEntry } from '@/navigation/entryGate';

/** Re-read identity and mounted-stack prerequisites after every async preflight. */
export function canNavigateInvitation(userId: string, wasGuest: boolean): boolean {
  const user = useUserStore.getState();
  const entry = useEntryStore.getState();
  const current = user.currentUser;
  if (!current || current.id !== userId || (current.isGuest === true) !== wasGuest) return false;
  if (entry.suppressAutoConsume || !useGroupStore.getState().hydrated) return false;
  if (!wasGuest && (!user.isProfileComplete() || !user.hasCompletedOnboarding())) return false;
  return decideEntry({ isGuest: wasGuest, organicCompleted: entry.organicCompleted,
    existingAccountWasNew: entry.existingAccountWasNew,
    hasCompletedOnboarding: user.hasCompletedOnboarding() }) === 'app';
}
