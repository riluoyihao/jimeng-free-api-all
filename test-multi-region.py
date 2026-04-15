#!/usr/bin/env python3
"""
多地区国际版 Seedance 批量验证
从表格中提取的 7 个账号，覆盖 VE/AL/PT/AZ/UZ/TR/XK 地区
"""

import json
import time
import requests

BASE_URL = "http://localhost:8000"
IMAGE_URL = "https://p3-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/bab623359bd9410da0c1f07897b16fec~tplv-tb4s082cfz-resize:0:0.image?lk3s=8e790bc3&x-expires=1788961069&x-signature=cbtnyeSIcqWpngHdoYWFkCra3cA%3D"

# 从表格提取：邮箱 | 密码 | sessionid | 积分 | 状态 | 地区 | 日期
ACCOUNTS = [
    {"email": "KellyDavis3641@outlook.com",        "sid": "xxxx", "credits": 120, "region": "IL"},
    {"email": "DavidMyers1349@outlook.com",         "sid": "xxxx", "credits": 120, "region": "PT"},
    {"email": "LeonardJuarez4182@outlook.com",      "sid": "xxxx", "credits": 120, "region": "UZ"},
    {"email": "MelissaParker2669@outlook.com",      "sid": "xxxx", "credits": 450, "region": "TR"},
    {"email": "StephenWells5685@outlook.com",       "sid": "xxxx", "credits": 120, "region": "XK"},
]


def test_account(account: dict, index: int):
    region = account["region"].lower()
    token = f"{region}-{account['sid']}"
    tag = f"[{account['region']} #{index}] {account['email']}"

    print(f"\n{'='*60}")
    print(f"{tag}")
    print(f"  Token: {token[:25]}...{token[-8:]}  积分: {account['credits']}")
    print(f"{'='*60}")

    try:
        start = time.time()
        resp = requests.post(
            f"{BASE_URL}/v1/videos/international/generations",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "model": "seedance-2.0-fast",
                "prompt": "@1 中的人物开始微笑",
                "ratio": "4:3",
                "resolution": "720p",
                "duration": 4,
                "file_paths": [IMAGE_URL],
            },
            timeout=600,
        )
        elapsed = time.time() - start
        body = resp.json()

        # 判断结果
        data = body.get("data", [])
        errmsg = body.get("errmsg") or body.get("error") or body.get("message") or ""

        if "shark not pass" in errmsg:
            print(f"  [SHARK] 签名未通过 ({elapsed:.1f}s)")
            return {"status": "shark", "elapsed": elapsed}
        elif "积分不足" in errmsg or "Not enough credits" in errmsg or "INSUFFICIENT_POINTS" in errmsg:
            print(f"  [NO-CREDITS] 积分不足 ({elapsed:.1f}s)")
            return {"status": "no_credits", "elapsed": elapsed}
        elif "不支持" in errmsg or "暂不支持" in errmsg:
            print(f"  [UNSUPPORTED] 地区不支持 ({elapsed:.1f}s)")
            print(f"  Detail: {errmsg}")
            return {"status": "unsupported", "elapsed": elapsed}
        elif "上传失败" in errmsg or "503" in errmsg:
            print(f"  [UPLOAD-ERR] 上传失败 ({elapsed:.1f}s)")
            print(f"  Detail: {errmsg[:120]}")
            return {"status": "upload_err", "elapsed": elapsed}
        elif resp.ok and data and isinstance(data, list) and data[0].get("url"):
            url = data[0]["url"]
            print(f"  [OK] 成功! ({elapsed:.1f}s)")
            print(f"  Video: {url[:100]}...")
            return {"status": "success", "elapsed": elapsed, "url": url}
        else:
            short = errmsg[:150] if errmsg else json.dumps(body, ensure_ascii=False)[:150]
            print(f"  [FAIL] HTTP {resp.status_code} ({elapsed:.1f}s)")
            print(f"  Detail: {short}")
            return {"status": "failed", "elapsed": elapsed}

    except requests.exceptions.Timeout:
        print(f"  [TIMEOUT] 请求超时 600s")
        return {"status": "timeout", "elapsed": 600}
    except Exception as e:
        print(f"  [ERROR] {e}")
        return {"status": "error", "elapsed": 0}


def main():
    total = len(ACCOUNTS)
    print(f"批量验证 {total} 个国际账号（seedance-2.0-fast）")
    print(f"服务端: {BASE_URL}")

    # ping 检测
    try:
        r = requests.get(f"{BASE_URL}/ping", timeout=5)
        print(f"服务状态: {r.text.strip()}")
    except:
        print("服务端未响应，请确认已启动")
        return

    results = []
    for i, acc in enumerate(ACCOUNTS):
        r = test_account(acc, i)
        r["region"] = acc["region"]
        r["email"] = acc["email"]
        r["credits"] = acc["credits"]
        results.append(r)

    # 汇总
    print(f"\n{'='*70}")
    print(f"{'地区':<6} {'邮箱':<38} {'积分':<6} {'结果':<18} {'耗时':<8}")
    print(f"{'-'*6} {'-'*38} {'-'*6} {'-'*18} {'-'*8}")

    for r in results:
        status_map = {
            "success": "OK 成功",
            "shark": "SHARK 签名失败",
            "no_credits": "积分不足",
            "unsupported": "地区不支持",
            "upload_err": "上传失败",
            "timeout": "超时",
            "failed": "失败",
            "error": "异常",
        }
        label = status_map.get(r["status"], r["status"])
        print(f"{r['region']:<6} {r['email']:<38} {r['credits']:<6} {label:<18} {r['elapsed']:.1f}s")

    ok = sum(1 for r in results if r["status"] == "success")
    shark_ok = sum(1 for r in results if r["status"] != "shark")
    print(f"\n视频生成成功: {ok}/{total}")
    print(f"Shark 签名通过: {shark_ok}/{total} {'(全部通过)' if shark_ok == total else '(有失败)'}")


if __name__ == "__main__":
    main()
