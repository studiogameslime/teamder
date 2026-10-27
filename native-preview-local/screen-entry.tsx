import React from 'react';
import { AppRegistry, I18nManager, Text, View, StatusBar, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
I18nManager.allowRTL(true); I18nManager.forceRTL(true); LogBox.ignoreAllLogs(true);
const old = (Text as any).defaultProps ?? {};
(Text as any).defaultProps = { ...old, style: [{ textAlign: 'right', writingDirection: 'rtl' }, old.style] };
const nothing = async () => {};
// Fixture affects this isolated preview runtime only. Real screen and navigation components are unchanged.
const activityHook = require('../src/services/useMyActivity');
activityHook.useMyActivity = () => ({ status: 'available', metrics: { movement: { maxSpeedKmh: 24.3, avgSpeedKmh: 6.2, stationaryMs: 300000, walkingMs: 300000, runningMs: 600000, sprintMs: 45000, sprints: 6, sampledMs: 1200000 }, recordingMs: 1500000, distanceM: 2300, steps: 3184,
  calories: null, caloriesKind: 'total', totalCalories: 276, avgHeartRateBpm: 138, maxHeartRateBpm: 172 }, sourceLabel: 'אפליקציית השעון שלי',
  periodLabel: 'היום: 26.10.2026', refreshing: false, selectedDay: '2026-10-26', previousDay: nothing, nextDay: nothing,
  canNextDay: false, canPreviousDay: true, lastUpdatedLabel: 'העדכון האחרון התקבל בשעה 20:14', error: null,
  sources: [{ id: 'demo-wear', label: 'אפליקציית השעון שלי', detail: 'שעון מחובר לצורך הדגמת התצוגה', kind: 'wear-health-services' }],
  selectedSourceId: 'demo-wear', refresh: nothing, connect: nothing, selectSource: nothing, disconnect: nothing });
const { MyActivityScreen } = require('../src/screens/profile/MyActivityScreen');
const Stack = createNativeStackNavigator();
function Preview() {
  return <SafeAreaProvider><View style={{ flex: 1, backgroundColor: '#F5F8FA' }}>
    <StatusBar barStyle="dark-content" backgroundColor="#F5F8FA" />
    <View style={{ paddingTop: 30, paddingHorizontal: 16, paddingBottom: 5 }}><Text style={{ color: '#677B8D', fontSize: 11, textAlign: 'left' }}>תצוגת מסך מקורית, נתוני הדגמה ללא סנכרון</Text></View>
    <NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="MyActivity" component={MyActivityScreen} /></Stack.Navigator></NavigationContainer>
  </View></SafeAreaProvider>;
}
AppRegistry.registerComponent('main', () => Preview);
