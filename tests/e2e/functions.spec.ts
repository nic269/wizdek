import { expect, type Page, test } from "@playwright/test";
import { prisma } from "../../packages/database/src/client";
import {
  createOrganization,
  createTestSuffix,
  signUp,
} from "./support/user-flows";

const WORKBENCH_URL_PATTERN = /\/functions\/[a-z0-9]+$/;
const TOKEN_PREFIX = /^wfn_/;

const SAMPLE_MAIN =
  "export function main(orderId: string, limit: number = 10, dryRun: boolean = false) { console.log(orderId); return { orderId, limit }; }";
const CHANGED_MAIN =
  "export function main(customer: string) { return customer; }";

const editorText = (page: Page) =>
  page.getByTestId("code-editor").locator(".view-lines");

/**
 * Replaces the open file's text by typing it. The editor closes brackets
 * and quotes as they are typed and types over them, so the result matches.
 */
const replaceEditorText = async (page: Page, text: string) => {
  await editorText(page).click();
  // The browser profile reports Windows, so the editor selects all with
  // Control+A whatever system the tests run on.
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
};

const createFunction = async (page: Page, name: string) => {
  await page.goto("/functions");
  await page.getByRole("button", { name: "New function" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Function name").fill(name);
  await dialog.getByRole("button", { name: "Create function" }).click();
  await expect(page).toHaveURL(WORKBENCH_URL_PATTERN);
  await expect(editorText(page)).toContainText("main");
};

const saveButton = (page: Page) =>
  page.getByRole("button", { exact: true, name: "Save" });

// The workbench with its file tree, editor and side panel is a desktop surface.
test.skip(
  ({ isMobile }) => isMobile,
  "The functions editor is a desktop tool."
);

test("an author writes, saves, reopens and runs a TypeScript function", async ({
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await signUp({
    email: `fn-author-${suffix}@example.com`,
    name: "Function Author",
    page,
  });
  await createOrganization({ name: `Function Studio ${suffix}`, page });
  await createFunction(page, "Order check");

  await replaceEditorText(page, SAMPLE_MAIN);
  await expect(editorText(page)).toContainText("dryRun");
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel("New file path").fill("lib/util.ts");
  await page.getByLabel("New file path").press("Enter");
  await expect(page.getByRole("tab", { name: "util.ts" })).toBeVisible();
  await page.keyboard.type("export const twice = (n: number) => n * 2;");
  await expect(editorText(page)).toContainText("twice");
  await expect(saveButton(page)).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+S");
  await expect(saveButton(page)).toBeDisabled();

  // The form comes from the signature of main, with its defaults.
  await expect(page.getByRole("textbox", { name: "orderId" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "limit" })).toHaveValue(
    "10"
  );
  await expect(page.getByRole("checkbox", { name: "dryRun" })).toBeVisible();

  // Both files are there after a reload.
  await page.reload();
  await expect(page.getByTestId("file-index.ts")).toBeVisible();
  await page.getByTestId("file-lib/util.ts").click();
  await expect(editorText(page)).toContainText("twice");

  // Changing the signature changes the form.
  await page.getByTestId("file-index.ts").click();
  await replaceEditorText(page, CHANGED_MAIN);
  await expect(editorText(page)).toContainText("customer");
  await saveButton(page).click();
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "customer" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "orderId" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "customer" }).fill("Ada");
  await page
    .getByRole("button", { exact: true, name: "Run ⌘↵" })
    .last()
    .click();
  await expect(page.getByText("Run #1")).toBeVisible();
  await expect(page.getByTestId("run-output")).toContainText("hello");
  await expect(page.getByTestId("run-result")).toContainText('"ok": true');

  await page.getByRole("button", { exact: true, name: "History" }).click();
  await expect(page.getByTestId("history-run-1")).toContainText("Succeeded");

  expect(errors).toEqual([]);
});

test("the editor accepts the imports the runner resolves and flags missing files", async ({
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  await signUp({
    email: `fn-imports-${suffix}@example.com`,
    name: "Import Author",
    page,
  });
  await createOrganization({ name: `Import Studio ${suffix}`, page });
  await createFunction(page, "Imports");

  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel("New file path").fill("lib/util.ts");
  await page.getByLabel("New file path").press("Enter");
  await page.keyboard.type(
    "export const plus = (a: number, b: number) => a + b;"
  );
  await page.getByTestId("file-index.ts").click();
  const errors = page.getByTestId("code-editor").locator(".squiggly-error");

  await replaceEditorText(
    page,
    'import { plus } from "./lib/utils";\nexport function main() { return plus(1, 1); }'
  );
  await expect(errors).not.toHaveCount(0);

  // Without an extension, with `.ts` and from a package all pass; the one
  // deliberate type error shows the checker has run over the new text.
  await replaceEditorText(
    page,
    'import { plus } from "./lib/util";\nimport { plus as add } from "./lib/util.ts";\nimport { thing } from "some-package";\nconst wrong: number = "text";\nexport function main(limit: number) { return plus(add(1, 1), limit) + thing + wrong; }'
  );
  await expect(errors).toHaveCount(1);
});

test("packages from package.json install, show their log and are used by runs", async ({
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  await signUp({
    email: `fn-packages-${suffix}@example.com`,
    name: "Package Author",
    page,
  });
  await createOrganization({ name: `Package Studio ${suffix}`, page });
  await createFunction(page, "Uses ms");

  await replaceEditorText(
    page,
    'import ms from "ms";\nexport function main() { return ms("2h"); }'
  );
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel("New file path").fill("package.json");
  await page.getByLabel("New file path").press("Enter");
  await page.keyboard.type('{"dependencies": {"ms": "2.1.3"');
  await page.keyboard.press("ControlOrMeta+S");
  await expect(saveButton(page)).toBeDisabled();

  // Installing takes a while on a real runner.
  await expect(page.getByTestId("packages-ready")).toBeVisible({
    timeout: 120_000,
  });
  await page.getByText("Install log").click();
  await expect(page.getByTestId("packages-log")).not.toBeEmpty();

  await page
    .getByRole("button", { exact: true, name: "Run ⌘↵" })
    .last()
    .click();
  await expect(page.getByText("Run #1")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "History" }).click();
  await expect(page.getByTestId("history-run-1")).toContainText("Succeeded", {
    timeout: 30_000,
  });
});

test("variables, the HTTP trigger and schedules are set up from the side panel", async ({
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const secret = `e2e-secret-${suffix}`;

  await signUp({
    email: `fn-triggers-${suffix}@example.com`,
    name: "Function Triggers",
    page,
  });
  await createOrganization({ name: `Function Triggers ${suffix}`, page });
  await createFunction(page, "Triggered");
  const functionId = page.url().split("/").at(-1) ?? "";

  // A variable shows by name only.
  await page.getByRole("button", { exact: true, name: "Variables" }).click();
  await page.getByLabel("Variable name").fill("api_key");
  await expect(page.getByLabel("Variable name")).toHaveValue("API_KEY");
  await page.getByLabel("Variable value").fill(secret);
  await page.getByRole("button", { name: "Save variable" }).click();
  await expect(page.getByTestId("env-var")).toContainText("API_KEY");
  await expect(page.getByText(secret)).toHaveCount(0);

  // The token is shown once, and calling the URL with it runs the function.
  await page.getByRole("button", { exact: true, name: "Triggers" }).click();
  await page.getByRole("button", { name: "Turn on" }).click();
  const token = (await page.getByTestId("http-token").textContent()) ?? "";
  expect(token).toMatch(TOKEN_PREFIX);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`…${token.slice(-4)}`)).toBeVisible();

  const refused = await page.request.post(`/api/fn/${functionId}`, {
    data: { name: "outside" },
    headers: { "x-function-token": "wfn_wrong" },
  });
  expect(refused.status()).toBe(401);
  const called = await page.request.post(`/api/fn/${functionId}`, {
    data: { name: "outside" },
    headers: { "x-function-token": token },
  });
  expect(called.status()).toBe(200);
  expect(await called.json()).toMatchObject({
    result: { ok: true },
    status: "SUCCEEDED",
  });

  // A schedule with the function's parameters.
  await page.getByRole("button", { name: "Add schedule" }).click();
  await page.getByLabel("Cron").fill("0 6 * * *");
  await page.getByLabel("Time zone").fill("Asia/Ho_Chi_Minh");
  await page.getByRole("textbox", { name: "name" }).fill("nightly");
  await page.getByRole("button", { exact: true, name: "Add schedule" }).click();
  const schedule = page.getByTestId("schedule");
  await expect(schedule).toContainText("0 6 * * *");
  await expect(schedule).toContainText("Asia/Ho_Chi_Minh");
  await schedule.getByRole("checkbox", { name: "Enabled" }).click();
  await expect(
    schedule.getByRole("checkbox", { name: "Enabled" })
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Delete schedule 0 6 * * *" }).click();
  await expect(schedule).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "History" }).click();
  await expect(page.getByTestId("history-run-1")).toContainText("HTTP");

  expect(errors).toEqual([]);
});

test("the page says when functions are not enabled", async ({
  page,
}, testInfo) => {
  const suffix = createTestSuffix(testInfo);
  await signUp({
    email: `fn-off-${suffix}@example.com`,
    name: "Function Owner",
    page,
  });
  await createOrganization({ name: `Functions Off ${suffix}`, page });

  // Stands in for a server without a runner configured.
  await page.route("**/functions/status", (route) =>
    route.fulfill({
      json: { data: { enabled: false, reachable: false, runtimes: [] } },
    })
  );
  await page.goto("/functions");
  await expect(page.getByText("Functions are not enabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "New function" })).toHaveCount(
    0
  );
});

test("someone who may only read functions gets a read-only editor", async ({
  browser,
  page,
}, testInfo) => {
  test.slow();
  const suffix = createTestSuffix(testInfo);
  const readerEmail = `fn-reader-${suffix}@example.com`;
  await signUp({
    email: `fn-owner-${suffix}@example.com`,
    name: "Function Owner",
    page,
  });
  await createOrganization({ name: `Reader Studio ${suffix}`, page });
  await createFunction(page, "Read me");
  const functionUrl = page.url();
  const functionId = functionUrl.split("/").at(-1) as string;

  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  try {
    await signUp({
      email: readerEmail,
      name: "Function Reader",
      page: readerPage,
    });

    const fn = await prisma.codeFunction.findUniqueOrThrow({
      where: { id: functionId },
    });
    const role = await prisma.role.create({
      data: {
        name: `Function readers ${suffix}`,
        organizationId: fn.organizationId,
        permissions: { create: [{ action: "read", module: "functions" }] },
      },
    });
    const reader = await prisma.user.findUniqueOrThrow({
      where: { email: readerEmail },
    });
    await prisma.membership.create({
      data: {
        organizationId: fn.organizationId,
        roleId: role.id,
        userId: reader.id,
      },
    });

    await readerPage.goto(functionUrl);
    await expect(editorText(readerPage)).toContainText("main");
    await expect(readerPage.getByText("Read-only")).toBeVisible();
    await expect(saveButton(readerPage)).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "Run ⌘↵" })
    ).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "New file" })
    ).toHaveCount(0);

    await editorText(readerPage).click();
    await readerPage.keyboard.type("typed by a reader");
    await expect(editorText(readerPage)).not.toContainText("typed by a reader");
  } finally {
    await readerContext.close();
  }
});
