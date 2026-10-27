import React, { useState } from 'react';
import { AppRegistry, I18nManager, Text, View, ScrollView, StatusBar, LogBox, Pressable } from 'react-native';
import { MyActivityDashboard } from '../src/components/activity/MyActivityDashboard';
import { MyActivityRoundCard } from '../src/components/activity/MyActivityRoundCard';
I18nManager.allowRTL(true); I18nManager.forceRTL(true); LogBox.ignoreAllLogs(true);
const old = (Text as any).defaultProps ?? {};
(Text as any).defaultProps = { ...old, style: [{ textAlign: 'right', writingDirection: 'rtl' }, old.style] };
const metrics = { recordingMs: 25 * 60000, distanceM: 2300, steps: 3184, calories: null, caloriesKind: 'total' as const, totalCalories: 276, avgHeartRateBpm: 138, maxHeartRateBpm: 172 };
function Preview() {
  const [round, setRound] = useState(false);
  return <View style={{ flex: 1, backgroundColor: '#F5F8FA' }}>
    <StatusBar barStyle="dark-content" backgroundColor="#F5F8FA" />
    <Pressable onPress={() => setRound(!round)} style={{ paddingTop: 34, paddingHorizontal: 20, paddingBottom: 10 }}>
      <Text style={{ fontSize: 12, color: '#677B8D', textAlign: 'left' }}>תצוגת עיצוב באימולטור, נתוני הדגמה</Text>
    </Pressable>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      {round ? <View style={{ gap: 24 }}><Text style={{ fontSize: 28, fontWeight: '800', textAlign: 'left', color: '#10283F' }}>הסיכום שלי</Text>
        <View style={{ borderRadius: 24, backgroundColor: '#10283F', padding: 26, gap: 14 }}><Text style={{ color: '#9DE8CF', fontSize: 14, textAlign: 'left' }}>סיכום המחזור האישי</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800', textAlign: 'left' }}>ערב של כדורגל</Text>
          <Text style={{ color: '#C6D9E0', fontSize: 14, textAlign: 'left' }}>כאן יופיע סיכום הכדורגל הקיים שלך</Text></View>
        <MyActivityRoundCard status="available" metrics={{...metrics,calories:276}} sourceLabel="שירותי הבריאות בשעון" periodLabel="סיכום המחזור האישי" durationLabel="זמן שנמדד במחזור" onPress={() => {}} />
        <Text style={{ color: '#677B8D', textAlign: 'left', fontSize: 12, lineHeight: 20 }}>כרטיס הפעילות מופיע כרכיב אישי נוסף מתחת לסיכום. הוא אינו נכלל בתמונת השיתוף.</Text>
      </View> : <MyActivityDashboard status="available" scope="day" metrics={metrics} periodLabel="היום, 26.10.2026" sourceLabel="אפליקציית השעון שלי" onRefresh={() => {}} lastUpdatedLabel="העדכון האחרון התקבל בשעה 20:14" />}
    </ScrollView>
  </View>;
}
AppRegistry.registerComponent('main', () => Preview);
