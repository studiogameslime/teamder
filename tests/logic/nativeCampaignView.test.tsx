import React from 'react';
jest.mock('react-native', () => ({ Animated: { View: 'AnimatedView' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (x: unknown) => x, absoluteFill: { position: 'absolute' } } }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/theme', () => ({ colors: { surface: '#FFFFFF', text: '#111111', primary: '#2563EB' }, radius: { lg: 16, md: 12 }, spacing: { xs: 4, sm: 8, lg: 24 }, typography: { body: { fontSize: 15 }, label: { fontSize: 14 } } }));
jest.mock('@/theme/colors', () => ({ colors: { surface: '#FFFFFF', border: '#E2EAF6' }, isDarkTheme: false }));
import { NativeCampaignView, type NativeMsg } from '@/components/joryio/NativeCampaignView';
const message: NativeMsg = { id: 'local', name: 'local', kind: 'native', type: 'modal', priority: 0, title: 'כותרת', body: 'תוכן', buttons: [{ id: 'one', text: 'אישור', action: 'dismiss' }], closeButton: true, backdropDismissible: false };
function nodes(node: any): any[] { if (!React.isValidElement<any>(node)) return []; return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)]; }
const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flat)) : style ?? {};
test('only callbacks handle close and button actions, and disabled backdrop does not dismiss', () => {
  const onClose = jest.fn(), onButton = jest.fn();
  const tree = nodes(NativeCampaignView({ msg: message, onClose, onButton }));
  expect(onClose).not.toHaveBeenCalled(); expect(onButton).not.toHaveBeenCalled();
  const presses = tree.filter(x => x.type === 'Pressable');
  presses[0].props.onPress(); expect(onClose).not.toHaveBeenCalled();
  presses[1].props.onPress(); expect(onClose).toHaveBeenCalledTimes(1);
  presses[2].props.onPress(); expect(onButton).toHaveBeenCalledWith(message.buttons[0]);
  tree[0].props.onRequestClose(); expect(onClose).toHaveBeenCalledTimes(2);
});
test('explicit campaign colors, typography and zero corner override shared fallback', () => {
  const msg = { ...message, style: { backgroundColor: '#012345', textColor: '#ABCDEF', primaryButtonColor: '#123456', primaryButtonTextColor: '#FEDCBA', cornerRadius: 0, fontSize: 20, titleWeight: 'medium' as const, fontFamily: 'Example', textAlign: 'center' as const } };
  const tree=nodes(NativeCampaignView({msg,onClose:jest.fn(),onButton:jest.fn()}));
  const card=tree.find(x=>x.type==='View'&&flat(x.props.style).width==='100%');
  expect(flat(card.props.style)).toMatchObject({backgroundColor:'#012345',borderRadius:0});
  const title=tree.find(x=>x.type==='Text'&&x.props.children==='כותרת');
  expect(flat(title.props.style)).toMatchObject({color:'#ABCDEF',fontSize:27,fontWeight:'500',fontFamily:'Example',textAlign:'center',writingDirection:'auto'});
  const button=tree.find(x=>x.type==='Pressable'&&flat(x.props.style).backgroundColor==='#123456');
  expect(flat(button.props.children.props.style).color).toBe('#FEDCBA');
});
test('default dialog shares surface, fullscreen retains its geometry and close remains optional', () => {
  const render=(msg:NativeMsg)=>nodes(NativeCampaignView({msg,onClose:jest.fn(),onButton:jest.fn()}));
  const card=(tree:any[])=>flat(tree.find(x=>x.type==='View'&&flat(x.props.style).width==='100%').props.style);
  expect(card(render(message))).toMatchObject({borderRadius:24,borderWidth:1,paddingTop:40});
  expect(card(render({...message,type:'fullscreen',closeButton:false}))).toMatchObject({borderRadius:16,flex:1});
  expect(render({...message,closeButton:false}).filter(x=>x.type==='Pressable')).toHaveLength(2);
});

test('long body scrolls separately while action buttons and close remain outside scroll content', () => {
  const tree = nodes(NativeCampaignView({msg:{...message,body:'תוכן ארוך\n'.repeat(100)},onClose:jest.fn(),onButton:jest.fn()}));
  const scroll=tree.find(x=>x.type==='ScrollView');
  expect(scroll).toBeDefined();
  expect(nodes(scroll).some(x=>x.type==='Pressable')).toBe(false);
  expect(tree.filter(x=>x.type==='Pressable')).toHaveLength(3);
  const card=tree.find(x=>x.type==='View'&&flat(x.props.style).width==='100%');
  expect(flat(card.props.style).maxHeight).toBe('100%');
});
