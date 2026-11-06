const fs=require('fs'),path=require('path'),babel=require('@babel/core');
const traverse=require('@babel/traverse').default;
const targets=[
 'src/components/support/SupportChatHost.tsx','src/screens/auth/SignInScreen.tsx',
 'src/screens/auth/EmailAuthScreen.tsx','src/screens/tabs/ProfileScreen.tsx',
 'src/screens/players/PlayerCompareScreen.tsx','src/components/match/LiveScoreboardCard.tsx',
 'src/components/AppDialog.tsx','src/components/profile/HamburgerMenu.tsx',
 'src/components/chat/ChatView.tsx','src/components/PressableScale.tsx',
 'src/components/anim/BallSwitch.tsx','src/firebase/auth.ts',
 'src/services/gameService.ts','src/services/userService.ts','src/screens/SplashScreen.tsx',
 'src/screens/onboarding/PostSignInOnboardingScreen.tsx','src/screens/profile/AvailabilityEditScreen.tsx',
];
const rows=[];
for(const file of targets.filter(f=>fs.existsSync(f))) {
 const result=babel.transformFileSync(file,{caller:{name:'metro',platform:'android'},envName:'production',ast:true});
 const missing=[];let references=0;
 traverse(result.ast,{ReferencedIdentifier(p) {
  if(/^_(?:controlActivity|trackControl|productActor)\d*$/.test(p.node.name)) {
   references++;if(!p.scope.hasBinding(p.node.name))missing.push(p.node.name);
  }
 }});
 rows.push({file,references,unbound:missing});
}
const proof={transform:'normal Babel config, Metro caller, Android, production',files:rows,unbound:rows.reduce((n,r)=>n+r.unbound.length,0)};
fs.writeFileSync(path.join(__dirname,'runtime-bindings-result.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));
if(proof.unbound)process.exitCode=1;
