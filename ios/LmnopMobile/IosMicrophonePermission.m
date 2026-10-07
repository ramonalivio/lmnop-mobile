#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface IosMicrophonePermission : NSObject <RCTBridgeModule>
@end

@implementation IosMicrophonePermission

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(request:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSessionRecordPermission permission =
      [AVAudioSession sharedInstance].recordPermission;

  if (permission == AVAudioSessionRecordPermissionGranted) {
    resolve(@YES);
    return;
  }

  if (permission == AVAudioSessionRecordPermissionDenied) {
    resolve(@NO);
    return;
  }

  [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
    resolve(@(granted));
  }];
}

@end
