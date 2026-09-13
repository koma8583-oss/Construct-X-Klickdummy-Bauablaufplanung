---
name: Publication gate test fixtures
description: How to distinguish modern performance requests from legacy publication-gated requests in regression tests.
---

Modern performance requests intentionally ignore compatibility `dataPublicationId` input and are governed by their versioned performance policy. A test for the legacy publication lifecycle gate must explicitly link the publication and clear the performance-policy link, then exercise the legacy root details route; the AN-local projection route does not carry legacy publication linkage.

**Why:** The two flows have different ownership and data boundaries. Treating a modern request as publication-gated makes parallel tests appear order-dependent and can assert a gate that the AN-local projection cannot evaluate.

**How to apply:** When covering `PUBLISHED`/`SUSPENDED`/`WITHDRAWN` publication behavior, construct a genuine legacy row and test the compatibility route. Keep normal service-request tests focused on policy and local projection behavior.