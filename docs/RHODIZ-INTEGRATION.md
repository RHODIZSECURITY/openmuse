# RHODIZ sovereign integration

This fork can run the OpenMuse Experience Shell while RHODIZ remains the canonical assistant.

## Authority boundary

When `AUTH_BACKEND=rhodiz`:

- RHODIZ authenticates the user and owns the stable user ID.
- RHODIZ/Hermes owns the conversational runtime.
- MemoryOS remains the only canonical runtime memory.
- RHODIZ Policy / Action Fabric remains the only authority for external effects.
- OpenMuse does not mint a second user session for the same person.
- The OpenMuse server revalidates each bearer against `GET /api/rhodiz/sesion`.
- The verified bearer is forwarded to the raw AG-UI endpoint; a static `AGENT_TOKEN` is ignored in this mode.
- CopilotKit Intelligence remains optional. It is not the canonical conversation store in RHODIZ mode.

## Required configuration

```dotenv
AUTH_BACKEND=rhodiz
RHODIZ_API_URL=http://127.0.0.1:8080
AGENT_BACKEND=agui
AGENT_URL=http://127.0.0.1:8080/api/rhodiz/openmuse/agui
```

Do not set `AGENT_TOKEN` in RHODIZ mode. The OpenMuse server forwards the already verified per-user RHODIZ bearer instead.

## Sign-in flow

1. The app reads `/api/health` and discovers `authBackend: "rhodiz"`.
2. The native/web shell asks for the RHODIZ username and password.
3. OpenMuse proxies those credentials to RHODIZ `POST /auth/login`.
4. RHODIZ returns its normal signed bearer and stable `user_id`.
5. OpenMuse returns only that RHODIZ bearer to the shell; it does not persist a parallel OpenMuse session.
6. Every OpenMuse API request revalidates the bearer against RHODIZ before using the stable RHODIZ user ID as the OpenMuse storage owner.
7. CopilotKit's AG-UI runtime forwards the same verified bearer to the RHODIZ AG-UI bridge.

RHODIZ lockout/rate-limit policy still applies because authentication uses the existing `/auth/login` endpoint.

## Current shadow restrictions

The RHODIZ AG-UI bridge is intentionally narrower than the full OpenMuse runtime:

- text chat and RHODIZ streaming are enabled;
- RHODIZ conversation IDs are deterministically bound to the OpenMuse thread and owner;
- MemoryOS and RHODIZ persistence remain active;
- tool execution through this bridge is currently disabled;
- no OpenMuse approval state can authorize a RHODIZ side effect;
- no production deployment or HIL certification is implied by this integration branch.

Tools will only be enabled after cancellation, approval, receipt and idempotency semantics map cleanly into RHODIZ Action Fabric.

## Verification

The RHODIZ-auth slice is covered by tests that verify:

- login returns the canonical RHODIZ bearer and stable owner without creating a second OpenMuse session;
- bearer validation uses the RHODIZ session endpoint;
- rejected/expired RHODIZ sessions fail closed;
- AG-UI forwards the verified per-user bearer and does not fall back to a static agent token;
- legacy/local OpenMuse authentication behavior remains supported when `AUTH_BACKEND` is unset or `local`.

The integration remains a branch/PR candidate until its exact SHA passes the required RHODIZ gates.
