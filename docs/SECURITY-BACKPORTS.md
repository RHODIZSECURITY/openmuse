# RHODIZ OpenMuse security backports

OpenMuse is a subordinate source for RHODIZ IA. Its dependency graph is required
to remain auditable even when upstream packages have published advisories but no
fixed npm release.

## Policy

A registry release is preferred. A local backport is allowed only when all of
the following are true:

1. the advisory has no published fixed release;
2. the vulnerable registry tarball and its integrity are recorded;
3. the backport is pinned to a reviewed upstream pull-request commit;
4. only the security-relevant upstream files plus local provenance metadata are
   changed;
5. a regression test exercises the published vulnerability shape;
6. `pnpm audit --prod`, the full OpenMuse test suite, lint, typechecks and
   server build are green;
7. the backport is removed in favor of an official release as soon as one is
   available and revalidated.

No audit finding is ignored or suppressed.

## node-forge — GHSA-86w9-cpqp-85rv / CVE-2026-85393

- upstream npm package: `node-forge@1.4.0`;
- registry integrity:
  `sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==`;
- GitHub advisory: RSA PKCS#1 v1.5 verification accepts extra nested
  DigestAlgorithm elements;
- patched npm release available at integration time: **none**;
- reviewed upstream candidate: `digitalbazaar/forge#1152`;
- pinned source commit:
  `ceba34402e329f0365134f23fe19898756527d65`;
- local package identity: `1.4.1-rhodiz.1`;
- changed upstream runtime file: `lib/rsa.js`.

The backport adds the missing nested element-count validation. The regression in
`tests/security-backports.test.ts` uses the upstream low-exponent forgery vector
and requires verification to reject it.

## braces — GHSA-vfj7-8cjw-p6xm / CVE-2026-93687

- upstream npm package: `braces@3.0.3`;
- registry integrity:
  `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`;
- GitHub advisory: uncontrolled recursion can exhaust the JS stack;
- patched npm release available at integration time: **none**;
- reviewed upstream candidate: `micromatch/braces#72`;
- pinned source commit:
  `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`;
- local package identity: `3.0.4-rhodiz.1`;
- changed upstream runtime files:
  `lib/constants.js`, `lib/compile.js`, `lib/expand.js`, `lib/parse.js`,
  and `lib/stringify.js`.

The backport limits structural nesting, protects direct AST walkers and rejects
cyclic parent chains. The regression requires depth 101 to fail, depth 100 to
remain accepted and a cyclic parent chain to be rejected.

## Other advisories discovered on 2026-10-08

The same audit refresh exposed registry-fixed versions for transitive
dependencies. They are resolved by exact overrides rather than local forks:

- `argparse@1.0.10 -> 2.0.1`, removing vulnerable `sprintf-js`;
- `katex@0.16.47 -> 0.18.2`;
- `source-map-js@1.2.1 -> 1.2.2`;
- `proxy-addr@2.0.7 -> 2.0.8`;
- `@graphql-tools/utils@11.2.2 -> 12.0.1`;
- `shell-quote@1.10.0 -> 1.11.0`;
- `@modelcontextprotocol/sdk@1.30.0 -> 1.31.0`.

These are covered by the lockfile regression in
`tests/security-backports.test.ts`.
