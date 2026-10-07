#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#include "omi_engine.h"
#include <dlfcn.h>
#include <sys/sysctl.h>
#include <vector>

static bool cpuFeature(const char *name) {
  int value = 0;
  size_t size = sizeof(value);
  return sysctlbyname(name, &value, &size, nullptr, 0) == 0 && value == 1;
}
@interface OmiMedSpeech : NSObject <RCTBridgeModule, RCTInvalidating>
@end
@implementation OmiMedSpeech {
  dispatch_queue_t _queue;
  void *_library;
  void *_model;
  NSString *_sessionId;
  BOOL _optimized;
  decltype(&lmnop_omi_load) _load;
  decltype(&lmnop_omi_transcribe) _transcribe;
  decltype(&lmnop_omi_error) _error;
  decltype(&lmnop_omi_free_text) _freeText;
  decltype(&lmnop_omi_release) _release;
}
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) _queue = dispatch_queue_create("com.lmnop.omi-med", DISPATCH_QUEUE_SERIAL);
  return self;
}
- (dispatch_queue_t)methodQueue { return _queue; }
- (BOOL)loadLibrary:(RCTPromiseRejectBlock)reject {
  if (_library) return YES;
  _optimized = cpuFeature("hw.optional.arm.FEAT_DotProd") && cpuFeature("hw.optional.neon_fp16");
  NSString *name = _optimized ? @"OmiMedEngineFast" : @"OmiMedEngine";
  NSString *path = [NSBundle.mainBundle.privateFrameworksPath stringByAppendingPathComponent:
      [NSString stringWithFormat:@"%@.framework/%@", name, name]];
  _library = dlopen(path.fileSystemRepresentation, RTLD_NOW | RTLD_LOCAL);
  if (_library) {
    _load = reinterpret_cast<decltype(_load)>(dlsym(_library, "lmnop_omi_load"));
    _transcribe = reinterpret_cast<decltype(_transcribe)>(dlsym(_library, "lmnop_omi_transcribe"));
    _error = reinterpret_cast<decltype(_error)>(dlsym(_library, "lmnop_omi_error"));
    _freeText = reinterpret_cast<decltype(_freeText)>(dlsym(_library, "lmnop_omi_free_text"));
    _release = reinterpret_cast<decltype(_release)>(dlsym(_library, "lmnop_omi_release"));
    if (_load && _transcribe && _error && _freeText && _release) return YES;
    dlclose(_library); _library = nullptr;
  }
  reject(@"omi_med", @"Omi native engine is missing or incompatible. Install a current iOS build.", nil);
  return NO;
}
- (void)freeSession {
  if (_model) _release(_model);
  _model = nullptr;
  _sessionId = nil;
}
RCT_EXPORT_METHOD(prepare:(NSString *)sessionId modelPath:(NSString *)modelPath
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  const double started = NSProcessInfo.processInfo.systemUptime;
  if (![self loadLibrary:reject]) return;
  if (![_sessionId isEqualToString:sessionId]) {
    [self freeSession];
    _model = _load(modelPath.fileSystemRepresentation);
    if (!_model) { reject(@"omi_med", @"Could not load Omi Med STT v1 Q8 GGUF.", nil); return; }
    _sessionId = [sessionId copy];
  }
  resolve(@{@"model": @"Omi Med STT v1 Q8_0 GGUF", @"backend": @"CPU", @"gpu": @NO,
      @"threads": @4, @"nativeLoadMs": @((NSProcessInfo.processInfo.systemUptime - started) * 1000),
      @"runtime": [@"parakeet.cpp b11fe5bc + Omi adapter v2 / GGML CPU / " stringByAppendingString:
          _optimized ? @"ARM dotprod + FP16" : @"ARM baseline"]});
}
RCT_EXPORT_METHOD(transcribe:(NSString *)sessionId pcm:(NSString *)encoded
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!_model || ![_sessionId isEqualToString:sessionId]) {
    reject(@"omi_med", @"Omi is not prepared.", nil); return;
  }
  NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
  if (!data.length || data.length % 2 || data.length > 16000 * 2 * 26) {
    reject(@"omi_med", @"Invalid PCM16 audio window.", nil); return;
  }
  try {
    const double started = NSProcessInfo.processInfo.systemUptime;
    const uint8_t *bytes = static_cast<const uint8_t *>(data.bytes);
    std::vector<float> samples(data.length / 2);
    for (size_t i = 0; i < samples.size(); ++i)
      samples[i] = static_cast<int16_t>(bytes[2*i] | (uint16_t(bytes[2*i+1]) << 8)) / 32768.0f;
    char *raw = _transcribe(_model, samples.data(), samples.size());
    if (!raw) {
      const char *message = _error(_model);
      reject(@"omi_med", message ? @(message) : @"Omi transcription failed.", nil); return;
    }
    NSString *text = [NSString stringWithUTF8String:raw];
    _freeText(raw);
    if (!text) { reject(@"omi_med", @"Omi returned invalid UTF-8.", nil); return; }
    resolve(@{@"text": [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet],
              @"nativeMs": @((NSProcessInfo.processInfo.systemUptime - started) * 1000)});
  } catch (const std::exception &error) { reject(@"omi_med", @(error.what()), nil); }
}
RCT_EXPORT_METHOD(release:(NSString *)sessionId resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if ([_sessionId isEqualToString:sessionId]) [self freeSession];
  resolve(nil);
}
- (void)invalidate {
  dispatch_async(_queue, ^{
    [self freeSession];
    if (self->_library) { dlclose(self->_library); self->_library = nullptr; }
  });
}
@end
