Pod::Spec.new do |s|
  s.name = 'LmnopOmiMed'
  s.version = '1.0.0'
  s.summary = 'Omi Med STT v1 offline refinement for LMNOP'
  s.homepage = 'https://github.com/Omi-Health/omi-med-stt-runtime'
  s.license = { :type => 'MIT', :file => 'OMI-RUNTIME-LICENSE' }
  s.author = 'LMNOP'
  s.source = { :git => 'https://github.com/Omi-Health/omi-med-stt-runtime.git', :commit => '41689b213622b0bf87cdcd75047b272facec9393' }
  s.platform = :ios, '15.1'
  s.source_files = 'ios/OmiMedSpeech.mm', 'ios/omi_engine.h'
  s.vendored_frameworks = 'Frameworks/OmiMedEngine.xcframework', 'Frameworks/OmiMedEngineFast.xcframework'
  s.resource_bundles = { 'LmnopOmiLicenses' => ['licenses/*.txt'] }
  s.libraries = 'c++'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17' }
  s.dependency 'React-Core'
end
