// eslint-disable-next-line no-restricted-imports -- sole authorized escape hatch
import { useEffect } from "react";

import type { EffectCallback } from "react";

export function useMountEffect(effect: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only effect; empty deps array is the whole point of this wrapper
  useEffect(effect, []);
}
