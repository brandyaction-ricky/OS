import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import {
  hrActor,
  hrDbError,
  hrError,
  hrJson,
  hrRpc,
  hrSelf,
  hrWorkspace,
  HR_MESSAGES,
  readAll,
} from "@/lib/server/hr";
import { hrFileRead, hrUpload } from "@/lib/server/hr-files";
import { registerHrPerson, issueHrAccount } from "@/lib/server/hr-accounts";
import {
  personSchema,
  leaveSchema,
  date,
  uuid,
  version,
  reason,
  contractSchema,
  promotionSchema,
} from "@/lib/hr/schema";
import {
  addDays,
  activeEmployees,
  hrBadges,
  balance,
  headcount,
  ledger,
  leavePreview,
  promotion,
  todayKst,
} from "@/lib/hr/domain";
import { RETIRE_LABELS, type Employee, type HrEvent } from "@/lib/hr/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown) =>
  NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(request: Request, context: Context) {
  try {
    const { path } = await context.params,
      action = path.join("/"),
      url = new URL(request.url),
      query = url.searchParams;
    const selfRoutes =
      action === "session" ||
      action === "me/leave" ||
      path[0] === "leave-requests" ||
      path[0] === "files" ||
      (path[0] === "holidays" && request.method === "GET") ||
      (path[0] === "leave-promotions" &&
        ["reply", "read"].includes(path[2] || "")) ||
      (path[0] === "people" && path[2] === "ledger");
    const actor = await hrActor(request, !selfRoutes),
      today = todayKst();
    const data = () => (actor.hrAccess ? hrWorkspace(actor) : hrSelf(actor));
    if (request.method === "GET") {
      if (action === "legacy-preview")
        return json(
          await hrRpc(actor, "os_hr_legacy_preview", {
            p_employee: uuid.parse(query.get("employee")),
          }),
        );
      if (action === "session") return json({ active: true });
      if (action === "badges") {
        return json({ badges: hrBadges(await hrWorkspace(actor), today) });
      }
      if (action === "workspace")
        return json({ data: await hrWorkspace(actor), today });
      if (action === "me/leave")
        return json({ data: await hrSelf(actor), today });
      if (path[0] === "files" && path.length >= 4)
        return json(await hrFileRead(actor, path.slice(1).join("/")));
      if (action === "holidays")
        return json({
          rows: await readAll(actor, "os_hr_holidays", "*", {
            from: date.parse(query.get("from") || `${today.slice(0, 4)}-01-01`),
            to: date.parse(
              query.get("to") || `${Number(today.slice(0, 4)) + 1}-12-31`,
            ),
          }),
        });
      if (action === "settings")
        return json({ rows: await readAll(actor, "os_hr_settings") });
      if (action === "forms/history") {
        const { data: rows, error } = await actor.supabase
          .from("os_hr_events")
          .select("id,action,detail,created_at")
          .eq("action", "form.updated")
          .contains("detail", { form: uuid.parse(query.get("form")) })
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) hrDbError(error);
        return json({ rows });
      }
      if (action === "forms")
        return json({ rows: await readAll(actor, "os_hr_forms") });
      if (action === "documents")
        return json({ rows: await readAll(actor, "os_hr_documents") });
      if (action === "leave-requests") {
        const from = query.get("from"),
          to = query.get("to");
        if (
          (from && !to) ||
          (!from && to) ||
          (query.get("calendar") === "true" && (!from || !to))
        )
          throw new ApiError(
            400,
            "RANGE_REQUIRED",
            "캘린더의 시작일과 종료일을 입력해 주세요.",
          );
        const rows = await readAll<import("@/lib/hr/types").LeaveRequest>(
          actor,
          "os_hr_leave_requests",
          "*",
          {
            employee: query.get("person")
              ? uuid.parse(query.get("person"))
              : undefined,
            from: from ? date.parse(from) : undefined,
            to: to ? date.parse(to) : undefined,
          },
        );
        return json({
          rows: rows.filter(
            (r) => !query.get("status") || r.status === query.get("status"),
          ),
        });
      }
      if (action === "leave-requests/preview") {
        const input = leaveSchema.parse({
          person: query.get("person"),
          type: query.get("type"),
          start: query.get("start"),
          end: query.get("end"),
        });
        const d = actor.hrAccess
            ? await hrWorkspace(actor, {
                from: addDays(input.start, -366),
                to: addDays(input.end, 366),
              })
            : await hrSelf(actor),
          e = d.employees.find((e) => e.id === input.person);
        if (!e)
          throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
        return json(
          leavePreview(d, e, input.type, input.start, input.end, today),
        );
      }
      if (path[0] === "people" && path[1]) {
        const id = uuid.parse(path[1]),
          d = await data(),
          e = d.employees.find((e) => e.id === id || e.profile_id === id),
          profile = d.profiles.find((p) => p.id === id);
        if (!e && !profile)
          throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
        if (path[2] === "ledger") {
          if (!e)
            throw new ApiError(404, "NOT_EMPLOYEE", HR_MESSAGES.NOT_EMPLOYEE);
          return json({
            rows: ledger(d, e, today),
            balance: balance(d, e, today),
          });
        }
        if (path[2] === "history") {
          let q = actor.supabase
            .from("os_hr_events")
            .select("*")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(200);
          q = e ? q.eq("hr_employee_id", e.id) : q.eq("profile_id", id);
          const { data: rows, error } = await q;
          if (error) hrDbError(error);
          return json({ rows: rows as HrEvent[] });
        }
        return json({
          employee: e || null,
          profile:
            profile || d.profiles.find((p) => p.id === e?.profile_id) || null,
          data: d,
        });
      }
      if (
        ["people", "leave-balances", "leave-promotions", "export"].includes(
          action,
        )
      ) {
        const d = await hrWorkspace(actor);
        if (action === "people")
          return json({ data: d, headcount: headcount(d, today) });
        if (action === "leave-balances")
          return json({
            rows: activeEmployees(d, today).map((e) => ({
              employee: e,
              ...balance(d, e, today),
            })),
          });
        if (action === "leave-promotions")
          return json({
            rows: activeEmployees(d, today).map((e) => ({
              employee: e,
              ...promotion(d, e, today),
            })),
          });
        if (action === "export") {
          const ids = z
            .array(uuid)
            .max(5000)
            .parse((query.get("ids") || "").split(",").filter(Boolean));
          const rows = await hrRpc<Employee[]>(actor, "os_hr_export", {
            p_ids: ids,
          });
          const { default: ExcelJS } = await import("exceljs");
          const book = new ExcelJS.Workbook(),
            sheet = book.addWorksheet("근로자 명부");
          sheet.addRow([
            "성명",
            "성별",
            "생년월일",
            "주소",
            "이력",
            "업무 종류",
            "고용일",
            "계약 기간",
            "퇴직일",
            "퇴직 사유",
            "고용형태",
            "주 근로시간",
            "연차 잔여",
          ]);
          for (const e of rows) {
            const c = d.contracts.find(
              (c) => c.hr_employee_id === e.id && c.is_current,
            );
            sheet.addRow([
              e.legal_name,
              e.gender,
              e.birth_date,
              e.address,
              e.career_summary,
              e.job_roles.join(", "),
              e.hire_date,
              c ? `${c.start_date} ~ ${c.end_date || "기간 정함 없음"}` : "",
              e.retire_date,
              RETIRE_LABELS[e.retire_reason || ""] || e.retire_reason,
              c?.contract_type,
              c?.weekly_hours,
              balance(d, e, today).left,
            ]);
          }
          sheet.columns.forEach((c) => {
            c.width = 22;
          });
          sheet.getRow(1).font = { bold: true };
          return new NextResponse(
            new Uint8Array(await book.xlsx.writeBuffer()),
            {
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="hr-register-${today}.xlsx"`,
                "Cache-Control": "private, no-store",
              },
            },
          );
        }
      }
    }
    if (
      request.method === "DELETE" &&
      path[0] === "holidays" &&
      path.length === 2
    ) {
      if (!actor.hrAccess)
        throw new ApiError(
          403,
          "HR_ACCESS_REQUIRED",
          HR_MESSAGES.HR_ACCESS_REQUIRED,
        );
      await hrRpc(actor, "os_hr_remove_holiday", {
        p_day: date.parse(path[1]),
      });
      return json({ saved: true });
    }
    const input = await hrJson(request);
    if (request.method === "POST" && action === "legacy-person")
      return json(
        await hrRpc(actor, "os_hr_legacy_person", {
          p_profile: z.object({ profile: uuid }).strict().parse(input).profile,
        }),
      );
    if (request.method === "POST" && action === "legacy-import") {
      const b = z
        .object({
          employee: uuid,
          version,
          balanceId: uuid.nullable(),
          balanceVersion: version.nullable(),
          requests: z
            .array(
              z
                .object({ id: uuid, version, type: leaveSchema.shape.type })
                .strict(),
            )
            .max(500),
        })
        .strict()
        .parse(input);
      return json(
        await hrRpc(actor, "os_hr_import_legacy", {
          p_employee: b.employee,
          p_version: b.version,
          p_balance: b.balanceId,
          p_balance_version: b.balanceVersion,
          p_requests: b.requests,
        }),
      );
    }
    if (request.method === "POST" && action === "people") {
      const body = z
        .object({
          person: personSchema,
          issue: z.boolean().default(false),
          role: z.enum(["member", "lead", "admin"]).default("member"),
        })
        .strict()
        .parse(input);
      return json(
        await registerHrPerson(actor, body.person, body.issue, body.role),
      );
    }
    if (path[0] === "people" && path[1]) {
      const personId = uuid.parse(path[1]);
      const d = await hrWorkspace(actor);
      const employee = d.employees.find(
          (e) => e.id === personId || e.profile_id === personId,
        ),
        profile = d.profiles.find(
          (p) => p.id === personId || p.id === employee?.profile_id,
        );
      if (!employee && !profile)
        throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
      if (request.method === "PATCH" && path.length === 2) {
        const body = z
          .object({
            person: personSchema,
            version: z.number().int().nonnegative(),
            reason,
          })
          .strict()
          .parse(input);
        if (
          (body.person.id && body.person.id !== employee?.id) ||
          (body.person.profile_id && body.person.profile_id !== profile?.id)
        )
          throw new ApiError(
            400,
            "INVALID_PERSON",
            "대상 정보를 확인해 주세요.",
          );
        await hrRpc(actor, "os_hr_upsert_employee", {
          p_payload: {
            ...body.person,
            id: employee?.id,
            profile_id: profile?.id || null,
          },
          p_version: body.version,
          p_reason: body.reason,
        });
        return json({ saved: true });
      }
      if (path[2] === "account") {
        if (actor.role !== "admin")
          throw new ApiError(403, "ADMIN_REQUIRED", HR_MESSAGES.ADMIN_REQUIRED);
        if (request.method === "POST" && employee)
          return json(
            await issueHrAccount(
              actor,
              employee.id,
              z.object({ version }).strict().parse(input).version,
            ),
          );
        if (request.method === "PATCH" && profile) {
          const body = z
            .object({
              updated_at: z.string().datetime({ offset: true }),
              account: z
                .object({
                  role: z.enum(["member", "lead", "admin"]).optional(),
                  is_active: z.boolean().optional(),
                  finance_access: z.boolean().optional(),
                  onboarding: z.record(z.boolean()).optional(),
                })
                .strict(),
            })
            .strict()
            .parse(input);
          await hrRpc(actor, "os_hr_set_account", {
            p_profile: profile.id,
            p_payload: body.account,
            p_updated_at: body.updated_at,
          });
          return json({ saved: true });
        }
      }
      if (!employee)
        throw new ApiError(404, "NOT_EMPLOYEE", HR_MESSAGES.NOT_EMPLOYEE);
      if (request.method === "POST" && path[2] === "reveal")
        return json(
          await hrRpc(actor, "os_hr_reveal", {
            p_employee: employee.id,
            p_fields: z
              .object({
                fields: z
                  .array(
                    z.enum(["legal_name", "birth_date", "phone", "address"]),
                  )
                  .min(1)
                  .max(4),
              })
              .strict()
              .parse(input).fields,
          }),
        );
      if (request.method === "POST" && path[2] === "contracts") {
        const body = z
          .object({ contract: contractSchema, reason, current: uuid })
          .strict()
          .parse(input);
        if (!body.contract.start_date)
          throw new ApiError(
            400,
            "INVALID_DATES",
            "적용 시작일을 입력해 주세요.",
          );
        await hrRpc(actor, "os_hr_change_contract", {
          p_employee: employee.id,
          p_payload: body.contract,
          p_reason: body.reason,
          p_current: body.current,
        });
        return json({ saved: true });
      }
      if (request.method === "POST" && path[2] === "retire") {
        const body = z
          .object({
            version,
            date,
            reason: z.enum([
              "voluntary",
              "contract_end",
              "recommended",
              "dismissal",
              "retirement_age",
              "other",
            ]),
            offboarding: z.object({
              insurance: z.boolean(),
              settlement: z.boolean(),
              handoff: z.boolean(),
            }),
          })
          .strict()
          .parse(input);
        await hrRpc(actor, "os_hr_retire", {
          p_employee: employee.id,
          p_version: body.version,
          p_date: body.date,
          p_reason: body.reason,
          p_offboarding: body.offboarding,
        });
        return json({ saved: true });
      }
    }
    if (request.method === "POST" && action === "leave-requests") {
      const b = leaveSchema.parse(input);
      return json({
        id: await hrRpc(actor, "os_hr_request_leave", {
          p_employee: b.person,
          p_type: b.type,
          p_start: b.start,
          p_end: b.end,
          p_reason: b.reason || null,
          p_proof: b.proof || null,
          p_direct: b.direct,
        }),
      });
    }
    if (
      request.method === "POST" &&
      path[0] === "leave-requests" &&
      path.length === 3
    ) {
      const id = uuid.parse(path[1]);
      if (path[2] === "decision") {
        if (!actor.hrAccess)
          throw new ApiError(
            403,
            "HR_ACCESS_REQUIRED",
            HR_MESSAGES.HR_ACCESS_REQUIRED,
          );
        const b = z
          .object({
            version,
            decision: z.enum(["approved", "rejected"]),
            reason: z.string().max(500).nullable().optional(),
          })
          .strict()
          .parse(input);
        await hrRpc(actor, "os_hr_decide_leave", {
          p_id: id,
          p_version: b.version,
          p_decision: b.decision,
          p_reason: b.reason || null,
        });
        return json({ saved: true });
      }
      if (path[2] === "cancel") {
        const b = z.object({ version }).strict().parse(input);
        await hrRpc(actor, "os_hr_cancel_leave", {
          p_id: id,
          p_version: b.version,
        });
        return json({ saved: true });
      }
    }
    if (request.method === "POST" && action === "leave-credits") {
      const b = z
        .object({
          employee: uuid,
          days: z.number(),
          reason,
          kind: z.enum(["adjustment", "opening"]).default("adjustment"),
          evidence: z.string().max(200).nullable().optional(),
        })
        .strict()
        .parse(input);
      return json({
        id: await hrRpc(actor, "os_hr_add_credit", {
          p_employee: b.employee,
          p_days: b.days,
          p_reason: b.reason,
          p_kind: b.kind,
          p_evidence: b.evidence || null,
        }),
      });
    }
    if (request.method === "POST" && action === "leave-promotions") {
      const b = promotionSchema.parse(input);
      return json({
        id: await hrRpc(actor, "os_hr_send_promotion", {
          p_employee: b.employee,
          p_step: b.step,
          p_days: b.days,
          p_dates: b.dates,
          p_channel: b.channel,
          p_body: b.body,
          p_paper: b.paper || null,
        }),
      });
    }
    if (request.method === "POST" && action === "leave-promotions/settlement") {
      await hrRpc(actor, "os_hr_mark_settlement", {
        p_employee: z.object({ employee: uuid }).strict().parse(input).employee,
      });
      return json({ saved: true });
    }
    if (
      request.method === "POST" &&
      path[0] === "leave-promotions" &&
      path.length === 3
    ) {
      const id = uuid.parse(path[1]);
      if (path[2] === "reply") {
        await hrRpc(actor, "os_hr_reply_promotion", {
          p_id: id,
          p_dates: z
            .object({ dates: z.array(date).min(1).max(366) })
            .strict()
            .parse(input).dates,
        });
        return json({ saved: true });
      }
      if (path[2] === "read") {
        z.object({}).strict().parse(input);
        await hrRpc(actor, "os_hr_mark_promotion_read", { p_id: id });
        return json({ saved: true });
      }
    }
    if (request.method === "PATCH" && action === "documents") {
      const b = z
        .object({
          employee: uuid,
          kind: z.enum([
            "contract_signed",
            "contract_given",
            "roster",
            "privacy",
            "nda",
            "insurance",
          ]),
          status: z.enum(["done", "missing"]),
          date: date.nullable(),
          path: z.string().max(200).nullable(),
          version,
        })
        .strict()
        .parse(input);
      await hrRpc(actor, "os_hr_set_document", {
        p_employee: b.employee,
        p_kind: b.kind,
        p_status: b.status,
        p_date: b.date,
        p_path: b.path,
        p_version: b.version,
      });
      return json({ saved: true });
    }
    if (request.method === "POST" && action === "forms") {
      const b = z
        .object({
          id: uuid.nullable(),
          version: z.number().int().nonnegative(),
          title: z.string().min(1).max(120),
          usage: z.string().max(300),
          kind: z.string().min(1).max(80),
          label: z.string().min(1).max(60),
          path: z.string().max(200),
        })
        .strict()
        .parse(input);
      return json({
        id: await hrRpc(actor, "os_hr_set_form", {
          p_id: b.id,
          p_version: b.version,
          p_title: b.title,
          p_usage: b.usage,
          p_kind: b.kind,
          p_label: b.label,
          p_path: b.path,
        }),
      });
    }
    if (request.method === "POST" && action === "files/upload-url")
      return json(await hrUpload(actor, input));
    if (request.method === "POST" && action === "holidays") {
      const b = z
        .object({ day: date, name: z.string().trim().min(1).max(40) })
        .strict()
        .parse(input);
      await hrRpc(actor, "os_hr_set_holiday", { p_day: b.day, p_name: b.name });
      return json({ saved: true });
    }
    throw new ApiError(404, "HR_NOT_FOUND", HR_MESSAGES.HR_NOT_FOUND);
  } catch (error) {
    return apiErrorResponse(hrError(error));
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
