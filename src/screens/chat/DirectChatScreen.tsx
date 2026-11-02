import { observeCaughtError } from '../../utils/errorObservation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRoute, useIsFocused, type RouteProp } from '@react-navigation/native';
import { ChatView } from '@/components/chat/ChatView';
import { DmRequestBanner } from '@/components/chat/DmRequestBanner';
import { chatService } from '@/services/chatService';
import { dmRequestService, dmErrorMessage, type DmAccess } from '@/services/dmRequestService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { isOfficialSender } from '@/utils/officialAccount';
import { Button } from '@/components/Button';
import { toast } from '@/components/Toast';
import { colors } from '@/theme';
import { he } from '@/i18n/he';
import type { ChatStackParamList } from '@/navigation/ChatStack';

export function DirectChatScreen() {
  const focused = useIsFocused();
  const route = useRoute<RouteProp<ChatStackParamList, 'DirectChat'>>();
  const { convId } = route.params;
  const me = useUserStore(s => s.currentUser);
  const otherId = me ? convId.split('__').find(u => u !== me.id) ?? '' : '';
  const official = isOfficialSender(otherId);
  const [access, setAccess] = useState<(DmAccess & { ownerId: string }) | null>(null);
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const seenRequest = useRef('');
  const refresh = useCallback(async () => {
    if (!me || !otherId || official) return;
    const ownGeneration = ++generation.current, owner = me.id;
    try {
      const next = await dmRequestService.action(owner, otherId, 'status');
      if (ownGeneration === generation.current && useUserStore.getState().currentUser?.id === owner) {
        setAccess({ ...next, ownerId: owner }); setFailed(false);
        const seenKey=`${owner}:${next.convId}`;
        if ((next.status==='incoming'||next.status==='declined') && seenRequest.current!==seenKey) {
          seenRequest.current=seenKey;
          void dmRequestService.action(owner,otherId,'seen').catch(error=>{
            observeCaughtError(error,{source:'src/screens/chat/DirectChatScreen.tsx',handler:'markRequestSeen',site:'DirectChatScreen:requestSeen'});
            if(seenRequest.current===seenKey)seenRequest.current='';
          });
        }
      }
    } catch (caughtError692dbede61) {
    observeCaughtError(caughtError692dbede61, {"source":"src/screens/chat/DirectChatScreen.tsx","handler":"DirectChatScreen","site":"DirectChatScreen:692dbede61"});
      if (ownGeneration === generation.current && useUserStore.getState().currentUser?.id === owner) {
        setFailed(true);
        logEvent(AnalyticsEvent.ChatLoadFailed, { scope: 'dm', reason: 'fetch_failed' });
      }
    }
  }, [me?.id, otherId, official]);
  useEffect(() => {
    setAccess(null); setFailed(false);
    if (!focused) return;
    if (official && me) { chatService.ensureDmConversation(me.id, otherId).catch((caughtErrord68ef19728: unknown) => { observeCaughtError(caughtErrord68ef19728, {"source":"src/screens/chat/DirectChatScreen.tsx","handler":"DirectChatScreen","site":"DirectChatScreen:d68ef19728"}); return setFailed(true); }); return; }
    void refresh();
    const stop = me ? dmRequestService.subscribe(me.id, () => { void refresh(); }, () => { setFailed(true); }) : () => {};
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { ++generation.current; clearInterval(timer); stop(); };
  }, [refresh, focused, retry]);
  const action = async (kind: 'accept'|'decline'|'cancel') => {
    if (!me || busy) return;
    setBusy(true);
    try { await dmRequestService.action(me.id, otherId, kind); await refresh(); }
    catch (e) {
    observeCaughtError(e, {"source":"src/screens/chat/DirectChatScreen.tsx","handler":"action","site":"DirectChatScreen:249b21c01d"}); toast.error(dmErrorMessage(e)); }
    finally { setBusy(false); }
  };
  if (!me || !otherId || failed && !access) return <View style={{flex:1,backgroundColor:colors.bg}}><ScreenHeader title={he.dmTitle}/><View style={{padding:24}}><Button title="לא הצלחנו לטעון את השיחה. נסו שוב" onPress={() => { logEvent(AnalyticsEvent.ChatLoadRetryTapped,{scope:'dm'});setRetry(n=>n+1); }}/></View></View>;
  if (official) return <ChatView scope="dm" parentId={convId} title={he.officialAccountName} canModerate={false} official />;
  if (!access || access.ownerId!==me.id || access.convId!==convId) return <View style={{flex:1,backgroundColor:colors.bg}}><ScreenHeader title={he.dmTitle}/><ActivityIndicator color={colors.primary}/></View>;
  const writable = !failed && ['open','compose','incoming','declined'].includes(access.status);
  return <ChatView key={`${me.id}:${convId}`} scope="dm" parentId={convId} title={access.other.name} canModerate={false}
    memberIds={[me.id,otherId]} readOnly={!writable} suppressSignals={failed || access.status !== 'open'}
    disableMessageDeletion={access.status !== 'open'}
    readOnlyMessage={access.status==='waiting'?'הבקשה נשלחה. אפשר להמשיך להתכתב לאחר אישור':access.status==='cancelled'?'הבקשה בוטלה. אי אפשר לשלוח אותה שוב.':'אי אפשר לשלוח הודעה כרגע. ההיסטוריה נשמרת לקריאה.'}
    statusBanner={failed?<Button title="החיבור לשיחה נכשל. נסו שוב" onPress={()=>void refresh()}/>:<DmRequestBanner status={access.status} busy={busy} onAction={kind=>void action(kind)} />}
    sendOverride={async (text, operationId) => {
      await dmRequestService.action(me.id, otherId, 'send', text, operationId);
      await refresh();
    }}/>;
}
