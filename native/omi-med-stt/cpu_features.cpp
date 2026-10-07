#include <jni.h>
#include <sys/auxv.h>
#include <asm/hwcap.h>

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ramon_lmnop_OmiMedCpu_optimizedSupported(JNIEnv *, jobject) {
    const auto features = getauxval(AT_HWCAP);
    // Match armv8.2-a+dotprod's FP16 and dot-product requirements.
    const unsigned long required = HWCAP_ASIMDDP | HWCAP_ASIMDHP | HWCAP_FPHP |
        HWCAP_ATOMICS | HWCAP_ASIMDRDM;
    return (features & required) == required;
}
