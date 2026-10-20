import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';

export function PlayerDisclosure({title,children}:{title:string;children:React.ReactNode}) {
 const [open,setOpen]=useState(false);
 const [visited,setVisited]=useState(false);
 const icon=title.includes('מכשיר')?'phone-portrait-outline':title.includes('זמינות')?'settings-outline':title.includes('התראות') || title.includes('פרטיות')?'notifications-outline':title.includes('חבר') || title.includes('הזמנ')?'people-outline':title.includes('משחק') || title.includes('מחזור')?'football-outline':title.includes('חשבון')?'person-outline':'document-text-outline';
 return <View><Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded:open}} onPress={()=>{setVisited(true);setOpen(v=>!v)}} style={{flexDirection:'row',direction:'rtl',alignItems:'center',gap:12,minHeight:54,borderBottomWidth:1,borderBottomColor:colors.border}}><Ionicons name={icon} size={21} color={colors.textSoft}/><Text style={{ ...font.body,flex:1,textAlign: RTL_LABEL_ALIGN}}>{title}</Text><Ionicons name={open?'chevron-down':'chevron-back'} size={18} color={colors.textSoft}/></Pressable>{visited?<View style={{display:open?'flex':'none',paddingVertical:12,gap:12}}>{children}</View>:null}</View>;
}
