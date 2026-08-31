---
name: AG Vitest component mocks
description: Large AG page tests must avoid asynchronous partial mocks of the generated API client.
---

Use explicit synchronous API-client mocks in large AG page tests; an async `vi.importActual()` partial mock can leave the Vitest worker blocked before test callbacks run.

**Why:** The project-detail regression suite imported a large component graph and stayed at 0/N tests when the generated client was partially mocked asynchronously, while a synchronous mock completed deterministically.

**How to apply:** Return every runtime export used by the page and its rendered child components, including generated constants; keep the mock data and callbacks local to the test.