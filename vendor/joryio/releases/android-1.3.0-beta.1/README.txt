Joryio Android SDK 1.3.0-beta.1 (BETA) - local Maven repository

Betas are not on Maven Central. Unzip this file into a folder, then add that
folder as a Maven repository BEFORE google() and mavenCentral():

  // settings.gradle.kts
  dependencyResolutionManagement {
      repositories {
          maven { url = uri("/absolute/path/to/joryio-android-1.3.0-beta.1-maven-repo") }
          google()
          mavenCentral()
      }
  }

  // app/build.gradle.kts
  implementation("io.joryio:joryio-android:1.3.0-beta.1")      // or joryio-android-ui

The SDK's own dependencies (okhttp, kotlin-stdlib, androidx, ...) still come
from google() and mavenCentral().

React Native (@joryio/react-native-sdk@1.3.0-beta.1): add the folder to
android/build.gradle (the project-level file):

  allprojects {
      repositories {
          maven { url = uri("/absolute/path/to/joryio-android-1.3.0-beta.1-maven-repo") }
      }
  }

Unity (Joryio Unity SDK 1.3.0-beta.1, which already asks EDM4U for
io.joryio:joryio-android:1.3.0-beta.1): unzip OUTSIDE Assets/ (Unity would import
the .aar files as plugins), then add Assets/Editor/JoryioBetaRepository.xml:

  <dependencies>
    <androidPackages>
      <androidPackage spec="io.joryio:joryio-android:1.3.0-beta.1">
        <repositories>
          <repository>file:///absolute/path/to/joryio-android-1.3.0-beta.1-maven-repo</repository>
        </repositories>
      </androidPackage>
    </androidPackages>
  </dependencies>

then Assets -> External Dependency Manager -> Android Resolver -> Force
Resolve. Delete that file when you move to the final release.
