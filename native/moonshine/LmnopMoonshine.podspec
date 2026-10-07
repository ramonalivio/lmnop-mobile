Pod::Spec.new do |s|
  s.name = 'LmnopMoonshine'
  s.version = '0.1.5'
  s.summary = 'Local Moonshine streaming speech bridge for LMNOP'
  s.homepage = 'https://github.com/moonshine-ai/moonshine'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'LMNOP'
  s.source = { :git => 'https://github.com/moonshine-ai/moonshine-swift.git', :tag => 'v0.1.5' }
  s.platform = :ios, '15.1'
  s.source_files = 'MoonshineSpeech.mm'
  s.vendored_frameworks = 'Frameworks/Moonshine.xcframework'
  s.libraries = 'c++'
  s.dependency 'React-Core'
end
