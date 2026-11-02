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

test("collects Atom entries with href links and summary content", async () => {
  const records = await runScheduledCollection(`
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>atom-internship-1</id>
        <title>Стажировка backend-разработчика</title>
        <link rel="alternate" href="https://example.org/atom-internship" />
        <summary>Стажировка для начинающих специалистов</summary>
        <published>2026-11-01T10:00:00Z</published>
      </entry>
    </feed>
  `);

  assert.equal(records.size, 1);
  const item = [...records.values()][0];
  assert.equal(item.url, "https://example.org/atom-internship");
  assert.equal(item.guid, "atom-internship-1");
  assert.equal(item.category, "Стажировки");
  assert.match(item.summary, /Стажировка для начинающих специалистов/);
  assert.equal(item.source_published_at, "2026-11-01T10:00:00Z");
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


function createPublishDatabase({ failFinalize = false } = {}) {
  const row = {
    id: 7,
    status: "approved",
    telegram_message_id: null,
    title: "Тестовая стажировка",
    summary: "Описание",
    category: "Стажировки",
    url: "https://example.org/job"
  };

  return {
    row,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return row.id === values[0] && row.status === "approved" ? { ...row } : null;
        },
        async run() {
          if (sql.includes("SET telegram_message_id = -1")) {
            if (row.id === values[0] && row.status === "approved" && row.telegram_message_id === null) {
              row.telegram_message_id = -1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          if (sql.includes("SET status = 'published'")) {
            if (failFinalize) throw new Error("Simulated D1 write failure");
            if (row.id === values[1] && row.status === "approved" && row.telegram_message_id === -1) {
              row.status = "published";
              row.telegram_message_id = values[0];
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          if (sql.includes("SET telegram_message_id = NULL")) {
            if (row.id === values[0] && row.status === "approved" && row.telegram_message_id === -1) {
              row.telegram_message_id = null;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          throw new Error(`Unexpected publish query: ${sql}`);
        }
      };
    }
  };
}

test("only one of two concurrent publish commands sends to the channel", async () => {
  const DB = createPublishDatabase();
  const originalFetch = globalThis.fetch;
  const channelMessages = [];

  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.chat_id === "@test_channel") channelMessages.push(payload);
    return Response.json({
      ok: true,
      result: { message_id: channelMessages.length || 99 }
    });
  };

  const env = {
    DB,
    BOT_TOKEN: "test-token",
    CHANNEL_ID: "@test_channel",
    ADMIN_IDS: "42"
  };

  const request = () => new Request("https://worker.example/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: 42 },
        from: { id: 42 },
        text: "/publish 7"
      }
    })
  });

  try {
    const responses = await Promise.all([
      worker.fetch(request(), env),
      worker.fetch(request(), env)
    ]);

    assert.equal(responses.length, 2);
    assert.equal(channelMessages.length, 1);
    assert.match(channelMessages[0].text, /<b>Тестовая стажировка<\/b>\n\nОписание\n\nКатегория: Стажировки/);
    assert.doesNotMatch(channelMessages[0].text, /\\\\n/);
    assert.equal(DB.row.status, "published");
    assert.notEqual(DB.row.telegram_message_id, -1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("keeps the publication claim when Telegram accepted a post but D1 finalization fails", async () => {
  const DB = createPublishDatabase({ failFinalize: true });
  const originalFetch = globalThis.fetch;
  const channelMessages = [];

  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.chat_id === "@test_channel") {
      channelMessages.push(payload);
      return Response.json({ ok: true, result: { message_id: 123 } });
    }
    return Response.json({ ok: true, result: { message_id: 999 } });
  };

  const env = {
    DB,
    BOT_TOKEN: "test-token",
    CHANNEL_ID: "@test_channel",
    ADMIN_IDS: "42"
  };

  const request = () => new Request("https://worker.example/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        chat: { id: 42 },
        from: { id: 42 },
        text: "/publish 7"
      }
    })
  });

  try {
    await worker.fetch(request(), env);
    assert.equal(channelMessages.length, 1);
    assert.equal(DB.row.telegram_message_id, -1);

    await worker.fetch(request(), env);
    assert.equal(channelMessages.length, 1);
    assert.equal(DB.row.telegram_message_id, -1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("filters out senior vacancies while keeping student-friendly opportunities", async () => {
  const records = await runScheduledCollection(`
    <rss><channel>
      <item>
        <title>Функциональный тестировщик / QA инженер #senior</title>
        <link>https://example.org/senior-qa</link>
        <description>Требуемые навыки: SOAP, REST, SQL, PostgreSQL</description>
        <guid>senior-qa</guid>
      </item>
      <item>
        <title>Стажёр-разработчик C#</title>
        <link>https://example.org/csharp-intern</link>
        <description>Можно без опыта, обучение на рабочем месте</description>
        <guid>csharp-intern</guid>
      </item>
      <item>
        <title>Младший аналитик</title>
        <link>https://example.org/analyst</link>
        <description>Опыт работы от 3 лет</description>
        <guid>experienced-analyst</guid>
      </item>
    </channel></rss>
  `);

  assert.equal(records.size, 1);
  assert.equal([...records.values()][0].title, "Стажёр-разработчик C#");
});
