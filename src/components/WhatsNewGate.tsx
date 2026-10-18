// WhatsNewGate — decides (once per launch) whether to show the "מה חדש" modal.
// Mounted in App.tsx next to CampaignGate and only made `active` when the app
// is past splash, signed in, onboarded, and NOT showing a force/optional update
// modal — so the What's New sheet never competes with an update prompt.
//
// Persist after a visible render. Failure/cancellation must not consume a release.

import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import {
  resolveWhatsNew,
  markWhatsNewSeen,
  type WhatsNewPayload,
} from '@/services/whatsNewService';

export function WhatsNewGate({
  active,
  onVisibilityChange,
}: {
  active: boolean;
  /** Reports whether the sheet is on screen. Added so the contextual
   *  notification offer can stand down while this owns the screen — two
   *  one-time interruptions stacked is the modal-over-modal the offer's own
   *  queue exists to avoid. Optional; nothing else uses it. */
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const [payload, setPayload] = useState<WhatsNewPayload | null>(null);
  // One resolve per app session — the modal is one-time, and re-checking on
  // every foreground would be wasteful (and already blocked by seenVersion).
  const checkedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || checkedRef.current) return;
    checkedRef.current = true;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let complete = false;
    (async () => {
      try {
        const p = await resolveWhatsNew();
        if (!alive) return;
        complete = true;
        if (p) setPayload(p);
      } catch {
        // Transient network/storage failures must not consume this release.
        if (alive) {
          checkedRef.current = false;
          retry = setTimeout(() => setAttempt(value => value + 1), 30_000);
        }
      }
    })();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      if (!complete) checkedRef.current = false;
    };
  }, [active, attempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !checkedRef.current) setAttempt(value => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active || !payload) return;
    // Persist only after a committed render of the visible sheet. A gate
    // deactivated during the fetch must not mark an unseen sheet as shown.
    void markWhatsNewSeen(payload.version).catch(() => {
      // Keep the session visible/usable; a later launch can retry persistence.
    });
  }, [active, payload]);

  useEffect(() => {
    onVisibilityChange?.(active && !!payload);
  }, [active, payload, onVisibilityChange]);

  if (!active || !payload) return null;
  return (
    <WhatsNewModal
      version={payload.version}
      items={payload.items}
      onClose={() => setPayload(null)}
    />
  );
}
