#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface CsvFile : NSObject <RCTBridgeModule>
@end

@implementation CsvFile

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(writeQuestionnaireAnswers:(NSString *)csvContent
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *fileURL = [self questionnaireFileURL];
  NSError *error = nil;

  BOOL didWrite = [csvContent writeToURL:fileURL
                              atomically:YES
                                encoding:NSUTF8StringEncoding
                                   error:&error];

  if (!didWrite) {
    reject(@"csv_write_failed", @"Could not write questionnaire CSV.", error);
    return;
  }

  resolve(fileURL.path);
}

RCT_EXPORT_METHOD(readQuestionnaireAnswers:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *fileURL = [self questionnaireFileURL];

  if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
    resolve([NSNull null]);
    return;
  }

  NSError *error = nil;
  NSString *csvContent = [NSString stringWithContentsOfURL:fileURL
                                                  encoding:NSUTF8StringEncoding
                                                     error:&error];

  if (csvContent == nil) {
    reject(@"csv_read_failed", @"Could not read questionnaire CSV.", error);
    return;
  }

  resolve(csvContent);
}

RCT_EXPORT_METHOD(getQuestionnaireAnswersPath:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *fileURL = [self questionnaireFileURL];

  if (![[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
    resolve([NSNull null]);
    return;
  }

  resolve(fileURL.path);
}

- (NSURL *)questionnaireFileURL
{
  NSURL *documentsURL = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory
                                                                inDomains:NSUserDomainMask] firstObject];

  return [documentsURL URLByAppendingPathComponent:@"questionnaire-answers.csv"];
}

@end
