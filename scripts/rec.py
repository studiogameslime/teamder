#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge a JSON blob of test results into results.json then rebuild the xlsx.
Usage: python3 scripts/rec.py '{"G-01":{"status":"עבר","note":"..."}}'
Each value: {status, severity?, note?, bug?, fix?, repro?}"""
import json, sys, os, subprocess
here = os.path.dirname(__file__)
p = os.path.join(here, "results.json")
data = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
incoming = json.loads(sys.argv[1])
data.update(incoming)
json.dump(data, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
subprocess.run([sys.executable, os.path.join(here, "make_test_plan.py")], cwd=os.path.dirname(here))
print(f"recorded {len(incoming)} | total {len(data)}")
