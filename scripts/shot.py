#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Capture a screenshot from an emulator and downscale so the Read tool can
view it (max height kept well under the image limit).
Usage: python3 scripts/shot.py <serial> <out.png> [maxheight]"""
import subprocess, sys
from PIL import Image
import io

serial, out = sys.argv[1], sys.argv[2]
maxh = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
png = subprocess.run(["adb", "-s", serial, "exec-out", "screencap", "-p"],
                     capture_output=True).stdout
im = Image.open(io.BytesIO(png)).convert("RGB")
w, h = im.size
if h > maxh:
    im = im.resize((int(w * maxh / h), maxh), Image.LANCZOS)
im.save(out, "PNG")
print(out, im.size)
