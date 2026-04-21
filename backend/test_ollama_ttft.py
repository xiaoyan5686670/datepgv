"""
直接测 Ollama TTFT，绕过 LiteLLM。
用法：python test_ollama_ttft.py <ollama_host>
示例：python test_ollama_ttft.py http://192.168.1.100:11434
"""
import sys
import time
import json
import requests

OLLAMA_BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
MODEL = "qwen2.5-coder:32b"


def test_ttft(label, messages):
    total_chars = sum(len(m["content"]) for m in messages)
    print(f"\n{'='*60}")
    print(f"{label}")
    print(f"  {len(messages)} messages, {total_chars} chars")
    print(f"{'='*60}")

    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.1},
    }

    t0 = time.perf_counter()
    first_token_t = None
    token_count = 0
    full_text = ""

    try:
        resp = requests.post(
            f"{OLLAMA_BASE}/api/chat",
            json=payload,
            stream=True,
            timeout=300,
        )
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            data = json.loads(line)
            content = data.get("message", {}).get("content", "")
            if content and first_token_t is None:
                first_token_t = time.perf_counter()
                ttft_ms = (first_token_t - t0) * 1000
                print(f"  ✅ TTFT: {ttft_ms:.0f} ms")
            if content:
                full_text += content
                token_count += 1
            if data.get("done"):
                break
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return

    total_ms = (time.perf_counter() - t0) * 1000
    gen_ms = total_ms - (ttft_ms if first_token_t else 0)
    tps = token_count / (gen_ms / 1000) if gen_ms > 100 else 0
    print(f"  Total: {total_ms:.0f} ms | Tokens: {token_count} | Gen TPS: {tps:.1f}")
    print(f"  Preview: {full_text[:150]}")


# ===== Test 1: 短 prompt（基线） =====
test_ttft("Test 1: 短 prompt（基线）", [
    {"role": "user", "content": "你好，1+1等于几？只回答数字。"},
])

# ===== Test 2: 中等 prompt（模拟业务，~6600 chars） =====
sys_prompt = (
    "你是一个 SQL 助手。根据用户问题生成 PostgreSQL 查询。只生成 SELECT 语句。\n"
    + "规则：使用标准 SQL，添加 WHERE 条件，使用 JOIN 连接表。\n" * 30
)

user_prompt = (
    "表结构如下：\n"
    + "orders: id(int), customer_id(int), order_date(date), total_amount(decimal), status(varchar)\n" * 10
    + "customers: id(int), name(varchar), email(varchar), phone(varchar), province(varchar)\n" * 10
    + "products: id(int), name(varchar), category(varchar), price(decimal)\n" * 10
    + "\n问题：查询每个省份的总订单金额，按金额降序排列"
)

history = []
for i in range(5):
    history.append({"role": "user", "content": f"查询问题{i+1}：按月统计订单数量"})
    history.append({"role": "assistant", "content": f"SELECT DATE_TRUNC('month', order_date) AS m, COUNT(*) FROM orders GROUP BY 1 ORDER BY 1 -- round {i+1}"})

msgs_medium = [{"role": "system", "content": sys_prompt}] + history + [{"role": "user", "content": user_prompt}]
test_ttft("Test 2: 业务级 prompt (~6600 chars, 12 msgs)", msgs_medium)

# ===== 结论 =====
print(f"\n{'='*60}")
print("对比 Test1 和 Test2 的 TTFT：")
print("  如果 Test2 TTFT < 5s → Ollama 没问题，瓶颈在 LiteLLM")
print("  如果 Test2 TTFT > 20s → Ollama 本身 prefill 慢")
print(f"{'='*60}")
