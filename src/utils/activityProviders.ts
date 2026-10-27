/** Catalog describes compatible sources, not installed apps or available measurements. */
export const activityProviders = [
  { id: 'com.google.android.apps.fitness', label: 'גוגל פיט', icon: 'fit', hint: 'צעדים, מרחק ופעילות מהטלפון או מהשעון' },
  { id: 'com.sec.android.app.shealth', label: 'סמסונג בריאות', icon: 'samsung', hint: 'פעילות מהטלפון ומשעון סמסונג' },
  { id: 'com.garmin.android.apps.connectmobile', label: 'גרמין', icon: 'garmin', hint: 'פעילות שסונכרנה מאפליקציית השעון' },
  { id: 'com.fitbit.FitbitMobile', label: 'פיטביט', icon: 'fitbit', hint: 'פעילות שסונכרנה מאפליקציית השעון' },
  { id: 'com.strava', label: 'סטרבה', icon: 'strava', hint: 'אימונים שהאפליקציה משתפת' },
  { id: 'fi.polar.polarflow', label: 'פולאר', icon: 'polar', hint: 'אימונים שהאפליקציה משתפת' },
  { id: 'phone', label: 'הטלפון שלי', icon: 'phone', hint: 'מונה הצעדים המובנה, צעדים בלבד' },
] as const;
export type ActivityProvider = { id: string; label: string; icon: string; hint: string };
export function isPhoneActivitySource(id: string): boolean {
  return id === 'android' || id.startsWith('com.android.healthconnect.phone.');
}
export function activityProvider(id: string, kind?: string): ActivityProvider {
  if (kind === 'wear-health-services') return { id, label: 'השעון שלי', icon: 'watch', hint: 'התחלה ועצירה של מדידה בשעון' };
  return activityProviders.find(p => p.id === (isPhoneActivitySource(id) ? 'phone' : id))
    ?? { id, label: 'אפליקציית פעילות', icon: 'other', hint: 'נתונים משותפים ממאגר הבריאות' };
}
export function matchesActivityProvider(sourceId: string, providerId: string): boolean {
  return providerId === 'phone' ? isPhoneActivitySource(sourceId) : sourceId === providerId;
}
