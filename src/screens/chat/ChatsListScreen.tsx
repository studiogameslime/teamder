import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChatInbox } from '@/components/chat/ChatInbox';
import { PlayerDiscovery } from '@/components/social/PlayerDiscovery';
import { socialStyles } from '@/components/social/SocialUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { ChatStackParamList } from '@/navigation/ChatStack';
import {useSocialInboxBadge} from '@/hooks/useSocialInboxBadge';
type Nav = NativeStackNavigationProp<ChatStackParamList, 'ChatsList'>;

export function ChatsListScreen() {
  const nav = useNavigation<Nav>();
  const route=useRoute();
  const socialBadge=useSocialInboxBadge();
  const qaSocialPreview=__DEV__&&process.env.EXPO_PUBLIC_QA_ROUTES==='1'&&process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK==='1'&&(route.params as {qaSocialPreview?:boolean}|undefined)?.qaSocialPreview;
  const qaChatPreview=__DEV__&&process.env.EXPO_PUBLIC_QA_ROUTES==='1'&&process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK==='1'&&(route.params as {qaChatPreview?:boolean}|undefined)?.qaChatPreview;
  const [socialTab, setSocialTab] = useState<'chats' | 'players'>(qaSocialPreview?'players':'chats');
  useEffect(()=>{if(qaSocialPreview)setSocialTab('players');},[qaSocialPreview]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="חברים" showBack={false} actions={[{icon:'mail-outline',label:socialBadge?`חברים והזמנות, ${socialBadge} ממתינות`:'חברים והזמנות',badge:socialBadge,onPress:()=>nav.navigate('Friends')},{icon:'settings-outline',label:'הגדרות פרטיות',onPress:()=>nav.navigate('SocialPrivacy')}]} />
      <View style={{flexDirection:'row',borderBottomWidth:1,borderBottomColor:'#E5EDF7',paddingHorizontal:16}}>
        {([['chats',"צ׳אטים"],['players','מצא שחקנים']] as const).map(([value,label])=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:socialTab===value}} onPress={()=>setSocialTab(value)} style={{flex:1,paddingVertical:14,borderBottomWidth:2,borderBottomColor:socialTab===value?'#2563EB':'transparent'}}><Text style={{textAlign:'center',fontSize:16,fontWeight:'700',color:socialTab===value?'#2563EB':'#667796'}}>{label}</Text></Pressable>)}
      </View>
      {socialTab === 'players' ? <PlayerDiscovery preview={qaSocialPreview?(require('@/dev/socialPlayersFixture') as typeof import('@/dev/socialPlayersFixture')).socialDemoPlayers:undefined}/> : <ChatInbox preview={qaChatPreview?(require('@/dev/chatInboxFixture') as typeof import('@/dev/chatInboxFixture')).chatInboxPreview:undefined}/>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: socialStyles.root.backgroundColor } });
