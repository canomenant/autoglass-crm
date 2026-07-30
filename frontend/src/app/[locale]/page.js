import { redirect } from "@/i18n/navigation";

export default async function Home({ params }) {
  const { locale } = await params;
  redirect({ href: "/login", locale });
}
