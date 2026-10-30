// Isolated rendering of the real Pulse screen. No Firebase imports or account.
import React from 'react';
import { AppRegistry, I18nManager, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProPlanningScreen } from '../pulse/src/screens/ProPlanningScreen';
import * as SplashScreen from 'expo-splash-screen';
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
LogBox.ignoreAllLogs(true);
function Preview() { React.useEffect(() => { void SplashScreen.hideAsync(); }, []); return <SafeAreaProvider><ProPlanningScreen /></SafeAreaProvider>; }
AppRegistry.registerComponent('main', () => Preview);
