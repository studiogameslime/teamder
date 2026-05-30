#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiny UIAutomator helper so taps land on real elements instead of guessed
pixels. Usage:
  python3 scripts/ui.py <serial> dump                 -> print all texts
  python3 scripts/ui.py <serial> find  "<text>"       -> matches + centers
  python3 scripts/ui.py <serial> tap   "<text>"       -> tap first match
  python3 scripts/ui.py <serial> tapd  "<content-desc>"-> tap by desc
  python3 scripts/ui.py <serial> has   "<text>"       -> exit 0 if present
"""
import subprocess, sys, re, time
import xml.etree.ElementTree as ET


def adb(serial, *args, text=True):
    return subprocess.run(["adb", "-s", serial, *args],
                          capture_output=True, text=text).stdout


def dump_xml(serial):
    for _ in range(3):
        subprocess.run(["adb", "-s", serial, "shell", "uiautomator", "dump",
                        "/sdcard/ui.xml"], capture_output=True)
        xml = adb(serial, "shell", "cat", "/sdcard/ui.xml")
        if xml and "<hierarchy" in xml:
            return xml
        time.sleep(0.6)
    return xml


def nodes(xml):
    try:
        root = ET.fromstring(xml)
    except Exception:
        return []
    out = []
    for n in root.iter("node"):
        b = n.attrib.get("bounds", "")
        m = re.findall(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
        cx = cy = None
        if m:
            x1, y1, x2, y2 = map(int, m[0])
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        out.append({
            "text": n.attrib.get("text", ""),
            "desc": n.attrib.get("content-desc", ""),
            "rid": n.attrib.get("resource-id", ""),
            "cls": n.attrib.get("class", ""),
            "cx": cx, "cy": cy, "bounds": b,
        })
    return out


def find(xml, query, by="text"):
    res = []
    for n in nodes(xml):
        hay = n[by]
        if query and query in hay and n["cx"] is not None:
            res.append(n)
    return res


def main():
    serial, cmd = sys.argv[1], sys.argv[2]
    if cmd == "dump":
        xml = dump_xml(serial)
        for n in nodes(xml):
            if n["text"] or n["desc"]:
                print(f'[{n["cx"]},{n["cy"]}] text="{n["text"]}" desc="{n["desc"]}"')
        return
    q = sys.argv[3]
    by = "desc" if cmd in ("tapd",) else "text"
    xml = dump_xml(serial)
    res = find(xml, q, by=by)
    if cmd == "find":
        for n in res:
            print(f'[{n["cx"]},{n["cy"]}] text="{n["text"]}" desc="{n["desc"]}" rid="{n["rid"]}"')
        if not res:
            print("NO MATCH")
    elif cmd in ("tap", "tapd"):
        if res:
            n = res[0]
            subprocess.run(["adb", "-s", serial, "shell", "input", "tap",
                            str(n["cx"]), str(n["cy"])])
            print(f'TAPPED [{n["cx"]},{n["cy"]}] "{n["text"] or n["desc"]}"')
        else:
            print("NO MATCH")
            sys.exit(2)
    elif cmd == "has":
        sys.exit(0 if res else 1)


if __name__ == "__main__":
    main()
