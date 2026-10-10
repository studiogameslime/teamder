/** Explicit catalog shared by the client, server and private Pulse dashboard. */
export const ONBOARDING_ACTIONS: Record<string, string> = {
  guest_session_started: 'התחיל ביקור כאורח',
  entry_source_resolved: 'זוהה מקור הכניסה',
  organic_entry_viewed: 'נכנס ללא הזמנה',
  entry_welcome_viewed: 'צפה במסך הפתיחה',
  entry_welcome_continued: 'לחץ להתחיל',
  entry_intent_viewed: 'צפה בבחירת דרך ההתחלה',
  entry_intent_selected: 'בחר איך להתחיל',
  entry_existing_account_tapped: 'בחר להתחבר לחשבון קיים',
  onboarding_slide_viewed: 'צפה בשקופית היכרות',
  onboarding_next_tapped: 'לחץ לשקופית הבאה',
  onboarding_finish_tapped: 'לחץ לסיום ההיכרות',
  onboarding_completed: 'סיים את ההיכרות',
  onboarding_skipped: 'דילג על ההיכרות',
  onboarding_step_completed: 'השלים שלב בהיכרות',
  onboarding_checklist_step_tapped: 'בחר משימה ברשימת ההתחלה',
  onboarding_interaction: 'פעל בשלב ההצטרפות',
  personal_invite_viewed: 'צפה בהזמנה מחבר',
  personal_invite_target_opened: 'פתח מחזור או מועדון מתוך ההזמנה',
  personal_invite_explore_tapped: 'בחר לחקור מחוץ להזמנה',
  deferred_deep_link_resolved: 'שוחזרה הזמנה לאחר התקנה',
  invite_link_opened: 'פתח קישור הזמנה',
  invite_link_dead: 'פתח הזמנה לא זמינה',
  pending_action_saved: 'נשמרה פעולה להשלמה לאחר התחברות',
  pending_action_resumed: 'חזר לפעולה לאחר התחברות',
  pending_action_failed: 'הפעולה הממתינה נכשלה',
  auth_prompt_shown: 'נפתח חלון התחברות',
  auth_method_selected: 'בחר אמצעי התחברות',
  auth_completed: 'התחבר בהצלחה',
  auth_cancelled: 'ביטל התחברות',
  auth_failed: 'ההתחברות נכשלה',
  sign_in_attempted: 'ניסה להתחבר',
  sign_in_success: 'התחבר בהצלחה',
  sign_in_failed: 'ניסיון ההתחברות נכשל',
  sign_in_cancelled: 'ביטל ניסיון התחברות',
  sign_in_provider_conflict: 'נתקל בחשבון עם אמצעי התחברות אחר',
  auth_mode_switched: 'החליף בין הרשמה להתחברות',
  password_reset_requested: 'ביקש איפוס סיסמה',
  profile_confirmation_viewed: 'צפה באישור הפרופיל',
  profile_confirmed: 'אישר את הפרופיל',
  profile_save_failed: 'שמירת הפרופיל נכשלה',
  avatar_changed: 'בחר אוואטר',
  photo_uploaded: 'העלה תמונת פרופיל',
  photo_upload_abandoned: 'ביטל בחירת תמונת פרופיל',
  photo_upload_failed: 'העלאת תמונת הפרופיל נכשלה',
  notification_education_shown: 'צפה בהסבר על התראות',
  notification_education_action: 'בחר בהסבר על התראות',
  push_permission_result: 'התקבלה תשובה להרשאת התראות',
  notification_permission_settings_opened: 'פתח הגדרות הרשאת התראות',
  role_selected: 'בחר תפקיד',
  community_create_started: 'התחיל להקים מועדון',
  community_wizard_step_completed: 'השלים שלב בהקמת מועדון',
  group_created: 'הקים מועדון',
  group_create_failed: 'הקמת המועדון נכשלה',
  game_create_started: 'התחיל ליצור מחזור',
  quick_game_flow_started: 'בחר יצירת מחזור חד־פעמי',
  game_create_community_changed: 'בחר מועדון למחזור',
  game_form_warning_shown: 'הוצגה אזהרה ביצירת מחזור',
  game_save_blocked: 'שמירת המחזור נחסמה',
  game_wizard_step_changed: 'עבר שלב ביצירת מחזור',
  game_wizard_submit_failed: 'יצירת המחזור נכשלה',
  game_created: 'יצר מחזור',
  quick_game_created: 'יצר מחזור חד־פעמי',
};

const DETAILS: Record<string, string> = {
  create_club: 'להקים מועדון', find_game: 'למצוא משחק', one_off_game: 'ליצור מחזור חד־פעמי', invite: 'להמשיך דרך ההזמנה',
  photo_picker_opened: 'פתח בחירת תמונה', avatar_selected: 'בחר אוואטר', field_focused: 'לחץ על שדה', field_edited: 'סיים עריכת שדה',
  city_selected: 'בחר עיר', profile_save_tapped: 'לחץ לשמירת פרופיל', email_submit_tapped: 'לחץ לאישור ההתחברות במייל',
  email_screen_left: 'עזב את מסך ההתחברות במייל', password_visibility_toggled: 'שינה הצגת סיסמה', confirmation_visibility_toggled: 'שינה הצגת אימות סיסמה',
  google: 'גוגל', apple: 'אפל', email: 'דואר אלקטרוני', name: 'שם',
  next: 'הבא', back: 'חזור', submit: 'אישור', profile: 'פרופיל', authentication: 'התחברות', profile_setup: 'השלמת פרופיל',
};
export function activityLabel(action: string, params: Record<string, unknown> = {}): string {
  const detail = [params.intent, params.action, params.auth_method, params.method].find(value => typeof value === 'string' && DETAILS[value]);
  const label = action === 'onboarding_interaction' && typeof detail === 'string' ? DETAILS[detail] : ONBOARDING_ACTIONS[action] ?? action;
  const suffix = action !== 'onboarding_interaction' && typeof detail === 'string' ? ` — ${DETAILS[detail]}` : '';
  const step = params.step ?? params.slide;
  const direction = typeof params.direction === 'string' ? DETAILS[params.direction] : '';
  return `${label}${suffix}${step !== undefined ? ` · שלב ${DETAILS[String(step)] ?? step}` : ''}${direction ? ` · ${direction}` : ''}${params.field === 'name' ? ' · שם' : ''}`;
}

// Never upload names, emails, passwords, search queries, free text or full URLs.
const KEYS = new Set(['platform', 'intent', 'invite_kind', 'is_guest', 'entry_source', 'resolved_by', 'has_inviter', 'target_type', 'target_id', 'inviter_uid', 'source', 'channel', 'action_kind', 'auth_method', 'method', 'provider', 'is_existing_account', 'required_profile', 'has_draft', 'had_prefill', 'step', 'slide', 'total', 'via', 'direction', 'mode', 'stage', 'prefilled', 'code', 'reason', 'origin', 'action', 'field', 'has_value', 'granted', 'status', 'result', 'context', 'permission_before', 'permission_after', 'inviter_resolved', 'unresolved_reason', 'has_clubs', 'has_games']);
export function safeActivityParams(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KEYS.has(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 120);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return out;
}
