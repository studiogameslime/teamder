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

interface Options {
  /** True when the screen has edits that haven't been persisted. */
  isDirty: boolean;
  /** Set true by the caller's save handler so the save→leave flow
   *  doesn't re-trigger the guard. Optional — created internally if
   *  omitted (the caller can read `.current`). */
  savingRef?: React.MutableRefObject<boolean>;
  /** Invoked when the user picks "save" in the dialog. */
  onSave: () => void | Promise<void>;
}

export function useUnsavedChangesGuard({ isDirty, savingRef, onSave }: Options) {
  const nav = useNavigation();
  const internalSaving = useRef(false);
  const saving = savingRef ?? internalSaving;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const unsub = (nav as unknown as {
      addListener: (
        e: 'beforeRemove',
        h: (e: { preventDefault: () => void; data: { action: unknown } }) => void,
      ) => () => void;
    }).addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || saving.current) return;
      e.preventDefault();
      appAlert(he.profileEditUnsavedTitle, he.profileEditUnsavedBody, [
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
            await onSave();
          },
        },
        { text: he.cancel, style: 'cancel' },
      ]);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  return saving;
}
