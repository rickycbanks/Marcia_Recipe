import { expect, test } from "@playwright/test";

test("health endpoint is available", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test("first-run setup is reachable", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: /welcome to marcia recipe/i })).toBeVisible();
  await expect(page.getByLabel("Setup token")).toBeVisible();
});
