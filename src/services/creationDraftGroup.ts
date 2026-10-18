import type { Group } from '@/types';

export function creationDraftRecoveryMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'CREATION_GROUP_MISSING') return 'המועדון של הטיוטה אינו זמין עוד. אין להמשיך את היצירה במועדון אחר.';
  if (code === 'CREATION_GROUP_ACCESS') return 'לא ניתן לאמת גישה למועדון של הטיוטה. נסו שוב לפני המשך היצירה.';
  return 'לא ניתן לשחזר את הטיוטה. נסו שוב.';
}

/** A cache miss is not evidence that the saved target was deleted. */
export async function readCreationDraftGroup(
  values: Record<string, unknown>, uid: string, quickIntent: boolean,
  read: (id: string) => Promise<Group | null>,
): Promise<Group | undefined> {
  if (!('__creationGroupId' in values)) return undefined;
  const id = values.__creationGroupId;
  if (id === null && quickIntent) return undefined; // no personal group is needed to restore the form
  if (typeof id !== 'string' || !id || quickIntent) throw Error('יש לחזור למסלול היצירה המקורי כדי להמשיך את הטיוטה השמורה.');
  const group = await read(id);
  if (!group) throw Object.assign(Error('המועדון של הטיוטה אינו זמין עוד. אין להמשיך את היצירה במועדון אחר.'), { code: 'CREATION_GROUP_MISSING' });
  if (!group.adminIds.includes(uid)) throw Object.assign(Error('לא ניתן לאמת גישה למועדון של הטיוטה. נסו שוב לפני המשך היצירה.'), { code: 'CREATION_GROUP_ACCESS' });
  return group;
}
