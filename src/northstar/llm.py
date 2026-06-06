import northstar.api as api
from typing import Any, List, Dict, Optional, Generator, AsyncGenerator

class LLMService:
    """
    A robust LLM service wrapper around LiteLLM that automatically
    integrates with NorthStar's native tracing, usage, and cost tracking.
    """
    def __init__(self, default_model: str = "gpt-4o-mini"):
        try:
            import litellm
            self.litellm = litellm
        except ImportError:
            raise ImportError(
                "LiteLLM is required to use LLMService. "
                "Install it with `pip install litellm` or `uv add 'northstar-ai[pricing]'`."
            )
        self.default_model = default_model

    def generate(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Any = "auto",
        temperature: float = 0.3,
        **kwargs
    ) -> Any:
        """
        Synchronous model generation with native NorthStar telemetry.
        """
        model_name = model or self.default_model
        
        with api.model_call("llm.generate", model=model_name) as span:
            span.record_input_messages(messages)
            try:
                response = self.litellm.completion(
                    model=model_name,
                    messages=messages,
                    tools=tools,
                    tool_choice=tool_choice if tools else None,
                    temperature=temperature,
                    **kwargs
                )
                
                # Record the output message natively
                span.record_output_message(response.choices[0].message.model_dump())
                
                # Record usage (cost is automatically calculated by NorthStar's pricing module)
                if hasattr(response, "usage") and response.usage:
                    span.record_usage(
                        prompt_tokens=response.usage.prompt_tokens,
                        completion_tokens=response.usage.completion_tokens,
                    )
                return response
            except Exception:
                # Exceptions are automatically caught and logged by NorthStar's span context manager
                raise

    async def agenerate(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Any = "auto",
        temperature: float = 0.3,
        **kwargs
    ) -> Any:
        """
        Asynchronous model generation with native NorthStar telemetry.
        """
        model_name = model or self.default_model
        
        with api.model_call("llm.agenerate", model=model_name) as span:
            span.record_input_messages(messages)
            try:
                response = await self.litellm.acompletion(
                    model=model_name,
                    messages=messages,
                    tools=tools,
                    tool_choice=tool_choice if tools else None,
                    temperature=temperature,
                    **kwargs
                )
                
                span.record_output_message(response.choices[0].message.model_dump())
                
                if hasattr(response, "usage") and response.usage:
                    span.record_usage(
                        prompt_tokens=response.usage.prompt_tokens,
                        completion_tokens=response.usage.completion_tokens,
                    )
                return response
            except Exception:
                raise

    def stream(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Any = "auto",
        temperature: float = 0.3,
        **kwargs
    ) -> Generator[Any, None, None]:
        """
        Synchronous streaming generation with native NorthStar telemetry.
        Tracks content progressively and reports usage/cost automatically.
        """
        model_name = model or self.default_model
        
        with api.model_call("llm.stream", model=model_name) as span:
            span.record_input_messages(messages)
            try:
                # Include stream usage if not provided, allowing LiteLLM to report token counts
                if "stream_options" not in kwargs:
                    kwargs["stream_options"] = {"include_usage": True}
                    
                response = self.litellm.completion(
                    model=model_name,
                    messages=messages,
                    tools=tools,
                    tool_choice=tool_choice if tools else None,
                    temperature=temperature,
                    stream=True,
                    **kwargs
                )
                
                full_content = ""
                for chunk in response:
                    # Accumulate content
                    if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                        full_content += chunk.choices[0].delta.content
                    
                    # Accumulate usage if present in the chunk
                    if hasattr(chunk, "usage") and chunk.usage:
                        span.record_usage(
                            prompt_tokens=chunk.usage.prompt_tokens,
                            completion_tokens=chunk.usage.completion_tokens,
                        )
                        
                    yield chunk
                
                # Record the full aggregated message at the end
                span.record_output_message({"role": "assistant", "content": full_content})
            except Exception:
                raise

    async def astream(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Any = "auto",
        temperature: float = 0.3,
        **kwargs
    ) -> AsyncGenerator[Any, None]:
        """
        Asynchronous streaming generation with native NorthStar telemetry.
        Tracks content progressively and reports usage/cost automatically.
        """
        model_name = model or self.default_model
        
        with api.model_call("llm.astream", model=model_name) as span:
            span.record_input_messages(messages)
            try:
                if "stream_options" not in kwargs:
                    kwargs["stream_options"] = {"include_usage": True}
                    
                response = await self.litellm.acompletion(
                    model=model_name,
                    messages=messages,
                    tools=tools,
                    tool_choice=tool_choice if tools else None,
                    temperature=temperature,
                    stream=True,
                    **kwargs
                )
                
                full_content = ""
                async for chunk in response:
                    # Accumulate content
                    if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                        full_content += chunk.choices[0].delta.content
                    
                    # Accumulate usage if present in the chunk
                    if hasattr(chunk, "usage") and chunk.usage:
                        span.record_usage(
                            prompt_tokens=chunk.usage.prompt_tokens,
                            completion_tokens=chunk.usage.completion_tokens,
                        )
                        
                    yield chunk
                
                span.record_output_message({"role": "assistant", "content": full_content})
            except Exception:
                raise
