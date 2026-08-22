plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

// Single source of truth for both artifacts' version. base and -ui are released
// in LOCKSTEP at the same number, which is what stops a consumer assembling an
// incompatible pair; Braze does the same for android-sdk-base/-ui.
val sdkVersion = "1.0.0"

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

                // Pin base to the EXACT same version rather than letting Gradle
                // resolve a range. The reflective lookup between the two
                // artifacts (base finds DefaultInAppMessagePresenter by name)
                // has no compile-time check, so a mismatched pair would fail by
                // displaying nothing rather than by failing to build. An exact
                // pin makes that impossible at resolution time.
                pom.withXml {
                    val deps = asNode().appendNode("dependencies")
                    deps.appendNode("dependency").apply {
                        appendNode("groupId", "io.joryio")
                        appendNode("artifactId", "joryio-android")
                        appendNode("version", "[$sdkVersion]")
                        appendNode("scope", "compile")
                    }
                }
            }
        }
    }
}
