# Hebrew Learning Android project

This is the first installable-app source project. It bundles the offline study
and picture-to-Hebrew quiz screens from `prototype/index.html`. Run
`python tools/build_prototype.py` and `python tools/sync_android_assets.py`
from the workspace root after changing the vocabulary or screens.

The active vocabulary is `content/vocabulary.json`: 120 words, twelve topics with ten entries each.
The original approved 30-word snapshot remains in `content/seed-30.json`.

All 120 audio clips are user-verified and bundled without re-encoding. Build
copies of the photo masters use WebP to reduce the installation download.
The native shell supports checked GitHub content/app updates and a permanent
release signing identity. Public download/update access still depends on the
owner's distribution decision; a private repository needs authentication design.
Offline speech recognition and pronunciation scoring remain unimplemented.

The app compiles with JDK 17, Gradle 8.11.1 and Android SDK 35. A separate `.debug`
package is used for tests so it cannot overwrite the permanently signed app.
See the root README for build, signing and GitHub release instructions.

## Manual screen layouts

The settings menu defaults to Phone (locked portrait). The KTC 24.5-inch option targets a 1920×1080, 16:9 Android 14 display, using larger touch controls, a wider topic grid and side-by-side lesson/quiz content. The native interface accepts only `phone` or `ktc-24` and locks the selected orientation; it does not use sensor rotation. Configuration changes preserve the active WebView. Browser previews switch page layout; physical display orientation is handled by Android. The target display still needs physical-device verification.
