/* Egypt Cinema — تطبيق صفحة واحدة (SPA) بدون خادم — المصدر: Top Cinema */
(function () {
  "use strict";

  /* كاشف أخطاء ظاهر (يساعد في معرفة أي مشكلة على الهوست) */
  function showErr(msg) {
    var box = document.createElement("div");
    box.style.position = "fixed";
    box.style.bottom = "0";
    box.style.left = "0";
    box.style.right = "0";
    box.style.background = "#1a0b0d";
    box.style.color = "#ff6b6b";
    box.style.padding = "10px 14px";
    box.style.zIndex = "99999";
    box.style.fontFamily = "monospace";
    box.style.fontSize = "12px";
    box.style.borderTop = "2px solid #e50914";
    box.textContent = "خطأ: " + msg;
    document.body.appendChild(box);
  }

  window.addEventListener("error", function (ev) {
    showErr((ev && ev.message) || "شعر بالخطأ");
  });
  window.addEventListener("unhandledrejection", function (ev) {
    showErr("Promise: " + ((ev && ev.reason && ev.reason.message) || ev.reason || "unknown"));
  });

  /* ---------- إعدادات ---------- */
  /* كل بيانات الموقع من Top Cinema عبر وسيط الخادم /search/ (يتجاوز CORS) */
  const TC = "/search/wp-json/wp/v2";
  const LS_LIB = "tc_guest_library_v2";

  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /* تنسيق عربي لعرض الأرقام */
  const fa = (n) => (n == null ? "" : n.toLocaleString("ar-EG"));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- مكتبة المحلي (الضيف) ---------- */
  const emptyLib = () => ({ favorites: {}, ratings: {}, history: {} });

  function loadLib() {
    try {
      return Object.assign(emptyLib(), JSON.parse(localStorage.getItem(LS_LIB) || "{}"));
    } catch {
      return emptyLib();
    }
  }

  function saveLib(lib) {
    localStorage.setItem(LS_LIB, JSON.stringify(lib));
    renderNavBadges();
  }

  function snapshotOf(it) {
    return { id: it.id, title: it.title, year: it.year, image: it.image || "" };
  }

  function snapshotToItem(s) {
    return {
      id: s.id,
      title: s.title || "فيلم",
      year: s.year || "",
      cats: [],
      catNames: [],
      image: s.image || "",
      link: "",
      desc: "",
    };
  }

  function isFav(id) {
    return !!loadLib().favorites[id];
  }

  function toggleFav(item) {
    const lib = loadLib();
    if (lib.favorites[item.id]) {
      delete lib.favorites[item.id];
    } else {
      lib.favorites[item.id] = { snapshot: snapshotOf(item) };
    }
    saveLib(lib);
    return isFav(item.id);
  }

  function getRating(id) {
    const r = loadLib().ratings[id];
    return r ? r.rating : null;
  }

  function setRating(item, rating) {
    const lib = loadLib();
    if (rating) {
      lib.ratings[item.id] = { snapshot: snapshotOf(item), rating };
    } else {
      delete lib.ratings[item.id];
    }
    saveLib(lib);
  }

  function addHistory(item, progress, duration) {
    const lib = loadLib();
    lib.history[item.id] = {
      snapshot: snapshotOf(item),
      progress: progress || 0,
      duration: duration || 0,
      updatedAt: Date.now(),
    };
    saveLib(lib);
  }

  function renderNavBadges() {
    const lib = loadLib();
    const set = (sel, n) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.textContent = n > 0 ? " (" + n + ")" : "";
    };
    set('[data-nav="favs"] .count', Object.keys(lib.favorites).length);
    set('[data-nav="hist"] .count', Object.keys(lib.history).length);
    set('[data-nav="rated"] .count', Object.keys(lib.ratings).length);
  }

  /* ---------- جلب البيانات من Top Cinema (دائمًا تحديث بدون كاش) ---------- */
  async function tc(resource, params) {
    const url = new URL(TC + "/" + resource.replace(/^\//, ""), location.origin);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 18000);
        let res;
        try {
          res = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: ctrl.signal });
          if (!res.ok) throw new Error("منبع " + res.status);
          const json = await res.json();
          return {
            json,
            total: parseInt((res.headers.get("X-WP-Total") || "0"), 10),
            totalPages: parseInt((res.headers.get("X-WP-TotalPages") || "1"), 10),
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (attempt < 2) await sleep(1000 * (attempt + 1));
      }
    }
    return { json: null, total: 0, totalPages: 1 };
  }

  /* عناوين Top Cinema مثل: "فيلم Saipan 2025 مترجم اون لاين" */
  function parseWpTitle(title) {
    const t = title || "";
    const isSeries = /مسلسل|الحلقة|موسم|episode|season/i.test(t);
    const year = (t.match(/(?:19|20)\d{2}/) || [])[0] || "";
    const enPart = t
      .replace(/[\u0600-\u06FF\ufb50-\ufdff\ufe70-\ufeff]/g, " ")
      .replace(/[^A-Za-z0-9 .'&:!()\-]+/g, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { isSeries, year, enPart };
  }

  const stripHtml = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  /* تحويل الأرقام/الأحرف العربية إلى لاتينية */
  const toLatin = (s) =>
    String(s || "")
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

  /* تحويل "الموسم السابع" و "الحادي عشر" و "الثاني والعشرون" إلى رقم */
  const wordN = (w2) => {
    const unit = {
      الحادي: 1, الحادية: 1, الثاني: 2, الثانية: 2, الثالث: 3, الثالثة: 3,
      الرابع: 4, الرابعة: 4, الخامس: 5, الخامسة: 5, السادس: 6, السادسة: 6,
      السابع: 7, السابعة: 7, الثامن: 8, الثامنة: 8, التاسع: 9, التاسعة: 9,
      العاشر: 10, العاشرة: 10
    };
    const tens = {
      عشر: 10, عشرة: 10, عشرون: 20, عشرين: 20, ثلاثون: 30, ثلاثين: 30,
      اربعون: 40, أربعون: 40, اربعين: 40, أربعين: 40, خمسون: 50, خمسين: 50,
      ستون: 60, ستين: 60, سبعون: 70, سبعين: 70, ثمانون: 80, ثمانين: 80,
      تسعون: 90, تسعين: 90
    };
    const w = (" " + (w2 || "") + " ")
      .replace(/[أإآ]/g, "ا")
      .replace(/\s+/g, " ")
      .trim();
    for (const k of Object.keys(unit).sort((x, y) => y.length - x.length)) {
      if (w === k || w.startsWith(k + " ")) {
        const rest = w.slice(k.length).trim().replace(/^و/, "").trim();
        if (tens[rest]) return unit[k] + tens[rest];
        return unit[k];
      }
    }
    return tens[w] || 0;
  };

  /* رقم الجزء/الموسم → كلمة عربية (الجزء الأول، الثاني، الثالث، الرابع، الحادي عشر…) */
  function arSeason(n) {
    n = +n || 0;
    if (n <= 0) return "";
    const ones = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"];
    const tbl = ones.concat([
      "العاشر", "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر",
      "الخامس عشر", "السادس عشر", "السابع عشر", "الثامن عشر", "التاسع عشر", "العشرون",
    ]);
    if (tbl[n]) return tbl[n];
    const lead = ["", "الحادي", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"][n % 10];
    const tensW = { 20: "العشرون", 30: "الثلاثون", 40: "الأربعون", 50: "الخمسون", 60: "الستون", 70: "السبعون", 80: "الثمانون", 90: "التسعون" };
    const t = n - (n % 10);
    if (n % 10 === 0 && tensW[t]) return tensW[t];
    return (lead || "") + " و" + (tensW[t] || fa(t));
  }

  /* تحليل عنوان حلقة في Top Cinema مثل:
     "انمي ون بيس One Piece الحلقة 1178 مترجمة"
     "مسلسل X الموسم 2 الحلقة 5 مترجمة"
     "مسلسل Hawaii Five-0 الموسم السابع الحلقة 25 والاخيرة مترجمة"
     => { base, season, episode, finale } */
  function parseEpTitle(title) {
    const t = toLatin(stripHtml(title));
    const isEpisode = /الحلقة/i.test(t);
    let episode = 0;
    let finale = false;
    if (isEpisode) {
      const m = t.match(/الحلقة\s*\d+/i);
      if (m) episode = parseInt(m[0].replace(/\D/g, ""), 10) || 0;
      if (/الاخيرة|الاخير|اخيرة|فينال|finale/i.test(t)) finale = true;
      if (!m && !finale) finale = true;
    }
    /* رقم الموسم/الجزء إن جاء رقمًا (٢ أو 14) أو كلمةً (السابع، الحادي عشر) */
    let season = 0;
    const sDigit = t.match(/الموسم\s*(\d+)/i);
    const sWord = t.match(/الموسم\s+(\S+(?:\s+\S+)?)/i);
    if (sDigit) season = parseInt(sDigit[1], 10) || 0;
    else if (sWord) season = wordN(sWord[1]) || 0;
    if (!season) {
      const sDigit2 = t.match(/الجزء\s*(\d+)/i);
      const sWord2 = t.match(/الجزء\s+(\S+(?:\s+\S+)?)/i);
      if (sDigit2) season = parseInt(sDigit2[1], 10) || 0;
      else if (sWord2) season = wordN(sWord2[1]) || 0;
    }
    let base = t
      .replace(/\s*الحلقة.*$/g, "")
      .replace(/\s*الموسم.*$/g, "")
      .replace(/\s*الجزء.*$/g, "");
    base = base
      .replace(/^(?:انمي|مسلسل|فيلم|افلام انمي|افلام)\s*[:：\-]?\s*/i, "")
      .replace(/\s*(?:مترجمة|مترجم|اون لاين|كاملة|مشاهدة|والاخيرة|الاخيرة)\s*$/i, "")
      .trim();
    return { isEpisode, episode, finale, season, base };
  }

  let catsById = {};
  async function ensureCats() {
    const r = await tc("categories", { per_page: 100, _fields: "id,name,count,slug" });
    const list = (r.json && r.json.length ? r.json : []).filter((c) => c.count > 0);
    list.forEach((c) => (catsById[c.id] = c.name));
    return list;
  }

  /* حول كائن post من WP إلى عنصر بطاقة */
  function itemFromPost(p, image) {
    const title = stripHtml(p.title && (p.title.rendered || p.title));
    const parsed = parseWpTitle(title);
    let year = "";
    if (p.date) year = String(new Date(p.date).getUTCFullYear());
    if (!year) year = parsed.year;
    const cats = (p.categories || []).filter(Boolean);
    return {
      id: p.id,
      title: title || "فيلم",
      year,
      cats,
      catNames: cats.map((c) => catsById[c]).filter(Boolean),
      image: image || "",
      link: p.link || p.url || "",
      desc: "",
      isSeries: parsed.isSeries,
    };
  }

  /* يجلب صور البوسترات لمجموعة posts فأكثر (دفعة واحدة عبر include) */
  async function attachMedia(posts) {
    if (!posts.length) return [];
    const ids = [...new Set(posts.map((p) => p.featured_media).filter(Boolean))];
    const mm = {};
    if (ids.length) {
      for (let i = 0; i < ids.length; i += 90) {
        const r = await tc("media", {
          include: ids.slice(i, i + 90).join(","),
          per_page: 100,
          _fields: "id,source_url",
        });
        for (const m of r.json || []) mm[m.id] = m.source_url;
      }
    }
    return rememberItems(posts.map((p) => itemFromPost(p, mm[p.featured_media])));
  }

  /* مختزن ذاكرة عناوين لترشيح فوري أثناء الكتابة في البحث */
  const knownItems = new Map();

  function rememberItems(items) {
    items.forEach((it) => {
      if (it && it.id && it.title) {
        knownItems.set(it.id, it);
        if (knownItems.size > 4000) {
          const first = knownItems.keys().next().value;
          knownItems.delete(first);
        }
      }
    });
    return items;
  }

  /* ضم حلقات المسلسل في بوستر واحد عند العرض في الشبكة/القائمة.
     الوضع الافتراضي: كل موسم/جزء ببوستر مستقل.
     الوضع "series": ضم كل المواسم في بوستر واحد (يُستخدم في نتائج البحث). */
  function dedupeSeries(items, mode) {
    const out = [];
    const seen = new Map();
    items.forEach((it) => {
      const p = parseEpTitle(it.title);
      if (!p.isEpisode || !p.base) {
        out.push(it);
        return;
      }
      const key = norm(p.base) + (mode === "series" ? "" : p.season ? "|s" + p.season : "");
      if (!norm(p.base)) {
        out.push(it);
        return;
      }
      let rep = seen.get(key);
      if (!rep) {
        rep = Object.assign({}, it, {
          title:
            mode === "series"
              ? p.base
              : p.base + (p.season ? " - الجزء " + arSeason(p.season) : ""),
          seriesCount: 1,
          seriesBase: p.base,
          seriesSeason: p.season || 0,
          seriesLastEp: p.episode || 0,
          seriesLastId: it.id,
        });
        seen.set(key, rep);
        out.push(rep);
      } else {
        rep.seriesCount++;
        if ((p.episode || 0) > rep.seriesLastEp) {
          rep.seriesLastEp = p.episode || 0;
          rep.seriesLastId = it.id;
        }
      }
    });
    out.forEach((rep) => {
      if (rep.seriesCount > 1 && rep.seriesLastId) rep.id = rep.seriesLastId;
    });
    /* إن كانت السلسلة لها أجزاء مرقّمة، فحلقات "الجزء الأول" التي لم تُرقّم
       في المصدر (تكتب "الحلقة X" بدون "الموسم") تُدمج في الجزء الأول أو تُسمّى به */
    if (mode !== "series") {
      const byBase = new Map();
      out.forEach((r) => {
        const k = "b|" + norm(r.seriesBase);
        if (!byBase.has(k)) byBase.set(k, []);
        byBase.get(k).push(r);
      });
      for (const arr of byBase.values()) {
        const hasParts = arr.some((r) => r.seriesSeason > 0);
        if (!hasParts) continue;
        const zeros = arr.filter((r) => !r.seriesSeason);
        const one = arr.find((r) => r.seriesSeason === 1);
        zeros.forEach((z) => {
          if (one) {
            one.seriesCount += z.seriesCount;
            if (z.seriesLastEp > one.seriesLastEp) {
              one.seriesLastEp = z.seriesLastEp;
              one.seriesLastId = z.seriesLastId;
            }
            out.splice(out.indexOf(z), 1);
          } else {
            z.title = (z.seriesBase || "") + " - الجزء الأول";
            z.seriesSeason = 1;
          }
        });
      }
    }
    return out;
  }

  /* ترتيب نتائج البحث حسب قربها من الاستعلام (الأقرب أولًا) */
  function searchScore(it, q) {
    const qN = norm(q);
    if (!qN) return 9999;
    const bN = norm(it.seriesBase || it.title || "");
    if (!bN) return 900;
    const qToks = qN.split(" ");
    const bToks = new Set(bN.split(" "));
    const hits = qToks.filter((t) => t && bToks.has(t)).length;
    let score;
    if (bN === qN) score = 0;
    else if (qToks.length === 1 && bToks.has(qToks[0])) score = bN.split(" ")[0] === qToks[0] ? 20 : 60;
    else if (bN.startsWith(qN)) score = 30;
    else if (bN.includes(qN)) score = 60;
    else if (qToks.length > 1 && hits === qToks.length) score = 80;
    else if (hits) score = 200 - hits * 60;
    else score = 1000;
    return score;
  }

  /* قائمة posts: بحث أو استعراض (fresh دائمًا) */
  async function fetchPosts(o) {
    const per_page = o.per_page || 40;
    const page = o.page || 1;
    let posts = [];
    let total = 0;
    let totalPages = 1;

    if (o.search) {
      const r = await tc("search", {
        search: o.search,
        per_page: 100,
        subtype: "post",
        _fields: "id,title,url",
      });
      if (!r.json || !r.json.length) return { items: [], total: 0, totalPages: 1 };
      if (o.fast) {
        return {
          items: r.json.map((x) => {
            const title = stripHtml(x.title && (x.title.rendered || x.title));
            const parsed = parseWpTitle(title);
            return {
              id: x.id,
              title,
              year: parsed.year || "",
              cats: [],
              catNames: [],
              image: "",
              link: x.url || "",
              desc: "",
              isSeries: parsed.isSeries,
            };
          }),
          total: r.total,
          totalPages: r.totalPages,
        };
      }
      /* تجميع كل صفحات سيرش Top Cinema (لأن كل حلقة نتيجة مستقلة) */
      const maxPages = o.pages || 1;
      const totalPagesS = Math.min(maxPages, r.totalPages || 1);
      const pagesRows = [r.json];
      if (totalPagesS > 1) {
        const rest = await mapPool(
          Array.from({ length: totalPagesS - 1 }, (_, k) => k + 2),
          4,
          (pg) =>
            tc("search", {
              search: o.search,
              page: pg,
              per_page: 100,
              subtype: "post",
              _fields: "id,title,url",
            })
        );
        rest.forEach((x) => pagesRows.push(x.json || []));
      }
      const seenIds = new Set();
      const found = [];
      pagesRows.forEach((rows) =>
        (rows || []).forEach((x) => {
          if (x && x.id && !seenIds.has(x.id)) {
            seenIds.add(x.id);
            found.push(x);
          }
        })
      );
      if (!found.length) return { items: [], total: 0, totalPages: 1 };
      const ids = found.map((x) => x.id);
      const dm = {};
      const batches = [];
      for (let i = 0; i < ids.length; i += 90) {
        batches.push(
          tc("posts", {
            include: ids.slice(i, i + 90).join(","),
            per_page: 100,
            _fields: "id,title,link,date,categories,featured_media",
          })
        );
      }
      const db = await Promise.all(batches);
      db.forEach((d) => (d.json || []).forEach((x) => (dm[x.id] = x)));
      posts = found.map((x) => Object.assign({}, dm[x.id] || {}, { id: x.id }));
      total = r.total;
      totalPages = r.totalPages;
    } else {
      const q = {
        per_page,
        page,
        _fields: "id,title,link,date,categories,featured_media",
        orderby: "date",
        order: o.order || "desc",
      };
      if (o.categories && String(o.categories)) {
        q.categories = String(o.categories)
          .split(",")
          .map((x) => parseInt(x, 10))
          .filter(Boolean)
          .join(",");
      }
      if (o.after) q.after = o.after;
      if (o.before) q.before = o.before;
      const r = await tc("posts", q);
      posts = r.json && r.json.length ? r.json : [];
      total = r.total;
      totalPages = r.totalPages;
    }
    const items = await attachMedia(posts);
    return { items, total, totalPages };
  }

  /* تفاصيل post واحد (لصفحة الفيلم + المشغل) */
  async function fetchPost(id) {
    const r = await tc("posts/" + id, {
      _fields: "id,title,link,date,categories,featured_media,content",
    });
    const p = r.json;
    if (!p || !p.id) return null;
    const items = await attachMedia([p]);
    const item = items[0];
    item.desc = stripHtml((p.content && p.content.rendered) || "");
    return item;
  }

  /* تجمع حلقات الأنمي/المسلسل من نفس العنوان عبر بحث WP وتجميعها بالأرقام */
  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  }

  async function fetchEpisodes(item) {
    const info = parseEpTitle(item.title);
    if (!info.isEpisode) return [];
    const baseEn = parseWpTitle(info.base).enPart;
    const searchKey = baseEn || info.base;
    let r1;
    try {
      r1 = await tc("search", { search: searchKey, per_page: 100, subtype: "post", _fields: "id,title" });
    } catch {
      r1 = { json: null };
    }
    if (!r1.json || !r1.json.length) return [];
    const total = r1.total || (r1.json || []).length;
    const totalPages = Math.min(25, r1.totalPages || 1, Math.ceil(total / 100));
    const rest = await mapPool(Array.from({ length: totalPages - 1 }, (_, k) => k + 2), 4, (pg) =>
      tc("search", { search: searchKey, page: pg, per_page: 100, subtype: "post", _fields: "id,title" })
    );
    const all = [...r1.json, ...rest.flatMap((r) => r.json || [])];
    const baseN = norm(info.base);
    const byId = new Map();
    all.forEach((x) => {
      const t = stripHtml(x.title && (x.title.rendered || x.title));
      const p = parseEpTitle(t);
      if (!p.isEpisode) return;
      /* اقبل الحلقة لو اسمها يبدأ بالمسلسل نفسه (أو بنفس الاسم بالضبط)،
         بحيث لا تتسرّب حلقات أعمال أخرى تحمل نفس الكلمة في الاسم */
      const bN = norm(p.base);
      if (bN === baseN) {
        byId.set(x.id, { id: x.id, title: t, season: p.season, episode: p.episode, finale: p.finale });
        return;
      }
      if (bN.length > baseN.length && bN.slice(-baseN.length) === baseN && bN[bN.length - baseN.length - 1] === " ") {
        byId.set(x.id, { id: x.id, title: t, season: p.season, episode: p.episode, finale: p.finale });
      }
    });
    const list = [...byId.values()];
    if (!list.length) return [];
    const hasSeasons = list.some((e) => e.season > 0);
    const noSeasonsMany = !hasSeasons && list.length > 100;
    if (hasSeasons) list.forEach((e) => { if (!e.season) e.season = 1; });
    const groups = new Map();
    list.forEach((e) => {
      if (noSeasonsMany) {
        const c = Math.floor((e.episode - 1) / 100);
        const k = "c" + c;
        if (!groups.has(k)) groups.set(k, { kind: "chunk", items: [] });
        groups.get(k).items.push(e);
      } else {
        const k = "s" + e.season;
        if (!groups.has(k)) groups.set(k, { kind: "season", season: e.season, items: [] });
        groups.get(k).items.push(e);
      }
    });
    return [...groups.keys()]
      .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
      .map((k) => {
        const g = groups.get(k);
        g.items.sort((x, y) => (x.finale ? 1 : 0) - (y.finale ? 1 : 0) || x.episode - y.episode);
        return { kind: g.kind, season: g.season || 0, items: g.items };
      });
  }

  function episodesHtml(groups, currentId) {
    return groups
      .map((g) => {
        let head = g.season ? "الجزء " + arSeason(g.season) : "الحلقات";
        if (g.kind === "chunk") {
          const es = g.items.map((i) => i.episode).filter(Boolean);
          head = es.length ? "الحلقة " + fa(Math.min.apply(null, es)) + " - " + fa(Math.max.apply(null, es)) : head;
        }
        const cells = g.items
          .map(
            (e) =>
              '<a class="ep-btn' +
              (e.id === currentId ? " current" : "") +
              '" data-ep="' +
              e.id +
              '" href="#/watch/' +
              e.id +
              '" title="' +
              esc(e.title) +
              '">' +
              (e.finale ? "الأخيرة" : fa(e.episode)) +
              "</a>"
          )
          .join("");
        return (
          '<div class="ep-block"><h3 class="ep-seas">' +
          head +
          ' <span class="ep-count">' +
          fa(g.items.length) +
          "</span></h3><div class=\"ep-grid\">" +
          cells +
          "</div></div>"
        );
      })
      .join("");
  }

  /* قائمة الحلقات المسطّحة للتنقل السريع بينها */
  let epList = [];

  function renderEpNav(currentId) {
    const nav = document.querySelector("#epNav");
    if (!nav) return;
    if (!epList.length) {
      nav.innerHTML = "";
      return;
    }
    const i = epList.findIndex((e) => String(e.id) === String(currentId));
    const prev = i > 0 ? epList[i - 1] : null;
    const next = i >= 0 && i < epList.length - 1 ? epList[i + 1] : null;
    if (!prev && !next) {
      nav.innerHTML = "";
      return;
    }
    const cell = (e, dir) =>
      e
        ? '<a class="ep-nav-btn" data-ep="' +
          e.id +
          '" href="#/watch/' +
          e.id +
          '">' +
          (dir === "prev" ? "‹ " : "") +
          "الحلقة " +
          (e.finale ? "الأخيرة" : fa(e.episode)) +
          (dir === "next" ? " ›" : "") +
          "</a>"
        : '<span class="ep-nav-btn disabled"></span>';
    nav.innerHTML = cell(prev, "prev") + cell(next, "next");
  }

  /* تبديل الحلقة داخل نفس الصفحة بدون إعادة بناء كاملة */
  async function switchEpisode(id) {
    const iframe = document.querySelector("#watchIframe");
    if (!iframe) {
      location.hash = "#/watch/" + id;
      return;
    }
    try {
      const item = await fetchPost(id);
      if (!item || !item.link) throw new Error("no link");
      iframe.src = item.link + "?embedScreen=true";
      const t = document.querySelector("#watchTitle");
      if (t) t.innerHTML = "▶ " + esc(item.title) + (item.year ? " (" + esc(item.year) + ")" : "");
      setDocTitle(item.title);
      document.querySelectorAll(".ep-btn").forEach((b) => b.classList.toggle("current", String(b.dataset.ep) === String(id)));
      addHistory(item);
      renderEpNav(id);
      const wf = document.querySelector(".watch-frame");
      if (wf) wf.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        history.replaceState(null, "", "#/watch/" + id);
      } catch (e2) {
        location.hash = "#/watch/" + id;
      }
    } catch (e) {
      location.hash = "#/watch/" + id;
    }
  }

  /* يحمّل الحلقات في مكان خالٍ داخل الصفحة الحالية */
  function renderEpGroups(groups, wrap, currentId) {
    wrap.innerHTML = episodesHtml(groups, currentId);
    epList = groups.reduce((acc, g) => acc.concat(g.items), []);
    renderEpNav(currentId);
    const sec = wrap.closest("section");
    if (sec) sec.style.display = "";
    observeReveals();
  }

  async function loadEpisodes(item, wrap) {
    if (!wrap) return;
    let groups = [];
    try {
      groups = await fetchEpisodes(item);
    } catch (e) {}
    if (!document.body.contains(wrap)) return;
    const sec = wrap.closest("section");
    if (!groups.length) {
      if (sec) sec.style.display = "none";
      epList = [];
      renderEpNav("");
      return;
    }
    renderEpGroups(groups, wrap, item.id);
  }

  /* أجزاء المسلسل كبوسترات منفصلة (الجزء الأول، الثاني...) بصورها الخاصة */
  async function loadParts(item, base, sec, titleEl, epsWrap) {
    if (!sec) return;
    sec.style.display = "none";
    let groups = [];
    try {
      groups = await fetchEpisodes(item);
    } catch (e) {}
    if (!document.body.contains(sec)) return;
    if (groups.length && epsWrap && document.body.contains(epsWrap)) renderEpGroups(groups, epsWrap, item.id);
    const baseId = String(item.id);
    const parts = [];
    (groups || []).forEach((g) => {
      const list = g.items || [];
      if (!list.length || !g.season) return;
      let rep = list[0];
      list.forEach((e) => {
        if ((e.episode || 0) > (rep.episode || 0) || ((e.episode || 0) === (rep.episode || 0) && e.finale && !rep.finale)) rep = e;
      });
      parts.push({ id: rep.id, season: g.season, count: list.length, isCurrent: list.some((e) => String(e.id) === baseId) });
    });
    if (parts.length < 2) return;
    parts.sort((a, b) => a.season - b.season);
    const dm = {};
    try {
      const d = await tc("posts", { include: parts.map((p) => p.id).join(","), per_page: 100, _fields: "id,featured_media,date" });
      (d.json || []).forEach((x) => (dm[x.id] = x));
    } catch {}
    const mm = {};
    const mids = [...new Set(parts.map((p) => (dm[p.id] || {}).featured_media).filter(Boolean))];
    if (mids.length) {
      try {
        const r = await tc("media", { include: mids.join(","), per_page: 100, _fields: "id,source_url" });
        (r.json || []).forEach((m) => (mm[m.id] = m.source_url));
      } catch {}
    }
    if (!document.body.contains(sec)) return;
    if (titleEl) titleEl.textContent = base;
    sec.querySelector(".part-row").innerHTML = parts
      .map((p) => {
        const img = mm[(dm[p.id] || {}).featured_media] || "";
        const year = dm[p.id] && dm[p.id].date ? String(new Date(dm[p.id].date).getUTCFullYear()) : "";
        const it = {
          id: p.id,
          title: base + " - الجزء " + arSeason(p.season),
          year,
          cats: [],
          catNames: [],
          image: img,
          link: "",
          desc: "",
          isSeries: true,
          seriesCount: p.count,
        };
        return (
          '<div class="part-item' +
          (p.isCurrent ? " current" : "") +
          '">' +
          cardHtml(it) +
          (p.isCurrent ? '<span class="part-current">الآن</span>' : "") +
          "</div>"
        );
      })
      .join("");
    sec.style.display = "";
    observeReveals();
  }

  /* ---------- العرض ---------- */
  let loadingTimer = null;
  function setLoading(mode) {
    const el = document.querySelector("#loadingTop");
    if (!el) return;
    clearTimeout(loadingTimer);
    if (mode) {
      loadingTimer = setTimeout(() => { el.style.display = "flex"; }, 220);
    } else {
      el.style.display = "none";
    }
  }

  function setDocTitle(title) {
    document.title = title ? title + " — Egypt Cinema" : "Egypt Cinema — مشاهدة الأفلام اون لاين";
  }

  const setActiveNav = (key) => {
    document.querySelectorAll(".nav a").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === key);
    });
  };

  const bindGlobal = () => {};

  function toast(msg) {
    const t = $("#toast");
    t.classList.remove("toast-hide");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => {
      t.classList.add("toast-hide");
      setTimeout(() => (t.hidden = true), 240);
    }, 1600);
  }

  function observeReveals() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
  }

  /* ---------- عناصر مشتركة ---------- */
  const browseQuery = (o) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(o || {})) if (v !== "" && v != null && v !== undefined) qs.set(k, String(v));
    return "#/movies" + (qs.toString() ? "?" + qs.toString() : "");
  };

  function progressBarHtml(item) {
    const lib = loadLib();
    const h = lib.history[item.id];
    if (!h || !h.duration) return "";
    const p = Math.min(100, Math.round(((h.progress || 0) / h.duration) * 100));
    return '<div class="card-progress"><span style="width:' + p + '%"></span></div>';
  }

  function cardHtml(item) {
    const id = item.id;
    const fav = isFav(id);
    const img = item.image || "";
    const metaParts = [];
    if (item.seriesCount > 1) metaParts.push('<span class="cmeta">' + fa(item.seriesCount) + " حلقة</span>");
    if (item.year) metaParts.push('<span class="cmeta" data-goto="' + browseQuery({ year: item.year }) + '">' + esc(item.year) + "</span>");
    if (item.isSeries) metaParts.push('<span class="cmeta">مسلسل</span>');
    item.catNames.forEach((nm, i) => {
      const cid = item.cats[i];
      if (cid) metaParts.push('<span class="cmeta" data-goto="' + browseQuery({ cat: cid }) + '">' + esc(nm) + "</span>");
    });
    const meta = metaParts.join(" · ") || "Top Cinema";
    const synopsis = (item.desc || "").slice(0, 150);
    const tags = item.catNames.length
      ? '<div class="card-detail-tags">' +
        item.catNames
          .slice(0, 3)
          .map((nm, i) => (item.cats[i] ? '<span data-goto="' + browseQuery({ cat: item.cats[i] }) + '">' + esc(nm) + "</span>" : ""))
          .join("") +
        "</div>"
      : "";
    const post =
      '<div class="card-poster ' +
      (img ? "" : "placeholder") +
      '" style="' +
      (img ? "background-image:url('" + esc(img) + "')" : "") +
      '">' +
      (!img ? "🎬" : "") +
      (item.seriesCount > 1 ? '<span class="card-eps">' + fa(item.seriesCount) + " حلقة</span>" : "") +
      '<div class="card-detail"><div class="card-detail-mask"></div><div class="card-detail-body">' +
      (synopsis ? '<p class="card-detail-overview">' + esc(synopsis) + "…</p>" : "") +
      tags +
      '<span class="card-detail-play">▶ شاهد الآن</span>' +
      "</div></div></div>";
    return (
      '<div class="card" data-id="' +
      id +
      '" data-title="' +
      esc(item.title) +
      '" data-poster="' +
      esc(item.image || "") +
      '" data-year="' +
      esc(item.year || "") +
      '">' +
      '<a class="card-link" href="#/movie/' +
      id +
      '">' +
      post +
      '<div class="card-body"><p class="card-title">' +
      esc(item.title) +
      '</p><p class="card-meta">' +
      meta +
      "</p></div></a>" +
      '<button class="card-fav ' +
      (fav ? "active" : "") +
      '" data-fav="' +
      id +
      '" title="مفضلة">' +
      (fav ? "♥" : "♡") +
      "</button>" +
      progressBarHtml(item) +
      "</div>"
    );
  }

  function gridHtml(list) {
    if (!list || !list.length) {
      return '<div class="empty"><div class="icon">🎬</div><p>لا يوجد محتوى للعرض</p></div>';
    }
    return '<div class="row">' + list.map(cardHtml).join("") + "</div>";
  }

  function sectionHead(title, link) {
    return (
      '<section class="section reveal"><div class="section-head"><h2>' +
      title +
      "</h2>" +
      (link ? '<a class="see-all" href="' + link + '">عرض الكل</a>' : "") +
      "</div></section>"
    );
  }

  /* ---------- الصفحات ---------- */
  const views = {};

  const FILM_CATS = [3, 4, 5];
  const SERIES_CATS = [7, 8, 9];

  let heroTimer = null;

  views.home = async () => {
    clearInterval(heroTimer);
    setActiveNav("home");
    setLoading(true);
    try {
      const [films, series] = await Promise.all([
        fetchPosts({ categories: FILM_CATS, per_page: 30 }),
        fetchPosts({ categories: SERIES_CATS, per_page: 30 }),
      ]);
      const cats = await ensureCats();

      const slides = films.items.slice(0, 5);
      let idx = 0;

      const heroHtml = () => {
        const it = slides[idx];
        if (!it) return "";
        return (
          '<section class="hero">' +
          '<div class="hero-backdrop" style="' +
          (it.image ? "background-image:url('" + esc(it.image) + "')" : "") +
          '"></div>' +
          '<div class="hero-overlay"></div>' +
          (slides.length > 1
            ? '<button class="hero-nav prev" data-hprev>‹</button><button class="hero-nav next" data-hnext>›</button>'
            : "") +
          '<div class="hero-content">' +
          (it.image ? '<img class="hero-poster" src="' + esc(it.image) + '" alt="">' : "") +
          '<div class="hero-body">' +
          "<h1>" +
          esc(it.title) +
          "</h1>" +
          '<div class="hero-meta">' +
          (it.year ? '<a class="chip" href="' + browseQuery({ year: it.year }) + '">' + esc(it.year) + "</a>" : "") +
          it.catNames
            .slice(0, 2)
            .map((nm, i) =>
              it.cats[i]
                ? '<a class="chip" href="' + browseQuery({ cat: it.cats[i] }) + '">' + esc(nm) + "</a>"
                : ""
            )
            .join("") +
          "</div>" +
          (it.desc
            ? '<p class="hero-overview">' + esc(it.desc.slice(0, 180)) + "…</p>"
            : "") +
          '<div class="hero-actions">' +
          '<a class="btn btn-primary" href="#/watch/' +
          it.id +
          '">▶ شاهد الآن</a>' +
          '<a class="btn btn-ghost" href="#/movie/' +
          it.id +
          '">التفاصيل</a>' +
          "</div></div></div>" +
          '<div class="hero-dots">' +
          slides
            .map((_, i) => '<button class="' + (i === idx ? "active" : "") + '" data-hdot="' + i + '"></button>')
            .join("") +
          "</div></section>"
        );
      };

      let hero = heroHtml();
      const renderHero = () => {
        const slotEl = $("#heroSlot");
        if (!slotEl) return;
        slotEl.innerHTML = hero;
        document.querySelectorAll("[data-hdot]").forEach((d) =>
          d.addEventListener("click", () => {
            idx = +d.dataset.hdot;
            hero = heroHtml();
            renderHero();
          })
        );
        slotEl.querySelector("[data-hprev]")?.addEventListener("click", () => {
          idx = (idx - 1 + slides.length) % slides.length;
          hero = heroHtml();
          renderHero();
        });
        slotEl.querySelector("[data-hnext]")?.addEventListener("click", () => {
          idx = (idx + 1) % slides.length;
          hero = heroHtml();
          renderHero();
        });
      };

      const filmCats = cats.filter((c) => FILM_CATS.includes(c.id));
      const seriesCats = cats.filter((c) => SERIES_CATS.includes(c.id));
      const pills = (list, cf) =>
        list
          .map((c) => '<a class="filter-chip" href="' + browseQuery({ cat: c.id }) + '">' + esc(c.name) + "</a>")
          .join("");

      const recent = Object.values(loadLib().history)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 8)
        .map((x) => snapshotToItem(x.snapshot));
      const continueSection = recent.length
        ? '<section class="section reveal"><div class="section-head"><h2>⏱ متابعة المشاهدة</h2></div>' +
          gridHtml(recent) +
          "</section>"
        : "";

      app.innerHTML =
        '<div id="heroSlot"></div>' +
        continueSection +
        '<section class="section reveal"><div class="section-head"><h2>🎬 أحدث الأفلام</h2>' +
        '<a class="see-all" href="' + browseQuery({ cat: FILM_CATS.join(",") }) + '">عرض الكل</a></div>' +
        (filmCats.length ? '<div class="filter-chips">' + pills(filmCats) + "</div>" : "") +
        gridHtml(dedupeSeries(films.items).slice(1, 25)) +
        "</section>" +
        '<section class="section reveal"><div class="section-head"><h2>📺 أحدث المسلسلات</h2>' +
        '<a class="see-all" href="' + browseQuery({ cat: SERIES_CATS.join(",") }) + '">عرض الكل</a></div>' +
        (seriesCats.length ? '<div class="filter-chips">' + pills(seriesCats) + "</div>" : "") +
        gridHtml(dedupeSeries(series.items).slice(0, 25)) +
        "</section>";
      renderHero();
      bindGlobal();
      observeReveals();

      /* تشغيل تلقائي للهيرو + إيقاف عند المرور/التركيز + سحب بالإصبع */
      const heroSlot = $("#heroSlot");
      const goHero = (step) => {
        idx = (idx + step + slides.length) % slides.length;
        hero = heroHtml();
        renderHero();
      };
      const startHero = () => {
        clearInterval(heroTimer);
        if (slides.length > 1) heroTimer = setInterval(() => goHero(1), 6500);
      };
      const stopHero = () => clearInterval(heroTimer);
      if (heroSlot) {
        heroSlot.addEventListener("mouseenter", stopHero);
        heroSlot.addEventListener("mouseleave", startHero);
        heroSlot.addEventListener("focusin", stopHero);
        heroSlot.addEventListener("focusout", startHero);
        let sx = 0;
        heroSlot.addEventListener(
          "touchstart",
          (e) => { sx = e.touches[0].clientX; },
          { passive: true }
        );
        heroSlot.addEventListener(
          "touchend",
          (e) => {
            const dx = (e.changedTouches[0].clientX || 0) - sx;
            if (Math.abs(dx) > 45) goHero(dx < 0 ? 1 : -1);
          },
          { passive: true }
        );
      }
      startHero();
      setDocTitle("");
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر تحميل البيانات: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.movies = async (params) => {
    setActiveNav("browse");
    setDocTitle("تصفح المحتوى");
    setLoading(true);
    try {
      const cats = await ensureCats();
      const catParam = params.cat || FILM_CATS.join(",");
      const year = params.year || "";
      const sort = params.sort || "desc";

      const state = { page: 0, acc: [], totalResults: 0, totalPages: 1, loading: false };

      const catIds = () => catParam.split(",").map((x) => parseInt(x, 10)).filter(Boolean);

      const fetchPage = (p) => {
        const q = { page: p, per_page: 30, order: sort };
        const ids = catIds();
        if (ids.length && catParam) q.categories = ids.join(",");
        if (year) {
          q.after = year + "-01-01T00:00:01";
          q.before = String(+year + 1) + "-01-01T00:00:00";
        }
        return fetchPosts(q);
      };

      const append = (res) => {
        state.totalPages = res.totalPages || 1;
        state.totalResults = res.total || 0;
        res.items.forEach((it) => state.acc.push(it));
      };

      const moreSlot = () => {
        const shown = dedupeSeries(state.acc).length;
        if (state.page >= state.totalPages) {
          return shown
            ? '<p class="more-end">عرض ' + fa(shown) + " عنصر — وصلت للنهاية</p>"
            : "";
        }
        return (
          '<div class="more-wrap">' +
          '<span class="more-count">عرض ' +
          fa(shown) +
          " من " +
          fa(state.totalResults) +
          "</span>" +
          '<button id="loadMoreBtn" class="btn btn-ghost load-more">تحميل المزيد</button>' +
          "</div>"
        );
      };

      const cOpts =
        '<option value="">كل الأقسام</option>' +
        cats
          .filter((c) => FILM_CATS.includes(c.id) || SERIES_CATS.includes(c.id))
          .map((c) => {
            const sel = catParam.split(",").map(Number).includes(c.id) ? " selected" : "";
            return '<option value="' + c.id + '"' + sel + ">" + esc(c.name) + " (" + fa(c.count) + ")</option>";
          })
          .join("");
      const catSelected = catParam.split(",").map(Number).filter((x) => cats.some((c) => c.id === x));

      const yOpts = ["", ...Array.from({ length: 22 }, (_, i) => String(new Date().getUTCFullYear() - i))]
        .map((y) => '<option value="' + y + '"' + (year == y ? " selected" : "") + ">" + (y || "كل السنين") + "</option>")
        .join("");

      const chips = [];
      catSelected.forEach((cid) => {
        if (catsById[cid]) chips.push(["cat", (catsById[cid].includes("مسلسل") ? "📺 " : "🎬 ") + esc(catsById[cid]) + " ✕", { ...params, cat: "", year }]);
      });
      if (year) chips.push(["year", "سنة " + esc(year) + " ✕", { ...params, year: "", cat: catParam }]);
      const chipsRow = chips.length
        ? '<div class="filter-chips">' +
          chips.map(([, label, rest]) => '<a class="filter-chip" href="' + browseQuery(rest) + '" title="إزالة الفلتر">' + label + "</a>").join("") +
          '<a class="filter-chip clear" href="#/movies">مسح الكل ✕</a>' +
          "</div>"
        : "";

      const render = () => {
        app.innerHTML =
          '<h1 class="page-title" style="margin:24px 0 0">تصفح المحتوى</h1>' +
          '<form class="filters" id="filtersForm">' +
          '<label>القسم <select name="cat">' +
          cOpts +
          "</select></label>" +
          '<label>السنة <select name="year">' +
          yOpts +
          "</select></label>" +
          '<label>الترتيب <select name="sort"><option value="desc" ' + (sort !== "asc" ? "selected" : "") + ">الأحدث</option><option value=\"asc\" " + (sort === "asc" ? "selected" : "") + ">الأقدم</option></select></label>" +
          "</form>" +
          chipsRow +
          '<div id="browseResults">' +
          gridHtml(dedupeSeries(state.acc)) +
          "</div>" +
          moreSlot();
        bindFilters();
        bindGlobal();
        const btn = $("#loadMoreBtn");
        if (btn) btn.addEventListener("click", loadMore);
        observeReveals();
      };

      function bindFilters() {
        const form = $("#filtersForm");
        if (!form) return;
        form.addEventListener("change", () => {
          const fd = new FormData(form);
          const qs = new URLSearchParams();
          if (fd.get("cat")) qs.set("cat", fd.get("cat"));
          if (fd.get("year")) qs.set("year", fd.get("year"));
          if (fd.get("sort")) qs.set("sort", fd.get("sort"));
          location.hash = "#/movies" + (qs.toString() ? "?" + qs.toString() : "");
        });
      }

      async function loadMore() {
        if (state.loading) return;
        state.loading = true;
        const btn = $("#loadMoreBtn");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "جاري التحميل…";
        }
        try {
          const res = await fetchPage(state.page + 1);
          state.page = state.page + 1;
          append(res);
          const slot = $("#browseResults");
          if (slot) slot.innerHTML = gridHtml(dedupeSeries(state.acc));
          const wrap = document.querySelector(".more-wrap");
          if (wrap) wrap.outerHTML = moreSlot();
          bindGlobal();
          const nb = $("#loadMoreBtn");
          if (nb) nb.addEventListener("click", loadMore);
          observeReveals();
        } catch (e) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "تحميل المزيد";
          }
          toast("تعذر التحميل: " + e.message);
        }
        state.loading = false;
      }

      const [r1, r2] = await Promise.all([fetchPage(1), fetchPage(2)]);
      state.page = 2;
      append(r1);
      append(r2);
      render();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر التحميل: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.movie = async (params) => {
    setActiveNav("");
    setLoading(true);
    try {
      const item = await fetchPost(params.id);
      if (!item) throw new Error("لم نجد هذا العنصر");
      setDocTitle(item.title);

      const epsInfo = parseEpTitle(item.title);
      const showsEps = !!epsInfo.isEpisode;
      const epsSection = showsEps
        ? '<section class="section reveal" id="epsSection"><div class="section-head"><h2>🗂 كل حلقات ' +
          esc(epsInfo.base) +
          '</h2></div><div class="ep-wrap"><p class="ep-loading">جاري تحميل كل الحلقات…</p></div></section>'
        : "";
      const partsSection = showsEps
        ? '<section class="section reveal" id="partsSection" style="display:none"><div class="section-head"><h2>🎬 أجزاء <span class="parts-title">' +
          esc(epsInfo.base) +
          '</span></h2></div><div class="part-row"></div></section>'
        : "";

      const rating = getRating(item.id);
      let curRating = rating || 0;
      let stars = "";
      for (let i = 1; i <= 5; i++) {
        stars += '<button data-rate="' + i + '" class="' + (rating && i <= rating ? "on" : "") + '">★</button>';
      }

      let related = [];
      if (item.cats.length) {
        try {
          const r = await fetchPosts({ categories: [item.cats[0]], per_page: 9 });
          related = r.items.filter((x) => x.id !== item.id).slice(0, 8);
        } catch {}
      }

      app.innerHTML =
        '<section class="movie"><div class="movie-hero">' +
        '<div class="movie-backdrop" style="' +
        (item.image ? "background-image:url('" + esc(item.image) + "')" : "") +
        '"></div>' +
        '<div class="movie-grid">' +
        (item.image ? '<img class="movie-poster" src="' + esc(item.image) + '" alt="' + esc(item.title) + '">' : "") +
        '<div class="movie-info">' +
        "<h1>" +
        esc(item.title) +
        "</h1>" +
        '<div class="movie-badges">' +
        (item.year ? '<a class="badge" href="' + browseQuery({ year: item.year }) + '">' + esc(item.year) + "</a>" : "") +
        item.catNames
          .map((nm, i) => (item.cats[i] ? '<a class="badge genre" href="' + browseQuery({ cat: item.cats[i] }) + '">' + esc(nm) + "</a>" : ""))
          .join("") +
        (item.isSeries ? '<span class="badge">مسلسل/حلقة</span>' : "") +
        "</div>" +
        '<div class="movie-actions">' +
        '<a class="btn btn-primary" href="#/watch/' +
        item.id +
        '">▶ شاهد الآن</a>' +
        '<button class="btn btn-ghost" id="favBtn">' +
        (isFav(item.id) ? "♥ إزالة من المفضلة" : "♡ أضف للمفضلة") +
        "</button>" +
        '<div class="stars">' +
        stars +
        "</div>" +
        '<span class="rating-note">' +
        (rating ? "بصّام: " + fa(rating) + "/5" : "قيّم الفيلم") +
        "</span></div>" +
        (item.desc ? '<p class="overview">' + esc(item.desc) + "</p>" : "") +
        "</div></div></div></section>" +
        partsSection +
        epsSection +
        (related.length
          ? '<section class="section reveal"><div class="section-head"><h2>الأحدث في نفس القسم</h2></div>' +
            gridHtml(dedupeSeries(related)) +
            "</section>"
          : "");

      $("#favBtn").addEventListener("click", () => {
        const nowFav = toggleFav(item);
        $("#favBtn").textContent = nowFav ? "♥ إزالة من المفضلة" : "♡ أضف للمفضلة";
        toast(nowFav ? "أضيف للمفضلة" : "أُزيلت من المفضلة");
      });
      document.querySelectorAll(".stars button").forEach((b) =>
        b.addEventListener("click", () => {
          const v = +b.dataset.rate;
          const val = curRating === v ? 0 : v;
          setRating(item, val || null);
          curRating = val;
          document.querySelectorAll(".stars button").forEach((x) => x.classList.toggle("on", +x.dataset.rate <= val));
          $(".rating-note").textContent = val ? "بصّام: " + fa(val) + "/5" : "قيّم الفيلم";
          if (val) toast("تم التقييم " + fa(val) + "/5");
        })
      );
      if (showsEps) loadParts(item, epsInfo.base, $("#partsSection"), $(".parts-title"), $("#epsSection .ep-wrap"));
      bindGlobal();
      observeReveals();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر التحميل: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.watch = async (params) => {
    setActiveNav("");
    setLoading(true);
    epList = [];
    try {
      const item = await fetchPost(params.id);
      if (!item || !item.link) {
        app.innerHTML =
          '<div class="not-found"><div class="icon">😕</div><h2>' +
          esc(item && item.title ? item.title : "") +
          "</h2><p>للأسف لم نجد نسخة متاحة للبث حاليًا.<br>جرّب عنصرًا آخر من الرئيسية.</p>" +
          '<a class="btn btn-ghost" href="#/">الرئيسية</a></div>';
        bindGlobal();
        setLoading(false);
        return;
      }
      const epsInfo = parseEpTitle(item.title);
      const epsSection = epsInfo.isEpisode
        ? '<section class="section reveal" id="epsSection"><div class="section-head"><h2>🗂 كل حلقات ' +
          esc(epsInfo.base) +
          '</h2></div><div class="ep-wrap"><p class="ep-loading">جاري تحميل كل الحلقات…</p></div></section>'
        : "";
      setDocTitle(item.title);
      app.innerHTML =
        '<div class="watch">' +
        '<div class="section-head"><h2 id="watchTitle">▶ ' +
        esc(item.title) +
        (item.year ? " (" + esc(item.year) + ")" : "") +
        '</h2><a class="see-all" href="#/movie/' +
        item.id +
        '">تفاصيل</a></div>' +
        '<div class="watch-frame"><iframe id="watchIframe" src="' +
        esc(item.link) +
        '?embedScreen=true" allow="autoplay; fullscreen; encrypted-media" allowfullscreen referrerpolicy="origin" title="' +
        esc(item.title) +
        '"></iframe></div>' +
        '<div class="ep-nav" id="epNav"></div>' +
        '<p style="color:var(--muted);font-size:0.85rem;margin-top:10px">إذا لم يعمل المشغل، جرّب فتح <a href="' +
        esc(item.link) +
        '?embedScreen=true" target="_blank" rel="noopener" style="color:var(--accent)">النافذة الأصلية</a></p>' +
        epsSection +
        "</div>";
      addHistory(item);
      if (epsInfo.isEpisode) loadEpisodes(item, $("#epsSection .ep-wrap"));
      bindGlobal();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر التشغيل: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.search = async (params) => {
    setActiveNav("");
    setLoading(true);
    try {
      const q = (params.q || "").trim();
      $("#searchInput").value = q;
      syncSearchClear();
      setDocTitle(q ? "بحث: " + q : "بحث");
      if (!q) {
        app.innerHTML = '<div class="empty"><div class="icon">🔍</div><p>اكتب اسم فيلم في خانة البحث بالأعلى</p></div>';
        setLoading(false);
        return;
      }
      const res = await fetchPosts({ search: q, per_page: 100, pages: 8 });
      const items = res.items;
      const qn = norm(q);
      const all = dedupeSeries(items)
        .map((it) => ({ it, score: searchScore(it, qn) }))
        .filter((x) => x.score < 500);
      all.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const sa = a.it.seriesSeason || 0;
        const sb = b.it.seriesSeason || 0;
        if (sa !== sb) return sa - sb;
        return 0;
      });
      const posters = all.map((x) => x.it);
      const head =
        '<div class="search-head"><h2>نتائج البحث عن: <span style="color:var(--accent)">' +
        esc(q) +
        "</span></h2>" +
        '<p class="search-note">' +
        (posters.length ? "مرتبة حسب الأقرب لبحثك — من مجموع " + fa(res.total) + " نتيجة في المصدر" : "") +
        "</p></div>";
      app.innerHTML = posters.length
        ? head + '<div class="row">' + posters.map(cardHtml).join("") + "</div>"
        : head + '<div class="empty"><div class="icon">🎬</div><p>لا توجد نتائج في مصدرنا الحالي لهذه الكلمة</p></div>';
      bindGlobal();
      observeReveals();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر البحث: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.library = async (params) => {
    setActiveNav(params.type);
    setLoading(true);
    const lib = loadLib();
    let items = [];
    let emptyMsg = "";
    if (params.type === "favorites") {
      items = Object.values(lib.favorites).map((x) => snapshotToItem(x.snapshot));
      emptyMsg = "لا توجد أفلام في المفضلة بعد";
    } else if (params.type === "history") {
      items = Object.values(lib.history)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map((x) => snapshotToItem(x.snapshot));
      emptyMsg = "لم تشاهد شيئًا بعد";
    } else if (params.type === "rated") {
      items = Object.values(lib.ratings)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .map((x) => snapshotToItem(x.snapshot));
      emptyMsg = "لم تقيّم أي فيلم بعد";
    } else {
      items = [];
    }
    const titles = {
      favorites: "♥ المفضلة",
      history: "🕒 آخر المشاهدة",
      rated: "⭐ قيمت عليها",
    };
    setDocTitle((titles[params.type] || "مكتبتي").replace(/^[^\s]+\s/, ""));
    app.innerHTML =
      '<h1 class="page-title" style="margin:24px 0 0">' +
      (titles[params.type] || "مكتبتي") +
      "</h1>" +
      (items.length ? gridHtml(items) : '<div class="empty"><div class="icon">📂</div><p>' + esc(emptyMsg) + "</p></div>");
    bindGlobal();
    observeReveals();
    setLoading(false);
  };

  /* ---------- الراوتر ---------- */
  function parse(hash) {
    const h = hash || "#/";
    const [pathRaw, query] = h.slice(2).split("?");
    const parts = pathRaw.split("/").filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ""));
    return { parts, params };
  }

  function jumpTop() {
    window.scrollTo({ top: 0 });
  }

  async function route() {
    const { parts, params } = parse(location.hash);
    clearInterval(heroTimer);
    jumpTop();
    if (!parts.length || parts[0] === "") {
      await views.home(params);
    } else if (parts[0] === "movies") {
      await views.movies(params);
    } else if (parts[0] === "search") {
      await views.search(params);
    } else if (parts[0] === "movie" && parts[1]) {
      await views.movie({ id: parts[1] });
    } else if (parts[0] === "watch" && parts[1]) {
      await views.watch({ id: parts[1] });
    } else if (parts[0] === "wp" && parts[1]) {
      await views.watch({ id: parts[1] });
    } else if (parts[0] === "library" && parts[1]) {
      await views.library({ type: parts[1] });
    } else {
      app.innerHTML = '<div class="not-found"><div class="icon">404</div><p>الصفحة غير موجودة</p><a class="btn btn-ghost" href="#/">الرئيسية</a></div>';
      setLoading(false);
    }
  }

  /* ---------- البداية ---------- */
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#searchInput").value.trim();
    if (q) {
      pushRecent(q);
      location.hash = "#/search?q=" + encodeURIComponent(q);
    }
  });

  /* ---------- البحث الفوري (درج نتائج صغير) ---------- */
  const searchInput = $("#searchInput");
  const searchDrop = $("#searchDrop");
  const searchClear = $("#searchClear");
  let searchTimer;
  let searchRows = [];

  function closeSearchDrop() {
    searchDrop.hidden = true;
    searchDrop.innerHTML = "";
    searchRows = [];
    lastQuery = "";
  }

  let lastQuery = "";
  let activeQ = "";
  let enrichId = 0;

  function renderSearchDrop() {
    const rows = searchRows.map(
      (it, i) =>
        '<a class="search-drop-item" data-srow="' +
        i +
        '" href="#/movie/' +
        it.id +
        '">' +
        (it.image ? '<img src="' + esc(it.image) + '" loading="lazy" alt="">' : '<span class="s-thumb">🎬</span>') +
        '<span class="s-info"><span class="s-title">' +
        esc(it.title) +
        "</span>" +
        (it.year ? '<span class="s-year">' + esc(it.year) + "</span>" : "") +
        "</span></a>"
    );
    searchDrop.innerHTML =
      rows.join("") +
      '<a class="search-drop-item all" href="#/search?q=' +
      encodeURIComponent(activeQ) +
      '">عرض كل النتائج لـ "' +
      esc(activeQ) +
      '" 🔍</a>';
    searchDrop.hidden = false;
    enrichDropImages(activeQ);
  }

  async function enrichDropImages(q) {
    const myId = ++enrichId;
    const ids = searchRows.filter((it) => !it.image && it.id).map((it) => it.id);
    if (!ids.length) return;
    const pr = await tc("posts", { include: ids.join(","), per_page: 100, _fields: "id,featured_media" });
    if (myId !== enrichId) return;
    const fms = (pr.json || []).filter((p) => p.featured_media).map((p) => p.featured_media);
    if (!fms.length) return;
    const mr = await tc("media", { include: [...new Set(fms)].join(","), per_page: 100, _fields: "id,source_url" });
    const mm = {};
    (mr.json || []).forEach((m) => (mm[m.id] = m.source_url));
    const byPost = {};
    (pr.json || []).forEach((p) => { if (mm[p.featured_media]) byPost[p.id] = mm[p.featured_media]; });
    if (myId !== enrichId) return;
    let changed = false;
    searchRows.forEach((it) => { if (byPost[it.id]) { it.image = byPost[it.id]; changed = true; } });
    if (changed && !searchDrop.hidden && activeQ === q && document.querySelector("#searchInput").value.trim() === q) {
      const slots = searchDrop.querySelectorAll("[data-srow] > img, [data-srow] > .s-thumb");
      searchRows.forEach((it, i) => {
        if (byPost[it.id] && slots[i]) {
          const img = document.createElement("img");
          img.src = byPost[it.id];
          img.loading = "lazy";
          img.alt = "";
          slots[i].replaceWith(img);
        }
      });
    }
  }

  async function openSearchDrop(q) {
    lastQuery = q;
const local = dedupeSeries(poolRows(q), "series");
      if (local.length) {
        activeQ = q;
        searchRows = local.slice(0, 7);
      renderSearchDrop();
    }
    let res;
    try {
      res = await fetchPosts({ search: q, per_page: 12, fast: true });
    } catch (e) {
      if (lastQuery === q && document.activeElement === searchInput && searchDrop.hidden && !local.length) {
        searchDrop.innerHTML = '<div class="search-drop-item none">تعذر البحث الآن</div>';
        searchDrop.hidden = false;
      }
      return;
    }
    if (lastQuery !== q || searchInput.value.trim() !== q) return;
    rememberItems(res.items);
const merged = dedupeSeries(poolRows(q), "series");
    if (!merged.length) {
      searchDrop.innerHTML = '<div class="search-drop-item none">لا توجد نتائج لـ "' + esc(q) + '"</div>';
      searchDrop.hidden = false;
      return;
    }
    activeQ = q;
    searchRows = dedupeSeries(merged, "series").slice(0, 7);
    renderSearchDrop();
  }

  function poolRows(q) {
    const nq = norm(q);
    if (!nq) return [];
    return [...knownItems.values()].filter((it) => it.title && norm(it.title).includes(nq));
  }

  function norm(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ---------- سجل البحث الأخير ---------- */
  const LS_RECENT = "tc_recent_searches_v1";

  function getRecent() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_RECENT) || "[]");
      return Array.isArray(a) ? a.slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  function pushRecent(q) {
    q = (q || "").trim();
    if (!q) return;
    const arr = getRecent().filter((x) => x !== q);
    arr.unshift(q);
    try {
      localStorage.setItem(LS_RECENT, JSON.stringify(arr.slice(0, 6)));
    } catch {}
  }

  function renderRecentDrop() {
    const rec = getRecent();
    if (!rec.length) return;
    searchRows = [];
    lastQuery = "";
    searchDrop.innerHTML =
      rec
        .map(
          (q) =>
            '<a class="search-drop-item recent" data-recent="' +
            esc(q) +
            '" href="#/search?q=' +
            encodeURIComponent(q) +
            '"><span class="s-thumb">🕒</span><span class="s-info"><span class="s-title">' +
            esc(q) +
            '</span><span class="s-year">بحث سابق</span></span></a>'
        )
        .join("") +
      '<a class="search-drop-item clear-recent" data-clearrecent>مسح سجل البحث</a>';
    searchDrop.hidden = false;
  }

  function syncSearchClear() {
    searchClear.hidden = !searchInput.value.trim();
  }

  searchInput.addEventListener("input", () => {
    syncSearchClear();
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      if (!q) renderRecentDrop();
      else closeSearchDrop();
      return;
    }
    const local = poolRows(q);
    if (local.length) {
      lastQuery = q;
      activeQ = q;
      searchRows = dedupeSeries(local, "series").slice(0, 7);
      renderSearchDrop();
    }
    searchTimer = setTimeout(() => openSearchDrop(q), 250);
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    syncSearchClear();
    closeSearchDrop();
    searchInput.focus();
  });

  searchInput.addEventListener("focus", () => {
    if (!searchInput.value.trim()) renderRecentDrop();
  });

  searchDrop.addEventListener("click", (e) => {
    const rec = e.target.closest("[data-recent]");
    const clr = e.target.closest("[data-clearrecent]");
    if (clr) {
      e.preventDefault();
      try { localStorage.removeItem(LS_RECENT); } catch {}
      closeSearchDrop();
      return;
    }
    if (rec) {
      const q = rec.dataset.recent;
      searchInput.value = q;
      syncSearchClear();
      pushRecent(q);
      closeSearchDrop();
    }
  });

  document.addEventListener("keydown", (e) => {
    const ae = document.activeElement;
    const tag = (ae && ae.tagName) || "";
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (ae && ae.isContentEditable);
    if (!typing && e.key === "/") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  window.addEventListener("hashchange", closeSearchDrop);
  window.addEventListener("scroll", () => { if (!searchDrop.hidden) closeSearchDrop(); }, { passive: true });

  searchInput.addEventListener("keydown", (e) => {
    if (searchDrop.hidden) return;
    const items = [...searchDrop.querySelectorAll(".search-drop-item")];
    if (!items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let idx = items.findIndex((i) => i.classList.contains("hl"));
      idx = (idx + dir + items.length) % items.length;
      items.forEach((i) => i.classList.toggle("hl", i === items[idx]));
      items[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const hl = searchDrop.querySelector(".hl");
      if (hl && hl.dataset.srow !== undefined && searchRows[+hl.dataset.srow]) {
        e.preventDefault();
        const row = searchRows[+hl.dataset.srow];
        searchInput.blur();
        closeSearchDrop();
        location.hash = "#/movie/" + row.id;
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchDrop();
    }
  });

  window.addEventListener("hashchange", route);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  renderNavBadges();

  /* ضغطة في أي مكان على "المعلومات القابلة للنقر" = فتح قائمة بنفس التصنيف */
  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) {
      e.preventDefault();
      if (goto.dataset.goto) location.hash = goto.dataset.goto;
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    if (e.target.closest(".card-fav")) return;
    e.preventDefault();
    if (card.dataset.id) location.hash = "#/movie/" + card.dataset.id;
  });

  document.addEventListener("click", (e) => {
    const fav = e.target.closest(".card-fav");
    if (!fav) return;
    const card = fav.closest(".card");
    if (!card) return;
    e.preventDefault();
    const item = {
      id: fav.dataset.fav,
      title: card.dataset.title || "فيلم",
      year: card.dataset.year || "",
      image: card.dataset.poster || "",
    };
    const nowFav = toggleFav(item);
    fav.classList.toggle("active", nowFav);
    fav.textContent = nowFav ? "♥" : "♡";
    toast(nowFav ? "أضيف للمفضلة" : "أُزيلت من المفضلة");
  });

  /* تبديل الحلقة داخل نفس الصفحة بدون إعادة تحميل كاملة */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".ep-btn, .ep-nav-btn");
    if (!btn || btn.classList.contains("disabled")) return;
    const id =
      btn.dataset.ep ||
      (((btn.getAttribute("href") || "").match(/watch\/(\d+)/) || [])[1] || "");
    if (!id) return;
    e.preventDefault();
    switchEpisode(id);
  });

  /* زر العودة للأعلى + تظليل الهيدر عند التمرير */
  const backTop = $("#backTop");
  const headerEl = document.querySelector(".header");
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    if (backTop) backTop.classList.toggle("show", y > 500);
    if (headerEl) headerEl.classList.toggle("scrolled", y > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (backTop) backTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  onScroll();

  route();
})();