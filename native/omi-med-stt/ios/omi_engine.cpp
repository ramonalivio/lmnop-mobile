#include "omi_engine.h"
#include "parakeet_capi.h"
#include "ggml_graph.hpp"
extern "C" void *lmnop_omi_load(const char *path) {
    parakeet_capi_set_num_threads(4);
    auto *ctx = parakeet_capi_load(path);
    if (!ctx) pk::shutdown_backend();
    return ctx;
}
extern "C" char *lmnop_omi_transcribe(void *ctx, const float *samples, size_t count) {
    if (!ctx || !samples || !count || count > 16000 * 26) return nullptr;
    return parakeet_capi_transcribe_pcm(static_cast<parakeet_ctx *>(ctx), samples,
                                      static_cast<int>(count), 16000, 2);
}
extern "C" const char *lmnop_omi_error(void *ctx) {
    return parakeet_capi_last_error(static_cast<parakeet_ctx *>(ctx));
}
extern "C" void lmnop_omi_free_text(char *text) { parakeet_capi_free_string(text); }
extern "C" void lmnop_omi_release(void *ctx) {
    parakeet_capi_free(static_cast<parakeet_ctx *>(ctx));
    pk::shutdown_backend();
}
