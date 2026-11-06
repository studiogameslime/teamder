import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors, font, RTL_LABEL_ALIGN } from '../theme';
import { ensureTaskFromOrigin, type TaskOrigin } from '../services/taskConversion';
import { observeCaughtError } from '../services/errorObservation';
import { navRef } from '../navigation/navRef';

export function ConvertToTaskButton({ origin, linkedTaskId, onOpen }: { origin: TaskOrigin; linkedTaskId?: string; onOpen?: () => void }) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const serial = useRef(0), pending = useRef(false), key = JSON.stringify(origin.kind === 'feedback' ? [origin.kind, origin.id] : [origin.kind, origin.userId, origin.messageId]);
  useEffect(() => { serial.current++; pending.current = false; setBusy(false); setFailed(false); return () => { serial.current++; }; }, [key]);
  const convert = async () => {
    if (pending.current) return;
    const current = serial.current;
    pending.current = true; setBusy(true); setFailed(false);
    try {
      const result = linkedTaskId ? { taskId: linkedTaskId } : await ensureTaskFromOrigin(origin);
      if (current !== serial.current) return;
      if (!navRef.isReady()) throw new Error('TASK_NAVIGATION_NOT_READY');
      onOpen?.();
      (navRef as any).navigate('Tasks', { taskId: result.taskId, taskOpenAt: Date.now() });
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/components/ConvertToTaskButton.tsx', handler: 'convert', site: 'task:conversion' });
      if (current === serial.current) setFailed(true);
    } finally { if (current === serial.current) { pending.current = false; setBusy(false); } }
  };
  return <View style={{ gap: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={linkedTaskId ? 'פתיחת המשימה המקושרת' : 'הפוך למשימה'} accessibilityHint="אם כבר נוצרה משימה מהמקור הזה, תיפתח אותה משימה." accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void convert()} style={{ minHeight: 44, paddingVertical: 10, flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 8 }}>
      <Text style={{ ...font.title, color: colors.primary, textAlign: RTL_LABEL_ALIGN }}>{busy ? 'פותחים משימה' : linkedTaskId ? 'פתיחת המשימה המקושרת' : 'הפוך למשימה'}</Text>
      {busy ? <ActivityIndicator color={colors.primary}/> : null}
    </Pressable>
    {failed ? <Text style={{ ...font.small, color: colors.red, textAlign: RTL_LABEL_ALIGN }}>לא ניתן לאשר פתיחת משימה. נסו שוב. אם השמירה הושלמה, תיפתח אותה משימה בלי ליצור עותק נוסף.</Text> : null}
  </View>;
}
