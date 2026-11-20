import { apiBoundary } from "@/lib/director/director-api";
import { clearAnswer, listAnswers, saveAnswer } from "@/lib/director/director-answers-api";
import { guard } from "@/lib/access/guard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = guard(async (request: Request) => { return apiBoundary(() => listAnswers(request)); });
export const POST = guard(async (request: Request) => { return apiBoundary(() => saveAnswer(request)); });
export const DELETE = guard(async (request: Request) => { return apiBoundary(() => clearAnswer(request)); });
