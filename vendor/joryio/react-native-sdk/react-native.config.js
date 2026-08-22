/**
 * React Native CLI autolinking descriptor.
 *
 * Without this the CLI silently skips the package: the app still builds, the
 * native module is simply absent, and the SDK degrades to no-ops — a green
 * build that ships zero analytics. Verified: before adding this file, the APK
 * contained 0 joryio entries and Gradle ran 0 :joryio-sdk tasks.
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import io.joryio.reactnative.JoryioPackage;',
        packageInstance: 'new JoryioPackage()',
      },
      ios: {
        podspecPath: './joryio-react-native.podspec',
      },
    },
  },
};
