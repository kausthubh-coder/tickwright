import { createRemoteJWKSet, jwtVerify } from "jose";

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifySession(
  token: string,
  issuer: string,
  origin: string,
): Promise<string> {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:")
    throw new Error("Clerk issuer must use HTTPS");
  let jwks = keys.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
    keys.set(issuer, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "azp"],
  });
  if (payload.azp !== origin || !payload.sub)
    throw new Error("Wrong session origin");
  return payload.sub;
}
