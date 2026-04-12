export interface Keyring {
  readonly secrets: Record<number, Uint8Array>;
  readonly currentVersion: number;
}

export interface EnvelopeEncryptResult {
  readonly encryptedBlob: string;
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

const getSecret = (keyring: Keyring, version: number): Uint8Array => {
  const secret = keyring.secrets[version];
  if (!secret) {
    // eslint-disable-next-line functional/no-throw-statements -- pure validation at boundary
    throw new Error(`Keyring version ${version} not found`);
  }
  return secret;
};

export const resolveKeyring = (vaultKeyringJson: string): Keyring => {
  const raw: unknown = JSON.parse(vaultKeyringJson);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    // eslint-disable-next-line functional/no-throw-statements -- pure validation at boundary
    throw new Error("Vault keyring must be a JSON object");
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    // eslint-disable-next-line functional/no-throw-statements -- pure validation at boundary
    throw new Error("Vault keyring is empty");
  }

  const secrets = Object.fromEntries(
    entries.map(([key, value]) => {
      const version = Number(key);
      if (!Number.isInteger(version) || version < 1) {
        // eslint-disable-next-line functional/no-throw-statements -- pure validation at boundary
        throw new Error(`Invalid keyring version: ${key}`);
      }
      return [version, fromBase64(String(value))] as const;
    }),
  );

  const currentVersion = Math.max(...Object.keys(secrets).map(Number));
  return { secrets, currentVersion };
};

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
      salt: new TextEncoder().encode(orgId),
      info: new TextEncoder().encode(`credential-vault:${keyVersion}`),
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
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, asBuffer(plaintext));
  return new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
};

export const decryptAesGcm = async (key: CryptoKey, data: Uint8Array): Promise<Uint8Array> => {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, asBuffer(ciphertext));
  return new Uint8Array(decrypted);
};

const importDekKey = async (dek: Uint8Array, usages: readonly KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", asBuffer(dek), { name: "AES-GCM" }, true, [...usages]);

export const envelopeEncrypt = async (
  keyring: Keyring,
  orgId: string,
  plaintext: Uint8Array,
): Promise<EnvelopeEncryptResult> => {
  const dek = generateDEK();
  const kek = await deriveKEK(
    getSecret(keyring, keyring.currentVersion),
    orgId,
    keyring.currentVersion,
  );
  const dekKey = await importDekKey(dek, ["encrypt", "decrypt"]);
  const encryptedBlob = await encryptAesGcm(dekKey, plaintext);
  const encryptedDek = await encryptAesGcm(kek, dek);
  return {
    encryptedBlob: toBase64(encryptedBlob),
    encryptedDek: toBase64(encryptedDek),
    keyVersion: keyring.currentVersion,
  };
};

export const envelopeDecrypt = async (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedDekB64: string,
  encryptedBlobB64: string,
): Promise<Uint8Array> => {
  const kek = await deriveKEK(getSecret(keyring, keyVersion), orgId, keyVersion);
  const dek = await decryptAesGcm(kek, fromBase64(encryptedDekB64));
  const dekKey = await importDekKey(dek, ["decrypt"]);
  return decryptAesGcm(dekKey, fromBase64(encryptedBlobB64));
};

export const encryptSecret = async (
  keyring: Keyring,
  orgId: string,
  secret: string,
): Promise<{ encrypted: string; keyVersion: number }> => {
  const kek = await deriveKEK(
    getSecret(keyring, keyring.currentVersion),
    orgId,
    keyring.currentVersion,
  );
  const encrypted = await encryptAesGcm(kek, new TextEncoder().encode(secret));
  return { encrypted: toBase64(encrypted), keyVersion: keyring.currentVersion };
};

export const decryptSecret = async (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedB64: string,
): Promise<string> => {
  const kek = await deriveKEK(getSecret(keyring, keyVersion), orgId, keyVersion);
  const decrypted = await decryptAesGcm(kek, fromBase64(encryptedB64));
  return new TextDecoder().decode(decrypted);
};
