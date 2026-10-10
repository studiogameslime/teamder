// Public campaign codes are identifiers, never authentication tokens.
export const AD_LINK_ORIGIN = 'https://teamderfc.web.app';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const SHORT_CODE_LENGTH = 8;
export function newAdLinkCode(random: () => number = Math.random): string {
  return Array.from({ length: SHORT_CODE_LENGTH }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
}
export function buildShortAdLink(code: string): string {
  if (!/^[A-Za-z0-9]{8}$/.test(code)) throw new Error('מזהה קישור לא תקין');
  return `${AD_LINK_ORIGIN}/play/${code}`;
}
export interface ShortAdLinkInput { name: string; source: string; campaign?: string; gameId?: string }
export type CreateOnlyResult = 'created' | 'conflict' | 'error';
export async function createShortAdLink(
  input: ShortAdLinkInput,
  createOnly: (path: string, fields: Record<string, unknown>) => Promise<CreateOnlyResult>,
  random: () => number = Math.random,
): Promise<{ ok: boolean; url: string }> {
  const source = input.source.trim();
  if (!source || source.length > 200) throw new Error('בחר מקור תקין לקישור');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newAdLinkCode(random);
    const url = buildShortAdLink(code);
    const result = await createOnly(`adLinks/${code}`, {
      name: input.name.trim() || source, source,
      ...(input.campaign?.trim() ? { campaign: input.campaign.trim() } : {}),
      ...(input.gameId?.trim() ? { gameId: input.gameId.trim() } : {}),
      shortCode: code, url, clicks: 0, createdAt: Date.now(),
    });
    if (result === 'created') return { ok: true, url };
    if (result === 'error') return { ok: false, url: '' };
  }
  throw new Error('לא הצלחנו להקצות קישור פנוי. נסה שוב');
}
