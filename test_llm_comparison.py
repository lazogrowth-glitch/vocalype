"""
Comparaison Qwen3-0.6B vs Gemma3-270M pour nettoyage de dictée Vocalype.
Usage: python test_llm_comparison.py
"""

import subprocess, time, urllib.request, os, json, sys
from pathlib import Path

LLAMA_DIR  = Path(os.environ["APPDATA"]) / "com.vocalype.desktop" / "vocalype-llm"
MODELS_DIR = LLAMA_DIR / "models"
SERVER_EXE = LLAMA_DIR / "llama-server.exe"
PORT       = 8799

MODELS = {
    "Qwen3-0.6B (actuel)": {
        "file":     MODELS_DIR / "qwen3-0.6b-q4_k_m.gguf",
        "url":      "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
        "size_mb":  450,
        "args_extra": ["--chat-template-kwargs", '{"enable_thinking":false}'],
    },
    "Gemma3-270M (challenger)": {
        "file":     MODELS_DIR / "gemma-3-270m-it-q4_k_m.gguf",
        "url":      "https://huggingface.co/bartowski/google_gemma-3-270m-it-GGUF/resolve/main/google_gemma-3-270m-it-Q4_K_M.gguf",
        "size_mb":  150,
        "args_extra": [],
    },
}

SYSTEM_PROMPT = (
    "You are a speech transcription cleaner. "
    "Fix ONLY: filler words (euh, um, uh, hm), obvious repetitions, missing punctuation, capitalization. "
    "Do NOT rephrase or add content. Return ONLY the cleaned text."
)

TEST_CASES = [
    {
        "label": "🇫🇷 Français — fillers + ponctuation",
        "input": "euh je veux euh créer une fonction qui euh prend en paramètre un tableau et retourne euh la somme de tous les éléments",
    },
    {
        "label": "🇬🇧 English — repetitions + casing",
        "input": "i want i want to refactor the the authentication module to use JWT tokens instead of session cookies",
    },
    {
        "label": "🔀 Mixte FR/EN — jargon dev",
        "input": "euh faut qu'on fix le bug dans le component um le UserCard component qui qui re-render trop souvent à cause du useEffect",
    },
    {
        "label": "🔀 Auto-correction — RSI dev",
        "input": "appelle la fonction euh non attends appelle la méthode getUserById avec l'id de l'utilisateur courant",
    },
    {
        "label": "🇫🇷 Email pro",
        "input": "bonjour euh je vous contacte pour euh vous informer que euh le déploiement prévu pour vendredi est repoussé à lundi prochain en raison de problèmes techniques rencontrés lors des tests",
    },
]

def download(url, dest, label, size_mb):
    if dest.exists():
        mb = dest.stat().st_size // 1024 // 1024
        print(f"  ✓ {label} déjà présent ({mb} MB)")
        return
    print(f"  ↓ Téléchargement {label} (~{size_mb} MB)...", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    try:
        def progress(count, block, total):
            if total > 0:
                pct = min(100, count * block * 100 // total)
                print(f"\r    {pct}%  ", end="", flush=True)
        urllib.request.urlretrieve(url, tmp, reporthook=progress)
        tmp.rename(dest)
        print(f"\r  ✓ {label} OK ({dest.stat().st_size // 1024 // 1024} MB)")
    except Exception as e:
        if tmp.exists(): tmp.unlink()
        print(f"\n  ✗ {e}")
        sys.exit(1)

def start_server(model_path, extra_args):
    cmd = [
        str(SERVER_EXE), "--host", "127.0.0.1", "--port", str(PORT),
        "--model", str(model_path), "--ctx-size", "512",
        "--threads", "4", "--n-predict", "256",
        "-ngl", "0", "--parallel", "1", "--log-disable",
    ] + extra_args
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_healthy(timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=1)
            if r.status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False

def chat(text):
    payload = json.dumps({
        "model": "test",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": text},
        ],
        "max_tokens": 256,
        "temperature": 0.1,
    }).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/v1/chat/completions",
        data=payload, headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    elapsed = time.time() - t0
    content = data["choices"][0]["message"]["content"].strip()
    tokens  = data.get("usage", {}).get("completion_tokens", 0)
    return content, elapsed, tokens

def run_model(name, cfg):
    print(f"\n{'='*62}")
    print(f"  MODEL : {name}")
    print(f"{'='*62}")
    proc = start_server(cfg["file"], cfg["args_extra"])
    results = []
    try:
        print("  Démarrage...", end=" ", flush=True)
        if not wait_healthy(90):
            print("TIMEOUT ✗")
            proc.kill()
            return []
        print("prêt ✓\n")
        for tc in TEST_CASES:
            print(f"  {tc['label']}")
            print(f"  IN : {tc['input']}")
            try:
                out, secs, toks = chat(tc["input"])
                print(f"  OUT: {out}")
                print(f"       ⏱ {secs:.1f}s | {toks} tokens\n")
                results.append({"label": tc["label"], "output": out,
                                 "secs": secs, "tokens": toks})
            except Exception as e:
                print(f"  ✗ {e}\n")
                results.append({"label": tc["label"], "output": str(e),
                                 "secs": 0, "tokens": 0})
    finally:
        proc.kill()
        proc.wait()
        time.sleep(1)
    return results

def verdict(all_results):
    print(f"\n{'='*62}")
    print("  VERDICT FINAL")
    print(f"{'='*62}")
    names = list(all_results.keys())
    if len(names) < 2:
        return
    a, b = names[0], names[1]
    ra, rb = all_results[a], all_results[b]
    if not ra or not rb:
        return

    avg_a = sum(r["secs"] for r in ra if r["secs"] > 0) / max(1, sum(1 for r in ra if r["secs"] > 0))
    avg_b = sum(r["secs"] for r in rb if r["secs"] > 0) / max(1, sum(1 for r in rb if r["secs"] > 0))
    size_a = MODELS[a]["size_mb"]
    size_b = MODELS[b]["size_mb"]

    print(f"\n  Vitesse moyenne : {a} {avg_a:.1f}s  |  {b} {avg_b:.1f}s")
    print(f"  RAM estimée     : {a} ~{size_a}MB  |  {b} ~{size_b}MB  (diff: {size_a-size_b}MB)")
    print(f"\n  → Compare les OUT ci-dessus pour la qualité.")
    print(f"  → Si qualité similaire : prends {b} (économie {size_a-size_b} MB RAM)")
    print(f"  → Si {a} clairement meilleur sur le jargon dev/FR : garde-le")

if __name__ == "__main__":
    print("Vocalype — Benchmark LLM : Qwen3-0.6B vs Gemma3-270M")
    print("="*62)
    print("\nTéléchargements :")
    for name, cfg in MODELS.items():
        download(cfg["url"], cfg["file"], name, cfg["size_mb"])

    all_results = {}
    for name, cfg in MODELS.items():
        all_results[name] = run_model(name, cfg)

    verdict(all_results)
    print("\nTest terminé.\n")
