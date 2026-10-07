#import <AuthenticationServices/AuthenticationServices.h>
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

@interface IosAuthSession : NSObject <RCTBridgeModule, ASWebAuthenticationPresentationContextProviding>
@property (nonatomic, strong) ASWebAuthenticationSession *session;
@end

@implementation IosAuthSession

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(openAuthUrl:(NSString *)authUrl
                  callbackScheme:(NSString *)callbackScheme
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSURL *url = [NSURL URLWithString:authUrl];

    if (url == nil) {
      NSLog(@"LMNOP_AUTH_NATIVE invalid_auth_url");
      reject(@"invalid_auth_url", @"The authentication URL is invalid.", nil);
      return;
    }

    NSLog(@"LMNOP_AUTH_NATIVE open_auth_url scheme=%@", callbackScheme);

    self.session = [[ASWebAuthenticationSession alloc] initWithURL:url
                                                 callbackURLScheme:callbackScheme
                                                 completionHandler:^(NSURL * _Nullable callbackURL, NSError * _Nullable error) {
      self.session = nil;

      if (callbackURL != nil) {
        NSLog(@"LMNOP_AUTH_NATIVE callback_received length=%lu scheme=%@ host=%@ path=%@",
              (unsigned long)callbackURL.absoluteString.length,
              callbackURL.scheme,
              callbackURL.host,
              callbackURL.path);
        resolve(callbackURL.absoluteString);
        return;
      }

      if (error != nil) {
        NSLog(@"LMNOP_AUTH_NATIVE callback_error domain=%@ code=%ld",
              error.domain,
              (long)error.code);

        if ([error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
            error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin) {
          reject(@"auth_session_cancelled", @"The authentication session was cancelled.", error);
          return;
        }

        reject(@"auth_session_failed", @"The authentication session did not complete.", error);
        return;
      }

      NSLog(@"LMNOP_AUTH_NATIVE callback_missing");
      reject(@"auth_session_failed", @"The authentication session did not complete.", nil);
    }];

    self.session.presentationContextProvider = self;
    self.session.prefersEphemeralWebBrowserSession = NO;

    if (![self.session start]) {
      NSLog(@"LMNOP_AUTH_NATIVE start_failed");
      self.session = nil;
      reject(@"auth_session_start_failed", @"Could not start the authentication session.", nil);
    }
  });
}

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }

    UIWindowScene *windowScene = (UIWindowScene *)scene;

    for (UIWindow *window in windowScene.windows) {
      if (window.isKeyWindow) {
        return window;
      }
    }
  }

  return UIApplication.sharedApplication.windows.firstObject;
}

@end
