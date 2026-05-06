import { redirect } from "next/navigation";
import { listAvailableSeasons } from "@/lib/season-static";

export default async function LegacyRaceRedirect({ params }: { params: Promise<{ round: string }> }) {
  const { round } = await params;
  const seasons = await listAvailableSeasons();
  const target = seasons.length > 0 ? seasons[seasons.length - 1] : 2025;
  redirect(`/${target}/race/${round}`);
}
