import {
  clientSideApiEndpointsLimiter,
  forgetPasswordLimiter,
  loginLimiter,
  resetPasswordLimiter,
  shareUrlLimiter,
  signUpLimiter,
  syncUserIdentificationLimiter,
  verifyEmailLimiter,
} from "@/app/middleware/bucket";
import {
  clientSideApiRoute,
  forgetPasswordRoute,
  isAuthProtectedRoute,
  isSyncWithUserIdentificationEndpoint,
  loginRoute,
  resetPasswordRoute,
  shareUrlRoute,
  signupRoute,
  verifyEmailRoute,
} from "@/app/middleware/endpointValidator";
import { ipAddress } from "@vercel/functions";
import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { RATE_LIMITING_DISABLED, WEBAPP_URL } from "@formbricks/lib/constants";
import { isValidCallbackUrl } from "@formbricks/lib/utils/url";

export const middleware = async (request: NextRequest) => {
  // issue with next auth types; let's review when new fixes are available
  const token = await getToken({ req: request as any });

  if (isAuthProtectedRoute(request.nextUrl.pathname) && !token) {
    const loginUrl = `${WEBAPP_URL}/auth/login?callbackUrl=${encodeURIComponent(WEBAPP_URL + request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(loginUrl);
  }

  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
  if (callbackUrl && !isValidCallbackUrl(callbackUrl, WEBAPP_URL)) {
    return NextResponse.json({ error: "Invalid callback URL" });
  }
  if (token && callbackUrl) {
    return NextResponse.redirect(WEBAPP_URL + callbackUrl);
  }
  if (process.env.NODE_ENV !== "production" || RATE_LIMITING_DISABLED) {
    return NextResponse.next();
  }

  let ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    ipAddress(request);

  if (ip) {
    try {
      if (loginRoute(request.nextUrl.pathname)) {
        await loginLimiter(`login-${ip}`);
      } else if (signupRoute(request.nextUrl.pathname)) {
        await signUpLimiter(`signup-${ip}`);
      } else if (forgetPasswordRoute(request.nextUrl.pathname)) {
        await forgetPasswordLimiter(`forget-password-${ip}`);
      } else if (verifyEmailRoute(request.nextUrl.pathname)) {
        await verifyEmailLimiter(`verify-email-${ip}`);
      } else if (resetPasswordRoute(request.nextUrl.pathname)) {
        await resetPasswordLimiter(`reset-password-${ip}`);
      } else if (clientSideApiRoute(request.nextUrl.pathname)) {
        await clientSideApiEndpointsLimiter(`client-side-api-${ip}`);

        const envIdAndUserId = isSyncWithUserIdentificationEndpoint(request.nextUrl.pathname);
        if (envIdAndUserId) {
          const { environmentId, userId } = envIdAndUserId;
          await syncUserIdentificationLimiter(`sync-${environmentId}-${userId}`);
        }
      } else if (shareUrlRoute(request.nextUrl.pathname)) {
        await shareUrlLimiter(`share-${ip}`);
      }
      return NextResponse.next();
    } catch (e) {
      console.log(`Rate Limiting IP: ${ip}`);
      return NextResponse.json({ error: "Too many requests, Please try after a while!" }, { status: 429 });
    }
  }
  return NextResponse.next();
};

export const config = {
  matcher: [
    "/api/auth/callback/credentials",
    "/api/v1/users",
    "/api/v1/users/forgot-password",
    "/api/v1/users/verification-email",
    "/api/v1/users/reset-password",
    "/api/(.*)/client/:path*",
    "/api/v1/js/actions",
    "/api/v1/client/storage",
    "/share/(.*)/:path",
    "/environments/:path*",
    "/setup/organization/:path*",
    "/api/auth/signout",
    "/auth/login",
    "/api/packages/:path*",
  ],
};
