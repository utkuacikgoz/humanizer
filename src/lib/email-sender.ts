// Transactional email delivery for magic-link sign-in.
//
// Two things this file is careful about:
//
//   * The sender is an interface, not a module-level `fetch`. Tests inject a
//     recording stub and never touch the network, which is what lets the
//     whole sign-in flow be exercised without an API key and without mailing
//     anyone.
//   * Nothing here logs a message body, a recipient, or a link. A magic link
//     in a log line is a credential in a log line.
//
// No SDK: Resend's HTTP API is one POST, and the Workers runtime has `fetch`.
// Adding a Node-targeted SDK to a Worker bundle buys nothing here.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Delivery failed. Carries a short, self-generated code — never the provider's response body. */
export class EmailDeliveryError extends Error {
  constructor(readonly code: string) {
    super(`Email delivery failed: ${code}`);
    this.name = "EmailDeliveryError";
  }
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function createResendSender(config: { apiKey: string; from: string }): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      let response: Response;
      try {
        response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
      } catch {
        // The caught error can name the request it failed on; the request
        // body is the sign-in link. Only a code leaves this function.
        throw new EmailDeliveryError("network");
      }
      if (!response.ok) throw new EmailDeliveryError(`http_${response.status}`);
    },
  };
}
