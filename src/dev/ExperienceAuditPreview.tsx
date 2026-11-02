// Isolated native QA: three gates, local fixtures, no business-service writes.
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { Button } from '@/components/Button';
import { ToastHost, toast } from '@/components/Toast';
import { ContentReveal } from '@/components/anim/ContentReveal';
import { UpdateHighlight } from '@/components/anim/UpdateHighlight';
import { ListUpdateNotice } from '@/components/ListUpdateNotice';
import { PlayersSkeleton, ClubStatsSkeleton, HomeRoundSkeleton, PersonalStatsSkeleton } from '@/components/loading/ScreenSkeletons';
import { MatchDetailsSkeleton, ClubDetailsSkeleton, PersonalStatisticsSkeleton, ConversationListSkeleton } from '@/components/loading/PageSkeletons';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { ChatView } from '@/components/chat/ChatView';
import type { ChatMessage } from '@/types';
import { useRememberedScroll } from '@/hooks/useListMemory';
import { useListUpdates } from '@/hooks/useListUpdates';
import { useConfirmedFeedback } from '@/hooks/useConfirmedFeedback';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { activateListOwner, readListOffset, writeListOffset } from '@/utils/listMemory';
import { useUserStore } from '@/store/userStore';
import { RTL_LABEL_ALIGN } from '@/theme';

const enabled = () => __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1';
const fixtures = () => Array.from({length:40},(_,i)=>({id:`audit-${i}`,name:`שחקן לדוגמה ${i+1}`}));
const AuditRowSeparator = () => <View style={{height:8}} />;
const skeletons: Record<string, React.ReactNode> = {
  players:<PlayersSkeleton/>, stats:<ClubStatsSkeleton/>, home:<HomeRoundSkeleton/>, card:<PersonalStatsSkeleton/>,
  match:<MatchDetailsSkeleton/>, club:<ClubDetailsSkeleton/>, personal:<PersonalStatisticsSkeleton/>,
  inbox:<ConversationListSkeleton/>, friends:<ConversationListSkeleton kind="friends"/>, rounds:<MatchCardSkeleton/>,
};

export function ExperienceAuditPreview({kind,onClose}:{kind:string;onClose:()=>void}) {
  const me=useUserStore(s=>s.currentUser), owner=me?.id;
  const isFlat=kind.startsWith('flat');
  const seeded=useRef(false), scope=`qa-experience:${kind}`;
  if(!seeded.current&&owner&&enabled()) { activateListOwner(owner);writeListOffset(owner,scope,kind==='memory'?650:isFlat?1900:0);seeded.current=true; }
  const [ready,setReady]=useState(kind==='updates'||kind==='feedback'||kind==='undo'||kind==='chat');
  const [rows,setRows]=useState(()=>kind==='flat_short'?fixtures().slice(0,10):kind==='flat_empty'?[]:fixtures()), [observedY,setObservedY]=useState(0), [measured,setMeasured]=useState(0);
  const [busy,setBusy]=useState(false), [requests,setRequests]=useState(0), [fail,setFail]=useState(false),[archived,setArchived]=useState(false);
  const [chat,setChat]=useState('a');
  const [messages,setMessages]=useState<ChatMessage[]>(()=>fixtures().map((r,i)=>({id:r.id,senderId:'p2',senderName:'שחקן לדוגמה',text:`הודעה לדוגמה ${i+1}`,createdAt:Date.now()-60000+i*1000})));
  const lock=useRef(false), timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const memory=useRememberedScroll(owner,scope,ready,isFlat?rows.length:undefined);
  const updates=useListUpdates(scope,rows,{ready,hold:!memory.nearStart,key:r=>r.id,revision:r=>r.name});
  const feedback=useConfirmedFeedback(scope,owner),reduced=useReducedMotion();
  const schedule=(fn:()=>void,ms:number)=>{const id=setTimeout(fn,ms);timers.current.push(id);};
  useEffect(()=>{if(!ready)schedule(()=>setReady(true),kind==='memory'||isFlat?1800:6500);return()=>{timers.current.forEach(clearTimeout);};},[]);
  const action=(label:string,onPress:()=>void)=><Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={s.control}><Text style={s.controlText}>{label}</Text></Pressable>;
  const register=()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setRequests(n=>n+1);
    schedule(()=>{lock.current=false;setBusy(false);if(fail)toast.error('הבקשה נכשלה בהדגמה');else feedback.confirm('registration','ההצטרפות אושרה בהדגמה');},1100);
  };
  if(!enabled())return null;
  return <Modal visible onRequestClose={onClose}><View style={s.root}>
    <View style={s.header}><Text style={s.heading}>בדיקת חוויית שימוש</Text>{action('סגור',onClose)}</View>
    <Text style={s.note}>נתוני הדגמה מקומיים בלבד</Text>
    {kind in skeletons||kind==='slow'?<Text style={s.note}>{`תנועה מופחתת: ${reduced?'כן':'לא'}`}</Text>:null}
    {kind==='chat'?<>
      <View style={s.toolbar}>{action('הוסף הודעה',()=>setMessages(previous=>[...previous,{id:`message-${Date.now()}`,senderId:'p2',senderName:'שחקן לדוגמה',text:'הודעה חדשה בהדגמה',createdAt:Date.now()}]))}
      {action('החלף שיחה',()=>{setChat(value=>value==='a'?'b':'a');setMessages([{id:`other-${Date.now()}`,senderId:'p2',senderName:'שחקן אחר',text:'תוכן השיחה האחרת',createdAt:Date.now()}]);})}</View>
      <ChatView scope="dm" parentId={`qa-local-${chat}`} title="שיחת הדגמה" canModerate={false} previewMessages={messages} suppressSignals readOnly disableMessageDeletion/>
    </>:kind==='feedback'?<View style={s.panel}>
      <Text style={s.label}>בקשות שנשלחו: {requests}</Text>
      <Button title="הרשמה בהדגמה" loading={busy} confirmation={feedback.labelFor('registration')} onPress={register}/>
      {action(fail?'החלף להצלחה':'החלף לכשל',()=>setFail(v=>!v))}
    </View>:kind==='undo'?<View style={s.panel}>
      <Text style={s.label}>{archived?'השיחה בהדגמה בארכיון':'השיחה בהדגמה ברשימה'}</Text>
      {action('ארכוב בהדגמה',()=>{setArchived(true);toast.action('השיחה הועברה לארכיון',{label:'בטל',ownerId:owner,onPress:async()=>{await new Promise<void>(resolve=>schedule(resolve,600));if(fail)throw Error('QA_UNDO_FAILURE');setArchived(false);toast.success('השיחה הוחזרה לשיחות');}});})}
      {action(fail?'החלף להצלחה':'החלף לכשל',()=>setFail(v=>!v))}
    </View>:<>
      <View style={s.toolbar}>
        {action('טעינה מחדש',()=>{setReady(false);schedule(()=>setReady(true),1800);})}
        {action('הוסף שחקן',()=>setRows(previous=>[{id:`added-${Date.now()}`,name:'שחקן חדש'},...previous]))}
      </View>
      <Text style={s.label} testID="audit-scroll-state">{`מיקום נוכחי: ${Math.round(observedY)}, זכור: ${Math.round(readListOffset(owner??null,scope))}, גובה: ${Math.round(measured)}`}</Text>
      <ContentReveal ready={ready} scopeKey={scope} style={{flex:1}}>
        {isFlat?<FlatList data={ready?updates.items:[]} ref={memory.ref} onLayout={memory.onLayout} onScrollBeginDrag={memory.onScrollBeginDrag} onViewableItemsChanged={memory.onViewableItemsChanged}
          onContentSizeChange={(w,h)=>{memory.onContentSizeChange(w,h);setMeasured(h);}}
          onScroll={event=>{memory.onScroll(event);setObservedY(event.nativeEvent.contentOffset.y);}} scrollEventThrottle={64} contentContainerStyle={[s.content,{gap:0}]} ItemSeparatorComponent={AuditRowSeparator}
          keyExtractor={row=>row.id} initialNumToRender={4} maxToRenderPerBatch={4} windowSize={3} ListEmptyComponent={ready?<Text style={s.label}>הרשימה ריקה בהדגמה</Text>:<PlayersSkeleton/>}
          renderItem={({item:row})=><UpdateHighlight at={updates.highlights[row.id]}><View style={s.row}><Text style={s.label}>{row.name}</Text></View></UpdateHighlight>}/>:<ScrollView ref={memory.ref} onLayout={memory.onLayout} onScrollBeginDrag={memory.onScrollBeginDrag}
          onContentSizeChange={(w,h)=>{memory.onContentSizeChange(w,h);setMeasured(h);}}
          onScroll={event=>{memory.onScroll(event);setObservedY(event.nativeEvent.contentOffset.y);}} scrollEventThrottle={64} contentContainerStyle={s.content}>
          {!ready?(skeletons[kind]??<PlayersSkeleton/>):updates.items.map(row=><UpdateHighlight key={row.id} at={updates.highlights[row.id]}><View style={s.row}><Text style={s.label}>{row.name}</Text></View></UpdateHighlight>)}
        </ScrollView>}
      </ContentReveal>
      {ready&&updates.pending?<View style={s.update}><ListUpdateNotice count={updates.pendingCount} noun="שחקנים" onPress={()=>{updates.apply();memory.toStart(!reduced);}}/></View>:null}
    </>}
    <ToastHost/>
  </View></Modal>;
}
const s=StyleSheet.create({root:{flex:1,paddingTop:36,backgroundColor:'#F4F7FB'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},heading:{fontSize:20,fontWeight:'800',color:'#15244F'},note:{fontSize:12,textAlign:'center',color:'#8B5B18',padding:8},toolbar:{flexDirection:'row',gap:10,paddingHorizontal:16},control:{padding:12,minHeight:44,borderRadius:12,backgroundColor:'#E1ECFF'},controlText:{fontSize:13,color:'#1842A0',fontWeight:'700'},label:{fontSize:14,color:'#15244F',textAlign:RTL_LABEL_ALIGN,padding:8},panel:{padding:22,gap:18},content:{padding:16,paddingBottom:90,gap:8},row:{minHeight:68,justifyContent:'center',borderBottomWidth:1,borderColor:'#DDE5F1'},update:{position:'absolute',bottom:16,alignSelf:'center',maxWidth:'92%'}});
