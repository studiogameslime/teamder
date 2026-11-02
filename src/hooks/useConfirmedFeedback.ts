import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUserStore } from '@/store/userStore';
import { successHaptic } from '@/utils/haptics';
import { toast } from '@/components/Toast';

/** Called only after a confirmed service result, never from a pending/optimistic state. */
export function useConfirmedFeedback(scope: string, ownerId: string | undefined) {
  const current = useRef(scope); current.current = scope;
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [receipt, setReceipt] = useState<{ scope: string; key: string; label: string } | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setReceipt(null);
  }, []);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; clear(); }; }, [scope, clear]));
  useEffect(() => clear, [clear]);
  const confirm = useCallback((key: string, label: string, tone: 'success' | 'info' = 'success') => {
    if (!focused.current || current.current !== scope || useUserStore.getState().currentUser?.id !== ownerId) return;
    clear(); setReceipt({ scope, key, label }); successHaptic();
    toast[tone](label);
    timer.current = setTimeout(() => { timer.current = null; setReceipt(null); }, 1400);
  }, [scope, ownerId, clear]);
  const labelFor = useCallback((key: string) => receipt?.scope === scope && receipt.key === key ? receipt.label : undefined, [receipt, scope]);
  return { confirm, labelFor };
}
