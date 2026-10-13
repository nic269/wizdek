# Flows

A flow is a small automation that runs against one connected store. It starts from a trigger, passes items from step to step, and records what happened to every item at every step.

The example used throughout: upload a CSV of orders, and tag each order whose total is above 1,000.

## Who can do what

| Action | Permission | Has it by default |
|--------|------------|-------------------|
| See flows, runs and items | `flows:read` | Owner, Admin, Member, Viewer |
| Start and cancel runs, upload files | `flows:run` | Owner, Admin, Member |
| Create and edit flows | `flows:manage` | Owner, Admin |

Running a flow changes store data through its action steps, with everything the store's access token is allowed to do. Give `flows:run` to people you would trust with that store.

## Building a flow

Open **Flows**, type a name and choose **Create flow**. The builder has three parts: the palette of steps on the left, the canvas in the middle, and the settings of the selected step on the right.

1. **Add steps.** Click a palette entry to add it to the right of the existing steps, or drag it onto the canvas.
2. **Connect them.** Drag from a step's output handle (right edge) to another step's input handle (left edge), or click one handle and then the other. A connection that would form a loop, connect a step to itself, or lead into a trigger is refused.
3. **Configure each step.** Select a step to edit its settings. Problems appear under the form and as a red count on the step.
4. **Validate.** Lists everything that must be fixed before the flow can run, and takes you to the step.
5. **Save.** Each save creates a new version. A flow may be saved with problems; it cannot be run until they are fixed.

If someone else saved the flow while you were editing, your save is refused and a dialog offers to reload. Your changes stay on the canvas until you choose to reload.

To delete a step or a connection, select it and press Delete or Backspace. Without `flows:manage` the canvas is read-only.

### The example, step by step

| Step | Settings |
|------|----------|
| Manual trigger | One input: label `CSV file`, key `csvFile`, type CSV file |
| Parse CSV | File: `{{ $json.csvFile }}` |
| Find order | By order name; value `{{ $json.Order }}` |
| If | `{{ $json.Total }}` is greater than `1000`, compared as number |
| Add tags (on the **true** output) | Resource `{{ $json.order.id }}`; tag `high-value` |

The CSV needs a header row with the columns the flow reads, here `Order` and `Total`.

## Templates

Settings that accept a template can read values from the item being processed:

| Template | Reads |
|----------|-------|
| `{{ $json.Total }}` | The field `Total` of the current item |
| `{{ $json["Order Name"] }}` | A field whose name has spaces or symbols |
| `{{ $json.order.id }}` | A nested field |
| `{{ $json.tags[0] }}` | An entry of a list |
| `{{ $trigger.csvFile }}` | A value the run was started with |
| `{{ $run.id }}` | The run's id; also `flowId`, `storeId`, `organizationId` |

A setting that is exactly one template keeps the value's type, so a number stays a number. Mixed text such as `Order {{ $json.Order }}` becomes text. A path that does not exist gives an empty value. Templates only look values up: they cannot calculate or call anything.

After a flow has run once, the settings panel offers the field names it saw at that step as shortcuts.

## Step reference

| Step | What it does | Outputs |
|------|--------------|---------|
| **Manual trigger** | Starts the flow when someone runs it. Declares the inputs to ask for: a CSV file, text or a number. Each is available as `{{ $json.<key> }}`. | `main` |
| **Parse CSV** | Reads an uploaded file and emits one item per row, keyed by column name. Options: delimiter, whether the first row is a header (otherwise columns are `column1`, `column2`, …), trimming, skipping empty rows. Each item also carries `$row`, the row number as a spreadsheet shows it. | `main` |
| **If** | Sends each item to `true` or `false`. Conditions compare as text or as number; all must match, or any. Comparing as number accepts amounts like `$1,250.00`, treating commas as thousands separators, and fails the item when the value is not a number. | `true`, `false` |
| **Find order** | Looks an order up by name (`#1001`) or id and adds it to the item as `order` with `id`, `name`, `tags`, `totalPrice` and `currencyCode`. Fails the item when no order matches. | `main` |
| **Add tags** | Adds tags to an order, customer, product or draft order. Tags already present are left alone, so running it again changes nothing. Fails the item when Shopify reports a problem. | `main` |
| **Shopify webhook** | Starts the flow when the store sends a webhook for the chosen topic, such as `ORDERS_CREATE`. The webhook's payload is the item. Needs activation; see below. | `main` |
| **Schedule** | Starts the flow on a cron schedule in a chosen time zone. The item holds `scheduledAt`. Needs activation. | `main` |
| **Filter** | Keeps items that match its conditions and drops the rest. Same conditions as If. | `main` |
| **Switch** | Compares one value against named cases and sends the item to the first case it equals. Each case is an output; items matching none leave by `default`. | one per case, plus `default` |
| **Set fields** | Renames fields, then adds or overwrites fields (as text, number, yes/no, or whatever the template gives), then removes fields. | `main` |
| **GraphQL request** | Runs any Admin GraphQL query or mutation for each item. Variables are JSON whose text values may contain templates. The response, or the part named by the result path, is added to the item as `result`. `userErrors` fail the item. | `main` |
| **Bulk mutation** | Runs one mutation for all items as a single Shopify bulk operation: uploads every item's variables, starts the operation, waits for it, and records each item's result. Suited to tens of thousands of items. | `main` |

## Flows that start by themselves

A flow whose trigger is **Shopify webhook** or **Schedule** has no Run button. It has **Activation** instead: choose a store and activate. From then on the flow starts by itself for that store, and each start appears in **Runs** like any other run, started by "Automatic".

- An activation uses the version that was saved when you activated. After editing the flow, save and activate again.
- One flow can be activated on several stores. Each is turned on and off separately.
- If Shopify or the scheduler refuses, the activation is shown as Failed with the reason.
- Disconnecting a store turns off the flows activated on it first.

**Webhooks.** Activating creates a webhook subscription in the store, and deactivating removes it. Two things must be in place:

- The server needs a public address Shopify can reach, set as `SHOPIFY_WEBHOOK_BASE_URL` (a deployed host, or a tunnel during development). Without it, webhook activation is refused; schedules and everything else still work.
- Shopify signs each webhook with the app's client secret. Stores connected through a registered app already have it. For a store connected by a pasted token, save the secret first under **Stores → Add webhook secret**.

Each delivery starts one run. Shopify may send the same delivery more than once; a repeat is recognised and starts nothing. A delivery with a missing or wrong signature is rejected and nothing is recorded.

**Schedules.** A cron expression has five fields: minute, hour, day of month, month, day of week. `0 6 * * *` means every day at 06:00 in the chosen time zone. A schedule fires at most once a minute, within about a minute of the time. If the server is down at the scheduled time, that firing is skipped.

## Running a flow

In the builder, choose **Run**. Pick the store, provide the trigger's inputs (a CSV file is uploaded first) and start. Run is unavailable while the flow has unsaved changes or problems. The run uses the saved version, and later edits to the flow do not change it.

Runs for the same store go one at a time, in the order they were started. Runs for different stores go side by side.

The run page shows the flow as it was when the run started. Each step shows its status and how many items it received, how many succeeded and how many failed. Each connection shows how many items travelled along it. Select a step to list its items; filter by status, page through them, and open an item's input and output. The page refreshes by itself while the run is active.

**Runs** in the builder lists every run of the flow with its status, store, who started it, duration and item counts.

### Run statuses

| Status | Meaning |
|--------|---------|
| Queued | Waiting to start, for example behind another run for the same store |
| Running | In progress |
| Succeeded | Every item succeeded |
| Partially failed | The run finished, and at least one item failed or has an unknown outcome |
| Failed | A step could not work at all, for example because the store rejected its credentials. Items not yet processed stay pending. |
| Canceled | Someone canceled it. The item in progress finished and the rest stay pending. |

### Item statuses

| Status | Meaning |
|--------|---------|
| Pending | Waiting to be processed |
| In progress | Being processed by a step whose effect must not be repeated |
| Succeeded | Done; its output was handed to the next step |
| Failed | Something was wrong with this item. The message says what: an unknown order, a value that is not a number, an error from Shopify. Other items are not affected. |
| Unknown | The run was interrupted while this item was being processed by a step that must not be repeated. It may or may not have been applied. Check the store before doing it again. |

## What happens when something is interrupted

A run survives a restart of the server. Every item's outcome is saved as it happens, and when the server comes back the run carries on from the first item without a saved outcome. An item whose outcome was saved is never processed again.

One case needs explaining. A call to Shopify can succeed an instant before the server stops, before its outcome is saved. What happens next depends on the step:

- A step that is safe to repeat, such as Find order or Add tags, simply processes the item again. Adding a tag that is already there changes nothing.
- A step that is not safe to repeat marks the item as in progress before the call. On restart such an item becomes **Unknown** and is left alone, because repeating it could apply the change twice.

Steps that only read, and Add tags, are safe to repeat. Two steps are not:

- **GraphQL request** with a mutation. A query is repeated freely; a mutation is sent once per item, and an item interrupted mid-request becomes Unknown.
- **Bulk mutation**. The whole batch is submitted once. After a restart the step goes back to waiting for the operation it already started; it does not submit again. If the server stopped at the very moment of submitting, so that it cannot tell whether Shopify received the batch, every item becomes Unknown. If the operation itself ends as failed or canceled, the items are Unknown too, because part of it may have been applied.

After a crash a run resumes within about a minute and a half. After a clean restart it resumes within seconds.

When Shopify throttles requests, the run waits and continues. Throttling does not fail items.

## Limits

| Limit | Value |
|-------|-------|
| Steps per flow | 100 |
| Items per run | 100,000 |
| Size of one item | 1 MB |
| Uploaded file | 10 MB, CSV only |
| Items per page in the run view | 50 |
| Webhook payload | 5 MB |
| Bulk mutation upload | 100 MB (Shopify's limit) |

Measured once with a 10,000-row CSV against the test store stand-in (no network delay): the run of 20,002 items finished in 48 seconds, the run page's data loaded in 16 ms, and item pages loaded in 5 to 16 ms, including the hundredth page.

A webhook payload larger than 1 MB is accepted, but fails as an item at the trigger, because items are limited to 1 MB.

Shopify runs up to five bulk mutations at a time per store on API versions from 2026-01, and one at a time on earlier versions. A bulk operation has 24 hours to finish.

## Authoring mutations

The GraphQL request and Bulk mutation steps let a flow's author write any mutation the store's token allows. People with `flows:run`, and triggers, then execute it. Treat `flows:manage` as the permission to decide what flows may do to a store.

## Data kept by runs

Run items hold the rows of uploaded files, webhook payloads and the data read from the store, which can include customer data. They are visible to everyone with `flows:read` in the organization and are kept indefinitely for now. Uploaded files are read only by the run; there is no download link for them.

## Related

- [Architecture: flow engine](./architecture.md#flow-engine) covers the item model and how steps are added.
- [Decision 0004](./decisions/0004-durable-jobs-on-pg-boss.md) covers the job queue runs execute on.
