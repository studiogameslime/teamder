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
  # Upstream names HippoCampus-Tech/Joryio, which does not exist, and the pod is
  # not on CocoaPods trunk. Irrelevant while we consume by :path from
  # vendor/joryio — CocoaPods never reads `source` for a path pod — but the
  # attribute is required, so it points at the repo the sources really live in.
  s.source       = { :git => "https://github.com/HippoCampus-Tech/Hippomation.git", :tag => s.version }
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"
  # Joryio/UI, not Joryio: the UI subspec pulls Core and adds native in-app
  # rendering, so a plain install displays messages without any JavaScript.
  # Calling Joryio.onInAppMessage() from JS still takes rendering over.
  # No version pin: Joryio is supplied by :path, and `~> 1.0` makes CocoaPods
  # look for a PUBLISHED spec instead of accepting the local one.
  s.dependency "Joryio/UI"
end
