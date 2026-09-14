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
    return posts.map((p) => itemFromPost(p, mm[p.featured_media]));
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
        per_page: Math.min(per_page, 100),
        subtype: "post",
        _fields: "id,title,url",
      });
      const found = r.json && r.json.length ? r.json : [];
      if (!found.length) return { items: [], total: 0, totalPages: 1 };
      const ids = found.map((x) => x.id);
      const d = await tc("posts", {
        include: ids.join(","),
        per_page: 100,
        _fields: "id,title,link,date,categories,featured_media",
      });
      const dm = {};
      for (const x of d.json || []) dm[x.id] = x;
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

  views.home = async () => {
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
        $("#heroSlot").innerHTML = hero;
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

      const filmCats = cats.filter((c) => FILM_CATS.includes(c.id));
      const seriesCats = cats.filter((c) => SERIES_CATS.includes(c.id));
      const pills = (list, cf) =>
        list
          .map((c) => '<a class="filter-chip" href="' + browseQuery({ cat: c.id }) + '">' + esc(c.name) + "</a>")
          .join("");

      app.innerHTML =
        '<div id="heroSlot"></div>' +
        '<section class="section reveal"><div class="section-head"><h2>🎬 أحدث الأفلام</h2>' +
        '<a class="see-all" href="' + browseQuery({ cat: FILM_CATS.join(",") }) + '">عرض الكل</a></div>' +
        (filmCats.length ? '<div class="filter-chips">' + pills(filmCats) + "</div>" : "") +
        gridHtml(films.items.slice(1, 25)) +
        "</section>" +
        '<section class="section reveal"><div class="section-head"><h2>📺 أحدث المسلسلات</h2>' +
        '<a class="see-all" href="' + browseQuery({ cat: SERIES_CATS.join(",") }) + '">عرض الكل</a></div>' +
        (seriesCats.length ? '<div class="filter-chips">' + pills(seriesCats) + "</div>" : "") +
        gridHtml(series.items.slice(0, 25)) +
        "</section>";
      renderHero();
      bindGlobal();
      observeReveals();
    } catch (e) {
      app.innerHTML = '<div class="error-box">تعذر تحميل البيانات: ' + esc(e.message) + "</div>";
    }
    setLoading(false);
  };

  views.movies = async (params) => {
    setActiveNav("browse");
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
        if (state.page >= state.totalPages) {
          return state.acc.length
            ? '<p class="more-end">عرض ' + fa(state.acc.length) + " عنصر — وصلت للنهاية</p>"
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
          gridHtml(state.acc) +
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
          if (slot) slot.innerHTML = gridHtml(state.acc);
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

      const rating = getRating(item.id);
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
        (related.length
          ? '<section class="section reveal"><div class="section-head"><h2>الأحدث في نفس القسم</h2></div>' +
            gridHtml(related) +
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
          setRating(item, rating === v ? null : v);
          document.querySelectorAll(".stars button").forEach((x) => x.classList.toggle("on", +x.dataset.rate <= (rating === v ? 0 : v)));
          $(".rating-note").textContent = rating === v ? "قيّم الفيلم" : "بصّام: " + fa(v) + "/5";
        })
      );
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
      app.innerHTML =
        '<div class="watch">' +
        '<div class="section-head"><h2>▶ ' +
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
        '<p style="color:var(--muted);font-size:0.85rem;margin-top:10px">إذا لم يعمل المشغل، جرّب فتح <a href="' +
        esc(item.link) +
        '?embedScreen=true" target="_blank" rel="noopener" style="color:var(--accent)">النافذة الأصلية</a></p>' +
        "</div>";
      addHistory(item);
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
      if (!q) {
        app.innerHTML = '<div class="empty"><div class="icon">🔍</div><p>اكتب اسم فيلم في خانة البحث بالأعلى</p></div>';
        setLoading(false);
        return;
      }
      const res = await fetchPosts({ search: q, per_page: 40 });
      const items = res.items;
      const head =
        '<div class="search-head"><h2>نتائج البحث عن: <span style="color:var(--accent)">' +
        esc(q) +
        "</span></h2>" +
        '<p class="search-note">كما تظهر في Top Cinema</p></div>';
      app.innerHTML = items.length
        ? head + '<div class="row">' + items.map(cardHtml).join("") + "</div>"
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
    if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
  });

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