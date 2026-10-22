"""Build the offline, file-openable mobile screen prototype from the seed data."""

import json
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "content" / "vocabulary.json"
template = ROOT / "prototype" / "app.template.html"
output = ROOT / "prototype" / "index.html"

data = json.loads(source.read_text(encoding="utf-8"))
for word in data["words"]:
    if word.get("audioAsset"):
        word["audioSha256"] = hashlib.sha256((source.parent / word["audioAsset"]).read_bytes()).hexdigest()
assert len(data["words"]) == len(data["categories"]) * 10
assert all(sum(w["categoryId"] == c["id"] for w in data["words"]) == 10 for c in data["categories"])
payload = json.dumps(
    {"categories": data["categories"], "words": data["words"]},
    ensure_ascii=False,
    separators=(",", ":"),
).replace("<", "\\u003c")
feedback = (ROOT / "prototype" / "quiz-feedback.js").read_text(encoding="utf-8")
milestones = (ROOT / "prototype" / "milestones.js").read_text(encoding="utf-8")
preferences = (ROOT / "prototype" / "preferences.js").read_text(encoding="utf-8")
updates = (ROOT / "prototype" / "native-updates.js").read_text(encoding="utf-8")
html = template.read_text(encoding="utf-8").replace("__SEED_DATA__", payload).replace("__QUIZ_FEEDBACK__", feedback).replace("__MILESTONES__", milestones).replace("__PREFERENCES__", preferences).replace("__NATIVE_UPDATES__", updates)
assert html != template.read_text(encoding="utf-8")
output.write_text(html, encoding="utf-8")
print(f"Built {output} with {len(data['words'])} words in {len(data['categories'])} categories")
