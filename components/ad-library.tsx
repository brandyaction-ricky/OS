"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Image as ImageIcon, Film, Plus } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { AD_IMAGE_STEPS, AD_VIDEO_STEPS, type AdAspect, type AdSetup } from "@/lib/ad-production";
import { emptyImageCreative, imageBriefProblems, type ImageBrief } from "@/lib/image-creative/model";
import { nextAction } from "@/lib/youtube-process/next";
import { projectName, stepHref, type YpProject, type YpTrashed } from "@/lib/youtube-process/project";
import type { YpClient } from "./youtube-process-data";
import { useSession } from "./session-provider";
import { useImageProductCatalog } from "./use-image-product-catalog";
import { ImageProductFields } from "./image-product-fields";
import { loadDemoImages, saveNewDemoAd, demoImageRow } from "./image-creative-demo";
import type { ImageProjectRow, ImageProjectBundle } from "./image-creative-workspace";
import "./ad-production.css";

type Kind = "video" | "image";
type Bucket = "open" | "stalled" | "done" | "trash";
type Row = {
  id: string;
  title: string;
  kind: Kind;
  step: number;
  updated: string;
  test: boolean;
  href: string;
  finished: boolean;
  trash: boolean;
};
const tabs: [Bucket, string][] = [
  ["open", "진행 중"],
  ["stalled", "멈춤"],
  ["done", "끝난 광고"],
  ["trash", "휴지통"],
];
const stepForVideo = (p: YpProject) =>
  ({ topic: 2, draft: 3, outline: 3, make: 4, review: 5, upload: 6, shorts: 6, done: 6 })[p.yp.stage];
export function AdLibrary({
  projects,
  bin,
  client,
  onCopy,
  onTrash,
  onRefresh,
  error,
}: {
  projects: YpProject[] | null;
  bin: (YpTrashed & { canManage: boolean })[];
  client: YpClient | null;
  onCopy: (p: YpProject) => void;
  onTrash: (p: YpProject) => void;
  onRefresh: () => void;
  error: string;
}) {
  const { demo, accessToken, profile } = useSession();
  const [images, setImages] = useState<ImageProjectRow[]>([]),
    [deleted, setDeleted] = useState<ImageProjectRow[]>([]);
  const [bucket, setBucket] = useState<Bucket>("open"),
    [kind, setKind] = useState<Kind | "all">("all"),
    [query, setQuery] = useState("");
  const [reuse, setReuse] = useState<{ setup: AdSetup; kind: Kind } | null>(null);
  const [create, setCreate] = useState(false),
    [issue, setIssue] = useState(""),
    [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (!demo && !accessToken) return;
    const abort = new AbortController();
    async function read() {
      if (demo) {
        const rows = loadDemoImages().map(demoImageRow);
        setImages(rows.filter((r) => !r.archivedAt));
        setDeleted(rows.filter((r) => r.archivedAt));
      } else {
        const [live, trash] = await Promise.all(
          ["", "/trash"].map((path) =>
            apiRequest<{ projects: ImageProjectRow[] }>("/api/v1/content/image-creatives" + path, {
              token: accessToken,
              signal: abort.signal,
            }),
          ),
        );
        if (abort.signal.aborted) return;
        setImages(live.projects);
        setDeleted(trash.projects);
      }
      setReady(true);
      setIssue("");
    }
    void read().catch((e) => {
      if (!abort.signal.aborted) setIssue(e.message);
    });
    return () => abort.abort();
  }, [demo, accessToken, attempt]);
  const video = (p: YpProject, trash = false): Row => ({
    id: p.id,
    title: projectName(p),
    kind: "video",
    step: stepForVideo(p),
    updated: p.yp.contentUpdatedAt,
    test: !!p.yp.isTest,
    href: p.yp.stage === "done" ? stepHref(5, p.id) : nextAction(p).href,
    finished: !!p.yp.adRelease,
    trash,
  });
  const img = (p: ImageProjectRow, trash = false): Row => ({
    id: p.id,
    title: p.title,
    kind: "image",
    step: p.step ?? 2,
    updated: p.updatedAt ?? "",
    test: !!p.isTest,
    href: "/content/images?project=" + encodeURIComponent(p.id),
    finished: !!p.released,
    trash,
  });
  const rows = [
    ...(projects ?? []).map((p) => video(p)),
    ...bin.map((b) => video(b.project, true)),
    ...images.map((p) => img(p)),
    ...deleted.map((p) => img(p, true)),
  ];
  const inBucket = (r: Row, b: Bucket) =>
    b === "trash"
      ? r.trash
      : !r.trash &&
        (b === "done"
          ? r.finished
          : !r.finished && (b !== "stalled" || Date.now() - Date.parse(r.updated) >= 7 * 86400000));
  const typed = rows.filter(
    (r) =>
      (kind === "all" || kind === r.kind) &&
      r.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const shown = typed.filter((r) => inBucket(r, bucket)).sort((a, b) => b.updated.localeCompare(a.updated));
  async function newFormat(row: Row) {
    try {
      const setup =
        row.kind === "video"
          ? projects?.find((p) => p.id === row.id)?.yp.adSetup
          : (demo
              ? loadDemoImages().find((b) => b.project.id === row.id)
              : await apiRequest<ImageProjectBundle>("/api/v1/content/image-creatives/" + row.id, {
                  token: accessToken,
                })
            )?.state?.adSetup;
      if (!setup) {
        setIssue("이전 광고에 확인한 상품 근거가 없어요. 새 광고에서 근거를 입력해 주세요.");
        return;
      }
      setReuse({ setup, kind: row.kind === "video" ? "image" : "video" });
      setCreate(true);
    } catch (e) {
      setIssue((e as Error).message);
    }
  }
  if (create && client) return <NewAd client={client} reuse={reuse} cancel={() => setCreate(false)} />;
  return (
    <section className="ad-library">
      <header className="ad-library-head">
        <h1 className="page-title">내 광고</h1>
        <button
          className="yp-btn yp-pri"
          disabled={!client}
          onClick={() => {
            setReuse(null);
            setCreate(true);
          }}
        >
          <Plus size={16} /> 새 광고
        </button>
      </header>
      <div className="ad-library-tools">
        <div className="yp-seg2" aria-label="광고 상태">
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={bucket === key ? "yp-on" : ""}
              aria-pressed={bucket === key}
              onClick={() => setBucket(key)}
            >
              {label} {typed.filter((r) => inBucket(r, key)).length}
            </button>
          ))}
        </div>
        <div className="ad-kinds" role="group" aria-label="광고 형식">
          {(
            [
              ["all", "전체"],
              ["video", "영상"],
              ["image", "이미지"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              className={kind === value ? "yp-btn yp-sm yp-pri" : "yp-btn yp-sm"}
              key={value}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="yp-in"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="광고 이름으로 찾기"
          aria-label="광고 이름"
        />
      </div>
      {bucket === "stalled" && <p>최근 7일 동안 수정하지 않은 진행 중 광고입니다.</p>}
      {(issue || error) && (
        <p role="alert">
          {issue || error}{" "}
          <button
            className="yp-btn"
            onClick={() => {
              setAttempt((n) => n + 1);
              onRefresh();
            }}
          >
            다시 불러오기
          </button>
        </p>
      )}
      <div className="ad-library-list">
        {shown.map((r) => {
          const p = projects?.find((p) => r.kind === "video" && p.id === r.id);
          const step = (r.kind === "video" ? AD_VIDEO_STEPS : AD_IMAGE_STEPS)[r.step - 1];
          return (
            <article className="ad-row" data-medium={r.kind} key={r.kind + r.id}>
              <div className="ad-row-main">
                <div className="ad-labels">
                  <span className="ad-medium">
                    {r.kind === "video" ? <Film size={16} /> : <ImageIcon size={16} />}
                    {r.kind === "video" ? "영상 광고" : "이미지 광고"}
                  </span>
                  {r.test && <span className="yp-tag">시험</span>}
                </div>
                <strong>{r.title}</strong>
                <small>
                  {bucket === "stalled" && "7일 이상 변경 없음 · "}
                  {r.finished ? "집행 기록 완료" : r.step + "/6 · " + step}
                  {r.updated && " · " + new Date(r.updated).toLocaleDateString("ko-KR") + " 수정"}
                </small>
              </div>
              {r.trash ? (
                r.kind === "image" ? (
                  <Link className="yp-btn" href="/content/images?view=trash">
                    휴지통에서 보기
                  </Link>
                ) : (
                  bin.find((b) => b.project.id === r.id)?.canManage && (
                    <button
                      className="yp-btn"
                      onClick={async () => {
                        try {
                          await client!.restore(r.id);
                          onRefresh();
                        } catch (e) {
                          setIssue((e as Error).message);
                        }
                      }}
                    >
                      복구
                    </button>
                  )
                )
              ) : (
                <>
                  <Link className="yp-btn yp-pri" href={r.href}>
                    {r.finished ? "집행 기록 보기" : step + " 열기"}
                  </Link>
                  {
                    <details>
                      <summary>더 보기</summary>
                      <button type="button" className="yp-btn" onClick={() => void newFormat(r)}>
                        같은 캠페인으로 {r.kind === "video" ? "이미지" : "영상"} 만들기
                      </button>
                      {p && (
                        <>
                          <button className="yp-btn" onClick={() => onCopy(p)}>
                            복제
                          </button>
                          {(demo ||
                            profile?.role === "admin" ||
                            [p.ownerId, p.assigneeId].includes(profile?.id ?? "")) && (
                            <button className="yp-btn" onClick={() => onTrash(p)}>
                              휴지통으로
                            </button>
                          )}
                        </>
                      )}
                    </details>
                  }
                </>
              )}
            </article>
          );
        })}
      </div>
      {!shown.length && !issue && !error && (
        <p className="yp-pempty" role="status">
          {ready && projects ? "조건에 맞는 광고가 없어요." : "광고를 불러오고 있어요…"}
        </p>
      )}
      <Link className="yp-lnk" href="/content/projects?view=discover&platform=ad">
        지난 광고와 주제 살펴보기
      </Link>
    </section>
  );
}

function NewAd({
  client,
  cancel,
  reuse,
}: {
  client: YpClient;
  cancel: () => void;
  reuse: { setup: AdSetup; kind: Kind } | null;
}) {
  const router = useRouter(),
    { demo, accessToken } = useSession(),
    catalog = useImageProductCatalog(false, undefined);
  const [brief, setBrief] = useState<ImageBrief>(() => ({
      ...emptyImageCreative().brief,
      ...(reuse && {
        product: reuse.setup.product,
        objective: reuse.setup.goal,
        offer: reuse.setup.offer ?? "",
        audience: reuse.setup.audience ?? "",
        brand: reuse.setup.brand ?? "",
      }),
    })),
    [kind, setKind] = useState<Kind>(reuse?.kind ?? "video");
  const [name, setName] = useState(""),
    [campaign, setCampaign] = useState(reuse?.setup.campaign ?? ""),
    [landing, setLanding] = useState(reuse?.setup.landingUrl ?? ""),
    [path, setPath] = useState<"free" | "paid">(reuse?.setup.path ?? "free");
  const [checked, setChecked] = useState(false),
    [test, setTest] = useState(false),
    [sizes, setSizes] = useState<AdAspect[]>([reuse?.kind === "image" ? "4x5" : "9x16"]),
    [evidence, setEvidence] = useState(reuse?.setup.evidence ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = kind === "video" ? "9x16" : "4x5";
  async function start() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const facts = evidence.trim(),
        updated = { ...brief, facts, landingUrl: landing.trim() };
      const setup: AdSetup = {
        product: brief.product,
        brand: brief.brand,
        audience: brief.audience,
        offer: brief.offer,
        evidence: facts,
        goal: brief.objective,
        landingUrl: updated.landingUrl,
        campaign: campaign.trim(),
        aspects: sizes,
        path,
      };
      const { adSetupSchema } = await import("@/lib/ad-production-schema");
      if (!checked || !adSetupSchema.safeParse(setup).success || !name.trim())
        throw new Error("광고 이름·캠페인·할 행동·근거와 HTTPS 연결 주소를 확인해 주세요.");
      const issue = imageBriefProblems(updated, true)[0];
      if (issue) throw new Error(issue);
      await catalog.verify(updated);
      if (kind === "video") {
        const p = await client.create({
          kind: "short",
          purpose: "ad",
          title: name.trim(),
          target: brief.audience.slice(0, 300),
          adSetup: setup,
          isTest: test,
        });
        router.push(stepHref(0, p.id));
      } else {
        const p = demo
          ? saveNewDemoAd(name.trim(), updated, setup, test)
          : await apiRequest<{ project: ImageProjectRow }>("/api/v1/content/image-creatives", {
              method: "POST",
              token: accessToken,
              body: JSON.stringify({ title: name.trim(), brief: updated, adSetup: setup, isTest: test }),
            });
        router.push("/content/images?project=" + encodeURIComponent(p.project.id));
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form
      className="panel panel-pad-lg ad-setup"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <header className="ad-library-head">
        <h1>새 광고</h1>
        <button className="secondary-button" type="button" onClick={cancel}>
          목록으로
        </button>
      </header>
      <fieldset disabled={busy}>
        <legend>상품과 형식</legend>
        <div className="ad-format-options">
          {(["video", "image"] as const).map((k) => (
            <label key={k}>
              <input
                type="radio"
                name="kind"
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setSizes([k === "video" ? "9x16" : "4x5"]);
                }}
              />
              {k === "video" ? <Film size={18} /> : <ImageIcon size={18} />}
              {k === "video" ? "영상 · 30초" : "이미지 한 장"}
            </label>
          ))}
        </div>
        <ImageProductFields
          brief={brief}
          setBrief={(b) => {
            if (b.product !== brief.product || b.offer !== brief.offer) {
              setChecked(false);
              setEvidence("");
            }
            setBrief(b);
          }}
          catalog={catalog}
          sample={demo}
          disabled={busy}
        />
        <label>
          광고 이름
          <input
            className="field"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          시험 광고
        </label>
      </fieldset>
      <details className="ic-details">
        <summary>이 광고에 쓰는 정본</summary>
        <p>
          상품 {brief.productSource ? "정본 v" + brief.productSource.source.version : "직접 입력"} · 타겟{" "}
          {brief.productSource?.audienceSource
            ? "정본 v" + brief.productSource.audienceSource.version
            : "직접 입력"}{" "}
          · 운영 정본의 광고 규칙
        </p>
        <p>광고 전용 정본 · 문서 없음</p>
      </details>
      <fieldset disabled={busy}>
        <legend>광고에 사용할 근거</legend>
        {brief.productSource?.productId === "myin-free" && (
          <p>상품 정본과 사이트의 무료 제공 범위가 다릅니다. 현재 사이트에서 확인한 항목만 입력해 주세요.</p>
        )}
        <label>
          확인한 상품 설명 · 가격 · 제공 시점
          <textarea
            className="field"
            required
            maxLength={2000}
            value={evidence}
            onChange={(e) => {
              setEvidence(e.target.value);
              setChecked(false);
            }}
          />
        </label>
        <label>
          <input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} /> 연결
          페이지에서 이 근거를 확인했어요
        </label>
        <label>
          연결 페이지
          <input
            type="url"
            required
            className="field"
            value={landing}
            onChange={(e) => {
              setLanding(e.target.value);
              setChecked(false);
            }}
            placeholder="https://"
          />
        </label>
        <label>
          캠페인 이름 (UTM)
          <input
            className="field"
            required
            maxLength={120}
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          />
        </label>
        <label>
          광고 경로
          <select className="field" value={path} onChange={(e) => setPath(e.target.value as typeof path)}>
            <option value="free">무료 진단 → 유료 구매</option>
            <option value="paid">유료 상품 구매</option>
          </select>
        </label>
        <p>
          {path === "free"
            ? "진단 시작·완료를 추적하고, 같은 UTM의 유료 구매당 총 획득비로 판단해요."
            : "환불을 반영한 구매당 비용과 광고비 대비 매출로 판단해요."}
        </p>
        <div className="ad-kinds">
          {([base, ...(["9x16", "4x5", "1x1"] as AdAspect[]).filter((a) => a !== base)] as AdAspect[]).map((a) => (
            <label key={a}>
              <input
                type="checkbox"
                disabled={a === base}
                checked={sizes.includes(a)}
                onChange={(e) => setSizes((old) => (e.target.checked ? [...old, a] : old.filter((s) => s !== a)))}
              />
              {a.replace("x", ":")}
              {a === base ? " 기본" : ""}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || !checked}>
        {busy ? "저장 중…" : kind === "video" ? "주제 정하기" : "구매 이유 고르기"}
      </button>
    </form>
  );
}
