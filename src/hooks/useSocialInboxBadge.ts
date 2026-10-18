import {useCallback,useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useUserStore} from '@/store/userStore';
import {friendsService} from '@/services/friendsService';
import {receivedInvitationsService} from '@/services/receivedInvitationsService';

/** Pending friend requests plus unread, still-actionable invitations. No private identities. */
export function useSocialInboxBadge() {
  const me=useUserStore(s=>s.currentUser);
  const [result,setResult]=useState<{owner:string;count:number}|null>(null);
  useFocusEffect(useCallback(()=>{
    let alive=true,inFlight=false;
    const owner=me?.id;
    if(!owner||me?.isGuest){setResult(null);return;}
    const refresh=async()=>{
      if(inFlight||AppState.currentState==='background')return;
      inFlight=true;
      try{
        const [requests,invites]=await Promise.all([friendsService.queryRequests('toUserId',owner),receivedInvitationsService.listInbox(owner)]);
        if(alive&&useUserStore.getState().currentUser?.id===owner)setResult({owner,count:requests.length+invites.filter(i=>!i.read&&!['joined','expired','unavailable'].includes(i.status??'available')).length});
      }catch{/* Retain the previous count on transport failure; do not invent zero. */}
      finally{inFlight=false;}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),30000);
    const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return()=>{alive=false;clearInterval(timer);sub.remove();};
  },[me?.id,me?.isGuest]));
  return result?.owner===me?.id?result?.count??0:0;
}
