"""Read aggregate usage for a fixed range, without user identifiers or credentials in output."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("start")
    parser.add_argument("end")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    gcloud = shutil.which("gcloud") or os.path.expandvars(r"%LOCALAPPDATA%\TeamderTools\google-cloud-sdk\bin\gcloud.cmd")
    token = subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, check=True, timeout=45).stdout.decode().strip()
    url = "https://analyticsdata.googleapis.com/v1beta/properties/534662166:runReport"
    query = {"dateRanges": [{"startDate": args.start, "endDate": args.end}],
             "dimensions": [{"name": "eventName"}], "metrics": [{"name": "totalUsers"}, {"name": "eventCount"}],
             "orderBys": [{"dimension": {"dimensionName": "eventName"}}], "limit": 1000}
    results = {"range": [args.start, args.end], "rows": [], "metadata": {}}
    try:
        while True:
            query["offset"] = len(results["rows"])
            req = urllib.request.Request(url, json.dumps(query).encode(), {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as response:
                data = json.load(response)
            rows = data.get("rows", [])
            results["rows"].extend({"event": r["dimensionValues"][0]["value"], "users": int(r["metricValues"][0]["value"]),
                                    "count": int(r["metricValues"][1]["value"])} for r in rows)
            results["metadata"] = data.get("metadata", {})
            if len(results["rows"]) >= data.get("rowCount", 0):
                break
            if not rows:
                raise RuntimeError("Incomplete analytics page")
    except urllib.error.HTTPError as err:
        body = json.load(err).get("error", {})
        results = {"range": results["range"], "status": err.code, "reason": body.get("status"), "message": body.get("message", "")[:230]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in results.items() if k not in ("rows", "metadata")}, ensure_ascii=False), len(results.get("rows", [])))


if __name__ == "__main__":
    main()
