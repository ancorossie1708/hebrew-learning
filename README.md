# Hebrew Learning

Offline Android vocabulary practice: 140 words in 14 topics, Hebrew spelling,
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
- A feed for an older app release cannot replace a newer installed catalog,
  including the interval before the new release is marked latest on GitHub.
- The direct GitHub update feed requires readable release assets. A private
  repository requires additional authentication/distribution design before it can
  support automatic updates for end users. No account token is embedded in the APK.
- Automatic pronunciation recognition/feedback is not implemented in this version.

## Keeping learner progress during updates

Learner records use permanent word IDs and the existing device-local storage keys.
Adding words/topics must retain every published word ID. Updates never run a reset;
the historical one-off star reset has been removed. Only explicit Reset actions
clear progress. Records for temporarily unavailable word IDs remain stored and
reappear when those words return. Visible totals count the current vocabulary and
stay synchronized with topic stars.

The main reward targets are halfway (rounded up to a multiple of ten), ten stars
before completion, and completion. A 160-word catalog therefore uses 80, 150 and
160 stars, while a 140-word release uses 70, 130 and 140. Standard milestones
continue every ten stars. Opening an expanded
catalog does not replay celebrations. The upgrade regression uses synthetic
released-version learner data; it does not access real learner records.

Android upgrades must retain the application ID, WebView origin/entry path and
permanent signing certificate; regression checks protect these values and every
published word ID. Install updates over the existing app; uninstalling or clearing
its data removes device-local progress.

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
## Four new topics — owner review complete, 26 November 2026

Release selection: only Everyday sentences 1 and Israeli politics are added now,
for 140 items in fourteen topics. Swear words and Everyday sentences 2 are marked
`releaseEnabled: false` in the authoring categories. Their approved entries,
photos and recordings remain in the 160-item authoring database for a later
release, but are excluded from browser previews, APK media, the update feed and
the public source package. Stored IDs for deferred words are retained on devices.

Latest status, 26 November: 33 owner-recorded replacements are imported and
normalized; the plain filenames were selected regardless of timestamp or review
verdict. Nine byte-identical numbered downloads were moved out of the active
source directory. With seven explicit synthetic-voice approvals, all 160
items are approved. The final three replacements (“לך לעזאזל”,
“בן זונה” and “ביבי נתניהו”) are included. See
`content/review_submissions/2026-11-26-human-import-verification.json` and
`content/audio_sources/deduplication-2026-11-26.json`. The signed Android 0.6.0
update is prepared locally; distribution status is recorded in `release-artifacts/`.

The local authoring vocabulary contains 160 items: the original 120 approved
entries, unchanged, plus ten each in Swear words, Everyday sentences 1,
Everyday sentences 2, and Israeli politics. The owner approved these lists in
chat, including “לך תזדיין” and “אני לא מבינה. תסביר לי שוב.”

All forty new Hebrew audio candidates were generated with the installed Asaf
voice and normalized to the existing -25 LUFS target. The owner subsequently
approved seven and supplied thirty-three human replacements; none remain pending.
Open `content/audio-review.html` to approve them or record replacements; the
sheet shows the completed review and preserves direct folder saving.
The 30 scene photos were generated individually. The ten politician portraits
are actual Wikimedia Commons photos, with original-file hashes, author and
license details in `content/four-topics-photo-sources.json`. Photo credits are
also available in the learner settings. Political grouping is dated 2026-11-25.

Definitions and image prompts: `content/additions-40-sentences-politics.json` and
`content/four-topics-generated-photo-sources.json`. Untouched audio originals and
normalization measurements are archived under `content/audio_sources/`.

This is a completed expansion, prepared for Android distribution. The Android
bundle/release builder rejects unapproved or changed recordings before writing
bundle files. For the selected 140 words, the special reward targets are 70, 130 and 140;
all previously saved word IDs, stars and settings retain their existing keys.

