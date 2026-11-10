export const dynamic = "force-dynamic";

/**
 * Digital Asset Links for the Android wrapper (Trusted Web Activity).
 *
 * After an APK is generated for this site's permanent address, set
 * ANDROID_PACKAGE_NAME and ANDROID_SHA256_FINGERPRINT (comma-separated if
 * there are several). Android then trusts the APK to show this site
 * full-screen, without a browser address bar.
 */
export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body =
    packageName && fingerprints.length
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
