import { redirect } from "next/navigation";
import { listAvailableSeasons } from "@/lib/season-static";

export default async function RaceRedirect() {
  const seasons = await listAvailableSeasons();
  const target = seasons.length > 0 ? seasons[seasons.length - 1] : 2025;
  redirect(`/${target}/race/1`);
}
