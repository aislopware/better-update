import { useMountEffect } from "@better-update/react-hooks";
import { Effect, Exit } from "effect";
import { useRef, useState } from "react";

export const useCopyToClipboard = (resetAfterMs = 2000) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMountEffect(() => () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
  });

  const copy = async (text: string): Promise<boolean> => {
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise(async () => navigator.clipboard.writeText(text)),
    );
    if (Exit.isFailure(exit)) {
      return false;
    }
    setCopied(true);
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, resetAfterMs);
    return true;
  };

  return { copied, copy };
};
