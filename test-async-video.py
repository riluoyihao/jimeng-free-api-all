#!/usr/bin/env python3
"""
异步视频生成接口测试

用法:
  python3 test-async-video.py <sessionid>
"""

import sys
import time
import json
import requests

TOKEN = sys.argv[1] if len(sys.argv) > 1 else "99999"
BASE_URL = "http://localhost:8000"

# ========== 1. 提交任务 ==========
print("=" * 50)
print("  [1] 提交异步视频生成任务")
print("=" * 50)

resp = requests.post(
    f"{BASE_URL}/v1/videos/generations/async",
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    },
    json={
        "model": "seedance-2.0-fast",
        "prompt": "@1 图片中的小狗带个帽子",
        "ratio": "9:16",
        "resolution": "720p",
        "duration": 4,
        "file_paths": [
            "https://p3-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/bab623359bd9410da0c1f07897b16fec~tplv-tb4s082cfz-resize:0:0.image?lk3s=8e790bc3&x-expires=1788961069&x-signature=cbtnyeSIcqWpngHdoYWFkCra3cA%3D"
        ],
    },
)

print(f"HTTP {resp.status_code}")
body = resp.json()
print(json.dumps(body, indent=2, ensure_ascii=False))

task_id = body.get("task_id")
if not task_id:
    print("\n提交失败，退出")
    sys.exit(1)

# ========== 2. 查询结果 ==========
print()
print("=" * 50)
print(f"  [2] 查询任务结果")
print("=" * 50)
print(f"task_id: {task_id}")
print(f"开始时间: {time.strftime('%H:%M:%S')}")
print("等待视频生成中...\n")

start = time.time()
resp = requests.get(
    f"{BASE_URL}/v1/videos/generations/async/{task_id}",
    headers={"Authorization": f"Bearer {TOKEN}"},
    timeout=1800,
)
elapsed = time.time() - start

print(f"耗时: {elapsed:.1f} 秒 ({elapsed / 60:.1f} 分钟)")
print(f"HTTP {resp.status_code}")
result = resp.json()
print(json.dumps(result, indent=2, ensure_ascii=False))

if result.get("status") == "succeeded":
    url = result.get("data", [{}])[0].get("url", "")
    print(f"\n视频地址: {url}")
