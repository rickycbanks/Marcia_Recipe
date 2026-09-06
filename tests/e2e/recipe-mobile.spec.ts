import { expect, test } from "@playwright/test";
import sharp from "sharp";

// Opt in against a disposable data directory; this test creates an owner.
test("mobile recipe entry and automatic batch photos", async ({ page }, testInfo) => {
  test.skip(!process.env.RECIPE_MOBILE_TEST, "Requires an isolated application data directory");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/setup");
  await page.getByLabel("Setup token").fill("e2e-setup-token");
  await page.getByLabel("Username", { exact: true }).fill("mobile-owner");
  await page.getByLabel("Display name").fill("A very long household owner display name");
  await page.getByLabel("Password (min 10 characters)", { exact: true }).fill("mobile-test-password");
  await page.getByLabel("Confirm password").fill("mobile-test-password");
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page.waitForURL("/");
  await page.goto("/admin/recipes/new");
  await page.getByLabel("Title", { exact: true }).fill("Mobile photo test");
  await page.getByLabel("Ingredient 1 name", { exact: true }).fill("Flour");
  await page.getByLabel("Step 1", { exact: true }).fill("Mix ingredients.");
  for (const width of [320, 375, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 850 });
  const image = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#8c4a2f" } }).png().toBuffer();
  const photo = (name: string) => ({ name, mimeType: "image/png", buffer: image });
  await page.getByLabel("Choose photos", { exact: true }).setInputFiles([
    photo("first.png"), { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") }, photo("second.png"),
  ]);
  await expect(page.getByRole("status").filter({ hasText: "2 photos added" })).toBeVisible();
  await expect(page.locator("#photos img")).toHaveCount(2);
  await expect(page.locator("#photos [role=alert]")).toContainText("broken.png");
  await page.getByLabel("Choose photos", { exact: true }).setInputFiles(photo("broken.png"));
  await expect(page.getByRole("status").filter({ hasText: "1 photo added" })).toBeVisible();
  await expect(page.locator("#photos img")).toHaveCount(3);
  await page.getByRole("button", { name: "Create recipe", exact: true }).click();
  await page.waitForURL(/\/admin\/recipes\/[^/]+\/edit#photos$/);
  await expect(page.locator("#photos img")).toHaveCount(3);
  await page.getByLabel("Choose photos", { exact: true }).setInputFiles([photo("third.png"), photo("fourth.png")]);
  await expect(page.getByRole("status").filter({ hasText: "2 photos added" })).toBeVisible();
  await expect(page.locator("#photos img")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#photos").screenshot({ path: testInfo.outputPath("mobile-photos.png") });
  await page.getByRole("group", { name: "Ingredients", exact: true }).screenshot({ path: testInfo.outputPath("mobile-ingredients.png") });
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#photos button[aria-label^='Remove image']").first().click();
  await expect(page.locator("#photos img")).toHaveCount(4);
  await page.reload();
  await expect(page.locator("#photos img")).toHaveCount(4);
});
