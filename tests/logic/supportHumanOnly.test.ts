import fs from 'fs';
import path from 'path';

const files=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);

test('support has no model UI, endpoints, configuration or provider code in either application or server sources',()=>{
  const forbidden=/supportAi|SUPPORT_AI_|askSupportAi|getSupportAiStatus|cleanupSupportAiLimits|SupportModelProvider|gemma|ollama|qwen|עוזר אוטומטי|שירות מודל/i;
  const violations=['src','functions/src','pulse/src','functions/lib'].filter(dir=>fs.existsSync(dir)).flatMap(dir=>files(dir)).filter(file=>/\.(tsx?|js|json)$/.test(file)&&forbidden.test(fs.readFileSync(file,'utf8')));
  expect(violations).toEqual([]);
  for(const removed of ['src/components/support/SupportAiPanel.tsx','src/services/supportAi.ts','functions/src/supportAi.ts','functions/src/supportKnowledge.json','functions/scripts/build-support-knowledge.cjs','scripts/evaluate-support-model.cjs','infra/support-model'])expect(fs.existsSync(removed)).toBe(false);
  const serverPackage=JSON.parse(fs.readFileSync('functions/package.json','utf8'));
  expect(serverPackage.scripts.build).not.toContain('support-knowledge');
  expect(serverPackage.dependencies).not.toHaveProperty('google-auth-library');
});

test('the only support composer sends the human draft and displays the official conversation',()=>{
  const host=fs.readFileSync('src/components/support/SupportChatHost.tsx','utf8');
  expect(host).toContain('await sendSupportDraft(uid, attempt)');
  expect(host).toContain("chatService.subscribeMessages('dm', convId");
  expect(host).toContain('תמיכה ועזרה · שיחה עם הצוות');
  expect(host).not.toContain('accessibilityRole="tab"');
  const entry=fs.readFileSync('functions/src/index.ts','utf8');
  expect(entry).toContain("export { sendSupportMessage } from './supportMessage'");
});
