#!/usr/bin/env python3
"""Seedance 2.0 VIP 模型测试: Fast VIP + VIP"""

import sys
import requests

TOKEN = sys.argv[1] if len(sys.argv) > 1 else "99999"
BASE_URL = "http://localhost:8000"
IMAGE_URL = "https://p3-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/bab623359bd9410da0c1f07897b16fec~tplv-tb4s082cfz-resize:0:0.image?lk3s=8e790bc3&x-expires=1788961069&x-signature=cbtnyeSIcqWpngHdoYWFkCra3cA%3D"

# 通过命令行参数选择模型，默认测试 fast-vip
model_key = sys.argv[2] if len(sys.argv) > 2 else "fast-vip"

MODELS = {
    "fast-vip": {
        "model": "jimeng-video-seedance-2.0-fast-vip",
        "desc": "Seedance 2.0 Fast VIP (极速推理，会员专属通道)",
        "internal": "dreamina_seedance_40_vision",
    },
    "vip": {
        "model": "jimeng-video-seedance-2.0-vip",
        "desc": "Seedance 2.0 VIP (主模态能力，会员专属通道)",
        "internal": "dreamina_seedance_40_pro_vision",
    },
}

if model_key not in MODELS:
    print(f"未知模型: {model_key}")
    print(f"可选: {', '.join(MODELS.keys())}")
    sys.exit(1)

cfg = MODELS[model_key]

print("=" * 55)
print(f" {cfg['desc']}")
print("=" * 55)
print(f"POST {BASE_URL}/v1/videos/generations")
print(f"  model={cfg['model']}")
print(f"  internal={cfg['internal']}")
print(f"  file_paths=[IMAGE_URL]")
print(f"  prompt=小熊头上带个帽子")
print(f"  ratio=16:9, duration=4")
print()

resp = requests.post(
    f"{BASE_URL}/v1/videos/generations",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={
        "model": cfg["model"],
        "prompt": "小熊头上带个帽子",
        "ratio": "16:9",
        "duration": 4,
        "file_paths": [IMAGE_URL],
    },
)

print(f"HTTP {resp.status_code}")
print()

if resp.status_code == 200:
    result = resp.json()
    print(f"created: {result.get('created', '')}")
    data = result.get("data", [])
    if data:
        for i, item in enumerate(data):
            url = item.get("url", "")
            prompt = item.get("revised_prompt", "")
            print(f"revised_prompt: {prompt}")
            print()
            print(f"Video URL:")
            print(url)
    else:
        print("data 为空，未生成视频")
        print(f"原始响应: {resp.text}")
else:
    print(f"请求失败:")
    print(resp.text)
