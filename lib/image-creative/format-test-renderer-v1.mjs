import { placedSvg } from "./safe-artwork.mjs";
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
function type(value, x, y, {width, size, lines = 2, weight = 780, color = ink, align = "start", spacing = -1, leading = 1.16}) {
  let font = size;
  let rows = wrap(value, width, font);
  while (rows.length > lines && font > 18) rows = wrap(value, width, --font);
  if (rows.length > lines) throw new Error("Copy cannot fit the selected format");
  return `<text font-family="MyinAd,Pretendard,sans-serif" font-size="${font}" font-weight="${weight}" letter-spacing="${spacing}" fill="${color}" text-anchor="${align}">`+
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
function foot(copy,{dark=false,background=true}={}) {
  return (background?`<path fill="${dark?ink:paper}" d="M0 1016H1080V1350H0Z"/>`:"") +
    type(copy.support,72,1110,{width:944,size:42,lines:2,weight:580,color:dark?"#fff":ink,spacing:-1.2,leading:1.08})+
    `<rect x="64" y="1186" width="952" height="110" rx="55" fill="${violet}"/>`+
    type(copy.cta,107,1259,{width:745,size:52,lines:1,color:"#fff",weight:780,spacing:-1.8})+arrow(904,1242,"#fff",1.05);
}
function bubble(x,y,w,h,fill,tipX) {
  const tip = Math.min(Math.max(tipX,60),w-70);
  return `<path transform="translate(${x} ${y})" fill="${fill}" d="M42 0H${w-42}Q${w} 0 ${w} 42V${h-42}Q${w} ${h} ${w-42} ${h}H${tip+36}L${tip+48} ${h+28}Q${tip+7} ${h+15} ${tip-8} ${h}H42Q0 ${h} 0 ${h-42}V42Q0 0 42 0Z"/>`;
}
function bubbleText(value, x, y, w, h, max) {
  // Fit typical thoughts on one line. Longer user input fits two centered lines.
  const area = w - 76;
  let size = Math.min(max, Math.floor(area / Math.max(units(value), 1)));
  if (size < 44) size = Math.min(max, Math.floor(h / 2.65));
  let rows = wrap(value, area, size);
  while (rows.length * size * 1.13 > h - 20 && size > 19) rows = wrap(value, area, --size);
  const baseline=y+(h-rows.length*size*1.13)/2+size*.9;
  return headlineText(value,x+38,baseline,{width:area,size,lines:rows.length,weight:780,spacing:-2,leading:1.13});
}
function thoughts(copy) {
  const [a,b]=divide(copy.headline);
  return photo(0,0,1080,1030,0,0,1500,1000)+
    '<path fill="url(#photo-edge)" d="M0 0H1080V1030H0Z"/>'+brand(copy.brand,"#fff")+
    bubble(55,202,705,164,paper,475)+bubbleText(a,55,202,705,164,70)+
    bubble(76,445,606,157,lime,415)+bubbleText(b,76,445,606,157,73)+foot(copy);
}
function documentNode(cx,cy,second) {
  const icon=second ?
    '<path d="M-25 20V2M-2 20v-36M21 20v-54" stroke-width="12"/>' :
    '<path d="m-26 21 5-18 34-34 15 15-34 34-20 3zM5-24l14 14" stroke-width="6"/>';
  return `<g transform="translate(${cx} ${cy})">
    <rect x="-113" y="-97" width="226" height="194" rx="13" fill="white" stroke="${ink}" stroke-width="4"/>
    <path d="M58-97v57l14-9 14 9v-57" fill="${second?violet:lime}"/>
    <g transform="translate(-50 -24)" fill="none" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round">${icon}</g>
    <path d="M-78 24h150" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>
    <path d="M-78 48h94m-94 18h119" stroke="#B4B1C1" stroke-width="6" stroke-linecap="round"/>
    </g>`;
}
function fork(copy) {
  return `<path fill="${paper}" d="M0 0H1080V1350H0Z"/>`+brand(copy.brand)+
    headlineText(copy.headline,66,237,{width:945,size:91,lines:2,weight:820,spacing:-4.3,leading:1.05})+
    `<g fill="none" stroke="${violet}" stroke-width="12" stroke-linecap="round"><path d="M540 549v26q0 30-33 30H306q-50 0-50 51v13M540 549v26q0 30 33 30h201q50 0 50 51v13"/><path d="M256 845v14q0 47 47 47h190q47 0 47 45v36M824 845v14q0 47-47 47H587q-47 0-47 45"/></g>`+
    `<path d="m518 970 22 22 22-22" fill="none" stroke="${violet}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`+
    circlePhoto(540,480,71,780,65,510,510)+
    documentNode(256,754,false)+documentNode(824,754,true)+foot(copy);
}
function empty(copy) {
  return `<rect width="1080" height="1350" fill="${lilac}"/>`+
    brand(copy.brand)+circlePhoto(961,88,34,775,55,520,520)+
    `<rect x="55" y="190" width="970" height="204" rx="54" fill="#fff" stroke="${violet}" stroke-width="4"/><g fill="none" stroke="${violet}" stroke-width="8" stroke-linecap="round"><circle cx="124" cy="287" r="20"/><path d="m139 304 19 19"/></g>`+
    headlineText(divide(copy.headline)[0],190,268,{width:776,size:66,lines:1,weight:740,spacing:-2.2})+
    headlineText(divide(copy.headline)[1],190,341,{width:776,size:68,lines:1,weight:740,spacing:-2.2})+
    `<g transform="translate(540 672)" fill="none"><path d="M-159-141h197l62 62v208h-259z" fill="#f4f3fe" stroke="${violet}" stroke-width="5" stroke-dasharray="13 15"/><path d="M34-141v62h62" stroke="${violet}" stroke-width="4" stroke-dasharray="13 15"/><path d="M-95-41h111M-95 7h77" stroke="#B5ACE8" stroke-width="9" stroke-linecap="round"/><circle cx="58" cy="57" r="90" fill="${lime}" stroke="${ink}" stroke-width="12"/><path d="m123 122 78 78" stroke="${ink}" stroke-width="25" stroke-linecap="round"/><path d="M28 57h60" stroke="${ink}" stroke-width="10" stroke-linecap="round"/></g>`+
    `<path d="M246 954h588" stroke="#A39CCD" stroke-width="2" stroke-dasharray="8 15"/>`+foot(copy,{background:false});
}
function input(copy) {
  const [a,b]=divide(copy.headline);
  return photo(0,0,1080,1060,10,5,1480,985)+
    '<path fill="url(#photo-edge)" d="M0 0H1080V1060H0Z"/>'+brand(copy.brand,"#fff")+
    headlineText(a,66,255,{width:658,size:87,lines:2,weight:800,color:"#fff",spacing:-4,leading:1.04})+
    `<rect x="56" y="826" width="969" height="156" rx="33" fill="#fff"/><rect x="865" y="847" width="112" height="112" rx="56" fill="${violet}"/>`+
    headlineText(b,100,930,{width:671,size:66,lines:1,weight:680,spacing:-2.6})+
    `<path d="M${Math.round(106+Math.min(671,units(b)*64))} 867v70" stroke="${violet}" stroke-width="4"/>`+arrow(898,903,"#fff",.95)+foot(copy);
}
function pause(copy) {
  return `<rect width="1080" height="1350" fill="${ink}"/>`+photo(0,0,1080,1052,350,465,690,535)+
    '<path fill="url(#pause-shade)" d="M0 0H1080V1350H0Z"/>'+brand(copy.brand,"#fff")+
    headlineText(copy.headline,65,253,{width:940,size:93,lines:2,weight:810,color:"#fff",spacing:-4.4,leading:1.04})+
    foot(copy,{dark:true,background:false});
}
function renderSourceSvg({formatId,copy,photo:photoData,fontData}) {
  const scene = new Map([["M01",thoughts],["A04",fork],["A10",empty],["D12",input],["M09",pause]]).get(formatId);
  if (!scene) throw new Error("Unknown warehouse format");
  const locked=cleanCopy(copy);
  const embeddedPhoto=requireData(photoData,/^image\/(jpeg|png|webp)$/i,"photo");
  const embeddedFont=requireData(fontData,/^(font\/woff2|application\/(font-woff2|octet-stream|woff2))$/i,"font");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${xml(locked.headline)}"><defs><style>@font-face{font-family:MyinAd;src:url("${embeddedFont}") format("woff2");font-weight:100 900;font-style:normal;}</style><image id="master" width="1500" height="1000" preserveAspectRatio="xMidYMid slice" href="${embeddedPhoto}"/><linearGradient id="photo-edge" x1="0" y1="0" x2="1" y2=".23" gradientUnits="objectBoundingBox"><stop stop-color="#10112c" stop-opacity=".83"/><stop offset=".56" stop-color="#10112c" stop-opacity=".08"/><stop offset="1" stop-color="#10112c" stop-opacity="0"/></linearGradient><linearGradient id="pause-shade" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#101120" stop-opacity=".80"/><stop offset=".32" stop-color="#101120" stop-opacity=".47"/><stop offset=".50" stop-color="#101120" stop-opacity=".01"/><stop offset=".67" stop-color="#101120" stop-opacity=".02"/><stop offset=".78" stop-color="#171735" stop-opacity="1"/><stop offset="1" stop-color="#171735" stop-opacity="1"/></linearGradient></defs>${scene(locked)}</svg>`;
}

const artBackground = { M01:"#F6F4EF", A04:"#F6F4EF", A10:"#E6E2FC", D12:"#F6F4EF", M09:"#171735" };
export function renderFormatTestSvg(options) {
  return placedSvg(renderSourceSvg(options), options, artBackground[options.formatId]);
}
