# Readiness Fingerprint Contract

This contract defines the exact canonical inputs used by both the live-audit artifact producer and runtime readiness validator. Fingerprints are not plain hashes: each value is `hmac-sha256:<lowercase hex>` computed with the external `READINESS_FINGERPRINT_KEY`.

## Common rules

- Encode canonical input as UTF-8.
- Normalize human-entered strings to Unicode NFC, then trim leading/trailing ASCII whitespace.
- Use the exact fixed field order shown below, one `name=value` pair per line, LF (`0x0a`) separators, and no trailing LF.
- Reject CR/LF or NUL inside any value rather than escaping it.
- Produce lowercase hexadecimal HMAC-SHA-256 and compare decoded bytes in constant time.
- The artifact producer and runtime use the same implementation/module. The artifact stores only the resulting `hmac-sha256:<hex>` values.

## Current-value sources

| Fingerprint | Runtime sources |
|---|---|
| Chatwoot | Normalized `CHATWOOT_BASE_URL`; live version fetched using the artifact's `chatwoot.version_probe`; configured account/inbox IDs and identifier verified through the local Application API; artifact signing-contract fields; current `CHATWOOT_WEBHOOK_SECRET`. |
| Telnyx sender | `TELNYX_SENDER_NUMBER` normalized to E.164. |
| Telnyx profile | Lowercase canonical UUID from `TELNYX_MESSAGING_PROFILE_ID`. |
| Ingress | Normalized `PUBLIC_INGRESS_ORIGIN` plus lowercase 64-hex `PUBLIC_INGRESS_CERT_SPKI_SHA256` from the deployed TLS certificate check. |

The Chatwoot signing contract is read from the validated artifact because it is the audit result used to construct the verifier. Environment drift is detected through the live version/account/inbox probes, current webhook secret contribution, short artifact expiry, and ingress/provider fingerprints. A failed live probe is not-ready, never a reason to reuse cached success.

## Normalization

- `base_url` and `origin`: parse as URL; lowercase scheme/host; remove default port; reject userinfo, query and fragment; remove a single trailing slash; `base_url` may retain an audited same-instance path prefix, while ingress must be an origin with path `/` only.
- `version`: exact trimmed value returned by the live-audited version probe.
- IDs: unsigned base-10 without leading zeroes.
- `inbox_identifier`: NFC plus trim; case preserved.
- Header names: lowercase ASCII.
- Algorithm and digest encoding: lowercase audit tokens.
- `canonical_bytes`: the exact non-secret audit token defined for the observed construction, not executable template text.
- Nullable signing values: literal `none`.
- Boolean: `true` or `false`.
- Sender: canonical E.164 with leading `+`.
- UUID: lowercase hyphenated canonical form.
- SPKI digest: lowercase 64-hex SHA-256 without a prefix.

## Signing-contract digest

For HMAC-supported Chatwoot, first build:

```text
signing-contract-v1
signature_header=<normalized value>
timestamp_header=<normalized value or none>
delivery_id_header=<normalized value or none>
algorithm=<normalized value>
digest_encoding=<normalized value>
canonical_bytes=<exact audited token>
freshness_seconds=<unsigned decimal or none>
```

`signing_contract_sha256` is lowercase SHA-256 of these exact bytes. For unsupported HMAC, the readiness artifact cannot have `status=pass`, so no ready Chatwoot fingerprint is produced.

## Chatwoot fingerprint

```text
chatwoot-v1
base_url=<normalized URL>
version=<live-probed version>
account_id=<decimal>
inbox_id=<decimal>
inbox_identifier=<normalized identifier>
hmac_supported=true
signing_contract_sha256=<64 lowercase hex>
webhook_secret_sha256=<SHA-256 of current secret bytes>
```

The inner secret hash is never stored or logged; it exists only in the HMAC preimage. This binds readiness to the current secret without exposing it in the artifact.

## Telnyx sender fingerprint

```text
telnyx-sender-v1
sender=<canonical E.164>
```

## Telnyx messaging-profile fingerprint

```text
telnyx-profile-v1
messaging_profile_id=<lowercase canonical UUID>
```

## Ingress fingerprint

```text
ingress-v1
origin=<normalized HTTPS origin>
certificate_spki_sha256=<64 lowercase hex>
```

## Deterministic test vector

Key bytes (UTF-8): `test-readiness-key`

Observed signing contract:

```text
signing-contract-v1
signature_header=x-chatwoot-signature
timestamp_header=x-chatwoot-timestamp
delivery_id_header=x-chatwoot-delivery
algorithm=hmac-sha256
digest_encoding=hex-lower
canonical_bytes=timestamp-dot-raw-body
freshness_seconds=300
```

- Signing-contract SHA-256: `9f3bf0766a1e9b0e0913ddaec244a7913af6f90b70f607477c203df1fddf4afc`
- SHA-256 of test secret `test-webhook-secret`: `d4d0f3c54b0f3c0b500bf62607b52f14d91882a1fa855c210f36e649cc32430c`
- Chatwoot input uses base URL `http://localhost:3001`, version `3.13.0`, account `1`, inbox `2`, identifier `jama-sms`: `hmac-sha256:aa3d326d1bf5bdc1240301b8747868b6d759063859e004a7072749326e9db42c`
- Sender `+15551234567`: `hmac-sha256:331a36062d25b3d3902874a02761f9c998963382ff37e877877b5a89254dddf8`
- Profile `11111111-2222-3333-4444-555555555555`: `hmac-sha256:aa519c3ddad2c8b912de57e71e32bd1b75cb2bb41ebc12a9366ae1a36eeec6af`
- Ingress `https://sms.example.test` with SPKI digest of 64 `a` characters: `hmac-sha256:617c77e674627dd0608309c476243bd032e20e11d274b1e1eaaa8e8ff41b6a4f`

Any implementation that produces different bytes for these fixtures is incompatible and must fail its contract tests.
