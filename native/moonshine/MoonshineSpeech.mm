#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#include "moonshine-c-api.h"
#include <vector>
#include <cmath>

@interface MoonshineSpeech : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation MoonshineSpeech {
  dispatch_queue_t _queue;
  int32_t _transcriber;
  int32_t _stream;
  double _audioTime;
  double _lastUpdate;
  double _lastDecode;
}

RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("com.lmnop.moonshine", DISPATCH_QUEUE_SERIAL);
    _transcriber = -1;
    _stream = -1;
  }
  return self;
}
- (dispatch_queue_t)methodQueue { return _queue; }

- (BOOL)check:(int32_t)code reject:(RCTPromiseRejectBlock)reject {
  if (code == 0) return YES;
  const char *message = moonshine_error_to_string(code);
  reject(@"moonshine", message ? @(message) : @"Speech recognition failed.", nil);
  return NO;
}

- (void)freeStream {
  if (_stream >= 0 && _transcriber >= 0) {
    moonshine_free_stream(_transcriber, _stream);
    _stream = -1;
  }
}

- (NSDictionary *)snapshot:(BOOL)final reject:(RCTPromiseRejectBlock)reject {
  transcript_t *transcript = nullptr;
  CFAbsoluteTime before = CFAbsoluteTimeGetCurrent();
  int32_t code = moonshine_transcribe_stream(_transcriber, _stream, 0, &transcript);
  _lastDecode = CFAbsoluteTimeGetCurrent() - before;
  if (![self check:code reject:reject]) return nil;
  NSMutableArray *confirmed = [NSMutableArray array];
  NSMutableArray *provisional = [NSMutableArray array];
  BOOL pending = NO;
  if (transcript) {
    for (uint64_t i = 0; i < transcript->line_count; ++i) {
      const transcript_line_t &line = transcript->lines[i];
      if (!final && !line.is_complete) pending = YES;
      NSString *text = line.text ? [NSString stringWithUTF8String:line.text] : @"";
      text = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
      if (text.length) [(pending ? provisional : confirmed) addObject:text];
    }
  }
  return @{@"confirmed": [confirmed componentsJoinedByString:@" "],
           @"provisional": [provisional componentsJoinedByString:@" "]};
}

RCT_EXPORT_METHOD(prepare:(NSArray<NSString *> *)keyterms
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_transcriber >= 0) { resolve(nil); return; }
  NSString *folder = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:
                     @"models/moonshine-medium-streaming-en-26-08-21"];
  for (NSString *name in @[@"adapter.ort", @"cross_kv.ort", @"decoder_kv.ort", @"encoder.ort",
                           @"frontend.model.ort", @"frontend.weights.ort", @"streaming_config.json", @"tokenizer.bin"]) {
    if (![NSFileManager.defaultManager fileExistsAtPath:[folder stringByAppendingPathComponent:name]]) {
      reject(@"model-missing", [@"Missing Moonshine model file: " stringByAppendingString:name], nil);
      return;
    }
  }
  _transcriber = moonshine_load_transcriber_from_files(folder.UTF8String,
      MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING, nullptr, 0, MOONSHINE_HEADER_VERSION);
  if (_transcriber < 0) { [self check:_transcriber reject:reject]; return; }
  int32_t code = moonshine_transcriber_set_keyterms(_transcriber,
      [keyterms componentsJoinedByString:@","].UTF8String);
  if (![self check:code reject:reject]) {
    moonshine_free_transcriber(_transcriber); _transcriber = -1; return;
  }
  NSLog(@"LMNOP Moonshine Medium ready (offline, runtime %d)", moonshine_get_version());
  resolve(nil);
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_transcriber < 0 || _stream >= 0) {
    reject(@"state", @"Recognizer is not ready or a recording is already active.", nil); return;
  }
  _stream = moonshine_create_stream(_transcriber, 0);
  if (_stream < 0) { [self check:_stream reject:reject]; return; }
  if (![self check:moonshine_start_stream(_transcriber, _stream) reject:reject]) {
    [self freeStream]; return;
  }
  _audioTime = _lastUpdate = _lastDecode = 0;
#if DEBUG
  NSLog(@"LMNOP Moonshine recording started");
#endif
  resolve(nil);
}

RCT_EXPORT_METHOD(process:(NSArray<NSNumber *> *)samples sampleRate:(double)rate
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_stream < 0 || !std::isfinite(rate) || rate < 8000 || rate > 192000) {
    reject(@"state", @"No active recording or invalid sample rate.", nil); return;
  }
  std::vector<float> pcm;
  pcm.reserve(samples.count);
  for (NSNumber *sample in samples) pcm.push_back(sample.floatValue);
  if (![self check:moonshine_transcribe_add_audio_to_stream(_transcriber, _stream,
          pcm.data(), pcm.size(), (int32_t)rate, 0) reject:reject]) return;
  _audioTime += pcm.size() / rate;
  double interval = fmin(fmax(0.5, _lastDecode), 2.0);
  if (_audioTime - _lastUpdate < interval) { resolve(nil); return; }
  NSDictionary *result = [self snapshot:NO reject:reject];
  _lastUpdate = _audioTime;
  if (result) resolve(result);
}

RCT_EXPORT_METHOD(finish:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_stream < 0) { reject(@"state", @"No active recording.", nil); return; }
  if (![self check:moonshine_stop_stream(_transcriber, _stream) reject:reject]) {
    [self freeStream]; return;
  }
  NSDictionary *result = [self snapshot:YES reject:reject];
#if DEBUG
  NSLog(@"LMNOP Moonshine recording finished (%.2f seconds of PCM)", _audioTime);
#endif
  [self freeStream];
  if (result) resolve(result);
}

RCT_EXPORT_METHOD(dispose:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self freeStream];
  // Keep the live model resident; invalidate owns final model cleanup.
  resolve(nil);
}

- (void)invalidate {
  dispatch_async(_queue, ^{
    [self freeStream];
    if (self->_transcriber >= 0) {
      moonshine_free_transcriber(self->_transcriber); self->_transcriber = -1;
    }
  });
}
@end
