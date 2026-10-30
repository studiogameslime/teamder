// Isolated native rendering of the real manager screen. Services are replaced
// only by the dedicated Metro resolver, never in the product bundle.
import React from 'react';
import {AppRegistry,I18nManager,LogBox,View,Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ManagerDashboardScreen} from '../src/screens/communities/ManagerDashboardScreen';
import {DockIcon} from '../src/components/NavigationDock';
I18nManager.allowRTL(true);I18nManager.forceRTL(true);LogBox.ignoreAllLogs(true);
const Stack=createNativeStackNavigator();
function Placeholder(){return <View><Text>מסך חיצוני לתצוגת הבדיקה</Text></View>}
function Preview(){return <SafeAreaProvider><NavigationContainer linking={{prefixes:['managerpreview://'],config:{screens:{ManagerDashboard:'manager/:groupId',External:'external'}}}}><View style={{flex:1,backgroundColor:'#F3F6FA'}}><Stack.Navigator screenOptions={{headerShown:false}}><Stack.Screen name="ManagerDashboard" component={ManagerDashboardScreen} initialParams={{groupId:'g1'}}/>{['MatchDetails','AdminApproval','PlayerTimeline','CommunityStats','CommunityHistory','SeasonSummary','CommunityEdit'].map(name=><Stack.Screen key={name} name={name} component={Placeholder}/>)}</Stack.Navigator><View style={{marginHorizontal:16,marginVertical:8,height:70,borderRadius:16,backgroundColor:'#FFF',borderWidth:1,borderColor:'#DCE7FA',flexDirection:'row'}}>{[['ProfileTab','בית'],['CommunitiesTab','מועדונים'],['GameTab','מחזורים'],['ChatTab','חברים']].map(([tab,label])=><View key={tab} style={{flex:1,alignItems:'center',justifyContent:'center'}}><View style={{borderRadius:11,backgroundColor:tab==='CommunitiesTab'?'#2463EB':'transparent'}}><DockIcon tab={tab} color={tab==='CommunitiesTab'?'#FFF':'#667085'}/></View><Text style={{fontSize:11,fontWeight:'700',color:tab==='CommunitiesTab'?'#2463EB':'#667085'}}>{label}</Text></View>)}</View></View></NavigationContainer></SafeAreaProvider>}
AppRegistry.registerComponent('main',()=>Preview);
