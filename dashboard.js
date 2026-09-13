(function () {
  function set(id, text, ok) {
    var el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = ok ? "ok" : "bad"; }
  }

  fetch("/proxy/?p=4997")
    .then(function (r) { return r.ok && r.status === 200 ? r.text() : null; })
    .then(function (t) {
      if (!t || !/watch\/\?url=/i.test(t)) set("srcStatus", "غير متاح", false);
      else set("srcStatus", "متاح", true);
    })
    .catch(function () { set("srcStatus", "غير متاح", false); });

  fetch("/tmdb/genre/movie/list")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.genres && j.genres.length) set("tmdbStatus", "مفعّل", true);
      else set("tmdbStatus", "غير مفعل (جرّب TMDB_KEY)", false);
    })
    .catch(function () { set("tmdbStatus", "فشل — افحص TMDB_KEY", false); });

  fetch("/app.js")
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var m = t.match(/const TMDB_BASE = "([^"]+)"/);
      set("version", m && m[1] === "/tmdb" ? "مؤمّن (المفتاح على الخادم)" : "نسخة قديمة", m && m[1] === "/tmdb");
    });
})();