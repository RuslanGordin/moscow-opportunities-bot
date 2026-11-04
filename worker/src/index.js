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
  const s = String(text || "").toLowerCase().replace(/ё/g, "е");

  // Opportunity types take priority over broad job-title words.
  if (/грант|стипенди|конкурс|преми|финансировани[ея]|субсиди|компенсаци/.test(s)) return "Гранты и конкурсы";
  if (/волонт[её]р|добровол|благотвор|социальн(?:ый|ого) проект/.test(s)) return "Волонтёрство";
  if (/мероприят|конференц|митап|meetup|встреч|лекци|вебинар|хакатон|выставк|форум|день открытых дверей|дня открытых дверей|дни открытых дверей/.test(s)) return "Мероприятия";
  if (/стажиров|стаж[её]р|intern(ship)?|практик(?:а|и|у|ой)|trainee/.test(s)) return "Стажировки";
  if (/бесплатн(?:ая|ый|ое) курс|курс(?:ы|а|ов)?|обучени|образовательн|школа программирован|интенсив|повышени[ея] квалификац|переподготовк/.test(s)) return "Образование";
  if (/льгот|пособи|выплат|компенсац|социальн(?:ая|ой) поддержк|права потребител|трудов(?:ые|ых) права|жилищн(?:ая|ые) субсиди/.test(s)) return "Права и льготы";
  if (/стартап|предпринимател|бизнес-иде|бизнес проект|партн[её]рств|ищем соосновател|соосновател|акселератор/.test(s)) return "Бизнес и проекты";
  if (/городск(?:ой|ая) проект|благоустройств|общественн(?:ое|ый) обсуждени|городская среда|транспортн(?:ая|ый) проект/.test(s)) return "Город";

  // Technical roles are classified before generic "manager"/"specialist" matches.
  if (/mlops|dataops|devops|sre\b|разработчик|developer|программист|инженер|техническ|technical|тестировщик|qa\b|quality assurance|аналитик|analyst|data scientist|data engineer|product analyst|системн(?:ый|ого) администратор|сетев(?:ой|ого) инженер|кибербезопас|информационн(?:ая|ой) безопасност|backend|frontend|бэкенд|фронтенд|python|java|javascript|c#|sql|dwh|машинн(?:ое|ого) обучени/.test(s)) return "IT";
  if (/дизайн|дизайнер|figma|ux|ui\/ux|графическ(?:ий|ого) дизайнер/.test(s)) return "Дизайн";
  if (/маркетинг|smm|контент|копирайт|seo|бренд-менедж/.test(s)) return "Маркетинг";
  if (/продаж|аккаунт|business development|коммерческ/.test(s)) return "Продажи";
  if (/работа|ваканси|зарплат|оклад|требуется|ищем сотрудник|открыта позици|job\b|в команду|\bmanager\b|менеджер|специалист|руководитель|директор|\bhr\b|product manager|project manager/.test(s)) return "Работа";
  if (/технолог|цифровизац|искусственн(?:ый|ого) интеллект|нейросет|робототехник/.test(s)) return "Технологии";
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
  const moscow = /москв|moscow|подмосков/.test(s);
  const outside = OUTSIDE_CITIES.some(city => s.includes(city));
  const unrestrictedRemote = /из любой точки|по всей россии|вся россия|любой регион|в любом городе|без привязки к местоположению|независимо от местоположения|по всей стране|anywhere|worldwide|remote worldwide/.test(s);
  const remoteSignal = /удал[её]нн|remote|дистанционн|работа из дома|work from home|онлайн|online/.test(s);

  // A Moscow office/branch is a valid local opportunity even if other cities are listed.
  if (moscow) return "moscow";
  // A city-specific vacancy is not considered Moscow-eligible merely because it says
  // "можно удалённо". Only unrestricted remote wording overrides another city.
  if (outside) return unrestrictedRemote ? "remote" : "outside";
  if (unrestrictedRemote || remoteSignal) return "remote";
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
  if (/^(новости|новость|дайджест|обзор|статья|подборка)\b/i.test(title)) {
    return { accepted: false, reason: "not_an_opportunity", category, location };
  }
  if (category === "Другое") {
    return { accepted: false, reason: "unclassified", category, location };
  }
  if (location === "outside" || location === "unknown") {
    return { accepted: false, reason: location === "outside" ? "outside_moscow" : "location_unknown", category, location };
  }

  const sourceDate = item.source_published_at ? Date.parse(item.source_published_at) : NaN;
  const discoveredDate = item.discovered_at ? Date.parse(item.discovered_at) : NaN;
  const publishedAt = Number.isFinite(sourceDate) ? sourceDate : discoveredDate;
  const maxAgeDays = category === "Мероприятия" ? 45
    : category === "Гранты и конкурсы" || category === "Образование" ? 60 : 35;
  if (Number.isFinite(publishedAt) && now - publishedAt > maxAgeDays * 86400000) {
    return { accepted: false, reason: "stale", category, location };
  }

  return { accepted: true, reason: "accepted", category, location };
}

export { evaluateOpportunity };

function categoryHashtag(category) {
  return ({
    "Работа": "#Работа", "IT": "#IT", "Дизайн": "#Дизайн",
    "Маркетинг": "#Маркетинг", "Продажи": "#Продажи",
    "Стажировки": "#Стажировки", "Образование": "#Образование",
    "Мероприятия": "#События", "Гранты и конкурсы": "#Гранты",
    "Бизнес и проекты": "#Бизнес", "Волонтёрство": "#Волонтёрство",
    "Права и льготы": "#Права", "Город": "#Город", "Технологии": "#Технологии",
    "Другое": "#Возможности"
  })[category] || "#Возможности";
}

function detectExperienceLevel(text) {
  const s = String(text || "").toLowerCase();
  if (/\\b(?:lead|ведущ(?:ий|его)|руководител[ья]|head of|team lead|директор)\\b/.test(s)) return "Руководящая роль";
  if (/\\b(?:senior|сеньор|старш(?:ий|его)|principal|staff)\\b/.test(s)) return "Senior";
  if (/\\b(?:middle|мидл|средн(?:ий|его) уровень)\\b/.test(s)) return "Middle";
  if (/\\b(?:junior|джуниор|начинающ(?:ий|его)|без опыта|стажер|стажерка|intern|trainee)\\b/.test(s)) return "Начальный уровень";
  return "";
}

function extractSalary(text) {
  const s = String(text || "").replace(/\\s+/g, " ");
  const match = s.match(/(?:зарплат[аы]?|оклад|доход|оплата труда)?[^.\\n]{0,35}(?:от\\s*)?\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:тыс\\.?\\s*)?(?:₽|руб(?:лей|ля|ль)?|р\\.?)(?:\\s*(?:до|—|–|-)\\s*\\d[\\d\\s]*(?:[.,]\\d+)?\\s*(?:тыс\\.?\\s*)?(?:₽|руб(?:лей|ля|ль)?|р\\.?))?/i);
  return match ? match[0].trim() : "";
}

function extractWorkFormat(text) {
  const s = String(text || "").toLowerCase();
  if (/гибрид|гибридн/.test(s)) return "Гибрид";
  if (/удал[её]нн|remote|дистанционн/.test(s)) return "Удалённо";
  if (/офис|на площадке|очно/.test(s)) return "Офис";
  return "";
}

function formatOpportunityPost(item) {
  const category = item.category || categoryOf(item.title);
  const sourceText = [item.title, item.summary].filter(Boolean).join(" ");
  const location = evaluateOpportunity({
    ...item,
    feedUrl: item.feed_url
  }).location;
  const locationLabel = location === "moscow" ? "Москва / Московская область"
    : location === "remote" ? "Удалённо (география проверена по описанию)" : "";
  const level = detectExperienceLevel(sourceText);
  const salary = extractSalary(sourceText);
  const workFormat = extractWorkFormat(sourceText);
  const summary = String(item.summary || "").trim().slice(0, 1800);
  const facts = [
    level ? "<b>Уровень:</b> " + escapeHtml(level) : "",
    salary ? "<b>Оплата:</b> " + escapeHtml(salary) : "",
    workFormat ? "<b>Формат:</b> " + escapeHtml(workFormat) : ""
  ].filter(Boolean);
  const parts = [
    "<b>" + escapeHtml(item.title) + "</b>",
    summary ? escapeHtml(summary) : "",
    facts.join("\\n"),
    "<b>Категория:</b> " + escapeHtml(category),
    locationLabel ? "<b>География:</b> " + escapeHtml(locationLabel) : "",
    '<a href="' + escapeHtml(item.url) + '">Источник и полные условия</a>',
    categoryHashtag(category)
  ].filter(Boolean);
  return parts.join("\\n\\n").slice(0, 3900);
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
      const items = xml.match(/<item\b[^>]*>[\d\D]*?<\/item>|<entry\b[^>]*>[\d\D]*?<\/entry>/gi) || [];

      for (const item of items) {
        const title = getTag(item, "title");
        const link = getFeedLink(item);
        const description = (
          getTag(item, "description") ||
          getTag(item, "summary") ||
          getTag(item, "content")
        ).slice(0, 1200);
        const pubDate = getTag(item, "pubDate") || getTag(item, "published") || getTag(item, "updated");

        if (!title || !link || !/^https?:[/][/]/i.test(link)) {
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
  for (let page = 0; page < 50; page++) {
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

    // D1 allows at most 100 bound parameters per statement. Keep each
    // update to three parameters and execute the page as one D1 batch.
    const updates = decisions.map(row => env.DB.prepare(`
      UPDATE opportunities
      SET category = ?, status = ?
      WHERE id = ? AND status = 'pending'
    `).bind(row.category, row.status, row.id));
    for (let offset = 0; offset < updates.length; offset += 50) {
      await env.DB.batch(updates.slice(offset, offset + 50));
    }

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
        SELECT o.title, o.summary, f.url AS feed_url
        FROM opportunities o LEFT JOIN feeds f ON f.id = o.feed_id
        WHERE o.id = ? AND o.status = 'pending'
      `).bind(id).first();

      if (candidate && !evaluateOpportunity({ ...candidate, feedUrl: candidate.feed_url }).accepted) {
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
      SELECT o.*, f.url AS feed_url
      FROM opportunities o LEFT JOIN feeds f ON f.id = o.feed_id
      WHERE o.id = ? AND o.status = 'approved'
    `).bind(id).first();

    if (!item) return send(env, chatId, "Нет такого одобренного материала.");

    if (!evaluateOpportunity({ ...item, feedUrl: item.feed_url }).accepted) {
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
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return send(env, chatId, "Формат: /addfeed Название | https://example.com/rss");
    }
    let feedUrl;
    try {
      feedUrl = new URL(parts[1]);
    } catch {
      return send(env, chatId, "Укажи корректный URL источника.");
    }
    if (!["http:", "https:"].includes(feedUrl.protocol)) {
      return send(env, chatId, "Источник должен использовать HTTP или HTTPS.");
    }

    await env.DB.prepare(
      "INSERT OR IGNORE INTO feeds (name, url) VALUES (?, ?)"
    ).bind(parts[0].slice(0, 120), feedUrl.toString()).run();

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
    ctx.waitUntil(collect(env).catch(error => {
      console.error("Scheduled collection failed:", error);
    }));
  }
};