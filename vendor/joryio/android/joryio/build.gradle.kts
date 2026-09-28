import java.util.Properties

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    // Generates Room's JoryioDatabase_Impl. WITHOUT this the room-runtime
    // dependency below compiles fine and then throws at RUNTIME - "Cannot find
    // implementation for JoryioDatabase" - inside initialize(), which meant the
    // Android SDK could never start. A missing annotation processor is invisible
    // until the first database access, so keep it next to the room deps.
    //
    // kapt rather than KSP deliberately: this module is consumed as a SOURCE
    // MODULE by host apps (the RN bridge does exactly that), and KSP would
    // require every one of those apps to declare the KSP plugin version in its
    // own settings.gradle. kapt ships with the Kotlin plugin they already have,
    // so the SDK stays self-contained. Revisit if the SDK is only ever consumed
    // as a published AAR.
    id("kotlin-kapt")
    id("maven-publish")
}

android {
    namespace = "io.joryio.sdk"
    compileSdk = 34

    /**
     * Android Lint is already part of AGP - no extra tooling. Configured so a
     * run MEANS something: dependency-staleness warnings drowned the two
     * findings that were actually about our code, and a report nobody reads is
     * the same as no report.
     *
     * Run with: ./gradlew :joryio:lintRelease
     */
    lint {
        warningsAsErrors = false
        abortOnError = true
        // Version-bump nagging, not correctness. Dependencies are upgraded
        // deliberately, not because a linter noticed a newer number exists.
        disable += setOf("GradleDependency", "OldTargetApi", "KaptUsageInsteadOfKsp")
    }

    defaultConfig {
        minSdk = 23
        targetSdk = 34

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // Java 17, matching AGP 8 / compileSdk 34 and the React Native 0.75
    // toolchain. This is not cosmetic: when the SDK is consumed as an included
    // Gradle project (which is how the demo apps and any monorepo consumer link
    // it), React Native's `com.facebook.react.rootproject` plugin applies Java
    // 17 to every subproject. Pinning Kotlin to 11 here left the module with
    // compileDebugJavaWithJavac=17 and compileDebugKotlin=11, and Kotlin's
    // jvm-target validation fails the build outright:
    //
    //   Inconsistent JVM-target compatibility detected for tasks
    //   'compileDebugJavaWithJavac' (17) and 'compileDebugKotlin' (11)
    //
    // So the SDK could not be built by a stock RN app at all. Both values move
    // together - they must always agree, whatever the number is.
    //
    // Safe for the published AAR too: AGP 8 already requires JDK 17 to run, and
    // d8 desugars for minSdk 23, so 17-target bytecode does not raise the
    // SDK's runtime floor.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.20")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // AndroidX
    implementation("androidx.core:core-ktx:1.12.0")
    // ActivityResultRegistry, for requesting POST_NOTIFICATIONS without asking the
    // host app to plumb onRequestPermissionsResult back to us. Present already in
    // every AppCompat / React Native app; declared so we do not rely on it
    // arriving transitively.
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
    implementation("androidx.lifecycle:lifecycle-process:2.6.2")

    // Security: EncryptedSharedPreferences + MasterKey (encrypt sensitive data at rest).
    // Requires API 23+ at runtime; minSdk IS 23, so it is always available.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // JSON
    implementation("com.google.code.gson:gson:2.10.1")

    // Database
    implementation("androidx.room:room-runtime:2.6.0")
    implementation("androidx.room:room-ktx:2.6.0")
    // Required: generates the _Impl classes room-runtime looks up at runtime.
    kapt("androidx.room:room-compiler:2.6.0")

    // Firebase Cloud Messaging (optional - for push notifications)
    compileOnly("com.google.firebase:firebase-messaging:23.3.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

// The published version of both artifacts, read from THIS repository's
// gradle.properties by path. Gradle only reads gradle.properties from the
// ROOT project and the user home, and a React Native app consumes these
// modules as projects of its own build (`include ':joryio-sdk'` +
// projectDir), so `project.findProperty(...)` is null there and an error()
// took every consumer's build down at configuration time (Teamder,
// 2026-09-28). The version only matters when PUBLISHING: a consumer that
// never publishes gets "unspecified" and builds; a publish without the
// property fails at publish time, where it belongs.
val sdkVersion: String = run {
    val props = Properties()
    val own = file("${projectDir.parentFile}/gradle.properties")
    if (own.isFile) own.inputStream().use { props.load(it) }
    (project.findProperty("joryioSdkVersion") as String?)
        ?: props.getProperty("joryioSdkVersion")
        ?: "unspecified"
}

publishing {
    publications {
        create<MavenPublication>("release") {
            groupId = "io.joryio"
            artifactId = "joryio-android"
            // ONE number for base and -ui: gradle.properties (joryioSdkVersion), see sdkVersion above.
            version = sdkVersion

            afterEvaluate {
                from(components["release"])
            }
        }
    }
}
