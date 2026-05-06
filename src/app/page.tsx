import { redirect } from "next/navigation";
import { listAvailableSeasons } from "@/lib/season-static";

export default async function Page() {
  const seasons = await listAvailableSeasons();
  // Default to the latest season with data; fall back to 2025 if none.
  const target = seasons.length > 0 ? seasons[seasons.length - 1] : 2025;
  redirect(`/${target}`);
}
