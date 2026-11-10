#!/usr/bin/env python3
"""Agent HQ search: one query, every source at once.

Sources (all local, no network):
  vault     LihFolk Vault V2 notes, ranked by the vault's own vault.py (BM25F + symptoms)
  docs      Official Roblox Creator Docs (guides + engine API reference), sources/roblox-docs
  cards     LihFolk Engine Reference Cards (vault section 62)
  research  Project research: research/, the Agent HQ playbook chapters, the Agent HQ Studio vault, TASK.md

Usage (run from the Agent HQ folder, or anywhere: paths are resolved from this file):
  python -I tools/hq-search/hq_search.py "crime empire core loop"
  python -I tools/hq-search/hq_search.py -k 5 "mobile hud thumb reach"
  python -I tools/hq-search/hq_search.py --chapter 9            # playbook chapter 9 title as the query
  python -I tools/hq-search/hq_search.py --chapter 9 "gamepass vs dev product"   # chapter + extra words
  python -I tools/hq-search/hq_search.py --only docs,cards "ProximityPrompt hold duration"
  python -I tools/hq-search/hq_search.py --json "datastore session lock"
  python -I tools/hq-search/hq_search.py --chapters             # list playbook chapters
  python -I tools/hq-search/hq_search.py --setup-docs           # download/update the Roblox docs text (~30 MB)

The LihFolk vault is found at $LIHFOLK_VAULT, <root>/vault/LihFolk Vault V2, or the LihFolk Claude Code plugin.

The docs/cards/research index is cached in tools/hq-search/.cache and rebuilt when any file changes.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # the Agent HQ folder


def find_vault() -> Path:
    """LihFolk Vault V2: $LIHFOLK_VAULT, then <root>/vault, then the newest LihFolk plugin in ~/.claude."""
    env = os.environ.get("LIHFOLK_VAULT")
    cands = [Path(env)] if env else []
    cands.append(ROOT / "vault" / "LihFolk Vault V2")
    cache = Path.home() / ".claude" / "plugins" / "cache" / "lihfolk" / "lihfolk"
    if cache.exists():
        cands += [d / "LihFolk Vault V2" for d in sorted(cache.iterdir(), reverse=True)]
    for c in cands:
        if (c / "_tools" / "vault.py").exists():
            return c
    return cands[0] if env else ROOT / "vault" / "LihFolk Vault V2"


VAULT = find_vault()
VAULT_PY = VAULT / "_tools" / "vault.py"
DOCS = ROOT / "sources" / "roblox-docs" / "content" / "en-us"
CARDS = VAULT / "62 Engine Reference Cards"
PLAYBOOK = ROOT / ".claude" / "skills" / "roblox-agent-team" / "vault.md"
RESEARCH_DIRS = [ROOT / "research", ROOT / "agent-hq-studio" / "vault"]
RESEARCH_FILES = [ROOT / "TASK.md"]
CACHE = HERE / ".cache"

STOP = set("""a an and are as at be by can do does for from has have how i if in into is it its of on or our
so that the their them then there these this to use used using was we what when where which who why will with
you your not no only also than too very just more most get got make made""".split())
TOKEN = re.compile(r"[a-z0-9]+")


def tokens(text: str) -> list[str]:
    out = []
    for t in TOKEN.findall(text.lower()):
        if t in STOP or len(t) < 2:
            continue
        # light stemming so "upgrades"/"upgrade", "shops"/"shop" meet
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        out.append(t)
    return out


def split_camel(name: str) -> str:
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)


# ---------- document loaders: each returns dicts {title, path, text, weight_text} ----------

def frontmatter(text: str) -> tuple[dict, str]:
    meta = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            for line in text[3:end].splitlines():
                if ":" in line and not line.startswith(" "):
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip("'\"")
            text = text[end + 4:]
    return meta, text


def load_docs() -> list[dict]:
    docs = []
    if not DOCS.exists():
        return docs
    for p in DOCS.rglob("*.md"):
        if "includes" in p.parts:
            continue
        raw = p.read_text(encoding="utf-8", errors="ignore")
        meta, body = frontmatter(raw)
        body = re.sub(r"<[^>]+>", " ", body)  # strip JSX/HTML
        title = meta.get("title") or p.stem.replace("-", " ")
        heads = " ".join(re.findall(r"^#{1,4}\s+(.+)$", body, re.M))
        docs.append({"title": title, "path": p.relative_to(ROOT).as_posix(),
                     "boost": f"{title} {title} {meta.get('description', '')} {heads}", "text": body})
    for p in (DOCS / "reference").rglob("*.yaml"):
        raw = p.read_text(encoding="utf-8", errors="ignore")
        name = re.search(r"^name:\s*(\S+)", raw, re.M)
        name = name.group(1) if name else p.stem
        summ = re.search(r"^summary:\s*\|?\s*\n((?:  .*\n)+)", raw, re.M)
        summ = summ.group(1) if summ else ""
        members = " ".join(re.findall(r"^\s*-?\s*name:\s*\S+?\.(\w+)", raw, re.M))
        kind = p.parent.name  # classes / datatypes / enums / globals / libraries
        kind = {"classes": "class", "datatypes": "datatype", "enums": "enum", "globals": "global",
                "libraries": "library"}.get(kind, kind)
        docs.append({"title": f"{name} (API {kind})",
                     "path": p.relative_to(ROOT).as_posix(),
                     "boost": f"{name} {split_camel(name)} {name} {summ}",
                     "text": f"{summ} {split_camel(members)} {raw[:6000]}"})
    return docs


def load_cards() -> list[dict]:
    out = []
    if not CARDS.exists():
        return out
    for p in CARDS.glob("*.md"):
        raw = p.read_text(encoding="utf-8", errors="ignore")
        _, body = frontmatter(raw)
        title = p.stem
        cls = title.split(" - ")[0]
        heads = " ".join(re.findall(r"^#{1,4}\s+(.+)$", body, re.M))
        out.append({"title": title, "path": rel(p),
                    "boost": f"{cls} {split_camel(cls)} {cls} {heads}", "text": body})
    return out


def playbook_chapters() -> list[dict]:
    if not PLAYBOOK.exists():
        return []
    text = PLAYBOOK.read_text(encoding="utf-8", errors="ignore")
    parts = re.split(r"^## (\d+)\.\s+(.+)$", text, flags=re.M)
    chapters = []
    for i in range(1, len(parts) - 2, 3):
        chapters.append({"n": int(parts[i]), "title": parts[i + 1].strip(), "body": parts[i + 2].strip()})
    return chapters


def load_research() -> list[dict]:
    out = []
    for c in playbook_chapters():
        out.append({"title": f"Playbook {c['n']}. {c['title']}",
                    "path": f"{PLAYBOOK.relative_to(ROOT).as_posix()}#{c['n']}",
                    "boost": f"{c['title']} {c['title']}", "text": c["body"]})
    files = list(RESEARCH_FILES)
    for d in RESEARCH_DIRS:
        if d.exists():
            files += [p for p in d.rglob("*.md") if ".git" not in p.parts]
    for p in files:
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8", errors="ignore")
        meta, body = frontmatter(raw)
        title = meta.get("title") or p.stem
        heads = " ".join(re.findall(r"^#{1,4}\s+(.+)$", body, re.M))
        out.append({"title": title, "path": p.relative_to(ROOT).as_posix(),
                    "boost": f"{title} {title} {heads}", "text": body})
    return out


LOADERS = {"docs": load_docs, "cards": load_cards, "research": load_research}


def source_files(name: str) -> list[Path]:
    if name == "docs":
        return list(DOCS.rglob("*.md")) + list((DOCS / "reference").rglob("*.yaml")) if DOCS.exists() else []
    if name == "cards":
        return list(CARDS.glob("*.md")) if CARDS.exists() else []
    files = [PLAYBOOK, *RESEARCH_FILES]
    for d in RESEARCH_DIRS:
        if d.exists():
            files += list(d.rglob("*.md"))
    return [f for f in files if f.exists()]


# ---------- BM25 index with a JSON cache ----------

def fingerprint(files: list[Path]) -> str:
    h = hashlib.sha1()
    for f in sorted(files):
        st = f.stat()
        h.update(f"{f}|{st.st_size}|{int(st.st_mtime)}".encode())
    return h.hexdigest()


def build_index(name: str) -> dict:
    files = source_files(name)
    fp = fingerprint(files)
    cache = CACHE / f"{name}.json"
    if cache.exists():
        try:
            idx = json.loads(cache.read_text(encoding="utf-8"))
            if idx.get("fp") == fp:
                return idx
        except (OSError, ValueError):
            pass
    docs = LOADERS[name]()
    entries, df = [], {}
    for d in docs:
        tf = {}
        for t in tokens(d["boost"]):
            tf[t] = tf.get(t, 0) + 3  # title/headings weigh 3x
        body_toks = tokens(d["text"])
        for t in body_toks:
            tf[t] = tf.get(t, 0) + 1
        for t in tf:
            df[t] = df.get(t, 0) + 1
        entries.append({"title": d["title"], "path": d["path"], "len": sum(tf.values()), "tf": tf})
    idx = {"fp": fp, "n": len(entries), "avg": (sum(e["len"] for e in entries) / len(entries)) if entries else 1,
           "df": df, "docs": entries}
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(idx), encoding="utf-8")
    return idx


def bm25(idx: dict, q: list[str], k: int) -> list[tuple[float, dict]]:
    k1, b = 1.4, 0.75
    n, avg, df = idx["n"], idx["avg"], idx["df"]
    qset = [t for t in dict.fromkeys(q) if t in df]
    scored = []
    for d in idx["docs"]:
        tf = d["tf"]
        s = 0.0
        hits = 0
        for t in qset:
            f = tf.get(t)
            if not f:
                continue
            hits += 1
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d["len"] / avg))
        if s:
            s *= 1 + 0.25 * (hits - 1)  # reward docs that match more of the query
            scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return scored[:k]


def snippet(path: str, q: list[str], width: int = 220) -> str:
    real = Path(path.split("#")[0])
    real = real if real.is_absolute() else ROOT / real
    try:
        text = real.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    if "#" in path:  # a playbook chapter
        n = path.split("#")[1]
        m = re.search(rf"^## {n}\.[^\n]*\n(.*?)(?=^## \d+\.|\Z)", text, re.M | re.S)
        text = m.group(1) if m else text
    qs = set(q)
    best, best_score = "", 0
    for line in text.splitlines():
        line = re.sub(r"<[^>]+>", " ", line).strip(" >-*#\t|")
        if len(line) < 25 or line.startswith(("title:", "description:", "---")):
            continue
        sc = len(qs & set(tokens(line)))
        if sc > best_score:
            best, best_score = line, sc
    best = re.sub(r"\s+", " ", best)
    return best[:width] + ("…" if len(best) > width else "")


# ---------- sources ----------

def rel(p: Path) -> str:
    try:
        return p.relative_to(ROOT).as_posix()
    except ValueError:
        return p.as_posix()


def setup_docs() -> int:
    """Shallow, text-only sparse clone of github.com/Roblox/creator-docs (English .md and API .yaml, ~30 MB)."""
    dest = ROOT / "sources" / "roblox-docs"
    if (dest / ".git").exists():
        print(f"Updating {rel(dest)}")
        return subprocess.call(["git", "-C", str(dest), "pull", "--depth", "1", "-q"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading the Roblox Creator Docs text into {rel(dest)} (about 30 MB)")
    rc = subprocess.call(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse",
                          "https://github.com/Roblox/creator-docs.git", str(dest)])
    if rc:
        return rc
    return subprocess.call(["git", "-C", str(dest), "sparse-checkout", "set", "--no-cone",
                            "/content/en-us/**/*.md", "/content/en-us/**/*.yaml", "/LICENSE*", "/README.md"])


def search_vault(query: str, k: int) -> list[dict]:
    if not VAULT_PY.exists():
        return [{"error": f"vault not found at {VAULT_PY}"}]
    py = sys.executable or "python"
    try:
        r = subprocess.run([py, "-I", str(VAULT_PY), "--json", "-k", str(k), query], capture_output=True,
                           text=True, encoding="utf-8", timeout=120, cwd=str(VAULT.parent))
        data = json.loads(r.stdout)
    except Exception as e:  # noqa: BLE001
        return [{"error": f"vault.py failed: {e}"}]
    out = []
    for item in data.get("results", [])[:k]:
        tl = [ln.lstrip("> -").strip() for ln in item.get("tldr", "").splitlines()]
        tl = [ln for ln in tl if ln and not ln.startswith(("[!tldr]", "Cost:"))]
        out.append({"title": item["title"], "path": rel(VAULT / item["path"]),
                    "score": item.get("score"), "snippet": " | ".join(tl[:3])})
    return out


def search_local(name: str, query: str, k: int) -> list[dict]:
    idx = build_index(name)
    if not idx["n"]:
        hint = " (run with --setup-docs)" if name == "docs" else ""
        return [{"error": f"no {name} files found{hint}"}]
    q = tokens(query)
    return [{"title": d["title"], "path": d["path"], "score": round(s, 2), "snippet": snippet(d["path"], q)}
            for s, d in bm25(idx, q, k)]


SOURCES = {
    "vault": ("LihFolk vault", search_vault),
    "docs": ("Roblox docs", lambda q, k: search_local("docs", q, k)),
    "cards": ("Reference cards", lambda q, k: search_local("cards", q, k)),
    "research": ("Project research", lambda q, k: search_local("research", q, k)),
}


def run(query: str, k: int, only: list[str]) -> dict:
    names = [n for n in SOURCES if n in only]
    with cf.ThreadPoolExecutor(len(names)) as ex:
        futs = {n: ex.submit(SOURCES[n][1], query, k) for n in names}
        return {n: futs[n].result() for n in names}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Search the LihFolk vault, Roblox docs, reference cards and project research at once.")
    ap.add_argument("query", nargs="*")
    ap.add_argument("-k", type=int, default=3, help="results per source (default 3)")
    ap.add_argument("--only", default="vault,docs,cards,research", help="comma list of sources")
    ap.add_argument("--chapter", type=int, help="use this playbook chapter's title (and its first rule) as the query")
    ap.add_argument("--chapters", action="store_true", help="list the playbook chapters and exit")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--setup-docs", action="store_true", help="download or update the Roblox Creator Docs text (~30 MB)")
    a = ap.parse_args()

    if a.setup_docs:
        return setup_docs()
    chapters = playbook_chapters()
    if a.chapters:
        for c in chapters:
            print(f"{c['n']:>2}. {c['title']}")
        return 0
    query = " ".join(a.query)
    if a.chapter is not None:
        c = next((c for c in chapters if c["n"] == a.chapter), None)
        if not c:
            print(f"no playbook chapter {a.chapter}", file=sys.stderr)
            return 2
        query = f"{c['title']} {query}".strip()
    if not query:
        ap.print_help()
        return 2
    only = [s.strip() for s in a.only.split(",") if s.strip() in SOURCES]
    res = run(query, a.k, only)
    if a.json:
        print(json.dumps({"query": query, "results": res}, indent=1, ensure_ascii=False))
        return 0
    print(f"query: {query}")
    for n in only:
        print(f"\n## {SOURCES[n][0]}")
        items = res.get(n) or []
        if not items:
            print("  (no match)")
        for i, it in enumerate(items, 1):
            if "error" in it:
                print(f"  ! {it['error']}")
                continue
            print(f"  {i}. {it['title']}  [{it['path']}]")
            if it.get("snippet"):
                print(f"     {it['snippet']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
