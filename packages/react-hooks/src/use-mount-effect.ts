// eslint-disable-next-line no-restricted-imports -- sole authorized escape hatch
import { useEffect } from "react";

import type { EffectCallback } from "react";

export function useMountEffect(effect: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
