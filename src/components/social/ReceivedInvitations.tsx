import { useGroupStore } from '@/store/groupStore';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useUserStore } from '@/store/userStore';
import { receivedInvitationsService } from '@/services/receivedInvitationsService';
import { notificationsService } from '@/services/notificationsService';
import { navigateForPush, navigateInvite } from '@/navigation/navigationRef';
import { acceptReceivedInvitation } from '@/services/acceptReceivedInvitation';
import { InvitationCard } from './InvitationCard';
import { toast } from '@/components/Toast';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { ReceivedInvitation } from '@/utils/receivedInvitations';
import { SocialAction, socialStyles as s } from './SocialUI';

export function ReceivedInvitations({refreshKey=0}:{refreshKey?:number}) {
  const me=useUserStore(x=>x.currentUser), epoch=useRef(0);
  const [items,setItems]=useState<ReceivedInvitation[]>([]),[busy,setBusy]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  const groups=useGroupStore(state=>state.groups);
  const membershipKey=groups.filter(g=>[...g.playerIds,...g.adminIds].includes(me?.id??'')).map(g=>g.id).sort().join('|');
  const visibleItems=items.filter(item=>item.type!=='groupInvitation'||!groups.some(g=>g.id===item.targetId&&[...g.playerIds,...g.adminIds].includes(me?.id??'')));
  const accepting = useRef(false);
  const [acceptingId, setAcceptingId] = useState<string>();
  useFocusEffect(useCallback(()=>{
    const turn=++epoch.current;setItems([]);setFailed(false);
    if(!me||me.isGuest){setBusy(false);return;}
    setBusy(true);
    receivedInvitationsService.list(me.id).then(rows=>{if(epoch.current===turn)setItems(rows);})
      .catch(()=>{if(epoch.current===turn)setFailed(true);})
      .finally(()=>{if(epoch.current===turn)setBusy(false);});
    return()=>{epoch.current++;};
  },[me?.id,me?.isGuest,retry,refreshKey,membershipKey]));
  const open=(item:ReceivedInvitation)=>{
    if(useUserStore.getState().currentUser?.id!==me?.id)return;
    if(!navigateForPush(item.type,item.payload)){toast.error('לא ניתן לפתוח את ההזמנה כרגע');return;}
    setItems(old=>old.map(x=>x.id===item.id?{...x,read:true}:x));
    void notificationsService.markRead(item.id);
  };
  const accept = async (item: ReceivedInvitation) => {
    if (!me || accepting.current) return;
    accepting.current = true; setAcceptingId(item.id);
    const turn = epoch.current;
    try {
      const result = await acceptReceivedInvitation(item, me.id);
      if (epoch.current !== turn || useUserStore.getState().currentUser?.id !== me.id) return;
      if (result.isMember) setItems(old => old.filter(x => !(x.type === item.type && x.targetId === item.targetId)));
      else setItems(old => old.map(x => x.id === item.id ? { ...x, status: 'pending', read: true } : x));
      void notificationsService.markRead(item.id).catch(() => {});
      if (!navigateInvite(result)) toast.info('ההצטרפות נשמרה. אפשר לפתוח את הפרטים מהכרטיס או מהרשימה');
      else if (result.status === 'waitlist') toast.success('נכנסת לרשימת ההמתנה למחזור');
      else if (result.status === 'pending') toast.info('בקשת ההצטרפות ממתינה לאישור');
      else toast.success(result.type === 'team' ? 'הצטרפת למועדון!' : 'נרשמת למחזור!');
    } catch (error) {
      if (epoch.current !== turn || useUserStore.getState().currentUser?.id !== me.id) return;
      const message = error instanceof Error ? error.message : '';
      toast.error(message.includes('GROUP_FULL') ? 'המועדון מלא כרגע' : message.includes('CONFLICT') ? 'כבר נרשמת למחזור אחר בזמן הזה' : message.includes('REJECTED') || message.includes('FORBIDDEN') ? 'לא ניתן להצטרף למחזור הזה' : message.includes('NOT_OPEN') || message.includes('INVITATION_UNAVAILABLE') ? 'ההזמנה אינה זמינה להצטרפות כרגע' : 'ההצטרפות לא הושלמה. אפשר לנסות שוב');
      setRetry(n => n + 1);
    } finally {
      accepting.current = false; setAcceptingId(undefined);
    }
  };
  const unreadCount = visibleItems.filter(item => !item.read).length;
  return <View style={{gap:10,marginBottom:24}}>
    <View style={s.row}><Text style={[s.title,{textAlign:RTL_LABEL_ALIGN}]}>הזמנות שקיבלת</Text>{unreadCount ? <View style={{backgroundColor:'#E5EEFF',borderRadius:14,paddingHorizontal:10,paddingVertical:5}}><Text style={{color:'#2860F5',fontSize:12,fontWeight:'700'}}>{unreadCount === 1 ? '1 חדשה' : `${unreadCount} חדשות`}</Text></View> : null}</View>
    {busy?<ActivityIndicator color="#2563EB"/>:failed?<View style={s.card}><Text style={s.body}>לא ניתן לטעון את ההזמנות כרגע</Text><SocialAction title="נסה שוב" secondary icon="refresh-outline" onPress={()=>setRetry(n=>n+1)}/></View>:!visibleItems.length?<View style={[s.card,s.row]}><Ionicons name="mail-open-outline" size={26} color="#7F90AF"/><View style={{flex:1,gap:4}}><Text style={s.title}>אין הזמנות כרגע</Text><Text style={s.body}>הזמנות למועדונים ולמחזורים יופיעו כאן גם אם פספסת את ההתראה</Text></View></View>:visibleItems.map(item=><InvitationCard key={item.id} item={item} busy={acceptingId===item.id} disabled={!!acceptingId} onAccept={()=>void accept(item)} onOpen={()=>open(item)}/>)}
  </View>;
}
