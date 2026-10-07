#include <jni.h>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>
#include "parakeet_capi.h"
#include "ggml_graph.hpp"

static void fail(JNIEnv *env, const char *message) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_ramon_lmnop_OmiMedSpeechModule_nativeLoad(JNIEnv *env, jobject, jstring model) {
    const char *path = env->GetStringUTFChars(model, nullptr);
    if (!path) return 0;
    parakeet_capi_set_num_threads(4);
    auto *ctx = parakeet_capi_load(path);
    env->ReleaseStringUTFChars(model, path);
    if (!ctx) {
        pk::shutdown_backend();
        fail(env, "Could not load Omi Med STT v1 Q8 GGUF.");
    }
    return reinterpret_cast<jlong>(ctx);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_ramon_lmnop_OmiMedSpeechModule_nativeTranscribe(JNIEnv *env, jobject, jlong raw, jbyteArray pcm) {
    const jsize size = env->GetArrayLength(pcm);
    if (!raw || (size & 1) || size <= 0 || size > 16000 * 2 * 26) {
        fail(env, "Invalid Omi session or PCM16 audio window.");
        return nullptr;
    }
    try {
        std::vector<jbyte> bytes(static_cast<size_t>(size));
        env->GetByteArrayRegion(pcm, 0, size, bytes.data());
        if (env->ExceptionCheck()) return nullptr;
        std::vector<float> samples(static_cast<size_t>(size / 2));
        for (size_t i = 0; i < samples.size(); ++i) {
            const uint16_t u = static_cast<uint8_t>(bytes[2*i]) |
                (static_cast<uint16_t>(static_cast<uint8_t>(bytes[2*i+1])) << 8);
            samples[i] = static_cast<int16_t>(u) / 32768.0f;
        }
        auto *ctx = reinterpret_cast<parakeet_ctx *>(raw);
        std::unique_ptr<char, decltype(&parakeet_capi_free_string)> text(
            parakeet_capi_transcribe_pcm(ctx, samples.data(), static_cast<int>(samples.size()), 16000, 2),
            &parakeet_capi_free_string);
        if (!text) { fail(env, parakeet_capi_last_error(ctx)); return nullptr; }
        const auto length = static_cast<jsize>(std::strlen(text.get()));
        jbyteArray encoded = env->NewByteArray(length);
        if (!encoded) return nullptr;
        env->SetByteArrayRegion(encoded, 0, length, reinterpret_cast<const jbyte *>(text.get()));
        if (env->ExceptionCheck()) return nullptr;
        jclass cls = env->FindClass("java/lang/String");
        jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
        return static_cast<jstring>(env->NewObject(cls, ctor, encoded, env->NewStringUTF("UTF-8")));
    } catch (const std::exception &error) {
        fail(env, error.what());
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_ramon_lmnop_OmiMedSpeechModule_nativeFree(JNIEnv *, jobject, jlong raw) {
    parakeet_capi_free(reinterpret_cast<parakeet_ctx *>(raw));
    // Called after the sole session is removed on the serialized Kotlin queue.
    // Free the persistent graph allocation too, not just the model weights.
    pk::shutdown_backend();
}
