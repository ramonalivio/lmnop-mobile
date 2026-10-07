#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>

@interface AppInfo : NSObject <RCTBridgeModule>
@end

@implementation AppInfo

RCT_EXPORT_MODULE();

- (NSDictionary *)constantsToExport
{
  NSString *directMode = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"LMNOP_DIRECT_DEVICE_BUILD"] ?: @"";
  return @{ @"directDeviceBuild": @([directMode boolValue]) };
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(getVersion:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *infoDictionary = [[NSBundle mainBundle] infoDictionary];
  NSString *versionName = infoDictionary[@"CFBundleShortVersionString"] ?: @"";
  NSString *versionCode = infoDictionary[@"CFBundleVersion"] ?: @"";

  resolve(@{
    @"versionName": versionName,
    @"versionCode": versionCode,
  });
}

// Hash large offline models with bounded memory, off the UI thread.
RCT_EXPORT_METHOD(hashFile:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSInputStream *stream = [NSInputStream inputStreamWithFileAtPath:path];
    if (!stream) {
      reject(@"MODEL_READ", @"Cannot open downloaded model.", nil);
      return;
    }
    [stream open];
    CC_SHA256_CTX context;
    CC_SHA256_Init(&context);
    uint8_t buffer[65536];
    NSInteger length;
    while ((length = [stream read:buffer maxLength:sizeof(buffer)]) > 0) {
      CC_SHA256_Update(&context, buffer, (CC_LONG)length);
    }
    NSError *error = stream.streamError;
    [stream close];
    if (length < 0 || error) {
      reject(@"MODEL_READ", @"Cannot verify downloaded model.", error);
      return;
    }
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256_Final(digest, &context);
    NSMutableString *hex = [NSMutableString stringWithCapacity:64];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
      [hex appendFormat:@"%02x", digest[i]];
    }
    resolve(hex);
  });
}

@end
