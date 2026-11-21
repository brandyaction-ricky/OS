// 숏폼 웹 렌더러 (2026-11-19, 「롱폼 재활용 숏폼 정본」 §3~§8): one GSAP timeline from a storyboard (story.json) and the design values
// (theme.json). Scene templates own what moves in which order; colours, type, spacing, subtitles and easing come from the theme only,
// so a new design is a theme edit. The page is seeked frame by frame by render.py (window.__seek) and checks itself (window.__qaAll).
(() => {
  const story = window.__STORY, T = window.__THEME, C = T.colors, M = T.motion, G = T.grid;
  const stage = document.getElementById("stage");
  const $ = (s, r = document) => r.querySelector(s);
  const mk = (tag, cls, parent, html, style) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (style) Object.assign(e.style, style); parent.appendChild(e); return e; };
  const qa = (e, label, kind = "text") => { e.dataset.qa = kind; e.dataset.label = label; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const photoUrl = f => `url(${story.photoBase || "photos/"}${f})`;

  // theme → CSS variables
  const css = document.documentElement.style;
  Object.entries(C).forEach(([k, v]) => css.setProperty(`--${k}`, v));
  css.setProperty("--card-radius", `${T.card.radius}px`); css.setProperty("--card-shadow", T.card.shadow);
  css.setProperty("--photo-filter", `saturate(${T.photo.saturate}) contrast(${T.photo.contrast})`);
  // the frame: 9:16 draws the design as it is; 1:1 · 4:5 (feed) fit the design's text band (T.band) into the frame, photos fill it all
  const F = window.__FORMAT || T.frame, vertical = F.h / F.w > 1.6, bandH = T.band.bottom - T.band.top;
  const k = vertical ? 1 : Math.min(1, F.h / bandH, F.w / T.frame.w);
  const ox = vertical ? 0 : (F.w - T.frame.w * k) / 2, oy = vertical ? 0 : (F.h - bandH * k) / 2 - T.band.top * k;
  stage.style.width = `${F.w}px`; stage.style.height = `${F.h}px`;

  const bg = mk("div", "layer", stage);
  const box = mk("div", "abs", stage, null, { left: `${ox}px`, top: `${oy}px`, width: `${T.frame.w}px`, height: `${T.frame.h}px`, transform: `scale(${k})`, transformOrigin: "0 0" });
  const vis = mk("div", "layer", box);
  // the shade behind the title spans the whole frame width, from the frame's top edge
  const top = mk("div", "abs", box, null, { left: `${-ox / k}px`, width: `${F.w / k}px`, top: `${-oy / k}px`, height: `${560 + oy / k}px`, background: T.photo.topShade, opacity: 0, zIndex: 40 });
  const heroBox = mk("div", "layer", box, null, { zIndex: 45, pointerEvents: "none" });
  const subs = mk("div", "abs", box, null, { left: `${(T.frame.w - T.subtitle.width) / 2}px`, width: `${T.subtitle.width}px`, bottom: `${T.subtitle.bottom}px`, zIndex: 60, display: "flex", justifyContent: "center" });
  const tl = gsap.timeline({ paused: true });
  gsap.ticker.lagSmoothing(0);

  // a scene's photo: the whole frame under the title, drifting slowly; blurred behind a card
  const backdrop = (img, a, b, blur = false) => {
    const ph = mk("div", "photo", bg, null, { backgroundImage: photoUrl(img), opacity: 0, ...(blur ? { filter: `blur(${T.photo.blur}px) saturate(1.05)` } : {}) });
    const v = mk("div", "layer", bg, null, { opacity: 0, background: T.photo.veil });
    tl.to([ph, v], { opacity: 1, duration: 0.35 }, a).fromTo(ph, { scale: M.drift }, { scale: 1, duration: b - a + 0.4, ease: "none" }, a).to([ph, v], { opacity: 0, duration: 0.3 }, b);
    return ph;
  };
  const card = (html, a, b, h = G.bottom - G.top) => {
    const c = mk("div", "card", vis, html, { left: `${G.left}px`, top: `${G.top}px`, width: `${G.right - G.left}px`, height: `${h}px`, opacity: 0 });
    c.dataset.box = "카드";
    tl.fromTo(c, { opacity: 0, rotationX: -60, y: 120, scale: 0.92, transformPerspective: 1600, transformOrigin: "50% 100%" }, { opacity: 1, rotationX: 0, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, a)
      .to(c, { opacity: 0, y: -60, scale: 0.96, duration: 0.3, ease: M.out }, b - 0.3);
    return c;
  };
  const pop = (e, at, from = { y: 40, scale: 0.6 }) => tl.fromTo(e, { opacity: 0, ...from }, { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.42, ease: M.pop }, at);

  // ── title: words pop over the first photo, then it flies to the top and stays (no band) ──
  const title = mk("div", "abs", heroBox, null, { left: "60px", right: "60px", top: `${G.heroTop}px`, textAlign: "center", fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", transformOrigin: "50% 0", textShadow: "0 4px 18px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.6)" });
  qa(title, "제목", "title");
  const titleWords = [], accents = [];
  (story.title?.lines ?? []).forEach(line => {
    const l = mk("div", "", title, null, { fontSize: `${T.type.title}px`, lineHeight: 1.22 });
    line.forEach(piece => (piece.accent ? [piece.text] : piece.text.split(" ").filter(Boolean)).forEach(w => {
      const s = mk("span", "w", l, null, { display: "inline-block", position: "relative", padding: piece.accent ? "0 12px" : 0 });
      if (piece.accent) { const p = mk("span", "abs", s, null, { inset: "6px -4px 2px -4px", background: C.brand2, borderRadius: "18px", zIndex: -1, transformOrigin: "0 50%" }); accents.push([p, s]); }
      mk("span", "", s, esc(w), { position: "relative" }); titleWords.push(s); s.after(" ");
    }));
  });

  const scenes = {
    opening(s) {
      const ph = mk("div", "photo", bg, null, { backgroundImage: photoUrl(s.photo) }), v = mk("div", "veil", bg);
      tl.fromTo(ph, { scale: 1.16 }, { scale: 1, duration: s.to + 0.2, ease: "none" }, 0)
        .fromTo(titleWords, { opacity: 0, y: 60, scale: 0.6 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: M.pop, stagger: 0.11 }, s.from + 0.04);
      accents.forEach(([p]) => tl.fromTo(p, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "expo.out" }, s.from + 0.75));
      const lift = G.titleTop - G.heroTop;
      tl.to(top, { opacity: 1, duration: 0.42 }, s.to - 0.15).to(title, { y: lift, scale: T.type.titleTopScale, duration: 0.5, ease: M.move }, s.to - 0.15);
      accents.forEach(([p, w]) => tl.to(p, { opacity: 0, duration: 0.25 }, s.to - 0.05).to(w, { color: C.accentText, duration: 0.25 }, s.to - 0.05));
      tl.to([ph, v], { opacity: 0, duration: 0.3 }, s.to + 0.1);
    },
    // C: a situation photo with a person card, a tape label and/or steps that light up as they are said
    photo(s) {
      const ph = mk("div", "photo", bg, null, { backgroundImage: photoUrl(s.photo), opacity: 0 }), v = mk("div", "layer", bg, null, { opacity: 0, background: T.photo.veil });
      const a = s.from - 0.05, b = s.to;
      tl.to([ph, v], { opacity: 1, duration: s.enter === "whip" ? 0.01 : 0.3 }, a).fromTo(ph, { scale: M.drift + 0.02, x: 30 }, { scale: 1.02, x: -30, duration: b - a + 0.4, ease: "none" }, a);
      if (s.enter === "whip") tl.fromTo(ph, { xPercent: 100, filter: "blur(10px)" }, { xPercent: 0, filter: "blur(0px)", duration: M.whip + 0.02, ease: M.ease }, a);
      if (s.exit === "whip") tl.to([ph, v], { yPercent: -100, duration: M.whip, ease: M.out }, b - 0.2).set([ph, v], { opacity: 0 }, b + 0.2);
      else tl.to([ph, v], { opacity: 0, duration: 0.3 }, b);
      if (s.persona) {
        const c = mk("div", "card", vis, `<div class="abs" style="left:34px;top:34px;width:124px;height:124px;border-radius:50%;background:var(--brand)"></div>
          <div class="abs" style="left:58px;top:56px;width:76px;height:36px;border-radius:38px 38px 0 0;background:#fff;opacity:.9"></div>
          <div class="abs" style="left:66px;top:96px;width:60px;height:44px;border-radius:30px 30px 6px 6px;background:#fff;opacity:.9"></div>
          <div class="abs n" style="left:190px;top:30px;font-weight:900;font-size:64px">${esc(s.persona.name)}</div>
          <div class="abs d" style="left:192px;top:110px;font-weight:600;font-size:44px;color:var(--gray)">${esc(s.persona.desc)}</div>`,
          { left: `${G.left}px`, top: "560px", width: `${Math.max(560, 232 + Math.max(s.persona.name.length * 62, s.persona.desc.length * 43))}px`, height: "192px", opacity: 0 });
        qa(c.querySelector(".n"), s.persona.name); qa(c.querySelector(".d"), s.persona.desc); c.dataset.box = "인물 카드";
        tl.fromTo(c, { opacity: 0, x: -260, rotation: -6 }, { opacity: 1, x: 0, rotation: 0, duration: 0.55, ease: "back.out(1.6)" }, s.persona.at)
          .to(c, { opacity: 0, x: -120, duration: 0.3, ease: M.out }, s.to - 0.3);
      }
      if (s.tape) {
        const html = s.tape.lines.map((l, i) => i === s.tape.accent ? `<em>${esc(l)}</em>` : esc(l)).join("<br>");
        const t = qa(mk("div", "tape", vis, html, { left: `${G.left}px`, top: `${s.tape.top ?? 840}px`, opacity: 0 }), s.tape.lines.join(" "));
        tl.fromTo(t, { opacity: 0, x: 200, rotation: 8 }, { opacity: 1, x: 0, rotation: -3, duration: 0.5, ease: "back.out(1.7)" }, s.tape.at)
          .to(t, { y: -14, duration: Math.max(0.5, s.to - s.tape.at - 0.8), ease: "none" }, s.tape.at + 0.5).to(t, { opacity: 0, y: -200, duration: 0.3, ease: M.out }, s.to - 0.3);
      }
      if (s.steps?.length) {
        const gap = 200, y0 = 760 - (s.steps.length - 1) * gap / 2;
        s.steps.forEach((st, i) => {
          const c = qa(mk("div", "chip", vis, esc(st.text), { left: "540px", top: `${y0 + i * gap}px`, opacity: 0 }), st.text);
          tl.fromTo(c, { opacity: 0, scale: 0.5, xPercent: -50 }, { opacity: 1, scale: 1, xPercent: -50, duration: 0.42, ease: M.pop }, st.at - 0.08).to(c, { opacity: 0, duration: 0.3 }, s.to - 0.3);
          if (i) {
            tl.to(vis.querySelectorAll(".chip")[vis.querySelectorAll(".chip").length - 2], { background: C.line, color: C.gray, duration: 0.2 }, st.at);
            const a = mk("div", "abs", vis, null, { left: "536px", top: `${y0 + (i - 1) * gap + 130}px`, width: "8px", height: "0px", background: "#fff", borderRadius: "4px" });
            tl.to(a, { height: gap - 140, duration: 0.25, ease: "power2.out" }, st.at - 0.2).to(a, { opacity: 0, duration: 0.3 }, s.to - 0.3);
          }
        });
      }
      return ph;
    },
    // B: one stimulus, two reactions — the face changes, one person sees it (a sight line draws), the others don't; it can carry on into
    // the prepared words that halve and a progress bar that rushes to the end, all on the same card (one picture turning into the next)
    react(s) {
      backdrop(s.photo, s.from - 0.2, s.to, true);
      const box = mk("div", "layer", vis, `<svg viewBox="0 0 1080 1920" width="1080" height="1920" style="position:absolute;inset:0">
        <defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#1E246E" flood-opacity=".18"/></filter></defs>
        <rect id="bcard" x="${G.left}" y="${G.top}" width="${G.right - G.left}" height="${G.bottom - G.top}" rx="${Math.round(T.card.radius * 4 / 3)}" fill="#fff" filter="url(#sh)" opacity="0"/>
        <line id="sight" x1="540" y1="690" x2="335" y2="810" stroke="${C.brand}" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 18" opacity="0"/>
        <g transform="translate(540 760)"><g id="face">
          <circle r="160" fill="#fff" stroke="${C.ink}" stroke-width="11" filter="url(#sh)"/>
          <rect id="browL" x="-96" y="-66" width="64" height="15" rx="7.5" fill="${C.ink}"/><rect id="browR" x="32" y="-66" width="64" height="15" rx="7.5" fill="${C.ink}"/>
          <circle cx="-60" cy="-16" r="15" fill="${C.ink}"/><circle cx="60" cy="-16" r="15" fill="${C.ink}"/>
          <path id="mouth" d="M -66 70 Q 0 96 66 70" stroke="${C.ink}" stroke-width="13" fill="none" stroke-linecap="round"/></g></g>
        <g transform="translate(540 1000)"><g id="tag" opacity="0"><rect x="-150" y="-46" width="300" height="92" rx="46" fill="${C.soft}"/><text id="tagT" text-anchor="middle" y="16" font-size="46" font-weight="700" fill="${C.brand}">${esc(s.stimulus.label)}</text></g></g>
        <g transform="translate(305 880)"><g id="me" opacity="0"><circle id="ring" r="118" fill="none" stroke="${C.brand}" stroke-width="8" opacity="0"/>
          <circle r="92" fill="${C.brand}"/><path d="M -42 -4 Q 0 -38 42 -4 Q 0 30 -42 -4" fill="#fff"/><circle r="14" fill="${C.brand}"/>
          <text id="meT" text-anchor="middle" y="160" font-size="50" font-weight="900" fill="${C.ink}">${esc(s.a.label)}</text></g></g>
        <g transform="translate(775 880)"><g id="team" opacity="0">
          ${[-74, 0, 74].map((x, i) => `<g class="tm" transform="translate(${x} ${i === 1 ? -30 : 0})"><circle r="56" fill="${C.muted}"/><rect class="lid" x="-24" y="-6" width="48" height="12" rx="6" fill="${C.gray}"/></g>`).join("")}
          <text id="teamT" text-anchor="middle" y="160" font-size="50" font-weight="900" fill="${C.gray}">${esc(s.b.label)}</text></g></g>
        ${s.bubble ? `<g transform="translate(540 670)"><g id="bubble" opacity="0">
          <text id="bubT" text-anchor="middle" y="-202" font-size="50" font-weight="900" fill="${C.ink}">${esc(s.bubble.label)}</text>
          <rect x="-330" y="-180" width="660" height="330" rx="56" fill="#fff" stroke="${C.ink}" stroke-width="10" filter="url(#sh)"/>
          <path d="M -46 146 L 0 214 L 50 146" fill="#fff" stroke="${C.ink}" stroke-width="10" stroke-linejoin="round"/>
          ${[0, 1, 2, 3].map(i => `<rect class="bl" x="-262" y="${-124 + i * 72}" width="524" height="38" rx="19" fill="${i ? C.mutedInk : C.brand}"/>`).join("")}</g></g>` : ""}
        ${s.progress ? `<g transform="translate(540 760)"><g id="prog" opacity="0">
          <text id="progT" text-anchor="middle" y="-70" font-size="54" font-weight="900" fill="${C.ink}">${esc(s.progress.label)}</text>
          <rect x="-330" y="-22" width="660" height="44" rx="22" fill="${C.line}"/><rect id="fill" x="-330" y="-22" width="660" height="44" rx="22" fill="${C.brand}"/>
          <g transform="translate(300 -170)"><g id="stamp" opacity="0"><circle r="74" fill="${C.stamp}"/><text id="stampT" text-anchor="middle" y="20" font-size="58" font-weight="900" fill="#fff">${esc(s.progress.stamp || "끝")}</text></g></g></g></g>` : ""}
      </svg>`);
      const S = id => box.querySelector(id);
      [["#tagT", s.stimulus.label], ["#meT", s.a.label], ["#teamT", s.b.label], ...(s.bubble ? [["#bubT", s.bubble.label]] : []), ...(s.progress ? [["#progT", s.progress.label], ["#stampT", s.progress.stamp || "끝"]] : [])].forEach(([id, l]) => qa(S(id), l));
      const st = s.stimulus;
      tl.fromTo(S("#bcard"), { opacity: 0, scale: 0.9, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.5)" }, s.from - 0.15)
        .fromTo(S("#face"), { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.55, ease: M.enter }, s.from - 0.1)
        .fromTo(S("#tag"), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35, ease: M.ease }, st.at)
        .to(S("#mouth"), { attr: { d: "M -66 92 Q 0 40 66 92" }, duration: 0.38, ease: "back.out(2)" }, st.changeAt)
        .to(S("#browL"), { rotation: 16, transformOrigin: "100% 50%", y: 12, duration: 0.32, ease: "back.out(2)" }, st.changeAt)
        .to(S("#browR"), { rotation: -16, transformOrigin: "0% 50%", y: 12, duration: 0.32, ease: "back.out(2)" }, st.changeAt)
        .to(S("#face"), { x: -8, duration: 0.05, yoyo: true, repeat: 5 }, st.changeAt + 0.25)
        .to(S("#face"), { y: -170, scale: 0.68, duration: 0.6, ease: M.move }, s.a.at - 0.15)
        .to(S("#tag"), { y: -260, opacity: 0, duration: 0.45, ease: M.move }, s.a.at - 0.15)
        .fromTo(S("#me"), { opacity: 0, scale: 0.4, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.5, ease: M.enter }, s.a.at)
        .fromTo(S("#sight"), { opacity: 1, attr: { "stroke-dasharray": "300 300", "stroke-dashoffset": 300 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.45, ease: "power2.out" }, s.a.at + 0.22)
        .fromTo(S("#ring"), { opacity: 0.9, scale: 0.8, transformOrigin: "50% 50%" }, { opacity: 0, scale: 1.45, duration: 0.75, ease: "power2.out", repeat: 1 }, s.a.at + 0.35)
        .fromTo(S("#team"), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.42, ease: M.ease }, s.b.at)
        .fromTo(box.querySelectorAll("#team .tm"), { scale: 0.5, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.38, ease: "back.out(2)", stagger: M.stagger }, s.b.at);
      if (s.b.closeAt) tl.to(box.querySelectorAll("#team .lid"), { fill: C.ink, duration: 0.15 }, s.b.closeAt);
      if (s.b.dimAt) tl.to(S("#team"), { opacity: 0.32, duration: 0.3 }, s.b.dimAt);
      const next = s.bubble?.at ?? s.progress?.at;
      if (next) {   // the person carries on to the centre; the rest leaves
        const go = (s.bubble?.moveAt ?? next) - 0.1;
        tl.to([S("#face"), S("#sight"), S("#team")], { opacity: 0, duration: 0.3, ease: "power2.in" }, go - 0.1)
          .to(S("#meT"), { opacity: 0, duration: 0.2 }, go - 0.1).to(S("#me"), { x: 235, y: 85, scale: 1, duration: 0.65, ease: M.move }, go);
      }
      if (s.bubble) {
        const b = s.bubble;
        tl.fromTo(S("#bubble"), { opacity: 0, scale: 0.3, transformOrigin: "50% 100%" }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, b.at)
          .fromTo(box.querySelectorAll("#bubble .bl"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.32, ease: M.ease, stagger: 0.07 }, b.linesAt ?? b.at + 0.6);
        if (b.shrinkAt) tl.to(box.querySelectorAll("#bubble .bl"), { scaleX: i => (i < 2 ? 0.5 : 0), duration: 0.42, ease: M.move, stagger: 0.05 }, b.shrinkAt);
        if (s.progress) tl.to(S("#bubble"), { y: -60, scale: 0, opacity: 0, duration: 0.4, ease: M.out }, s.progress.at - 0.1);
      }
      if (s.progress) {
        const p = s.progress;
        tl.fromTo(S("#prog"), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.35, ease: M.ease }, p.at)
          .fromTo(S("#fill"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, transformOrigin: "0% 50%", duration: 0.6, ease: "power4.in" }, p.fillAt)
          .fromTo(S("#stamp"), { opacity: 0, scale: 2.4, rotation: -30, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, rotation: -12, duration: 0.35, ease: "back.out(2.2)" }, p.stampAt ?? p.fillAt + 0.6);
      }
      tl.to(box, { xPercent: -100, duration: 0.36, ease: M.out }, s.to - 0.1).set(box, { autoAlpha: 0 }, s.to + 0.3);
    },
    // D: a messenger window — each message is typed while it is said, deleted, or sent
    messenger(s) {
      backdrop(s.photo, s.from - 0.1, s.to, true);
      const c = card(`<div class="abs" style="left:40px;top:34px;width:92px;height:92px;border-radius:50%;background:var(--muted)"></div>
        <div class="abs nm" style="left:156px;top:44px;font-weight:900;font-size:${T.type.cardHead}px">${esc(s.name)}</div>
        <div class="abs" style="left:0;right:0;top:160px;height:2px;background:var(--soft)"></div>
        <div class="abs sent" style="right:40px;top:196px;max-width:620px;background:var(--brand);color:#fff;font-weight:600;font-size:${T.type.cardBody - 8}px;line-height:1.32;padding:22px 32px;border-radius:38px 38px 8px 38px;opacity:0"></div>
        <div class="abs" style="left:30px;right:30px;bottom:30px;height:190px;border-radius:32px;background:#F4F5FB"></div>
        <div class="abs typed" style="left:62px;right:150px;bottom:62px;font-weight:700;font-size:${T.type.cardBody - 6}px;line-height:1.3;color:var(--ink);word-break:keep-all"></div>
        <div class="abs send" style="right:54px;bottom:62px;width:84px;height:84px;border-radius:50%;background:var(--muted)"></div>`, s.from, s.to);
      qa(c.querySelector(".nm"), s.name);
      const typed = qa(c.querySelector(".typed"), "입력 중 글자"), send = c.querySelector(".send"), sent = qa(c.querySelector(".sent"), "보낸 말풍선");
      const caret = `<span style="display:inline-block;width:5px;height:${T.type.cardBody - 4}px;background:${C.brand};vertical-align:-8px;margin-left:5px"></span>`;
      const show = (text, n) => { typed.innerHTML = esc(text.slice(0, Math.round(n))) + caret; };
      tl.call(() => { typed.innerHTML = caret; }, null, s.from + 0.3);
      for (const m of s.messages) {
        const p = { n: 0 };
        tl.fromTo(p, { n: 0 }, { n: m.text.length, duration: Math.max(0.3, m.atEnd - m.at), ease: "none", onUpdate: () => show(m.text, p.n) }, m.at);
        if (m.delAt) { const q = { n: m.text.length }; tl.fromTo(q, { n: m.text.length }, { n: 0, duration: 0.42, ease: "power2.in", onUpdate: () => show(m.text, q.n) }, m.delAt); }
        if (m.sendAt) {
          tl.to(send, { background: C.brand, duration: 0.15 }, m.sendAt - 0.25).set(typed, { innerHTML: "" }, m.sendAt).set(sent, { innerHTML: esc(m.text) }, m.sendAt)
            .fromTo(sent, { opacity: 0, y: 260, scale: 0.6, transformOrigin: "100% 100%" }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, m.sendAt);
        }
      }
      if (s.pulseAt) tl.to(c, { scale: 1.03, duration: 0.25, yoyo: true, repeat: 1, ease: "power2.inOut" }, s.pulseAt);
    },
    // B/D: time passes — a clock spins fast over a clocks photo
    clock(s) {
      backdrop(s.photo, s.from - 0.1, s.to, true);
      const box = mk("div", "layer", vis, `<svg viewBox="0 0 1080 1920" width="1080" height="1920" style="position:absolute;inset:0">
        <g transform="translate(540 710)"><g id="clk" opacity="0"><circle r="240" fill="#fff" stroke="${C.ink}" stroke-width="12"/>
          ${Array.from({ length: 12 }, (_, i) => `<rect x="-5" y="-222" width="10" height="${i % 3 ? 22 : 40}" rx="5" fill="${C.ink}" transform="rotate(${i * 30})"/>`).join("")}
          <rect id="hh" x="-9" y="-120" width="18" height="140" rx="9" fill="${C.ink}"/><rect id="mh" x="-6" y="-190" width="12" height="210" rx="6" fill="${C.brand}"/><circle r="16" fill="${C.ink}"/></g></g>
        <text id="clkT" x="540" y="1050" text-anchor="middle" font-size="${T.type.big}" font-weight="900" fill="#fff" stroke="${C.ink}" stroke-width="12" paint-order="stroke" opacity="0">${esc(s.label || "")}</text></svg>`);
      const S = id => box.querySelector(id); qa(S("#clkT"), s.label || "시계");
      const spin = s.spinAt ?? s.from + 0.35, spinFor = Math.max(0.8, s.to - 0.25 - spin);
      tl.fromTo(S("#clk"), { opacity: 0, scale: 0.4, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.7)" }, s.from)
        .fromTo(S("#mh"), { rotation: 0, transformOrigin: "50% 90.5%" }, { rotation: 1080, duration: spinFor, ease: "power2.inOut" }, spin)
        .fromTo(S("#hh"), { rotation: 30, transformOrigin: "50% 85.7%" }, { rotation: 120, duration: spinFor, ease: "power2.inOut" }, spin);
      if (s.label) tl.fromTo(S("#clkT"), { opacity: 0, y: 40, scale: 0.6, transformOrigin: "50% 50%" }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(2)" }, s.labelAt);
      tl.to(S("#clk"), { scale: 6, opacity: 0, duration: 0.55, ease: M.out }, s.to - 0.1).to(S("#clkT"), { opacity: 0, duration: 0.2 }, s.to - 0.1);
    },
    // C: a spotlight closes on one point of the photo
    spotlight(s) {
      backdrop(s.photo, s.from - 0.15, s.to, false);
      const spot = mk("div", "layer", bg, null, { opacity: 0 }); const sp = { r: 900, x: 50, y: 42 };
      const paint = () => { spot.style.background = `radial-gradient(circle at ${sp.x}% ${sp.y}%, rgba(0,0,0,0) ${sp.r * k}px, rgba(6,8,22,.62) ${(sp.r + 40) * k}px)`; }; paint();
      tl.set(spot, { opacity: 1 }, s.from).to(sp, { r: s.r ?? 230, x: s.x ?? 46, y: s.y ?? 40, duration: 0.6, ease: M.move, onUpdate: paint }, s.focusAt ?? s.from + 0.8).to(spot, { opacity: 0, duration: 0.25 }, s.to - 0.1);
    },
    // C: a fast push into the photo with speed streaks
    push(s) {
      const ph = backdrop(s.photo, s.from - 0.1, s.to, false);
      const at = s.pushAt ?? s.from + 0.6;
      tl.fromTo(ph, { scale: 1 }, { scale: 1.35, duration: 0.5, ease: "expo.in" }, at - 0.25).to(ph, { scale: 1.4, duration: 1, ease: "none" }, at + 0.25);
      const streaks = Array.from({ length: 9 }, (_, i) => mk("div", "abs", vis, null, { left: "-400px", top: `${520 + i * 60}px`, width: `${260 + (i % 3) * 140}px`, height: "7px", background: "rgba(255,255,255,.75)", borderRadius: "4px", opacity: 0 }));
      tl.fromTo(streaks, { opacity: 0, x: 1500 }, { opacity: 1, x: -300, duration: 0.45, ease: "power2.out", stagger: 0.025 }, at - 0.05).to(streaks, { opacity: 0, duration: 0.2 }, at + 0.45);
    },
    // C: a slow push with a darkening edge
    vignette(s) {
      const ph = backdrop(s.photo, s.from - 0.1, s.to, false);
      const vig = mk("div", "layer", bg, null, { background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0) 35%, rgba(6,8,22,.7) 100%)", opacity: 0 });
      tl.fromTo(ph, { scale: 1.05 }, { scale: 1.22, duration: s.to - s.from + 0.1, ease: "power1.inOut" }, s.from - 0.1).to(vig, { opacity: 1, duration: 0.6 }, s.darkAt ?? s.from + 1).to(vig, { opacity: 0, duration: 0.25 }, s.to - 0.1);
    },
    // C: two photos split top and bottom (a recap of what was seen). The top photo fills the frame from the scene's start (no empty
    // frame while waiting for its cue) and folds into the top half as the bottom photo comes in. Both move together with the same
    // ease, so the top photo's lower edge and the bottom photo's upper edge stay joined (no white strip between them).
    split(s) {
      const half = (img, topPx, h0) => { const h = mk("div", "abs", bg, null, { left: 0, top: `${topPx}px`, width: `${F.w}px`, height: `${h0}px`, overflow: "hidden", opacity: 0 }); const ph = mk("div", "photo", h, null, { backgroundImage: photoUrl(img) }); return [h, ph]; };
      const [t1, p1] = half(s.top.photo, 0, F.h), [t2, p2] = half(s.bottom.photo, F.h / 2, F.h / 2);
      const line = mk("div", "abs", bg, null, { left: 0, top: `${F.h / 2 - 6}px`, width: `${F.w}px`, height: "12px", background: "#fff", transformOrigin: "0 50%", transform: "scaleX(0)" });
      tl.fromTo(t1, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: M.ease }, s.from).fromTo(p1, { scale: 1.15 }, { scale: 1, duration: s.to - s.from, ease: "none" }, s.from)
        .to(t1, { height: F.h / 2, duration: 0.45, ease: M.ease }, s.bottom.at - 0.1)
        .to(line, { scaleX: 1, duration: 0.35, ease: M.ease }, s.bottom.at - 0.1)
        .fromTo(t2, { opacity: 1, yPercent: 100 }, { yPercent: 0, duration: 0.45, ease: M.ease }, s.bottom.at - 0.1).fromTo(p2, { scale: 1.15 }, { scale: 1, duration: s.to - s.bottom.at, ease: "none" }, s.bottom.at);
    },

    // D: a checklist card — each item pops in as it is said; an optional pick lights one item and dims the rest
    list(s) {
      backdrop(s.photo, s.from - 0.1, s.to, true);
      const n = s.items.length, head = s.title ? 150 : 40, room = G.bottom - G.top - head - 40, row = Math.min(150, room / n), top0 = head + (room - row * n) / 2;
      const c = card(`${s.title ? `<div class="abs hd" style="left:56px;top:46px;font-weight:900;font-size:${T.type.cardHead + 6}px">${esc(s.title)}</div>` : ""}`, s.from, s.to);
      if (s.title) qa(c.querySelector(".hd"), s.title);
      const rows = s.items.map((it, i) => {
        const r = mk("div", "abs", c, null, { left: "36px", right: "36px", top: `${top0 + i * row}px`, height: `${row - 16}px`, borderRadius: "24px" });
        const dot = mk("div", "abs", r, `<svg viewBox="0 0 64 64" width="72" height="72"><circle cx="32" cy="32" r="32" fill="${C.brand}"/><path d="M18 33 L28 43 L46 23" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`, { left: "24px", top: `${(row - 16 - 72) / 2}px`, width: "72px", height: "72px" });
        const tx = qa(mk("div", "abs", r, esc(it.text), { left: "124px", top: "50%", transform: "translateY(-50%)", fontWeight: 800, fontSize: `${T.type.cardBody + 4}px`, whiteSpace: "nowrap" }), it.text);
        const at = it.at ?? s.from + 0.4 + i * 0.5;
        tl.fromTo(dot, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.4, ease: M.pop }, at - 0.06)
          .fromTo(tx, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.4, ease: M.ease }, at);
        return r;
      });
      if (Number.isInteger(s.pick) && rows[s.pick]) {
        const at = s.pickAt ?? s.to - 1;
        tl.to(rows[s.pick], { background: C.soft, scale: 1.03, duration: 0.35, ease: M.enter }, at)
          .to(rows.filter((_, i) => i !== s.pick), { opacity: 0.35, duration: 0.3 }, at);
      }
    },
    // B: two sides — each turns over as it is said; an optional pick (0 left, 1 right) fills the chosen side and dims the other
    compare(s) {
      backdrop(s.photo, s.from - 0.1, s.to, true);
      const c = card("", s.from, s.to);
      const w = (G.right - G.left - 136) / 2, h = G.bottom - G.top - 200;
      const side = (d, i) => {
        const p = mk("div", "abs", c, `<div class="abs lb" style="left:50%;top:40px;transform:translateX(-50%);background:${C.soft};color:${C.brand};font-weight:700;font-size:${T.type.label - 6}px;padding:10px 30px;border-radius:999px;white-space:nowrap">${esc(d.label)}</div>
          <div class="abs tx" style="left:24px;right:24px;top:50%;transform:translateY(-36%);text-align:center;font-weight:900;font-size:${T.type.cardBody + 4}px;line-height:1.2;word-break:keep-all;overflow-wrap:anywhere">${esc(d.text)}</div>`,
          { left: `${48 + i * (w + 40)}px`, top: "100px", width: `${w}px`, height: `${h}px`, borderRadius: "28px", border: `4px solid ${C.line}`, background: C.paper });
        qa(p.querySelector(".lb"), d.label); qa(p.querySelector(".tx"), d.text); p.dataset.box = "비교 칸";
        tl.fromTo(p, { opacity: 0, rotationY: i ? 80 : -80, transformPerspective: 1400 }, { opacity: 1, rotationY: 0, duration: 0.55, ease: M.enter }, d.at ?? s.from + 0.3 + i * 0.8);
        return p;
      };
      const ps = [side(s.a, 0), side(s.b, 1)];
      const mid = mk("div", "abs", c, s.arrow ? `<svg viewBox="0 0 60 60" width="60" height="60"><path d="M10 30 H46 M32 14 L48 30 L32 46" stroke="${C.ink}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "vs",
        { left: `${48 + w + 20 - 30}px`, top: `${100 + h / 2 - 30}px`, width: "60px", height: "60px", textAlign: "center", lineHeight: "60px", fontWeight: 900, fontSize: "40px", color: C.gray });
      tl.fromTo(mid, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: M.pop }, (s.b.at ?? s.from + 1.1) - 0.15);
      if (s.pick === 0 || s.pick === 1) {
        const at = s.pickAt ?? s.to - 1, win = ps[s.pick];
        tl.to(win, { background: C.brand, borderColor: C.brand, scale: 1.05, duration: 0.35, ease: M.enter }, at)
          .to(win.querySelector(".tx"), { color: "#fff", duration: 0.25 }, at).to(win.querySelector(".lb"), { background: "rgba(255,255,255,.18)", color: "#fff", duration: 0.25 }, at)
          .to(ps[1 - s.pick], { opacity: 0.35, scale: 0.96, duration: 0.3 }, at);
      }
    },
    // the last screen of an ad: what to look for and what to do, with a button that keeps pulsing
    endcard(s) {
      backdrop(s.photo, s.from - 0.1, s.to + 0.5, false);
      const c = mk("div", "card", vis, `<div class="abs nm" style="left:0;right:0;top:70px;text-align:center;font-weight:900;font-size:${T.type.title - 20}px;letter-spacing:-0.02em">${esc(s.name)}</div>
        ${s.line ? `<div class="abs ln" style="left:40px;right:40px;top:186px;text-align:center;font-weight:600;font-size:${T.type.label}px;color:var(--gray);word-break:keep-all">${esc(s.line)}</div>` : ""}
        <div class="abs bt" style="left:50%;bottom:64px;transform:translateX(-50%);background:var(--brand);color:#fff;font-weight:800;font-size:${T.type.cardBody}px;padding:24px 64px;border-radius:999px;white-space:nowrap;box-shadow:0 16px 36px rgba(20,30,140,.35)">${esc(s.button)}</div>`,
        { left: `${G.left}px`, top: `${G.top + 60}px`, width: `${G.right - G.left}px`, height: "500px", opacity: 0 });
      qa(c.querySelector(".nm"), s.name); qa(c.querySelector(".bt"), s.button); if (s.line) qa(c.querySelector(".ln"), s.line); c.dataset.box = "행동 카드";
      const bt = c.querySelector(".bt"), at = s.buttonAt ?? s.from + 0.7;
      tl.fromTo(c, { opacity: 0, y: 160, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.5)" }, s.from)
        .fromTo(bt, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.45, ease: M.pop }, at)
        .to(bt, { scale: 1.07, duration: 0.45, yoyo: true, repeat: Math.max(1, Math.floor((s.to - at - 0.5) / 0.45)), ease: "sine.inOut" }, at + 0.5);
    },
  };
  for (const s of story.scenes) {
    if (!scenes[s.type]) throw new Error(`unknown scene type ${s.type}`);
    scenes[s.type](s);
  }

  // subtitles: one line each, shown from a little before the first word until the next line
  const subEls = [];
  (story.subtitles ?? []).forEach(([a, b, text], i, all) => {
    const e = qa(mk("div", "sub", subs, null, { fontSize: `${T.type.subtitle}px`, fontWeight: T.subtitle.weight, background: T.subtitle.bg, borderRadius: `${T.subtitle.radius}px`, padding: T.subtitle.pad }), text, "sub");
    subEls.push(e);
    e.textContent = text;
    tl.fromTo(e, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, Math.max(0, a - 0.05));
    const next = all[i + 1];
    tl.set(e, { opacity: 0 }, next && next[0] - b < 0.12 ? next[0] - 0.05 : b + 0.1);
  });
  tl.to({}, { duration: 0.01 }, story.duration);

  // QA: text glyphs stay out of the Shorts UI, never overlap the subtitle, subtitles stay one line and readable
  const S = T.safe, W = F.w, H = F.h;
  const opacityOf = el => { let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement || n.parentNode) { if (n.nodeType !== 1) break; const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); } return o; };
  const glyphs = el => { if (el instanceof SVGElement || el.dataset.qa === "sub") return el.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(el); const rs = [...rg.getClientRects()].filter(r => r.width > 1); if (!rs.length) return el.getBoundingClientRect(); const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), r = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom)); return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }; };
  window.__qa = t => {
    tl.time(t); const out = [], st = stage.getBoundingClientRect();
    const items = [...document.querySelectorAll("[data-qa]")].map(el => ({ el, kind: el.dataset.qa, label: el.dataset.label, r: glyphs(el), o: opacityOf(el) }))
      .filter(i => i.o > 0.6 && i.r.width > 2 && i.r.right > st.left + 1 && i.r.left < st.right - 1 && i.r.bottom > st.top + 1 && i.r.top < st.bottom - 1);
    for (const i of items) {
      const r = { l: i.r.left - st.left, t: i.r.top - st.top, r: i.r.right - st.left, b: i.r.bottom - st.top }; i.box = r;
      if (i.kind === "title" && t < (story.scenes[0]?.to ?? 0)) continue;   // the opening title is large on purpose
      if (r.l < 40 || r.r > W - 40) out.push([t, i.label, `가로 밖 (${Math.round(r.l)}~${Math.round(r.r)})`]);
      if (!vertical) { if (r.t < 30 || r.b > H - 30) out.push([t, i.label, `세로 밖 (${Math.round(r.t)}~${Math.round(r.b)})`]); }
      else {
        if (r.t < S.top) out.push([t, i.label, `위 아이콘 자리 (${Math.round(r.t)})`]);
        if (r.b > S.bottom) out.push([t, i.label, `아래 쇼츠 글자 자리 침범 (아래 ${Math.round(r.b)})`]);
        if (r.r > S.right && r.b > S.rightFrom) out.push([t, i.label, `오른쪽 버튼 자리 침범 (오른쪽 ${Math.round(r.r)}, 아래 ${Math.round(r.b)})`]);
      }
      const box = i.el.closest?.("[data-box]");
      if (box && i.kind === "text") { const b = box.getBoundingClientRect(); if (i.r.left < b.left - 2 || i.r.right > b.right + 2 || i.r.top < b.top - 2 || i.r.bottom > b.bottom + 2) out.push([t, i.label, `${box.dataset.box} 밖으로 나감`]); }
      if (i.kind === "sub") { if (i.r.height > (T.type.subtitle * 1.32 + 40) * k) out.push([t, i.label, "자막이 두 줄"]); if (i.label.replace(/\s/g, "").length > 14) out.push([t, i.label, "자막 14자 넘음"]); }
    }
    const subsOn = items.filter(i => i.kind === "sub"), texts = items.filter(i => i.kind === "text");
    for (const s of subsOn) for (const x of texts) { const a = s.box, b = x.box; const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); if (w > 4 && h > 4) out.push([t, `${x.label} ↔ 자막`, `겹침 ${Math.round(w)}×${Math.round(h)}`]); }
    if (subsOn.length > 1) out.push([t, subsOn.map(s => s.label).join(" / "), "자막 두 개가 동시에"]);
    return out;
  };
  window.__qaAll = (step = 0.1) => { const all = []; for (let t = 0; t <= story.duration; t += step) all.push(...window.__qa(+t.toFixed(2))); return all; };
  window.__seek = t => { tl.time(t); };
  window.__duration = story.duration;
  // A long line (14 letters with its spaces) is wider than the room left of the Shorts buttons (11-21: 890–905 > safe.right):
  // that line alone gets a smaller type, measured once the fonts are in.
  const fitSubs = () => {
    const room = 2 * (T.safe.right - T.frame.w / 2) - 4;
    for (const e of subEls) {
      if (e.offsetWidth <= room) continue;
      const cs = getComputedStyle(e), pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      e.style.fontSize = `${Math.floor(T.type.subtitle * (room - pad) / (e.offsetWidth - pad))}px`;
    }
  };
  document.fonts.ready.then(() => Promise.all(Object.keys(T.fonts.files).map(w => document.fonts.load(`${w} 50px ${T.fonts.family}`)))).then(() => { fitSubs(); tl.time(0); window.__ready = true; });
})();
