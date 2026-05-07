import { Context, Data } from "effect";

import type { Effect } from "effect";

export class EmailSendError extends Data.TaggedError("EmailSendError")<{
  readonly cause: unknown;
}> {}

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface EmailServiceImpl {
  readonly send: (message: EmailMessage) => Effect.Effect<void, EmailSendError>;
}

export class EmailService extends Context.Tag("server/EmailService")<
  EmailService,
  EmailServiceImpl
>() {}
