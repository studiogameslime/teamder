import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';

export function SocialAction({ title, icon, onPress, secondary = false, disabled = false, compact = false, loading = false }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; secondary?: boolean; disabled?: boolean; compact?: boolean; loading?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled||loading} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled:disabled||loading, busy:loading }} style={({pressed}) => [socialStyles.action, secondary && socialStyles.secondary, compact && socialStyles.compact, (disabled || pressed) && { opacity: 0.6 }]}>
    <Text style={[socialStyles.actionText, secondary && {color:'#2563EB'}, compact && {fontSize:13}]}>{title}</Text>
    {loading?<ActivityIndicator size="small" color={secondary?'#2563EB':'white'}/>:<Ionicons name={icon} size={compact?16:20} color={secondary?'#2563EB':'white'} />}
  </Pressable>;
}
export function SocialTitle({ title, icon }: { title: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={socialStyles.titleRow}><Text style={socialStyles.title}>{title}</Text><Ionicons name={icon} size={20} color="#2563EB" /></View>;
}
export const socialStyles = StyleSheet.create({
  root: {flex:1,backgroundColor:'#F4F7FB'}, content:{padding:16,gap:12,paddingBottom:24},
  card:{backgroundColor:'white',borderRadius:14,padding:12,borderWidth:1,borderColor:'#E8EEF7',shadowColor:'#19345B',shadowOpacity:0.04,shadowRadius:8,shadowOffset:{width:0,height:3},elevation:1},
  titleRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:8},title:{fontSize:16,fontWeight:'800',color:'#0C1744',textAlign:RTL_LABEL_ALIGN,flex:1},
  body:{fontSize:13,color:'#667796',textAlign:RTL_LABEL_ALIGN,lineHeight:19},action:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:12,paddingVertical:10,borderRadius:11,backgroundColor:'#2563EB',borderWidth:1,borderColor:'#2563EB'},
  secondary:{backgroundColor:'white',borderColor:'#A9C6FF'},compact:{minHeight:36,paddingVertical:6,paddingHorizontal:10},actionText:{fontSize:15,fontWeight:'700',color:'white',textAlign:'center'},
  chip:{borderRadius:10,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:'#DCE5F2',backgroundColor:'#F8FBFF'},chipText:{fontSize:13,fontWeight:'700',color:'#0C1744'},empty:{paddingVertical:32,alignItems:'center',gap:12},row:{flexDirection:'row',alignItems:'center',gap:10},
});
