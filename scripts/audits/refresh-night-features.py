"""Refresh each documented feature through the normal status command, serially."""
from pathlib import Path
import json, subprocess, sys
ROOT=Path(__file__).resolve().parents[2]
features=set(json.loads((ROOT/'artifacts/system-night/documented-features.json').read_text(encoding='utf8')))
features.update(['shared/usage-activity','shared/pulse-management','entry/authentication','profile/profile-edit',
                 'entry/profile-onboarding','rounds/registration','rounds/fillers','rounds/penalties',
                 'rounds/match-stats','statistics/club-leaders-and-table','clubs/members-and-administration'])
failures=[]
with (ROOT/'artifacts/system-night/feature-refresh.log').open('w',encoding='utf8') as log:
 for feature in sorted(features):
  result=subprocess.run([sys.executable,'-X','utf8','scripts/feature_status.py','refresh',feature],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
  log.write(feature+'\n'+result.stdout+result.stderr+'\n');log.flush()
  if result.returncode:failures.append(feature)
result={'features':len(features),'failed':failures}
(ROOT/'artifacts/system-night/feature-refreshed.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps(result))
raise SystemExit(bool(failures))
