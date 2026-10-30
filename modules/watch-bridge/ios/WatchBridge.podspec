Pod::Spec.new do |s|
  s.name = 'WatchBridge'
  s.version = '1.0.0'
  s.summary = 'Teamder Apple Watch connectivity bridge'
  s.description = 'Local Expo module for the Teamder phone and Apple Watch relay.'
  s.author = 'Teamder'
  s.homepage = 'https://github.com/studiogameslime/teamder'
  s.license = { :type => 'Proprietary' }
  s.source = { :git => 'https://github.com/studiogameslime/teamder.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity', 'SystemConfiguration'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
