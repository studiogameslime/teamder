"""Read back only the isolated preview's planning key before and after restart.
Screenshot states were operated and visually checked separately. UIAutomator
exposes an empty tree when LogBox is suppressed in this preview, so this script
claims storage verification only, not automatic UI assertions.
"""
from pathlib import Path
import subprocess, time, json, sqlite3
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/pro-planning-2026-10-30'
ADB='C:/Users/User/Documents/Codex/tools/android-sdk/platform-tools/adb.exe'
PKG='com.studiogameslime.soccerapp.activitypreview'
def adb(*args):
    return subprocess.run([ADB,'-s','emulator-5554',*args],capture_output=True,check=True).stdout
def plan():
    path=OUT/'preview-storage.sqlite'
    path.write_bytes(adb('exec-out','run-as',PKG,'cat','databases/RKStorage'))
    with sqlite3.connect(path) as db:
        value=db.execute('SELECT value FROM catalystLocalStorage WHERE key=?',('pulse.proPlanning.v1',)).fetchone()
    assert value is not None
    return json.loads(value[0])
before=plan()
assert before=={'entry/authentication':True}
adb('shell','am','force-stop',PKG)
adb('shell','am','start','-n',PKG+'/com.studiogameslime.soccerapp.MainActivity')
time.sleep(5)
after=plan()
assert before==after
(OUT/'native-receipt.json').write_text(json.dumps({
    'package':PKG,'render':'real Pulse screen with root React Native runtime, isolated from Firebase',
    'features':84,'visuallyCheckedStates':['all: 84 total, 0 pro, 84 non pro','pro only: 1 shown, 1 pro, 83 non pro'],
    'storageReadBack':after,'savedAcrossRestart':True,'productionDataChanged':False,
    'limits':'Preview runtime differs from installed Pulse. Navigation and real Pulse installation not exercised.'
},indent=2),encoding='utf-8')
print('Planning key read back and persisted across preview restart')
