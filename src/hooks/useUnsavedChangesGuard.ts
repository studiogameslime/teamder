// useUnsavedChangesGuard — pops the standard "unsaved changes" dialog
// when the user tries to leave a screen (back gesture, header back, or
// a tab switch) while there are unsaved edits. Mirrors the behaviour
// that ProfileEditScreen had inline, so every edit screen
// (notifications, availability, the create/edit wizard) behaves the
// same instead of silently discarding changes.
//
// Usage:
//   const savingRef = useRef(false);
//   useUnsavedChangesGuard({ isDirty, savingRef, onSave: save });
//   // in save(): set savingRef.current = true before nav.goBack()
//
// `savingRef` lets the legitimate save→goBack flow pass through without
// re-prompting (the save handler navigates away itself).

import { useEffect, useRef } from 'react';
import {  } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { useNavigation } from '@react-navigation/native';
import { he } from '@/i18n/he';
import { registerTabLeaveGuard } from '@/navigation/tabLeaveGuard';

interface Options {
  /** True when the screen has edits that haven't been persisted. */
  isDirty: boolean;
  /** Set true by the caller's save handler so the save→leave flow
   *  doesn't re-trigger the guard. Optional — created internally if
   *  omitted (the caller can read `.current`). */
  savingRef?: React.MutableRefObject<boolean>;
  /** Invoked when the user picks "save" in the dialog. */
  onSave: () => void | Promise<void>;
  /** Optional dialog copy override. Defaults to the profile/avatar
   *  wording — every non-profile screen (game/community wizard) should
   *  pass its own so the prompt actually matches what the user edited. */
  title?: string;
  body?: string;
}

export function useUnsavedChangesGuard({
  isDirty,
  savingRef,
  onSave,
  title,
  body,
}: Options) {
  const nav = useNavigation();
  const internalSaving = useRef(false);
  const saving = savingRef ?? internalSaving;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  // Listeners are installed once, but edits, copy and an externally supplied
  // saving ref may all change while the screen stays mounted. Read them at
  // event/button time, including a dialog opened before the latest render.
  const latest = useRef({ saving, onSave, title, body });
  latest.current = { saving, onSave, title, body };

  useEffect(() => {
    const unsub = (nav as unknown as {
      addListener: (
        e: 'beforeRemove',
        h: (e: { preventDefault: () => void; data: { action: unknown } }) => void,
      ) => () => void;
    }).addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || latest.current.saving.current) return;
      e.preventDefault();
      appAlert(latest.current.title ?? he.profileEditUnsavedTitle, latest.current.body ?? he.profileEditUnsavedBody, [
        {
          text: he.profileEditUnsavedDiscard,
          style: 'destructive',
          onPress: () => {
            (nav as unknown as { dispatch: (a: unknown) => void }).dispatch(
              e.data.action,
            );
          },
        },
        {
          text: he.profileEditUnsavedSave,
          onPress: async () => {
            await latest.current.onSave();
          },
        },
        { text: he.cancel, style: 'cancel' },
      ]);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  // Bottom-tab switches don't fire `beforeRemove` (the screen is blurred, not
  // removed), so tapping another tab would silently drop unsaved edits. Register
  // a tab-leave guard that `resetTabToRoot` (MainTabs) consults; it shows the
  // same confirm dialog and only leaves on discard / after a successful save.
  useEffect(() => {
    const unregister = registerTabLeaveGuard({
      isDirty: () => dirtyRef.current && !latest.current.saving.current,
      confirmLeave: (proceed) => {
        appAlert(
          latest.current.title ?? he.profileEditUnsavedTitle,
          latest.current.body ?? he.profileEditUnsavedBody,
          [
            {
              text: he.profileEditUnsavedDiscard,
              style: 'destructive',
              onPress: () => proceed(),
            },
            {
              text: he.profileEditUnsavedSave,
              onPress: async () => {
                await latest.current.onSave();
              },
            },
            { text: he.cancel, style: 'cancel' },
          ],
        );
      },
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return saving;
}
