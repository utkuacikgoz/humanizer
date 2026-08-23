import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, resolveChatGPTUserFromHeaders, type ChatGPTUser } from "@/src/lib/chatgpt-identity";

export type { ChatGPTUser };
export { chatGPTSignInPath, chatGPTSignOutPath, resolveChatGPTUserFromHeaders } from "@/src/lib/chatgpt-identity";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return resolveChatGPTUserFromHeaders(await headers());
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}
