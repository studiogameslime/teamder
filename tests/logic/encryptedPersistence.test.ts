import { encryptedPersistence } from '../../src/utils/encryptedPersistence';
function setup() {
  const encrypted = new Map<string,string>(), plain = new Map<string,string>();
  const storage = (map: Map<string,string>) => ({ getItem: async (k:string) => map.get(k) ?? null,
    setItem: async (k:string,v:string) => { map.set(k,v); }, removeItem: async (k:string) => { map.delete(k); } });
  const secure = storage(encrypted), legacy = storage(plain);
  let sequence=0;
  return { encrypted, plain, secure, legacy, adapter: encryptedPersistence(secure,legacy,async k=>k,()=>`v${++sequence}`) };
}
test('migrates an existing login without exposing large Unicode chunks in plaintext',async()=>{
  const s=setup(), value=JSON.stringify({token:'א😀'.repeat(3000)});
  s.plain.set('login',value);
  expect(await s.adapter.getItem('login')).toBe(value);
  expect(s.plain.has('login')).toBe(false);
  expect(await s.adapter.getItem('login')).toBe(value);
  for(const [key,chunk] of s.encrypted) if(key.endsWith('.0')||/\.\d+$/.test(key)) expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(1920);
});
test('a failed encrypted write retains the existing login',async()=>{
  const s=setup();s.plain.set('login','existing');
  s.secure.setItem=async()=>{throw new Error('device locked');};
  await expect(s.adapter.getItem('login')).rejects.toThrow('device locked');
  expect(s.plain.get('login')).toBe('existing');
});
test('concurrent updates and logout cannot resurrect old login',async()=>{
  const s=setup();
  await Promise.all([s.adapter.setItem('login','first'),s.adapter.setItem('login','second'),s.adapter.removeItem('login')]);
  expect(await s.adapter.getItem('login')).toBeNull();
  expect(s.encrypted.size).toBe(0);
});
test('missing encrypted chunks fail visibly rather than claiming no saved user',async()=>{
  const s=setup();await s.adapter.setItem('login','saved');
  s.encrypted.delete('firebaseAuth.login.v1.0');
  await expect(s.adapter.getItem('login')).rejects.toThrow('AUTH_STORAGE_INCOMPLETE');
});
test('committed encrypted login wins over stale plaintext left after interrupted cleanup',async()=>{
  const s=setup();await s.adapter.setItem('login','new');s.plain.set('login','old');
  expect(await s.adapter.getItem('login')).toBe('new');expect(s.plain.has('login')).toBe(false);
});
