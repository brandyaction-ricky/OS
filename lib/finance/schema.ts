import { z } from "zod";

export const uuid = z.string().uuid();
export const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "날짜를 확인해 주세요.");
const text = (max: number) => z.string().trim().max(max);
const name = (max: number) => text(max).min(1);
const nullable = (max: number) => text(max).nullable().default(null);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const categories = z.enum(["광고선전비", "지급수수료", "소모품비", "도서인쇄비", "여비교통비", "지급임차료", "외주용역비", "회의비", "복리후생비", "접대비"]);
const biz = z.enum(["common", "ba", "edu", "myin", "hm", "any"]);
const vat = z.enum(["공제 예상", "불공제 예상", "해당 없음(면세)", "해당 없음(해외)", "판단 필요"]);
const bankCategory = z.enum(["미분류", "토스 정산", "외부 매출", "연구비", "내 통장 간 이체", "기타 입금", "카드 대금", "급여", "4대보험", "임대료", "세무 기장료", "강사 정산", "프리랜서", "세금 납부", "기타 출금"]);
const common = { id: uuid, version: z.number().int().min(0), archived_at: z.string().datetime().nullable().default(null) };

/** Only user-editable fields. Provider, audit and approval fields never pass through this schema. */
export const resourceSchemas = {
  external_revenues: z.object({ ...common, kind: z.enum(["youtube", "outsource", "lecture", "etc"]), biz: z.enum(["ba", "edu", "myin", "hm"]), title: name(120), client: text(80), revenue_date: date, usd: z.number().positive().max(9999999999).nullable(), supply: won, vat: won, due_date: date.nullable(), invoice: text(120), memo: text(300) }).strict().refine(v => v.kind === "youtube" ? v.usd !== null && v.usd > 0 : v.supply > 0, "매출 금액을 확인해 주세요."),
  bank_accounts: z.object({ ...common, bank: name(30), name: name(30), last4: z.string().regex(/^\d{4}$/).nullable(), uses: z.array(text(30)).max(10), method: z.enum(["excel", "bank_api", "openbanking", "aggregator"]), sync_freq: z.enum(["hourly", "4x_daily", "daily_0700"]), include_in_net: z.boolean(), opening_balance: z.number().int().safe().nullable() }).strict(),
  bank_rules: z.object({ ...common, name: name(50), keyword: name(50), direction: z.enum(["in", "out"]), category: bankCategory, enabled: z.boolean(), sort_order: won }).strict().refine(v => v.category !== "내 통장 간 이체", "통장 간 이체는 두 거래를 직접 묶어 주세요."),
  cards: z.object({ ...common, issuer: name(30), name: name(30), last4: z.string().regex(/^\d{4}$/), holder_profile_id: uuid.nullable(), holder_name: text(40) }).strict(),
  card_rules: z.object({ ...common, name: name(40), keywords: z.array(name(50)).min(1).max(20), category: categories, biz, vat_type: vat, memo_template: text(100), enabled: z.boolean(), sort_order: won }).strict(),
  recurring_overrides: z.object({ ...common, merchant_key: name(120), owner_profile_id: uuid.nullable(), owner_name: text(40), state: z.enum(["유지", "해지 검토", "해지함"]) }).strict(),
  budget_items: z.object({ ...common, kind: z.enum(["fixed", "variable", "labor"]), name: name(40), biz, monthly_amount: won, source: z.enum(["card", "bank", "manual"]), card_categories: z.array(categories).max(10), bank_categories: z.array(bankCategory).max(10), owner_name: text(40), memo: text(200), sort_order: won }).strict().superRefine((v,c) => {
    if ((v.source === "card" && !v.card_categories.length) || (v.source === "bank" && (!v.bank_categories.length || v.bank_categories.some(x => ["카드 대금", "강사 정산", "내 통장 간 이체"].includes(x))))) c.addIssue({code:"custom", message:"비용 출처와 분류를 확인해 주세요. 강사 정산은 직접 입력만 가능합니다."});
  }),
  budget_actuals: z.object({ ...common, item_id: uuid, month: date.refine(v => v.endsWith("-01")), amount: won }).strict(),
  payout_notes: z.object({ ...common, store_id: uuid, paid_out_date: date, reason: z.enum(["토스 지급 보류", "환불 차감", "다른 날짜에 합쳐 입금", "기타"]), memo: text(300) }).strict(),
  settings: z.object({ ...common, key: z.enum(["net_include_research", "usd_krw_estimate", "receipt_required_categories", "data_start_date"]), value: z.unknown() }).strict().superRefine((v,c) => {
    const s = {net_include_research:z.boolean(), usd_krw_estimate:z.number().positive().max(100000), receipt_required_categories:z.array(categories).max(10), data_start_date:date.nullable()}[v.key];
    if (!s.safeParse(v.value).success) c.addIssue({code:"custom",message:"설정 값을 확인해 주세요."});
  }),
  bank_transactions: z.object({ ...common, account_id: uuid, tx_date: date, time, deposit: won, withdrawal: won, balance_after: z.number().int().safe().nullable(), description: name(200), branch: nullable(80), dedupe_key: name(128), manual_category: bankCategory.nullable(), link_type: z.enum(["payout","external_revenue","transfer"]).nullable(), link_ref: nullable(100), import_batch_id: uuid.nullable() }).strict().refine(v => (v.deposit > 0) !== (v.withdrawal > 0), "입금·출금 중 하나만 0보다 커야 합니다."),
  card_transactions: z.object({ ...common, card_id: uuid, used_date: date, time, merchant: name(120), amount_krw: won, foreign_amount: z.number().nonnegative().max(9999999999).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), approval_no: name(80), installment: z.number().int().min(0).max(60).nullable(), canceled: z.boolean(), manual_category: categories.nullable(), manual_biz: biz.nullable(), manual_vat: vat.nullable(), memo: nullable(200), receipt_path: nullable(300), import_batch_id: uuid.nullable() }).strict(),
  import_mappings: z.object({ ...common, kind: z.enum(["card","bank"]), header_signature: name(128), columns: z.record(text(100),z.number().int().min(-1).max(99)) }).strict(),
  import_batches: z.object({ ...common, kind:z.enum(["card","bank"]), account_id:uuid.nullable(), file_name:name(150), row_count:won.max(5000), inserted:won.max(5000), duplicates:won.max(5000), skipped:won.max(5000), period_from:date.nullable(), period_to:date.nullable(), mapping_id:uuid.nullable() }).strict(),
} as const;
export type Resource = keyof typeof resourceSchemas;
export type FinanceRow = Record<string, unknown> & {id:string;version:number;archived_at?:string|null};
export type FinanceData = Record<string, FinanceRow[]>;
export const READ_RESOURCES = [...Object.keys(resourceSchemas), "stores", "payments", "payment_cancels", "settlements", "refund_requests", "events"] as const;
export const batchSchema = z.object({ changes:z.array(z.object({ resource:z.string(), row:z.record(z.unknown()) }).strict()).min(1).max(1200) }).strict();
export const refundRequestSchema = z.object({payment_id:uuid,amount:won.min(1),reason:name(200)}).strict();
