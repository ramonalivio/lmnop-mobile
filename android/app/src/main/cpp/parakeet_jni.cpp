#include <jni.h>
#include <cstdint>
#include <cstring>
#include <vector>
extern "C" {
void *lmnop_parakeet_open(const char *, char **);
char *lmnop_parakeet_run(void *, const float *, size_t, char **);
void lmnop_parakeet_close(void *);
void lmnop_parakeet_string_free(char *);
}
static void fail(JNIEnv *env, char *error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error ? error : "Parakeet ONNX failed");
    lmnop_parakeet_string_free(error);
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_ramon_lmnop_ParakeetSpeechModule_nativeLoad(JNIEnv *env, jobject, jstring directory) {
    const char *path = env->GetStringUTFChars(directory, nullptr);
    if (!path) return 0;
    char *error = nullptr;
    void *session = lmnop_parakeet_open(path, &error);
    env->ReleaseStringUTFChars(directory, path);
    if (!session) fail(env, error);
    return reinterpret_cast<jlong>(session);
}
extern "C" JNIEXPORT jstring JNICALL
Java_com_ramon_lmnop_ParakeetSpeechModule_nativeBackendName(JNIEnv *env, jobject, jlong) {
    return env->NewStringUTF("CPU");
}
extern "C" JNIEXPORT jstring JNICALL
Java_com_ramon_lmnop_ParakeetSpeechModule_nativeTranscribe(JNIEnv *env, jobject, jlong raw, jbyteArray pcm) {
    const jsize size = env->GetArrayLength(pcm);
    if (!raw || (size & 1) || size <= 0 || size > 16000 * 2 * 26) {
        env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), "Invalid Parakeet session or PCM16 audio window");
        return nullptr;
    }
    std::vector<jbyte> bytes(static_cast<size_t>(size));
    env->GetByteArrayRegion(pcm, 0, size, bytes.data());
    if (env->ExceptionCheck()) return nullptr;
    std::vector<float> samples(static_cast<size_t>(size / 2));
    for (size_t i = 0; i < samples.size(); ++i) {
        const uint16_t u = static_cast<uint8_t>(bytes[2*i]) | (static_cast<uint16_t>(static_cast<uint8_t>(bytes[2*i+1])) << 8);
        samples[i] = static_cast<int16_t>(u) / 32768.0f;
    }
    char *error = nullptr;
    char *json = lmnop_parakeet_run(reinterpret_cast<void *>(raw), samples.data(), samples.size(), &error);
    if (!json) { fail(env, error); return nullptr; }
    const auto length = static_cast<jsize>(std::strlen(json));
    jbyteArray encoded = env->NewByteArray(length);
    if (!encoded) { lmnop_parakeet_string_free(json); return nullptr; }
    env->SetByteArrayRegion(encoded, 0, length, reinterpret_cast<const jbyte *>(json));
    lmnop_parakeet_string_free(json);
    jclass cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
    auto result = static_cast<jstring>(env->NewObject(cls, ctor, encoded, env->NewStringUTF("UTF-8")));
    return result;
}
extern "C" JNIEXPORT void JNICALL
Java_com_ramon_lmnop_ParakeetSpeechModule_nativeFree(JNIEnv *, jobject, jlong raw) {
    lmnop_parakeet_close(reinterpret_cast<void *>(raw));
}
