import { Effect, Layer } from "effect";

import { EmailSendError, EmailService } from "../domain/email-service";
import { cloudflareEnv } from "./context";

export const EmailServiceLive = Layer.succeed(EmailService, {
  send: (message) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.tryPromise({
        try: async () => {
          await env.EMAIL.send({
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
        },
        catch: (cause) => new EmailSendError({ cause }),
      });
    }),
});
