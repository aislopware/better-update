import { useMountEffect } from "@better-update/react-hooks";
import { useRef, useState } from "react";

interface UseDebouncedSearchOptions {
  readonly initial: string;
  readonly delayMs: number;
  readonly onCommit: (value: string) => void;
}

interface UseDebouncedSearchResult {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
}

/**
 * Drives a debounced text input bound to a downstream search-param update.
 * Maintains a synchronous "draft" for the input value and commits the trimmed
 * value after `delayMs` of idle, via `onCommit`.
 */
export const useDebouncedSearch = ({
  initial,
  delayMs,
  onCommit,
}: UseDebouncedSearchOptions): UseDebouncedSearchResult => {
  const [draft, setDraft] = useState(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMountEffect(() => () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
  });

  const handleChange = (value: string): void => {
    setDraft(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onCommit(value.trim());
    }, delayMs);
  };

  return { draft, setDraft: handleChange };
};
