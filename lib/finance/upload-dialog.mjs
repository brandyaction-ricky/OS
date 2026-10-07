import {
  IMPORT_FIELDS,
  inferMapping,
  parseCsv,
  previewImport,
  readImportFile,
} from "./import-file.mjs";

/** UI adapter lets the import wizard use a future repository without owning it. */
export function createImportFlow(adapter) {
  const { root, esc } = adapter;
  const savedMappings = new Map();
  let kind = "cards",
    table = null,
    mapping = {},
    preview = null,
    step = 0,
    account = "",
    fileName = "",
    ticket = 0,
    busy = false;
  const get = (id) => root.querySelector("#" + id);
  const showError = (message) => {
    const el = get("importError");
    if (el) {
      el.textContent = message;
      el.focus();
    }
  };
  const label = () =>
    kind === "cards" ? "카드 내역 올리기" : "통장 내역 올리기";
  const existing = () => (kind === "cards" ? adapter.cards() : adapter.bank());

  function open(nextKind = "cards") {
    ticket++;
    kind = nextKind;
    table = null;
    mapping = {};
    preview = null;
    step = 0;
    busy = false;
    fileName = "";
    account =
      adapter.selectedAccount() === "all"
        ? adapter.accounts()[0]?.id || ""
        : adapter.selectedAccount();
    render();
  }
  function render() {
    const stages = ["파일", "열 맞추기", "미리보기", "완료"];
    const steps = `<div class="steps" aria-label="가져오기 단계">${stages.map((name, index) => `<span class="${index === step ? "on" : index < step ? "done" : ""}" ${index === step ? 'aria-current="step"' : ""}>${index + 1} ${name}</span>`).join("")}</div>`;
    let body = "",
      footer = '<button class="btn sm" data-act="close">닫기</button>';
    if (step === 0) {
      body = `${
        kind === "bank"
          ? `<div class="field"><label for="importAccount">가져올 통장</label><select class="input" id="importAccount">${adapter
              .accounts()
              .map(
                (a) =>
                  `<option value="${esc(a.id)}" ${a.id === account ? "selected" : ""}>${esc(a.name)} ••${esc(a.last || "예시")}</option>`,
              )
              .join("")}</select></div>`
          : ""
      }
        <div class="dropzone"><b>${kind === "cards" ? "카드사 이용 내역" : "은행 거래 내역"}</b><span class="small muted">CSV 또는 XLSX · 5MB · 최대 5,000행 · 첫 행은 열 이름</span><input type="file" id="ledgerFile" aria-label="거래 내역 파일" accept=".csv,.xlsx" data-change="ledgerfile" ${busy ? "disabled" : ""}><button class="btn sm" data-act="ledgerDemo" ${busy ? "disabled" : ""}>예시 파일로 해 보기</button></div>
        <p class="note">파일은 브라우저에서만 읽습니다. 서버에 업로드하거나 실제 계좌·카드를 연결하지 않습니다. 새로고침하면 사라집니다.</p><p id="importStatus" role="status">${busy ? "파일을 읽고 있습니다…" : ""}</p>`;
    } else if (step === 1) {
      body = `<p class="small">${esc(fileName)} · ${table.rows.length}행 · 필수 열(*)을 연결하세요.</p><div class="stack">${IMPORT_FIELDS[kind].map(([key, name, required]) => `<div class="field"><label for="map-${key}">${name}${required ? " *" : ""}</label><select class="input" id="map-${key}" data-map="${key}"><option value="-1">쓰지 않음</option>${table.headers.map((header, index) => `<option value="${index}" ${mapping[key] === index ? "selected" : ""}>${esc(header)} (열 ${index + 1})</option>`).join("")}</select></div>`).join("")}</div>`;
      footer =
        '<button class="btn sm" data-act="ledgerBack">이전</button><button class="btn pri sm" data-act="ledgerPreview">미리보기</button>';
    } else if (step === 2) {
      const newCards =
        kind === "cards"
          ? [...new Set(preview.valid.map((r) => r.last))].filter(
              (last) => !adapter.cardRegistry().some((c) => c.last === last),
            )
          : [];
      body = `<div class="tiles t3"><div class="tile"><span class="l">새 거래</span><b>${preview.valid.length}건</b></div><div class="tile"><span class="l">중복 제외</span><b>${preview.duplicates.length}건</b></div><div class="tile"><span class="l">오류 제외</span><b>${preview.errors.length}건</b></div></div>
        ${newCards.map((last) => `<div class="card"><h3>새 카드 ••${esc(last)}</h3><div class="field"><label for="new-name-${last}">카드 이름 *</label><input class="input" id="new-name-${last}" maxlength="60" placeholder="예: 법인 공용"></div><div class="field"><label for="new-owner-${last}">사용자 *</label><input class="input" id="new-owner-${last}" maxlength="60" placeholder="예: 담당 A"></div></div>`).join("")}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>${kind === "cards" ? "가맹점" : "적요"}</th><th class="r">금액</th></tr></thead><tbody>${preview.valid
          .slice(0, 20)
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.merchant || r.desc)}</td><td class="r">${adapter.amount(kind === "cards" ? r.krw : r.in - r.out)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><p class="note">처음 20건 미리보기 · 오류와 중복은 제외하고 새 거래만 가져옵니다.</p>
        ${preview.errors.length ? `<details><summary>오류 ${preview.errors.length}건 보기</summary>${preview.errors.map((r) => `<p class="small">${r.line}행: ${esc(r.error)}</p>`).join("")}</details>` : ""}`;
      footer = `<button class="btn sm" data-act="ledgerBack">이전</button><button class="btn pri sm" data-act="ledgerCommit" ${preview.valid.length ? "" : "disabled"}>새 거래 ${preview.valid.length}건 가져오기</button>`;
    } else {
      body = `<div class="callout info"><b>모의 내역에 반영했습니다</b><span>${preview.valid.length}건 추가 · ${preview.duplicates.length}건 중복 제외 · ${preview.errors.length}건 오류 제외</span></div><p class="note">이 모의 작업공간에서만 유지됩니다. 실제 거래나 영구 저장은 실행되지 않았습니다.</p>`;
      footer +=
        '<button class="btn pri sm" data-act="ledgerFinish">내역 보기</button>';
    }
    adapter.drawer(
      label(),
      "로컬 파일 가져오기 · API 연결 전",
      steps +
        body +
        '<p id="importError" role="alert" tabindex="-1" class="small" style="color:var(--bad)"></p>',
      footer,
    );
  }
  function setTable(value) {
    table = value;
    mapping =
      savedMappings.get(JSON.stringify([kind, table.headers])) ||
      inferMapping(table.headers, kind);
    step = 1;
    busy = false;
    render();
  }
  async function file(file) {
    if (!file) return;
    if (kind === "bank") account = get("importAccount")?.value || account;
    const request = ++ticket;
    busy = true;
    fileName = file.name;
    render();
    try {
      const value = await readImportFile(file);
      if (request === ticket && get("importStatus")) setTable(value);
    } catch (error) {
      if (request === ticket && get("importStatus")) {
        busy = false;
        render();
        showError(error.message);
      }
    }
  }
  function action(name) {
    if (!name.startsWith("ledger")) return false;
    if (name === "ledgerDemo") {
      if (kind === "bank") account = get("importAccount")?.value || account;
      fileName = "예시 거래.csv";
      setTable(
        parseCsv(
          kind === "cards"
            ? "이용일자,이용시간,카드번호,가맹점명,이용금액,승인번호\n2026-10-06,12:30,1234,예시 촬영 스튜디오,150000,DEMO-1001\n2026-10-06,14:00,1234,예시 문구점,25000,DEMO-1002"
            : "거래일,거래시간,적요,입금,출금\n2026-10-06,12:30,예시 거래처 입금,550000,0\n2026-10-06,15:00,예시 소모품,0,25000",
        ),
      );
    } else if (name === "ledgerBack") {
      step = Math.max(0, step - 1);
      render();
    } else if (name === "ledgerPreview") {
      mapping = Object.fromEntries(
        [...root.querySelectorAll("[data-map]")].map((el) => [
          el.dataset.map,
          Number(el.value),
        ]),
      );
      try {
        preview = previewImport(table, mapping, kind, existing(), account);
        savedMappings.set(JSON.stringify([kind, table.headers]), {
          ...mapping,
        });
        step = 2;
        render();
      } catch (error) {
        showError(error.message);
      }
    } else if (name === "ledgerCommit" && step === 2) {
      // Recheck against current memory state, preventing a double-click import.
      preview = previewImport(table, mapping, kind, existing(), account);
      const newCards =
        kind === "cards"
          ? [...new Set(preview.valid.map((r) => r.last))].filter(
              (last) => !adapter.cardRegistry().some((c) => c.last === last),
            )
          : [];
      const additions = newCards.map((last) => ({
        last,
        name: get(`new-name-${last}`)?.value.trim(),
        user: get(`new-owner-${last}`)?.value.trim(),
      }));
      if (additions.some((c) => !c.name || !c.user)) {
        showError("새 카드 이름과 사용자를 모두 입력하세요.");
        return true;
      }
      adapter.insert(kind, preview.valid, additions);
      step = 3;
      render();
    } else if (name === "ledgerFinish") {
      adapter.finish(kind);
    }
    return true;
  }
  return {
    open,
    file,
    action,
    cancel() {
      ticket++;
      table = null;
      preview = null;
    },
  };
}
