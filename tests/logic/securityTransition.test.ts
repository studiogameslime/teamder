import fs from 'fs';
import path from 'path';
test('App Check enforcement requires an explicit server flag and defaults to off',()=>{
  const old=process.env.TEAMDER_ENFORCE_APP_CHECK;
  try {
    for(const [value,expected] of [[undefined,false],['false',false],['true',true]] as const){
      jest.resetModules();
      if(value===undefined)delete process.env.TEAMDER_ENFORCE_APP_CHECK;else process.env.TEAMDER_ENFORCE_APP_CHECK=value;
      expect(require('../../functions/src/appCheckPolicy').ENFORCE_APP_CHECK).toBe(expected);
    }
  } finally { if(old===undefined)delete process.env.TEAMDER_ENFORCE_APP_CHECK;else process.env.TEAMDER_ENFORCE_APP_CHECK=old; }
});
test('backup exclusions cover both cloud restore and device transfer, preserving other preferences',()=>{
  const root=path.resolve(__dirname,'../..');
  const plugin=require('../../plugins/withAuthBackupExclusions');
  const documents=plugin.backupDocuments(root,'./google-services.json');
  expect(documents['auth_backup_rules.xml']).toContain('SecureStore.xml');
  expect(documents['auth_backup_rules.xml']).toContain('com.google.firebase.auth.api.Store.');
  expect(documents['auth_backup_rules.xml']).not.toContain('path="."');
  const extraction=documents['auth_data_extraction_rules.xml'];
  expect(extraction).toContain('<cloud-backup>');expect(extraction).toContain('<device-transfer>');
  expect(fs.readFileSync(path.join(root,'pulse/plugins/withAuthBackupExclusions.js'),'utf8'))
    .toBe(fs.readFileSync(path.join(root,'plugins/withAuthBackupExclusions.js'),'utf8'));
});
