#!/usr/bin/env python3
"""
国际版 Seedance 接口测试

用法:
  python3 test-international-seedance.py <token>
"""

import sys
import json
import requests

TOKEN = sys.argv[1] if len(sys.argv) > 1 else "hk-your-token"
BASE_URL = "http://localhost:8000"
IMAGE_URL = "https://p3-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/bab623359bd9410da0c1f07897b16fec~tplv-tb4s082cfz-resize:0:0.image?lk3s=8e790bc3&x-expires=1788961069&x-signature=cbtnyeSIcqWpngHdoYWFkCra3cA%3D"

for model in ["seedance-2.0-fast"]:
    print("=" * 60)
    print(f"Testing model: {model}")
    print("=" * 60)
    resp = requests.post(
        f"{BASE_URL}/v1/videos/international/generations",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "prompt": "@image_file_1 中的人物开始微笑并转身",
            "ratio": "4:3",
            "duration": 4,
            "image_file_1": IMAGE_URL,
        },
        timeout=1800,
    )

    print(f"HTTP {resp.status_code}")
    body = resp.json()
    print(json.dumps(body, indent=2, ensure_ascii=False))

    data = body.get("data") or []
    url = data[0].get("url") if isinstance(data, list) and data else None
    if resp.ok and url:
        print(f"\nvideo url: {url}\n")
    else:
        print("\nrequest failed or missing data[0].url\n")
        if body.get("message"):
            print(f"message: {body['message']}\n")

    if body.get("code") not in (None, 0) and not url:
        continue
