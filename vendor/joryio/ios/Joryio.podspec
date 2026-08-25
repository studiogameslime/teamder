Pod::Spec.new do |s|
  s.name             = 'Joryio'
  # Keep in sync with the SDK release version (package.json in sdk-web is the
  # fleet reference; all SDKs ship 1.0.0 until the first public release).
  s.version          = '1.2.0'
  s.summary          = 'Joryio iOS SDK — identify, track, push, and in-app messaging.'
  s.description      = <<-DESC
    Official Joryio SDK for iOS: user identification, event tracking with
    offline batching, push notifications (APNS), in-app messaging, and
    e-commerce tracking helpers.
  DESC
  s.homepage         = 'https://joryio.com'
  s.license          = { :type => 'Commercial', :text => 'Copyright Joryio. All rights reserved.' }
  s.author           = { 'Joryio' => 'support@joryio.com' }
  # CocoaPods requires a source; the git URL is the canonical distribution
  # point once the SDK repo is published. The React Native podspec depends on
  # this pod ("Joryio", "~> 1.0"), which is why it must exist.
  s.source           = { :git => 'https://github.com/HippoCampus-Tech/joryio-sdk-ios.git', :tag => s.version.to_s }

  s.ios.deployment_target = '14.0'
  s.swift_version    = '5.9'

  # Subspecs mirror the SwiftPM products, so a CocoaPods consumer gets the same
  # choice: `pod 'Joryio'` is tracking/identity/push with NO WebKit and no
  # message views linked; `pod 'Joryio/UI'` adds in-app rendering.
  #
  # `Core` is the default subspec, so a bare `pod 'Joryio'` stays UI-free. That
  # is deliberate: an integrator who has not asked for in-app rendering should
  # not silently link a web view.
  s.default_subspec  = 'Core'

  s.subspec 'Core' do |core|
    core.source_files = 'Sources/Joryio/**/*.swift'
  end

  s.subspec 'UI' do |ui|
    ui.source_files   = 'Sources/JoryioUI/**/*.swift'
    ui.dependency 'Joryio/Core'
  end

  # Mirrors Package.swift dependencies.
  s.dependency 'SQLite.swift', '~> 0.15'
  s.dependency 'Stencil', '~> 0.15'
end
