/* Egypt Cinema — تطبيق صفحة واحدة (SPA) بدون خادم */
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
  /* مفتاح TMDB لا يعيش في الكلاينت: جميع طلباته تمر عبر /tmdb على الخادم وتُامن هناك */
  const TMDB_BASE = "/tmdb";
  const IMG = "https://image.tmdb.org/t/p";
  const LANG = "ar";
  const LS_LIB = "tc_guest_library_v1";
  const LS_LINKS = "tc_links_cache_v3";

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

  function snapshotOf(b) {
    return {
      tmdbId: b.id,
      mediaType: "movie",
      title: b.title,
      year: b.year,
      posterPath: b.posterPath,
      backdropPath: b.backdropPath,
      voteAverage: b.voteAverage,
    };
  }

  function isFav(id) {
    return !!loadLib().favorites[id];
  }

  function toggleFav(b) {
    const lib = loadLib();
    if (lib.favorites[b.id]) {
      delete lib.favorites[b.id];
    } else {
      lib.favorites[b.id] = { snapshot: snapshotOf(b) };
    }
    saveLib(lib);
    return isFav(b.id);
  }

  function getRating(id) {
    const r = loadLib().ratings[id];
    return r ? r.rating : null;
  }

  function setRating(b, rating) {
    const lib = loadLib();
    if (rating) {
      lib.ratings[b.id] = { snapshot: snapshotOf(b), rating };
    } else {
      delete lib.ratings[b.id];
    }
    saveLib(lib);
  }

  function addHistory(b, progress, duration) {
    const lib = loadLib();
    lib.history[b.id] = {
      snapshot: snapshotOf(b),
      progress: progress || 0,
      duration: duration || 0,
      updatedAt: Date.now(),
    };
    saveLib(lib);
  }

  function setProgress(id, progress) {
    const lib = loadLib();
    if (lib.history[id]) {
      lib.history[id].progress = progress;
      lib.history[id].updatedAt = Date.now();
    }
    saveLib(lib);
  }

  function renderNavBadges() {
    const lib = loadLib();
    const favCount = Object.keys(lib.favorites).length;
    const histCount = Object.keys(lib.history).length;
    const rateCount = Object.keys(lib.ratings).length;

    const set = (sel, n) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.textContent = n > 0 ? " (" + n + ")" : "";
    };
    set('[data-nav="favs"] .count', favCount);
    set('[data-nav="hist"] .count', histCount);
    set('[data-nav="rated"] .count', rateCount);
  }

  /* ---------- TMDB ---------- */
  const TCACHE_TTL = 30 * 60 * 1000; /* 30 دقيقة */

  function tcacheRead(url) {
    try {
      const hit = JSON.parse(localStorage.getItem("tc_" + url));
      if (hit && Date.now() - hit.t < TCACHE_TTL) return hit.d;
    } catch {}
    return null;
  }

  function tcacheWrite(url, data) {
    try {
      const key = "tc_" + url;
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("tc_") === 0) entries.push(k);
      }
      if (entries.length > 60) for (const k of entries) localStorage.removeItem(k);
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
    } catch {}
  }

  async function tmdb(path, params) {
    const url = new URL(TMDB_BASE + path, location.origin);
    url.searchParams.set("language", LANG);
    url.searchParams.set("include_adult", "false");
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const urlStr = url.toString();
    const cached = tcacheRead(urlStr);
    if (cached) return cached;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let data;
    try {
      const res = await fetch(urlStr, {
        headers: { accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("TMDB error " + res.status);
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    tcacheWrite(urlStr, data);
    return data;
  }

  function brief(m) {
    return {
      id: m.id,
      title: m.title || m.original_title,
      originalTitle: m.original_title || m.title,
      year: m.release_date ? new Date(m.release_date).getUTCFullYear() : null,
      overview: m.overview || "",
      posterPath: m.poster_path,
      backdropPath: m.backdrop_path,
      voteAverage: m.vote_average,
      voteCount: m.vote_count,
genres: (m.genres || []).map((g) => g.name),
    genreIds: m.genre_ids || [],
    runtime: m.runtime ?? null,
  };
}

  const pct = (score) => Math.round((score || 0) * 10);
  const poster = (b, w) => (b.posterPath ? IMG + "/w" + w + b.posterPath : "");
  const backdrop = (b, w) => (b.backdropPath ? IMG + "/w" + w + b.backdropPath : "");

  const fmtRuntime = (min) => {
    if (!min) return "";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return ((h ? h + "س" : "") + (m ? m + "د" : "")) || (h ? h + "س" : "");
  };

  /* نطاق مدة قريب من المدة الأصلية (للربط مع الاكتشاف) */
  const rtRange = (min) => {
    if (!min || !isFinite(min)) return "";
    return Math.max(0, min - 15) + "," + (min + 15);
  };

  /* رابط صفحة "جميع الأفلام" مع فلاتر محددة */
  const browseQuery = (o) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(o || {})) if (v !== "" && v != null && v !== undefined) qs.set(k, String(v));
    return "#/movies" + (qs.toString() ? "?" + qs.toString() : "");
  };

  let genresById = {};
  function seedGenreNames() {
    loadGenres()
      .then((gs) => {
        (gs || []).forEach((g) => (genresById[g.id] = g.name));
      })
      .catch(() => {});
  }
  function cardGenres(b) {
    return (b.genreIds || []).map((id) => genresById[id]).filter(Boolean).slice(0, 2);
  }

  /* تحويل snapshot مخزن إلى بيانات بطاقة */
  function briefFromSnapshot(s) {
    return {
      id: s.tmdbId,
      title: s.title,
      originalTitle: s.title,
      year: s.year,
      overview: "",
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      voteAverage: s.voteAverage ?? 0,
      voteCount: 0,
      genres: [],
      runtime: null,
    };
  }

  /* ---------- كرت الفيلم (غني بالتفاصيل + طبقة تفاصيل عند الـ hover) ---------- */
  function cardHtml(b) {
    const fav = isFav(b.id);
    const img = poster(b, 300);
    const bd = backdrop(b, 500);
    const genreIds = (b.genreIds || []).slice(0, 2);
    const nameOf = (id) => genresById[id];
    const rt = fmtRuntime(b.runtime);
    const metaParts = [];
    if (b.year) metaParts.push('<span class="cmeta" data-goto="' + browseQuery({ year: b.year }) + '">' + esc(b.year) + "</span>");
    genreIds.forEach((id) => {
      if (nameOf(id)) metaParts.push('<span class="cmeta" data-goto="' + browseQuery({ genres: id }) + '">' + esc(nameOf(id)) + "</span>");
    });
    if (rt) metaParts.push('<span class="cmeta" data-goto="' + browseQuery({ rt: rtRange(b.runtime) }) + '">' + rt + "</span>");
    const meta = metaParts.join(" · ") || "—";
    const synopsis = (b.overview || "").slice(0, 150);
    const post =
      '<div class="card-poster ' +
      (img ? "" : "placeholder") +
      '" style="' +
      (img ? "background-image:url('" + img + "')" : "") +
      '">' +
      (!img ? esc((b.title || "؟").charAt(0)) : "") +
      '<div class="card-detail"' +
      (bd ? " style=\"background-image:url('" + bd + "')\"" : "") +
      '"><div class="card-detail-mask"></div><div class="card-detail-body">' +
      (synopsis ? '<p class="card-detail-overview">' + esc(synopsis) + "…</p>" : "") +
      (genreIds.length
        ? '<div class="card-detail-tags">' +
          genreIds.map((id) => (nameOf(id) ? '<span data-goto="' + browseQuery({ genres: id }) + '">' + esc(nameOf(id)) + "</span>" : "")).join("") +
          "</div>"
        : "") +
      '<span class="card-detail-play">▶ شاهد الآن</span>' +
      "</div></div></div>";
    return (
      '<div class="card" data-id="' +
      b.id +
      '" data-title="' +
      esc(b.title) +
      '" data-poster="' +
      esc(b.posterPath || "") +
      '" data-year="' +
      (b.year || "") +
      '" data-rating="' +
      (b.voteAverage || "") +
      '">' +
      '<a class="card-link" href="#/movie/' +
      b.id +
      '">' +
      post +
      '<div class="card-body"><p class="card-title">' +
      esc(b.title) +
      '</p><p class="card-meta">' +
      meta +
      "</p></div></a>" +
      '<span class="card-rating">⭐ ' +
      fa(pct(b.voteAverage)) +
      "%</span>" +
      '<button class="card-fav ' +
      (fav ? "active" : "") +
      '" data-fav="' +
      b.id +
      '" title="مفضلة">' +
      (fav ? "♥" : "♡") +
      "</button>" +
      progressBarHtml(b) +
      "</div>"
    );
  }

  function progressBarHtml(b) {
    const lib = loadLib();
    const item = lib.history[b.id];
    if (!item || !item.duration) return "";
    const p = Math.min(100, Math.round(((item.progress || 0) / item.duration) * 100));
    return '<div class="card-progress"><span style="width:' + p + '%"></span></div>';
  }

  function gridHtml(list) {
    if (!list.length) {
      return '<div class="empty"><div class="icon">🎬</div><p>لا توجد أفلام للعرض</p></div>';
    }
    return '<div class="row">' + list.map(cardHtml).join("") + "</div>";
  }

  async function loadGenres() {
    const data = await tmdb("/genre/movie/list");
    return data.genres;
  }

  /* ---------- المصدر (topcinema) ---------- */
  const STOP = new Set(["the", "a", "an", "and", "for", "of", "in", "on", "to", "with", "at", "film", "movie", "series", "tv", "part"]);

  function normalize(s) {
    return s
      .toLowerCase()
      .replace(/[\u0600-\u06FF\ufb50-\ufdff\ufe70-\ufeff]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function scoreTitle(postTitle, englishTitle, year) {
    const normTitle = normalize(postTitle);
    const tokens = normalize(englishTitle)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t));
    if (!tokens.length) return 0;
    let hits = 0;
    for (const token of tokens) if (normTitle.includes(token)) hits++;
    let score = hits / tokens.length;
    if (year && normTitle.includes(String(year))) score += 0.25;
    return score;
  }

  const stripHtml = (s) => s.replace(/<[^>]*>/g, "").trim();

  async function searchTopcinema(query) {
    /* المحاولة مرة إضافية لأن/ بحث Top Cinema قد يتعطل مؤقتا */
    const url = new URL("/search/wp-json/wp/v2/search", location.origin);
    url.searchParams.set("search", query);
    url.searchParams.set("per_page", "40");
    url.searchParams.set("subtype", "post");
    url.searchParams.set("_fields", "id,title,url");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 18000);
        let json = [];
        try {
          const res = await fetch(url.toString(), {
            headers: { accept: "application/json" },
            signal: ctrl.signal,
          });
          if (res.ok) json = await res.json();
        } finally {
          clearTimeout(timer);
        }
        if (json && json.length) {
          return json.map((r) => ({
            id: r.id,
            title: stripHtml(r.title?.rendered || r.title || ""),
            url: r.url || r.link || "",
          }));
        }
      } catch {}
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
    return [];
  }

  function loadLinksCache() {
    try {
      return JSON.parse(localStorage.getItem(LS_LINKS) || "{}");
    } catch {
      return {};
    }
  }

  function saveLinksCache(cache) {
    try {
      localStorage.setItem(LS_LINKS, JSON.stringify(cache));
    } catch {}
  }

  /* ---------- نتائج البحث المباشرة من Top Cinema (posts بدون بيانات TMDB) ---------- */
  const LS_WP = "tc_raw_posts_v1";
  function loadWpPosts() {
    try {
      return JSON.parse(localStorage.getItem(LS_WP) || "{}");
    } catch {
      return {};
    }
  }
  function saveWpPosts(map) {
    try {
      const keys = Object.keys(map);
      if (keys.length > 300) {
        keys.slice(0, keys.length - 300).forEach((k) => delete map[k]);
      }
      localStorage.setItem(LS_WP, JSON.stringify(map));
    } catch {}
  }

  /* يستخرج السنة والعنوان الإنجليزي ونوع المحتوى من عنوان post في Top Cinema
     مثل: "فيلم Spider-Man: Brand New Day 2026 مترجم اون لاين" */
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

  /* كارت بسيط لنتيجة top cinema لا يُعرف لها فيلم في TMDB */
  function rawCardHtml(p) {
    const meta = [p.year ? esc(p.year) : "", "Top Cinema"].filter(Boolean).join(" · ");
    return (
      '<div class="card card-raw" data-wp="' +
      esc(p.id) +
      '" data-title="' +
      esc(p.title) +
      '" data-year="' +
      esc(p.year) +
      '">' +
      '<a class="card-link" href="#/wp/' +
      esc(p.id) +
      '">' +
      '<div class="card-poster placeholder">🎬</div>' +
      '<div class="card-body"><p class="card-title">' +
      esc(p.title) +
      '</p><p class="card-meta">' +
      meta +
      "</p></div></a></div>"
    );
  }

  function hostnameOf(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function providerRank(u) {
    const h = hostnameOf(u);
    if (/dood|do7go|mixdrop|streamtape|stape|cda/i.test(h)) return 3;
    if (/everia|fvideo|playnixes|hgplaycdn/i.test(h)) return 2;
    return 1;
  }

  async function resolveMovie(b) {
    const cache = loadLinksCache();
    if (cache[b.id] && cache[b.id].embedUrl) return cache[b.id];

    /* منظِّف: يزيل علامات الترقيم والأحرف الكبيرة (بحث WP حساس للـ "!") */
    const clean = (s) =>
      (s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const variants = [];
    const en = clean(b.originalTitle);
    const ar = clean(b.title);
    if (en) {
      if (b.year) variants.push(en + " " + b.year);
      variants.push(en);
    }
    if (ar && ar !== en) {
      if (b.year) variants.push(ar + " " + b.year);
      variants.push(ar);
    }

    let best = null;
    for (const query of variants) {
      if (!query) continue;
      const results = await searchTopcinema(query);
      for (const r of results) {
        const title = stripHtml(r.title);
        const score = scoreTitle(title, b.originalTitle, b.year);
        if (!best || score > best.score) best = { r: { ...r, title }, score };
      }
      if (best && best.score >= 0.85) break;
    }

    let resolved = null;
    if (best && best.score >= 0.5 && best.r.url) {
      resolved = {
        tmdbId: b.id,
        score: best.score,
        title: best.r.title,
        servers: [],
        embedUrl: best.r.url + "?embedScreen=true",
      };
    }

    if (resolved) {
      cache[b.id] = resolved;
      saveLinksCache(cache);
    }
    return resolved;
  }

  /* ---------- العرض ---------- */
  function setLoading(mode) {
    const el = document.querySelector("#loadingTop");
    if (el) el.style.display = mode ? "flex" : "none";
  }

  const setActiveNav = (key) => {
    document.querySelectorAll(".nav a").forEach((a) => {
      a.classList.toggle("active", a.dataset.nav === key);
    });
  };

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

  /* ظهور العناصر عند التمرير */
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

  /* ---------- الصفحات ---------- */
  const views = {};

  views.home = async () => {
    setActiveNav("home");
    setLoading(true);
    try {
      const [trending, now, top, upcoming] = await Promise.all([
        tmdb("/trending/movie/week", { page: 1 }),
        tmdb("/movie/now_playing", { page: 1 }),
        tmdb("/movie/top_rated", { page: 1 }),
        tmdb("/movie/upcoming", { page: 1 }),
      ]);

      const slides = trending.results.slice(0, 5).map(brief);
      let idx = 0;

      const heroHtml = () => {
        const b = slides[idx];
        if (!b) return "";
        const bg = backdrop(b, 1280);
        return (
          '<section class="hero">' +
          '<div class="hero-backdrop" style="' +
          (bg ? "background-image:url('" + bg + "')" : "") +
          '"></div>' +
          '<div class="hero-overlay"></div>' +
          (slides.length > 1
            ? '<button class="hero-nav prev" data-hprev>‹</button><button class="hero-nav next" data-hnext>›</button>'
            : "") +
          '<div class="hero-content">' +
          (poster(b, 300)
            ? '<img class="hero-poster" src="' + poster(b, 300) + '" alt="">'
            : "") +
          '<div class="hero-body">' +
          '<h1>' +
          esc(b.title) +
          "</h1>" +
          '<div class="hero-meta">' +
          (b.year ? '<a class="chip" href="' + browseQuery({ year: b.year }) + '">' + esc(b.year) + "</a>" : "") +
          (b.genreIds || [])
            .slice(0, 2)
            .map((id) => (genresById[id] ? '<a class="chip" href="' + browseQuery({ genres: id }) + '">' + esc(genresById[id]) + "</a>" : ""))
            .join("") +
          '<a class="chip rate" href="' +
          browseQuery({ vote: pct(b.voteAverage) }) +
          '">⭐ ' +
          fa(pct(b.voteAverage)) +
          "%</a></div>" +
          (b.overview
            ? '<p class="hero-overview">' + esc(b.overview) + "</p>"
            : "") +
          '<div class="hero-actions">' +
          '<a class="btn btn-primary" href="#/watch/' +
          b.id +
          '">▶ شاهد الفيلم</a>' +
          '<a class="btn btn-ghost" href="#/movie/' +
          b.id +
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
        $("#heroSlot").innerHTML = hero;
        bindHero();
      };
      const bindHero = () => {
        document.querySelectorAll("[data-hdot]").forEach((d) =>
          d.addEventListener("click", () => {
            idx = +d.dataset.hdot;
            hero = heroHtml();
            renderHero();
          })
        );
        $("#heroSlot [data-hprev]")?.addEventListener("click", () => {
          idx = (idx - 1 + slides.length) % slides.length;
          hero = heroHtml();
          renderHero();
        });
        $("#heroSlot [data-hnext]")?.addEventListener("click", () => {
          idx = (idx + 1) % slides.length;
          hero = heroHtml();
          renderHero();
        });
      };

      const rows = [
        { title: "🔥 رائج هذا الأسبوع", list: trending.results.slice(0, 12).map(brief) },
        { title: "🎬 فيلم السينما الآن", list: now.results.slice(0, 12).map(brief) },
        { title: "🏆 الأعلى تقييمًا", list: top.results.slice(0, 12).map(brief) },
        { title: "🗓 قريبًا في السينما", list: upcoming.results.slice(0, 12).map(brief) },
      ];

      app.innerHTML =
        '<div id="heroSlot"></div>' +
        rows
          .map(
            (r, i) =>
              '<section class="section reveal"><div class="section-head"><h2>' +
              r.title +
              '</h2><a class="see-all" href="#/movies">عرض الكل</a></div>' +
              gridHtml(r.list) +
              "</section>"
          )
          .join("");
      renderHero();
      bindGlobal();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر تحميل البيانات: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.movies = async (params) => {
    setActiveNav("browse");
    setLoading(true);
    try {
      const genres = await loadGenres();
      genres.forEach((g) => (genresById[g.id] = g.name));
      const sortBy = params.sortBy || "popularity.desc";
      const withGenres = params.genres || "";
      const year = params.year || "";
      const vote = params.vote ? Math.max(0, Math.min(100, +params.vote)) : "";
      const rt = params.rt || "";
      const country = params.country || "";
      const lang = params.lang || "";
      const cert = params.cert || "";

      const state = { page: 0, acc: [], totalPages: 1, totalResults: 0, loading: false };

      const fetchPage = (p) => {
        const rtMin = rt ? Math.max(0, +rt.split(",")[0] || 0) : "";
        const rtMax = rt ? (+rt.split(",")[1] || "") : "";
        return tmdb("/discover/movie", {
          page: p,
          sort_by: sortBy,
          with_genres: withGenres,
          primary_release_year: year,
          "vote_count.gte": 50,
          "vote_average.gte": vote ? (vote / 10).toFixed(1) : "",
          "with_runtime.gte": rtMin || "",
          "with_runtime.lte": rtMax || "",
          "with_origin_country": country,
          "with_original_language": lang,
          "certification_country": cert ? "US" : "",
          certification: cert,
        });
      };

      const append = (res) => {
        state.totalPages = res.total_pages || 1;
        state.totalResults = res.total_results || 0;
        (res.results || []).forEach((m) => state.acc.push(brief(m)));
      };

      const moreSlot = () => {
        if (state.page >= state.totalPages) {
          return state.acc.length
            ? '<p class="more-end">عرض ' + fa(state.acc.length) + " فيلم — وصلت للنهاية</p>"
            : "";
        }
        return (
          '<div class="more-wrap">' +
          '<span class="more-count">عرض ' +
          fa(state.acc.length) +
          " من " +
          fa(state.totalResults) +
          "</span>" +
          '<button id="loadMoreBtn" class="btn btn-ghost load-more">تحميل المزيد</button>' +
          "</div>"
        );
      };

      const gOpts =
        '<option value="">كل الأنواع</option>' +
        genres.map((g) => '<option value="' + g.id + '"' + (withGenres == g.id ? " selected" : "") + ">" + esc(g.name) + "</option>").join("");

      const yOpts = ["", ...Array.from({ length: 25 }, (_, i) => String(new Date().getUTCFullYear() - i))]
        .map((y) => '<option value="' + y + '"' + (year == y ? " selected" : "") + ">" + (y || "كل السنين") + "</option>")
        .join("");

      const sOpts = [
        ["popularity.desc", "الأكثر رواجًا"],
        ["vote_average.desc", "الأعلى تقييمًا"],
        ["primary_release_date.desc", "الأحدث"],
        ["primary_release_date.asc", "الأقدم"],
        ["original_title.asc", "الترتيب الأبجدي"],
      ]
        .map(([v, l]) => '<option value="' + v + '"' + (sortBy == v ? " selected" : "") + ">" + l + "</option>")
        .join("");

      const rOpts = ["60", "70", "80", "90"]
        .map((v) => '<option value="' + v + '"' + (String(vote) == v ? " selected" : "") + ">التقييم ≥ " + fa(+v) + "%</option>")
        .join("");

      const rtRaw = [
        ["", "كل المدد"],
        ["0,89", "أقل من 90 دقيقة"],
        ["90,120", "من 90 إلى 120"],
        ["121,150", "من 121 إلى 150"],
        ["151,180", "من 151 إلى 180"],
        ["181,9999", "أكثر من 180"],
      ];
      let rtOpts = rtRaw.map(([v, l]) => '<option value="' + v + '"' + (rt == v ? " selected" : "") + ">" + l + "</option>").join("");
      if (rt && !rtRaw.some(([v]) => v === rt)) {
        rtOpts =
          '<option value="' + esc(rt) + '" selected>' +
          "المدة " +
          fa(+rt.split(",")[0]) +
          "–" +
          fa(+rt.split(",")[1]) +
          " دقيقة</option>" +
          rtOpts;
      }

      const restOf = (excluding) => {
        const o = { sortBy, genres: withGenres, year, vote, rt, country, lang, cert };
        delete o[excluding];
        return o;
      };
      const chips = [];
      if (year) chips.push(["year", "سنة " + esc(year), restOf("year")]);
      if (withGenres && genresById[withGenres]) chips.push(["genres", esc(genresById[withGenres]) + " ✕", restOf("genres")]);
      if (vote) chips.push(["vote", "التقييم ≥ " + fa(+vote) + "% ✕", restOf("vote")]);
      if (rt) chips.push(["rt", "المدة " + fa(+rt.split(",")[0]) + "–" + fa(+rt.split(",")[1]) + " دقيقة ✕", restOf("rt")]);
      if (country) chips.push(["country", String(country).toUpperCase() + " ✕", restOf("country")]);
      if (lang) chips.push(["lang", String(lang) + " ✕", restOf("lang")]);
      if (cert) chips.push(["cert", "تصنيف " + esc(cert) + " ✕", restOf("cert")]);
      const chipsRow = chips.length
        ? '<div class="filter-chips">' +
          chips.map(([, label, rest]) => '<a class="filter-chip" href="' + browseQuery(rest) + '" title="إزالة الفلتر">' + label + "</a>").join("") +
          '<a class="filter-chip clear" href="#/movies">مسح الكل ✕</a>' +
          "</div>"
        : "";

      const render = () => {
        app.innerHTML =
          '<h1 class="page-title" style="margin:24px 0 0">تصفح جميع الأفلام</h1>' +
          '<form class="filters" id="filtersForm">' +
          '<label>الترتيب <select name="sortBy">' +
          sOpts +
          "</select></label>" +
          '<label>النوع <select name="genres">' +
          gOpts +
          "</select></label>" +
          '<label>السنة <select name="year">' +
          yOpts +
          "</select></label>" +
          '<label>التقييم <select name="vote"><option value="">كل التقييمات</option>' +
          rOpts +
          "</select></label>" +
          '<label>المدة <select name="rt">' +
          rtOpts +
          "</select></label>" +
          "</form>" +
          chipsRow +
          '<div id="browseResults">' +
          gridHtml(state.acc) +
          "</div>" +
          moreSlot();
        bindFilters();
        bindGlobal();
        const btn = $("#loadMoreBtn");
        if (btn) btn.addEventListener("click", loadMore);
      };

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
          state.page = res.page || state.page + 1;
          append(res);
          const slot = $("#browseResults");
          if (slot) slot.innerHTML = gridHtml(state.acc);
          const wrap = document.querySelector(".more-wrap");
          if (wrap) wrap.outerHTML = moreSlot();
          bindGlobal();
          const nb = $("#loadMoreBtn");
          if (nb) nb.addEventListener("click", loadMore);
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
      append(r1);
      append(r2);
      state.page = 2;
      render();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر التحميل: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  function bindFilters() {
    const form = $("#filtersForm");
    if (!form) return;
    form.addEventListener("change", () => {
      const fd = new FormData(form);
      const qs = new URLSearchParams();
      if (fd.get("sortBy") && fd.get("sortBy") !== "popularity.desc") qs.set("sortBy", fd.get("sortBy"));
      if (fd.get("genres")) qs.set("genres", fd.get("genres"));
      if (fd.get("year")) qs.set("year", fd.get("year"));
      if (fd.get("vote")) qs.set("vote", fd.get("vote"));
      if (fd.get("rt")) qs.set("rt", fd.get("rt"));
      const p = parse(location.hash).params;
      if (p.country) qs.set("country", p.country);
      if (p.lang) qs.set("lang", p.lang);
      if (p.cert) qs.set("cert", p.cert);
      location.hash = "#/movies?" + qs.toString();
    });
  }

  views.search = async (params) => {
    setActiveNav("");
    setLoading(true);
    try {
      const q = (params.q || "").trim();
      $("#searchInput").value = q;
      if (!q) {
        app.innerHTML = '<div class="empty"><div class="icon">🔍</div><p>اكتب اسم فيلم في خانة البحث بالأعلى</p></div>';
        setLoading(false);
        return;
      }

      /* نجّيب نتائج Top Cinema + بحث TMDB في الخلفية */
      const [posts, tmdbRes] = await Promise.all([
        searchTopcinema(q),
        tmdb("/search/movie", { query: q, page: 1 }).catch(() => ({ results: [] })),
      ]);

      /* فهرس مطابقة TMDB (normalized title + سنة → movie object) */
      const tmdbIdx = new Map();
      for (const m of tmdbRes.results || []) {
        const en = normalize(m.original_title || m.title);
        const y = m.release_date ? new Date(m.release_date).getUTCFullYear() : null;
        tmdbIdx.set(en, m);
        if (m.title && normalize(m.title) !== en) tmdbIdx.set(normalize(m.title), m);
        if (y) tmdbIdx.set(en + " " + y, m);
      }

      const cards = [];
      const wpStore = loadWpPosts();
      let targetedCalls = 0;

      for (const post of posts) {
        const { year, enPart, isSeries } = parseWpTitle(post.title);
        const enN = normalize(enPart);
        let m = (year && tmdbIdx.get(enN + " " + year)) || tmdbIdx.get(enN) || null;

        /* بحث TMDB مركزي لأفلام غير معروفة (مقيد بعدد المكالمات عشان لا يبطي) */
        if (!m && enN && !isSeries && targetedCalls < 8 && enN.length >= 3) {
          targetedCalls++;
          try {
            const r = await tmdb("/search/movie", { query: enPart, page: 1 });
            const cand = (r.results || [])[0];
            if (cand && scoreTitle(cand.original_title || cand.title, enN, year || undefined) >= 0.7) {
              m = cand;
            }
          } catch {}
        }

        if (m) {
          cards.push(cardHtml(brief(m)));
        } else {
          const wp = { id: String(post.id), title: post.title, url: post.url, year: year || "" };
          wpStore[wp.id] = wp;
          cards.push(rawCardHtml(wp));
        }
      }
      saveWpPosts(wpStore);

      const head =
        '<div class="search-head"><h2>نتائج البحث عن: <span style="color:var(--accent)">' +
        esc(q) +
        "</span></h2>" +
        '<p class="search-note">كما تظهر في Top Cinema</p></div>';
      app.innerHTML = cards.length
        ? head + '<div class="row">' + cards.join("") + "</div>"
        : head + '<div class="empty"><div class="icon">🎬</div><p>لا توجد نتائج في مصدرنا الحالي لهذه الكلمة</p></div>';
      bindGlobal();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر البحث: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.movie = async (params) => {
    setActiveNav("");
    setLoading(true);
    try {
      const data = await tmdb("/movie/" + params.id, { append_to_response: "videos,credits,similar" });
      const b = brief(data);
      const bg = backdrop(b, 1280);
      const yearBadge = b.year;
      const runtime = data.runtime ? data.runtime + " دقيقة" : "";
      const cert = (data.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
      const certVal = cert?.release_dates.find((d) => d.certification)?.certification;
      const trailer = (data.videos?.results || []).find((v) => v.site === "YouTube" && v.type === "Trailer");
      const director = (data.credits?.crew || []).find((c) => c.job === "Director");
      const rating = getRating(b.id);

      const cast = (data.credits?.cast || []).slice(0, 8).map((c) => c.name).join("، ") || "—";
      const similar = (data.similar?.results || []).slice(0, 12).map(brief);

      let stars = "";
      for (let i = 1; i <= 5; i++) {
        stars += '<button data-rate="' + i + '" class="' + (rating && i <= rating ? "on" : "") + '">★</button>';
      }

      app.innerHTML =
        '<section class="movie"><div class="movie-hero">' +
        '<div class="movie-backdrop" style="' +
        (bg ? "background-image:url('" + bg + "')" : "") +
        '"></div>' +
        '<div class="movie-grid">' +
        (poster(b, 500)
          ? '<img class="movie-poster" src="' + poster(b, 500) + '" alt="' + esc(b.title) + '">'
          : "") +
        '<div class="movie-info">' +
        "<h1>" +
        esc(b.title) +
        "</h1>" +
        '<div class="movie-badges">' +
        (yearBadge ? '<a class="badge" href="' + browseQuery({ year: b.year }) + '">' + esc(yearBadge) + "</a>" : "") +
        (certVal ? '<a class="badge" href="' + browseQuery({ cert: certVal }) + '">' + esc(certVal) + "</a>" : "") +
        (runtime ? '<a class="badge" href="' + browseQuery({ rt: rtRange(data.runtime) }) + '">' + esc(runtime) + "</a>" : "") +
        '<a class="badge" href="' +
        browseQuery({ vote: pct(b.voteAverage) }) +
        '">⭐ ' +
        fa(pct(b.voteAverage)) +
        "% (" +
        fa(b.voteCount) +
        " تقييم)</a>" +
        (data.genres || [])
          .map((g) => '<a class="badge genre" href="' + browseQuery({ genres: g.id }) + '">' + esc(g.name) + "</a>")
          .join("") +
        "</div>" +
        '<div class="movie-actions">' +
        '<a class="btn btn-primary" href="#/watch/' +
        b.id +
        '">▶ شاهد الفيلم</a>' +
        '<button class="btn btn-ghost" id="favBtn">' +
        (isFav(b.id) ? "♥ إزالة من المفضلة" : "♡ أضف للمفضلة") +
        "</button>" +
        '<div class="stars">' +
        stars +
        "</div>" +
        '<span class="rating-note">' +
        (rating ? "بصّام: " + fa(rating) + "/5" : "قيّم الفيلم") +
        "</span></div>" +
        (b.overview ? '<p class="overview">' + esc(b.overview) + "</p>" : "") +
        '<div class="meta-list">' +
        (director ? "<div><strong>المخرج:</strong> " + esc(director.name) + "</div>" : "") +
        "<div><strong>النجوم:</strong> " +
        esc(cast) +
        "</div>" +
        (data.production_countries?.length
          ? "<div><strong>البلد:</strong> " +
            data.production_countries
              .map((c) => '<a class="meta-link" href="' + browseQuery({ country: c.iso_3166_1 }) + '">' + esc(c.name) + "</a>")
              .join("، ") +
            "</div>"
          : "") +
        (data.spoken_languages?.length
          ? "<div><strong>اللغات:</strong> " +
            data.spoken_languages
              .slice(0, 3)
              .map((l) => '<a class="meta-link" href="' + browseQuery({ lang: l.iso_639_1 }) + '">' + esc(l.name || l.iso_639_1) + "</a>")
              .join("، ") +
            "</div>"
          : "") +
        (trailer ? '<div><a href="https://www.youtube.com/watch?v=' + trailer.key + '" target="_blank" rel="noopener" style="color:var(--accent)">▶ مشاهدة الإعلان الرسمي</a></div>' : "") +
        "</div></div></div></div></section>" +
        '<section class="section reveal"><div class="section-head"><h2>أفلام مشابهة</h2></div>' +
        gridHtml(similar) +
        "</section>";

      $("#favBtn").addEventListener("click", () => {
        const fav = toggleFav(b);
        $("#favBtn").textContent = fav ? "♥ إزالة من المفضلة" : "♡ أضف للمفضلة";
        toast(fav ? "تمت الإضافة للمفضلة" : "تمت الإزالة من المفضلة");
      });

document.querySelectorAll("[data-rate]").forEach((btn) =>
        btn.addEventListener("click", () => {
          const r = +btn.dataset.rate;
          const cur = getRating(b.id);
          const next = cur === r ? 0 : r;
          setRating(b, next);
          document.querySelectorAll("[data-rate]").forEach((st) =>
            st.classList.toggle("on", next > 0 && +st.dataset.rate <= next)
          );
          const note = document.querySelector(".rating-note");
          if (note) note.textContent = next ? "بتقييمك: " + fa(next) + "/5" : "قيّم الفيلم";
          toast(next ? "تم حفظ التقييم" : "تم حذف التقييم");
        })
      );

      bindGlobal();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر عرض الفيلم: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.watch = async (params) => {
    setActiveNav("");
    setLoading(true);
    try {
      const data = await tmdb("/movie/" + params.id);
      const b = brief(data);
      const resolved = await resolveMovie(b);

      if (!resolved) {
        const fileTip =
          location.protocol === "file:"
            ? '<p style="color:var(--muted);font-size:0.85rem;margin-top:14px">التشغيل يحتاج فتح الموقع من الرابط المباشر وليس من الملف على جهازك:<br><b>https://top-cinema-production-44b5.up.railway.app</b></p>'
            : "";
        app.innerHTML =
          '<div class="watch"><div class="not-found">' +
          '<div class="icon">😕</div>' +
          "<h2>" +
          esc(b.title) +
          "</h2>" +
          "<p>للأسف لم نجد نسخة متاحة للبث حاليًا لهذا الفيلم.<br>جرّب فيلمًا آخر من الرئيسية.</p>" +
          '<a class="btn btn-ghost" href="#/movie/' +
          b.id +
          '">العودة لصفحة الفيلم</a>' +
          fileTip +
          "</div></div>";
        bindGlobal();
        setLoading(false);
        return;
      }

      const servers = resolved.servers && resolved.servers.length > 1 ? resolved.servers : [];
      let serversRow = "";
      if (servers.length) {
        serversRow =
          '<div class="watch-servers">' +
          servers
            .map(
              (s, i) =>
                '<button class="srv-btn' +
                (i === 0 ? " active" : "") +
                '" data-src="' +
                esc(s) +
                '" title="الخصائص الأصلية"' +
                ">سيرفر " +
                (i + 1) +
                ' <small class="srv-host">' +
                esc(hostnameOf(s).split(".")[0]) +
                "</small></button>"
            )
            .join("") +
          "</div>";
      }

      app.innerHTML =
        '<div class="watch">' +
        '<div class="section-head"><h2>▶ ' +
        esc(b.title) +
        " (" +
        (b.year || "—") +
        ')</h2><a class="see-all" href="#/movie/' +
        b.id +
        '">تفاصيل الفيلم</a></div>' +
        '<div class="watch-frame"><iframe id="watchIframe" src="' +
        esc(resolved.embedUrl) +
        '" allow="autoplay; fullscreen; encrypted-media" allowfullscreen referrerpolicy="origin" title="مشاهدة ' +
        esc(b.title) +
        '"></iframe></div>' +
        serversRow +
        (servers.length
          ? '<p style="color:var(--muted);font-size:0.85rem;margin-top:10px">إن أكثُرت الإعلانات في سيرفر، اختر سيرفرًا آخر من الأزرار أعلاه.</p>'
          : '<p style="color:var(--muted);font-size:0.85rem;margin-top:10px">إذا لم يعمل المشغل، جرّب فتح <a href="' +
            esc(resolved.embedUrl) +
            '" target="_blank" rel="noopener" style="color:var(--accent)">النافذة الأصلية</a></p>') +
        "</div>";

      document.querySelectorAll(".srv-btn").forEach((btn) =>
        btn.addEventListener("click", () => {
          document.querySelectorAll(".srv-btn").forEach((x) => x.classList.remove("active"));
          btn.classList.add("active");
          const iframe = $("#watchIframe");
          if (iframe) iframe.src = btn.dataset.src;
        })
      );

      addHistory(b);
      bindGlobal();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر التشغيل: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  /* صفحة مشاهدة مباشرة لنتيجة بحث Top Cinema (بدون بيانات TMDB) */
  views.watchWp = async (params) => {
    setActiveNav("");
    setLoading(true);
    const posts = loadWpPosts();
    const p = posts[params.id];
    if (!p || !p.url) {
      app.innerHTML =
        '<div class="not-found"><div class="icon">🎬</div><p>الرابط قديم أو غير متاح — ابحث عن الفيلم من جديد.</p>' +
        '<a class="btn btn-ghost" href="#/">الرئيسية</a></div>';
      setLoading(false);
      return;
    }
    app.innerHTML =
      '<div class="watch">' +
      '<div class="section-head"><h2>▶ ' +
      esc(p.title) +
      (p.year ? " (" + esc(p.year) + ")" : "") +
      '</h2><a class="see-all" href="' +
      esc(p.url) +
      '" target="_blank" rel="noopener">فتح في Top Cinema</a></div>' +
      '<div class="watch-frame"><iframe id="watchIframe" src="' +
      esc(p.url) +
      '?embedScreen=true" allow="autoplay; fullscreen; encrypted-media" allowfullscreen referrerpolicy="origin" title="' +
      esc(p.title) +
      '"></iframe></div>' +
      '<p style="color:var(--muted);font-size:0.85rem;margin-top:10px">إذا لم يعمل المشغل، جرّب فتح <a href="' +
      esc(p.url) +
      '?embedScreen=true" target="_blank" rel="noopener" style="color:var(--accent)">النافذة الأصلية</a></p>' +
      "</div>";
    bindGlobal();
    setLoading(false);
  };

  views.library = async (params) => {
    setActiveNav(params.type);
    setLoading(true);
    const lib = loadLib();
    let list = [];
    let title = "";

    if (params.type === "favorites") {
      title = "المفضلة";
      list = Object.values(lib.favorites).map((i) => briefFromSnapshot(i.snapshot));
    } else if (params.type === "history") {
      title = "آخر المشاهدة";
      list = Object.values(lib.history)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map((i) => briefFromSnapshot(i.snapshot));
    } else if (params.type === "rated") {
      title = "قيمت عليها";
      list = Object.values(lib.ratings).map((i) => briefFromSnapshot(i.snapshot));
    }

    app.innerHTML =
      '<h1 class="page-title" style="margin:24px 0 16px">' +
      title +
      "</h1>" +
      (list.length
        ? gridHtml(list)
        : '<div class="empty"><div class="icon">🍿</div><p>القائمة فاضية حاليًا.<br>تصفح الأفلام من <a href="#/" style="color:var(--accent)">الرئيسية</a> وابدأ أضف المفضلة!</p></div>');
    bindGlobal();
    setLoading(false);
  };

  /* ---------- ربط عام (الأزرار داخل البطاقات) ---------- */
  function bindGlobal() {
    observeReveals();
    document.querySelectorAll("[data-fav]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const card = btn.closest(".card");
        const id = +btn.dataset.fav;
        const b = {
          id,
          title: card?.dataset.title || "فيلم",
          year: card?.dataset.year ? +card.dataset.year : null,
          posterPath: card?.dataset.poster || null,
          voteAverage: card?.dataset.rating ? +card.dataset.rating : null,
        };
        const lib = loadLib();
        const isNow = !lib.favorites[id];
        if (isNow) {
          lib.favorites[id] = { snapshot: snapshotOf(b) };
        } else {
          delete lib.favorites[id];
        }
        saveLib(lib);
        btn.classList.toggle("active", isNow);
        btn.textContent = isNow ? "♥" : "♡";
        toast(isNow ? "تمت الإضافة للمفضلة" : "تمت الإزالة من المفضلة");
      })
    );
  }

  /* ---------- الراوتر ---------- */
  /* قفزة فورية لأعلى بدون scroll متحرك قديم */
  function jumpTop() {
    const html = document.documentElement;
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      html.style.scrollBehavior = "";
    });
  }

  function parse(hash) {
    const h = hash || "#/";
    const [pathRaw, query] = h.slice(2).split("?");
    const parts = pathRaw.split("/").filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ""));
    return { parts, params };
  }

  async function route() {
    const { parts, params } = parse(location.hash);
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
      await views.watchWp({ id: decodeURIComponent(parts[1]) });
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
    if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
  });

  /* بحث فوري أثناء الكتابة */
  let searchDebounce;
  $("#searchInput").addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = $("#searchInput").value.trim();
    if (!q || q.length < 2) {
      if (location.hash.indexOf("#/search") === 0) app.innerHTML = "";
      return;
    }
    searchDebounce = setTimeout(() => {
      if (location.hash !== "#/search?q=" + encodeURIComponent(q)) {
        location.hash = "#/search?q=" + encodeURIComponent(q);
      }
    }, 350);
  });

  window.addEventListener("hashchange", route);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  renderNavBadges();
  seedGenreNames();

  /* ضغطة في أي مكان على "المعلومات القابلة للنقر" = فتح قائمة أفلام بنفس التصنيف */
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
    else if (card.dataset.wp) location.hash = "#/wp/" + card.dataset.wp;
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