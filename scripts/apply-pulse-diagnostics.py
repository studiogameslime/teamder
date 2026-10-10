from pathlib import Path
import shutil
import argparse
parser=argparse.ArgumentParser(description='Apply the Pulse diagnostic timeline to an existing Pulse checkout')
parser.add_argument('pulse_root',type=Path)
args=parser.parse_args()
root=args.pulse_root.resolve()
assert (root/'src/screens/TasksScreen.tsx').is_file(),'Not a Pulse checkout'
here=Path(__file__).resolve().parent/'pulse-ui'
for name,destination in [('diagnosticTimeline.ts','src/services'),('DiagnosticTimeline.tsx','src/components')]:
    shutil.copy2(here/name,root/destination/name)
for file,anchor,insertion in [
 ('src/screens/ErrorDetailScreen.tsx','          {/* What the user was trying to do','          <DiagnosticTimeline docPath={`${rec.coll??\'errors\'}/${rec.id}`} />\n\n'),
 ('src/screens/ReportsScreen.tsx','                  {it.message ?','                  <DiagnosticTimeline docPath={`feedback/${it.id}`} />\n'),
 ('src/screens/TasksScreen.tsx','          {item.body ?','          {(item.stream===\'error\'||item.stream===\'report\')?<DiagnosticTimeline docPath={item.docPath}/>:null}\n'),
]:
    p=root/file;s=p.read_text(encoding='utf-8')
    if "import { DiagnosticTimeline }" in s:continue
    assert anchor in s,(file,anchor)
    s="import { DiagnosticTimeline } from '../components/DiagnosticTimeline';\n"+s.replace(anchor,insertion+anchor,1)
    p.write_text(s,encoding='utf-8')
print('Pulse diagnostic UI installed in three entry points')
