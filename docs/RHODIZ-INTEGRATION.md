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
- CopilotKit Intelligence is disabled as a conversation store in RHODIZ mode even if a key is configured.
- Chat hydration is read-only from RHODIZ `/api/rhodiz/openmuse/conversation`; OpenMuse does not persist a parallel `conversations/default` history.

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
7. The shell hydrates the main transcript through OpenMuse's authenticated proxy to RHODIZ canonical history.
8. CopilotKit's AG-UI runtime forwards the same verified bearer to the RHODIZ AG-UI bridge.
9. Successful turns persist in RHODIZ; the shell performs no local conversation-history write in RHODIZ mode.

RHODIZ lockout/rate-limit policy still applies because authentication uses the existing `/auth/login` endpoint.

## Current shadow restrictions

The RHODIZ AG-UI bridge is intentionally narrower than the full OpenMuse runtime:

- text chat and RHODIZ streaming are enabled;
- RHODIZ conversation IDs are deterministically bound to the OpenMuse thread and owner;
- MemoryOS and RHODIZ persistence remain active and are the only canonical runtime history/memory boundary;
- OpenMuse local conversation persistence is disabled in RHODIZ mode;
- tool execution through this bridge is currently disabled;
- RHODIZ browser availability is projected from the canonical `/api/rhodiz/computer/estado` endpoint;
- OpenMuse's local Browser worker and local Linux Computer routes are fail-closed in RHODIZ mode;
- browser navigation/takeover remains disabled until RHODIZ confirmation-ticket and receipt semantics are explicitly adapted;
- no OpenMuse approval state can authorize a RHODIZ side effect;
- no production deployment or HIL certification is implied by this integration branch.

Tools will only be enabled after cancellation, approval, receipt and idempotency semantics map cleanly into RHODIZ Action Fabric.

## Work and outcome projection

In `AUTH_BACKEND=rhodiz`, OpenMuse does not run a second durable Work engine:

- the local OpenMuse `TaskWorker` is not started;
- task lists/details are read-only projections of owner-scoped RHODIZ `/api/rhodiz/tareas`;
- proactive notifications are read-only projections of RHODIZ `/api/rhodiz/proactividad/avisos`;
- local OpenMuse Tasks, Goals, Ideas, Monitors, approvals and Activity records are not surfaced as RHODIZ state;
- OpenMuse task creation, resume/retry/input/approval, Goals, Ideas and Monitors fail closed until a canonical RHODIZ Work/Outcome contract is certified;
- task cancellation may be relayed to the canonical RHODIZ cancel endpoint because it reduces authority and does not authorize an external effect;
- RHODIZ confirmation tickets and pending action identifiers are never copied into the OpenMuse projection.

This is an authority-removal slice, not a Work promotion. File-producing Work remains blocked by the upstream durability/idempotency gate tracked in the RHODIZ OpenSpec.

## Verification

The RHODIZ-auth slice is covered by tests that verify:

- login returns the canonical RHODIZ bearer and stable owner without creating a second OpenMuse session;
- bearer validation uses the RHODIZ session endpoint;
- rejected/expired RHODIZ sessions fail closed;
- AG-UI forwards the verified per-user bearer and does not fall back to a static agent token;
- legacy/local OpenMuse authentication behavior remains supported when `AUTH_BACKEND` is unset or `local`;
- RHODIZ hydration returns canonical messages while local `PUT /api/conversation` persistence is not used;
- the proxy rejects history payloads that do not assert `canonical: "rhodiz"`;
- a configured CopilotKit Intelligence key cannot enable Rich Threads ownership in RHODIZ mode.
- a configured OpenMuse browser worker cannot become active in RHODIZ mode; canonical browser health comes only from RHODIZ.
- `/api/browsers/*` and `/api/computer/*` local effects return fail-closed in RHODIZ mode.

## Slice provenance

- OpenMuse upstream rechecked before this slice: `CopilotKit/openmuse@d0b3a6b3ea461bc938a5dea6c46e65eefdb1b933`.
- Approved RHODIZ pin remains `2c83474b1a504dd5af8756225e6b461ee89aeca6`; no newer upstream code is implicitly imported.
- RHODIZ canonical-history counterpart was reconciled against `RHODIZ-IA@1fd29075d3cf51d08c8828ed207d2f66da527e74`.
- Work file-producing durability remains blocked on upstream OpenMuse issue #32 / PR #45 until that fix is merged, audited and revalidated.

The integration remains a branch/PR candidate until its exact SHA passes the required RHODIZ gates.

## Supply-chain compatibility hardening

The RHODIZ fork pins the following transitive security remediations in
`pnpm-workspace.yaml` and `pnpm-lock.yaml`:

- `undici 5.29.0 -> 6.28.1`;
- `image-size 1.2.1 -> 2.0.3`;
- `uuid 7.0.3 -> 11.1.1`.

Metro `0.83.3` historically passes a filesystem path to `image-size`, while
`image-size 2.x` accepts image bytes. The compatibility change is kept as the
versioned pnpm patch `patches/metro@0.83.3.patch`: Metro reads the asset bytes
before invoking `image-size`. This does not grant OpenMuse any RHODIZ authority
and does not change runtime routing.

Certification for this override set must include a frozen-lockfile install,
`pnpm audit --prod`, full tests, Biome, root/mobile typecheck, server build,
web export, and iOS prebuild without dependency installation.
