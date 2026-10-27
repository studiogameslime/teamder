"""Prepare an isolated debug-only widget package. Does not build, install or touch production data."""
from pathlib import Path
import json
import shutil
import argparse
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/widget-completion-2026-10-25'
out.mkdir(parents=True,exist_ok=True)
android=root/'android'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--restore',action='store_true',help='Restore the generated debug manifest and remove only the copied QA sources.')
args=parser.parse_args()
if args.restore:
    manifest=android/'app/src/debug/AndroidManifest.xml'
    backup=out/'debug-manifest-original.xml'
    if not backup.exists(): raise SystemExit('Missing original debug manifest; refusing to guess.')
    shutil.copy2(backup,manifest)
    qa=(android/'app/src/debug/java/com/studiogameslime/soccerapp/widget').resolve()
    assert qa.is_relative_to(root.resolve())
    for source in (root/'tests/native/widget-qa').glob('*.kt'):
        target=qa/source.name
        if target.exists(): target.unlink()
    print('Restored original debug manifest and removed the copied QA-only Kotlin files.')
    raise SystemExit(0)
dest=android/'app/src/main/java/com/studiogameslime/soccerapp'
for source in (root/'plugins/wear-src/widget/kotlin').glob('*.kt'):
    shutil.copy2(source,dest/'widget'/source.name)
for source in (root/'plugins/wear-src/watch').glob('*.kt'):
    shutil.copy2(source,dest/'watch'/source.name)
for source in (root/'plugins/wear-src/widget/res').rglob('*'):
    if source.is_file():
        target=android/'app/src/main/res'/source.relative_to(root/'plugins/wear-src/widget/res')
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
gradle=android/'app/build.gradle'
text=gradle.read_text(encoding='utf-8')
if 'androidx.work:work-runtime' not in text:
    text=text.replace('dependencies {','dependencies {\n    implementation("androidx.work:work-runtime:2.7.0")',1)
gradle.write_text(text,encoding='utf-8')
qa=android/'app/src/debug/java/com/studiogameslime/soccerapp/widget'
qa.mkdir(parents=True,exist_ok=True)
for source in (root/'tests/native/widget-qa').glob('*.kt'):
    shutil.copy2(source,qa/source.name)
manifest=android/'app/src/debug/AndroidManifest.xml'
backup=out/'debug-manifest-original.xml'
if not backup.exists(): backup.write_bytes(manifest.read_bytes())
manifest.write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
<application android:name="com.studiogameslime.soccerapp.widget.WidgetAuditApplication" tools:replace="android:name">
<provider android:name="com.google.firebase.provider.FirebaseInitProvider" tools:node="remove" />
<provider android:name="androidx.startup.InitializationProvider" android:authorities="${applicationId}.androidx-startup" tools:node="merge">
<meta-data android:name="androidx.work.WorkManagerInitializer" tools:node="remove" />
</provider>
<activity android:name="com.studiogameslime.soccerapp.widget.WidgetAuditActivity" android:exported="true" android:theme="@android:style/Theme.Material.Light.NoActionBar" />
</application><instrumentation android:name="com.studiogameslime.soccerapp.widget.WidgetAuditInstrumentation" android:targetPackage="com.studiogameslime.soccerapp.widgetqa" /></manifest>''',encoding='utf-8')
(out/'qa.init.gradle').write_text('''allprojects { p ->
  p.afterEvaluate {
    if (p.path == ':app') {
      p.android.buildTypes.debug.applicationIdSuffix = '.widgetqa'
      p.tasks.matching { it.name == 'processDebugGoogleServices' }.configureEach { enabled = false }
    }
  }
}''',encoding='utf-8')
print(json.dumps({'debugOnly':True,'applicationId':'com.studiogameslime.soccerapp.widgetqa','server':'local-fixtures','productionInstalledAppChanged':False,'requiredBuildInit':str(out/'qa.init.gradle')}))
