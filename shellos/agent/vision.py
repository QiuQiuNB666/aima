"""看图：把眼镜的小图发给 OpenAI 兼容的视觉模型，返回一句话 + 结构化地形判断。

环境变量（三个都要）：
  SHELLOS_LLM_BASE   例如 https://api.openai.com/v1 或 EvoMap 的兼容端点
  SHELLOS_LLM_KEY
  SHELLOS_LLM_MODEL  一个能看图的模型名
没配就返回 None，仪表盘只显示图。纯标准库 urllib，不加依赖。
"""
from __future__ import annotations
import base64
import json
import os
import urllib.request

PROMPT = ("你是一台髋关节助行外骨骼的眼睛。看这张第一视角照片，判断穿戴者接下来几步会遇到什么地形。"
          "只输出 JSON：{\"terrain\":\"flat|stairs_up|stairs_down|slope_up|slope_down|obstacle|unknown\","
          "\"confidence\":0到1,\"say\":\"给穿戴者的一句话提醒，15 字以内\"}")


def configured() -> bool:
    return all(os.environ.get(k) for k in ("SHELLOS_LLM_BASE", "SHELLOS_LLM_KEY", "SHELLOS_LLM_MODEL"))


def look(image_path: str, timeout: float = 20.0) -> dict | None:
    if not configured():
        return None
    b64 = base64.b64encode(open(image_path, "rb").read()).decode()
    body = {
        "model": os.environ["SHELLOS_LLM_MODEL"],
        "max_tokens": 120,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
    }
    req = urllib.request.Request(
        os.environ["SHELLOS_LLM_BASE"].rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["SHELLOS_LLM_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    s = text[text.find("{"): text.rfind("}") + 1]
    try:
        return json.loads(s)
    except Exception:  # noqa: BLE001
        return {"terrain": "unknown", "confidence": 0, "say": text[:40]}
