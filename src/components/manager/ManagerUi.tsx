import React from 'react';
import {Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {UserAvatar} from '@/components/UserAvatar';
import {RTL_LABEL_ALIGN} from '@/theme';
import type {User} from '@/types';
export const managerColors = {blue: '#2467F5', ink: '#101B47', green: '#13834A', amber: '#A66709'};
export function ManagerLabel({children, style}: {children: React.ReactNode; style?: StyleProp<TextStyle>}) {
  return <Text style={[u.text, style]}>{children}</Text>;
}
export function ManagerBox({title, icon, children}: {title?: string; icon?: keyof typeof Ionicons.glyphMap; children: React.ReactNode}) {
  return <View style={u.box}>{title && <View style={u.row}><ManagerLabel style={u.heading}>{title}</ManagerLabel>{icon && <Ionicons name={icon} color={managerColors.blue} size={21}/>}</View>}{children}</View>;
}
export function ManagerLink({title, onPress}: {title: string; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={u.link}><ManagerLabel style={u.linkText}>{title}</ManagerLabel><Ionicons name="chevron-back" size={17} color={managerColors.blue}/></Pressable>;
}
export function ManagerMetrics({items}: {items: {value: string | number; label: string}[]}) {
  return <View style={u.metrics}>{items.map(item => <View key={item.label} style={u.metric}><ManagerLabel style={u.number}>{item.value}</ManagerLabel><ManagerLabel style={u.caption}>{item.label}</ManagerLabel></View>)}</View>;
}
export function ManagerProgress({value}: {value: number}) {
  return <View style={u.track}><View style={[u.fill, {width: `${Math.max(0, Math.min(100, value))}%`}]}/></View>;
}
export function ManagerDetail({label, value, warning = false}: {label: string; value: string; warning?: boolean}) {
  return <View style={u.detail}><ManagerLabel style={[u.sub, {flex: 1}]}>{label}</ManagerLabel><ManagerLabel style={[u.value, warning && {color: managerColors.amber}]}>{value}</ManagerLabel></View>;
}
export function ManagerPerson({user, subtitle, badge, warning, onPress}: {user: User; subtitle: string; badge?: string; warning?: boolean; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`מידע ניהולי על ${user.name}`} onPress={onPress} style={u.person}><UserAvatar user={user} size={40}/><View style={{flex: 1, gap: 4}}><ManagerLabel style={u.name}>{user.name}</ManagerLabel><ManagerLabel style={u.sub}>{subtitle}</ManagerLabel></View>{badge ? <View style={[u.badge, warning && {backgroundColor: '#FFF3DF'}]}><ManagerLabel style={[u.badgeText, warning && {color: managerColors.amber}]}>{badge}</ManagerLabel></View> : <Ionicons name="chevron-back" color={managerColors.blue} size={17}/>}</Pressable>;
}
export const u = StyleSheet.create({
  text: {color: managerColors.ink, fontSize: 14, textAlign: RTL_LABEL_ALIGN},
  box: {backgroundColor: '#FFF', borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: '#E9EEF5', shadowColor: '#17395D', shadowOpacity: .06, shadowRadius: 6, shadowOffset: {width: 0, height: 3}, elevation: 1},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8}, heading: {flex: 1, fontSize: 17, fontWeight: '800'},
  sub: {fontSize: 13, color: '#6C7893', lineHeight: 20}, name: {fontSize: 14, fontWeight: '700'},
  link: {flexDirection: 'row', gap: 5, alignItems: 'center', minHeight: 48}, linkText: {flex: 1, fontSize: 13, fontWeight: '700', color: managerColors.blue},
  metrics: {flexDirection: 'row', gap: 6, flexWrap: 'wrap'}, metric: {flex: 1, minWidth: 75, backgroundColor: '#F4F8FE', borderRadius: 11, paddingVertical: 11, paddingHorizontal: 4, alignItems: 'center', gap: 4},
  number: {fontSize: 24, fontWeight: '800', color: managerColors.blue}, caption: {fontSize: 12, textAlign: 'center'},
  detail: {flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderColor: '#EEF2F7'}, value: {fontSize: 13, fontWeight: '700', flexShrink: 1},
  person: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#EEF2F7'},
  badge: {backgroundColor: '#EDF3FF', padding: 7, borderRadius: 8, maxWidth: '34%'}, badgeText: {fontSize: 12, fontWeight: '700', color: managerColors.blue},
  track: {height: 8, backgroundColor: '#DFE7F3', borderRadius: 8, overflow: 'hidden', alignItems: 'flex-start'}, fill: {height: 8, backgroundColor: managerColors.blue, borderRadius: 8},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 6}, chip: {paddingHorizontal: 10, paddingVertical: 10, minHeight: 44, borderRadius: 9, backgroundColor: '#E6ECF5', justifyContent: 'center'},
});
