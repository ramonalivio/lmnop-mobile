#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void *lmnop_omi_load(const char *path);
char *lmnop_omi_transcribe(void *ctx, const float *samples, size_t count);
const char *lmnop_omi_error(void *ctx);
void lmnop_omi_free_text(char *text);
void lmnop_omi_release(void *ctx);
#ifdef __cplusplus
}
#endif
