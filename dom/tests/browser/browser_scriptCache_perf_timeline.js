const URL_BASE = "https://example.com/browser/dom/tests/browser/";
const URL_BASE2 = "https://example.net/browser/dom/tests/browser/";

function testFields(
  entry,
  { hasBodyAccess, hasTimingAccess, isCacheOf },
  desc
) {
  Assert.equal(entry.entryType, "resource", "entryType should be available");
  Assert.equal(
    entry.initiatorType,
    "script",
    "initiatorType should be available"
  );

  if (hasTimingAccess) {
    Assert.equal(
      entry.nextHopProtocol,
      "http/1.1",
      `nextHopProtocol should be available for ${desc}`
    );
  } else {
    Assert.equal(
      entry.nextHopProtocol,
      "",
      `nextHopProtocol should be hidden for ${desc}`
    );
  }

  if (hasBodyAccess) {
    Assert.equal(
      entry.responseStatus,
      200,
      `responseStatus should be available for ${desc}`
    );
  } else {
    Assert.equal(
      entry.responseStatus,
      0,
      `responseStatus should be hidden for ${desc}`
    );
  }

  if (hasBodyAccess) {
    Assert.equal(
      entry.contentType,
      "text/javascript",
      `contentType should be available for ${desc}`
    );
  } else {
    Assert.equal(
      entry.contentType,
      "",
      `contentType should be hidden for ${desc}`
    );
  }

  Assert.greater(
    entry.startTime,
    0,
    `startTime should be non-zero for ${desc}`
  );
  Assert.greater(
    entry.responseEnd,
    0,
    `responseEnd should be non-zero for ${desc}`
  );
  Assert.lessOrEqual(
    entry.startTime,
    entry.responseEnd,
    `startTime <= responseEnd for ${desc}`
  );

  if (hasTimingAccess) {
    Assert.deepEqual(
      entry.serverTiming,
      [
        { name: "name1", duration: 0, description: "" },
        { name: "name2", duration: 20, description: "" },
        { name: "name3", duration: 30, description: "desc3" },
      ],
      `serverTiming should be available for ${desc}`
    );
  } else {
    Assert.deepEqual(
      entry.serverTiming,
      [],
      `serverTiming should be hidden for ${desc}`
    );
  }

  if (hasBodyAccess) {
    Assert.greater(
      entry.encodedBodySize,
      0,
      `encodedBodySize should be available for ${desc}`
    );
  } else {
    Assert.equal(
      entry.encodedBodySize,
      0,
      `encodedBodySize should be hidden for ${desc}`
    );
  }

  if (isCacheOf) {
    Assert.equal(
      entry.encodedBodySize,
      isCacheOf.encodedBodySize,
      `encodedBodySize should equal to non-cache case for ${desc}`
    );
  }

  if (hasBodyAccess) {
    Assert.greater(
      entry.decodedBodySize,
      0,
      `decodedBodySize should be available for ${desc}`
    );
  } else {
    Assert.equal(
      entry.decodedBodySize,
      0,
      `decodedBodySize should be hidden for ${desc}`
    );
  }

  if (isCacheOf) {
    Assert.equal(
      entry.decodedBodySize,
      isCacheOf.decodedBodySize,
      `decodedBodySize should equal to non-cache case for ${desc}`
    );
  }

  if (hasTimingAccess) {
    if (isCacheOf) {
      Assert.equal(
        entry.transferSize,
        0,
        `transferSize should be zero for ${desc}`
      );
    } else if (hasBodyAccess) {
      Assert.greater(
        entry.transferSize,
        300,
        `transferSize should be non-zero +300 for ${desc}`
      );
    } else {
      Assert.equal(
        entry.transferSize,
        300,
        `transferSize should be zero +300 for ${desc}`
      );
    }
  } else {
    Assert.equal(
      entry.transferSize,
      0,
      `transferSize should be hidden for ${desc}`
    );
  }
}

async function doTestCompleteCacheAfterReload(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE + "perf_server.sjs?cacheable";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        // NOTE: entries[0].toJSON() doesn't convert serverTiming items.
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
        },
        "same origin (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntry.name, JS_URL);
      testFields(
        cacheEntry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
          isCacheOf: entry,
        },
        "same origin (cached)"
      );
    }
  );
}

add_task(async function testScriptCompleteCacheAfterReload() {
  await doTestCompleteCacheAfterReload("script");
});
add_task(async function testModuleCompleteCacheAfterReload() {
  await doTestCompleteCacheAfterReload("module");
});

async function doTestCompleteCacheInSameDocument(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE + "perf_server.sjs?cacheable";

      const task = async (url, type) => {
        // Before reload:
        //   * The first load is not cache
        //   * The second load is complete cache
        // After reload:
        //   * Both loads are complete cache

        for (let i = 0; i < 2; i++) {
          await new Promise(resolve => {
            const script = content.document.createElement("script");
            script.src = url;
            if (type === "module") {
              script.type = "module";
            }
            script.addEventListener("load", () => {
              resolve();
            });
            content.document.head.append(script);
          });
        }

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        // In contrast to CSS, classic scripts perform "fetch" for both.
        // Module scripts become singleton, and only one "fetch" happens.
        if (type === "script") {
          if (entries.length != 2) {
            throw new Error(
              `Expect two entries, got ${entries.length} entries`
            );
          }
        } else if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries));
      };

      const entries = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entries[0].name, JS_URL);
      if (type === "script") {
        Assert.equal(entries[1].name, JS_URL);
      }
      testFields(
        entries[0],
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
        },
        "same origin (non-cached)"
      );
      if (type === "script") {
        testFields(
          entries[1],
          {
            hasBodyAccess: true,
            hasTimingAccess: true,
            isCacheOf: entries[0],
          },
          "same origin (cached)"
        );
      }

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntries = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntries[0].name, JS_URL);
      if (type === "script") {
        Assert.equal(cacheEntries[1].name, JS_URL);
      }
      testFields(
        cacheEntries[0],
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
          isCacheOf: entries[0],
        },
        "same origin (cached)"
      );
      if (type === "script") {
        testFields(
          cacheEntries[1],
          {
            hasBodyAccess: true,
            hasTimingAccess: true,
            isCacheOf: entries[0],
          },
          "same origin (cached)"
        );
      }
    }
  );
}

add_task(async function testScriptCompleteCacheInSameDocument() {
  await doTestCompleteCacheInSameDocument("script");
});
add_task(async function testModuleCompleteCacheInSameDocument() {
  await doTestCompleteCacheInSameDocument("module");
});

async function doTestNoCacheReload(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE + "perf_server.sjs?";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
        },
        "same origin (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      // Reloading the JS shouldn't hit any cache.

      const reloadEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(reloadEntry.name, JS_URL);
      testFields(
        reloadEntry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
        },
        "same origin (non-cached)"
      );
    }
  );
}

add_task(async function testScriptNoCacheReload() {
  await doTestNoCacheReload("script");
});
add_task(async function testModuleNoCacheReload() {
  await doTestNoCacheReload("module");
});

async function doTest_NoCORS(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE2 + "perf_server.sjs?cacheable";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: false,
          hasTimingAccess: false,
        },
        "cross origin (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntry.name, JS_URL);
      testFields(
        cacheEntry,
        {
          hasBodyAccess: false,
          hasTimingAccess: false,
          isCacheOf: entry,
        },
        "cross origin (cached)"
      );
    }
  );
}

add_task(async function testScript_NoCORS() {
  await doTest_NoCORS("script");
});
// Modules cannot be loaded with no CORS.

async function doTest_NoCORS_TAO(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE2 + "perf_server.sjs?cacheable,tao";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: false,
          hasTimingAccess: true,
        },
        "cross origin with Timing-Allow-Origin (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntry.name, JS_URL);
      testFields(
        cacheEntry,
        {
          hasBodyAccess: false,
          hasTimingAccess: true,
          isCacheOf: entry,
        },
        "cross origin with Timing-Allow-Origin (cached)"
      );
    }
  );
}

add_task(async function testScript_NoCORS_TAO() {
  await doTest_NoCORS_TAO("script");
});
// Modules cannot be loaded with no CORS.

async function doTest_CORS(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE2 + "perf_server.sjs?cacheable,cors";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.setAttribute("crossorigin", "anonymous");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: true,
          hasTimingAccess: false,
        },
        "CORS (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntry.name, JS_URL);
      testFields(
        cacheEntry,
        {
          hasBodyAccess: true,
          hasTimingAccess: false,
          isCacheOf: entry,
        },
        "CORS (cached)"
      );
    }
  );
}

add_task(async function testScript_CORS() {
  await doTest_CORS("script");
});
add_task(async function testModule_CORS() {
  await doTest_CORS("module");
});

async function doTest_CORS_TAO(type) {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.script_loader.navigation_cache", true]],
  });
  registerCleanupFunction(() => SpecialPowers.popPrefEnv());

  ChromeUtils.clearResourceCache();
  Services.cache2.clear();

  await BrowserTestUtils.withNewTab(
    {
      gBrowser,
      url: URL_BASE + "dummy.html",
    },
    async function (browser) {
      const JS_URL = URL_BASE2 + "perf_server.sjs?cacheable,cors,tao";

      const task = async (url, type) => {
        await new Promise(resolve => {
          const script = content.document.createElement("script");
          script.setAttribute("crossorigin", "anonymous");
          script.src = url;
          if (type === "module") {
            script.type = "module";
          }
          script.addEventListener("load", resolve);
          content.document.head.append(script);
        });

        const entries = content.performance
          .getEntriesByType("resource")
          .filter(entry => entry.name.includes("perf_server.sjs"));
        if (entries.length != 1) {
          throw new Error(`Expect one entry, got ${entries.length} entries`);
        }
        return JSON.parse(JSON.stringify(entries[0]));
      };

      const entry = await SpecialPowers.spawn(browser, [JS_URL, type], task);
      Assert.equal(entry.name, JS_URL);
      testFields(
        entry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
        },
        "CORS with Timing-Allow-Origin (non-cached)"
      );

      await BrowserTestUtils.reloadTab(gBrowser.selectedTab);

      const cacheEntry = await SpecialPowers.spawn(
        browser,
        [JS_URL, type],
        task
      );
      Assert.equal(cacheEntry.name, JS_URL);
      testFields(
        cacheEntry,
        {
          hasBodyAccess: true,
          hasTimingAccess: true,
          isCacheOf: entry,
        },
        "CORS with Timing-Allow-Origin (cached)"
      );
    }
  );
}

add_task(async function testScript_CORS_TAO() {
  await doTest_CORS_TAO("script");
});
add_task(async function testModule_CORS_TAO() {
  await doTest_CORS_TAO("module");
});
