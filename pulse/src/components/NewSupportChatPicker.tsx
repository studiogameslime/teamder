import { observeCaughtError } from '../services/errorObservation';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from './RtlTextInput';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchUsers } from '../services/firebase';
import type { AppUser } from '../types';
import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';

export function NewSupportChatPicker({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (userId: string, userName: string) => void }) {
  const [users, setUsers] = useState<AppUser[]>([]), [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!visible) return;
    let alive = true; setSearch(''); setUsers([]); setLoading(true); setFailed(false);
    void fetchUsers({ force: true }).then(rows => { if (alive) setUsers(rows.filter(u => !u.deleted && !u.isTest && u.id !== 'teamder' && !u.id.includes('__') && !/[\/\s]/.test(u.id))); })
      .catch((caughtError2b3b625851: unknown) => {
    observeCaughtError(caughtError2b3b625851, {"source":"pulse/src/components/NewSupportChatPicker.tsx","handler":"NewSupportChatPicker","site":"NewSupportChatPicker:2b3b625851"}); if (alive) setFailed(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible, retry]);
  const matches = useMemo(() => users.filter(u => `${u.name} ${u.city ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [users, search]);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView style={s.wrap} behavior="padding"><View style={[s.sheet,{paddingBottom:insets.bottom+14}]}>
    <View style={s.row}><View style={{flex:1}}><Text style={font.h2}>שיחה חדשה</Text><Text style={font.small}>בחרו למי לכתוב בשם ⁦Teamder⁩</Text></View><Pressable accessibilityLabel="סגירת בחירת המשתמש" onPress={onClose} hitSlop={10}><Ionicons name="close" size={23} color={colors.text}/></Pressable></View>
    <TextInput value={search} onChangeText={setSearch} placeholder="חיפוש לפי שם או עיר" placeholderTextColor={colors.textMuted} style={s.input} accessibilityLabel="חיפוש משתמש לשיחה חדשה"/>
    {loading?<ActivityIndicator color={colors.primary}/>:failed?<Pressable onPress={()=>setRetry(n=>n+1)}><Text style={font.body}>טעינת המשתמשים נכשלה. לחצו לניסיון נוסף.</Text></Pressable>:<FlatList data={matches.slice(0,50)} keyExtractor={u=>u.id} keyboardShouldPersistTaps="handled" ListHeaderComponent={matches.length>50?<Text style={font.small}>מוצגים 50 מתוך {matches.length}. צמצמו את החיפוש.</Text>:null} ListEmptyComponent={<Text style={font.body}>לא נמצאו משתמשים</Text>} renderItem={({item})=><Pressable style={s.user} onPress={()=>{Keyboard.dismiss();onSelect(item.id,item.name);}}><Ionicons name="person-circle-outline" size={34} color={colors.primary}/><View style={{flex:1}}><Text style={font.body}>{item.name}</Text><Text style={font.small}>{item.city || 'עיר לא צוינה'}</Text></View><Ionicons name="chatbubble-outline" size={21} color={colors.primary}/></Pressable>}/>}<Text style={font.small}>בחירת משתמש פותחת שיחה קיימת או ריקה. הודעה נשלחת רק בלחיצה על שליחה.</Text>
  </View></KeyboardAvoidingView></Modal>;
}
const s=StyleSheet.create({wrap:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.5)'},sheet:{height:'88%',backgroundColor:colors.bg,borderTopLeftRadius:radius.lg,borderTopRightRadius:radius.lg,padding:18,gap:14},row:{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12},input:{ direction: 'rtl' as const,minHeight:50,borderRadius:radius.md,borderWidth:1,borderColor:colors.border,color:colors.text,textAlign: RTL_LABEL_ALIGN,padding:12,backgroundColor:colors.surface},user:{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12,paddingVertical:14,borderBottomWidth:1,borderBottomColor:colors.border}});
