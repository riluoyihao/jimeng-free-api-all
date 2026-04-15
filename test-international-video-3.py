#!/usr/bin/env python3
import sys
import json
import requests

def main():
    # 获取命令行传入的 Token
    TOKEN = sys.argv[1] if len(sys.argv) > 1 else "ve-your-token"
    BASE_URL = "http://localhost:8000"

    # 请求参数
    payload = {
        "model": "jimeng-video-3.0",
        "prompt": "A cute cat walking slowly on grass, cinematic, natural motion",
        "ratio": "16:9",
        "resolution": "720p",
        "duration": 5
    }

    # 发送生成视频请求
    try:
        resp = requests.post(
            url=f"{BASE_URL}/v1/videos/international/generations",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=1800
        )
    except requests.exceptions.RequestException as e:
        print(f"请求失败：{str(e)}")
        sys.exit(1)

    # 输出状态码
    print("HTTP", resp.status_code)

    # 解析响应
    try:
        body = resp.json()
        print(json.dumps(body, ensure_ascii=False, indent=2))
    except Exception:
        print("响应非 JSON 格式：")
        print(resp.text)
        sys.exit(1)

    # 提取并输出视频地址
    data = body.get("data", [])
    if isinstance(data, list) and data:
        print("\nvideo url:")
        print(data[0].get("url"))
    else:
        print("\nrequest failed")

if __name__ == "__main__":
    main()