# Hebrew Learning

Offline Android vocabulary practice: 120 words in 12 topics, Hebrew spelling,
English meaning, Latin pronunciation, photographs and approved Hebrew audio.
The interface is in English. Quiz stars, milestones and settings stay on the device.

## Android

- Android 8.0 or later; no account is required for offline lessons.
- Phone portrait is the default. Settings can explicitly select the KTC 24.5-inch,
  1920×1080, Android 14 landscape layout. Orientation does not follow the sensor.
- App updates require Android's installation confirmation. The native updater
  validates APK checksum, package, version and signing identity.
- Data updates are downloaded and verified as complete generations. They activate
  between lessons; an interrupted download leaves existing lessons available.
- The direct GitHub update feed requires readable release assets. A private
  repository requires additional authentication/distribution design before it can
  support automatic updates for end users. No account token is embedded in the APK.
- Automatic pronunciation recognition/feedback is not implemented in this version.

## Build

JDK 17, Gradle 8.11.1, Android SDK 35 / build-tools 35.0.0, Python 3.13 and Node 24.
The source export contains optimized WebP photos; it needs no media encoder.
The owner's workspace keeps PNG masters and encodes build copies using FFmpeg.

```text
python tools/build_prototype.py
python tools/sync_android_assets.py
node tools/test_quiz_rewards.cjs
node tools/test_quiz_feedback.cjs
node tools/test_milestones.cjs
node tools/test_audio_recording.cjs
gradle -p android-app --no-daemon assembleDebug lintDebug
```

`python tools/test_android_emulator.py --serial emulator-5580` exercises the
isolated `.debug` app on the explicitly named desktop emulator. It refuses
physical-device serial numbers. It checks quiz retries, first-try stars,
persistence, settings, manual orientation, reset and Hebrew playback, then opens
the signed release APK. The runner never selects a connected phone automatically.
Target KTC hardware still needs physical verification.

## Permanent signing and GitHub releases

The permanent public certificate fingerprint is in
`android-app/signing-certificate.sha256`. Preserve the matching private key for
all future updates. Do not generate a replacement key for a routine release.

The Actions workflow expects the repository secret `HEBREW_LEARNING_SIGNING`.
The owner keeps this secret in a separate private backup; it is never source code
or a release attachment. The workflow builds, runs lint, verifies the signed APK,
then publishes the APK and matching update manifest together.

Repository visibility controls access to both source and release downloads.
No public deployment has been authorized by merely creating this source package.
