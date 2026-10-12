import {requireRecentAuth} from '../../functions/src/recentAuth';
const now=1800000000000;
test.each([undefined,null,0,'1800000000',NaN,Infinity,now/1000-301,now/1000+61])('rejects invalid or stale authentication before deletion: %s',at=>{
  expect(()=>requireRecentAuth(at,now)).toThrow('AUTH_REQUIRES_RECENT_LOGIN');
});
test('accepts a genuinely fresh authentication',()=>{
  expect(()=>requireRecentAuth(now/1000-299,now)).not.toThrow();
});
