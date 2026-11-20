import { apiBoundary, jsonResponse, requireConfiguration, requireHuman } from "../director/director-api";
import { readBriefing } from "./briefing";
import { deleteConversation, listConversations, readConversation } from "./store";

export const briefingResponse = (request: Request) => apiBoundary(async () => {
  const { config } = await requireHuman(request);
  return jsonResponse(await readBriefing(config, new Date()));
});

export const conversationsResponse = (request: Request) => apiBoundary(async () => {
  const { config, reviewerId } = await requireHuman(request);
  return jsonResponse({ conversations: await listConversations(config, reviewerId) });
});

export const conversationResponse = (request: Request, id: string) => apiBoundary(async () => {
  const { config, reviewerId } = await requireHuman(request);
  return jsonResponse(await readConversation(config, reviewerId, id));
});

export const deleteConversationResponse = (request: Request, id: string) => apiBoundary(async () => {
  const { config, reviewerId } = await requireHuman(request, requireConfiguration(), true);
  await deleteConversation(config, reviewerId, id);
  return jsonResponse({ deleted: true });
});
