"""Compile and execute the actual pure Kotlin engine. No Android/emulated algorithm."""
import os, subprocess
from pathlib import Path
cache = Path(os.environ.get('GRADLE_USER_HOME', 'C:/Users/User/Documents/Codex/tools/gradle-cache')) / 'caches/modules-2/files-2.1'
def jar(group, name, version):
    return str(next((cache/group/name/version).rglob('*.jar')))
stdlib = jar('org.jetbrains.kotlin','kotlin-stdlib','2.0.21')
deps = [stdlib, jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.0.21'), jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330'), jar('org.jetbrains','annotations','13.0')]
deps += [str(p) for p in (cache/'org.jetbrains.kotlin/kotlin-script-runtime/2.0.21').rglob('*.jar')]
deps += [str(p) for p in (cache/'org.jetbrains.kotlin/kotlin-daemon-embeddable/2.0.21').rglob('*.jar')]
deps += [str(next((cache/'org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm').rglob('*.jar')))]
java = str(Path(os.environ.get('JAVA_HOME', 'C:/Users/User/Documents/Codex/tools/jdk-17.0.20.1+1'))/'bin/java.exe')
out = Path('artifacts/phone-measurement/native-tests'); out.mkdir(parents=True,exist_ok=True)
subprocess.run([java,'-cp',os.pathsep.join(deps),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',stdlib,'-d',str(out),'plugins/phone-activity-src/PhoneMovement.kt','tests/native/PhoneMovementTest.kt'],check=True)
subprocess.run([java,'-cp',os.pathsep.join([str(out),stdlib]),'PhoneMovementTestKt'],check=True)
