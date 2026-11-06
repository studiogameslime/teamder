import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { colors, RTL_LABEL_ALIGN } from '@/theme';

/** A delayed hint, never a guess that the device is offline. */
export function useSlowOperation(active: boolean, scope: string, delay = 6000) {
  const key = JSON.stringify([scope, active]);
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    setElapsed(null);
    if (!active) return;
    const timer = setTimeout(() => setElapsed(key), delay);
    return () => clearTimeout(timer);
  }, [active, key, delay]);
  return active && elapsed === key;
}

export function ReadStatusNotice({ loading, failed, hasData, scope, onRetry }: {
  loading: boolean; failed: boolean; hasData: boolean; scope: string; onRetry: () => void;
}) {
  const slow = useSlowOperation(loading, scope);
  if (!failed && !slow) return null;
  return <View style={styles.wrap}>
    <View style={styles.row}>
      <Ionicons name={failed ? 'cloud-offline-outline' : 'time-outline'} size={21} color="#895700" accessible={false}/>
      <View style={styles.copy}>
        <Text accessibilityLiveRegion="polite" style={styles.title}>{failed ? hasData ? 'לא הצלחנו להתעדכן' : 'לא הצלחנו לטעון את המידע' : hasData ? 'העדכון מתעכב' : 'הטעינה מתעכבת'}</Text>
        <Text style={styles.body}>{hasData ? 'מוצג מידע שכבר נטען. ייתכן שהפרטים השתנו.' : 'המידע עדיין לא זמין. נציג אותו לאחר שהטעינה תצליח.'} {failed ? 'בדקו את החיבור ונסו שוב.' : 'אפשר לחזור למסך הזה בהמשך.'}</Text>
      </View>
    </View>
    {failed ? <Button title="נסו שוב" variant="outline" size="sm" disabled={loading} onPress={onRetry}/> : null}
  </View>;
}

/** The stage comes from the operation, not from a timer or invented percentage. */
export function OperationStatus({ active, label, scope, awaitingConfirmation = false, showLabel = true }: {
  active: boolean; label: string; scope: string; awaitingConfirmation?: boolean; showLabel?: boolean;
}) {
  const slow = useSlowOperation(active, scope);
  if (!active || !showLabel && !slow) return null;
  return <View style={styles.operation}>
    {showLabel ? <Text accessibilityLiveRegion="polite" style={styles.operationLabel}>{label}</Text> : null}
    {slow ? <Text style={styles.body}>{awaitingConfirmation ? 'עדיין ממתינים לאישור. אין צורך ללחוץ שוב.' : 'הפעולה מתארכת. נעדכן כאן כשהשלב יסתיים.'}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: {padding: 12, gap: 10, marginVertical: 8, borderRadius: 14, backgroundColor: '#FFF8E7', borderWidth: 1, borderColor: '#E8D5A8'},
  row: {flexDirection: 'row', gap: 10, alignItems: 'flex-start'},
  copy: {flex: 1, gap: 4},
  title: {fontSize: 14, fontWeight: '800', color: '#704600', textAlign: RTL_LABEL_ALIGN},
  body: {fontSize: 13, lineHeight: 20, color: '#655337', textAlign: RTL_LABEL_ALIGN},
  operation: {gap: 4, paddingVertical: 8, alignSelf: 'stretch'},
  operationLabel: {fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN},
});
