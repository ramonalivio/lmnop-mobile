#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <mach/mach.h>
#import <sys/resource.h>
#import <sys/utsname.h>
#import <TargetConditionals.h>

@interface SpeechProfiler : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation SpeechProfiler {
  dispatch_queue_t _queue;
  dispatch_source_t _timer;
  NSMutableDictionary<NSString *, NSMutableDictionary *> *_profiles;
  NSString *_latestID;
}
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("com.lmnop.speech-profiler", DISPATCH_QUEUE_SERIAL);
    _profiles = [NSMutableDictionary dictionary];
  }
  return self;
}
- (dispatch_queue_t)methodQueue { return _queue; }

- (NSDictionary *)metrics {
  struct task_vm_info vm = {0};
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  kern_return_t memoryResult = task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&vm, &count);
  struct rusage usage = {0};
  int cpuResult = getrusage(RUSAGE_SELF, &usage);
  double cpu = usage.ru_utime.tv_sec + usage.ru_utime.tv_usec / 1e6 +
               usage.ru_stime.tv_sec + usage.ru_stime.tv_usec / 1e6;
  return @{
    @"uptimeSeconds": @(NSProcessInfo.processInfo.systemUptime),
    @"footprintMiB": memoryResult == KERN_SUCCESS && count >= TASK_VM_INFO_REV1_COUNT ? @(vm.phys_footprint / 1048576.0) : NSNull.null,
    @"residentMiB": memoryResult == KERN_SUCCESS ? @(vm.resident_size / 1048576.0) : NSNull.null,
    @"cpuSeconds": cpuResult == 0 ? @(cpu) : NSNull.null,
    @"thermalState": @(NSProcessInfo.processInfo.thermalState),
    @"memoryStatus": @(memoryResult), @"cpuStatus": @(cpuResult),
  };
}

- (void)updatePeaks:(NSMutableDictionary *)profile metrics:(NSDictionary *)metrics {
  for (NSString *key in @[@"footprintMiB", @"residentMiB"]) {
    id value = metrics[key];
    NSString *peak = [@"peak_" stringByAppendingString:key];
    if ([value isKindOfClass:NSNumber.class] &&
        (!profile[peak] || [value doubleValue] > [profile[peak] doubleValue])) profile[peak] = value;
  }
  if ([metrics[@"memoryStatus"] intValue] != 0 || [metrics[@"cpuStatus"] intValue] != 0)
    profile[@"metricErrorCount"] = @([profile[@"metricErrorCount"] unsignedIntegerValue] + 1);
}

- (void)sample:(NSMutableDictionary *)profile {
  NSDictionary *metrics = [self metrics];
  [self updatePeaks:profile metrics:metrics];
  NSDictionary *previous = profile[@"previous"];
  double elapsed = [metrics[@"uptimeSeconds"] doubleValue] - [previous[@"uptimeSeconds"] doubleValue];
  id percent = NSNull.null;
  // Very short phase-boundary samples are unsuitable for interval CPU percentages.
  if (elapsed >= 0.1 && [previous[@"cpuSeconds"] isKindOfClass:NSNumber.class] &&
      [metrics[@"cpuSeconds"] isKindOfClass:NSNumber.class]) {
    double value = MAX(0, 100 * ([metrics[@"cpuSeconds"] doubleValue] - [previous[@"cpuSeconds"] doubleValue]) / elapsed);
    percent = @(value);
    if (!profile[@"peakCpuPercent"] || value > [profile[@"peakCpuPercent"] doubleValue]) profile[@"peakCpuPercent"] = percent;
  }
  if (!previous || elapsed >= 0.1) profile[@"previous"] = metrics;
  profile[@"last"] = metrics;
  NSMutableDictionary *sample = [metrics mutableCopy];
  sample[@"elapsedMs"] = @(([metrics[@"uptimeSeconds"] doubleValue] - [profile[@"startedUptime"] doubleValue]) * 1000);
  sample[@"phase"] = profile[@"phase"];
  sample[@"cpuPercentOneCore"] = percent;
  sample[@"cpuPercentMachine"] = [percent isKindOfClass:NSNumber.class] ? @([percent doubleValue] / NSProcessInfo.processInfo.processorCount) : NSNull.null;
  NSMutableArray *samples = profile[@"samples"];
  if (samples.count >= 3600) { [samples removeObjectAtIndex:0]; profile[@"droppedSamples"] = @([profile[@"droppedSamples"] unsignedIntegerValue] + 1); }
  [samples addObject:sample];
}

- (NSDictionary *)report:(NSMutableDictionary *)profile ended:(BOOL)ended {
  NSDictionary *first = profile[@"baseline"], *last = profile[@"last"];
  double wall = [last[@"uptimeSeconds"] doubleValue] - [first[@"uptimeSeconds"] doubleValue];
  id cpu = NSNull.null, average = NSNull.null, delta = NSNull.null;
  if ([first[@"cpuSeconds"] isKindOfClass:NSNumber.class] && [last[@"cpuSeconds"] isKindOfClass:NSNumber.class]) {
    cpu = @(MAX(0, [last[@"cpuSeconds"] doubleValue] - [first[@"cpuSeconds"] doubleValue]));
    if (wall > 0) average = @(100 * [cpu doubleValue] / wall);
  }
  if ([first[@"footprintMiB"] isKindOfClass:NSNumber.class] && profile[@"peak_footprintMiB"])
    delta = @([profile[@"peak_footprintMiB"] doubleValue] - [first[@"footprintMiB"] doubleValue]);
  return @{
    @"schemaVersion": @1, @"id": profile[@"id"], @"startedAt": profile[@"startedAt"], @"ended": @(ended),
    @"scope": @"Whole app process; CPU 100% = one core; GPU utilization is not measured. Peaks are sampled.",
    @"metadata": profile[@"metadata"], @"baseline": first,
    @"summary": @{@"elapsedSeconds": @(wall), @"cpuSeconds": cpu, @"averageCpuPercentOneCore": average,
      @"peakCpuPercentOneCore": profile[@"peakCpuPercent"] ?: NSNull.null,
      @"peakFootprintMiB": profile[@"peak_footprintMiB"] ?: NSNull.null,
      @"peakResidentMiB": profile[@"peak_residentMiB"] ?: NSNull.null,
      @"footprintIncreaseToPeakMiB": delta, @"metricErrorCount": profile[@"metricErrorCount"] ?: @0},
    @"droppedSamples": profile[@"droppedSamples"] ?: @0, @"droppedEvents": profile[@"droppedEvents"] ?: @0,
    @"samples": [profile[@"samples"] copy], @"events": [profile[@"events"] copy],
  };
}

- (NSURL *)directory {
  return [[NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"SpeechProfiles" isDirectory:YES];
}
- (NSArray<NSURL *> *)files {
  NSArray *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:[self directory] includingPropertiesForKeys:@[NSURLContentModificationDateKey] options:0 error:nil];
  NSPredicate *json = [NSPredicate predicateWithBlock:^BOOL(NSURL *url, NSDictionary *bindings) { return [url.pathExtension isEqualToString:@"json"]; }];
  return [[files filteredArrayUsingPredicate:json] sortedArrayUsingComparator:^NSComparisonResult(NSURL *a, NSURL *b) {
    NSDate *dateA, *dateB;
    [a getResourceValue:&dateA forKey:NSURLContentModificationDateKey error:nil];
    [b getResourceValue:&dateB forKey:NSURLContentModificationDateKey error:nil];
    return [dateB compare:dateA];
  }];
}
- (NSURL *)save:(NSMutableDictionary *)profile ended:(BOOL)ended error:(NSError **)error {
  NSDictionary *report = [self report:profile ended:ended];
  NSData *data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:error];
  if (!data) return nil;
  if (![NSFileManager.defaultManager createDirectoryAtURL:[self directory] withIntermediateDirectories:YES attributes:nil error:error]) return nil;
  NSURL *url = [[self directory] URLByAppendingPathComponent:[profile[@"id"] stringByAppendingString:@".json"]];
  if (![data writeToURL:url options:NSDataWritingAtomic error:error]) return nil;
  NSArray *files = [self files];
  for (NSUInteger i = 10; i < files.count; i++) [NSFileManager.defaultManager removeItemAtURL:files[i] error:nil];
  NSData *summary = [NSJSONSerialization dataWithJSONObject:report[@"summary"] options:0 error:nil];
  NSLog(@"LMNOP_SPEECH_PROFILE %@ %@", profile[@"id"], [[NSString alloc] initWithData:summary encoding:NSUTF8StringEncoding]);
  return url;
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  struct utsname machine; uname(&machine);
  NSString *identifier = NSUUID.UUID.UUIDString;
  NSDictionary *baseline = [self metrics];
  NSMutableDictionary *profile = [@{
    @"id": identifier, @"startedAt": [NSISO8601DateFormatter.new stringFromDate:NSDate.date],
    @"startedUptime": baseline[@"uptimeSeconds"], @"baseline": baseline, @"previous": baseline, @"last": baseline,
    @"phase": @"model-load", @"samples": [NSMutableArray array], @"events": [NSMutableArray array],
    @"metadata": [@{@"model": @"unspecified", @"runtime": @"unspecified",
      @"machine": @(machine.machine), @"osVersion": NSProcessInfo.processInfo.operatingSystemVersionString,
      @"simulator": @(TARGET_OS_SIMULATOR), @"logicalCpuCount": @(NSProcessInfo.processInfo.processorCount),
      @"physicalMemoryMiB": @(NSProcessInfo.processInfo.physicalMemory / 1048576.0),
      @"appVersion": [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"",
      @"appBuild": [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @""} mutableCopy],
  } mutableCopy];
  _profiles[identifier] = profile; _latestID = identifier;
  [self sample:profile];
  if (!_timer) {
    _timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _queue);
    dispatch_source_set_timer(_timer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
    __weak SpeechProfiler *weakSelf = self;
    dispatch_source_set_event_handler(_timer, ^{
      SpeechProfiler *owner = weakSelf;
      if (!owner) return;
      for (NSMutableDictionary *active in owner->_profiles.allValues) [owner sample:active];
    });
    dispatch_resume(_timer);
  }
  resolve(identifier);
}

RCT_EXPORT_METHOD(mark:(NSString *)identifier phase:(NSString *)phase details:(NSDictionary *)details resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *profile = _profiles[identifier];
  if (!profile) { resolve(nil); return; }
  // Permit only operational metadata: never retain arbitrary input or transcripts.
  NSMutableDictionary *safe = [NSMutableDictionary dictionary];
  for (NSString *key in @[@"model", @"runtime", @"audioSeconds", @"elapsedMs", @"realTimeFactor", @"decodeIndex", @"recordingIndex", @"final", @"success", @"gpu", @"reasonNoGPU"])
    if (details[key]) safe[key] = details[key];
  for (NSString *key in @[@"model", @"runtime"])
    if ([safe[key] isKindOfClass:NSString.class]) profile[@"metadata"][key] = safe[key];
  if (safe[@"gpu"]) profile[@"metadata"][@"gpu"] = safe[@"gpu"];
  if (safe[@"reasonNoGPU"]) profile[@"metadata"][@"reasonNoGPU"] = safe[@"reasonNoGPU"];
  NSDictionary *metrics = [self metrics]; [self updatePeaks:profile metrics:metrics];
  NSMutableArray *events = profile[@"events"];
  if (events.count >= 600) { [events removeObjectAtIndex:0]; profile[@"droppedEvents"] = @([profile[@"droppedEvents"] unsignedIntegerValue] + 1); }
  [events addObject:@{@"phase": phase, @"elapsedMs": @(([metrics[@"uptimeSeconds"] doubleValue] - [profile[@"startedUptime"] doubleValue]) * 1000), @"details": safe, @"metrics": metrics}];
  profile[@"phase"] = phase; _latestID = identifier;
  resolve(nil);
}

RCT_EXPORT_METHOD(checkpoint:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *profile = _profiles[identifier];
  if (!profile) { resolve(nil); return; }
  [self sample:profile]; NSError *error;
  NSURL *url = [self save:profile ended:NO error:&error];
  if (!url) reject(@"profile_write", @"Could not save performance report.", error); else resolve(url.absoluteString);
}
RCT_EXPORT_METHOD(end:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *profile = _profiles[identifier];
  if (!profile) { resolve(nil); return; }
  [self sample:profile]; NSError *error;
  NSURL *url = [self save:profile ended:YES error:&error];
  [_profiles removeObjectForKey:identifier];
  if (!_profiles.count && _timer) { dispatch_source_cancel(_timer); _timer = nil; }
  if (!url) reject(@"profile_write", @"Could not save performance report.", error); else resolve(url.absoluteString);
}
RCT_EXPORT_METHOD(exportLatest:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSMutableDictionary *active = _profiles[_latestID ?: @""]; NSError *error;
  NSURL *url;
  if (active) { [self sample:active]; url = [self save:active ended:NO error:&error]; }
  else url = [self files].firstObject;
  if (!url) reject(@"profile_missing", @"No performance report is available yet.", error); else resolve(url.absoluteString);
}
- (void)invalidate {
  dispatch_async(_queue, ^{
    if (self->_timer) { dispatch_source_cancel(self->_timer); self->_timer = nil; }
    for (NSMutableDictionary *profile in self->_profiles.allValues) [self save:profile ended:YES error:nil];
    [self->_profiles removeAllObjects];
  });
}
@end
