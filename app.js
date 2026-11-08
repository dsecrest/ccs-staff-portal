(function () {
  "use strict";
  var C = window.PORTAL_CONFIG || {};
  var MB = 1024 * 1024;
  var params = new URLSearchParams(location.search);

  // ---------- Embed mode (inside Squarespace) ----------
  var embedded = params.has("embed") || window.self !== window.top;
  if (embedded) document.body.classList.add("embed");

  function postHeight() {
    if (window.parent === window) return;
    window.parent.postMessage({ ccsPortalHeight: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  }
  if ("ResizeObserver" in window) new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener("load", postHeight);

  // ---------- Section switching ----------
  var panels = Array.prototype.slice.call(document.querySelectorAll(".panel"));
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tabs a"));

  function show(id, scroll) {
    if (!document.getElementById(id) || !document.getElementById(id).classList.contains("panel")) id = "apply";
    panels.forEach(function (p) { p.hidden = p.id !== id; });
    tabs.forEach(function (t) {
      if (t.hash === "#" + id) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    if (scroll) window.scrollTo(0, 0);
    postHeight();
  }

  var only = params.get("only");
  if (only) {
    document.body.classList.add("single");
    show(only);
  } else {
    show(location.hash.slice(1));
  }
  // Any in-page link to a section (tabs, "see Recommendation Letters" etc.)
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || only) return;
    var id = a.getAttribute("href").slice(1);
    if (!document.getElementById(id)) return;
    e.preventDefault();
    history.replaceState(null, "", "#" + id);
    show(id, true);
  });
  window.addEventListener("hashchange", function () { if (!only) show(location.hash.slice(1)); });

  // ---------- Static text from config ----------
  document.querySelectorAll("[data-max-file]").forEach(function (el) { el.textContent = C.maxFileMB || 10; });
  document.querySelectorAll("[data-version]").forEach(function (el) { el.textContent = C.handbookVersion || ""; });

  var hbFrame = document.querySelector("[data-handbook]");
  var hbLink = document.querySelector("[data-handbook-link]");
  if (C.handbookUrl) {
    hbFrame.src = C.handbookUrl;
    hbLink.href = C.handbookUrl.replace(/\/preview(\?.*)?$/, "/view");
  } else {
    hbFrame.hidden = true;
    hbLink.parentElement.hidden = true;
    document.querySelector(".handbook-missing").hidden = false;
  }

  // ---------- Signature pad ----------
  var pad = (function () {
    var canvas = document.querySelector(".sig-pad");
    var ctx = canvas.getContext("2d");
    var drawing = false, dirty = false, last = null;

    function resize() {
      var data = dirty ? canvas.toDataURL() : null;
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = "#0d1d3f";
      if (data) {
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, r.width, r.height); };
        img.src = data;
      }
    }
    function pt(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (!canvas.width) resize();
      drawing = true; last = pt(e);
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = "#0d1d3f"; ctx.fill();
      dirty = true;
      canvas.classList.remove("invalid");
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var p = pt(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
      canvas.addEventListener(t, function () { drawing = false; });
    });
    window.addEventListener("resize", resize);
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);

    function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }
    document.querySelector("[data-clear-sig]").addEventListener("click", clear);

    return {
      canvas: canvas,
      isEmpty: function () { return !dirty; },
      clear: clear,
      toBase64: function () {
        // Flatten onto white so the signature shows in PDFs/viewers.
        var out = document.createElement("canvas");
        out.width = canvas.width; out.height = canvas.height;
        var o = out.getContext("2d");
        o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(canvas, 0, 0);
        return out.toDataURL("image/png").split(",")[1];
      }
    };
  })();

  // ---------- Forms ----------
  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(",")[1] || ""); };
      fr.onerror = function () { reject(new Error("Couldn't read " + file.name)); };
      fr.readAsDataURL(file);
    });
  }

  function setStatus(form, msg, kind) {
    var s = form.querySelector(".status");
    s.textContent = msg || "";
    s.className = "status" + (kind ? " " + kind : "");
  }

  function validate(form) {
    var firstBad = null;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.classList.contains("hp")) return;
      el.classList.remove("invalid");
      if (!el.checkValidity()) {
        el.classList.add("invalid");
        firstBad = firstBad || el;
      }
    });
    if (form.dataset.type === "handbook" && pad.isEmpty()) {
      pad.canvas.classList.add("invalid");
      firstBad = firstBad || pad.canvas;
    }
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      if (firstBad.focus) firstBad.focus({ preventScroll: true });
      var msg = firstBad === pad.canvas ? "Please sign in the box above."
        : (firstBad.validationMessage || "Please fill in the highlighted fields.");
      setStatus(form, "Please check the highlighted fields. " + msg, "error");
      return false;
    }
    return true;
  }

  document.addEventListener("input", function (e) {
    if (e.target.classList && e.target.classList.contains("invalid") && e.target.checkValidity()) {
      e.target.classList.remove("invalid");
    }
  });

  document.querySelectorAll("form[data-type]").forEach(function (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (!validate(form)) return;
      if (!C.scriptUrl) {
        setStatus(form, "This form isn't connected yet (missing scriptUrl in config.js).", "error");
        return;
      }

      var payload = { type: form.dataset.type, fields: {}, files: [] };
      var total = 0;
      try {
        btn.disabled = true;
        setStatus(form, "Preparing…", "info");

        for (var i = 0; i < form.elements.length; i++) {
          var el = form.elements[i];
          if (!el.name || el.disabled) continue;
          if (el.type === "file") {
            for (var j = 0; j < el.files.length; j++) {
              var f = el.files[j];
              if (f.size > (C.maxFileMB || 10) * MB) throw new Error('"' + f.name + '" is larger than ' + (C.maxFileMB || 10) + " MB. Please choose a smaller file.");
              total += f.size;
              payload.files.push({ field: el.name, name: f.name, mimeType: f.type || "application/octet-stream", data: await readBase64(f) });
            }
          } else if (el.type === "checkbox" || el.type === "radio") {
            if (!el.checked) continue;
            payload.fields[el.name] = payload.fields[el.name] ? payload.fields[el.name] + ", " + el.value : el.value;
          } else {
            payload.fields[el.name] = el.value.trim();
          }
        }
        if (total > (C.maxTotalMB || 30) * MB) throw new Error("Your files add up to more than " + (C.maxTotalMB || 30) + " MB. Please send them in a few smaller batches.");

        if (form.dataset.type === "handbook") {
          payload.signature = pad.toBase64();
          payload.handbookVersion = C.handbookVersion || "";
          payload.statement = form.querySelector("[data-statement]").textContent.replace(/\s+/g, " ").trim();
        }

        setStatus(form, payload.files.length ? "Uploading… please keep this page open." : "Sending…", "info");
        // text/plain body avoids a CORS preflight, which Apps Script can't answer.
        var res = await fetch(C.scriptUrl, { method: "POST", body: JSON.stringify(payload) });
        var out = await res.json();
        if (!out.ok) throw new Error(out.error || "The server didn't accept the submission.");

        form.hidden = true;
        var done = form.nextElementSibling;
        done.hidden = false;
        done.scrollIntoView({ behavior: "smooth", block: "center" });
        postHeight();
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = "We couldn't reach the server. Check your internet connection and try again.";
        setStatus(form, msg, "error");
      } finally {
        btn.disabled = false;
      }
    });
  });

  // "Upload another" buttons: reset the form but keep name/email/code.
  document.querySelectorAll("[data-again]").forEach(function (b) {
    b.addEventListener("click", function () {
      var done = b.closest(".done");
      var form = done.previousElementSibling;
      form.querySelectorAll('input[type=file], select, input[name="Notes"], input[name="Recommender name"], input[name="Recommender contact"], input[name="Relationship"]').forEach(function (el) { el.value = ""; });
      setStatus(form, "");
      done.hidden = true;
      form.hidden = false;
      postHeight();
    });
  });
})();
