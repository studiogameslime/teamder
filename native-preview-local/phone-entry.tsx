import React from 'react';
import { AppRegistry, I18nManager, LogBox, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PhoneActivityTest } from '../src/components/activity/PhoneActivityTest';
import * as SplashScreen from 'expo-splash-screen';
I18nManager.allowRTL(true); I18nManager.forceRTL(true); LogBox.ignoreAllLogs(true);
const Stack = createNativeStackNavigator();
function Screen() { React.useEffect(() => { void SplashScreen.hideAsync(); }, []); return <PhoneActivityTest onClose={() => {}} />; }
function Preview() { return <SafeAreaProvider><StatusBar barStyle="dark-content" backgroundColor="#F5F8FA" /><NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="PhoneTest" component={Screen} /></Stack.Navigator></NavigationContainer></SafeAreaProvider>; }
AppRegistry.registerComponent('main', () => Preview);
