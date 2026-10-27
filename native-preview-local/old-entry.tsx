import React from 'react';
import { AppRegistry, I18nManager, Text, View, ScrollView, StatusBar, LogBox } from 'react-native';
import { PersonalActivityContent } from '../src/components/summary/PersonalActivityPanel';
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
LogBox.ignoreAllLogs(true);
const old=(Text as any).defaultProps??{};
(Text as any).defaultProps={...old,style:[{textAlign:'right',writingDirection:'rtl'},old.style]};
const summary={gameId:'local-preview',eligibleMs:40*60000,measuredMs:25*60000,coverageRatio:0.625,
  distanceM:2300,steps:3184,calories:276,avgHeartRateBpm:138,maxHeartRateBpm:172,
  heartRateSamples:48,excludedBoundarySamples:3,coverageMs:{distanceM:25*60000,steps:19*60000,calories:25*60000}};
function Preview(){return <View style={{flex:1,backgroundColor:'#F7F9FD'}}>
  <StatusBar barStyle="dark-content" backgroundColor="#F7F9FD"/>
  <View style={{paddingTop:34,paddingHorizontal:20,paddingBottom:12}}><Text style={{fontSize:22,fontWeight:'800',textAlign:'left',color:'#102744'}}>הסיכום שלי</Text><Text style={{fontSize:12,color:'#63778C',textAlign:'left'}}>תצוגת בדיקה מקומית, נתוני הדגמה</Text></View>
  <ScrollView contentContainerStyle={{padding:16,paddingBottom:28}}><PersonalActivityContent state={{status:'available',summary}} onRefresh={()=>{}}/></ScrollView>
</View>}
AppRegistry.registerComponent('main',()=>Preview);

