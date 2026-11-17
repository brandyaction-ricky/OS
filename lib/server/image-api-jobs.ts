import type { z } from "zod";
import { ApiError } from "@/lib/http";
import type { RequestActor } from "./auth";
import { creditTier } from "./openai-credit";
import { requestStaffJob, type staffJobRequestSchema } from "./youtube-ai-jobs";
import { scheduleGptJob } from "./youtube-gpt-jobs";

type ImageRequest = Extract<z.infer<typeof staffJobRequestSchema>, { task: "image-creative" }>;

/** Image-ad buttons use the OS company model, with the same queue, lease and result checks as existing GPT work. */
export async function requestImageApiJob(actor: RequestActor, input: ImageRequest) {
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new ApiError(503, "IMAGE_API_UNAVAILABLE", "OS의 회사 GPT 연결을 확인하지 못했어요. 담당자에게 연결 확인을 요청해 주세요.");
  const tier = await creditTier();
  const job = await requestStaffJob(actor, input, { tier });
  // A duplicate response may reuse a queued job. Its saved model tier remains authoritative;
  // the runner's existing compare-and-swap lease prevents two API executions.
  if (job.executor === "gpt" && (job.status === "backlog" || (job.status === "active" && !job.processing)))
    scheduleGptJob(job.id, { id: actor.ownerId, name: actor.name, team: actor.team }, job.tier ?? tier);
  return job;
}
