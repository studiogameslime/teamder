import * as admin from 'firebase-admin';

/** Server-owned number, stable across visits and in-place anonymous upgrades. */
export async function onboardingGuestNumber(uid: string, allocate = false): Promise<number | undefined> {
  const db = admin.firestore();
  const ref = db.doc(`onboardingGuests/${uid}`);
  const valid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
  if (!allocate) {
    const value = (await ref.get()).data()?.number;
    return valid(value) ? value : undefined;
  }
  const counter = db.doc('adminConfig/onboardingGuestCounter');
  return db.runTransaction(async tx => {
    const [guest, count] = await tx.getAll(ref, counter);
    if (valid(guest.data()?.number)) return guest.data()!.number as number;
    const previous = count.data()?.lastNumber;
    if (previous !== undefined && (!Number.isSafeInteger(previous) || previous < 0)) {
      throw new Error('Invalid onboarding guest counter');
    }
    const number = (previous ?? 0) + 1;
    if (!Number.isSafeInteger(number)) throw new Error('Onboarding guest counter exhausted');
    tx.set(counter, { lastNumber: number });
    tx.set(ref, { number, createdAt: Date.now() });
    return number;
  });
}
