require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "joryio-react-native"
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = "https://github.com/HippoCampus-Tech/Joryio"
  s.license      = "MIT"
  s.author       = "Joryio"
  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => "https://github.com/HippoCampus-Tech/Joryio.git", :tag => s.version }
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"

  # Joryio/UI, not Joryio: the UI subspec pulls Core and adds native in-app
  # rendering, so a plain install displays messages without any JavaScript.
  # Calling Joryio.onInAppMessage() from JS still takes rendering over.
  #
  # NO VERSION PIN, deliberately, until the pod is published. `"~> 1.0"` cannot
  # resolve against any spec repo because Joryio is not on CocoaPods trunk yet,
  # so `pod install` fails outright and the integrator has to edit this file by
  # hand - which a production integration reported doing (2026-08-23).
  #
  # Until then, point CocoaPods at a local checkout from your app's Podfile:
  #
  #   pod 'Joryio', :path => '../path/to/packages/sdk-ios'
  #
  # A :path pod resolves from source and satisfies this dependency. Restore the
  # pin at publish time - see PRODUCTION_DEPLOYMENT_PLAN, "Publishing the SDKs".
  s.dependency "Joryio/UI"
end
