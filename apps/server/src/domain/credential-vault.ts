import { Effect } from "effect";

export interface Keyring {
  readonly secrets: Record<number, Uint8Array>;
  readonly currentVersion: number;
}

export interface EnvelopeEncryptResult {
  readonly encryptedBlob: Uint8Array;
  readonly encryptedDek: string;
  readonly keyVersion: number;
}

export const toBase64 = (data: Uint8Array): string => {
  const binary = [...data].map((byte) => String.fromCodePoint(byte)).join("");
  return btoa(binary);
};

export const fromBase64 = (str: string): Uint8Array => {
  const binary = atob(str);
  return new Uint8Array(
    Array.from({ length: binary.length }, (_, idx) => binary.codePointAt(idx) ?? 0),
  );
};

const asBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
};

const keyringError = (message: string) => new Error(message);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getSecret = (keyring: Keyring, version: number): Effect.Effect<Uint8Array, Error> => {
  const secret = keyring.secrets[version];
  return secret
    ? Effect.succeed(secret)
    : Effect.fail(keyringError(`Keyring version ${version} not found`));
};

export const resolveKeyring = (vaultKeyringJson: string): Effect.Effect<Keyring, Error> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(vaultKeyringJson) as unknown,
      catch: () => keyringError("Vault keyring must be valid JSON"),
    });
    if (!isRecord(raw)) {
      return yield* Effect.fail(keyringError("Vault keyring must be a JSON object"));
    }
    const entries = Object.entries(raw);
    if (entries.length === 0) {
      return yield* Effect.fail(keyringError("Vault keyring is empty"));
    }

    const pairs = yield* Effect.forEach(
      entries,
      ([key, value]) => {
        const version = Number(key);
        return Number.isInteger(version) && version >= 1
          ? Effect.succeed([version, fromBase64(String(value))] as const)
          : Effect.fail(keyringError(`Invalid keyring version: ${key}`));
      },
      { concurrency: 1 },
    );

    const secrets: Record<number, Uint8Array> = Object.fromEntries(pairs);
    const currentVersion = Math.max(...Object.keys(secrets).map(Number));
    return { secrets, currentVersion };
  });

export const deriveKEK = async (
  secret: Uint8Array,
  orgId: string,
  keyVersion: number,
): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey("raw", asBuffer(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBuffer(new TextEncoder().encode(orgId)),
      info: asBuffer(new TextEncoder().encode(`credential-vault:${keyVersion}`)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const generateDEK = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export const encryptAesGcm = async (key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(plaintext),
  );
  return new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
};

export const decryptAesGcm = async (key: CryptoKey, data: Uint8Array): Promise<Uint8Array> => {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(ciphertext),
  );
  return new Uint8Array(decrypted);
};

const importDekKey = async (dek: Uint8Array, usages: readonly KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", asBuffer(dek), { name: "AES-GCM" }, true, [...usages]);

export const envelopeEncrypt = async (
  keyring: Keyring,
  orgId: string,
  plaintext: Uint8Array,
): Promise<EnvelopeEncryptResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const dek = generateDEK();
      const secret = yield* getSecret(keyring, keyring.currentVersion);
      const kek = yield* Effect.promise(async () =>
        deriveKEK(secret, orgId, keyring.currentVersion),
      );
      const dekKey = yield* Effect.promise(async () => importDekKey(dek, ["encrypt", "decrypt"]));
      const encryptedBlob = yield* Effect.promise(async () => encryptAesGcm(dekKey, plaintext));
      const encryptedDek = yield* Effect.promise(async () => encryptAesGcm(kek, dek));
      return {
        encryptedBlob,
        encryptedDek: toBase64(encryptedDek),
        keyVersion: keyring.currentVersion,
      };
    }),
  );

export const envelopeDecrypt = async (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedDekB64: string,
  encryptedBlob: Uint8Array,
): Promise<Uint8Array> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secret = yield* getSecret(keyring, keyVersion);
      const kek = yield* Effect.promise(async () => deriveKEK(secret, orgId, keyVersion));
      const dek = yield* Effect.promise(async () =>
        decryptAesGcm(kek, fromBase64(encryptedDekB64)),
      );
      const dekKey = yield* Effect.promise(async () => importDekKey(dek, ["decrypt"]));
      return yield* Effect.promise(async () => decryptAesGcm(dekKey, encryptedBlob));
    }),
  );

export const encryptSecret = async (
  keyring: Keyring,
  orgId: string,
  secret: string,
): Promise<{ encrypted: string; keyVersion: number }> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const keySecret = yield* getSecret(keyring, keyring.currentVersion);
      const kek = yield* Effect.promise(async () =>
        deriveKEK(keySecret, orgId, keyring.currentVersion),
      );
      const plaintext = new TextEncoder().encode(secret);
      const encrypted = yield* Effect.promise(async () => encryptAesGcm(kek, plaintext));
      return { encrypted: toBase64(encrypted), keyVersion: keyring.currentVersion };
    }),
  );

export const decryptSecret = async (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedB64: string,
): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secret = yield* getSecret(keyring, keyVersion);
      const kek = yield* Effect.promise(async () => deriveKEK(secret, orgId, keyVersion));
      const decrypted = yield* Effect.promise(async () =>
        decryptAesGcm(kek, fromBase64(encryptedB64)),
      );
      return new TextDecoder().decode(decrypted);
    }),
  );
