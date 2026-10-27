"""Audit the actual Kotlin parser and extracted legacy transaction. No Android runtime or Firestore writes."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2];out=root/'artifacts/watch-app-audit-2026-10-25'
out.mkdir(parents=True,exist_ok=True)
runtime=root.parent/'tools';lib=next((runtime/'gradle-cache/wrapper/dists/gradle-8.13-bin').glob('*/gradle-8.13/lib'))
java=runtime/'jdk-17.0.20.1+1/bin/java.exe';stdlib=lib/'kotlin-stdlib-2.0.21.jar'
jsonjar=next((runtime/'gradle-cache/caches/modules-2/files-2.1/org.json/json').glob('**/*.jar'))
(out/'SystemClock.kt').write_text('package android.os\nobject SystemClock { @JvmStatic fun elapsedRealtime(): Long = 100_000L }',encoding='utf-8')
source=(root/'plugins/wear-src/widget/kotlin/TimerActionReceiver.kt').read_text(encoding='utf-8')
body=source.split('db.runTransaction<Map<String, Any?>?> { tx ->',1)[1].split('}.addOnSuccessListener',1)[0]
prefix='''package audit
class Snapshot(private val data: Map<String, Any?>) {
 fun exists() = true
 fun get(key: String): Any? = data[key]
 fun getString(key: String) = data[key] as? String
}
class Transaction(private val data: Map<String, Any?>) {
 var written: Map<String, Any?>? = null
 fun get(ref: String) = Snapshot(data)
 fun update(ref: String, fields: Map<String, Any?>) { written = fields }
}
const val ACTION_START = "start"
const val ACTION_PAUSE = "pause"
const val ACTION_RESET = "reset"
fun legacy(game: Map<String, Any?>, action: String, now: Long, uid: String = "owner"): Map<String, Any?>? {
 val tx = Transaction(game); val ref = "qa-only"; val userName = "local"; var boundRound: String? = null
 fun runTransaction(block: (Transaction) -> Map<String, Any?>?) = block(tx)
 runTransaction { tx ->
'''
(out/'LegacyTransaction.kt').write_text(prefix+body+'\n }\n return tx.written\n}\n',encoding='utf-8')
model=root/'plugins/wear-src/wear/src/main/java/com/studiogameslime/soccerapp/wear/model'
sources=[model/'WearGameState.kt',model/'WearStatePayload.kt',out/'SystemClock.kt',out/'LegacyTransaction.kt',root/'tests/native/watch/WatchAuditTest.kt']
classpath=os.pathsep.join(map(str,[stdlib,jsonjar]));jar=out/'watch-tests.jar'
args=['-no-stdlib','-no-reflect','-jvm-target','17','-classpath',classpath,'-d',str(jar)]+list(map(str,sources))
(out/'compile.args').write_text('\n'.join(json.dumps(v.replace('\\','/')) for v in args),encoding='utf-8')
r=subprocess.run([str(java),'-cp',str(lib/'*'),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','@'+str(out/'compile.args')],capture_output=True,text=True,encoding='utf-8',errors='replace')
(out/'native-compile.log').write_text(r.stdout+r.stderr,encoding='utf-8')
if r.returncode:print(r.stdout+r.stderr);raise SystemExit(r.returncode)
r=subprocess.run([str(java),'-cp',os.pathsep.join([str(jar),classpath]),'audit.WatchAuditTestKt'],capture_output=True,text=True,encoding='utf-8',errors='replace')
(out/'native-tests.log').write_text(r.stdout+r.stderr,encoding='utf-8');print(r.stdout+r.stderr)
raise SystemExit(r.returncode)
