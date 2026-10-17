/** Keep server diagnostics in logs while presenting actionable Hebrew copy. */
export function roundSaveError(error: unknown, fallback: string): string {
  const message = String((error as {message?: unknown})?.message ?? '');
  if (message.includes('closedSeasonGame')) return 'לא ניתן לשמור: שיוך העונה של המחזור אינו תואם לעונה הפעילה. הגולים והבעיטות נשמרו; יש לבדוק את העונה ולנסות שוב.';
  if (message.includes('season-operation:busy')) return 'מתבצע עדכון עונה במועדון. הגולים והבעיטות נשמרו; נסו שוב לאחר סיומו.';
  return /[א-ת]/.test(message) ? message : fallback;
}
