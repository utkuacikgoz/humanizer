"use client";

// M3-01 history surface. Every authorization decision it depends on happens
// on the server (src/lib/history-access.ts); this page only renders what the
// two endpoints return and never assumes an item is readable until
// /api/history/{id} says so.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { productConfig } from "@/src/config/product";
import { MarkedText, describeMarks, diffRewrite, selectDisplayFacts } from "@/src/components/rewrite-marks";
import { improvementLabel } from "@/src/lib/preview-projection";

type HistoryItem = {
  jobId: string;
  mode: "natural" | "professional" | "academic" | "casual";
  state: string;
  createdAt: string;
  inputWordCount: number;
  successfulWordCount: number | null;
  preview: string;
  hiddenWordCount: number;
  issuesImproved: number;
  naturalness: "Strong" | "Good";
  meaningPreservation: "High" | "Review needed";
  protectedItems: string[];
};

type HistoryDetail = HistoryItem & {
  original: string;
  result: string;
};

type ListState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "ready"; entitled: boolean; items: HistoryItem[] };

const MODE_LABELS = {
  natural: "Natural",
  professional: "Professional",
  academic: "Academic",
  casual: "Casual",
} as const;

const SIGN_IN_HREF = "/signin?return_to=%2Fhistory";
const MAX_FACT_CHIPS = 6;

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function OpenedRewrite({ detail }: { detail: HistoryDetail }) {
  const marks = useMemo(() => diffRewrite(detail.original, detail.result), [detail]);
  const facts = useMemo(() => selectDisplayFacts(detail.protectedItems, detail.original), [detail]);

  return (
    <div className="history-detail">
      <div className="checks" aria-label="Rewrite checks">
        <article><small>Naturalness</small><strong>{detail.naturalness}</strong></article>
        <article><small>Meaning preservation</small><strong>{detail.meaningPreservation}</strong></article>
        <article className="warm"><small>Changes</small><strong>{improvementLabel(detail.issuesImproved)}</strong></article>
      </div>
      <div className="comparison">
        <article>
          <div className="panel-label"><span>Original</span><small>{detail.inputWordCount} words</small></div>
          <p><MarkedText segments={marks.source} facts={facts} /></p>
        </article>
        <article className="humanized-panel">
          <div className="panel-label"><span>Humanized</span><small>complete</small></div>
          <p className="sr-only">{describeMarks(marks.result)}</p>
          <p><MarkedText segments={marks.result} facts={facts} /></p>
        </article>
      </div>
      {facts.length ? (
        <div className="protected-note">
          <b>Held exactly as you wrote them</b>
          <ul>{facts.slice(0, MAX_FACT_CHIPS).map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

export default function HistoryPage() {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailError, setDetailError] = useState<string>("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  // Re-entrancy guards. Controls stay focusable and use aria-disabled, so the
  // only thing stopping a second submit is this ref, not a native `disabled`.
  const busy = useRef(false);
  const copied = useRef(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => { document.documentElement.classList.add("motion-ready"); }, []);

  // Re-reading the list is a state bump rather than a callable, so the fetch
  // stays inside the effect that owns its cancellation.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/history", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) { setList({ kind: "signed-out" }); return; }
        if (!response.ok) { setList({ kind: "unavailable" }); return; }
        const body = (await response.json()) as { entitled: boolean; items: HistoryItem[] };
        if (!cancelled) setList({ kind: "ready", entitled: body.entitled, items: body.items });
      } catch {
        if (!cancelled) setList({ kind: "unavailable" });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  async function openItem(jobId: string) {
    if (busy.current) return;
    busy.current = true;
    setDetailError("");
    setCopyStatus("idle");
    copied.current = false;
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      if (response.ok) {
        setDetail((await response.json()) as HistoryDetail);
        setOpenId(jobId);
        return;
      }
      if (response.status === 401) { setList({ kind: "signed-out" }); return; }
      setOpenId(null);
      setDetail(null);
      setDetailError(
        response.status === 404
          ? "This rewrite cannot be opened. An active subscription is needed to read a full rewrite, and a deleted rewrite is gone for good."
          : "This rewrite could not be opened. Please try again.",
      );
    } catch {
      setDetailError("This rewrite could not be opened. Please try again.");
    } finally {
      busy.current = false;
    }
  }

  async function deleteItem(jobId: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(jobId)}`, { method: "DELETE", cache: "no-store" });
      if (response.status === 401) { setList({ kind: "signed-out" }); return; }
      if (!response.ok && response.status !== 404) {
        setNotice("That rewrite could not be deleted. Nothing was removed. Please try again.");
        return;
      }
      // 404 and 200 are both terminal here: the item is not yours to read,
      // so removing it from the list is honest either way.
      setConfirmingId(null);
      if (openId === jobId) { setOpenId(null); setDetail(null); }
      setNotice("That rewrite was deleted. Its text has been removed and is queued for purge everywhere it was stored.");
      setReloadToken((token) => token + 1);
    } catch {
      setNotice("That rewrite could not be deleted. Nothing was removed. Please try again.");
    } finally {
      busy.current = false;
    }
  }

  async function copyOpened() {
    if (!detail || copied.current) return;
    try {
      await navigator.clipboard.writeText(detail.result);
      copied.current = true;
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={`${productConfig.productName} home`}>
          <span>{productConfig.productName}</span>
        </Link>
        <nav>
          <Link className="sign-in" href="/">Rewrite another draft</Link>
        </nav>
      </header>

      <div className="stage stage-single">
        <section className="workspace" aria-labelledby="history-title">
          <div className="workspace-topline">
            <div>
              <span className="step-number">04</span>
              <h2 id="history-title">Your rewrites</h2>
            </div>
          </div>

          {list.kind === "loading" ? (
            <p className="status-line" role="status" style={{ borderTop: "none" }}>
              <span className="dot-loader" aria-hidden="true"><span /><span /><span /></span>
              {" "}Loading your saved rewrites.
            </p>
          ) : null}

          {list.kind === "signed-out" ? (
            <p className="error" role="alert" style={{ borderTop: "none" }}>
              <Link href={SIGN_IN_HREF}>Sign in</Link> to see the rewrites saved to your account. Nothing is
              stored under an account until you sign in and unlock a rewrite.
            </p>
          ) : null}

          {list.kind === "unavailable" ? (
            <p className="error" role="alert" style={{ borderTop: "none" }}>
              Your history could not be loaded right now. This is a problem on our side, not a sign that
              anything was lost. Please try again in a moment.
            </p>
          ) : null}

          {list.kind === "ready" && list.items.length === 0 ? (
            <p className="status-line" role="status" style={{ borderTop: "none" }}>
              No saved rewrites yet. A rewrite is saved to your account when you unlock it through
              checkout. Rewrites you run while signed in and subscribed are returned to you in full and
              are not stored here.
            </p>
          ) : null}

          {list.kind === "ready" && !list.entitled && list.items.length ? (
            <p className="status-line" role="status" style={{ borderTop: "none" }}>
              Your subscription is not active, so these rewrites cannot be opened in full. You can still
              see what is stored and delete any of it.
            </p>
          ) : null}

          <p className="copy-status" role="status" aria-live="polite">{notice}</p>

          {list.kind === "ready" && list.items.length ? (
            <ul className="history-list">
              {list.items.map((item) => (
                <li key={item.jobId} className="history-item">
                  <div className="history-meta">
                    <strong>{MODE_LABELS[item.mode] ?? item.mode} rewrite</strong>
                    <small>
                      {formatDate(item.createdAt)} · {item.inputWordCount} words in
                      {item.successfulWordCount === null ? "" : ` · ${item.successfulWordCount} words out`}
                      {" · "}{improvementLabel(item.issuesImproved)}
                    </small>
                  </div>
                  <p className="history-preview">{item.preview}</p>
                  <div className="history-actions">
                    <button
                      type="button"
                      className="next-action"
                      aria-expanded={openId === item.jobId}
                      onClick={() => void openItem(item.jobId)}
                    >
                      {openId === item.jobId ? "Opened" : "Open full rewrite"}
                    </button>
                    {confirmingId === item.jobId ? (
                      <>
                        <button type="button" className="history-delete" onClick={() => void deleteItem(item.jobId)}>
                          Delete permanently
                        </button>
                        <button type="button" className="history-cancel" onClick={() => setConfirmingId(null)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="history-cancel"
                        onClick={() => { setNotice(""); setConfirmingId(item.jobId); }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {confirmingId === item.jobId ? (
                    <p className="history-warning" role="status">
                      This removes the rewrite and the text it was made from. It cannot be undone.
                    </p>
                  ) : null}
                  {openId === item.jobId && detail ? (
                    <>
                      <OpenedRewrite detail={detail} />
                      <div className="paid-actions">
                        <button type="button" className="copy-result" onClick={() => void copyOpened()}>Copy full rewrite</button>
                        <p className="copy-status" role="status" aria-live="polite">
                          {copyStatus === "copied"
                            ? "Copied to your clipboard."
                            : copyStatus === "failed"
                              ? "Copy was blocked. Select the text and copy it manually."
                              : ""}
                        </p>
                      </div>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {detailError ? (
            <p className="error" role="alert" style={{ borderTop: "none" }}>{detailError}</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
