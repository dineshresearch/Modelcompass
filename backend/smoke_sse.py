"""Scratch end-to-end smoke test against the running backend (tiny live runs)."""
import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000"
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(f"{'PASS' if cond else 'FAIL'} {name} {detail}", flush=True)


def sse_events(client, payload):
    evs = []
    with client.stream("POST", f"{BASE}/api/compare", json=payload, timeout=180) as resp:
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.read()[:300]}")
        for line in resp.iter_lines():
            if line.startswith("data: "):
                evs.append(json.loads(line[6:]))
    return evs


def main():
    with httpx.Client(trust_env=False) as client:
        p1 = {
            "prompt": "Reply with one short sentence: what is a load balancer?",
            "models": ["glm-5.3-flash", "deepseek-v4.1-flash"],
            "max_tokens": 512, "synthesize": False, "mode": "fast",
            "reasoning": False, "budget_usd": 0.002, "refresh": True,
        }
        evs = sse_events(client, p1)
        types = [e["type"] for e in evs]
        tokens = sum(1 for e in evs if e["type"] == "panel_token")
        done = next(e for e in evs if e["type"] == "done")
        runs = [e["run"] for e in evs if e["type"] == "panel_completed"]
        check("stream: event order", types[0] == "started" and types[-1] == "done", str(types[:4]) + "...")
        check("stream: token events", tokens > 0, f"{tokens} tokens")
        check("stream: 2 ok panels", len(runs) == 2 and all(r["status"] == "ok" for r in runs))
        check("stream: reasoning off honored", all((r.get("reasoning_tokens") or 0) <= 5 for r in runs),
              str([r.get("reasoning_tokens") for r in runs]))
        check("stream: envelope ok", done["overall_status"] == "ok", done["overall_status"])
        check("stream: streamed flag", all(r.get("streamed") for r in runs))
        exp_a = done["experiment_id"]

        evs2 = sse_events(client, dict(p1, refresh=False))
        runs2 = [e["run"] for e in evs2 if e["type"] == "panel_completed"]
        done2 = next(e for e in evs2 if e["type"] == "done")
        check("cache: exact hits free+labeled", all(r.get("cache_hit") == "exact" and r["est_cost_usd"] == 0 for r in runs2),
              str([(r.get("cache_hit"), r.get("cached_at")) for r in runs2]))
        check("cache: zero cost total", done2["totals"]["cost_usd"] == 0, str(done2["totals"]["cost_usd"]))

        p3 = {
            "prompt": "Reply with one word: hello.",
            "models": ["glm-5.3-flash", "deepseek-v4.1-flash", "minimax-m2.5", "kimi-k2.6"],
            "max_tokens": 2048, "synthesize": False, "mode": "custom",
            "reasoning": False, "budget_usd": 0.001, "refresh": True,
        }
        evs3 = sse_events(client, p3)
        skipped = [e["run"] for e in evs3 if e["type"] == "panel_skipped"]
        ok3 = [e["run"] for e in evs3 if e["type"] == "panel_completed"]
        done3 = next(e for e in evs3 if e["type"] == "done")
        check("budget: panels skipped+labeled", len(skipped) >= 1 and all(r["error_kind"] == "budget" for r in skipped),
              f"{len(skipped)} skipped, {len(ok3)} ok")
        check("budget: envelope degraded/partial", done3["overall_status"] in ("degraded", "partial"), done3["overall_status"])
        check("budget: notes present", len(done3["status_notes"]) >= 1)
        exp_c = done3["experiment_id"]

        r = client.post(f"{BASE}/api/experiments/{exp_c}/retry-failed", timeout=180)
        check("retry: HTTP 200", r.status_code == 200, str(r.status_code))
        if r.status_code == 200:
            exp = r.json()
            n_ok = sum(1 for x in exp["runs"] if x["status"] == "ok")
            check("retry: all panels ok now", n_ok == 4, f"{n_ok}/4")
            check("retry: envelope ok", exp["overall_status"] == "ok", str(exp["overall_status"]))

        # cancellation: start a slower run, cancel after first token
        p5 = {
            "prompt": "Think step by step, then answer: explain consensus algorithms in detail.",
            "models": ["minimax-m2.5", "kimi-k2.6"],
            "max_tokens": 4096, "synthesize": False, "mode": "custom", "reasoning": True,
        }
        exp_id = None
        cancelled_sent = False
        evs5 = []
        with client.stream("POST", f"{BASE}/api/compare", json=p5, timeout=180) as resp:
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                ev = json.loads(line[6:])
                evs5.append(ev)
                if ev["type"] == "started":
                    exp_id = ev["experiment_id"]
                if ev["type"] == "panel_token" and not cancelled_sent:
                    cancelled_sent = True
                    cr = client.post(f"{BASE}/api/compare/{exp_id}/cancel", timeout=30)
                    check("cancel: endpoint ok", cr.status_code == 200, str(cr.status_code))
        done5 = next((e for e in evs5 if e["type"] == "done"), None)
        check("cancel: done envelope cancelled", done5 and done5["overall_status"] == "cancelled",
              done5["overall_status"] if done5 else "no done")
        check("cancel: partial results preserved", done5 and done5["totals"]["models_cancelled"] >= 1,
              str(done5["totals"]) if done5 else "")

        # Deep mode: async job + polling
        p6 = {
            "prompt": "Reply with one short sentence: what is a vector database?",
            "models": ["glm-5.3-flash", "deepseek-v4.1-flash", "minimax-m2.5", "kimi-k2.6"],
            "max_tokens": 1024, "synthesize": True, "mode": "deep", "reasoning": False, "refresh": True,
        }
        r6 = client.post(f"{BASE}/api/compare", json=p6, timeout=30)
        check("deep: 202 + job_id", r6.status_code == 202 and "job_id" in r6.json(), str(r6.status_code))
        job_id = r6.json()["job_id"]
        snap = None
        t0 = time.time()
        saw_running_partial = False
        while time.time() - t0 < 180:
            snap = client.get(f"{BASE}/api/jobs/{job_id}", timeout=30).json()
            if any(p.get("partial_output") for p in snap["panels"].values() if p["status"] == "running"):
                saw_running_partial = True
            if snap["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.4)
        check("deep: job completed", snap and snap["status"] == "completed", snap["status"] if snap else "timeout")
        check("deep: polling saw partial output", saw_running_partial)
        check("deep: synthesis + envelope", snap and snap["synthesis"] is not None and snap["overall_status"] in ("ok", "degraded"),
              snap["overall_status"] if snap else "")
        check("deep: experiment persisted", snap and client.get(f"{BASE}/api/experiments/{snap['experiment_id']}").status_code == 200)

        # semantic cache: paraphrase of p1 (high lexical overlap)
        p7 = dict(p1, refresh=False, prompt="Reply with one short sentence: what is a load balancer ?")
        evs7 = sse_events(client, p7)
        runs7 = [e["run"] for e in evs7 if e["type"] == "panel_completed"]
        check("cache: normalized/semantic hit", all(r.get("cache_hit") in ("exact", "semantic") for r in runs7),
              str([r.get("cache_hit") for r in runs7]))

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed", flush=True)
    sys.exit(1 if failed else 0)


main()