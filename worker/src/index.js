const HELP = `
Команды бота:

/myid — узнать свой Telegram ID
/collect — собрать новые вакансии
/queue — показать очередь
/approve ID — одобрить материал
/reject ID — отклонить материал
/publish ID — опубликовать одобренный материал
/feeds — список RSS-источников
/addfeed Название | URL — добавить источник
/stats — статистика
`;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function decodeXml(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(xml, tag) {
  const match = xml.match(new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"
  ));
  return match ? decodeXml(match[1]) : "";
}

function categoryOf(text) {
  const s = text.toLowerCase();
  if (/стажиров|intern|практик/.test(s)) return "Стажировки";
  if (/мероприят|конференц|митап|лекци|хакатон|день открытых дверей|дня открытых дверей|дни открытых дверей/.test(s)) return "Мероприятия";
  if (/дизайн|дизайнер|figma/.test(s)) return "Дизайн";
  if (/программ|разработчик|developer|python|java|javascript|c#|backend|frontend|devops/.test(s)) return "IT";
  if (/маркетинг|smm|контент/.test(s)) return "Маркетинг";
  return "Вакансии";
}

async function telegram(env, method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram API error");
  return result.result;
}

async function send(env, chatId, text) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

function isAdmin(env, userId) {
  const ids = (env.ADMIN_IDS || "").split(",").map(x => x.trim());
  return ids.includes(String(userId));
}

async function collect(env) {
  const feeds = await env.DB.prepare(
    "SELECT id, name, url FROM feeds WHERE active = 1"
  ).all();

  let added = 0;

  for (const feed of feeds.results || []) {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "MoscowOpportunitiesBot/1.0" }
      });
      if (!response.ok) continue;

      const xml = await response.text();
      const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];

      for (const item of items) {
        const title = getTag(item, "title");
        const link = getTag(item, "link");
        const description = getTag(item, "description").slice(0, 500);
        const pubDate = getTag(item, "pubDate");

        if (!title || !link || !/^https?:\/\//i.test(link)) continue;

        const category = categoryOf(title + " " + description);

        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO opportunities
          (feed_id, guid, title, summary, url, category, source_published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          feed.id, getTag(item, "guid") || link,
          title, description, link, category, pubDate || null
        ).run();

        if (result.meta.changes > 0) added++;
      }
    } catch (error) {
      console.error("RSS error:", feed.name, error);
    }
  }

  return added;
}

async function handleCommand(message, env) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";
  const match = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]+))?$/i);

  if (!match) return;

  const command = match[1].toLowerCase();
  const arg = (match[2] || "").trim();

  if (command === "myid") {
    return send(env, chatId, `Твой Telegram ID: <code>${userId}</code>`);
  }

  if (command === "start" || command === "help") {
    return send(env, chatId, "Привет! Я бот канала «Москва | Возможности».\n" + HELP);
  }

  if (!isAdmin(env, userId)) {
    return send(env, chatId, "У тебя нет доступа к административным командам.");
  }

  if (command === "collect") {
    const count = await collect(env);
    return send(env, chatId, `Сбор завершён. Новых материалов: ${count}.`);
  }

  if (command === "queue") {
    const rows = await env.DB.prepare(`
      SELECT id, title, category FROM opportunities
      WHERE status = 'pending'
      ORDER BY id DESC LIMIT 10
    `).all();

    if (!rows.results.length) return send(env, chatId, "Очередь пока пуста.");

    const result = rows.results.map(x =>
      `<b>${x.id}.</b> ${escapeHtml(x.title)}\nКатегория: ${escapeHtml(x.category)}`
    ).join("\n\n");

    return send(env, chatId, result);
  }

  if (command === "approve" || command === "reject") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id < 1) {
      return send(env, chatId, "Укажи ID материала. Например: /approve 3");
    }

    const status = command === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare(`
      UPDATE opportunities SET status = ?
      WHERE id = ? AND status = 'pending'
    `).bind(status, id).run();

    return send(env, chatId, result.meta.changes
      ? `Материал №${id}: ${status === "approved" ? "одобрен" : "отклонён"}.`
      : "Материал не найден или уже обработан.");
  }

  if (command === "publish") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id < 1) {
      return send(env, chatId, "Укажи ID. Например: /publish 3");
    }

    const item = await env.DB.prepare(`
      SELECT * FROM opportunities WHERE id = ? AND status = 'approved'
    `).bind(id).first();

    if (!item) return send(env, chatId, "Нет такого одобренного материала.");

    // Claim atomically before sending so concurrent commands cannot both publish.
    const claim = await env.DB.prepare(`
      UPDATE opportunities
      SET telegram_message_id = -1
      WHERE id = ? AND status = 'approved' AND telegram_message_id IS NULL
    `).bind(id).run();

    if (!claim.meta.changes) {
      return send(env, chatId, "Материал уже публикуется или был обработан.");
    }

    const post =
      `<b>${escapeHtml(item.title)}</b>\\n\\n` +
      `${escapeHtml(item.summary || "")}\\n\\n` +
      `Категория: ${escapeHtml(item.category)}\\n` +
      `<a href="${escapeHtml(item.url)}">Подробнее об источнике</a>\\n\\n` +
      `Источник: ${escapeHtml(item.url)}`;

    try {
      const sent = await telegram(env, "sendMessage", {
        chat_id: env.CHANNEL_ID,
        text: post,
        parse_mode: "HTML",
        disable_web_page_preview: false
      });

      await env.DB.prepare(`
        UPDATE opportunities
        SET status = 'published', telegram_message_id = ?,
            published_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'approved' AND telegram_message_id = -1
      `).bind(sent.message_id, id).run();

      return send(env, chatId, `Материал №${id} опубликован.`);
    } catch (error) {
      // Release the claim when Telegram rejects the send, allowing a retry.
      await env.DB.prepare(`
        UPDATE opportunities SET telegram_message_id = NULL
        WHERE id = ? AND status = 'approved' AND telegram_message_id = -1
      `).bind(id).run();
      throw error;
    }
  }

  if (command === "feeds") {
    const rows = await env.DB.prepare(
      "SELECT id, name, url FROM feeds WHERE active = 1"
    ).all();

    const result = (rows.results || []).map(x =>
      `${x.id}. ${escapeHtml(x.name)}\n${escapeHtml(x.url)}`
    ).join("\n\n");

    return send(env, chatId, result || "Источников пока нет.");
  }

  if (command === "addfeed") {
    const parts = arg.split("|").map(x => x.trim());
    if (parts.length !== 2 || !/^https?:\/\//i.test(parts[1])) {
      return send(env, chatId, "Формат: /addfeed Название | https://example.com/rss");
    }

    await env.DB.prepare(
      "INSERT OR IGNORE INTO feeds (name, url) VALUES (?, ?)"
    ).bind(parts[0], parts[1]).run();

    return send(env, chatId, "Источник добавлен (если его ещё не было).");
  }

  if (command === "stats") {
    const rows = await env.DB.prepare(`
      SELECT status, COUNT(*) AS total
      FROM opportunities GROUP BY status
    `).all();

    const stats = (rows.results || []).map(x =>
      `${x.status}: ${x.total}`
    ).join("\n");

    return send(env, chatId, stats || "Материалов пока нет.");
  }

  return send(env, chatId, HELP);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("Moscow Opportunities Bot is running.");
    }

    if (url.pathname === "/setup") {
      if (!env.SETUP_SECRET || url.searchParams.get("key") !== env.SETUP_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const webhookUrl = `${url.origin}/telegram`;
      const result = await telegram(env, "setWebhook", {
        url: webhookUrl,
        secret_token: env.WEBHOOK_SECRET
      });

      return Response.json({ ok: true, result });
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      if (env.WEBHOOK_SECRET &&
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json();
      if (update.message) {
        try {
          await handleCommand(update.message, env);
        } catch (error) {
          console.error(error);
          await send(env, update.message.chat.id, "Произошла ошибка. Попробуй ещё раз.");
        }
      }

      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(collect(env));
  }
};