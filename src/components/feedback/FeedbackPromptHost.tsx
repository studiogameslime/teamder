import React, { useEffect, useRef, useState } from 'react';
import { FeedbackPromptDialog } from './FeedbackPromptDialog';
import { useUserStore } from '@/store/userStore';
import { feedbackPromptContext, markFeedbackPromptHandled, shouldShowFeedbackPrompt, submitFeedbackPrompt } from '@/services/feedbackPromptService';
import type { FeedbackDiagnostics } from '@/services/feedbackService';
import { observeCaughtError } from '@/utils/errorObservation';
import { rcBool, useRemoteConfig } from '@/services/remoteConfigService';

export function FeedbackPromptHost({ active, onVisibilityChange }: { active: boolean; onVisibilityChange?: (visible: boolean) => void }) {
  useRemoteConfig();
  const uid = useUserStore(s => s.currentUser?.id);
  const guest = useUserStore(s => s.currentUser?.isGuest === true);
  return uid && !guest ? <AccountFeedbackPrompt key={uid} uid={uid} active={active && !rcBool('maintenance_mode')} onVisibilityChange={onVisibilityChange} /> : null;
}

function AccountFeedbackPrompt({ uid, active, onVisibilityChange }: { uid: string; active: boolean; onVisibilityChange?: (visible: boolean) => void }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [success, setSuccess] = useState(false), [error, setError] = useState('');
  const checked = useRef(false), submitting = useRef(false), mounted = useRef(true);
  const context = useRef<FeedbackDiagnostics | null>(null);
  const visible = active && open;
  const current = () => mounted.current && useUserStore.getState().currentUser?.id === uid;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onVisibilityChange?.(visible); return () => onVisibilityChange?.(false); }, [visible, onVisibilityChange]);
  useEffect(() => {
    if (!active || checked.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void shouldShowFeedbackPrompt(uid).then(show => {
        if (cancelled || !current()) return;
        checked.current = true;
        if (show) { context.current = feedbackPromptContext(uid); setOpen(true); }
      }).catch(caught => {
        if (cancelled || !current()) return;
        checked.current = true;
        observeCaughtError(caught, { source: 'src/components/feedback/FeedbackPromptHost.tsx', handler: 'eligibility', site: 'feedbackPromptEligibility' });
      });
    }, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, uid]);
  const remember = () => { void markFeedbackPromptHandled(uid).catch(caught => observeCaughtError(caught, { source: 'src/components/feedback/FeedbackPromptHost.tsx', handler: 'remember', site: 'feedbackPromptRemember' })); };
  const close = () => { setOpen(false); remember(); };
  const submit = async () => {
    if (submitting.current || success || !message.trim() || !context.current || !current()) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      await submitFeedbackPrompt(uid, message, context.current);
      // The receipt belongs to the captured owner even if they signed out.
      remember();
      if (current()) setSuccess(true);
    } catch (caught) {
      observeCaughtError(caught, { source: 'src/components/feedback/FeedbackPromptHost.tsx', handler: 'submit', site: 'feedbackPromptSubmit' });
      if (current()) setError('ההצעה לא נשלחה. הטקסט נשמר כאן, אפשר לנסות שוב.');
    } finally {
      submitting.current = false;
      if (current()) setBusy(false);
    }
  };
  if (!visible) return null;
  return <FeedbackPromptDialog message={message} busy={busy} error={error} success={success} onChange={setMessage} onSubmit={() => { void submit(); }} onClose={close} />;
}
