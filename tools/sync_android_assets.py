"""Prepare the offline Android bundle; keep approved photo/audio masters untouched."""

import argparse
import copy
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
ASSETS = ROOT / "android-app/app/src/main/assets"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(output=ASSETS):
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT) or output == ROOT:
        raise ValueError("Build output must be a subdirectory of this project")
    source = json.loads((CONTENT / "vocabulary.json").read_text(encoding="utf-8"))
    data = copy.deepcopy(source)
    cache = ROOT / ".release-build/photos-webp-q90-v1"
    cache.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")

    def photo(word):
        original = (CONTENT / word["imageAsset"]).resolve()
        if not original.is_relative_to(CONTENT) or not original.is_file():
            raise ValueError(f"Missing/invalid photo for {word['id']}")
        if original.suffix == ".webp":
            return word["id"], original
        encoded = cache / (digest(original) + ".webp")
        if not encoded.is_file():
            if not ffmpeg:
                raise RuntimeError("FFmpeg is required to encode PNG photo masters")
            temporary = encoded.with_suffix(".tmp.webp")
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                            "-i", str(original), "-c:v", "libwebp", "-quality", "90",
                            "-compression_level", "6", "-frames:v", "1", str(temporary)],
                           check=True, capture_output=True)
            temporary.replace(encoded)
        return word["id"], encoded

    with ThreadPoolExecutor(max_workers=4) as pool:
        photos = dict(pool.map(photo, data["words"]))
    wanted = set()
    # Export runtime fields only; owner review paths and source metadata stay local.
    fields = ("id", "categoryId", "hebrew", "english", "pronunciation", "imageAsset",
              "audioAsset", "audioStatus", "audioSha256")
    runtime_words = []
    for word in data["words"]:
        if word.get("audioStatus") != "user_verified":
            raise ValueError(f"Unapproved audio: {word['id']}")
        clip = (CONTENT / word["audioAsset"]).resolve()
        if not clip.is_relative_to(CONTENT) or digest(clip) != word["audioSha256"]:
            raise ValueError(f"Audio approval checksum mismatch: {word['id']}")
        runtime = {key: word[key] for key in fields}
        runtime["imageAsset"] = f"assets/photos/{word['id']}.webp"
        runtime_words.append(runtime)
        for relative, source_file in ((runtime["imageAsset"], photos[word["id"]]),
                                      (runtime["audioAsset"], clip)):
            target = output / "content" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, target)
            wanted.add(target.resolve())
    data["words"] = runtime_words
    canonical = {key: value for key, value in data.items() if key != "contentVersion"}
    hashes = {str(path.relative_to(output)).replace("\\", "/"): digest(path)
              for path in sorted(wanted)}
    fingerprint = hashlib.sha256(json.dumps([canonical, hashes], ensure_ascii=False,
                                          sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    data["contentVersion"] = "content-" + fingerprint[:32]
    if os.environ.get("CONTENT_VERSION") and os.environ["CONTENT_VERSION"] != data["contentVersion"]:
        raise ValueError("CONTENT_VERSION must match the runtime content fingerprint")
    vocabulary = output / "content/vocabulary.json"
    vocabulary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    target_index = output / "prototype/index.html"
    target_index.parent.mkdir(parents=True, exist_ok=True)
    html = (ROOT / "prototype/index.html").read_text(encoding="utf-8")
    seed = json.dumps({"categories": data["categories"], "words": data["words"]},
                      ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    html, replaced = re.subn(r'(<script id="seed" type="application/json">).*?(</script>)',
                            lambda match: match[1] + seed + match[2], html, flags=re.S)
    if replaced != 1:
        raise ValueError("Runtime vocabulary placeholder missing")
    target_index.write_text(html, encoding="utf-8")
    # Remove obsolete generated files only; source masters are outside these directories.
    for folder in (output / "content/assets/photos", output / "content/assets/audio"):
        for path in folder.iterdir():
            if path.is_file() and path.resolve() not in wanted:
                path.unlink()
    total = sum(path.stat().st_size for path in wanted)
    print(f"Prepared {len(runtime_words)} approved words, {total / 1024**2:.1f} MiB media, {data['contentVersion']}")
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ASSETS)
    prepare(parser.parse_args().output)
