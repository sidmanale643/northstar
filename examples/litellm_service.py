"""
Example of using NorthStar's native LLMService wrapper.

This example demonstrates how the LLMService automatically traces
calls, computes usage, and calculates costs.
"""
import os
import northstar
from northstar.llm import LLMService

# Make sure you have valid credentials set, either in your environment
# or by explicitly passing them to `northstar.init()`.
# export NORTHSTAR_API_KEY="..."
# export NORTHSTAR_PROJECT_ID="..."

def main():
    # Initialize the NorthStar client to capture telemtry
    # We use client API to directly manage sessions and runs to manually record events
    client = northstar.Northstar(
        api_key=os.environ.get("NORTHSTAR_API_KEY", "test_key"),
        project_id=os.environ.get("NORTHSTAR_PROJECT_ID", "testproject123456789"),
        capture=northstar.CaptureOptions(user_input=True, final_response=True),
    )
    
    # Initialize the global state so LLMService picks up the active client
    northstar.init(
        api_key=os.environ.get("NORTHSTAR_API_KEY", "test_key"),
        project_id=os.environ.get("NORTHSTAR_PROJECT_ID", "testproject123456789"),
    )

    # Instantiate the LLMService (defaults to gpt-4o-mini)
    llm = LLMService(default_model="gpt-4o-mini")

    print("Sending synchronous request to LLMService...")
    # Wrap our agent's flow in a traced run
    with client.session() as session:
        with session.run("my_llm_agent") as run:
            
            run.record_user_input("What is the capital of France?")
            
            # The generate call automatically creates a model_span, 
            # calculates token usage, captures response content, and adds it to the current trace!
            try:
                response = llm.generate(
                    messages=[{"role": "user", "content": "What is the capital of France?"}],
                    temperature=0.0
                )
                
                # We can extract the response string easily
                answer = response.choices[0].message.content
                run.record_final_response(answer)
                
                print(f"Response: {answer}")
            except Exception as e:
                print(f"Exception occurred (expected if OPENAI_API_KEY is not set): {e}")
        
    # Send pending telemetry to the backend
    northstar.flush()
    print("Telemetry flushed to NorthStar backend!")

if __name__ == "__main__":
    main()
