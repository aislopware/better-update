import forge from "node-forge";

export interface CsrResult {
  readonly csrPem: string;
  readonly privateKeyPem: string;
  readonly privateKey: forge.pki.rsa.PrivateKey;
}

const generateRsaKeyPair = async (): Promise<forge.pki.rsa.KeyPair> =>
  new Promise((resolve) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (_err, keyPair) => {
      resolve(keyPair);
    });
  });

export const generateCertificateSigningRequest = async (): Promise<CsrResult> => {
  const keyPair = await generateRsaKeyPair();
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keyPair.publicKey;
  csr.setSubject([{ name: "commonName", shortName: "CN", value: "PEM" }]);
  csr.sign(keyPair.privateKey, forge.md.sha1.create());
  return {
    csrPem: forge.pki.certificationRequestToPem(csr),
    privateKeyPem: forge.pki.privateKeyToPem(keyPair.privateKey),
    privateKey: keyPair.privateKey,
  };
};
