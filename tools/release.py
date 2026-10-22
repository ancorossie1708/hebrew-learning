"""Permanent signing, APK verification and matching GitHub release metadata."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "release-artifacts"
REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "ancorossie1708/hebrew-learning")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def versions():
    run = int(os.environ.get("GITHUB_RUN_NUMBER", "1"))
    attempt = int(os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    version = os.environ.get("REQUESTED_VERSION") or f"0.5.{run}"
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid app version")
    code = run * 100 + attempt
    if not 1 <= code <= 2147483647:
        raise ValueError("Invalid Android version code")
    return version, code, f"v{version}-build.{code}"


def configure():
    version, code, tag = versions()
    env = {"APP_VERSION": version, "APP_VERSION_CODE": str(code),
           "HEBREW_LEARNING_MANIFEST_URL": f"https://github.com/{REPOSITORY}/releases/latest/download/release-manifest.json"}
    secret = os.environ.get("HEBREW_LEARNING_SIGNING")
    if secret:
        bundle = json.loads(secret)
        destination = Path(os.environ["RUNNER_TEMP"]) / "hebrew-learning-release.p12"
        destination.write_bytes(base64.b64decode(bundle["keystoreBase64"], validate=True))
    else:
        secret_file = ROOT / ".release-private/hebrew-learning-signing.json"
        if not secret_file.is_file():
            raise ValueError("Permanent signing identity unavailable; release must remain unsigned/unpublished")
        bundle = json.loads(secret_file.read_text(encoding="utf-8"))
        destination = ROOT / ".release-private/hebrew-learning-release.p12"
    expected = (ROOT / "android-app/signing-certificate.sha256").read_text().strip()
    if bundle["certificateSha256"] != expected or bundle["storeType"] != "PKCS12":
        raise ValueError("Signing identity differs from the permanent pinned certificate")
    for key in ("password", "keystoreBase64"):
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print("::add-mask::" + bundle[key])
    env.update(ANDROID_KEYSTORE_PATH=str(destination.resolve()), ANDROID_KEYSTORE_TYPE="PKCS12",
               ANDROID_KEYSTORE_PASSWORD=bundle["password"], ANDROID_KEY_ALIAS=bundle["alias"],
               ANDROID_KEY_PASSWORD=bundle["password"])
    for value in env.values():
        if "\n" in value or "\r" in value:
            raise ValueError("Invalid multiline environment value")
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as target:
            for key, value in env.items():
                target.write(f"{key}={value}\n")
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as target:
            target.write(f"version={version}\ntag={tag}\n")
    return dict(os.environ, **env)


def verify(apk):
    sdk = Path(os.environ.get("ANDROID_HOME", ROOT / ".android-toolchain/android-sdk"))
    verifier = sdk / "build-tools/35.0.0" / ("apksigner.bat" if os.name == "nt" else "apksigner")
    result = subprocess.run([str(verifier), "verify", "--verbose", "--print-certs", str(apk)],
                            text=True, capture_output=True)
    if result.returncode:
        raise ValueError("APK signature verification failed: " + result.stderr)
    match = re.search(r"Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})", result.stdout)
    expected = (ROOT / "android-app/signing-certificate.sha256").read_text().strip()
    if not match or match[1].lower() != expected:
        raise ValueError("APK does not use the permanent signing identity")
    with zipfile.ZipFile(apk) as archive:
        vocabulary = json.loads(archive.read("assets/content/vocabulary.json"))
        if len(vocabulary["words"]) != len(vocabulary["categories"]) * 10:
            raise ValueError("Incomplete APK vocabulary")
        for word in vocabulary["words"]:
            for field in ("audioAsset", "imageAsset"):
                data = archive.read("assets/content/" + word[field])
                if not data:
                    raise ValueError("Empty media")
                if field == "audioAsset" and (word["audioStatus"] != "user_verified" or hashlib.sha256(data).hexdigest() != word["audioSha256"]):
                    raise ValueError("APK contains unapproved/modified audio")
    if apk.stat().st_size >= 256 * 1024**2:
        raise ValueError("APK exceeds the verified updater size limit")
    print(f"Verified permanent signature and all {len(vocabulary['words'])} photo/audio pairs; APK {apk.stat().st_size/1024**2:.1f} MiB")


def artifacts():
    version, code, tag = versions()
    ARTIFACTS.mkdir(exist_ok=True)
    apk = ARTIFACTS / "hebrew-learning.apk"
    shutil.copy2(ROOT / "android-app/app/build/outputs/apk/release/app-release.apk", apk)
    verify(apk)
    (ARTIFACTS / "hebrew-learning.apk.sha256").write_text(sha(apk) + "  hebrew-learning.apk\n", encoding="ascii")
    shutil.copy2(ROOT / "android-app/signing-certificate.sha256", ARTIFACTS / "signing-certificate.sha256")
    assets = ROOT / "android-app/app/src/main/assets"
    vocabulary = json.loads((assets / "content/vocabulary.json").read_text(encoding="utf-8"))
    shutil.copy2(assets / "content/vocabulary.json", ARTIFACTS / "vocabulary.json")
    release_base = f"https://github.com/{REPOSITORY}/releases/download/{tag}"
    media = ARTIFACTS / "media"
    media.mkdir(exist_ok=True)
    files = []
    for file in sorted((assets / "content").rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(assets).as_posix()
        if relative == "content/vocabulary.json":
            url = release_base + "/vocabulary.json"
        else:
            # Immutable release attachments keep the feed independent of source checkout paths.
            # Word IDs are globally unique; .wav/.webp names cannot collide.
            url = release_base + "/" + file.name
            shutil.copy2(file, media / file.name)
        files.append(dict(path=relative, url=url, bytes=file.stat().st_size, sha256=sha(file)))
    manifest = {"schemaVersion": 1, "app": {"version": version, "versionCode": code,
                "apkUrl": release_base + "/hebrew-learning.apk", "sha256": sha(apk)}}
    manifest["content"] = dict(version=vocabulary["contentVersion"], minAppVersionCode=code, files=files)
    if len(files) != 1 + 2 * len(vocabulary["words"]):
        raise ValueError("Incomplete release content batch")
    (ARTIFACTS / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Prepared signed release files in release-artifacts")


def build():
    env = configure()
    local_jdk = next((ROOT / ".android-toolchain").glob("jdk-17*"), None)
    if local_jdk:
        env.update(JAVA_HOME=str(local_jdk), ANDROID_HOME=str(ROOT / ".android-toolchain/android-sdk"),
                   ANDROID_USER_HOME=str(ROOT / ".android-toolchain/android-user"),
                   GRADLE_USER_HOME=str(ROOT / ".android-toolchain/gradle-cache"))
    gradle = ROOT / ".android-toolchain/gradle-8.11.1/bin/gradle.bat"
    # A fresh package avoids unused ZIP space left by large incremental photo replacements.
    subprocess.run([str(gradle), "-p", str(ROOT / "android-app"), "--no-daemon", "clean", "assembleRelease", "lintRelease"], env=env, check=True)
    os.environ.update({key:env[key] for key in ("ANDROID_HOME", "JAVA_HOME") if key in env})
    artifacts()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["configure", "build", "artifacts", "verify"])
    args = parser.parse_args()
    if args.command == "configure": configure()
    elif args.command == "build": build()
    elif args.command == "artifacts": artifacts()
    else: verify(ARTIFACTS / "hebrew-learning.apk")
