import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseRoundVisit, type RoundVisit } from '@/utils/roundVisit';
import { observeCaughtError } from '@/utils/errorObservation';

const keyFor = (owner: string) => `footy.roundVisits.v1.${owner}`;
const MAX_VISITS = 60;
// Serialize only this small local ledger. It never writes round or account data.
let writes: Promise<unknown> = Promise.resolve();
async function ledger(owner: string): Promise<Record<string, RoundVisit>> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(owner));
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      const visit = parseRoundVisit(value); return visit ? [[id, visit]] : [];
    }));
  } catch (error) {
    observeCaughtError(error, {source: 'src/services/roundVisitService.ts', handler: 'ledger', site: 'roundVisit:read'});
    return {};
  } // Optional presentation memory; never a server read.
}
export async function readRoundVisit(owner: string, id: string): Promise<RoundVisit | null> {
  await writes;
  return (await ledger(owner))[id] ?? null;
}
export function saveRoundVisit(owner: string, id: string, visit: RoundVisit): Promise<void> {
  const save = async () => {
    const entries = Object.entries(await ledger(owner)).filter(([key]) => key !== id);
    await AsyncStorage.setItem(keyFor(owner), JSON.stringify(Object.fromEntries([...entries, [id, visit]].slice(-MAX_VISITS))));
  };
  const result = writes.then(save);
  writes = result.catch(error => {
    observeCaughtError(error, {source: 'src/services/roundVisitService.ts', handler: 'saveRoundVisit', site: 'roundVisit:write'});
  });
  return result;
}
