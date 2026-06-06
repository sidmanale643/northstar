import northstar


northstar.init(project="research-agent", environment="dev")


@northstar.observe("retrieve-docs")
def retrieve_docs(query: str) -> list[str]:
    northstar.log_event("retrieval_started", {"query": query})
    return ["NorthStar captures agent traces."]


@northstar.observe("generate-answer")
def generate_answer(query: str, docs: list[str]) -> str:
    northstar.log_metric("retrieval_count", len(docs))
    return f"{query}: {docs[0]}"


@northstar.trace("market-research-agent", tags=["example"])
def run_agent(query: str) -> str:
    northstar.log_metadata({"source": "example"})
    docs = retrieve_docs(query)
    return generate_answer(query, docs)


print(run_agent("How does tracing work?"))

with northstar.model_call("summarise", model="gpt-4o") as llm:
    llm.record_input_messages([{"role": "user", "content": "summarise"}])
    llm.record_output_message({"role": "assistant", "content": "short"})

northstar.flush(timeout=5)
