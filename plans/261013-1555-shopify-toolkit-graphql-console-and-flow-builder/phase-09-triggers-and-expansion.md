---
phase: 9
title: "Phase 9: Triggers and Expansion"
status: todo
priority: P2
effort: "5d"
dependencies: [3, 5, 6, 7, 8]
---

# Phase 9: Triggers and Expansion

## Context Links

- Webhook verification to port: `/Volumes/anh.nguyen/Projects/b8/project-evisu-oms-v2/packages/shopify/src/webhooks/verify-shopify-webhook.ts` (base64 HMAC of the raw body)
- Webhook dedupe model already in the schema: `WebhookEvent` (`@@unique([provider, externalId])`) in `packages/database/prisma/schema.prisma`
- Scheduling from phase 5: `schedule` and `unschedule` on `JobQueueProvider`
- Node contract from phase 6: `outputs` as a function of config, `mode: "batch"`, `ctx.stepState`
- Classifier from phase 2: `packages/shopify/src/graphql/classify-operation.ts`
- Raw-body route precedent: the plain Hono handlers in `packages/api/src/app.ts`

## Overview

Start flows without a person: Shopify webhooks and cron schedules. Widen the node catalog through the registry alone, and add a bulk-operation node for very large batches.

## Key Insights

- A flow becomes event-driven when it is activated for a store. One flow can be activated on several stores, each activation owning its webhook subscription or schedule.
- Shopify signs webhooks with the app's client secret. Stores connected through the app registry already have it. Static-token stores do not, so they need the secret supplied before a webhook flow can be activated on them.
- The boilerplate's `verifyHmacSignature` compares hex digests; Shopify sends base64. The evisu helper is the correct one to port.
- Shopify retries webhooks and can deliver duplicates; the delivery id is the dedupe key.
- Per-item mutations on a standard-plan store run at about ten per second. A bulk mutation uploads all inputs once and lets Shopify process them, which suits runs of tens of thousands of items but is a different execution shape (one call for all items, then polling).

## Requirements

Functional:

- Activate and deactivate a flow for a store. Activation requires a valid saved version whose trigger is `trigger.webhook` or `trigger.schedule`.
- `trigger.webhook`: config `topic`; activation creates the subscription in Shopify, deactivation deletes it; each delivery starts one run whose trigger item is the payload.
- `trigger.schedule`: config `cron` and `timezone`; each firing starts one run.
- New nodes, each added without touching `packages/flows/src/engine/`: `shopify.graphql`, `logic.filter`, `logic.switch`, `data.setFields`, `shopify.bulkMutation`.
- Static-token stores can store a webhook signing secret.

Non-functional:

- The webhook endpoint verifies the signature over the raw body before doing anything else with the payload, answers within Shopify's timeout by enqueueing work, and ignores duplicate deliveries.
- A bulk node survives a restart by continuing to poll the operation it already submitted.

## Architecture

New model and column:

```prisma
enum FlowActivationStatus { ACTIVE FAILED INACTIVE }

model FlowActivation {
  id String @id @default(cuid())
  flowId String
  storeId String
  flowVersionId String
  status FlowActivationStatus
  webhookSubscriptionId String?
  error String? @db.Text
  activatedById String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([flowId, storeId])
}
// ShopifyStore gains: webhookSecretEncrypted String? @db.Text
```

Webhook path:

```text
activate -> webhookSubscriptionCreate(topic, { callbackUrl: {SHOPIFY_WEBHOOK_BASE_URL}/api/webhooks/shopify/{activationId}, format: JSON })
POST /api/webhooks/shopify/:activationId        (plain Hono route, raw body, 5 MB limit)
  load activation + store (404 if unknown or inactive)
  secret = app client secret (registry stores) | store webhook secret (static-token stores)
  verify X-Shopify-Hmac-Sha256 over the raw bytes       -> 401 on mismatch
  check X-Shopify-Shop-Domain and X-Shopify-Topic match the activation
  insert WebhookEvent(provider "shopify", externalId = delivery id) -> duplicate: 200, stop
  enqueue flow run (triggerPayload = parsed body) -> 200
```

Schedule path: activation calls `schedule({ name: "flow-schedule", key: activationId, cron, timezone })`; the handler starts a run with `{ scheduledAt }` as the trigger item; deactivation calls `unschedule`. An invalid cron expression is returned as a validation error on activation.

Nodes:

| Node | Notes |
|------|-------|
| `shopify.graphql` | Config: document, variables as JSON with templates, optional result path. `idempotent` is true for queries and false for mutations (decided by the classifier), so interrupted mutations become `UNKNOWN`. `userErrors` fail the item. |
| `logic.filter` | Same condition model as IF; one output; non-matching items are dropped. |
| `logic.switch` | Compares one value against named cases; `outputs` is computed from config plus `default`. |
| `data.setFields` | Sets, renames and removes fields with templates and type coercion. |
| `shopify.bulkMutation` | `mode: "batch"`. Builds JSONL from all items, stages the upload, starts the bulk mutation, stores the operation id in `stepState`, polls to completion, maps result lines back to items in order. |

API: `flows.activations.list`, `flows.activations.activate`, `flows.activations.deactivate` (`flows:manage`); `shopifyStores.setWebhookSecret` (`stores:manage`).

UI: an Activate control in the builder toolbar with a store picker and the list of activations and their status; a webhook-secret field on static-token stores; config forms for the two triggers and for `logic.switch` and `shopify.graphql`; the generic form serves the rest.

## Related Code Files

- Create: `packages/shopify/src/webhooks/verify-shopify-webhook.ts`, `packages/shopify/src/webhooks/subscriptions.ts`, with tests
- Create: `packages/flows/src/nodes/trigger-webhook.ts`, `trigger-schedule.ts`, `shopify-graphql.ts`, `logic-filter.ts`, `logic-switch.ts`, `data-set-fields.ts`, `shopify-bulk-mutation.ts`, with tests
- Create: `packages/flows/src/services/activations.ts`, `packages/flows/src/engine/schedule-job.ts`, `packages/flows/integration/triggers.integration.test.ts`
- Create: `packages/api/src/shopify-webhook-route.ts` with tests; one Prisma migration `flow_activations`
- Create: `apps/app/app/flows/[flowId]/activation-panel.tsx`, `config-forms/trigger-webhook-form.tsx`, `trigger-schedule-form.tsx`, `switch-form.tsx`, `shopify-graphql-form.tsx`
- Modify: `packages/database/prisma/schema.prisma`, `packages/flows/src/nodes/index.ts`, `packages/flows/src/definition/validate.ts` (trigger-specific rules only), `packages/api/src/contracts/flows.ts`, `packages/api/src/routers/flows.ts`, `packages/api/src/contracts/shopify-stores.ts`, `packages/api/src/routers/shopify-stores.ts`, `packages/api/src/jobs.ts`, `packages/api/src/app.ts`, `packages/shopify/src/keys.ts` (`SHOPIFY_WEBHOOK_BASE_URL`), `.env.example`, `turbo.json`, `apps/api/env.ts`
- Modify: `packages/shopify/src/testing/fake-shopify-server.ts` (subscriptions, staged uploads, bulk operations), `docs/flows.md`, `docs/stores.md`

## Implementation Steps

1. Port `verifyShopifyWebhookHmac` and write `subscriptions.ts` (create and delete a subscription for a topic and callback URL).
2. Add `FlowActivation`, the store column and `SHOPIFY_WEBHOOK_BASE_URL`; migrate.
3. Write `activations.ts`: activation validates the flow, creates the subscription or schedule, and records failure text when Shopify refuses; deactivation removes it. Both are idempotent.
4. Add the webhook route to `app.ts` ahead of the oRPC handler, reading the body as bytes. Test with signed fixtures: valid, tampered body, wrong secret, wrong shop header, duplicate delivery id, unknown activation.
5. Add `trigger-webhook.ts` and `trigger-schedule.ts`, the `flow-schedule` job, and trigger-specific validation.
6. Add the activation API and UI, and the webhook-secret field for static-token stores. Validation reports a missing secret on such a store as an activation error.
7. Add `logic.filter`, `data.setFields`, `logic.switch`, `shopify.graphql`, each as one node file, its registration, tests, and a bespoke form only where the generic form is insufficient.
8. Confirm with `git diff --stat` that step 7 changed nothing under `packages/flows/src/engine/`.
9. Before writing the bulk node, read the current Shopify documentation for bulk mutations and note the limits that apply (concurrent operations per shop, upload size, supported mutations). Write `shopify-bulk-mutation.ts` in batch mode with resume from `stepState`. Extend the fake server to simulate the staged upload and a bulk operation moving from running to completed.
10. Integration tests: a signed delivery starts exactly one run and a repeat of the same delivery starts none; a schedule firing starts a run; deactivation stops both; the switch routes items to the right handles; a `shopify.graphql` mutation interrupted mid-call leaves the item `UNKNOWN`; the bulk node restarted mid-poll does not resubmit.
11. Manual acceptance on a dev store, through a reachable URL: activate a webhook flow on order creation, create an order, see the run; activate a schedule and see it fire.
12. Update `docs/flows.md` and `docs/stores.md`. Commit.

## Todo

- [x] Webhook verification and subscription helpers
- [x] Activation model, env and migration
- [x] Activation service
- [x] Webhook route with signed-fixture tests
- [x] Webhook and schedule trigger nodes and the schedule job
- [x] Activation API and UI; webhook secret for static-token stores
- [x] Filter, set-fields, switch and generic GraphQL nodes
- [x] Engine directory confirmed untouched by the node additions
- [x] Bulk mutation node with resume
- [x] Integration tests green
- [ ] Manual acceptance on a dev store
- [x] Docs updated; phase committed

## Success Criteria

- Integration tests in step 10 pass.
- The webhook route answers 401 to every unsigned or wrongly signed request and writes nothing for them.
- `git diff --stat` for the commits of step 7 lists no file under `packages/flows/src/engine/`.
- Manual acceptance in step 11 is recorded with the topic, the store and the run ids.
- `pnpm check:ci`, `pnpm check-types`, `pnpm test`, `pnpm boundaries` and `pnpm build` exit 0.

## Risk Assessment

- **No reachable URL in the environment.** Signal: `SHOPIFY_WEBHOOK_BASE_URL` unset. Response: webhook activation is refused with a clear message; schedule triggers and all nodes still work.
- **Bulk mutation limits differ from expectations.** Signal: step 9's documentation read. Response: enforce the documented limits in the node's validation and fail the step with a readable error when a batch exceeds them; splitting a batch across operations is added only if the limit makes the node impractical.
- **Webhook subscriptions outlive a disconnected store.** Signal: deliveries for an inactive activation. Response: the route answers 404 for inactive activations, and disconnecting a store deactivates its activations first.
- **Schedules pile up while the worker is down.** Signal: a burst of runs after a restart. Response: runs for one store are already serialised; document the behaviour.

## Security Considerations

- The webhook endpoint is unauthenticated by design; the signature over the raw body is the authentication. Comparison is constant-time and failures reveal nothing about why.
- The activation id in the URL is not a secret and grants nothing without a valid signature.
- The generic GraphQL node lets anyone with `flows:manage` author mutations that `flows:run` users and triggers execute. This is stated beside both permissions.
- Webhook payloads contain customer data and are stored as run items under the same access rules as other run data.

## Next Steps

Work deferred beyond this plan: retention for run data, a per-user rate limit on the console, expiring-token rollout for a public app, and deployment automation.
