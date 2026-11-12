import { doc, getDoc } from 'firebase/firestore';
import * as lite from 'firebase/firestore/lite';
import { getFirebase } from '@/firebase/config';
import { isTransientReadError } from './readRetry';
import { observeCaughtError } from '@/utils/errorObservation';

function bounded<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('App configuration read timed out'), {code: 'deadline-exceeded'})), ms);
  });
  return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
}

/** The streaming client can be offline while ordinary HTTPS still works.
 * Both reads use the same Firebase app, document, credentials and rules. */
export async function readAppConfig(key: 'ads' | 'features' | 'whatsNew') {
  const { app, db } = getFirebase();
  try {
    return await bounded(getDoc(doc(db, 'appConfig', key)), 2500);
  } catch (error) {
    if (!isTransientReadError(error)) {
      observeCaughtError(error, {source: 'src/services/readAppConfig.ts', handler: 'readAppConfig', site: 'appConfig:' + key});
      throw error;
    }
    return bounded(lite.getDoc(lite.doc(lite.getFirestore(app), 'appConfig', key)), 8000);
  }
}
