const HELP = `
Команды бота:

/myid — узнать свой Telegram ID
/collect — запустить автоматический сбор и отбор
/queue — показать автоматически отобранные материалы
/publish ID — опубликовать отобранный материал
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

const OUTSIDE_CITIES = [
  "санкт-петербург", "петербург", "спб", "екатеринбург", "новосибирск", "казань",
  "нижний новгород", "краснодар", "ростов-на-дону", "самара", "уфа", "челябинск",
  "пермь", "воронеж", "красноярск", "омск", "тюмень", "ярославль", "рыбинск",
  "тбилиси", "минск", "алматы", "астана", "нур-султан", "владивосток", "иркутск",
  "барнаул", "томск", "кемерово", "новокузнецк", "саратов", "пенза", "тула",
  "калуга", "рязань", "липецк", "тамбов", "иваново", "владимир", "брянск",
  "курск", "орёл", "орел", "белгород", "ставрополь", "сочи", "мурманск",
  "архангельск", "петрозаводск", "череповец", "вологда", "смоленск", "псков",
  "великий новгород", "калининград", "хабаровск", "благовещенск", "якутск",
  "южно-сахалинск", "магадан", "чита", "улан-удэ", "абакан", "сургут",
  "нижневартовск", "ханты-мансийск", "набережные челны", "тольятти", "йошкар-ола",
  "чебоксары", "ижевск", "киров", "оренбург", "астрахань", "волгоград"
];

function locationOf(text) {
  const s = String(text || "").toLowerCase().replace(/ё/g, "е");
  if (/удал[её]нн|remote|работа из любой точки|из любой точки|по всей россии|вся россия|любой регион|любом городе|независимо от местоположения|онлайн|online/.test(s)) return "remote";
  if (/москв|moscow|подмосков/.test(s)) return "moscow";
  if (OUTSIDE_CITIES.some(city => s.includes(city))) return "outside";
  return "unknown";
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|yclid|gclid|fbclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function evaluateOpportunity(item, now = Date.now()) {
  const title = String(item.title || "").trim();
  const summary = String(item.summary || "").trim();
  const category = categoryOf(title);
  let location = locationOf(title + " " + summary);

  // Official HSE announcements are Moscow-oriented unless the item explicitly says otherwise.
  if (location === "unknown" &&
      /hse\.ru\/rss\/rss_announcement\.rss/i.test(String(item.feedUrl || ""))) {
    location = "moscow";
  }

  if (!title || title.length < 8 || title.length > 240) {
    return { accepted: false, reason: "invalid_title", category, location };
  }
  if (/^(новости|новость|дайджест|обзор|статья|подборка|анонс)\b/i.test(title)) {
    return { accepted: false, reason: "not_an_opportunity", category, location };
  }
  if (category === "Другое") {
    return { accepted: false, reason: "unclassified", category, location };
  }
  if (location === "outside" || location === "unknown") {
    return { accepted: false, reason: location === "outside" ? "outside_moscow" : "location_unknown", category, location };
  }

  const dateValue = item.source_published_at || item.discovered_at || "";
  const publishedAt = dateValue ? Date.parse(dateValue) : NaN;
  const maxAgeDays = category === "Мероприятия" ? 21
    : category === "Гранты и конкурсы" || category === "Образование" ? 60 : 35;
  if (Number.isFinite(publishedAt) && now - publishedAt > maxAgeDays * 86400000) {
    return { accepted: false, reason: "stale", category, location };
  }

  return { accepted: true, reason: "accepted", category, location };
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
    : location === "remote" ? "Удалённо / онлайн" : "";
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
  let filtered = 0;
  let errors = 0;

  for (const feed of feeds.results || []) {
    try {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "MoscowOpportunitiesBot/2.0" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) {
        errors++;
        console.error("RSS HTTP error:", feed.name, response.status);
        continue;
      }

      const xml = await response.text();
      if (xml.length > 2_000_000) {
        errors++;
        console.error("RSS feed too large:", feed.name);
        continue;
      }
      const items = xml.match(/<item\\b[^>]*>[\\s\\S]*?<\\/item>|<entry\\b[^>]*>[\\s\\S]*?<\\/entry>/gi) || [];

      for (const item of items) {
        const title = getTag(item, "title");
        const link = getFeedLink(item);
        const description = (
          getTag(item, "description") ||
          getTag(item, "summary") ||
          getTag(item, "content")
        ).slice(0, 1200);
        const pubDate = getTag(item, "pubDate") || getTag(item, "published") || getTag(item, "updated");

        if (!title || !link || !/^https?:\\/\\//i.test(link)) {
          filtered++;
          continue;
        }

        const url = canonicalUrl(link);
        const decision = evaluateOpportunity({
          title, summary: description, source_published_at: pubDate,
          feedUrl: feed.url
        });

        if (!decision.accepted) {
          filtered++;
          continue;
        }

        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO opportunities
          (feed_id, guid, title, summary, url, category, source_published_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
        `).bind(
          feed.id, getTag(item, "guid") || getTag(item, "id") || url,
          title, description, url, decision.category, pubDate || null
        ).run();

        if (result.meta.changes > 0) added++;
      }
    } catch (error) {
      errors++;
      console.error("RSS error:", feed.name, error);
    }
  }

  const backlog = await autoTriagePending(env);
  return { added, filtered, errors, backlog };
}

async function autoTriagePending(env) {
  let approved = 0;
  let rejected = 0;
  let recategorized = 0;

  // Process in bounded batches so a large legacy queue cannot exhaust one Worker invocation.
  for (let page = 0; page < 20; page++) {
    const result = await env.DB.prepare(`
      SELECT o.id, o.title, o.summary, o.category, o.source_published_at,
             o.discovered_at, f.url AS feed_url
      FROM opportunities o
      LEFT JOIN feeds f ON f.id = o.feed_id
      WHERE o.status = 'pending'
      ORDER BY o.id
      LIMIT 100
    `).all();

    const rows = result.results || [];
    if (!rows.length) break;

    const decisions = rows.map(row => {
      const decision = evaluateOpportunity({ ...row, feedUrl: row.feed_url });
      return {
        id: row.id,
        category: decision.category,
        status: decision.accepted ? "approved" : "rejected",
        wasRecategorized: row.category !== decision.category
      };
    });

    const categoryCase = decisions.map(() => "WHEN ? THEN ?").join(" ");
    const statusCase = decisions.map(() => "WHEN ? THEN ?").join(" ");
    const ids = decisions.map(() => "?").join(", ");
    await env.DB.prepare(`
      UPDATE opportunities
      SET category = CASE id ${categoryCase} ELSE category END,
          status = CASE id ${statusCase} ELSE status END
      WHERE status = 'pending' AND id IN (${ids})
    `).bind(
      ...decisions.flatMap(row => [row.id, row.category]),
      ...decisions.flatMap(row => [row.id, row.status]),
      ...decisions.map(row => row.id)
    ).run();

    approved += decisions.filter(row => row.status === "approved").length;
    rejected += decisions.filter(row => row.status === "rejected").length;
    recategorized += decisions.filter(row => row.wasRecategorized).length;
  }

  return { approved, rejected, recategorized };
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
    const result = await collect(env);
    return send(env, chatId,
      `Автоматический отбор завершён. Новых материалов принято: ${result.added}. Отсеяно: ${result.filtered}. Ошибок источников: ${result.errors}. Старая очередь обработана: одобрено ${result.backlog.approved}, отклонено ${result.backlog.rejected}, категорий исправлено ${result.backlog.recategorized}.`);
  }

  if (command === "queue") {
    const rows = await env.DB.prepare(`
      SELECT id, title, summary, category, url FROM opportunities
      WHERE status = 'approved'
      ORDER BY id DESC LIMIT 10
    `).all();

    if (!rows.results.length) return send(env, chatId, "Нет новых материалов, ожидающих публикации.");

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