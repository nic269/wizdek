---
phase: 2
title: "Phase 2: Storage Streaming"
status: todo
priority: P1
effort: "1d"
dependencies: []
---

# Phase 2: Storage Streaming

## Context Links

- Interface: `packages/storage/src/provider.ts` (`StorageProvider`)
- Providers: `packages/storage/src/providers/local.ts`, `s3.ts`, `memory.ts`
- Existing tests: `packages/storage/src/provider.test.ts`
- Current caller that buffers: `packages/flows/src/services/uploads.ts` (10 MB CSV limit, unaffected)

## Overview

Let storage write and read an object as a stream, so a multi-gigabyte archive never sits in memory.

## Key Insights

- `putObject` takes `body: Uint8Array` and `getObject` returns one. Both providers load the whole object.
- An archive's size is not known to S3 before upload unless it is read from a file first. `@aws-sdk/lib-storage`'s `Upload` handles a stream of unknown length with multipart upload; `PutObjectCommand` does not.
- The local provider's `resolveKey` already strips parent-directory prefixes; the stream methods must go through the same function.

## Requirements

- New provider methods, implemented by local, S3 and memory:
  - `putObjectStream({ key, contentType, body: Readable, metadata? })` returns `StoredObject` with the real byte count.
  - `getObjectStream({ key })` returns `{ body: Readable, contentType, key, provider, sizeBytes }`.
- A failed or aborted stream write leaves no object at the key.
- Existing `putObject` and `getObject` keep their behaviour.

## Architecture

```ts
interface PutObjectStreamInput {
  body: Readable;
  contentType: string;
  key: string;
  metadata?: Record<string, string>;
}
type StoredObjectStream = StoredObject & { body: Readable };

interface StorageProvider {
  /* existing members */
  getObjectStream(input: GetObjectInput): Promise<StoredObjectStream>;
  putObjectStream(input: PutObjectStreamInput): Promise<StoredObject>;
}
```

- **Local:** pipe into `createWriteStream` on `<path>.partial`, then rename to the final path. On error, remove the partial file. Read with `stat` plus `createReadStream`.
- **S3:** `Upload` from `@aws-sdk/lib-storage` with `ServerSideEncryption: "AES256"` to match `putObject`, a fixed part size and a small queue. On error, call `abort()` so no incomplete multipart upload is left. Read with `GetObjectCommand` and return `response.Body` as a Node stream with `ContentLength`.
- **Memory:** collect chunks into a buffer; serve reads with `Readable.from`.

## Related Code Files

- Modify: `packages/storage/src/provider.ts`, `packages/storage/src/providers/local.ts`, `packages/storage/src/providers/s3.ts`, `packages/storage/src/providers/memory.ts`
- Modify: `packages/storage/src/provider.test.ts`
- Modify: `packages/storage/package.json` (add `@aws-sdk/lib-storage` at the same version line as the other AWS packages)

## Implementation Steps

1. Add the two input and result types and the two interface members.
2. Implement the local provider with the partial-file-then-rename write.
3. Implement the memory provider.
4. Implement the S3 provider with `Upload`, counting bytes as they pass so `sizeBytes` is exact.
5. Tests for local and memory: round-trip a stream; a source stream that errors midway leaves no object and no `.partial` file; a key with `../` segments stays inside the root.
6. Memory-bound test for local: write a 256 MB generated stream while sampling `process.memoryUsage().rss`; assert the peak growth stays well under the object size.
7. Check how `provider.test.ts` exercises S3 today and extend it the same way. If it has no live S3 coverage, verify the S3 stream path by hand against a real bucket or an S3-compatible endpoint and record the result in the phase todo; do not add a stubbed client that only proves the stub.

## Todo

- [x] Interface and types added
- [x] Local provider streams with atomic rename
- [x] Memory provider implemented
- [x] S3 provider streams with multipart upload and abort on failure
- [x] Round-trip, failure-cleanup and path-safety tests
- [x] Memory-bound test
- [x] S3 stream path verified and the method recorded here (against an `adobe/s3mock` container: 40 MiB multipart round trip with a matching hash; a failing source leaves no object and no open multipart upload)

## Success Criteria

- `pnpm --filter @repo/storage test` passes, including the memory-bound test.
- `pnpm check-types` passes across the workspace (every `StorageProvider` implementation and any test double satisfies the wider interface).

## Risk Assessment

- **The memory-bound test is flaky on a loaded machine.** Use a generous threshold (growth under half the object size) so it only fails on real buffering.
- **S3 path is not covered by automated tests.** Stated honestly in the todo; the local provider is the one the driving use case runs on first.
- **Other code implements `StorageProvider`.** Typecheck finds every implementation that must add the methods.

## Security Considerations

- Stream writes use the same key sanitising and the same server-side encryption header as buffered writes.

## Next Steps

Phase 4 writes archives with `putObjectStream`. Phase 5 serves downloads with `getObjectStream` or a signed URL.
