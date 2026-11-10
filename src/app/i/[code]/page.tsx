import { redirect } from "next/navigation";

/** Invite links look like /i/CODE. The app itself reads the code after sign-in. */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(/^[A-Za-z0-9_-]{8,32}$/.test(code) ? `/?i=${code}` : "/");
}
