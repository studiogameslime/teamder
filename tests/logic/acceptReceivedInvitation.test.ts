import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';

function fixture() {
  let user: any = {id:'me'};
  const requestJoinById = jest.fn(async () => 'joined');
  const requestJoinGame = jest.fn(async () => ({bucket:'players'}));
  const exports: any = {};
  const modules: Record<string, any> = {
    '@/store/userStore': {useUserStore:{getState:()=>({currentUser:user})}},
    '@/store/groupStore': {useGroupStore:{getState:()=>({requestJoinById})}},
    './gameService': {gameService:{requestJoinGame}}, './staleSession': {StaleSessionError},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/acceptReceivedInvitation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:(name:string)=>modules[name]});
  return {accept:exports.acceptReceivedInvitation, requestJoinById, requestJoinGame, setUser:(value:any)=>{user=value;}};
}
const invite=(type='inviteToGame',status='available')=>({id:'notice',type,targetId:'target',status});
test.each(['players','waitlist','pending'])('round acceptance uses canonical join result %s without predicting membership',async bucket=>{
  const f=fixture();f.requestJoinGame.mockResolvedValue({bucket});
  expect(await f.accept(invite(),'me')).toEqual({type:'session',id:'target',isMember:bucket!=='pending',status:bucket});
  expect(f.requestJoinGame).toHaveBeenCalledWith('target','me','notification');
  expect(f.requestJoinById).not.toHaveBeenCalled();
});
test.each(['joined','already_member','pending'])('club acceptance hydrates through the store and honours %s',async status=>{
  const f=fixture();f.requestJoinById.mockResolvedValue(status);
  expect(await f.accept(invite('groupInvitation'),'me')).toEqual({type:'team',id:'target',isMember:status!=='pending',status});
  expect(f.requestJoinById).toHaveBeenCalledWith('target','me');
});
test.each(['expired','full','scheduled','unavailable'])('unavailable invitation %s never starts a join',async status=>{
  const f=fixture();await expect(f.accept(invite('inviteToGame',status),'me')).rejects.toThrow('INVITATION_UNAVAILABLE');
  expect(f.requestJoinGame).not.toHaveBeenCalled();
});
test('account change during acceptance never returns a navigation for the new user',async()=>{
  const f=fixture();f.requestJoinGame.mockImplementation(async()=>{f.setUser({id:'other'});return {bucket:'players'};});
  await expect(f.accept(invite(),'me')).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.requestJoinGame).toHaveBeenCalledTimes(1);
  f.setUser({id:'me',isGuest:true});await expect(f.accept(invite(),'me')).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.requestJoinGame).toHaveBeenCalledTimes(1);
});
test('join rejection propagates without claiming a successful acceptance',async()=>{
  const f=fixture();f.requestJoinGame.mockRejectedValue(new Error('GAME_JOIN_REJECTED'));
  await expect(f.accept(invite(),'me')).rejects.toThrow('GAME_JOIN_REJECTED');
});
