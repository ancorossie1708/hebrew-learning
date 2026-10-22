"""Run Android acceptance tests only on an explicitly selected desktop emulator."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5580")
    args = parser.parse_args()
    if not re.fullmatch(r"emulator-\d{4,5}", args.serial):
        raise SystemExit("Physical devices are not allowed by this test runner")
    env = dict(os.environ)
    env.pop("ANDROID_SERIAL", None)
    local = ROOT / ".android-toolchain"
    env.update(JAVA_HOME=str(next(local.glob("jdk-17*"))),
               ANDROID_HOME=str(local / "android-sdk"),
               ANDROID_USER_HOME=str(local / "android-user"),
               GRADLE_USER_HOME=str(local / "gradle-cache"))
    adb = str(local / "android-sdk/platform-tools/adb.exe")

    def device(*command, timeout=30, binary=False):
        return subprocess.check_output([adb, "-s", args.serial, *command],
                                       env=env, timeout=timeout, text=not binary)

    deadline = time.monotonic() + 180
    while True:
        try:
            if device("shell", "getprop", "sys.boot_completed").strip() == "1":
                break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass
        if time.monotonic() > deadline:
            raise SystemExit("Project emulator did not boot; no physical device was used")
        time.sleep(2)
    if device("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise SystemExit("Target is not a verified emulator")
    print("Confirmed Android emulator " + args.serial, flush=True)
    gradle = str(local / "gradle-8.11.1/bin/gradle.bat")
    subprocess.run([gradle, "-p", str(ROOT / "android-app"), "--no-daemon",
                    "assembleDebug", "assembleDebugAndroidTest", "lintDebug"], env=env, check=True)
    device("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    device("shell", "wm", "dismiss-keyguard")
    device("shell", "wm", "density", "160")
    apks = ROOT / "android-app/app/build/outputs/apk"
    print(device("install", "-r", str(apks / "debug/app-debug.apk"), timeout=90), flush=True)
    print(device("install", "-r", str(apks / "androidTest/debug/app-debug-androidTest.apk"), timeout=90), flush=True)
    result = device("shell", "am", "instrument", "-w", "-r",
                    "org.hebrewlearning.app.debug.test/androidx.test.runner.AndroidJUnitRunner", timeout=240)
    reports = ROOT / "release-artifacts"
    reports.mkdir(exist_ok=True)
    (reports / "emulator-acceptance.txt").write_text(result, encoding="utf-8")
    print(result, flush=True)
    if not re.search(r"OK \(\d+ tests?\)", result) or "FAILURES" in result:
        raise SystemExit("Android emulator acceptance test failed")
    device("pull", "/sdcard/Android/data/org.hebrewlearning.app.debug/files/acceptance/tablet-topics.png", str(reports / "android14-tablet-topics.png"))
    device("pull", "/sdcard/Android/data/org.hebrewlearning.app.debug/files/acceptance/tablet-lesson.png", str(reports / "android14-tablet-lesson.png"))
    device("shell", "wm", "density", "420")
    print(device("install", "-r", str(reports / "hebrew-learning.apk"), timeout=90), flush=True)
    print(device("shell", "am", "start", "-W", "-n", "org.hebrewlearning.app/.MainActivity"),flush=True)
    time.sleep(3)
    resumed = device("shell", "dumpsys", "activity", "activities")
    if not any("org.hebrewlearning.app/.MainActivity" in line and
               ("mResumedActivity" in line or "topResumedActivity" in line) for line in resumed.splitlines()):
        raise SystemExit("Signed release APK did not remain in the foreground")
    (reports / "android14-release-home.png").write_bytes(device("exec-out", "screencap", "-p", binary=True))
    print("Signed release APK opened on Android 14; screenshot saved. No physical phone used.")


if __name__ == "__main__":
    main()
