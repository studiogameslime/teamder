export const SUPPORT_IMAGE_LIMIT = 180_000;
export function validateSupportMessage(input: any): { id: string; text: string; image?: string; context: Record<string, string | number> } {
  if (!input || typeof input.id !== 'string' || !/^support-[a-zA-Z0-9-]{10,100}$/.test(input.id)) throw new Error('invalid-message');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  // Callable encoding turns an explicitly undefined optional field into null.
  // Released clients send image: undefined for text-only messages.
  const image = input.image == null ? undefined : input.image;
  if (text.length > 1000 || (image !== undefined && (typeof image !== 'string' || image.length > SUPPORT_IMAGE_LIMIT || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image)))) throw new Error('invalid-message');
  if (!text && !image) throw new Error('empty-message');
  const context: Record<string, string | number> = {};
  for (const key of ['screen', 'screenLabel', 'step', 'groupId', 'gameId', 'appVersion', 'platform']) {
    const value = input.context?.[key];
    if (typeof value === 'string' && value.length <= 140 && !/[\u0000-\u001f\u202a-\u202e]/.test(value)) context[key] = value;
    else if (key === 'step' && Number.isSafeInteger(value) && value >= 0 && value <= 100) context[key] = value;
  }
  if (!context.screen) throw new Error('missing-context');
  return { id: input.id, text: text || 'מצורף צילום מסך', ...(image ? { image } : {}), context };
}
