"""Master rebrand codemod: CodeFusion -> CodeFusion / CF. Phase 1 (content) + Phase 2 (renames).

Every filesystem mutation goes through fs_safe(): normalized, no ".." component,
and strictly inside ROOT. See CONTENT_RULES for the mapping table.
"""
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")

EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store", ".turbo", ".cache"}
EXCLUDE_PATH_PARTS = ("cf-old", ".backup_run1", ".backup_run2", ".obsidian_previous")
EXCLUDE_FILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
TEXT_EXT = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts", ".json", ".jsonc",
    ".md", ".mdx", ".yml", ".yaml", ".html", ".htm", ".css", ".scss", ".less",
    ".txt", ".sh", ".ps1", ".bash", ".zsh", ".py", ".toml", ".xml", ".svg",
    ".env", ".npmrc", ".editorconfig", ".gitignore", ".prettierignore", ".dockerignore",
    ".proto", ".sql", ".h", ".hpp", ".c", ".cpp", ".cc", ".ino", ".gradle", ".properties",
}
TEXT_NAMES = {"Dockerfile", "LICENSE", "NOTICE", "CHANGELOG", "Procfile", "Makefile"}
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".bmp", ".woff", ".woff2",
    ".ttf", ".otf", ".eot", ".mp4", ".mp3", ".wav", ".m4a", ".wasm", ".zip", ".gz", ".tgz",
    ".node", ".exe", ".dll", ".bin", ".pak", ".dat", ".asar", ".7z", ".rar", ".pdf", ".lock",
    ".hprof", ".sym", ".ilk", ".pdb", ".lib", ".so", ".dylib",
}

CONTENT_RULES = [
    (re.compile(r"apps/cli"), "apps/cli"),
    (re.compile(r"@origin-ai/cf-"), "@origin-ai/cf-"),
    (re.compile(r"\.cfignore"), ".cfignore"),
    (re.compile(r"\.cf-plugin"), ".cf-plugin"),
    (re.compile(r'"\.cf"'), '".cf"'),
    (re.compile(r"'\.cf'"), "'.cf'"),
    (re.compile(r"/\.cf/"), "/.cf/"),
    (re.compile(r"~/.cf"), "~/.cf"),
    (re.compile(r"cf-server-cli"), "cf-server-cli"),
    (re.compile(r"cf-cua-plugin"), "cf-cua-plugin"),
    (re.compile(r"cf-guide-plugin"), "cf-guide-plugin"),
    (re.compile(r"cf-cua"), "cf-cua"),
    (re.compile(r"cf-cli"), "cf-cli"),
    (re.compile(r"cf\.cjs"), "cf.cjs"),
    (re.compile(r"cf\.js"), "cf.js"),
    (re.compile(r"CF"), "CF"),
    (re.compile(r"CodeFusion(?=[A-Za-z0-9_])"), "Cf"),
    (re.compile(r"(?<=[A-Za-z0-9_])CodeFusion"), "Cf"),
    (re.compile(r"CodeFusion"), "CodeFusion"),
    (re.compile(r"CodeFusion(?=[A-Za-z0-9_])"), "Cf"),
    (re.compile(r"(?<=[A-Za-z0-9_])CodeFusion"), "Cf"),
    (re.compile(r"CodeFusion"), "CodeFusion"),
    (re.compile(r"cf"), "cf"),
]


def fs_safe(p: Path) -> Path:
    """Normalize p, refuse any '..' component, and require p to be inside ROOT."""
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        p = Path(dirpath)
        if any(part in EXCLUDE_PATH_PARTS for part in p.relative_to(ROOT).parts):
            dirnames[:] = []
            continue
        for fn in filenames:
            f = fs_safe(p / fn)
            if f.name in EXCLUDE_FILES or f.suffix.lower() in BINARY_EXT:
                continue
            if f.suffix.lower() in TEXT_EXT or f.name in TEXT_NAMES or f.name.startswith("Dockerfile"):
                yield f


def transform(text: str):
    total = 0
    for rx, rep in CONTENT_RULES:
        text, n = rx.subn(rep, text)
        total += n
    return text, total


def main():
    files_changed = 0
    replacements = 0
    for f in iter_files():
        try:
            text = f.read_bytes().decode("utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        new_text, n = transform(text)
        if f == ROOT / "package.json" and '"name": "cf"' in new_text:
            new_text = new_text.replace('"name": "cf"', '"name": "code-fusion"', 1)
        if n and new_text != text:
            fs_safe(f).write_text(new_text, encoding="utf-8", newline="")
            files_changed += 1
            replacements += n
    print(f"[phase1] {files_changed} files changed, {replacements} replacements")

    renamed_files = 0
    for f in list(iter_files()):
        if "cf" in f.name.lower():
            new_name = f.name.replace("cf", "cf").replace("CodeFusion", "Cf").replace("CodeFusion", "Cf")
            target = fs_safe(f.with_name(new_name))
            if not target.exists():
                f.rename(target)
                renamed_files += 1
    print(f"[phase2a] {renamed_files} files renamed")

    renamed_dirs = 0
    all_dirs = []
    for dirpath, dirnames, _ in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        p = Path(dirpath)
        if any(part in EXCLUDE_PATH_PARTS for part in p.relative_to(ROOT).parts):
            dirnames[:] = []
            continue
        for d in dirnames:
            if "cf" in d.lower():
                all_dirs.append(p / d)
    for d in sorted(all_dirs, key=lambda x: len(x.parts), reverse=True):
        new_name = d.name.replace("cf", "cf").replace("CodeFusion", "Cf").replace("CodeFusion", "Cf")
        parent_is_apps = d.parent.name == "apps"
        target_name = "cli" if parent_is_apps and new_name == "cf-cli" else new_name
        target = fs_safe(d.with_name(target_name))
        if not target.exists():
            d.rename(target)
            renamed_dirs += 1
        else:
            print(f"  !! rename target exists, skipped: {d} -> {target}")
    print(f"[phase2b] {renamed_dirs} dirs renamed")

    leftovers = []
    for f in iter_files():
        try:
            text = f.read_bytes().decode("utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        if re.search(r"cf", text, re.IGNORECASE):
            leftovers.append(str(f.relative_to(ROOT)))
    print(f"[leftovers] {len(leftovers)} files still reference cf")
    for f in leftovers[:40]:
        print("   ", f)
    fs_safe(ROOT / "scripts" / "rebrand" / "leftovers.txt").write_text(
        "\n".join(leftovers), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
