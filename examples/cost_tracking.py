"""Track token usage and USD cost for LLM calls.

Run with:
    uv run --extra pricing python examples/cost_tracking.py
"""

import northstar


northstar.init(project="cost-tracking-demo", environment="dev")


@northstar.observe("retrieve-docs")
def retrieve_docs(query: str) -> list[str]:
    return [f"Doc about {query}"]


@northstar.trace("cost-tracked-agent", tags=["example", "pricing"])
def run_agent(query: str) -> str:
    messages = [
        {"role": "system", "content": "You answer questions about tracing."},
        {"role": "user", "content": query},
    ]

    with northstar.model_call("answer-llm", model="gpt-4o") as llm:
        llm.record_input_messages(messages)
        response_text = "NorthStar captures LLM cost in run metadata."
        llm.record_output_message(
            {"role": "assistant", "content": response_text},
        )

    docs = retrieve_docs(query)
    return f"{response_text} (sources: {len(docs)})"


print(run_agent("How does cost tracking work?"))
print(f"Total cost: {northstar.pricing.format_cost(0.0023)}")
northstar.flush(timeout=5)
