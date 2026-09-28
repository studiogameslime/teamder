plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

// Single source of truth for both artifacts' version. base and -ui are released
// in LOCKSTEP at the same number, which is what stops a consumer assembling an
// incompatible pair; Braze does the same for android-sdk-base/-ui.
// ── LOCAL PATCH (Teamder) ──────────────────────────────────────────────────
// Upstream still says "1.0.0" while :joryio publishes 1.2.0, so this artifact
// would go out two versions behind and pin base to a version that never sat
// beside it. "Single source of truth" is the intent, not the mechanism —
// :joryio hardcodes its own number in its own file and nothing compares them.
val sdkVersion = "1.2.0"

android {
    namespace = "io.joryio.sdk.ui"
    compileSdk = 34

    defaultConfig {
        minSdk = 23
        targetSdk = 34
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // Must match :joryio exactly - see the long note in its build file. Kotlin's
    // jvm-target validation fails the build outright if a module's Java and
    // Kotlin targets disagree, and React Native's root plugin forces 17 on every
    // subproject when the SDK is consumed as an included build.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // The base SDK. `api`, not `implementation`: an app that depends on -ui gets
    // base's public surface (Joryio.track, identify, ...) without naming it, so
    // ONE coordinate is the whole integration.
    //
    // The PATH is resolved rather than hard-coded, because a Gradle project
    // path belongs to whoever registered it. In this build base is `:joryio`;
    // an app including the SDK by directory - which is how the demo apps and
    // any monorepo consumer link it - registers it as `:joryio-sdk`. Hard-coding
    // either one fails in the other build with "Project with path ':joryio'
    // could not be found", which is a confusing error for something that is
    // really just a naming difference.
    api(project(if (rootProject.findProject(":joryio") != null) ":joryio" else ":joryio-sdk"))

    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.20")
    implementation("androidx.core:core-ktx:1.12.0")

    testImplementation("junit:junit:4.13.2")
}

publishing {
    publications {
        create<MavenPublication>("release") {
            groupId = "io.joryio"
            artifactId = "joryio-android-ui"
            version = sdkVersion

            afterEvaluate {
                from(components["release"])

                // ── LOCAL PATCH (Teamder) ──────────────────────────
                // The generated POM ALREADY carries io.joryio:joryio-android at
                // this exact version, from the project dependency below — so the
                // pin this block was written for is there for free.
                //
                // It appended a SECOND <dependencies> element to a POM that
                // already had one, which is invalid, and Gradle refused the
                // publication outright: publishReleasePublicationToMavenLocal
                // failed with "POM file is invalid" on every machine, so the
                // artifact could not be released at all.
            }
        }
    }
}
