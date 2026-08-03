// WhatsNewGate — decides (once per launch) whether to show the "מה חדש" modal.
// Mounted in App.tsx next to CampaignGate and only made `active` when the app
// is past splash, signed in, onboarded, and NOT showing a force/optional update
// modal — so the What's New sheet never competes with an update prompt.
//
// One-time guarantee: we write seenVersion = current the instant we decide to
// show (before rendering), so the modal can't reappear for that version even if
// the app is killed mid-modal.

import React, { useEffect, useRef, useState } from 'react';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import {
  resolveWhatsNew,
  markWhatsNewSeen,
  type WhatsNewPayload,
} from '@/services/whatsNewService';

export function WhatsNewGate({ active }: { active: boolean }) {
  const [payload, setPayload] = useState<WhatsNewPayload | null>(null);
  // One resolve per app session — the modal is one-time, and re-checking on
  // every foreground would be wasteful (and already blocked by seenVersion).
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!active || checkedRef.current) return;
    checkedRef.current = true;
    let alive = true;
    (async () => {
      const p = await resolveWhatsNew();
      if (!alive || !p) return;
      // Write-through BEFORE showing → strictly one-time per version.
      await markWhatsNewSeen(p.version);
      if (alive) setPayload(p);
    })();
    return () => {
      alive = false;
    };
  }, [active]);

  if (!payload) return null;
  return (
    <WhatsNewModal
      version={payload.version}
      items={payload.items}
      onClose={() => setPayload(null)}
    />
  );
}
