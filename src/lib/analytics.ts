export const ANALYTICS_EVENTS = [
  "landing_view",
  "text_pasted",
  "humanization_started",
  "humanization_completed",
  "preview_viewed",
  "checkout_started",
  "checkout_completed",
  "full_result_unlocked",
  "result_copied",
  "second_humanization",
  "subscription_cancelled",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function track(event: AnalyticsEvent, properties: Record<string, string | number | boolean> = {}) {
  if (typeof window === "undefined") return;
  const detail = { event, properties, occurredAt: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent("humanizer:analytics", { detail }));

  const body = JSON.stringify(detail);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
}
