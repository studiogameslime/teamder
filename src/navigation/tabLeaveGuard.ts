// tabLeaveGuard — a tiny registry that lets a focused edit screen (game
// create/edit, community edit, group create) intercept a BOTTOM-TAB switch
// the same way `beforeRemove` intercepts a back/pop. React Navigation's
// `beforeRemove` never fires on a tab change (the screen isn't removed, just
// blurred), so tapping another tab used to silently abandon unsaved edits
// (user report on the create-game screen). `resetTabToRoot` (MainTabs)
// consults this before performing any tab switch.

type Guard = {
  /** True when the registered screen currently has unsaved edits. */
  isDirty: () => boolean;
  /** Show the confirm dialog. Call `proceed()` to actually leave (after
   *  the user picks discard, or once a save completes). */
  confirmLeave: (proceed: () => void) => void;
};

let current: Guard | null = null;

/** Register the active edit screen's guard. Returns an unregister fn — call
 *  it on unmount so a stale guard can't block navigation after the screen is
 *  gone. Last registration wins (only one edit screen is focused at a time). */
export function registerTabLeaveGuard(g: Guard): () => void {
  current = g;
  return () => {
    if (current === g) current = null;
  };
}

/** Consulted by the tab-press handler. If a dirty guard is registered, shows
 *  its dialog and returns true (the caller must preventDefault + NOT navigate;
 *  `proceed` performs the deferred switch). Returns false when there's nothing
 *  to guard — the caller navigates normally. */
export function maybeInterceptTabLeave(proceed: () => void): boolean {
  if (current && current.isDirty()) {
    current.confirmLeave(proceed);
    return true;
  }
  return false;
}
