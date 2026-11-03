# 문자·메신저 계열 (유쓰 요청 6076e9e6, 대표 2026-11-03 「개발해」): 실제로 익숙한 화면은 그 화면의 색·구조·움직임을 따른다.
# 아이폰 문자 장면 = 흰 화면 · 받은 말풍선 연회색 · 보낸 말풍선 파랑 · 입력 중 점 셋 · 「전송됨」. 마이인 색으로 바꾸지 않는다:
# 색은 rgb(…)로 적는다 — 채널 톤(myin_tone.recolor)은 #RRGGBB만 바꾸므로 이 화면은 실제 iOS 색 그대로 남는다.
# 애플 로고·상표 글자(iMessage 등)는 쓰지 않는다. 효과음은 사운드 창고의 것: 받을 때 bell_notify · 보낼 때 pop_soft · 입력 keyboard_type.
from myin_dia.base import E, T, diagram, f2, g, lines, spring, svg, text_w

BG = "rgb(255,255,255)"; BAR = "rgb(247,247,247)"; HAIR = "rgb(216,216,220)"; GRAYTXT = "rgb(142,142,147)"
THEM = "rgb(233,233,235)"; ME_ = "rgb(10,132,255)"; BLACK = "rgb(0,0,0)"; WHITE_ = "rgb(255,255,255)"
BEZEL = "rgb(28,28,30)"; FIELD = "rgb(209,209,214)"; DOT = "rgb(142,142,147)"

DEFS = """
<linearGradient id="icAv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(168,170,178)"/><stop offset="1" stop-color="rgb(134,136,144)"/></linearGradient>
<filter id="icShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="rgb(20,22,40)" flood-opacity="0.28"/></filter>
"""


def _rr(x, y, w, h, r, fill, extra=""):
    return f'<rect x="{f2(x)}" y="{f2(y)}" width="{f2(w)}" height="{f2(h)}" rx="{f2(r)}" fill="{fill}" {extra}/>'


def _bubble(x, y, w, h, r, fill, mine, tail=True):
    """말풍선 한 개: 둥근 네모 + 아래 모서리에서 바깥으로 살짝 말려 나간 꼬리(보낸 것은 오른쪽, 받은 것은 왼쪽)."""
    out = _rr(x, y, w, h, r, fill)
    if tail:
        bx, by, d = (x + w, y + h, 1) if mine else (x, y + h, -1)
        X = lambda v: f2(bx + d * v)
        out += (f'<path d="M{X(-r)},{f2(by - r)} L{X(0)},{f2(by - r)} L{X(0)},{f2(by - r * 0.32)} '
                f'C{X(0)},{f2(by - r * 0.06)} {X(r * 0.2)},{f2(by + r * 0.02)} {X(r * 0.46)},{f2(by + r * 0.04)} '
                f'C{X(r * 0.12)},{f2(by + r * 0.16)} {X(-r * 0.34)},{f2(by + r * 0.08)} {X(-r * 0.62)},{f2(by - r * 0.1)} '
                f'L{X(-r)},{f2(by - r * 0.1)} Z" fill="{fill}"/>')
    return out


def _messages(sc):
    raw = sc.get("messages", [])
    out = []
    for i, m in enumerate(raw):
        m = m if isinstance(m, dict) else {"text": str(m)}
        out.append({"from": "me" if m.get("from") in ("me", "나", "보냄") else "them", "text": str(m.get("text", ""))[:60],
                    "t": float(m.get("t", sc.get("t0", 0) + 0.8 + 1.1 * i))})
    return out


@diagram("ios_chat", "화면·도구", "아이폰 문자 대화",
         when="「팀장님께 문자가 왔다」 · 「답장을 보냈다」 · 「약속을 문자로 바꿨다」 — 실제 문자·메신저 대화가 오가는 장면(실제 iOS 문자 화면처럼, 마이인 색으로 바꾸지 않음)",
         slots="messages 1~6개: from(me=보냄 · them=받음) + text 4~40자 + t(초) · name: 상대 이름 2~6자 · status: 마지막 보낸 말풍선 아래 글(기본 전송됨) · typing: 받기 전 입력 중 점 셋(기본 켬)",
         motion="폰이 아래에서 올라오고 → 받는 말은 입력 중 점 셋 뒤 왼쪽에 회색 말풍선이 튀어나오고(효과음 bell_notify) → 보내는 말은 아래 입력칸에 글자가 찍힌 뒤(keyboard_type) 파란 말풍선이 위로 올라가고(pop_soft) → 마지막에 「전송됨」",
         sample={"t0": 0, "name": "팀장님", "messages": [{"from": "them", "text": "내일 회의 10시로 당겨도 될까요?", "t": 1.0},
                                                         {"from": "me", "text": "네 가능합니다!", "t": 2.6},
                                                         {"from": "them", "text": "자료는 오늘 중으로 부탁해요", "t": 3.9}]},
         variants={"보낸 말로 끝": {"messages": [{"from": "them", "text": "이번 주말 시간 돼?", "t": 1.0}, {"from": "me", "text": "토요일 오후 괜찮아", "t": 2.5}], "name": "친구"},
                   "답장 고민": {"messages": [{"from": "them", "text": "오늘 일정 다시 잡아야 할 것 같아요", "t": 0.9},
                                             {"from": "them", "text": "3시 괜찮으세요?", "t": 1.9}, {"from": "me", "text": "확인하고 바로 말씀드릴게요", "t": 3.3}], "name": "거래처"},
                   "읽음": {"status": "읽음"}},
         dur=5.6, avoid="여러 앱 알림이 쌓이는 장면(폰 알림 도식) · 직접 만나 나누는 대화")
def ios_chat(sc, t, size):
    w, h = size; vertical = h > w
    msgs = _messages(sc); name = str(sc.get("name", "")).strip()[:8] or "상대"
    typing = sc.get("typing", True); status = str(sc.get("status", "전송됨"))[:6]
    t0 = sc.get("t0", 0)
    # 폰: 화면 아래로 잘려 들고 있는 것처럼(가로 1600×760 · 세로 1000×1250)
    if vertical:
        pw, top, fs, bez = 800, 60, 42, 22
    else:
        pw, top, fs, bez = 560, 34, 31, 16
    cx = w / 2; px = cx - pw / 2; ph = h * 1.4
    sx, sy, sw = px + bez, top + bez, pw - 2 * bez
    vis_bottom = h - 4
    pad = sw * 0.045; r = fs * 0.95; lh = fs * 1.28; maxw = sw * 0.68 - 2 * r

    a, dy = E(t, t0, 0.55), (1 - E(t, t0, 0.55)) * 60
    inner = ""
    # 위: 상태 줄 · 상대(동그라미 + 이름)
    sb = fs * 0.62
    inner += T(sx + pad * 1.6, sy + sb * 1.9, str(sc.get("clock", "10:24")), sb, 700, BLACK, "start")
    inner += _rr(sx + sw - pad * 1.6 - sb * 1.9, sy + sb * 1.05, sb * 1.9, sb * 0.9, sb * 0.22, "none", f'stroke="{BLACK}" stroke-width="2"')
    inner += _rr(sx + sw - pad * 1.6 - sb * 1.9 + 3, sy + sb * 1.05 + 3, sb * 1.3, sb * 0.9 - 6, sb * 0.12, BLACK)
    hy = sy + sb * 2.9; av = fs * 1.45
    head_h = av * 2 + fs * 1.3
    inner += _rr(sx, hy - fs * 0.4, sw, head_h, 0, BAR) + f'<line x1="{f2(sx)}" y1="{f2(hy - fs * 0.4 + head_h)}" x2="{f2(sx + sw)}" y2="{f2(hy - fs * 0.4 + head_h)}" stroke="{HAIR}" stroke-width="2"/>'
    inner += f'<path d="M{f2(sx + pad * 1.9)},{f2(hy + av * 0.55)} l{f2(-fs * 0.42)},{f2(fs * 0.42)} l{f2(fs * 0.42)},{f2(fs * 0.42)}" fill="none" stroke="{ME_}" stroke-width="{f2(fs * 0.13)}" stroke-linecap="round" stroke-linejoin="round"/>'
    inner += f'<circle cx="{f2(cx)}" cy="{f2(hy + av * 0.62)}" r="{f2(av * 0.62)}" fill="url(#icAv)"/>'
    inner += T(cx, hy + av * 0.62 + fs * 0.42, name[0], fs * 1.1, 600, WHITE_)
    inner += T(cx, hy + av * 1.24 + fs * 1.0, name, fs * 0.6, 500, BLACK)
    area_top = hy - fs * 0.4 + head_h + fs * 0.5
    # 아래: 입력칸(보내는 말은 여기서 글자가 찍힌 뒤 날아간다)
    ib_h = fs * 1.75; ib_y = vis_bottom - ib_h - fs * 0.7
    field_x = sx + pad + fs * 1.6; field_w = sw - pad * 2 - fs * 1.6
    inner += f'<circle cx="{f2(sx + pad + fs * 0.62)}" cy="{f2(ib_y + ib_h / 2)}" r="{f2(fs * 0.62)}" fill="{THEM}"/>'
    inner += T(sx + pad + fs * 0.62, ib_y + ib_h / 2 + fs * 0.32, "+", fs * 0.95, 500, GRAYTXT)
    inner += _rr(field_x, ib_y, field_w, ib_h, ib_h / 2, BG, f'stroke="{FIELD}" stroke-width="2"')
    typing_now = None
    for m in msgs:
        if m["from"] == "me" and m["t"] - 0.95 <= t < m["t"]:
            typing_now = m
    if typing_now:
        k = E(t, typing_now["t"] - 0.95, 0.7)
        shown = typing_now["text"][:max(1, int(len(typing_now["text"]) * k + 0.999))]
        inner += T(field_x + fs * 0.6, ib_y + ib_h / 2 + fs * 0.34, shown, fs * 0.9, 500, BLACK, "start")
        inner += f'<circle cx="{f2(field_x + field_w - ib_h / 2)}" cy="{f2(ib_y + ib_h / 2)}" r="{f2(ib_h * 0.36)}" fill="{ME_}"/>'
        ax, ay = field_x + field_w - ib_h / 2, ib_y + ib_h / 2
        inner += f'<path d="M{f2(ax)},{f2(ay + fs * 0.3)} V{f2(ay - fs * 0.3)} M{f2(ax - fs * 0.24)},{f2(ay - fs * 0.06)} L{f2(ax)},{f2(ay - fs * 0.32)} L{f2(ax + fs * 0.24)},{f2(ay - fs * 0.06)}" fill="none" stroke="{WHITE_}" stroke-width="{f2(fs * 0.1)}" stroke-linecap="round" stroke-linejoin="round"/>'
    else:
        inner += T(field_x + fs * 0.6, ib_y + ib_h / 2 + fs * 0.34, "문자 메시지", fs * 0.9, 400, GRAYTXT, "start")

    # 가운데: 말풍선(아래에서 위로 쌓임 · 새 말풍선이 오면 앞의 것이 밀려 올라간다)
    rows = []   # (아래 기준 높이, 그리는 함수)
    floor = ib_y - fs * 0.9
    shown = [m for m in msgs if t >= m["t"]]
    pending = next((m for m in msgs if m["from"] == "them" and typing and m["t"] - 0.75 <= t < m["t"]), None)
    last_me = max((i for i, m in enumerate(shown) if m["from"] == "me"), default=-1)
    blocks = []
    for i, m in enumerate(shown):
        ls = lines(m["text"], maxw, fs, 400)
        bw = max(text_w(x, fs, 400) for x in ls) + 2 * r * 0.95; bh = len(ls) * lh + r * 0.9
        mine = m["from"] == "me"; grow = E(t, m["t"], 0.32)
        extra = fs * 0.95 if (mine and i == last_me and t >= m["t"] + 0.45) else 0
        nxt = shown[i + 1] if i + 1 < len(shown) else None
        tail = not (nxt and nxt["from"] == m["from"])
        blocks.append((m, ls, bw, bh, mine, grow, extra, tail))
    if pending:
        blocks.append(({"from": "them", "t": pending["t"] - 0.75}, None, r * 3.3, fs * 1.75, False, E(t, pending["t"] - 0.75, 0.25), 0, True))
    y = floor
    for (m, ls, bw, bh, mine, grow, extra, tail) in reversed(blocks):
        gap = fs * 0.32 if tail else fs * 0.12
        y -= (bh + gap + extra) * grow
        if y + bh < area_top - fs:
            continue
        bx = sx + sw - pad - bw if mine else sx + pad
        piece = _bubble(bx, y, bw, bh, r, ME_ if mine else THEM, mine, tail)
        if ls is None:   # 입력 중 점 셋
            for j in range(3):
                b = abs(((t * 2.4 - j * 0.22) % 1.0) - 0.5) * 2
                piece += f'<circle cx="{f2(bx + r * 0.95 + j * r * 0.72)}" cy="{f2(y + bh / 2 - fs * 0.12 * (1 - b))}" r="{f2(fs * 0.17)}" fill="{DOT}" opacity="{f2(0.45 + 0.55 * (1 - b))}"/>'
        else:
            for j, ln in enumerate(ls):
                piece += T(bx + r * 0.95, y + r * 0.45 + fs * 0.98 + j * lh, ln, fs, 400, WHITE_ if mine else BLACK, "start")
        if extra:
            piece += T(sx + sw - pad, y + bh + fs * 0.78, status, fs * 0.55, 600, GRAYTXT, "end", E(t, m["t"] + 0.45, 0.3))
        s = 0.55 + 0.45 * min(1.2, spring(t, m["t"], 2.2, 0.58))
        ox = bx + bw if mine else bx
        rows.append(g(piece, 0, 0, s, ox, y + bh, 0, min(1.0, E(t, m["t"], 0.2) * 1.4)))
    clip = f'<clipPath id="icArea"><rect x="{f2(sx)}" y="{f2(area_top)}" width="{f2(sw)}" height="{f2(floor - area_top + fs * 0.6)}"/></clipPath>'
    inner += clip + '<g clip-path="url(#icArea)">' + "".join(rows) + "</g>"

    phone = _rr(px, top, pw, ph, pw * 0.15, BEZEL, 'filter="url(#icShadow)"')
    phone += f'<clipPath id="icScreen"><rect x="{f2(sx)}" y="{f2(sy)}" width="{f2(sw)}" height="{f2(ph - 2 * bez)}" rx="{f2(pw * 0.12)}"/></clipPath>'
    phone += f'<g clip-path="url(#icScreen)"><rect x="{f2(sx)}" y="{f2(sy)}" width="{f2(sw)}" height="{f2(ph)}" fill="{BG}"/>{inner}</g>'
    phone += _rr(cx - pw * 0.16, sy + bez * 0.55, pw * 0.32, pw * 0.085, pw * 0.045, BEZEL)
    out = g(phone, 0, dy, 0.96 + 0.04 * spring(t, t0), cx, top + 200, 0, a)
    return svg(size, out, DEFS)


# ================================================================ 카톡 대화 (대표 2026-11-03 「카톡 대화 장면 만들자」)
# 한국 시청자에게 가장 익숙한 메신저 화면: 하늘빛 회색 바탕 · 받은 말 흰 말풍선(프로필 · 이름) · 보낸 말 노란 말풍선 · 시각과 안 읽은 「1」.
# 로고 · 앱 이름 글자는 쓰지 않는다. 색은 rgb(…)로 적어 채널 톤이 바꾸지 않는다. 효과음: 받을 때 bell_notify · 보낼 때 pop_soft.
K_BG = "rgb(186,206,224)"; K_THEM = "rgb(255,255,255)"; K_ME = "rgb(254,229,0)"
K_INK = "rgb(25,25,25)"; K_SUB = "rgb(85,96,107)"; K_TIME = "rgb(90,104,117)"; K_UNREAD = "rgb(255,196,0)"; K_AV = "rgb(160,175,190)"


def _k_bubble(x, y, w, h, fill, mine, tail, r):
    """카톡 말풍선: 덜 둥근 네모 + 첫 말풍선 위 모서리의 작은 꼬리(받은 것은 왼쪽 위, 보낸 것은 오른쪽 위)."""
    out = _rr(x, y, w, h, r, fill)
    if tail:
        if mine:
            tx = x + w
            out += f'<path d="M{f2(tx - r * 0.9)},{f2(y)} L{f2(tx + r * 0.55)},{f2(y)} Q{f2(tx)},{f2(y + r * 0.35)} {f2(tx - r * 0.1)},{f2(y + r * 1.1)} Z" fill="{fill}"/>'
        else:
            out += f'<path d="M{f2(x + r * 0.9)},{f2(y)} L{f2(x - r * 0.55)},{f2(y)} Q{f2(x)},{f2(y + r * 0.35)} {f2(x + r * 0.1)},{f2(y + r * 1.1)} Z" fill="{fill}"/>'
    return out


@diagram("kakao_chat", "화면·도구", "카톡 대화",
         when="「단톡방에 공지가 올라왔다」 · 「팀장님 카톡에 답했다」 · 「약속을 카톡으로 잡았다」 — 한국 시청자에게 익숙한 메신저 대화 장면(실제 카톡 화면처럼, 마이인 색으로 바꾸지 않음)",
         slots="messages 1~6개: from(me=보냄 · them=받음) + text 4~40자 + t(초) · name: 상대(방) 이름 2~8자 · time: 시각 글(기본 오후 3:12) · read: 보낸 말의 안 읽은 숫자가 사라지는 초(없으면 남음) · unread: 그 숫자(기본 1, 단톡방은 인원 − 1)",
         motion="폰이 아래에서 올라오고 → 받는 말은 프로필 옆에 흰 말풍선이 튀어나오고(효과음 bell_notify) → 보내는 말은 아래 입력칸에 글자가 찍힌 뒤(keyboard_type) 노란 말풍선이 올라가며 옆에 「1」(pop_soft) → read 시각에 「1」이 사라짐",
         sample={"t0": 0, "name": "팀장님", "messages": [{"from": "them", "text": "내일 회의 10시로 당겨도 될까요?", "t": 0.9},
                                                         {"from": "me", "text": "네 가능합니다!", "t": 2.5},
                                                         {"from": "them", "text": "자료는 오늘 중으로 부탁해요", "t": 3.8}], "read": 3.2},
         variants={"단톡방": {"name": "기획팀 4", "messages": [{"from": "them", "text": "이번 주 발표 누가 하죠?", "t": 0.9, "who": "김대리"},
                                                            {"from": "them", "text": "저는 금요일이 어려워요", "t": 1.9, "who": "박주임"},
                                                            {"from": "me", "text": "제가 해 볼게요", "t": 3.2}], "read": None, "unread": 3},
                   "안 읽음": {"read": None},
                   "보낸 말로 끝": {"name": "친구", "messages": [{"from": "them", "text": "이번 주말 시간 돼?", "t": 0.9}, {"from": "me", "text": "토요일 오후 괜찮아", "t": 2.4}], "read": None}},
         dur=5.6, avoid="여러 앱 알림이 쌓이는 장면(폰 알림 도식) · 아이폰 문자로 보낸 장면(아이폰 문자 대화 도식)")
def kakao_chat(sc, t, size):
    w, h = size; vertical = h > w
    raw = sc.get("messages", [])
    msgs = []
    for i, m in enumerate(raw):
        m = m if isinstance(m, dict) else {"text": str(m)}
        msgs.append({"from": "me" if m.get("from") in ("me", "나", "보냄") else "them", "text": str(m.get("text", ""))[:60],
                     "t": float(m.get("t", sc.get("t0", 0) + 0.8 + 1.1 * i)), "who": str(m.get("who", ""))[:8]})
    name = str(sc.get("name", "")).strip()[:10] or "상대"; clock = str(sc.get("time", "오후 3:12"))[:8]
    read_at = sc.get("read"); unread = str(sc.get("unread", 1))[:3]; t0 = sc.get("t0", 0)
    if vertical:
        pw, top, fs, bez = 800, 60, 40, 22
    else:
        pw, top, fs, bez = 560, 34, 29, 16
    cx = w / 2; px = cx - pw / 2; ph = h * 1.4
    sx, sy, sw = px + bez, top + bez, pw - 2 * bez
    vis_bottom = h - 4
    pad = sw * 0.04; r = fs * 0.42; lh = fs * 1.3; av = fs * 1.55
    maxw = sw * 0.62 - 2 * fs * 0.55
    a, dy = E(t, t0, 0.55), (1 - E(t, t0, 0.55)) * 60
    inner = f'<rect x="{f2(sx)}" y="{f2(sy)}" width="{f2(sw)}" height="{f2(ph)}" fill="{K_BG}"/>'
    sb = fs * 0.62
    inner += T(sx + pad * 1.8, sy + sb * 1.9, "10:24", sb, 700, K_INK, "start")
    inner += _rr(sx + sw - pad * 1.8 - sb * 1.9, sy + sb * 1.05, sb * 1.9, sb * 0.9, sb * 0.22, "none", f'stroke="{K_INK}" stroke-width="2"')
    inner += _rr(sx + sw - pad * 1.8 - sb * 1.9 + 3, sy + sb * 1.05 + 3, sb * 1.3, sb * 0.9 - 6, sb * 0.12, K_INK)
    # 위 줄: < · 방 이름 · 돋보기 · 메뉴
    hy = sy + sb * 3.6
    inner += f'<path d="M{f2(sx + pad * 2.2)},{f2(hy - fs * 0.42)} l{f2(-fs * 0.42)},{f2(fs * 0.42)} l{f2(fs * 0.42)},{f2(fs * 0.42)}" fill="none" stroke="{K_INK}" stroke-width="{f2(fs * 0.11)}" stroke-linecap="round" stroke-linejoin="round"/>'
    inner += T(sx + pad * 2.2 + fs * 0.7, hy + fs * 0.34, name, fs * 0.95, 700, K_INK, "start")
    mx = sx + sw - pad * 2.2
    inner += f'<circle cx="{f2(mx - fs * 1.9)}" cy="{f2(hy - fs * 0.06)}" r="{f2(fs * 0.3)}" fill="none" stroke="{K_INK}" stroke-width="{f2(fs * 0.08)}"/>'
    inner += f'<line x1="{f2(mx - fs * 1.68)}" y1="{f2(hy + fs * 0.16)}" x2="{f2(mx - fs * 1.48)}" y2="{f2(hy + fs * 0.36)}" stroke="{K_INK}" stroke-width="{f2(fs * 0.08)}" stroke-linecap="round"/>'
    for j in range(3):
        inner += f'<line x1="{f2(mx - fs * 0.6)}" y1="{f2(hy - fs * 0.3 + j * fs * 0.28)}" x2="{f2(mx)}" y2="{f2(hy - fs * 0.3 + j * fs * 0.28)}" stroke="{K_INK}" stroke-width="{f2(fs * 0.08)}" stroke-linecap="round"/>'
    area_top = hy + fs * 1.1
    # 아래: 입력칸
    ib_h = fs * 1.75; bar_y = vis_bottom - ib_h - fs * 0.9
    inner += _rr(sx, bar_y - fs * 0.35, sw, ph, 0, K_THEM)
    inner += T(sx + pad + fs * 0.55, bar_y + ib_h / 2 + fs * 0.38, "+", fs * 1.25, 400, K_SUB)
    field_x = sx + pad + fs * 1.5; field_w = sw - pad * 2 - fs * 1.5 - fs * 1.9
    inner += _rr(field_x, bar_y, field_w, ib_h, ib_h / 2, "rgb(244,244,244)")
    send_x = field_x + field_w + fs * 0.25
    typing_now = None
    for m in msgs:
        if m["from"] == "me" and m["t"] - 0.95 <= t < m["t"]:
            typing_now = m
    if typing_now:
        k = E(t, typing_now["t"] - 0.95, 0.7)
        shown_text = typing_now["text"][:max(1, int(len(typing_now["text"]) * k + 0.999))]
        inner += T(field_x + fs * 0.6, bar_y + ib_h / 2 + fs * 0.34, shown_text, fs * 0.9, 400, K_INK, "start")
        inner += _rr(send_x, bar_y, fs * 1.6, ib_h, fs * 0.4, K_ME)
        ax, ay = send_x + fs * 0.8, bar_y + ib_h / 2
        inner += f'<path d="M{f2(ax)},{f2(ay + fs * 0.32)} V{f2(ay - fs * 0.3)} M{f2(ax - fs * 0.25)},{f2(ay - fs * 0.05)} L{f2(ax)},{f2(ay - fs * 0.32)} L{f2(ax + fs * 0.25)},{f2(ay - fs * 0.05)}" fill="none" stroke="{K_INK}" stroke-width="{f2(fs * 0.1)}" stroke-linecap="round" stroke-linejoin="round"/>'
    else:
        inner += T(field_x + fs * 0.6, bar_y + ib_h / 2 + fs * 0.34, "메시지 입력", fs * 0.9, 400, "rgb(160,160,160)", "start")
        inner += _rr(send_x, bar_y, fs * 1.6, ib_h, fs * 0.4, "rgb(244,244,244)")
        inner += T(send_x + fs * 0.8, bar_y + ib_h / 2 + fs * 0.36, "#", fs * 0.95, 500, "rgb(170,170,170)")

    floor = bar_y - fs * 1.1
    shown = [m for m in msgs if t >= m["t"]]
    blocks = []
    for i, m in enumerate(shown):
        mine = m["from"] == "me"
        prev = shown[i - 1] if i else None; nxt = shown[i + 1] if i + 1 < len(shown) else None
        first = not (prev and prev["from"] == m["from"] and (mine or prev.get("who") == m.get("who")))
        last = not (nxt and nxt["from"] == m["from"] and (mine or nxt.get("who") == m.get("who")))
        ls = lines(m["text"], maxw, fs, 400)
        bw = max(text_w(x, fs, 400) for x in ls) + 2 * fs * 0.55; bh = len(ls) * lh + fs * 0.62
        label = (fs * 0.95) if (not mine and first) else 0
        blocks.append((m, ls, bw, bh, mine, first, last, label, E(t, m["t"], 0.32)))
    y = floor; rows = []
    for (m, ls, bw, bh, mine, first, last, label, grow) in reversed(blocks):
        gap = fs * 0.55 if first else fs * 0.2
        y -= (bh + label + gap) * grow
        if y + bh < area_top - fs:
            continue
        by = y + label
        bx = sx + sw - pad * 1.6 - bw if mine else sx + pad + av + fs * 0.45
        piece = ""
        if not mine and first:
            piece += _rr(sx + pad, y, av, av, av * 0.38, K_AV)
            piece += f'<circle cx="{f2(sx + pad + av / 2)}" cy="{f2(y + av * 0.4)}" r="{f2(av * 0.18)}" fill="rgb(232,238,244)"/>'
            piece += f'<path d="M{f2(sx + pad + av * 0.2)},{f2(y + av * 0.86)} q{f2(av * 0.3)},{f2(-av * 0.34)} {f2(av * 0.6)},0" fill="rgb(232,238,244)"/>'
            piece += T(bx, y + fs * 0.62, m.get("who") or name, fs * 0.62, 500, K_SUB, "start")
        piece += _k_bubble(bx, by, bw, bh, K_ME if mine else K_THEM, mine, first, r)
        for j, ln in enumerate(ls):
            piece += T(bx + fs * 0.55, by + fs * 0.31 + fs * 0.95 + j * lh, ln, fs, 400, K_INK, "start")
        if last:
            if mine:
                tx = bx - fs * 0.3
                piece += T(tx, by + bh - fs * 0.12, clock, fs * 0.52, 400, K_TIME, "end")
                if read_at is None or t < read_at:
                    piece += T(tx, by + bh - fs * 0.78, unread, fs * 0.55, 700, K_UNREAD, "end")
            else:
                piece += T(bx + bw + fs * 0.3, by + bh - fs * 0.12, clock, fs * 0.52, 400, K_TIME, "start")
        s = 0.55 + 0.45 * min(1.2, spring(t, m["t"], 2.2, 0.58))
        ox = bx + bw if mine else bx
        rows.append(g(piece, 0, 0, s, ox, by, 0, min(1.0, E(t, m["t"], 0.2) * 1.4)))
    inner += f'<clipPath id="kcArea"><rect x="{f2(sx)}" y="{f2(area_top)}" width="{f2(sw)}" height="{f2(floor - area_top + fs * 0.8)}"/></clipPath>'
    inner += '<g clip-path="url(#kcArea)">' + "".join(rows) + "</g>"

    phone = _rr(px, top, pw, ph, pw * 0.15, BEZEL, 'filter="url(#icShadow)"')
    phone += f'<clipPath id="kcScreen"><rect x="{f2(sx)}" y="{f2(sy)}" width="{f2(sw)}" height="{f2(ph - 2 * bez)}" rx="{f2(pw * 0.12)}"/></clipPath>'
    phone += f'<g clip-path="url(#kcScreen)">{inner}</g>'
    phone += _rr(cx - pw * 0.16, sy + bez * 0.55, pw * 0.32, pw * 0.085, pw * 0.045, BEZEL)
    out = g(phone, 0, dy, 0.96 + 0.04 * spring(t, t0), cx, top + 200, 0, a)
    return svg(size, out, DEFS)
