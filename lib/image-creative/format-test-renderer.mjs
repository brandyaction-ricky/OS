import { artworkGeometry, placedSvg } from "./safe-artwork.mjs";
/** One frozen copy block, one photograph, five warehouse compositions. All coordinates are on a 1080×1350 artboard. */
export const FORMAT_TEST_FORMATS = Object.freeze([
  { id: "M01", label: "속마음 말풍선" },
  { id: "A04", label: "질문 갈림길" },
  { id: "A10", label: "검색 결과의 빈칸" },
  { id: "D12", label: "미리 채운 입력창" },
  { id: "M09", label: "손이 멈춘 한 컷" },
]);
const ink = "#171735", violet = "#3D32D8", lilac = "#E6E2FC", lime = "#E8FF72", paper = "#F6F4EF";
const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const limits = { brand: 15, headline: 54, support: 60, cta: 20 };

function cleanCopy(copy) {
  const checked = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = copy?.[key];
    if (typeof value !== "string" || !value.trim() || Array.from(value).length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`${key} must be printable text, 1–${limit} characters`);
    }
    checked[key] = value;
  }
  return checked;
}

function requireData(value, type, label) {
  const match = typeof value === "string" && value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match || !type.test(match[1]) || match[2].length % 4 !== 0) throw new Error(`Invalid embedded ${label}`);
  return value;
}

// Hangul occupies about one em. Conservative ASCII widths also leave breathing room at the right edge.
function units(value) {
  return Array.from(value).reduce((n, ch) => n + (/\s/u.test(ch) ? .28 : /[A-Z0-9]/.test(ch) ? .71 : /[a-z]/.test(ch) ? .61 : /[.,?!…'"()]/.test(ch) ? .42 : 1), 0);
}
function wrap(value, width, size) {
  const rows = [];
  let line = "";
  const chunks = value.split(/( +)/u);
  for (const chunk of chunks) {
    if (/^ +$/.test(chunk)) { line += chunk; continue; }
    if (line.trim() && units(line + chunk) * size > width) { rows.push(line.trimEnd()); line = ""; }
    for (const ch of chunk) {
      if (line && units(line + ch) * size > width) { rows.push(line.trimEnd()); line = ""; }
      line += ch;
    }
  }
  if (line.trim()) rows.push(line.trimEnd());
  return rows;
}
function type(value, x, y, {width, size, lines = 2, weight = 780, color = ink, align = "start", spacing = -1, leading = 1.16, family = "MyinAd"}) {
  let font = size;
  let rows = wrap(value, width, font);
  while (rows.length > lines && font > 18) rows = wrap(value, width, --font);
  if (rows.length > lines) throw new Error("Copy cannot fit the selected format");
  return `<text font-family="${family === "Display" ? "MyinDisplay,MyinAd" : "MyinAd"},Pretendard,sans-serif" font-size="${font}" font-weight="${weight}" letter-spacing="${spacing}" fill="${color}" text-anchor="${align}">`+
    rows.map((row, i) => `<tspan x="${x}" y="${Math.round(y+i*font*leading)}">${xml(row)}</tspan>`).join("")+"</text>";
}
function headlineText(...args) { return type(...args).replace("<text ", '<text class="ad-headline" '); }
function divide(value) {
  const punctuation = value.search(/[,，;:]/u);
  if (punctuation >= 0 && punctuation < value.length-1) return [value.slice(0,punctuation+1),value.slice(punctuation+1).trimStart()];
  const boundaries = Array.from(value.matchAll(/ +/g), m=>m.index);
  const mid = boundaries.length ? boundaries.reduce((a,b)=>Math.abs(a-value.length/2)<Math.abs(b-value.length/2)?a:b) : Math.ceil(value.length/2);
  return [value.slice(0,mid).trimEnd(),value.slice(mid).trimStart()];
}
function photo(x,y,w,h, vx,vy,vw,vh) {
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid slice"><use href="#master"/></svg>`;
}
function circlePhoto(cx,cy,r,vx,vy,vw,vh) {
  return `<clipPath id="round-photo"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#round-photo)">${photo(cx-r,cy-r,2*r,2*r,vx,vy,vw,vh)}</g>`;
}
function arrow(x,y,color,scale=1) {
  return `<path d="M0 0H46M30 -16L46 0L30 16" transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function brand(value,color=ink) {
  return type(value,70,104,{width:440,size:41,lines:1,weight:780,color,spacing:-1});
}
function thoughts(copy) {
  const [first, second] = divide(copy.headline);
  const stock = "#F1E7D2", ink = "#35291E", red = "#9D2B27";
  const pen = { family: "Display", weight: 700, spacing: -1.5, color: ink };
  // A print tipped into a notebook with two irregular ink balloons. Both tails point into the photograph.
  return `<defs>
    <pattern id="pf-fibre" width="83" height="79" patternUnits="userSpaceOnUse"><circle cx="10" cy="19" r="1.2" fill="#AC936F"/><circle cx="48" cy="63" r="1.5" fill="#FFF7EA"/><path d="m62 20 5 -1m-43 25 4 1" stroke="#B7A389" stroke-width="1.1"/></pattern>
    <filter id="pf-printtone" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1.01 .04 .01 0 .015 .02 .96 .01 0 .005 .01 .025 .88 0 .007 0 0 0 1 0"/></filter>
    </defs><rect width="1080" height="1350" fill="${stock}"/><rect width="1080" height="1350" fill="url(#pf-fibre)" opacity=".4"/>`+
    type(copy.brand,68,93,{width:560,size:48,lines:1,color:ink,weight:800,spacing:-1.5})+
    `<g transform="rotate(-3 549 676)">
      <rect x="63" y="381" width="967" height="632" fill="#C3AE8D" opacity=".45"/>
      <rect x="57" y="375" width="967" height="632" fill="#FFF8EA"/>
      <g filter="url(#pf-printtone)">${photo(70,388,941,605,0,0,1500,1000)}</g>
      <path d="M826 368l141 -5 3 39 -145 3z" fill="#DEC697" opacity=".83"/>
    </g>
    <g transform="rotate(-2 523 246)">
     <path d="M70 191Q113 144 285 146Q575 127 798 157Q887 169 890 228Q888 293 808 313Q773 321 729 326L766 400Q694 361 638 332Q331 352 153 325Q60 311 51 263Q43 221 70 191Z" stroke="${ink}" stroke-width="5" fill="#FFFAEA" stroke-linejoin="round"/>
     ${headlineText(first,458,276,{...pen,width:804,size:102,lines:1,align:"middle"})}
    </g>
    <g transform="rotate(1.8 458 953)">
      <path d="M57 918Q80 865 191 854Q345 834 511 849Q554 841 627 779L599 859Q695 868 714 904Q742 958 688 994Q610 1043 392 1041Q151 1044 85 1009Q33 982 57 918Z" fill="#FFD6A3" stroke="${ink}" stroke-width="5.5" stroke-linejoin="round"/>
      ${headlineText(second,379,973,{...pen,width:632,size:108,lines:1,align:"middle"})}
    </g>
    <path d="M752 956q30 -5 52 -22m-49 47 42 4" fill="none" stroke="${red}" stroke-width="5" stroke-linecap="round"/>`+
    type(copy.support,75,1149,{width:902,size:40,lines:2,weight:570,color:ink,spacing:-1,leading:1.12})+
    `<g transform="rotate(-2 770 1247)"><path d="m515 1194 469 -2 9 87 -471 4z" fill="${red}"/>
    ${type(copy.cta,544,1256,{width:354,size:46,lines:1,weight:760,color:"#FFF5DD",spacing:-1.6})}
    <path d="m922 1239 39 -1m-18 -15 18 15 -17 15" fill="none" stroke="#FFF5DD" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function pause(copy) {
  const [first, second] = divide(copy.headline);
  const pale = "#FFF6E9", accent = "#FF583F";
  const serif = {family:"Display",weight:700,color:pale,spacing:-3};
  // The working edge of the trackpad and the air under the fingertip stay in the exposed midtones.
  return `<defs><filter id="pf-silver" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".26 .65 .09 0 0 .26 .65 .09 0 0 .26 .65 .09 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="linear" slope="1.15" intercept="-.045"/><feFuncG type="linear" slope="1.15" intercept="-.045"/><feFuncB type="linear" slope="1.15" intercept="-.045"/></feComponentTransfer></filter>
    <linearGradient id="pf-cinema" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#11100F" stop-opacity=".82"/><stop offset=".30" stop-color="#131110" stop-opacity=".67"/><stop offset=".5" stop-color="#131110" stop-opacity=".12"/><stop offset=".70" stop-color="#131110" stop-opacity="0"/><stop offset=".83" stop-color="#141211" stop-opacity=".25"/><stop offset="1" stop-color="#100F0F" stop-opacity=".96"/></linearGradient>
    </defs><rect width="1080" height="1350" fill="#161514"/>
    <g filter="url(#pf-silver)">${photo(0,0,1080,1350,455,460,432,540)}</g><rect width="1080" height="1350" fill="url(#pf-cinema)"/>`+
    type(copy.brand,67,99,{width:500,size:42,lines:1,weight:710,color:pale,spacing:-1.25})+
    `<path d="M69 171h69" stroke="${accent}" stroke-width="7"/>`+
    headlineText(first,64,290,{...serif,width:931,size:80,lines:1,leading:1.02})+
    headlineText(second,60,427,{...serif,width:973,size:122,lines:1,spacing:-5.5})+
    type(copy.support,69,539,{width:905,size:40,lines:2,weight:510,color:pale,spacing:-1.15,leading:1.16})+
    `<g transform="translate(68 1194)"><circle cx="35" cy="35" r="35" fill="${accent}"/><path d="M20 35h29m-13-13 13 13-13 13" fill="none" stroke="#141110" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`+
    type(copy.cta,161,1249,{width:786,size:56,lines:1,weight:720,color:pale,spacing:-1.8});
}

// The two saved postings terminate the transit lines: one pencil, one bar chart.
function routePosting(x, y, direction) {
  const blue = "#1534AD", cream = "#FFF3CF", lemon = "#CFF967";
  const fill = direction === "write" ? cream : lemon;
  const icon = direction === "write"
    ? '<path d="m-39 22 7-28 47-47 21 21-47 47-28 7zm48-64 21 21" fill="none" stroke-width="8" stroke-linejoin="round"/>'
    : '<path d="M-36 21V4m31 17v-42m31 42v-68" fill="none" stroke-width="15" stroke-linecap="square"/>';
  return `<g transform="translate(${x} ${y})"><path d="M-78-86H78V94L0 55l-78 39z" fill="${fill}"/><g stroke="${blue}">${icon}</g></g>`;
}

function fork(copy) {
  const [premise, question] = divide(copy.headline);
  const blue = "#1534AD", cream = "#FFF3CF", lemon = "#CFF967";
  return `<rect width="1080" height="1350" fill="${blue}"/>
    <path d="M61 67h19v49H61zm31 0h9v49h-9z" fill="${lemon}"/>
    ${type(copy.brand,121,108,{width:428,size:45,lines:1,weight:700,color:cream})}
    <path d="M752 95h266" stroke="${cream}" stroke-width="2"/>
    ${headlineText(premise,57,268,{width:975,size:111,lines:1,weight:400,color:cream,family:"Display",spacing:-2.5})}
    ${headlineText(question,55,412,{width:978,size:142,lines:1,weight:400,color:lemon,family:"Display",spacing:-2.8})}
    <path d="M61 467h958" stroke="${cream}" stroke-width="2" opacity=".54"/>
    <g fill="none" stroke-linecap="square" stroke-linejoin="round">
      <path d="M540 919v-62c0-28-12-46-34-59L267 659" stroke="${cream}" stroke-width="25"/>
      <path d="M540 919v-62c0-28 12-46 34-59L813 659" stroke="${lemon}" stroke-width="25"/>
    </g>
    <g fill="none" stroke="#1534AD" stroke-width="9" stroke-linecap="square" stroke-linejoin="miter">
      <path d="m406 756-12-35 35-6" transform="rotate(-12 404 739)"/>
      <path d="m675 756 12-35-35-6" transform="rotate(12 676 739)"/>
    </g>
    ${routePosting(241,596,"write")}${routePosting(839,596,"numbers")}
    <clipPath id="route-station"><circle cx="540" cy="917" r="66"/></clipPath>
    <circle cx="540" cy="917" r="75" fill="${blue}" stroke="${cream}" stroke-width="7"/>
    <g clip-path="url(#route-station)">${photo(474,851,132,132,855,82,470,470)}</g>
    <path d="M60 1038h960" stroke="${cream}" stroke-width="2" opacity=".68"/>
    ${type(copy.support,65,1128,{width:458,size:46,lines:3,leading:1.23,weight:550,color:cream,spacing:-.8})}
    <path d="M557 1094h409l53 63-53 63H557z" fill="${lemon}"/>
    ${type(copy.cta,579,1174,{width:379,size:52,lines:1,weight:790,color:blue,spacing:-1.4})}
    <path d="m966 1143 14 14-14 14" fill="none" stroke="${blue}" stroke-width="5" stroke-linecap="square"/>
  `;
}

function empty(copy) {
  const [query, question] = divide(copy.headline);
  const cream = "#FAF9F4", black = "#191B1C", red = "#BE3528";
  const imprintWidth = Math.min(876, Math.max(515, Math.ceil(units(copy.cta) * 55) + 165));
  // A glass physically erases the ghosted results beneath it. The unfilled centre is the result.
  return `<rect width="1080" height="1350" fill="${cream}"/>
    ${type(copy.brand,69,103,{width:550,size:43,lines:1,weight:600,color:black,spacing:1.4})}
    <circle cx="988" cy="87" r="11" fill="${red}"/>
    <path d="M68 142h944" stroke="${black}" stroke-width="2"/>
    <g transform="translate(102 241)" fill="none" stroke="${black}" stroke-width="5"><circle r="23"/><path d="m17 18 23 23"/></g>
    ${headlineText(query,172,266,{width:836,size:67,lines:1,weight:470,color:black,spacing:-1.4})}
    ${headlineText(question,67,407,{width:947,size:108,lines:1,weight:590,color:black,spacing:-3.8})}
    <path d="M68 452h944" stroke="${black}" stroke-width="5"/>
    <g transform="rotate(-7 459 758)">
      <path d="M116 638h645M116 699h475M116 760h602M116 821h428M116 882h490" stroke="#D9DAD6" stroke-width="7"/>
      <path d="M116 657h256M116 779h312M116 901h230" stroke="#E6E5DF" stroke-width="3"/>
    </g>
    <g transform="translate(565 737)">
      <path d="m125 123 113 112" fill="none" stroke="${black}" stroke-width="34"/>
      <path d="m189 186 83 83" fill="none" stroke="${black}" stroke-width="53" stroke-linecap="round"/>
      <circle r="180" fill="${cream}" stroke="${black}" stroke-width="8"/>
      <circle r="166" fill="none" stroke="#C8C9C2" stroke-width="2"/>
      <clipPath id="lens-reflection"><path d="M-164-10a165 165 0 0 1 249-132c-31-3-89 17-128 47s-81 61-121 85z"/></clipPath>
      <filter id="lens-mono" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>
      <g clip-path="url(#lens-reflection)" opacity=".34" filter="url(#lens-mono)">${photo(-169,-169,338,338,665,90,540,540)}</g>
      <path d="M-48 0h96" stroke="${red}" stroke-width="13"/>
    </g>
    ${type(copy.support,70,1093,{width:931,size:46,lines:2,weight:430,color:black,spacing:-.8})}
    <rect x="68" y="1171" width="${imprintWidth}" height="119" fill="${black}"/>
    ${type(copy.cta,95,1249,{width:imprintWidth-136,size:55,lines:1,weight:630,color:cream,spacing:-1.2})}
    <g transform="translate(${68+imprintWidth-67} 1234)" fill="none" stroke="${cream}" stroke-width="3.7">
      <path d="M-14 15 16-15M-8-15h24V9"/>
    </g>
  `;
}

function input(copy) {
  const [premise, question] = divide(copy.headline);
  const peach = "#F3C5A5", wine = "#401F26", red = "#A62C23", white = "#FFF8EE";
  const fieldWidth = 772;
  const qSize = Math.min(87, Math.floor(fieldWidth / Math.max(1,units(question))));
  const caret = 96 + Math.min(fieldWidth-2,Math.round(units(question)*qSize));
  return `<rect width="1080" height="1350" fill="${peach}"/>
    ${type(copy.brand,66,103,{width:550,size:44,lines:1,weight:680,color:wine,spacing:-.5})}
    <path d="M64 142h954" stroke="${wine}" stroke-width="2.5"/>
    <clipPath id="input-portrait"><path d="M719 215H1080V1015H405V611c0-145 128-311 314-396z"/></clipPath>
    <g clip-path="url(#input-portrait)">
      ${photo(245,213,835,810,662,15,744,767)}
      <path d="M245 213h835v810H245z" fill="#B8502B" opacity=".11"/>
    </g>
    <path d="M63 202h116v12H63z" fill="${red}"/>
    ${headlineText(premise,59,347,{width:565,size:99,lines:2,weight:720,color:wine,leading:1.09,spacing:-3.8})}
    <g transform="rotate(-3.5 533 919)">
      <path d="M51 841h988v201H51z" fill="#47251B" opacity=".16"/>
      <path d="M42 828h988v201H42z" fill="${white}"/>
      <path d="M864 828h166v201H864z" fill="${red}"/>
      ${headlineText(question,83,952,{width:fieldWidth,size:qSize,lines:1,weight:505,color:wine,spacing:-1.8})}
      <path d="M${caret} 872v96" stroke="${red}" stroke-width="4"/>
      <path d="M918 929h62m-27-27 27 27-27 27" fill="none" stroke="${white}" stroke-width="8" stroke-linecap="square"/>
    </g>
    ${type(copy.support,64,1141,{width:946,size:45,lines:2,weight:460,color:wine,spacing:-.7})}
    ${type(copy.cta,62,1273,{width:806,size:62,lines:1,weight:720,color:wine,spacing:-1.8})}
    <path d="M64 1295h362" stroke="${red}" stroke-width="6"/>
  `;
}

function renderSourceSvg({formatId,copy,photo:photoData,fontData,displayFontData,design}) {
  const scene = new Map([["M01",thoughts],["A04",fork],["A10",empty],["D12",input],["M09",pause]]).get(formatId);
  if (!scene) throw new Error("Unknown warehouse format");
  const locked=cleanCopy(copy);
  const sourcePhoto=requireData(photoData,/^image\/(jpeg|png|webp)$/i,"photo");
  // Chrome caches decodes of the small A04 portrait. Give each drawing size its own cache entry.
  const art = artworkGeometry("portrait", design, 1080, 1350);
  const embeddedPhoto = formatId === "A04"
    ? sourcePhoto.replace(";base64,", `;name=A04-${Math.round(art.width)}x${Math.round(art.height)};base64,`)
    : sourcePhoto;
  const embeddedFont=requireData(fontData,/^(font\/woff2|application\/(font-woff2|octet-stream|woff2))$/i,"font");
  const displayFace = displayFontData
    ? `@font-face{font-family:MyinDisplay;src:url("${requireData(displayFontData,/^font\/woff2$/i,"display font")}") format("woff2");font-weight:100 900;font-style:normal;}`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${xml(locked.headline)}"><defs><style>@font-face{font-family:MyinAd;src:url("${embeddedFont}") format("woff2");font-weight:100 900;font-style:normal;}${displayFace}</style><image id="master" width="1500" height="1000" preserveAspectRatio="xMidYMid slice" href="${embeddedPhoto}"/><linearGradient id="photo-edge" x1="0" y1="0" x2="1" y2=".23" gradientUnits="objectBoundingBox"><stop stop-color="#10112c" stop-opacity=".83"/><stop offset=".56" stop-color="#10112c" stop-opacity=".08"/><stop offset="1" stop-color="#10112c" stop-opacity="0"/></linearGradient><linearGradient id="pause-shade" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#101120" stop-opacity=".80"/><stop offset=".32" stop-color="#101120" stop-opacity=".47"/><stop offset=".50" stop-color="#101120" stop-opacity=".01"/><stop offset=".67" stop-color="#101120" stop-opacity=".02"/><stop offset=".78" stop-color="#171735" stop-opacity="1"/><stop offset="1" stop-color="#171735" stop-opacity="1"/></linearGradient></defs>${scene(locked)}</svg>`;
}

const artBackground = { M01:"#F1E7D2", A04:"#1935A5", A10:"#FAF9F4", D12:"#F3C5A5", M09:"#161514" };
export function renderFormatTestSvg(options) {
  return placedSvg(renderSourceSvg(options), options, artBackground[options.formatId]);
}
