"""Build a source-only release and check it against locally configured secrets."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "release"
ROOT_FILES = (
    ".env.example", ".gitignore", ".prettierignore", ".prettierrc.json",
    "README.md", "JUDGES.md", "LICENSE", "index.html", "package.json",
    "package-lock.json", "playwright.config.mjs", "tsconfig.json", "vite.config.mjs",
)
DIRECTORIES = ("contracts", "sdk", "server", "src", "scripts", "tests", "public", "docs", "deployments")


def source_files():
    files = {ROOT / name for name in ROOT_FILES if (ROOT / name).is_file()}
    for directory in DIRECTORIES:
        for file in (ROOT / directory).rglob("*"):
            if not file.is_file():
                continue
            relative = file.relative_to(ROOT)
            if any(part in {"__pycache__", "node_modules", ".data", "demo-video"} for part in relative.parts):
                continue
            if file.suffix.lower() in {".pyc", ".webm", ".mp4", ".log"}:
                continue
            files.add(file)
    return sorted(files, key=lambda file: file.relative_to(ROOT).as_posix())


def local_secrets():
    secrets = set()
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            name, value = line.split("=", 1)
            if name.strip().endswith(("_KEY", "_TOKEN", "_SECRET")):
                value = value.strip().strip("\"'")
                if len(value) >= 12:
                    secrets.add(value.encode())
    for name in ("keys.json", "app-key-research.json", "app-key-writer.json", "public-access.json"):
        file = ROOT / ".data" / name
        if file.exists():
            values = json.loads(file.read_text(encoding="utf-8-sig"))
            for key, value in values.items():
                if isinstance(value, str) and (name != "public-access.json" or key in {"accessCode", "gatewaySecret"}):
                    if len(value) >= 12:
                        secrets.add(value.encode())
    master = ROOT / ".data" / "master.key"
    if master.exists():
        secrets.add(master.read_bytes())
    return {secret for secret in secrets if len(secret) >= 12}


def main():
    files = source_files()
    secrets = local_secrets()
    entries = []
    for file in files:
        data = file.read_bytes()
        if any(secret in data for secret in secrets):
            raise SystemExit(f"Release blocked: configured credential found in {file.relative_to(ROOT)}")
        entries.append({"path": file.relative_to(ROOT).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    OUTPUT.mkdir(exist_ok=True)
    archive = OUTPUT / "AgentPassport-source.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for file in files:
            bundle.write(file, "AgentPassport/" + file.relative_to(ROOT).as_posix())
    manifest = {
        "archive": archive.name,
        "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "fileCount": len(entries),
        "configuredCredentialCheckPassed": True,
        "files": entries,
    }
    (OUTPUT / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUTPUT / "git-paths.txt").write_text("\n".join(entry["path"] for entry in entries) + "\n", encoding="utf-8")
    print(json.dumps({"archive": str(archive), "fileCount": len(entries), "bytes": archive.stat().st_size, "configuredCredentialCheckPassed": True}))


if __name__ == "__main__":
    main()
