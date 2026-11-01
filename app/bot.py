import asyncio
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
CHANNEL_ID = os.getenv("CHANNEL_ID", "").strip()
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip().isdigit()}
DB_PATH = os.getenv("DB_PATH", "data.sqlite3")
COLLECT_EVERY_MINUTES = int(os.getenv("COLLECT_EVERY_MINUTES", "60"))
MAX_POSTS_PER_RUN = int(os.getenv("MAX_POSTS_PER_RUN", "5"))

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is missing in .env")
if not ADMIN_IDS:
    raise RuntimeError("Set at least one numeric Telegram user ID in ADMIN_IDS")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("moscow-opportunities")

bot = Bot(BOT_TOKEN)
dp = Dispatcher()
scheduler = AsyncIOScheduler(timezone="Europe/Moscow")

DEFAULT_FEEDS = [
    # Replace or extend these with feeds whose terms permit reuse.
    # The bot stores source links and attributes every item.
    ("Habr Career", "https://career.habr.com/vacancies/rss"),
]


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS feeds(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS items(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, summary TEXT, link TEXT NOT NULL UNIQUE,
            source TEXT, published TEXT, category TEXT, status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL, telegram_message_id INTEGER
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS posts(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER, published_at TEXT, telegram_message_id INTEGER,
            FOREIGN KEY(item_id) REFERENCES items(id)
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS ad_slots(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            advertiser TEXT, text TEXT, start_at TEXT, end_at TEXT, status TEXT DEFAULT 'draft'
        )""")
        count = c.execute("SELECT COUNT(*) n FROM feeds").fetchone()["n"]
        if count == 0:
            c.executemany("INSERT OR IGNORE INTO feeds(name,url) VALUES(?,?)", DEFAULT_FEEDS)


def is_admin(message: Message) -> bool:
    return bool(message.from_user and message.from_user.id in ADMIN_IDS)


def clean_html(value: str) -> str:
    value = re.sub(r"<(script|style).*?</\\1>", " ", value or "", flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"&nbsp;|&#160;", " ", value, flags=re.I)
    value = re.sub(r"&amp;", "&", value)
    value = re.sub(r"&quot;", '"', value)
    value = re.sub(r"&#39;|&apos;", "'", value)
    return re.sub(r"\\s+", " ", value).strip()


def categorize(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ("стажиров", "intern", "практик")):
        return "🎓 Стажировки"
    if any(x in t for x in ("python", "разработ", "программи", "qa", "тестиров", "аналитик", "devops", "дизайн")):
        return "💻 IT и цифровые профессии"
    if any(x in t for x in ("ваканси", "работ", "подработ", "зарплат")):
        return "💼 Работа и подработка"
    if any(x in t for x in ("бесплат", "выставк", "лекци", "концерт", "форум", "мероприят")):
        return "📍 События и возможности"
    return "📰 Полезное"


def safe_link(link: str) -> bool:
    try:
        parsed = urlparse(link)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def format_post(row) -> str:
    title = clean_html(row["title"])[:180]
    summary = clean_html(row["summary"])[:550]
    source = clean_html(row["source"])[:80]
    category = row["category"] or "📰 Полезное"
    parts = [f"<b>{category}</b>", "", f"<b>{title}</b>"]
    if summary:
        parts += ["", summary]
    parts += ["", f'<a href="{row["link"]}">Источник и подробности</a>', f"<i>Источник: {source}</i>"]
    return "\n".join(parts)


async def collect():
    log.info("Starting feed collection")
    with db() as c:
        feeds = c.execute("SELECT * FROM feeds WHERE active=1").fetchall()
    added = 0
    for feed in feeds:
        try:
            parsed = await asyncio.to_thread(feedparser.parse, feed["url"])
            for entry in parsed.entries[:30]:
                link = getattr(entry, "link", "")
                title = clean_html(getattr(entry, "title", ""))
                if not title or not safe_link(link):
                    continue
                summary = clean_html(getattr(entry, "summary", "") or getattr(entry, "description", ""))
                published = getattr(entry, "published", "") or getattr(entry, "updated", "")
                category = categorize(title + " " + summary)
                with db() as c:
                    cur = c.execute(
                        """INSERT OR IGNORE INTO items
                        (title,summary,link,source,published,category,status,created_at)
                        VALUES(?,?,?,?,?,?, 'pending', ?)""",
                        (title, summary, link, feed["name"], published, category,
                         datetime.now(timezone.utc).isoformat())
                    )
                    added += cur.rowcount
        except Exception:
            log.exception("Feed failed: %s", feed["url"])
    log.info("Collection complete, added=%s", added)
    return added


async def publish_item(item_id: int):
    if not CHANNEL_ID:
        raise RuntimeError("CHANNEL_ID is not configured")
    with db() as c:
        row = c.execute("SELECT * FROM items WHERE id=? AND status='approved'", (item_id,)).fetchone()
    if not row:
        raise ValueError("Item not found or not approved")
    msg = await bot.send_message(
        CHANNEL_ID, format_post(row), parse_mode="HTML", disable_web_page_preview=False
    )
    with db() as c:
        c.execute(
            "UPDATE items SET status='published', telegram_message_id=? WHERE id=?",
            (msg.message_id, item_id)
        )
        c.execute(
            "INSERT INTO posts(item_id,published_at,telegram_message_id) VALUES(?,?,?)",
            (item_id, datetime.now(timezone.utc).isoformat(), msg.message_id)
        )
    return msg.message_id


@dp.message(Command("start"))
async def start(message: Message):
    await message.answer(
        "Бот «Москва: возможности» работает.\n\n"
        "/help — команды\n"
        "Доступ к управлению есть только у администратора."
    )


@dp.message(Command("help"))
async def help_cmd(message: Message):
    if not is_admin(message):
        await message.answer("Бот собирает полезные материалы. Управление доступно администратору.")
        return
    await message.answer(
        "<b>Команды администратора</b>\n"
        "/collect — собрать новые материалы\n"
        "/queue — показать ожидающие материалы\n"
        "/approve ID — одобрить материал\n"
        "/reject ID — отклонить материал\n"
        "/publish ID — опубликовать одобренный материал\n"
        "/feeds — список RSS-источников\n"
        "/addfeed Название | URL — добавить RSS\n"
        "/stats — статистика\n"
        "/ad Текст рекламного предложения — сохранить черновик рекламного слота",
        parse_mode="HTML"
    )


@dp.message(Command("collect"))
async def collect_cmd(message: Message):
    if not is_admin(message):
        return
    added = await collect()
    await message.answer(f"Сбор завершён. Новых материалов: {added}.")


@dp.message(Command("queue"))
async def queue_cmd(message: Message):
    if not is_admin(message):
        return
    with db() as c:
        rows = c.execute(
            "SELECT id,title,source,category FROM items WHERE status='pending' ORDER BY id DESC LIMIT 10"
        ).fetchall()
    if not rows:
        await message.answer("Очередь пуста.")
        return
    for r in rows:
        await message.answer(
            f"#{r['id']} · {r['category']}\n<b>{r['title']}</b>\n"
            f"Источник: {r['source']}\nОдобрить: /approve {r['id']}\n"
            f"Отклонить: /reject {r['id']}",
            parse_mode="HTML"
        )


@dp.message(Command("approve"))
async def approve_cmd(message: Message):
    if not is_admin(message):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /approve ID")
        return
    with db() as c:
        cur = c.execute(
            "UPDATE items SET status='approved' WHERE id=? AND status='pending'",
            (int(parts[1]),)
        )
    await message.answer("Материал одобрен." if cur.rowcount else "Материал не найден в очереди.")


@dp.message(Command("reject"))
async def reject_cmd(message: Message):
    if not is_admin(message):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /reject ID")
        return
    with db() as c:
        cur = c.execute(
            "UPDATE items SET status='rejected' WHERE id=? AND status='pending'",
            (int(parts[1]),)
        )
    await message.answer("Материал отклонён." if cur.rowcount else "Материал не найден в очереди.")


@dp.message(Command("publish"))
async def publish_cmd(message: Message):
    if not is_admin(message):
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /publish ID")
        return
    try:
        msg_id = await publish_item(int(parts[1]))
        await message.answer(f"Опубликовано. ID сообщения в канале: {msg_id}.")
    except Exception as e:
        await message.answer(f"Не удалось опубликовать: {e}")


@dp.message(Command("feeds"))
async def feeds_cmd(message: Message):
    if not is_admin(message):
        return
    with db() as c:
        rows = c.execute("SELECT id,name,url,active FROM feeds ORDER BY id").fetchall()
    await message.answer(
        "\n".join(
            f"#{r['id']} {r['name']} — {'вкл' if r['active'] else 'выкл'}\n{r['url']}"
            for r in rows
        ) or "Источников пока нет."
    )


@dp.message(Command("addfeed"))
async def addfeed_cmd(message: Message):
    if not is_admin(message):
        return
    payload = (message.text or "").partition(" ")[2]
    if "|" not in payload:
        await message.answer("Формат: /addfeed Название | https://example.com/feed.xml")
        return
    name, url = [x.strip() for x in payload.split("|", 1)]
    if not name or not safe_link(url):
        await message.answer("Проверь название и URL (только http/https).")
        return
    with db() as c:
        try:
            c.execute("INSERT INTO feeds(name,url) VALUES(?,?)", (name, url))
            await message.answer("Источник добавлен.")
        except sqlite3.IntegrityError:
            await message.answer("Такой URL уже добавлен.")


@dp.message(Command("stats"))
async def stats_cmd(message: Message):
    if not is_admin(message):
        return
    with db() as c:
        total = c.execute("SELECT COUNT(*) n FROM items").fetchone()["n"]
        pending = c.execute("SELECT COUNT(*) n FROM items WHERE status='pending'").fetchone()["n"]
        published = c.execute("SELECT COUNT(*) n FROM items WHERE status='published'").fetchone()["n"]
        feeds = c.execute("SELECT COUNT(*) n FROM feeds WHERE active=1").fetchone()["n"]
    await message.answer(
        f"Источников: {feeds}\nМатериалов собрано: {total}\n"
        f"В очереди: {pending}\nОпубликовано: {published}"
    )


@dp.message(Command("ad"))
async def ad_cmd(message: Message):
    if not is_admin(message):
        return
    payload = (message.text or "").partition(" ")[2].strip()
    if not payload:
        await message.answer("Использование: /ad Текст рекламного предложения")
        return
    with db() as c:
        c.execute(
            "INSERT INTO ad_slots(advertiser,text,status) VALUES(?,?, 'draft')",
            ("Не указан", payload)
        )
    await message.answer(
        "Рекламный черновик сохранён. Перед публикацией проверьте рекламную маркировку "
        "и применимые требования закона."
    )


async def main():
    init_db()
    scheduler.add_job(collect, "interval", minutes=COLLECT_EVERY_MINUTES, max_instances=1)
    scheduler.start()
    log.info("Bot started")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
