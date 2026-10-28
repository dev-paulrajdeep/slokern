## 2026-10-29 - [Optimization of Async Generators in Serving Adapters]
**Learning:** When building asynchronous wrappers around synchronous generators that simulate delays, using synchronous blocking calls (like `time.sleep`) inside the wrapped generator will starve the asyncio event loop.
**Action:** Always allow internal mechanisms to bypass synchronous delays (e.g., via a `simulate_delay` flag passed via kwargs) and reimplement the delays in the async wrapper using non-blocking operations (e.g., `await asyncio.sleep`) based on latency metadata yielded by the chunks or responses.
