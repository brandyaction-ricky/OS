import { createImportFlow } from "./upload-dialog.mjs";
import { recurringCandidates } from "./recurring.mjs";
import DOMPurify from "dompurify";
const cleanHTML = html => DOMPurify.sanitize(html,{USE_PROFILES:{html:true,svg:true},FORBID_TAGS:["style","foreignObject"]});
/** Finance UI controller adapted from the supplied v0.6 visual prototype.
 * React owns the host; this controller exclusively owns its descendants.
 * Server persistence is injected by the authenticated client adapter; demo is isolated.
 */
export function createFinanceDemo() {
  return mountFinanceWorkspace(null, {});
}
export function mountFinanceWorkspace(root, options = {}) {
  const abort = root ? new AbortController() : null,
    timers = new Set();
  const connected = Boolean(options.data);
  const ACTOR = options.actorId || "담당 A";
  let liveData = options.data;
  let saving = false;
  const newId = () => crypto.randomUUID();
  const getId = (id) => root.querySelector("#" + id);
  const listen = (type, handler) =>
    root.addEventListener(type, handler, { signal: abort.signal });
  if (root)
    root.innerHTML =
      cleanHTML('<div class="samplebar" role="note"><span><b>모의 모드</b> · 2026년 7–10월 예시 데이터. 변경은 이 화면에서만 유지되며 새로고침하면 초기화됩니다. 실제 거래·발송 없음.</span><div class="sw"><button class="chip" data-act="palette">재무 내역 찾기</button><button class="chip" data-act="blank" id="blankBtn" aria-pressed="false">금액 숨기기</button><button class="chip" data-act="reset" id="resetBtn">예시 데이터 처음으로</button></div></div><div class="view" id="view" tabindex="-1"></div><div id="layer"></div><div id="tip" hidden></div><div id="toast" role="status" aria-live="polite" hidden></div>');

  /* ================= 기본 도구 ================= */
  const TODAY = options.today || "2026-10-07",
    DATA_START = options.dataStart || (connected ? "2000-01-01" : "2026-07-01"),
    NOW_LABEL = connected ? new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}) : "10/7(수) 11:00";
  const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const HOL = new Set([
    "2026-08-15",
    "2026-08-17",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-10-03",
    "2026-10-05",
    "2026-10-09",
  ]);
  const WD = "일월화수목금토";
  const pad = (n) => String(n).padStart(2, "0");
  const dparse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const dstr = (t) => t.toISOString().slice(0, 10);
  const addDays = (s, n) => {
    const t = dparse(s);
    t.setUTCDate(t.getUTCDate() + n);
    return dstr(t);
  };
  const diffDays = (a, b) => Math.round((dparse(b) - dparse(a)) / 864e5);
  const isBiz = (s) => {
    const w = dparse(s).getUTCDay();
    return w !== 0 && w !== 6 && !HOL.has(s);
  };
  const addBiz = (s, n) => {
    let t = s;
    while (n > 0) {
      t = addDays(t, 1);
      if (isBiz(t)) n--;
    }
    return t;
  };
  const nextBiz = (s) => {
    let t = s;
    while (!isBiz(t)) t = addDays(t, 1);
    return t;
  };
  const md = (s) => {
    if (!s) return "미정";
    const t = dparse(s);
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${WD[t.getUTCDay()]})`;
  };
  const mdS = (s) => {
    if (!s) return "미정";
    const t = dparse(s);
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`;
  };
  const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
  const mLabel = (ym) => `${Number(ym.slice(5))}월`;
  const nextYm = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  };
  const lastDay = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let seed = 20261007;
  const R = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const wpick = (arr) => {
    let tot = arr.reduce((a, b) => a + b[1], 0),
      x = R() * tot;
    for (const [v, w] of arr) {
      x -= w;
      if (x < 0) return v;
    }
    return arr[0][0];
  };
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const sum = (a, f) => a.reduce((x, y) => x + (f ? f(y) : y), 0);
  const parseNum = (v) => {
    const t = String(v ?? "")
      .trim()
      .replace(/[,\s₩원]/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(t)) return NaN;
    const n = Number(t);
    return isFinite(n) ? n : NaN;
  };

  let BLANK = false;
  if (root) {
    try {
      BLANK = localStorage.getItem("finance.hideAmounts") === "true";
    } catch {
      /* Private browsing. */
    }
  }
  const B = () => `<span class="blank">[ ]</span>`;
  const won = (n) =>
    BLANK
      ? B() + "원"
      : (n < 0 ? "−" : "") +
        Math.abs(Math.round(n)).toLocaleString("ko-KR") +
        "원";
  const man = (n) => {
    if (BLANK) return B() + "원";
    const a = Math.abs(n),
      sg = n < 0 ? "−" : "";
    if (a >= 1e8)
      return (
        sg +
        (a / 1e8).toFixed(2).replace(/0$/, "").replace(/\.0$/, "") +
        "억 원"
      );
    if (a >= 1e4)
      return sg + Math.round(a / 1e4).toLocaleString("ko-KR") + "만 원";
    return sg + Math.round(a).toLocaleString("ko-KR") + "원";
  };
  const cnt = (n) => (BLANK ? B() : Number(n).toLocaleString("ko-KR"));
  const pct = (x) =>
    BLANK ? B() + "%" : (x * 100).toFixed(1).replace(/\.0$/, "") + "%";
  const usd = (n) =>
    BLANK
      ? "$" + B()
      : "$" +
        Number(n).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const ICN = { good: "✓", warn: "!", bad: "✕" };
  const pill = (k, t) =>
    `<span class="pill ${k}">${ICN[k] ? `<span aria-hidden="true">${ICN[k]}</span>` : ""}${t}</span>`;
  const chip = (act, val, label, on, n) =>
    `<button class="chip" data-act="${act}" data-v="${esc(val)}" aria-pressed="${on}">${label}${n !== undefined ? ` <span class="n">${n}</span>` : ""}</button>`;
  const tbl = (h, rows, foot = "", cls = "") =>
    `<div class="tbl-wrap"><table class="tbl ${cls}"><thead><tr>${h.map((x) => `<th${x.r ? ' class="r"' : ""}>${x.t ?? x}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table></div>`;
  const head = (t, s, a = "") =>
    `<div class="ph"><div class="ph-t"><h1>${t}</h1>${s ? `<p class="ph-s">${s}</p>` : ""}</div>${a ? `<div class="ph-a">${a}</div>` : ""}</div>`;
  const fmtIn = (n) => Number(n).toLocaleString("ko-KR");

  /* ================= 예시 데이터: 토스 결제 ================= */
  const BIZ = {
    edu: { name: "브랜디에듀", short: "에듀", cls: "s2" },
    myin: { name: "마이인 진단", short: "마이인", cls: "s1" },
    hm: { name: "하루멜라", short: "하루멜라", cls: "s3" },
    ba: { name: "브랜디액션", short: "브랜디액션", cls: "" },
    common: { name: "공통", short: "공통", cls: "" },
  };
  const bz = (b) =>
    b === "common" || b === "ba"
      ? `<span class="pill out">${BIZ[b].short}</span>`
      : BIZ[b]
        ? `<span class="bz"><i style="background:var(--${BIZ[b].cls})"></i>${BIZ[b].short}</span>`
        : '<span class="muted">-</span>';
  const PROD = {
    edu: {
      moon: { n: "문샷 챌린지 4기", p: 890000 },
      ai: { n: "AI 직원 생성하기", p: 290000 },
      self: { n: "자영업 마케팅 2기", p: 390000 },
    },
    myin: {
      lite: { n: "라이트 진단", p: 39000 },
      deep: { n: "정밀 진단", p: 129000 },
      rep: { n: "사업 운영 맞춤 리포트", p: 290000 },
    },
  };

  const METHODS = [
    ["카드", 58],
    ["토스페이", 14],
    ["카카오페이", 10],
    ["네이버페이", 9],
    ["계좌이체", 5],
    ["가상계좌", 4],
  ];
  const FEE = {
    카드: 0.032,
    토스페이: 0.034,
    카카오페이: 0.034,
    네이버페이: 0.034,
    계좌이체: 0.02,
  };
  const SURN = "김이박최정강조윤장임한오서신권황안송류홍",
    GIV = "연우진서민지현수아윤호준";
  const SRC = {
    myin: [
      ["유튜브 설명란", 30],
      ["메타 광고", 22],
      ["네이버 검색", 12],
      ["카카오 채널", 8],
      ["직접", 8],
      ["미기록", 20],
    ],
    edu: [
      ["무료 웨비나", 30],
      ["유튜브 설명란", 18],
      ["카카오 채널", 14],
      ["메타 광고", 10],
      ["직접", 6],
      ["미기록", 22],
    ],
  };
  const TX = [];
  (function () {
    const seq = { edu: 0, myin: 0 };
    for (let d = DATA_START; d <= TODAY; d = addDays(d, 1)) {
      const w = dparse(d).getUTCDay(),
        we = w === 0 || w === 6,
        mult = d < "2026-08-01" ? 0.75 : d < "2026-09-01" ? 0.88 : 1,
        plan = [];
      for (
        let i = 0, n = Math.round((we ? ri(2, 5) : ri(4, 9)) * mult);
        i < n;
        i++
      )
        plan.push(["myin", "lite"]);
      for (let i = 0, n = ri(0, 2); i < n; i++)
        if (R() < mult) plan.push(["myin", "deep"]);
      if (R() < 0.18 * mult) plan.push(["myin", "rep"]);
      if (R() < 0.3) plan.push(["edu", "ai"]);
      if (d >= "2026-08-24" && d <= "2026-08-27") {
        for (let i = 0, n = ri(2, 6); i < n; i++) plan.push(["edu", "self"]);
      }
      if (d >= "2026-09-01" && d <= "2026-09-20") {
        for (let i = 0, n = ri(0, 3); i < n; i++) plan.push(["edu", "moon"]);
      } else if (d >= "2026-09-21" && d <= "2026-09-30" && R() < 0.22)
        plan.push(["edu", "moon"]);
      for (const [b, pk] of plan) {
        if (d === TODAY && R() < 0.55) continue;
        const pr = PROD[b][pk],
          method = wpick(METHODS),
          hh = d === TODAY ? ri(0, 10) : ri(8, 23);
        seq[b]++;
        const t = {
          id: `${b === "edu" ? "EDU" : "MYIN"}-${d.replace(/-/g, "")}-${String(seq[b]).padStart(4, "0")}`,
          biz: b,
          date: d,
          time: `${pad(hh)}:${pad(ri(0, 59))}`,
          product: pr.n,
          amount: pr.p,
          method,
          status: "완료",
          cancel: 0,
          cancelDate: null,
          cust: SURN[ri(0, SURN.length - 1)] + "*" + GIV[ri(0, GIV.length - 1)],
          src: wpick(SRC[b]),
          key: Math.floor(R() * 65535)
            .toString(16)
            .padStart(4, "0"),
          approval: String(ri(10000000, 99999999)),
          issuer:
            method === "카드"
              ? ["신한", "KB국민", "삼성", "현대", "BC", "롯데"][ri(0, 5)]
              : "",
        };
        t.fee = method === "가상계좌" ? 400 : Math.round(pr.p * FEE[method]);
        if (method === "가상계좌" && d >= "2026-10-06" && R() < 0.6) {
          t.status = "입금 대기";
        } else if (R() < (b === "edu" ? 0.07 : 0.03)) {
          if (b === "edu" && R() < 0.5) {
            t.status = "부분 취소";
            t.cancel = Math.round((pr.p * 0.5) / 1000) * 1000;
          } else {
            t.status = "취소";
            t.cancel = pr.p;
          }
          t.cancelDate = addDays(d, ri(0, 3));
          if (t.cancelDate > TODAY) t.cancelDate = TODAY;
        }
        TX.push(t);
      }
    }
  })();
  const txById = (id) => TX.find((t) => t.id === id);
  const feeBack = (t) =>
    connected ? t.feeRefund??0 : t.cancel ? Math.round((t.fee * t.cancel) / t.amount) : 0;

  /* ================= 예시 데이터: 카드 ================= */
  const CARDS = [
    { id: "c12", name: "법인 공용", last: "1234", user: "담당 C" },
    { id: "c34", name: "대표", last: "3456", user: "담당 B" },
    { id: "c56", name: "광고비 전용", last: "5678", user: ACTOR },
    { id: "c78", name: "촬영·제작", last: "7890", user: "담당 G" },
  ];
  const cardOf = (id) => CARDS.find((c) => c.id === id);
  const FX = options.data?.settings?.usd_krw_estimate || 1390;
  const MER = [
    {
      m: "META PLATFORMS (FACEBK ADS)",
      card: "c56",
      fx: [180, 420],
      days: [2, 9, 16, 23, 30],
    },
    { m: "GOOGLE *ADS", card: "c56", fx: [90, 240], days: [5, 12, 19, 26] },
    { m: "VERCEL INC.", card: "c12", fx: [60, 60], days: [3], rec: true },
    { m: "SUPABASE", card: "c12", fx: [25, 25], days: [5], rec: true },
    { m: "ANTHROPIC", card: "c12", fx: [100, 100], days: [8], rec: true },
    { m: "NOTION LABS", card: "c12", fx: [40, 40], days: [12], rec: true },
    {
      m: "GOOGLE WORKSPACE",
      card: "c12",
      krw: [86400, 86400],
      days: [1],
      rec: true,
    },
    { m: "쿠팡", card: "c12", krw: [12000, 89000], n: 4 },
    { m: "다이소 강남역점", card: "c78", krw: [5000, 23000], n: 2 },
    {
      m: "교보문고",
      card: "c12",
      krw: [15000, 68000],
      n: 2,
      memos: ["콘텐츠 리서치 도서"],
    },
    {
      m: "스타벅스 역삼",
      card: "c12",
      krw: [8000, 42000],
      n: 5,
      memos: ["팀 회의", "외부 미팅 (참석 2명)"],
      past: { cat: "회의비", biz: "common" },
    },
    {
      m: "카카오T 택시",
      card: "c34",
      krw: [9000, 32000],
      n: 6,
      memos: ["미팅 이동", "촬영 장비 이동"],
    },
    {
      m: "코레일 KTX",
      card: "c34",
      krw: [59800, 59800],
      n: 2,
      memos: ["부산 출장"],
    },
    {
      m: "OO스튜디오 강남",
      card: "c78",
      krw: [220000, 330000],
      n: 2,
      need: true,
    },
    {
      m: "크몽",
      card: "c78",
      krw: [150000, 450000],
      n: 2,
      need: true,
      memos: ["썸네일 외주", "자막 외주"],
      past: { cat: "외주용역비", biz: "edu" },
    },
    {
      m: "한식당 소담",
      card: "c34",
      krw: [86000, 240000],
      n: 3,
      need: true,
      memos: ["외부 미팅 (참석 3명)", "팀 회식"],
      past: { cat: "회의비", biz: "common" },
    },
  ];
  const CR = [];
  function genCards(ym, seedv, maxDay, target) {
    const s0 = seed;
    seed = seedv;
    let k = 0;
    const dim = Number(lastDay(ym).slice(8));
    const top = Math.min(dim, maxDay || dim);
    const closed = ym < "2026-09";
    MER.forEach((t) => {
      const days = (
        t.days || Array.from({ length: t.n }, () => ri(1, dim))
      ).filter((x) => x <= top);
      days.forEach((day) => {
        k++;
        const d = ym + "-" + pad(day);
        const fx = t.fx
          ? Math.round((t.fx[0] + R() * (t.fx[1] - t.fx[0])) * 100) / 100
          : null;
        const krw = t.fx
          ? Math.round((fx * FX) / 10) * 10
          : Math.round((t.krw[0] + R() * (t.krw[1] - t.krw[0])) / 100) * 100;
        const memo =
          t.memos && (closed || R() < 0.5)
            ? t.memos[ri(0, t.memos.length - 1)]
            : "";
        (target || CR).push({
          id: `K${ym.replace("-", "")}${pad(k)}`,
          date: d,
          time: `${pad(ri(8, 22))}:${pad(ri(0, 59))}`,
          card: t.card,
          merchant: t.m,
          krw,
          fx,
          cur: t.fx ? "USD" : null,
          memo,
          need: !!t.need,
          receipt: t.need ? closed || R() < 0.35 : false,
          rec: !!t.rec,
          mcat: closed && t.past ? t.past.cat : null,
          mbiz: closed && t.past ? t.past.biz : null,
          appr: String(ri(10000000, 99999999)),
        });
      });
    });
    seed = s0;
  }
  genCards("2026-07", 7001);
  genCards("2026-08", 8001);
  genCards("2026-09", 9001);
  const CATS = [
    "광고선전비",
    "지급수수료",
    "소모품비",
    "도서인쇄비",
    "여비교통비",
    "지급임차료",
    "외주용역비",
    "회의비",
    "복리후생비",
    "접대비",
  ];
  const VATS = ["공제 예상", "불공제 예상", "해당 없음(면세)", "판단 필요"];

  /* ================= 기본값(저장 전) ================= */
  function defaultRules() {
    return [
      {
        id: "r1",
        name: "메타 광고",
        kw: ["META", "FACEBK"],
        cat: "광고선전비",
        biz: "myin",
        vat: "공제 예상",
        memo: "마이인 진단 광고",
        on: true,
      },
      {
        id: "r2",
        name: "구글 광고",
        kw: ["GOOGLE *ADS"],
        cat: "광고선전비",
        biz: "edu",
        vat: "공제 예상",
        memo: "브랜디에듀 검색 광고",
        on: true,
      },
      {
        id: "r3",
        name: "개발·업무 도구",
        kw: ["VERCEL", "SUPABASE", "ANTHROPIC", "NOTION", "GOOGLE WORKSPACE"],
        cat: "지급수수료",
        biz: "common",
        vat: "공제 예상",
        memo: "업무 도구 구독",
        on: true,
      },
      {
        id: "r4",
        name: "사무용품",
        kw: ["쿠팡", "다이소"],
        cat: "소모품비",
        biz: "common",
        vat: "공제 예상",
        memo: "사무·촬영 소품",
        on: true,
      },
      {
        id: "r5",
        name: "도서",
        kw: ["교보문고"],
        cat: "도서인쇄비",
        biz: "common",
        vat: "해당 없음(면세)",
        memo: "",
        on: true,
      },
      {
        id: "r6",
        name: "교통",
        kw: ["카카오T", "코레일"],
        cat: "여비교통비",
        biz: "common",
        vat: "불공제 예상",
        memo: "",
        on: true,
      },
      {
        id: "r7",
        name: "촬영 대관",
        kw: ["스튜디오"],
        cat: "지급임차료",
        biz: "edu",
        vat: "공제 예상",
        memo: "촬영 대관",
        on: true,
      },
    ];
  }
  const XFER = "내 통장 간 이체";
  const BANK_CATS_IN = ["토스 정산", "외부 매출", "연구비", XFER, "기타 입금"];
  const BANK_CATS_OUT = [
    "카드 대금",
    "급여",
    "4대보험",
    "임대료",
    "세무 기장료",
    "강사 정산",
    "프리랜서",
    "세금 납부",
    XFER,
    "기타 출금",
  ];
  const ACCT_USES = [
    "토스 정산 입금",
    "외부 매출 입금",
    "운영비·카드 대금",
    "급여·4대보험",
    "연구비",
    "세금·예비 적립",
    "기타",
  ];
  const BANKS = [
    "KB국민은행",
    "신한은행",
    "우리은행",
    "하나은행",
    "IBK기업은행",
    "NH농협은행",
    "토스뱅크",
    "카카오뱅크",
  ];
  const BANK_SHORT = {
    KB국민은행: "KB",
    신한은행: "신한",
    우리은행: "우리",
    하나은행: "하나",
    IBK기업은행: "IBK",
    NH농협은행: "NH",
    토스뱅크: "토스",
    카카오뱅크: "카카오",
  };
  const CONN_M = {
    kb: "은행 직접 API (KB 기업 오픈API)",
    ob: "오픈뱅킹 (금융결제원)",
    sc: "중개 API (빠른조회)",
    xl: "엑셀로만 올리기",
  };
  const CONN_D = {
    kb: "KB국민은행 기업 OpenAPI 포탈 이용 신청 · 조건·비용은 은행 문의",
    ob: "이용기관 심사 필요 · 거래내역조회 API (입금·출금·잔액·적요)",
    sc: "하이픈·코드에프 등 · 은행 '빠른조회' 가입 · 월 요금",
    xl: "KB기업뱅킹에서 거래내역 엑셀을 받아 올립니다",
  };
  function defaultAccounts() {
    return [
      {
        id: "a1",
        bank: "KB국민은행",
        name: "주거래",
        last: "",
        uses: ["토스 정산 입금", "외부 매출 입금", "운영비·카드 대금"],
        method: "xl",
        freq: "매시간",
        incl: true,
        open: 40000000,
        sample: true,
      },
      {
        id: "a2",
        bank: "KB국민은행",
        name: "인건비·연구비",
        last: "",
        uses: ["급여·4대보험", "연구비"],
        method: "xl",
        freq: "매시간",
        incl: true,
        open: 6000000,
        sample: true,
      },
    ];
  }
  function defaultBudget() {
    return [
      {
        id: "b1",
        type: "fixed",
        name: "개발·업무 도구",
        biz: "any",
        amount: 600000,
        source: "card",
        cats: ["지급수수료"],
        owner: ACTOR,
        memo: "Vercel · Supabase · Anthropic · Notion · Google Workspace",
      },
      {
        id: "b2",
        type: "fixed",
        name: "사무실 임대료",
        biz: "common",
        amount: 1500000,
        source: "bank",
        bcats: ["임대료"],
        owner: "담당 C",
        memo: "통장 자동이체",
      },
      {
        id: "b3",
        type: "fixed",
        name: "세무 기장료",
        biz: "common",
        amount: 330000,
        source: "bank",
        bcats: ["세무 기장료"],
        owner: "담당 C",
        memo: "외부 세무사",
      },
      {
        id: "b4",
        type: "variable",
        name: "광고비 · 마이인",
        biz: "myin",
        amount: 3000000,
        source: "card",
        cats: ["광고선전비"],
        owner: ACTOR,
        memo: "예시 광고 예산",
      },
      {
        id: "b5",
        type: "variable",
        name: "광고비 · 에듀",
        biz: "edu",
        amount: 2000000,
        source: "card",
        cats: ["광고선전비"],
        owner: ACTOR,
        memo: "",
      },
      {
        id: "bi",
        type: "variable",
        name: "강사 정산 (협력사)",
        biz: "edu",
        amount: 10000000,
        source: "manual",
        actual: { "2026-07": 1200000, "2026-08": 3900000, "2026-09": 15500000 },
        owner: "담당 C",
        memo: "예시 명세서 공급가액",
      },
      {
        id: "b6",
        type: "variable",
        name: "촬영·대관",
        biz: "any",
        amount: 800000,
        source: "card",
        cats: ["지급임차료"],
        owner: "담당 G",
        memo: "",
      },
      {
        id: "b7",
        type: "variable",
        name: "외주",
        biz: "any",
        amount: 1500000,
        source: "card",
        cats: ["외주용역비"],
        owner: "담당 D",
        memo: "썸네일·자막 외주",
      },
      {
        id: "b8",
        type: "variable",
        name: "회의·식대",
        biz: "any",
        amount: 500000,
        source: "card",
        cats: ["회의비", "복리후생비", "접대비"],
        owner: "담당 C",
        memo: "",
      },
      {
        id: "b9",
        type: "variable",
        name: "교통",
        biz: "any",
        amount: 300000,
        source: "card",
        cats: ["여비교통비"],
        owner: "담당 C",
        memo: "",
      },
      {
        id: "b10",
        type: "variable",
        name: "소모품·도서",
        biz: "any",
        amount: 200000,
        source: "card",
        cats: ["소모품비", "도서인쇄비"],
        owner: "담당 C",
        memo: "",
      },
      {
        id: "b11",
        type: "labor",
        name: "급여",
        biz: "common",
        amount: 12000000,
        source: "bank",
        bcats: ["급여"],
        owner: "담당 C",
        memo: "인건비·연구비 통장에서 일괄 이체 · 세전 합계",
      },
      {
        id: "b12",
        type: "labor",
        name: "4대보험 회사 부담",
        biz: "common",
        amount: 1200000,
        source: "bank",
        bcats: ["4대보험"],
        owner: "담당 C",
        memo: "",
      },
      {
        id: "b13",
        type: "labor",
        name: "프리랜서 (사업소득 3.3%)",
        biz: "any",
        amount: 2000000,
        source: "manual",
        actual: { "2026-07": 1500000, "2026-08": 2400000, "2026-09": 1800000 },
        owner: "담당 D",
        memo: "편집·디자인 프리랜서",
      },
    ];
  }
  const EXT_TYPES = {
    youtube: "유튜브",
    outsource: "외주·용역",
    lecture: "강연·교육",
    etc: "기타",
  };
  function defaultExt() {
    return [
      {
        id: "e1",
        type: "youtube",
        biz: "ba",
        title: "유튜브 애드센스 6월분",
        client: "Google AdSense",
        date: "2026-06-30",
        usd: 1180,
        supply: 0,
        vat: 0,
        due: "2026-07-21",
        invoice: "",
        memo: "브랜디액션 채널",
      },
      {
        id: "e2",
        type: "youtube",
        biz: "ba",
        title: "유튜브 애드센스 7월분",
        client: "Google AdSense",
        date: "2026-07-31",
        usd: 1320,
        supply: 0,
        vat: 0,
        due: "2026-08-21",
        invoice: "",
        memo: "브랜디액션 채널",
      },
      {
        id: "e3",
        type: "youtube",
        biz: "ba",
        title: "유튜브 애드센스 8월분",
        client: "Google AdSense",
        date: "2026-08-31",
        usd: 1410,
        supply: 0,
        vat: 0,
        due: "2026-09-21",
        invoice: "",
        memo: "브랜디액션 채널",
      },
      {
        id: "e4",
        type: "lecture",
        biz: "edu",
        title: "A사 임직원 AI 교육",
        client: "A사",
        date: "2026-08-20",
        usd: null,
        supply: 3000000,
        vat: 300000,
        due: "2026-09-04",
        invoice: "8/20 발행",
        memo: "2회차",
      },
      {
        id: "e5",
        type: "youtube",
        biz: "ba",
        title: "유튜브 애드센스 9월분",
        client: "Google AdSense",
        date: "2026-09-30",
        usd: 1290,
        supply: 0,
        vat: 0,
        due: "2026-10-21",
        invoice: "",
        memo: "10/3경 확정",
      },
      {
        id: "e6",
        type: "outsource",
        biz: "ba",
        title: "B사 브랜딩 워크숍",
        client: "B사",
        date: "2026-09-25",
        usd: null,
        supply: 2000000,
        vat: 200000,
        due: "2026-10-15",
        invoice: "9/25 발행",
        memo: "",
      },
    ];
  }
  function defaultRefunds() {
    const t = TX.find(
      (x) =>
        x.biz === "edu" &&
        x.product === "문샷 챌린지 4기" &&
        x.status === "완료" &&
        x.date >= "2026-09-10",
    );
    return t
      ? {
          [t.id]: {
            amount: 445000,
            type: "부분",
            by: "담당 E",
            at: "10/6 16:20",
            reason: "고객 요청 · 개인 사정 (3주차, 진도 18%)",
            state: "승인 대기",
          },
        }
      : {};
  }

  /* ================= 저장소 ================= */

  let DB = {};
  function freshDB() {
    return {
      v: 6,
      bankRules: [],
      rules: defaultRules(),
      budget: defaultBudget(),
      ext: defaultExt(),
      ov: {},
      bov: {},
      refunds: defaultRefunds(),
      po: {},
      owners: {},
      recState: {},
      oct: false,
      synced: false,
      accounts: defaultAccounts(),
      netRnd: false,
    };
  }
  function load() {
    DB = freshDB();
  }
  function snapshot() { return structuredClone({DB,TX,CR,CARDS,BANK}); }
  function hydrate(data) {
    DB = structuredClone(data.DB);
    TX.splice(0,TX.length,...structuredClone(data.TX));
    CR.splice(0,CR.length,...structuredClone(data.CR));
    CARDS.splice(0,CARDS.length,...structuredClone(data.CARDS));
    BANK=structuredClone(data.BANK);
  }
  let lastSaved;
  async function command(name,input={},file) {
    if(saving)throw new Error("저장 중입니다. 잠시 기다려 주세요.");
    saving=true;root?.setAttribute("aria-busy","true");
    try {liveData=await options.command(name,input,file);hydrate(liveData);lastSaved=snapshot();rebuild();}
    finally {saving=false;root?.removeAttribute("aria-busy");}
  }
  async function save() {
    if (!connected) { options.onChange?.(); return; }
    if(saving)throw new Error("저장 중입니다. 잠시 기다려 주세요.");
    saving=true;
    root?.setAttribute("aria-busy","true");
    try {
      const next=await options.onChange(lastSaved,snapshot());
      if(next){liveData=next;hydrate(next);rebuild();}
      lastSaved=snapshot();
    } catch(error) {
      hydrate(lastSaved);
      throw error;
    } finally {saving=false;root?.removeAttribute("aria-busy");}
  }
  load();
  function cardUntil() {
    return CR.reduce(
      (latest, r) => (r.date > latest ? r.date : latest),
      connected ? "" : "2026-09-30",
    );
  }
  if (DB.oct) genCards("2026-10", 10001, 6);

  /* ================= 카드 분류 ================= */
  function ruleFor(r) {
    return DB.rules.find(
      (x) =>
        x.on &&
        x.kw.some(
          (k) => k && r.merchant.toUpperCase().includes(k.toUpperCase()),
        ),
    );
  }
  function cls(r) {
    const o = DB.ov[r.id] || {};
    const rule = ruleFor(r);
    const manualCat = "cat" in o ? o.cat : r.mcat;
    const manualBiz = "biz" in o ? o.biz : r.mbiz;
    const cat = "cat" in o ? o.cat : manualCat || (rule ? rule.cat : null);
    const biz = "biz" in o ? o.biz : manualBiz || (rule ? rule.biz : null);
    const vat = r.cur
      ? "해당 없음(해외)"
      : o.vat || (rule && !manualCat ? rule.vat : "판단 필요");
    const memo = "memo" in o ? o.memo : r.memo || (rule ? rule.memo : "");
    const receipt = "receipt" in o ? o.receipt : r.receipt;
    return {
      cat,
      biz,
      vat,
      memo,
      receipt,
      rule: manualCat ? null : rule ? rule.name : null,
    };
  }
  function crState(r) {
    if(r.canceled)return "취소";
    const c = cls(r);
    return !c.cat
      ? "미분류"
      : !c.memo
        ? "메모 필요"
        : ["지급임차료", "외주용역비", "접대비"].includes(c.cat) && !c.receipt
          ? "영수증 필요"
          : "완료";
  }
  const CR_KIND = {
    취소:"none",
    미분류: "bad",
    "메모 필요": "warn",
    "영수증 필요": "warn",
    완료: "good",
  };

  /* ================= 토스 정산 ================= */
  let ST = [],
    PO = [];
  const ANOM = {};
  function rebuild() {
    if(connected){ST=liveData.ST;PO=liveData.PO;return;}
    Object.entries(DB.refunds).forEach(([id, q]) => {
      if (q.state === "승인 · 취소됨") {
        const t = txById(id);
        if (t && !t.cancel) {
          t.status = q.type === "전액" ? "취소" : "부분 취소";
          t.cancel = q.amount;
          t.cancelDate = q.date || TODAY;
        }
      }
    });
    ST = [];
    TX.forEach((t) => {
      if (t.status === "입금 대기") return;
      ST.push({
        tx: t,
        biz: t.biz,
        sold: t.date,
        amount: t.amount,
        fee: t.fee,
        pay: addBiz(t.date, 3),
      });
      if (t.cancel) {
        ST.push({
          tx: t,
          biz: t.biz,
          sold: t.cancelDate,
          amount: -t.cancel,
          fee: -feeBack(t),
          pay: addBiz(t.cancelDate, 3),
          cancel: true,
        });
      }
    });
    const m = {};
    ST.forEach((e) => {
      const k = e.biz + "|" + e.pay;
      (m[k] = m[k] || {
        id: "P" + e.biz + e.pay.replace(/-/g, ""),
        biz: e.biz,
        pay: e.pay,
        items: [],
      }).items.push(e);
    });
    PO = Object.values(m).map((p) => {
      p.amount = sum(p.items, (e) => e.amount);
      p.fee = sum(p.items, (e) => e.fee);
      p.supply = Math.round(p.fee / 1.1);
      p.vat = p.fee - p.supply;
      p.payout = p.amount - p.fee;
      const so = p.items.map((e) => e.sold).sort();
      p.soldFrom = so[0];
      p.soldTo = so[so.length - 1];
      p.count = p.items.length;
      return p;
    });
    PO.sort((a, b) =>
      a.pay < b.pay ? -1 : a.pay > b.pay ? 1 : a.biz < b.biz ? -1 : 1,
    );
    if (!ANOM.miss) {
      const a = PO.find(
        (p) =>
          p.biz === "myin" && p.pay >= "2026-10-02" && p.pay <= "2026-10-06",
      );
      const b = PO.find((p) => p.biz === "edu" && p.pay >= "2026-09-15");
      ANOM.miss = a && a.id;
      ANOM.diff = b && b.id;
    }
    PO.forEach((p) => {
      if (p.pay > TODAY) {
        p.state = "지급 예정";
        p.bank = null;
      } else if (p.pay === TODAY && !DB.synced) {
        p.state = "입금 대기";
        p.bank = null;
      } else if (p.id === ANOM.miss) {
        p.state = "미확인";
        p.bank = null;
      } else if (p.id === ANOM.diff) {
        p.state = "금액 다름";
        p.bank = p.payout - 12300;
      } else {
        p.state = "입금 확인";
        p.bank = p.payout;
      }
      if (DB.po[p.id] && (p.state === "미확인" || p.state === "금액 다름")) {
        p.note = DB.po[p.id];
        p.state = "사유 기록";
      }
    });
  }
  rebuild();
  const PO_KIND = {
    "입금 확인": "good",
    미확인: "bad",
    "금액 다름": "bad",
    "입금 대기": "none",
    "지급 예정": "acc",
    "사유 기록": "good",
  };
  const refundPending = () =>
    Object.keys(DB.refunds).filter((k) => DB.refunds[k].state === "승인 대기");

  /* ================= 강사 정산: 예산 관리 '강사 정산' 항목에 매달 직접 입력 ================= */
  const payDateFor = (ym, day) => nextBiz(`${nextYm(ym)}-${pad(day || 10)}`);

  /* ================= 통장 (KB국민은행 · 여러 통장) ================= */
  let BANK = [];
  (function genBank() {
    const s0 = seed;
    seed = 4242;
    const rows = [];
    const add = (date, time, desc, inn, out, cat, link, acct) =>
      rows.push({
        date,
        time,
        desc,
        in: inn,
        out,
        cat,
        link: link || null,
        acct: acct || "a1",
      });
    const rt = () => `${pad(ri(9, 15))}:${pad(ri(0, 59))}`;
    PO.forEach((p) => {
      if (p.pay > TODAY || p.id === ANOM.miss) return;
      const amt = p.id === ANOM.diff ? p.payout - 12300 : p.payout;
      add(
        p.pay,
        p.pay === TODAY ? "10:35" : rt(),
        `토스페이먼츠 ${BIZ[p.biz].short}`,
        amt,
        0,
        "토스 정산",
        { type: "po", id: p.id },
      );
    });
    const yt = {
      e1: ["2026-07-21", 1372],
      e2: ["2026-08-21", 1385],
      e3: ["2026-09-21", 1368],
    };
    const dx = defaultExt();
    Object.entries(yt).forEach(([id, [d, rate]]) => {
      const e = dx.find((x) => x.id === id);
      add(
        d,
        "08:12",
        "GOOGLE ASIA PACIFIC",
        Math.round((e.usd * rate) / 10) * 10,
        0,
        "외부 매출",
        { type: "ext", id },
      );
    });
    add("2026-09-04", "11:20", "A사", 3300000, 0, "외부 매출", {
      type: "ext",
      id: "e4",
    });
    add("2026-10-02", "14:05", "(주)씨디미디어", 1650000, 0, "미분류");
    add("2026-09-18", "16:40", "김*수", 0, 250000, "미분류");
    const cardTot = (ym) =>
      sum(
        CR.filter((x) => x.date.startsWith(ym)),
        (x) => x.krw,
      );
    add("2026-07-14", "09:01", "KB국민카드 대금", 0, 4200000, "카드 대금");
    add(
      "2026-08-14",
      "09:01",
      "KB국민카드 대금",
      0,
      cardTot("2026-07"),
      "카드 대금",
    );
    add(
      "2026-09-14",
      "09:01",
      "KB국민카드 대금",
      0,
      cardTot("2026-08"),
      "카드 대금",
    );
    [
      ["2026-07-24", 12000000],
      ["2026-08-25", 12000000],
      ["2026-09-23", 12000000],
    ].forEach(([d, a]) =>
      add(d, "10:00", "급여 일괄이체", 0, a, "급여", null, "a2"),
    );
    [
      ["2026-07-10", 1180000],
      ["2026-08-10", 1180000],
      ["2026-09-10", 1195000],
    ].forEach(([d, a]) =>
      add(d, "09:30", "국민건강보험공단", 0, a, "4대보험", null, "a2"),
    );
    add(
      "2026-07-16",
      "10:20",
      "연구비 1차 입금",
      30000000,
      0,
      "연구비",
      null,
      "a2",
    );
    [
      ["2026-07-22", 5000000, "t1"],
      ["2026-08-24", 8000000, "t2"],
      ["2026-09-22", 8000000, "t3"],
    ].forEach(([d, a, k]) => {
      add(
        d,
        "16:00",
        "인건비·연구비 통장으로",
        0,
        a,
        XFER,
        { type: "xfer", pair: k },
        "a1",
      );
      add(
        d,
        "16:00",
        "주거래 통장에서",
        a,
        0,
        XFER,
        { type: "xfer", pair: k },
        "a2",
      );
    });
    add("2026-10-06", "15:10", "브랜디액션", 0, 3000000, "미분류", null, "a1");
    add("2026-10-06", "15:10", "브랜디액션", 3000000, 0, "미분류", null, "a2");
    ["2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].forEach((d) =>
      add(d, "09:00", "OO빌딩 임대료", 0, 1500000, "임대료"),
    );
    ["2026-07-15", "2026-08-14", "2026-09-15"].forEach((d) =>
      add(d, "11:00", "OO세무회계", 0, 330000, "세무 기장료"),
    );
    [
      ["2026-07", 1320000],
      ["2026-08", 4290000],
    ].forEach(([ym, a]) =>
      add(
        payDateFor(ym, 10),
        "14:00",
        `협력사 RS정산 ${mLabel(ym)}분`,
        0,
        a,
        "강사 정산",
        null,
      ),
    );
    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const cnt2 = {};
    rows.forEach((r) => {
      cnt2[r.date] = (cnt2[r.date] || 0) + 1;
      r.id = `B${r.date.replace(/-/g, "")}${pad(cnt2[r.date])}`;
    });
    const pr = {};
    rows.forEach((r) => {
      if (r.link && r.link.pair)
        (pr[r.link.pair] = pr[r.link.pair] || []).push(r);
    });
    Object.values(pr).forEach(([a, b]) => {
      a.link = { type: "xfer", id: b.id };
      b.link = { type: "xfer", id: a.id };
    });
    BANK = rows;
    seed = s0;
  })();
  if(connected){hydrate(liveData);lastSaved=snapshot();rebuild();}
  const SYNC_LABEL = () => connected ? "저장된 내역" : (DB.synced ? "10/7 11:00" : "10/7 10:00");
  const acctOf = (id) => DB.accounts.find((a) => a.id === id);
  const acctName = (id) => {
    const a = acctOf(id);
    return a ? a.name : "지운 통장";
  };
  const acctIncl = (id) => {
    const a = acctOf(id);
    return !!a && a.incl !== false;
  };
  function bankRows() {
    const ids = new Set(DB.accounts.map((a) => a.id));
    const vis = BANK.filter(
      (r) =>
        ids.has(r.acct) &&
        (connected || !(r.date === TODAY && r.time > "10:00" && !DB.synced)),
    ).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const bal = {};
    DB.accounts.forEach((a) => (bal[a.id] = connected?a.open??null:a.open||0));
    return vis.map((r) => {
      const o = DB.bov[r.id] || {};
      const rule = DB.bankRules.find(
        (x) =>
          x.on &&
          (x.direction === "in") === r.in > 0 &&
          r.desc.toLowerCase().includes(x.keyword.toLowerCase()),
      );
      const payout=connected?liveData.PO.find(p=>p.bankIds?.includes(r.id)):null;
      const link = "link" in o ? o.link : r.link || (payout?{type:"po",id:payout.id}:null);
      const linkedCategory=connected?({po:"토스 정산",ext:"외부 매출",xfer:XFER})[link?.type]:null;
      const cat = linkedCategory ?? o.cat ?? (r.cat === "미분류" && payout ? "토스 정산" : r.cat === "미분류" && rule ? rule.cat : r.cat);
      if(bal[r.acct]!==null)bal[r.acct] += r.in - r.out;
      if(connected && r.balance != null)bal[r.acct]=r.balance;
      return { ...r, cat, link, bal: bal[r.acct] };
    });
  }
  /* 순수익·예산은 '계산에 넣기'를 켠 통장만 */
  const netBank = () => bankRows().filter((x) => acctIncl(x.acct) && x.link?.type!=="xfer" && x.cat!==XFER);
  function acctBal(id) {
    const a = acctOf(id);
    const rs = bankRows().filter((x) => x.acct === id);
    return rs.length ? rs[rs.length - 1].bal : a?.open??null;
  }
  /* 같은 날(±1일) 같은 금액이 한 통장에서 나가고 다른 통장으로 들어온 미분류 거래 → 내 통장 간 이체 후보 */
  function pairCands() {
    const rs = bankRows().filter(
      (x) => (x.cat === "미분류" || !x.cat || x.cat === XFER) && !x.link,
    );
    const out = [],
      used = new Set();
    rs.filter((x) => x.out > 0).forEach((o) => {
      const m = rs.find(
        (i) =>
          i.in === o.out &&
          i.acct !== o.acct &&
          !used.has(i.id) &&
          Math.abs(diffDays(o.date, i.date)) <= 1,
      );
      if (m) {
        used.add(m.id);
        out.push([o, m]);
      }
    });
    return out;
  }
  const extPaidRow = (id) =>
    bankRows().find((r) => r.link && r.link.type === "ext" && r.link.id === id);

  /* ================= 외부 매출 ================= */
  function extInfo(e) {
    const r = extPaidRow(e.id);
    const total =
      e.type === "youtube"
        ? r
          ? r.in
          : Math.round(((e.usd || 0) * FX) / 10) * 10
        : (Number(e.supply) || 0) + (Number(e.vat) || 0);
    const state = r
      ? "입금 확인"
      : e.due && e.due < TODAY
        ? "입금 지남"
        : "입금 예정";
    return {
      total,
      est: e.type === "youtube" && !r,
      state,
      paid: r ? r.date : null,
      row: r,
    };
  }
  const EXT_KIND = {
    "입금 확인": "good",
    "입금 예정": "acc",
    "입금 지남": "bad",
  };

  /* ================= 조회 기간 ================= */
  const P = {
    mode: "month",
    month: "2026-09",
    from: "2026-09-01",
    to: "2026-09-30",
    err: "",
  };
  if(connected){
    const dates=[...TX.map(x=>x.date),...CR.map(x=>x.date),...BANK.map(x=>x.date),...DB.ext.map(x=>x.date)].filter(Boolean).sort();
    const first=(dates[0]||TODAY).slice(0,7);MONTHS.length=0;
    for(let month=first;month<=TODAY.slice(0,7)&&MONTHS.length<600;month=nextYm(month))MONTHS.push(month);
    const previous=dstr(new Date(Date.UTC(Number(TODAY.slice(0,4)),Number(TODAY.slice(5,7))-1,0))).slice(0,7);
    if(!MONTHS.includes(previous))MONTHS.unshift(previous);
    P.month=Number(TODAY.slice(8))<=7?previous:TODAY.slice(0,7);
    if(!MONTHS.includes(P.month))MONTHS.unshift(P.month);
    P.from=P.month+"-01";P.to=lastDay(P.month);
  }
  function range() {
    if (P.mode === "month")
      return [
        P.month + "-01",
        lastDay(P.month) < TODAY ? lastDay(P.month) : TODAY,
      ];
    if (P.mode === "week") return [addDays(TODAY, -6), TODAY];
    if (P.mode === "all") return [DATA_START, TODAY];
    return [P.from, P.to];
  }
  const inR = (d, r) => d >= r[0] && d <= r[1];
  /* 외부 매출은 매출일이 앞으로인 건(계약·발행 예정)도 보여 준다 */
  function rangeX() {
    const r = range();
    if (P.mode === "month") return [P.month + "-01", lastDay(P.month)];
    if (P.mode === "all") return [r[0], "9999-12-31"];
    return r;
  }
  function prevRange() {
    const [a, b] = range();
    if (P.mode === "all") return null;
    if (P.mode === "month") {
      const i = MONTHS.indexOf(P.month);
      if (i <= 0) return null;
      const pm = MONTHS[i - 1];
      const pe = addDays(pm + "-01", diffDays(a, b));
      return [
        pm + "-01",
        P.month < TODAY.slice(0, 7)
          ? lastDay(pm)
          : pe > lastDay(pm)
            ? lastDay(pm)
            : pe,
      ];
    }
    const len = diffDays(a, b) + 1;
    const pa = addDays(a, -len),
      pb = addDays(a, -1);
    return pa < DATA_START ? null : [pa, pb];
  }
  function rLabel(r) {
    r = r || range();
    return r[0] === r[1] ? md(r[0]) : `${md(r[0])} – ${md(r[1])}`;
  }
  function periodCtl(basis) {
    const i = MONTHS.indexOf(P.month);
    return `<div class="pctl" role="group" aria-label="조회 기간">
   <div class="seg">${[
     ["month", "월별"],
     ["week", "최근 7일"],
     ["all", "전체"],
     ["custom", "기간 설정"],
   ]
     .map(
       ([v, l]) =>
         `<button class="seg-b" data-act="pmode" data-v="${v}" aria-pressed="${P.mode === v}">${l}</button>`,
     )
     .join("")}</div>
   ${
     P.mode === "month"
       ? `<div class="mpick"><button class="btn sm icon" data-act="pstep" data-v="-1" aria-label="이전 달" ${i <= 0 ? "disabled" : ""}>‹</button><select class="sel" id="pmonth" data-change="pmonth" aria-label="월 선택">${[
           ...MONTHS,
         ]
           .reverse()
           .map(
             (m) =>
               `<option value="${m}" ${m === P.month ? "selected" : ""}>${ymLabel(m)}${m === TODAY.slice(0,7) ? " (진행 중)" : ""}</option>`,
           )
           .join(
             "",
           )}</select><button class="btn sm icon" data-act="pstep" data-v="1" aria-label="다음 달" ${i >= MONTHS.length - 1 ? "disabled" : ""}>›</button></div>`
       : ""
   }
   ${P.mode === "custom" ? `<div class="crange"><label class="vh" for="pfrom">시작일</label><input type="date" id="pfrom" value="${P.from}" min="${DATA_START}" max="${TODAY}"><span class="muted">–</span><label class="vh" for="pto">종료일</label><input type="date" id="pto" value="${P.to}" min="${DATA_START}" max="${TODAY}"><button class="btn sm pri" data-act="papply">조회</button>${P.err ? `<span class="perr" role="alert">${P.err}</span>` : ""}</div>` : ""}
   <span class="prange"><b>${rLabel()}</b> · ${basis} 기준</span></div>`;
  }
  let BIZF = "all";
  function bizChips() {
    return `<div class="chips" role="group" aria-label="사업">${chip("biz", "all", "전체 사업", BIZF === "all")}${chip("biz", "edu", bz("edu"), BIZF === "edu")}${chip("biz", "myin", bz("myin"), BIZF === "myin")}${chip("biz", "hm", bz("hm"), BIZF === "hm")}</div>`;
  }
  const bizOk = (b) => BIZF === "all" || BIZF === b;
  function delta(cur, prev, upGood, label) {
    if (BLANK || prev == null || !prev) return "";
    const r = (cur - prev) / Math.abs(prev);
    if (!isFinite(r)) return "";
    const up = r >= 0,
      good = up === upGood;
    return `<span class="${good ? "up" : "dn"}">${up ? "▲" : "▼"} ${(Math.abs(r) * 100).toFixed(1).replace(/\.0$/, "")}%</span> <span class="muted">${label}</span>`;
  }

  /* ================= 차트 ================= */
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function salesChart(r) {
    if (BLANK) return `<div class="chart-empty">금액을 숨긴 상태입니다.</div>`;
    const days = diffDays(r[0], r[1]) + 1,
      weekly = days > 45,
      out = [];
    for (let d = r[0]; d <= r[1]; d = addDays(d, weekly ? 7 : 1)) {
      const e = weekly ? (addDays(d, 6) > r[1] ? r[1] : addDays(d, 6)) : d;
      out.push({
        a: d,
        b: e,
        lab: weekly ? `${mdS(d)}주` : mdS(d),
        tip: weekly ? `${md(d)} – ${md(e)}` : md(d),
        myin: 0,
        edu: 0,
      });
    }
    TX.forEach((t) => {
      if (t.status === "입금 대기" || !inR(t.date, r) || !bizOk(t.biz)) return;
      const k = out.find((x) => t.date >= x.a && t.date <= x.b);
      if (k) k[t.biz] += t.amount;
    });
    const W = 760,
      H = 230,
      L = 52,
      Rm = 10,
      T = 12,
      Bm = 26,
      iw = W - L - Rm,
      ih = H - T - Bm;
    const max = Math.max(...out.map((x) => x.myin + x.edu), 1),
      step = niceStep(max / 4),
      top = Math.ceil(max / step) * step;
    const y = (v) => T + ih - (v / top) * ih,
      band = iw / out.length,
      bw = Math.min(weekly ? 28 : 16, band * 0.62);
    let g = "";
    for (let v = 0; v <= top; v += step) {
      g += `<line class="g" x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? "0" : (v / 1e4).toLocaleString("ko-KR") + "만"}</text>`;
    }
    const rt = (x, yy, w, h, rr) => {
      rr = Math.min(rr, h, w / 2);
      return `M${x},${yy + h}V${yy + rr}Q${x},${yy} ${x + rr},${yy}H${x + w - rr}Q${x + w},${yy} ${x + w},${yy + rr}V${yy + h}Z`;
    };
    const every = Math.max(1, Math.ceil(out.length / 8));
    let bars = "",
      hits = "",
      xl = "";
    out.forEach((d, i) => {
      const x = L + i * band + (band - bw) / 2,
        tot = d.myin + d.edu;
      if (d.myin > 0) {
        const h = (ih * d.myin) / top;
        bars +=
          d.edu > 0
            ? `<rect class="s1" x="${x}" y="${y(d.myin)}" width="${bw}" height="${h}"/>`
            : `<path class="s1" d="${rt(x, y(d.myin), bw, h, 4)}"/>`;
      }
      if (d.edu > 0) {
        const h = (ih * d.edu) / top,
          gap = d.myin > 0 ? 2 : 0;
        bars += `<path class="s2" d="${rt(x, y(tot), bw, Math.max(h - gap, 1), 4)}"/>`;
      }
      const tip = `<b>${d.tip}</b><div class="tr"><span>마이인 진단</span><span>${won(d.myin)}</span></div><div class="tr"><span>브랜디에듀</span><span>${won(d.edu)}</span></div><div class="tr"><span>합계</span><b>${won(tot)}</b></div>`;
      hits += `<rect class="hit" x="${L + i * band}" y="${T}" width="${band}" height="${ih}" tabindex="0" aria-label="${d.tip} 합계 ${tot.toLocaleString("ko-KR")}원" data-tip="${esc(tip)}"/>`;
      if (i % every === 0)
        xl += `<text class="ax" x="${L + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${d.lab}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${weekly ? "주별" : "일별"} 결제 금액">${g}<line class="base" x1="${L}" x2="${W - Rm}" y1="${y(0)}" y2="${y(0)}"/>${bars}${xl}${hits}</svg>`;
  }
  function netChart(rows) {
    /* [{ym,net,partial}] */
    if (BLANK)
      return `<div class="chart-empty" style="height:180px">금액을 숨긴 상태입니다.</div>`;
    const W = 420,
      H = 200,
      L = 64,
      Rm = 10,
      T = 20,
      Bm = 26,
      iw = W - L - Rm,
      ih = H - T - Bm;
    const mx = Math.max(...rows.map((r) => r.net), 0),
      mn = Math.min(...rows.map((r) => r.net), 0);
    const step = niceStep(Math.max(mx - mn, 1) / 4),
      top = Math.ceil(mx / step) * step,
      bot = Math.floor(mn / step) * step,
      span = top - bot || 1;
    const y = (v) => T + ih - ((v - bot) / span) * ih,
      band = iw / rows.length,
      bw = Math.min(36, band * 0.5);
    let g = "";
    for (let v = bot; v <= top; v += step) {
      g += `<line class="g" x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? "0" : (v / 1e4).toLocaleString("ko-KR") + "만"}</text>`;
    }
    let bars = "",
      lab = "",
      hits = "";
    rows.forEach((r, i) => {
      const x = L + i * band + (band - bw) / 2,
        y0 = y(0),
        y1 = y(r.net),
        h = Math.max(1, Math.abs(y1 - y0));
      const cls = r.partial ? "part" : r.net < 0 ? "neg" : "pos";
      const yy = r.net >= 0 ? y1 : y0;
      bars += `<rect class="${cls}" x="${x}" y="${yy}" width="${bw}" height="${h}" rx="3"/>`;
      lab += `<text class="vl" x="${x + bw / 2}" y="${r.net >= 0 ? y1 - 6 : y1 + 14}" text-anchor="middle">${man(r.net).replace(/<[^>]+>/g, "")}</text><text class="ax" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${mLabel(r.ym)}${r.partial ? " (진행 중)" : ""}</text>`;
      hits += `<rect class="hit" x="${L + i * band}" y="${T}" width="${band}" height="${ih}" tabindex="0" aria-label="${mLabel(r.ym)} 순수익 ${Math.round(r.net).toLocaleString("ko-KR")}원" data-tip="${esc(`<b>${ymLabel(r.ym)}${r.partial ? " · 진행 중" : ""}</b><div class="tr"><span>들어온 돈</span><span>${won(r.inn)}</span></div><div class="tr"><span>비용</span><span>${won(-r.cost)}</span></div><div class="tr"><span>순수익</span><b>${won(r.net)}</b></div>`)}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 순수익">${g}<line class="base" x1="${L}" x2="${W - Rm}" y1="${y(0)}" y2="${y(0)}"/>${bars}${lab}${hits}</svg>`;
  }
  function hbars(items) {
    if (BLANK)
      return `<div class="chart-empty" style="height:140px">금액을 숨긴 상태입니다.</div>`;
    if (!items.length)
      return `<div class="empty">이 기간 카드 지출이 없습니다.</div>`;
    const max = Math.max(...items.map((i) => i.v), 1);
    return items
      .map(
        (i) =>
          `<div class="hbar"><span>${i.l}</span><div><div class="fl" style="width:${Math.max(0.5, (i.v / max) * 100)}%"></div></div><span class="v">${won(i.v)}</span></div>`,
      )
      .join("");
  }

  /* ================= 월 순수익 ================= */
  let BM = connected?P.month:"2026-09";
  function budgetMonth(ym) {
    const r = [ym + "-01", lastDay(ym)],
      cu = cardUntil(),
      cardOk = r[0] <= cu;
    const rows = CR.filter((x) => !x.canceled && inR(x.date, r)),
      brows = netBank().filter((x) => inR(x.date, r));
    const hits = {};
    const items = DB.budget.map((b) => {
      let act = null,
        n = 0;
      if (b.source === "card") {
        if (cardOk) {
          const m = rows.filter((x) => {
            const c = cls(x);
            return (
              c.cat &&
              (b.cats || []).includes(c.cat) &&
              (b.biz === "any" || c.biz === b.biz)
            );
          });
          m.forEach((x) => {
            (hits[x.id] = hits[x.id] || []).push(b.id);
          });
          act = sum(m, (x) => x.krw);
          n = m.length;
        }
      } else if (b.source === "bank") {
        const m = brows.filter(
          (x) => x.out > 0 && (b.bcats || []).includes(x.cat),
        );
        act = m.length || ym < TODAY.slice(0, 7) ? sum(m, (x) => x.out) : null;
        n = m.length;
        if (ym === TODAY.slice(0, 7) && !m.length) act = null;
      } else {
        act = b.actual && b.actual[ym] != null ? b.actual[ym] : null;
      }
      return { ...b, act, n };
    });
    const unc = rows.filter((x) => !cls(x).cat),
      matched = new Set(Object.keys(hits)),
      unassigned = rows.filter((x) => cls(x).cat && !matched.has(x.id)),
      dup = Object.entries(hits).filter(([, v]) => v.length > 1);
    const bOut = brows.filter((x) => x.out > 0),
      bUnc = bOut.filter((x) => x.cat === "미분류" || !x.cat);
    return {
      ym,
      items,
      cardOk,
      cu,
      unc,
      unassigned,
      dup,
      partial: cardOk && r[1] > cu,
      bUnc,
    };
  }
  function netOf(ym) {
    const r = [ym + "-01", lastDay(ym)],
      br = netBank().filter((x) => inR(x.date, r));
    const toss = sum(
        br.filter((x) => x.cat === "토스 정산"),
        (x) => x.in,
      ),
      ext = sum(
        br.filter((x) => x.cat === "외부 매출"),
        (x) => x.in,
      ),
      rnd = sum(
        br.filter((x) => x.cat === "연구비"),
        (x) => x.in,
      );
    const M = budgetMonth(ym);
    const by = (t) =>
      sum(
        M.items.filter((b) => b.type === t && b.act != null),
        (b) => b.act,
      );
    const fixed = by("fixed"),
      variable = by("variable"),
      labor = by("labor");
    const inn = toss + ext + (DB.netRnd ? rnd : 0),
      cost = fixed + variable + labor;
    const missing = M.items.filter((b) => b.act == null).length;
    const poIssue = PO.filter(
      (p) =>
        p.pay.startsWith(ym) &&
        (p.state === "미확인" || p.state === "금액 다름"),
    );
    return {
      ym,
      toss,
      ext,
      rnd,
      inn,
      fixed,
      variable,
      labor,
      cost,
      net: inn - cost,
      missing,
      poIssue,
      partial: ym >= TODAY.slice(0, 7),
      M,
    };
  }

  /* ================= 화면: 개요 ================= */
  const txIn = (r) =>
    TX.filter(
      (t) => inR(t.date, r) && bizOk(t.biz) && t.status !== "입금 대기",
    );
  const cancelsIn = (r) => connected
    ? TX.filter(t=>bizOk(t.biz)).flatMap(t=>(t.cancelEvents||[]).filter(c=>inR(c.date,r)).map(c=>({...t,cancel:c.amount,cancelDate:c.date,feeRefund:c.feeRefund})))
    : TX.filter((t) => t.cancel && inR(t.cancelDate, r) && bizOk(t.biz));
  const extIn = (r) =>
    DB.ext.filter((e) => inR(e.date, r) && (BIZF === "all" || e.biz === BIZF));
  function vOverview() {
    const r = range(),
      pr = prevRange();
    const prl = !pr
      ? ""
      : P.mode === "month"
        ? "전월 같은 기간 대비"
        : `직전 ${diffDays(r[0], r[1]) + 1}일 대비`;
    const tx = txIn(r),
      cn = cancelsIn(r),
      gross = sum(tx, (t) => t.amount),
      canc = sum(cn, (t) => t.cancel),
      fee = sum(tx, (t) => t.fee) - sum(cn, (t) => feeBack(t));
    const feeKnown=!connected||(!tx.some(t=>!t.feeKnown)&&!cn.some(t=>t.feeRefund==null));
    const ex = extIn(r),
      exT = sum(ex, (e) => extInfo(e).total);
    const ptx = pr ? txIn(pr) : null,
      pg = pr
        ? sum(ptx, (t) => t.amount) -
          sum(cancelsIn(pr), (t) => t.cancel) +
          sum(extIn(pr), (e) => extInfo(e).total)
        : null;
    const net = gross - canc + exT;
    const br = netBank().filter((x) => inR(x.date, r)),
      inn = sum(
        br.filter(
          (x) =>
            x.cat === "토스 정산" ||
            x.cat === "외부 매출" ||
            (DB.netRnd && x.cat === "연구비"),
        ),
        (x) => x.in,
      );
    const ym = TODAY.slice(0, 7),
      lastM = MONTHS[MONTHS.indexOf(ym) - 1],
      nl = netOf(lastM),
      nc = netOf(ym);
    const byBiz = ["edu", "myin"].filter(bizOk).map((b) => {
      const a = tx.filter((x) => x.biz === b),
        c = cn.filter((x) => x.biz === b),
        am = a.map((x) => x.amount);
      return {
        b,
        n: a.length,
        g: sum(a, (x) => x.amount),
        c: sum(c, (x) => x.cancel),
        med: median(am),
        lo: am.length ? Math.min(...am) : 0,
        hi: am.length ? Math.max(...am) : 0,
      };
    });
    const exBy = {};
    ex.forEach((e) => {
      const k = e.type;
      exBy[k] = exBy[k] || { n: 0, t: 0 };
      exBy[k].n++;
      exBy[k].t += extInfo(e).total;
    });
    return (
      head(
        "개요",
        "PG 토스페이먼츠(상점 3곳) · 외부 매출 · KB국민은행 · KB국민카드",
        `<button class="btn sm" data-act="csv" data-v="sales">CSV 내보내기</button>`,
      ) +
      `<div class="fresh">${(connected?[
        [(DB.tossSync||[]).length?"good":"none","토스페이먼츠",(DB.tossSync||[]).length?"수동 수집 원장 · 기간별 수집 상태는 위에서 확인":"자동 수집 미연결 · 저장된 내역만 조회"],
        [BANK.length?"good":"none",`통장 ${DB.accounts.length}개`,BANK.length?`${BANK.length}건 저장됨 · 자동 연결 미설정`:"가져온 내역 없음"],
        [CR.length?"good":"none","카드 내역",cardUntil()?`${mdS(cardUntil())} 이용분까지 저장됨`:"가져온 내역 없음"],
      ]:[
        ["good", "토스 · 에듀·마이인", "거래 06:00 · 정산 07:00"],
        ["none", "토스 · 하루멜라", "연결 전"],
        [
          "good",
          `KB국민은행 통장 ${DB.accounts.length}개`,
          `${SYNC_LABEL()} 동기화`,
        ],
        [
          DB.oct ? "good" : "warn",
          "KB국민카드",
          `${mdS(cardUntil())}까지 올림`,
        ],
      ])
        .map(
          ([k, n, s]) =>
            `<span><span class="dot ${k}" aria-hidden="true"></span><b>${n}</b><span class="muted">${s}</span></span>`,
        )
        .join("")}</div>` +
      `<div class="toolbar">${periodCtl("결제일")}</div><div class="toolbar">${bizChips()}</div>` +
      `<div style="margin-bottom:16px"><div class="tiles">
    <a class="tile" href="#sales"><span class="l">순매출 (토스 + 외부)</span><span class="v">${man(net)}</span><span class="d">${delta(net, pg, true, prl) || "결제 − 취소 + 외부 매출"}</span></a>
    <a class="tile" href="#sales"><span class="l">토스 결제</span><span class="v">${man(gross - canc)}</span><span class="d">${cnt(tx.length)}건 · 취소 ${won(-canc)}</span></a>
    <a class="tile" href="#sales" data-act="srcext"><span class="l">외부 매출</span><span class="v">${man(exT)}</span><span class="d">${cnt(ex.length)}건 · 유튜브·외주·강연</span></a>
    <a class="tile" href="#settlements"><span class="l">토스 수수료</span><span class="v">${feeKnown?man(fee):"미확인"}</span><span class="d">${feeKnown?`실효 ${gross ? pct(fee / gross) : "-"} · 부가세 포함`:"수수료 자료 수집 후 확인"}</span></a>
    <a class="tile" href="#bank"><span class="l">들어온 돈 (통장)</span><span class="v">${man(inn)}</span><span class="d">토스 정산 + 외부 매출 입금${DB.netRnd ? " + 연구비" : " · 연구비 제외"}</span></a>
   </div>
   <a class="netcard" href="#budget" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:12px 0 0;text-decoration:none;color:inherit"><div style="flex:1;min-width:200px"><span class="small muted">월 순수익 · 예산 관리</span><div style="font-size:13px;margin-top:2px">들어온 돈 − (고정비 + 변동비 + 인건비)</div></div><div><span class="small muted">${mLabel(lastM)}</span><div style="font-size:20px;font-weight:700;color:${nl.net < 0 ? "var(--bad)" : "var(--fg)"}">${man(nl.net)}</div></div><div><span class="small muted">${mLabel(ym)} 진행 중</span><div style="font-size:20px;font-weight:700;color:var(--fg-2)">${man(nc.net)}</div></div><span class="btn sm">자세히</span></a></div>` +
      (BIZF === "hm"
        ? `<div class="card"><div class="empty"><b>하루멜라는 아직 토스와 연결 전입니다</b>자체몰을 열고 상점 키를 등록하면 거래·정산이 들어옵니다.</div></div>`
        : `<div class="card" style="margin-bottom:16px"><div class="card-h"><div><h2>${diffDays(r[0], r[1]) > 45 ? "주별" : "일별"} 토스 결제 금액</h2><p class="small muted">결제일 기준 · 취소 전 · 외부 매출은 아래 표</p></div><div class="legend">${bizOk("myin") ? '<span><i style="background:var(--s1)"></i>마이인 진단</span>' : ""}${bizOk("edu") ? '<span><i style="background:var(--s2)"></i>브랜디에듀</span>' : ""}</div></div>${salesChart(r)}</div>` +
          `<div class="grid2" style="align-items:start"><div><div class="card-h"><h2>토스 결제 · 사업별</h2></div>${tbl(["사업", { t: "건수", r: 1 }, { t: "결제", r: 1 }, { t: "취소", r: 1 }, { t: "순매출", r: 1 }], byBiz.map((x) => `<tr><td>${bz(x.b)}</td><td class="r">${cnt(x.n)}</td><td class="r">${won(x.g)}</td><td class="r">${won(-x.c)}</td><td class="r"><b>${won(x.g - x.c)}</b></td></tr>`).join(""), "", "nw")}<p class="note" style="margin-top:8px">결제 1건 금액 중앙값(범위) · ${byBiz.map((x) => `${BIZ[x.b].short} ${x.n ? won(x.med) + " (" + won(x.lo) + "–" + won(x.hi) + ")" : "-"}`).join(" · ")}</p></div>
    <div><div class="card-h"><h2>외부 매출 · 종류별</h2><button class="btn sm" data-act="extadd">외부 매출 추가</button></div>${tbl(
      ["종류", { t: "건수", r: 1 }, { t: "금액", r: 1 }],
      Object.entries(exBy)
        .map(
          ([k, v]) =>
            `<tr><td>${EXT_TYPES[k]}</td><td class="r">${cnt(v.n)}</td><td class="r">${won(v.t)}</td></tr>`,
        )
        .join("") ||
        '<tr><td colspan="3"><div class="empty" style="border:0">이 기간 외부 매출이 없습니다.</div></td></tr>',
      "",
      "nw",
    )}<p class="note" style="margin-top:8px">매출일 기준 · 유튜브는 입금 전이면 예상 원화(환율 ${FX.toLocaleString("ko-KR")}원 가정)</p></div></div>`)
    );
  }

  /* ================= 화면: 매출 내역 ================= */
  const SL = {
    src: "toss",
    status: "all",
    method: "all",
    q: "",
    page: 1,
    etype: "all",
  };
  function salesRows() {
    const r = range(),
      q = SL.q.trim().toLowerCase();
    return TX.filter(
      (t) =>
        inR(t.date, r) &&
        bizOk(t.biz) &&
        (SL.status === "all" || t.status === SL.status) &&
        (SL.method === "all" || t.method === SL.method) &&
        (!q ||
          (t.id + " " + t.product + " " + t.cust).toLowerCase().includes(q)),
    ).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }
  const TX_KIND = {
    완료: "good",
    취소: "bad",
    "부분 취소": "warn",
    "입금 대기": "none",
  };
  function salesList() {
    const rows = salesRows(),
      per = 25,
      pages = Math.max(1, Math.ceil(rows.length / per));
    if (SL.page > pages) SL.page = pages;
    const pg = rows.slice((SL.page - 1) * per, SL.page * per),
      g = sum(
        rows.filter((t) => t.status !== "입금 대기"),
        (t) => t.amount,
      ),
      c = sum(rows, (t) => t.cancel);
    return (
      `<div class="sumline"><span>${cnt(rows.length)}건</span><span>결제 <b>${won(g)}</b></span><span>취소 <b>${won(-c)}</b></span><span>순매출 <b>${won(g - c)}</b></span></div><p class="note">목록은 선택 기간에 결제한 주문의 현재 취소 누계를 포함합니다. 상단 순매출은 결제·취소가 각각 발생한 날짜 기준이므로 목록 합계와 다를 수 있습니다.</p>` +
      tbl(
        [
          "결제 일시",
          "사업",
          "상품",
          "결제수단",
          { t: "금액", r: 1 },
          { t: "취소", r: 1 },
          "상태",
          "정산 예정",
          "주문번호",
        ],
        pg
          .map(
            (t) =>
              `<tr class="click" data-act="tx" data-v="${t.id}"><td class="num">${mdS(t.date)} <span class="muted">${t.time}</span></td><td>${bz(t.biz)}</td><td><button class="rowbtn" data-act="tx" data-v="${t.id}">${t.product}</button>${DB.refunds[t.id] && DB.refunds[t.id].state === "승인 대기" ? " " + pill("bad", "환불 요청") : ""}</td><td>${t.method}</td><td class="r">${won(t.amount)}</td><td class="r">${t.cancel ? won(-t.cancel) : '<span class="muted">-</span>'}</td><td>${pill(TX_KIND[t.status], t.status)}</td><td class="num">${t.status === "입금 대기" ? '<span class="muted">입금 후</span>' : md(addBiz(t.date, 3))}</td><td class="mono muted">${t.id}</td></tr>`,
          )
          .join("") ||
          `<tr><td colspan="9"><div class="empty" style="border:0"><b>조건에 맞는 결제가 없습니다</b>기간이나 상태를 바꿔 보세요.</div></td></tr>`,
        "",
        "nw",
      ) +
      `<div class="pager"><span>${cnt(rows.length)}건 중 ${rows.length ? (SL.page - 1) * per + 1 : 0}–${Math.min(SL.page * per, rows.length)}</span><span style="display:flex;gap:6px;align-items:center"><button class="btn sm" data-act="page" data-v="-1" ${SL.page <= 1 ? "disabled" : ""}>이전</button><span>${SL.page} / ${pages}</span><button class="btn sm" data-act="page" data-v="1" ${SL.page >= pages ? "disabled" : ""}>다음</button></span></div>`
    );
  }
  function extRows() {
    const r = rangeX(),
      q = SL.q.trim().toLowerCase();
    return DB.ext
      .filter(
        (e) =>
          inR(e.date, r) &&
          (SL.etype === "all" || e.type === SL.etype) &&
          (!q || (e.title + " " + e.client).toLowerCase().includes(q)),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  function extList() {
    const rows = extRows();
    return (
      `<div class="sumline"><span>${cnt(rows.length)}건</span><span>합계 <b>${won(sum(rows, (e) => extInfo(e).total))}</b></span><span>입금 확인 <b>${won(
        sum(
          rows.filter((e) => extInfo(e).state === "입금 확인"),
          (e) => extInfo(e).total,
        ),
      )}</b></span><span>받을 돈 <b>${won(
        sum(
          rows.filter((e) => extInfo(e).state !== "입금 확인"),
          (e) => extInfo(e).total,
        ),
      )}</b></span></div>` +
      tbl(
        [
          "매출일",
          "종류",
          "사업",
          "내용",
          "거래처",
          { t: "공급가액", r: 1 },
          { t: "부가세", r: 1 },
          { t: "합계", r: 1 },
          "입금",
          "증빙",
          "",
        ],
        rows
          .map((e) => {
            const i = extInfo(e);
            return `<tr class="click" data-act="extedit" data-v="${e.id}"><td class="num">${md(e.date)}${e.date > TODAY ? ' <span class="muted small">예정</span>' : ""}</td><td>${EXT_TYPES[e.type]}</td><td>${bz(e.biz)}</td><td><button class="rowbtn ell" data-act="extedit" data-v="${e.id}">${esc(e.title)}</button></td><td>${esc(e.client)}</td><td class="r">${e.type === "youtube" ? (e.usd ? `<span class="muted small">${usd(e.usd)}</span>` : "") : won(e.supply)}</td><td class="r">${e.type === "youtube" ? '<span class="muted small">해외</span>' : won(e.vat)}</td><td class="r"><b>${won(i.total)}</b>${i.est ? ' <span class="muted small">예상</span>' : ""}</td><td>${pill(EXT_KIND[i.state], i.state === "입금 확인" ? `${mdS(i.paid)} 입금` : i.state === "입금 예정" ? `${mdS(e.due)} 예정` : `${mdS(e.due)} 지남`)}</td><td class="small">${e.invoice ? esc(e.invoice) : e.type === "youtube" ? '<span class="muted">해외 지급</span>' : '<span class="muted">-</span>'}</td><td class="r"><button class="btn sm" data-act="extedit" data-v="${e.id}">수정</button></td></tr>`;
          })
          .join("") ||
          `<tr><td colspan="11"><div class="empty" style="border:0"><b>이 기간 외부 매출이 없습니다</b><button class="btn sm pri" data-act="extadd" style="margin-top:8px">외부 매출 추가</button></div></td></tr>`,
        "",
        "nw",
      )
    );
  }
  function vSales() {
    const rf = refundPending(),
      r = range(),
      base = TX.filter((t) => inR(t.date, r) && bizOk(t.biz));
    const tossNet =
      sum(
        base.filter((t) => t.status !== "입금 대기"),
        (t) => t.amount,
      ) -
      sum(
        cancelsIn(r),
        (t) => t.cancel,
      );
    const ex = extIn(rangeX()),
      exT = sum(ex, (e) => extInfo(e).total),
      late = DB.ext.filter((e) => extInfo(e).state === "입금 지남");
    return (
      head(
        "매출내역",
        "토스 결제(PG)와 밖에서 들어오는 매출(유튜브·외주·강연)을 한곳에서",
        `<button class="btn sm" data-act="csv" data-v="${SL.src === "toss" ? "sales" : "ext"}">CSV 내보내기</button><button class="btn pri sm" data-act="extadd">외부 매출 추가</button>`,
      ) +
      (rf.length
        ? `<div class="callout bad"><b>환불 요청 ${rf.length}건</b><span class="grow">모의 승인 흐름입니다. 실제 결제 취소나 고객 안내는 실행하지 않습니다.</span><button class="btn sm" data-act="tx" data-v="${rf[0]}">요청 보기</button></div>`
        : "") +
      (late.length
        ? `<div class="callout bad"><b>외부 매출 입금 지남 ${late.length}건</b><span class="grow">${late.map((e) => `${esc(e.title)} (${mdS(e.due)} 예정)`).join(" · ")}</span><button class="btn sm" data-act="extedit" data-v="${late[0].id}">확인</button></div>`
        : "") +
      `<div class="toolbar">${periodCtl("매출일")}</div>` +
      `<div class="srctabs" role="tablist" aria-label="매출 출처">
     <button class="srctab" role="tab" aria-selected="${SL.src === "toss"}" data-act="src" data-v="toss"><span class="l">토스 결제 (PG)</span><span class="v">${won(tossNet)}</span></button>
     <button class="srctab" role="tab" aria-selected="${SL.src === "ext"}" data-act="src" data-v="ext"><span class="l">외부 매출</span><span class="v">${won(exT)}</span></button>
     <div class="srctab" style="cursor:default;background:var(--surface-2)"><span class="l">합계</span><span class="v">${won(tossNet + exT)}</span></div></div>` +
      (SL.src === "toss"
        ? `<div class="toolbar">${bizChips()}<select class="sel" id="smethod" data-change="smethod" aria-label="결제수단"><option value="all">결제수단 전체</option>${METHODS.map((m) => `<option ${SL.method === m[0] ? "selected" : ""}>${m[0]}</option>`).join("")}</select><input class="input search" id="sq" data-input="sq" placeholder="주문번호 · 상품 · 고객(가린 이름)" value="${esc(SL.q)}" aria-label="결제 검색"></div>` +
          `<div class="toolbar"><div class="chips" role="group" aria-label="상태">${["all", "완료", "취소", "부분 취소", "입금 대기"].map((s) => chip("sstatus", s, s === "all" ? "전체 상태" : s, SL.status === s, s === "all" ? cnt(base.length) : cnt(base.filter((t) => t.status === s).length))).join("")}</div></div>` +
          (BIZF === "hm"
            ? `<div class="empty"><b>하루멜라는 아직 토스와 연결 전입니다</b>자체몰 오픈 후 연결됩니다.</div>`
            : `<div id="salesList">${salesList()}</div>`)
        : `<div class="toolbar"><div class="chips" role="group" aria-label="종류">${chip("etype", "all", "전체 종류", SL.etype === "all")}${Object.entries(
            EXT_TYPES,
          )
            .map(([k, l]) =>
              chip(
                "etype",
                k,
                l,
                SL.etype === k,
                cnt(ex.filter((e) => e.type === k).length),
              ),
            )
            .join(
              "",
            )}</div><input class="input search" id="sq" data-input="sq" placeholder="내용 · 거래처" value="${esc(SL.q)}" aria-label="외부 매출 검색"></div><div id="salesList">${extList()}</div><p class="note" style="margin-top:8px">통장 내역에서 입금 후보를 확인해 연결하면 '입금 확인'이 됩니다. 유튜브 예상 입금은 실제 지급일·원화 금액과 다를 수 있으며, 연결 후에는 통장 입금액을 표시합니다.</p>`)
    );
  }

  /* ================= 화면: 정산·입금 ================= */
  const SE = { tab: "payout", status: "all", page: 1 };
  function settlementRows(status = SE.status) {
    return PO.filter(
      (p) =>
        inR(p.pay, range()) &&
        bizOk(p.biz) &&
        (status === "all" ||
          p.state === status ||
          (status === "확인 필요" &&
            ["미확인", "금액 다름"].includes(p.state))),
    );
  }
  function vSettlements() {
    const r = range();
    const all = PO.filter((p) => inR(p.pay, r) && bizOk(p.biz));
    const list = settlementRows();
    const next = PO.filter((p) => p.pay > TODAY && bizOk(p.biz)).sort((a, b) =>
        a.pay < b.pay ? -1 : 1,
      ),
      nd = next[0] && next[0].pay;
    const need = PO.filter(
      (p) => bizOk(p.biz) && (p.state === "미확인" || p.state === "금액 다름"),
    );
    const fee = sum(all, (p) => p.fee);
    const tabs = `<div class="tabs" role="tablist">${[
      ["payout", "지급일별"],
      ["entry", "거래별 정산"],
    ]
      .map(
        ([v, l]) =>
          `<button class="tab" role="tab" aria-selected="${SE.tab === v}" data-act="setab" data-v="${v}">${l}</button>`,
      )
      .join("")}</div>`;
    let body;
    if (SE.tab === "entry") {
      const es = ST.filter((e) => inR(e.pay, r) && bizOk(e.biz)).sort(
        (a, b) => b.pay.localeCompare(a.pay) || b.sold.localeCompare(a.sold),
      );
      SE.page = Math.max(1, Math.min(SE.page, Math.ceil(es.length / 30) || 1));
      body =
        tbl(
          [
            "지급일",
            "매출일",
            "사업",
            "주문번호",
            "구분",
            { t: "결제 금액", r: 1 },
            { t: "수수료", r: 1 },
            { t: "지급 금액", r: 1 },
          ],
          es
            .slice((SE.page - 1) * 30, SE.page * 30)
            .map(
              (e) =>
                `<tr><td class="num">${md(e.pay)}</td><td class="num">${md(e.sold)}</td><td>${bz(e.biz)}</td><td class="mono muted">${e.tx.id}</td><td>${e.cancel ? pill("warn", "취소") : "결제"}</td><td class="r">${won(e.amount)}</td><td class="r">${won(-e.fee)}</td><td class="r">${won(e.amount - e.fee)}</td></tr>`,
            )
            .join("") ||
            `<tr><td colspan="8"><div class="empty" style="border:0">이 기간 정산이 없습니다.</div></td></tr>`,
          "",
          "nw",
        ) +
        `<div class="pager"><span>${cnt(es.length)}건 · ${SE.page} / ${Math.ceil(es.length / 30) || 1}</span><div><button class="btn sm" data-act="sepage" data-v="-1" ${SE.page <= 1 ? "disabled" : ""}>이전</button><button class="btn sm" data-act="sepage" data-v="1" ${SE.page * 30 >= es.length ? "disabled" : ""}>다음</button></div></div>`;
    } else {
      const sts = [
        "all",
        "확인 필요",
        "입금 확인",
        "사유 기록",
        "입금 대기",
        "지급 예정",
      ];
      body =
        `<div class="toolbar"><div class="chips" role="group" aria-label="상태">${sts.map((s) => chip("sestatus", s, s === "all" ? "전체" : s, SE.status === s, s === "all" ? cnt(all.length) : s === "확인 필요" ? cnt(need.length) : cnt(all.filter((p) => p.state === s).length))).join("")}</div></div>` +
        tbl(
          [
            "지급일",
            "상점",
            "매출일",
            { t: "건수", r: 1 },
            { t: "결제 금액", r: 1 },
            { t: "수수료", r: 1 },
            { t: "지급 금액", r: 1 },
            { t: "통장 입금", r: 1 },
            "상태",
          ],
          list
            .map(
              (p) =>
                `<tr class="click" data-act="po" data-v="${p.id}"><td class="num"><button class="rowbtn" data-act="po" data-v="${p.id}">${md(p.pay)}</button></td><td>${bz(p.biz)}</td><td class="num">${p.soldFrom === p.soldTo ? mdS(p.soldFrom) : mdS(p.soldFrom) + "–" + mdS(p.soldTo)}</td><td class="r">${cnt(p.count)}</td><td class="r">${won(p.amount)}</td><td class="r">${won(-p.fee)}</td><td class="r"><b>${won(p.payout)}</b></td><td class="r">${p.bank != null ? won(p.bank) + (p.bank !== p.payout ? ` <span style="color:var(--bad)">(${won(p.bank - p.payout)})</span>` : "") : '<span class="muted">-</span>'}</td><td>${pill(PO_KIND[p.state], p.state)}</td></tr>`,
            )
            .join("") ||
            `<tr><td colspan="9"><div class="empty" style="border:0">이 조건의 지급이 없습니다.</div></td></tr>`,
          list.length
            ? `<tr><td colspan="4">합계 ${cnt(list.length)}회</td><td class="r">${won(sum(list, (p) => p.amount))}</td><td class="r">${won(-sum(list, (p) => p.fee))}</td><td class="r">${won(sum(list, (p) => p.payout))}</td><td class="r">${won(
                sum(
                  list.filter((p) => p.bank != null),
                  (p) => p.bank,
                ),
              )}</td><td></td></tr>`
            : "",
          "nw",
        );
    }
    return (
      head(
        "정산입금",
        "PG 토스페이먼츠가 보낸 정산금과 KB국민은행 입금을 자동으로 맞춥니다 · 지급 금액 = 결제 금액 − 수수료(공급가액 + 부가세)",
        `<a class="btn sm" href="#bank">통장 내역</a><button class="btn sm" data-act="csv" data-v="settlements">CSV 내보내기</button>`,
      ) +
      (need.length
        ? `<div class="callout bad"><b>확인 필요 ${need.length}건</b><span class="grow">${need.map((p) => `${md(p.pay)} ${BIZ[p.biz].short} · ${p.state}`).join(" · ")}</span><button class="btn sm" data-act="po" data-v="${need[0].id}">확인하기</button></div>`
        : "") +
      `<div class="toolbar">${periodCtl("지급일")}</div><div class="toolbar">${bizChips()}</div>` +
      (BIZF === "hm"
        ? `<div class="empty"><b>하루멜라는 아직 토스와 연결 전입니다</b></div>`
        : `<div class="tiles t4" style="margin-bottom:16px">
    <div class="tile"><span class="l">다음 지급</span><span class="v">${nd ? md(nd) : "-"}</span><span class="d">${
      nd
        ? won(
            sum(
              next.filter((p) => p.pay === nd),
              (p) => p.payout,
            ),
          )
        : "예정 없음"
    }</span></div>
    <div class="tile"><span class="l">기간 지급 합계</span><span class="v">${man(sum(all, (p) => p.payout))}</span><span class="d">${cnt(all.length)}회</span></div>
    <div class="tile"><span class="l">수수료</span><span class="v">${man(fee)}</span><span class="d">공급가 ${won(Math.round(fee / 1.1))} · 부가세 ${won(fee - Math.round(fee / 1.1))}</span></div>
    <a class="tile" href="#bank"><span class="l">통장 입금 (KB국민은행)</span><span class="v">${man(
      sum(
        all.filter((p) => p.bank != null),
        (p) => p.bank,
      ),
    )}</span><span class="d">${connected?"저장된 통장 내역과 대조":SYNC_LABEL()+" 동기화"}</span></a>
   </div>` +
          tabs +
          body)
    );
  }

  /* ================= 화면: 통장 내역 ================= */
  const BK = { f: "all", cat: "all", q: "", page: 1, acct: "all" };
  function bankFiltered() {
    const r = range(),
      q = BK.q.trim().toLowerCase();
    return bankRows()
      .filter(
        (x) =>
          inR(x.date, r) &&
          (BK.acct === "all" || x.acct === BK.acct) &&
          (BK.f === "all" ||
            (BK.f === "in" && x.in > 0) ||
            (BK.f === "out" && x.out > 0) ||
            (BK.f === "xfer" && x.cat === XFER) ||
            (BK.f === "unc" && (x.cat === "미분류" || !x.cat))) &&
          (BK.cat === "all" || x.cat === BK.cat) &&
          (!q || x.desc.toLowerCase().includes(q)),
      )
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }
  function linkText(x) {
    if (!x.link)
      return x.cat === "미분류"
        ? `<span class="muted small">연결 안 됨</span>`
        : '<span class="muted small">-</span>';
    if (x.link.type === "po") {
      const p = PO.find((z) => z.id === x.link.id);
      return p
        ? `<button class="rowbtn small" data-act="po" data-v="${p.id}">${md(p.pay)} 토스 ${BIZ[p.biz].short} 정산</button>`
        : "";
    }
    if (x.link.type === "ext") {
      const e = DB.ext.find((z) => z.id === x.link.id);
      return e
        ? `<button class="rowbtn small" data-act="extedit" data-v="${e.id}">${esc(e.title)}</button>`
        : '<span class="muted small">지운 외부 매출</span>';
    }
    if (x.link.type === "xfer") {
      const o = bankRows().find((z) => z.id === x.link.id);
      return o
        ? `<button class="rowbtn small" data-act="bk" data-v="${o.id}">${x.out ? "→" : "←"} ${esc(acctName(o.acct))} 통장</button>`
        : '<span class="muted small">-</span>';
    }
    if (x.link.type === "inst") {
      const ym = x.link.id;
      return `<button class="rowbtn small" data-act="bgo" data-v="${ym}">${mLabel(ym)}분 강사 정산 · 예산 관리</button>`;
    }
    return "";
  }
  function bankList() {
    const rows = bankFiltered(),
      per = 30,
      pages = Math.max(1, Math.ceil(rows.length / per));
    if (BK.page > pages) BK.page = pages;
    const pg = rows.slice((BK.page - 1) * per, BK.page * per);
    const showA = BK.acct === "all" && DB.accounts.length > 1,
      cols = showA ? 8 : 7,
      sel = BK.acct === "all" ? null : acctOf(BK.acct),
      none = sel && !bankRows().some((x) => x.acct === sel.id);
    const empty = none
      ? `<div class="empty" style="border:0"><b>아직 가져온 거래가 없습니다</b>${sel.method === "xl" ? "KB기업뱅킹에서 받은 거래내역 엑셀을 올려 주세요." : `연결이 끝나면 ${esc(sel.freq)} 자동으로 들어옵니다. 그 전에는 엑셀로 올릴 수 있습니다.`}<div style="margin-top:10px"><button class="btn sm" data-act="bankupload">거래내역 파일 올리기</button></div></div>`
      : `<div class="empty" style="border:0">이 조건의 거래가 없습니다.</div>`;
    return (
      tbl(
        [
          "거래 일시",
          ...(showA ? ["통장"] : []),
          "적요 (거래처)",
          { t: "입금", r: 1 },
          { t: "출금", r: 1 },
          { t: "잔액", r: 1 },
          "분류",
          "연결",
        ],
        pg
          .map(
            (x) =>
              `<tr class="click" data-act="bk" data-v="${x.id}"><td class="num">${mdS(x.date)} <span class="muted">${x.time}</span></td>${showA ? `<td><span class="acct-tag">${esc(acctName(x.acct))}</span></td>` : ""}<td><button class="rowbtn" data-act="bk" data-v="${x.id}">${esc(x.desc)}</button></td><td class="r">${x.in ? `<span class="inamt">+${won(x.in)}</span>` : ""}</td><td class="r">${x.out ? won(-x.out) : ""}</td><td class="r muted">${x.bal==null?"미확인":won(x.bal)}</td><td>${x.cat === "미분류" || !x.cat ? pill("warn", "미분류") : `<span class="pill">${x.cat}</span>`}</td><td>${linkText(x)}</td></tr>`,
          )
          .join("") || `<tr><td colspan="${cols}">${empty}</td></tr>`,
        "",
        "nw",
      ) +
      `<div class="pager"><span>${cnt(rows.length)}건 중 ${rows.length ? (BK.page - 1) * per + 1 : 0}–${Math.min(BK.page * per, rows.length)}${showA ? " · 잔액은 그 통장 기준" : ""}</span><span style="display:flex;gap:6px;align-items:center"><button class="btn sm" data-act="bpage" data-v="-1" ${BK.page <= 1 ? "disabled" : ""}>이전</button><span>${BK.page} / ${pages}</span><button class="btn sm" data-act="bpage" data-v="1" ${BK.page >= pages ? "disabled" : ""}>다음</button></span></div>`
    );
  }
  const acctStatus = (a) =>
    a.sample
      ? pill("out", "모의 내역")
      : a.method === "xl"
        ? pill("none", "엑셀 올리기")
        : pill("warn", "연결 대기");
  function acctCard(a) {
    const on = BK.acct === a.id,
      b = acctBal(a.id);
    return `<div class="acct${on ? " on" : ""}"><button class="acct-sel" data-act="bacct" data-v="${a.id}" aria-pressed="${on}"><span class="acct-top"><span class="bank" aria-hidden="true">${BANK_SHORT[a.bank] || "은행"}</span><span class="acct-nm"><b>${esc(a.name)}</b><span class="small muted">${esc(a.bank)} ••${a.last ? esc(a.last) : "[ ]"}</span></span></span><span class="acct-bal">${b == null ? '<span class="muted small" style="font-weight:400">첫 가져오기 전</span>' : man(b)}</span><span class="acct-meta">${acctStatus(a)}${a.incl === false ? ' <span class="pill">순수익 제외</span>' : ""}</span><span class="small muted acct-use">${(a.uses || []).join(" · ") || "용도 안 정함"}</span></button><button class="btn sm ghost acct-set" data-act="acctedit" data-v="${a.id}" aria-label="${esc(a.name)} 통장 설정">설정</button></div>`;
  }
  function vBank() {
    if (BK.acct !== "all" && !acctOf(BK.acct)) BK.acct = "all";
    const all = bankRows(),
      r = range(),
      sel = BK.acct === "all" ? null : acctOf(BK.acct);
    const scope = all.filter((x) => !sel || x.acct === sel.id),
      inr = scope.filter((x) => inR(x.date, r)),
      unc = all.filter((x) => x.cat === "미분류" || !x.cat);
    const real = inr.filter((x) => x.cat !== XFER),
      xf = inr.filter((x) => x.cat === XFER),
      xIn = sum(xf, (x) => x.in),
      xOut = sum(xf, (x) => x.out),
      chg = sum(inr, (x) => x.in - x.out);
    const bals = DB.accounts.map((a) => acctBal(a.id)),
      bal = sel
        ? acctBal(sel.id)
        : sum(
            bals.filter((b) => b != null),
            (b) => b,
          );
    const byCat = (c) =>
        sum(
          real.filter((x) => x.cat === c),
          (x) => x.in,
        ),
      rnd = byCat("연구비");
    const pc = pairCands();
    return (
      head(
        "통장 내역",
        `KB국민은행 통장 ${DB.accounts.length}개 · 입출금을 자동으로 가져와 토스 정산·외부 매출·비용과 맞춥니다`,
        `<button class="btn sm" data-act="banksync">${connected?"은행 연결 확인":"모의 새로고침"}</button><button class="btn sm" data-act="bankupload">파일 올리기</button><button class="btn sm" data-act="bankrules">분류 규칙</button>${DB.archivedAccounts?.length ? '<button class="btn sm" data-act="archived">보관 통장</button>' : ""}<button class="btn sm" data-act="csv" data-v="bank">CSV 내보내기</button><button class="btn pri sm" data-act="acctadd">통장 추가</button>`,
      ) +
      `<div class="accts" role="group" aria-label="통장 고르기">
     <div class="acct${!sel ? " on" : ""}"><button class="acct-sel" data-act="bacct" data-v="all" aria-pressed="${!sel}"><span class="acct-top"><span class="bank" aria-hidden="true">전체</span><span class="acct-nm"><b>전체 통장</b><span class="small muted">${DB.accounts.length}개 합계</span></span></span><span class="acct-bal">${man(
       sum(
         bals.filter((b) => b != null),
         (b) => b,
       ),
     )}</span><span class="small muted acct-use">통장끼리 옮긴 돈은 합계에서 서로 지웁니다</span></button></div>
     ${DB.accounts.map(acctCard).join("")}
     <button class="acct add" data-act="acctadd"><b>＋ 통장 추가</b><span class="small muted">KB국민은행 · 다른 은행</span></button></div>` +
      (sel
        ? `<div class="conn"><span class="bank" aria-hidden="true">${BANK_SHORT[sel.bank] || "은행"}</span><div style="flex:1;min-width:200px"><b>${esc(sel.bank)} · ${esc(sel.name)} ••${sel.last ? esc(sel.last) : "[ ]"}</b><div class="small muted">${CONN_M[sel.method]} · ${sel.method === "xl" ? "직접 올림" : esc(sel.freq) + " 자동"} · ${sel.sample ? "마지막 " + SYNC_LABEL() : "아직 가져온 거래 없음"}${sel.incl === false ? " · 순수익·예산 계산에서 뺌" : ""}</div></div>${acctStatus(sel)}<button class="btn sm" data-act="acctedit" data-v="${sel.id}">설정</button></div>`
        : "") +
      (pc.length
        ? `<div class="callout info"><b>내 통장 간 이체로 보이는 거래 ${pc.length}쌍</b><span class="grow">${pc.map(([o, i]) => `${mdS(o.date)} ${esc(acctName(o.acct))} → ${esc(acctName(i.acct))} ${won(o.out)}`).join(" · ")} — 묶으면 입출금 합계·순수익에서 빠집니다.</span><button class="btn sm" data-act="bkpair" data-v="${pc[0][0].id}" data-o="${pc[0][1].id}">이체로 묶기</button></div>`
        : "") +
      (unc.length
        ? `<div class="callout warn"><b>미분류 ${unc.length}건</b><span class="grow">${unc.map((x) => `${esc(acctName(x.acct))} ${mdS(x.date)} ${esc(x.desc)} ${x.in ? "+" + won(x.in) : won(-x.out)}`).join(" · ")}</span><button class="btn sm" data-act="bk" data-v="${unc[0].id}">분류하기</button></div>`
        : "") +
      `<div class="toolbar">${periodCtl("거래일")}</div>` +
      `<div class="tiles t4" style="margin-bottom:14px">
     <div class="tile"><span class="l">${sel ? "현재 잔액" : "잔액 합계"}</span><span class="v">${bal == null ? "-" : man(bal)}</span><span class="d">${SYNC_LABEL()} 기준${sel ? "" : ` · 통장 ${DB.accounts.length}개`}</span></div>
     <div class="tile"><span class="l">기간 입금</span><span class="v" style="color:var(--good)">${man(sum(real, (x) => x.in))}</span><span class="d">${
       [
         ["토스 정산", byCat("토스 정산")],
         ["외부 매출", byCat("외부 매출")],
         ["연구비", rnd],
         ["기타", byCat("기타 입금") + byCat("미분류")],
       ]
         .filter((z) => z[1])
         .map((z) => `${z[0]} ${won(z[1])}`)
         .join(" · ") || "입금 없음"
     }</span></div>
     <div class="tile"><span class="l">기간 출금</span><span class="v">${man(sum(real, (x) => x.out))}</span><span class="d">${cnt(real.filter((x) => x.out).length)}건 · 통장 간 이체 뺌</span></div>
     <div class="tile"><span class="l">기간 순증감</span><span class="v" style="color:${chg < 0 ? "var(--bad)" : "inherit"}">${man(chg)}</span><span class="d">${sel && (xIn || xOut) ? `이체 받음 ${won(xIn)} · 보냄 ${won(-xOut)} 포함` : "입금 − 출금"}</span></div></div>` +
      `<div class="toolbar"><div class="chips" role="group" aria-label="보기">${chip("bkf", "all", "전체", BK.f === "all", cnt(inr.length))}${chip("bkf", "in", "입금", BK.f === "in", cnt(inr.filter((x) => x.in).length))}${chip("bkf", "out", "출금", BK.f === "out", cnt(inr.filter((x) => x.out).length))}${chip("bkf", "xfer", "통장 간 이체", BK.f === "xfer", cnt(xf.length))}${chip("bkf", "unc", "미분류", BK.f === "unc", cnt(inr.filter((x) => x.cat === "미분류" || !x.cat).length))}</div><label class="vh" for="bkcat">분류</label><select class="sel" id="bkcat" data-change="bkcat"><option value="all">분류 전체</option>${[...new Set([...BANK_CATS_IN, ...BANK_CATS_OUT]), "미분류"].map((c) => `<option ${BK.cat === c ? "selected" : ""}>${c}</option>`).join("")}</select><input class="input search" id="bq" data-input="bq" placeholder="적요 · 거래처" value="${esc(BK.q)}" aria-label="통장 검색"></div>` +
      `<div id="bankList">${bankList()}</div>` +
      `<p class="note" style="margin-top:8px">분류는 적요로 자동 지정합니다. 카드 대금은 카드 지출에서 이미 비용으로 셉니다. 내 통장 간 이체는 들어온 돈·비용 어디에도 넣지 않습니다. 연구비 입금은 예산 관리에서 순수익에 넣을지 고릅니다.</p>`
    );
  }

  /* ================= 화면: 카드 지출 ================= */
  const CS = { f: "todo", card: "all", sel: new Set(), page: 1 };
  function cardRows() {
    const r = range();
    return CR.filter(
      (x) => inR(x.date, r) && (CS.card === "all" || x.card === CS.card),
    );
  }
  function cardFiltered(rows) {
    const f = CS.f;
    return rows
      .filter((x) => {
        const s = crState(x);
        return (
          f === "all" ||
          (f === "todo" && s !== "완료" && s !== "취소") ||
          f === s ||
          (f === "해외" && x.cur) ||
          (f === "정기" && x.rec)
        );
      })
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }
  function cardList() {
    const base = cardRows(),
      rows = cardFiltered(base),
      per = 30,
      pages = Math.max(1, Math.ceil(rows.length / per));
    if (CS.page > pages) CS.page = pages;
    const pg = rows.slice((CS.page - 1) * per, CS.page * per);
    const allSel = pg.length && pg.every((x) => CS.sel.has(x.id));
    return (
      (CS.sel.size
        ? `<div class="bulk"><b>${CS.sel.size}건 선택</b><select class="sel" id="bcat" aria-label="계정과목"><option value="">계정과목</option>${CATS.map((c) => `<option>${c}</option>`).join("")}</select><select class="sel" id="bbiz" aria-label="사업"><option value="">사업</option><option value="common">공통</option><option value="edu">브랜디에듀</option><option value="myin">마이인 진단</option><option value="hm">하루멜라</option></select><button class="btn pri sm" data-act="bulkapply">적용</button><button class="btn sm" data-act="bulkreq">메모 요청</button><button class="btn sm ghost" data-act="selclear">선택 해제</button></div>`
        : "") +
      tbl(
        [
          `<input type="checkbox" data-act="selall" aria-label="이 쪽 모두 선택" ${allSel ? "checked" : ""}>`,
          "이용일",
          "카드",
          "가맹점",
          { t: "금액", r: 1 },
          "계정과목",
          "사업",
          "부가세",
          "사용 목적",
          "상태",
        ],
        pg
          .map((x) => {
            const c = cls(x),
              s = crState(x),
              cd = cardOf(x.card);
            return `<tr class="${CS.sel.has(x.id) ? "on" : ""}"><td><input type="checkbox" data-act="sel" data-v="${x.id}" aria-label="${esc(x.merchant)} 선택" ${CS.sel.has(x.id) ? "checked" : ""}></td><td class="num">${mdS(x.date)} <span class="muted">${x.time}</span></td><td>••${cd.last} <span class="muted">${esc(cd.user)}</span></td><td><button class="rowbtn ell" data-act="cr" data-v="${x.id}" title="${esc(x.merchant)}">${esc(x.merchant)}</button>${x.rec ? ' <span class="pill out">정기</span>' : ""}</td><td class="r">${won(x.krw)}${x.cur ? ' <span class="pill out">USD</span>' : ""}</td><td>${c.cat ? c.cat : pill("bad", "미분류")}</td><td>${c.biz ? bz(c.biz) : '<span class="muted">-</span>'}</td><td class="small">${c.vat}</td><td><span class="ell w160 small" title="${esc(c.memo)}">${c.memo ? esc(c.memo) : '<span class="muted">비어 있음</span>'}</span></td><td>${pill(CR_KIND[s], s)}</td></tr>`;
          })
          .join("") ||
          `<tr><td colspan="10"><div class="empty" style="border:0">${range()[0] > cardUntil() ? `<b>이 기간 카드 내역을 아직 올리지 않았습니다</b>KB국민카드 내역은 ${mdS(cardUntil())}까지 올라와 있습니다. <button class="btn sm" data-act="upload" style="margin-top:8px">카드 내역 올리기</button>` : "<b>할 일이 없습니다</b>분류·메모·영수증이 모두 끝났습니다."}</div></td></tr>`,
        "",
        "nw",
      ) +
      `<div class="pager"><span>${cnt(rows.length)}건 중 ${rows.length ? (CS.page - 1) * per + 1 : 0}–${Math.min(CS.page * per, rows.length)}</span><span style="display:flex;gap:6px;align-items:center"><button class="btn sm" data-act="cpage" data-v="-1" ${CS.page <= 1 ? "disabled" : ""}>이전</button><span>${CS.page} / ${pages}</span><button class="btn sm" data-act="cpage" data-v="1" ${CS.page >= pages ? "disabled" : ""}>다음</button></span></div>`
    );
  }
  function vCards() {
    const r = range(),
      base = CR.filter((x) => !x.canceled && inR(x.date, r)),
      cu = cardUntil();
    const bb = base.filter((x) => CS.card === "all" || x.card === CS.card);
    const st = (s) => bb.filter((x) => crState(x) === s).length;
    const fchips = [
      ["todo", "할 일", bb.filter((x) => crState(x) !== "완료").length],
      ["미분류", "미분류", st("미분류")],
      ["메모 필요", "메모 필요", st("메모 필요")],
      ["영수증 필요", "영수증 필요", st("영수증 필요")],
      ["해외", "해외 결제", bb.filter((x) => x.cur).length],
      ["정기", "정기 결제", bb.filter((x) => x.rec).length],
      ["취소", "취소", cardRows().filter(x=>x.canceled).length],
      ["all", "전체", cardRows().length],
    ];
    const byCat = {};
    bb.forEach((x) => {
      const k = cls(x).cat || "미분류";
      byCat[k] = (byCat[k] || 0) + x.krw;
    });
    return (
      head(
        "카드지출",
        `KB국민카드 · 이용내역 엑셀 · ${mdS(cu)}까지 올림`,
        `<button class="btn sm" data-act="cardmanage">카드 관리</button><button class="btn sm" data-act="csv" data-v="cards">CSV 내보내기</button><button class="btn pri sm" data-act="upload">카드 내역 올리기</button>`,
      ) +
      (cu && r[1] > cu
        ? `<div class="callout warn"><b>${mdS(addDays(cu, 1))} 이후 카드 내역 없음</b><span class="grow">선택한 기간 중 ${mdS(cu)}까지만 보입니다.</span><button class="btn sm" data-act="upload">카드 내역 올리기</button></div>`
        : "") +
      `<div class="toolbar">${periodCtl("이용일")}</div>` +
      `<div class="tiles t4" style="margin-bottom:14px">${CARDS.map((c) => {
        const rs = base.filter((x) => x.card === c.id),
          todo = rs.filter((x) => crState(x) !== "완료").length;
        return `<button class="tile" data-act="cardf" data-v="${c.id}" aria-pressed="${CS.card === c.id}"><span class="l">${esc(c.name)} ••${c.last} · ${esc(c.user)}</span><span class="v">${man(sum(rs, (x) => x.krw))}</span><span class="d">${cnt(rs.length)}건 · ${todo ? `<span style="color:var(--warn);font-weight:700">할 일 ${cnt(todo)}</span>` : "할 일 없음"}</span></button>`;
      }).join("")}</div>` +
      `<div class="toolbar"><div class="chips" role="group" aria-label="보기">${fchips.map(([v, l, n]) => chip("crf", v, l, CS.f === v, cnt(n))).join("")}</div>${CS.card !== "all" ? `<button class="btn sm ghost" data-act="cardf" data-v="all">${esc(cardOf(CS.card).name)} ••${cardOf(CS.card).last}만 보는 중 ✕</button>` : ""}</div>` +
      `<div id="cardList">${cardList()}</div>` +
      `<div class="grid2" style="margin-top:24px;align-items:start">
     <div class="card"><div class="card-h"><div><h2>계정과목별</h2><p class="small muted">${rLabel()}${CS.card !== "all" ? " · " + cardOf(CS.card).name : ""}</p></div><span class="sub num">${won(sum(bb, (x) => x.krw))}</span></div>${hbars(
       Object.entries(byCat)
         .sort((a, b) => b[1] - a[1])
         .map(([l, v]) => ({ l, v })),
     )}</div>
     <div class="card"><div class="card-h"><div><h2>분류 규칙 ${DB.rules.length}</h2><p class="small muted">가맹점 이름에 들어간 말로 계정과목·사업을 자동으로 정합니다. 위에서부터 처음 맞는 규칙 하나만 씁니다.</p></div><button class="btn sm pri" data-act="rule" data-v="">규칙 추가</button></div>
      ${DB.rules
        .map((x, i) => {
          const n = CR.filter((c) => cls(c).rule === x.name).length;
          return `<div class="li"><div class="t"><b>${i + 1}. ${esc(x.name)}</b>${x.on ? "" : " " + pill("none", "꺼짐")}<div class="s">'${x.kw.map(esc).join("' · '")}' → ${x.cat} · ${x.biz === "common" ? "공통" : BIZ[x.biz] ? BIZ[x.biz].short : "-"} · ${x.vat}</div></div><div class="a"><span class="small muted num">${n}건</span><button class="btn sm" data-act="rulemove" data-v="${x.id}" data-d="-1" aria-label="${esc(x.name)} 규칙 위로" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm" data-act="rulemove" data-v="${x.id}" data-d="1" aria-label="${esc(x.name)} 규칙 아래로" ${i === DB.rules.length - 1 ? "disabled" : ""}>↓</button><button class="btn sm" data-act="rule" data-v="${x.id}">편집</button></div></div>`;
        })
        .join("")}${!DB.rules.length?'<button class="btn sm" data-act="ruledefaults">기본 분류 규칙으로 시작</button>':""}</div></div>`
    );
  }

  /* ================= 화면: 정기 결제 ================= */
  function vRecurring() {
    const g = Object.fromEntries(
      recurringCandidates(CR).map((x) => [x.merchant, x.records]),
    );
    const defOwner = {
      "VERCEL INC.": ACTOR,
      SUPABASE: ACTOR,
      ANTHROPIC: ACTOR,
      "GOOGLE WORKSPACE": "담당 C",
    };
    const rows = Object.entries(g).map(([m, rs]) => {
      rs.sort((a, b) => a.date.localeCompare(b.date));
      const last = rs[rs.length - 1];
      const nm = nextYm(last.date.slice(0, 7));
      return {
        m,
        rs,
        last,
        next: `${nm}-${pad(Math.min(Number(last.date.slice(8)), Number(lastDay(nm).slice(8))))}`,
        owner: DB.owners[m] ?? (connected?"":defOwner[m]) ?? "",
        state: DB.recState[m] || "유지",
      };
    });
    const tot = sum(
      rows.filter((x) => x.state !== "해지함"),
      (x) => x.last.krw,
    );
    return (
      head(
        "정기 결제",
        "카드에서 매달 나가는 구독 · 같은 가맹점이 매달 비슷한 날짜·금액으로 2번 이상이면 여기에 모입니다",
        `<button class="btn sm" data-act="csv" data-v="recurring">CSV 내보내기</button>`,
      ) +
      `<div class="tiles t3" style="margin-bottom:16px"><div class="tile"><span class="l">월 합계 (최근 청구)</span><span class="v">${won(tot)}</span><span class="d">${rows.length}개 서비스 · 예산 '개발·업무 도구'</span></div><div class="tile"><span class="l">담당 없음</span><span class="v" style="color:${rows.filter((x) => !x.owner).length ? "var(--warn)" : "inherit"}">${rows.filter((x) => !x.owner).length}개</span><span class="d">유지·해지를 정할 사람</span></div><div class="tile"><span class="l">해지 검토</span><span class="v">${rows.filter((x) => x.state === "해지 검토").length}개</span><span class="d">다음 결제 전에 결정</span></div></div>` +
      tbl(
        [
          "서비스",
          "카드",
          { t: "최근 금액", r: 1 },
          "최근 3개월",
          "결제일",
          "다음 예정",
          "담당",
          "상태",
        ],
        rows
          .map(
            (x) =>
              `<tr><td><b>${esc(x.m)}</b></td><td>••${cardOf(x.last.card).last}</td><td class="r">${won(x.last.krw)}${x.last.cur ? ` <span class="muted small">${usd(x.last.fx)}</span>` : ""}</td><td class="small num">${x.rs
                .slice(-3)
                .map((r) =>
                  BLANK
                    ? "[ ]"
                    : Math.round(r.krw / 1000).toLocaleString("ko-KR") + "천",
                )
                .join(
                  " · ",
                )}</td><td class="num">매달 ${dparse(x.last.date).getUTCDate()}일</td><td class="num">${x.state === "해지함" ? "—" : x.next < TODAY ? "카드 내역 확인 필요" : md(x.next)}</td><td><label class="vh" for="ow-${x.rs[0].id}">${esc(x.m)} 담당</label><select class="sel" id="ow-${x.rs[0].id}" data-change="owner" data-v="${esc(x.m)}"><option value="">담당 없음</option>${(connected?[...new Set(CARDS.map(c=>c.user).filter(Boolean).concat(x.owner||[]))]:[ACTOR, "담당 B", "담당 C", "담당 D", "담당 E"]).map((n) => `<option ${x.owner === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></td><td><label class="vh" for="rs-${x.rs[0].id}">${esc(x.m)} 상태</label><select class="sel" id="rs-${x.rs[0].id}" data-change="recstate" data-v="${esc(x.m)}">${["유지", "해지 검토", "해지함"].map((s) => `<option ${x.state === s ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`,
          )
          .join(""),
        "",
        "nw",
      ) +
      `<p class="note" style="margin-top:10px">해외 결제는 환율에 따라 원화 청구액이 달라집니다. 통장 자동이체(임대료 등)는 예산 관리에서 통장 출금으로 잡힙니다.</p>`
    );
  }

  /* ================= 화면: 예산 관리 ================= */
  const TYPES = {
    fixed: { n: "고정비", d: "매달 거의 같은 금액 (임대료·구독·기장료)" },
    variable: {
      n: "변동비",
      d: "쓰는 만큼 달라지는 비용 (광고·강사 정산·외주·촬영·회의)",
    },
    labor: { n: "인건비", d: "급여·4대보험·프리랜서" },
  };
  const SRC_LABEL = {
    card: "카드 자동",
    bank: "통장 출금 자동",
    instructor: "자동 계산",
    manual: "직접 입력",
  };
  function budgetUsageCell(b) {
    if (b.act == null)
      return `<span class="muted small">${b.source === "card" ? "카드 내역 없음" : b.source === "bank" ? "출금 없음" : "입력 전"}</span>`;
    if (!b.amount) return `<span class="muted small">예산 없음</span>`;
    const p = b.act / b.amount,
      k = p >= 1 ? "bad" : p >= 0.8 ? "warn" : "";
    return `<div class="usebar"><div class="meter ${k}"><i style="width:${BLANK ? 0 : Math.min(100, p * 100)}%"></i></div>${k ? pill(k, pct(p)) : `<span class="small num">${pct(p)}</span>`}</div>`;
  }
  function vBudget() {
    const M = budgetMonth(BM),
      N = netOf(BM),
      i = MONTHS.indexOf(BM);
    const trend = MONTHS.map((m) => {
      const n = netOf(m);
      return {
        ym: m,
        net: n.net,
        inn: n.inn,
        cost: n.cost,
        partial: n.partial,
      };
    });
    const tot = sum(M.items, (b) => b.amount),
      act = sum(
        M.items.filter((b) => b.act != null),
        (b) => b.act,
      );
    const byT = (t) => {
      const it = M.items.filter((b) => b.type === t);
      return {
        it,
        b: sum(it, (x) => x.amount),
        a: sum(
          it.filter((x) => x.act != null),
          (x) => x.act,
        ),
        miss: it.filter((x) => x.act == null).length,
      };
    };
    const srcText = (b) =>
      b.source === "card"
        ? `카드 · ${(b.cats || []).join(", ")}`
        : b.source === "bank"
          ? `통장 · ${(b.bcats || []).join(", ")}`
          : b.source === "instructor"
            ? "자동"
            : "직접 입력";
    const group = (t) => {
      const g = byT(t);
      return (
        `<section class="bgroup" aria-labelledby="bg-${t}"><div class="bgroup-h"><div><h2 id="bg-${t}">${TYPES[t].n} <span class="typetag">${g.it.length}개</span></h2><p class="small muted">${TYPES[t].d}</p></div><div class="small fg2 num">예산 ${won(g.b)} · 실적 ${won(g.a)}${g.miss ? ` · <span class="muted">실적 없음 ${g.miss}개</span>` : ""}</div></div>` +
        tbl(
          [
            "항목",
            "사업",
            { t: "월 예산", r: 1 },
            { t: "실적", r: 1 },
            "사용률",
            { t: "남은 금액", r: 1 },
            "담당",
            { t: "", r: 1 },
          ],
          g.it
            .map(
              (b) =>
                `<tr><td><b>${esc(b.name)}</b><span class="sub2" title="${esc(b.memo)}">${[SRC_LABEL[b.source], srcText(b).split(" · ").slice(1).join(" · "), b.act != null && b.source !== "manual" && b.source !== "instructor" ? `${b.n}건` : "", b.memo ? esc(b.memo) : ""].filter(Boolean).join(" · ")}</span></td><td>${b.biz === "any" ? '<span class="muted small">전체</span>' : bz(b.biz)}</td><td class="r">${won(b.amount)}</td><td class="r">${b.source === "manual" ? `<button class="rowbtn" data-act="bact" data-v="${b.id}" title="${ymLabel(BM)} 실적 입력">${b.act != null ? won(b.act) : '<span style="color:var(--accent-fg);font-weight:700">입력하기</span>'}</button>` : b.act != null ? won(b.act) : '<span class="muted">-</span>'}</td><td>${budgetUsageCell(b)}</td><td class="r">${b.act != null ? (b.amount - b.act < 0 ? `<span style="color:var(--bad)">${won(b.amount - b.act)}</span>` : won(b.amount - b.act)) : '<span class="muted">-</span>'}</td><td>${esc(b.owner || "")}</td><td class="r"><button class="btn sm" data-act="bedit" data-v="${b.id}" aria-label="${esc(b.name)} 수정">수정</button></td></tr>`,
            )
            .join("") ||
            `<tr><td colspan="8"><div class="empty" style="border:0">항목이 없습니다. <button class="btn sm" data-act="bedit" data-v="" data-t="${t}">${TYPES[t].n} 항목 추가</button></div></td></tr>`,
          g.it.length
            ? `<tr><td colspan="2">${TYPES[t].n} 합계</td><td class="r">${won(g.b)}</td><td class="r">${won(g.a)}</td><td>${g.b ? budgetUsageCell({ amount: g.b, act: g.a, source: "x" }) : ""}</td><td class="r">${won(g.b - g.a)}</td><td colspan="2"></td></tr>`
            : "",
          "nw",
        ) +
        `</section>`
      );
    };
    const neg = N.net < 0;
    return (
      head(
        "예산 관리",
        "들어온 돈에서 고정비·변동비·인건비를 빼서 매달 남는 돈(순수익)을 봅니다",
        `<button class="btn sm" data-act="csv" data-v="budget">CSV 내보내기</button><button class="btn pri sm" data-act="bedit" data-v="">항목 추가</button>`,
      ) +
      (DB.budget.length
        ? ""
        : '<div class="empty"><b>아직 예산 항목이 없습니다</b><p>기본 항목은 예산 0원으로 시작합니다.</p><button class="btn pri sm" data-act="bdefaults">기본 항목으로 시작</button></div>') +
      `<div class="toolbar"><div class="pctl"><div class="mpick"><button class="btn sm icon" data-act="bstep" data-v="-1" aria-label="이전 달" ${i <= 0 ? "disabled" : ""}>‹</button><label class="vh" for="bmonth">월 선택</label><select class="sel" id="bmonth" data-change="bmonth">${[
        ...MONTHS,
      ]
        .reverse()
        .map(
          (m) =>
            `<option value="${m}" ${m === BM ? "selected" : ""}>${ymLabel(m)}${m === TODAY.slice(0,7) ? " (진행 중)" : ""}</option>`,
        )
        .join(
          "",
        )}</select><button class="btn sm icon" data-act="bstep" data-v="1" aria-label="다음 달" ${i >= MONTHS.length - 1 ? "disabled" : ""}>›</button></div><span class="prange">들어온 돈은 통장 입금일 · 비용은 발생월 기준</span></div></div>` +
      `<section class="netcard" aria-labelledby="nethead"><div class="card-h"><div><h2 id="nethead">${ymLabel(BM)} 순수익${N.partial ? ' <span class="pill">진행 중</span>' : ""}</h2><p class="small muted">들어온 돈 − (고정비 + 변동비 + 인건비)</p></div><div class="small muted">순수익률 ${N.inn ? pct(N.net / N.inn) : "-"}</div></div>
    <div class="netgrid"><div><div class="eq">
      <a class="term inflow" href="#bank" data-act="bankin"><span class="l">들어온 돈</span><span class="v">${won(N.inn)}</span><span class="d"><span>토스 정산 ${won(N.toss)}</span><span>외부 매출 ${won(N.ext)}</span>${DB.netRnd ? `<span>연구비 ${won(N.rnd)}</span>` : ""}</span></a><span class="op" aria-hidden="true">−</span>
      <div class="term"><span class="l">고정비</span><span class="v">${won(N.fixed)}</span><span class="d">임대료·구독·기장료</span></div><span class="op" aria-hidden="true">−</span>
      <div class="term"><span class="l">변동비</span><span class="v">${won(N.variable)}</span><span class="d">광고·강사 정산·외주·촬영</span></div><span class="op" aria-hidden="true">−</span>
      <div class="term"><span class="l">인건비</span><span class="v">${won(N.labor)}</span><span class="d">급여·4대보험·프리랜서</span></div><span class="op" aria-hidden="true">=</span>
      <div class="term result ${neg ? "neg" : ""}"><span class="l">순수익</span><span class="v" style="${neg ? "color:var(--bad)" : ""}">${won(N.net)}</span><span class="d">${neg ? "들어온 돈보다 비용이 많음" : "남은 돈"}</span></div></div>
      <div class="netnotes">
       ${N.missing ? `<span>${pill("warn", `실적 없음 ${N.missing}개`)} 이 항목들은 0으로 계산 — 순수익이 실제보다 높게 보일 수 있습니다</span>` : ""}
       ${N.poIssue.length ? `<span>${pill("bad", `정산 확인 필요 ${N.poIssue.length}건`)} 통장에 안 들어온 토스 정산은 들어온 돈에서 빠져 있습니다 · <a href="#settlements" data-act="stlfocus">확인</a></span>` : ""}
       ${!connected && BM === "2026-07" ? '<span class="muted">예시 데이터가 7/1부터라 7월 들어온 돈에 6월 매출분 정산 일부가 빠져 있습니다</span>' : ""}
       ${M.bUnc.length ? `<span>${pill("warn", `통장 미분류 출금 ${M.bUnc.length}건`)} 분류하면 비용에 들어갑니다 · <a href="#bank" data-act="bankunc">분류</a></span>` : ""}
       ${netBank().some((x) => x.cat === "연구비") ? `<label class="small rndt"><input type="checkbox" data-change="netrnd" ${DB.netRnd ? "checked" : ""}><span><b>연구비 입금도 들어온 돈에 넣기</b> · ${N.rnd ? `${mLabel(BM)} ${won(N.rnd)}` : `${mLabel(BM)}에는 연구비 입금 없음`}<br><span class="muted">연구비는 매출이 아니라 기본은 뺍니다. 연구비 통장에서 나간 인건비는 비용에 들어 있습니다.</span></span></label>` : ""}
       <span class="muted">부가세(토스 수수료·강사 세금계산서)는 돌려받는 돈이라 비용에서 뺐습니다. 카드 대금 출금은 카드 지출로 이미 셌고, 내 통장 간 이체는 넣지 않습니다.</span></div></div>
     <div><div class="small muted" style="margin-bottom:4px">월별 순수익</div>${netChart(trend)}</div></div></section>` +
      (!M.cardOk
        ? `<div class="callout warn"><b>${ymLabel(BM)} 카드 내역이 아직 없습니다</b><span class="grow">카드로 나가는 항목의 실적은 카드 내역을 올리면 채워집니다.</span><button class="btn sm" data-act="upload">카드 내역 올리기</button></div>`
        : M.partial
          ? `<div class="callout warn"><b>카드 내역은 ${mdS(M.cu)}까지</b><span class="grow">그 뒤 지출은 아직 실적에 없습니다.</span></div>`
          : "") +
      `<div class="tiles t4" style="margin-bottom:8px">
     <div class="tile"><span class="l">${mLabel(BM)} 예산</span><span class="v">${man(tot)}</span><span class="d">실적 ${won(act)} · ${tot ? pct(act / tot) : "-"} 사용</span></div>
     ${["fixed", "variable", "labor"]
       .map((t) => {
         const g = byT(t);
         return `<div class="tile"><span class="l">${TYPES[t].n}</span><span class="v">${man(g.a)}</span><span class="d" style="display:flex;flex-direction:column;gap:6px">예산 ${won(g.b)}${g.b ? budgetUsageCell({ amount: g.b, act: g.a, source: "x" }) : ""}</span></div>`;
       })
       .join("")}
   </div>` +
      (M.unc.length || M.unassigned.length || M.dup.length
        ? `<div class="card flat" style="margin-top:14px"><div class="card-h"><h3>예산에 안 잡힌 카드 지출</h3></div>${M.unc.length ? `<div class="li"><div class="t"><b>미분류 ${M.unc.length}건 · ${won(sum(M.unc, (x) => x.krw))}</b><div class="s">계정과목을 정하면 예산에 들어갑니다</div></div><div class="a"><button class="btn sm" data-act="cardtodo">분류하러 가기</button></div></div>` : ""}${M.unassigned.length ? `<div class="li"><div class="t"><b>항목 없는 계정과목 ${M.unassigned.length}건 · ${won(sum(M.unassigned, (x) => x.krw))}</b><div class="s">${[...new Set(M.unassigned.map((x) => cls(x).cat))].join(" · ")}</div></div><div class="a"><button class="btn sm" data-act="bedit" data-v="">항목 추가</button></div></div>` : ""}${M.dup.length ? `<div class="li"><div class="t"><b>두 항목에 같이 잡힌 지출 ${M.dup.length}건</b><div class="s">항목의 계정과목·사업 조건이 겹칩니다</div></div></div>` : ""}</div>`
        : "") +
      group("fixed") +
      group("variable") +
      group("labor")
    );
  }

  /* ================= 서랍 · 창 ================= */
  function startBudgetDefaults() {
    if (DB.budget.length) return;
    DB.budget = defaultBudget().map((item) => ({
      ...item,
      id:connected?newId():item.id,
      amount: 0,
      actual: {},
      owner: "",
    }));
  }
  if (!root)
    return {
      renderPage(page) { return ({overview:vOverview,sales:vSales,settlements:vSettlements,bank:vBank,cards:vCards,recurring:vRecurring,budget:vBudget})[page](); },
      netOf,
      budgetMonth,
      startBudgetDefaults,
      settlementRows,
      range,
      prevRange,
      salesRows,
      extRows,
      bankRows,
      crState,
      cls,
      rebuild,
      get state() {
        return DB;
      },
      snapshot,
      get transactions() {
        return TX;
      },
      get cards() {
        return CR;
      },
      get payouts() {
        return PO;
      },
      period: P,
      setBusiness(value) {
        BIZF = value;
      },
    };
  const layer = getId("layer");
  let lastFocus = null;
  function closeLayer() {
    importFlow.cancel();
    layer.innerHTML = cleanHTML("");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    else getId("view").focus();
    lastFocus = null;
  }
  function drawer(title, sub, body, foot = "") {
    if (!layer.innerHTML) lastFocus = document.activeElement;
    layer.innerHTML = cleanHTML(`<div class="scrim" data-act="close"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-h"><div><h2>${title}</h2>${sub ? `<p class="small muted" style="margin-top:2px">${sub}</p>` : ""}</div><button class="x" data-act="close" aria-label="닫기">✕</button></div><div class="drawer-b">${body}</div>${foot ? `<div class="drawer-f">${foot}</div>` : ""}</section>`);
    layer.querySelector(".drawer .x").focus();
  }
  function modal(title, body, foot) {
    if (!layer.innerHTML) lastFocus = document.activeElement;
    closeModal();
    layer.insertAdjacentHTML(
      "beforeend",
      cleanHTML(`<div class="scrim modal-scrim" data-act="closemodal"></div><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><h2>${title}</h2><button class="x" data-act="closemodal" aria-label="닫기">✕</button></div><div class="mbody">${body}</div><div class="mf">${foot}</div></section>`),
    );
    const f = layer.querySelector(
      ".modal input:not([type=hidden]):not([type=radio]):not([type=checkbox]),.modal select,.modal textarea",
    );
    (f || layer.querySelector(".modal .x")).focus();
  }
  function closeModal() {
    const had = layer.querySelector(".modal");
    layer.querySelectorAll(".modal,.modal-scrim").forEach((e) => e.remove());
    if (had) {
      const target =
        layer.querySelector(".drawer .x") ||
        (lastFocus && document.contains(lastFocus) ? lastFocus : getId("view"));
      target?.focus();
      if (!layer.innerHTML.trim()) lastFocus = null;
    }
  }
  let toastT;
  function toast(m) {
    const t = getId("toast");
    t.textContent = m;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 2800);
  }
  const bizOpts = (sel, list) =>
    list
      .map(
        ([v, l]) =>
          `<option value="${v}" ${sel === v ? "selected" : ""}>${l}</option>`,
      )
      .join("");

  function openTx(id) {
    const t = txById(id);
    if (!t) return;
    const q = DB.refunds[id];
    const settlement=connected?ST.find(s=>s.tx.id===id&&!s.cancel):null;
    const pay = connected?settlement?.pay:t.status === "입금 대기" ? null : addBiz(t.date, 3);
    const tl = [
      [`${md(t.date)} ${t.time}`, "결제 승인", won(t.amount)],
      t.cancel
        ? [
            md(t.cancelDate),
            t.status === "부분 취소" ? "부분 취소" : "취소",
            won(-t.cancel),
          ]
        : null,
      pay
        ? [
            md(pay),
            pay <= TODAY ? "정산 지급" : "정산 지급 예정",
            won(connected?settlement.amount-settlement.fee:t.amount-t.fee),
          ]
        : null,
    ].filter(Boolean);
    let rf = "";
    if (q) {
      rf = `<div class="card" style="border:2px solid ${q.state === "승인 대기" ? "var(--bad)" : "var(--line)"}"><div class="card-h"><h3>환불 요청 · ${q.state}</h3>${pill(q.state === "승인 대기" ? "bad" : q.state === "반려" ? "none" : "good", q.type + " " + won(q.amount))}</div><dl class="kv"><dt>요청</dt><dd>${esc(q.by)} · ${esc(q.at)}</dd><dt>사유</dt><dd>${esc(q.reason)}</dd><dt>승인하면</dt><dd>모의 취소 (${q.type} ${won(q.amount)}) · 실제 결제 취소나 고객 안내는 실행하지 않습니다</dd></dl>${q.state === "승인 대기" ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn danger sm" data-act="refreject" data-v="${id}" ${q.by === ACTOR ? "disabled" : ""}>반려</button><button class="btn pri sm" data-act="refok" data-v="${id}" ${q.by === ACTOR ? 'disabled title="요청자는 승인할 수 없습니다"' : ""}>모의 승인·취소</button></div>` : ""}</div>`;
    }
    drawer(
      esc(t.product),
      `${BIZ[t.biz].name} · ${t.id}`,
      `${rf}
   <div class="tiles t3"><div class="tile"><span class="l">결제 금액</span><span class="v">${won(t.amount)}</span></div><div class="tile"><span class="l">취소</span><span class="v">${t.cancel ? won(-t.cancel) : "-"}</span></div><div class="tile"><span class="l">PG 수수료</span><span class="v">${connected&&!t.feeKnown?"미확인":won(t.fee)}</span></div></div>
   <dl class="kv"><dt>상태</dt><dd>${pill(TX_KIND[t.status], t.status)}</dd><dt>결제수단</dt><dd>${esc(t.method)}${t.issuer ? " · " + esc(t.issuer) + "카드" : ""}</dd><dt>승인번호</dt><dd class="mono">${esc(t.approval)}</dd><dt>고객</dt><dd>${esc(t.cust)}</dd><dt>결제 키</dt><dd class="mono">${connected?"":"tgen_"}••••${esc(t.key)}</dd><dt>유입</dt><dd>${t.src === "미기록" ? pill("warn", "미기록") : esc(t.src)}</dd><dt>정산 지급일</dt><dd>${pay ? md(pay) : "정산 자료 확인 전"}</dd></dl>
   <div><h3 style="margin-bottom:6px">이력</h3>${tl.map((x) => `<div class="li"><div class="t"><b>${x[1]}</b><div class="s">${x[0]}</div></div><div class="a num">${x[2]}</div></div>`).join("")}</div>`,
      `${!q && t.status === "완료" ? `<button class="btn sm" data-act="refreq" data-v="${id}">환불 요청</button>` : ""}<button class="btn pri sm" data-act="close">닫기</button>`,
    );
  }
  function openPo(id) {
    const p = PO.find((x) => x.id === id);
    if (!p) return;
    const issue = p.state === "미확인" || p.state === "금액 다름";
    const br = bankRows().find(
      (r) => r.link && r.link.type === "po" && r.link.id === p.id,
    );
    drawer(
      `${md(p.pay)} 지급 · ${BIZ[p.biz].name}`,
      `매출일 ${md(p.soldFrom)}${p.soldFrom !== p.soldTo ? " – " + md(p.soldTo) : ""} · ${p.count}건`,
      `<div class="tiles t3"><div class="tile"><span class="l">결제 금액</span><span class="v">${won(p.amount)}</span></div><div class="tile"><span class="l">수수료</span><span class="v">${won(-p.fee)}</span><span class="d">공급가 ${won(p.supply)} · 부가세 ${won(p.vat)}</span></div><div class="tile"><span class="l">지급 금액</span><span class="v">${won(p.payout)}</span></div></div>
   <div class="card" style="${issue ? "border:2px solid var(--bad)" : ""}"><div class="card-h"><h3>KB국민은행 입금${br ? " · " + esc(acctName(br.acct)) + " 통장" : ""}</h3>${pill(PO_KIND[p.state], p.state)}</div>
    ${
      br
        ? `<dl class="kv"><dt>입금</dt><dd>${md(br.date)} ${br.time}</dd><dt>적요</dt><dd>${esc(br.desc)}</dd><dt>금액</dt><dd>${won(br.in)}${br.in !== p.payout ? ` · <b style="color:var(--bad)">차이 ${won(br.in - p.payout)}</b>` : ""}</dd></dl>`
        : p.state === "미확인" || (p.state === "사유 기록" && !br)
          ? `<p class="small fg2">지급일 ${md(p.pay)}이 지났는데 통장에서 같은 금액을 확인하지 못했습니다. ${connected?"지급일·상점·금액이 일치하는 단일 거래만 자동 연결합니다. 분할·날짜 차이는 통장 내역에서 직접 연결하세요.":"지급일 ±1영업일 · 같은 상점으로 찾았습니다."}</p>`
          : `<p class="small fg2">${p.state === "지급 예정" ? "아직 지급일 전입니다." : connected?"통장 파일을 가져온 뒤 다시 확인해 주세요.":"오늘 입금분은 다음 동기화에 확인됩니다."}</p>`
    }
    ${p.note ? `<dl class="kv" style="margin-top:8px"><dt>기록한 사유</dt><dd>${esc(p.note.reason)}${p.note.memo ? " · " + esc(p.note.memo) : ""} (${esc(p.note.by)} · ${esc(p.note.at)})</dd></dl>` : ""}
    ${issue ? `<div class="field" style="margin-top:12px"><label for="podiff">차이 사유</label><select class="input" id="podiff"><option value="">고르기</option><option>토스 지급 보류</option><option>환불 차감</option><option>다른 날짜에 합쳐 입금</option><option>기타</option></select></div><div class="field" style="margin-top:8px"><label for="pomemo">메모</label><input class="input" id="pomemo" placeholder="예: 토스 고객센터 문의 10/7"></div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn pri sm" data-act="ponote" data-v="${p.id}">사유 기록</button></div>` : ""}</div>
   <div><h3 style="margin-bottom:6px">포함된 거래 ${p.items.length}건</h3>${tbl(["매출일", "주문번호", { t: "금액", r: 1 }, { t: "수수료", r: 1 }], p.items.map((e) => `<tr><td class="num">${mdS(e.sold)}</td><td class="mono small">${e.tx.id}${e.cancel ? " " + pill("warn", "취소") : ""}</td><td class="r">${won(e.amount)}</td><td class="r">${won(-e.fee)}</td></tr>`).join(""), "", "nw")}</div>`,
      `<button class="btn pri sm" data-act="close">닫기</button>`,
    );
  }
  function openBank(id) {
    const x = bankRows().find((r) => r.id === id);
    if (!x) return;
    const isIn = x.in > 0;
    const cats = isIn ? BANK_CATS_IN : BANK_CATS_OUT;
    const candExt = isIn
      ? DB.ext.filter(
          (e) =>
            !extPaidRow(e.id) &&
            Math.abs(extInfo(e).total - x.in) <= Math.max(1000, x.in * 0.03),
        )
      : [];
    const pcx = x.link
        ? null
        : pairCands().find((p) => p[0].id === x.id || p[1].id === x.id),
      pco = pcx ? (pcx[0].id === x.id ? pcx[1] : pcx[0]) : null;
    drawer(
      esc(x.desc),
      `${md(x.date)} ${x.time} · ${esc(acctOf(x.acct) ? acctOf(x.acct).bank : "")} ${esc(acctName(x.acct))} 통장`,
      `<div class="tiles t3"><div class="tile"><span class="l">${isIn ? "입금" : "출금"}</span><span class="v" style="${isIn ? "color:var(--good)" : ""}">${isIn ? "+" + won(x.in) : won(-x.out)}</span></div><div class="tile"><span class="l">거래 후 잔액</span><span class="v">${x.bal==null?"미확인":won(x.bal)}</span></div><div class="tile"><span class="l">분류</span><span class="v" style="font-size:15px">${x.cat === "미분류" || !x.cat ? pill("warn", "미분류") : esc(x.cat)}</span></div></div>
   <div class="field"><label for="bkc">분류</label><select class="input" id="bkc"><option value="미분류">미분류</option>${cats.map((c) => `<option ${x.cat === c ? "selected" : ""}>${c}</option>`).join("")}</select><span class="hint">${isIn ? "토스 정산·외부 매출 입금이 월 순수익의 '들어온 돈'이 됩니다 · 연구비는 따로 봅니다" : "예산 관리에서 '통장 출금' 항목이 이 분류를 읽습니다"}</span></div>
   <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="bkrule"> 적요에 '${esc(x.desc)}'가 들어간 거래는 앞으로 같은 분류로</label>
   ${pco ? `<div class="card flat" style="border:2px solid var(--accent)"><div class="card-h"><h3>내 통장 간 이체로 보입니다</h3></div><p class="small fg2" style="margin:4px 0 10px">${esc(acctName(pco.acct))} 통장 ${md(pco.date)} ${pco.in ? "+" + won(pco.in) : won(-pco.out)} · 같은 금액이 한쪽에서 나가고 다른 쪽으로 들어왔습니다. 묶으면 입출금 합계·순수익에서 빠집니다.</p><button class="btn sm pri" data-act="bkpair" data-v="${x.out ? x.id : pco.id}" data-o="${x.out ? pco.id : x.id}">이체로 묶기</button></div>` : ""}
   ${x.link ? `<div class="card flat"><h3>연결</h3><p class="small fg2" style="margin-top:4px">${linkText(x)}</p></div>` : ""}
   ${connected&&isIn&&x.link?.type!=="xfer"?`<div class="card flat"><div class="field"><label for="bkPayout">토스 정산에 직접 연결</label><select id="bkPayout" class="input"><option value="">정산 선택</option>${PO.map(p=>`<option value="${esc(p.id)}" ${x.link?.type==="po"&&x.link.id===p.id?"selected":""}>${esc(p.pay)} · ${esc(BIZ[p.biz].name)} · ${won(p.payout)}</option>`).join("")}</select><span class="hint">분할 입금은 여러 거래를 같은 정산에 연결합니다. 합계와 지급 금액의 차이는 정산입금에서 확인합니다.</span></div><button class="btn sm pri" data-act="bkpaylink" data-v="${x.id}">정산 연결 저장</button>${x.link?` <button class="btn sm" data-act="bkunlink" data-v="${x.id}">연결 해제</button>`:""}</div>`:""}
   ${isIn && !x.link && x.cat !== XFER ? `<div class="card flat"><div class="card-h"><h3>이 입금은 무엇인가요?</h3></div>${candExt.length ? candExt.map((e) => `<div class="li"><div class="t"><b>${esc(e.title)}</b><div class="s">${EXT_TYPES[e.type]} · ${won(extInfo(e).total)} · ${md(e.due)} 예정</div></div><div class="a"><button class="btn sm" data-act="bklink" data-v="${x.id}" data-e="${e.id}">이 매출로 연결</button></div></div>`).join("") : '<p class="small muted">금액이 맞는 외부 매출이 없습니다.</p>'}<div style="margin-top:10px"><button class="btn sm pri" data-act="extfrombank" data-v="${x.id}">외부 매출로 새로 등록</button></div></div>` : ""}`,
      `<button class="btn sm" data-act="close">취소</button><button class="btn pri sm" data-act="bksave" data-v="${x.id}">저장</button>`,
    );
  }
  function openCr(id) {
    const x = CR.find((r) => r.id === id);
    if (!x) return;
    const c = cls(x),
      cd = cardOf(x.card),
      s = crState(x);
    drawer(
      esc(x.merchant),
      `${md(x.date)} ${x.time} · ${esc(cd.name)} ••${cd.last} · ${esc(cd.user)}`,
      `<div class="tiles t3"><div class="tile"><span class="l">금액</span><span class="v">${won(x.krw)}</span>${x.cur ? `<span class="d">${usd(x.fx)} · 원화는 청구 때 바뀔 수 있음</span>` : ""}</div><div class="tile"><span class="l">상태</span><span class="v" style="font-size:15px">${pill(CR_KIND[s], s)}</span></div><div class="tile"><span class="l">분류</span><span class="v" style="font-size:15px">${c.rule ? "규칙" : "직접"}</span><span class="d">${c.rule ? esc(c.rule) : ""}</span></div></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="ccat">계정과목</label><select class="input" id="ccat"><option value="">미분류</option>${CATS.map((k) => `<option ${c.cat === k ? "selected" : ""}>${k}</option>`).join("")}</select></div><div class="field"><label for="cbiz">사업</label><select class="input" id="cbiz"><option value="">고르기</option>${bizOpts(
     c.biz,
     [
       ["common", "공통"],
       ["edu", "브랜디에듀"],
       ["myin", "마이인 진단"],
       ["hm", "하루멜라"],
     ],
   )}</select></div></div>
   <div class="field"><label for="cmemo">사용 목적</label><input class="input" id="cmemo" value="${esc(c.memo)}" placeholder="예: 외부 미팅 (참석 3명) · 촬영 소품"></div>
   ${x.cur ? "" : `<div class="field"><label for="cvat">부가세</label><select class="input" id="cvat">${VATS.map((v) => `<option ${c.vat === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>`}
   <div class="field"><span class="lb">영수증</span>${["지급임차료", "외주용역비", "접대비"].includes(c.cat) ? (c.receipt ? `<div>${pill("good", "붙음")}${connected?` <button class="btn sm" data-act="rcpview" data-v="${x.id}">보기</button>`:""} <button class="btn sm ghost" data-act="rcpoff" data-v="${x.id}">떼기</button></div>` : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="btn sm" for="crf">사진·PDF 올리기</label><input type="file" id="crf" accept="image/*,.pdf" hidden data-change="rcp" data-v="${x.id}"><span class="small muted">대관·외주·접대는 영수증을 함께 둡니다</span></div>`) : '<span class="small muted">필요 없음 (카드 매출전표로 충분)</span>'}</div>
   <dl class="kv"><dt>승인번호</dt><dd class="mono">${x.appr}</dd><dt>카드 사용자</dt><dd>${esc(cd.user)}</dd></dl>
   ${!c.rule ? `<div class="card flat"><h3>이 가맹점 규칙 만들기</h3><p class="small fg2" style="margin:4px 0 8px">가맹점에 '${esc(x.merchant.split(" ")[0])}'가 들어가면 앞으로 같은 계정과목·사업으로 정합니다.</p><button class="btn sm" data-act="rulefrom" data-v="${x.id}">규칙 만들기</button></div>` : ""}`,
      `<button class="btn sm" data-act="close">취소</button><button class="btn pri sm" data-act="crsave" data-v="${x.id}">저장</button>`,
    );
  }
  function extModal(id, pre) {
    const e = id
      ? DB.ext.find((x) => x.id === id)
      : Object.assign(
          {
            id: "",
            type: "outsource",
            biz: "ba",
            title: "",
            client: "",
            date: TODAY,
            usd: "",
            supply: "",
            vat: "",
            due: "",
            invoice: "",
            memo: "",
          },
          pre || {},
        );
    const i = id ? extInfo(e) : null;
    const yt = e.type === "youtube";
    modal(
      id ? "외부 매출 수정" : "외부 매출 추가",
      `
   <div class="field"><span class="lb">종류</span><div class="radios" role="radiogroup" aria-label="종류">${Object.entries(
     EXT_TYPES,
   )
     .map(
       ([k, l]) =>
         `<label class="radio"><input type="radio" name="etype" value="${k}" ${e.type === k ? "checked" : ""}>${l}</label>`,
     )
     .join("")}</div></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="etitle">내용</label><input class="input" id="etitle" value="${esc(e.title)}" placeholder="${yt ? "예: 유튜브 애드센스 10월분" : "예: C사 콘텐츠 제작"}"></div><div class="field"><label for="eclient">거래처</label><input class="input" id="eclient" value="${esc(e.client)}" placeholder="${yt ? "Google AdSense" : "예: C사"}"></div></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="ebiz">사업</label><select class="input" id="ebiz">${bizOpts(
     e.biz,
     [
       ["ba", "브랜디액션"],
       ["edu", "브랜디에듀"],
       ["myin", "마이인 진단"],
       ["hm", "하루멜라"],
     ],
   )}</select></div><div class="field"><label for="edate">매출일</label><input class="input" type="date" id="edate" value="${e.date}"><span class="hint">${yt ? "수익이 생긴 달의 마지막 날" : "세금계산서 작성일 또는 용역 완료일"}</span></div></div>
   <div id="eyt" ${yt ? "" : "hidden"}><div class="grid2" style="gap:12px"><div class="field"><label for="eusd">확정 수익 (USD)</label><input class="input" id="eusd" inputmode="decimal" value="${e.usd ?? ""}" placeholder="예: 1290.00"><span class="hint">입금 전에는 환율 ${FX.toLocaleString("ko-KR")}원으로 예상 원화를 보여 줍니다</span></div><div class="field"><span class="lb">원화</span><div class="formula" id="eykrw">${i && !i.est ? `${won(i.total)} (입금액)` : "입금되면 통장 금액으로"}</div></div></div></div>
   <div id="eout" ${yt ? "hidden" : ""}><div class="grid2" style="gap:12px"><div class="field"><label for="esupply">공급가액 (원)</label><input class="input" id="esupply" inputmode="numeric" value="${e.supply !== "" && e.supply != null ? fmtIn(e.supply) : ""}" placeholder="0"></div><div class="field"><label for="evat">부가세 (원)</label><input class="input" id="evat" inputmode="numeric" value="${e.vat !== "" && e.vat != null ? fmtIn(e.vat) : ""}" placeholder="공급가액의 10%"><span class="hint"><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="evatauto" ${id ? "" : "checked"}> 10% 자동</label></span></div></div>
     <div class="field" style="margin-top:12px"><label for="einv">세금계산서</label><input class="input" id="einv" value="${esc(e.invoice)}" placeholder="예: 10/7 발행 · 승인번호"></div></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="edue">입금 예정일</label><input class="input" type="date" id="edue" value="${e.due || ""}"></div><div class="field"><label for="ememo">메모</label><input class="input" id="ememo" value="${esc(e.memo)}"></div></div>
   ${i ? `<div class="formula">입금 상태: ${i.state}${i.paid ? ` · ${md(i.paid)} 통장 입금 ${won(i.row.in)}` : ""}</div>` : ""}
   ${pre && pre.bankId ? `<div class="formula">저장하면 통장 입금(${md(pre.bankDate)} ${won(pre.bankAmt)})과 연결됩니다</div>` : ""}
   <p class="small" id="eerr" role="alert" style="color:var(--bad)"></p>`,
      `${id ? `<button class="btn sm danger left" data-act="extdel" data-v="${id}">삭제</button>` : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="extsave" data-v="${id}" ${pre && pre.bankId ? `data-bank="${pre.bankId}"` : ""}>저장</button>`,
    );
    const m = layer.querySelector(".modal");
    m.querySelectorAll("input[name=etype]").forEach((r) =>
      r.addEventListener("change", () => {
        const y =
          m.querySelector("input[name=etype]:checked").value === "youtube";
        getId("eyt").hidden = !y;
        getId("eout").hidden = y;
      }),
    );
    const sp = getId("esupply"),
      vt = getId("evat");
    if (sp) {
      sp.addEventListener("input", () => {
        if (getId("evatauto").checked) {
          const n = parseNum(sp.value);
          vt.value = isNaN(n) ? "" : fmtIn(Math.round(n * 0.1));
        }
      });
      sp.addEventListener("blur", () => {
        const n = parseNum(sp.value);
        if (!isNaN(n)) sp.value = fmtIn(n);
      });
    }
  }
  function ruleModal(id, pre) {
    const x = id
      ? DB.rules.find((r) => r.id === id)
      : Object.assign(
          {
            id: "",
            name: "",
            kw: [],
            cat: "",
            biz: "common",
            vat: "공제 예상",
            memo: "",
            on: true,
          },
          pre || {},
        );
    const pos = id ? DB.rules.indexOf(x) + 1 : DB.rules.length + 1;
    modal(
      id ? "분류 규칙 수정" : "분류 규칙 추가",
      `
   <div class="field"><label for="rname">규칙 이름</label><input class="input" id="rname" value="${esc(x.name)}" placeholder="예: 메타 광고"></div>
   <div class="field"><label for="rkw">가맹점에 들어가는 말</label><input class="input" id="rkw" value="${esc(x.kw.join(", "))}" placeholder="쉼표로 구분 · 예: META, FACEBK"><span class="hint" id="rhit">맞는 카드 내역: ${CR.filter((c) => x.kw.some((k) => k && c.merchant.toUpperCase().includes(k.toUpperCase()))).length}건</span></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="rcat">계정과목</label><select class="input" id="rcat"><option value="">고르기</option>${CATS.map((k) => `<option ${x.cat === k ? "selected" : ""}>${k}</option>`).join("")}</select></div><div class="field"><label for="rbiz">사업</label><select class="input" id="rbiz">${bizOpts(
     x.biz,
     [
       ["common", "공통"],
       ["edu", "브랜디에듀"],
       ["myin", "마이인 진단"],
       ["hm", "하루멜라"],
     ],
   )}</select></div></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="rvat">부가세</label><select class="input" id="rvat">${VATS.map((v) => `<option ${x.vat === v ? "selected" : ""}>${v}</option>`).join("")}</select><span class="hint">해외 결제는 자동으로 '해당 없음'</span></div><div class="field"><label for="rmemo">사용 목적 자동 입력</label><input class="input" id="rmemo" value="${esc(x.memo)}" placeholder="비워 두면 사람이 입력"></div></div>
   <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ron" ${x.on ? "checked" : ""}> 이 규칙 쓰기 · 순서 ${pos}번째</label>
   <p class="small" id="rerr" role="alert" style="color:var(--bad)"></p>`,
      `${id ? `<button class="btn sm danger left" data-act="ruledel" data-v="${id}">삭제</button>` : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="rulesave" data-v="${id}">저장</button>`,
    );
    getId("rkw").addEventListener("input", (ev) => {
      const kw = ev.target.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      getId("rhit").textContent =
        `맞는 카드 내역: ${CR.filter((c) => kw.some((k) => c.merchant.toUpperCase().includes(k.toUpperCase()))).length}건`;
    });
  }
  function budgetModal(id, type) {
    const b = id
      ? DB.budget.find((x) => x.id === id)
      : {
          id: "",
          type: type || "variable",
          name: "",
          biz: "any",
          amount: "",
          source: "card",
          cats: [],
          bcats: [],
          owner: "",
          memo: "",
        };
    const sys = b.source === "instructor";
    modal(
      id ? "예산 항목 수정" : "예산 항목 추가",
      `
   <div class="field"><span class="lb">구분</span><div class="radios" role="radiogroup" aria-label="구분">${Object.entries(
     TYPES,
   )
     .map(
       ([k, v]) =>
         `<label class="radio"><input type="radio" name="btype" value="${k}" ${b.type === k ? "checked" : ""}>${v.n}</label>`,
     )
     .join(
       "",
     )}</div><span class="hint" id="btypehint">${TYPES[b.type].d}</span></div>
   <div class="field"><label for="bname">항목 이름</label><input class="input" id="bname" value="${esc(b.name)}" placeholder="예: 광고비 · 하루멜라"></div>
   <div class="grid2" style="gap:12px"><div class="field"><label for="bamt">월 예산 (원)</label><input class="input" id="bamt" inputmode="numeric" value="${b.amount === "" ? "" : fmtIn(b.amount)}" placeholder="0"></div><div class="field"><label for="bbiz2">사업</label><select class="input" id="bbiz2">${bizOpts(
     b.biz,
     [
       ["any", "전체"],
       ["common", "공통"],
       ["edu", "브랜디에듀"],
       ["myin", "마이인 진단"],
       ["hm", "하루멜라"],
     ],
   )}</select></div></div>
   ${
     sys
       ? `<div class="field"><span class="lb">실적 가져오기</span><div class="formula">자동</div></div>`
       : `<div class="field"><span class="lb">실적 가져오기</span><div class="radios" role="radiogroup" aria-label="실적 가져오기"><label class="radio"><input type="radio" name="bsrc" value="card" ${b.source === "card" ? "checked" : ""}>카드 지출</label><label class="radio"><input type="radio" name="bsrc" value="bank" ${b.source === "bank" ? "checked" : ""}>통장 출금</label><label class="radio"><input type="radio" name="bsrc" value="manual" ${b.source === "manual" ? "checked" : ""}>직접 입력</label></div></div>
   <div class="field" id="bcatsF" ${b.source === "card" ? "" : "hidden"}><span class="lb">카드 계정과목 (하나 이상)</span><div class="checks">${CATS.map((k) => `<label><input type="checkbox" name="bcats" value="${k}" ${(b.cats || []).includes(k) ? "checked" : ""}>${k}</label>`).join("")}</div><span class="hint">사업을 고르면 그 사업으로 분류된 카드 지출만 셉니다</span></div>
   <div class="field" id="bbankF" ${b.source === "bank" ? "" : "hidden"}><span class="lb">통장 출금 분류 (하나 이상)</span><div class="checks">${BANK_CATS_OUT.filter(
     (c) => c !== "카드 대금" && c !== "강사 정산" && c !== XFER,
   )
     .map(
       (k) =>
         `<label><input type="checkbox" name="bbcats" value="${k}" ${(b.bcats || []).includes(k) ? "checked" : ""}>${k}</label>`,
     )
     .join(
       "",
     )}</div><span class="hint">카드 대금·강사 정산은 다른 곳에서 세고, 내 통장 간 이체는 비용이 아니라 고를 수 없습니다 · 순수익 계산에 넣은 통장만 읽습니다</span></div>`
   }
   <div class="grid2" style="gap:12px"><div class="field"><label for="bowner">담당</label><select class="input" id="bowner"><option value="">없음</option>${(connected?[...new Set(CARDS.map(c=>c.user).filter(Boolean).concat(b.owner||[]))]:[ACTOR, "담당 B", "담당 C", "담당 D", "담당 E", "담당 F", "담당 G"]).map((n) => `<option ${b.owner === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div><div class="field"><label for="bmemo">메모</label><input class="input" id="bmemo" value="${esc(b.memo)}"></div></div>
   <p class="small" id="berr" role="alert" style="color:var(--bad)"></p>`,
      `${id && !sys ? `<button class="btn sm danger left" data-act="bdel" data-v="${id}">삭제</button>` : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="bsave" data-v="${id}">저장</button>`,
    );
    const m = layer.querySelector(".modal");
    m.querySelectorAll("input[name=bsrc]").forEach((r) =>
      r.addEventListener("change", () => {
        const v = m.querySelector("input[name=bsrc]:checked").value;
        getId("bcatsF").hidden = v !== "card";
        getId("bbankF").hidden = v !== "bank";
      }),
    );
    m.querySelectorAll("input[name=btype]").forEach((r) =>
      r.addEventListener("change", () => {
        getId("btypehint").textContent =
          TYPES[m.querySelector("input[name=btype]:checked").value].d;
      }),
    );
    const a = getId("bamt");
    a.addEventListener("blur", () => {
      const n = parseNum(a.value);
      if (a.value.trim() && !isNaN(n)) a.value = fmtIn(n);
    });
  }
  function actualModal(id) {
    const b = DB.budget.find((x) => x.id === id);
    const v = b.actual && b.actual[BM];
    modal(
      `${ymLabel(BM)} 실적 입력`,
      `<p class="small fg2"><b>${esc(b.name)}</b> · 월 예산 ${won(b.amount)}</p><div class="field"><label for="aamt">실제 금액 (원)</label><input class="input" id="aamt" inputmode="numeric" value="${v != null ? fmtIn(v) : ""}" placeholder="지급 대장·명세서 기준"><span class="hint">부가세가 붙는 지출은 부가세를 뺀 금액(공급가액)으로 적습니다</span></div><p class="small" id="aerr" role="alert" style="color:var(--bad)"></p>`,
      `${v != null ? '<button class="btn sm danger left" data-act="aclear" data-v="' + id + '">비우기</button>' : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="asave" data-v="${id}">저장</button>`,
    );
  }
  function acctModal(id) {
    const a = id
      ? acctOf(id)
      : {
          id: "",
          bank: "KB국민은행",
          name: "",
          last: "",
          uses: [],
          method: "xl",
          freq: "매시간",
          incl: true,
        };
    const n = id ? bankRows().filter((x) => x.acct === id).length : 0;
    modal(
      id ? `통장 설정 · ${esc(a.name)}` : "통장 추가",
      `
   <div class="grid2" style="gap:12px"><div class="field"><label for="abank">은행</label><select class="input" id="abank">${BANKS.map((b) => `<option ${a.bank === b ? "selected" : ""}>${b}</option>`).join("")}</select></div><div class="field"><label for="aname">통장 이름</label><input class="input" id="aname" value="${esc(a.name)}" placeholder="예: 운영비, 세금 적립"></div></div>
   <div class="field"><label for="alast">계좌번호 끝 4자리</label><input class="input" id="alast" inputmode="numeric" maxlength="4" value="${esc(a.last || "")}" placeholder="예: 1234" style="max-width:200px"><span class="hint">화면에는 ••1234로만 보입니다. 전체 계좌번호는 여기 적지 않습니다</span></div>
   <div class="field"><span class="lb">용도 (여러 개)</span><div class="checks wide">${ACCT_USES.map((u) => `<label><input type="checkbox" name="auses" value="${u}" ${(a.uses || []).includes(u) ? "checked" : ""}>${u}</label>`).join("")}</div></div>
   <div class="field"><span class="lb">연결 방식</span><div class="stack" style="gap:6px">${Object.entries(
     CONN_M,
   )
     .map(
       ([v, l]) =>
         `<label class="radio" style="height:auto;padding:10px 12px;align-items:flex-start"><input type="radio" name="am" value="${v}" ${a.method === v ? "checked" : ""} style="margin-top:3px"><span><b style="font-weight:700">${l}</b><br><span class="small muted" style="font-weight:400">${CONN_D[v]}</span></span></label>`,
     )
     .join("")}</div></div>
   <div class="field"><label for="afreq">자동 가져오기</label><select class="input" id="afreq" style="max-width:240px">${["매시간", "하루 4번", "하루 1번 (07:00)"].map((f) => `<option ${a.freq === f ? "selected" : ""}>${f}</option>`).join("")}</select></div>
   <label class="small" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="aincl" ${a.incl !== false ? "checked" : ""} style="margin-top:2px"><span>순수익·예산 실적 계산에 넣기<br><span class="muted">끄면 이 통장은 잔액만 봅니다 (예: 적금·예비 통장)</span></span></label>
   <p class="small" id="acerr" role="alert" style="color:var(--bad)"></p>`,
      `${id ? `<button class="btn sm danger left" data-act="acctdel" data-v="${id}" data-n="${n}" ${DB.accounts.length <= 1 ? 'disabled title="마지막 통장은 보관할 수 없습니다"' : ""}>보관</button>` : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="acctsave" data-v="${id}">저장</button>`,
    );
    const bk = getId("abank"),
      kb = layer.querySelector("input[name=am][value=kb]");
    const sync = () => {
      const isKB = bk.value === "KB국민은행";
      kb.disabled = !isKB;
      if (!isKB && kb.checked)
        layer.querySelector("input[name=am][value=ob]").checked = true;
    };
    bk.addEventListener("change", sync);
    sync();
  }
  function cardManagement() {
    drawer(
      "카드 관리",
      "카드 이름·담당자 관리 · 실제 카드 발급/해지 없음",
      CARDS.map(
        (c) =>
          `<div class="li"><div class="t"><b>${esc(c.name)} ••${esc(c.last)}</b><div class="s">${esc(c.user)}</div></div><button class="btn sm" data-act="cardedit" data-v="${c.id}">수정</button></div>`,
      ).join(""),
      '<button class="btn sm" data-act="close">닫기</button><button class="btn pri sm" data-act="cardedit" data-v="">카드 추가</button>',
    );
  }
  function cardEdit(id) {
    const card = CARDS.find((c) => c.id === id) || {
      name: "",
      last: "",
      user: "",
    };
    modal(
      id ? "카드 수정" : "카드 추가",
      `<div class="field"><label for="registryName">카드 이름</label><input class="input" id="registryName" maxlength="60" value="${esc(card.name)}"></div><div class="field"><label for="registryLast">끝 4자리</label><input class="input" id="registryLast" inputmode="numeric" maxlength="4" value="${esc(card.last)}"></div><div class="field"><label for="registryUser">사용자</label><input class="input" id="registryUser" maxlength="60" value="${esc(card.user)}"></div><p id="registryError" role="alert" tabindex="-1" class="small" style="color:var(--bad)"></p>`,
      `<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="cardsave" data-v="${id}">저장</button>`,
    );
  }
  function bankRulesPanel() {
    drawer(
      "통장 분류 규칙",
      "적요와 입출금 방향으로 분류합니다. 수동 분류와 이미 연결된 거래는 유지합니다.",
      DB.bankRules
        .map(
          (r, i) =>
            `<div class="li"><div class="t"><b>${i + 1}. ${esc(r.name)}</b><div class="s">${esc(r.keyword)} · ${r.direction === "in" ? "입금" : "출금"} → ${esc(r.cat)} · ${r.on ? "사용" : "꺼짐"}</div></div><div class="a"><button class="btn sm" data-act="bankrulemove" data-v="${r.id}" data-d="-1" aria-label="${esc(r.name)} 위로" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm" data-act="bankrulemove" data-v="${r.id}" data-d="1" aria-label="${esc(r.name)} 아래로" ${i === DB.bankRules.length - 1 ? "disabled" : ""}>↓</button><button class="btn sm" data-act="bankruleedit" data-v="${r.id}">수정</button></div></div>`,
        )
        .join("") ||
        '<div class="empty"><b>분류 규칙이 없습니다</b>자주 쓰는 적요부터 추가하세요.</div>',
      '<button class="btn sm" data-act="close">닫기</button><button class="btn pri sm" data-act="bankruleedit" data-v="">규칙 추가</button>',
    );
  }
  function bankRuleEdit(id) {
    const r = DB.bankRules.find((x) => x.id === id) || {
      name: "",
      keyword: "",
      direction: "out",
      cat: "기타 출금",
      on: true,
    };
    const opts = (direction) =>
      (direction === "in" ? BANK_CATS_IN : BANK_CATS_OUT)
        .filter((x) => x !== XFER)
        .map((x) => `<option ${x === r.cat ? "selected" : ""}>${x}</option>`)
        .join("");
    modal(
      id ? "통장 규칙 수정" : "통장 규칙 추가",
      `<div class="field"><label for="brname">규칙 이름</label><input class="input" id="brname" value="${esc(r.name)}"></div><div class="field"><label for="brkeyword">적요에 들어가는 말</label><input class="input" id="brkeyword" value="${esc(r.keyword)}"></div><div class="grid2"><div class="field"><label for="brdirection">입출금</label><select class="input" id="brdirection"><option value="out" ${r.direction === "out" ? "selected" : ""}>출금</option><option value="in" ${r.direction === "in" ? "selected" : ""}>입금</option></select></div><div class="field"><label for="brcat">분류</label><select class="input" id="brcat">${opts(r.direction)}</select></div></div><label><input type="checkbox" id="bron" ${r.on ? "checked" : ""}> 이 규칙 사용</label><p id="brerr" role="alert" tabindex="-1" class="small" style="color:var(--bad)"></p>`,
      `${id ? `<button class="btn sm danger left" data-act="bankruledel" data-v="${id}">삭제</button>` : ""}<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="bankrulesave" data-v="${id}">저장</button>`,
    );
    getId("brdirection").addEventListener("change", (event) => {
      getId("brcat").innerHTML = cleanHTML(opts(event.target.value));
    });
  }
  const importFlow = createImportFlow({
    connected,
    findMapping:options.findMapping,
    root,
    esc,
    drawer,
    amount: won,
    cards: () => CR.map((x) => ({ ...x, last: cardOf(x.card).last })),
    bank: () => BANK,
    accounts: () => DB.accounts,
    cardRegistry: () => CARDS,
    selectedAccount: () => BK.acct,
    async insert(kind, records, additions, metadata) {
      if(connected){
        saving=true;
        try{liveData=await options.importRows(kind,records,additions,metadata);hydrate(liveData);lastSaved=snapshot();rebuild();}
        finally{saving=false;}
      } else {
      for (const card of additions)
        CARDS.push({ ...card, id: newId() });
      for (const record of records) {
        if (kind === "cards") {
          const card = CARDS.find((c) => c.last === record.last);
          const old=CR.find(c=>c.card===card.id&&c.appr===record.appr&&c.date===record.date);
          if(old){Object.assign(old,{krw:Math.abs(record.krw),canceled:old.canceled||record.krw<0});continue;}
          CR.push({
            ...record,
            krw:Math.abs(record.krw),canceled:record.krw<0,
            id: newId(),
            card: card.id,
            cur: record.fx ? "USD" : null,
            memo: "",
            receipt: false,
            mcat: null,
            mbiz: null,
            rec: false,
          });
        } else
          BANK.push({
            ...record,
            id: newId(),
            cat: "미분류",
            link: null,
          });
      }
      }
      if (records.length) {
        const date = records
          .map((x) => x.date)
          .sort()
          .at(-1);
        if (!MONTHS.includes(date.slice(0, 7))) MONTHS.push(date.slice(0, 7));
        MONTHS.sort();
        P.mode = "month";
        P.month = date.slice(0, 7);
        DB.oct = CR.some((x) => x.date.startsWith("2026-10"));
      }
      if(!connected)await save();
      render();
    },
    finish(kind) {
      closeLayer();
      CS.f = "all";
      CS.card = "all";
      CS.page = 1;
      BK.page = 1;
      go(kind === "cards" ? "cards" : "bank");
    },
  });
  function openUpload() {
    importFlow.open("cards");
  }

  /* ================= 찾기(⌘K) ================= */
  const NAV = [
    [
      "overview",
      "개요",
      '<path d="M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z"/>',
    ],
    ["sales", "매출내역", '<path d="M4 6h16M4 12h16M4 18h10"/>'],
    [
      "settlements",
      "정산입금",
      '<path d="M3 7h18v12H3z"/><path d="M3 11h18M7 15h3"/>',
    ],
    [
      "bank",
      "통장 내역",
      '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
    ],
    [
      "cards",
      "카드지출",
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    ],
    [
      "recurring",
      "정기 결제",
      '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    ],
    [
      "budget",
      "예산 관리",
      '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 3"/>',
    ],
  ];
  function openPalette() {
    lastFocus = document.activeElement;
    layer.innerHTML = cleanHTML(`<div class="scrim pal-scrim" data-act="close"></div><div class="pal" role="dialog" aria-modal="true" aria-label="찾기"><label class="vh" for="palq">찾기</label><input id="palq" placeholder="주문번호 · 상품 · 가맹점 · 통장 적요 · 강사 · 메뉴" autocomplete="off"><div class="res" id="palres"></div></div>`);
    const inp = getId("palq");
    inp.focus();
    palFill("");
    inp.addEventListener("input", () => palFill(inp.value));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const a = root.querySelector("#palres button");
        if (a) a.click();
      }
      if (e.key === "ArrowDown") {
        const a = root.querySelector("#palres button");
        if (a) {
          e.preventDefault();
          a.focus();
        }
      }
    });
  }
  function palFill(q) {
    q = q.trim().toLowerCase();
    const m = (s) => !q || s.toLowerCase().includes(q);
    const W = (n) =>
      BLANK ? "[ ]" : Math.round(n).toLocaleString("ko-KR") + "원";
    const nav = NAV.filter((n) => m(n[1])).map(
      (n) =>
        `<button data-act="go" data-v="${n[0]}">${n[1]}<span>메뉴</span></button>`,
    );
    const ords =
      q.length >= 2
        ? TX.filter((t) => (t.id + " " + t.product).toLowerCase().includes(q))
            .slice(-5)
            .reverse()
            .map(
              (t) =>
                `<button data-act="tx" data-v="${t.id}">${t.id}<span>${t.product} · ${W(t.amount)}</span></button>`,
            )
        : [];
    const exs =
      q.length >= 2
        ? DB.ext
            .filter((e) => (e.title + " " + e.client).toLowerCase().includes(q))
            .slice(0, 5)
            .map(
              (e) =>
                `<button data-act="extedit" data-v="${e.id}">${esc(e.title)}<span>외부 매출 · ${W(extInfo(e).total)}</span></button>`,
            )
        : [];
    const bks =
      q.length >= 2
        ? bankRows()
            .filter((x) => (x.desc + " " + x.cat).toLowerCase().includes(q))
            .slice(-5)
            .reverse()
            .map(
              (x) =>
                `<button data-act="bk" data-v="${x.id}">${esc(x.desc)}<span>${mdS(x.date)} · ${esc(acctName(x.acct))} · ${x.in ? "+" + W(x.in) : "−" + W(x.out)}</span></button>`,
            )
        : [];
    const ins = [];
    const crs =
      q.length >= 2
        ? CR.filter((x) => {
            const c = cls(x);
            return (
              x.merchant +
              " " +
              (c.rule || "") +
              " " +
              (c.cat || "") +
              " " +
              c.memo
            )
              .toLowerCase()
              .includes(q);
          })
            .slice(-5)
            .reverse()
            .map(
              (x) =>
                `<button data-act="cr" data-v="${x.id}">${esc(x.merchant)}<span>${mdS(x.date)} · ${W(x.krw)}</span></button>`,
            )
        : [];
    const sec = (t, a) =>
      a.length ? `<div class="gh">${t}</div>${a.join("")}` : "";
    getId("palres").innerHTML =
      cleanHTML(sec("메뉴", nav) +
        sec("강사", ins) +
        sec("결제", ords) +
        sec("외부 매출", exs) +
        sec("통장", bks) +
        sec("카드 내역", crs) ||
      '<p class="note" style="padding:12px">찾는 것이 없습니다. 두 글자 이상 넣어 보세요.</p>');
  }

  /* ================= 엑셀(CSV) ================= */
  function csv(name, head, rows) {
    const f = (v) => {
      const numeric = typeof v === "number";
      v = String(v ?? "");
      if (!numeric && /^[\s]*[=+@-]/.test(v)) v = "'" + v;
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const text =
      "﻿" + [head, ...rows].map((r) => r.map(f).join(",")).join("\r\n");
    try {
      const b = new Blob([text], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 800);
      toast(`${name} 파일을 만들었습니다`);
    } catch {
      toast("이 환경에서는 파일을 내려받을 수 없습니다");
    }
  }
  function exportCsv(kind) {
    const r = range(),
      tag = `${r[0]}_${r[1]}`;
    if (kind === "sales")
      csv(
        `토스결제_${tag}.csv`,
        [
          "결제일",
          "시각",
          "사업",
          "상품",
          "결제수단",
          "금액",
          "취소",
          "PG 수수료",
          "상태",
          "주문번호",
          "유입",
        ],
        salesRows().map((t) => [
          t.date,
          t.time,
          BIZ[t.biz].name,
          t.product,
          t.method,
          t.amount,
          t.cancel,
          t.fee,
          t.status,
          t.id,
          t.src,
        ]),
      );
    if (kind === "ext")
      csv(
        `외부매출_${tag}.csv`,
        [
          "매출일",
          "종류",
          "사업",
          "내용",
          "거래처",
          "USD",
          "공급가액",
          "부가세",
          "합계",
          "입금 상태",
          "입금일",
          "입금 예정일",
          "세금계산서",
          "메모",
        ],
        extRows().map((e) => {
          const i = extInfo(e);
          return [
            e.date,
            EXT_TYPES[e.type],
            BIZ[e.biz].name,
            e.title,
            e.client,
            e.usd ?? "",
            e.type === "youtube" ? "" : e.supply,
            e.type === "youtube" ? "" : e.vat,
            i.total,
            i.state,
            i.paid || "",
            e.due,
            e.invoice,
            e.memo,
          ];
        }),
      );
    if (kind === "settlements" && SE.tab === "entry")
      csv(
        `거래별정산_${tag}.csv`,
        [
          "지급일",
          "매출일",
          "사업",
          "주문번호",
          "구분",
          "결제 금액",
          "수수료",
          "지급 금액",
        ],
        ST.filter((e) => inR(e.pay, r) && bizOk(e.biz)).map((e) => [
          e.pay,
          e.sold,
          BIZ[e.biz].name,
          e.tx.id,
          e.cancel ? "취소" : "결제",
          e.amount,
          e.fee,
          e.amount - e.fee,
        ]),
      );
    if (kind === "settlements" && SE.tab === "payout")
      csv(
        `정산입금_${tag}.csv`,
        [
          "지급일",
          "상점",
          "매출일 시작",
          "매출일 끝",
          "건수",
          "결제 금액",
          "수수료",
          "지급 금액",
          "통장 입금",
          "상태",
        ],
        settlementRows().map((p) => [
          p.pay,
          BIZ[p.biz].name,
          p.soldFrom,
          p.soldTo,
          p.count,
          p.amount,
          p.fee,
          p.payout,
          p.bank ?? "",
          p.state,
        ]),
      );
    if (kind === "bank")
      csv(
        `통장내역_${BK.acct === "all" ? "전체" : acctName(BK.acct)}_${tag}.csv`,
        [
          "거래일",
          "시각",
          "통장",
          "적요",
          "입금",
          "출금",
          "그 통장 잔액",
          "분류",
        ],
        bankFiltered().map((x) => [
          x.date,
          x.time,
          acctName(x.acct),
          x.desc,
          x.in || "",
          x.out || "",
          x.bal,
          x.cat || "미분류",
        ]),
      );
    if (kind === "cards")
      csv(
        `카드지출_${tag}.csv`,
        [
          "이용일",
          "시각",
          "카드",
          "사용자",
          "가맹점",
          "원화 금액",
          "외화",
          "계정과목",
          "사업",
          "부가세",
          "사용 목적",
          "상태",
          "승인번호",
        ],
        cardFiltered(cardRows()).map((x) => {
          const c = cls(x),
            cd = cardOf(x.card);
          return [
            x.date,
            x.time,
            cd.name + " " + cd.last,
            cd.user,
            x.merchant,
            x.krw,
            x.cur ? x.fx + " USD" : "",
            c.cat || "",
            c.biz ? BIZ[c.biz].name : "",
            c.vat,
            c.memo,
            crState(x),
            x.appr,
          ];
        }),
      );

    if (kind === "recurring") {
      const g = Object.fromEntries(
        recurringCandidates(CR).map((x) => [x.merchant, x.records.at(-1)]),
      );
      csv(
        "정기결제.csv",
        ["서비스", "최근 결제일", "원화", "외화", "담당", "상태"],
        Object.values(g).map((x) => [
          x.merchant,
          x.date,
          x.krw,
          x.cur ? x.fx + " USD" : "",
          DB.owners[x.merchant] || "",
          DB.recState[x.merchant] || "유지",
        ]),
      );
    }
    if (kind === "budget") {
      const M = budgetMonth(BM),
        N = netOf(BM);
      csv(
        `예산관리_${BM}.csv`,
        [
          "구분",
          "항목",
          "사업",
          "실적 가져오기",
          "월 예산",
          "실적",
          "남은 금액",
          "담당",
          "메모",
        ],
        M.items
          .map((b) => [
            TYPES[b.type].n,
            b.name,
            b.biz === "any" ? "전체" : BIZ[b.biz].name,
            SRC_LABEL[b.source],
            b.amount,
            b.act ?? "",
            b.act != null ? b.amount - b.act : "",
            b.owner,
            b.memo,
          ])
          .concat([
            [],
            ["순수익", "들어온 돈", N.inn],
            ["", "토스 정산", N.toss],
            ["", "외부 매출", N.ext],
            ["", DB.netRnd ? "연구비 (넣음)" : "연구비 (뺌 · 참고)", N.rnd],
            ["", "고정비", N.fixed],
            ["", "변동비", N.variable],
            ["", "인건비", N.labor],
            ["", "순수익", N.net],
          ]),
      );
    }
  }

  let activePage = "overview",
    lastUrl = "";
  function urlFor(page) {
    const q = new URLSearchParams();
    q.set("period", activePage === "budget" ? "month" : P.mode);
    q.set("month", page === "budget" || activePage === "budget" ? BM : P.month);
    if (P.mode === "custom") {
      q.set("from", P.from);
      q.set("to", P.to);
    }
    if (BIZF !== "all") q.set("biz", BIZF);
    if (page === "sales") q.set("tab", SL.src === "ext" ? "external" : "toss");
    if (page === "settlements") q.set("tab", SE.tab);
    if (page === "bank") q.set("account", BK.acct);
    return "/finance/" + page + "?" + q.toString();
  }
  function syncUrl() {
    if (!root) return;
    const url = urlFor(activePage);
    if (lastUrl !== url) {
      lastUrl = url;
      options.replaceUrl?.(url);
    }
  }
  function applyUrl(input) {
    const url = new URL(input, "http://finance.local"),
      page = url.pathname.split("/")[2],
      q = url.searchParams;
    if (ROUTES[page]) activePage = page;
    if (["month", "week", "all", "custom"].includes(q.get("period")))
      P.mode = q.get("period");
    if (MONTHS.includes(q.get("month"))) {
      if (activePage === "budget") BM = q.get("month");
      else P.month = q.get("month");
    }
    const from = q.get("from"),
      to = q.get("to");
    if (
      from &&
      to &&
      /^\d{4}-\d{2}-\d{2}$/.test(from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(to) &&
      from <= to &&
      from >= DATA_START &&
      to <= TODAY
    ) {
      P.from = from;
      P.to = to;
    }
    if (q.has("biz"))
      BIZF = ["all", "edu", "myin", "hm"].includes(q.get("biz"))
        ? q.get("biz")
        : "all";
    if (activePage === "sales" && q.has("tab"))
      SL.src = q.get("tab") === "external" ? "ext" : "toss";
    if (activePage === "settlements" && q.has("tab"))
      SE.tab = q.get("tab") === "entry" ? "entry" : "payout";
    if (activePage === "bank" && q.has("account"))
      BK.acct = DB.accounts.some((a) => a.id === q.get("account"))
        ? q.get("account")
        : "all";
  }

  /* ================= 라우터 ================= */
  const ROUTES = {
    overview: vOverview,
    sales: vSales,
    settlements: vSettlements,
    bank: vBank,
    cards: vCards,
    recurring: vRecurring,
    budget: vBudget,
  };
  let cur = null;
  function route() {
    return activePage;
  }
  function renderSide() {}
  function render(updateUrl = true) {
    const c = route(),
      name = NAV.find((n) => n[0] === c)[1];

    document.title = `${name} · 재무관리 | 브랜디 OS`;
    renderSide();
    getId("view").innerHTML = cleanHTML(ROUTES[c]());
    getId("view")
      .querySelectorAll('a[href^="#"]')
      .forEach((link) => {
        const page = link.getAttribute("href").slice(1);
        if (!ROUTES[page]) return;
        link.dataset.financeRoute = page;
        link.href = urlFor(page);
      });
    if (BLANK) {
      const walk = document.createTreeWalker(
        getId("view"),
        NodeFilter.SHOW_TEXT,
      );
      while (walk.nextNode()) {
        const node = walk.currentNode;
        if (!node.parentElement.closest("option"))
          node.textContent = node.textContent.replace(
            /\d[\d,]*(?=\s*(?:건|개|회|쌍)(?:\s|$|[·,.]))/g,
            "[ ]",
          );
      }
    }
    if (cur !== c) {
      window.scrollTo(0, 0);
      cur = c;
      if (layer.querySelector(".drawer,.modal")) closeLayer();
    }
    if (updateUrl) syncUrl();
  }
  const refreshSales = () => {
    const el = getId("salesList");
    if (el) el.innerHTML = cleanHTML(SL.src === "toss" ? salesList() : extList());
  };
  const refreshCards = () => {
    const el = getId("cardList");
    if (el) el.innerHTML = cleanHTML(cardList());
    renderSide();
  };
  const refreshBank = () => {
    const el = getId("bankList");
    if (el) el.innerHTML = cleanHTML(bankList());
  };
  function go(h) {
    if (!ROUTES[h]) return;
    if(activePage==="budget"&&h!=="budget"){P.month=BM;P.mode="month";}
    activePage = h;
    render(false);
    options.navigate?.(urlFor(h));
  }

  /* ================= 이벤트 ================= */
  listen("click", async (e) => {
    if(saving)return;
    const link = e.target.closest("a[data-finance-route]");
    if (link && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    if (link) e.preventDefault();
    if (link && !link.dataset.act) {
      go(link.dataset.financeRoute);
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const a = el.dataset.act,
      v = el.dataset.v;
    try { if (await importFlow.action(a, el)) return; }
    catch(error){toast(error.message||"파일을 처리하지 못했습니다.");return;}
    const A = {
      reload:()=>options.onReset?.(),
      ruledefaults:async()=>{if(DB.rules.length)return;DB.rules=defaultRules().map(r=>({...r,id:connected?newId():r.id}));await save();render();toast("기본 분류 규칙 7개를 만들었습니다");},
      cardmanage: () => cardManagement(),
      cardedit: () => cardEdit(v),
      cardsave: async () => {
        const name = getId("registryName").value.trim(),
          last = getId("registryLast").value,
          user = getId("registryUser").value.trim();
        if (
          !name ||
          !user ||
          !/^\d{4}$/.test(last) ||
          CARDS.some((c) => c.id !== v && c.last === last)
        ) {
          getId("registryError").textContent =
            "이름·사용자·중복되지 않는 끝 4자리를 확인하세요";
          getId("registryError").focus();
          return;
        }
        if (v) Object.assign(cardOf(v), { name, last, user });
        else
          CARDS.push({ id: newId(), name, last, user });
        await save();
        closeModal();
        render();
        cardManagement();
      },
      archived: () =>
        drawer(
          "보관 통장",
          "보관한 통장과 거래 내역을 복원합니다",
          (DB.archivedAccounts || [])
            .map(
              (a) =>
                `<div class="li"><b>${esc(a.name)}</b><button class="btn sm" data-act="restoreacct" data-v="${a.id}">복원</button></div>`,
            )
            .join(""),
        ),
      restoreacct: async () => {
        const acct = DB.archivedAccounts.find((x) => x.id === v);
        if (!acct) return;
        DB.accounts.push(acct);
        DB.archivedAccounts = DB.archivedAccounts.filter((x) => x.id !== v);
        await save();
        closeLayer();
        render();
        toast("통장을 복원했습니다");
      },
      bankrules: () => bankRulesPanel(),
      bankruleedit: () => bankRuleEdit(v),
      bankrulemove: async () => {
        const i = DB.bankRules.findIndex((x) => x.id === v),
          j = i + Number(el.dataset.d);
        if (i < 0 || j < 0 || j >= DB.bankRules.length) return;
        [DB.bankRules[i], DB.bankRules[j]] = [DB.bankRules[j], DB.bankRules[i]];
        await save();
        render();
        bankRulesPanel();
      },
      bankrulesave: async () => {
        const name = getId("brname").value.trim(),
          keyword = getId("brkeyword").value.trim();
        if (!name || !keyword) {
          getId("brerr").textContent = "규칙 이름과 적요 검색어를 입력하세요";
          getId("brerr").focus();
          return;
        }
        const data = {
          name,
          keyword,
          cat: getId("brcat").value,
          direction: getId("brdirection").value,
          on: getId("bron").checked,
        };
        if (v)
          Object.assign(
            DB.bankRules.find((x) => x.id === v),
            data,
          );
        else DB.bankRules.push({ id: newId(), ...data });
        await save();
        closeModal();
        render();
        bankRulesPanel();
      },
      bankruledel: async () => {
        if (!el.dataset.armed) {
          el.dataset.armed = "1";
          el.textContent = "한 번 더 누르면 삭제";
          return;
        }
        DB.bankRules = DB.bankRules.filter((x) => x.id !== v);
        await save();
        closeModal();
        render();
        bankRulesPanel();
      },

      palette: openPalette,
      go: async () => {
        closeLayer();
        go(v);
      },
      blank: async () => {
        BLANK = !BLANK;
        try {
          localStorage.setItem("finance.hideAmounts", String(BLANK));
        } catch {}
        closeLayer();
        el.setAttribute("aria-pressed", BLANK);
        el.textContent = BLANK ? "금액 보이기" : "금액 숨기기";
        render();
      },
      reset: async () => {
        if (el.dataset.armed) {
          options.onReset?.();
        } else {
          el.dataset.armed = "1";
          el.textContent = "한 번 더 누르면 처음으로";
          setTimeout(() => {
            delete el.dataset.armed;
            el.textContent = "예시 데이터 처음으로";
          }, 3500);
        }
      },
      close: () => closeLayer(),
      closemodal: () => closeModal(),
      pmode: async () => {
        if (v === "custom" && P.mode !== "custom") {
          const r = range();
          P.from = r[0];
          P.to = r[1];
        }
        P.mode = v;
        P.err = "";
        SL.page = 1;
        CS.page = 1;
        BK.page = 1;
        render();
      },
      pstep: async () => {
        const i = MONTHS.indexOf(P.month) + Number(v);
        if (MONTHS[i]) {
          P.month = MONTHS[i];
          SL.page = 1;
          CS.page = 1;
          BK.page = 1;
          render();
        }
      },
      papply: async () => {
        const f = getId("pfrom").value,
          t = getId("pto").value;
        if (!f || !t) P.err = "시작일과 종료일을 모두 고르세요";
        else if (f > t) P.err = "시작일이 종료일보다 늦습니다";
        else if (f < DATA_START || t > TODAY)
          P.err = `${mdS(DATA_START)}부터 ${mdS(TODAY)}까지 고를 수 있습니다`;
        else {
          P.from = f;
          P.to = t;
          P.err = "";
        }
        SL.page = 1;
        CS.page = 1;
        BK.page = 1;
        render();
      },
      biz: async () => {
        BIZF = v;
        SL.page = 1;
        render();
      },
      src: async () => {
        SL.src = v;
        SL.q = "";
        SL.page = 1;
        render();
      },
      srcext: async () => {
        SL.src = "ext";
        go("sales");
      },
      etype: async () => {
        SL.etype = v;
        render();
      },
      sstatus: async () => {
        SL.status = v;
        SL.page = 1;
        render();
      },
      page: async () => {
        SL.page += Number(v);
        refreshSales();
      },
      tx: async () => {
        e.preventDefault();
        openTx(v);
      },
      po: async () => {
        e.preventDefault();
        openPo(v);
      },
      sepage: async () => {
        SE.page += Number(v);
        render();
      },
      setab: async () => {
        SE.tab = v;
        SE.page = 1;
        render();
      },
      sestatus: async () => {
        SE.status = v;
        render();
      },
      stlfocus: async () => {
        e.preventDefault();
        SE.status = "확인 필요";
        SE.tab = "payout";
        P.mode = "all";
        closeLayer();
        go("settlements");
      },
      cardtodo: async () => {
        CS.f = "todo";
        CS.card = "all";
        P.mode = "month";
        P.month = "2026-09";
        go("cards");
      },
      bankunc: async () => {
        e.preventDefault();
        BK.f = "unc";
        BK.acct = "all";
        P.mode = "all";
        go("bank");
      },
      bankin: async () => {
        e.preventDefault();
        BK.f = "in";
        BK.acct = "all";
        P.mode = "month";
        P.month = BM;
        go("bank");
      },
      extfocus: async () => {
        SL.src = "ext";
        P.mode = "all";
        go("sales");
      },
      bgo: async () => {
        e.preventDefault();
        closeLayer();
        if (MONTHS.includes(v)) BM = v;
        go("budget");
      },
      crf: async () => {
        CS.f = v;
        CS.page = 1;
        render();
      },
      cardf: async () => {
        CS.card = v === CS.card || v === "all" ? "all" : v;
        CS.page = 1;
        render();
      },
      cpage: async () => {
        CS.page += Number(v);
        refreshCards();
      },
      sel: async () => {
        if (el.checked) CS.sel.add(v);
        else CS.sel.delete(v);
        refreshCards();
      },
      selall: async () => {
        const r = cardFiltered(cardRows()).slice(
          (CS.page - 1) * 30,
          CS.page * 30,
        );
        if (el.checked) r.forEach((x) => CS.sel.add(x.id));
        else r.forEach((x) => CS.sel.delete(x.id));
        refreshCards();
      },
      selclear: async () => {
        CS.sel.clear();
        refreshCards();
      },
      bulkapply: async () => {
        const c = getId("bcat").value,
          b = getId("bbiz").value;
        if (!c && !b) {
          toast("계정과목이나 사업을 고르세요");
          return;
        }
        let n = 0;
        CS.sel.forEach((id) => {
          const o = (DB.ov[id] = DB.ov[id] || {});
          if (c) o.cat = c;
          if (b) o.biz = b;
          n++;
        });
        CS.sel.clear();
        await save();
        render();
        toast(`${n}건을 바꿨습니다`);
      },
      bulkreq: async () => {
        if(connected){await command("memo-request",{ids:[...CS.sel]});toast("메모 요청을 모의 기록했습니다. 실제 메시지는 보내지 않았습니다.");return;}
        const us = [
          ...new Set(
            CR.filter((x) => CS.sel.has(x.id)).map((x) => cardOf(x.card).user),
          ),
        ];
        toast(
          `${us.join(" · ")}님에게 메모 요청을 모의 기록했습니다 · 실제 발송 없음`,
        );
      },
      cr: () => openCr(v),
      crsave: async () => {
        const o = (DB.ov[v] = DB.ov[v] || {});
        o.cat = getId("ccat").value || null;
        o.biz = getId("cbiz").value || null;
        o.memo = getId("cmemo").value.trim();
        const vt = getId("cvat");
        if (vt) o.vat = vt.value;
        await save();
        closeLayer();
        render();
        toast("저장했습니다");
      },
      rcpoff: async () => {
        if(connected){await command("receipt-remove",{id:v});render();openCr(v);return;}
        (DB.ov[v] = DB.ov[v] || {}).receipt = false;
        await save();
        openCr(v);
        render();
      },
      rcpview:async()=>{if(connected)await command("receipt-read",{id:v});},
      rulefrom: async () => {
        const x = CR.find((r) => r.id === v);
        ruleModal("", {
          name: x.merchant.split(" ")[0],
          kw: [x.merchant.split(" ")[0]],
          cat: getId("ccat").value,
          biz: getId("cbiz").value || "common",
          memo: getId("cmemo").value.trim(),
        });
      },
      rule: () => ruleModal(v),
      rulesave: async () => {
        const name = getId("rname").value.trim(),
          kw = getId("rkw")
            .value.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          cat = getId("rcat").value,
          err = getId("rerr");
        if (!name) {
          err.textContent = "규칙 이름을 적어 주세요";
          getId("rname").focus();
          return;
        }
        if (!kw.length) {
          err.textContent = "가맹점에 들어가는 말을 하나 이상 적어 주세요";
          getId("rkw").focus();
          return;
        }
        if (!cat) {
          err.textContent = "계정과목을 고르세요";
          getId("rcat").focus();
          return;
        }
        const data = {
          name,
          kw,
          cat,
          biz: getId("rbiz").value,
          vat: getId("rvat").value,
          memo: getId("rmemo").value.trim(),
          on: getId("ron").checked,
        };
        if (v)
          Object.assign(
            DB.rules.find((r) => r.id === v),
            data,
          );
        else DB.rules.push({ id: newId(), ...data });
        await save();
        closeLayer();
        render();
        toast(
          v
            ? "규칙을 고쳤습니다. 카드 내역에 바로 다시 적용했습니다"
            : "규칙을 만들었습니다. 카드 내역에 바로 적용했습니다",
        );
      },
      ruledel: async () => {
        if (!el.dataset.armed) {
          el.dataset.armed = "1";
          el.textContent = "한 번 더 누르면 삭제";
          el.classList.add("on");
          return;
        }
        DB.rules = DB.rules.filter((r) => r.id !== v);
        await save();
        closeLayer();
        render();
        toast("규칙을 지웠습니다");
      },
      upload: () => openUpload(),
      bankupload: () => importFlow.open("bank"),
      rulemove: async () => {
        const i = DB.rules.findIndex((x) => x.id === v),
          j = i + Number(el.dataset.d);
        if (i < 0 || j < 0 || j >= DB.rules.length) return;
        [DB.rules[i], DB.rules[j]] = [DB.rules[j], DB.rules[i]];
        await save();
        render();
      },

      ponote: async () => {
        const reason = getId("podiff").value;
        if (!reason) {
          toast("차이 사유를 고르세요");
          getId("podiff").focus();
          return;
        }
        DB.po[v] = {
          reason,
          memo: getId("pomemo").value.trim(),
          by: ACTOR,
          at: NOW_LABEL,
        };
        await save();
        rebuild();
        render();
        openPo(v);
        toast("사유를 기록했습니다");
      },
      refreq: async () => {
        const t = txById(v);
        modal(
          "환불 요청",
          `<p class="small fg2">${t.product} · ${won(t.amount)} · ${t.id}</p><div class="field"><span class="lb">범위</span><div class="radios"><label class="radio"><input type="radio" name="rft" value="전액" checked>전액</label><label class="radio"><input type="radio" name="rft" value="부분">부분</label></div></div><div class="field"><label for="rfa">금액 (원)</label><input class="input" id="rfa" inputmode="numeric" value="${fmtIn(t.amount-t.cancel)}"></div><div class="field"><label for="rfr">${connected?"환불 사유 (필수 · 200자까지)":"모의 사유 (필수 · 외부 전송 없음, 200자까지)"}</label><textarea class="input" id="rfr" maxlength="200"></textarea></div><p class="small" id="rferr" role="alert" style="color:var(--bad)"></p>`,
          `<button class="btn sm" data-act="closemodal">취소</button><button class="btn pri sm" data-act="refsend" data-v="${v}">${connected?"승인 요청 저장":"모의 승인 요청"}</button>`,
        );
      },
      refsend: async () => {
        const t = txById(v),
          reason = getId("rfr").value.trim(),
          amt = parseNum(getId("rfa").value),
          type = layer.querySelector("input[name=rft]:checked").value,
          err = getId("rferr");
        if (!reason) {
          err.textContent = "사유를 적어 주세요";
          getId("rfr").focus();
          return;
        }
        if (!(amt > 0) || amt > t.amount - t.cancel) {
          err.textContent = `1원부터 ${fmtIn(t.amount)}원까지 넣을 수 있습니다`;
          return;
        }
        if(connected){await command("refund-request",{payment_id:v,amount:amt,reason});closeModal();render();openTx(v);toast("환불 요청을 저장했습니다. 실제 취소는 아직 실행하지 않았습니다.");return;}
        DB.refunds[v] = {
          amount: amt,
          type: amt === t.amount ? "전액" : type,
          by: ACTOR,
          at: NOW_LABEL,
          reason,
          state: "승인 대기",
        };
        await save();
        closeModal();
        render();
        openTx(v);
        toast("승인 요청을 모의 기록했습니다 · 실제 발송 없음");
      },
      refok: async () => {
        const q = DB.refunds[v];
        if (!q || q.by === ACTOR || q.state !== "승인 대기") {
          toast("요청자는 승인할 수 없습니다");
          return;
        }
        if(connected){await command("refund-approve",{id:q.id});render();openTx(v);toast("환불 처리 결과를 저장했습니다. 모의 여부를 확인해 주세요.");return;}
        q.state = "승인 · 취소됨";
        q.date = TODAY;
        await save();
        rebuild();
        render();
        openTx(v);
        toast("토스 결제 취소를 요청했습니다 (예시 — 실제 실행 없음)");
      },
      refreject: async () => {
        if (DB.refunds[v]?.by === ACTOR) {
          toast("요청자는 직접 처리할 수 없습니다");
          return;
        }
        if(connected){await command("refund-reject",{id:DB.refunds[v].id});render();openTx(v);toast("반려했습니다");return;}
        DB.refunds[v].state = "반려";
        await save();
        render();
        openTx(v);
        toast("반려했습니다");
      },

      csv: async () => {if(connected)await command("csv-export",{view:v});exportCsv(v);},
      /* 외부 매출 */
      extadd: async () => {
        e.preventDefault();
        extModal("");
      },
      extedit: async () => {
        e.preventDefault();
        extModal(v);
      },
      extfrombank: async () => {
        const x = bankRows().find((r) => r.id === v);
        const sup = Math.round(x.in / 1.1);
        extModal("", {
          type: "outsource",
          title: "",
          client: x.desc.replace(/^\(주\)/, ""),
          date: x.date,
          supply: sup,
          vat: x.in - sup,
          due: x.date,
          bankId: x.id,
          bankDate: x.date,
          bankAmt: x.in,
        });
      },
      extsave: async () => {
        const m = layer.querySelector(".modal"),
          err = getId("eerr");
        const type = m.querySelector("input[name=etype]:checked").value,
          title = getId("etitle").value.trim(),
          client = getId("eclient").value.trim(),
          date = getId("edate").value,
          due = getId("edue").value;
        if (!title) {
          err.textContent = "내용을 적어 주세요";
          getId("etitle").focus();
          return;
        }
        if (!date) {
          err.textContent = "매출일을 고르세요";
          return;
        }
        let usdv = null,
          supply = 0,
          vat = 0;
        if (type === "youtube") {
          usdv = parseNum(getId("eusd").value);
          if (isNaN(usdv) || usdv <= 0) {
            err.textContent = "확정 수익(USD)을 적어 주세요";
            getId("eusd").focus();
            return;
          }
        } else {
          supply = parseNum(getId("esupply").value);
          vat = parseNum(getId("evat").value);
          if (!Number.isSafeInteger(supply) || supply <= 0) {
            err.textContent = "공급가액을 원 단위 양의 정수로 적어 주세요";
            getId("esupply").focus();
            return;
          }
          if (!getId("evat").value.trim()) vat = 0;
          if (!Number.isSafeInteger(vat) || vat < 0) {
            err.textContent = "부가세를 0 이상의 원 단위 정수로 적어 주세요";
            getId("evat").focus();
            return;
          }
        }
        const data = {
          type,
          title,
          client,
          biz: getId("ebiz").value,
          date,
          due,
          usd: usdv,
          supply,
          vat,
          invoice: type === "youtube" ? "" : getId("einv").value.trim(),
          memo: getId("ememo").value.trim(),
        };
        let id = v;
        if (v)
          Object.assign(
            DB.ext.find((x) => x.id === v),
            data,
          );
        else {
          id = newId();
          DB.ext.push({ id, ...data });
        }
        if (el.dataset.bank) {
          DB.bov[el.dataset.bank] = {
            cat: "외부 매출",
            link: { type: "ext", id },
          };
        }
        let moved = "";
        if (cur === "sales" && !inR(date, rangeX())) {
          if (MONTHS.includes(date.slice(0, 7))) {
            P.mode = "month";
            P.month = date.slice(0, 7);
            P.err = "";
            moved = ` · ${mLabel(P.month)} 보기로 옮겼습니다`;
          } else moved = " · 지금 보는 기간 밖의 매출일입니다";
        }
        await save();
        closeLayer();
        render();
        toast(
          (v
            ? "외부 매출을 고쳤습니다"
            : el.dataset.bank
              ? "외부 매출로 등록하고 통장 입금과 연결했습니다"
              : "외부 매출을 추가했습니다") + moved,
        );
      },
      extdel: async () => {
        if (!el.dataset.armed) {
          el.dataset.armed = "1";
          el.textContent = "한 번 더 누르면 삭제";
          el.classList.add("on");
          return;
        }
        bankRows()
          .filter((x) => x.link?.type === "ext" && x.link.id === v)
          .forEach((x) => (DB.bov[x.id] = { cat: "미분류", link: null }));
        DB.ext = DB.ext.filter((x) => x.id !== v);
        await save();
        closeLayer();
        render();
        toast("외부 매출을 지웠습니다");
      },
      /* 통장 */
      bk: async () => {
        e.preventDefault();
        openBank(v);
      },
      bkf: async () => {
        BK.f = v;
        BK.page = 1;
        render();
      },
      bpage: async () => {
        BK.page += Number(v);
        refreshBank();
      },
      bksave: async () => {
        const x = bankRows().find((r) => r.id === v);
        const cat = getId("bkc").value;
        const o = (DB.bov[v] = DB.bov[v] || {});
        o.cat = cat;
        if (x.link && x.link.type === "xfer" && cat !== XFER) {
          o.link = null;
          DB.bov[x.link.id] = { cat: "미분류", link: null };
        }
        if (getId("bkrule").checked && cat !== XFER) {
          DB.bankRules.push({
            id: newId(),
            name: x.desc,
            keyword: x.desc,
            direction: x.in > 0 ? "in" : "out",
            cat,
            on: true,
          });
        }
        await save();
        closeLayer();
        render();
        toast(
          `'${cat}'(으)로 분류했습니다. 통장 간 이체 연결은 후보 확인 후 별도로 묶어 주세요.`,
        );
      },
      bklink: async () => {
        DB.bov[v] = {
          cat: "외부 매출",
          link: { type: "ext", id: el.dataset.e },
        };
        await save();
        closeLayer();
        render();
        toast("외부 매출과 연결했습니다 — 입금 확인으로 바뀌었습니다");
      },
      bkpaylink:async()=>{
        const payout=getId("bkPayout").value;
        if(!PO.some(p=>p.id===payout)){toast("연결할 토스 정산을 선택해 주세요.");return;}
        DB.bov[v]={cat:"토스 정산",link:{type:"po",id:payout}};
        await save();render();openBank(v);toast("정산 연결을 저장했습니다.");
      },
      bkunlink:async()=>{
        DB.bov[v]={cat:"기타 입금",link:null};
        await save();render();openBank(v);toast("연결을 해제하고 기타 입금으로 분류했습니다.");
      },
      banksync: async () => {
        if(connected){await command("bank-sync");return;}
        const before = bankRows().length;
        DB.synced = true;
        await save();
        rebuild();
        render();
        toast(
          `통장 ${DB.accounts.length}개에서 새 거래 ${bankRows().length - before}건을 가져왔습니다`,
        );
      },
      bacct: async () => {
        BK.acct = v;
        BK.page = 1;
        render();
      },
      acctadd: () => acctModal(""),
      acctedit: async () => {
        e.stopPropagation();
        acctModal(v);
      },
      acctsave: async () => {
        const m = layer.querySelector(".modal"),
          err = getId("acerr");
        const name = getId("aname").value.trim(),
          last = getId("alast").value.trim();
        if (!name) {
          err.textContent = "통장 이름을 적어 주세요";
          getId("aname").focus();
          return;
        }
        if (DB.accounts.some((a) => a.id !== v && a.name === name)) {
          err.textContent = "같은 이름의 통장이 있습니다";
          getId("aname").focus();
          return;
        }
        if (last && !/^[0-9]{4}$/.test(last)) {
          err.textContent = "끝 4자리 숫자만 적어 주세요";
          getId("alast").focus();
          return;
        }
        const data = {
          bank: getId("abank").value,
          name,
          last,
          uses: [...m.querySelectorAll("input[name=auses]:checked")].map(
            (i) => i.value,
          ),
          method: m.querySelector("input[name=am]:checked").value,
          freq: getId("afreq").value,
          incl: getId("aincl").checked,
        };
        if (v) Object.assign(acctOf(v), data);
        else {
          const id = newId();
          DB.accounts.push({ id, open: connected?null:0, sample: false, ...data });
          BK.acct = id;
          BK.page = 1;
        }
        await save();
        closeLayer();
        render();
        toast(
          v
            ? "통장 설정을 저장했습니다"
            : `'${name}' 통장을 추가했습니다 · ${data.method === "xl" ? "거래내역 엑셀을 올려 주세요" : "연결이 끝나면 거래를 가져옵니다"}`,
        );
      },
      acctdel: async () => {
        if (DB.accounts.length <= 1) return;
        if (!el.dataset.armed) {
          el.dataset.armed = "1";
          el.textContent = Number(el.dataset.n)
            ? `한 번 더 누르면 보관 · 거래 ${el.dataset.n}건은 복원 가능`
            : "한 번 더 누르면 보관";
          el.classList.add("on");
          return;
        }
        const nm = acctName(v);
        DB.archivedAccounts = DB.archivedAccounts || [];
        DB.archivedAccounts.push(acctOf(v));
        DB.accounts = DB.accounts.filter((a) => a.id !== v);
        if (BK.acct === v) BK.acct = "all";
        await save();
        closeLayer();
        render();
        toast(`'${nm}' 통장을 보관했습니다 · 복원할 수 있습니다`);
      },
      bkpair: async () => {
        const o = el.dataset.o;
        DB.bov[v] = { cat: XFER, link: { type: "xfer", id: o } };
        DB.bov[o] = { cat: XFER, link: { type: "xfer", id: v } };
        await save();
        closeLayer();
        render();
        toast("내 통장 간 이체로 묶었습니다 — 입출금 합계·순수익에서 빠집니다");
      },
      /* 예산 */
      bdefaults: async () => {
        startBudgetDefaults();
        await save();
        render();
        toast(
          "예산 0원의 기본 항목을 만들었습니다. 금액과 담당을 채워 주세요.",
        );
      },
      bstep: async () => {
        const i = MONTHS.indexOf(BM) + Number(v);
        if (MONTHS[i]) {
          BM = MONTHS[i];
          render();
        }
      },
      bedit: () => budgetModal(v, el.dataset.t),
      bact: () => actualModal(v),
      bsave: async () => {
        const m = layer.querySelector(".modal"),
          err = getId("berr"),
          cur0 = v ? DB.budget.find((x) => x.id === v) : null;
        const name = getId("bname").value.trim(),
          amtRaw = getId("bamt").value,
          amt = parseNum(amtRaw);
        const srcEl = m.querySelector("input[name=bsrc]:checked"),
          src =
            cur0 && cur0.source === "instructor"
              ? "instructor"
              : srcEl
                ? srcEl.value
                : "manual";
        const cats = [...m.querySelectorAll("input[name=bcats]:checked")].map(
            (i) => i.value,
          ),
          bcats = [...m.querySelectorAll("input[name=bbcats]:checked")].map(
            (i) => i.value,
          );
        getId("bname").classList.toggle("err", !name);
        getId("bamt").classList.toggle("err", isNaN(amt) || amt < 0);
        if (!name) {
          err.textContent = "항목 이름을 적어 주세요";
          getId("bname").focus();
          return;
        }
        if (!amtRaw.trim() || !Number.isSafeInteger(amt) || amt < 0) {
          err.textContent = "월 예산을 0 이상의 원 단위 정수로 적어 주세요";
          getId("bamt").focus();
          return;
        }
        if (src === "card" && !cats.length) {
          err.textContent = "카드 계정과목을 하나 이상 고르세요";
          return;
        }
        if (src === "bank" && !bcats.length) {
          err.textContent = "통장 출금 분류를 하나 이상 고르세요";
          return;
        }
        if (src === "bank") {
          const clash = DB.budget.filter(
            (b) =>
              b.id !== v &&
              b.source === "bank" &&
              (b.bcats || []).some((c) => bcats.includes(c)),
          );
          if (clash.length) {
            const c = bcats.find((k) => (clash[0].bcats || []).includes(k));
            err.textContent = `'${c}' 출금은 '${clash[0].name}' 항목이 이미 읽고 있습니다. 두 번 세지 않도록 한 항목에서만 고르세요`;
            return;
          }
        }
        const data = {
          type: m.querySelector("input[name=btype]:checked").value,
          name,
          amount: amt,
          biz: getId("bbiz2").value,
          source: src,
          cats: src === "card" ? cats : [],
          bcats: src === "bank" ? bcats : [],
          owner: getId("bowner").value,
          memo: getId("bmemo").value.trim(),
        };
        if (cur0) {
          Object.assign(cur0, data);
          if (!cur0.actual) cur0.actual = {};
        } else DB.budget.push({ id: newId(), actual: {}, ...data });
        await save();
        closeLayer();
        render();
        toast(v ? "항목을 고쳤습니다" : "항목을 추가했습니다");
      },
      bdel: async () => {
        if (!el.dataset.armed) {
          el.dataset.armed = "1";
          el.textContent = "한 번 더 누르면 삭제";
          el.classList.add("on");
          return;
        }
        DB.budget = DB.budget.filter((b) => b.id !== v);
        await save();
        closeLayer();
        render();
        toast("항목을 지웠습니다");
      },
      asave: async () => {
        const raw = getId("aamt").value,
          n = parseNum(raw);
        if (!raw.trim() || !Number.isSafeInteger(n) || n < 0) {
          getId("aerr").textContent = "0 이상의 원 단위 정수로 적어 주세요";
          getId("aamt").focus();
          return;
        }
        const b = DB.budget.find((x) => x.id === v);
        (b.actual = b.actual || {})[BM] = n;
        await save();
        closeLayer();
        render();
        toast(`${ymLabel(BM)} 실적을 저장했습니다`);
      },
      aclear: async () => {
        const b = DB.budget.find((x) => x.id === v);
        if (b.actual) delete b.actual[BM];
        await save();
        closeLayer();
        render();
      },
    };
    try { if (A[a]) await A[a](); }
    catch(error) { toast(error.message || "저장하지 못했습니다. 입력 내용은 유지됩니다."); }
    if (el.dataset.armed) {
      const timer = setTimeout(() => {
        delete el.dataset.armed;
        if (el.isConnected) {
          el.textContent =
            a === "acctdel"
              ? "보관"
              : a === "reset"
                ? "예시 데이터 처음으로"
                : "삭제";
          el.classList.remove("on");
        }
        timers.delete(timer);
      }, 3500);
      timers.add(timer);
    }
  });
  listen("change", async (e) => {
    if(saving)return;
    try {
    const el = e.target,
      c = el.dataset.change;
    if (!c) return;
    const v = el.dataset.v;
    if (c === "pmonth") {
      P.month = el.value;
      SL.page = 1;
      CS.page = 1;
      BK.page = 1;
      render();
    }
    if (c === "bmonth") {
      BM = el.value;
      render();
    }

    if (c === "smethod") {
      SL.method = el.value;
      SL.page = 1;
      refreshSales();
    }
    if (c === "bkcat") {
      BK.cat = el.value;
      BK.page = 1;
      refreshBank();
    }
    if (c === "owner") {
      DB.owners[v] = el.value;
      await save();
      render();
      toast("담당을 바꿨습니다");
    }
    if (c === "recstate") {
      DB.recState[v] = el.value;
      await save();
      render();
    }
    if (c === "rcp") {
      const f = el.files[0];
      if (!f) return;
      if (
        f.size > 10 * 1024 * 1024 ||
        !/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.type)
      ) {
        toast("PNG·JPEG·GIF·WebP 또는 PDF, 10MB 이하만 가능합니다");
        el.value = "";
        return;
      }
      if(connected){await command("receipt-upload",{id:v},f);render();openCr(v);toast("영수증을 안전하게 첨부했습니다.");return;}
      (DB.ov[v] = DB.ov[v] || {}).receipt = true;
      DB.ov[v].receiptName = f.name;
      await save();
      openCr(v);
      render();
      toast("영수증 정보를 모의 저장했습니다 · 실제 파일 업로드 없음");
    }
    if (c === "ledgerfile") void importFlow.file(el.files[0]);

    if (c === "netrnd") {
      DB.netRnd = el.checked;
      await save();
      render();
      toast(
        el.checked
          ? "연구비 입금을 들어온 돈에 넣었습니다"
          : "연구비 입금을 들어온 돈에서 뺐습니다",
      );
    }
    } catch(error){toast(error.message || "저장하지 못했습니다.");}
  });
  listen("input", (e) => {
    const el = e.target;
    if (el.dataset.input === "sq") {
      SL.q = el.value;
      SL.page = 1;
      refreshSales();
    }
    if (el.dataset.input === "bq") {
      BK.q = el.value;
      BK.page = 1;
      refreshBank();
    }
  });
  listen("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openPalette();
    }
    const dialog =
      layer.querySelector(".modal") ||
      layer.querySelector(".drawer") ||
      layer.querySelector(".pal");
    if (e.key === "Tab" && dialog) {
      const items = [
        ...dialog.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ].filter((x) => x.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      if (layer.querySelector(".modal")) closeModal();
      else if (layer.innerHTML) closeLayer();
    }
    if (e.key === "Enter" && e.target.closest && e.target.closest(".crange")) {
      const b = root.querySelector("[data-act=papply]");
      if (b) b.click();
    }
  });
  const tip = getId("tip");
  function showTip(el, x, y) {
    tip.innerHTML = cleanHTML(el.getAttribute("data-tip"));
    tip.hidden = false;
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    tip.style.left =
      Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + "px";
    tip.style.top = Math.max(8, y - h - 10) + "px";
  }
  listen("pointermove", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el) showTip(el, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  listen("focusin", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el) {
      const r = el.getBoundingClientRect();
      showTip(el, r.left + r.width / 2, r.top);
    } else tip.hidden = true;
  });
  applyUrl(options.url || "/finance/overview");
  if(connected){
    const note=root.querySelector(".samplebar > span");
    note.textContent="재무 데이터 · 변경사항은 서버에 저장됩니다. 실제 환불 실행은 별도 설정·승인이 필요합니다.";
    getId("resetBtn").textContent="새로 불러오기";
    getId("resetBtn").dataset.act="reload";
  }
  getId("blankBtn").setAttribute("aria-pressed", String(BLANK));
  getId("blankBtn").textContent = BLANK ? "금액 보이기" : "금액 숨기기";
  render();
  return {
    setUrl(url) {
      applyUrl(url);
      render();
    },
    destroy() {
      abort.abort();
      clearTimeout(toastT);
      timers.forEach(clearTimeout);
      root.replaceChildren();
    },
  };
}
