"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const {chromium} = require(process.env.LAZYFISH_BROWSER_MODULE);
const fixture = JSON.parse(fs.readFileSync(process.env.LAZYFISH_BROWSER_FIXTURE, "utf8"));
(async () => {
  const browser = await chromium.launch({executablePath:process.env.LAZYFISH_BROWSER_EXECUTABLE, headless:true, args:["--no-sandbox"]});
  const page = await browser.newPage({viewport:{width:1200,height:1000}, locale:"zh-CN"}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(fixture.url + "/?conversation=" + fixture.chat);
    await page.locator("#token").fill(fixture.token); await page.locator("#login button").click();
    const gallery = page.locator(".turn .output-artifacts"), inline = page.locator(".reply-image img");
    await gallery.waitFor();
    assert.equal(await gallery.locator(".output-artifact").count(), 3);
    assert.equal(await gallery.locator("figcaption").filter({hasText:"linked.png"}).count(), 1);
    assert.equal(await gallery.locator("figcaption").filter({hasText:"inline.png"}).count(), 0);
    assert.equal(await page.getByRole("link", {name:"查看截图", exact:true}).count(), 1);
    assert.equal(await inline.count(), 1);
    async function checkImages(selector, maxWidth, maxHeight) {
      for (const image of await page.locator(selector).all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(el => el.decode());
        const size = await image.evaluate(el => ({width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height,
          ratio:el.naturalWidth/el.naturalHeight, fit:getComputedStyle(el).objectFit}));
        assert.ok(size.width > 0 && size.width <= maxWidth+1 && size.height > 0 && size.height <= maxHeight+1, JSON.stringify(size));
        assert.ok(Math.abs(size.width/size.height - size.ratio) < 0.02, JSON.stringify(size));
        assert.equal(size.fit, "contain");
      }
    }
    await checkImages(".reply-image img", 360, 240);
    await checkImages(".output-image img", 320, 220);
    await page.screenshot({path:fixture.output + "/compact-images-desktop.png"});
    await gallery.locator("img").first().click();
    const viewer = page.locator(".image-viewer"); await viewer.waitFor();
    const large = viewer.locator("img"); await large.evaluate(el => el.decode());
    assert.ok((await large.boundingBox()).width > 320);
    await page.screenshot({path:fixture.output + "/compact-images-expanded.png"});
    await page.keyboard.press("Escape"); await viewer.waitFor({state:"detached"});
    await inline.click(); await viewer.waitFor(); await page.keyboard.press("Escape"); await viewer.waitFor({state:"detached"});
    await page.setViewportSize({width:390, height:850});
    await checkImages(".reply-image img", 360, 200);
    await checkImages(".output-image img", 320, 220);
    assert.ok(await gallery.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await page.screenshot({path:fixture.output + "/compact-images-mobile.png"});
    await page.reload(); await gallery.waitFor();
    assert.equal(await gallery.locator(".output-artifact").count(), 3);
    assert.deepEqual(errors, []);
    console.log("compact image outputs passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
