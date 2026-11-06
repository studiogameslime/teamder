"""Wait for existing checks, verify local evidence, and produce one completion receipt."""
from pathlib import Path
import datetime, json, subprocess, sys, time
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/system-night'
deadline=time.monotonic()+2400
while not ((OUT/'jest-complete.json').is_file() and (OUT/'feature-refreshed.json').is_file()):
 if time.monotonic()>deadline:raise TimeoutError('Existing validation did not finish')
 time.sleep(15)
tests=json.loads((OUT/'jest-complete.json').read_text(encoding='utf8'))
features=json.loads((OUT/'feature-refreshed.json').read_text(encoding='utf8'))
assert tests['success'] and tests['numFailedTests']==0, 'Full test suite has failures'
assert not features['failed'], 'A documented feature did not refresh'
for kind in ['app','server','pulse']:
 assert not (OUT/(kind+'-types-complete.log')).read_text(encoding='utf-8-sig').strip(),kind
def run(script,target):
 p=subprocess.run([sys.executable,'-X','utf8',script],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
 (OUT/target).write_text(p.stdout,encoding='utf8')
 return p
status=subprocess.run([sys.executable,'-X','utf8','scripts/feature_status.py','check'],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
(OUT/'status-complete.json').write_text(status.stdout,encoding='utf8')
assert status.returncode==0, 'Feature status still has drift'
docs=run('scripts/check-feature-docs.py','docs-complete.json')
summary=json.loads(docs.stdout)
baseline=set(json.loads((OUT/'docs-before.json').read_text(encoding='utf8'))['failures'])
unexpected=[f for f in summary['failures'] if ': missing ' not in f or f not in baseline]
assert not unexpected, 'Documentation has failures beyond historic missing links'
if not (OUT/'release-log-receipt.json').is_file():
 record=run('scripts/audits/record-system-night.py','record.log')
 if record.returncode:
  (OUT/'record-error.log').write_text(record.stderr,encoding='utf8')
  raise RuntimeError('Release log recording requires attention')
receipt=json.loads((OUT/'release-log-receipt.json').read_text(encoding='utf8'))
assert len(receipt['entries'])==17 and all(row['readBackVerified'] for row in receipt['entries'])
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localOnly':True,'deployed':False,
 'tests':{'passed':tests['numPassedTests'],'failed':tests['numFailedTests'],'suites':tests['numTotalTestSuites']},
 'typechecks':['app','server','pulse'],'featureStatusFailures':0,
 'documentation':{'historicMissingLinks':len(summary['failures']),'otherFailures':0},
 'releaseEntriesReadBack':len(receipt['entries']),'proofsReadBack':sum('shotId' in e for e in receipt['entries']),
 'pulseTaskUpdated':False,'pulseTaskReason':'No verified item ID was supplied'}
(OUT/'completion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(result))
