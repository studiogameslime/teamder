import React from 'react';
let slots:any[]=[],index=0;
jest.mock('react',()=>({...jest.requireActual('react'),useState:(initial:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];}}));
jest.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',ScrollView:'ScrollView',ActivityIndicator:'Spinner',StyleSheet:{create:(x:any)=>x,absoluteFill:{}},useWindowDimensions:()=>({width:320,height:569,fontScale:1.4})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left',colors:{primary:'blue',text:'black',surfaceMuted:'white',border:'gray'}}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{sheet:{},dialog:{}},overlayTheme:{backdrop:'#0008'}}));
jest.mock('@/components/match/rotationView',()=>({teamColor:()=> 'red',teamName:(i:number)=>['האדומים','הכחולים','הירוקים','הצהובים'][i]}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
import { LiveTeamsEditModal } from '@/components/match/LiveTeamsEditModal';
function nodes(node:any):any[]{if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);return [node,...nodes(node.props?.children)];}
function copy(node:any):string{if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(copy).join(' ');if(typeof node==='string'||typeof node==='number')return String(node);return copy(node.props?.children);}
function labeled(tree:any,label:string){return nodes(tree).find(n=>n.props?.accessibilityLabel===label);}
const original={playing:[0,1] as [number,number],waiting:[2,3]};
function harness(extra:any={}){
  slots=[];
  const props={original,draft:{teams:[0,1,2,3].map(index=>({index,playerIds:['p'+index]}))} as any,roundNumber:2,busy:false,stale:false,onSave:jest.fn(),onClose:jest.fn(),...extra};
  const render=()=>{index=0;return LiveTeamsEditModal(props);};
  const save=(tree:any)=>nodes(tree).find(n=>n.props?.testID==='live-teams-save');
  return {props,render,save};
}
test('opening and cancelling do not save; unchanged plan cannot be confirmed',()=>{
  const h=harness(),tree=h.render();expect(h.save(tree).props.disabled).toBe(true);
  labeled(tree,'ביטול העריכה').props.onPress();expect(h.props.onClose).toHaveBeenCalledTimes(1);expect(h.props.onSave).not.toHaveBeenCalled();
});
test('queue-only change saves once without showing a reset confirmation',()=>{
  const h=harness();labeled(h.render(),'הצהובים, הקדמה בתור').props.onPress();
  const tree=h.render();expect(copy(tree)).not.toContain('לאפס את משחק');expect(copy(h.save(tree))).toBe('שמירת הסדר');
  h.save(tree).props.onPress();expect(h.props.onSave).toHaveBeenCalledWith({playing:[0,1],waiting:[3,2]});
});
test('a team replacement requires explicit reset confirmation and returning preserves the draft',()=>{
  const h=harness();labeled(h.render(),'החלפת הכחולים').props.onPress();
  let tree=h.render();expect(labeled(tree,'האדומים').props.disabled).toBe(true);
  labeled(tree,'הירוקים').props.onPress();tree=h.render();expect(copy(tree)).toContain('תאפס');
  h.save(tree).props.onPress();tree=h.render();expect(copy(tree)).toContain('לאפס את משחק 2?');expect(h.props.onSave).not.toHaveBeenCalled();
  nodes(tree).find(n=>n.type==='Pressable'&&copy(n)==='חזרה לעריכה').props.onPress();
  expect(copy(h.render())).toContain('הירוקים');expect(h.props.onSave).not.toHaveBeenCalled();
  h.save(h.render()).props.onPress();h.save(h.render()).props.onPress();
  expect(h.props.onSave).toHaveBeenCalledTimes(1);expect(h.props.onSave).toHaveBeenCalledWith({playing:[0,2],waiting:[3,1]});
});
test.each(['busy','stale'])('%s disables confirmation and reordering without discarding the draft',flag=>{
  const h=harness();labeled(h.render(),'הצהובים, הקדמה בתור').props.onPress();h.props[flag]=true;
  const tree=h.render();expect(h.save(tree).props.disabled).toBe(true);expect(labeled(tree,'הירוקים, הקדמה בתור').props.disabled).toBe(true);
  if(flag==='stale')expect(copy(tree)).toContain('המשחק השתנה');
});
test('a retryable save error remains visible and retains chosen order',()=>{
  const h=harness();labeled(h.render(),'הצהובים, הקדמה בתור').props.onPress();h.props.error='אין חיבור';
  const tree=h.render();expect(copy(tree)).toContain('אין חיבור');expect(h.save(tree).props.disabled).toBe(false);
  h.save(tree).props.onPress();expect(h.props.onSave).toHaveBeenCalledWith({playing:[0,1],waiting:[3,2]});
});
test('two teams show an empty queue and cannot replace one another',()=>{
  const h=harness({original:{playing:[0,1],waiting:[]}}),tree=h.render();
  expect(copy(tree)).toContain('אין קבוצות ממתינות');expect(labeled(tree,'החלפת האדומים').props.disabled).toBe(true);
});
