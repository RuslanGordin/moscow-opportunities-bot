const HELP = ['/myid — мой ID','/collect — сбор RSS','/queue — очередь','/approve ID — одобрить','/reject ID — отклонить','/publish ID — опубликовать одобренное','/feeds — источники','/addfeed Название | URL — добавить RSS','/stats — статистика'].join('\n');
const CAT = { internship:'🎓 Стажировки', event:'📅 Мероприятия', design:'🎨 Дизайн', it:'💻 IT и цифровые профессии', marketing:'📣 Маркетинг', vacancy:'💼 Работа и подработка', education:'📚 Образование', other:'📰 Другое' };

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function decode(s='') {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function clean(s='') { return decode(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function tag(block,names) {
  for (const n of names) { const m=block.match(new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'\\s*>','i')); if(m) return clean(m[1]); }
  return '';
}
function linkOf(block) { const m=block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i); return m ? decode(m[1]).trim() : tag(block,['link']); }
function safeUrl(s) { try { const u=new URL(s); return ['http:','https:'].includes(u.protocol)?u.href:''; } catch { return ''; } }
function normUrl(s) { try { const u=new URL(s); u.hash=''; for(const k of [...u.searchParams.keys()]) if(/^(utm_|yclid|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); u.hostname=u.hostname.toLowerCase(); return u.href.replace(/\/$/,''); } catch { return s; } }
function normTitle(s='') { return clean(s).toLocaleLowerCase('ru').replace(/[«»„“”"']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim(); }

function categoryOf(title,summary) {
  const t=(title+' '+summary).toLocaleLowerCase('ru');
  if(/стажиров|internship|intern\b|практик[аиу]/i.test(t)) return CAT.internship;
  if(/день открытых дверей|конференц|форум|лекци|мастер.?класс|митап|хакатон|выставк|концерт|встреча|мероприят|вебинар|олимпиад|конкурс|грант|образовательн/i.test(t)) return CAT.event;
  if(/ваканси|подработ|работа\b|работать|зарплат|оплачиваем|частичная занятость|гибкий график|без опыта/i.test(t)) {
    if(/дизайн|дизайнер|figma|illustrator|photoshop/i.test(t)) return CAT.design;
    if(/маркет|smm|seo|контент|реклам/i.test(t)) return CAT.marketing;
    if(/разработ|программи|python|javascript|typescript|java\b|c\+\+|c#|golang|devops|qa\b|тестиров|frontend|backend|аналитик данных/i.test(t)) return CAT.it;
    return CAT.vacancy;
  }
  if(/дизайн|дизайнер|figma|illustrator|photoshop/i.test(t)) return CAT.design;
  if(/маркет|smm|seo|контент-маркет|таргет/i.test(t)) return CAT.marketing;
  if(/разработ|программи|python|javascript|typescript|java\b|c\+\+|c#|golang|devops|qa\b|тестиров|frontend|backend|нейросет|машинн.*обуч|искусственн.*интеллект/i.test(t)) return CAT.it;
  if(/курс|обучени|образован|бакалавр|магистратур|университет|студент|школа/i.test(t)) return CAT.education;
  return CAT.other;
}
function useful(title,summary,url) { const t=(title+' '+summary).toLowerCase(); return title.length>=8 && !!url && !/политик конфиденциальности|cookie|пользовательское соглашение|архив новостей/i.test(t); }

async function tg(env,method,payload={}) {
  const r=await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json(); if(!d.ok) throw new Error('Telegram '+method+': '+(d.description||'error')); return d.result;
}
function admin(m,env) { return !!(m&&m.from&&(env.ADMIN_IDS||'').split(',').map(x=>x.trim()).includes(String(m.from.id))); }
function send(env,id,text) { return tg(env,'sendMessage',{chat_id:id,text,parse_mode:'HTML',disable_web_page_preview:true}); }

async function parseFeed(xml) {
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(m=>{
    const b=m[2], title=tag(b,['title']), summary=tag(b,['description','summary','content:encoded','content']);
    const url=safeUrl(linkOf(b)||tag(b,['guid','id'])), published=tag(b,['pubDate','published','updated','dc:date']), guid=tag(b,['guid','id'])||url;
    return {title,summary,url,published,guid};
  }).filter(x=>x.title&&x.url);
}

async function collect(env) {
  const feeds=await env.DB.prepare('SELECT id,name,url FROM feeds WHERE active=1 ORDER BY id').all();
  let added=0,skipped=0; const errors=[];
  for(const feed of feeds.results||[]) {
    try {
      const r=await fetch(feed.url,{headers:{'user-agent':'MoscowOpportunitiesBot/1.0'},signal:AbortSignal.timeout(15000)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const items=await parseFeed(await r.text());
      for(const item of items.slice(0,50)) {
        const title=clean(item.title).slice(0,500), summary=clean(item.summary).slice(0,3000), url=normUrl(item.url);
        if(!useful(title,summary,url)) { skipped++; continue; }
        const byUrl=await env.DB.prepare('SELECT id FROM opportunities WHERE url=? LIMIT 1').bind(url).first();
        if(byUrl) { skipped++; continue; }
        const byTitle=await env.DB.prepare("SELECT id FROM opportunities WHERE lower(title)=lower(?) AND discovered_at>=datetime('now','-45 days') LIMIT 1").bind(title).first();
        if(byTitle||normTitle(title).length<8) { skipped++; continue; }
        const result=await env.DB.prepare("INSERT OR IGNORE INTO opportunities (feed_id,guid,title,summary,url,category,source_published_at,discovered_at,status) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'pending')")
          .bind(feed.id,item.guid,title,summary,url,categoryOf(title,summary),item.published||null).run();
        if(result.meta&&result.meta.changes) added++; else skipped++;
      }
    } catch(e) { errors.push(feed.name+': '+e.message); }
  }
  return {added,skipped,errors};
}

async function getItem(env,id) { return env.DB.prepare('SELECT o.*,f.name AS source FROM opportunities o LEFT JOIN feeds f ON f.id=o.feed_id WHERE o.id=?').bind(id).first(); }
function postText(row) {
  return '<b>'+esc(row.category||CAT.other)+'</b>\n\n<b>'+esc(row.title||'')+'</b>'+
    (row.summary?'\n\n'+esc(row.summary.slice(0,500)):'')+
    '\n\n<a href="'+esc(row.url)+'">Открыть первоисточник</a>\n<i>Источник: '+esc(row.source||'Источник')+'</i>';
}
async function publish(env,id,chatId) {
  const row=await getItem(env,id);
  if(!row) return send(env,chatId,'Материал #'+id+' не найден.');
  if(row.status!=='approved') return send(env,chatId,'Сначала одобри материал: /approve '+id);
  const sent=await tg(env,'sendMessage',{chat_id:env.CHANNEL_ID,text:postText(row),parse_mode:'HTML',disable_web_page_preview:false});
  await env.DB.prepare("UPDATE opportunities SET status='published',telegram_message_id=?,published_at=CURRENT_TIMESTAMP WHERE id=?").bind(sent.message_id,id).run();
  return send(env,chatId,'Материал #'+id+' опубликован.');
}

async function command(m,env) {
  const chat=m.chat.id, bits=(m.text||'').trim().split(/\s+/), cmd=(bits.shift()||'').split('@')[0].toLowerCase(), arg=bits.join(' ').trim();
  if(cmd==='/myid') return send(env,chat,'Твой Telegram ID: <code>'+m.from.id+'</code>');
  if(cmd==='/start'||cmd==='/help') return send(env,chat,'Бот «Москва | Возможности» работает.\n\n'+HELP);
  if(!admin(m,env)) return send(env,chat,'Команда доступна только администратору.');
  if(cmd==='/collect') {
    const r=await collect(env); return send(env,chat,'Сбор завершён.\nНовых материалов: '+r.added+'\nПропущено: '+r.skipped+(r.errors.length?'\nОшибки:\n'+r.errors.map(esc).join('\n'):''));
  }
  if(cmd==='/queue') {
    const r=await env.DB.prepare("SELECT id,title,category FROM opportunities WHERE status='pending' ORDER BY discovered_at DESC LIMIT 10").all();
    if(!r.results||!r.results.length) return send(env,chat,'Очередь пуста.');
    return send(env,chat,r.results.map(x=>'<b>#'+x.id+'</b> '+esc(x.title)+'\n'+esc(x.category||CAT.other)).join('\n\n'));
  }
  if(cmd==='/approve'||cmd==='/reject') {
    const id=Number(arg); if(!Number.isInteger(id)||id<1) return send(env,chat,'Формат: '+cmd+' ID');
    const status=cmd==='/approve'?'approved':'rejected';
    const r=await env.DB.prepare("UPDATE opportunities SET status=? WHERE id=? AND status IN ('pending','approved')").bind(status,id).run();
    return send(env,chat,r.meta&&r.meta.changes?'Материал #'+id+(status==='approved'?' одобрен.':' отклонён.'):'Материал не найден или уже опубликован.');
  }
  if(cmd==='/publish') { const id=Number(arg); if(!Number.isInteger(id)||id<1) return send(env,chat,'Формат: /publish ID'); return publish(env,id,chat); }
  if(cmd==='/feeds') {
    const r=await env.DB.prepare('SELECT id,name,url,active FROM feeds ORDER BY id').all();
    if(!r.results||!r.results.length) return send(env,chat,'Источников пока нет.');
    return send(env,chat,r.results.map(f=>'<b>#'+f.id+' '+esc(f.name)+'</b> — '+(f.active?'включён':'выключен')+'\n'+esc(f.url)).join('\n\n'));
  }
  if(cmd==='/addfeed') {
    const p=arg.split('|').map(x=>x.trim()); if(p.length!==2||!p[0]||!safeUrl(p[1])) return send(env,chat,'Формат: /addfeed Название | https://example.com/feed.xml');
    try { await env.DB.prepare('INSERT INTO feeds (name,url,active) VALUES (?,?,1)').bind(p[0].slice(0,120),p[1]).run(); return send(env,chat,'RSS-источник добавлен.'); }
    catch { return send(env,chat,'Такой RSS-источник уже добавлен.'); }
  }
  if(cmd==='/stats') {
    const r=await env.DB.prepare('SELECT status,COUNT(*) AS count FROM opportunities GROUP BY status').all();
    const c=Object.fromEntries((r.results||[]).map(x=>[x.status,x.count]));
    return send(env,chat,'Статистика:\nВ очереди: '+(c.pending||0)+'\nОдобрено: '+(c.approved||0)+'\nОпубликовано: '+(c.published||0)+'\nОтклонено: '+(c.rejected||0));
  }
  return send(env,chat,'Неизвестная команда. Используй /help.');
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/health') return new Response('Moscow Opportunities Bot is running.');
    if(url.pathname==='/setup'&&request.method==='GET') {
      if(!env.SETUP_SECRET||url.searchParams.get('key')!==env.SETUP_SECRET) return new Response('Unauthorized',{status:401});
      const result=await tg(env,'setWebhook',{url:url.origin+'/telegram',secret_token:env.WEBHOOK_SECRET,allowed_updates:['message']});
      return Response.json({ok:true,result});
    }
    if(url.pathname==='/telegram'&&request.method==='POST') {
      if(env.WEBHOOK_SECRET&&request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET) return new Response('Unauthorized',{status:401});
      const update=await request.json();
      if(update.message&&update.message.text) {
        try { await command(update.message,env); }
        catch(e) { console.error('Telegram update failed:',e); await send(env,update.message.chat.id,'Не удалось выполнить команду. Проверь журналы Worker.'); }
      }
      return new Response('OK');
    }
    return new Response('Not found',{status:404});
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(collect(env).then(r=>console.log('Scheduled collection:',JSON.stringify(r))).catch(e=>console.error('Scheduled collection failed:',e)));
  }
};
