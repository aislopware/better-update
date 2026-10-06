/**
 * Apple's public intermediate certificate authorities, as published at
 * https://www.apple.com/certificateauthority/ (base64 DER). A `.p12` exported
 * from Keychain Access carries only the leaf certificate, so on a machine
 * whose keychains lack the matching intermediate — any clean CI runner, or a
 * process with its own HOME — codesign cannot build the chain to Apple's root:
 * `find-identity -v` reports no valid identity and signing fails. Importing
 * these into the ephemeral signing keychain makes every Developer ID and
 * Apple Distribution/Development certificate resolvable anywhere.
 *
 * Regenerate from the URLs in each entry; verify the SHA-256 fingerprints.
 */

export interface AppleIntermediateCa {
  readonly fileName: string;
  readonly description: string;
  /** SHA-256 of the DER bytes, uppercase hex. */
  readonly sha256: string;
  readonly derBase64: string;
}

export const APPLE_INTERMEDIATE_CAS: readonly AppleIntermediateCa[] = [
  {
    // https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
    fileName: "DeveloperIDG2CA.cer",
    description:
      "Developer ID Certification Authority (G2) — signs current Developer ID certificates",
    sha256: "F16CD3C54C7F83CEA4BF1A3E6A0819C8AAA8E4A1528FD144715F350643D2DF3A",
    derBase64:
      "MIIEPjCCAyagAwIBAgIUf7QAP82XSXrLg02SpIp4c8KEXUMwDQYJKoZIhvcNAQELBQAwYjELMAkGA1UEBhMCVVMxEz" +
      "ARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsTHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQD" +
      "Ew1BcHBsZSBSb290IENBMB4XDTIxMDkyMjE4NTUxMFoXDTMxMDkxNzAwMDAwMFowXjEtMCsGA1UEAwwkRGV2ZWxvcG" +
      "VyIElEIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MQswCQYDVQQLDAJHMjETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkG" +
      "A1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDTLJVoIVSRir9lccIYTvbNDeGRKHXXA7qVH9" +
      "MSmVJE3oBGZ/wpiwCFiIowh01Mbkq0x+UC49djTKrM6uzbQi+RfSXpX6RLKlRvF6wwnykoNKR/j+V4410jKiFG0InD" +
      "X/hql51xGxiosgzJAwo1sgKnLfWz3BuDxSchQHKm5zd2Mee7Br90svZwrEysLc3JXkWLz/sI5mLVQJW1N1zMGw7h79" +
      "yl5Y3JULdAnwojJUVAj5Rne+CU6jnTeKU00cLL4DN/LrYsw+Um1SXOqo0qd/yeFJaX4PVfLvLop3GnO6OZTHoio03v" +
      "cBHV1oaBgvFnM5MzWkCxksSqc5YdxFz/4es3AgMBAAGjge8wgewwEgYDVR0TAQH/BAgwBgEB/wIBADAfBgNVHSMEGD" +
      "AWgBQr0GlHlHYJ/vRrjS5ApvdHTX8IXjBEBggrBgEFBQcBAQQ4MDYwNAYIKwYBBQUHMAGGKGh0dHA6Ly9vY3NwLmFw" +
      "cGxlLmNvbS9vY3NwMDMtYXBwbGVyb290Y2EwLgYDVR0fBCcwJTAjoCGgH4YdaHR0cDovL2NybC5hcHBsZS5jb20vcm" +
      "9vdC5jcmwwHQYDVR0OBBYEFPg6DGkRduDtrNHrpln6N9XEVbAeMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIG" +
      "BAIFADANBgkqhkiG9w0BAQsFAAOCAQEAwf1DClm/8bG3QxBa1hgyMBRWJuERSGMraXKXSB+OW8peJhX7dCOAM1QzGa" +
      "EihlrYuEtpqqfOlpbCCsc1atBvzoppg2JtSjn1/oNN16LUiB/tiMAP+PkzHrQQt8JcETdENwSwpESdjGgNe30dfsy1" +
      "k/DWbz0VeoCldNPhj33SiOgxp5jFH9/iglmugIFgRhbsnrmKQKobKuFhhgqMcA/ZSizsTKIFEdZ5jKVjJSEjAm+TW1" +
      "pXoddFbd/M93+fX9vH7WSnb0Qvb009eHgKVrQ71zrIK2Wik+rbWOqO1LnEwDD8MhpNupIMJDmYgjqgmd7n5OS8DryF" +
      "r1qrXND828wQww==",
  },
  {
    // https://www.apple.com/certificateauthority/DeveloperIDCA.cer
    fileName: "DeveloperIDCA.cer",
    description: "Developer ID Certification Authority (original) — expires 2027-02-01",
    sha256: "7AFC9D01A62F03A2DE9637936D4AFE68090D2DE18D03F29C88CFB0B1BA63587F",
    derBase64:
      "MIIEBDCCAuygAwIBAgIIGHqpqMKWIQwwDQYJKoZIhvcNAQELBQAwYjELMAkGA1UEBhMCVVMxEzARBgNVBAoTCkFwcG" +
      "xlIEluYy4xJjAkBgNVBAsTHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQDEw1BcHBsZSBSb290" +
      "IENBMB4XDTEyMDIwMTIyMTIxNVoXDTI3MDIwMTIyMTIxNVoweTEtMCsGA1UEAwwkRGV2ZWxvcGVyIElEIENlcnRpZm" +
      "ljYXRpb24gQXV0aG9yaXR5MSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwK" +
      "QXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCJdk8GW5pB7qUjKw" +
      "KjX9dzP8A1sIuECj8GJH+nlT/rTw6Tr7QO0Mg+5W0Ysx/oiUe/1wkI5P9WmCkV55SduTWjCs20wOHiYPTK7Cl4RWlp" +
      "YGtfipL8niPmOsIiszFPHLrytjRZQu6wqQIDGJEEtrN4LjMfgEUNRW+7Dlpbfzrn2AjXCw4ybfuGNuRsq8QRinCEJq" +
      "qfRNHxuMZ7lBebSPcLWBa6I8WfFTl+yl3DMl8P4FJ/QOq+rAhklVvJGpzlgMofakQcbD7EsCYfHex7r16gaj1HqVgS" +
      "MT8gdihtHRywwk4RaSaLy9bQEYLJTg/xVnTQ2QhLZniiq6yn4tJMh1nJAgMBAAGjgaYwgaMwHQYDVR0OBBYEFFcX7a" +
      "LP3HyYoRDg/L6HLSzy4xdUMA8GA1UdEwEB/wQFMAMBAf8wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4w" +
      "LgYDVR0fBCcwJTAjoCGgH4YdaHR0cDovL2NybC5hcHBsZS5jb20vcm9vdC5jcmwwDgYDVR0PAQH/BAQDAgGGMBAGCi" +
      "qGSIb3Y2QGAgYEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQBCOXRrodzGpI83KoyzHQpEvJUsf7xZuKxh+weQkjK51L87" +
      "wVA5akR0ouxbH3Dlqt1LbBwjcS1f0cWTvu6binBlgp0W4xoQF4ktqM39DHhYSQwofzPuAHobtHastrW7T9+oG53IGZ" +
      "dKC1ZnL8I+trPEgzrwd210xC4jUe6apQNvYPSlSKcGwrta4h8fRkV+5Jf1JxC3ICJyb3LaxlB1xT0lj12jAOmfNoxI" +
      "OY+zO+qQgC6VmmD0eM70DgpTPqL6T9geroSVjTK8Vk2J6XgY4KyaQrp6RhuEoonOFOiI0ViL9q5WxCwFKkWvC9lLqQ" +
      "IPNKyIx2FViUTJJ3MH7oLlTvVw",
  },
  {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG2.cer
    fileName: "AppleWWDRCAG2.cer",
    description: "Apple Worldwide Developer Relations CA - G2",
    sha256: "9ED4B3B88C6A339CF1387895BDA9CA6EA31A6B5CE9EDF7511845923B0C8AC94C",
    derBase64:
      "MIIC9zCCAnygAwIBAgIIb+/Y9emjp+4wCgYIKoZIzj0EAwIwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMS" +
      "YwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UE" +
      "BhMCVVMwHhcNMTQwNTA2MjM0MzI0WhcNMjkwNTA2MjM0MzI0WjCBgDE0MDIGA1UEAwwrQXBwbGUgV29ybGR3aWRlIE" +
      "RldmVsb3BlciBSZWxhdGlvbnMgQ0EgLSBHMjEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx" +
      "EzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3fC3BkvP3X" +
      "MEE8RDiQOTgPte9nStQmFSWAImUxnIYyIHCVJhysTZV+9tJmiLdJGMxPmAaCj8CWjwENrp0C7JGqOB9zCB9DBGBggr" +
      "BgEFBQcBAQQ6MDgwNgYIKwYBBQUHMAGGKmh0dHA6Ly9vY3NwLmFwcGxlLmNvbS9vY3NwMDQtYXBwbGVyb290Y2FnMz" +
      "AdBgNVHQ4EFgQUhLaEzDqGYnIWWZToGqO9SN863wswDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBS7sN6hWDOI" +
      "mqSKmd6+veuv2sskqzA3BgNVHR8EMDAuMCygKqAohiZodHRwOi8vY3JsLmFwcGxlLmNvbS9hcHBsZXJvb3RjYWczLm" +
      "NybDAOBgNVHQ8BAf8EBAMCAQYwEAYKKoZIhvdjZAYCDwQCBQAwCgYIKoZIzj0EAwIDaQAwZgIxANmxxzHGI/ZPTdDZ" +
      "R8V9GGkRh3En02it4Jtlmr5s3z9GppAJvm6hOyywUYlBPIfSvwIxAPxkUolLPF2/axzCiZgvcq61m6oaCyNUd1ToFU" +
      "OixRLal1BzfF7QbrJcYlDXUfE6Wg==",
  },
  {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
    fileName: "AppleWWDRCAG3.cer",
    description: "Apple Worldwide Developer Relations CA - G3",
    sha256: "DCF21878C77F4198E4B4614F03D696D89C66C66008D4244E1B99161AAC91601F",
    derBase64:
      "MIIEUTCCAzmgAwIBAgIQfK9pCiW3Of57m0R6wXjF7jANBgkqhkiG9w0BAQsFADBiMQswCQYDVQQGEwJVUzETMBEGA1" +
      "UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxFjAUBgNVBAMTDUFw" +
      "cGxlIFJvb3QgQ0EwHhcNMjAwMjE5MTgxMzQ3WhcNMzAwMjIwMDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZH" +
      "dpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzMxEzARBgNV" +
      "BAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2PWJ/KhZC4" +
      "fHTJEuLVaQ03gdpDDppUjvC0O/LYT7JF1FG+XrWTYSXFRknmxiLbTGl8rMPPbWBpH85QKmHGq0edVny6zpPwcR4YS8" +
      "Rx1mjjmi6LRJ7TrS4RBgeo6TjMrA2gzAg9Dj+ZHWp4zIwXPirkbRYp2SqJBgN31ols2N4Pyb+ni743uvLRfdW/6AWS" +
      "N1F7gSwe0b5TTO/iK1nkmw5VW/j4SiPKi6xYaVFuQAyZ8D0MyzOhZ71gVcnetHrg21LYwOaU1A0EtMOwSejSGxrC5D" +
      "VDDOwYqGlJhL32oNP/77HK6XF8J4CjDgXx9UO0m3JQAaN4LSVpelUkl8YDib7wIDAQABo4HvMIHsMBIGA1UdEwEB/w" +
      "QIMAYBAf8CAQAwHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wRAYIKwYBBQUHAQEEODA2MDQGCCsGAQUF" +
      "BzABhihodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhMC4GA1UdHwQnMCUwI6AhoB+GHWh0dH" +
      "A6Ly9jcmwuYXBwbGUuY29tL3Jvb3QuY3JsMB0GA1UdDgQWBBQJ/sAVkPmvZAqSErkmKGMMl+ynsjAOBgNVHQ8BAf8E" +
      "BAMCAQYwEAYKKoZIhvdjZAYCAQQCBQAwDQYJKoZIhvcNAQELBQADggEBAK1lE+j24IF3RAJHQr5fpTkg6mKp/cWQyX" +
      "MT1Z6b0KoPjY3L7QHPbChAW8dVJEH4/M/BtSPp3Ozxb8qAHXfCxGFJJWevD8o5Ja3T43rMMygNDi6hV0Bz+uZcrgZR" +
      "Ke3jhQxPYdwyFot30ETKXXIDMUacrptAGvr04NM++i+MZp+XxFRZ79JI9AeZSWBZGcfdlNHAwWx/eCHvDOs7bJmCS1" +
      "JgOLU5gm3sUjFTvg+RTElJdI+mUcuER04ddSduvfnSXPN/wmwLCTbiZOTCNwMUGdXqapSqqdv+9poIZ4vvK7iqF0mD" +
      "r8/LvOnP6pVxsLRFoszlh6oKw0E6eVzaUDSdlTs=",
  },
  {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
    fileName: "AppleWWDRCAG4.cer",
    description: "Apple Worldwide Developer Relations CA - G4",
    sha256: "EA4757885538DD8CB59FF4556F676087D83C85E70902C122E42C0808B5BCE14C",
    derBase64:
      "MIIEVTCCAz2gAwIBAgIUE9x3lVJx5T3GMujM/+Uh88zFztIwDQYJKoZIhvcNAQELBQAwYjELMAkGA1UEBhMCVVMxEz" +
      "ARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsTHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQD" +
      "Ew1BcHBsZSBSb290IENBMB4XDTIwMTIxNjE5MzYwNFoXDTMwMTIxMDAwMDAwMFowdTFEMEIGA1UEAww7QXBwbGUgV2" +
      "9ybGR3aWRlIERldmVsb3BlciBSZWxhdGlvbnMgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxCzAJBgNVBAsMAkc0MRMw" +
      "EQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANAfeK" +
      "p6JzKwRl/nF3bYoJ0OKY6tPTKlxGs3yeRBkWq3eXFdDDQEYHX3rkOPR8SGHgjov9Y5Ui8eZ/xx8YJtPH4GUnadLLzV" +
      "Q+mxtLxAOnhRXVGhJeG+bJGdayFZGEHVD41tQSo5SiHgkJ9OE0/QjJoyuNdqkh4laqQyziIZhQVg3AJK8lrrd3kCfc" +
      "CXVGySjnYB5kaP5eYq+6KwrRitbTOFOCOL6oqW7Z+uZk+jDEAnbZXQYojZQykn/e2kv1MukBVlPNkuYmQzHWxq3Y4h" +
      "qqRfFcYw7V/mjDaSlLfcOQIA+2SM1AyB8j/VNJeHdSbCb64DYyEMe9QbsWLFApy9/a8CAwEAAaOB7zCB7DASBgNVHR" +
      "MBAf8ECDAGAQH/AgEAMB8GA1UdIwQYMBaAFCvQaUeUdgn+9GuNLkCm90dNfwheMEQGCCsGAQUFBwEBBDgwNjA0Bggr" +
      "BgEFBQcwAYYoaHR0cDovL29jc3AuYXBwbGUuY29tL29jc3AwMy1hcHBsZXJvb3RjYTAuBgNVHR8EJzAlMCOgIaAfhh" +
      "1odHRwOi8vY3JsLmFwcGxlLmNvbS9yb290LmNybDAdBgNVHQ4EFgQUW9n6HeeaGgujmXYiUIY+kchbd6gwDgYDVR0P" +
      "AQH/BAQDAgEGMBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQA/Vj2e5bbDeeZFIGi9v3OLLBKeAu" +
      "OugCKMBB7DUshwgKj7zqew1UJEggOCTwb8O0kU+9h0UoWvp50h5wESA5/NQFjQAde/MoMrU1goPO6cn1R2PWQnxn6N" +
      "HThNLa6B5rmluJyJlPefx4elUWY0GzlxOSTjh2fvpbFoe4zuPfeutnvi0v/fYcZqdUmVIkSoBPyUuAsuORFJEtHlge" +
      "pZAE9bPFo22noicwkJac3AfOriJP6YRLj477JxPxpd1F1+M02cHSS+APCQA1iZQT0xWmJArzmoUUOSqwSonMJNsUvS" +
      "q3xKX+udO7xPiEAGE/+QF4oIRynoYpgppU8RBWk6z/Kf",
  },
  {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG5.cer
    fileName: "AppleWWDRCAG5.cer",
    description: "Apple Worldwide Developer Relations CA - G5",
    sha256: "53FD008278E5A595FE1E908AE9C5E5675F26243264A5A6438C023E3CE2870760",
    derBase64:
      "MIIEVTCCAz2gAwIBAgIUO36ACu7TAqHm7NuX2cqsKJzxaZQwDQYJKoZIhvcNAQELBQAwYjELMAkGA1UEBhMCVVMxEz" +
      "ARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsTHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQD" +
      "Ew1BcHBsZSBSb290IENBMB4XDTIwMTIxNjE5Mzg1NloXDTMwMTIxMDAwMDAwMFowdTFEMEIGA1UEAww7QXBwbGUgV2" +
      "9ybGR3aWRlIERldmVsb3BlciBSZWxhdGlvbnMgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxCzAJBgNVBAsMAkc1MRMw" +
      "EQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ9d2h" +
      "/7+rzQSyI8x9Ym+hf39J8ePmQRZprvXr6rNL2qLCFu1h6UIYUsdMEOEGGqPGNKfkrjyHXWz8KcCEh7arkpsclm/ciK" +
      "FtGyBDyCuoBs4v8Kcuus/jtvSL6eixFNlX2ye5AvAhxO/Em+12+1T754xtress3J2WYRO1rpCUVziVDUTuJoBX7adZ" +
      "xLAa7a489tdE3eU9DVGjiCOtCd410pe7GB6iknC/tgfIYS+/BiTwbnTNEf2W2e7XPaeCENnXDZRleQX2eEwXN3Cqhi" +
      "YraucIa7dSOJrXn25qTU/YMmMgo7JJJbIKGc0S+AGJvdPAvntf3sgFcPF54/K4cnu/cCAwEAAaOB7zCB7DASBgNVHR" +
      "MBAf8ECDAGAQH/AgEAMB8GA1UdIwQYMBaAFCvQaUeUdgn+9GuNLkCm90dNfwheMEQGCCsGAQUFBwEBBDgwNjA0Bggr" +
      "BgEFBQcwAYYoaHR0cDovL29jc3AuYXBwbGUuY29tL29jc3AwMy1hcHBsZXJvb3RjYTAuBgNVHR8EJzAlMCOgIaAfhh" +
      "1odHRwOi8vY3JsLmFwcGxlLmNvbS9yb290LmNybDAdBgNVHQ4EFgQUGYuXjUpbYXhX9KVcNRKKOQjjsHUwDgYDVR0P" +
      "AQH/BAQDAgEGMBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQBaxDWi2eYKnlKiAIIid81yL5D5Iq" +
      "8UJcyqCkJgksK9dR3rTMoV5X5rQBBe+1tFdA3wen2Ikc7eY4tCidIY30GzWJ4GCIdI3UCvI9Xt6yxg5eukfxzpnIPW" +
      "lF9MYjmKTq4TjX1DuNxerL4YQPLmDyxdE5Pxe2WowmhI3v+0lpsM+zI2np4NlV84CouW0hJst4sLjtc+7G8Bqs5NRW" +
      "DbhHFmYuUZZTDNiv9FU/tu+4h3Q8NIY/n3UbNyXnniVs+8u4S5OFp4rhFIUrsNNYuU3sx0mmj1SWCUrPKosxWGkNDM" +
      "MEOG0+VwAlG0gcCol9Tq6rCMCUDvOJOyzSID62dDZchF",
  },
  {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer
    fileName: "AppleWWDRCAG6.cer",
    description: "Apple Worldwide Developer Relations CA - G6",
    sha256: "BDD4ED6E74691F0C2BFD01BE0296197AF1379E0418E2D300EFA9C3BEF642CA30",
    derBase64:
      "MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm" +
      "9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUg" +
      "SW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcNMzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZS" +
      "BXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYx" +
      "EzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZX" +
      "nXgtxzdVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7cOB+aao90" +
      "fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUu7DeoVgziJqkip" +
      "nevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAz" +
      "LWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy" +
      "5jcmwwHQYDVR0OBBYEFD8vlCNR01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIF" +
      "ADAKBggqhkjOPQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxcxf" +
      "kCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=",
  },
];
