"use client";

import {
  CalendarClock,
  CircleAlert,
  Download,
  FileCheck2,
  FileText,
  FolderClosed,
  LockKeyhole,
  Plus,
  Receipt,
  Search,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createRecord,
  getCompanyFileUrl,
  listRecords,
  uploadCompanyFile,
} from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type FinanceTab = "spend" | "vat" | "contract" | "subscription" | "documents";
type DocumentFolder = "사업자" | "프로젝트" | "기타";
interface ExpenseRow {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  card: string;
  fingerprint: string;
}

const DOCUMENT_FOLDERS: Array<{
  id: DocumentFolder;
  description: string;
  sensitive: boolean;
}> = [
  { id: "사업자", description: "민감정보 접근 권한 4명", sensitive: true },
  { id: "프로젝트", description: "프로젝트별 계약·증빙", sensitive: false },
  { id: "기타", description: "공통 운영 서류", sensitive: false },
];

const RULES: Array<[RegExp, string]> = [
  [/META|FACEBOOK|인스타/i, "광고"],
  [/ADOBE|OPENAI|ANTHROPIC|NOTION|VERCEL|SUPABASE/i, "구독·프로그램"],
  [/택시|KAKAO T|철도|KORAIL/i, "교통"],
  [/식당|카페|커피|배달/i, "식비"],
  [/문구|OFFICE|쿠팡/i, "사무용품"],
];
function classify(merchant: string) {
  return RULES.find(([rule]) => rule.test(merchant))?.[1] || "확인 필요";
}
function splitCsv(line: string) {
  const cells: string[] = [];
  let value = "",
    quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else value += char;
  }
  cells.push(value.trim());
  return cells;
}
function pick(row: Record<string, string>, keys: string[]) {
  const key = Object.keys(row).find((header) =>
    keys.some((candidate) =>
      header.replace(/\s/g, "").toLowerCase().includes(candidate.toLowerCase()),
    ),
  );
  return key ? row[key] : "";
}
function normalizeDate(value: string) {
  const match = value.match(/(20\d{2})[^0-9]?(\d{1,2})[^0-9]?(\d{1,2})/);
  return match
    ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
    : "";
}
function parseCsv(content: string, bank: string) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsv(lines[0]);
  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsv(line);
      const row = Object.fromEntries(
        headers.map((header, index) => [header, cells[index] ?? ""]),
      );
      const date = normalizeDate(
        pick(row, ["이용일", "거래일", "승인일", "일자", "date"]),
      );
      const merchant = pick(row, [
        "가맹점",
        "이용처",
        "거래처",
        "사용처",
        "merchant",
      ]);
      const amount = Number(
        pick(row, [
          "이용금액",
          "승인금액",
          "거래금액",
          "금액",
          "amount",
        ]).replace(/[^0-9.-]/g, ""),
      );
      const cardRaw = pick(row, ["카드번호", "카드", "card"]);
      const card = cardRaw
        ? `${bank} · ${cardRaw.replace(/\D/g, "").slice(-4).padStart(4, "•")}`
        : bank;
      return {
        date,
        merchant,
        amount,
        category: classify(merchant),
        card,
        fingerprint: `${bank}|${date}|${merchant}|${amount}`,
      };
    })
    .filter(
      (row) =>
        row.date &&
        row.merchant &&
        Number.isFinite(row.amount) &&
        row.amount > 0,
    );
}
function money(value: number) {
  return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
}
function recordMeta(record: OsRecord, key: string) {
  return record.metadata[key];
}
function downloadCsv(name: string, rows: string[][]) {
  const value =
    "\uFEFF" +
    rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
  const url = URL.createObjectURL(
    new Blob([value], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FinanceWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [tab, setTab] = useState<FinanceTab>("spend");
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [preview, setPreview] = useState<ExpenseRow[]>([]);
  const [query, setQuery] = useState("");
  const [documentFolder, setDocumentFolder] = useState<"all" | DocumentFolder>(
    "all",
  );
  const [modal, setModal] = useState<
    "contract" | "subscription" | "document" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const results = await Promise.all(
        ["expense", "contract", "subscription", "company_document"].map(
          (type) =>
            listRecords(
              accessToken,
              type as
                "expense" | "contract" | "subscription" | "company_document",
              "limit=200",
            ),
        ),
      );
      setRecords(results.flatMap((result) => result.records));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "경영지원 자료를 불러오지 못했습니다.",
      );
    }
  }, [accessToken, demo]);
  useEffect(() => {
    load();
  }, [load]);
  const expenses = records.filter((record) => record.record_type === "expense");
  const contracts = records.filter(
    (record) => record.record_type === "contract",
  );
  const subscriptions = records.filter(
    (record) => record.record_type === "subscription",
  );
  const documents = records.filter(
    (record) => record.record_type === "company_document",
  );
  const chooseCsv = async (file: File | undefined, bank: string) => {
    if (!file) return;
    setError("");
    try {
      const parsed = parseCsv(await file.text(), bank);
      const existing = new Set(
        expenses.map((item) => String(recordMeta(item, "fingerprint") || "")),
      );
      setPreview(
        parsed.filter((row) => !existing.has(row.fingerprint)).slice(0, 500),
      );
      if (!parsed.length)
        setError("국민·신한 CSV에서 날짜·가맹점·금액 열을 찾지 못했습니다.");
    } catch {
      setError("CSV 파일을 읽지 못했습니다.");
    }
  };
  const applyCsv = async () => {
    setBusy(true);
    setError("");
    try {
      for (const row of preview) {
        await createRecord(accessToken, {
          recordType: "expense",
          title: row.merchant,
          description: "카드 CSV 가져오기",
          status: row.category === "확인 필요" ? "needs_review" : "classified",
          amount: row.amount,
          metricUnit: "원",
          startsAt: `${row.date}T00:00:00.000Z`,
          tags: [row.category],
          metadata: {
            date: row.date,
            merchant: row.merchant,
            category: row.category,
            card: row.card,
            evidence: false,
            fingerprint: row.fingerprint,
            importedBy: profile?.id,
          },
        });
      }
      setPreview([]);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "지출 내역을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || "").trim();
    setBusy(true);
    try {
      if (modal === "contract")
        await createRecord(accessToken, {
          recordType: "contract",
          title: value("title"),
          description: value("description"),
          status: value("status"),
          dueDate: value("dueDate") || null,
          team: value("team"),
          metadata: {
            counterparty: value("counterparty"),
            contractType: value("contractType"),
            startsOn: value("startsOn"),
            endsOn: value("dueDate"),
            renewal: value("renewal"),
          },
        });
      else if (modal === "subscription")
        await createRecord(accessToken, {
          recordType: "subscription",
          title: value("title"),
          description: value("description"),
          status: "active",
          amount: Number(value("amount") || 0),
          dueDate: value("renewalDate") || null,
          metricUnit: "원",
          metadata: {
            cycle: value("cycle"),
            owner: value("owner"),
            card: value("card"),
          },
        });
      else if (modal === "document") {
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("파일을 선택해 주세요.");
        const uploaded = await uploadCompanyFile(accessToken, file);
        await createRecord(accessToken, {
          recordType: "company_document",
          title: value("title") || file.name,
          description: value("description"),
          status: "active",
          dueDate: value("expiresOn") || null,
          tags: [value("category")],
          metadata: {
            category: value("category"),
            sensitive: value("category") === "사업자",
            filePath: uploaded.path,
            fileName: uploaded.name,
            fileSize: uploaded.size,
          },
        });
      }
      setModal(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openFile = async (record: OsRecord) => {
    try {
      const path = String(recordMeta(record, "filePath") || "");
      const { url } = await getCompanyFileUrl(accessToken, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "파일을 열지 못했습니다.",
      );
    }
  };
  const visibleDocuments = documents.filter(
    (document) =>
      documentFolder === "all" ||
      String(recordMeta(document, "category") || "기타") === documentFolder,
  );
  const quarter = `${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}`;
  const quarterExpenses = expenses.filter((item) => {
    const date = String(recordMeta(item, "date") || dateKey(item.starts_at));
    const month = Number(date.slice(5, 7));
    return (
      date.startsWith(String(new Date().getFullYear())) &&
      Math.floor((month - 1) / 3) + 1 ===
        Math.floor(new Date().getMonth() / 3) + 1
    );
  });
  const missing = quarterExpenses.filter(
    (item) => !recordMeta(item, "evidence"),
  );
  const filtered = expenses.filter((item) =>
    `${item.title} ${recordMeta(item, "category") || ""} ${recordMeta(item, "card") || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const exportVat = () =>
    downloadCsv(`부가세준비_${quarter}.csv`, [
      ["일자", "가맹점", "금액", "분류", "카드", "증빙"],
      ...quarterExpenses.map((item) => [
        String(recordMeta(item, "date") || ""),
        item.title,
        String(item.amount || 0),
        String(recordMeta(item, "category") || ""),
        String(recordMeta(item, "card") || ""),
        recordMeta(item, "evidence") ? "완료" : "누락",
      ]),
    ]);
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">경영지원</span>
          <h1>경영지원</h1>
          <p>
            법인카드 사용처 확인과 부가세 자료 준비에 드는 반복 시간을 줄입니다.
          </p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      <div className="workspace-tabs finance-tabs">
        {(
          [
            ["spend", "지출·카드"],
            ["vat", "부가세 준비"],
            ["contract", "계약"],
            ["subscription", "구독·프로그램"],
            ["documents", "서류함"],
          ] as [FinanceTab, string][]
        ).map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "spend" ? (
        <>
          <section className="metric-grid compact-metrics">
            <div className="metric-card">
              <div className="metric-top">
                <span>이번 달 지출</span>
                <WalletCards size={16} />
              </div>
              <div className="metric-value growth-money">
                {money(
                  expenses
                    .filter((item) =>
                      String(recordMeta(item, "date") || "").startsWith(
                        new Date().toISOString().slice(0, 7),
                      ),
                    )
                    .reduce((sum, item) => sum + Number(item.amount || 0), 0),
                )}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <span>확인 필요</span>
                <CircleAlert size={16} />
              </div>
              <div className="metric-value">
                {
                  expenses.filter((item) => item.status === "needs_review")
                    .length
                }
              </div>
              <div className="metric-caption warn">미분류 사용처</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <span>증빙 없음</span>
                <Receipt size={16} />
              </div>
              <div className="metric-value">
                {
                  expenses.filter((item) => !recordMeta(item, "evidence"))
                    .length
                }
              </div>
            </div>
          </section>
          <section className="panel csv-import-panel">
            <div>
              <Upload size={20} />
              <span className="csv-import-copy">
                <strong>카드 CSV 가져오기</strong>
                <small>
                  국민·신한 파일에서 날짜·가맹점·금액만 읽습니다.
                  <br />카드번호는 저장하지 않습니다.
                </small>
              </span>
            </div>
            <label className="csv-file-picker">
              <span>국민카드 CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="국민카드 CSV 파일 선택"
                onChange={(event) => chooseCsv(event.target.files?.[0], "국민")}
              />
            </label>
            <label className="csv-file-picker">
              <span>신한카드 CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="신한카드 CSV 파일 선택"
                onChange={(event) => chooseCsv(event.target.files?.[0], "신한")}
              />
            </label>
          </section>
          {preview.length ? (
            <section className="panel csv-preview">
              <div className="panel-header">
                <div>
                  <h2>가져오기 미리보기</h2>
                  <p>
                    중복을 제외한 {preview.length}건 · 자동분류 후 확인 필요만
                    수정
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={applyCsv}
                >
                  {busy ? "저장 중…" : `${preview.length}건 저장`}
                </button>
              </div>
              <div>
                {preview.slice(0, 20).map((row) => (
                  <div key={row.fingerprint}>
                    <span>{row.date}</span>
                    <strong>{row.merchant}</strong>
                    <em>{row.category}</em>
                    <b>{row.amount.toLocaleString("ko-KR")}원</b>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>지출 내역</h2>
                <p>가맹점·분류·카드로 즉시 재확인</p>
              </div>
              <label className="table-search">
                <Search size={14} />
                <input
                  aria-label="지출 내역 검색"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="가맹점·카테고리 검색"
                />
              </label>
            </div>
            <div className="finance-table">
              <div className="finance-row head">
                <span>일자</span>
                <span>가맹점</span>
                <span>금액</span>
                <span>분류</span>
                <span>카드</span>
                <span>증빙</span>
              </div>
              {filtered.map((item) => (
                <div
                  className={`finance-row${item.status === "needs_review" ? " needs-review" : ""}`}
                  key={item.id}
                >
                  <span>{String(recordMeta(item, "date") || "")}</span>
                  <strong>{item.title}</strong>
                  <span>
                    {Number(item.amount || 0).toLocaleString("ko-KR")}원
                  </span>
                  <em>{String(recordMeta(item, "category") || "확인 필요")}</em>
                  <span>{String(recordMeta(item, "card") || "")}</span>
                  <span>{recordMeta(item, "evidence") ? "완료" : "누락"}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {tab === "vat" ? (
        <>
          <section className="metric-grid compact-metrics">
            <div className="metric-card">
              <div className="metric-top">
                <span>대상 분기</span>
                <CalendarClock size={16} />
              </div>
              <div className="metric-value">{quarter}</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <span>매입 내역</span>
                <Receipt size={16} />
              </div>
              <div className="metric-value">{quarterExpenses.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <span>증빙 누락</span>
                <CircleAlert size={16} />
              </div>
              <div className="metric-value">{missing.length}</div>
              <div className="metric-caption warn">세무사 전달 전 확인</div>
            </div>
          </section>
          <section className="panel vat-panel">
            <div className="panel-header">
              <div>
                <h2>부가세 준비</h2>
                <p>신고가 아니라 증빙 정리표를 만들어 세무사에게 전달합니다.</p>
              </div>
              <button className="primary-button" onClick={exportVat}>
                <Download size={15} />
                세무사 전달용 CSV
              </button>
            </div>
            <div className="missing-evidence">
              {missing.map((item) => (
                <div key={item.id}>
                  <CircleAlert size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {String(recordMeta(item, "date") || "")} ·{" "}
                      {Number(item.amount || 0).toLocaleString("ko-KR")}원
                    </small>
                  </span>
                  <em>증빙 누락</em>
                </div>
              ))}
              {!missing.length ? (
                <div className="quiet-state">
                  <FileCheck2 />
                  <strong>누락된 증빙 없음</strong>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {tab === "contract" ? (
        <RecordList
          title="계약"
          description="상대·기간·만료·갱신 상태"
          records={contracts}
          onAdd={() => setModal("contract")}
        />
      ) : null}
      {tab === "subscription" ? (
        <RecordList
          title="구독·프로그램"
          description="월 비용·결제 주기·갱신일"
          records={subscriptions}
          onAdd={() => setModal("subscription")}
        />
      ) : null}
      {tab === "documents" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>서류함</h2>
              <p>사업자·프로젝트·기타 문서를 비공개 저장소에 보관합니다.</p>
            </div>
            <button
              className="primary-button"
              onClick={() => setModal("document")}
            >
              <Plus size={15} />
              서류 추가
            </button>
          </div>
          <div className="document-folder-toolbar">
            <button
              className={documentFolder === "all" ? "active" : ""}
              onClick={() => setDocumentFolder("all")}
            >
              전체 서류 <b>{documents.length}</b>
            </button>
          </div>
          <div className="document-folders">
            {DOCUMENT_FOLDERS.map((folder) => {
              const count = documents.filter(
                (document) =>
                  String(recordMeta(document, "category") || "기타") === folder.id,
              ).length;
              return (
                <button
                  key={folder.id}
                  className={documentFolder === folder.id ? "active" : ""}
                  onClick={() => setDocumentFolder(folder.id)}
                >
                  <span className="document-folder-icon">
                    {folder.sensitive ? <LockKeyhole size={17} /> : <FolderClosed size={17} />}
                  </span>
                  <span>
                    <strong>{folder.id}</strong>
                    <small>{folder.description}</small>
                  </span>
                  <em>{count}</em>
                </button>
              );
            })}
          </div>
          <div className="document-vault">
            {visibleDocuments.map((item) => (
              <button key={item.id} onClick={() => openFile(item)}>
                <FileText size={18} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {String(recordMeta(item, "category") || "기타")} ·{" "}
                    {String(recordMeta(item, "fileName") || "")}
                  </small>
                </span>
                <em>{item.due_date ? `만료 ${item.due_date}` : "만료 없음"}</em>
              </button>
            ))}
            {!visibleDocuments.length ? (
              <div className="quiet-state">
                <FileText />
                <strong>
                  {documentFolder === "all"
                    ? "등록된 서류 없음"
                    : `${documentFolder} 폴더에 등록된 서류 없음`}
                </strong>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      {modal ? (
        <div
          className="drawer-backdrop"
          onMouseDown={() => !busy && setModal(null)}
        >
          <form
            className="record-drawer"
            onSubmit={submit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <span className="eyebrow">경영지원</span>
                <h2>
                  {modal === "contract"
                    ? "계약 등록"
                    : modal === "subscription"
                      ? "구독 등록"
                      : "서류 등록"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModal(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              <span>이름</span>
              <input name="title" required />
            </label>
            {modal === "contract" ? (
              <>
                <div className="form-grid">
                  <label>
                    <span>상대방</span>
                    <input name="counterparty" />
                  </label>
                  <label>
                    <span>유형</span>
                    <input name="contractType" placeholder="외주·제휴·NDA" />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    <span>시작일</span>
                    <input type="date" name="startsOn" />
                  </label>
                  <label>
                    <span>만료일</span>
                    <input type="date" name="dueDate" />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    <span>상태</span>
                    <select name="status">
                      <option value="active">유효</option>
                      <option value="renewal">갱신 검토</option>
                      <option value="ended">종료</option>
                    </select>
                  </label>
                  <label>
                    <span>갱신</span>
                    <select name="renewal">
                      <option>수동 갱신</option>
                      <option>자동 갱신</option>
                      <option>갱신 없음</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>담당 팀</span>
                  <input name="team" />
                </label>
              </>
            ) : modal === "subscription" ? (
              <>
                <div className="form-grid">
                  <label>
                    <span>금액</span>
                    <input type="number" name="amount" />
                  </label>
                  <label>
                    <span>주기</span>
                    <select name="cycle">
                      <option>월</option>
                      <option>연</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    <span>갱신일</span>
                    <input type="date" name="renewalDate" />
                  </label>
                  <label>
                    <span>담당</span>
                    <input name="owner" />
                  </label>
                </div>
                <label>
                  <span>결제 카드</span>
                  <input name="card" placeholder="국민 · 1234처럼 뒤 4자리만" />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>분류</span>
                  <select
                    name="category"
                    defaultValue={documentFolder === "all" ? "기타" : documentFolder}
                  >
                    <option>사업자</option>
                    <option>프로젝트</option>
                    <option>기타</option>
                  </select>
                </label>
                <label>
                  <span>파일</span>
                  <input
                    type="file"
                    name="file"
                    accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx"
                    required
                  />
                </label>
                <label>
                  <span>만료일</span>
                  <input type="date" name="expiresOn" />
                </label>
              </>
            )}
            <label>
              <span>메모</span>
              <textarea name="description" rows={4} />
            </label>
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                취소
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "저장 중…" : "저장"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function dateKey(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}
function RecordList({
  title,
  description,
  records,
  onAdd,
}: {
  title: string;
  description: string;
  records: OsRecord[];
  onAdd: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={15} />
          추가
        </button>
      </div>
      <div className="support-record-list">
        {records.map((item) => (
          <div key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.description ||
                  String(
                    recordMeta(item, "counterparty") ||
                      recordMeta(item, "cycle") ||
                      "",
                  )}
              </small>
            </span>
            <em>
              {item.amount
                ? money(Number(item.amount))
                : item.due_date
                  ? `만료 ${item.due_date}`
                  : item.status}
            </em>
            <span className={`status-pill status-${item.status}`}>
              {item.status}
            </span>
          </div>
        ))}
        {!records.length ? (
          <div className="quiet-state">
            <FileText />
            <strong>등록된 항목 없음</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}
