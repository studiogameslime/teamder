"""Capture the actual native product screen. Never opens the owner's package."""
from pathlib import Path
import subprocess,time,xml.etree.ElementTree as ET,re,json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/manager-implementation-2026-10-28'
ADB='C:/Users/User/Documents/Codex/tools/android-sdk/platform-tools/adb.exe'
PKG='com.studiogameslime.soccerapp.activitypreview'
def adb(*args):
    return subprocess.run([ADB,'-s','emulator-5554',*args],capture_output=True,check=True).stdout
def nodes():
    try:
        result=adb('shell','uiautomator','dump','/sdcard/manager-ui.xml')
        if b'UI hierchary dumped' not in result:return []
        return list(ET.fromstring(adb('shell','cat','/sdcard/manager-ui.xml')).iter('node'))
    except (subprocess.CalledProcessError,ET.ParseError):
        return []
def visible_node(label):
    for n in nodes():
        if label not in (n.get('text'),n.get('content-desc')):continue
        b=[int(v) for v in re.findall(r'\d+',n.get('bounds',''))]
        if len(b)==4 and b[2]>b[0] and b[3]>b[1] and b[1]>=0 and b[3]<=2400:
            return ((b[0]+b[2])//2,(b[1]+b[3])//2)
    return None
def tap(label):
    for _ in range(10):
        point=visible_node(label)
        if point:
            adb('shell','input','tap',*map(str,point));time.sleep(.6)
            expected={'דירוגים':'ציונים ומגמות','ציוד':'אצל מי הציוד עכשיו?'}.get(label)
            if expected and not visible_node(expected):
                point=visible_node(label)
                if point:adb('shell','input','tap',*map(str,point));time.sleep(.8)
                if not visible_node(expected):raise RuntimeError('Tab selection was not confirmed: '+label)
            return
        adb('shell','input','swipe','550','1850','550','850','350');time.sleep(.4)
    raise RuntimeError('Could not find visible label: '+label)
def root():
    adb('shell','am','force-stop',PKG)
    adb('shell','am','start','-n',PKG+'/com.studiogameslime.soccerapp.MainActivity')
    for _ in range(12):
        time.sleep(.6)
        if visible_node('מה דורש טיפול?'):time.sleep(1);return
    raise RuntimeError('Native manager root did not load')
def shot(name):
    time.sleep(.7)
    adb('shell','screencap','-p','/sdcard/manager-proof.png')
    adb('pull','/sdcard/manager-proof.png',str(OUT/(name+'.png')))
    print(name,flush=True)
scenarios=[
 ('after-overview',[]),
 ('after-readiness',['לתמונת המוכנות המלאה']),
 ('after-roster',['לסגל ולהרגלי ההרשמה']),
 ('after-cards',['לסגל ולהרגלי ההרשמה','כרטיסים פעילים']),
 ('after-player',['לסגל ולהרגלי ההרשמה','כל הסגל','מידע ניהולי על רועי מזרחי']),
 ('after-newcomers',['להשתלבות חברים חדשים']),
 ('after-equipment',['ציוד']),
 ('after-ratings',['דירוגים']),
 ('after-activity',['לסיכום הפעילות והמשחקים']),
 ('after-season',['למצב העונה']),
 ('after-demand',['לביקוש ולמקומות בהרשמה']),
 ('after-attendance',['לביטולים ולהגעה מדווחת']),
 ('after-retention',['להשתלבות חברים חדשים','להמשכיות לאורך זמן']),
]
if __name__=='__main__':
    import sys
    wanted=set(sys.argv[1:])
    results=[]
    for name,steps in scenarios:
        if wanted and name not in wanted:continue
        root()
        for label in steps:tap(label)
        shot(name)
        results.append({'file':name+'.png','steps':steps,'native':True,'package':PKG,'fixture':True})
    receipt=OUT/'native-capture-receipt.json'
    merged={r['file']:r for r in json.loads(receipt.read_text(encoding='utf-8'))} if receipt.exists() else {}
    merged.update({r['file']:r for r in results})
    receipt.write_text(json.dumps(list(merged.values()),ensure_ascii=False,indent=2),encoding='utf-8')
