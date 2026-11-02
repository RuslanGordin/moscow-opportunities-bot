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
/cleanup — проверить старую очередь
/cleanup confirm — применить очистку
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
    "<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">",
    "i"
  ));
  return match ? decodeXml(match[1]) : "";
}

function getFeedLink(item) {
  const match = item.match(/<link\b([^>]*)\/?\s*>/i);
  if (!match) return "";

  const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (href) return decodeXml(href[1] || href[2] || "");

  const content = item.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  return content ? decodeXml(content[1]) : "";
}

function categoryOf(text) {
  const s = String(text || "").toLowerCase();

  // Use the title as the primary signal; descriptions often mention unrelated topics.
  if (/стартап|предпринимател|бизнес-иде|бизнес проект|партн[её]рств|ищем соосновател|соосновател|акселератор/.test(s)) return "Бизнес и проекты";
  if (/грант|стипенди|конкурс|преми|финансировани[ея]/.test(s)) return "Гранты и конкурсы";
  if (/волонт[её]р|добровол|благотвор|социальн(?:ый|ого) проект/.test(s)) return "Волонтёрство";
  if (/мероприят|конференц|митап|meetup|лекци|вебинар|хакатон|выставк|форум|день открытых дверей|дня открытых дверей|дни открытых дверей/.test(s)) return "Мероприятия";
  if (/курс(?:ы|а|ов)?|обучени|образовательн|школа программирован|интенсив|повышени[ея] квалификац/.test(s)) return "Образование";
  if (/стажиров|стаж[её]р|intern(ship)?|практик(?:а|и|у|ой)|trainee/.test(s)) return "Стажировки";
  if (/работа|ваканси|зарплат|оклад|требуется|ищем сотрудник|открыта позици|job\b|в команду|\bmanager\b|менеджер|специалист|руководитель|директор|\bhr\b/.test(s)) {
    if (/разработчик|developer|программист|инженер|техническ|тестировщик|qa\b|devops|аналитик|кибербезопас|информационн(?:ая|ой) безопасност|backend|frontend|бэкенд|фронтенд|python|java|javascript|c#/.test(s)) return "IT";
    if (/дизайн|дизайнер|figma|ux|ui\/ux/.test(s)) return "Дизайн";
    if (/маркетинг|smm|контент|копирайт|seo/.test(s)) return "Маркетинг";
    if (/продаж|аккаунт|business development|коммерческ/.test(s)) return "Продажи";
    return "Работа";
  }
  if (/дизайн|дизайнер|figma|ux|ui\/ux/.test(s)) return "Дизайн";
  if (/разработчик|developer|программист|инженер|техническ|тестировщик|qa\b|devops|аналитик|кибербезопас|backend|frontend|бэкенд|фронтенд|python|java|javascript|c#/.test(s)) return "IT";
  if (/маркетинг|smm|контент|копирайт|seo/.test(s)) return "Маркетинг";
  return "Другое";
}

function locationOf(text) {
  const s = String(text || "").toLowerCase();
  if (/удал[её]нно|remote|работа из любой точки|из любой точки|по всей россии|вся россия|онлайн/.test(s)) return "remote";
  const outsideMoscow = [
    "санкт-петербург", "спб", "екатеринбург", "новосибирск", "казань",
    "нижний новгород", "краснодар", "ростов-на-дону", "самара", "уфа",
    "челябинск", "пермь", "воронеж", "красноярск", "омск", "тюмень",
    "ярославль", "рыбинск", "тбилиси", "минск", "алматы"
  ];
  // A role available in Moscow remains relevant even if the employer lists several cities.
  if (/москва|московская область|подмосковье|московской обл/.test(s)) return "moscow";
  if (outsideMoscow.some(city => s.includes(city))) return "outside";
  return "unknown";
}

function isRelevantLocation(text) {
  // Unknown geography stays in the moderation queue; only explicit other-city roles are skipped.
  return locationOf(text) !== "outside";
}

function categoryHashtag(category) {
  return ({
    "Работа": "#Работа", "IT": "#IT", "Дизайн": "#Дизайн",
    "Маркетинг": "#Маркетинг", "Продажи": "#Продажи",
    "Стажировки": "#Стажировки", "Образование": "#Образование",
    "Мероприятия": "#Мероприятия", "Гранты и конкурсы": "#ГрантыИКонкурсы",
    "Бизнес и проекты": "#Бизнес", "Волонтёрство": "#Волонтёрство",
    "Другое": "#Возможности"
  })[category] || "#Возможности";
}

function formatOpportunityPost(item) {
  const category = item.category || "Другое";
  const location = locationOf([item.title, item.summary].join(" "));
  const locationLabel = location === "moscow" ? "Москва / Московская область"
    : location === "remote" ? "Удалённо / онлайн"
    : location === "unknown" ? "География уточняется" : "";
  const summary = String(item.summary || "").trim();
  const parts = [
    "<b>" + escapeHtml(item.title) + "</b>",
    summary ? escapeHtml(summary) : "",
    "<b>Раздел:</b> " + escapeHtml(category),
    locationLabel ? "<b>География:</b> " + escapeHtml(locationLabel) : "",
    '<a href="' + escapeHtml(item.url) + '">Подробнее и условия</a>',
    categoryHashtag(category)
  ].filter(Boolean);
  return parts.join("\n\n");
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
      const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>|<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];

      for (const item of items) {
        const title = getTag(item, "title");
        const link = getFeedLink(item);
        const description = (
          getTag(item, "description") ||
          getTag(item, "summary") ||
          getTag(item, "content")
        ).slice(0, 500);
        const pubDate = getTag(item, "pubDate") || getTag(item, "published") || getTag(item, "updated");

        if (!title || !link || !/^https?:\/\//i.test(link)) continue;

        const fullText = title + " " + description;
        // Keep Moscow-focused offers; remote and unspecified geography remain for review.
        if (!isRelevantLocation(fullText)) continue;

        const category = categoryOf(title);

        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO opportunities
          (feed_id, guid, title, summary, url, category, source_published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          feed.id, getTag(item, "guid") || getTag(item, "id") || link,
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


async function cleanupPending(env, apply = false) {
  const result = await env.DB.prepare(`
    SELECT id, title, summary, category
    FROM opportunities
    WHERE status = 'pending'
    ORDER BY id DESC
  `).all();

  const rows = result.results || [];
  const changes = rows.map(row => ({
    ...row,
    nextCategory: categoryOf(row.title),
    location: locationOf([row.title, row.summary || ""].join(" "))
  }));
  const outside = changes.filter(row => row.location === "outside");
  const recategorized = changes.filter(row => row.category !== row.nextCategory);
  const unknown = changes.filter(row => row.location === "unknown");

  if (apply && changes.length) {
    // Keep statements comfortably below SQLite's bind-parameter limit.
    for (let offset = 0; offset < changes.length; offset += 100) {
      const chunk = changes.slice(offset, offset + 100);
      const categoryCases = chunk.map(() => "WHEN ? THEN ?").join(" ");
      const rejectedIds = chunk.filter(row => row.location === "outside").map(row => row.id);
      const sql = `
        UPDATE opportunities
        SET category = CASE id ${categoryCases} ELSE category END,
            status = CASE WHEN id IN (${rejectedIds.length ? rejectedIds.map(() => "?").join(",") : "NULL"})
          THEN 'rejected' ELSE status END
        WHERE status = 'pending' AND id IN (${chunk.map(() => "?").join(",")})
      `;
      const bindings = [
        ...chunk.flatMap(row => [row.id, row.nextCategory]),
        ...rejectedIds,
        ...chunk.map(row => row.id)
      ];
      await env.DB.prepare(sql).bind(...bindings).run();
    }
  }

  return { total: rows.length, rejected: outside.length, recategorized: recategorized.length, unknown: unknown.length,
    examples: outside.slice(0, 5).map(row => `${row.id}: ${row.title}`) };
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


  if (command === "cleanup") {
    const apply = arg.toLowerCase() === "confirm";
    if (arg && !apply) {
      return send(env, chatId, "Формат: /cleanup — предварительная проверка; /cleanup confirm — применить изменения.");
    }
    const result = await cleanupPending(env, apply);
    const examples = result.examples.length
      ? "\\nПримеры отклоняемых:\\n" + result.examples.map(escapeHtml).join("\\n")
      : "";
    if (!apply) {
      return send(env, chatId,
        `Проверка очереди (без изменений):\\nОжидают модерации: ${result.total}\\nБудут отклонены как другие города без удалённого формата: ${result.rejected}\\nКатегории будут исправлены: ${result.recategorized}\\nГеография не определена (останутся на проверке): ${result.unknown}${examples}\\n\\nЧтобы применить: /cleanup confirm`);
    }
    return send(env, chatId,
      `Очередь обработана. Проверено: ${result.total}. Отклонено по географии: ${result.rejected}. Категорий исправлено: ${result.recategorized}. Неопределённая география оставлена на модерации: ${result.unknown}.`);
  }

  if (command === "collect") {
    const count = await collect(env);
    return send(env, chatId, `Сбор завершён. Новых материалов: ${count}.`);
  }

  if (command === "queue") {
    const rows = await env.DB.prepare(`
      SELECT id, title, summary, category, url FROM opportunities
      WHERE status = 'pending'
      ORDER BY id DESC LIMIT 10
    `).all();

    if (!rows.results.length) return send(env, chatId, "Очередь пока пуста.");

    const result = rows.results.map(x =>
      `<b>${x.id}.</b> ${escapeHtml(x.title)}\nКатегория: ${escapeHtml(x.category)}\n${escapeHtml(String(x.summary || "").slice(0, 180))}\n<a href="${escapeHtml(x.url)}">Источник</a>`
    ).join("\n\n");

    return send(env, chatId, result);
  }

  if (command === "approve" || command === "reject") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id < 1) {
      return send(env, chatId, "Укажи ID материала. Например: /approve 3");
    }

    if (command === "approve") {
      const candidate = await env.DB.prepare(`
        SELECT title, summary FROM opportunities
        WHERE id = ? AND status = 'pending'
      `).bind(id).first();

      if (candidate && !isRelevantLocation(candidate.title + " " + (candidate.summary || ""))) {
        await env.DB.prepare(`
          UPDATE opportunities SET status = 'rejected'
          WHERE id = ? AND status = 'pending'
        `).bind(id).run();
        return send(env, chatId, `Материал №${id} отклонён: возможность явно относится к другому городу.`);
      }
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

    if (!isRelevantLocation(item.title + " " + (item.summary || ""))) {
      await env.DB.prepare(`
        UPDATE opportunities SET status = 'rejected'
        WHERE id = ? AND status = 'approved' AND telegram_message_id IS NULL
      `).bind(id).run();
      return send(env, chatId, `Материал №${id} отклонён: возможность явно относится к другому городу.`);
    }

    // Claim atomically before sending so concurrent commands cannot both publish.
    const claim = await env.DB.prepare(`
      UPDATE opportunities
      SET telegram_message_id = -1
      WHERE id = ? AND status = 'approved' AND telegram_message_id IS NULL
    `).bind(id).run();

    if (!claim.meta.changes) {
      return send(env, chatId, "Материал уже публикуется или был обработан.");
    }

    const post = formatOpportunityPost(item);

    let telegramAcceptedMessage = false;

    try {
      const sent = await telegram(env, "sendMessage", {
        chat_id: env.CHANNEL_ID,
        text: post,
        parse_mode: "HTML",
        disable_web_page_preview: false
      });
      telegramAcceptedMessage = true;

      const saved = await env.DB.prepare(`
        UPDATE opportunities
        SET status = 'published', telegram_message_id = ?,
            published_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'approved' AND telegram_message_id = -1
      `).bind(sent.message_id, id).run();

      if (!saved.meta.changes) {
        throw new Error("Telegram accepted the post, but D1 did not finalize the publication record.");
      }

      return send(env, chatId, `Материал №${id} опубликован.`);
    } catch (error) {
      if (!telegramAcceptedMessage) {
        // Telegram did not confirm the send: release the claim for a safe retry.
        await env.DB.prepare(`
          UPDATE opportunities SET telegram_message_id = NULL
          WHERE id = ? AND status = 'approved' AND telegram_message_id = -1
        `).bind(id).run();
      } else {
        // Telegram accepted the post. Keep the claim to prevent a duplicate retry.
        console.error("Publication accepted by Telegram but not finalized in D1; manual reconciliation is required:", id, error);
      }
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