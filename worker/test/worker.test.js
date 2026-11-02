import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function createDatabase(feeds) {
  const opportunities = new Map();

  return {
    opportunities,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async all() {
          if (sql.includes("FROM feeds")) return { results: feeds };
          throw new Error(`Unexpected query: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO opportunities")) {
            const [feedId, guid, title, summary, url, category, publishedAt] = values;
            if (opportunities.has(url)) return { meta: { changes: 0 } };
            opportunities.set(url, {
              feed_id: feedId,
              guid,
              title,
              summary,
              url,
              category,
              source_published_at: publishedAt
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected query: ${sql}`);
        }
      };
    }
  };
}

async function runScheduledCollection(xml) {
  const db = createDatabase([
    { id: 1, name: "Test RSS", url: "https://feed.example/rss" }
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://feed.example/rss");
    return new Response(xml, { status: 200 });
  };

  try {
    let scheduledWork;
    worker.scheduled({}, { DB: db }, {
      waitUntil(promise) {
        scheduledWork = promise;
      }
    });
    await scheduledWork;
  } finally {
    globalThis.fetch = originalFetch;
  }

  return db.opportunities;
}

test("classifies an open day announcement as an event", async () => {
  const records = await runScheduledCollection(`
    <rss><channel><item>
      <title>День открытых дверей для абитуриентов</title>
      <link>https://example.org/open-day</link>
      <description>Знакомство с университетом</description>
      <guid>open-day-1</guid>
    </item></channel></rss>
  `);

  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].category, "Мероприятия");
});

test("ignores duplicate URLs and does not collect non-http links", async () => {
  const records = await runScheduledCollection(`
    <rss><channel>
      <item>
        <title>Стажировка разработчика</title>
        <link>https://example.org/internship</link>
        <guid>internship-1</guid>
      </item>
      <item>
        <title>Повторная запись</title>
        <link>https://example.org/internship</link>
        <guid>internship-duplicate</guid>
      </item>
      <item>
        <title>Некорректная ссылка</title>
        <link>javascript:alert(1)</link>
        <guid>bad-link</guid>
      </item>
    </channel></rss>
  `);

  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].category, "Стажировки");
});
