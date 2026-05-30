import { createSign, createVerify, X509Certificate } from "node:crypto";

import { buildExpoSignatureHeader } from "@better-update/expo-codesign";

// A FIXED 2048-bit RSA keypair + self-signed code-signing certificate used by the
// e2e tests that publish a real, verifiable signed update. The keypair is fixed
// (not regenerated per run) so the fixture is deterministic and cheap; the
// SIGNATURE is computed per-test over the exact manifest body bytes (node:crypto
// createSign works in the workerd pool under nodejs_compat). Test-only material.
export const TEST_CODE_SIGNING_PRIVATE_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAsxasAhcb35DDhEqokoOU1ETaGjNyJZDNtxTSxuBvDqPAMp26
XGHAibfjsC/40LpFx9XoVSCxwMg2yxEajKGkSvO4+s3uHrThGqcKjMz3daFrgg4s
Adt1exprQ13XBRBbp3lwP7zww5ZedcbQekwIsZl6GlVMOk6KhJJvQXhKK7nQHv1+
KINLxpLLritqgmyzjaU0WtxAb+cycAY6Vld0Hpnyo5x+Tw6mz856rqVkulnfZrPb
vCHjRHHsSKH1MIioylyD2xRrbSGovYq+LBtC0zlYtT113djFQ4NVc1a0wgB5z1bB
yjRTaWx5pzNr4SFMJVkeI+R3TK+l8uHpZbJCtQIDAQABAoIBAFBrhmtb4DbpJXtD
IWbFsrANiRlJ7+DBoTctISeQgh6DVxwDqzuv48uUKaklKajldM9zlaSgjWHCJqTS
tebf8Ux9HJx3nA3q8MjMqRaoNhl7FrFs1sMwvxU8PF2ghp1uBpJynH7qw/04iYt+
74Bzo1XJU0T+97+ZJGe68D3om/n88ibwHirU7SQf6dHdt1f78rsoImqpMghn1ggR
pmt7Fx/lSAiXpvty0b34IrDFzQmJZCsEsMVujzHQjWI5IiMO05UZ9xIRlaGvlRpQ
9sFn2AFpxwB+LB1l1xPtI4/W7O72QRutqpD+TazwMg6TBOROIZwVDUeqwynuclZJ
pJ5/98MCgYEA7DOL27g1LSFAYu+VrXqEBlyzTPap1z+B1EXqr9v1VtJvm/0qlMu0
vrM3Jh6M6cHuwgbIJK6L9utnwF2syLIgm6OVVSB4VMlBpwvFZju8nFj903WZws5M
bFCx5Brn/ITLIJ52y981HXReTlrwDbZRi5X74bQP7/pzETVRuuN3W5cCgYEAwhmW
o1tad8ObLLq1lS0BrMS1HuVEn9jHZiRegiXaX7H7FCmPR0w/DmsiHPuki4Vr55Ci
kJB6LorF0KTLHLilGjRfsSPv7xoZEoFxwa2Du96ssAxoGDsiPGR8uuOlwRvDr33p
uQwKTxTdDBxLD+tLA6fv0M4kR76k14pgJMPODZMCgYAoxPzu/+ytzX9/lDsRpoQD
VRzdu/W04ZFXQnovwJeoVMpO8nPXGxInmGd8fOl1r7O2adVB/57JD/joi0K3oYdf
Ve0AtIoQmGxsmOuJqeX0Vqf5R+MybMlkKMmLxdklDQbCqpd2uSBB5UQh4jBtLXsF
zO2dF6dolKIn5jwlNf30IQKBgQCBHt6b6zCijUhUGBylkRwVH4JRfDkLkP0M0NLi
B2Ze1JpvTjpXNryXzeMSnsBWZDplAE10l/f/sCdp5caMY7TJWt/xijOZvqXBLsVL
Dy+cMcR1FLvGqsfanwpulPP2I48o1j098WmGNB3caZHxlBgB5ZzeLdPqukMUc6QD
sRII6wKBgDRhiE2Hw1JroBDxMZrPI2M1gyat7k7aRH8EKQ75zI88kYdXKR2WyXqj
xdNJ5UKXiCVQYX2Cg9AkIxFWwLG4AtVD2FzWTopdWR0Wpa0JkYWqUQQOLLtW3xBZ
o8zentUY4q2d6VRk4wu3e60/gfjp/+uLfGv7liUVoeIHAfbNTAFs
-----END RSA PRIVATE KEY-----`;

export const TEST_CODE_SIGNING_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIC8zCCAdugAwIBAgIBATANBgkqhkiG9w0BAQsFADAqMSgwJgYDVQQDEx9CZXR0
ZXIgVXBkYXRlIFRlc3QgQ29kZSBTaWduaW5nMB4XDTI1MDEwMTAwMDAwMFoXDTM1
MDEwMTAwMDAwMFowKjEoMCYGA1UEAxMfQmV0dGVyIFVwZGF0ZSBUZXN0IENvZGUg
U2lnbmluZzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALMWrAIXG9+Q
w4RKqJKDlNRE2hozciWQzbcU0sbgbw6jwDKdulxhwIm347Av+NC6RcfV6FUgscDI
NssRGoyhpErzuPrN7h604RqnCozM93Wha4IOLAHbdXsaa0Nd1wUQW6d5cD+88MOW
XnXG0HpMCLGZehpVTDpOioSSb0F4Siu50B79fiiDS8aSy64raoJss42lNFrcQG/n
MnAGOlZXdB6Z8qOcfk8Ops/Oeq6lZLpZ32az27wh40Rx7Eih9TCIqMpcg9sUa20h
qL2KviwbQtM5WLU9dd3YxUODVXNWtMIAec9Wwco0U2lseacza+EhTCVZHiPkd0yv
pfLh6WWyQrUCAwEAAaMkMCIwCwYDVR0PBAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUF
BwMDMA0GCSqGSIb3DQEBCwUAA4IBAQCJh1iV4xGvK6wup8O78PdkbUFdMk95ce7c
POD94CIi8dajtV1Dd8Vg67xb4x/ULosqjNrjDB1xp8REx4VAoLpc5FfcghjfZ4La
qNMICDaJzd07XZn+kQRVsBFJwg9JupzMugdFaKjCbh8Kl+YoGdDnZ5UrbvhSChy6
B5Eg/PfmvQJ91PmUjZaI09VNB+n0RgqTqKXi8CuC+WnOfp34xd2I17C8eowBHMYZ
WZspYcC5LPQ33/q0+msJfdBSOq4xnkDjQbCn4w9XVkEmx6RKsJrWas5TvbACLLOz
eK+o9+xp1r5l2kyoXumT/qXugFHuIr0AHwXOaS80ZsNrHqCqNmF8
-----END CERTIFICATE-----`;

/**
 * Sign manifest body bytes with the fixed test key and return the full
 * `expo-signature` SFV header (`sig=…, keyid=…, alg=rsa-v1_5-sha256`). Self-
 * verifies against the test cert to mirror the production signer.
 */
export const signTestManifestBody = (bodyBytes: string, keyid = "main"): string => {
  const sig = createSign("RSA-SHA256")
    .update(bodyBytes, "utf8")
    .sign(TEST_CODE_SIGNING_PRIVATE_KEY_PEM, "base64");
  const verified = createVerify("RSA-SHA256")
    .update(bodyBytes, "utf8")
    .verify(new X509Certificate(TEST_CODE_SIGNING_CERTIFICATE_PEM).publicKey, sig, "base64");
  if (!verified) {
    throw new Error("test fixture signature does not self-verify");
  }
  return buildExpoSignatureHeader({ sig, keyid });
};
